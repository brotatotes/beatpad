// Node unit tests for Beat Pad core logic. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const T = require('../src/theory.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('step duration and loop length', () => {
  close(C.stepDur(120), 0.125);
  assert.equal(C.loopSteps(C.newPattern({ bars: 2 })), 32);
});

test('quantize to 1/16, 1/8, triplets and off, wrapping into the loop', () => {
  close(C.quantize(3.4, 16, 32), 3);
  close(C.quantize(3.6, 16, 32), 4);
  close(C.quantize(2.9, 8, 32), 2);
  close(C.quantize(3.1, 8, 32), 4);
  close(C.quantize(0.7, 24, 32), 2 / 3);
  close(C.quantize(31.8, 16, 32), 0); // wraps to start
  close(C.quantize(5.013, 0, 32), Math.round(5.013 * 24) / 24);
});

test('swing moves only odd sixteenths, by up to a third of a step', () => {
  close(C.swungStep(0, 0.5), 0);
  close(C.swungStep(2, 0.5), 2);
  close(C.swungStep(1, 0.5), 1 + 1 / 3);
  close(C.swungStep(3, 0.25), 3 + 1 / 6);
  close(C.swungStep(1.5, 0.5), 1.5); // off-grid hits are left alone
  close(C.swungStep(1, 0), 1);
});

test('lookahead window returns each event once per loop at audio-clock times', () => {
  const events = [{ t: 0, pad: 0 }, { t: 4, pad: 1 }, { t: 1, pad: 2 }];
  const opts = { origin: 10, bpm: 120, total: 16, swing: 0 };
  // loop is 2 s long. Collect over 0..6 s in 25 ms ticks with 100 ms lookahead, like the real scheduler
  const seen = [];
  let scheduledUntil = 0;
  for (let now = 0; now < 15.9; now += 0.025) {
    const to = now + 0.1;
    for (const x of C.eventsInWindow(events, opts, Math.max(scheduledUntil, 10), to)) seen.push(x);
    scheduledUntil = Math.max(scheduledUntil, to);
  }
  const whens = seen.map((x) => +x.when.toFixed(4));
  assert.deepEqual(whens, [10, 10.125, 10.5, 12, 12.125, 12.5, 14, 14.125, 14.5].filter((w) => w < 16));
  assert.equal(new Set(whens).size, whens.length, 'no duplicates');
});

test('lookahead applies swing', () => {
  const r = C.eventsInWindow([{ t: 1, pad: 0 }], { origin: 0, bpm: 120, total: 16, swing: 0.5 }, 0, 1);
  close(r[0].when, 0.125 * (1 + 1 / 3));
});

test('timeToStep compensates latency and wraps', () => {
  close(C.timeToStep(10.5, 10, 120, 16, 0), 4);
  close(C.timeToStep(10.55, 10, 120, 16, 0.05), 4);
  close(C.timeToStep(12.25, 10, 120, 16, 0), 2);
});

test('pattern layers: overdub, duplicate replacement, undo', () => {
  const p = C.newPattern();
  const l1 = C.openLayer(p);
  C.addHit(p, l1, { t: 0, pad: 12, vel: 1 });
  C.addHit(p, l1, { t: 4, pad: 4, vel: 1 });
  const l2 = C.openLayer(p);
  C.addHit(p, l2, { t: 0.1, pad: 12, vel: 0.5 }); // replaces the kick at 0
  C.addHit(p, l2, { t: 2, pad: 2, vel: 0.7 });
  assert.equal(C.allEvents(p).length, 3);
  assert.equal(C.allEvents(p).filter((e) => e.pad === 12).length, 1);
  const undone = C.undoLayer(p);
  assert.equal(undone, l2);
  assert.equal(C.allEvents(p).length, 1);
  C.openLayer(p); // empty layer is skipped by undo
  assert.equal(C.undoLayer(p), l1);
  assert.equal(C.undoLayer(p), null);
});

test('step grid toggles and reflects recorded hits', () => {
  const p = C.newPattern();
  const l = C.openLayer(p);
  C.addHit(p, l, { t: 4.04, pad: 3, vel: 1 });
  assert.ok(C.gridHas(p, 3, 4));
  assert.equal(C.gridToggle(p, 3, 4), false);
  assert.ok(!C.gridHas(p, 3, 4));
  assert.equal(C.gridToggle(p, 5, 7), true);
  assert.ok(C.gridHas(p, 5, 7));
  assert.match(p.layers[p.layers.length - 1].id, /grid$/);
});

test('melodic mapping stays in key and scale using Chord Explorer theory', () => {
  const semis = C.scaleSemis(T, 'minorPentatonic');
  assert.deepEqual(semis, [0, 3, 5, 7, 10]);
  const notes = Array.from({ length: 16 }, (_, d) => C.degreeToMidi(semis, 9, 36, d));
  assert.equal(notes[0], 45); // A2
  for (const n of notes) assert.ok(semis.includes(((n - 45) % 12 + 12) % 12));
  assert.ok(notes.every((n, i) => i === 0 || n > notes[i - 1]));
  const major = C.scaleSemis(T, 'major');
  assert.deepEqual(major, [0, 2, 4, 5, 7, 9, 11]);
});

test('share link round trip keeps settings and events', () => {
  const p = C.newPattern({ bpm: 97, bars: 2, swing: 0.21, quant: 24, kit: 'lofi' });
  p.pads[3] = { vol: -6.5, pitch: -3, filter: -0.4, rev: 0.33 };
  p.melodic = { inst: 'keys', key: 2, scale: 'dorian', octave: 1 };
  const l = C.openLayer(p);
  for (let s = 0; s < 32; s += 2) C.addHit(p, l, { t: s, pad: s % 16, vel: 0.8 });
  C.addHit(p, l, { t: 5 + 1 / 3, pad: 7, vel: 0.4 });
  C.addHit(p, l, { t: 6, note: 50, inst: 'keys', vel: 0.6, dur: 1.5 });
  const code = C.encodeShare(p);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const q = C.decodeShare(code);
  assert.equal(q.bpm, 97); assert.equal(q.bars, 2); close(q.swing, 0.21, 0.006); assert.equal(q.quant, 24); assert.equal(q.kit, 'lofi');
  close(q.pads[3].vol, -6.5, 0.13); assert.equal(q.pads[3].pitch, -3); close(q.pads[3].filter, -0.4, 0.006); close(q.pads[3].rev, 0.33, 0.006);
  assert.deepEqual(q.melodic, { inst: 'keys', key: 2, scale: 'dorian', octave: 1 });
  const a = C.allEvents(p).map((e) => [+e.t.toFixed(3), e.pad ?? e.note]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const b = C.allEvents(q).map((e) => [+e.t.toFixed(3), e.pad ?? e.note]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  assert.deepEqual(b, a);
  const kn = C.allEvents(q).find((e) => e.note === 50);
  assert.equal(kn.inst, 'keys'); close(kn.dur, 1.5);
});

test('a 2-bar beat with 60 hits makes a short link', () => {
  const p = C.newPattern();
  const l = C.openLayer(p);
  for (let i = 0; i < 60; i++) C.addHit(p, l, { t: (i * 7) % 32 + (i % 3) * 0.01, pad: i % 16, vel: 0.9 });
  const code = C.encodeShare(p);
  assert.ok(code.length < 420, 'code length ' + code.length);
});

test('malformed share codes are rejected cleanly', () => {
  assert.throws(() => C.decodeShare('!!!'));
  assert.throws(() => C.decodeShare(''));
  assert.throws(() => C.decodeShare('AQID'));
  const good = C.encodeShare(C.newPattern());
  assert.throws(() => C.decodeShare(good.slice(0, 20)));
  assert.equal(C.sanitizePattern({}), null);
});
