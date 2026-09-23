import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { ChaseCamera } from './ChaseCamera';
import type { FlightModel } from './FlightModel';

/**
 * Milestone 6 — camera director: dramatic cutaways + target-lock views.
 *
 * 90s OVA cinematography is built on hard cuts, not blends: a fighter fills
 * the frame from behind, CUT to a static camera it screams past, CUT to a
 * slow orbit around the target as the missile hits. The director owns which
 * shot is live; each shot is a small function of (subject, time) → eye + look.
 *
 * Shots
 *   chase   the spring chase camera (default, always simulated so returning
 *           to it never pops)
 *   lock    over-the-shoulder padlock: behind the player, framing the target
 *   orbit   slow orbit around a subject (target-lock orbit / kill-cam)
 *   flyby   static camera planted ahead of the ship's path; auto-ends once
 *           the ship is well past
 *   track   rides behind a moving subject (missile cam) looking down its path
 *
 * Aiming never uses the director's camera — HUD marks are projected from the
 * ship's real nose — so cutaways can't make the player miss.
 */
export type ShotKind = 'chase' | 'lock' | 'orbit' | 'flyby' | 'track';

export interface Subject {
  position: Vector3; // universe (float64)
  velocity: Vector3;
  /** Rough size, metres — scales orbit/track distances. */
  radius: number;
}

interface ActiveShot {
  kind: ShotKind;
  subject: Subject | null;
  until: number; // absolute time; Infinity = until changed
  t0: number;
  anchor: Vector3; // flyby camera position / orbit phase data
  phase: number;
}

const _look = new Vector3();
const _up = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _m = new Matrix4();

export class CameraDirector {
  /** Universe eye position of the live shot. */
  readonly eye = new Vector3();
  readonly orientation = new Quaternion();
  /** Increments on every hard cut (the post pipeline can flash/boil on it). */
  cutCount = 0;

  private shot: ActiveShot = { kind: 'chase', subject: null, until: Infinity, t0: 0, anchor: new Vector3(), phase: 0 };
  private baseMode: ShotKind = 'chase';
  private time = 0;
  private fov = 58;

  constructor(
    readonly camera: PerspectiveCamera,
    readonly chase: ChaseCamera,
  ) {}

  get kind(): ShotKind {
    return this.shot.kind;
  }

  /** Persistent mode the director returns to after cutaways (chase or lock). */
  setBase(mode: 'chase' | 'lock', target: Subject | null = null): void {
    this.baseMode = mode;
    if (this.shot.until === Infinity) this.cut(mode, target, Infinity);
  }

  /** Hard cut to a shot for `duration` seconds (Infinity = hold). */
  cut(kind: ShotKind, subject: Subject | null, duration: number, ship?: FlightModel): void {
    const s = this.shot;
    s.kind = kind;
    s.subject = subject;
    s.t0 = this.time;
    s.until = this.time + duration;
    s.phase = Math.random() * Math.PI * 2;
    if (kind === 'flyby' && ship) this.plantFlyby(ship);
    this.cutCount++;
  }

  private plantFlyby(ship: FlightModel): void {
    // Plant the camera ~1.6 s ahead on the flight path, offset to the side and
    // slightly low so the ship crosses the frame silhouetted against the sky.
    const lead = Math.max(60, ship.speed * 1.6);
    ship.forward(_v);
    _w.set(1, -0.35, 0).applyQuaternion(ship.orientation).normalize();
    this.shot.anchor
      .copy(ship.position)
      .addScaledVector(_v, lead)
      .addScaledVector(_w, 14 + ship.speed * 0.03);
  }

  update(ship: FlightModel, target: Subject | null, dt: number): void {
    this.time += dt;
    // The chase cam always runs so cutting back to it is seamless.
    this.chase.update(ship, dt);

    const s = this.shot;
    if (this.time >= s.until) this.cut(this.baseMode, this.baseMode === 'lock' ? target : null, Infinity);
    if (s.kind === 'lock' && !s.subject) s.subject = target;
    if (s.kind === 'lock' && !s.subject) s.kind = 'chase';

    let fov = this.chase.camera.fov;
    switch (s.kind) {
      case 'chase':
        this.eye.copy(this.chase.eye);
        this.orientation.copy(this.chase.orientation);
        fov = this.fovChase();
        break;

      case 'lock': {
        // Behind and above the player, looking at the midpoint weighted to the
        // target so both stay in frame (Wing Commander "padlock").
        const tgt = s.subject!;
        _v.subVectors(tgt.position, ship.position);
        const dist = _v.length();
        _v.divideScalar(Math.max(dist, 1e-3));
        ship.up(_up);
        this.eye.copy(ship.position).addScaledVector(_v, -42).addScaledVector(_up, 10);
        _look.copy(ship.position).lerp(tgt.position, 0.65);
        this.lookAt(_look, _up);
        fov = Math.max(26, Math.min(62, 2 * Math.atan2(tgt.radius * 3 + 20, dist) * (180 / Math.PI) + 30));
        break;
      }

      case 'orbit': {
        const subj = s.subject ?? { position: ship.position, velocity: ship.velocity, radius: 10 };
        const r = subj.radius * 4.5 + 25;
        const a = s.phase + (this.time - s.t0) * 0.35;
        // Move with the subject so orbiting a 400 m/s fighter still works.
        this.eye.set(Math.cos(a) * r, r * 0.28, Math.sin(a) * r).add(subj.position);
        this.lookAt(subj.position, _up.set(0, 1, 0));
        fov = 40;
        break;
      }

      case 'flyby': {
        this.eye.copy(s.anchor);
        this.lookAt(ship.position, _up.set(0, 1, 0).applyQuaternion(ship.orientation).lerp(_w.set(0, 1, 0), 0.5));
        // Long-lens compression as it approaches, widening as it passes.
        const d = s.anchor.distanceTo(ship.position);
        fov = Math.min(55, Math.max(18, 2 * Math.atan2(22, d) * (180 / Math.PI)));
        // Done once the ship is well past the camera.
        ship.forward(_v);
        _w.subVectors(ship.position, s.anchor);
        if (_w.dot(_v) > 140 && this.time - s.t0 > 1.0) s.until = this.time;
        break;
      }

      case 'track': {
        const subj = s.subject;
        if (!subj) {
          s.until = this.time;
          break;
        }
        _v.copy(subj.velocity);
        if (_v.lengthSq() < 1) ship.forward(_v);
        _v.normalize();
        this.eye.copy(subj.position).addScaledVector(_v, -(subj.radius * 6 + 4)).add(_w.set(0, subj.radius * 1.5 + 1, 0));
        _look.copy(subj.position).addScaledVector(_v, 80);
        this.lookAt(_look, _up.set(0, 1, 0));
        fov = 65;
        break;
      }
    }

    this.fov = fov;
    this.camera.quaternion.copy(this.orientation);
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private fovChase(): number {
    return this.chase.fovValue;
  }

  private lookAt(target: Vector3, up: Vector3): void {
    // Camera looks down -Z: build basis from eye→target.
    _look.subVectors(target, this.eye).normalize().negate(); // +Z axis of camera
    _w.crossVectors(up, _look).normalize();
    if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0);
    _up.crossVectors(_look, _w);
    this.orientation.setFromRotationMatrix(_m.makeBasis(_w, _up, _look));
  }

  label(): string {
    return this.shot.kind.toUpperCase();
  }
}
