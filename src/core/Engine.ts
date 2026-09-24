import { Timer } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { RendererInfo } from '@/render/RendererFactory';
import { flags } from './Flags';
import { Perf } from './Perf';
import { input } from './Input';

/** The simulation's fixed step (MP-0): 60 Hz, whatever the display runs at. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** At most this many sim ticks per frame; beyond it the game drops into slow motion instead of spiralling. */
export const MAX_SUBSTEPS = 4;

export interface FrameContext {
  /** Seconds since the previous frame, clamped to avoid physics explosions. */
  dt: number;
  /** Presentation time in seconds (frame clock). */
  time: number;
  frame: number;
  /**
   * Fixed-step scenes: how far the frame sits past the last sim tick, in
   * ticks (0..1). Presentation predicts ships `alpha · SIM_DT` ahead from the
   * last tick (FlightScene.present) so motion is smooth at any display rate.
   */
  alpha: number;
  /** Sim ticks run this frame (0 at >60 Hz between ticks; up to MAX_SUBSTEPS). */
  ticks: number;
}

export interface TickContext {
  /** Always SIM_DT. */
  dt: number;
  /** Sim time at the start of this tick (seconds; tick · SIM_DT from the scene start). */
  time: number;
  /** Tick index since the engine started. */
  tick: number;
}

export interface Updatable {
  /** Presentation (and, for variable-step scenes, everything): once per frame, after the frame's ticks. */
  update(ctx: FrameContext): void;
  /**
   * Fixed-step simulation: called 0..MAX_SUBSTEPS times per frame, each a
   * 1/60 s tick with the player's controls loaded from this frame's input.
   */
  fixedUpdate?(tick: TickContext): void;
  /** Sim speed for fixed-step systems: 1 normal, 0.25 tactical slow-mo, 0 paused (berthed, kill-cam). */
  timeScale?(): number;
}

export interface ResizeAware {
  resize(width: number, height: number, pixelRatio: number): void;
}

/**
 * Owns the main loop. Per frame:
 *
 *   1. sample input (once, top of the frame)
 *   2. fixed-step sim: an accumulator runs 0..MAX_SUBSTEPS ticks of exactly
 *      1/60 s through every system's `fixedUpdate` — the player's input
 *      applies on the first tick of the frame it arrived in (the latency
 *      rule). Frame intervals within 2 ms of a whole number of ticks snap to
 *      it (vsync jitter never turns 1-1-1 into 0-2-1). If the frame took
 *      longer than MAX_SUBSTEPS ticks the extra time is dropped: slow motion,
 *      never a spiral of death.
 *   3. `update` (presentation) with `alpha` = accumulator / SIM_DT
 *   4. render
 *
 * Scenes without `fixedUpdate` keep a variable `dt` in `update` as before.
 * In screenshot mode time advances by a fixed step so captures are
 * deterministic regardless of how slow the (software) GPU is; `?record=fps`
 * steps 1/fps per frame (the accumulator turns that into whole ticks).
 */
export class Engine {
  readonly renderer: WebGPURenderer;
  readonly info: RendererInfo;

  private systems: Updatable[] = [];
  private resizeTargets: ResizeAware[] = [];
  private timer = new Timer();
  private renderFn: () => void = () => {};
  private ctx: FrameContext = { dt: 0, time: flags.startTime, frame: 0, alpha: 0, ticks: 0 };
  private tickCtx: TickContext = { dt: SIM_DT, time: flags.startTime, tick: 0 };
  /** Unsimulated time, seconds (< SIM_DT after each frame). */
  private acc = 0;
  /** Frames that hit MAX_SUBSTEPS and dropped time (slow motion). */
  droppedFrames = 0;
  /** Suspend the fixed-step loop (a replay fast-forward drives ticks itself). */
  holdTicks = false;

  /** Rolling frame-time stats for the debug overlay / profiler. */
  readonly stats = { fps: 0, frameMs: 0 };
  readonly perf: Perf;
  private statAccum = 0;
  private statFrames = 0;

  constructor(info: RendererInfo) {
    this.info = info;
    this.renderer = info.renderer;
    this.perf = new Perf(info.renderer, flags.budget);
    window.addEventListener('resize', () => this.handleResize());
  }

  /** Drop all update systems and resize targets (scene switch). */
  clearSystems(): void {
    this.systems.length = 0;
    this.resizeTargets.length = 0;
  }

  addSystem<T extends Updatable>(system: T): T {
    this.systems.push(system);
    return system;
  }

  onResize<T extends ResizeAware>(target: T): T {
    this.resizeTargets.push(target);
    target.resize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
    return target;
  }

  setRender(fn: () => void): void {
    this.renderFn = fn;
  }

  get frameContext(): Readonly<FrameContext> {
    return this.ctx;
  }

  get tickContext(): Readonly<TickContext> {
    return this.tickCtx;
  }

  start(): void {
    this.timer.connect(document);
    if (flags.record) return; // frame-stepped by the recorder via step()
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /** Recording: advance exactly `n` frames of 1/record s, then wait for the GPU. */
  async step(n: number): Promise<void> {
    for (let i = 0; i < n; i++) this.tick(performance.now());
    const device = (this.renderer.backend as { device?: GPUDevice }).device;
    await device?.queue.onSubmittedWorkDone();
  }

  private tick(timestamp: number): void {
    this.perf.begin(timestamp);
    this.timer.update(timestamp);
    const realDt = this.timer.getDelta();
    const fixedFrame = flags.record ? 1 / flags.record : flags.shot ? 1 / 60 : 0;
    const dt = fixedFrame || Math.min(realDt, 1 / 20);

    this.ctx.dt = dt;
    this.ctx.time += dt;
    this.ctx.frame++;

    // Input is sampled exactly once, first thing; the sim ticks below apply it
    // this same frame.
    input.sample(this.ctx.time);

    let fixed = 0;
    let scale = Infinity;
    for (const s of this.systems) {
      if (!s.fixedUpdate) continue;
      fixed++;
      scale = Math.min(scale, s.timeScale?.() ?? 1);
    }
    if (!Number.isFinite(scale)) scale = 1;
    let ticks = 0;
    if (fixed && !this.holdTicks) {
      let step = fixedFrame || Math.min(realDt, 0.25);
      if (!fixedFrame) {
        const k = Math.round(step / SIM_DT);
        if (k >= 1 && k <= 2 && Math.abs(step - k * SIM_DT) < 0.002) step = k * SIM_DT;
      }
      this.acc += step * Math.max(0, scale);
      // A deliberate speed-up (tape ×4, capture warp) raises the cap with it.
      const cap = MAX_SUBSTEPS * Math.max(1, scale) * SIM_DT;
      if (this.acc > cap) {
        this.acc = cap;
        this.droppedFrames++;
      }
      const t = this.tickCtx;
      while (this.acc >= SIM_DT - 1e-9) {
        this.acc -= SIM_DT;
        input.beginTick(ticks === 0);
        for (const s of this.systems) s.fixedUpdate?.(t);
        t.tick++;
        t.time += SIM_DT;
        ticks++;
      }
      if (this.acc < 0) this.acc = 0;
      input.endTicks(ticks, scale <= 0);
      this.ctx.alpha = this.acc / SIM_DT;
    } else {
      // Variable-step scenes read `input.state` directly, once per frame.
      input.beginTick(true);
      input.endTicks(1, false);
      this.ctx.alpha = 0;
    }
    this.ctx.ticks = ticks;

    for (const s of this.systems) s.update(this.ctx);
    this.renderFn();
    this.perf.end(input.consumedInputTime);

    this.statAccum += realDt;
    this.statFrames++;
    if (this.statAccum >= 0.5) {
      this.stats.fps = this.statFrames / this.statAccum;
      this.stats.frameMs = (this.statAccum / this.statFrames) * 1000;
      this.statAccum = 0;
      this.statFrames = 0;
    }
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    for (const t of this.resizeTargets) t.resize(w, h, pr);
  }
}
