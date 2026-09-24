/**
 * How a big hull dies — pure data + functions (no three.js; unit-tested in
 * tests/destruction.test.ts). Damage.ts owns one `Structure` per ship and
 * feeds it; Combat.settleDeath reads `pending` and kills the ship by that
 * path; src/sim/Destruction.ts leaves the pieces.
 *
 * - **Sections**: capitals are cut into three sections along the keel (bow /
 *   midships / stern). Hull damage with an impact point lands on the section
 *   it hit; a section driven to zero fails and the spine breaks there
 *   (structural kill). The ends are tough (a warship fights nose-on and soaks
 *   it there), the spine is the weak point: rake the midships and she snaps
 *   before the hull runs out. Untargeted damage (collisions, cook-offs,
 *   shockwaves without a point) is spread and never snaps a hull.
 * - **Reactor**: the core subsystem destroyed → CRITICAL: a fuse counts down
 *   to a detonation while the crew vents the core. Venting is faster than the
 *   fuse, so the reactor only blows if someone keeps shooting at the core —
 *   every hit near it knocks the vent back (VENT_KNOCKBACK).
 * - **Bridge**: the command deck gone and the hull under STRIKE_HULL — the
 *   crew strikes (bridge kill: the whole hull drifts dark). With the hull
 *   still sound, she fights on blind (Damage.capitalEffects coordination).
 * - **Hull depletion**: the hull pool runs out (the rolling chain).
 */

export type DeathCause = 'hull' | 'structural' | 'reactor' | 'bridge';
export const SECTION_NAMES = ['BOW', 'MIDSHIPS', 'STERN'] as const;
/** Section integrity as a fraction of hull: [bow, midships, stern]. */
export const SECTION_SHARE = [0.85, 0.75, 0.85] as const;

export interface Section {
  /** Ship-local z extent (z1 > z0; bow is +Z). The outer sections reach to ±∞. */
  z0: number;
  z1: number;
  hp: number;
  hpMax: number;
}

export type ReactorPhase = 'ok' | 'critical' | 'vented' | 'detonated';

export interface ReactorState {
  phase: ReactorPhase;
  /** Seconds left on the fuse while critical. */
  t: number;
  fuse: number;
  /** Crew venting progress 0..1 while critical (1 = vented, the ship lives). */
  vent: number;
  ventTime: number;
  /** Ship id that sent the core critical (kill credit), 0 = none. */
  by: number;
}

export interface Structure {
  /** [bow, midships, stern] on capitals; empty for everything else. */
  sections: Section[];
  reactor: ReactorState;
  /** A kill path tripped; Combat.settleDeath kills the ship by it and moves it into `death`. */
  pending: DeathCause | null;
  death: DeathCause | null;
  /** Ship-local z where the hull broke (structural), NaN otherwise. */
  breakZ: number;
  /** Section index that failed, −1 none. */
  failed: number;
  /** Last ship id that did damage (kill credit for delayed deaths), 0 = none. */
  lastBy: number;
}

/** Fuse and vent times (s) by hull length: capitals burn longer. */
export function reactorTiming(length: number): { fuse: number; ventTime: number } {
  const big = length > 400;
  return { fuse: big ? 18 : 7, ventTime: big ? 12.5 : 5 };
}

/** Vent knock-back per point of damage near a critical core, as a fraction of its hit points. */
export const VENT_KNOCKBACK = 0.05;

/** With the bridge gone, the crew strikes once the hull is this far gone (hull fraction left). */
export const STRIKE_HULL = 0.35;

export function createStructure(sectioned: boolean, cz: number, halfL: number, hullMax: number, length = halfL * 2): Structure {
  const sections: Section[] = [];
  if (sectioned) {
    const z = [cz + halfL, cz + halfL / 3, cz - halfL / 3, cz - halfL];
    for (let i = 0; i < 3; i++) {
      const hpMax = hullMax * SECTION_SHARE[i];
      sections.push({ z0: i === 2 ? -Infinity : z[i + 1], z1: i === 0 ? Infinity : z[i], hp: hpMax, hpMax });
    }
  }
  const { fuse, ventTime } = reactorTiming(length);
  return { sections, reactor: { phase: 'ok', t: 0, fuse, vent: 0, ventTime, by: 0 }, pending: null, death: null, breakZ: NaN, failed: -1, lastBy: 0 };
}

export function resetStructure(s: Structure): void {
  for (const sec of s.sections) sec.hp = sec.hpMax;
  const r = s.reactor;
  r.phase = 'ok';
  r.t = r.vent = 0;
  r.by = 0;
  s.pending = s.death = null;
  s.breakZ = NaN;
  s.failed = -1;
  s.lastBy = 0;
}

/** Re-size the sections to a new hull figure (refit), keeping each one's damage fraction. */
export function rescaleStructure(s: Structure, hullMax: number): void {
  s.sections.forEach((sec, i) => {
    const k = sec.hpMax > 0 ? sec.hp / sec.hpMax : 1;
    sec.hpMax = hullMax * SECTION_SHARE[i];
    sec.hp = k * sec.hpMax;
  });
}

export function sectionAt(s: Structure, z: number): number {
  for (let i = 0; i < s.sections.length; i++) if (z >= s.sections[i].z0 && z < s.sections[i].z1) return i;
  return -1;
}

/** Where a failed section breaks the hull: midships snaps in its middle (the spine), bow and stern tear off at their inner joint. */
export function breakPlane(s: Structure, i: number): number {
  const sec = s.sections;
  if (i === 1) return (sec[1].z0 + sec[1].z1) / 2;
  if (i === 0) return sec[0].z0;
  return sec[2].z1;
}

/**
 * Hull damage at ship-local z (null = spread over the hull). Returns the
 * section that failed on this hit, or −1. A failure sets `pending = 'structural'`.
 */
export function damageSection(s: Structure, z: number | null, amount: number): number {
  if (!s.sections.length || amount <= 0) return -1;
  if (z === null) {
    for (const sec of s.sections) sec.hp = Math.max(1, sec.hp - amount / 3);
    return -1;
  }
  const i = sectionAt(s, z);
  if (i < 0) return -1;
  const sec = s.sections[i];
  if (sec.hp <= 0) return -1;
  sec.hp -= amount;
  if (sec.hp > 0) return -1;
  sec.hp = 0;
  if (!s.pending && !s.death) {
    s.pending = 'structural';
    s.failed = i;
    s.breakZ = breakPlane(s, i);
  }
  return i;
}

/** The core took a killing blow: the fuse is lit (the crew starts venting). */
export function reactorCritical(s: Structure, by: number): void {
  const r = s.reactor;
  if (r.phase !== 'ok') return;
  r.phase = 'critical';
  r.t = r.fuse;
  r.vent = 0;
  r.by = by;
}

/** Damage near a critical core sets the crew's venting back. */
export function reactorStruck(s: Structure, damage: number, hpMax: number): void {
  const r = s.reactor;
  if (r.phase !== 'critical') return;
  r.vent = Math.max(0, r.vent - damage / Math.max(1, hpMax * VENT_KNOCKBACK));
}

/**
 * Tick a critical reactor. Returns 'vented' / 'detonated' on the tick the
 * crisis resolves, else null. A detonation sets `pending = 'reactor'`.
 */
export function stepReactor(s: Structure, dt: number): 'vented' | 'detonated' | null {
  const r = s.reactor;
  if (r.phase !== 'critical') return null;
  r.t -= dt;
  r.vent += dt / r.ventTime;
  if (r.vent >= 1) {
    r.vent = 1;
    r.phase = 'vented';
    return 'vented';
  }
  if (r.t <= 0) {
    r.t = 0;
    r.phase = 'detonated';
    if (!s.death && !s.pending) s.pending = 'reactor';
    return 'detonated';
  }
  return null;
}

export interface ShockwaveSpec {
  /** Reach (m). */
  radius: number;
  /** Front speed (m/s). */
  speed: number;
  /** Peak damage to a capital-class target at the blast, and to anything smaller. */
  peakCapital: number;
  peakSmall: number;
}

/** Shockwave of a reactor detonation by the dead hull's length and hull points. */
export function shockwaveSpec(length: number, hullMax: number): ShockwaveSpec {
  return { radius: Math.min(2600, Math.max(450, length * 0.75)), speed: 1100, peakCapital: hullMax * 0.12, peakSmall: 420 };
}

/** Shockwave damage to a ship `d` metres from the blast (`big` = capital-class target). */
export function shockwaveDamage(spec: ShockwaveSpec, d: number, big: boolean): number {
  if (d >= spec.radius) return 0;
  const k = 1 - d / spec.radius;
  return big ? spec.peakCapital * k * k : spec.peakSmall * k;
}

/** What settleDeath needs of a ship (ShipEntity satisfies it). */
export interface Mortal {
  alive: boolean;
  hull: number;
  hullMax: number;
  plotArmour: boolean;
  isPlayer: boolean;
  model: { root: { visible: boolean } };
  combat: { dmg: { structure: Structure } };
}

/**
 * Apply a pending kill path or hull depletion. Plot armour holds the hull at
 * 15 % and refuses every kill path (a failed section holds by a thread, a
 * critical core is vented); the player never strikes on a lost bridge (the
 * cockpit fights on). Returns true when the ship died now; how is
 * `combat.dmg.structure.death`.
 */
export function settleDeath(s: Mortal): boolean {
  if (!s.alive) return false;
  const S = s.combat.dmg.structure;
  if (S.pending && (s.plotArmour || (s.isPlayer && S.pending === 'bridge'))) {
    if (S.pending === 'structural' && S.failed >= 0) S.sections[S.failed].hp = 1;
    if (S.pending === 'reactor') S.reactor.phase = 'vented';
    S.pending = null;
    S.failed = -1;
    S.breakZ = NaN;
  }
  if (s.plotArmour) s.hull = Math.max(s.hull, s.hullMax * 0.15);
  if (s.hull > 0 && !S.pending) return false;
  S.death = S.pending ?? 'hull';
  S.pending = null;
  s.hull = 0;
  s.alive = false;
  s.model.root.visible = false;
  return true;
}
