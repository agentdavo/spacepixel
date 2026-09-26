import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [directory, output] = process.argv.slice(2);
const frames = readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8'));
const ticks = frames.flatMap(f => f.clearance);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const delta = (a, b) => a.map((v, i) => v - b[i]);
const ep02 = provenance.episode === 'ep02-fossil-fire';
const tags = ep02 ? ['barge', 'indomitable'] : ['lifeboats-1', 'lifeboats-2'];
const first = ticks[0], last = ticks.at(-1);
const firstShips = tags.map(tag => first.ships.find(s => s.tag === tag));
assert.ok(firstShips.every(Boolean));
const ids = firstShips.map(s => s.id);
const counts = { fighter: 0, capital: 0, hull: 0 };
const contactsInvolvingSubjects = [];
for (const f of frames) for (const e of f.contacts) {
  if (ids.includes(e.a) || ids.includes(e.b)) contactsInvolvingSubjects.push(e);
  if (ids.includes(e.a) && ids.includes(e.b)) counts[e.kind]++;
}
let minimumGap = Infinity, minimumGapTick, maxAnchorDrift = 0, maxAnchorSpeed = 0;
let firstArrival = null, maxTargetError = 0;
for (let i = 0; i < ticks.length; i++) {
  const t = ticks[i];
  assert.equal(t.tick, i + 1, 'every 60 Hz tick must be present once');
  const [a, b] = tags.map(tag => t.ships.find(s => s.tag === tag));
  assert.ok(a && b && a.alive && b.alive);
  assert.ok(a.enclosingRadius > 0 && b.enclosingRadius > 0);
  const gap = distance(a.centre, b.centre) - a.enclosingRadius - b.enclosingRadius;
  if (gap < minimumGap) { minimumGap = gap; minimumGapTick = t.tick; }
  assert.equal(a.hull, firstShips[0].hull);
  assert.equal(b.hull, firstShips[1].hull);
  if (ep02) {
    assert.equal(b.team, 'neutral');
    maxAnchorDrift = Math.max(maxAnchorDrift, distance(b.position, firstShips[1].position));
    maxAnchorSpeed = Math.max(maxAnchorSpeed, Math.hypot(...b.velocity));
    const r = t.routes.find(r => r.tag === 'barge');
    maxTargetError = Math.max(maxTargetError, distance(delta(r.target, b.position), [0, 0, -1800]));
    if (!firstArrival && t.flags.includes('barge-arrived')) firstArrival = {
      tick: t.tick, seconds: t.tick / 60,
      distance: distance(a.position, r.target),
      loggedDistance: r.distances.find(d => d.id === a.id).distance,
      speed: Math.hypot(...a.velocity),
    };
  } else {
    assert.ok(t.flags.includes('halt:lifeboats'));
    assert.ok(!t.flags.includes('resume:lifeboats'));
  }
}
assert.ok(minimumGap > 20, 'conservative enclosing spheres retain at least20m clearance');
assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 0);
if (ep02) {
  assert.ok(firstArrival && firstArrival.distance < 100);
  assert.equal(maxAnchorDrift, 0);
  assert.equal(maxAnchorSpeed, 0);
  assert.equal(maxTargetError, 0);
}
const result = {
  source: provenance.source, episode: provenance.episode, renderer: provenance.renderer,
  eventsSha256: createHash('sha256').update(readFileSync(join(directory, 'events.jsonl'))).digest('hex'),
  frames: frames.length, ticks: ticks.length, firstTick: first.tick, lastTick: last.tick,
  seconds: last.tick / 60, pair: tags, ids, contacts: counts, contactsInvolvingSubjects,
  minimumGap, minimumGapTick, maxAnchorDrift, maxAnchorSpeed, maxTargetError,
  firstArrival, initialMemberDelta: ep02 ? undefined : delta(firstShips[1].position, firstShips[0].position),
  final: last.ships.map(s => ({tag:s.tag,alive:s.alive,hull:s.hull,shield:s.shield,speed:Math.hypot(...s.velocity)})),
  flags: last.flags, outcome: last.outcome,
  scope: ep02 ? 'Fresh native approach/external-arrival/hold before combat; no halt/resume or mission completion claim.' : 'Fresh native initial hold through launch grace; no combat/resume/evacuation completion claim.',
  passed: true,
};
if (output) writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
