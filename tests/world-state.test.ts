import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_CAP, World, bump, counter, emptyWorld, fact, mod, nudge, recall, record, sanitizeWorld, setFact, tick } from '../src/game/world/WorldState.ts';

test('facts and counters are immutable updates', () => {
  const a = emptyWorld();
  const b = bump(setFact(a, 'bastion.fallen'), 'kills.renegade', 3);
  assert.equal(fact(a, 'bastion.fallen'), undefined);
  assert.equal(fact(b, 'bastion.fallen'), true);
  assert.equal(counter(b, 'kills.renegade'), 3);
  assert.equal(setFact(b, 'bastion.fallen'), b, 'no-op returns the same object');
});

test('modifiers clamp and decay back to zero', () => {
  let w = nudge(emptyWorld(), 'system:meridian', 'traffic', 0.8, 0.5);
  w = nudge(w, 'system:meridian', 'traffic', 0.8, 0.5);
  assert.equal(mod(w, 'system:meridian', 'traffic'), 1);
  w = tick(w, 3600);
  assert.ok(Math.abs(mod(w, 'system:meridian', 'traffic') - 0.5) < 1e-9);
  w = tick(w, 7200);
  assert.equal(mod(w, 'system:meridian', 'traffic'), 0);
  assert.equal(w.mods['system:meridian'], undefined, 'spent modifiers are dropped');
  assert.equal(w.clock, 10800);
});

test('the log is capped and recall filters newest first', () => {
  let w = emptyWorld();
  for (let i = 0; i < LOG_CAP + 50; i++) w = record(tick(w, 1), i % 2 ? 'kill' : 'trade', 'system:tessaly', { i });
  assert.equal(w.log.length, LOG_CAP);
  const kills = recall(w, { kind: 'kill' }, 3);
  assert.equal(kills.length, 3);
  assert.ok((kills[0].data!.i as number) > (kills[1].data!.i as number));
  assert.equal(recall(w, { since: w.clock - 4 }).length, 5);
});

test('sanitize repairs bad saves', () => {
  const w = sanitizeWorld({ clock: -5, facts: { a: 1, b: 'x' }, counters: { n: 'nope', m: 2 }, mods: { 'system:x': { traffic: { value: 0.3, decay: 0.1 }, bad: {} } }, log: [{ t: 1, kind: 'k' }, null, { kind: 'no-t' }] });
  assert.equal(w.clock, 0);
  assert.deepEqual(w.facts, { b: 'x' });
  assert.deepEqual(w.counters, { m: 2 });
  assert.deepEqual(Object.keys(w.mods['system:x']), ['traffic']);
  assert.equal(w.log.length, 1);
  assert.deepEqual(sanitizeWorld('garbage'), emptyWorld());
});

test('the live World notifies listeners with the event', () => {
  const live = new World();
  const seen: string[] = [];
  const off = live.on((_w, e) => seen.push(e ? e.kind : 'update'));
  live.event('dock', 'station:castellan-highport');
  live.update((w) => setFact(w, 'x'));
  live.update((w) => w);
  off();
  live.event('ignored');
  assert.deepEqual(seen, ['dock', 'update']);
});
