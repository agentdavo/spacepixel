import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { moonPosition, surveySystem } from '../src/universe/bodies.ts';
import {
  TRAFFIC_ROLES,
  ambushOf,
  ambushReward,
  laneProgress,
  lanePoint,
  manifest,
  nextArrivals,
  sailingsAt,
  systemLanes,
  systemTraffic,
  wingSize,
} from '../src/universe/traffic.ts';
import type { StarSystem } from '../src/universe/Universe.ts';
import type { TradeLedger } from '../src/game/economy.ts';

/** A small stand-in system shaped like the generator's output (no render deps). */
function makeSystem(id: string, faction: StarSystem['faction'] = 'concord'): StarSystem {
  const gates = [
    { to: 'alpha', position: new Vector3(22_000, 400, 3000), normal: new Vector3(1, 0, 0.1).normalize() },
    { to: 'beta', position: new Vector3(-9000, -600, 24_000), normal: new Vector3(-0.3, 0, 1).normalize() },
  ];
  const planets = [
    {
      preset: { name: `${id} I`, radius: 40_000, bands: [{ at: 0, color: '#ffffff' }], bandScale: 2, turbulence: 0.1, atmosphere: '#9fdcff', ring: { inner: 1.4, outer: 2.2, tilt: 0.3, bands: [{ at: 0, color: '#000', alpha: 0 }] } },
      position: new Vector3(300_000, 20_000, -90_000),
      tilt: [0.1, 0.2, 0.3] as [number, number, number],
    },
    {
      preset: { name: `${id} V`, radius: 30_000, bands: [{ at: 0, color: '#ffffff' }], bandScale: 2, turbulence: 0.1, atmosphere: '#9fdcff' },
      position: new Vector3(-150_000, -10_000, 210_000),
      tilt: [0, 0, 0] as [number, number, number],
    },
  ];
  const stations = [
    { id: `${id}-orbital-0`, name: `${id} Highport`, kind: 'orbital' as const, faction: 'concord' as const, position: new Vector3(260_000, 17_000, -78_000), axis: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), planet: 0, seed: 1 },
    { id: `${id}-bastion-1`, name: `${id} Watch`, kind: 'bastion' as const, faction: 'concord' as const, position: new Vector3(10_000, 0, 2000), axis: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), seed: 2 },
  ];
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    faction,
    map: { x: 0, y: 0 },
    starColor: null as never,
    starClass: 'K',
    light: null as never,
    backdrop: null as never,
    planets,
    gates,
    stations,
    threat: faction === 'contested' ? 0.5 : 0.1,
  };
}

test('survey is deterministic and never moves an original planet', () => {
  const a = makeSystem('testhold');
  const b = makeSystem('testhold');
  const before = a.planets.map((p) => ({ name: p.preset.name, pos: p.position.clone(), r: p.preset.radius, ring: !!p.preset.ring }));
  surveySystem(1994, a);
  surveySystem(1994, b);
  assert.equal(a.planets.length, b.planets.length);
  a.planets.forEach((p, i) => {
    assert.equal(p.preset.name, b.planets[i].preset.name);
    assert.equal(p.preset.kind, b.planets[i].preset.kind);
    assert.ok(p.position.equals(b.planets[i].position));
    assert.equal(p.description, b.planets[i].description);
    assert.equal(p.moons?.length ?? 0, b.planets[i].moons?.length ?? 0);
  });
  before.forEach((o, i) => {
    const p = a.planets[i];
    assert.equal(p.preset.name, o.name);
    assert.ok(p.position.equals(o.pos), 'position unchanged');
    assert.equal(p.preset.radius, o.r, 'radius unchanged');
    assert.equal(!!p.preset.ring, o.ring, 'ring unchanged');
  });
  // The ringed / refinery-free original with an orbital port keeps its ring and becomes a giant.
  assert.equal(a.planets[0].preset.kind, 'gas');
});

test('every body has a name and a line of flavour; added bodies keep clear', () => {
  for (const id of ['vesta', 'orrin', 'kaldor', 'mire', 'sable']) {
    for (const faction of ['concord', 'choir', 'rustwake', 'contested'] as const) {
      const sys = makeSystem(id, faction);
      surveySystem(1994, sys);
      for (const p of sys.planets) {
        assert.ok(p.preset.name.length > 0);
        assert.ok((p.description ?? '').length > 10, `${p.preset.name} has flavour`);
        for (const m of p.moons ?? []) assert.ok(m.description.length > 10);
      }
      const added = sys.planets.filter((p) => p.added);
      for (const n of added) {
        for (const o of sys.planets) {
          if (o === n) continue;
          assert.ok(n.position.distanceTo(o.position) > (n.preset.radius + o.preset.radius) * 2, `${n.preset.name} clear of ${o.preset.name}`);
        }
        for (const g of sys.gates) assert.ok(n.position.distanceTo(g.position) > 60_000, 'clear of the Lanterns');
        assert.ok(n.position.length() < 560_000, 'inside the camera far plane budget');
      }
    }
  }
});

test('moons orbit outside rings and station altitudes, inside 45% of the planet distance', () => {
  for (const id of ['vesta', 'orrin', 'kaldor', 'mire', 'sable', 'tamsin', 'odo']) {
    const sys = makeSystem(id, 'rustwake');
    surveySystem(1994, sys);
    for (const p of sys.planets) {
      for (const m of p.moons ?? []) {
        const R = p.preset.radius;
        const minOrbit = p.preset.ring ? R * (p.preset.ring.outer + 0.5) : R * 2.6;
        assert.ok(m.orbit >= minOrbit - 1, `${m.preset.name}: orbit ${m.orbit} ≥ ${minOrbit}`);
        assert.ok(m.orbit <= p.position.length() * 0.45 + 1, `${m.preset.name}: stays off the Lanterns`);
        assert.ok(m.orbit - m.preset.radius > R + 12_000, 'clear of orbital ports');
        for (const t of [0, 123, 4567]) {
          const q = moonPosition(p.position, m, t);
          assert.ok(Math.abs(q.distanceTo(p.position) - m.orbit) < 1e-3 * m.orbit, 'circular orbit');
        }
      }
    }
  }
});

test('traffic timetable: deterministic lanes, sailings under way, arrival at the far node', () => {
  const sys = makeSystem('testhold');
  const lanes = systemLanes(1994, sys);
  const again = systemLanes(1994, sys);
  assert.ok(lanes.length > 6);
  assert.deepEqual(
    lanes.map((l) => [l.from.id, l.to.id, l.period, l.phase]),
    again.map((l) => [l.from.id, l.to.id, l.period, l.phase]),
  );
  const clock = 90_000;
  const act = sailingsAt(sys.id, lanes, clock);
  assert.ok(act.length > 3, `busy lanes (${act.length})`);
  for (const s of act) {
    assert.ok(clock >= s.depart && clock < s.depart + s.duration);
    const end = laneProgress(s.lane, s.role, s.duration);
    assert.ok(Math.abs(end.dist - s.lane.length) < 1, 'sailing ends at the far node');
    let last = -1;
    for (let t = 0; t <= s.duration; t += s.duration / 20) {
      const d = laneProgress(s.lane, s.role, t).dist;
      assert.ok(d >= last - 1e-6, 'monotonic progress');
      last = d;
    }
    assert.ok(lanePoint(s.lane, 0).distanceTo(s.lane.from.position) < 1e-6);
    assert.deepEqual(manifest(s), manifest(s));
    assert.ok(TRAFFIC_ROLES[s.role].hulls[s.flag].length > 0, 'a hull for every role and flag');
  }
  // Same clock, same traffic.
  assert.deepEqual(
    sailingsAt(sys.id, lanes, clock).map((s) => s.key),
    act.map((s) => s.key),
  );
  const next = nextArrivals(sys.id, lanes, 'alpha', clock, 3);
  assert.ok(next.length > 0 && next.every((s) => s.depart >= clock && s.lane.from.id === 'alpha'));
  const patrol = lanes.find((l) => l.kind === 'patrol');
  assert.ok(patrol, 'a patrol lane out of the bastion');
});

test('raiders only work lawless lanes; patrol wings are 2–4; summaries add up', () => {
  const safe = makeSystem('coreworld', 'choir');
  const wild = makeSystem('borderland', 'contested');
  const count = (sys: StarSystem) => {
    const lanes = systemLanes(1994, sys);
    let n = 0;
    for (let c = 50_000; c < 60_000; c += 97) for (const s of sailingsAt(sys.id, lanes, c)) if (ambushOf(sys, s)) n++;
    return n;
  };
  assert.equal(count(safe), 0);
  assert.ok(count(wild) > 0);
  const lanes = systemLanes(1994, wild);
  for (const s of sailingsAt(wild.id, lanes, 70_000)) {
    if (s.role !== 'patrol') continue;
    const n = wingSize(s);
    assert.ok(n >= 2 && n <= 4);
  }
  const sum = systemTraffic(1994, wild);
  assert.ok(sum.perHour > 0 && sum.piracy > 0);
  assert.ok((sum.byGate.alpha ?? 0) > 0 && (sum.byGate.beta ?? 0) > 0);
});

test('ambush reward is pure: bounty per raider, standing when the hauler lives', () => {
  const l: TradeLedger = { credits: 1000, cargo: {}, capacity: 16, rep: { concord: 10, choir: 0, rustwake: 0 }, missiles: 4, clock: 0, pressure: {} };
  const r = ambushReward(l, 'concord', 2, true);
  assert.equal(l.credits, 1000, 'input untouched');
  assert.equal(r.ledger.credits, 1000 + r.credits);
  assert.ok(r.credits > 0 && r.rep > 0);
  assert.ok(r.ledger.rep.concord > l.rep.concord);
  const lost = ambushReward(l, 'rustwake', 0, false);
  assert.equal(lost.credits, 0);
  assert.equal(lost.ledger.rep.rustwake, 0);
});
