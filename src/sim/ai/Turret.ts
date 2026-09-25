import { Vector3 } from 'three';
import { hostile, type ShipEntity, type Shootables, type Team } from '../Fleet';
import { GUN, leadPoint } from './Pilot';
import { isCapital } from './state';

/**
 * Milestone 14 — capital-ship turret targeting.
 *
 * Pure functions: the weapons system owns turrets (slew rates, cooldowns,
 * visuals) and asks here "what should this mount shoot, and where do I point
 * the barrel?". All vectors are world space; nothing is allocated.
 */
export interface TurretMount {
  /** Muzzle position (world). */
  position: Vector3;
  /** Centre of traverse (world, unit). */
  forward: Vector3;
  /** Mount normal (world, unit): elevation is measured from the plane it defines. */
  up: Vector3;
  /** Half-angle of azimuth traverse about `up`, radians (π = full circle). */
  traverse: number;
  /** Elevation limits above the mount plane, radians. */
  minElevation: number;
  maxElevation: number;
  range: number;
  boltSpeed: number;
  /** Velocity of the carrying ship (bolts inherit it when GUN.inheritVelocity). */
  velocity: Vector3;
}

export interface TurretSolution {
  target: ShipEntity | null;
  /** Unit barrel direction (world). */
  aimDir: Vector3;
  /** Lead point (world). */
  aimPoint: Vector3;
  /** Bolt time of flight, s. */
  time: number;
  distance: number;
}

export function createTurretSolution(): TurretSolution {
  return { target: null, aimDir: new Vector3(0, 0, 1), aimPoint: new Vector3(), time: 0, distance: 0 };
}

const _h = new Vector3();
const _p = new Vector3();

/** Is a world direction inside the mount's traverse / elevation limits? */
export function turretCanPoint(m: TurretMount, dir: Vector3): boolean {
  const s = Math.max(-1, Math.min(1, dir.dot(m.up)));
  const elev = Math.asin(s);
  if (elev < m.minElevation || elev > m.maxElevation) return false;
  if (m.traverse >= Math.PI) return true;
  _h.copy(dir).addScaledVector(m.up, -s);
  const hl = _h.length();
  if (hl < 1e-6) return true; // straight up/down: azimuth is moot
  return Math.acos(Math.max(-1, Math.min(1, _h.dot(m.forward) / hl))) <= m.traverse;
}

/**
 * Lead solution for one target. Fills `out` (target, aimDir, aimPoint, time,
 * distance) and returns true if it is in range and within the mount's limits.
 */
export function turretAim(m: TurretMount, target: ShipEntity, out: TurretSolution): boolean {
  const tf = target.flight;
  const t = leadPoint(m.position, m.velocity, tf.position, tf.velocity, null, out.aimPoint, m.boltSpeed);
  if (t < 0) return false;
  _p.subVectors(out.aimPoint, m.position);
  const d = _p.length();
  if (d < 1e-3) return false;
  out.aimDir.copy(_p).divideScalar(d);
  out.time = t;
  out.distance = tf.position.distanceTo(m.position);
  out.target = target;
  return out.distance <= m.range && turretCanPoint(m, out.aimDir);
}

const _best = createTurretSolution();
const _try = createTurretSolution();

const _ordPos = new Vector3();
const _ordVel = new Vector3();
const _ordAim = new Vector3();
const _ordDir = new Vector3();

/** Select the nearest ordnance with a reachable lead solution, not just the nearest missile. */
export function turretSelectThreat(m: TurretMount, team: Team, ord: Shootables, range: number, out: TurretSolution): boolean {
  const canEngage = (pos: Vector3, vel: Vector3) =>
    leadPoint(m.position, m.velocity, pos, vel, null, _ordAim, m.boltSpeed) > 0 &&
    turretCanPoint(m, _ordDir.subVectors(_ordAim, m.position).normalize());
  if (ord.nearestThreat(m.position, team, range, _ordPos, _ordVel, canEngage) < 0) return false;
  // Filtering may have examined a rejected candidate after the winner.
  out.time = leadPoint(m.position, m.velocity, _ordPos, _ordVel, null, out.aimPoint, m.boltSpeed);
  out.aimDir.subVectors(out.aimPoint, m.position).normalize();
  out.distance = _ordPos.distanceTo(m.position);
  out.target = null;
  return true;
}

/**
 * Choose what a turret should engage. Prefers short flight time, fighters
 * closing on the mount, the player (point-defence priority), and the current
 * target (hysteresis so turrets don't twitch between ships). Capital ships are
 * skipped unless `allowCapitals` (a player-flown capital is always fair game). Returns true and fills `out` on success.
 */
export function turretSelectTarget(
  m: TurretMount,
  team: Team,
  ships: readonly ShipEntity[],
  current: ShipEntity | null,
  out: TurretSolution,
  allowCapitals = false,
): boolean {
  let bestScore = Infinity;
  _best.target = null;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive || !hostile(s, { team })) continue;
    // Capital hulls are other capitals' business — except the player's own (a shipyard frigate).
    if (!allowCapitals && isCapital(s) && !s.isPlayer) continue;
    if (!turretAim(m, s, _try)) continue;
    // Closing speed toward the mount (positive = inbound).
    _p.subVectors(m.position, s.flight.position).normalize();
    const closing = s.flight.velocity.dot(_p);
    let score = _try.time * (1 - Math.max(-0.3, Math.min(0.4, closing / 1000)));
    if (s.isPlayer) score *= 0.85;
    if (s === current) score *= 0.7;
    if (score < bestScore) {
      bestScore = score;
      copySolution(_try, _best);
    }
  }
  if (!_best.target) {
    out.target = null;
    return false;
  }
  copySolution(_best, out);
  return true;
}

function copySolution(a: TurretSolution, b: TurretSolution): void {
  b.target = a.target;
  b.aimDir.copy(a.aimDir);
  b.aimPoint.copy(a.aimPoint);
  b.time = a.time;
  b.distance = a.distance;
}

/** Default mount parameters for a capital point-defence gun. */
export const TURRET_DEFAULTS = {
  traverse: Math.PI,
  minElevation: -0.1,
  maxElevation: 1.45,
  range: 2200,
  boltSpeed: GUN.boltSpeed,
};
