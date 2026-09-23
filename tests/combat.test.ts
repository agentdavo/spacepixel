import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAMAGE_MUL,
  FACING,
  ZONE,
  addSubsystem,
  applyHit,
  capitalEffects,
  createDamageState,
  facingOf,
  fighterEffects,
  fighterZone,
  pickSubsystem,
  regenShields,
  resetDamage,
  shieldFacing,
  type Pools,
} from '../src/sim/Damage.ts';
import { GUNS, LOADOUTS, MISSILES, SHIP_STATS } from '../src/sim/Loadouts.ts';

const ROSTER_IDS = [
  'vf27-kestrel',
  'vf31-harrier',
  'choir-cantor',
  'rw-scrapjack',
  'sb9-warhorse',
  'choir-psalter',
  'ffc-lantern-guard',
  'choir-vesper',
  'cvs07-hesperus-dawn',
  'bb-indomitable',
  'choir-cathedral',
];

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function fighter(hull = 100, shield = 50): { st: ReturnType<typeof createDamageState>; pools: Pools } {
  const st = createDamageState(false, shield, hull, { cx: 0, cy: 0, cz: 0, halfW: 6, halfH: 2, halfL: 8 }, 0.2, 3);
  return { st, pools: { hull, hullMax: hull, shield, shieldMax: shield } };
}

function capital(hull = 40000, shield = 8000) {
  const st = createDamageState(true, shield, hull, { cx: 0, cy: 0, cz: 0, halfW: 200, halfH: 150, halfL: 1000 }, 0.05, 6);
  const pools: Pools = { hull, hullMax: hull, shield, shieldMax: shield };
  const turret = addSubsystem(st, { id: 'battery-1', kind: 'turret', label: 'TURRET 1', x: 150, y: 120, z: 200, radius: 60, hpMax: 600 });
  const turret2 = addSubsystem(st, { id: 'battery-2', kind: 'turret', label: 'TURRET 2', x: 150, y: 120, z: 290, radius: 60, hpMax: 600 });
  const e1 = addSubsystem(st, { id: 'engine-0', kind: 'engine', label: 'ENGINE 1', x: 60, y: 0, z: -1000, radius: 80, hpMax: 1600 });
  const e2 = addSubsystem(st, { id: 'engine-1', kind: 'engine', label: 'ENGINE 2', x: -60, y: 0, z: -1000, radius: 80, hpMax: 1600 });
  const gen = addSubsystem(st, { id: 'shield-gen', kind: 'shieldGen', label: 'SHIELD GEN', x: 0, y: 150, z: -500, radius: 90, hpMax: 2000 });
  const bridge = addSubsystem(st, { id: 'bridge', kind: 'bridge', label: 'BRIDGE', x: 0, y: 150, z: 800, radius: 80, hpMax: 2000 });
  return { st, pools, turret, turret2, e1, e2, gen, bridge };
}

// ── data ─────────────────────────────────────────────────────────────

test('every design has stats and a loadout that references real guns and missiles', () => {
  for (const id of ROSTER_IDS) {
    const s = SHIP_STATS[id];
    assert.ok(s, `${id}: stats`);
    assert.ok(s.hull > 0 && s.shield > 0 && s.shieldRegen > 0 && s.shieldDelay > 0, `${id}: pools`);
    const l = LOADOUTS[id];
    assert.ok(l, `${id}: loadout`);
    for (const g of l.guns) assert.ok(GUNS[g], `${id}: gun ${g}`);
    for (const m of l.missiles) assert.ok(MISSILES[m], `${id}: missile ${m}`);
    if (s.facings === 4) assert.ok(l.turret && GUNS[l.turret].burst, `${id}: capital turret gun`);
    else assert.ok(l.guns.length >= 2, `${id}: fighters carry two guns to cycle`);
  }
});

test('fighters differ: Harrier fastest and nimblest, Warhorse and Scrapjack toughest but slow', () => {
  const k = SHIP_STATS['vf27-kestrel'];
  const h = SHIP_STATS['vf31-harrier'];
  const w = SHIP_STATS['sb9-warhorse'];
  const j = SHIP_STATS['rw-scrapjack'];
  assert.ok(h.speed > k.speed && h.agility > k.agility && h.hull < k.hull);
  for (const heavy of [w, j]) {
    assert.ok(heavy.hull > k.hull * 1.5 && heavy.speed < k.speed && heavy.agility < k.agility && heavy.mass > k.mass);
  }
  assert.ok(j.shield < k.shield, 'salvage: armour, not shields');
});

test('faction weapon families: Directorate kinetic + laser, Hegemony harmonic, Rustwake scattergun', () => {
  assert.deepEqual(LOADOUTS['vf27-kestrel'].guns.map((g) => GUNS[g].type).sort(), ['kinetic', 'laser']);
  assert.ok(LOADOUTS['choir-cantor'].guns.every((g) => GUNS[g].type === 'harmonic'));
  assert.ok(LOADOUTS['choir-cantor'].guns.some((g) => GUNS[g].beam), 'Choir carry a beam-lance');
  const sc = GUNS[LOADOUTS['rw-scrapjack'].guns[0]];
  assert.ok(sc.pellets > 1 && sc.spread > 0 && sc.speed * sc.life < 1000, 'scattergun: spread, short range');
  assert.ok(MISSILES.torpedo.hp > 0 && MISSILES.torpedo.maxSpeed < MISSILES.micro.maxSpeed / 2, 'torpedo: slow, shootable');
});

// ── damage types ─────────────────────────────────────────────────────

test('damage multipliers: kinetic chews hull, harmonic strips shields, explosives wreck subsystems', () => {
  const M = DAMAGE_MUL;
  assert.ok(M.kinetic.hull > M.laser.hull && M.laser.hull > M.harmonic.hull);
  assert.ok(M.harmonic.shield > M.laser.shield && M.laser.shield > M.kinetic.shield);
  assert.ok(M.explosive.subsystem > M.kinetic.subsystem && M.explosive.subsystem > M.laser.subsystem);
});

test('shield absorbs first; overflow reaches the hull scaled by type', () => {
  // Laser 30 into 10 shield: 10 absorbed, 20 through.
  let f = fighter(100, 10);
  let r = applyHit(f.st, f.pools, { amount: 30, type: 'laser', local: null });
  assert.equal(r.shielded, true);
  assert.equal(r.facingCollapsed, true);
  near(f.pools.shield, 0);
  near(f.pools.hull, 80);
  // Kinetic 30 into 10 shield: shield sees 15 → only 2/3 blocked, 10 raw passes ×1.4.
  f = fighter(100, 10);
  r = applyHit(f.st, f.pools, { amount: 30, type: 'kinetic', local: null });
  near(f.pools.hull, 100 - 14);
  near(r.hullDamage, 14);
  // Harmonic: 10 raw vs 50 shield → 17 absorbed, nothing through.
  f = fighter(100, 50);
  applyHit(f.st, f.pools, { amount: 10, type: 'harmonic', local: null });
  near(f.pools.shield, 50 - 17);
  near(f.pools.hull, 100);
});

test('a pool drained to exactly zero still counts as a collapse', () => {
  const f = fighter(100, 12);
  applyHit(f.st, f.pools, { amount: 6, type: 'laser', local: null });
  const r = applyHit(f.st, f.pools, { amount: 6, type: 'laser', local: null });
  assert.equal(r.facingCollapsed, true);
  assert.equal(f.pools.shield, 0);
});

// ── fighter zones ────────────────────────────────────────────────────

test('fighter zone from impact direction (ship-local, +Z nose, +X port)', () => {
  assert.equal(fighterZone(0, 0, 1), ZONE.NOSE);
  assert.equal(fighterZone(0.3, 0.2, 1), ZONE.NOSE);
  assert.equal(fighterZone(0, 0, -1), ZONE.ENGINE);
  assert.equal(fighterZone(1, 0, 0), ZONE.WING_L);
  assert.equal(fighterZone(-1, 0.3, 0.2), ZONE.WING_R);
  assert.equal(fighterZone(0.2, -1, 0), ZONE.WING_L, 'belly hits go to the nearer wing');
});

test('hull hits accumulate on the zone they land in; shielded hits do not', () => {
  const f = fighter(100, 20);
  applyHit(f.st, f.pools, { amount: 10, type: 'laser', local: { x: 0, y: 0, z: 7 } });
  assert.deepEqual(f.st.zones, [0, 0, 0, 0], 'bubble took it');
  const r = applyHit(f.st, f.pools, { amount: 40, type: 'laser', local: { x: 5, y: 0, z: 0 } });
  assert.equal(r.zone, ZONE.WING_L);
  near(f.st.zones[ZONE.WING_L], 30 / f.st.zoneHp);
  assert.equal(f.st.zones[ZONE.NOSE], 0);
});

test('fighter effects: engines cut thrust, wing asymmetry rolls, low hull smokes', () => {
  const f = fighter();
  let e = fighterEffects(f.st, 1);
  assert.equal(e.thrustMul, 1);
  assert.equal(e.rollDrift, 0);
  assert.equal(e.smoke, 0);
  f.st.zones[ZONE.ENGINE] = 0.9;
  f.st.zones[ZONE.WING_L] = 0.8;
  e = fighterEffects(f.st, 0.5);
  assert.ok(e.thrustMul < 0.6 && e.noBoost, 'engines: thrust down, afterburner out');
  assert.ok(e.rollDrift < 0, 'port wing shot up: rolls to port');
  assert.equal(e.smoke, 1);
  assert.equal(fighterEffects(f.st, 0.2).smoke, 2);
  f.st.zones.fill(0);
  f.st.tether = 2;
  e = fighterEffects(f.st, 1);
  assert.ok(e.thrustMul <= 0.5 && e.noBoost, 'harpooned');
});

// ── capital facings ──────────────────────────────────────────────────

test('capital facing from a point on a long hull', () => {
  assert.equal(shieldFacing(0, 900, 200, 1000), FACING.FORE);
  assert.equal(shieldFacing(0, -900, 200, 1000), FACING.AFT);
  assert.equal(shieldFacing(190, 300, 200, 1000), FACING.PORT, 'flank well forward of amidships is still the flank');
  assert.equal(shieldFacing(-190, -300, 200, 1000), FACING.STBD);
});

test('facings have separate pools; a collapsed facing lets fire through there only', () => {
  const c = capital();
  const fore = { x: 0, y: 0, z: 950 };
  const port = { x: 190, y: 50, z: 0 };
  assert.equal(facingOf(c.st, fore), FACING.FORE);
  let r = applyHit(c.st, c.pools, { amount: c.st.facingMax + 100, type: 'laser', local: fore });
  assert.equal(r.facing, FACING.FORE);
  assert.equal(r.facingCollapsed, true);
  assert.equal(c.st.facings[FACING.FORE], 0);
  near(r.hullDamage, 100);
  assert.equal(c.st.facings[FACING.PORT], c.st.facingMax);
  near(c.pools.shield, c.st.facingMax * 3);
  r = applyHit(c.st, c.pools, { amount: 100, type: 'laser', local: port });
  assert.equal(r.shielded, true);
  assert.equal(r.hullDamage, 0);
});

// ── capital subsystems ───────────────────────────────────────────────

test('hull hits route to the nearest intact subsystem within its radius, else the plating', () => {
  const c = capital();
  c.st.facings.fill(0);
  assert.equal(pickSubsystem(c.st.subsystems, 150, 120, 240), c.turret, 'closer to turret 1 than 2');
  assert.equal(pickSubsystem(c.st.subsystems, 150, 120, 260), c.turret2);
  assert.equal(pickSubsystem(c.st.subsystems, 0, -150, 0), null);
  const r = applyHit(c.st, c.pools, { amount: 100, type: 'kinetic', local: { x: 150, y: 125, z: 205 } });
  assert.equal(r.subsystem, c.turret);
  near(c.turret.hp, 600 - 100 * DAMAGE_MUL.kinetic.subsystem);
  near(r.hullDamage, 100 * DAMAGE_MUL.kinetic.hull * 0.5, 1e-9);
  // Bare plating: a scar.
  applyHit(c.st, c.pools, { amount: 100, type: 'laser', local: { x: 0, y: -150, z: 0 } });
  assert.equal(c.st.scars.length, 1);
});

test('destroying a subsystem: flag, then hits there go to hull', () => {
  const c = capital();
  c.st.facings.fill(0);
  const at = { x: 150, y: 120, z: 200 };
  const r = applyHit(c.st, c.pools, { amount: 600 / DAMAGE_MUL.explosive.subsystem + 1, type: 'explosive', local: at });
  assert.equal(r.subsystemDestroyed, true);
  assert.equal(c.turret.destroyed, true);
  const r2 = applyHit(c.st, c.pools, { amount: 10, type: 'laser', local: at });
  assert.notEqual(r2.subsystem, c.turret);
});

test('subsystem effects: engines → slow then drift; shield generator → shields down, no regen; bridge → fire control', () => {
  const c = capital();
  c.st.facings.fill(0);
  c.st.down = 0b1111; // all four facings knocked down
  const kill = (s: typeof c.turret) => applyHit(c.st, c.pools, { amount: 1e5, type: 'explosive', local: { x: s.x, y: s.y, z: s.z } });
  let e = capitalEffects(c.st);
  assert.deepEqual([e.speedMul, e.drift, e.shieldsOnline, e.coordination], [1, false, true, 1]);
  kill(c.e1);
  e = capitalEffects(c.st);
  assert.equal(e.speedMul, 0.5);
  assert.equal(e.drift, false);
  kill(c.e2);
  assert.equal(capitalEffects(c.st).drift, true);
  kill(c.bridge);
  assert.ok(capitalEffects(c.st).coordination < 1);
  // Shields: regenerate while the generator stands…
  regenShields(c.st, c.pools, 99, 1);
  assert.ok(c.pools.shield > 0);
  assert.equal(c.st.regenStarted, 0b1111, 'regen shimmer on every facing that was down');
  // …and collapse for good when it falls.
  kill(c.gen);
  assert.equal(capitalEffects(c.st).shieldsOnline, false);
  assert.equal(c.pools.shield, 0);
  regenShields(c.st, c.pools, 99, 5);
  assert.equal(c.pools.shield, 0);
});

test('regeneration waits for the delay; reset restores everything', () => {
  const f = fighter(100, 50);
  applyHit(f.st, f.pools, { amount: 60, type: 'laser', local: { x: 0, y: 0, z: 7 } });
  regenShields(f.st, f.pools, 1, 1);
  assert.equal(f.pools.shield, 0, 'inside the delay');
  regenShields(f.st, f.pools, 5, 1);
  near(f.pools.shield, 50 * 0.2);
  assert.equal(f.st.regenStarted, 1);
  resetDamage(f.st, f.pools);
  assert.equal(f.pools.hull, 100);
  assert.equal(f.pools.shield, 50);
  assert.deepEqual(f.st.zones, [0, 0, 0, 0]);
});
