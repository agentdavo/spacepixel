import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Group, Vector3 } from 'three';
import { createServer, type ViteDevServer } from 'vite';
import { CampaignRunner, type CampaignHost, type RunnerSnapshot } from '../src/game/CampaignRunner.ts';
import { EscortGuidance } from '../src/game/campaign/EscortGuidance.ts';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import type { CampaignMission } from '../src/game/campaign/types.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';
import { FlightModel, KESTREL_SPEC, type FlightSpec } from '../src/sim/FlightModel.ts';
import { createPilotState, flyToPoint } from '../src/sim/ai/Pilot.ts';

const DT = 1 / 60;
let server: ViteDevServer;
const designs = new Map<string, { spec: FlightSpec; radius: number; bound: number }>();
before(async () => {
  // Build actual escort hulls once on CPU: test their real flight authority and
  // rest-pose bounds, without a renderer, browser, collision solver or GPU.
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const { Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts');
  const fleet = new Fleet(new Group(), 1994);
  for (const m of MISSIONS) for (const spec of m.spawns) {
    if (spec.role !== 'escort' || designs.has(spec.blueprint)) continue;
    const ship = fleet.spawn(spec.blueprint, spec.faction, new Vector3(), new Vector3(0, 0, 1));
    const bounds = ship.model.bounds;
    const half = bounds.max.clone().sub(bounds.min).multiplyScalar(0.5);
    designs.set(spec.blueprint, { spec: { ...ship.flight.spec }, radius: ship.radius, bound: half.length() });
  }
});
after(async () => { await server?.close(); });

function harness(mission = MISSIONS[3], snapshot?: RunnerSnapshot) {
  const guidance = new EscortGuidance(mission);
  const ships: ShipEntity[] = [];
  const legacyPilots = new WeakMap<ShipEntity, ReturnType<typeof createPilotState>>();
  const h: CampaignHost = {
    playerPosition: new Vector3(), playerAlive: true, playerHull: 1, systemId: mission.system, jumps: 0,
    ships, gatePosition: () => new Vector3(0, 0, 20000),
    spawnShip: (spec, member, pos) => {
      const design = designs.get(spec.blueprint);
      const flight = new FlightModel({ ...(design?.spec ?? KESTREL_SPEC) });
      flight.position.copy(pos);
      flight.velocity.set(0, 0, flight.spec.maxSpeed * 0.6);
      const s = { flight, alive: true, faction: spec.faction, radius: design?.radius ?? 5,
        hull: 100, hullMax: 100,
        controls: { pitch: 0, yaw: 0, roll: 0, throttleDelta: 0, throttleSet: null, afterburner: false, flightAssistToggle: false, fire: false },
      } as ShipEntity;
      ships.push(s);
      if (spec.role === 'escort') guidance.register(s, spec, member);
      legacyPilots.set(s, createPilotState());
      return s;
    },
    spawnSetPiece: (spec, position) => ({ tag: spec.tag, position, radius: 0 }),
    playChatter: () => {}, unlockCodex: () => {},
  };
  const runner = new CampaignRunner(mission, h);
  if (snapshot) runner.restore(snapshot);
  runner.begin();
  const step = (ticks: number, legacy = false, sample?: () => void) => {
    for (let tick = 0; tick < ticks; tick++) {
      if (legacy) {
        for (const route of runner.escorts) for (const ship of route.ships) {
          if (ship.alive && route.target) flyToPoint(ship.controls, ship.flight, route.target, 60, legacyPilots.get(ship)!, DT);
        }
      } else guidance.step(runner.escorts, DT);
      for (const route of runner.escorts) for (const ship of route.ships) if (ship.alive) ship.flight.step(ship.controls, DT);
      runner.update(DT);
      sample?.();
    }
  };
  return { runner, guidance, ships, h, step };
}

function liveEscorts(h: ReturnType<typeof harness>) {
  return h.runner.escorts.flatMap(e => e.ships).filter(s => s.alive);
}

test('EP04 escorts brake into separate lanes rather than converge and reverse at the buoy', (t) => {
  const h = harness();
  let minDistance = Infinity;
  let arrivedAt: number | undefined;
  h.step(90 * 60, false, () => {
    if (arrivedAt === undefined && h.runner.flags.has('tankers-arrived')) arrivedAt = h.runner.time;
    const ships = liveEscorts(h);
    for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
      minDistance = Math.min(minDistance, ships[i].flight.position.distanceTo(ships[j].flight.position));
    }
  });
  assert.ok(minDistance > 50, `convoy must not collapse on approach: minimum ${minDistance}`);
  assert.ok(h.runner.flags.has('tankers-arrived'));
  const stopped = liveEscorts(h).map(s => s.flight.position.clone());
  for (const s of liveEscorts(h)) assert.ok(s.flight.speed < 0.01, `escort should stop, speed=${s.flight.speed}`);
  h.step(30 * 60);
  liveEscorts(h).forEach((s, i) => assert.ok(s.flight.position.distanceTo(stopped[i]) < 0.01, 'no repeated reversal after arrival'));
  const old = harness();
  old.step(90 * 60, true);
  assert.ok(liveEscorts(old).some(s => s.flight.speed > 10), 'old arrival-speed guidance does not hold the endpoint');
  t.diagnostic(`EP04 guidance-only: minimum approach separation ${minDistance.toFixed(2)}m; tankers-arrived at ${arrivedAt!.toFixed(2)}s; all five stationary by90s and remain stationary for30s.`);
});

test('all authored escort routes fit the unchanged arrival radius with real hull clearance', () => {
  for (const mission of MISSIONS.filter(m => m.spawns.some(s => s.role === 'escort'))) {
    const h = harness(mission);
    // EP10 intentionally holds its lifeboats until the objective releases them.
    h.step(2);
    if (mission.episode === 10) h.runner.setFlag('resume:lifeboats');
    h.step(150 * 60);
    for (const route of h.runner.escorts) {
      assert.ok(route.target, `${mission.id}/${route.tag} destination must resolve`);
      assert.ok(h.runner.flags.has(`${route.tag}-arrived`), `${mission.id}/${route.tag} keeps original arrival flag`);
      for (const ship of route.ships) {
        assert.ok(ship.flight.position.distanceTo(route.target!) < 800, `${mission.id} must not need a larger arrival radius`);
        assert.ok(ship.flight.speed < 0.01, `${mission.id}/${route.tag} should remain stopped: ${ship.flight.speed}`);
      }
    }
    const ships = liveEscorts(h);
    for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
      const specOf = (ship: ShipEntity) => mission.spawns.find(s => s.tag && h.runner.tagOf(ship)?.startsWith(s.tag))!;
      if (specOf(ships[i]).routeTo !== specOf(ships[j]).routeTo) continue;
      const clearance = designs.get(specOf(ships[i]).blueprint)!.bound + designs.get(specOf(ships[j]).blueprint)!.bound + 20;
      assert.ok(ships[i].flight.position.distanceTo(ships[j].flight.position) > clearance,
        `${mission.id}: endpoint spacing must clear both actual bounding spheres +20m (${clearance})`);
    }
  }
});

test('halt and unresolved routes clear stale drive controls, brake normally and resume', () => {
  const h = harness();
  h.step(5 * 60);
  h.runner.setFlag('halt:tankers'); h.step(1);
  const tanker = h.runner.shipsTagged('tankers')[0];
  Object.assign(tanker.controls, { afterburner: true, throttleDelta: 1, fire: true, missile: true });
  tanker.flight.flightAssist = false;
  tanker.flight.cruise = 'on';
  const before = tanker.flight.position.clone();
  const velocityBefore = tanker.flight.velocity.clone();
  const orientationBefore = tanker.flight.orientation.clone();
  const nonEscort = h.ships.find(s => !liveEscorts(h).includes(s))!;
  const unrelatedControls = { ...nonEscort.controls };
  h.guidance.step(h.runner.escorts, DT);
  assert.deepEqual(tanker.flight.position, before, 'guidance must not write poses');
  assert.deepEqual(tanker.flight.velocity, velocityBefore, 'guidance must not write velocity');
  assert.deepEqual(tanker.flight.orientation, orientationBefore, 'guidance must not write orientation');
  assert.deepEqual(nonEscort.controls, unrelatedControls, 'guidance must not take control of unrelated actors or the player');
  assert.equal(tanker.controls.afterburner, false);
  assert.equal(tanker.controls.throttleDelta, 0);
  assert.equal(tanker.controls.fire, false);
  assert.equal(tanker.controls.missile, false);
  assert.equal(tanker.controls.flightAssistToggle, true);
  assert.equal(tanker.controls.cruise, true, 'cancel an active cruise drive through its normal toggle');
  h.step(15 * 60);
  assert.ok(tanker.flight.speed < 0.01);
  h.runner.setFlag('resume:tankers'); h.step(120 * 60);
  assert.ok(h.runner.flags.has('tankers-arrived'));
  assert.ok(tanker.flight.speed < 0.01);
  const route = h.runner.escorts.find(r => r.tag === 'tankers')!;
  route.target = null;
  Object.assign(tanker.controls, { afterburner: true, throttleDelta: 1 });
  h.guidance.step(h.runner.escorts, DT);
  assert.equal(tanker.controls.afterburner, false);
  assert.equal(tanker.controls.throttleSet, 0);
});

test('casualties, JSON restore and mission retry preserve surviving arrival slots', () => {
  const original = harness(); original.step(20 * 60);
  original.runner.shipsTagged('tankers')[1].alive = false;
  const restored = harness(MISSIONS[3], JSON.parse(JSON.stringify(original.runner.snapshot())));
  original.step(100 * 60); restored.step(100 * 60);
  for (const ship of liveEscorts(original)) {
    const tag = original.runner.tagOf(ship)!;
    const resumed = restored.runner.shipsTagged(tag)[0];
    assert.ok(resumed, `${tag} must retain its member identity`);
    assert.ok(ship.flight.position.distanceTo(resumed.flight.position) < 16, `${tag} must keep its slot on restore`);
    assert.ok(resumed.flight.speed < 0.01);
  }
  assert.equal(restored.runner.shipsTagged('tankers-2').length, 0, 'dead member must not respawn or steal a slot');
  const retry = harness(); retry.step(120 * 60);
  for (const ship of liveEscorts(original)) {
    const tag = original.runner.tagOf(ship)!;
    assert.ok(ship.flight.position.distanceTo(retry.runner.shipsTagged(tag)[0].flight.position) < 0.01, `${tag} casualty must not shift the other endpoints`);
  }
});

test('fixed-step escort motion is identical across repeat runs and tick batches', () => {
  const a = harness(), b = harness();
  a.step(90 * 60);
  for (let i = 0; i < 90; i++) b.step(60);
  const state = (h: ReturnType<typeof harness>) => liveEscorts(h).map(s => ({ pos: s.flight.position.toArray(), vel: s.flight.velocity.toArray(), q: s.flight.orientation.toArray(), controls: s.controls }));
  assert.deepEqual(state(a), state(b));
  assert.deepEqual(a.runner.snapshot(), b.runner.snapshot());
});
