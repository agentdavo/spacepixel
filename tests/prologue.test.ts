import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROLOGUE, SIGNAL_PULSES } from '../src/cinema/prologue.ts';
import { captionsAt, crossed, locate, makePose, moveAt, sampleFx, sampleMove, sampleTrack, totalDuration, typed, type Shot } from '../src/cinema/timeline.ts';

const SETS = new Set(['void', 'gate', 'graveyard', 'lantern', 'treaty', 'launch', 'null']);
const EPS = 1e-6;

test('prologue runs about a minute, nine-ish shots, ending on the title card', () => {
  const d = totalDuration(PROLOGUE);
  assert.ok(d >= 55 && d <= 65, `duration ${d}`);
  assert.ok(PROLOGUE.length >= 8 && PROLOGUE.length <= 10);
  assert.equal(PROLOGUE[PROLOGUE.length - 1].id, 'title');
  assert.ok(PROLOGUE[PROLOGUE.length - 1].captions?.some((c) => c.kind === 'title'));
  assert.equal(new Set(PROLOGUE.map((s) => s.id)).size, PROLOGUE.length, 'shot ids are unique');
});

test('every shot uses a known set and its camera moves tile the shot', () => {
  for (const s of PROLOGUE) {
    assert.ok(SETS.has(s.set), `${s.id}: unknown set ${s.set}`);
    assert.ok(s.cams.length > 0, `${s.id}: no camera`);
    assert.equal(s.cams[0].at, 0, `${s.id}: first move starts at 0`);
    for (let i = 1; i < s.cams.length; i++) {
      const p = s.cams[i - 1];
      assert.ok(Math.abs(p.at + p.dur - s.cams[i].at) < EPS, `${s.id}: gap/overlap before move ${i}`);
    }
    const last = s.cams[s.cams.length - 1];
    assert.ok(Math.abs(last.at + last.dur - s.dur) < EPS, `${s.id}: moves end at ${last.at + last.dur}, shot at ${s.dur}`);
    for (const m of s.cams) assert.ok(!(m.rig && m.aim), `${s.id}: a move is either a rig or an aim`);
  }
});

test('captions, cues and envelopes stay inside their shot', () => {
  for (const s of PROLOGUE) {
    for (const c of s.captions ?? []) assert.ok(c.at >= 0 && c.at + c.dur <= s.dur + EPS, `${s.id}: caption "${c.text}" overruns`);
    for (const e of [...(s.events ?? []), ...(s.sound ?? []), ...(s.music ?? [])]) assert.ok(e.at >= 0 && e.at <= s.dur, `${s.id}: cue at ${e.at}`);
    for (const tr of s.fx ?? []) {
      for (let i = 1; i < tr.keys.length; i++) assert.ok(tr.keys[i][0] >= tr.keys[i - 1][0], `${s.id}: ${tr.field} keys out of order`);
      if (tr.field !== 'hue') for (const [, v] of tr.keys) assert.ok(v >= 0 && v <= 1, `${s.id}: ${tr.field} value ${v}`);
    }
  }
});

test('narration is readable: one subtitle at a time, at a sane reading speed', () => {
  for (const s of PROLOGUE) {
    const subs = (s.captions ?? []).filter((c) => (c.kind ?? 'narration') === 'narration');
    for (const c of subs) assert.ok(c.text.length / c.dur <= 26, `${s.id}: "${c.text}" is ${(c.text.length / c.dur).toFixed(1)} chars/s`);
    for (let t = 0; t < s.dur; t += 0.05) {
      const live = captionsAt(s, t).filter((x) => (x.caption.kind ?? 'narration') === 'narration');
      assert.ok(live.length <= 1, `${s.id}: ${live.length} subtitles at ${t.toFixed(2)}s`);
    }
  }
});

test('no shot is left blown out: flash never holds at full for long', () => {
  for (const s of PROLOGUE) {
    let hot = 0;
    for (let t = 0; t < s.dur; t += 1 / 60) {
      const fx = sampleFx(s, t);
      hot = fx.flash > 0.9 ? hot + 1 / 60 : 0;
      assert.ok(hot < 0.4, `${s.id}: white-out held ${hot.toFixed(2)}s at ${t.toFixed(2)}`);
    }
    // Every shot but the first and last is fully graded in by its midpoint.
    if (s.id !== 'cold-open' && s.id !== 'title') assert.ok(sampleFx(s, s.dur / 2).fade < 0.5, `${s.id}: faded at midpoint`);
  }
});

test('the Signal counts down primes, one per pulse', () => {
  const sig = PROLOGUE.find((s) => s.id === 'signal')!;
  const counts = (sig.captions ?? []).filter((c) => c.kind === 'count');
  assert.equal(counts.length, SIGNAL_PULSES.length);
  const n = counts.map((c) => Number(c.text.replace(/,/g, '')));
  const isPrime = (k: number) => k > 1 && [...Array(Math.floor(Math.sqrt(k)) - 1)].every((_, i) => k % (i + 2) !== 0);
  for (let i = 0; i < n.length; i++) {
    assert.ok(isPrime(n[i]), `${n[i]} is prime`);
    if (i) {
      assert.ok(n[i] < n[i - 1]);
      for (let k = n[i] + 1; k < n[i - 1]; k++) assert.ok(!isPrime(k), `skipped prime ${k}`);
    }
  }
});

test('timeline sampling: locate, moves, envelopes, crossings, typewriter', () => {
  const shots: Shot[] = [
    { id: 'a', set: 'void', dur: 2, cams: [{ at: 0, dur: 2, from: { eye: [0, 0, 0], look: [0, 0, -1], fov: 40 }, to: { eye: [10, 0, 0], look: [0, 0, -1], fov: 60 }, ease: 'linear' }] },
    {
      id: 'b',
      set: 'void',
      dur: 3,
      cams: [
        { at: 0, dur: 1, from: { eye: [1, 1, 1], look: [0, 0, 0] } },
        { at: 1, dur: 2, from: { eye: [2, 2, 2], look: [0, 0, 0] } },
      ],
      fx: [{ field: 'flash', keys: [[1, 0], [2, 1]] }],
    },
  ];
  assert.deepEqual(locate(shots, 0), { index: 0, start: 0, local: 0 });
  assert.deepEqual(locate(shots, 2.5), { index: 1, start: 2, local: 0.5 });
  assert.deepEqual(locate(shots, 99), { index: 1, start: 2, local: 3 });
  const p = sampleMove(moveAt(shots[0], 1), 1, makePose());
  assert.equal(p.eye.x, 5);
  assert.equal(p.fov, 50);
  assert.equal(moveAt(shots[1], 1.5).from.eye[0], 2);
  assert.equal(sampleTrack(shots[1].fx![0].keys, 1.5), 0.5);
  assert.equal(sampleFx(shots[1], 3).flash, 1);
  assert.ok(crossed(0, -Infinity, 0));
  assert.ok(!crossed(1, 1, 2));
  assert.ok(crossed(2, 1, 2));
  assert.equal(typed('hello', 0.05, 40), 2);
  assert.equal(typed('hello', 10, 40), 5);
});
