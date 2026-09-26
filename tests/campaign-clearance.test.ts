import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Group, Vector3 } from 'three';
import { createServer, type ViteDevServer } from 'vite';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import type { CampaignMission } from '../src/game/campaign/types.ts';
import type { RunnerSnapshot } from '../src/game/CampaignRunner.ts';

const DT = 1 / 60;
let server: ViteDevServer;
let Fleet: any, CampaignRunner: any, CampaignSession: any, EscortGuidance: any;
let FighterCollisions: any, proxiesFromModel: any, makeHost: any, placeHost: any, sphereContact: any;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  ({ Fleet } = await server.ssrLoadModule('/src/sim/Fleet.ts'));
  ({ CampaignRunner } = await server.ssrLoadModule('/src/game/CampaignRunner.ts'));
  ({ CampaignSession } = await server.ssrLoadModule('/src/game/CampaignSession.ts'));
  ({ EscortGuidance } = await server.ssrLoadModule('/src/game/campaign/EscortGuidance.ts'));
  ({ FighterCollisions } = await server.ssrLoadModule('/src/sim/FighterCollisions.ts'));
  ({ proxiesFromModel } = await server.ssrLoadModule('/src/sim/CollisionProxies.ts'));
  ({ makeHost, placeHost, sphereContact } = await server.ssrLoadModule('/src/sim/Collision.ts'));
});
after(async () => { await server?.close(); });

function harness(mission: CampaignMission, snapshot?: RunnerSnapshot) {
  const fleet = new Fleet(new Group(), 1994);
  const player = fleet.spawn('vf27-kestrel', 'concord', new Vector3(), new Vector3(0, 0, 1));
  // Use the production Session spawn and preStep methods (facing, initial
  // velocity, teams, anchor and escort controls); omit only DOM/presentation.
  const session = Object.assign(Object.create(CampaignSession.prototype), {
    host: { player, fleet, capitals: { register() {} } },
    statics: [], wing: [], stationary: new WeakSet(), departing: [],
    escortGuidance: new EscortGuidance(mission),
  });
  const host = {
    playerPosition: player.flight.position, playerAlive: true, playerHull: 1, systemId: mission.system, jumps: 0,
    ships: fleet.ships, gatePosition: () => new Vector3(0, 0, 20000),
    spawnShip: (spec: any, member: number, pos: Vector3) => session.spawn(spec, member, pos),
    spawnSetPiece: (spec: any, pos: Vector3) => ({ tag: spec.tag, position: pos, radius: 0 }),
    playChatter() {}, unlockCodex() {},
  };
  const runner = new CampaignRunner(mission, host);
  session.runner = runner;
  if (snapshot) runner.restore(snapshot);
  runner.begin(); runner.update(DT);
  const escorts = runner.escorts.flatMap((r: any) => r.ships);
  const target = runner.shipsTagged('indomitable')[0];
  const collisionHost = target ? makeHost(target, proxiesFromModel(target.model), target.flight.position, target.flight.orientation, target.flight.velocity) : null;
  const fighters = new FighterCollisions();
  const contact = { point: new Vector3(), normal: new Vector3(), depth: 0 };
  const metrics = { proxyHits: 0, firstProxyHit: -1, minClearance: Infinity, arrivedAt: -1, arrivalDistance: Infinity };
  // Bounds include every actual rest-pose mesh, including the offset bridge.
  const sphere = (s: any) => ({
    centre: s.model.bounds.getCenter(new Vector3()).applyQuaternion(s.flight.orientation).add(s.flight.position),
    radius: s.model.bounds.getSize(new Vector3()).length() / 2,
  });
  const step = (ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) {
      session.preStep(DT);
      fleet.step(DT);
      if (collisionHost) {
        placeHost(collisionHost);
        if (sphereContact(escorts[0].flight.position, escorts[0].radius, collisionHost.proxies, contact)) {
          metrics.proxyHits++;
          if (metrics.firstProxyHit < 0) metrics.firstProxyHit = runner.time;
        }
      }
      // Same small-craft solver and launch grace as HullCollisions.stepFighters.
      fighters.step(escorts, DT, (s: any, amount: number) => fleet.damage(s, amount));
      const pair = target ? [escorts[0], target] : escorts;
      if (pair.length === 2) {
        const [a, b] = pair.map(sphere);
        metrics.minClearance = Math.min(metrics.minClearance, a.centre.distanceTo(b.centre) - a.radius - b.radius);
      }
      runner.update(DT);
      if (metrics.arrivedAt < 0 && runner.flags.has(`${runner.escorts[0].tag}-arrived`)) {
        metrics.arrivedAt = runner.time;
        metrics.arrivalDistance = escorts[0].flight.position.distanceTo(runner.escorts[0].target);
      }
    }
  };
  return { runner, session, fleet, player, host, escorts, target, fighters, metrics, step };
}

function legacy(mission: CampaignMission): CampaignMission {
  return { ...mission, spawns: mission.spawns.map(({ routeArrival, stationary, memberOffsets, ...s }) => s) };
}

test('EP02 actual hull/flight reproduces the old collision; external transfer is clear through halt, resume and hold', t => {
  const old = harness(legacy(MISSIONS[1])); old.step(60 * 60);
  assert.ok(old.metrics.proxyHits > 0, 'old centre route must reproduce collision with actual Indomitable proxies');
  assert.ok(old.metrics.firstProxyHit < old.metrics.arrivedAt, 'the old delivery flag was too late to prevent hull entry');

  const h = harness(MISSIONS[1]);
  const anchor = h.target.flight.position.clone();
  h.step(8 * 60); h.runner.setFlag('halt:barge'); h.step(20 * 60);
  assert.ok(h.escorts[0].flight.speed < 0.01);
  assert.equal(h.runner.flags.has('barge-arrived'), false);
  h.runner.setFlag('resume:barge'); h.step(120 * 60);
  assert.ok(h.runner.flags.has('barge-arrived'));
  assert.ok(h.metrics.arrivalDistance < 100);
  assert.ok(h.escorts[0].flight.position.distanceTo(h.target.flight.position) > 1700, 'delivery is at the external point, not host centre');
  assert.ok(h.escorts[0].flight.speed < 0.01);
  assert.deepEqual(h.target.flight.position, anchor, 'production Session keeps the neutral host at anchor');
  assert.equal(h.metrics.proxyHits, 0);
  assert.ok(h.metrics.minClearance > 20, `whole-hull conservative clearance ${h.metrics.minClearance}`);
  t.diagnostic(JSON.stringify({ legacy: old.metrics, externalTransfer: h.metrics }));
});

test('EP02 delivery completes with the authored predicates and never fires at the host centre', () => {
  const wrong = harness(MISSIONS[1]);
  wrong.escorts[0].flight.position.copy(wrong.target.flight.position);
  wrong.runner.update(DT);
  assert.equal(wrong.runner.flags.has('barge-arrived'), false);
  const h = harness(MISSIONS[1]);
  h.player.flight.position.copy(h.escorts[0].flight.position); h.runner.update(DT);
  for (let i = 0; i < 4; i++) h.runner.onKill({ faction: 'rustwake' });
  h.runner.update(DT); h.step(15 * 60);
  assert.ok(h.runner.flags.has('halt:barge'));
  for (let i = 0; i < 4; i++) h.runner.onKill({ faction: 'rustwake' });
  h.runner.update(DT); h.step(100 * 60);
  assert.equal(h.runner.outcome, 'success');
  assert.equal(h.metrics.proxyHits, 0);
  assert.equal(h.escorts[0].hull, h.escorts[0].hullMax);
});

test('EP10 widened authored spawn removes the real fighter contact and stays clear through hold and arrival', t => {
  const old = harness(legacy(MISSIONS[9])); old.step(20 * 60);
  assert.ok(old.fighters.contacts > 0, 'original 76m wedge must contact after launch grace');
  const h = harness(MISSIONS[9]); h.step(20 * 60);
  assert.equal(h.fighters.contacts, 0);
  h.runner.setFlag('resume:lifeboats'); h.step(150 * 60);
  assert.ok(h.runner.flags.has('lifeboats-arrived'));
  assert.equal(h.fighters.contacts, 0);
  assert.ok(h.metrics.minClearance > 20, `conservative full-flight clearance ${h.metrics.minClearance}`);
  for (const s of h.escorts) assert.ok(s.flight.speed < 0.01);
  t.diagnostic(JSON.stringify({ legacyContacts: old.fighters.contacts, widenedSpawn: h.metrics, contacts: h.fighters.contacts }));
});

test('EP02/10 fixed-step retries repeat exactly; restore keeps saved positions and dead member identity', () => {
  for (const mission of [MISSIONS[1], MISSIONS[9]]) {
    const a = harness(mission), b = harness(mission);
    a.step(5 * 60); for (let i = 0; i < 5; i++) b.step(60);
    assert.deepEqual(a.runner.snapshot(), b.runner.snapshot());
    if (mission.episode === 10) a.escorts[0].alive = false;
    const snapshot = JSON.parse(JSON.stringify(a.runner.snapshot()));
    const restored = harness(mission, snapshot);
    for (const ship of a.escorts.filter((s: any) => s.alive)) {
      const r = restored.runner.shipsTagged(a.runner.tagOf(ship))[0];
      assert.deepEqual(r.flight.position, ship.flight.position, 'restored coordinates are never re-spaced');
      assert.deepEqual(r.flight.velocity, ship.flight.velocity, 'saved velocity overrides authored start velocity');
    }
    if (mission.episode === 10) {
      assert.equal(restored.runner.shipsTagged('lifeboats-1').length, 0);
      restored.runner.setFlag('resume:lifeboats');
    }
    restored.step(150 * 60);
    assert.ok(restored.runner.flags.has(`${restored.runner.escorts[0].tag}-arrived`));
    assert.equal(restored.metrics.proxyHits, 0);
    assert.equal(restored.fighters.contacts, 0);
  }
});

test('an existing EP02 save keeps its drifting host velocity, then brakes naturally at the new anchor', () => {
  const old = harness(legacy(MISSIONS[1])); old.step(8 * 60);
  const saved = JSON.parse(JSON.stringify(old.runner.snapshot()));
  const h = harness(MISSIONS[1], saved);
  assert.deepEqual(h.target.flight.velocity, old.target.flight.velocity, 'loading does not snap saved motion to zero');
  assert.deepEqual(h.target.flight.position, old.target.flight.position);
  h.step(100 * 60);
  assert.ok(h.runner.flags.has('barge-arrived'));
  assert.ok(h.target.flight.speed < 0.01);
  assert.equal(h.metrics.proxyHits, 0);
  assert.ok(h.metrics.minClearance > 20);
});
