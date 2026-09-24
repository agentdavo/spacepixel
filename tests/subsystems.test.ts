import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACING, SENSORS_LOST, addSubsystem, applyHit, capitalEffects, createDamageState, facingOf, hitSubsystem, powerLevel, regenShields, type DamageState, type Pools, type Subsystem } from '../src/sim/Damage.ts';
import { stepReactor } from '../src/sim/Structure.ts';
import {
  AIM_SPHERE,
  BOMBER_PREFS,
  CITADELS,
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

test('exposure on a gunship (fore / aft halves): the half the mount sits under', () => {
  const st = createDamageState(false, 200, 600, EXT, 0.1, 3);
  assert.equal(st.facings.length, 2);
  const fore = addSubsystem(st, { id: 'turret-chin', kind: 'turret', label: 'TURRET 1', x: 0, y: -5, z: 120, radius: 4, hpMax: 40 });
  const aft = addSubsystem(st, { id: 'turret-dorsal', kind: 'turret', label: 'TURRET 2', x: 0, y: 5, z: -120, radius: 4, hpMax: 40 });
  assert.equal(facingOf(st, fore), FACING.FORE);
  assert.equal(facingOf(st, aft), FACING.AFT);
  assert.ok(!subsystemExposed(st, 200, fore) && !subsystemExposed(st, 200, aft));
  st.facings[FACING.AFT] = 0;
  assert.ok(!subsystemExposed(st, 100, fore));
  assert.ok(subsystemExposed(st, 100, aft));
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

test('a shield emitter shot off drops its own facing; bombers want emitters most', () => {
  const { st, pools, subs } = capital();
  const em = addSubsystem(st, { id: 'emitter-port', kind: 'shieldEmitter', label: 'PORT EMITTER', x: 50, y: 0, z: -80, radius: 10, hpMax: 150, facing: FACING.PORT });
  assert.equal(chooseAttackSubsystem(st, 4000, 600, 0, -80, BOMBER_PREFS), -1, 'all shielded');
  st.facings[FACING.PORT] = 0;
  assert.equal(st.subsystems[chooseAttackSubsystem(st, 4000, 600, 0, -80, BOMBER_PREFS)], em);
  assert.equal(st.subsystems[chooseAttackSubsystem(st, 4000, 600, 0, -80, FIGHTER_PREFS)].kind, 'turret');
  assert.ok(hitSubsystem(st, pools, em, 200));
  assert.equal(st.facings[FACING.PORT], 0);
  assert.ok(st.facings[FACING.FORE] > 0, 'the other facings hold');
  assert.ok(!subs.gen.destroyed);
});

// ── reactor, sensors, launchers (ported from the lead's subsystems v2) ──

/** The test hull plus a keel reactor, a sensor mast, a launcher and the bridge. */
function withCore() {
  const c = capital();
  const add = (id: string, kind: Subsystem['kind'], x: number, y: number, z: number, hpMax: number) => addSubsystem(c.st, { id, kind, label: id.toUpperCase(), x, y, z, radius: 12, hpMax });
  return {
    ...c,
    reactor: add('reactor', 'reactor', 0, -30, -100, 1200),
    sensors: add('sensors', 'sensors', 0, 30, 150, 150),
    launcher: add('tube', 'launcher', 20, 30, 120, 200),
    bridge: add('bridge', 'bridge', 0, 30, 100, 600),
  };
}
const at = (s: Subsystem) => ({ x: s.x, y: s.y, z: s.z });

test('reactor: hurt → brownout; destroyed → critical (whoever hit her last lit it); left alone the crew vents it', () => {
  const c = withCore();
  c.st.facings.fill(0);
  assert.equal(powerLevel(c.st), 1);
  applyHit(c.st, c.pools, { amount: c.reactor.hpMax * 0.6, type: 'laser', local: at(c.reactor) });
  assert.equal(powerLevel(c.st), 0.75, 'badly hit: brownout');
  assert.equal(capitalEffects(c.st).power, 0.75);
  // Brownout slows shield regeneration.
  const fresh = withCore();
  for (const x of [fresh, c]) {
    x.st.facings.fill(0);
    x.st.cooldown.fill(0);
    regenShields(x.st, x.pools, 99, 1);
  }
  assert.ok(Math.abs(c.st.facings[0] - fresh.st.facings[0] * 0.75) < 1e-6);
  c.st.structure.lastBy = 42;
  applyHit(c.st, c.pools, { amount: c.reactor.hpMax, type: 'explosive', local: at(c.reactor) });
  const R = c.st.structure.reactor;
  assert.ok(c.reactor.destroyed);
  assert.equal(R.phase, 'critical');
  assert.equal(R.by, 42);
  assert.equal(powerLevel(c.st), 0.5);
  let out: string | null = null;
  for (let t = 0; t < R.fuse && !out; t += 0.1) out = stepReactor(c.st.structure, 0.1);
  assert.equal(out, 'vented');
  assert.equal(c.st.structure.pending, null);
});

test('a critical core kept under fire detonates: the kill path is pending', () => {
  const c = withCore();
  c.st.facings.fill(0);
  applyHit(c.st, c.pools, { amount: c.reactor.hpMax, type: 'explosive', local: at(c.reactor) });
  const S = c.st.structure;
  let out: string | null = null;
  for (let t = 0; t < 60 && !out; t += 0.1) {
    // A wing keeps hammering the plating over the core: every hit knocks the venting back.
    applyHit(c.st, c.pools, { amount: 20, type: 'kinetic', local: { x: 4, y: -30, z: -100 } });
    out = stepReactor(S, 0.1);
  }
  assert.equal(out, 'detonated');
  assert.equal(S.pending, 'reactor');
});

test('mount effects: sensors → shorter locks and worse aim, launchers → no salvos', () => {
  const c = withCore();
  let e = capitalEffects(c.st);
  assert.deepEqual([e.sensors, e.launchers], [1, true]);
  hitSubsystem(c.st, c.pools, c.sensors, 1e6);
  hitSubsystem(c.st, c.pools, c.launcher, 1e6);
  e = capitalEffects(c.st);
  assert.equal(e.sensors, SENSORS_LOST);
  assert.equal(e.launchers, false);
  assert.equal(capitalEffects(capital().st).launchers, true, 'a hull without launchers modelled is not disarmed');
});

test('citadels (bridge, reactor) are out of blast splash reach; a mount remembers how it died', () => {
  const c = withCore();
  const out: Subsystem[] = [];
  splashSubsystems(c.st, c.pools, c.reactor.x, c.reactor.y, c.reactor.z + 100, 250, 1e5, 'explosive', null, out);
  assert.ok(CITADELS.has('reactor') && CITADELS.has('bridge'));
  assert.equal(c.reactor.hp, c.reactor.hpMax, 'the core is untouched');
  assert.equal(c.bridge.hp, c.bridge.hpMax, 'the command deck is untouched');
  assert.ok(c.subs.t0.hp < c.subs.t0.hpMax, 'the mounts around them are not');
  const d = withCore();
  hitSubsystem(d.st, d.pools, d.subs.t0, 1e5, 'explosive');
  assert.equal(d.subs.t0.wreck, 'blown', 'an overkill throws the gun house off');
  for (let i = 0; i < 400 && !d.subs.t3.destroyed; i++) hitSubsystem(d.st, d.pools, d.subs.t3, 6, 'laser');
  assert.equal(d.subs.t3.wreck, 'droop', 'chip damage leaves the barrels drooping');
});

test('AI prefs weigh every kind: fighters go for launchers before the reactor; bombers the reactor before the guns', () => {
  for (const k of ['turret', 'launcher', 'lance', 'hangar', 'engine', 'shieldGen', 'shieldEmitter', 'bridge', 'sensors', 'reactor'] as const) {
    assert.ok(FIGHTER_PREFS[k] > 0 && BOMBER_PREFS[k] > 0, k);
  }
  assert.ok(FIGHTER_PREFS.launcher < FIGHTER_PREFS.reactor);
  assert.ok(BOMBER_PREFS.reactor < BOMBER_PREFS.turret);
});
