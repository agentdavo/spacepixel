import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputPlayer, InputRecorder, ReplayCursor, ReplayTake, copyControls, fromBase64, parseReplay, quantizeControls, toBase64, timecode, REPLAY_VERSION } from '../src/sim/Replay.ts';
import { Rng } from '../src/sim/Rng.ts';
import type { ControlState } from '../src/core/Input.ts';

const blank = (): ControlState => ({ pitch: 0, yaw: 0, roll: 0, throttleDelta: 0, throttleSet: null, afterburner: false, flightAssistToggle: false, fire: false });

/** Keyboard-ish and mouse-ish segments with edges, quantised like the live path. */
function stream(n: number, seed = 3): ControlState[] {
  const r = new Rng(seed);
  const out: ControlState[] = [];
  let hold = 0;
  let cur = blank();
  for (let i = 0; i < n; i++) {
    if (hold-- <= 0) {
      hold = r.int(90);
      cur = blank();
      cur.pitch = r.next() < 0.5 ? r.range(-1, 1) : r.int(3) - 1;
      cur.yaw = r.range(-1.2, 1.2);
      cur.roll = r.int(3) - 1;
      cur.throttleDelta = r.next() < 0.1 ? 1 : 0;
      cur.fire = r.next() < 0.4;
      cur.afterburner = r.next() < 0.1;
    }
    const c = copyControls(cur, blank());
    if (r.next() < 0.3) c.yaw += r.range(-0.05, 0.05); // mouse jitter: changes every tick
    c.throttleSet = r.next() < 0.01 ? r.next() : null;
    c.missile = r.next() < 0.01;
    c.nextTarget = r.next() < 0.005;
    c.flightAssistToggle = r.next() < 0.002;
    c.cycleGun = r.next() < 0.002;
    c.cycleMissile = r.next() < 0.002;
    c.cycleSub = r.next() < 0.002;
    c.cruise = r.next() < 0.001;
    out.push(quantizeControls(c));
  }
  return out;
}

test('input stream round-trips bit-exactly (quantised controls)', () => {
  const src = stream(20_000);
  const rec = new InputRecorder();
  for (const c of src) rec.push(c);
  const bytes = fromBase64(toBase64(rec.bytes()));
  const p = new InputPlayer(bytes, rec.ticks);
  const got = blank();
  for (let i = 0; i < src.length; i++) {
    assert.ok(p.next(got), `tick ${i}`);
    const want = src[i];
    for (const k of ['pitch', 'yaw', 'roll', 'throttleDelta', 'throttleSet'] as const) assert.equal(got[k], want[k], `tick ${i} ${k}`);
    for (const k of ['afterburner', 'flightAssistToggle', 'fire', 'missile', 'nextTarget', 'cruise', 'cycleGun', 'cycleMissile', 'cycleSub'] as const) assert.equal(!!got[k], !!want[k], `tick ${i} ${k}`);
  }
  assert.equal(p.next(got), false);
  assert.ok(p.done);
});

test('idle stretches cost almost nothing (run-length)', () => {
  const rec = new InputRecorder();
  const c = quantizeControls({ ...blank(), pitch: 0.5, throttleSet: 0.7 });
  for (let i = 0; i < 60 * 60 * 10; i++) rec.push(c); // ten minutes holding one input
  assert.ok(rec.bytes().length < 16, `${rec.bytes().length} bytes`);
  const p = new InputPlayer(rec.bytes(), rec.ticks);
  const got = blank();
  let n = 0;
  while (p.next(got)) {
    n++;
    assert.equal(got.pitch, c.pitch);
  }
  assert.equal(n, 36_000);
});

test('bytes() mid-take does not disturb the recording', () => {
  const src = stream(3000, 9);
  const rec = new InputRecorder();
  src.forEach((c, i) => {
    rec.push(c);
    if (i % 97 === 0) rec.bytes();
  });
  const ref = new InputRecorder();
  for (const c of src) ref.push(c);
  assert.deepEqual([...rec.bytes()], [...ref.bytes()]);
});

test('take → file → cursor: commands due in tick order, checkpoints verify', () => {
  const take = new ReplayTake({ v: REPLAY_VERSION, game: 'vanguard', hz: 60, seed: 1, scene: 'test', boot: '', storage: {}, created: '' });
  const src = stream(600);
  src.forEach((c, i) => {
    if (i === 10) take.command('key', 'Digit2');
    if (i === 10) take.command('ledger', { credits: 5 });
    if (i === 300) take.command('launch');
    take.input.push(c);
    if ((i + 1) % 60 === 0) take.checks.push([i + 1, i * 7]);
  });
  const file = parseReplay(JSON.stringify(take.file({ from: 120 })));
  assert.equal(file.view?.from, 120);
  const cur = new ReplayCursor(file);
  const got = blank();
  const seen: string[] = [];
  for (let i = 0; i < 600; i++) {
    for (const c of cur.due()) seen.push(`${i}:${c.c}`);
    cur.next(got);
    if ((i + 1) % 60 === 0) assert.equal(cur.verify(i + 1, i * 7), true);
    else assert.equal(cur.verify(i + 1, 0), null);
  }
  assert.deepEqual(seen, ['10:key', '10:ledger', '300:launch']);
  assert.throws(() => parseReplay('{"header":{"game":"other"}}'));
});

test('base64 round trip, all lengths', () => {
  for (let n = 0; n < 40; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
    assert.deepEqual([...fromBase64(toBase64(b))], [...b]);
  }
  assert.equal(timecode(61.5), '01:01:12');
});
