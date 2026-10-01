// Beat Pad sheets: kit picker, tempo, menu (beats, share, export, MIDI, help, about), pad edit and mic sampler.
import * as UI from './ui.js';

const Core = window.BeatCore;
const $ = (s) => document.querySelector(s);
let S = null;
const sheet = () => $('#sheet');
const body = () => $('#sheetBody');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BEATS_KEY = 'beatpad.beats.v1';
let onClose = null;

export function initSheets(state) {
  S = state;
  sheet().addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
}
export function closeSheet() {
  if (onClose) { const f = onClose; onClose = null; f(); }
  sheet().hidden = true;
  body().innerHTML = '';
}
function show(title, html) {
  if (onClose) { const f = onClose; onClose = null; f(); }
  $('#sheetTitle').textContent = title;
  body().innerHTML = html;
  sheet().hidden = false;
}
export function openSheet(kind, arg) {
  if (!S.ctx && kind !== 'menu') return;
  ({ kit: kitSheet, tempo: tempoSheet, menu: menuSheet, pad: padSheet, beats: beatsSheet, share: shareSheet, about: aboutSheet, help: helpSheet })[kind](arg);
}

// ---------- kit ----------
function kitSheet() {
  const L = UI.getLib();
  show('Sound', '<div class="cards">' + Core.KIT_IDS.map((k) => '<button class="card" data-kit="' + k + '" aria-pressed="' + (S.pattern.kit === k) + '"><b>' + esc(L.kits[k].name) + '</b><span>' + esc(L.kits[k].blurb) + '</span></button>').join('') + '</div>' +
    '<p style="margin-top:14px">Bass and Keys are under the Drums switch. Hold a pad to change its sound or record your own.</p>');
  body().querySelectorAll('[data-kit]').forEach((b) => b.addEventListener('click', async () => {
    body().querySelectorAll('[data-kit]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    await UI.setKit(b.dataset.kit);
    closeSheet();
  }));
}

// ---------- tempo ----------
function tempoSheet() {
  show('Tempo', '<div class="tempo-big num" id="tbig">' + S.pattern.bpm + '</div>' +
    '<div class="field"><span>BPM</span><input id="tIn" type="range" min="50" max="200" value="' + S.pattern.bpm + '" aria-label="Tempo"><output id="tOut">' + S.pattern.bpm + '</output></div>' +
    '<div class="row"><button class="btn" id="tm">−1</button><button class="btn" id="tp">+1</button><button class="btn" id="tap">Tap tempo</button></div>' +
    '<div class="row">' + [70, 85, 92, 120, 140].map((b) => '<button class="btn" data-bpm="' + b + '">' + b + '</button>').join('') + '</div>');
  const set = (v) => { UI.setBpm(v); $('#tbig').textContent = S.pattern.bpm; $('#tIn').value = S.pattern.bpm; $('#tOut').textContent = S.pattern.bpm; };
  $('#tIn').addEventListener('input', (e) => set(+e.target.value));
  $('#tm').addEventListener('click', () => set(S.pattern.bpm - 1));
  $('#tp').addEventListener('click', () => set(S.pattern.bpm + 1));
  body().querySelectorAll('[data-bpm]').forEach((b) => b.addEventListener('click', () => set(+b.dataset.bpm)));
  const taps = [];
  $('#tap').addEventListener('pointerdown', () => {
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(t);
    if (taps.length >= 3) { const d = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); set(60000 / d); }
  });
}

// ---------- menu ----------
function menuSheet() {
  const item = (id, t, s) => '<button id="' + id + '">' + t + '<small>' + s + '</small></button>';
  show('Beat Pad', '<div class="menu-list">' +
    item('mBeats', 'Saved beats', 'Save this beat or open one you saved') +
    item('mShare', 'Share link', 'A link that opens this beat') +
    item('mWav', 'Export WAV', 'Render two passes of the loop to an audio file') +
    item('mMidi', 'Connect MIDI', 'Play from a plugged-in pad controller') +
    item('mHelp', 'How to play', 'Keys, gestures and tips') +
    item('mAbout', 'About and credits', 'Where the sounds come from') + '</div>');
  $('#mBeats').addEventListener('click', () => beatsSheet());
  $('#mShare').addEventListener('click', () => shareSheet());
  $('#mWav').addEventListener('click', exportWav);
  $('#mMidi').addEventListener('click', async () => { closeSheet(); await UI.connectMidi(); });
  $('#mHelp').addEventListener('click', () => helpSheet());
  $('#mAbout').addEventListener('click', () => aboutSheet());
}

function readBeats() { try { return JSON.parse(localStorage.getItem(BEATS_KEY)) || []; } catch (e) { return []; } }
function beatsSheet() {
  const list = readBeats();
  show('Saved beats', '<div class="row"><input class="text-in" id="bName" placeholder="Name this beat" maxlength="40" style="flex:2"><button class="btn" id="bSave" style="flex:1;text-align:center">Save</button></div>' +
    '<div class="saved">' + (list.length ? list.map((b, i) => '<div class="it"><span>' + esc(b.name) + ' <small>' + new Date(b.savedAt).toLocaleDateString() + '</small></span><button data-open="' + i + '">Open</button><button data-del="' + i + '" aria-label="Delete ' + esc(b.name) + '">✕</button></div>').join('') : '<p>No saved beats yet.</p>') + '</div>');
  $('#bSave').addEventListener('click', () => {
    const name = $('#bName').value.trim() || 'Beat ' + (list.length + 1);
    list.unshift({ id: Date.now().toString(36), name, savedAt: Date.now(), pattern: S.pattern });
    try { localStorage.setItem(BEATS_KEY, JSON.stringify(list.slice(0, 50))); UI.status('Saved ' + name); } catch (e) { UI.status('Could not save, storage is full'); }
    beatsSheet();
  });
  body().querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const p = Core.sanitizePattern(list[+b.dataset.open].pattern);
    if (p) { UI.replacePattern(p); UI.status('Opened ' + list[+b.dataset.open].name); }
    closeSheet();
  }));
  body().querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    list.splice(+b.dataset.del, 1);
    localStorage.setItem(BEATS_KEY, JSON.stringify(list));
    beatsSheet();
  }));
}

function shareUrl() { return location.origin + location.pathname + '#b=' + Core.encodeShare(S.pattern); }
function shareSheet() {
  const url = shareUrl();
  const mic = Object.keys(S.engine ? S.engine.customPads : {}).length;
  show('Share link', '<p>Anyone with this link hears this beat with the same kit and settings.' + (mic ? ' Your mic sounds stay on this device, so those pads use the kit sound instead.' : '') + '</p>' +
    '<input class="text-in" id="sUrl" readonly value="' + esc(url) + '">' +
    '<div class="row"><button class="btn" id="sCopy" style="text-align:center">Copy link</button>' + (navigator.share ? '<button class="btn" id="sShare" style="text-align:center">Share…</button>' : '') + '</div>');
  $('#sCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); UI.status('Link copied'); } catch (e) { $('#sUrl').select(); document.execCommand('copy'); UI.status('Link copied'); }
  });
  if (navigator.share) $('#sShare').addEventListener('click', () => navigator.share({ title: 'Beat Pad beat', url }).catch(() => {}));
}

async function exportWav() {
  if (!Core.allEvents(S.pattern).length) { UI.status('Make a beat first'); closeSheet(); return; }
  closeSheet();
  UI.status('Rendering…', 0);
  try {
    const r = await S.engine.render(S.pattern, { loops: 2, tail: 1.5 });
    const blob = new Blob([window.BeatEngine.encodeWav(r.buffer)], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'beatpad-' + S.pattern.bpm + 'bpm.wav';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    window.__lastWav = blob;
    UI.status('WAV saved');
  } catch (e) { UI.status('Export failed: ' + e.message, 5000); }
}

function helpSheet() {
  show('How to play', '<p>Tap pads with as many fingers as you like. Tap nearer the middle of a pad for a harder hit.</p>' +
    '<p>Press record for a one-bar count-in, then play along. The loop keeps going and each pass adds a layer you can undo. Snap tidies the timing, and Swing adds groove.</p>' +
    '<p>Hold a pad to change its volume, pitch, tone and room, or to record your own sound with the mic. Switch to Bass or Keys to play notes that always fit the key.</p>' +
    '<h3>Keyboard</h3><p class="keymap"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> top row, <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd>, <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd>, <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd> bottom row. Hold Shift for a soft hit.<br>' +
    '<kbd>Space</kbd> play or stop, <kbd>Enter</kbd> record, <kbd>Backspace</kbd> undo, <kbd>G</kbd> grid, <kbd>M</kbd> metronome, <kbd>[</kbd> <kbd>]</kbd> tempo, <kbd>K</kbd> next kit. Shift-click or right-click a pad to edit it.</p>' +
    '<h3>MIDI</h3><p>Notes 36 to 51 play the 16 pads from the bottom left, like most pad controllers.</p>');
}
function aboutSheet() {
  const L = UI.getLib();
  show('About', '<p>Beat Pad is a drum pad for making beats with your fingers. Everything runs in your browser. There are no ads, accounts or tracking, and saved beats and mic sounds stay on this device.</p>' +
    '<h3>Sounds</h3><ul class="credits">' + L.credits.map((c) => '<li>' + esc(c.name) + ', <a href="' + esc(c.url) + '" target="_blank" rel="noopener">source</a>, ' + esc(c.license) + '</li>').join('') + '</ul>' +
    '<p>Sounds were trimmed, balanced and encoded for Beat Pad. Scales come from Chord Explorer\u2019s music theory module. Type is EB Garamond by Georg Duffner, under the <a href="fonts/OFL.txt" target="_blank" rel="noopener">SIL Open Font License</a>.</p>' +
    '<p>Latency: ' + (S.ctx ? Math.round(((S.ctx.baseLatency || 0) + (S.ctx.outputLatency || 0)) * 1000) + ' ms reported by this browser.' : 'start the app to measure.') + '</p>');
}

// ---------- pad edit + mic sampler ----------
function padSheet(i) {
  if (S.mode !== 'drums') return;
  const L = UI.getLib();
  const pd = S.pattern.pads[i];
  const mic = !!S.engine.customPads[i];
  const name = mic ? 'Mic ' + (i + 1) : L.kits[S.pattern.kit].pads[i].name;
  const f = (id, label, min, max, step, val, fmt) => '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output id="' + id + 'O">' + fmt(val) + '</output></div>';
  const fmtDb = (v) => (v > 0 ? '+' : '') + (+v).toFixed(0) + ' dB';
  const fmtSt = (v) => (v > 0 ? '+' : '') + v + ' st';
  const fmtF = (v) => (Math.abs(v) < 0.02 ? 'open' : v < 0 ? 'darker' : 'thinner');
  const fmtR = (v) => Math.round(v * 100) + '%';
  show(name, f('pVol', 'Volume', -24, 6, 1, pd.vol, fmtDb) + f('pPitch', 'Pitch', -12, 12, 1, pd.pitch, fmtSt) + f('pFilt', 'Tone', -1, 1, 0.02, pd.filter, fmtF) + f('pRev', 'Room', 0, 1, 0.01, pd.rev, fmtR) +
    '<div class="row"><button class="btn" id="pTry" style="text-align:center">Play</button><button class="btn" id="pReset" style="text-align:center">Reset</button></div>' +
    '<h3>Your own sound</h3><p>' + (mic ? 'This pad plays your recording.' : 'Record up to 4 seconds from the mic. Nothing leaves your device.') + '</p>' +
    '<div class="row"><button class="btn" id="pRec" style="text-align:center">' + (mic ? 'Record again' : 'Record from mic') + '</button>' + (mic ? '<button class="btn" id="pUnmic" style="text-align:center">Use kit sound</button>' : '') + '</div><div id="micArea"></div>');
  const bind = (id, key, fmt) => $('#' + id).addEventListener('input', (e) => { pd[key] = +e.target.value; $('#' + id + 'O').textContent = fmt(pd[key]); });
  bind('pVol', 'vol', fmtDb); bind('pPitch', 'pitch', fmtSt); bind('pFilt', 'filter', fmtF); bind('pRev', 'rev', fmtR);
  ['pVol', 'pPitch', 'pFilt', 'pRev'].forEach((id) => $('#' + id).addEventListener('change', () => UI.hitPad(i, 0.9)));
  $('#pTry').addEventListener('click', () => UI.hitPad(i, 0.9));
  $('#pReset').addEventListener('click', () => { S.pattern.pads[i] = Core.defaultPad(); padSheet(i); });
  $('#pRec').addEventListener('click', () => micRecord(i));
  if (mic) $('#pUnmic').addEventListener('click', () => { UI.clearCustomPad(i); padSheet(i); });
}

async function micRecord(i) {
  const area = $('#micArea');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { area.innerHTML = '<p>The mic was not available or not allowed.</p>'; return; }
  area.innerHTML = '<div class="meter"><i id="mLvl"></i></div><p id="mMsg">Recording… make your sound.</p><div class="row"><button class="btn" id="mStop" style="text-align:center">Stop</button></div>';
  const ctx = S.ctx;
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const chunks = [];
  let n = 0;
  const max = Math.round(ctx.sampleRate * 4);
  let done = false;
  const sink = ctx.createGain(); sink.gain.value = 0;
  proc.onaudioprocess = (ev) => {
    if (done) return;
    const d = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d)); n += d.length;
    let pk = 0; for (let k = 0; k < d.length; k++) pk = Math.max(pk, Math.abs(d[k]));
    const l = $('#mLvl'); if (l) l.style.width = Math.min(100, pk * 140) + '%';
    if (n >= max) finish();
  };
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  const cleanup = () => { done = true; try { src.disconnect(); proc.disconnect(); } catch (e) { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); };
  onClose = cleanup;
  function finish() {
    if (done) return;
    cleanup(); onClose = null;
    const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    trimEditor(i, all, ctx.sampleRate);
  }
  $('#mStop').addEventListener('click', finish);
}

// Auto-trim leading/trailing quiet, then let the user nudge start and end on a waveform.
function trimEditor(i, pcm, rate) {
  let pk = 0; for (let k = 0; k < pcm.length; k++) pk = Math.max(pk, Math.abs(pcm[k]));
  if (pk < 0.003) { $('#micArea').innerHTML = '<p>That was silent. Try again closer to the mic.</p>'; return; }
  const th = pk * 0.08;
  let a = 0; while (a < pcm.length && Math.abs(pcm[a]) < th) a++;
  let b = pcm.length - 1; while (b > a && Math.abs(pcm[b]) < th * 0.25) b--;
  a = Math.max(0, a - Math.round(rate * 0.003)); b = Math.min(pcm.length, b + Math.round(rate * 0.05));
  const area = $('#micArea');
  area.innerHTML = '<canvas class="wave" id="mWave" width="600" height="110"></canvas>' +
    '<div class="field"><label for="mA">Start</label><input id="mA" type="range" min="0" max="' + pcm.length + '" value="' + a + '"><output id="mAO"></output></div>' +
    '<div class="field"><label for="mB">End</label><input id="mB" type="range" min="0" max="' + pcm.length + '" value="' + b + '"><output id="mBO"></output></div>' +
    '<div class="row"><button class="btn" id="mPlay" style="text-align:center">Play</button><button class="btn" id="mUse" style="text-align:center">Use on pad</button></div>';
  const cv = $('#mWave'), g = cv.getContext('2d');
  const cut = () => {
    const s = +$('#mA').value, e = Math.max(s + 64, +$('#mB').value);
    const out = pcm.slice(s, e);
    let m = 0; for (let k = 0; k < out.length; k++) m = Math.max(m, Math.abs(out[k]));
    const gain = m > 0 ? 0.89 / m : 1; // normalize to about -1 dBFS
    const fi = Math.min(out.length, Math.round(rate * 0.002)), fo = Math.min(out.length, Math.round(rate * 0.03));
    for (let k = 0; k < out.length; k++) { let w = gain; if (k < fi) w *= k / fi; if (k > out.length - fo) w *= (out.length - k) / fo; out[k] *= w; }
    return out;
  };
  const draw = () => {
    const s = +$('#mA').value, e = +$('#mB').value;
    $('#mAO').textContent = (s / rate).toFixed(2) + 's'; $('#mBO').textContent = (e / rate).toFixed(2) + 's';
    g.fillStyle = '#17130f'; g.fillRect(0, 0, cv.width, cv.height);
    const step = pcm.length / cv.width;
    for (let x = 0; x < cv.width; x++) {
      let m = 0; const k0 = Math.floor(x * step); for (let k = k0; k < k0 + step; k++) m = Math.max(m, Math.abs(pcm[k] || 0));
      const inside = x * step >= s && x * step <= e;
      g.fillStyle = inside ? '#e0a24a' : '#3a3027';
      const h = Math.max(1, (m / pk) * 50); g.fillRect(x, 55 - h, 1, h * 2);
    }
  };
  ['mA', 'mB'].forEach((id) => $('#' + id).addEventListener('input', draw));
  draw();
  $('#mPlay').addEventListener('click', () => {
    const out = cut(); const buf = S.ctx.createBuffer(1, out.length, rate); buf.copyToChannel(out, 0);
    const src = S.ctx.createBufferSource(); src.buffer = buf; src.connect(S.player.bus.dry); src.start();
  });
  $('#mUse').addEventListener('click', () => { UI.setCustomPad(i, cut(), rate, true); UI.status('Your sound is on the pad'); padSheet(i); });
}
