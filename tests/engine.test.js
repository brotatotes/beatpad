// Node tests for pure engine helpers: velocity curve, limiter curve and WAV encoding.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

test('velocity curve is monotone from -36 dB to 0 dB', () => {
  assert.ok(Math.abs(20 * Math.log10(E.velAmp(0)) + 36) < 0.01);
  assert.strictEqual(E.velAmp(1), 1);
  let prev = 0;
  for (let v = 0; v <= 1.0001; v += 0.05) { const a = E.velAmp(v); assert.ok(a >= prev); prev = a; }
});

test('limiter curve is linear below the knee and never exceeds the ceiling', () => {
  const c = E.limiterCurve(4, 0.5, 0.93);
  const n = c.length;
  const at = (x) => c[Math.round(((x / 4) + 1) / 2 * (n - 1))];
  assert.ok(Math.abs(at(0.25) - 0.25) < 1e-3);
  assert.ok(Math.abs(at(-0.4) + 0.4) < 1e-3);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(c[i]) <= 0.93 + 1e-6);
  for (let i = 1; i < n; i++) assert.ok(c[i] >= c[i - 1]);
  assert.ok(at(4) > 0.92);
});

test('WAV encoder writes a valid 16-bit PCM header and clamps samples', () => {
  const frames = 480;
  const ch = [new Float32Array(frames), new Float32Array(frames)];
  ch[0][0] = 2; ch[1][0] = -2; ch[0][1] = 0.5;
  const buf = { numberOfChannels: 2, length: frames, sampleRate: 48000, getChannelData: (c) => ch[c] };
  const ab = E.encodeWav(buf);
  const v = new DataView(ab);
  const str = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.strictEqual(str(0), 'RIFF');
  assert.strictEqual(str(8), 'WAVE');
  assert.strictEqual(v.getUint16(22, true), 2);
  assert.strictEqual(v.getUint32(24, true), 48000);
  assert.strictEqual(v.getUint16(34, true), 16);
  assert.strictEqual(v.getUint32(40, true), frames * 4);
  assert.strictEqual(ab.byteLength, 44 + frames * 4);
  assert.strictEqual(v.getInt16(44, true), 32767);
  assert.strictEqual(v.getInt16(46, true), -32768);
  assert.ok(Math.abs(v.getInt16(48, true) - 16384) <= 2);
});
