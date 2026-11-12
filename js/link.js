'use strict';
// Game links: the whole game log, compressed, after the '#'.

function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function pipeBytes(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
async function encodeLog(log) {
  const raw = new TextEncoder().encode(JSON.stringify(log));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64u(await pipeBytes(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* fall through */ }
  }
  return 'j' + b64u(raw);
}
async function decodeLog(code) {
  code = code.trim().replace(/^.*#/, '');
  const kind = code[0], bytes = b64uToBytes(code.slice(1));
  let raw;
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser is too old to open game links. Try updating it.');
    raw = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind === 'j') raw = bytes;
  else throw new Error('That doesn’t look like a Dispatch link.');
  const log = JSON.parse(new TextDecoder().decode(raw));
  if (!log || !log.id || !Array.isArray(log.t) || !Array.isArray(log.c) || !Array.isArray(log.n)) throw new Error('That link is incomplete. Make sure the whole link was copied.');
  log.x = log.x || [null, null];
  return log;
}
function gameUrl(code) {
  return location.origin + location.pathname + '#' + code;
}
function randomSeed() {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('dispatch.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dispatch.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('dispatch.' + k); } catch (e) { /* ignore */ } },
};
