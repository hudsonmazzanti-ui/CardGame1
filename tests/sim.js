/*
  Stress test: two simulated phones play random games, passing only the game log back and forth.
  After every turn it checks that both phones agree on the board, and at the end that the
  fair-play check passes. Run it after changing cards:   node tests/sim.js [games]
*/
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'js') + path.sep;
const GAMES = +process.argv[2] || 400;
for (const f of ['cards.js','sha256.js','engine.js','bot.js']) vm.runInThisContext(fs.readFileSync(root+f,'utf8'), {filename:f});
const crypto = require('crypto');
// sha check
const ref = crypto.createHash('sha256').update('hello dispatch').digest();
if (Buffer.compare(Buffer.from(sha256('hello dispatch')), ref)) throw new Error('sha mismatch');
let R = Math.random;
const pick = a => a[Math.floor(R()*a.length)];
function randDeck(){ const d=[...POOL].sort(()=>R()-0.5).slice(0,10); return d; }
function mkSecret(){ return { seed: crypto.randomBytes(16).toString('base64url'), deck: randDeck() }; }

function tryAct(st, a){ const c = structuredClone(st); try { act(c, a, true); return c; } catch(e){ if (e instanceof Fizzle) return null; throw e; } }

function botTurn(st, side, secret){
  if (canReshuffle(st, side) && R() < 0.6) return [['m']];
  const acts=[];
  for (let n=0; n<12 && !st.over && !st.ended; n++){
    const P = st.P[side], cands=[];
    // pitch + play combos
    for (const c of new Set(P.hand)) {
      const C=CARDS[c]; if(!C) continue;
      // try to pay by pitching others
      let k = c==='titan' ? costOf(st,side,c) : costOf(st,side,c);
      const plan=[]; let pool=st.pool; const rest=[...P.hand]; rest.splice(rest.indexOf(c),1);
      let l=0;
      if (C.blood && R()<0.5) l=Math.min(k, 2);
      for (const r of rest) { if (pool >= k-l) break; if (CARDS[r].pitch>0){ plan.push(['p',r]); pool+=CARDS[r].pitch; } }
      if (C.type==='trap'){
        const x = pick(trapChoices(c));
        const plan2 = [...plan]; let pool2 = pool;
        for (const r of rest) { if (pool2 >= C.cost + taxOf(st, side)) break; if (CARDS[r].pitch > 0 && !plan2.some(a => a[1] === r)) { plan2.push(['p', r]); pool2 += CARDS[r].pitch; } }
        plan.splice(0, plan.length, ...plan2);
        cands.push([...plan, ['t', commitFor(c,x,saltFor(secret.seed,nextUid(st)+plan.length)), C.cost]]);
      } else {
        let tg=null;
        if (C.target){ const ts=spellTargets(st,c); if(!ts.length) continue; tg=pick(ts); }
        const pk = c==='map' ? pick(mapOptions(secret, st.turn)) : null;
        cands.push([...plan, ['c', c, k, l, tg, Math.floor(R()*3), pk]]);
        if (C.disguise) cands.push([...plan.slice(0,1), ['d', commitFor(c,null,saltFor(secret.seed,nextUid(st)+Math.min(1,plan.length))), 0]]);
      }
    }
    for (const u of st.P[side].board){
      if (!attackBlock(st,u.uid)) cands.push([['a', u.uid, pick(attackTargets(st,u.uid))]]);
      if (u.fd && u.sid){ const ts=flipTargets(st,u.sid); cands.push([['f', u.uid, u.sid, saltFor(secret.seed,u.uid), ts.length?pick(ts):null]]); }
    }
    if (!cands.length || R()<0.12) break;
    const grp = pick(cands);
    let c2 = st, ok = true;
    for (const a of grp){ const nx = tryAct(c2, a); if(!nx){ ok=false; break; } c2 = nx; }
    if (!ok) continue;
    for (const a of grp) acts.push(a);
    st = c2;
  }
  acts.push(['e']);
  return acts;
}

let games=0, kos=0, trapsFired=0, warns=0;
const botWins=[0,0,0];
for (let g=0; g<GAMES; g++){
  const sec=[mkSecret(), mkSecret()];
  // Game types: random vs random, bot vs random (bot side alternates), bot vs bot.
  const kind = g % 4, useBot = [kind === 1 || kind === 3, kind === 2 || kind === 3];
  if (kind === 3) { sec[0].deck = pick(PRESET_DECKS).cards.slice(); sec[1].deck = pick(PRESET_DECKS).cards.slice(); }
  const log={v:RULES_VERSION,id:'x',n:['A','B'],c:[deckCommit(sec[0].seed,sec[0].deck), deckCommit(sec[1].seed,sec[1].deck)],t:[],x:[null,null]};
  const view = s => { const a=[null,null]; a[s]=sec[s]; return a; };
  for (;;){
    const T = log.t.length, side = T%2;
    const base = rebuild(log, view(side));
    if (base.st.warn.length) { 
      // replay with event dump
      for (const e of base.st.ev) console.log(e.t, e.p, e.s);
      console.log(JSON.stringify(log.t.map(x=>x.a)), JSON.stringify(log.t.map(x=>x.r)));
      throw new Error('warn on own device side '+side+': '+base.st.warn.join(';')); }
    // compare canonical snapshots with the other device (other device has turn T-1 pending if it was theirs)
    const other = rebuild(log, view(1-side));
    for (let i=0;i<T-1;i++) if (base.snaps[i]!==other.snaps[i]) { console.log(JSON.stringify(log)); throw new Error(`divergence game ${g} turn ${i}\n${base.snaps[i]}\n${other.snaps[i]}`); }
    if (base.st.over){
      log.t.push({r: base.owed}); log.x[side]=sec[side]; log.x[1-side]=sec[1-side];
      break;
    }
    const st = structuredClone(base.st); startTurn(st, T);
    const acts = useBot[side] ? botPlan(st, side, sec[side]) : botTurn(st, side, sec[side]);
    log.t.push(base.owed.length ? {a:acts, r:base.owed} : {a:acts});
    trapsFired += base.owed.length;
  }
  const A = rebuild(log, view(0)), B = rebuild(log, view(1)), full = rebuild(log, sec);
  if (A.snaps.join()!==B.snaps.join() || A.snaps.join()!==full.snaps.join()) throw new Error('final divergence '+g);
  if (full.st.warn.length){ warns++; console.log('WARN', full.st.warn); }
  games++; if (full.st.over.ko) kos++;
  if (kind === 1 || kind === 2) { const b = kind === 1 ? 0 : 1, w = full.st.over.winner; botWins[w === b ? 0 : w === null ? 1 : 2]++; }
}
console.log({games, knockouts: kos, trapsFired, fairPlayWarnings: warns});
console.log('bot vs random-move player (win/draw/loss):', botWins.join(' / '));
if (warns) process.exit(1);
console.log('OK: both phones agreed on every turn of every game.');
