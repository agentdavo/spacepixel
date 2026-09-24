import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { createServer, type ViteDevServer } from 'vite';
import {
  FIRE_TOL,
  IDLE_SCAN,
  aimAngles,
  aimError,
  barrelDir,
  createDrive,
  gateTolerance,
  muzzleLocal,
  nextMuzzle,
  reachable,
  restoreDrive,
  rigFromInfo,
  slewAngle,
  slewRate,
  stepDrive,
  wrapAngle,
  wreckDrive,
  type TurretRig,
} from '../src/sim/TurretRig.ts';

/**
 * Turret drive math (src/sim/TurretRig.ts): slew limits, the fire gate,
 * idle / wreck poses and muzzle kinematics — and that the sim's muzzle math
 * agrees with the built model's joints (ShipBuilder rigs every turret).
 */
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);
const DEG = Math.PI / 180;

/** A twin mount on a deck at (0, 10, 0), facing +Z, trunnion 2 m up and 1 m forward, 8 m barrels 1 m apart. */
function rig(traverse: [number, number] = [-Math.PI, Math.PI], elevation: [number, number] = [-8 * DEG, 80 * DEG], radius = 4): TurretRig {
  return rigFromInfo({
    socket: 'test',
    yaw: 'test',
    pitch: 'test/el',
    base: new Vector3(0, 10, 0),
    up: new Vector3(0, 1, 0),
    fwd: new Vector3(0, 0, 1),
    pivot: new Vector3(0, 12, 1),
    tips: [new Vector3(-0.5, 12, 9), new Vector3(0.5, 12, 9)],
    radius,
    traverse,
    elevation,
  });
}

test('slew rate: heavier mounts train slower, clamped', () => {
  assert.ok(slewRate(1) > slewRate(5) && slewRate(5) > slewRate(25) && slewRate(25) > slewRate(90));
  near(slewRate(1e6), 12 * DEG, 1e-9, 'floor');
  near(slewRate(0.01), 200 * DEG, 1e-9, 'ceiling');
});

test('slewAngle: rate-limited, short way round all-round, never through a dead zone', () => {
  // Rate limit.
  near(slewAngle(0, 1, 0.5, 0.1, true, -Math.PI, Math.PI), 0.05);
  near(slewAngle(0, 0.01, 0.5, 0.1, true, -Math.PI, Math.PI), 0.01, 1e-12, 'arrives without overshoot');
  // All round: 170° → −170° goes through 180°, not back through 0.
  const a = slewAngle(170 * DEG, -170 * DEG, 1, 0.05, true, -Math.PI, Math.PI);
  assert.ok(a > 170 * DEG || a < -170 * DEG, `wrapped: ${a / DEG}`);
  near(wrapAngle(a - 170 * DEG), 0.05, 1e-9);
  // Limited arc ±150°: from +140° to −140° must swing back through 0 (the long way), not across the stern.
  const b = slewAngle(140 * DEG, -140 * DEG, 1, 0.05, false, -150 * DEG, 150 * DEG);
  near(b, 140 * DEG - 0.05, 1e-9);
  // A wish outside the arc is clamped to the stop.
  let c = 140 * DEG;
  for (let i = 0; i < 100; i++) c = slewAngle(c, 175 * DEG, 1, 0.05, false, -150 * DEG, 150 * DEG);
  near(c, 150 * DEG, 1e-9);
});

test('aim angles round-trip through the barrel direction', () => {
  const r = rig();
  const out = { yaw: 0, pitch: 0 };
  const d = new Vector3();
  for (const [y, p] of [
    [0, 0],
    [0.7, 0.2],
    [-2.5, 1.1],
    [3, -0.1],
  ]) {
    barrelDir(r, y, p, d);
    near(d.length(), 1, 1e-12);
    aimAngles(r, d, out);
    near(out.yaw, y, 1e-9, 'yaw');
    near(out.pitch, p, 1e-9, 'pitch');
    near(aimError(r, y, p, d), 0, 1e-6);
  }
  // + yaw turns from fwd toward side (up × fwd = +X here), + pitch raises toward up.
  barrelDir(r, Math.PI / 2, 0, d);
  near(d.x, 1, 1e-12);
  barrelDir(r, 0, Math.PI / 2, d);
  near(d.y, 1, 1e-12);
});

test('drive: slews at its rate, converges, and the gate opens only on the solution', () => {
  const r = rig();
  const d = createDrive();
  const want = new Vector3(1, 0.3, -0.2).normalize(); // abaft the beam, elevated
  const dt = 1 / 60;
  let err = stepDrive(r, d, want, dt);
  near(Math.abs(d.yaw), r.yawRate * dt, 1e-9, 'one step of traverse');
  assert.ok(err > FIRE_TOL, 'not on target after one step');
  let t = dt;
  let prev = err;
  while (err > 1e-6 && t < 10) {
    err = stepDrive(r, d, want, dt);
    assert.ok(err <= prev + 1e-9, 'error never grows toward a fixed solution');
    prev = err;
    t += dt;
  }
  near(err, 0, 1e-6);
  // Time to train ≈ the bigger of the two swings over their rates.
  const out = { yaw: 0, pitch: 0 };
  aimAngles(r, want, out);
  const expect = Math.max(Math.abs(out.yaw) / r.yawRate, Math.abs(out.pitch) / r.pitchRate);
  near(t, expect, 2 * dt, 'train time');
  // A heavier mount takes longer.
  const heavy = rig(undefined, undefined, 80);
  const h = createDrive();
  let th = 0;
  while (stepDrive(heavy, h, want, dt) > FIRE_TOL && th < 60) th += dt;
  assert.ok(th > t * 2, `heavy mount ${th.toFixed(2)} s vs ${t.toFixed(2)} s`);
});

test('drive: a target outside the arcs is never on the gate', () => {
  const r = rig([-150 * DEG, 150 * DEG], [-5 * DEG, 60 * DEG]);
  const out = { yaw: 0, pitch: 0 };
  const astern = new Vector3(0.05, 0.1, -1).normalize();
  const below = new Vector3(0.3, -0.5, 1).normalize();
  for (const w of [astern, below]) {
    aimAngles(r, w, out);
    assert.equal(reachable(r, out.yaw, out.pitch), false);
    const d = createDrive();
    let best = Infinity;
    for (let i = 0; i < 1200; i++) best = Math.min(best, stepDrive(r, d, w, 1 / 60));
    assert.ok(best > gateTolerance(20, 1000), `best error ${best}`);
    assert.ok(d.yaw >= -150 * DEG - 1e-9 && d.yaw <= 150 * DEG + 1e-9 && d.pitch >= -5 * DEG - 1e-9, 'stays inside its limits');
  }
});

test('gate tolerance: 2° floor, opens up for big hulls up close', () => {
  near(gateTolerance(10, 2000), FIRE_TOL);
  assert.ok(gateTolerance(300, 1000) > 0.15);
  assert.ok(gateTolerance(5000, 10) <= 0.2);
});

test('idle: home to rest, then a slow scan inside the arc', () => {
  const r = rig([-40 * DEG, 150 * DEG]);
  const d = createDrive();
  d.yaw = 1;
  d.pitch = 0.5;
  for (let t = 0; t < IDLE_SCAN - 0.1; t += 1 / 60) assert.equal(stepDrive(r, d, null, 1 / 60), Infinity);
  near(d.yaw, 0, 1e-9, 'home');
  near(d.pitch, 0, 1e-9);
  let lo = 0;
  let hi = 0;
  for (let t = 0; t < 40; t += 1 / 60) {
    stepDrive(r, d, null, 1 / 60);
    lo = Math.min(lo, d.yaw);
    hi = Math.max(hi, d.yaw);
  }
  assert.ok(hi - lo > 0.3, 'scans');
  assert.ok(lo >= -40 * DEG && hi <= 150 * DEG, 'inside the arc');
});

test('muzzles: rest tips, elevation about the trunnion, traverse about the mount, alternating barrels', () => {
  const r = rig();
  const m = new Vector3();
  muzzleLocal(r, 0, 0, 0, m);
  near(m.distanceTo(new Vector3(-0.5, 12, 9)), 0, 1e-9, 'rest tip 0');
  muzzleLocal(r, 0, 0, 1, m);
  near(m.distanceTo(new Vector3(0.5, 12, 9)), 0, 1e-9, 'rest tip 1');
  // Guns straight up: the tip sits 8 m above the trunnion.
  muzzleLocal(r, 0, Math.PI / 2, 0, m);
  near(m.distanceTo(new Vector3(-0.5, 20, 1)), 0, 1e-9, 'elevated');
  // Trained to starboard (+X): trunnion swings to x = 1, barrels along +X.
  muzzleLocal(r, Math.PI / 2, 0, 1, m);
  near(m.distanceTo(new Vector3(9, 12, -0.5)), 0, 1e-9, 'trained');
  // Any pose: the tip is barrel-length along the barrel from the (turned) trunnion.
  const piv = new Vector3();
  const dir = new Vector3();
  for (const [y, p] of [
    [0.4, 0.3],
    [-2, 1],
  ]) {
    muzzleLocal(r, y, p, 0, m);
    barrelDir(r, y, p, dir);
    piv.set(Math.sin(y), 12, Math.cos(y));
    const off = m.clone().sub(piv);
    near(off.dot(dir), 8, 1e-9, 'along the barrel');
  }
  const d = createDrive();
  const a = nextMuzzle(r, d, new Vector3()).clone();
  const b = nextMuzzle(r, d, new Vector3()).clone();
  const c = nextMuzzle(r, d, new Vector3()).clone();
  assert.notEqual(a.x, b.x, 'barrels alternate');
  near(a.distanceTo(c), 0, 1e-12, 'and cycle');
  assert.equal(d.recoil, 1, 'each shot kicks the recoil');
});

test('wreck: frozen skewed, guns drooped below the deck line, deaf to aim; repair restores', () => {
  const r = rig([-150 * DEG, 150 * DEG]);
  const d = createDrive();
  d.yaw = 0.3;
  wreckDrive(r, d);
  assert.ok(d.pitch < r.elevation[0], 'drooped');
  assert.ok(Math.abs(d.yaw - 0.3) > 0.15, 'skewed');
  const pose = [d.yaw, d.pitch];
  assert.equal(stepDrive(r, d, new Vector3(0, 0, 1), 1 / 60), Infinity);
  assert.deepEqual([d.yaw, d.pitch], pose, 'frozen');
  const d2 = createDrive();
  d2.yaw = 0.3;
  wreckDrive(r, d2);
  assert.deepEqual([d2.yaw, d2.pitch], pose, 'deterministic');
  restoreDrive(d);
  assert.equal(d.wrecked, false);
  assert.ok(stepDrive(r, d, new Vector3(0, 0, 1), 1 / 60) < 1e-9, 'live again');
});

// ── the built models ──────────────────────────────────────────────────

let server: ViteDevServer | null = null;
after(async () => {
  await server?.close();
});

test('every turret socket is rigged, and the sim muzzles match the model joints', { timeout: 240_000 }, async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  const THREE = await server.ssrLoadModule('three');
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { stationBlueprint } = await server.ssrLoadModule('/src/assets/blueprints/stations.ts');
  const TR = await server.ssrLoadModule('/src/sim/TurretRig.ts');
  let rigs = 0;
  for (const bp of [...Object.values(BLUEPRINTS), stationBlueprint('bastion', 'concord', 7)] as { id: string }[]) {
    const model = buildShip(bp);
    for (const [id, o] of model.sockets as Map<string, { userData: { kind: string } }>) {
      if (o.userData.kind !== 'turret') continue;
      const info = model.turrets.get(id);
      assert.ok(info, `${bp.id}: turret "${id}" is rigged`);
      const yaw = model.articulations.get(info.yaw);
      const pitch = model.articulations.get(info.pitch);
      assert.ok(yaw && pitch, `${bp.id}: ${id} has traverse + elevation joints`);
      assert.equal(pitch.node.parent, yaw.node, `${bp.id}: ${id} elevation rides the traverse`);
      assert.ok(yaw.mesh && pitch.mesh, `${bp.id}: ${id} mount and guns are separate meshes`);
      assert.ok(info.traverse[0] <= 0 && info.traverse[1] >= 0 && info.elevation[0] < 0 && info.elevation[1] > 0.5, `${bp.id}: ${id} limits contain the rest pose`);
      // Drive the joints and compare a barrel tip carried by the elevation node with the sim's muzzle.
      const r = TR.rigFromInfo(info);
      const d = TR.createDrive();
      d.yaw = Math.max(info.traverse[0], Math.min(info.traverse[1], 0.9));
      d.pitch = 0.4;
      TR.poseTurret(model, r, d);
      const probe = new THREE.Object3D();
      probe.position.copy(info.tips[0]).sub(info.pivot);
      pitch.node.add(probe);
      model.root.updateMatrixWorld(true);
      const world = probe.getWorldPosition(new THREE.Vector3());
      const sim = TR.muzzleLocal(r, d.yaw, d.pitch, 0, new THREE.Vector3());
      assert.ok(world.distanceTo(sim) < 1e-3 * Math.max(1, model.radius), `${bp.id}: ${id} muzzle sim ${sim.toArray()} vs model ${world.toArray()}`);
      pitch.node.remove(probe);
      rigs++;
    }
  }
  assert.ok(rigs > 60, `rigged turrets: ${rigs}`);
});
