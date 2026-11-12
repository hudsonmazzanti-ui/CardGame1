'use strict';
/*
  DISPATCH — rules engine.

  The game is a log of turns. Every phone replays the whole log from the start,
  so both phones always agree on the public board.

  Hidden information:
  - Each player has a secret (seed + 10-card deck) stored only on their phone.
    The seed shuffles the deck and salts the seals on traps and face-down units.
  - On the other phone, unknown cards show as '?'.
  - A trap fires during the *opponent's* turn. The trap owner's phone sees it fire
    when it replays that turn, and attaches the "reveal" to its next message so the
    other phone can replay the same turn identically.
  - Rule: whether an action succeeds or fizzles depends only on public state.
    Private checks (was that card really in your hand?) only raise warnings, which
    the end-of-game fair-play check reports.
*/

const TURNS = 10, START_LIFE = 20, HAND_SIZE = 3, MAX_UNITS = 5, MAX_TRAPS = 3;
const POOL = Object.keys(CARDS).filter(id => !CARDS[id].token);
const TRAP_COSTS = [...new Set(POOL.filter(id => CARDS[id].type === 'trap').map(id => CARDS[id].cost))];

class Fizzle extends Error {}
const need = (ok, msg) => { if (!ok) throw new Fizzle(msg); };

// ---------- hashing & randomness ----------
function b64u(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hashStr = (s, n = 16) => b64u(sha256(s).slice(0, n));
const saltFor = (seed, uid) => hashStr(`${seed}|salt|${uid}`, 12);
const commitFor = (c, x, salt) => hashStr(`${c}|${x ?? ''}|${salt}`);
const deckCommit = (seed, deck) => hashStr(`${seed}|${[...deck].sort().join(',')}`);
function rngFor(seed, tag) {
  const b = sha256(`${seed}|${tag}`);
  let s = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const mapOptions = (secret, turn) =>
  shuffled(POOL.filter(id => !secret.deck.includes(id)), rngFor(secret.seed, 'map|' + turn)).slice(0, 3);

function validDeck(cards) {
  return Array.isArray(cards) && cards.length === 10 && new Set(cards).size === 10 && cards.every(c => POOL.includes(c));
}

// ---------- state ----------
function newState(secrets) {
  return {
    turn: -1, ai: 0, pool: 0, terrain: null, over: null, attackers: [], ended: false,
    ev: [], warn: [], reveals: [],
    P: [0, 1].map(i => {
      const sec = secrets[i] || null;
      let deck, hand;
      if (sec) { deck = shuffled(sec.deck, rngFor(sec.seed, 'deck')); hand = deck.splice(0, HAND_SIZE); }
      else { deck = Array(10 - HAND_SIZE).fill('?'); hand = Array(HAND_SIZE).fill('?'); }
      return { life: START_LIFE, hand, deck, discard: [], board: [], traps: [], temper: {}, held: {}, found: [], sec };
    }),
  };
}

const active = st => st.turn % 2;
const turnNo = st => Math.floor(st.turn / 2) + 1;
const opp = p => 1 - p;
const ev = (st, p, s, k = '') => st.ev.push({ t: st.turn, p, s, k });

function findUnit(st, uid) {
  for (let s = 0; s < 2; s++) {
    const i = st.P[s].board.findIndex(u => u.uid === uid);
    if (i >= 0) return { u: st.P[s].board[i], side: s, idx: i };
  }
  return null;
}
const unitName = u => (u.fd ? 'a face-down unit' : CARDS[u.id].name);

function hasTaunt(st, side, i) {
  const b = st.P[side].board, u = b[i];
  if (u.burrowed) return false;
  if (!u.fd && CARDS[u.id].taunt) return true;
  return [b[i - 1], b[i + 1]].some(n => n && !n.fd && n.id === 'sergeant');
}
function tauntUnits(st, side) {
  return st.P[side].board.filter((u, i) => hasTaunt(st, side, i));
}

// ---------- queries used by the UI ----------
function attackBlock(st, uid) {
  if (st.over || st.ended) return 'The turn is over.';
  const f = findUnit(st, uid);
  if (!f || f.side !== active(st)) return 'That unit isn’t yours.';
  const u = f.u;
  if (u.sick && !u.rush) return 'Units can attack starting the turn after they’re played.';
  if (u.att >= u.allow) return 'It already attacked this turn.';
  if (st.terrain && st.terrain.id === 'pass' && !st.attackers.includes(uid) && st.attackers.length >= CARDS.pass.max)
    return `Narrow Pass: only ${CARDS.pass.max} units can attack each turn.`;
  return null;
}
function attackTargets(st) {
  const q = opp(active(st)), Q = st.P[q];
  const taunts = tauntUnits(st, q);
  if (taunts.length) return taunts.map(u => u.uid);
  return ['f', ...Q.board.filter(u => !u.burrowed).map(u => u.uid)];
}
function spellTargets(st, c) {
  const p = active(st), q = opp(p);
  const units = s => st.P[s].board.filter(u => !u.burrowed).map(u => u.uid);
  switch (CARDS[c].target) {
    case 'any': return ['f', ...units(q), ...units(p)];
    case 'unit': return [...units(q), ...units(p)];
    case 'attacked': return st.P[p].board.filter(u => u.att > 0).map(u => u.uid);
  }
  return null;
}
function flipTargets(st, c) {
  const Q = st.P[opp(active(st))];
  if (c === 'assassin') return Q.board.filter(u => !u.burrowed && u.dmg > 0).map(u => u.uid);
  if (c === 'doppel') return Q.board.filter(u => !u.burrowed && !u.fd).map(u => u.uid);
  return [];
}
// Cost as everyone can see it. Patient Titan's discount is private, so the player declares it.
function costOf(st, p, c) {
  const C = CARDS[c];
  if (c === 'golem') return Math.max(0, C.cost - C.temper * (st.P[p].temper[c] || 0));
  if (c === 'titan') { const P = st.P[p]; return P.sec ? Math.max(0, C.cost - (P.held.titan || 0)) : null; }
  return C.cost;
}
function spellDamage(st, p, c) {
  if (c === 'whetstone') return CARDS.whetstone.dmg + CARDS.whetstone.temper * (st.P[p].temper.whetstone || 0);
  if (c === 'curtain') return turnNo(st) === 5 ? CARDS.curtain.finale : CARDS.curtain.dmg;
  return 0;
}
function whelpStats(st, p) {
  const t = st.P[p].temper.whelp || 0, C = CARDS.whelp;
  return [C.atk + C.temper * t, C.hp + C.temper * t];
}

// ---------- internals ----------
function takeFromHand(st, p, c) {
  const P = st.P[p];
  let i = P.hand.indexOf(c);
  if (i < 0) {
    if (P.sec) st.warn.push(`${CARDS[c] ? CARDS[c].name : c} was used but wasn't in hand (turn ${turnNo(st)}).`);
    i = P.hand.indexOf('?');
  }
  P.hand.splice(i >= 0 ? i : 0, 1);
}
// A hidden card leaves the hand (trap or face-down unit).
function takeHidden(st, p, found, pred) {
  const P = st.P[p];
  if (P.sec) {
    if (found) { P.hand.splice(P.hand.indexOf(found.c), 1); return; }
    st.warn.push(`A sealed card didn't match anything in hand (turn ${turnNo(st)}).`);
    P.hand.splice(0, 1);
    return;
  }
  // Watching phone: forget any known card that could have been the one played.
  P.hand = P.hand.map(h => (h !== '?' && pred(h) ? '?' : h));
  const i = P.hand.indexOf('?');
  P.hand.splice(i >= 0 ? i : 0, 1);
}
function identify(st, p, h, uid, pred) {
  const P = st.P[p];
  if (!P.sec) return null;
  const s = saltFor(P.sec.seed, uid);
  for (const c of new Set(P.hand)) {
    if (c === '?' || !CARDS[c] || !pred(c)) continue;
    for (const x of c === 'calledshot' ? [0, 1, 2, 3, 4] : [null])
      if (commitFor(c, x, s) === h) return { c, x, s };
  }
  return null;
}
function fire(st, q, id, pred = () => true) {
  const Q = st.P[q];
  const i = Q.traps.findIndex(t => t.id === id && pred(t));
  if (i < 0) return null;
  const t = Q.traps.splice(i, 1)[0];
  Q.discard.push(id);
  st.reveals.push({ u: t.uid, c: t.id, x: t.x ?? null, s: t.s });
  return t;
}
// Object ids come from the turn and the action's position, never from what happened before,
// so a trap changing the outcome of one action can't shift the ids (and seals) of later ones.
const nextUid = st => (st.turn + 1) * 100 + st.ai;
function mkUnit(st, p, c, uid) {
  const C = CARDS[c];
  let [atk, hp] = c === 'whelp' ? whelpStats(st, p) : [C.atk, C.hp];
  return { uid, owner: p, card: c, id: c, fd: false, atk, hp, dmg: 0, sick: true, rush: !!C.rush,
           att: 0, allow: 1, burrowed: c === 'wyrm', did: false };
}
function deaths(st) {
  for (;;) {
    const dead = [];
    for (let s = 0; s < 2; s++) for (const u of st.P[s].board) if (u.dmg >= u.hp || u.doomed) dead.push([s, u]);
    if (!dead.length) return;
    for (const [s, u] of dead) {
      st.P[s].board.splice(st.P[s].board.indexOf(u), 1);
      st.P[u.owner].discard.push(u.card);
      ev(st, s, `{Ps} ${unitName(u)} was destroyed.`, 'die');
    }
    for (const [s, u] of dead) {
      if (!u.fd && u.id === 'zealot') {
        st.P[opp(s)].life -= CARDS.zealot.dmg;
        ev(st, s, `{Ps} Ashen Zealot dealt ${CARDS.zealot.dmg} to {O} as it died.`, 'dmg');
      }
    }
    for (let s = 0; s < 2; s++) for (const f of st.P[s].board) {
      if (!f.fd && f.id === 'feeder') { f.atk += dead.length; f.hp += dead.length; }
    }
  }
}
function ko(st) {
  if (st.over) return;
  const a = st.P[0].life, b = st.P[1].life;
  if (a <= 0 || b <= 0) st.over = { winner: a <= 0 && b <= 0 ? null : a <= 0 ? 1 : 0, ko: true };
}

// ---------- turn structure ----------
function startTurn(st, i) {
  st.turn = i; st.ai = 0; st.pool = 0; st.attackers = []; st.reveals = []; st.ended = false;
  for (const u of st.P[i % 2].board) { u.sick = false; u.att = 0; u.allow = 1; u.did = false; }
}
function endTurn(st) {
  const p = active(st), P = st.P[p];
  if (!st.ev.some(e => e.t === st.turn)) ev(st, p, '{P} passed.', 'pass');
  if (st.terrain && st.terrain.id === 'field') {
    for (const s of [0, 1]) for (const u of st.P[s].board) u.dmg += CARDS.field.dmg;
    ev(st, st.terrain.owner, `Ember Field burned every unit for ${CARDS.field.dmg}.`, 'dmg');
    deaths(st);
  }
  for (const u of P.board) if (!u.fd && u.id === 'wyrm' && !u.did && !u.burrowed) {
    u.burrowed = true; ev(st, p, '{Ps} Tunneling Wyrm burrowed.');
  }
  const hx = P.hand.filter(h => h === 'hex').length;
  if (hx) { P.life -= hx * CARDS.hex.life; ev(st, p, `{P} lost ${hx * CARDS.hex.life} life to a Hex.`, 'dmg'); }
  if (P.sec) for (const h of P.hand) if (h === 'titan') P.held.titan = (P.held.titan || 0) + 1;
  P.hand.push(...P.found.splice(0));
  while (P.hand.length < HAND_SIZE && P.deck.length) P.hand.push(P.deck.shift());
  st.pool = 0;
  st.ended = true;
  ko(st);
  if (!st.over && st.turn === TURNS - 1) {
    const a = st.P[0].life, b = st.P[1].life;
    st.over = { winner: a > b ? 0 : b > a ? 1 : null, ko: false };
  }
}

// ---------- actions ----------
/*
  ['p', card]                                pitch a card
  ['c', card, cost, lifePaid, target, slot, pick]   play a unit or spell
  ['t', seal, cost]                          set a trap face-down
  ['d', seal, slot]                          play a unit face-down (costs 1)
  ['f', uid, card, salt, target]             flip a face-down unit
  ['a', uid, target]                         attack ('f' = the opponent)
  ['e']                                      end turn
*/
function act(st, a, strict) {
  const p = active(st), q = opp(p), P = st.P[p], Q = st.P[q];
  const uid = nextUid(st);
  st.ai++;
  try {
    need(!st.over && !st.ended, 'The turn is over.');
    need(Array.isArray(a), 'Bad action.');
    switch (a[0]) {
      case 'p': {
        const c = a[1], C = CARDS[c];
        need(C && C.pitch > 0, "That card can't be pitched.");
        need(P.hand.length > 0, 'No cards in hand.');
        takeFromHand(st, p, c);
        st.pool += C.pitch;
        P.temper[c] = (P.temper[c] || 0) + 1;
        P.deck.push(c);
        ev(st, p, `{P} pitched ${C.name} for ${C.pitch}.`, 'pitch');
        break;
      }
      case 'c': {
        const [, c, k, l = 0, tg = null, slot = null, pick = null] = a;
        const C = CARDS[c];
        need(C && C.type !== 'trap', 'Unknown card.');
        need(P.hand.length > 0, 'No cards in hand.');
        if (c === 'titan') {
          need(Number.isInteger(k) && k >= 0 && k <= C.cost, 'Bad cost.');
          if (P.sec && k !== costOf(st, p, c)) st.warn.push(`Patient Titan was played for the wrong cost (turn ${turnNo(st)}).`);
        } else need(k === costOf(st, p, c), 'Wrong cost.');
        need(Number.isInteger(l) && l >= 0 && l <= k && (l === 0 || C.blood), 'Bad life payment.');
        need(st.pool >= k - l, 'Not enough resources.');
        if (C.type === 'unit') need(P.board.length < MAX_UNITS, 'Your side of the board is full.');
        if (C.target) need(spellTargets(st, c).includes(tg), 'Pick a valid target.');
        if (c === 'map') need(POOL.includes(pick) && pick !== 'map', 'Pick a card.');

        takeFromHand(st, p, c);
        st.pool -= k - l;
        P.life -= 2 * l;
        ev(st, p, `{P} played ${C.name}${l ? ` (paid ${2 * l} life)` : ''}.`, 'play');

        if (fire(st, q, 'calledshot', t => t.x === k)) {
          P.deck.push(c);
          ev(st, q, `{Ps} Called Shot on ${k} cancelled ${C.name}. It went to the bottom of {Os} deck.`, 'trap');
          break;
        }
        if (C.type === 'unit') {
          const u = mkUnit(st, p, c, uid);
          if (c === 'lancer' && turnNo(st) === 5) { u.atk += C.bonus; u.rush = true; ev(st, p, 'Finale: Twilight Lancer charges in.'); }
          const at = Number.isInteger(slot) ? Math.max(0, Math.min(slot, P.board.length)) : P.board.length;
          P.board.splice(at, 0, u);
          if (k <= CARDS.turncoat.max && Q.board.length < MAX_UNITS && fire(st, q, 'turncoat')) {
            P.board.splice(P.board.indexOf(u), 1);
            Q.board.push(u);
            ev(st, q, `{Ps} Turncoat took control of ${C.name}.`, 'trap');
          }
        } else if (C.type === 'hex') {
          // Played away. Nothing happens.
        } else {
          if (fire(st, q, 'reflect')) {
            const d = spellDamage(st, p, c);
            if (d) P.life -= d;
            P.discard.push(c);
            ev(st, q, `{Ps} Reflect cancelled ${C.name}${d ? ` and sent ${d} damage back at {O}` : ''}.`, 'trap');
            break;
          }
          resolveSpell(st, p, c, tg, pick);
        }
        break;
      }
      case 't': {
        const [, h, k] = a;
        need(typeof h === 'string' && TRAP_COSTS.includes(k), 'Bad trap.');
        need(P.hand.length > 0, 'No cards in hand.');
        need(P.traps.length < MAX_TRAPS, `You can have at most ${MAX_TRAPS} traps set.`);
        need(st.pool >= k, 'Not enough resources.');
        const pred = c => CARDS[c].type === 'trap' && CARDS[c].cost === k;
        const found = identify(st, p, h, uid, pred);
        takeHidden(st, p, found, pred);
        st.pool -= k;
        if (fire(st, q, 'calledshot', t => t.x === k)) {
          P.deck.push(found ? found.c : '?');
          ev(st, q, `{Ps} Called Shot on ${k} cancelled {Os} trap.`, 'trap');
          break;
        }
        P.traps.push({ uid, h, k, id: found ? found.c : null, x: found ? found.x : null, s: found ? found.s : null });
        ev(st, p, `{P} set a ${k}-cost trap.`, 'set');
        break;
      }
      case 'd': {
        const [, h, slot] = a;
        need(typeof h === 'string', 'Bad seal.');
        need(P.hand.length > 0, 'No cards in hand.');
        need(P.board.length < MAX_UNITS, 'Your side of the board is full.');
        need(st.pool >= 1, 'Not enough resources.');
        const pred = c => !!CARDS[c].disguise;
        const found = identify(st, p, h, uid, pred);
        takeHidden(st, p, found, pred);
        st.pool -= 1;
        const u = { uid, owner: p, card: found ? found.c : '?', id: null, fd: true, h, sid: found ? found.c : null,
                    atk: 2, hp: 2, dmg: 0, sick: true, rush: false, att: 0, allow: 1, burrowed: false, did: false };
        const at = Number.isInteger(slot) ? Math.max(0, Math.min(slot, P.board.length)) : P.board.length;
        P.board.splice(at, 0, u);
        if (fire(st, q, 'calledshot', t => t.x === 1)) {
          P.board.splice(P.board.indexOf(u), 1);
          P.deck.push(u.card);
          ev(st, q, `{Ps} Called Shot on 1 cancelled {Os} face-down unit.`, 'trap');
          break;
        }
        ev(st, p, '{P} played a unit face-down.', 'play');
        break;
      }
      case 'f': {
        const [, fu, c, s, tg = null] = a;
        const f = findUnit(st, fu);
        need(f && f.side === p && f.u.fd, 'That isn’t one of your face-down units.');
        need(!f.u.sick, 'You can flip it starting next turn.');
        const C = CARDS[c];
        need(C && C.disguise, 'Bad card.');
        need(commitFor(c, null, s) === f.u.h, "That card doesn't match its seal.");
        need(st.pool >= C.disguise, 'Not enough resources.');
        const ts = flipTargets(st, c);
        need(ts.length ? ts.includes(tg) : tg === null, 'Pick a valid target.');
        const u = f.u;
        st.pool -= C.disguise;
        Object.assign(u, { fd: false, id: c, card: c, atk: C.atk, hp: C.hp, sid: null, h: null });
        ev(st, p, `{P} flipped ${C.name}.`, 'flip');
        if (tg !== null) {
          const t = findUnit(st, tg).u;
          if (c === 'assassin') { t.doomed = true; ev(st, p, `Masked Assassin destroyed ${unitName(t)}.`, 'die'); }
          if (c === 'doppel') {
            Object.assign(u, { id: t.id, atk: t.atk, hp: t.hp, rush: t.rush, burrowed: false });
            ev(st, p, `Doppelganger became a copy of ${CARDS[t.id].name}.`);
          }
        }
        break;
      }
      case 'a': {
        const [, au, tg] = a;
        const f = findUnit(st, au);
        need(f && f.side === p, 'That unit isn’t yours.');
        const why = attackBlock(st, au);
        need(!why, why);
        need(attackTargets(st).includes(tg), 'Pick a valid target.');
        const u = f.u;
        u.att++; u.did = true; u.burrowed = false;
        if (!st.attackers.includes(au)) st.attackers.push(au);
        const tName = tg === 'f' ? '{O}' : unitName(findUnit(st, tg).u);
        ev(st, p, `{Ps} ${unitName(u)} attacked ${tName}.`, 'atk');
        if (fire(st, q, 'pitfall')) {
          u.dmg += CARDS.pitfall.dmg;
          ev(st, q, `{Ps} Pitfall hit ${unitName(u)} for ${CARDS.pitfall.dmg}.`, 'trap');
          deaths(st);
          if (!findUnit(st, au)) break;
        }
        if (tg === 'f') {
          let d = u.atk;
          if (fire(st, q, 'aegis')) {
            const prev = CARDS.aegis.prevent + CARDS.aegis.temper * (Q.temper.aegis || 0);
            d = Math.max(0, d - prev);
            ev(st, q, `{Ps} Tempered Aegis blocked ${Math.min(prev, u.atk)} damage.`, 'trap');
          }
          Q.life -= d;
          ev(st, p, `{O} took ${d} damage.`, 'dmg');
        } else {
          const t = findUnit(st, tg).u;
          t.dmg += u.atk; u.dmg += t.atk;
        }
        break;
      }
      case 'e':
        endTurn(st);
        break;
      default:
        need(false, 'Unknown action.');
    }
    deaths(st);
    ko(st);
    return true;
  } catch (e) {
    if (!(e instanceof Fizzle)) throw e;
    if (strict) throw e;
    ev(st, p, `One of {Ps} actions fizzled: ${e.message}`, 'fizzle');
    return false;
  }
}

function resolveSpell(st, p, c, tg, pick) {
  const q = opp(p), P = st.P[p], Q = st.P[q], C = CARDS[c];
  switch (c) {
    case 'whetstone':
    case 'curtain': {
      const d = spellDamage(st, p, c);
      if (tg === 'f' || c === 'curtain') { Q.life -= d; ev(st, p, `{O} took ${d} damage.`, 'dmg'); }
      else { const t = findUnit(st, tg).u; t.dmg += d; ev(st, p, `${unitName(t)} took ${d} damage.`, 'dmg'); }
      break;
    }
    case 'bloodprice': {
      const t = findUnit(st, tg).u;
      t.doomed = true; P.life -= C.life;
      ev(st, p, `Blood Price destroyed ${unitName(t)}. {P} lost ${C.life} life.`, 'die');
      break;
    }
    case 'quickstep': findUnit(st, tg).u.allow += 1; break;
    case 'witch': Q.hand.push('hex'); ev(st, p, '{O} got a Hex.'); break;
    case 'map':
      if (P.sec && !mapOptions(P.sec, st.turn).includes(pick)) st.warn.push(`Scavenger's Map picked a card it wasn't offered (turn ${turnNo(st)}).`);
      P.found.push(pick);
      ev(st, p, `{P} found ${CARDS[pick].name}. It arrives at the end of the turn.`);
      break;
    case 'pass':
    case 'field':
      if (st.terrain) st.P[st.terrain.owner].discard.push(st.terrain.id);
      st.terrain = { id: c, owner: p };
      return;
  }
  P.discard.push(c);
}

function applyReveals(st, q, reveals) {
  for (const r of reveals || []) {
    const t = st.P[q].traps.find(t => t.uid === r.u);
    if (t && CARDS[r.c] && commitFor(r.c, r.x, r.s) === t.h) Object.assign(t, { id: r.c, x: r.x, s: r.s });
    else st.warn.push('A revealed trap did not match its seal.');
  }
}

/*
  Replay a game log.
  log = { v, id, n:[names], c:[deck seals], t:[{a:[actions], r:[reveals]}], x:[secrets revealed at the end] }
  t[i] is played by player i % 2. t[i].r reveals that player's traps that fired during t[i-1].
  An entry with no `a` only carries reveals for the final turn.
*/
function publicSnap(st) {
  return JSON.stringify({
    life: st.P.map(P => P.life), terrain: st.terrain, over: st.over,
    hand: st.P.map(P => P.hand.length), deck: st.P.map(P => P.deck.length), temper: st.P.map(P => P.temper),
    traps: st.P.map(P => P.traps.map(t => [t.uid, t.k])),
    board: st.P.map(P => P.board.map(u => [u.uid, u.owner, u.fd, u.fd ? null : u.id, u.atk, u.hp, u.dmg, u.burrowed])),
  });
}

function rebuild(log, secrets) {
  const st = newState(secrets);
  let owed = [], pending = false;
  const snaps = [];
  for (let i = 0; i < log.t.length; i++) {
    const e = log.t[i];
    if (!e.a || st.over) break;
    const p = i % 2, q = 1 - p, nx = log.t[i + 1];
    if (!secrets[q]) {
      if (nx) applyReveals(st, q, nx.r);
      else pending = true;
    }
    startTurn(st, i);
    for (const a of e.a) { if (st.ended || st.over) break; act(st, a, false); }
    if (!st.ended && !st.over) endTurn(st);
    snaps.push(publicSnap(st));
    if (secrets[q]) {
      if (nx) {
        const want = JSON.stringify(st.reveals), got = JSON.stringify(nx.r || []);
        if (want !== got) st.warn.push(`Trap reveals for turn ${Math.floor(i / 2) + 1} don't match.`);
      } else owed = st.reveals;
    }
  }
  return { st, owed, pending, snaps };
}

if (typeof module !== 'undefined') {
  module.exports = { CARDS, POOL, rebuild, newState, startTurn, act, endTurn, saltFor, commitFor, deckCommit,
    mapOptions, nextUid, attackTargets, attackBlock, spellTargets, flipTargets, costOf, validDeck, Fizzle };
}
