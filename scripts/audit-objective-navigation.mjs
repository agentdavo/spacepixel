import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = resolve(process.argv[2]);
const read = name => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
const rows = readFileSync(`${dir}/events.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const provenance = read('provenance.json');
const stop = read('navigation-stop.json');
const tape = read('take.vgr');
const replay = read('replay-status.json');
const episode = provenance.episode;
assert.equal(provenance.renderer.backend, 'WebGPU');
assert.equal(provenance.renderer.device, 'GPUDevice');
assert.equal(provenance.renderer.queue, true);
assert.ok(replay.desyncAt < 0);
const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const changes = [];
let key = '';
for (const row of rows) {
  const nav = row.navigation;
  const next = JSON.stringify([nav.objective, nav.tag, nav.outcome]);
  if (next !== key) changes.push({ tick: row.tick, at: row.at, ...nav });
  key = next;
  if (nav.tag) {
    assert.equal(nav.calls.length, 1, `one marker call at ${row.tick}`);
    assert.equal(nav.calls[0].name, nav.label);
    assert.equal(nav.calls[0].mission, true);
    assert.ok(near(nav.calls[0].position, nav.position));
    assert.ok(nav.labels.length >= 1, `HUD marker request at ${row.tick}`);
    assert.ok(nav.labels.every(l => l.lines.some(line => line.startsWith(nav.label.toUpperCase()))));
  } else if ([4, 5].some(ep => episode.startsWith(`ep0${ep}`))) {
    assert.equal(nav.calls.length, 0, `no fallback marker at ${row.tick}`);
    assert.equal(nav.labels.length, 0, `no stale marker label at ${row.tick}`);
  }
  assert.ok(row.controls.every(c => !c.fire && !c.missile), 'peaceful route pilot never fires');
}
const report = {
  source: provenance.source, episode, renderer: provenance.renderer,
  frames: rows.length, ticks: rows.length * 2, duration: rows.at(-1).at,
  probe: provenance.probe, stop, replay,
  tape: { ticks: tape.ticks, checks: tape.checks.length, commands: tape.commands },
  transitions: changes,
  screenshots: readdirSync(dir).filter(f => f.endsWith('.jpg')),
  nativeScope: 'ordinary mouse/keyboard controls, fresh mission, read-only observations; no combat-completion claim',
};
if (episode.startsWith('ep04')) {
  assert.deepEqual(changes.map(x => [x.objective, x.tag]), [['formup', 'magpie'], ['raid', 'tankers-1']]);
  assert.equal(stop.ended, true);
} else if (episode.startsWith('ep05')) {
  assert.deepEqual(changes.map(x => [x.objective, x.tag]), [['relieve', 'station'], ['north', 'buoyN'], ['void', 'buoyV'], ['listen', 'throat'], ['measure', null]]);
  assert.equal(stop.ended, true);
  const progress = rows.flatMap(r => r.navigation.dwells.filter(d => d.tag === 'throat').map(d => ({ t: r.at, value: d.progress })));
  const began = progress.find(d => d.value > 0);
  const held = progress.find(d => d.value === 1);
  assert.ok(began && held && held.t - began.t >= 19.9, 'full authored listening dwell');
  report.dwell = { began, held };
} else {
  const samples = rows.flatMap(r => r.clearance ?? []).filter(s => s.ships.length === 2);
  assert.ok(samples.length > 120, 'pair observed beyond launch grace');
  const first = samples[0];
  const ids = new Set(first.ships.map(s => s.id));
  const pairContacts = rows.flatMap(r => r.contacts ?? []).filter(c => ids.has(c.a) && ids.has(c.b));
  assert.equal(pairContacts.length, 0, 'no relevant pair contacts in any solver');
  assert.ok(samples.every(s => s.ships.every(ship => ship.alive)), 'both actors survive the bounded native slice');
  const gap = samples.map(s => ({ tick: s.tick, gap: dist(s.ships[0].centre, s.ships[1].centre) - s.ships[0].enclosingRadius - s.ships[1].enclosingRadius })).reduce((a,b) => a.gap < b.gap ? a : b);
  report.clearance = { first, last: samples.at(-1), samples: samples.length, pairContacts: pairContacts.length, minRestBoundsGap: gap, allContactCount: rows.flatMap(r => r.contacts ?? []).length };
  if (episode.startsWith('ep02')) {
    const host = first.ships.find(s => s.tag === 'indomitable');
    const expected = host.position.map((v,i) => v + [0,0,-1800][i]);
    const arrival = samples.find(s => s.flags.includes('barge-arrived'));
    assert.ok(arrival, 'barge reached external destination during native slice');
    const route = arrival.routes.find(r => r.tag === 'barge');
    assert.ok(near(route.target, expected));
    assert.ok(route.distances[0].distance < 100);
    assert.ok(samples.every(s => {
      const h = s.ships.find(x => x.tag === 'indomitable');
      return h.team === 'neutral' && near(h.position, host.position) && Math.hypot(...h.velocity) < 1e-6;
    }), 'neutral host stays at its anchor');
    report.clearance.arrival = arrival;
  } else if (episode.startsWith('ep10')) {
    const delta = first.ships[1].position.map((v,i) => v - first.ships[0].position[i]);
    assert.ok(near(delta, [240,12,-45]));
    assert.ok(samples.every(s => s.flags.includes('halt:lifeboats') && !s.flags.includes('resume:lifeboats')));
    report.clearance.initialMemberDelta = delta;
  }
}
writeFileSync(`${dir}/audit.json`, JSON.stringify({ passed: true, ...report }, null, 2));
console.log(JSON.stringify({ passed: true, episode, duration: report.duration, transitions: changes.map(c=>({at:c.at,objective:c.objective,tag:c.tag})), minRestBoundsGap: report.clearance?.minRestBoundsGap, arrival: report.clearance?.arrival?.tick, screenshots: report.screenshots }, null, 2));
