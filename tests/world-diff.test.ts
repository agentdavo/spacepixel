import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_CAP, bump, emptyWorld, nudge, record, setFact, tick, type WorldState } from '../src/game/world/WorldState.ts';
import { applyWorldDiff, diffWorld, isEmptyDiff } from '../src/game/world/diff.ts';

function roundTrip(a: WorldState, b: WorldState): number {
  const d = JSON.parse(JSON.stringify(diffWorld(a, b)));
  assert.deepEqual(applyWorldDiff(a, d), b);
  return JSON.stringify(d).length;
}

test('no change is an empty diff', () => {
  const w = emptyWorld();
  assert.ok(isEmptyDiff(diffWorld(w, w)));
});

test('facts, counters, mods and the clock round-trip, including removals', () => {
  let a = emptyWorld();
  a = setFact(a, 'bastion.fallen');
  a = bump(a, 'kills.renegade', 2);
  a = nudge(a, 'system:meridian', 'traffic', 0.5, 0.5);
  a = nudge(a, 'station:lantern', 'attitude', 0.2);
  let b = setFact(a, 'guild.keeping.rank', 'warden');
  b = bump(b, 'kills.renegade');
  b = { ...b, facts: { ...b.facts } };
  delete b.facts['bastion.fallen'];
  b = nudge(b, 'system:meridian', 'patrol', -0.3);
  b = tick(b, 4 * 3600); // decays the lantern mod to nothing: a whole scope goes
  assert.equal(b.mods['station:lantern'], undefined);
  roundTrip(a, b);
});

test('the log carries only its new tail, also across the cap', () => {
  let a = emptyWorld();
  for (let i = 0; i < LOG_CAP; i++) a = record(a, 'filler', undefined, { i });
  let b = a;
  for (let i = 0; i < 3; i++) b = record(b, 'guild.joined', 'guild:keeping', { n: i });
  const size = roundTrip(a, b);
  const whole = JSON.stringify(b).length;
  assert.ok(size < whole / 20, `diff ${size} B vs snapshot ${whole} B`);
  const d = diffWorld(a, b);
  assert.deepEqual(d.log && 'drop' in d.log ? [d.log.drop, d.log.add.length] : null, [3, 3]);
});

test('a rewritten log falls back to the whole log; junk is sanitized', () => {
  const a = record(record(emptyWorld(), 'x'), 'y');
  const b = { ...a, log: [{ t: 0, kind: 'z' }] };
  roundTrip(a, b);
  assert.deepEqual(applyWorldDiff(a, null), a);
  const bad = applyWorldDiff(a, { counters: { set: { n: 'nope' } }, log: { drop: 0, add: [{ bogus: 1 }] } });
  assert.equal(bad.counters.n, undefined);
  assert.equal(bad.log.length, 2);
});
