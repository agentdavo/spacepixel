import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Station batteries (src/sim/StationDefence.ts): the bastion's gun mounts as
 * sim turrets on the capitals' machinery — they train before they fire, fire
 * from their barrels, keep to their arcs, hold fire on friends and (free
 * flight ROE) on hostiles that leave them alone, sit under the station's
 * shield facings until those drop, and can be shot out one by one; a
 * station is silenced, never destroyed, and damage control brings guns back.
 */
let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

const DT = 1 / 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let mods: Record<string, Any> | null = null;
async function load(): Promise<Record<string, Any>> {
  if (mods) return mods;
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const L = (p: string) => server!.ssrLoadModule(p);
  const [T, SB, ST, F, W, SD, TR, SS, R] = await Promise.all([
    L('three'),
    L('/src/assets/ShipBuilder.ts'),
    L('/src/assets/blueprints/stations.ts'),
    L('/src/sim/Fleet.ts'),
    L('/src/sim/Weapons.ts'),
    L('/src/sim/StationDefence.ts'),
    L('/src/sim/TurretRig.ts'),
    L('/src/sim/Subsystems.ts'),
    L('/src/sim/Damage.ts'),
  ]);
  mods = { T, SB, ST, F, W, SD, TR, SS, R };
  return mods;
}

/** A bastion at the origin (identity pose: +Z bay end, +Y up) in a fresh world. */
async function world(roe: 'free' | 'defensive' = 'free', faction = 'concord') {
  const m = await load();
  const { T } = m;
  const fleet = new m.F.Fleet(new T.Group());
  const weapons = new m.W.Weapons(fleet);
  const stations = new m.SD.StationDefences(fleet, weapons);
  const model = m.SB.buildShip(m.ST.stationBlueprint('bastion', faction, 7));
  const d = stations.register('bastion', faction, model, new T.Vector3(), new T.Quaternion(), { roe });
  /** A parked ship (no flight step runs: it stays exactly where it is put). */
  const park = (bp: string, fac: string, x: number, y: number, z: number, team?: string) => {
    const s = fleet.spawn(bp, fac, new T.Vector3(x, y, z), new T.Vector3(0, 0, 1), team ? { team } : {});
    s.flight.velocity.set(0, 0, 0);
    s.flight.throttle = 0;
    return s;
  };
  const battery = (id: string) => d.batteries.find((b: Any) => b.sub.id === id);
  return { m, T, fleet, weapons, stations, d, park, battery };
}

test('a bastion is armed: every rigged mount a battery and a turret subsystem under its own shield facing; unarmed stations are not', async () => {
  const { m, d, T, fleet, stations } = await world();
  assert.equal(d.batteries.length, 6);
  assert.ok(d.id < 0, 'bolt owner id never collides with a ship');
  for (const b of d.batteries) {
    assert.equal(b.sub.kind, 'turret');
    assert.ok(d.dmg.subsystems.includes(b.sub));
    assert.ok(b.rig.tips.length === 2, `${b.sub.id}: twin barrels from the model`);
    assert.ok(!m.SS.subsystemExposed(d.dmg, d.pools.shield, b.sub), `${b.sub.id}: protected while its facing holds`);
  }
  // Each face's guns sit under that face's facing.
  const facing = (id: string) => m.R.facingOf(d.dmg, d.batteries.find((b: Any) => b.sub.id === id).sub);
  assert.equal(facing('top'), m.R.FACING.DORSAL);
  assert.equal(facing('bottom'), m.R.FACING.VENTRAL);
  assert.notEqual(facing('left'), facing('right'));
  const refinery = m.SB.buildShip(m.ST.stationBlueprint('refinery', 'concord', 7));
  assert.equal(stations.register('refinery', 'concord', refinery, new T.Vector3(), new T.Quaternion()), null);
  assert.equal(fleet.installations, stations);
});

test('a battery traverses onto the target before it fires, and fires from its barrels', async () => {
  const { T, m, d, stations, weapons, park, battery } = await world();
  // Abeam of the top battery: ~90° of traverse from its rest bearing, 27° up.
  park('choir-cantor', 'choir', 900, 700, 40);
  const top = battery('top');
  const tol = m.TR.gateTolerance(10, 1000);
  let first = -1;
  const mz = new T.Vector3();
  for (let i = 0; i < 60 * 8 && first < 0; i++) {
    const barrel = top.drive.barrel;
    stations.step(DT);
    if (top.drive.recoil === 1) {
      first = i * DT;
      // The bolt left from the barrel's muzzle at the drive's current pose.
      m.TR.muzzleLocal(top.rig, top.drive.yaw, top.drive.pitch, barrel, mz);
      let found = false;
      for (let k = 0; k < weapons.life.length; k++) {
        if (weapons.owner[k] !== d.id || weapons.life[k] !== Math.fround(d.gun.life)) continue;
        if (Math.hypot(weapons.px[k] - mz.x, weapons.py[k] - mz.y, weapons.pz[k] - mz.z) < 1e-6) found = true;
      }
      assert.ok(found, 'a bolt spawned at the muzzle');
      assert.ok(mz.distanceTo(new T.Vector3(top.sub.x, top.sub.y, top.sub.z)) > 60, 'muzzle is out at the barrel tips, not the mount centre');
      // Barrels were on the solution when it fired.
      const want = top.sol.aimDir.clone();
      assert.ok(m.TR.aimError(top.rig, top.drive.yaw, top.drive.pitch, want) <= Math.max(tol, 0.2));
    }
    weapons.step(DT);
  }
  // 90° at ~27°/s: no shot inside the first 2.5 s of training.
  assert.ok(first > 2.5, `first shot at ${first.toFixed(2)} s`);
  assert.ok(Math.abs(top.drive.yaw - Math.PI / 2) < 0.1, `trained to the beam (${top.drive.yaw.toFixed(2)})`);
});

test('batteries keep to their arcs: a target under the keel is the ventral guns\' — the dorsal ones never lay on it', async () => {
  const { m, stations, weapons, park, battery } = await world();
  park('choir-cantor', 'choir', 0, -1500, 400);
  const top = battery('top');
  const topAft = battery('top-aft');
  const bottom = battery('bottom');
  const dir = (b: Any) => {
    const v = { x: 0 - b.sub.x, y: -1500 - b.sub.y, z: 400 - b.sub.z };
    const l = Math.hypot(v.x, v.y, v.z);
    const o = { yaw: 0, pitch: 0 };
    m.TR.aimAngles(b.rig, { dot: (u: Any) => (v.x * u.x + v.y * u.y + v.z * u.z) / l } as Any, o);
    return o;
  };
  // (aimAngles only reads dot products against the rig axes.)
  for (const b of [top, topAft]) {
    const a = dir(b);
    assert.ok(!m.TR.reachable(b.rig, a.yaw, a.pitch), `${b.sub.id}: target outside its arcs`);
  }
  const fired = new Map<string, number>();
  for (let i = 0; i < 60 * 10; i++) {
    stations.step(DT);
    for (const b of [top, topAft, bottom]) {
      if (b.drive.recoil === 1) fired.set(b.sub.id, (fired.get(b.sub.id) ?? 0) + 1);
      assert.ok(b.drive.pitch >= b.rig.elevation[0] - 1e-9 && b.drive.pitch <= b.rig.elevation[1] + 1e-9, `${b.sub.id}: inside its elevation limits`);
      assert.ok(b.drive.yaw >= b.rig.traverse[0] - 1e-9 && b.drive.yaw <= b.rig.traverse[1] + 1e-9, `${b.sub.id}: inside its traverse limits`);
    }
    for (const b of [top, topAft]) assert.equal(b.laid, false, `${b.sub.id} never lays on it`);
    weapons.step(DT);
  }
  assert.equal(fired.get('top') ?? 0, 0);
  assert.equal(fired.get('top-aft') ?? 0, 0);
  assert.ok((fired.get('bottom') ?? 0) > 3, `the ventral battery engages (${fired.get('bottom') ?? 0} shots)`);
});

test('no fire on friends or neutrals; free-flight ROE holds on hostiles until they open fire on the station', async () => {
  {
    const { stations, weapons, park, d } = await world('free');
    park('vf27-kestrel', 'concord', 900, 700, 40);
    park('choir-cantor', 'choir', -900, 700, 40, 'neutral');
    let shots = 0;
    for (let i = 0; i < 60 * 8; i++) {
      stations.step(DT);
      weapons.step(DT);
      for (const e of weapons.events) if (e.kind === 'fire') shots++;
    }
    assert.equal(shots, 0, 'friendly and neutral hulls in arc: guns silent');
    for (const b of d.batteries) assert.equal(b.laid, false);
  }
  {
    const { T, stations, weapons, park, d } = await world('defensive');
    const c = park('choir-cantor', 'choir', 900, 700, 40);
    const run = (n: number) => {
      let shots = 0;
      for (let i = 0; i < n; i++) {
        stations.step(DT);
        weapons.step(DT);
        for (const e of weapons.events) if (e.kind === 'fire') shots++;
      }
      return shots;
    };
    assert.equal(run(60 * 6), 0, 'a hostile minding its own business is left alone');
    // It opens fire on the station: a bolt into the shield shell.
    const from = c.flight.position.clone();
    const vel = new T.Vector3(0, 242, 40).sub(from).normalize().multiplyScalar(1400);
    weapons.spawnBolt(from, vel, 2, 10, c);
    const pre = d.pools.shield;
    let shieldEvents = 0;
    for (let i = 0; i < 60; i++) {
      weapons.step(DT);
      for (const e of weapons.events) if (e.kind === 'shield' && e.ship === null) shieldEvents++;
    }
    assert.equal(shieldEvents, 1, 'the shell took the bolt');
    assert.ok(d.pools.shield < pre);
    assert.ok(d.aggressors.has(c.id));
    assert.ok(run(60 * 8) > 0, 'now the batteries answer');
  }
  {
    // Attacking the station's own side under its guns draws fire too.
    const { stations, weapons, park } = await world('defensive');
    const c = park('choir-cantor', 'choir', 900, 700, 40);
    const k = park('vf27-kestrel', 'concord', 1400, 900, 40);
    c.target = k;
    let shots = 0;
    for (let i = 0; i < 60 * 8; i++) {
      stations.step(DT);
      weapons.step(DT);
      for (const e of weapons.events) if (e.kind === 'fire') shots++;
    }
    assert.ok(shots > 0);
  }
});

test('batteries are targetable once their facing is down and can be shot out; a silenced station is never destroyed; damage control restores guns', async () => {
  const { T, m, d, stations, weapons, park, battery } = await world();
  const shooter = park('vf27-kestrel', 'choir', 0, 3000, -3000, 'choir');
  const top = battery('top');
  const idx = d.dmg.subsystems.indexOf(top.sub);
  const at = (b: Any) => new T.Vector3(b.sub.x, b.sub.y, b.sub.z);
  /** One heavy bolt straight down the battery's mount normal from 1.5 km. */
  const fireAt = (b: Any, dmg: number) => {
    const target = at(b);
    const from = target.clone().addScaledVector(b.rig.up, 1500);
    weapons.spawnBolt(from, b.rig.up.clone().multiplyScalar(-1400), 2, dmg, shooter);
    const ev: Any[] = [];
    for (let i = 0; i < 90; i++) {
      weapons.step(DT);
      for (const e of weapons.events) if (e.ship === null && (e.kind === 'hit' || e.kind === 'shield' || e.kind === 'subsystem')) ev.push({ kind: e.kind, sub: e.sub, facing: e.facing });
    }
    return ev;
  };
  // Shielded: the facing takes it, the battery is untouched.
  let ev = fireAt(top, 300);
  assert.deepEqual(ev.map((e) => e.kind), ['shield']);
  assert.equal(ev[0].facing, m.R.FACING.DORSAL);
  assert.equal(top.sub.hp, top.sub.hpMax);
  // Knock the dorsal facing down: the dorsal guns are exposed, B cycles them first, fighters pick them.
  d.dmg.facings[m.R.FACING.DORSAL] = 0;
  assert.ok(m.SS.subsystemExposed(d.dmg, d.pools.shield, top.sub));
  assert.ok(!m.SS.subsystemExposed(d.dmg, d.pools.shield, battery('bottom').sub));
  assert.equal(m.SS.nextSubsystem(d.dmg, d.pools.shield, -1, 1), idx, 'B: the exposed dorsal battery first');
  const pick = m.SS.chooseAttackSubsystem(d.dmg, d.pools.shield, 0, 1500, 0, m.SS.FIGHTER_PREFS);
  assert.ok(['top', 'top-aft'].includes(d.dmg.subsystems[pick].id), 'a fighter goes for an exposed dorsal gun');
  // An aimed hit on the mount, then the kill.
  ev = fireAt(top, 300);
  assert.deepEqual(ev.map((e) => e.kind), ['hit']);
  assert.equal(ev[0].sub, top.sub);
  assert.ok(top.sub.hp < top.sub.hpMax);
  ev = fireAt(top, top.sub.hpMax * 2);
  assert.deepEqual(ev.map((e) => e.kind), ['hit', 'subsystem']);
  assert.equal(top.sub.destroyed, true);
  assert.equal(top.sub.wreck, 'blown');
  // Wrecked: the rig freezes drooped and the gun never fires again.
  park('choir-cantor', 'choir', 900, 700, 40);
  let topShots = 0;
  for (let i = 0; i < 60 * 8; i++) {
    stations.step(DT);
    if (top.drive.recoil === 1) topShots++;
    weapons.step(DT);
  }
  assert.equal(top.drive.wrecked, true);
  assert.ok(top.drive.pitch < top.rig.elevation[0]);
  assert.equal(topShots, 0);
  assert.equal(m.SD.stationGuns(d).online, 5);
  // Shoot out the rest: silenced, not destroyed.
  d.dmg.facings.fill(0);
  for (const b of d.batteries) if (!b.sub.destroyed) fireAt(b, b.sub.hpMax * 2);
  const g = m.SD.stationGuns(d);
  assert.deepEqual(g, { online: 0, total: 6, silenced: true });
  assert.ok(d.pools.hull >= 1);
  assert.ok(stations.list.includes(d));
  let shots = 0;
  for (let i = 0; i < 60 * 5; i++) {
    stations.step(DT);
    weapons.step(DT);
    for (const e of weapons.events) if (e.kind === 'fire') shots++;
  }
  assert.equal(shots, 0, 'a silenced station holds fire');
  // Damage control (the ships' rule): after REPAIR.restoreAfter s without a hit, a gun comes back and trains again.
  const R = m.SS.REPAIR;
  for (let t = 0; t < R.restoreAfter + 1; t += DT) stations.step(DT);
  const back = d.batteries.filter((b: Any) => !b.sub.destroyed);
  assert.equal(back.length, 1);
  stations.step(DT);
  assert.equal(back[0].drive.wrecked, false);
  const frac = back[0].sub.hp / back[0].sub.hpMax;
  assert.ok(frac >= R.restoreHp && frac < R.restoreHp + 0.1, `restored at ${frac.toFixed(3)} of max`);
});

test('sync arms the system\'s stations in order, leaves unarmed ones alone and drops those that leave', async () => {
  const m = await load();
  const { T } = m;
  const fleet = new m.F.Fleet(new T.Group());
  const stations = new m.SD.StationDefences(fleet, new m.W.Weapons(fleet));
  const st = (kind: string, id: string, x: number) => ({ site: { id, faction: 'concord' }, model: m.SB.buildShip(m.ST.stationBlueprint(kind, 'concord', 7)), center: new T.Vector3(x, 0, 0), quaternion: new T.Quaternion(), defence: null as Any });
  const a = st('bastion', 'a', 0);
  const b = st('refinery', 'b', 20000);
  const c = st('bastion', 'c', 40000);
  stations.sync([a, b, c]);
  assert.deepEqual(stations.list.map((d: Any) => d.key), ['a', 'c']);
  assert.ok(a.defence && c.defence && b.defence === null);
  assert.ok(a.defence.position.equals(a.center));
  const first = a.defence;
  stations.sync([a, b, c]);
  assert.equal(a.defence, first, 'unchanged list: nothing rebuilt');
  stations.sync([b, c]);
  assert.deepEqual(stations.list.map((d: Any) => d.key), ['c']);
  assert.equal(a.defence, null, 'a dropped station goes back to its idle scan');
  stations.sync([]);
  assert.equal(stations.list.length, 0);
  assert.equal(c.defence, null, 'a campaign (empty list) disarms every station');
});
