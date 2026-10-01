/* Beat Pad core: pure logic shared by the browser app and node tests.
   Pattern model, quantize, swing, scheduler window math and the share-link codec. No DOM, no audio. */
(function (global) {
  'use strict';

  const KIT_IDS = ['acoustic', 'trap', 'lofi', 'house'];
  const INST_IDS = ['bass', 'keys'];
  const SCALE_IDS = ['major', 'minor', 'majorPentatonic', 'minorPentatonic', 'dorian', 'mixolydian', 'blues', 'harmonicMinor'];
  const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const TICKS = 24; // share/storage resolution per sixteenth step
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function defaultPad() { return { vol: 0, pitch: 0, filter: 0, rev: 0.12 }; }

  function newPattern(opts) {
    const o = opts || {};
    return {
      v: 1,
      bpm: o.bpm || 92,
      bars: o.bars || 2,
      swing: o.swing == null ? 0 : o.swing,
      quant: o.quant == null ? 16 : o.quant,
      kit: o.kit || 'acoustic',
      pads: Array.from({ length: 16 }, defaultPad),
      melodic: { inst: 'bass', key: 9, scale: 'minorPentatonic', octave: 0 },
      layers: [],
    };
  }

  const loopSteps = (p) => p.bars * 16;
  const stepDur = (bpm) => 60 / bpm / 4;

  // Swing delays events that sit exactly on odd sixteenths by swing * 2/3 of a step.
  // swing 0 = straight, 0.5 = 1/3 step later, which is a hard triplet shuffle (2:1 pairs).
  function swingOffsetSteps(step, swing) {
    const whole = Math.round(step);
    if (Math.abs(step - whole) > 1e-6 || ((whole % 2) + 2) % 2 !== 1) return 0;
    return clamp(swing, 0, 0.5) * 2 / 3;
  }
  function swungStep(step, swing) {
    return step + swingOffsetSteps(step, clamp(swing, 0, 0.5));
  }

  // Quantize a raw step position to a grid of `quant` notes per bar (8, 16 or 24 for 1/16 triplets). 0 = off.
  function quantize(step, quant, total) {
    let s = step;
    if (quant) {
      const unit = 16 / quant;
      s = Math.round(step / unit) * unit;
    } else {
      s = Math.round(step * TICKS) / TICKS; // off: keep the played position at 1/24 step
    }
    if (total) s = ((s % total) + total) % total;
    return +s.toFixed(6);
  }

  // Convert an audio-clock time to a loop position in steps.
  function timeToStep(t, origin, bpm, total, latency) {
    const raw = (t - (latency || 0) - origin) / stepDur(bpm);
    return ((raw % total) + total) % total;
  }

  // Lookahead scheduler math: list every (event, when) whose time falls in [from, to) of audio time.
  // Events repeat every loop. Swing is applied to event step before conversion.
  function eventsInWindow(events, opts, from, to) {
    const { origin, bpm, total, swing } = opts;
    const sd = stepDur(bpm);
    const loopLen = total * sd;
    const out = [];
    if (to <= from) return out;
    const firstLoop = Math.floor((from - origin) / loopLen) - 1;
    const lastLoop = Math.floor((to - origin) / loopLen) + 1;
    for (let k = Math.max(0, firstLoop); k <= lastLoop; k++) {
      const base = origin + k * loopLen;
      for (const e of events) {
        const when = base + swungStep(e.t, swing || 0) * sd;
        if (when >= from - 1e-9 && when < to - 1e-9) out.push({ e, when, loop: k });
      }
    }
    out.sort((a, b) => a.when - b.when);
    return out;
  }

  function allEvents(p) {
    const out = [];
    for (const l of p.layers) for (const e of l.events) out.push(e);
    return out;
  }

  // Add a hit; a same-pad hit within 1/32 note (half a step) at the same spot replaces the old one.
  function addHit(p, layer, ev) {
    const total = loopSteps(p);
    const near = (a, b) => Math.min(Math.abs(a - b), total - Math.abs(a - b)) < 0.25;
    for (const l of p.layers) {
      l.events = l.events.filter((x) => !(sameVoice(x, ev) && near(x.t, ev.t)));
    }
    layer.events.push(ev);
    return ev;
  }
  const sameVoice = (a, b) => (a.pad != null && a.pad === b.pad) || (a.note != null && a.note === b.note && a.inst === b.inst);

  function openLayer(p, kind) {
    const l = { id: 'L' + (p.layers.length + 1) + '-' + (kind || 'rec'), events: [] };
    p.layers.push(l);
    return l;
  }
  function undoLayer(p) {
    for (let i = p.layers.length - 1; i >= 0; i--) {
      if (p.layers[i].events.length) return p.layers.splice(i, 1)[0];
      p.layers.splice(i, 1);
    }
    return null;
  }

  // Step grid view: is there a hit for this pad at integer step s.
  function gridHas(p, pad, s) {
    return allEvents(p).some((e) => e.pad === pad && Math.round(e.t) === s && Math.abs(e.t - s) < 0.5);
  }
  function gridToggle(p, pad, s) {
    if (gridHas(p, pad, s)) {
      for (const l of p.layers) l.events = l.events.filter((e) => !(e.pad === pad && Math.round(e.t) === s && Math.abs(e.t - s) < 0.5));
      p.layers = p.layers.filter((l) => l.events.length);
      return false;
    }
    let l = p.layers[p.layers.length - 1];
    if (!l || !/grid$/.test(l.id)) l = openLayer(p, 'grid');
    l.events.push({ t: s, pad, vel: 0.85 });
    return true;
  }

  // Melodic: scale degree index (0 = lowest pad) -> MIDI note in key/scale. Pads read bottom-left upward.
  function scaleSemis(Theory, scale) {
    const sc = Theory.SCALES[scale] || Theory.SCALES.minorPentatonic;
    return sc.intervals.map((i) => i.semis);
  }
  function degreeToMidi(semis, key, base, degree) {
    const n = semis.length;
    const oct = Math.floor(degree / n);
    return base + key + oct * 12 + semis[((degree % n) + n) % n];
  }

  // ---------- share codec ----------
  function b64urlEncode(bytes) {
    let s;
    if (typeof Buffer !== 'undefined' && !global.btoa) s = Buffer.from(bytes).toString('base64');
    else { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); s = global.btoa(bin); }
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad characters');
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof Buffer !== 'undefined' && !global.atob) return Uint8Array.from(Buffer.from(s, 'base64'));
    const bin = global.atob(s + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function encodeShare(p) {
    const b = [2]; // codec version
    b.push(clamp(Math.round(p.bpm) - 40, 0, 255), clamp(p.bars, 1, 8), Math.round(clamp(p.swing, 0, 0.5) * 200),
      [0, 8, 16, 24].indexOf(p.quant) & 3, Math.max(0, KIT_IDS.indexOf(p.kit)));
    for (const pd of p.pads) {
      b.push(clamp(Math.round((pd.vol + 30) * 4), 0, 255), clamp(Math.round(pd.pitch + 24), 0, 48),
        clamp(Math.round((pd.filter + 1) * 100), 0, 200), clamp(Math.round(pd.rev * 100), 0, 100));
    }
    const m = p.melodic;
    b.push(Math.max(0, INST_IDS.indexOf(m.inst)), clamp(m.key, 0, 11), Math.max(0, SCALE_IDS.indexOf(m.scale)), clamp((m.octave || 0) + 2, 0, 4));
    const evs = allEvents(p).slice().sort((x, y) => x.t - y.t).slice(0, 4000);
    b.push(evs.length >> 8, evs.length & 255);
    for (const e of evs) {
      const t = clamp(Math.round(e.t * TICKS), 0, 65535);
      const vel = clamp(Math.round(e.vel * 15), 1, 15);
      if (e.pad != null) {
        b.push(t >> 8, t & 255, e.pad & 15, vel);
      } else {
        b.push(t >> 8, t & 255, 16 + Math.max(0, INST_IDS.indexOf(e.inst)), vel, clamp(e.note, 0, 127), clamp(Math.round((e.dur || 1) * 8), 1, 255));
      }
    }
    return b64urlEncode(Uint8Array.from(b));
  }

  function decodeShare(code) {
    const b = b64urlDecode(String(code || ''));
    let i = 0;
    const need = (n) => { if (i + n > b.length) throw new Error('truncated'); };
    need(6);
    if (b[i++] !== 2) throw new Error('unknown version');
    const p = newPattern();
    p.bpm = clamp(b[i++] + 40, 40, 240);
    p.bars = clamp(b[i++], 1, 8);
    p.swing = clamp(b[i++] / 200, 0, 0.5);
    p.quant = [0, 8, 16, 24][b[i++] & 3];
    p.kit = KIT_IDS[b[i++]] || 'acoustic';
    need(64);
    for (let k = 0; k < 16; k++) {
      p.pads[k] = { vol: clamp(b[i++] / 4 - 30, -30, 12), pitch: clamp(b[i++] - 24, -24, 24), filter: clamp(b[i++] / 100 - 1, -1, 1), rev: clamp(b[i++] / 100, 0, 1) };
    }
    need(6);
    p.melodic = { inst: INST_IDS[b[i++]] || 'bass', key: clamp(b[i++], 0, 11), scale: SCALE_IDS[b[i++]] || 'minorPentatonic', octave: clamp(b[i++] - 2, -2, 2) };
    const n = (b[i++] << 8) | b[i++];
    const total = loopSteps(p);
    const layer = { id: 'L1-shared', events: [] };
    for (let k = 0; k < n; k++) {
      need(4);
      const t = ((b[i++] << 8) | b[i++]) / TICKS;
      const id = b[i++];
      const vel = clamp(b[i++], 1, 15) / 15;
      if (id < 16) {
        if (t < total) layer.events.push({ t, pad: id, vel: +vel.toFixed(4) });
      } else {
        need(2);
        const note = b[i++], dur = b[i++] / 8;
        if (t < total && id - 16 < INST_IDS.length) layer.events.push({ t, note, inst: INST_IDS[id - 16], vel: +vel.toFixed(4), dur });
      }
    }
    if (layer.events.length) p.layers.push(layer);
    return p;
  }

  // Validate a stored pattern, returning a clean copy or null.
  function sanitizePattern(x) {
    try { return decodeShare(encodeShare(x)); } catch (e) { return null; }
  }

  const Core = {
    KIT_IDS, INST_IDS, SCALE_IDS, KEY_NAMES, TICKS, clamp, newPattern, defaultPad, loopSteps, stepDur,
    swingOffsetSteps, swungStep, quantize, timeToStep, eventsInWindow, allEvents, addHit, openLayer, undoLayer,
    gridHas, gridToggle, scaleSemis, degreeToMidi, encodeShare, decodeShare, sanitizePattern, b64urlEncode, b64urlDecode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else global.BeatCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
