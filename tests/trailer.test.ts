import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT, TRAILER, UI_SHOTS } from '../src/cinema/trailer.ts';
import { captionsAt, intensityAt, sampleFx, soundTimes, totalDuration } from '../src/cinema/timeline.ts';
import { narrationCues } from '../src/cinema/narration.ts';

const SETS = new Set(['null', 'lantern', 'launch', 'fight', 'battle', 'reach', 'lineup', 'broadside']);
const EPS = 1e-6;

test('the trailer runs about 90 s and ends on the title and the end slate', () => {
  const d = totalDuration(TRAILER);
  assert.ok(d >= 85 && d <= 92, `duration ${d}`);
  assert.equal(new Set(TRAILER.map((s) => s.id)).size, TRAILER.length, 'shot ids are unique');
  const ids = TRAILER.map((s) => s.id);
  assert.deepEqual(ids.slice(-2), ['title', 'slate']);
  assert.ok(TRAILER.at(-2)!.captions?.some((c) => c.kind === 'title'));
  assert.ok(TRAILER.at(-1)!.captions?.some((c) => c.kind === 'slate' && /BROWSER/.test(c.text)));
  // Opens on the Signal, then the tagline.
  assert.equal(ids[0], 'signal');
  assert.ok(TRAILER[0].captions?.some((c) => c.kind === 'count'));
  assert.ok(TRAILER[1].captions?.some((c) => /Lantern gates went dark/.test(c.text)));
});

test('three eyecatch cards — FIGHT. TRADE. RISE. — in that order, a beat pair long', () => {
  const cards = TRAILER.flatMap((s) => (s.captions ?? []).filter((c) => c.kind === 'card').map((c) => ({ word: c.text, dur: s.dur })));
  assert.deepEqual(cards.map((c) => c.word), ['FIGHT.', 'TRADE.', 'RISE.']);
  for (const c of cards) assert.ok(Math.abs(c.dur - 2 * BEAT) < EPS);
});

test('every shot uses a known set and its camera moves tile the shot', () => {
  for (const s of TRAILER) {
    assert.ok(SETS.has(s.set), `${s.id}: unknown set ${s.set}`);
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

test('the combat movement is cut on the beat', () => {
  const start = TRAILER.findIndex((s) => s.id === 'fight-card');
  const end = TRAILER.findIndex((s) => s.id === 'trade-card');
  for (const s of TRAILER.slice(start, end)) {
    const beats = s.dur / BEAT;
    assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, `${s.id}: ${beats.toFixed(2)} beats`);
  }
});

test('captions, cues (with repeats) and envelopes stay inside their shot', () => {
  for (const s of TRAILER) {
    for (const c of s.captions ?? []) assert.ok(c.at >= 0 && c.at + c.dur <= s.dur + EPS, `${s.id}: caption "${c.text}" overruns`);
    for (const c of s.sound ?? []) for (const at of soundTimes(c)) assert.ok(at >= 0 && at <= s.dur, `${s.id}: sound at ${at}`);
    for (const e of [...(s.events ?? []), ...(s.music ?? [])]) assert.ok(e.at >= 0 && e.at <= s.dur, `${s.id}: cue at ${e.at}`);
    for (const tr of s.fx ?? []) if (tr.field !== 'hue') for (const [, v] of tr.keys) assert.ok(v >= 0 && v <= 1, `${s.id}: ${tr.field} ${v}`);
  }
});

test('subtitles are readable: one at a time, ≤ 26 chars/s, voiced lines fit their captions', () => {
  for (const s of TRAILER) {
    const subs = (s.captions ?? []).filter((c) => (c.kind ?? 'narration') === 'narration');
    for (const c of subs) assert.ok(c.text.length / c.dur <= 26, `${s.id}: "${c.text}" is ${(c.text.length / c.dur).toFixed(1)} chars/s`);
    for (let t = 0; t < s.dur; t += 0.05) {
      const live = captionsAt(s, t).filter((x) => (x.caption.kind ?? 'narration') === 'narration');
      assert.ok(live.length <= 1, `${s.id}: ${live.length} subtitles at ${t.toFixed(2)}s`);
    }
  }
  const cues = narrationCues(TRAILER);
  assert.ok(cues.some((c) => c.who === 'narrator'));
  assert.ok(cues.some((c) => c.who === 'kade' && c.channel === 'radio'), 'radio chatter is voiced');
  assert.ok(!cues.some((c) => c.caption.kind === 'label'), 'labels stay silent');
});

test('UI shots exist, and the score peaks in the fight', () => {
  for (const id of Object.keys(UI_SHOTS)) assert.ok(TRAILER.some((s) => s.id === id), id);
  let t = 0;
  for (const s of TRAILER) {
    if (s.id === 'merge') assert.ok(intensityAt(TRAILER, t + 0.5) > 0.8);
    if (s.id === 'giant') assert.ok(intensityAt(TRAILER, t + 0.5) < intensityAt(TRAILER, 16));
    t += s.dur;
  }
});

test('no shot is left blown out: flash never holds at full for long', () => {
  for (const s of TRAILER) {
    let hot = 0;
    for (let t = 0; t < s.dur; t += 1 / 60) {
      hot = sampleFx(s, t).flash > 0.9 ? hot + 1 / 60 : 0;
      assert.ok(hot < 0.35, `${s.id}: flash held ${hot.toFixed(2)} s at ${t.toFixed(2)}`);
    }
  }
});
