import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACING, addSubsystem, applyHit, createDamageState, facingOf, hitSubsystem, type DamageState, type Pools, type Subsystem } from '../src/sim/Damage.ts';
import {
  AIM_SPHERE,
  BOMBER_PREFS,
  FIGHTER_PREFS,
  REPAIR,
  SPLASH_CAP,
  SPLASH_FRAC,
  chooseAttackSubsystem,
  exposedCount,
  nextSubsystem,
  repairSubsystems,
  segmentSubsystem,
  splashSubsystems,
  subsystemExposed,
  subsystemNearestRay,
  type SegmentSubHit,
} from '../src/sim/Subsystems.ts';

/**
 * Subsystem targeting and destruction (src/sim/Subsystems.ts): exposure by
 * shield facing, B-cycling that prefers exposed mounts, the crosshair pick,
 * aimed-hit spheres, blast splash, AI mount choice, damage control.
 *
 * Test hull: 400 m long, 100 m wide (ship-local +Z nose, +X port).
 */
const EXT = { cx: 0, cy: 0, cz: 0, halfW: 50, halfH: 30, halfL: 200 };

function capital(): { st: DamageState; pools: Pools; subs: Record<string, Subsystem> } {
  const st = createDamageState(true, 4000, 10000, EXT, 0.05, 5);
  const pools: Pools = { hull: 10000, hullMax: 10000, shield: 4000, shieldMax: 4000 };
  const add = (id: string, kind: Subsystem['kind'], x: number, y: number, z: number, radius = 10, hpMax = 200) => addSubsystem(st, { id, kind, label: id.toUpperCase(), x, y, z, radius, hpMax });
  const subs = {
    // Port flank (x > 0), a cluster of three.
    t0: add('t0', 'turret', 50, 10, 0),
    t1: add('t1', 'turret', 50, 10, 25),
    t2: add('t2', 'turret', 50, 10, -25),
    // Starboard flank.
    t3: add('t3', 'turret', -50, 10, 0),
    // Bow and stern.
    lance: add('lance', 'lance', 0, 10, 190, 12, 300),
    engine: add('engine', 'engine', 0, 0, -195, 15, 300),
    gen: add('gen', 'shieldGen', 0, 30, -60, 12, 400),
  };
  return { st, pools, subs };
}

const idx = (st: DamageState, s: Subsystem) => st.subsystems.indexOf(s);

test('exposure follows the shield facing that covers the mount (Damage.facingOf)', () => {
  const { st, subs } = capital();
  assert.equal(facingOf(st, subs.t0), FACING.PORT);
  assert.equal(facingOf(st, subs.t3), FACING.STBD);
  assert.equal(exposedCount(st, 4000), 0);
  st.facings[FACING.PORT] = 0;
  assert.ok(subsystemExposed(st, 4000, subs.t0));
  assert.ok(subsystemExposed(st, 4000, subs.t1));
  assert.ok(!subsystemExposed(st, 4000, subs.t3), 'starboard still shielded');
  assert.ok(!subsystemExposed(st, 4000, subs.lance), 'bow still shielded');
  assert.equal(exposedCount(st, 4000), 3);
  // A regenerating facing (any shield left) protects again.
  st.facings[FACING.PORT] = 1;
  assert.ok(!subsystemExposed(st, 4000, subs.t0));
});

test('exposure on a single-bubble hull (gunship mounts): the bubble is down', () => {
  const st = createDamageState(false, 200, 600, EXT, 0.1, 3);
  const s = addSubsystem(st, { id: 'turret-dorsal', kind: 'turret', label: 'TURRET 1', x: 0, y: 5, z: 0, radius: 4, hpMax: 40 });
  assert.ok(!subsystemExposed(st, 50, s));
  assert.ok(subsystemExposed(st, 0, s));
});

test('B cycles exposed mounts first, then protected, then deselects; Shift+B runs it backwards', () => {
  const { st, subs } = capital();
  st.facings[FACING.PORT] = 0;
  st.facings[FACING.AFT] = 0; // engine (z −195) is aft; the generator (z −60, top centre) is aft too
  const order: number[] = [];
  let cur = -1;
  for (let n = 0; n < 20; n++) {
    cur = nextSubsystem(st, 4000, cur, 1);
    if (cur < 0) break;
    order.push(cur);
  }
  const exposed = [subs.t0, subs.t1, subs.t2, subs.engine, subs.gen].map((s) => idx(st, s));
  const shielded = [subs.t3, subs.lance].map((s) => idx(st, s));
  assert.deepEqual(order, [...exposed, ...shielded]);
  // Backwards from none: the last protected mount first.
  const back: number[] = [];
  cur = -1;
  for (let n = 0; n < 20; n++) {
    cur = nextSubsystem(st, 4000, cur, -1);
    if (cur < 0) break;
    back.push(cur);
  }
  assert.deepEqual(back, [...order].reverse());
  // Destroyed mounts are skipped.
  subs.t1.destroyed = true;
  assert.equal(nextSubsystem(st, 4000, idx(st, subs.t0), 1), idx(st, subs.t2));
});

test('crosshair pick: the mount nearest the sight line; exposed beats protected at a similar angle; nothing outside the cone', () => {
  const { st, subs } = capital();
  // Shooter 600 m off the port beam, level with the turrets, looking at t0.
  assert.equal(subsystemNearestRay(st, 4000, 650, 10, 0, -1, 0, 0, 0.2), idx(st, subs.t0));
  // Two mounts near the bow either side of the sight line: A in the fore facing's patch, B in the port one.
  const st2 = createDamageState(true, 4000, 10000, EXT, 0.05, 5);
  const a = addSubsystem(st2, { id: 'a', kind: 'turret', label: 'A', x: 40, y: 10, z: 170, radius: 6, hpMax: 100 });
  const b = addSubsystem(st2, { id: 'b', kind: 'turret', label: 'B', x: 50, y: 10, z: 150, radius: 6, hpMax: 100 });
  assert.equal(facingOf(st2, a), FACING.FORE);
  assert.equal(facingOf(st2, b), FACING.PORT);
  const pick = () => st2.subsystems[subsystemNearestRay(st2, 4000, 650, 10, 160, -1, 0, 0, 0.2)];
  st2.facings[FACING.PORT] = 0;
  assert.equal(pick(), b);
  st2.facings[FACING.PORT] = 1000;
  st2.facings[FACING.FORE] = 0;
  assert.equal(pick(), a);
  // Looking straight up: nothing.
  assert.equal(subsystemNearestRay(st, 4000, 650, 10, 0, 0, 1, 0, 0.2), -1);
});

test('aimed hits: a segment that passes over the plating still meets the turret sphere; the plating in front blocks it', () => {
  const { st, subs } = capital();
  const out: SegmentSubHit = { t: 0, c: 0 };
  // From 400 m off the port side, level with t1 (y 10) and aimed at it.
  const hit = segmentSubsystem(st.subsystems, 450, 10, 25, -420, 0, 0, 0, 1, out);
  assert.equal(hit, subs.t1);
  const r = subs.t1.radius * AIM_SPHERE;
  assert.ok(Math.abs(out.t - (400 - r) / 420) < 1e-9, 'enters at the sphere');
  assert.ok(Math.abs(out.c - 400 / 420) < 1e-9, 'reports the closest pass (the mount)');
  // The same shot, but the plating is hit first (tMax before the sphere): no aimed hit.
  assert.equal(segmentSubsystem(st.subsystems, 450, 10, 25, -420, 0, 0, 0, 0.5, out), null);
  // A miss by more than the sphere (plus pad) is a miss; a beam's pad makes it a hit.
  assert.equal(segmentSubsystem(st.subsystems, 450, 10 + r + 2, 25, -420, 0, 0, 0, 1, out), null);
  assert.equal(segmentSubsystem(st.subsystems, 450, 10 + r + 2, 25, -420, 0, 0, 2.5, 1, out), subs.t1);
  // Destroyed mounts are no longer targets.
  subs.t1.destroyed = true;
  assert.equal(segmentSubsystem(st.subsystems, 450, 10, 25, -420, 0, 0, 0, 1, out), null);
});

test('aimed hits route to the struck mount even when another is nearer the reported point', () => {
  const { st, pools, subs } = capital();
  st.facings[FACING.PORT] = 0;
  // A point right on t0 would route to t0; the aimed hit says t1.
  const r = applyHit(st, pools, { amount: 100, type: 'laser', local: { x: subs.t0.x, y: subs.t0.y, z: subs.t0.z }, sub: subs.t1 });
  assert.equal(r.subsystem, subs.t1);
  assert.equal(subs.t1.hp, 100);
  assert.equal(subs.t0.hp, 200);
  // A destroyed aimed mount falls back to the nearest intact one.
  subs.t1.destroyed = true;
  const r2 = applyHit(st, pools, { amount: 50, type: 'laser', local: { x: subs.t0.x, y: subs.t0.y, z: subs.t0.z }, sub: subs.t1 });
  assert.equal(r2.subsystem, subs.t0);
});

test('blast splash: every mount within the radius, linear falloff from its edge, capped per burst; the struck one is skipped', () => {
  const { st, pools, subs } = capital();
  const out: Subsystem[] = [];
  const R = 60;
  const amount = 800;
  const total = splashSubsystems(st, pools, 50, 10, 0, R, amount, 'explosive', subs.t0, out);
  assert.equal(subs.t0.hp, 200, 'direct-hit mount skipped');
  // t1 / t2: 25 m away, edge at 25 − 6 = 19 m.
  const raw = amount * SPLASH_FRAC * (1 - (25 - subs.t1.radius * AIM_SPHERE) / R) * 1.6;
  const want = Math.min(raw, subs.t1.hpMax * SPLASH_CAP);
  assert.ok(Math.abs(200 - subs.t1.hp - want) < 1e-9, `t1 took ${200 - subs.t1.hp}, want ${want}`);
  assert.equal(subs.t1.hp, subs.t2.hp, 'symmetric');
  assert.ok(!subs.t1.destroyed, 'the cap keeps one burst from finishing a mount');
  assert.equal(subs.t3.hp, 200, 'far flank untouched');
  assert.equal(subs.lance.hp, 300, 'out of radius');
  assert.ok(total > 0 && out.length === 0);
  // A second burst finishes the cluster.
  splashSubsystems(st, pools, 50, 10, 0, R, amount, 'explosive', null, out);
  assert.deepEqual(new Set(out), new Set([subs.t0, subs.t1, subs.t2].filter((s) => s.destroyed)));
  assert.ok(subs.t1.destroyed && subs.t2.destroyed);
  // Nothing without a radius.
  assert.equal(splashSubsystems(st, pools, 0, 30, -60, 0, amount, 'explosive', null, out), 0);
});

test('a shield generator lost to splash drops every facing, like a direct hit', () => {
  const { st, pools, subs } = capital();
  const out: Subsystem[] = [];
  subs.gen.hp = 10;
  splashSubsystems(st, pools, 0, 30, -60, 40, 800, 'explosive', null, out);
  assert.ok(subs.gen.destroyed);
  assert.deepEqual(st.facings, [0, 0, 0, 0]);
  assert.equal(pools.shield, 0);
  assert.equal(exposedCount(st, 0), st.subsystems.filter((s) => !s.destroyed).length);
  // hitSubsystem reports the kill once.
  assert.equal(hitSubsystem(st, pools, subs.gen, 100), false);
});

test('AI mount choice: nothing while every mount is shielded; fighters strip turrets, bombers go for the generator', () => {
  const { st, subs } = capital();
  const from = { x: 600, y: 60, z: -40 }; // off the port quarter
  assert.equal(chooseAttackSubsystem(st, 4000, from.x, from.y, from.z, FIGHTER_PREFS), -1);
  st.facings[FACING.PORT] = 0;
  st.facings[FACING.AFT] = 0;
  const f = chooseAttackSubsystem(st, 4000, from.x, from.y, from.z, FIGHTER_PREFS);
  assert.equal(st.subsystems[f].kind, 'turret');
  assert.equal(st.subsystems[f], subs.t2, 'the nearest exposed turret');
  const b = chooseAttackSubsystem(st, 4000, from.x, from.y, from.z, BOMBER_PREFS);
  assert.equal(st.subsystems[b], subs.gen);
  // The current pick holds against a slightly nearer one.
  assert.equal(chooseAttackSubsystem(st, 4000, from.x, from.y, from.z + 20, FIGHTER_PREFS, idx(st, subs.t0)), idx(st, subs.t0));
});

test('damage control: damaged mounts heal after a quiet spell; a destroyed turret comes back much later; nothing else does', () => {
  const { st, subs } = capital();
  subs.t0.hp = 100;
  subs.t1.hp = 0;
  subs.t1.destroyed = true;
  subs.lance.hp = 0;
  subs.lance.destroyed = true;
  const dt = 1 / 60;
  // Under fire: nothing.
  for (let t = 0; t < REPAIR.delay - 1; t += dt) repairSubsystems(st, t, dt);
  assert.equal(subs.t0.hp, 100);
  // Quiet for 10 s past the delay: REPAIR.rate × hpMax per second.
  let t = REPAIR.delay;
  for (; t < REPAIR.delay + 10; t += dt) repairSubsystems(st, t, dt);
  assert.ok(Math.abs(subs.t0.hp - (100 + 200 * REPAIR.rate * 10)) < 1, `t0 at ${subs.t0.hp}`);
  assert.ok(subs.t1.destroyed, 'no restore yet');
  let restored: Subsystem | null = null;
  for (; t < REPAIR.restoreAfter + 1; t += dt) restored = repairSubsystems(st, t, dt) ?? restored;
  assert.equal(restored, subs.t1);
  assert.ok(!subs.t1.destroyed);
  assert.ok(subs.t1.hp >= subs.t1.hpMax * REPAIR.restoreHp);
  for (; t < REPAIR.restoreAfter + 3 * REPAIR.restoreEvery; t += dt) repairSubsystems(st, t, dt);
  assert.ok(subs.lance.destroyed, 'lances stay dead');
});
