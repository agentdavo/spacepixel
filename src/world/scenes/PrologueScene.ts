import { PerspectiveCamera, Scene } from 'three';
import type { FrameContext } from '@/core/Engine';
import { WorldSpace } from '@/core/WorldSpace';
import { flags } from '@/core/Flags';
import { Fleet } from '@/sim/Fleet';
import { Weapons } from '@/sim/Weapons';
import { Missiles } from '@/sim/Missiles';
import { getAudio } from '@/audio';
import { postFx } from '@/render/post/PostFx';
import { Cinema, resetPostFx } from '@/cinema/Cinema';
import { CinemaOverlay } from '@/cinema/CinemaOverlay';
import { PrologueStage } from '@/cinema/PrologueStage';
import { PROLOGUE } from '@/cinema/prologue';
import { locate } from '@/cinema/timeline';
import type { GameScene } from '../GameScene';
import { WeaponVisuals } from '../WeaponVisuals';
import { CombatFx } from '../CombatFx';

/**
 * `?scene=prologue` — the ~60 s cold open (src/cinema/prologue.ts).
 *
 *   t=SECONDS   start (seek) anywhere on the timeline — deterministic, for captures
 *   loop=0      hold the last frame instead of looping (direct loads loop)
 *
 * Hosts that await it (first launch, title attract) set `exitOnSkip` and
 * read `done`; loaded directly, Skip jumps to the title card and the reel
 * loops like an attract mode.
 */
export class PrologueScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.5, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly fleet = new Fleet(this.world.root);
  readonly weapons = new Weapons(this.fleet);
  readonly missiles = new Missiles(this.fleet);
  readonly cinema: Cinema;
  /** Resolves when the reel ends or is skipped (hosts that await it set exitOnSkip). */
  readonly done: Promise<void>;
  /** Skip / end finishes the scene (resolving `done`) instead of jumping to the title / looping. */
  exitOnSkip = false;
  private readonly stage: PrologueStage;
  private readonly overlay: CinemaOverlay;
  private readonly visuals: WeaponVisuals;
  private readonly combatFx: CombatFx;
  private resolveDone!: () => void;
  private exitT = -1;
  private finished = false;
  private readonly loop: boolean;
  /** Shader warm-up: one black frame parked on each shot before the film starts. */
  private warm = 0;
  private readonly startT: number;

  constructor() {
    const q = new URLSearchParams(location.search);
    this.loop = q.get('loop') !== '0';
    this.done = new Promise((r) => (this.resolveDone = r));
    this.visuals = new WeaponVisuals(this.weapons, this.missiles);
    this.scene.add(this.visuals.group);
    this.combatFx = new CombatFx(this.weapons, this.missiles);
    this.scene.add(this.combatFx.fx.object);
    this.stage = new PrologueStage(this.scene, this.world, this.fleet, this.weapons, this.combatFx.fx, this.camera, PROLOGUE);
    this.overlay = new CinemaOverlay(document.getElementById('ui-root')!);
    this.overlay.onSkip = () => this.skip();
    const audio = getAudio();
    audio.autoMood = false;
    this.cinema = new Cinema(PROLOGUE, this.stage, this.world, this.camera, this.overlay, audio);
    this.cinema.t = flags.scene === 'prologue' ? flags.startTime : 0;
    this.startT = this.cinema.t;
    // Screenshots seek straight to their frame; the warm-up is for real playback.
    if (flags.shot) this.warm = PROLOGUE.length + 1;
    this.cinema.onEnd = () => {
      if (this.exitOnSkip || !this.loop) this.finish();
      else window.setTimeout(() => !this.finished && this.cinema.seek(0), 1200);
    };
    window.__VANGUARD__ = { ...(window.__VANGUARD__ ?? { ready: false, frame: () => 0, backend: '' }), hooks: { ...window.__VANGUARD__?.hooks, prologue: this } };
  }

  /** Skip: finish (awaited) or cut to the title card (direct / attract). */
  skip(): void {
    if (this.finished || this.exitT >= 0) return;
    getAudio().ui('confirm');
    if (this.exitOnSkip) {
      this.exitT = 0; // quick fade to black, then finish
      return;
    }
    const title = PROLOGUE.findIndex((s) => s.id === 'title');
    let start = 0;
    for (let i = 0; i < title; i++) start += PROLOGUE[i].dur;
    if (this.cinema.t < start) this.cinema.seek(start);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.overlay.dispose();
    this.stage.dispose();
    resetPostFx();
    getAudio().autoMood = true;
    this.resolveDone();
  }

  update(ctx: FrameContext): void {
    if (this.finished) return;
    if (this.warm <= PROLOGUE.length) {
      // Park on each set for one frame behind a black fade so every pipeline
      // compiles now, not on the first cut into it (seek is silent: no
      // captions, music or SFX). Then rewind to the real start.
      let at = 0;
      for (let i = 0; i < Math.min(this.warm, PROLOGUE.length - 1); i++) at += PROLOGUE[i].dur;
      this.cinema.seek(this.warm < PROLOGUE.length ? at + PROLOGUE[this.warm].dur * 0.5 : this.startT);
      this.warm++;
      postFx.fade = 1;
      this.overlay.el.style.visibility = this.warm <= PROLOGUE.length ? 'hidden' : '';
      return;
    }
    this.cinema.update(ctx.dt);
    const dt = ctx.dt;
    // Everything the weapons sim emitted this frame → flashes, beams, particles.
    this.visuals.update(this.world, dt);
    this.combatFx.consume(dt);
    this.combatFx.update(dt, this.world.eye);
    this.overlay.setSkipVisible(locate(PROLOGUE, this.cinema.t).index < PROLOGUE.length - 1 || this.exitOnSkip);
    if (this.exitT >= 0) {
      this.exitT += dt;
      // Skipped: fade the frame to black over the sequencer's grade, then hand back.
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
    const loc = locate(PROLOGUE, this.cinema.t);
    return `PROLOGUE · ${PROLOGUE[loc.index].id.toUpperCase()} · ${this.cinema.t.toFixed(1)}s`;
  }
}

