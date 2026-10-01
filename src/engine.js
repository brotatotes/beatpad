/* Beat Pad sound engine. Web Audio voices, velocity layers, round-robin, choke groups, mix bus with
   room reverb, zero-latency soft limiter, metronome, lookahead transport and offline WAV rendering.
   Works with a live AudioContext or an OfflineAudioContext. Depends on BeatCore (core.js). */
(function (global) {
  'use strict';
  const Core = global.BeatCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const dbToAmp = (db) => Math.pow(10, db / 20);
  const MIN_VEL_AMP = dbToAmp(-36);
  const MAX_VOICES = 32;

  // Velocity 0..1 to amplitude, v^1.6 curve between -36 dB and 0 dB.
  function velAmp(v) {
    const x = Math.min(1, Math.max(0, v));
    return MIN_VEL_AMP + (1 - MIN_VEL_AMP) * Math.pow(x, 1.6);
  }

  // Deterministic room impulse: decaying, gently darkened stereo noise.
  function makeImpulse(ctx, seconds) {
    const sr = ctx.sampleRate, n = Math.floor(sr * (seconds || 1.1));
    const ir = ctx.createBuffer(2, n, sr);
    let seed = 0x9e3779b9;
    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const k = 0.25 + 0.6 * Math.min(1, t / (seconds || 1.1)); // darker as it decays
        lp += (rnd() - lp) * (1 - k);
        const early = t < 0.012 ? t / 0.012 : 1;
        d[i] = lp * Math.exp(-t * 5.2) * early;
      }
    }
    return ir;
  }

  // Soft limiter transfer curve over input [-range, range] mapped onto the WaveShaper domain [-1, 1].
  function limiterCurve(range, knee, ceil) {
    const n = 8193, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) * 2 - 1) * range, a = Math.abs(x);
      const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
      c[i] = Math.sign(x) * y;
    }
    return c;
  }

  // Mix bus. Returns { dry, send, click, out } input nodes.
  function buildBus(ctx) {
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = makeImpulse(ctx, 1.1);
    const ret = ctx.createGain(); ret.gain.value = dbToAmp(-14);
    const click = ctx.createGain(); click.gain.value = dbToAmp(-10);
    const master = ctx.createGain(); master.gain.value = 1;
    // Zero-lookahead soft limiter. Chromium's DynamicsCompressor adds a fixed 6 ms pre-delay per node
    // (measured 12 ms for glue + limiter), which is audible on finger drums, so the bus uses a
    // WaveShaper: linear to -6 dBFS, smooth tanh knee to a -0.6 dBFS ceiling, input range +-12 dBFS.
    const pre = ctx.createGain(); pre.gain.value = 0.25;
    const lim = ctx.createWaveShaper();
    lim.curve = limiterCurve(4, 0.5, 0.93);
    lim.oversample = 'none';
    const fin = ctx.createGain(); fin.gain.value = 1;
    send.connect(conv); conv.connect(ret);
    dry.connect(master); ret.connect(master);
    click.connect(master);
    master.connect(pre); pre.connect(lim); lim.connect(fin); fin.connect(ctx.destination);
    return { dry, send, click, master, lim, out: fin };
  }

  function pickFormat() {
    try {
      const a = typeof Audio !== 'undefined' ? new Audio() : null;
      if (a && a.canPlayType('audio/ogg; codecs="opus"')) return 'ogg';
    } catch (e) { /* ignore */ }
    return 'm4a';
  }

  function createEngine(opts) {
    const o = opts || {};
    const lib = o.library;
    const base = o.baseUrl || '';
    const fetchFn = o.fetch || ((u) => fetch(u));
    const decodeCtx = o.decodeContext || null; // any BaseAudioContext for decoding
    const buffers = new Map(); // sample id -> AudioBuffer
    const pending = new Map();
    let format = o.format || pickFormat();

    async function decodeId(ctx, id) {
      if (buffers.has(id)) return buffers.get(id);
      if (pending.has(id)) return pending.get(id);
      const p = (async () => {
        const tryFmt = async (fmt) => {
          const r = await fetchFn(base + 'samples/' + id + '.' + fmt);
          if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + id);
          const ab = await r.arrayBuffer();
          return await ctx.decodeAudioData(ab);
        };
        let buf;
        try { buf = await tryFmt(format); }
        catch (e) {
          const alt = format === 'ogg' ? 'm4a' : 'ogg';
          buf = await tryFmt(alt);
          format = alt; // this browser decodes the other format
        }
        buffers.set(id, buf);
        pending.delete(id);
        return buf;
      })();
      pending.set(id, p);
      return p;
    }

    function idsForKit(kitId) {
      const kit = lib.kits[kitId];
      const ids = [];
      kit.pads.forEach((pad) => pad.layers.forEach((l) => l.forEach((id) => ids.push(id))));
      return ids;
    }
    function idsForInst(instId) {
      const ids = [];
      lib.instruments[instId].zones.forEach((z) => z.layers.forEach((l) => l.forEach((id) => ids.push(id))));
      return ids;
    }
    async function loadIds(ctx, ids, onProgress) {
      let done = 0;
      await Promise.all(ids.map((id) => decodeId(ctx, id).then((b) => { done++; if (onProgress) onProgress(done, ids.length); return b; })));
    }
    const kitLoaded = (k) => idsForKit(k).every((id) => buffers.has(id));
    const instLoaded = (k) => idsForInst(k).every((id) => buffers.has(id));

    // ---- a player bound to one context and bus (live or offline) ----
    function createPlayer(ctx, bus) {
      const live = []; // { src, gain, group, end }
      const rr = new Map();
      const custom = o.customPads || {}; // pad index -> AudioBuffer (mic samples), shared by reference

      function chooseTake(key, takes) {
        if (takes.length === 1) return takes[0];
        const last = rr.has(key) ? rr.get(key) : -1;
        const next = (last + 1) % takes.length;
        rr.set(key, next);
        return takes[next];
      }
      function stopVoice(v, when, fade) {
        const t = Math.max(when, ctx.currentTime);
        try {
          v.gain.gain.cancelScheduledValues(t);
          v.gain.gain.setValueAtTime(v.gain.gain.value, t);
          v.gain.gain.linearRampToValueAtTime(0, t + fade);
          v.src.stop(t + fade + 0.005);
        } catch (e) { /* already stopped */ }
        v.end = Math.min(v.end, t + fade);
      }
      function prune() {
        const now = ctx.currentTime;
        for (let i = live.length - 1; i >= 0; i--) if (live[i].end < now - 0.05) live.splice(i, 1);
      }

      // Start a buffer through per-pad processing. params: { vol dB, pitch semis, filter -1..1, rev 0..1 }
      function voice(buf, when, amp, params, group, rate, dur) {
        prune();
        const p = params || {};
        const t = Math.max(when, ctx.currentTime);
        if (group) live.filter((v) => v.group === group && v.end > t).forEach((v) => stopVoice(v, t, 0.008));
        if (live.length >= MAX_VOICES) { live.sort((a, b) => a.start - b.start); stopVoice(live.shift(), t, 0.01); }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const r = (rate || 1) * Math.pow(2, (p.pitch || 0) / 12);
        src.playbackRate.value = r;
        const g = ctx.createGain();
        g.gain.value = amp * dbToAmp(p.vol || 0);
        let node = src;
        const f = p.filter || 0;
        if (Math.abs(f) > 0.01) {
          const bq = ctx.createBiquadFilter();
          if (f < 0) { bq.type = 'lowpass'; bq.frequency.value = 18000 * Math.pow(2, f * 7.5); }
          else { bq.type = 'highpass'; bq.frequency.value = 30 * Math.pow(2, f * 6.5); }
          bq.Q.value = 0.8;
          node.connect(bq); node = bq;
        }
        node.connect(g);
        g.connect(bus.dry);
        const rev = p.rev == null ? 0.12 : p.rev;
        if (rev > 0.001) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(bus.send); }
        src.start(t);
        let end = t + buf.duration / r;
        if (dur) { // melodic note: release over 120 ms after the held length
          const off = t + dur;
          g.gain.setValueAtTime(g.gain.value, off);
          g.gain.linearRampToValueAtTime(0, off + 0.12);
          src.stop(off + 0.13);
          end = Math.min(end, off + 0.13);
        }
        const v = { src, gain: g, group, start: t, end };
        live.push(v);
        return v;
      }

      function trigger(kitId, padIndex, vel, when, params) {
        const v = vel == null ? 1 : vel;
        if (custom[padIndex]) return voice(custom[padIndex], when, velAmp(v), params, null, 1);
        const pad = lib.kits[kitId].pads[padIndex];
        const li = Math.min(pad.layers.length - 1, Math.floor(v * pad.layers.length - 1e-6));
        const take = chooseTake(kitId + ':' + padIndex + ':' + li, pad.layers[li]);
        const buf = buffers.get(take);
        if (!buf) return null;
        // layers already carry the loudness difference, so soften the velocity curve when there are several
        const amp = pad.layers.length > 1 ? Math.pow(velAmp(v), 0.6) : velAmp(v);
        return voice(buf, when, amp * dbToAmp(pad.gain || 0), params, pad.choke ? kitId + ':' + pad.choke : null, 1);
      }

      function note(instId, midi, vel, when, durSec, params) {
        const inst = lib.instruments[instId];
        let zone = inst.zones[0];
        for (const z of inst.zones) if (Math.abs(z.root - midi) < Math.abs(zone.root - midi)) zone = z;
        const v = vel == null ? 0.85 : vel;
        const li = Math.min(zone.layers.length - 1, Math.floor(v * zone.layers.length - 1e-6));
        const buf = buffers.get(chooseTake(instId + ':' + zone.root + ':' + li, zone.layers[li]));
        if (!buf) return null;
        const amp = (zone.layers.length > 1 ? Math.pow(velAmp(v), 0.6) : velAmp(v)) * dbToAmp(inst.gain || -4);
        return voice(buf, when, amp, params || { rev: 0.18 }, null, Math.pow(2, (midi - zone.root) / 12), durSec || 0.5);
      }

      function click(when, accent) {
        const t = Math.max(when, ctx.currentTime);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = accent ? 1760 : 1320;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.045);
        osc.connect(g); g.connect(bus.click);
        osc.start(t); osc.stop(t + 0.05);
      }

      function stopAll() { live.slice().forEach((v) => stopVoice(v, ctx.currentTime, 0.02)); live.length = 0; }

      // Play one scheduled pattern event.
      function playEvent(pattern, e, when) {
        const sd = Core.stepDur(pattern.bpm);
        if (e.pad != null) return trigger(pattern.kit, e.pad, e.vel, when, pattern.pads[e.pad]);
        if (e.note != null) return note(e.inst, e.note, e.vel, when, Math.max(0.08, (e.dur || 1) * sd));
        return null;
      }
      return { ctx, bus, trigger, note, click, stopAll, playEvent, live };
    }

    // ---- lookahead transport on the audio clock ----
    function createTransport(player, getPattern, hooks) {
      const ctx = player.ctx;
      const h = hooks || {};
      const LOOKAHEAD = 0.12, TICK = 0.025;
      let timer = null, origin = 0, scheduledTo = 0, running = false, countInEnd = 0;
      const st = { metronome: false };

      function tick() {
        if (!running) return;
        const p = getPattern();
        const total = Core.loopSteps(p);
        const sd = Core.stepDur(p.bpm);
        const to = ctx.currentTime + LOOKAHEAD;
        const from = scheduledTo;
        if (to <= from) return;
        // count-in clicks and metronome on quarter notes
        const qStart = Math.ceil((from - countInEnd) / (4 * sd) - 1e-9);
        for (let q = qStart; ; q++) {
          const when = countInEnd + q * 4 * sd;
          if (when >= to) break;
          if (when < from) continue;
          const inCount = when < countInEnd - 1e-9;
          if (inCount || st.metronome) player.click(when, ((q % 4) + 4) % 4 === 0);
          if (h.onBeat) h.onBeat(when, q, inCount);
        }
        if (to > origin) {
          const evs = Core.eventsInWindow(Core.allEvents(p), { origin, bpm: p.bpm, total, swing: p.swing }, Math.max(from, origin), to);
          for (const x of evs) { player.playEvent(p, x.e, x.when); if (h.onEvent) h.onEvent(x.e, x.when); }
        }
        scheduledTo = to;
      }
      function start(opt) {
        const p = getPattern();
        const sd = Core.stepDur(p.bpm);
        const countBars = (opt && opt.countIn) || 0;
        const t0 = ctx.currentTime + 0.06;
        countInEnd = t0 + countBars * 16 * sd;
        origin = countInEnd;
        scheduledTo = t0;
        running = true;
        tick();
        if (!timer) timer = setInterval(tick, TICK * 1000);
        return { origin, countInEnd };
      }
      function stop() {
        running = false;
        if (timer) { clearInterval(timer); timer = null; }
        player.stopAll();
      }
      // Keep the loop phase when tempo changes: re-anchor the origin to the current position.
      function retime(oldBpm, newBpm, total) {
        if (!running) return;
        const now = ctx.currentTime;
        const pos = Core.timeToStep(now, origin, oldBpm, total, 0);
        origin = now - pos * Core.stepDur(newBpm);
        countInEnd = Math.min(countInEnd, origin);
        scheduledTo = now;
      }
      const position = (latency) => {
        const p = getPattern();
        return Core.timeToStep(ctx.currentTime, origin, p.bpm, Core.loopSteps(p), latency || 0);
      };
      return { start, stop, tick, retime, position, state: st, get running() { return running; }, get origin() { return origin; }, get countInEnd() { return countInEnd; } };
    }

    // ---- offline render to an AudioBuffer ----
    async function render(pattern, ropts) {
      const r = ropts || {};
      const sr = r.sampleRate || 48000;
      const loops = r.loops || 1;
      const sd = Core.stepDur(pattern.bpm);
      const total = Core.loopSteps(pattern);
      const lead = r.lead == null ? 0.05 : r.lead;
      const seconds = lead + loops * total * sd + (r.tail == null ? 2 : r.tail);
      const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      const octx = new OAC(2, Math.ceil(seconds * sr), sr);
      await loadIds(octx, idsForKit(pattern.kit));
      const usedInst = new Set(Core.allEvents(pattern).filter((e) => e.inst).map((e) => e.inst));
      for (const i of usedInst) await loadIds(octx, idsForInst(i));
      const bus = buildBus(octx);
      const player = createPlayer(octx, bus);
      const evs = Core.eventsInWindow(Core.allEvents(pattern), { origin: lead, bpm: pattern.bpm, total, swing: pattern.swing }, 0, lead + loops * total * sd);
      for (const x of evs) player.playEvent(pattern, x.e, x.when);
      const buf = await octx.startRendering();
      return { buffer: buf, events: evs.map((x) => ({ when: x.when, pad: x.e.pad, note: x.e.note })), lead };
    }

    return {
      get format() { return format; },
      buffers,
      loadKit: (ctx, kitId, onProgress) => loadIds(ctx, idsForKit(kitId), onProgress),
      loadInstrument: (ctx, instId, onProgress) => loadIds(ctx, idsForInst(instId), onProgress),
      kitLoaded, instLoaded, createPlayer, createTransport, render, buildBus,
      customPads: (o.customPads = o.customPads || {}),
    };
  }

  // 16-bit PCM WAV with TPDF dither.
  function encodeWav(buf) {
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length, sr = buf.sampleRate;
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    const bytes = 44 + n * ch * 2;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    let off = 44, seed = 22222;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        let s = data[c][i] * 32767 + (rnd() - rnd());
        s = Math.max(-32768, Math.min(32767, Math.round(s)));
        v.setInt16(off, s, true); off += 2;
      }
    }
    return ab;
  }

  const BeatEngine = { createEngine, buildBus, limiterCurve, makeImpulse, velAmp, encodeWav, dbToAmp, MAX_VOICES };
  if (typeof module !== 'undefined' && module.exports) module.exports = BeatEngine;
  else global.BeatEngine = BeatEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
