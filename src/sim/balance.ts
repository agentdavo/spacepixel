import { Group, Vector3 } from 'three';
import { Fleet, faceAlong, type ShipEntity } from './Fleet';
import { Weapons } from './Weapons';
import { Missiles } from './Missiles';
import { Capitals } from './Capitals';
import { chooseGun, gunOf, leadSpeedOf, subsystemPosition, toUniverse } from './Combat';
import { GUNS, MISSILES, SHIP_STATS, type GunId } from './Loadouts';
import { leadPoint } from './ai/Pilot';
import type { Check, ScenarioResult } from './ai/sim';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { computeFit, slotsFor, stockFit, type Fit } from '@/game/outfitting/fit';
import { applyFit } from '@/game/outfitting/apply';
import { ShipTurrets } from '@/game/outfitting/turrets';

/**
 * Headless combat balance (`npm run balance`): the real weapons, missiles
 * and damage routing at a fixed 60 Hz, with scripted shooters that aim like
 * a good pilot — lead-corrected, with a per-shot aim error — and hold fire
 * on the target. Pass/fail bands:
 *
 *   fighter vs fighter   Kestrel (auto gun switch) vs Cantor     3–8 s
 *   turret               wing of 4 Kestrels vs one capital turret  5–15 s
 *   capital              squadron (4 Kestrel + 2 Warhorse) kills a capital   60–180 s
 *
 * Aim error is Gaussian in metres at the target (σ grows with range), so hit
 * rates come out like a skilled player's, not an aimbot's.
 */
const DT = 1 / 60;
const DEBUG = false;
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);

let seed = 1;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
function gauss(): number {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function check(name: string, value: number, rule: string, pass: boolean): Check {
  return { name, value: Math.round(value * 100) / 100, rule, pass };
}
function info(name: string, value: number, note: string): Check {
  return { name, value: Math.round(value * 100) / 100, rule: note, pass: true, info: true };
}

interface World {
  fleet: Fleet;
  weapons: Weapons;
  missiles: Missiles;
  capitals: Capitals;
}

function world(): World {
  const fleet = new Fleet(new Group());
  const weapons = new Weapons(fleet);
  const missiles = new Missiles(fleet);
  const capitals = new Capitals(fleet, weapons);
  return { fleet, weapons, missiles, capitals };
}

const _a = new Vector3();
const _b = new Vector3();
const _e = new Vector3();

/**
 * Point `s` at `aim` (lead-corrected for its gun) plus a Gaussian aim error of
 * `sigma` metres, and pull the trigger.
 */
function aimAndFire(s: ShipEntity, aim: Vector3, aimVel: Vector3, sigma: number): void {
  const f = s.flight;
  const tof = leadPoint(f.position, f.velocity, aim, aimVel, null, _a, leadSpeedOf(s));
  if (tof < 0) _a.copy(aim);
  _a.add(_e.set(gauss(), gauss(), gauss()).multiplyScalar(sigma));
  faceAlong(f.orientation, _b.subVectors(_a, f.position).normalize());
  f.bodyRates.set(0, 0, 0);
  s.controls.pitch = s.controls.yaw = s.controls.roll = 0;
  s.controls.fire = true;
}

/** Keep a ship on a fixed velocity (scripted flight). */
function hold(s: ShipEntity, vel: Vector3): void {
  s.flight.velocity.copy(vel);
}

// ── fighter vs fighter ────────────────────────────────────────────────

interface DuelResult {
  ttk: number;
  hitRate: number;
  shots: number;
}

/**
 * Shooter 350 m behind a weaving target, both at 150 m/s. Aim error σ = 1%
 * of range (3.5 m at 350 m). `gun` fixes the gun; otherwise the shooter
 * switches like a player would (best gun for the layer that is up).
 */
export function duel(shooterBp: string, targetBp: string, gun: GunId | null = null, range = 350, maxT = 30): DuelResult {
  seed = 7;
  const w = world();
  const fwd = new Vector3(0, 0, 1);
  const tgt = w.fleet.spawn(targetBp, targetBp.startsWith('choir') ? 'choir' : targetBp.startsWith('rw') ? 'rustwake' : 'concord', ORIGIN.clone().add(new Vector3(0, 0, range)), fwd);
  const sh = w.fleet.spawn(shooterBp, 'concord', ORIGIN.clone(), fwd, { isPlayer: true });
  tgt.team = 'renegade';
  sh.target = tgt;
  if (gun) sh.combat.gun = Math.max(0, sh.combat.loadout.guns.indexOf(gun));
  const v = new Vector3(0, 0, 150);
  const tv = new Vector3();
  let t = 0;
  let shots = 0;
  let hits = 0;
  for (; t < maxT && tgt.alive; t += DT) {
    // Weave: ±25 m lateral, 3 s period; gentle climb and dive.
    tv.set(Math.cos(t * 2.1) * 25 * 2.1, Math.sin(t * 1.3) * 12 * 1.3, 150);
    hold(tgt, tv);
    faceAlong(tgt.flight.orientation, _b.copy(tv).normalize());
    hold(sh, v);
    if (!gun) chooseGun(sh, tgt);
    // The shooter keeps station 350 m behind.
    sh.flight.position.copy(tgt.flight.position).add(_b.set(0, 0, -range));
    aimAndFire(sh, tgt.flight.position, tgt.flight.velocity, range * 0.01);
    w.fleet.step(DT);
    w.weapons.step(DT);
    for (const e of w.weapons.events) {
      if (e.kind === 'fire' && e.shooter === sh) shots += e.gun?.pellets ?? 1;
      if ((e.kind === 'hit' || e.kind === 'shield' || e.kind === 'beam-hit') && e.shooter === sh) hits++;
    }
  }
  return { ttk: tgt.alive ? Infinity : t, hitRate: hits / Math.max(1, shots), shots };
}

export function fighterScenario(): ScenarioResult {
  const main = duel('vf27-kestrel', 'choir-cantor');
  const laser = duel('vf27-kestrel', 'choir-cantor', 'laser');
  const auto = duel('vf27-kestrel', 'choir-cantor', 'autocannon');
  const matrix: [string, string][] = [
    ['vf31-harrier', 'choir-cantor'],
    ['sb9-warhorse', 'choir-cantor'],
    ['rw-scrapjack', 'choir-cantor'],
    ['choir-cantor', 'vf27-kestrel'],
    ['choir-cantor', 'rw-scrapjack'],
    ['vf27-kestrel', 'rw-scrapjack'],
    ['vf27-kestrel', 'sb9-warhorse'],
    ['choir-psalter', 'vf27-kestrel'],
  ];
  const rows = matrix.map(([a, b]) => ({ a, b, r: duel(a, b) }));
  const scatterClose = duel('rw-scrapjack', 'choir-cantor', 'scatter', 150);
  const scatterFar = duel('rw-scrapjack', 'choir-cantor', 'scatter', 600);
  return {
    name: 'fighter time-to-kill (sustained fire, aim σ = 1% of range)',
    metrics: {
      kestrelVsCantor: `${main.ttk.toFixed(2)} s @ ${(main.hitRate * 100).toFixed(0)}% hits`,
      laserOnly: `${laser.ttk.toFixed(2)} s`,
      autocannonOnly: `${auto.ttk.toFixed(2)} s`,
      matrix: rows.map((x) => `${short(x.a)}→${short(x.b)} ${x.r.ttk.toFixed(1)}s`).join('  '),
    },
    checks: [
      check('Kestrel vs Cantor TTK, gun switching (s)', main.ttk, '3..8', main.ttk >= 3 && main.ttk <= 8),
      check('switching beats laser only', laser.ttk - main.ttk, '> 0', laser.ttk > main.ttk),
      check('switching beats autocannon only', auto.ttk - main.ttk, '> 0', auto.ttk > main.ttk),
      check('hit rate (%)', main.hitRate * 100, '30..80', main.hitRate >= 0.3 && main.hitRate <= 0.8),
      ...rows.map((x) => check(`${short(x.a)} vs ${short(x.b)} TTK (s)`, x.r.ttk, '2..20', x.r.ttk >= 2 && x.r.ttk <= 20)),
      check('scattergun: point blank beats long range', scatterFar.ttk - scatterClose.ttk, '> 0', scatterFar.ttk > scatterClose.ttk),
      info('scattergun 150 m TTK (s)', scatterClose.ttk, 'Scrapjack vs Cantor'),
      info('scattergun 600 m TTK (s)', scatterFar.ttk, 'Scrapjack vs Cantor'),
    ],
  };
}

function short(bp: string): string {
  return bp.split('-').pop()!;
}

// ── damage types ──────────────────────────────────────────────────────

/** Seconds of all-hits fire from one gun to strip a layer (analytic, from the tables). */
function layerTime(gun: GunId, layer: 'shield' | 'hull', pool: number): number {
  const w = world();
  const s = w.fleet.spawn('vf27-kestrel', 'concord', ORIGIN.clone(), new Vector3(0, 0, 1));
  s.combat.loadout = { guns: [gun], missiles: [] };
  const g = gunOf(s)!;
  const mul = layer === 'shield' ? { laser: 1, kinetic: 0.5, harmonic: 1.7, explosive: 0.7 }[g.type] : { laser: 1, kinetic: 1.4, harmonic: 0.6, explosive: 1.5 }[g.type];
  const dps = (g.beam ? g.beam.dps * g.beam.duration * g.rate : g.rate * g.damage * g.pellets) * mul;
  return pool / dps;
}

export function damageTypeScenario(): ScenarioResult {
  const sL = layerTime('laser', 'shield', 100);
  const sA = layerTime('autocannon', 'shield', 100);
  const sH = layerTime('hymn', 'shield', 100);
  const hL = layerTime('laser', 'hull', 100);
  const hA = layerTime('autocannon', 'hull', 100);
  const hH = layerTime('hymn', 'hull', 100);
  return {
    name: 'damage types (seconds to strip 100 points, all hits)',
    metrics: { shield: `laser ${sL.toFixed(2)} · autocannon ${sA.toFixed(2)} · hymn ${sH.toFixed(2)}`, hull: `laser ${hL.toFixed(2)} · autocannon ${hA.toFixed(2)} · hymn ${hH.toFixed(2)}` },
    checks: [
      check('autocannon weak vs shields (× laser time)', sA / sL, '> 1.5', sA / sL > 1.5),
      check('autocannon strong vs hull (× laser time)', hA / hL, '< 0.8', hA / hL < 0.8),
      check('hymn strips shields fastest (× laser time)', sH / sL, '< 0.8', sH / sL < 0.8),
      check('hymn weak vs hull (× laser time)', hH / hL, '> 1.3', hH / hL > 1.3),
    ],
  };
}

// ── capital subsystems ───────────────────────────────────────────────

/**
 * A wing of four Kestrels 900 m off a capital's flank, holding station and
 * firing on one turret (aim σ = 0.8% of range). Time from first shot until
 * the turret is destroyed; the shield facing in the way goes first.
 */
export function turretKill(capBp: string, socket: string, wingSize = 4, range = 900, maxT = 60): { t: number; facingDownAt: number } {
  seed = 11;
  const w = world();
  const cap = w.fleet.spawn(capBp, 'choir', ORIGIN.clone(), new Vector3(0, 0, 1));
  cap.flight.velocity.set(0, 0, 0);
  cap.controls.throttleSet = 0;
  const sub = cap.combat.dmg.subsystems.find((s) => s.id === socket)!;
  const tp = subsystemPosition(cap, sub, new Vector3());
  // Come in from the side the turret is on, level with it.
  const st = cap.combat.dmg;
  const side = new Vector3(Math.sign(sub.x - st.cx) || 1, 0.6, 0.15).normalize();
  const wing: ShipEntity[] = [];
  for (let i = 0; i < wingSize; i++) {
    const p = tp.clone().addScaledVector(side, range).add(new Vector3((i - 1.5) * 35, (i % 2) * 20, (i - 1.5) * 25));
    const s = w.fleet.spawn('vf27-kestrel', 'concord', p, side.clone().negate());
    s.target = cap;
    wing.push(s);
  }
  let t = 0;
  let facingDownAt = -1;
  const zero = new Vector3();
  for (; t < maxT && !sub.destroyed; t += DT) {
    if (DEBUG && Math.abs(t % 2) < DT) console.log(capBp, t.toFixed(1), st.facings.map((x) => x.toFixed(0)).join(','), sub.hp.toFixed(0), cap.hull.toFixed(0), wing.map((s) => s.combat.gun).join(''));
    cap.flight.velocity.set(0, 0, 0);
    subsystemPosition(cap, sub, tp);
    for (const s of wing) {
      hold(s, zero);
      chooseGun(s, cap);
      aimAndFire(s, tp, zero, range * 0.008);
    }
    w.fleet.step(DT);
    w.weapons.step(DT);
    if (facingDownAt < 0 && w.weapons.events.some((e) => e.kind === 'shield-down')) facingDownAt = t;
  }
  return { t: sub.destroyed ? t : Infinity, facingDownAt };
}

export function turretScenario(): ScenarioResult {
  const cath = turretKill('choir-cathedral', 'battery-4');
  const indo = turretKill('bb-indomitable', 'secondary-1');
  const hesp = turretKill('cvs07-hesperus-dawn', 'pd-1');
  const lg = turretKill('ffc-lantern-guard', 'main-b');
  const lance = turretKill('choir-cathedral', 'spire-2');
  return {
    name: 'capital turret kill (wing of 4 Kestrels, 900 m, aim σ = 0.8% of range)',
    metrics: {
      cathedralBattery: `${cath.t.toFixed(1)} s (facing down at ${cath.facingDownAt.toFixed(1)} s)`,
      indomitableSecondary: `${indo.t.toFixed(1)} s (facing down at ${indo.facingDownAt.toFixed(1)} s)`,
      hesperusPD: `${hesp.t.toFixed(1)} s`,
      lanternGuardMain: `${lg.t.toFixed(1)} s`,
      cathedralSpireLance: `${lance.t.toFixed(1)} s`,
    },
    checks: [
      check('Cathedral battery (s)', cath.t, '5..15', cath.t >= 5 && cath.t <= 15),
      check('Indomitable secondary turret (s)', indo.t, '5..15', indo.t >= 5 && indo.t <= 15),
      check('Hesperus Dawn point defence (s)', hesp.t, '5..15', hesp.t >= 5 && hesp.t <= 15),
      check('Lantern Guard main turret (s)', lg.t, '2..15', lg.t >= 2 && lg.t <= 15),
      info('Cathedral spire lance (s)', lance.t, 'bigger subsystem, no band'),
    ],
  };
}

// ── capital kill ─────────────────────────────────────────────────────

/**
 * A squadron (4 Kestrels + 2 Warhorses with torpedoes) circling 1.2 km off a
 * capital, raking the hull (aim at random points on it) and putting
 * torpedoes in whenever they reload. Point defence is off: this is the DPS
 * budget, not a survival test.
 */
export function capitalKill(capBp: string, maxT = 400): { t: number; torps: number; subsKilled: number } {
  seed = 23;
  const w = world();
  const cap = w.fleet.spawn(capBp, 'choir', ORIGIN.clone(), new Vector3(0, 0, 1));
  cap.flight.velocity.set(0, 0, 0);
  const st = cap.combat.dmg;
  const squad: ShipEntity[] = [];
  const bps = ['vf27-kestrel', 'vf27-kestrel', 'vf27-kestrel', 'vf27-kestrel', 'sb9-warhorse', 'sb9-warhorse'];
  bps.forEach((bp) => {
    const s = w.fleet.spawn(bp, 'concord', ORIGIN.clone(), new Vector3(0, 0, 1));
    s.target = cap;
    if (bp === 'sb9-warhorse') s.combat.missile = 0; // torpedoes
    squad.push(s);
  });
  const R = Math.max(st.halfL, st.halfW) + 1200;
  const aims = squad.map(() => new Vector3());
  const zero = new Vector3();
  let torps = 0;
  let t = 0;
  for (; t < maxT && cap.alive; t += DT) {
    cap.flight.velocity.set(0, 0, 0);
    squad.forEach((s, i) => {
      // Orbit slowly on a ring around the hull.
      const a = (i / squad.length) * Math.PI * 2 + t * 0.02;
      s.flight.position.copy(cap.flight.position).add(_b.set(Math.cos(a) * R * 0.45, st.halfH * (0.6 + 0.4 * Math.sin(a * 2)), Math.sin(a) * R));
      hold(s, zero);
      // A fresh point on the hull every second (the squadron walks fire along it).
      if (Math.floor(t) !== Math.floor(t - DT) || t === 0) {
        toUniverse(cap, st.cx + (rand() - 0.5) * st.halfW * 1.2, st.cy + (rand() - 0.2) * st.halfH, st.cz + (rand() - 0.5) * st.halfL * 1.6, aims[i]);
      }
      chooseGun(s, cap);
      aimAndFire(s, aims[i], zero, 6);
      if (s.combat.loadout.missiles[s.combat.missile] === 'torpedo' && s.combat.missileReload <= 0 && w.missiles.salvo(s, cap)) torps++;
    });
    w.fleet.step(DT);
    w.weapons.step(DT);
    w.missiles.step(DT);
  }
  return { t: cap.alive ? Infinity : t, torps, subsKilled: st.subsystems.filter((s) => s.destroyed).length };
}

export function capitalScenario(): ScenarioResult {
  const cath = capitalKill('choir-cathedral');
  const indo = capitalKill('bb-indomitable');
  const hesp = capitalKill('cvs07-hesperus-dawn');
  const lg = capitalKill('ffc-lantern-guard');
  return {
    name: 'capital kill (squadron: 4 Kestrels + 2 Warhorses with torpedoes)',
    metrics: {
      cathedral: `${cath.t.toFixed(0)} s · ${cath.torps} torpedoes · ${cath.subsKilled} subsystems down`,
      indomitable: `${indo.t.toFixed(0)} s · ${indo.torps} torpedoes · ${indo.subsKilled} subsystems down`,
      hesperus: `${hesp.t.toFixed(0)} s · ${hesp.torps} torpedoes`,
      lanternGuard: `${lg.t.toFixed(0)} s · ${lg.torps} torpedoes`,
    },
    checks: [
      check('Cathedral (s)', cath.t, '60..180', cath.t >= 60 && cath.t <= 180),
      check('Indomitable (s)', indo.t, '60..180', indo.t >= 60 && indo.t <= 180),
      check('Hesperus Dawn (s)', hesp.t, '60..180', hesp.t >= 60 && hesp.t <= 180),
      // A corvette is not what six torpedo-armed fighters are for: it should go fast, but not instantly.
      check('Lantern Guard corvette (s)', lg.t, '8..60', lg.t >= 8 && lg.t <= 60),
    ],
  };
}

// ── subsystem effects + torpedo point defence ────────────────────────

export function effectsScenario(): ScenarioResult {
  // Torpedoes vs point defence: 6 torpedoes launched one by one at a Lantern Guard with PD live.
  seed = 5;
  const w = world();
  const lg = w.fleet.spawn('ffc-lantern-guard', 'concord', ORIGIN.clone(), new Vector3(1, 0, 0));
  lg.flight.velocity.set(0, 0, 0);
  w.capitals.register(lg, { launchBlueprint: null });
  // Player-flagged so its own AI doesn't add launches of its own.
  const bomber = w.fleet.spawn('choir-psalter', 'choir', ORIGIN.clone().add(new Vector3(0, 300, 3200)), new Vector3(0, 0, -1), { isPlayer: true });
  bomber.target = lg;
  let intercepted = 0;
  let hits = 0;
  // Three waves of a pair (a Psalter element's worth).
  for (let k = 0; k < 3; k++) {
    w.missiles.salvo(bomber, lg, MISSILES.torpedo);
    w.missiles.salvo(bomber, lg, MISSILES.torpedo);
    for (let t = 0; t < 14; t += DT) {
      bomber.flight.position.copy(ORIGIN).add(_b.set(0, 300, 3200));
      hold(bomber, new Vector3());
      bomber.controls.fire = false;
      lg.flight.velocity.set(0, 0, 0);
      w.capitals.step(DT);
      w.fleet.step(DT);
      w.weapons.step(DT);
      w.missiles.step(DT);
      for (const e of w.missiles.events) {
        if (e.kind !== 'detonate') continue;
        if (e.intercepted) intercepted++;
        else hits++;
      }
    }
  }
  // Subsystem effects on a capital: kill engines → drift; shield gen → shields down; bridge → coordination.
  const w2 = world();
  const cap = w2.fleet.spawn('bb-indomitable', 'concord', ORIGIN.clone(), new Vector3(0, 0, 1));
  w2.capitals.register(cap, { launchBlueprint: null });
  const kill = (kind: string) => {
    for (const s of cap.combat.dmg.subsystems) if (s.kind === kind) w2.fleet.hit(cap, s.hpMax, 'explosive', subsystemPosition(cap, s, _a), null, null);
  };
  cap.combat.dmg.facings.fill(0);
  cap.shield = 0;
  const speed0 = (() => {
    for (let t = 0; t < 20; t += DT) {
      w2.capitals.step(DT);
      w2.fleet.step(DT);
    }
    return cap.flight.speed;
  })();
  const drop = () => {
    cap.combat.dmg.facings.fill(0);
    cap.shield = 0;
    cap.sinceHit = 0;
  };
  drop();
  kill('engine');
  for (let t = 0; t < 20; t += DT) {
    w2.capitals.step(DT);
    w2.fleet.step(DT);
  }
  const drift = !cap.flight.flightAssist && cap.combat.cap.drift;
  drop();
  kill('shieldGen');
  const regenBlocked = (() => {
    cap.sinceHit = 99;
    for (let t = 0; t < 5; t += DT) w2.fleet.step(DT);
    return cap.shield === 0;
  })();
  drop();
  kill('bridge');
  w2.fleet.step(DT);
  w2.capitals.step(DT);
  return {
    name: 'subsystem effects + torpedo point defence',
    metrics: { torpedoes: `3 pairs launched · ${intercepted} shot down · ${hits} hit`, capitalSpeed: `${speed0.toFixed(1)} m/s before engines lost` },
    checks: [
      check('point defence shoots torpedoes down', intercepted, '>= 1', intercepted >= 1),
      check('some torpedoes get through', hits, '>= 1', hits >= 1),
      check('engines destroyed → drifting', drift ? 1 : 0, '== 1', drift),
      check('shield generator destroyed → no regen', regenBlocked ? 1 : 0, '== 1', regenBlocked),
      check('bridge destroyed → fire control lost', cap.combat.cap.coordination, '< 1', cap.combat.cap.coordination < 1),
    ],
  };
}

// ── outfitting: fitted player hulls vs AI warships ──────────────────

/** A "good" dockside fit: Mk III guns, turrets, shield, plate and reactor (legal on the power budget). */
export function goodFit(hullId: string): Fit {
  const e = CATALOG_BY_ID[hullId];
  const fit = { ...stockFit(e) };
  for (const s of slotsFor(e)) {
    const id = fit[s.id];
    if (!id) continue;
    if (s.kind === 'gun' || s.kind === 'turret' || s.kind === 'missile' || s.kind === 'shield' || s.kind === 'armour' || s.kind === 'reactor') fit[s.id] = id.replace(/-mk\d$/, '-mk3');
  }
  return fit;
}

export interface DuelOut {
  /** Seconds to kill the target (Infinity = didn't). */
  t: number;
  /** Attacker hull left, 0..1 (0 = lost). */
  hullLeft: number;
  power: { draw: number; output: number };
  torps: number;
}

/**
 * A fitted player hull (scripted helm: holds a standoff and keeps the bow —
 * and the spinal gun — on the target, aim σ = 0.6% of range) against an AI
 * warship registered with Capitals, whose turrets and lances fire back.
 * The attacker's turrets are the real outfitting system (assisted aim,
 * FREE); torpedoes go in on reload.
 */
export function fittedDuel(hullId: string, fit: Fit, targetBp: string, range = 1500, maxT = 300, seeds = [31, 47, 59, 73]): DuelOut {
  // Capitals draws on Math.random (turret cadence, scatter): seed it so the bands are repeatable,
  // and average a few seeds (a capital duel is chaotic: facings, torpedo intercepts).
  const random = Math.random;
  Math.random = rand;
  try {
    const runs = seeds.map((sd) => duelInner(hullId, fit, targetBp, range, maxT, sd));
    const mean = (f: (d: DuelOut) => number) => runs.reduce((n, d) => n + f(d), 0) / runs.length;
    return { t: mean((d) => d.t), hullLeft: mean((d) => d.hullLeft), power: runs[0].power, torps: Math.round(mean((d) => d.torps)) };
  } finally {
    Math.random = random;
  }
}

function duelInner(hullId: string, fit: Fit, targetBp: string, range: number, maxT: number, sd: number): DuelOut {
  seed = sd;
  const w = world();
  const turrets = new ShipTurrets(w.fleet, w.weapons, w.capitals);
  const tgt = w.fleet.spawn(targetBp, targetBp.startsWith('choir') ? 'choir' : 'concord', ORIGIN.clone(), new Vector3(1, 0, 0));
  tgt.team = 'renegade';
  w.capitals.register(tgt, { launchBlueprint: null });
  const e = CATALOG_BY_ID[hullId];
  const pos = ORIGIN.clone().add(new Vector3(0, range * 0.12, range));
  const sh = w.fleet.spawn(e.blueprint, 'concord', pos, new Vector3(0, 0, -1), { isPlayer: true });
  const r = applyFit(sh, e, fit);
  sh.target = tgt;
  const torp = sh.combat.loadout.missiles.indexOf('torpedo');
  if (torp >= 0) sh.combat.missile = torp;
  const zero = new Vector3();
  const aim = new Vector3();
  let torps = 0;
  let t = 0;
  for (; t < maxT && tgt.alive && sh.alive; t += DT) {
    tgt.flight.velocity.set(0, 0, 0);
    tgt.flight.position.copy(ORIGIN);
    sh.flight.position.copy(pos);
    hold(sh, zero);
    // Walk fire along the hull a little (a pilot raking the plating).
    toUniverse(tgt, tgt.combat.dmg.cx + Math.sin(t * 0.7) * tgt.combat.dmg.halfW * 0.3, tgt.combat.dmg.cy, tgt.combat.dmg.cz + Math.sin(t * 0.37) * tgt.combat.dmg.halfL * 0.5, aim);
    if (sh.combat.loadout.guns.length) {
      chooseGun(sh, tgt);
      aimAndFire(sh, aim, zero, range * 0.006);
    } else faceAlong(sh.flight.orientation, _b.subVectors(aim, sh.flight.position).normalize());
    if (torp >= 0 && sh.combat.missileReload <= 0 && w.missiles.salvo(sh, tgt)) torps++;
    w.capitals.step(DT);
    turrets.step(DT, tgt);
    w.fleet.step(DT);
    w.weapons.step(DT);
    w.missiles.step(DT);
  }
  return { t: tgt.alive ? Infinity : t, hullLeft: sh.alive ? sh.hull / sh.hullMax : 0, power: r.power, torps };
}

export function outfitScenario(): ScenarioResult {
  const resGood = fittedDuel('cr5-resolute', goodFit('cr5-resolute'), 'ffc-lantern-guard');
  const resStock = fittedDuel('cr5-resolute', stockFit(CATALOG_BY_ID['cr5-resolute']), 'ffc-lantern-guard');
  const valGood = fittedDuel('ffl3-valiant', goodFit('ffl3-valiant'), 'choir-vesper', 1800);
  const valStock = fittedDuel('ffl3-valiant', stockFit(CATALOG_BY_ID['ffl3-valiant']), 'choir-vesper', 1800);
  const bulGood = fittedDuel('gs12-bulwark', goodFit('gs12-bulwark'), 'ffc-lantern-guard', 1200, 400);
  const fmt = (d: DuelOut) => `${d.t.toFixed(1)} s · hull left ${(d.hullLeft * 100).toFixed(0)}% · ${d.torps} torpedoes · ${d.power.draw}/${d.power.output} MW`;
  // The stock Kestrel through the fit layer is the legacy Kestrel, number for number.
  const k = CATALOG_BY_ID['vf27-kestrel'];
  const kf = computeFit(k, stockFit(k));
  const legacy = kf.stats.hull === SHIP_STATS['vf27-kestrel'].hull && kf.stats.shield === SHIP_STATS['vf27-kestrel'].shield && kf.loadout.guns.join() === 'laser,autocannon';
  return {
    name: 'outfitting: fitted hulls vs AI warships (scripted helm at standoff, turrets live on both sides)',
    metrics: {
      resoluteGoodVsLanternGuard: fmt(resGood),
      resoluteStockVsLanternGuard: fmt(resStock),
      valiantGoodVsVesper: fmt(valGood),
      valiantStockVsVesper: fmt(valStock),
      bulwarkGoodVsLanternGuard: fmt(bulGood),
    },
    checks: [
      check('Resolute (Mk III fit) solo kills a Lantern Guard (s)', resGood.t, '60..120', resGood.t >= 60 && resGood.t <= 120),
      check('… and survives (hull left %)', resGood.hullLeft * 100, '> 10', resGood.hullLeft > 0.1),
      check('Mk III fit beats stock (s faster)', resStock.t - resGood.t, '> 0', resStock.t > resGood.t),
      check('Valiant (Mk III fit) wins a duel with a Vesper (s)', valGood.t, '20..120', valGood.t >= 20 && valGood.t <= 120),
      check('… and survives (hull left %)', valGood.hullLeft * 100, '> 10', valGood.hullLeft > 0.1),
      check('good fits are legal on the power budget', Math.max(resGood.power.draw - resGood.power.output, valGood.power.draw - valGood.power.output), '<= 0', resGood.power.draw <= resGood.power.output && valGood.power.draw <= valGood.power.output),
      check('stock Kestrel through the fit layer = legacy Kestrel', legacy ? 1 : 0, '== 1', legacy),
      info('Bulwark (Mk III) vs Lantern Guard (s)', bulGood.t, `gunship: not what it is for · hull left ${(bulGood.hullLeft * 100).toFixed(0)}%`),
    ],
  };
}

void GUNS;

const SCENARIOS: [string, () => ScenarioResult][] = [
  ['damage types', damageTypeScenario],
  ['fighter', fighterScenario],
  ['turret', turretScenario],
  ['capital', capitalScenario],
  ['effects', effectsScenario],
  ['outfit', outfitScenario],
];

export function runAll(filter = ''): ScenarioResult[] {
  return SCENARIOS.filter(([n]) => n.includes(filter)).map(([, run]) => run());
}
