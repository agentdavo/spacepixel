import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import { postFx } from '@/render/post/PostFx';
import type { GameAudio, Mood } from '@/audio';
import type { CinemaOverlay } from './CinemaOverlay';
import { captionsAt, crossed, emptyFx, locate, makePose, moveAt, sampleFx, sampleMove, totalDuration, type Shot } from './timeline';

/**
 * What a cutscene's stage provides to the sequencer: sets it can switch
 * between, kinematic props, tracking-shot rigs and one-shot events. The
 * stage owns every object in the frame; the sequencer only owns time, the
 * camera, the postFx grade, captions and cues.
 */
export interface CinemaStage {
  /** Universe anchor of a set (camera keys are km relative to it). */
  anchor(set: string): Vector3;
  /** A shot is cut in: show its set, apply its sky and light. */
  enter(shot: Shot): void;
  /** Pose props for shot-local time — runs before the camera is placed. */
  animate(shot: Shot, local: number, dt: number, seeking: boolean): void;
  /** Subject pose for rig/aim moves (universe position + orientation). */
  rig(name: string, pos: Vector3, quat: Quaternion): boolean;
  /** A one-shot stage event crossed this frame (also fired while seeking). */
  event(id: string, shot: Shot, seeking: boolean): void;
  /** After the camera is final: set pieces, weapons, particles. */
  settle(shot: Shot, local: number, dt: number, seeking: boolean): void;
}

const _rp = new Vector3();
const _rq = new Quaternion();
const _v = new Vector3();
const _up = new Vector3();
const SEEK_STEP = 1 / 30;

/**
 * Runs a shot list: advances time, cuts between shots, drives the camera
 * from keyframes or rigs, writes the postFx grade, fires sound / music /
 * stage cues on crossing and feeds the overlay. `seek(t)` fast-forwards a
 * shot from its start in fixed steps (stage sims stay deterministic; sounds
 * and particles are suppressed), which is what `?t=` screenshots use.
 */
export class Cinema {
  readonly duration: number;
  /** Global timeline time (s). */
  t = 0;
  ended = false;
  /** Called once when the timeline reaches its end. */
  onEnd: (() => void) | null = null;
  private index = -1;
  private prevLocal = -Infinity;
  private readonly pose = makePose();
  private readonly fx = emptyFx();

  constructor(
    readonly shots: readonly Shot[],
    private readonly stage: CinemaStage,
    private readonly world: WorldSpace,
    private readonly camera: PerspectiveCamera,
    private readonly overlay: CinemaOverlay | null,
    private readonly audio: GameAudio | null,
  ) {
    this.duration = totalDuration(shots);
  }

  get shot(): Shot {
    return this.shots[Math.max(0, this.index)];
  }

  /** Shot-local time of the live shot. */
  get local(): number {
    return locate(this.shots, this.t).local;
  }

  /** Jump to global time `t`: cut into its shot and fast-forward the stage from the shot's start. */
  seek(t: number): void {
    const T = Math.max(0, Math.min(this.duration, t));
    if (T < this.duration) this.ended = false;
    const loc = locate(this.shots, T);
    this.t = loc.start;
    this.index = -1;
    this.frame(0, true);
    while (this.t < T - 1e-6) {
      const h = Math.min(SEEK_STEP, T - this.t);
      this.t += h;
      this.frame(h, true);
    }
    const mood = this.moodAt(T);
    if (mood) this.audio?.music.setMood(mood.mood, 1.5);
    this.frame(0, false);
  }

  update(dt: number): void {
    if (this.index < 0) this.seek(this.t);
    if (!this.ended) this.t = Math.min(this.duration, this.t + dt);
    this.frame(this.ended ? 0 : dt, false);
    if (!this.ended && this.t >= this.duration) {
      this.ended = true;
      this.onEnd?.();
    }
  }

  private frame(dt: number, seeking: boolean): void {
    const loc = locate(this.shots, this.t);
    if (loc.index !== this.index) {
      this.index = loc.index;
      this.prevLocal = -Infinity;
      this.stage.enter(this.shots[loc.index]);
    }
    const shot = this.shots[this.index];
    const local = loc.local;
    const prev = this.prevLocal;

    this.stage.animate(shot, local, dt, seeking);
    for (const e of shot.events ?? []) if (crossed(e.at, prev, local)) this.stage.event(e.id, shot, seeking);
    if (!seeking && this.audio) {
      const a = this.audio;
      for (const m of shot.music ?? []) if (crossed(m.at, prev, local)) a.music.setMood(m.mood, m.fade ?? 2);
      for (const s of shot.sound ?? []) {
        if (!crossed(s.at, prev, local)) continue;
        if (s.sfx) a.sfx.play(s.sfx, { gain: s.gain ?? 1 });
        if (s.stinger) a.stinger(s.stinger);
        if (s.radio) a.radio(s.radio);
      }
    }

    // Host-owned per-frame postFx: reset what set pieces may raise this frame.
    postFx.flash = 0;
    postFx.jump = 0;
    this.placeCamera(shot, local);
    this.stage.settle(shot, local, dt, seeking);

    const fx = sampleFx(shot, local, this.fx);
    postFx.flash = Math.min(1, Math.max(postFx.flash, fx.flash));
    postFx.jump = Math.max(postFx.jump, fx.jump);
    postFx.fade = fx.fade;
    postFx.invert = fx.invert;
    postFx.hue = fx.hue;
    postFx.solarize = fx.solarize;
    postFx.boost = fx.boost;
    postFx.speed = fx.speed;

    if (!seeking) this.overlay?.update(captionsAt(shot, local));
    this.prevLocal = local;
  }

  private placeCamera(shot: Shot, local: number): void {
    const m = moveAt(shot, local);
    const p = sampleMove(m, local, this.pose);
    const unit = m.units === 'm' ? 1 : 1000;
    const eye = this.world.eye;
    _up.set(0, 1, 0);
    if (m.rig && this.stage.rig(m.rig, _rp, _rq)) {
      eye.copy(p.eye).multiplyScalar(unit).applyQuaternion(_rq).add(_rp);
      _v.copy(p.look).multiplyScalar(unit).applyQuaternion(_rq).add(_rp);
      _up.applyQuaternion(_rq);
    } else {
      eye.copy(p.eye).multiplyScalar(1000).add(this.stage.anchor(shot.set));
      if (m.aim && this.stage.rig(m.aim, _rp, _rq)) _v.copy(p.look).multiplyScalar(unit).applyQuaternion(_rq).add(_rp);
      else _v.copy(p.look).multiplyScalar(1000).add(this.stage.anchor(shot.set));
    }
    // Floating origin: the camera sits at 0, so look along the eye-relative direction.
    this.world.sync(this.camera);
    _v.sub(eye);
    const cam = this.camera;
    cam.up.copy(_up);
    cam.lookAt(_v);
    if (p.roll) cam.rotateZ(p.roll);
    if (m.shake) {
      const s = m.shake;
      const t = this.t;
      cam.rotateX(s * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 91.7) * 0.4));
      cam.rotateY(s * (Math.sin(t * 29.3 + 1.3) * 0.6 + Math.sin(t * 73.9) * 0.4));
    }
    if (Math.abs(cam.fov - p.fov) > 1e-4) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** The music cue in force at global time `t` (latest cue at or before it). */
  private moodAt(t: number): { mood: Mood; fade?: number } | null {
    let start = 0;
    let found: { mood: Mood; fade?: number } | null = null;
    for (const s of this.shots) {
      for (const m of s.music ?? []) if (start + m.at <= t + 1e-6) found = m;
      start += s.dur;
      if (start > t) break;
    }
    return found;
  }
}

/** Put every postFx field the sequencer writes back to "no effect". */
export function resetPostFx(): void {
  postFx.flash = postFx.jump = postFx.fade = postFx.invert = postFx.hue = postFx.solarize = postFx.boost = postFx.speed = 0;
}
