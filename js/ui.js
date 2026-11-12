'use strict';
/* DISPATCH — interface. */

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let view = 'home';        // home | decks | edit | rules | new | join | game | sent
let G = null;             // current game
let editDeck = null;      // deck being edited
let sheet = null;         // open sheet {title, html, buttons}
let sentCode = null;

// ---------- small helpers ----------
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 2600);
}
const typeLabel = id => {
  const C = CARDS[id];
  if (C.type === 'hex') return 'Token';
  if (C.terrain) return 'Spell · Terrain';
  return C.type[0].toUpperCase() + C.type.slice(1);
};
const savedDecks = () => store.get('decks', []);
const allDecks = () => [...savedDecks().map(d => ({ ...d, mine: true })), ...PRESET_DECKS];

// ---------- engraving ----------
// Each card gets its own guilloché band and rosette, generated from its id, like the
// engraved panels on stamps and banknotes.
const engraved = {};
// Layered polar rosette: n petals, a finer secondary ripple, four offset rings.
function rosettePath(b, cx, cy, size, layers = 4) {
  const n = 7 + (b[5] % 7), m = n * (2 + (b[6] % 2)), depth = 0.2 + (b[7] % 4) * 0.04, ripple = 0.04 + (b[8] % 3) * 0.02;
  let p = '';
  for (let L = 0; L < layers; L++) {
    const scale = 1 - L * 0.13, shift = (L * Math.PI) / n;
    for (let i = 0; i <= 360; i++) {
      const t = (i / 360) * Math.PI * 2;
      const rho = size * scale * (1 - depth + depth * Math.cos(n * t + shift) + ripple * Math.cos(m * t));
      p += (i ? 'L' : 'M') + (cx + rho * Math.cos(t)).toFixed(1) + ' ' + (cy + rho * Math.sin(t)).toFixed(1);
    }
  }
  return p;
}
function engraving(id) {
  if (engraved[id]) return engraved[id];
  const b = sha256('engrave|' + id);
  const f1 = 2 + (b[0] % 3), f2 = 5 + (b[1] % 4), amp = 7 + (b[2] % 5), lines = 6, ph = b[4] / 40;
  let waves = '';
  for (let j = 0; j < lines; j++) {
    let d = '';
    for (let x = 0; x <= 240; x += 3) {
      const t = (x / 240) * Math.PI * 2;
      const y = 20 + Math.sin(t * f1 + j * 0.5 + ph) * amp * (0.65 + 0.35 * Math.cos(t * 2 + j * 0.3)) + Math.sin(t * f2 - j * 0.7) * amp * 0.22;
      d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1);
    }
    waves += `<path d="${d}"/>`;
  }
  const ros = rosettePath(b, 120, 20, 15, 3);
  engraved[id] = {
    band: `<svg class="engr" viewBox="0 0 240 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g class="engr-w">${waves}</g><circle class="engr-bg" cx="120" cy="20" r="17"/><path class="engr-r" d="${ros}"/></svg>`,
    rosette: `<svg class="rosette" viewBox="0 0 40 40" aria-hidden="true"><path d="${rosettePath(b, 20, 20, 18)}"/></svg>`,
  };
  return engraved[id];
}

function pips(n) {
  return `<span class="pips" aria-label="Pitch ${n}">${[0, 1].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}
function cardFace(id, o = {}) {
  if (id === '?') return `<div class="cf cf-back ${o.cls || ''}" ${o.attrs || ''}><span>${engraving('back').rosette}<b>Dispatch</b></span></div>`;
  const C = CARDS[id];
  const cost = o.cost ?? C.cost;
  const stats = C.type === 'unit'
    ? `<div class="cf-stats"><span><b>${o.atk ?? C.atk}</b><small>atk</small></span><span><small>hp</small><b>${o.hp ?? C.hp}</b></span></div>` : '';
  const tags = o.tags ? `<div class="cf-tags">${o.tags}</div>` : '';
  return `<div class="cf cf-${C.terrain ? 'terrain' : C.type} ${o.cls || ''}" ${o.attrs || ''}>
    <div class="cf-top"><span class="cf-cost${cost !== C.cost ? ' changed' : ''}">${cost}</span>${pips(C.pitch)}</div>
    <div class="cf-name">${esc(C.name)}</div>
    <div class="cf-type">${typeLabel(id)}</div>
    <div class="cf-band">${engraving(id).band}</div>
    <div class="cf-text">${esc(cardText(id))}</div>
    ${tags}${stats}
  </div>`;
}

// ---------- routing ----------
async function boot() {
  const code = location.hash.slice(1);
  if (code.length > 8) {
    try { await openCode(code); return; }
    catch (e) { console.error(e); view = 'home'; render(); toast(e.message || 'That link could not be opened.'); return; }
  }
  view = 'home'; render();
}
window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== (G && G.code)) boot(); });

function go(v) {
  view = v; sheet = null;
  if (v !== 'game' && v !== 'sent' && location.hash) history.replaceState(null, '', location.pathname);
  render();
  window.scrollTo(0, 0);
}

// ---------- game records ----------
function gameRecord(id) { return store.get('game.' + id); }
function saveRecord(g) {
  const ids = store.get('games', []);
  if (!ids.includes(g.id)) { ids.unshift(g.id); store.set('games', ids); }
  store.set('game.' + g.id, {
    id: g.id, side: g.side, secret: g.secret, code: g.code, n: g.log.n,
    status: g.status, turn: g.T, result: g.result || null, updated: Date.now(),
    bot: g.bot || null,
  });
}

async function openCode(code) {
  const log = await decodeLog(code);
  const rec = gameRecord(log.id);
  let notice = null;
  if (rec && rec.code && rec.code !== code) {
    try {
      const mine = await decodeLog(rec.code);
      const progress = l => l.t.length * 2 + (l.x || []).filter(Boolean).length;
      const same = mine.t.slice(0, Math.min(mine.t.length, log.t.length)).every((e, i) => JSON.stringify(e) === JSON.stringify(log.t[i]));
      if (progress(mine) > progress(log)) {
        notice = { kind: 'old', code: rec.code };
      } else if (!same) {
        notice = { kind: 'diff' };
      }
    } catch (e) { /* ignore a bad stored copy */ }
  }
  if (rec) {
    G = makeGame(log, rec.side, rec.secret, code, rec.bot);
  } else if (log.c.length === 1 && log.t.length === 1) {
    G = makeGame(log, 1, null, code);
    G.joining = true;
  } else {
    G = makeGame(log, 0, null, code);
    G.spectator = true;
  }
  G.notice = notice;
  if ((log.v || 1) > RULES_VERSION) G.versionWarn = true;
  if (!G.spectator && !G.joining && !(notice && notice.kind === 'old')) saveRecord(G);
  view = G.joining ? 'join' : 'game';
  render();
  if (G.bot && G.status === 'bot') runBot();
}

// bot = { secret, deck } for games against the computer, which live only on this phone.
function makeGame(log, side, secret, code, bot = null) {
  const g = { id: log.id, log, side, secret, code, bot, acts: [], pend: null, mode: null, recap: true };
  compute(g);
  return g;
}

function compute(g) {
  const secrets = [null, null];
  if (g.secret) secrets[g.side] = g.secret;
  const o = 1 - g.side;
  if (g.secret && g.log.x && g.log.x[o]) secrets[o] = g.log.x[o];
  g.base = rebuild(g.log, secrets);
  g.T = g.log.t.length;
  const last = g.log.t[g.T - 1];
  const st = g.base.st;
  if (g.spectator || g.joining) g.status = g.joining ? 'join' : 'watch';
  else if ((last && !last.a) || (st.over && !g.base.pending)) g.status = 'over';
  else if (g.base.pending) g.status = g.bot ? 'bot' : 'wait';
  else g.status = g.T % 2 === g.side ? 'my' : g.bot ? 'bot' : 'wait';
  g.result = st.over && !g.base.pending ? (st.over.winner === null ? 'draw' : st.over.winner === g.side ? 'won' : 'lost') : null;
  // Fair play check once both decks are revealed.
  g.verify = null;
  if (g.secret && g.log.x && g.log.x[o] && !g.bot) {
    const xo = g.log.x[o];
    const sealOk = g.log.c[o] && deckCommit(xo.seed, xo.deck) === g.log.c[o] && validDeck(xo.deck);
    const issues = [...g.base.st.warn];
    if (!sealOk) issues.unshift('Their revealed deck doesn’t match the deck they sealed at the start.');
    g.verify = issues;
  }
}

function preview(g) {
  const st = structuredClone(g.base.st);
  startTurn(st, g.T);
  for (const grp of g.acts) for (const a of grp) act(st, a, true);
  return st;
}
const viewState = g => (g.status === 'my' ? preview(g) : g.base.st);

// ---------- names & events ----------
const nameOf = (g, s) => (g.log.n[s] || (s === 0 ? 'Player 1' : 'Player 2'));
function evText(g, e) {
  const me = g.spectator ? -1 : g.side, p = e.p, q = 1 - p;
  return esc(e.s
    .replace(/\{Ps\}/g, p === me ? 'Your' : nameOf(g, p) + '’s')
    .replace(/\{Os\}/g, q === me ? 'your' : nameOf(g, q) + '’s')
    .replace(/\{P\}/g, p === me ? 'You' : nameOf(g, p))
    .replace(/\{O\}/g, q === me ? 'you' : nameOf(g, q)))
    .replace(/^your/, 'Your').replace(/^you\b/, 'You');
}
function recapEvents(g) {
  const st = g.base.st;
  if (g.status === 'my') return st.ev.filter(e => e.t === g.T - 1 || (e.t === g.T - 2 && ['trap', 'fizzle'].includes(e.k)));
  if (g.status === 'over') return st.ev.filter(e => e.t >= g.T - 3);
  return [];
}

// ---------- render ----------
function render() {
  document.body.dataset.view = view;
  const html = {
    home: renderHome, decks: renderDecks, edit: renderEdit, rules: renderRules,
    new: renderNew, join: renderJoin, game: renderGame, sent: renderSent, bot: renderBotSetup,
  }[view]();
  $app.innerHTML = html;
  renderSheet();
}

function topbar(right = '') {
  return `<header class="topbar"><button class="wordmark" data-go="home" aria-label="Dispatch home">Dispatch</button><div class="topbar-r">${right}</div></header>`;
}

function renderHome() {
  const ids = store.get('games', []);
  const recs = ids.map(gameRecord).filter(Boolean).sort((a, b) => b.updated - a.updated);
  const label = r => {
    if (r.status === 'over') return r.result === 'won' ? ['You won', 'done'] : r.result === 'lost' ? ['You lost', 'done'] : ['Finished', 'done'];
    if (r.status === 'my' || r.status === 'bot') return ['Your move', 'live'];
    return ['Waiting', 'idle'];
  };
  const rows = recs.map(r => {
    const [txt, cls] = label(r);
    const them = r.bot ? `the bot · ${r.bot.deckName}` : r.n[1 - r.side] || 'Waiting for opponent';
    const turn = Math.min(5, Math.floor((r.turn || 0) / 2) + 1);
    return `<li><button class="game-row" data-open="${esc(r.id)}">
      <span class="gr-name">vs ${esc(them)}</span>
      <span class="gr-meta">Turn ${turn} of 5</span>
      <span class="chip chip-${cls}">${txt}</span></button></li>`;
  }).join('');
  return `<main class="page home">
    <div class="airmail-rule" aria-hidden="true"></div>
    <div class="mast-wrap">${engraving('dispatch').rosette}<h1 class="mast">Dispatch</h1></div>
    <p class="lede">A five-turn card duel you play by text. Take your turn, send the link, wait for theirs.</p>
    <div class="btn-row"><button class="btn primary" data-go="new">New game</button><button class="btn" data-go="bot">Play the bot</button><button class="btn" data-go="decks">Decks</button><button class="btn" data-go="rules">Cards &amp; rules</button></div>
    <section class="block">
      <h2 class="eyebrow">Your games</h2>
      ${rows ? `<ul class="game-list">${rows}</ul>` : `<p class="muted">No games yet. Start one and text the link to your opponent.</p>`}
    </section>
    <section class="block">
      <h2 class="eyebrow">Open a link</h2>
      <p class="muted small">Tapping a link in Messages opens it here. If that doesn’t work, paste it.</p>
      <div class="paste"><input id="paste-link" type="url" placeholder="Paste a game link" autocomplete="off"><button class="btn" data-act="paste">Open</button></div>
    </section>
  </main>`;
}

function renderDecks() {
  const mine = savedDecks();
  const deckRow = (d, i, mine) => `<li class="deck-row">
      <div><div class="deck-name">${esc(d.name)}</div><div class="deck-cards muted small">${d.cards.map(c => esc(CARDS[c].name)).join(' · ')}</div></div>
      <div class="deck-btns">${mine ? `<button class="btn sm" data-edit="${i}">Edit</button>` : `<button class="btn sm" data-copy="${i}">Copy &amp; edit</button>`}</div>
    </li>`;
  return `${topbar()}<main class="page">
    <h1 class="title">Decks</h1>
    <p class="muted">Ten cards, one copy of each, from the 24-card pool.</p>
    <div class="btn-row"><button class="btn primary" data-act="new-deck">Build a deck</button></div>
    <section class="block"><h2 class="eyebrow">Yours</h2>
      ${mine.length ? `<ul class="deck-list">${mine.map((d, i) => deckRow(d, i, true)).join('')}</ul>` : '<p class="muted">You haven’t built a deck yet. Start from scratch or copy a starter deck.</p>'}
    </section>
    <section class="block"><h2 class="eyebrow">Starter decks</h2>
      <ul class="deck-list">${PRESET_DECKS.map((d, i) => deckRow(d, i, false)).join('')}</ul>
    </section>
  </main>`;
}

function renderEdit() {
  const d = editDeck, n = d.cards.length;
  const groups = [['unit', 'Units'], ['spell', 'Spells'], ['trap', 'Traps']];
  return `${topbar(`<button class="btn sm" data-go="decks">Cancel</button>`)}<main class="page wide">
    <div class="edit-head">
      <input id="deck-name" class="deck-name-input" value="${esc(d.name)}" aria-label="Deck name" maxlength="28">
      <div class="counter ${n === 10 ? 'full' : ''}"><b>${n}</b>/10</div>
      <button class="btn primary" data-act="save-deck" ${n === 10 ? '' : 'disabled'}>Save</button>
    </div>
    <p class="muted small hint">Tap a card to add or remove it. Press and hold to read it.</p>
    ${d.index != null ? `<button class="link danger" data-act="delete-deck">Delete this deck</button>` : ''}
    ${groups.map(([t, label]) => `<section class="block"><h2 class="eyebrow">${label}</h2><div class="card-grid">
      ${POOL.filter(id => CARDS[id].type === t).map(id => cardFace(id, { cls: d.cards.includes(id) ? 'picked' : '', attrs: `data-toggle="${id}" role="button" tabindex="0" aria-pressed="${d.cards.includes(id)}"` })).join('')}
    </div></section>`).join('')}
  </main>`;
}

function renderRules() {
  const groups = [['unit', 'Units'], ['spell', 'Spells'], ['trap', 'Traps']];
  return `${topbar()}<main class="page wide">
    <h1 class="title">Cards &amp; rules</h1>
    <section class="rules">
      <div class="rule"><h3>The goal</h3><p>Both players start at 20 life. Bring your opponent to 0 to win. If nobody is knocked out after five turns each, the higher life total wins.</p></div>
      <div class="rule"><h3>Your hand</h3><p>You start with 3 cards and refill to 3 at the end of each of your turns. Decks are 10 cards, one copy of each.</p></div>
      <div class="rule"><h3>Paying for cards</h3><p>Pitch cards from your hand to pay. Each card shows its pitch value as bars in the top right. Pitched cards go to the bottom of your deck, so they come back. Unspent resources disappear at the end of your turn.</p></div>
      <div class="rule"><h3>Fighting</h3><p>Units can attack the turn after they’re played. The attacker picks the target: the opponent, or one of their units. Units hit each other at the same time, and damage stays.</p></div>
      <div class="rule"><h3>Traps</h3><p>Traps are set face-down. Your opponent sees only what they cost. They fire on their own when your opponent does the thing they watch for.</p></div>
      <div class="rule"><h3>Sending turns</h3><p>The whole game travels inside the link. Your hand, deck and traps are sealed, so the link can’t be peeked at. Play on the same phone and browser for the whole game: that’s where your sealed cards live.</p></div>
    </section>
    <section class="block"><h2 class="eyebrow">Keywords</h2><dl class="keywords">${Object.entries(KEYWORDS).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
    ${groups.map(([t, label]) => `<section class="block"><h2 class="eyebrow">${label}</h2><div class="card-grid">${POOL.filter(id => CARDS[id].type === t).map(id => cardFace(id, { attrs: `data-card="${id}" role="button" tabindex="0"` })).join('')}</div></section>`).join('')}
    <section class="block"><h2 class="eyebrow">Token</h2><div class="card-grid">${cardFace('hex', { attrs: 'data-card="hex" role="button" tabindex="0"' })}</div></section>
  </main>`;
}

function deckPicker() {
  const decks = allDecks();
  const sel = store.get('lastDeck', decks[0] && decks[0].name);
  return `<fieldset class="deck-pick"><legend class="eyebrow">Deck</legend>
    ${decks.map((d, i) => `<label class="deck-opt"><input type="radio" name="deck" value="${i}" ${d.name === sel ? 'checked' : ''}>
      <span><b>${esc(d.name)}</b>${d.mine ? '' : ' <small class="muted">starter</small>'}<br><small class="muted">${d.cards.map(c => esc(CARDS[c].name)).join(' · ')}</small></span></label>`).join('')}
  </fieldset>`;
}
function chosenDeck() {
  const el = document.querySelector('input[name=deck]:checked');
  const d = el ? allDecks()[+el.value] : allDecks()[0];
  store.set('lastDeck', d.name);
  return d.cards.slice();
}

function renderNew() {
  return `${topbar()}<main class="page">
    <h1 class="title">New game</h1>
    <label class="field"><span class="eyebrow">Your name</span><input id="my-name" maxlength="16" value="${esc(store.get('name', ''))}" placeholder="Name" autocomplete="nickname"></label>
    ${deckPicker()}
    <p class="muted small">You go first. Your opponent gets the last turn of the game.</p>
    <button class="btn primary block-btn" data-act="start">Start and take turn 1</button>
  </main>`;
}

function renderBotSetup() {
  return `${topbar()}<main class="page">
    <h1 class="title">Play the bot</h1>
    <p class="muted">A practice game on this phone. The bot plays one of the starter decks and can’t see your hand or your traps.</p>
    ${deckPicker()}
    <fieldset class="deck-pick"><legend class="eyebrow">Bot’s deck</legend>
      <div class="seg">${['Random', ...PRESET_DECKS.map(d => d.name)].map((n, i) =>
        `<label><input type="radio" name="botdeck" value="${i - 1}" ${i === 0 ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="deck-pick"><legend class="eyebrow">Who goes first</legend>
      <div class="seg"><label><input type="radio" name="first" value="0" checked><span>You</span></label><label><input type="radio" name="first" value="1"><span>The bot</span></label></div>
    </fieldset>
    <button class="btn primary block-btn" data-act="start-bot">Start</button>
  </main>`;
}

function renderJoin() {
  const g = G;
  return `${topbar()}<main class="page">
    <p class="eyebrow">Challenge</p>
    <h1 class="title">${esc(nameOf(g, 0))} wants a duel</h1>
    <p class="muted">They’ve already taken turn 1. Pick your name and a deck to answer.</p>
    <label class="field"><span class="eyebrow">Your name</span><input id="my-name" maxlength="16" value="${esc(store.get('name', ''))}" placeholder="Name" autocomplete="nickname"></label>
    ${deckPicker()}
    <button class="btn primary block-btn" data-act="join">Accept</button>
  </main>`;
}

// ---------- the table ----------
function track(g) {
  const cells = [];
  const cur = g.status === 'over' ? -1 : g.T;
  for (let i = 0; i < TURNS; i++) {
    const mine = i % 2 === g.side;
    const cls = i < g.T ? 'done' : i === cur ? 'now' : '';
    cells.push(`<i class="${cls} ${mine ? 'me' : 'them'}" title="${mine ? 'You' : esc(nameOf(g, i % 2))} · turn ${Math.floor(i / 2) + 1}"></i>`);
  }
  return `<div class="track" aria-label="Turn ${Math.min(5, Math.floor(g.T / 2) + 1)} of 5">${cells.join('')}</div>`;
}

function unitTile(g, st, u, side, ctx) {
  const me = g.side, mine = side === me;
  const idx = st.P[side].board.indexOf(u);
  const taunt = hasTaunt(st, side, idx);
  const known = !u.fd || (mine && u.sid);
  const name = u.fd ? (mine && u.sid ? CARDS[u.sid].name : 'Face-down') : CARDS[u.id].name;
  const hp = u.hp - u.dmg;
  const cls = ['ut'];
  if (u.fd) cls.push('ut-fd');
  if (taunt) cls.push('ut-taunt');
  if (u.burrowed) cls.push('ut-burrow');
  if (ctx.targets && ctx.targets.includes(u.uid)) cls.push('is-target');
  if (ctx.ready && ctx.ready.includes(u.uid)) cls.push('is-ready');
  if (ctx.sel === u.uid) cls.push('is-sel');
  const tags = [];
  if (taunt) tags.push('Taunt');
  if (u.burrowed) tags.push('Burrowed');
  if (u.fd && mine && u.sid) tags.push('Hidden');
  if (u.owner !== side) tags.push('Stolen');
  if (u.sick && !u.rush && mine && g.status === 'my' && st.turn === g.T) tags.push('New');
  return `<button class="${cls.join(' ')}" data-unit="${u.uid}" aria-label="${esc(name)}, ${u.atk} attack, ${hp} health">
    <span class="ut-name">${esc(name)}</span>
    ${tags.length ? `<span class="ut-tags">${tags.join(' · ')}</span>` : ''}
    ${known ? engraving(u.fd ? u.sid : u.id).rosette : ''}
    <span class="ut-stats"><b>${u.atk}</b><b class="${u.dmg ? 'hurt' : ''}">${hp}</b></span>
    ${u.fd && !known ? '<span class="ut-q" aria-hidden="true">?</span>' : ''}
  </button>`;
}

function boardRow(g, st, side, ctx) {
  const units = st.P[side].board;
  const slots = ctx.slots && side === g.side;
  const parts = [];
  units.forEach((u, i) => {
    if (slots) parts.push(`<button class="slot" data-slot="${i}" aria-label="Place here">+</button>`);
    parts.push(unitTile(g, st, u, side, ctx));
  });
  if (slots) parts.push(`<button class="slot" data-slot="${units.length}" aria-label="Place here">+</button>`);
  const empty = !units.length && !slots ? `<span class="row-empty">${side === g.side ? 'Your units go here' : 'No units'}</span>` : '';
  return `<div class="row ${side === g.side ? 'row-me' : 'row-them'}">${parts.join('')}${empty}</div>`;
}

function seals(st, side, mine) {
  const ts = st.P[side].traps;
  if (!ts.length) return '';
  return `<div class="seals">${ts.map(t => `<button class="seal" data-trap="${t.uid}" aria-label="${mine && t.id ? esc(CARDS[t.id].name) : `Face-down trap, cost ${t.k}`}">
    <span class="seal-wax">${t.k}</span>${mine && t.id ? `<span class="seal-name">${esc(CARDS[t.id].name)}${t.id === 'calledshot' ? ` · ${t.x}` : t.id === 'omen' ? (t.x ? ' · they attack' : ' · they hold') : ''}</span>` : ''}</button>`).join('')}</div>`;
}

function seat(g, st, side, ctx) {
  const P = st.P[side], mine = side === g.side;
  const target = ctx.targets && ctx.targets.includes('f') && !mine;
  const hand = mine ? '' : `<div class="opp-hand" aria-label="${P.hand.length} cards in hand">${P.hand.map(h => h === '?' ? '<i></i>' : `<i class="known" title="${esc(CARDS[h].name)}">${esc(CARDS[h].name.split(' ')[0])}</i>`).join('')}</div>`;
  return `<section class="seat ${mine ? 'seat-me' : 'seat-them'}">
    <button class="life ${target ? 'is-target' : ''}" data-face="${side}" ${target ? '' : 'tabindex="-1"'} aria-label="${esc(nameOf(g, side))}, ${P.life} life">
      <span class="life-n">${P.life}</span><span class="life-who">${mine && !g.spectator ? 'You' : esc(nameOf(g, side))}</span>
    </button>
    <div class="seat-info">
      <div class="seat-stats"><span>Deck <b>${P.deck.length}</b></span><span>Hand <b>${P.hand.length}</b></span>${Object.keys(P.temper).length ? `<span title="Cards pitched so far">Pitched <b>${Object.values(P.temper).reduce((a, b) => a + b, 0)}</b></span>` : ''}</div>
      ${hand}
    </div>
    ${seals(st, side, mine && !g.spectator)}
  </section>`;
}

function statusBanner(g, st) {
  const them = esc(nameOf(g, 1 - g.side));
  if (g.status === 'watch') return `<div class="banner">This game is between ${esc(nameOf(g, 0))} and ${esc(nameOf(g, 1))}. Only the phones that started it can play it.</div>`;
  if (g.status === 'bot') return `<div class="banner bot-think"><div><b>The bot is taking its turn…</b></div></div>`;
  if (g.status === 'over' && g.bot) {
    const o = st.over, me = g.side;
    const head = o.winner === null ? 'Draw' : o.winner === me ? 'You beat the bot' : 'The bot wins';
    const how = o.ko ? 'Knockout.' : `After five turns: ${st.P[me].life} to ${st.P[1 - me].life}.`;
    return `<div class="banner banner-over"><div><div class="result">${head}</div><p>${how} The bot was playing ${esc(g.bot.deckName)}.</p></div>
      <div class="btn-row"><button class="btn primary" data-act="rematch">Play again</button><button class="btn" data-go="home">Home</button></div></div>`;
  }
  if (g.status === 'wait') return `<div class="banner"><div><b>Waiting for ${them}.</b> ${g.base.pending ? 'Their hidden traps might still change how your turn played out.' : ''}</div><button class="btn sm" data-act="resend">Send link again</button></div>`;
  if (g.status === 'over') {
    const o = st.over, me = g.side;
    const head = o.winner === null ? 'Draw' : o.winner === me ? 'You win' : `${them} wins`;
    const how = o.ko ? 'Knockout.' : `After five turns: ${st.P[me].life} to ${st.P[1 - me].life}.`;
    const needSend = !(g.log.x && g.log.x[me]);
    let fair = '';
    if (g.verify) fair = g.verify.length
      ? `<p class="fair bad">Fair-play check found problems:<br>${g.verify.map(esc).join('<br>')}</p>`
      : `<p class="fair ok">Fair-play check passed. Both decks match their seals and every hidden card checks out.</p>`;
    else fair = `<p class="fair muted">The fair-play check runs once ${them} reveals their deck.</p>`;
    return `<div class="banner banner-over"><div><div class="result">${head}</div><p>${how}</p>${fair}</div>
      ${needSend ? `<button class="btn primary" data-act="final">Send the result</button>` : `<button class="btn sm" data-act="resend">Send link again</button>`}</div>`;
  }
  return '';
}

function renderGame() {
  const g = G;
  let st;
  try { st = viewState(g); } catch (e) { g.acts = []; st = viewState(g); }
  const me = g.side, my = g.status === 'my';
  const ctx = {};
  if (my && g.mode === 'target') ctx.targets = g.pend.targets;
  if (my && g.mode === 'attack') { ctx.targets = g.pend.targets; ctx.sel = g.pend.u; }
  if (my && g.mode === 'slot') ctx.slots = true;
  if (my && !g.mode) ctx.ready = st.P[me].board.filter(u => !attackBlock(st, u.uid)).map(u => u.uid);

  const notices = [];
  if (g.notice && g.notice.kind === 'old') notices.push(`<div class="banner warn"><div>This is an older link for this game. Your phone has a newer turn.</div><button class="btn sm" data-act="latest">Open latest</button></div>`);
  if (g.notice && g.notice.kind === 'diff') notices.push(`<div class="banner warn">The history in this link is different from the copy on your phone. If you didn’t expect that, ask where it came from.</div>`);
  if (g.versionWarn) notices.push(`<div class="banner warn">This game started on an older version of the cards. It may not replay correctly.</div>`);
  if (!g.spectator && g.secret && g.base.st.warn.length && !g.verify) notices.push(`<div class="banner warn">Something in this game didn’t add up: ${esc(g.base.st.warn[0])}</div>`);

  const recap = recapEvents(g);
  const recapHtml = recap.length ? `<details class="recap" ${g.recap ? 'open' : ''}>
      <summary>${g.status === 'over' ? 'Final turns' : `Since your last turn`}<span>${recap.length}</span></summary>
      <ol>${recap.map(e => `<li class="ev ev-${e.k}">${evText(g, e)}</li>`).join('')}</ol></details>` : '';

  const terrain = st.terrain ? `<button class="terrain" data-card="${st.terrain.id}">${esc(CARDS[st.terrain.id].name)} <small>${esc(cardText(st.terrain.id).replace('Terrain. ', ''))}</small></button>` : '';
  const turnLabel = g.status === 'my' ? `Your turn ${Math.floor(g.T / 2) + 1}` : g.status === 'over' ? 'Game over' : `Turn ${Math.min(5, Math.floor(g.T / 2) + 1)}`;

  return `${topbar(`<span class="turn-label">${turnLabel}</span>${track(g)}<button class="btn sm ghost" data-act="log" aria-label="Game log">Log</button>`)}
  <main class="table">
    ${notices.join('')}
    ${statusBanner(g, st)}
    ${recapHtml}
    ${seat(g, st, 1 - me, ctx)}
    ${boardRow(g, st, 1 - me, ctx)}
    <div class="midline"><span class="postmark" aria-hidden="true"></span>${terrain}${my && taxOf(st, me) ? `<span class="taxed">Red Tape: your next card costs ${taxOf(st, me)} more</span>` : ''}${my ? `<span class="pool" aria-label="Resources">${st.pool}<small>resources</small></span>` : ''}</div>
    ${boardRow(g, st, me, ctx)}
    ${seat(g, st, me, ctx)}
    ${g.spectator ? '' : handHtml(g, st)}
    ${my ? controls(g, st) : ''}
  </main>`;
}

function handHtml(g, st) {
  const P = st.P[g.side];
  const pay = g.mode === 'pay';
  const pend = g.pend;
  return `<section class="hand ${pay ? 'paying' : ''}" aria-label="Your hand">${P.hand.map((c, i) => {
    if (c === '?') return cardFace('?');
    const cls = [];
    let tags = '';
    if (pay) {
      if (i === pend.hi) cls.push('playing');
      else if (CARDS[c].pitch === 0) cls.push('dim');
      if (pend.pitched.includes(i)) cls.push('pitched');
    }
    if (CARDS[c].temper && P.temper[c]) tags = `<span class="tag">Tempered ×${P.temper[c]}</span>`;
    if (c === 'wraith' && P.echo.wraith) tags = `<span class="tag">Returned ×${P.echo.wraith}</span>`;
    const cost = CARDS[c].type === 'unit' || CARDS[c].type === 'spell' ? costOf(st, g.side, c) : undefined;
    const [atk, hp] = CARDS[c].type === 'unit' ? unitStats(st, g.side, c) : [undefined, undefined];
    return cardFace(c, { cls: cls.join(' '), cost: cost ?? undefined, atk, hp, tags, attrs: `data-hand="${i}" role="button" tabindex="0"` });
  }).join('')}${P.found.length ? `<div class="found muted small">Arriving at end of turn: ${P.found.map(c => esc(CARDS[c].name)).join(', ')}</div>` : ''}</section>`;
}

function controls(g, st) {
  if (g.mode === 'pay') {
    const p = g.pend, P = st.P[g.side];
    const have = p.pitched.reduce((s, i) => s + CARDS[P.hand[i]].pitch, st.pool);
    const need = payNeed(st, g.side, p);
    const blood = p.kind === 'play' && CARDS[p.c].blood && p.l < p.k;
    return `<div class="controls paybar">
      <div class="pay-msg">Pay <b>${need}</b> · you have <b>${have}</b>. Tap cards to pitch them.</div>
      <div class="btn-row">${blood ? `<button class="btn" data-act="blood">Pay 2 life instead of 1</button>` : ''}<button class="btn ghost" data-act="cancel">Cancel</button></div>
    </div>`;
  }
  if (g.mode) {
    const msg = { target: 'Choose a target.', attack: 'Choose what to attack.', slot: 'Choose where the unit goes.' }[g.mode];
    return `<div class="controls"><div class="pay-msg">${msg}</div><button class="btn ghost" data-act="cancel">Cancel</button></div>`;
  }
  return `<div class="controls">
    <button class="btn ghost" data-act="undo" ${g.acts.length ? '' : 'disabled'}>Undo</button>
    <button class="btn primary" data-act="end">End turn</button>
  </div>`;
}

// ---------- the send screen ----------
function renderSent() {
  const g = G;
  const url = gameUrl(sentCode);
  const them = nameOf(g, 1 - g.side);
  const text = shareText(g) + ' ' + url;
  const final = g.status === 'over';
  return `${topbar()}<main class="page sent">
    <div class="stamp" aria-hidden="true"><span>Sealed</span></div>
    <h1 class="title">${final ? 'Result ready to send' : `Turn ${Math.floor((g.T - 1) / 2) + 1} is sealed`}</h1>
    <p class="muted">Send this link to ${esc(g.log.n[1 - g.side] ? them : 'your opponent')}. They tap it to ${final ? 'see the result' : 'take their turn'}. No app or account needed.</p>
    <div class="btn-col">
      ${navigator.share ? `<button class="btn primary" data-act="share">Share…</button>` : ''}
      <a class="btn ${navigator.share ? '' : 'primary'}" href="sms:?&body=${encodeURIComponent(text)}">Text message</a>
      <button class="btn" data-act="copy">Copy link</button>
    </div>
    <label class="field"><span class="eyebrow">The link</span><textarea id="link-box" readonly rows="3">${esc(url)}</textarea></label>
    <button class="btn ghost block-btn" data-act="back">Back to the table</button>
  </main>`;
}
function shareText(g) {
  if (g.status === 'over') return 'Dispatch: the duel is over. See how it ended:';
  return `Dispatch: your move (turn ${Math.min(5, Math.floor(g.T / 2) + 1)} of 5).`;
}

// ---------- sheets ----------
function openSheet(s) { sheet = s; renderSheet(); }
function closeSheet() { sheet = null; renderSheet(); }
function renderSheet() {
  if (!sheet) { $sheet.hidden = true; $sheet.innerHTML = ''; return; }
  $sheet.hidden = false;
  $sheet.innerHTML = `<div class="sheet-scrim" data-act="close-sheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(sheet.title || 'Details')}">
      ${sheet.title ? `<h2 class="sheet-title">${esc(sheet.title)}</h2>` : ''}
      ${sheet.html || ''}
      <div class="btn-col">${(sheet.buttons || []).map((b, i) => `<button class="btn ${b.kind || ''}" data-sb="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}${b.note ? `<small>${b.note}</small>` : ''}</button>`).join('')}
      <button class="btn ghost" data-act="close-sheet">Close</button></div>
    </div>`;
  const btn = $sheet.querySelector('.sheet-panel .btn');
  if (btn) btn.focus({ preventScroll: true });
}

function cardSheet(id, extra = {}) {
  const C = CARDS[id];
  const kw = Object.keys(KEYWORDS).filter(k => C.text.includes(k));
  const facts = [];
  if (C.pitch === 0) facts.push('Pitch 0: this card can’t be pitched, so you have to play it.');
  else facts.push(`Pitch ${C.pitch}: gives ${C.pitch} resource${C.pitch > 1 ? 's' : ''} when you pitch it to pay for another card.`);
  if (C.type === 'trap') facts.push(`Set face-down for ${C.cost}. Your opponent sees only the cost.`);
  const related = id === 'witch' ? `<p class="muted small">The Hex it creates:</p><div class="sheet-card small-card">${cardFace('hex')}</div>` : '';
  return {
    title: '',
    html: `<div class="sheet-card">${cardFace(id, extra)}</div>
      ${kw.length ? `<dl class="keywords small">${kw.map(k => `<div><dt>${k}</dt><dd>${esc(KEYWORDS[k])}</dd></div>`).join('')}</dl>` : ''}
      <ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>${related}`,
    buttons: extra.buttons || [],
  };
}

// Press and hold a card in the deck builder to read it.
let holdTimer = null, holdStart = null, suppressClick = false;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-toggle]');
  suppressClick = false;
  if (!el || e.button > 0) return;
  holdStart = { x: e.clientX, y: e.clientY };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    suppressClick = true;
    el.classList.add('held');
    setTimeout(() => el.classList.remove('held'), 200);
    if (navigator.vibrate) navigator.vibrate(10);
    deckCardSheet(el.dataset.toggle);
  }, 420);
});
const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
document.addEventListener('pointermove', e => {
  if (holdTimer && holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 10) cancelHold();
});
document.addEventListener('pointerup', cancelHold);
document.addEventListener('pointercancel', cancelHold);
document.addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-toggle]');
  if (!el) return;
  e.preventDefault();
  if (!sheet) { cancelHold(); suppressClick = true; deckCardSheet(el.dataset.toggle); }
});
function deckCardSheet(id) {
  const inDeck = editDeck.cards.includes(id);
  const full = !inDeck && editDeck.cards.length >= 10;
  openSheet(cardSheet(id, { buttons: [{
    label: inDeck ? 'Remove from deck' : 'Add to deck', kind: inDeck ? '' : 'primary', disabled: full,
    note: full ? 'Your deck already has 10 cards' : '',
    fn: () => { toggleDeckCard(id); closeSheet(); },
  }] }));
}
function toggleDeckCard(id) {
  const i = editDeck.cards.indexOf(id);
  if (i >= 0) editDeck.cards.splice(i, 1);
  else if (editDeck.cards.length < 10) editDeck.cards.push(id);
  else { toast('A deck holds 10 cards. Remove one first.'); return; }
  const y = window.scrollY; render(); window.scrollTo(0, y);
}

// ---------- my turn: building actions ----------
// What a pending play still costs: Red Tape adds to plays (not flips); Bloodcost life comes off.
const payNeed = (st, side, p) => p.k + (p.kind === 'flip' ? 0 : taxOf(st, side)) - p.l;
function canPay(st, side, k, exceptIdx, blood) {
  if (blood) return true;
  const P = st.P[side];
  const max = st.pool + P.hand.reduce((s, c, i) => s + (i === exceptIdx || c === '?' ? 0 : CARDS[c].pitch), 0);
  return max >= k;
}

function tapHand(i) {
  const g = G, st = viewState(g), P = st.P[g.side], c = P.hand[i];
  if (!c || c === '?') return;
  if (g.mode === 'pay') {
    const p = g.pend;
    if (i === p.hi) return;
    if (CARDS[c].pitch === 0) { toast(`${CARDS[c].name} can’t be pitched.`); return; }
    const at = p.pitched.indexOf(i);
    if (at >= 0) p.pitched.splice(at, 1); else p.pitched.push(i);
    advance();
    return;
  }
  if (g.status !== 'my' || g.mode) { openSheet(cardSheet(c)); return; }
  const C = CARDS[c], buttons = [];
  const full = P.board.length >= MAX_UNITS;
  if (C.type === 'trap') {
    const ok = canPay(st, g.side, C.cost + taxOf(st, g.side), i) && P.traps.length < MAX_TRAPS;
    buttons.push({ label: `Set face-down · ${C.cost}`, kind: 'primary', disabled: !ok, note: P.traps.length >= MAX_TRAPS ? 'You already have 3 traps' : ok ? '' : 'Not enough to pitch', fn: () => startPend('trap', c, i) });
  } else {
    const k = costOf(st, g.side, c);
    const ok = canPay(st, g.side, k + taxOf(st, g.side), i, C.blood) && !(C.type === 'unit' && full);
    buttons.push({ label: `Play · ${k}`, kind: 'primary', disabled: !ok, note: C.type === 'unit' && full ? 'Your side is full' : ok ? '' : 'Not enough to pitch', fn: () => startPend('play', c, i) });
    if (C.disguise) {
      const ok2 = canPay(st, g.side, 1 + taxOf(st, g.side), i) && !full;
      buttons.push({ label: 'Play face-down · 1', disabled: !ok2, note: 'Shows as a blank 2/2', fn: () => startPend('fd', c, i) });
    }
  }
  const [atk, hp] = C.type === 'unit' ? unitStats(st, g.side, c) : [undefined, undefined];
  openSheet(cardSheet(c, { buttons, atk, hp, cost: C.type !== 'trap' ? costOf(st, g.side, c) : undefined }));
}

function startPend(kind, c, hi) {
  const g = G, st = viewState(g);
  const C = CARDS[c];
  const k = kind === 'fd' ? 1 : kind === 'trap' ? C.cost : costOf(st, g.side, c);
  g.pend = { kind, c, k, l: 0, hi, pitched: [] };
  closeSheet();
  advance();
}

function advance() {
  const g = G, p = g.pend, st = viewState(g), P = st.P[g.side];
  if (!p) return;
  const C = CARDS[p.c];
  if (p.kind === 'trap' && p.c === 'calledshot' && p.x === undefined) {
    openSheet({ title: 'Name a cost', html: '<p class="muted">The first card your opponent plays with this cost gets cancelled.</p>',
      buttons: [0, 1, 2, 3, 4].map(n => ({ label: String(n), fn: () => { p.x = n; closeSheet(); advance(); } })) });
    return;
  }
  if (p.kind === 'trap' && p.c === 'omen' && p.x === undefined) {
    openSheet({ title: 'Make your prediction', html: `<p class="muted">On ${esc(nameOf(g, 1 - g.side))}’s next turn, will they attack you directly? If you’re right, you gain ${CARDS.omen.life} life.</p>`,
      buttons: [{ label: 'They will attack me', fn: () => { p.x = 1; closeSheet(); advance(); } },
                { label: 'They won’t attack me', fn: () => { p.x = 0; closeSheet(); advance(); } }] });
    return;
  }
  if (p.kind === 'play' && C.target && p.tg === undefined) {
    const ts = spellTargets(st, p.c);
    if (!ts.length) { toast('There’s nothing to target.'); return cancel(); }
    g.mode = 'target'; p.targets = ts; render(); return;
  }
  if (p.kind === 'flip' && p.tg === undefined) {
    const ts = flipTargets(st, p.c);
    if (ts.length) { g.mode = 'target'; p.targets = ts; render(); return; }
    p.tg = null;
  }
  if ((p.kind === 'fd' || (p.kind === 'play' && C.type === 'unit')) && p.slot === undefined) {
    if (P.board.length === 0) p.slot = 0;
    else { g.mode = 'slot'; render(); return; }
  }
  if (p.kind === 'play' && p.c === 'map' && p.pick === undefined) {
    const opts = mapOptions(g.secret, g.T, st.v);
    openSheet({ title: 'Choose a card', html: `<p class="muted">It joins your hand at the end of this turn.</p><div class="pick-grid">${opts.map(id => cardFace(id)).join('')}</div>`,
      buttons: opts.map(id => ({ label: CARDS[id].name, fn: () => { p.pick = id; closeSheet(); advance(); } })) });
    return;
  }
  const have = p.pitched.reduce((s, i) => s + CARDS[P.hand[i]].pitch, st.pool);
  if (have < payNeed(st, g.side, p)) { g.mode = 'pay'; render(); return; }
  commit();
}

function commit() {
  const g = G, p = g.pend;
  const st = viewState(g), P = st.P[g.side];
  const grp = p.pitched.map(i => ['p', P.hand[i]]);
  const tmp = structuredClone(st);
  try {
    for (const a of grp) act(tmp, a, true);
    const uid = nextUid(tmp);
    let main;
    if (p.kind === 'play') main = ['c', p.c, p.k, p.l, p.tg ?? null, p.slot ?? null, p.pick ?? null];
    if (p.kind === 'trap') main = ['t', commitFor(p.c, p.x ?? null, saltFor(g.secret.seed, uid)), p.k];
    if (p.kind === 'fd') main = ['d', commitFor(p.c, null, saltFor(g.secret.seed, uid)), p.slot];
    if (p.kind === 'flip') main = ['f', p.u, p.c, saltFor(g.secret.seed, p.u), p.tg ?? null];
    act(tmp, main, true);
    grp.push(main);
    g.acts.push(grp);
  } catch (e) {
    if (!(e instanceof Fizzle)) throw e;
    toast(e.message);
  }
  g.pend = null; g.mode = null;
  render();
}
function cancel() { G.pend = null; G.mode = null; render(); }

function tapUnit(uid) {
  const g = G, st = viewState(g), f = findUnit(st, uid);
  if (!f) return;
  const u = f.u, mine = f.side === g.side;
  if (g.status === 'my' && (g.mode === 'target' || g.mode === 'attack')) {
    if (!g.pend.targets.includes(uid)) { toast('That isn’t a valid target.'); return; }
    if (g.mode === 'attack') return addAttack(g.pend.u, uid);
    g.pend.tg = uid; g.mode = null; advance(); return;
  }
  const info = () => {
    if (u.fd && !(mine && u.sid)) return openSheet({ title: 'Face-down unit', html: `<p class="muted">A 2/2 with no abilities until it’s flipped. Any card with Disguise could be hiding here.</p>` });
    const id = u.fd ? u.sid : u.id;
    openSheet(cardSheet(id, { atk: u.atk, hp: u.hp - u.dmg }));
  };
  if (g.status !== 'my' || g.mode || !mine) return info();
  const why = attackBlock(st, uid);
  const canFlip = u.fd && u.sid && !u.sick;
  const buttons = [];
  if (!why) buttons.push({ label: 'Attack', kind: 'primary', fn: () => { closeSheet(); startAttack(uid); } });
  if (canFlip) {
    const cost = CARDS[u.sid].disguise;
    buttons.push({ label: `Flip · ${cost}`, disabled: !canPay(st, g.side, cost, -1), fn: () => { closeSheet(); g.pend = { kind: 'flip', c: u.sid, u: uid, k: cost, l: 0, hi: -1, pitched: [] }; advance(); } });
  }
  if (buttons.length === 1 && !why && !canFlip) return startAttack(uid);
  const id = u.fd ? u.sid : u.id;
  const s = cardSheet(id, { atk: u.atk, hp: u.hp - u.dmg, buttons });
  if (why && !canFlip) s.html += `<p class="muted small">${esc(why)}</p>`;
  openSheet(s);
}
function startAttack(uid) {
  const g = G, st = viewState(g);
  g.pend = { kind: 'attack', u: uid, targets: attackTargets(st) };
  g.mode = 'attack';
  render();
}
function addAttack(uid, tg) {
  const g = G;
  const tmp = viewState(g);
  try { act(tmp, ['a', uid, tg], true); g.acts.push([['a', uid, tg]]); }
  catch (e) { if (!(e instanceof Fizzle)) throw e; toast(e.message); }
  g.pend = null; g.mode = null;
  render();
}
function tapFace(side) {
  const g = G;
  if (g.status !== 'my' || !g.pend || !g.pend.targets || !g.pend.targets.includes('f') || side === g.side) return;
  if (g.mode === 'attack') return addAttack(g.pend.u, 'f');
  g.pend.tg = 'f'; g.mode = null; advance();
}

function endTurnSheet() {
  const g = G, st = viewState(g);
  const notes = [];
  if (st.pool > 0) notes.push(`You have ${st.pool} unspent resource${st.pool > 1 ? 's' : ''}. They’ll be lost.`);
  const idle = st.P[g.side].board.filter(u => !attackBlock(st, u.uid));
  if (idle.length) notes.push(`${idle.length} of your units can still attack.`);
  const intro = g.bot ? 'The bot takes its turn right after. You can’t change yours after this.'
    : `Your turn gets sealed into a link for ${esc(nameOf(g, 1 - g.side))}. You can’t change it after this.`;
  openSheet({
    title: 'End your turn?',
    html: `<p class="muted">${intro}</p>${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}`,
    buttons: [{ label: g.bot ? 'End turn' : 'Seal and send', kind: 'primary', fn: sendTurn }],
  });
}

async function sendTurn() {
  const g = G;
  const acts = g.acts.flat();
  acts.push(['e']);
  const log = structuredClone(g.log);
  const owed = g.base.owed || [];
  log.t.push(owed.length ? { a: acts, r: owed } : { a: acts });
  if (g.bot) { await saveLocal(log); runBot(); return; }
  await finishSend(log);
}

// ---------- bot games ----------
async function saveLocal(log) {
  const g = G;
  if (g.bot) {
    // Once the game is over, reveal both decks so the final board shows everything.
    const tmp = { ...g, log };
    compute(tmp);
    if (tmp.status === 'over') { log.x = [null, null]; log.x[g.side] = g.secret; log.x[1 - g.side] = g.bot.secret; }
  }
  g.log = log; g.code = await encodeLog(log); g.acts = []; g.pend = null; g.mode = null; sheet = null;
  compute(g);
  saveRecord(g);
  history.replaceState(null, '', '#' + g.code);
  render();
}
let botBusy = false;
function runBot() {
  const g = G;
  if (botBusy || !g || !g.bot) return;
  botBusy = true;
  setTimeout(async () => {
    try {
      const next = botRespond(g.log, 1 - g.side, g.bot.secret);
      if (next && G === g) { g.recap = true; await saveLocal(next); }
    } finally { botBusy = false; }
    if (G === g && g.status === 'bot') runBot();
  }, 650);
}
async function sendFinal() {
  const g = G, me = g.side;
  const log = structuredClone(g.log);
  const last = log.t[log.t.length - 1];
  if (last && last.a && (log.t.length - 1) % 2 !== me) log.t.push({ r: g.base.owed || [] });
  log.x = log.x || [null, null];
  log.x[me] = g.secret;
  await finishSend(log);
}
async function finishSend(log) {
  const g = G;
  const code = await encodeLog(log);
  g.log = log; g.code = code; g.acts = []; g.pend = null; g.mode = null; g.notice = null;
  compute(g);
  saveRecord(g);
  sentCode = code;
  history.replaceState(null, '', '#' + code);
  sheet = null;
  view = 'sent';
  render();
  window.scrollTo(0, 0);
}

function logSheet() {
  const g = G, st = viewState(g);
  const byTurn = {};
  for (const e of st.ev) (byTurn[e.t] = byTurn[e.t] || []).push(e);
  const html = Object.keys(byTurn).map(t => {
    const who = +t % 2 === g.side ? 'You' : esc(nameOf(g, +t % 2));
    return `<section class="log-turn"><h3>${who} · turn ${Math.floor(t / 2) + 1}</h3><ol>${byTurn[t].map(e => `<li class="ev ev-${e.k}">${evText(g, e)}</li>`).join('')}</ol></section>`;
  }).join('') || '<p class="muted">Nothing has happened yet.</p>';
  openSheet({ title: 'Game log', html: `<div class="log">${html}</div>` });
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-act],[data-open],[data-edit],[data-copy],[data-toggle],[data-hand],[data-unit],[data-face],[data-slot],[data-trap],[data-card],[data-sb]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) return go(d.go);
  if (d.sb !== undefined) { const b = sheet && sheet.buttons[+d.sb]; if (b && b.fn) b.fn(); return; }
  if (d.open) { const r = gameRecord(d.open); if (r && r.code) { location.hash = r.code; } return; }
  if (d.edit !== undefined) { const dk = savedDecks()[+d.edit]; editDeck = { name: dk.name, cards: dk.cards.slice(), index: +d.edit }; return go('edit'); }
  if (d.copy !== undefined) { const dk = PRESET_DECKS[+d.copy]; editDeck = { name: dk.name + ' (mine)', cards: dk.cards.slice(), index: null }; return go('edit'); }
  if (d.toggle) {
    if (suppressClick) { suppressClick = false; return; }
    return toggleDeckCard(d.toggle);
  }
  if (d.hand !== undefined) return tapHand(+d.hand);
  if (d.unit !== undefined) return tapUnit(+d.unit);
  if (d.face !== undefined) return tapFace(+d.face);
  if (d.slot !== undefined) { G.pend.slot = +d.slot; G.mode = null; return advance(); }
  if (d.trap !== undefined) {
    const st = viewState(G);
    for (const s of [0, 1]) {
      const tr = st.P[s].traps.find(x => x.uid === +d.trap);
      if (tr && s === G.side && tr.id) return openSheet(cardSheet(tr.id));
      if (tr) return openSheet({ title: 'Face-down trap', html: `<p class="muted">It cost ${tr.k} to set. It fires on its own during your turn if you do what it’s waiting for.</p>` });
    }
    return;
  }
  if (d.card) return openSheet(cardSheet(d.card));

  switch (d.act) {
    case 'close-sheet': closeSheet(); break;
    case 'paste': {
      const v = document.getElementById('paste-link').value.trim();
      if (!v) return toast('Paste a game link first.');
      const code = v.replace(/^.*#/, '');
      if (code.length < 8) return toast('That doesn’t look like a Dispatch link.');
      location.hash = code;
      break;
    }
    case 'new-deck': editDeck = { name: 'New deck', cards: [], index: null }; go('edit'); break;
    case 'save-deck': {
      const decks = savedDecks();
      const name = (document.getElementById('deck-name').value || 'Untitled deck').trim().slice(0, 28);
      const dk = { name, cards: editDeck.cards.slice() };
      if (editDeck.index != null) decks[editDeck.index] = dk; else decks.unshift(dk);
      store.set('decks', decks); store.set('lastDeck', name);
      toast('Deck saved.'); go('decks'); break;
    }
    case 'delete-deck':
      openSheet({ title: 'Delete this deck?', buttons: [{ label: 'Delete', kind: 'danger', fn: () => {
        const decks = savedDecks(); decks.splice(editDeck.index, 1); store.set('decks', decks); go('decks');
      } }] });
      break;
    case 'start-bot': {
      const mine = { seed: randomSeed(), deck: chosenDeck() };
      const pickVal = +document.querySelector('input[name=botdeck]:checked').value;
      const preset = pickVal >= 0 ? PRESET_DECKS[pickVal] : PRESET_DECKS[Math.floor(Math.random() * PRESET_DECKS.length)];
      const bot = { secret: { seed: randomSeed(), deck: preset.cards.slice() }, deckName: preset.name };
      const side = +document.querySelector('input[name=first]:checked').value;
      const name = store.get('name', '') || 'You';
      const n = side === 0 ? [name, 'Bot'] : ['Bot', name];
      const c = side === 0 ? [deckCommit(mine.seed, mine.deck), deckCommit(bot.secret.seed, bot.secret.deck)]
                           : [deckCommit(bot.secret.seed, bot.secret.deck), deckCommit(mine.seed, mine.deck)];
      const log = { v: RULES_VERSION, id: 'bot' + randomSeed().slice(0, 8), n, c, t: [], x: [null, null] };
      G = makeGame(log, side, mine, await encodeLog(log), bot);
      saveRecord(G);
      history.replaceState(null, '', '#' + G.code);
      view = 'game'; render(); window.scrollTo(0, 0);
      if (G.status === 'bot') runBot();
      break;
    }
    case 'start': {
      const name = (document.getElementById('my-name').value || 'Player 1').trim().slice(0, 16);
      store.set('name', name);
      const secret = { seed: randomSeed(), deck: chosenDeck() };
      const id = randomSeed().slice(0, 10);
      const log = { v: RULES_VERSION, id, n: [name, ''], c: [deckCommit(secret.seed, secret.deck)], t: [], x: [null, null] };
      G = makeGame(log, 0, secret, await encodeLog(log));
      saveRecord(G);
      history.replaceState(null, '', '#' + G.code);
      view = 'game'; render(); window.scrollTo(0, 0);
      break;
    }
    case 'join': {
      const name = (document.getElementById('my-name').value || 'Player 2').trim().slice(0, 16);
      store.set('name', name);
      const secret = { seed: randomSeed(), deck: chosenDeck() };
      const log = structuredClone(G.log);
      log.n[1] = name;
      log.c[1] = deckCommit(secret.seed, secret.deck);
      G = makeGame(log, 1, secret, await encodeLog(log));
      saveRecord(G);
      history.replaceState(null, '', '#' + G.code);
      view = 'game'; render(); window.scrollTo(0, 0);
      break;
    }
    case 'rematch': go('bot'); break;
    case 'undo': G.acts.pop(); render(); break;
    case 'end': endTurnSheet(); break;
    case 'cancel': cancel(); break;
    case 'blood': G.pend.l++; advance(); break;
    case 'log': logSheet(); break;
    case 'final': await sendFinal(); break;
    case 'resend': sentCode = G.code; view = 'sent'; render(); break;
    case 'latest': location.hash = G.notice.code; break;
    case 'back': view = 'game'; render(); break;
    case 'share':
      try { await navigator.share({ text: shareText(G) + ' ' + gameUrl(sentCode) }); } catch (err) { /* cancelled */ }
      break;
    case 'copy':
      try { await navigator.clipboard.writeText(shareText(G) + ' ' + gameUrl(sentCode)); toast('Link copied.'); }
      catch (err) { const box = document.getElementById('link-box'); box.focus(); box.select(); toast('Select the link and copy it.'); }
      break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheet) { closeSheet(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('recap') && G) G.recap = e.target.open; }, true);
document.addEventListener('input', e => { if (e.target.id === 'deck-name' && editDeck) editDeck.name = e.target.value; });

boot();
