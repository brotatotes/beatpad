"""Chromium OfflineAudioContext render test and latency probe for Beat Pad.

Serves PRODUCT on a local port, loads tests/render-harness.html and renders patterns through the real
engine (decoded samples, per-pad chain, bus compressor, limiter, reverb). Checks onsets land at the
scheduled times, swing shifts odd sixteenths, chokes cut the open hat, nothing clips, and the WAV
encoder output is valid. Also records AudioContext baseLatency/outputLatency for several latency hints.

usage: python3 tests/render_test.py OUT_JSON
"""
import http.server, json, socketserver, sys, threading, functools, os, struct, io, wave
from playwright.sync_api import sync_playwright

PRODUCT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/beatpad-render.json'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

Handler = functools.partial(Quiet, directory=PRODUCT)
Handler.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'}
srv = socketserver.TCPServer(('127.0.0.1', 0), Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

JS = r"""
async ({}) => {
  const C = window.BeatCore, E = window.BeatEngine, LIB = window.SOUND_LIBRARY;
  const eng = E.createEngine({ library: LIB, baseUrl: '/', format: 'ogg' });
  const out = { kits: {} };
  function env(buf) {
    const a = buf.getChannelData(0), b = buf.getChannelData(1);
    let peak = 0, nan = 0, clip = 0;
    for (let i = 0; i < a.length; i++) {
      const m = Math.max(Math.abs(a[i]), Math.abs(b[i]));
      if (!(m === m)) nan++;
      if (m > peak) peak = m;
      if (m >= 1) clip++;
    }
    return { a, b, peak, nan, clip };
  }
  // onset = first sample after (when - 2ms) whose |x| exceeds max(-50 dBFS, 4x the level in the 10 ms before)
  function onset(e, sr, when) {
    const s0 = Math.floor((when - 0.012) * sr), s1 = Math.floor((when - 0.002) * sr);
    let pre = 0;
    for (let i = Math.max(0, s0); i < s1; i++) pre = Math.max(pre, Math.abs(e.a[i]), Math.abs(e.b[i]));
    const thr = Math.max(0.00316, pre * 4);
    const end = Math.floor((when + 0.05) * sr);
    for (let i = s1; i < end; i++) if (Math.max(Math.abs(e.a[i]), Math.abs(e.b[i])) > thr) return { t: i / sr, pre };
    return { t: null, pre };
  }
  for (const kit of C.KIT_IDS) {
    const p = C.newPattern({ bpm: 120, bars: 2, kit });
    const L = C.openLayer(p, 'test');
    // one pad per quarter note so every onset is isolated: kick, snare, closed hat, tom, clap ... (8 hits)
    const pads = [12, 8, 2, 4, 10, 13, 9, 5];
    pads.forEach((pad, k) => L.events.push({ t: k * 4, pad, vel: 0.9 }));
    const r = await eng.render(p, { loops: 1, tail: 1.5 });
    const e = env(r.buffer), sr = r.buffer.sampleRate;
    // exact onset: render again without event k; the first sample where the two renders differ is when k sounded
    const hits = [];
    for (let k = 0; k < L.events.length; k++) {
      const q = JSON.parse(JSON.stringify(p));
      q.layers[0].events.splice(k, 1);
      const r2 = await eng.render(q, { loops: 1, tail: 1.5 });
      const a2 = r2.buffer.getChannelData(0), b2 = r2.buffer.getChannelData(1);
      let first = null;
      for (let i = 0; i < a2.length; i++) if (Math.abs(e.a[i] - a2[i]) > 1e-5 || Math.abs(e.b[i] - b2[i]) > 1e-5) { first = i / sr; break; }
      const x = r.events[k];
      hits.push({ pad: x.pad, expected: +x.when.toFixed(4), onset: first == null ? null : +first.toFixed(4), errMs: first == null ? null : +((first - x.when) * 1000).toFixed(2) });
    }
    let leadPeak = 0; for (let i = 0; i < Math.floor(0.045 * sr); i++) leadPeak = Math.max(leadPeak, Math.abs(e.a[i]));
    out.kits[kit] = { events: hits.length, peak: +e.peak.toFixed(4), peakDbfs: +(20 * Math.log10(e.peak)).toFixed(2), clipped: e.clip, nan: e.nan, leadSilencePeak: leadPeak, hits, seconds: +r.buffer.duration.toFixed(3) };
  }
  // dense loud stress pattern: every pad on every step at full velocity, limiter must hold
  {
    const p = C.newPattern({ bpm: 140, bars: 1, kit: 'trap' });
    const L = C.openLayer(p, 'stress');
    for (let s = 0; s < 16; s++) for (const pad of [12, 13, 8, 10, 2, 14]) L.events.push({ t: s, pad, vel: 1 });
    p.pads.forEach((x) => { x.vol = 6; x.rev = 0.6; });
    const r = await eng.render(p, { loops: 2, tail: 1 });
    const e = env(r.buffer);
    out.stress = { events: r.events.length, peak: +e.peak.toFixed(4), peakDbfs: +(20 * Math.log10(e.peak)).toFixed(2), clipped: e.clip, nan: e.nan };
  }
  // swing: a hit on step 1 at swing 0.5 lands 1/3 step late; step 2 does not move
  {
    const res = {};
    for (const sw of [0, 0.5]) {
      const p = C.newPattern({ bpm: 120, bars: 1, kit: 'house', swing: sw });
      const L = C.openLayer(p, 'sw');
      L.events.push({ t: 1, pad: 12, vel: 1 }, { t: 6, pad: 12, vel: 1 });
      const r = await eng.render(p, { loops: 1, tail: 0.5 });
      const e = env(r.buffer), sr = r.buffer.sampleRate, sd = C.stepDur(120);
      const o1 = onset(e, sr, r.lead + 1 * sd + (sw ? sd / 3 : 0)).t, o2 = onset(e, sr, r.lead + 6 * sd).t;
      res['swing' + sw] = { step1: o1 == null ? null : +((o1 - r.lead) / sd).toFixed(3), step6: o2 == null ? null : +((o2 - r.lead) / sd).toFixed(3) };
    }
    out.swing = res;
  }
  // choke: open hat then closed hat 1 step later; open hat energy must be gone 30 ms after the closed hat
  {
    const mk = async (withClosed) => {
      const p = C.newPattern({ bpm: 120, bars: 1, kit: 'acoustic' });
      p.pads.forEach((x) => { x.rev = 0; });
      const L = C.openLayer(p, 'ch');
      L.events.push({ t: 0, pad: 1, vel: 1 });
      if (withClosed) L.events.push({ t: 4, pad: 2, vel: 0.3 });
      const r = await eng.render(p, { loops: 1, tail: 0.5 });
      const e = env(r.buffer), sr = r.buffer.sampleRate, sd = C.stepDur(120);
      const from = Math.floor((r.lead + 4 * sd + 0.25) * sr), to = Math.floor((r.lead + 4 * sd + 0.45) * sr);
      let rms = 0; for (let i = from; i < to; i++) rms += e.a[i] * e.a[i];
      return Math.sqrt(rms / (to - from));
    };
    const open = await mk(false), choked = await mk(true);
    out.choke = { openHatRmsLater: open, withClosedRmsLater: choked, reductionDb: +(20 * Math.log10(open / Math.max(choked, 1e-9))).toFixed(1) };
  }
  // melodic: bass and keys notes in A minor pentatonic render at their times
  {
    const p = C.newPattern({ bpm: 100, bars: 1, kit: 'lofi' });
    const L = C.openLayer(p, 'mel');
    const notes = [0, 2, 4, 1].map((d) => C.degreeToMidi(C.scaleSemis(window.Theory, 'minorPentatonic'), 9, 36, d));
    notes.forEach((n, k) => L.events.push({ t: k * 4, note: n, inst: k % 2 ? 'keys' : 'bass', vel: 0.85, dur: 3 }));
    const r = await eng.render(p, { loops: 1, tail: 1 });
    const e = env(r.buffer), sr = r.buffer.sampleRate;
    out.melodic = { notes, peakDbfs: +(20 * Math.log10(e.peak)).toFixed(2), clipped: e.clip, hits: r.events.map((x) => { const o = onset(e, sr, x.when).t; return { note: x.note, errMs: o == null ? null : +((o - x.when) * 1000).toFixed(2) }; }) };
  }
  // WAV encoder on a short render
  {
    const p = C.newPattern({ bpm: 120, bars: 1, kit: 'acoustic' });
    C.openLayer(p, 'w').events.push({ t: 0, pad: 12, vel: 1 }, { t: 4, pad: 8, vel: 1 });
    const r = await eng.render(p, { loops: 1, tail: 0.5 });
    const ab = E.encodeWav(r.buffer);
    const u8 = new Uint8Array(ab);
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    out.wav = { b64: btoa(s), frames: r.buffer.length, sampleRate: r.buffer.sampleRate };
  }
  // live context latency probe
  out.latency = {};
  for (const hint of ['interactive', 'balanced', 'playback', 0.005]) {
    const ctx = new AudioContext({ latencyHint: hint });
    await ctx.resume().catch(() => {});
    await new Promise((res) => setTimeout(res, 150));
    out.latency[String(hint)] = { sampleRate: ctx.sampleRate, baseLatencyMs: +(ctx.baseLatency * 1000).toFixed(2), outputLatencyMs: ctx.outputLatency == null ? null : +(ctx.outputLatency * 1000).toFixed(2), state: ctx.state };
    await ctx.close();
  }
  out.format = eng.format;
  return out;
}
"""

report = {'url': f'http://127.0.0.1:{port}/tests/render-harness.html'}
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page()
    errors, requests = [], []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: requests.append(r.url))
    pg.goto(report['url'])
    pg.wait_for_function('window.harnessReady === true', timeout=15000)
    res = pg.evaluate(JS, {})
    report['browser'] = b.version
    b.close()
srv.shutdown()

wav_b = __import__('base64').b64decode(res['wav'].pop('b64'))
with wave.open(io.BytesIO(wav_b)) as w:
    res['wav'].update(channels=w.getnchannels(), width=w.getsampwidth(), rate=w.getframerate(), nframes=w.getnframes(), bytes=len(wav_b))
report.update(res)
report['pageErrors'] = errors
report['offOriginRequests'] = [u for u in requests if not u.startswith(f'http://127.0.0.1:{port}/')]

checks = {}
for kit, k in res['kits'].items():
    errs = [h['errMs'] for h in k['hits']]
    checks[f'{kit}: 8 onsets within 0..3 ms of schedule'] = len(errs) == 8 and all(e is not None and -0.5 <= e <= 3 for e in errs)
    checks[f'{kit}: no clipping, peak below -0.5 dBFS'] = k['clipped'] == 0 and k['nan'] == 0 and k['peakDbfs'] < -0.5
    checks[f'{kit}: silent before first event'] = k['leadSilencePeak'] < 1e-4
s = res['stress']
checks['stress (96 full-velocity hits/bar, +6 dB pads): limiter holds below 0 dBFS'] = s['clipped'] == 0 and s['nan'] == 0 and s['peakDbfs'] < 0
checks['swing 0: step 1 at 1.00'] = res['swing']['swing0']['step1'] is not None and abs(res['swing']['swing0']['step1'] - 1) < 0.02
checks['swing 0.5: step 1 at 1.33, step 6 unmoved'] = res['swing']['swing0.5']['step1'] is not None and abs(res['swing']['swing0.5']['step1'] - 4 / 3) < 0.02 and abs(res['swing']['swing0.5']['step6'] - 6) < 0.02
checks['choke: closed hat cuts open hat by >= 20 dB'] = res['choke']['reductionDb'] >= 20
checks['melodic: 4 notes onset within 0..3 ms, no clip'] = all(h['errMs'] is not None and -0.5 <= h['errMs'] <= 3 for h in res['melodic']['hits']) and res['melodic']['clipped'] == 0
checks['wav: valid 16-bit stereo 48 kHz, frames match'] = res['wav']['channels'] == 2 and res['wav']['width'] == 2 and res['wav']['rate'] == 48000 and res['wav']['nframes'] == res['wav']['frames']
checks['no page errors'] = not errors
checks['no off-origin requests'] = not report['offOriginRequests']
report['checks'] = checks
report['passed'] = all(checks.values())
json.dump(report, open(OUT, 'w'), indent=1)
for k, v in checks.items():
    print(('PASS ' if v else 'FAIL ') + k)
print('latency', json.dumps(res['latency']))
print('PASSED' if report['passed'] else 'FAILED')
sys.exit(0 if report['passed'] else 1)
