import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { DAMAGE_MUL, addSubsystem, applyHit, createDamageState, type DamageState, type Pools } from '../src/sim/Damage.ts';
import { SECTION_SHARE, STRIKE_HULL, breakPlane, createStructure, damageSection, sectionAt, settleDeath, shockwaveDamage, shockwaveSpec } from '../src/sim/Structure.ts';
import { Destruction, WRECK_LIFE } from '../src/sim/Destruction.ts';

import { Rng } from '../src/sim/Rng.ts';
import { claimSalvage, lots, salvageRate, stepSalvage, SALVAGE_RANGE, SALVAGE_SPEED } from '../src/game/salvage.ts';
import { newLedger } from '../src/game/economy.ts';
import type { ShipEntity } from '../src/sim/Fleet.ts';

/**
 * Kill paths (src/sim/Structure.ts via Damage.applyHit), the wreckage they
 * leave (src/sim/Destruction.ts) and salvage (src/game/salvage.ts). Ported
 * from the lead session's batch 6 work onto the shields v2 / subsystems model.
 */
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** A 1.8 km capital with its shields down. */
function capital(hull = 40000, shield = 8000): { st: DamageState; pools: Pools } {
  const st = createDamageState(true, shield, hull, { cx: 0, cy: 0, cz: 0, halfW: 200, halfH: 150, halfL: 900 }, 0.05, 6);
  st.facings.fill(0);
  return { st, pools: { hull, hullMax: hull, shield: 0, shieldMax: shield } };
}

// ── structure ─────────────────────────────────────────────────────────

test('three sections along the keel: bow, midships, stern (capitals only)', () => {
  const s = createStructure(true, 0, 900, 40000);
  assert.equal(s.sections.length, 3);
  assert.equal(sectionAt(s, 800), 0);
  assert.equal(sectionAt(s, 0), 1);
  assert.equal(sectionAt(s, -800), 2);
  assert.equal(sectionAt(s, 5000), 0, 'the ends reach past the hull box');
  near(s.sections[1].hpMax, 40000 * SECTION_SHARE[1]);
  assert.equal(createStructure(false, 0, 10, 100).sections.length, 0, 'fighters have no sections');
  assert.equal(capital().st.structure.sections.length, 3, 'createDamageState cuts a capital into sections');
});

test('structural failure: raking the midships snaps the spine in the middle; the ends tear off at their joint', () => {
  const { st, pools } = capital();
  for (let i = 0; i < 1000 && !st.structure.pending; i++) applyHit(st, pools, { amount: 500, type: 'kinetic', local: { x: 190, y: 0, z: ((i % 7) - 3) * 60 } });
  assert.equal(st.structure.pending, 'structural');
  assert.equal(st.structure.failed, 1);
  near(st.structure.breakZ, 0);
  assert.ok(pools.hull > 0, 'before the hull runs out');
  near(pools.hullMax - pools.hull, 40000 * SECTION_SHARE[1], 800);
  const s = createStructure(true, 0, 900, 40000);
  near(breakPlane(s, 0), 300);
  near(breakPlane(s, 2), -300);
});

test('untargeted damage (collisions, blasts without a point) never snaps a hull', () => {
  const s = createStructure(true, 0, 900, 1000);
  for (let i = 0; i < 100; i++) assert.equal(damageSection(s, null, 500), -1);
  assert.equal(s.pending, null);
});

test('bridge kill: the command deck gone and the hull under STRIKE_HULL — she strikes; before that she fights blind', () => {
  const { st, pools } = capital();
  const bridge = addSubsystem(st, { id: 'bridge', kind: 'bridge', label: 'BRIDGE', x: 0, y: 150, z: 700, radius: 60, hpMax: 4000 });
  applyHit(st, pools, { amount: bridge.hpMax / DAMAGE_MUL.explosive.subsystem + 1, type: 'explosive', local: { x: 0, y: 150, z: 700 } });
  assert.equal(bridge.destroyed, true);
  assert.ok(pools.hull > pools.hullMax * STRIKE_HULL);
  assert.equal(st.structure.pending, null, 'still fighting, blind');
  applyHit(st, pools, { amount: pools.hull - pools.hullMax * (STRIKE_HULL - 0.05), type: 'laser', local: { x: 190, y: 0, z: -700 } });
  assert.equal(st.structure.pending, 'bridge');
});

test('reactor shockwave: damage falls off with distance; capitals feel it as a fraction of the dead ship', () => {
  const spec = shockwaveSpec(2000, 40000);
  assert.ok(spec.radius >= 1000);
  assert.equal(shockwaveDamage(spec, spec.radius + 1, true), 0);
  assert.ok(shockwaveDamage(spec, 100, true) > shockwaveDamage(spec, 800, true));
  assert.ok(shockwaveDamage(spec, 100, false) > 110 * 2, 'a fighter close in is vaporised');
  near(shockwaveDamage(spec, 0, true), 40000 * 0.12);
});

// ── settling a kill path ──────────────────────────────────────────────

function liveShip(st: DamageState, pools: Pools, opts: Partial<ShipEntity> = {}): ShipEntity {
  return { ...pools, alive: true, plotArmour: false, isPlayer: false, model: { root: { visible: true } }, combat: { dmg: st }, ...opts } as unknown as ShipEntity;
}

test('settleDeath: a pending path kills her by that cause; plot armour refuses it (the spine holds by a thread); the player never strikes', () => {
  const a = capital();
  a.st.structure.pending = 'structural';
  a.st.structure.failed = 1;
  const s = liveShip(a.st, a.pools);
  assert.equal(settleDeath(s), true);
  assert.equal(s.alive, false);
  assert.equal(a.st.structure.death, 'structural');
  assert.equal(s.hull, 0);

  const b = capital();
  b.st.structure.pending = 'structural';
  b.st.structure.failed = 1;
  b.st.structure.sections[1].hp = 0;
  const hero = liveShip(b.st, b.pools, { plotArmour: true });
  assert.equal(settleDeath(hero), false);
  assert.equal(hero.alive, true);
  assert.equal(b.st.structure.sections[1].hp, 1);
  assert.equal(b.st.structure.pending, null);

  const c = capital();
  c.st.structure.pending = 'bridge';
  const player = liveShip(c.st, c.pools, { isPlayer: true });
  assert.equal(settleDeath(player), false, 'the cockpit fights on');
  c.st.structure.pending = 'reactor';
  assert.equal(settleDeath(player), true, 'but a reactor takes everyone');
  assert.equal(c.st.structure.death, 'reactor');
});

// ── wrecks ────────────────────────────────────────────────────────────

/** Just enough of a ShipEntity for Destruction (pure sim: no model is built). */
function fakeShip(id: number, length = 1800, breakZ?: number): ShipEntity {
  const { st } = capital();
  st.halfL = length / 2;
  st.structure = createStructure(true, 0, length / 2, 40000, length);
  addSubsystem(st, { id: 'reactor', kind: 'reactor', label: 'REACTOR', x: 0, y: -150, z: -300, radius: 60, hpMax: 12000 });
  if (breakZ !== undefined) st.structure.breakZ = breakZ;
  return {
    id,
    alive: false,
    hullMax: 40000,
    radius: length * 0.2,
    rng: new Rng(1994).fork(id),
    model: { length },
    flight: { position: new Vector3(1e6, 0, 0), velocity: new Vector3(0, 0, 20), orientation: new Quaternion(), bodyRates: new Vector3() },
    combat: { dmg: st },
  } as unknown as ShipEntity;
}

function fakeFleet(ships: ShipEntity[] = []) {
  const hits: { ship: ShipEntity; amount: number }[] = [];
  const fleet = { ships, hit: (s: ShipEntity, amount: number) => (hits.push({ ship: s, amount }), { killed: false }) };
  return { fleet: fleet as never, hits };
}

test('structural kill: two burning pieces split at the break, flying apart and tumbling', () => {
  const { fleet } = fakeFleet();
  const D = new Destruction(fleet);
  D.onKill(fakeShip(3, 1800, 0), 'structural', null);
  assert.equal(D.wrecks.length, 2);
  const [fore, aft] = D.wrecks;
  assert.equal(fore.z0, 0);
  assert.equal(aft.z1, 0);
  assert.ok(fore.burning > 0 && fore.breakZ === 0);
  const gap0 = fore.position.distanceTo(aft.position);
  for (let t = 0; t < 20; t += 1 / 60) D.step(1 / 60);
  assert.ok(fore.position.distanceTo(aft.position) > gap0 + 100, 'separating');
  assert.ok(fore.spin.length() > 0 && aft.spin.length() > 0, 'tumbling');
  assert.ok(fore.position.z > 20 * 19, 'carrying the hull’s momentum');
});

test('bridge kill: one whole hull, dark and slow — the richest salvage; reactor: one charred piece and a shockwave', () => {
  const { fleet } = fakeFleet();
  const D = new Destruction(fleet);
  D.onKill(fakeShip(4), 'bridge', null);
  D.onKill(fakeShip(5), 'reactor', null);
  const struck = D.wrecks.filter((w) => w.cause === 'bridge');
  const blown = D.wrecks.filter((w) => w.cause === 'reactor');
  assert.equal(struck.length, 1);
  assert.equal(blown.length, 1);
  assert.equal(struck[0].z0, -Infinity);
  assert.equal(struck[0].z1, Infinity);
  assert.ok(lots(struck[0].salvage) > lots(blown[0].salvage) * 2);
  assert.ok(blown[0].velocity.distanceTo(new Vector3(0, 0, 20)) > 1, 'the charred piece is blown clear at once');
  assert.equal(D.shockwaves.length, 1);
});

test('wreck pieces are deterministic: the same death leaves the same pieces', () => {
  const run = () => {
    const D = new Destruction(fakeFleet().fleet);
    D.onKill(fakeShip(7, 1800, 0), 'structural', null);
    for (let t = 0; t < 10; t += 1 / 60) D.step(1 / 60);
    return D.wrecks.map((w) => [w.position.toArray(), w.orientation.toArray()]);
  };
  assert.deepEqual(run(), run());
});

test('the shockwave crosses the ships around the blast once each, strongest close in', () => {
  const near1 = fakeShip(10);
  const far = fakeShip(11);
  const out = fakeShip(12);
  for (const [s, d] of [
    [near1, 300],
    [far, 1000],
    [out, 5000],
  ] as const) {
    s.alive = true;
    s.flight.position.set(1e6 + d, 0, 0);
    s.radius = 40;
  }
  const { fleet, hits } = fakeFleet([near1, far, out]);
  const D = new Destruction(fleet);
  D.onKill(fakeShip(9), 'reactor', null);
  for (let t = 0; t < 5; t += 1 / 60) D.step(1 / 60);
  assert.equal(hits.filter((h) => h.ship === near1).length, 1);
  assert.equal(hits.filter((h) => h.ship === far).length, 1);
  assert.equal(hits.filter((h) => h.ship === out).length, 0);
  assert.ok(hits.find((h) => h.ship === near1)!.amount > hits.find((h) => h.ship === far)!.amount);
  assert.equal(D.shockwaves.length, 0, 'spent');
});

test('wrecks persist for a while, then clear; hull depletion leaves three sections; fighters leave nothing', () => {
  const { fleet } = fakeFleet();
  const D = new Destruction(fleet);
  D.onKill(fakeShip(6), 'hull', null);
  assert.equal(D.wrecks.length, 3);
  assert.ok(D.wrecks.every((w) => w.delay > 0), 'the death chain plays on the whole hull first');
  for (let t = 0; t < WRECK_LIFE - 1; t += 1) D.step(1);
  assert.equal(D.wrecks.length, 3);
  D.step(2);
  assert.equal(D.wrecks.length, 0);
  const fighter = fakeShip(8, 12);
  fighter.combat.dmg.capital = false;
  fighter.combat.dmg.structure = createStructure(false, 0, 6, 100);
  D.onKill(fighter, 'hull', null);
  assert.equal(D.wrecks.length, 0);
});

// ── salvage ───────────────────────────────────────────────────────────

test('salvage: close and slow to cut; the lot fills the hold, relics first, what does not fit stays aboard', () => {
  const y = { relics: 3, cores: 2, spares: 5 };
  assert.equal(salvageRate(y, SALVAGE_RANGE + 1, 0), 0, 'too far');
  assert.equal(salvageRate(y, 100, SALVAGE_SPEED + 1), 0, 'too fast');
  const rate = salvageRate(y, 100, 5);
  assert.ok(rate > 0);
  const w = { salvaged: 0, taken: false, salvage: y };
  let done = false;
  let t = 0;
  for (; t < 60 && !done; t += 0.1) done = stepSalvage(w, rate, 0.1);
  assert.ok(done && t > 5 && t < 30, `cut in ${t.toFixed(1)} s`);
  const l = { ...newLedger(), cargo: { rations: 10 }, capacity: 16 };
  const r = claimSalvage(l, y);
  assert.deepEqual(r.got, { relics: 3, cores: 2, spares: 1 });
  assert.deepEqual(r.left, { relics: 0, cores: 0, spares: 4 });
  assert.equal(r.ledger.cargo.relics, 3);
  assert.equal(l.cargo.relics, undefined, 'pure: the old ledger is untouched');
});
