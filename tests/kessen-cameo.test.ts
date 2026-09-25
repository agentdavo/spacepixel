import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { Box3, Group, Sphere, Vector3 } from 'three';
import { CampaignRunner, type CampaignHost } from '../src/game/CampaignRunner.ts';
import { MISSIONS } from '../src/game/campaign/missions.ts';
import type { CampaignMission, SetPieceSpec } from '../src/game/campaign/types.ts';

let server: ViteDevServer | undefined;
after(async () => { await server?.close(); });
async function load() {
  server ??= await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  return server.ssrLoadModule('/src/world/setpieces/KessenCameo.ts');
}

test('cameos: only Episodes 10/19, isolated tags and no interaction parameters', () => {
  const cameos = MISSIONS.flatMap((m) => m.setpieces.filter((p) => p.kind === 'kessen-cameo').map((p) => ({ ep: m.episode, p })));
  assert.deepEqual(cameos.map((x) => x.ep), [10, 19]);
  assert.equal(cameos[0].p.params?.whenFlag, 'bastion-destroyed');
  assert.equal(cameos[1].p.params?.hideWhenFlag, 'leg2');
  for (const { ep, p } of cameos) {
    assert.equal(p.params?.hold, undefined);
    assert.equal(p.params?.radius, undefined);
    assert.ok(p.tag.startsWith('kessen-'));
    const m = MISSIONS[ep - 1];
    assert.ok(!m.chatter.some((b) => JSON.stringify(b).includes(p.tag)));
    assert.ok(!m.objectives.some((o) => `${o.done}${o.failed}`.includes(p.tag)));
  }
});

function runMission(mission: CampaignMission) {
  const pieces = new Map<string, Vector3>();
  const released: string[] = [];
  const beats: string[] = [];
  const ships: any[] = [];
  const host = {
    playerPosition: new Vector3(), playerAlive: true, playerHull: 1,
    systemId: mission.system, jumps: 0, ships,
    gatePosition: () => new Vector3(0, 0, 5000),
    spawnShip: (s: any, _i: number, p: Vector3) => {
      const ship = { faction: s.faction, team: s.faction, alive: true, hull: 100, hullMax: 100, flight: { position: p.clone(), velocity: new Vector3() } };
      ships.push(ship); return ship;
    },
    spawnSetPiece: (s: SetPieceSpec, p: Vector3) => {
      pieces.set(s.tag, p.clone()); released.push(s.tag);
      return { tag: s.tag, position: p, radius: 0 };
    },
    playChatter: (b: { id: string }) => beats.push(b.id),
    unlockCodex: () => {}, command: () => {},
  };
  const runner = new CampaignRunner(mission, host as CampaignHost);
  runner.begin();
  if (mission.episode === 10) assert.ok(!released.includes('kessen-evacuation'));
  const snapshots = [];
  for (let tick = 0; tick < 200; tick++) {
    if (mission.episode === 10) {
      if (pieces.has('bastion')) host.playerPosition.copy(pieces.get('bastion')!);
      if (tick === 100) {
        runner.setFlag('bastion-destroyed');
        for (const ship of ships.filter((s) => s.faction === 'choir').slice(0, 5)) { ship.alive = false; runner.onKill(ship); }
      }
      if (tick === 120) runner.setFlag('lifeboats-arrived');
      if (tick === 140) host.jumps = 1;
    } else {
      const point = pieces.get(host.jumps === 0 ? 'tune-meridian' : host.jumps === 1 ? 'tune-second' : runner.flags.has('crest') ? 'crest-watch' : 'tune-third');
      if (point) host.playerPosition.copy(point);
      if (tick === 40) host.jumps = 1;
      if (tick === 80) host.jumps = 2;
    }
    runner.update(1);
    snapshots.push(runner.snapshot());
  }
  assert.equal(runner.outcome, 'success', mission.id);
  return { snapshots, beats, released };
}

test('cameos: identical runner snapshots, chatter, kills and outcomes with specs removed', () => {
  for (const ep of [10, 19]) {
    const mission = MISSIONS[ep - 1];
    const withCameos = runMission(mission);
    const without = runMission({ ...mission, setpieces: mission.setpieces.filter((s) => s.kind !== 'kessen-cameo') });
    assert.deepEqual(withCameos.snapshots, without.snapshots, `Episode ${ep}`);
    assert.deepEqual(withCameos.beats, without.beats);
    assert.equal(withCameos.released.filter((tag) => tag.startsWith('kessen-')).length, 1, 'one release despite repeated flags/updates');
    assert.deepEqual(withCameos.released.filter((tag) => !tag.startsWith('kessen-')), without.released);
  }
});

test('cameos: default on, explicit off allocates no meshes; poses are time-derived and side-effect free', async () => {
  const { KessenCameo, kessenCameosEnabled } = await load();
  assert.equal(kessenCameosEnabled(''), true);
  assert.equal(kessenCameosEnabled('?episode=10'), true);
  assert.equal(kessenCameosEnabled('?kessenCameos=1'), true);
  assert.equal(kessenCameosEnabled('?episode=19&kessenCameos=0'), false);
  const anchor = new Vector3(2_400_000, 150_000, -1_100_000);
  const off = new KessenCameo('off', anchor, undefined, kessenCameosEnabled('?kessenCameos=0'));
  assert.equal(off.frames.length, 0);
  assert.equal(off.group.children.length, 0);
  assert.equal(off.radius, 0);
  off.dispose();
  const a = new KessenCameo('a', anchor, { tableau: 'witness' });
  const b = new KessenCameo('b', anchor, { tableau: 'witness' }, true);
  assert.equal(a.frames.length, 2);
  assert.deepEqual(a.frames.map((f: any) => f.height), [7.2, 11.5]);
  const flags = new Set<string>();
  const context = (time: number) => ({ time, dt: 1 / 60, flags, setFlag: () => assert.fail('cameo emitted a story flag') });
  a.update(context(1)); a.update(context(8)); b.update(context(8));
  const pose = (p: any) => p.frames.flatMap((f: any) => Object.values(f.bones).map((bone: any) => bone.matrixWorld.elements));
  assert.deepEqual(pose(a), pose(b), 'pose is independent of intermediate rendered frames');
  assert.equal(flags.size, 0);
  a.dispose(); b.dispose();
});

test('cameos: first jump releases geometry exactly once and preserves shared frame material', async () => {
  const { KessenCameo } = await load();
  const p = new KessenCameo('witness', new Vector3(), { tableau: 'witness', hideWhenFlag: 'leg2' }, true);
  const root = new Group(); root.add(p.group);
  const geometries = new Set<any>();
  p.group.traverse((o: any) => { if (o.geometry) geometries.add(o.geometry); });
  let disposals = 0, sharedDisposals = 0;
  for (const g of geometries) g.addEventListener('dispose', () => disposals++);
  const shared = p.frames[0].meshes[0].material;
  const onShared = () => sharedDisposals++;
  shared.addEventListener('dispose', onShared);
  const context = { time: 40, flags: new Set(['leg2']) };
  p.update(context); p.update(context); p.dispose();
  assert.equal(disposals, geometries.size);
  assert.equal(sharedDisposals, 0);
  assert.equal(root.children.length, 0);
  assert.equal(p.group.children.length, 0);
  assert.equal(p.frames.length, 0);
  shared.removeEventListener('dispose', onShared);
});

test('cameos: rescue module clears actual lifeboat flight and arrival turns', async () => {
  const { KessenCameo } = await load();
  const { Fleet } = await server!.ssrLoadModule('/src/sim/Fleet.ts');
  const { flyToPoint, createPilotState } = await server!.ssrLoadModule('/src/sim/ai/Pilot.ts');
  const mission = MISSIONS[9];
  const spec = mission.setpieces.find((p) => p.kind === 'kessen-cameo')!;
  const lane = new Vector3(...mission.setpieces.find((p) => p.tag === 'lane')!.place.offset!);
  const bastion = new Vector3(...mission.setpieces.find((p) => p.tag === 'bastion')!.place.offset!);
  const escort = mission.spawns.find((s) => s.tag === 'lifeboats')!;
  const base = bastion.clone().add(new Vector3(...escort.place.offset!));
  const piece = new KessenCameo('clearance', lane.clone().add(new Vector3(...spec.place.offset!)), spec.params, true);
  const bounds = new Box3().setFromObject(piece.group).getBoundingSphere(new Sphere());
  const fleet = new Fleet(new Group());
  let minimumGap = Infinity;
  for (let member = 0; member < escort.count; member++) {
    const start = base.clone().add(new Vector3(member * 60, member * 12, -member * 45));
    const ship = fleet.spawn(escort.blueprint, escort.faction, start, new Vector3(0, 0, 1));
    ship.flight.velocity.set(0, 0, 0); ship.flight.throttle = 0;
    const pilot = createPilotState();
    // Production CampaignSession escort steering, including arrival turns.
    for (let tick = 0; tick < 18000; tick++) {
      flyToPoint(ship.controls, ship.flight, lane, 60, pilot, 1 / 60);
      ship.flight.step(ship.controls, 1 / 60);
      minimumGap = Math.min(minimumGap, ship.flight.position.distanceTo(bounds.center) - ship.radius - bounds.radius);
    }
  }
  assert.ok(minimumGap > 20, `conservative sphere clearance ${minimumGap.toFixed(1)} m`);
  console.log(`Kessen module / actual lifeboat route: minimum conservative clearance ${minimumGap.toFixed(1)} m`);
  piece.dispose();
  for (const ship of fleet.ships) ship.model.root.traverse((o: any) => o.geometry?.dispose());
});
