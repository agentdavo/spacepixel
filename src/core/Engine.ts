import { Timer } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { RendererInfo } from '@/render/RendererFactory';
import { flags } from './Flags';
import { Perf } from './Perf';
import { input } from './Input';

export interface FrameContext {
  /** Seconds since the previous frame, clamped to avoid physics explosions. */
  dt: number;
  /** Simulation time in seconds. */
  time: number;
  frame: number;
}

export interface Updatable {
  update(ctx: FrameContext): void;
}

export interface ResizeAware {
  resize(width: number, height: number, pixelRatio: number): void;
}

/**
 * Owns the main loop: fixed ordering of update systems, then a single render
 * call. In screenshot mode time advances by a fixed step so captures are
 * deterministic regardless of how slow the (software) GPU is.
 */
export class Engine {
  readonly renderer: WebGPURenderer;
  readonly info: RendererInfo;

  private systems: Updatable[] = [];
  private resizeTargets: ResizeAware[] = [];
  private timer = new Timer();
  private renderFn: () => void = () => {};
  private ctx: FrameContext = { dt: 0, time: flags.startTime, frame: 0 };

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

  start(): void {
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  private tick(timestamp: number): void {
    this.perf.begin(timestamp);
    this.timer.update(timestamp);
    const realDt = this.timer.getDelta();
    const dt = flags.shot ? 1 / 60 : Math.min(realDt, 1 / 20);

    this.ctx.dt = dt;
    this.ctx.time += dt;
    this.ctx.frame++;

    // Input is sampled exactly once, first thing, and read directly by the
    // sim on this same frame.
    input.sample(this.ctx.time);
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
