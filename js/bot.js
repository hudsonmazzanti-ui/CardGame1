'use strict';
/*
  DISPATCH — computer opponent.

  The bot plays the same way a second phone would: it only knows its own secret,
  so your hand, deck and traps are hidden from it. Each turn it looks at every move
  it could make right now (with every way of paying for it), scores the board that
  would result, makes the best one, and repeats until nothing improves the board.
*/

function botSubsets(arr) {
  const out = [];
  for (let m = 0; m < 1 << arr.length; m++) out.push(arr.filter((_, i) => (m >> i) & 1));
  return out;
}

// Every minimal set of pitches that covers `need` (never pitching the card being played).
function botPayPlans(st, hand, skip, need) {
  if (st.pool >= need) return [[]];
  const rest = hand.map((c, i) => [c, i]).filter(([c, i]) => i !== skip && c !== '?' && CARDS[c] && CARDS[c].pitch > 0);
  const plans = [];
  for (const sub of botSubsets(rest)) {
    const sum = sub.reduce((s, [c]) => s + CARDS[c].pitch, st.pool);
    if (sum < need || sub.some(([c]) => sum - CARDS[c].pitch >= need)) continue;
    plans.push(sub.map(([c]) => ['p', c]));
  }
  return plans;
}

function botCandidates(st, me, sec) {
  const P = st.P[me], Q = st.P[1 - me], out = [];
  const tax = taxOf(st, me), base = nextUid(st);
  P.hand.forEach((c, i) => {
    if (c === '?' || !CARDS[c] || P.hand.indexOf(c) !== i) return;
    const C = CARDS[c];
    if (C.type === 'trap') {
      if (P.traps.length >= MAX_TRAPS) return;
      const x = c === 'calledshot' ? 2 : c === 'omen' ? (Q.board.length ? 1 : 0) : null;
      for (const plan of botPayPlans(st, P.hand, i, C.cost + tax))
        out.push([...plan, ['t', commitFor(c, x, saltFor(sec.seed, base + plan.length)), C.cost]]);
      return;
    }
    const k = costOf(st, me, c);
    const targets = C.target ? spellTargets(st, c) : [null];
    if (!targets.length) return;
    const slots = C.type === 'unit' ? [...new Set([P.board.length, Math.floor(P.board.length / 2)])] : [null];
    const pick = c === 'map' ? botMapPick(st, sec) : null;
    const lifeOpts = C.blood ? [0, 1, 2, 3].filter(l => l <= k) : [0];
    for (const l of lifeOpts)
      for (const plan of botPayPlans(st, P.hand, i, k + tax - l))
        for (const tg of targets) for (const slot of slots)
          out.push([...plan, ['c', c, k, l, tg, slot, pick]]);
    if (C.disguise)
      for (const plan of botPayPlans(st, P.hand, i, 1 + tax))
        out.push([...plan, ['d', commitFor(c, null, saltFor(sec.seed, base + plan.length)), P.board.length]]);
  });
  for (const u of P.board) {
    if (u.fd && u.sid && !u.sick) {
      const ts = flipTargets(st, u.sid);
      for (const plan of botPayPlans(st, P.hand, -1, CARDS[u.sid].disguise))
        for (const tg of ts.length ? ts : [null])
          out.push([...plan, ['f', u.uid, u.sid, saltFor(sec.seed, u.uid), tg]]);
    }
    if (!attackBlock(st, u.uid)) for (const tg of attackTargets(st, u.uid)) out.push([['a', u.uid, tg]]);
  }
  return out;
}

function botMapPick(st, sec) {
  const opts = mapOptions(sec, st.turn, st.v);
  return opts.reduce((best, id) => (CARDS[id].cost > CARDS[best].cost ? id : best), opts[0]);
}

// How good the board looks for `me`. Life is what wins; units and traps matter less near the end.
function botScore(st, me) {
  if (st.over) return st.over.winner === me ? 1e5 : st.over.winner === null ? 0 : -1e5;
  const P = st.P[me], Q = st.P[1 - me];
  const w = Math.min(1, (TURNS - 1 - st.turn) / 3);
  const units = s => st.P[s].board.reduce((t, u, i) =>
    t + u.atk * 1.1 + Math.max(0, u.hp - u.dmg) * 0.7 + (hasTaunt(st, s, i) ? 1 : 0) + (u.burrowed ? 0.5 : 0), 0);
  let score = P.life - Q.life;
  score += w * (units(me) - units(1 - me));
  score += w * 1.2 * (P.traps.length - Q.traps.length);
  score += 0.35 * P.hand.filter(c => c !== 'hex').length - 2.2 * P.hand.filter(c => c === 'hex').length;
  score += w * 0.4 * Object.values(P.temper).reduce((a, b) => a + b, 0);
  if (st.terrain) score += w * (st.terrain.owner === me ? 0.8 : -0.4);
  score += w * 0.75 * (st.tax[1 - me] || 0);
  return score;
}

function botPlan(st, me, sec) {
  const acts = [];
  for (let step = 0; step < 16 && !st.over && !st.ended; step++) {
    let best = null, bestScore = botScore(st, me) + 0.05;
    for (const grp of botCandidates(st, me, sec)) {
      const s2 = structuredClone(st);
      try { for (const a of grp) act(s2, a, true); }
      catch (e) { if (e instanceof Fizzle) continue; throw e; }
      const sc = botScore(s2, me);
      if (sc > bestScore) { bestScore = sc; best = { grp, s2 }; }
    }
    if (!best) break;
    acts.push(...best.grp);
    st = best.s2;
  }
  acts.push(['e']);
  return acts;
}

// Given the game log, return it with the bot's next message added, or null if it isn't the bot's move.
function botRespond(log, bs, sec) {
  const secrets = [null, null];
  secrets[bs] = sec;
  const base = rebuild(log, secrets);
  const T = log.t.length, last = log.t[T - 1];
  if (last && !last.a) return null;
  const out = structuredClone(log);
  if (base.st.over && !base.pending) {
    if (last && (T - 1) % 2 !== bs) out.t.push({ r: base.owed });
    return out;
  }
  if (T % 2 !== bs || base.pending) return null;
  const st = structuredClone(base.st);
  startTurn(st, T);
  const acts = botPlan(st, bs, sec);
  out.t.push(base.owed.length ? { a: acts, r: base.owed } : { a: acts });
  return out;
}

if (typeof module !== 'undefined') module.exports = { botPlan, botRespond, botScore };
