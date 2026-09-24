import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { ShipEntity } from '@/sim/Fleet';
import type { BerthFx } from './BerthFx';

/**
 * A scripted berthing sequence the docking controller hands the ship to
 * when the berth isn't a hangar bay: clamp gantries, moorings, carriers
 * alongside (HullBerth) and planetary descent (world/surface/Descent).
 *
 * Every pose is a pure function of (start pose, t) in the BERTH frame —
 * origin at the berthed ship's centre (or the corridor's entry point), z out
 * along the corridor, y up — so a berth on a carrier steaming along works
 * exactly like one on a station, and captures can seek to any t.
 */
export interface BerthFrame {
  bay: Vector3;
  axis: Vector3;
  up: Vector3;
  velocity: Vector3;
  center: Vector3;
  radius: number;
}

export interface BerthHost {
  readonly ship: ShipEntity;
  readonly fx: BerthFx | null;
  toWorld(d: BerthFrame, local: Vector3, out: Vector3): Vector3;
  toLocal(d: BerthFrame, world: Vector3, out: Vector3): Vector3;
  /** Copy the flight pose onto the model and set the plume (default: from throttle / boost). */
  syncModel(plume?: number): void;
  say(text: string, color?: string, seconds?: number): void;
  /** Real seconds (lights, pulses) — keeps running while berthed. */
  readonly clock: number;
}

export type SeqPhase = 'auto' | 'docked' | 'launch';

export interface BerthSequence {
  /** Seconds from guidance capture to berthed. */
  readonly tAuto: number;
  /** Seconds from launch to hand-back. */
  readonly tLaunch: number;
  /** The ship stays visible while berthed (it lies outside, or on a pad). */
  readonly showsShip: boolean;
  /** Guidance captured the ship at berth-local `s0` with attitude `q0`. */
  begin(h: BerthHost, d: BerthFrame, s0: Vector3, q0: Quaternion): void;
  auto(h: BerthHost, d: BerthFrame, t: number, dt: number): void;
  /** Berthed (t = seconds since berthing, real time). */
  hold(h: BerthHost, d: BerthFrame, t: number): void;
  launch(h: BerthHost, d: BerthFrame, t: number, dt: number): void;
  /** Cutaway camera: writes `eye` (universe) and the camera rotation; returns the FOV. */
  camera(h: BerthHost, d: BerthFrame, phase: SeqPhase, t: number, eye: Vector3, cam: PerspectiveCamera, dt: number): number;
  /** Letterbox caption. */
  caption(phase: SeqPhase, t: number): { title: string; sub: string };
  /** Iris (1 open … 0 closed) for the letterbox. */
  iris(phase: SeqPhase, t: number): number;
  /** Aborted or finished: drop any effects. */
  end(h: BerthHost, d: BerthFrame): void;
}

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

export function smooth(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
}

/** Ship orientation: +Z along `fwd`, +Y toward `up` (explicit basis, no lookAt). */
export function orient(q: Quaternion, fwd: Vector3, up: Vector3): Quaternion {
  _x.crossVectors(up, fwd);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(fwd, _x);
  return q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z.copy(fwd).normalize()));
}

/** Camera rotation looking from `eye` at `target` (camera looks down −Z). */
export function look(q: Quaternion, eye: Vector3, target: Vector3, up: Vector3): void {
  _z.subVectors(eye, target).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/** Deterministic camera shake (m) at time t, amplitude a. */
export function shake(t: number, a: number, out: Vector3): Vector3 {
  return out.set(Math.sin(t * 37.1) + Math.sin(t * 61.7) * 0.5, Math.sin(t * 43.3 + 1.7) + Math.sin(t * 71.9) * 0.5, Math.sin(t * 29.3 + 0.4)).multiplyScalar(a);
}
