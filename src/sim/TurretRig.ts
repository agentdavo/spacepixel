import { Matrix4, Quaternion, Vector3 } from 'three';
import type { ShipModel, TurretRigInfo } from '../assets/ShipBuilder';
import type { ShipEntity } from './Fleet';
import type { TurretMount } from './ai/Turret';

/**
 * Turret drive: the physically limited half of a gun mount, shared by the
 * capital batteries (Capitals.ts) and fitted turrets (game/outfitting/turrets.ts).
 * The aim solvers (ai/Turret.ts) say *where* the barrels should point; this
 * says where they *do* point, and whether that is close enough to shoot.
 *
 *   rig      numbers from the built model (ShipBuilder `TurretRigInfo`, ship
 *            frame, rest pose): mount normal, rest bearing, trunnion, barrel
 *            muzzles, traverse / elevation limits. Read once at registration;
 *            the drive never touches the scene graph for sim state.
 *   drive    yaw + pitch (sim state), slewed toward the solution at a rate
 *            set by the mount's size (heavier = slower). Limited arcs never
 *            swing through the dead zone (no wrap-around); all-round mounts
 *            take the short way.
 *   gate     a mount fires only when its barrels are within a small angle of
 *            the solution (`aimError` ≤ tolerance); a target it can't reach
 *            leaves the error open, so it never fires.
 *   idle     no target: back to rest, then a slow scan of the arc.
 *   muzzles  barrel tips from the current yaw / pitch, one barrel after
 *            another through a salvo.
 *   wreck    a destroyed mount freezes skewed with its guns drooped;
 *            repaired, it snaps back to rest.
 *
 * `pose` copies the drive onto the model's joints (plus a visual recoil kick
 * on the guns) — render only, never read back. Everything here is pure
 * arithmetic on the drive's own numbers, so it is deterministic.
 *
 * Turret frame: x = side (up × fwd), y = up, z = rest bearing. Yaw turns
 * right-handed about up (from z toward x), pitch raises toward up.
 */

export interface TurretRig {
  socket: string;
  /** Joint ids (null: an unrigged socket — drives, but nothing moves on screen). */
  yawJoint: string | null;
  pitchJoint: string | null;
  /** Ship frame, rest pose (metres / unit vectors). */
  base: Vector3;
  up: Vector3;
  fwd: Vector3;
  side: Vector3;
  /** Trunnion relative to `base`, turret frame. */
  pivot: Vector3;
  /** Muzzle of each barrel relative to the trunnion, turret frame (at yaw = pitch = 0). */
  tips: Vector3[];
  /** Traverse limits relative to rest (rad); `full` = all round. */
  traverse: [number, number];
  full: boolean;
  /** Elevation limits above the mount plane (rad). */
  elevation: [number, number];
  /** Slew rates (rad/s). */
  yawRate: number;
  pitchRate: number;
  /** Recoil stroke (m, visual). */
  stroke: number;
  /** Per-mount constant from the socket id: scan phase, wreck skew side. */
  hash: number;
}

export interface TurretDrive {
  yaw: number;
  pitch: number;
  /** Seconds without a solution (drives the idle scan). */
  idle: number;
  /** Next barrel to fire. */
  barrel: number;
  /** Visual recoil 0..1 (decays). */
  recoil: number;
  wrecked: boolean;
}

/** Default arcs for an unrigged socket (the old capital flak limits). */
const LEGACY_ELEVATION: [number, number] = [-0.1, 1.45];
/** Seconds idle before the scan starts. */
export const IDLE_SCAN = 4;
/** Base fire gate: barrels within this of the solution (rad, ≈ 2°). */
export const FIRE_TOL = 0.035;
/** Point defence against ordnance: proximity-fused, a looser gate (≈ 2.6°). */
export const PD_TOL = 0.045;
const TAU = Math.PI * 2;

/** Traverse rate for a mount of base radius `r` metres (rad/s): ~180°/s for a fighter turret, ~19°/s for a battleship main. */
export function slewRate(r: number): number {
  const deg = Math.min(200, Math.max(12, 180 / Math.sqrt(Math.max(r, 0.25))));
  return (deg * Math.PI) / 180;
}

export function createDrive(): TurretDrive {
  return { yaw: 0, pitch: 0, idle: 0, barrel: 0, recoil: 0, wrecked: false };
}

/** Wrap to (−π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A drive rig from the builder's turret info. */
export function rigFromInfo(t: TurretRigInfo): TurretRig {
  const side = new Vector3().crossVectors(t.up, t.fwd).normalize();
  const toFrame = (v: Vector3, o: Vector3) => {
    const d = new Vector3().subVectors(v, o);
    return new Vector3(d.dot(side), d.dot(t.up), d.dot(t.fwd));
  };
  const pivot = toFrame(t.pivot, t.base);
  const tips = t.tips.map((p) => toFrame(p, t.pivot));
  const full = t.traverse[1] - t.traverse[0] >= TAU - 1e-3;
  const yawRate = slewRate(t.radius);
  const len = tips.length ? tips[0].length() : 1;
  return {
    socket: t.socket,
    yawJoint: t.yaw,
    pitchJoint: t.pitch,
    base: t.base.clone(),
    up: t.up.clone(),
    fwd: t.fwd.clone(),
    side,
    pivot,
    tips,
    traverse: [t.traverse[0], t.traverse[1]],
    full,
    elevation: [t.elevation[0], t.elevation[1]],
    yawRate,
    pitchRate: yawRate * 1.25,
    stroke: len * 0.12,
    hash: hashStr(t.socket),
  };
}

const _m = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();

/**
 * The rig for a turret socket on a built model: the builder's rig, or (an
 * unrigged 'turret' hardpoint) one read off the socket's rest transform with
 * a single muzzle at the socket and the legacy all-round limits.
 */
export function rigFor(model: ShipModel, socket: string): TurretRig | null {
  const info = model.turrets.get(socket);
  if (info) return rigFromInfo(info);
  const o = model.sockets.get(socket);
  if (!o) return null;
  model.root.updateMatrixWorld(true);
  _inv.copy(model.root.matrixWorld).invert();
  _m.multiplyMatrices(_inv, o.matrixWorld);
  _q.setFromRotationMatrix(_m);
  const base = new Vector3().setFromMatrixPosition(_m);
  const up = new Vector3(0, 1, 0).applyQuaternion(_q);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(_q);
  const r = Math.max(1, model.radius * 0.02);
  return {
    socket,
    yawJoint: null,
    pitchJoint: null,
    base,
    up,
    fwd,
    side: new Vector3().crossVectors(up, fwd).normalize(),
    pivot: new Vector3(),
    tips: [new Vector3()],
    traverse: [-Math.PI, Math.PI],
    full: true,
    elevation: [LEGACY_ELEVATION[0], LEGACY_ELEVATION[1]],
    yawRate: slewRate(r),
    pitchRate: slewRate(r) * 1.25,
    stroke: 0,
    hash: hashStr(socket),
  };
}

/** Turret-frame angles of a ship-frame unit direction: [yaw, pitch]. */
export function aimAngles(rig: TurretRig, dir: Vector3, out: { yaw: number; pitch: number }): void {
  const x = dir.dot(rig.side);
  const y = dir.dot(rig.up);
  const z = dir.dot(rig.fwd);
  out.yaw = Math.atan2(x, z);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, y / Math.max(1e-9, Math.hypot(x, y, z)))));
}

/** Is (yaw, pitch) inside the mount's limits? */
export function reachable(rig: TurretRig, yaw: number, pitch: number): boolean {
  if (pitch < rig.elevation[0] - 1e-6 || pitch > rig.elevation[1] + 1e-6) return false;
  return rig.full || (yaw >= rig.traverse[0] - 1e-6 && yaw <= rig.traverse[1] + 1e-6);
}

/**
 * One rate-limited step of an angle toward `want`. `wrap` (all-round
 * traverse): the short way round, result in (−π, π]. Otherwise `want` is
 * clamped into [lo, hi] and the move is linear, so a limited arc never
 * swings through its dead zone.
 */
export function slewAngle(cur: number, want: number, rate: number, dt: number, wrap: boolean, lo: number, hi: number): number {
  const step = rate * dt;
  if (wrap) {
    const d = wrapAngle(want - cur);
    return wrapAngle(cur + Math.max(-step, Math.min(step, d)));
  }
  const w = Math.max(lo, Math.min(hi, want));
  return cur + Math.max(-step, Math.min(step, w - cur));
}

/** Barrel direction (ship frame, unit) at (yaw, pitch). */
export function barrelDir(rig: TurretRig, yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  return out
    .copy(rig.fwd)
    .multiplyScalar(cp * Math.cos(yaw))
    .addScaledVector(rig.side, cp * Math.sin(yaw))
    .addScaledVector(rig.up, Math.sin(pitch));
}

/** Angle between the barrels at (yaw, pitch) and a ship-frame unit direction. */
export function aimError(rig: TurretRig, yaw: number, pitch: number, dir: Vector3): number {
  barrelDir(rig, yaw, pitch, _e);
  return Math.acos(Math.max(-1, Math.min(1, _e.dot(dir) / Math.max(1e-9, dir.length()))));
}
const _e = new Vector3();

/**
 * Muzzle of barrel `i` (ship frame) at (yaw, pitch): the tip offset raised
 * about the trunnion, then trunnion + tip turned about the mount normal.
 */
export function muzzleLocal(rig: TurretRig, yaw: number, pitch: number, i: number, out: Vector3): Vector3 {
  const t = rig.tips[((i % rig.tips.length) + rig.tips.length) % rig.tips.length];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Elevate: rotate (y, z) toward +y.
  const tx = t.x;
  const ty = t.y * cp + t.z * sp;
  const tz = -t.y * sp + t.z * cp;
  // Trunnion + tip, then traverse about y (z toward x).
  const px = rig.pivot.x + tx;
  const py = rig.pivot.y + ty;
  const pz = rig.pivot.z + tz;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = px * cy + pz * sy;
  const z = -px * sy + pz * cy;
  return out.copy(rig.base).addScaledVector(rig.side, x).addScaledVector(rig.up, py).addScaledVector(rig.fwd, z);
}

/** Trunnion (ship frame) at `yaw`: where the aim solvers measure from. */
export function trunnionLocal(rig: TurretRig, yaw: number, out: Vector3): Vector3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const p = rig.pivot;
  return out
    .copy(rig.base)
    .addScaledVector(rig.side, p.x * cy + p.z * sy)
    .addScaledVector(rig.up, p.y)
    .addScaledVector(rig.fwd, -p.x * sy + p.z * cy);
}

/** Centre of the traverse arc (ship frame, unit). */
export function arcCentre(rig: TurretRig, out: Vector3): Vector3 {
  return barrelDir(rig, rig.full ? 0 : (rig.traverse[0] + rig.traverse[1]) / 2, 0, out);
}

/**
 * Fill an aim-solver mount from the rig and the ship's pose: position at the
 * trunnion's turning axis, forward = arc centre, traverse / elevation limits.
 */
export function mountFromRig(rig: TurretRig, m: TurretMount, pos: Vector3, orient: Quaternion, vel: Vector3): void {
  m.position.copy(rig.base).addScaledVector(rig.up, rig.pivot.y).applyQuaternion(orient).add(pos);
  m.up.copy(rig.up).applyQuaternion(orient);
  arcCentre(rig, m.forward).applyQuaternion(orient);
  m.traverse = rig.full ? Math.PI : (rig.traverse[1] - rig.traverse[0]) / 2;
  m.minElevation = rig.elevation[0];
  m.maxElevation = rig.elevation[1];
  m.velocity.copy(vel);
}

const _ang = { yaw: 0, pitch: 0 };

/**
 * Step the drive. `want` = the solution as a ship-frame unit direction, or
 * null (idle: home to rest, then scan). Returns the remaining aim error
 * (rad) — Infinity when idle or wrecked — for the fire gate.
 */
export function stepDrive(rig: TurretRig, d: TurretDrive, want: Vector3 | null, dt: number): number {
  d.recoil = Math.max(0, d.recoil - dt * 6);
  if (d.wrecked) return Infinity;
  let wy = 0;
  let wp = 0;
  let rate = 1;
  if (want) {
    d.idle = 0;
    aimAngles(rig, want, _ang);
    wy = _ang.yaw;
    wp = _ang.pitch;
  } else {
    d.idle += dt;
    if (d.idle > IDLE_SCAN) {
      // Slow scan of the arc about rest, a little off the deck.
      const half = rig.full ? 0.6 : Math.min(0.6, -rig.traverse[0], rig.traverse[1]);
      const t = (d.idle - IDLE_SCAN) * 0.3 + (rig.hash % 628) / 100;
      wy = Math.sin(t) * half;
      wp = Math.max(rig.elevation[0], Math.min(rig.elevation[1], 0.1 + 0.08 * Math.sin(t * 0.63)));
      rate = 0.25;
    }
  }
  d.yaw = slewAngle(d.yaw, wy, rig.yawRate * rate, dt, rig.full, rig.traverse[0], rig.traverse[1]);
  d.pitch = slewAngle(d.pitch, wp, rig.pitchRate * rate, dt, false, rig.elevation[0], rig.elevation[1]);
  return want ? aimError(rig, d.yaw, d.pitch, want) : Infinity;
}

/**
 * Idle scan as a pure function of time (visual-only mounts that no fire
 * control steps — station batteries): sets `d.yaw` / `d.pitch`.
 */
export function scanPose(rig: TurretRig, time: number, d: TurretDrive): void {
  const half = rig.full ? 0.6 : Math.min(0.6, -rig.traverse[0], rig.traverse[1]);
  const t = time * 0.3 * 0.25 + (rig.hash % 628) / 100;
  d.yaw = Math.sin(t) * half;
  d.pitch = Math.max(rig.elevation[0], Math.min(rig.elevation[1], 0.1 + 0.08 * Math.sin(t * 0.63)));
}

/**
 * Gate tolerance for a target of radius `r` at distance `dist`: the base
 * 2°, opened up to the target's own angular size (a hull fills the sight).
 */
export function gateTolerance(r: number, dist: number): number {
  return Math.max(FIRE_TOL, Math.min(0.2, Math.atan2(r * 0.8, Math.max(1, dist))));
}

/** Muzzle for the next shot (alternating barrels) in ship frame; advances the barrel and kicks the recoil. */
export function nextMuzzle(rig: TurretRig, d: TurretDrive, out: Vector3): Vector3 {
  muzzleLocal(rig, d.yaw, d.pitch, d.barrel, out);
  d.barrel = (d.barrel + 1) % Math.max(1, rig.tips.length);
  d.recoil = 1;
  return out;
}

/** Freeze a destroyed mount: skewed off its last bearing, guns drooped below the deck line. */
export function wreckDrive(rig: TurretRig, d: TurretDrive): void {
  d.wrecked = true;
  d.recoil = 0;
  const skew = (0.18 + ((rig.hash >>> 8) % 100) / 400) * ((rig.hash & 1) ? 1 : -1);
  d.yaw = rig.full ? wrapAngle(d.yaw + skew) : Math.max(rig.traverse[0], Math.min(rig.traverse[1], d.yaw + skew));
  d.pitch = rig.elevation[0] - 0.12 - ((rig.hash >>> 16) % 100) / 1000;
}

/** Repaired (resetDamage / repair): back to rest, live again. */
export function restoreDrive(d: TurretDrive): void {
  d.wrecked = false;
  d.yaw = 0;
  d.pitch = 0;
  d.idle = 0;
  d.recoil = 0;
}

/** Copy the drive onto the model's joints (render only), with the guns' recoil stroke. */
export function poseTurret(model: ShipModel, rig: TurretRig, d: TurretDrive): void {
  if (!rig.yawJoint) return;
  const y = model.articulations.get(rig.yawJoint);
  if (y && y.angle !== d.yaw) model.setArticulation(rig.yawJoint, d.yaw);
  if (!rig.pitchJoint) return;
  const p = model.articulations.get(rig.pitchJoint);
  if (!p) return;
  if (p.angle !== d.pitch) model.setArticulation(rig.pitchJoint, d.pitch);
  // Recoil: slide the guns back along the (rest) barrel line, in the joint's own frame.
  if (p.mesh) {
    const k = d.recoil * d.recoil * rig.stroke;
    p.mesh.position.copy(rig.fwd).multiplyScalar(-k);
  }
}

const _w = new Vector3();

/**
 * World position of a turret — the centre of its mount on the turning axis —
 * for explosion / damage FX on a destroyed mount (Damage.ts subsystem id =
 * socket id). Falls back to the socket, then the ship.
 */
export function turretWorldPosition(s: ShipEntity, socket: string, out: Vector3): Vector3 {
  const t = s.model.turrets.get(socket);
  if (t) {
    _w.subVectors(t.pivot, t.base);
    out.copy(t.base).addScaledVector(t.up, _w.dot(t.up) * 0.8);
  } else {
    const o = s.model.sockets.get(socket);
    if (!o) return out.copy(s.flight.position);
    out.copy(o.position);
    for (let p = o.parent; p && p !== s.model.root; p = p.parent) out.multiply(p.scale).applyQuaternion(p.quaternion).add(p.position);
  }
  return out.applyQuaternion(s.flight.orientation).add(s.flight.position);
}
