import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { WorldSpace } from '@/core/WorldSpace';
import { flags } from '@/core/Flags';
import { Fleet } from '@/sim/Fleet';
import { Weapons } from '@/sim/Weapons';
import { Missiles } from '@/sim/Missiles';
import { getAudio, type AudioFrame } from '@/audio';
import { getVoice } from '@/audio/voice';
import { postFx } from '@/render/post/PostFx';
import { Cinema, resetPostFx } from '@/cinema/Cinema';
import { CinemaOverlay } from '@/cinema/CinemaOverlay';
import { TrailerStage } from '@/cinema/TrailerStage';
import { TRAILER } from '@/cinema/trailer';
import { intensityAt, locate } from '@/cinema/timeline';
import { narrationCues, cuesCrossed } from '@/cinema/narration';
import type { GameScene } from '../GameScene';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';

/**
 * `?scene=trailer` — the 90 s gameplay trailer (src/cinema/trailer.ts).
 *
 *   t=SECONDS   start (seek) anywhere — deterministic, for captures / ranged recording
 *   loop=0      hold the last frame instead of looping (direct loads loop)
 *   reel=N      play N× faster (attract-mode soak tests)
 *
 * Hosts that await it (the title's attract loop) set `exitOnSkip` and read
 * `done`. Live, the combat sims' own weapon and missile events feed the
 * mixer on top of the shot list's authored cues; the offline soundtrack
 * (`audio-render --only trailer`) renders the authored cues and voices.
 */
export class TrailerScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.5, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fleet = new Fleet(this.world.root);
  readonly weapons = new Weapons(this.fleet);
  readonly missiles = new Missiles(this.fleet);
  readonly cinema: Cinema;
  readonly done: Promise<void>;
  exitOnSkip = false;
  private readonly stage: TrailerStage;
  private readonly overlay: CinemaOverlay;
  private readonly visuals: WeaponVisuals;
  private readonly combatFx: CombatFx;
  private resolveDone!: () => void;
  private exitT = -1;
  private finished = false;
  private readonly loop: boolean;
  private readonly speed: number;
  private warm = 0;
  private readonly startT: number;
  private readonly narration = narrationCues(TRAILER);
  private readonly audioFrame: AudioFrame;

  constructor() {
    const q = new URLSearchParams(location.search);
    this.loop = q.get('loop') !== '0';
    this.speed = Math.max(0.1, Number(q.get('reel') ?? 1) || 1);
    this.done = new Promise((r) => (this.resolveDone = r));
    this.visuals = new WeaponVisuals(this.weapons, this.missiles);
    this.scene.add(this.visuals.group);
    this.combatFx = new CombatFx(this.weapons, this.missiles);
    this.scene.add(this.combatFx.fx.object);
    const uiRoot = document.getElementById('ui-root')!;
    this.stage = new TrailerStage(this.scene, this.world, this.fleet, this.weapons, this.missiles, this.combatFx.fx, this.camera, uiRoot);
    this.overlay = new CinemaOverlay(uiRoot);
    this.overlay.onSkip = () => this.skip();
    const audio = getAudio();
    audio.autoMood = false;
    this.cinema = new Cinema(TRAILER, this.stage, this.world, this.camera, this.overlay, audio);
    this.cinema.t = flags.scene === 'trailer' ? flags.startTime : 0;
    this.startT = this.cinema.t;
    if (flags.shot) this.warm = TRAILER.length + 1;
    this.cinema.onEnd = () => {
      if (this.exitOnSkip || !this.loop) this.finish();
      else window.setTimeout(() => !this.finished && this.cinema.seek(0), 1200);
    };
    const zero = new Vector3();
    this.audioFrame = {
      dt: 0,
      eye: this.world.eye,
      camera: this.camera.quaternion,
      player: { position: zero, velocity: zero, throttle: 0, boosting: false, cruise: 'off', lockProgress: 0, locked: false, incomingMissile: false, alive: false },
      weaponEvents: this.weapons.events,
      beams: this.weapons.beams,
      missileEvents: this.missiles.events,
      jumpPhase: 'none',
      combatIntensity: 0,
    };
    window.__VANGUARD__ = { ...(window.__VANGUARD__ ?? { ready: false, frame: () => 0, backend: '' }), hooks: { ...window.__VANGUARD__?.hooks, trailer: this } };
  }

  /** Skip: finish (awaited) or cut to the title card (direct loads). */
  skip(): void {
    if (this.finished || this.exitT >= 0) return;
    getAudio().ui('confirm');
    getVoice().stopAll();
    if (this.exitOnSkip) {
      this.exitT = 0;
      return;
    }
    const title = TRAILER.findIndex((s) => s.id === 'title');
    let start = 0;
    for (let i = 0; i < title; i++) start += TRAILER[i].dur;
    if (this.cinema.t < start) this.cinema.seek(start);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    getVoice().stopAll();
    this.overlay.dispose();
    this.stage.dispose();
    resetPostFx();
    getAudio().autoMood = true;
    // Let the finished reel be collected (the hook would pin the whole scene).
    const hooks = window.__VANGUARD__?.hooks;
    if (hooks?.trailer === this) delete hooks.trailer;
    this.resolveDone();
  }

  /** GPU and DOM teardown when the host swaps scenes (main.ts). */
  dispose(): void {
    this.finish();
  }

  update(ctx: FrameContext): void {
    if (this.finished) return;
    if (this.warm <= TRAILER.length) {
      // Compile every set's pipelines behind a black frame before the film starts.
      let at = 0;
      for (let i = 0; i < Math.min(this.warm, TRAILER.length - 1); i++) at += TRAILER[i].dur;
      this.cinema.seek(this.warm < TRAILER.length ? at + TRAILER[this.warm].dur * 0.5 : this.startT);
      this.warm++;
      postFx.fade = 1;
      this.overlay.el.style.visibility = this.warm <= TRAILER.length ? 'hidden' : '';
      return;
    }
    const dt = ctx.dt * this.speed;
    const before = this.cinema.t;
    this.cinema.update(dt);
    if (this.exitT < 0 && this.cinema.t > before && this.speed <= 1) {
      for (const c of cuesCrossed(this.narration, before, this.cinema.t)) getVoice().speak({ who: c.who, text: c.caption.text, channel: c.channel, maxDur: c.maxDur, maxSqueeze: c.maxSqueeze });
    }
    this.visuals.update(this.world, dt);
    this.combatFx.consume(dt);
    this.combatFx.update(dt, this.world.eye);
    // The sims' own gunfire and blasts, spatialised from the lens, under the authored cues.
    const a = this.audioFrame;
    a.dt = dt;
    a.combatIntensity = intensityAt(TRAILER, this.cinema.t, 0.3);
    getAudio().update(a);
    this.overlay.setSkipVisible(locate(TRAILER, this.cinema.t).index < TRAILER.length - 2 || this.exitOnSkip);
    if (this.exitT >= 0) {
      this.exitT += ctx.dt;
      const k = Math.min(1, this.exitT / 0.45);
      postFx.fade = Math.max(postFx.fade, k);
      this.overlay.setExit(k);
      if (k >= 1) this.finish();
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    const loc = locate(TRAILER, this.cinema.t);
    return `TRAILER · ${TRAILER[loc.index].id.toUpperCase()} · ${this.cinema.t.toFixed(1)}s`;
  }
}
