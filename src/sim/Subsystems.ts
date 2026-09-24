/**
 * Subsystem targeting and destruction rules — pure functions over the damage
 * state (Damage.ts), no three.js, no scene (unit-tested in
 * tests/subsystems.test.ts). Combat.ts, Fleet.ts, Missiles.ts, the fighter
 * brain and the HUD call into this; the numbers live here.
 *
 *   exposure   a subsystem is EXPOSED when the shield facing covering it is
 *              down (the facing is picked by Damage.facingOf from the mount's
 *              own position, the same function every hit uses), or the ship
 *              has no shield up at all. Shielded mounts are PROTECTED: shots
 *              at them spend themselves on the facing first.
 *   aimed hit  each intact mount has a hit sphere (AIM_SPHERE × its routing
 *              radius) tested before the plating once the shield over it is
 *              down (`segmentSubsystem`, Combat.raycastShip), so a small
 *              turret on a 3 km hull is reliably hittable where it is aimed at.
 *   targeting  B cycles exposed mounts first, then protected ones (Shift+B
 *              backwards); I / middle mouse takes the one nearest the
 *              crosshair. Fighters on a capital strip the shield, then the
 *              exposed turrets and lances; bombers go for the shield
 *              generator and engines (`chooseAttackSubsystem`).
 *   splash     warheads (MissileSpec.blast, GunSpec.blast) that burst on
 *              plating damage every intact subsystem within the blast radius,
 *              linear falloff from the mount's edge (`splashSubsystems`).
 *   secondary  a destroyed hangar cooks off: hull damage plus a splash on
 *              its neighbours (Fleet.blast).
 *   repair     damage control (`repairSubsystems`): after REPAIR.delay s
 *              without a hit, damaged mounts regain REPAIR.rate of max hp per
 *              second; after REPAIR.restoreAfter s one destroyed turret per
 *              REPAIR.restoreEvery s comes back at REPAIR.restoreHp. Nothing
 *              else is ever restored in flight (lances, hangars, engines,
 *              bridge and shield generator stay dead until the yard).
 */
import { DAMAGE_MUL, facingOf, facingUp, hitSubsystem, type DamageState, type Pools, type Subsystem, type SubsystemKind } from './Damage.ts';
import type { DamageType } from './Loadouts';

/** Aimed-hit sphere as a fraction of a subsystem's routing radius (Combat.raycastShip). */
export const AIM_SPHERE = 0.6;

/** Blast splash: fraction of the warhead's damage a mount at the burst point takes. */
export const SPLASH_FRAC = 0.5;
/**
 * …but one burst takes at most this fraction of a mount's max hp: splash
 * wears a cluster down, a direct hit or a second burst finishes it (on a
 * corvette a torpedo would otherwise wipe every mount on the hull at once).
 */
export const SPLASH_CAP = 0.7;

/** Hangar cook-off: hull damage and splash as multiples of the hangar's max hp; blast radius × its routing radius. */
export const HANGAR_SECONDARY = { hull: 1.0, splash: 0.8, radius: 2.5 } as const;

/** Damage control (see the header). */
export const REPAIR = { delay: 20, rate: 0.01, restoreAfter: 180, restoreEvery: 60, restoreHp: 0.25 } as const;

const _p = { x: 0, y: 0, z: 0 };

/**
 * Exposed: the shield layer over this mount is down — the facing that covers
 * the mount's position (Damage.facingOf, the same function every hit and the
 * shield shell use: fore / aft halves on fighters and gunships, 4 or 6
 * facings on capitals) holds no charge. A hull without facings falls back on
 * its pool (`shield` = the ship's current shield).
 */
export function subsystemExposed(st: DamageState, shield: number, sub: Subsystem): boolean {
  if (!st.facings.length) return shield <= 0;
  _p.x = sub.x;
  _p.y = sub.y;
  _p.z = sub.z;
  // (Any charge left holds the shell — the same test raycastShip makes — so 0, not facingUp's default margin.)
  return !facingUp(st, facingOf(st, _p), 0);
}

/** Intact subsystems whose shield is down. */
export function exposedCount(st: DamageState, shield: number): number {
  let n = 0;
  for (const s of st.subsystems) if (!s.destroyed && subsystemExposed(st, shield, s)) n++;
  return n;
}

/** Cycle key: exposed mounts first, then protected, each in list order. */
function cycleKey(st: DamageState, shield: number, i: number): number {
  return (subsystemExposed(st, shield, st.subsystems[i]) ? 0 : st.subsystems.length) + i;
}

/**
 * Next (dir 1) or previous (dir −1) intact subsystem after `cur` in cycle
 * order (exposed first). −1 = none selected: forward from none starts at the
 * first, backward from none at the last; stepping past either end deselects.
 */
export function nextSubsystem(st: DamageState, shield: number, cur: number, dir: 1 | -1): number {
  const subs = st.subsystems;
  const valid = cur >= 0 && cur < subs.length;
  const ck = valid ? cycleKey(st, shield, cur) : dir > 0 ? -1 : Infinity;
  let best = -1;
  let bk = dir > 0 ? Infinity : -Infinity;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].destroyed || i === cur) continue;
    const k = cycleKey(st, shield, i);
    if (dir > 0 ? k > ck && k < bk : k < ck && k > bk) {
      bk = k;
      best = i;
    }
  }
  return best;
}

/**
 * The intact subsystem nearest a sight line (ship-local origin `o`, unit
 * direction `d`), within `maxAngle` rad of it; protected mounts count as
 * `shieldedPenalty` × further off. −1 if nothing is in the cone.
 */
export function subsystemNearestRay(st: DamageState, shield: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxAngle: number, shieldedPenalty = 2): number {
  let best = -1;
  let bs = Infinity;
  const subs = st.subsystems;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    if (s.destroyed) continue;
    const rx = s.x - ox;
    const ry = s.y - oy;
    const rz = s.z - oz;
    const len = Math.hypot(rx, ry, rz);
    if (len < 1e-6) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (rx * dx + ry * dy + rz * dz) / len)));
    // A big mount fills more of the view: measure to its edge, not its centre.
    const edge = Math.max(0, ang - Math.atan2(s.radius * AIM_SPHERE, len));
    if (edge > maxAngle) continue;
    const score = edge * (subsystemExposed(st, shield, s) ? 1 : shieldedPenalty) + ang * 0.01;
    if (score < bs) {
      bs = score;
      best = i;
    }
  }
  return best;
}

/** Result of `segmentSubsystem`: entry parameter and closest-approach parameter (clamped to [t, tMax]). */
export interface SegmentSubHit {
  t: number;
  c: number;
}

/**
 * Aimed hits: the earliest intact subsystem whose hit sphere (routing radius
 * × AIM_SPHERE, + pad) the ship-local segment o + t·d enters for t ≤ tMax
 * (Combat.raycastShip passes the plating's t, so the hull still shields what
 * is behind it). Writes `out`; allocation-free.
 */
export function segmentSubsystem(subs: readonly Subsystem[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pad: number, tMax: number, out: SegmentSubHit): Subsystem | null {
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return null;
  let best: Subsystem | null = null;
  let bt = tMax + 1e-9;
  let bc = 0;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    if (s.destroyed) continue;
    const r = s.radius * AIM_SPHERE + pad;
    const mx = ox - s.x;
    const my = oy - s.y;
    const mz = oz - s.z;
    const cc = mx * mx + my * my + mz * mz - r * r;
    const bb = mx * dx + my * dy + mz * dz;
    let t = 0;
    if (cc > 0) {
      if (bb > 0) continue;
      const disc = bb * bb - a * cc;
      if (disc < 0) continue;
      t = (-bb - Math.sqrt(disc)) / a;
    }
    if (t < bt) {
      bt = t;
      bc = -bb / a;
      best = s;
    }
  }
  if (best) {
    out.t = bt;
    out.c = Math.max(bt, Math.min(bc, tMax));
  }
  return best;
}

/** What a fighter wants to kill on a capital, by kind (lower = sooner). */
export type KindWeights = Readonly<Record<SubsystemKind, number>>;

/** Fighters strip the guns that shoot at them: turrets and lances first. */
export const FIGHTER_PREFS: KindWeights = { turret: 1, lance: 1, hangar: 2.5, engine: 3, shieldGen: 2, shieldEmitter: 1.5, bridge: 3 };
/** Bombers go for what keeps the hull fighting: shield emitters (a lost one keeps its facing down) and the generator, then engines. */
export const BOMBER_PREFS: KindWeights = { turret: 2, lance: 2, hangar: 2, engine: 0.8, shieldGen: 0.5, shieldEmitter: 0.4, bridge: 1.5 };

/**
 * An attacker's pick on a capital: the exposed subsystem with the lowest
 * distance × kind weight from `from` (ship-local), or −1 while every mount is
 * still under its shield (keep working the facing). `keep` (the current pick)
 * wins ties by a margin so a wing doesn't flit between two turrets.
 */
export function chooseAttackSubsystem(st: DamageState, shield: number, fx: number, fy: number, fz: number, prefs: KindWeights, keep = -1): number {
  let best = -1;
  let bs = Infinity;
  const subs = st.subsystems;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    if (s.destroyed || !subsystemExposed(st, shield, s)) continue;
    const score = Math.hypot(s.x - fx, s.y - fy, s.z - fz) * prefs[s.kind] * (i === keep ? 0.7 : 1);
    if (score < bs) {
      bs = score;
      best = i;
    }
  }
  return best;
}

/**
 * Blast splash from a warhead that burst at ship-local (x, y, z): every intact
 * subsystem (except `skip`, the one the direct hit already struck) whose
 * edge lies within `radius` takes SPLASH_FRAC × amount × type multiplier,
 * falling off linearly to nothing at the rim, capped at SPLASH_CAP of its
 * max hp per burst. Shields don't matter — the
 * burst is already inside the shell. Destroyed mounts are pushed to `out`
 * (cleared first). Returns the total subsystem damage dealt.
 */
export function splashSubsystems(st: DamageState, pools: Pools, x: number, y: number, z: number, radius: number, amount: number, type: DamageType, skip: Subsystem | null, out: Subsystem[]): number {
  out.length = 0;
  if (radius <= 0 || amount <= 0) return 0;
  const mul = DAMAGE_MUL[type].subsystem;
  let total = 0;
  for (const s of st.subsystems) {
    if (s.destroyed || s === skip) continue;
    const d = Math.max(0, Math.hypot(s.x - x, s.y - y, s.z - z) - s.radius * AIM_SPHERE);
    if (d >= radius) continue;
    const dmg = Math.min(amount * SPLASH_FRAC * (1 - d / radius) * mul, s.hpMax * SPLASH_CAP);
    total += Math.min(dmg, s.hp);
    if (hitSubsystem(st, pools, s, dmg)) out.push(s);
  }
  return total;
}

/**
 * Damage control, once per step (`sinceHit` = seconds since the ship was
 * last hit). Returns the subsystem brought back from destroyed this step, or
 * null. Stateless beyond `sinceHit`: the restore cadence is read off it, so
 * any hit resets the clock.
 */
export function repairSubsystems(st: DamageState, sinceHit: number, dt: number): Subsystem | null {
  if (sinceHit < REPAIR.delay || !st.subsystems.length) return null;
  const heal = REPAIR.rate * dt;
  for (const s of st.subsystems) {
    if (s.destroyed || s.hp >= s.hpMax) continue;
    const before = s.hp;
    s.hp = Math.min(s.hpMax, s.hp + s.hpMax * heal);
    if (Math.floor((s.hp / s.hpMax) * 10) !== Math.floor((before / s.hpMax) * 10)) st.version++;
  }
  const t = sinceHit - REPAIR.restoreAfter;
  if (t < 0 || Math.floor(t / REPAIR.restoreEvery) === Math.floor((t - dt) / REPAIR.restoreEvery)) return null;
  for (const s of st.subsystems) {
    if (!s.destroyed || s.kind !== 'turret') continue;
    s.destroyed = false;
    s.hp = s.hpMax * REPAIR.restoreHp;
    st.version++;
    return s;
  }
  return null;
}
