// Beat Pad UI: pads, transport, looper, step grid, melodic mode, keyboard and MIDI.
import { SOUND_LIBRARY as LIB } from './kits.js';
import { openSheet, closeSheet, initSheets } from './sheets.js';

const Core = window.BeatCore;
const Theory = window.Theory;
const $ = (s) => document.querySelector(s);
const app = $('#app');

const S = {
  ctx: null, engine: null, player: null, transport: null,
  pattern: Core.newPattern(), recording: false, recLayer: null, playing: false,
  mode: 'drums', view: 'pads', latency: 0, metronome: false,
};
window.BeatApp = S;

// ---------- persistence ----------
const CUR_KEY = 'beatpad.current.v1';
let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(CUR_KEY, JSON.stringify(S.pattern)); } catch (e) { /* storage full */ } }, 500);
}
function loadInitial() {
  const m = location.hash.match(/[#&]b=([A-Za-z0-9_-]+)/);
  if (m) {
    try { S.pattern = Core.decodeShare(m[1]); S.fromLink = true; return; } catch (e) { S.linkError = true; }
  }
  try {
    const raw = localStorage.getItem(CUR_KEY);
    if (raw) { const p = Core.sanitizePattern(JSON.parse(raw)); if (p) S.pattern = p; }
  } catch (e) { /* ignore */ }
}
loadInitial();

// ---------- status line ----------
let statusTimer = null;
export function status(msg, ms) {
  const el = $('#status');
  el.textContent = msg || '';
  clearTimeout(statusTimer);
  if (msg && ms !== 0) statusTimer = setTimeout(() => { el.textContent = ''; }, ms || 2200);
}

// ---------- audio start ----------
async function startAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  S.ctx = new AC({ latencyHint: 'interactive' });
  S.engine = window.BeatEngine.createEngine({ library: LIB, baseUrl: '' });
  S.player = S.engine.createPlayer(S.ctx, window.BeatEngine.buildBus(S.ctx));
  S.latency = (S.ctx.outputLatency || 0) + (S.ctx.baseLatency || 0);
  S.transport = S.engine.createTransport(S.player, () => S.pattern, { onBeat, onEvent });
  const bar = $('#loadBar');
  bar.classList.add('on');
  const prog = (d, n) => { bar.firstElementChild.style.width = Math.round((100 * d) / n) + '%'; };
  await S.engine.loadKit(S.ctx, S.pattern.kit, prog);
  if (S.pattern.layers.some((l) => l.events.some((e) => e.inst))) {
    for (const i of new Set(Core.allEvents(S.pattern).filter((e) => e.inst).map((e) => e.inst))) await S.engine.loadInstrument(S.ctx, i);
  }
  await loadCustomPads();
  $('#splash').hidden = true;
  if (S.fromLink) status('Loaded a shared beat. Press play.', 3500);
  if (S.linkError) status('That share link could not be read.', 3500);
  // warm the other kits quietly so switching is instant
  setTimeout(() => { Core.KIT_IDS.forEach((k) => S.engine.loadKit(S.ctx, k).catch(() => {})); }, 1500);
}
export async function ensureKit(kitId) {
  if (!S.engine.kitLoaded(kitId)) { status('Loading ' + LIB.kits[kitId].name + '…', 0); await S.engine.loadKit(S.ctx, kitId); status(''); }
}
export async function ensureInst(instId) {
  if (!S.engine.instLoaded(instId)) { status('Loading ' + LIB.instruments[instId].name + '…', 0); await S.engine.loadInstrument(S.ctx, instId); status(''); }
}

// ---------- mic sample storage (IndexedDB) ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('beatpad', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('samples');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('samples', 'readwrite'); tx.objectStore('samples').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function idbDel(key) {
  const db = await idb();
  return new Promise((res) => { const tx = db.transaction('samples', 'readwrite'); tx.objectStore('samples').delete(key); tx.oncomplete = res; tx.onerror = res; });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res) => { const r = db.transaction('samples').objectStore('samples').get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
}
async function loadCustomPads() {
  try {
    for (let i = 0; i < 16; i++) {
      const rec = await idbGet('pad' + i);
      if (rec && rec.pcm) setCustomPad(i, rec.pcm, rec.rate, false);
    }
  } catch (e) { /* private mode: no mic pads */ }
}
export function setCustomPad(i, pcm, rate, persist) {
  const buf = S.ctx.createBuffer(1, pcm.length, rate);
  buf.copyToChannel(pcm, 0);
  S.engine.customPads[i] = buf;
  if (persist) idbPut('pad' + i, { pcm, rate }).catch(() => {});
  renderPads();
}
export function clearCustomPad(i) {
  delete S.engine.customPads[i];
  idbDel('pad' + i);
  renderPads();
}

// ---------- pads ----------
const KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
const KEY_LABELS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
const padsEl = $('#pads');
const padEls = [];

function melodicNoteFor(i) {
  // pads read bottom-left upward: bottom row is degrees 0-3
  const row = Math.floor(i / 4), col = i % 4;
  const degree = (3 - row) * 4 + col;
  const m = S.pattern.melodic;
  const semis = Core.scaleSemis(Theory, m.scale);
  const base = (m.inst === 'bass' ? 36 : 48) + m.octave * 12;
  return { midi: Core.degreeToMidi(semis, m.key, base, degree), tonic: degree % semis.length === 0 };
}
function midiName(n) { return Core.KEY_NAMES[n % 12] + (Math.floor(n / 12) - 1); }

export function renderPads() {
  if (!padEls.length) {
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button');
      b.className = 'pad';
      b.dataset.row = Math.floor(i / 4);
      b.dataset.i = i;
      b.innerHTML = '<span class="glow"></span><span class="key">' + KEY_LABELS[i] + '</span><span class="lbl"></span>';
      padsEl.appendChild(b);
      padEls.push(b);
    }
  }
  const kit = LIB.kits[S.pattern.kit];
  padEls.forEach((b, i) => {
    let label, tonic = false;
    if (S.mode === 'drums') label = S.engine && S.engine.customPads[i] ? 'Mic ' + (i + 1) : kit.pads[i].name;
    else { const n = melodicNoteFor(i); label = midiName(n.midi); tonic = n.tonic; }
    b.querySelector('.lbl').textContent = label;
    b.classList.toggle('tonic', tonic);
    b.classList.toggle('mic', S.mode === 'drums' && !!(S.engine && S.engine.customPads[i]));
    b.setAttribute('aria-label', label + ' pad, key ' + KEY_LABELS[i]);
  });
  $('#kitName').textContent = kit.name;
}

function flash(i) {
  const b = padEls[i];
  if (!b) return;
  b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('hit'), 110);
}

// Play a pad now (live) and record it if recording.
export function hitPad(i, vel) {
  if (!S.ctx) return;
  if (S.ctx.state !== 'running') S.ctx.resume();
  const now = S.ctx.currentTime;
  flash(i);
  let ev;
  if (S.mode === 'drums') {
    S.player.trigger(S.pattern.kit, i, vel, now, S.pattern.pads[i]);
    ev = { pad: i, vel };
  } else {
    const inst = S.pattern.melodic.inst;
    if (!S.engine.instLoaded(inst)) return;
    const n = melodicNoteFor(i).midi;
    const v = S.player.note(inst, n, vel, now, 0.6);
    held.set(i, { v, start: now, inst, note: n });
    ev = { note: n, inst, vel, dur: 2 };
  }
  if (S.recording && S.transport.running && now >= S.transport.countInEnd - 0.05) {
    const total = Core.loopSteps(S.pattern);
    const raw = Core.timeToStep(now, S.transport.origin, S.pattern.bpm, total, S.latency * 0.5);
    ev.t = Core.quantize(raw, S.pattern.quant, total);
    // a quantized hit landing just ahead would double-trigger on this pass, so mark it
    Core.addHit(S.pattern, S.recLayer, ev);
    if (S.view === 'grid' || wideScreen()) renderGrid();
    autosave();
  }
}
const held = new Map();
function releasePad(i) {
  const h = held.get(i);
  if (!h) return;
  held.delete(i);
  const len = S.ctx.currentTime - h.start;
  if (len > 0.6 && h.v) { try { h.v.gain.gain.cancelScheduledValues(S.ctx.currentTime); h.v.src.stop(S.ctx.currentTime + 0.13); } catch (e) { /* ignore */ } }
}

function padVelocity(e, el) {
  if (e.pressure && e.pressure !== 0.5 && e.pointerType === 'pen') return Core.clamp(e.pressure, 0.2, 1);
  const r = el.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const d = Math.min(1, Math.hypot(dx, dy) / 1.2);
  return +(1 - 0.3 * d).toFixed(3);
}

let pressTimer = null;
padsEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pad');
  if (!el) return;
  e.preventDefault();
  const i = +el.dataset.i;
  if (e.button === 2 || e.shiftKey && e.pointerType === 'mouse') { openSheet('pad', i); return; }
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  hitPad(i, padVelocity(e, el));
  clearTimeout(pressTimer);
  const x0 = e.clientX, y0 = e.clientY;
  el._move = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 12) clearTimeout(pressTimer); };
  if (S.mode === 'drums' && !S.recording) pressTimer = setTimeout(() => { openSheet('pad', i); }, 550);
});
padsEl.addEventListener('pointermove', (e) => { const el = e.target.closest('.pad'); if (el && el._move) el._move(e); });
const endPress = (e) => { clearTimeout(pressTimer); const el = e.target.closest && e.target.closest('.pad'); if (el) releasePad(+el.dataset.i); };
padsEl.addEventListener('pointerup', endPress);
padsEl.addEventListener('pointercancel', endPress);
padsEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- transport ----------
const beatsEl = $('#beats');
function renderBeats() {
  const n = S.pattern.bars * 4;
  beatsEl.innerHTML = '';
  for (let q = 0; q < n; q++) { const i = document.createElement('i'); if (q && q % 4 === 0) i.className = 'bar'; beatsEl.appendChild(i); }
}
function onBeat(when, q, inCount) {
  const delay = Math.max(0, (when - S.ctx.currentTime + S.latency) * 1000);
  setTimeout(() => {
    const kids = beatsEl.children;
    const n = kids.length;
    for (const k of kids) k.classList.remove('on', 'count');
    if (inCount) { const k = kids[((q % 4) + 4) % 4]; if (k) k.classList.add('count'); }
    else { const k = kids[((q % n) + n) % n]; if (k) k.classList.add('on'); }
  }, delay);
}
function onEvent(e, when) {
  if (e.pad == null && S.mode === 'drums') return;
  const delay = Math.max(0, (when - S.ctx.currentTime + S.latency) * 1000);
  setTimeout(() => {
    if (S.mode === 'drums' && e.pad != null) { const b = padEls[e.pad]; if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } }
    if (S.view === 'grid' || wideScreen()) markPlayhead();
  }, delay);
}

export function play(countIn) {
  if (S.transport.running) return;
  S.transport.start({ countIn: countIn ? 1 : 0 });
  S.playing = true;
  $('#playBtn').setAttribute('aria-pressed', 'true');
  $('#playBtn').setAttribute('aria-label', 'Stop');
}
export function stop() {
  S.transport.stop();
  S.playing = false;
  setRecording(false);
  $('#playBtn').setAttribute('aria-pressed', 'false');
  $('#playBtn').setAttribute('aria-label', 'Play');
  for (const k of beatsEl.children) k.classList.remove('on', 'count');
  clearPlayhead();
}
function setRecording(on) {
  S.recording = on;
  $('#recBtn').setAttribute('aria-pressed', String(on));
  app.classList.toggle('recording', on);
  if (!on && S.recLayer && !S.recLayer.events.length) S.pattern.layers = S.pattern.layers.filter((l) => l !== S.recLayer);
  if (!on) S.recLayer = null;
}
// Each loop pass while recording becomes its own layer, so undo removes the last pass.
let lastPass = -1;
setInterval(() => {
  if (!S.recording || !S.transport || !S.transport.running) return;
  const p = S.pattern;
  const loopLen = Core.loopSteps(p) * Core.stepDur(p.bpm);
  const pass = Math.floor((S.ctx.currentTime - S.transport.origin) / loopLen);
  if (pass > lastPass && pass >= 0) {
    lastPass = pass;
    if (S.recLayer && S.recLayer.events.length) S.recLayer = Core.openLayer(p, 'rec');
  }
}, 50);

$('#playBtn').addEventListener('click', () => { if (S.transport.running) stop(); else play(false); });
$('#recBtn').addEventListener('click', () => {
  if (S.recording) { setRecording(false); status('Recording off'); return; }
  S.recLayer = Core.openLayer(S.pattern, 'rec');
  lastPass = -1;
  setRecording(true);
  if (!S.transport.running) { play(true); status('One bar count-in…', 2600); } else status('Recording. Each pass adds a layer.');
});
$('#undoBtn').addEventListener('click', undo);
$('#clearBtn').addEventListener('click', () => {
  if (!Core.allEvents(S.pattern).length) return;
  if (!confirm('Clear this beat?')) return;
  S.pattern.layers = [];
  if (S.recording) S.recLayer = Core.openLayer(S.pattern, 'rec');
  renderGrid(); autosave(); status('Cleared');
});
function undo() {
  const l = Core.undoLayer(S.pattern);
  if (S.recording) S.recLayer = Core.openLayer(S.pattern, 'rec');
  renderGrid(); autosave();
  status(l ? 'Removed the last layer' : 'Nothing to undo');
}
$('#metBtn').addEventListener('click', () => {
  S.metronome = !S.metronome;
  if (S.transport) S.transport.state.metronome = S.metronome;
  $('#metBtn').setAttribute('aria-pressed', String(S.metronome));
});
$('#tempoBtn').addEventListener('click', () => openSheet('tempo'));
$('#kitBtn').addEventListener('click', () => openSheet('kit'));
$('#menuBtn').addEventListener('click', () => openSheet('menu'));

export function setBpm(bpm) {
  const old = S.pattern.bpm;
  S.pattern.bpm = Core.clamp(Math.round(bpm), 50, 200);
  if (S.transport) S.transport.retime(old, S.pattern.bpm, Core.loopSteps(S.pattern));
  $('#bpmVal').textContent = S.pattern.bpm;
  autosave();
}

// ---------- footer controls ----------
const quantSel = $('#quantSel'), swingIn = $('#swingIn'), barsSel = $('#barsSel');
quantSel.addEventListener('change', () => { S.pattern.quant = +quantSel.value; autosave(); });
swingIn.addEventListener('input', () => { S.pattern.swing = +swingIn.value / 100; $('#swingVal').textContent = swingIn.value + '%'; autosave(); });
barsSel.addEventListener('change', () => {
  const nb = +barsSel.value, ob = S.pattern.bars;
  if (nb > ob) { // repeat the existing loop to fill the longer length
    const total = ob * 16;
    for (const l of S.pattern.layers) {
      const extra = [];
      for (let k = 1; k < nb / ob; k++) for (const e of l.events) extra.push({ ...e, t: e.t + k * total });
      l.events.push(...extra);
    }
  } else {
    for (const l of S.pattern.layers) l.events = l.events.filter((e) => e.t < nb * 16);
  }
  S.pattern.bars = nb;
  renderBeats(); renderGrid(); autosave();
});

// ---------- views and modes ----------
document.querySelectorAll('.views [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('.views [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setView(v) {
  S.view = v;
  app.dataset.view = v;
  document.querySelectorAll('.views [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  renderGrid();
}
export async function setMode(m) {
  S.mode = m;
  app.dataset.mode = m;
  document.querySelectorAll('.views [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  $('#melBar').hidden = m === 'drums';
  if (m !== 'drums') { S.pattern.melodic.inst = m; await ensureInst(m); }
  renderPads(); renderGrid(); autosave();
  if (m !== 'drums') status('Every pad is in key. Dotted pads are the home note.', 3500);
}
const keySel = $('#keySel'), scaleSel = $('#scaleSel');
Core.KEY_NAMES.forEach((k, i) => keySel.add(new Option(k, i)));
Core.SCALE_IDS.forEach((s) => scaleSel.add(new Option(Theory.SCALES[s].name, s)));
keySel.addEventListener('change', () => { S.pattern.melodic.key = +keySel.value; renderPads(); autosave(); });
scaleSel.addEventListener('change', () => { S.pattern.melodic.scale = scaleSel.value; renderPads(); autosave(); });
$('#octDown').addEventListener('click', () => setOct(-1));
$('#octUp').addEventListener('click', () => setOct(1));
function setOct(d) { const m = S.pattern.melodic; m.octave = Core.clamp(m.octave + d, -1, 1); $('#octVal').textContent = (m.octave > 0 ? '+' : '') + m.octave; renderPads(); autosave(); }

// ---------- step grid ----------
const gridEl = $('#grid');
const wideScreen = () => window.matchMedia('(min-width: 980px)').matches;
export function renderGrid() {
  const p = S.pattern;
  const steps = Core.loopSteps(p);
  const kit = LIB.kits[p.kit];
  const on = new Set();
  const notes = [];
  for (const e of Core.allEvents(p)) {
    if (e.pad != null && Math.abs(e.t - Math.round(e.t)) < 0.5) on.add(e.pad + ':' + (Math.round(e.t) % steps));
    if (e.note != null) notes.push(e);
  }
  let html = '';
  const order = [12, 13, 8, 9, 10, 2, 1, 6, 0, 3, 4, 5, 7, 11, 14, 15]; // kick, snare, hats first
  for (const pad of order) {
    html += '<div class="grow" data-row="' + Math.floor(pad / 4) + '"><div class="gname">' + kit.pads[pad].name + '</div><div class="gcells" style="--steps:' + steps + '">';
    for (let s = 0; s < steps; s++) {
      const cls = 'gc' + (s % 4 === 0 ? ' beat' : '') + (s && s % 16 === 0 ? ' barline' : '') + (on.has(pad + ':' + s) ? ' on' : '');
      html += '<button class="' + cls + '" data-pad="' + pad + '" data-s="' + s + '" aria-label="' + kit.pads[pad].name + ' step ' + (s + 1) + '" aria-pressed="' + on.has(pad + ':' + s) + '"></button>';
    }
    html += '</div></div>';
  }
  if (notes.length) html += '<p class="gnote">Plus ' + notes.length + ' bass and keys notes, played live.</p>';
  gridEl.innerHTML = html;
}
gridEl.addEventListener('click', (e) => {
  const c = e.target.closest('.gc');
  if (!c) return;
  const pad = +c.dataset.pad, s = +c.dataset.s;
  const nowOn = Core.gridToggle(S.pattern, pad, s);
  c.classList.toggle('on', nowOn);
  c.setAttribute('aria-pressed', String(nowOn));
  if (nowOn && S.ctx && !S.transport.running) { S.player.trigger(S.pattern.kit, pad, 0.85, S.ctx.currentTime, S.pattern.pads[pad]); flash(pad); }
  autosave();
});
let phCells = [];
function markPlayhead() {
  if (!S.transport.running) return;
  const s = Math.floor(S.transport.position(S.latency));
  clearPlayhead();
  phCells = Array.from(gridEl.querySelectorAll('.gc[data-s="' + s + '"]'));
  phCells.forEach((c) => c.classList.add('ph'));
}
function clearPlayhead() { phCells.forEach((c) => c.classList.remove('ph')); phCells = []; }
setInterval(() => { if (S.transport && S.transport.running && (S.view === 'grid' || wideScreen())) markPlayhead(); }, 60);

// ---------- keyboard ----------
const isTyping = (e) => /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range';
window.addEventListener('keydown', (e) => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('#sheet').hidden) { if (e.code === 'Escape') closeSheet(); return; }
  if (!S.ctx) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); $('#startBtn').click(); } return; }
  const i = KEY_CODES.indexOf(e.code);
  if (i >= 0) { e.preventDefault(); if (!e.repeat) hitPad(i, e.shiftKey ? 0.5 : 1); return; }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); $('#playBtn').click(); break;
    case 'Enter': case 'Period': e.preventDefault(); $('#recBtn').click(); break;
    case 'Backspace': e.preventDefault(); undo(); break;
    case 'KeyG': setView(S.view === 'grid' ? 'pads' : 'grid'); break;
    case 'KeyM': $('#metBtn').click(); break;
    case 'BracketLeft': setBpm(S.pattern.bpm - 1); break;
    case 'BracketRight': setBpm(S.pattern.bpm + 1); break;
    case 'KeyK': { const ks = Core.KIT_IDS; setKit(ks[(ks.indexOf(S.pattern.kit) + 1) % ks.length]); break; }
    default:
  }
});
window.addEventListener('keyup', (e) => { const i = KEY_CODES.indexOf(e.code); if (i >= 0) releasePad(i); });

export async function setKit(k) {
  if (!LIB.kits[k]) return;
  await ensureKit(k);
  S.pattern.kit = k;
  renderPads(); renderGrid(); autosave();
  status(LIB.kits[k].name + ' kit');
}

// ---------- Web MIDI ----------
export async function connectMidi() {
  if (!navigator.requestMIDIAccess) { status('This browser has no MIDI support'); return false; }
  try {
    const acc = await navigator.requestMIDIAccess();
    const bind = () => acc.inputs.forEach((inp) => { inp.onmidimessage = onMidi; });
    bind(); acc.onstatechange = bind;
    status(acc.inputs.size ? 'MIDI connected' : 'MIDI ready. Plug in a controller.');
    return true;
  } catch (e) { status('MIDI was not allowed'); return false; }
}
function onMidi(m) {
  const [st, note, vel] = m.data;
  if ((st & 0xf0) !== 0x90 || !vel) return;
  if (S.mode === 'drums') {
    const k = note - 36;
    if (k < 0 || k > 15) return;
    const row = 3 - Math.floor(k / 4); // MIDI 36 is bottom-left
    hitPad(row * 4 + (k % 4), vel / 127);
  } else {
    // nearest pad note in scale
    let best = 0, bd = 1e9;
    for (let i = 0; i < 16; i++) { const d = Math.abs(melodicNoteFor(i).midi - note); if (d < bd) { bd = d; best = i; } }
    hitPad(best, vel / 127);
  }
}

// ---------- boot ----------
function syncControls() {
  const p = S.pattern;
  $('#bpmVal').textContent = p.bpm;
  quantSel.value = String(p.quant);
  swingIn.value = Math.round(p.swing * 100); $('#swingVal').textContent = swingIn.value + '%';
  barsSel.value = String(p.bars);
  keySel.value = String(p.melodic.key); scaleSel.value = p.melodic.scale;
  $('#octVal').textContent = (p.melodic.octave > 0 ? '+' : '') + p.melodic.octave;
}
export function refreshAll() { syncControls(); renderBeats(); renderPads(); renderGrid(); }
export function replacePattern(p) { if (S.transport && S.transport.running) stop(); S.pattern = p; ensureKit(p.kit).then(refreshAll); autosave(); }
export function getLib() { return LIB; }

refreshAll();
initSheets(S);
$('#startBtn').addEventListener('click', async () => {
  $('#startBtn').disabled = true;
  try { await startAudio(); renderPads(); } catch (e) { status('Could not start audio: ' + e.message, 6000); $('#startBtn').disabled = false; }
}, { once: false });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});
