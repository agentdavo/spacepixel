import type { WebGPURenderer } from 'three/webgpu';

/**
 * Frame-time budget and latency instrumentation — on from day one.
 *
 * Per frame we record:
 *   cpu      JS time spent in update + render submission (ms)
 *   gpu      GPU execution time from timestamp queries when the adapter
 *            supports them; otherwise submit→onSubmittedWorkDone (an upper
 *            bound that includes queueing)
 *   interval rAF-to-rAF time (what the player actually gets)
 *   input    input event → work submitted (ms). Input→photon adds the
 *            compositor + scanout (~1–2 refreshes) which a browser cannot
 *            observe; we report what we can measure honestly.
 *
 * Budgets are pass/fail numbers, not vibes: `?budget=8.3` for 120 Hz.
 */
const N = 240;

class Ring {
  readonly data = new Float32Array(N);
  private i = 0;
  count = 0;
  push(v: number): void {
    this.data[this.i] = v;
    this.i = (this.i + 1) % N;
    if (this.count < N) this.count++;
  }
  /** Value `k` frames ago (0 = latest). */
  at(k: number): number {
    return this.data[(this.i - 1 - k + N * 2) % N];
  }
  percentile(p: number): number {
    if (!this.count) return 0;
    const a = Array.from(this.data.subarray(0, this.count)).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))];
  }
  max(): number {
    let m = 0;
    for (let k = 0; k < this.count; k++) m = Math.max(m, this.data[k]);
    return m;
  }
}

export type GpuTimingMode = 'timestamp' | 'queue' | 'none';

export class Perf {
  readonly cpu = new Ring();
  readonly gpu = new Ring();
  readonly gpuRender = new Ring();
  readonly gpuCompute = new Ring();
  readonly interval = new Ring();
  readonly inputToSubmit = new Ring();
  readonly inputToGpu = new Ring();
  budgetMs: number;
  gpuMode: GpuTimingMode = 'none';
  frames = 0;
  overBudget = 0;
  /** Frames > 2× budget after warmup (hitches the player feels). */
  hitches = 0;
  /** Shader compilation etc. — excluded from steady-state percentiles. */
  warmupFrames = 60;

  private frameStart = 0;
  private lastRaf = -1;
  private gpuPending = false;
  private device: GPUDevice | null = null;
  private computeCalls = 0;
  timingErrors = 0;

  constructor(
    private renderer: WebGPURenderer,
    budgetMs = 1000 / 60,
  ) {
    this.budgetMs = budgetMs;
    const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice; trackTimestamp?: boolean };
    if (backend.isWebGPUBackend) {
      this.device = backend.device ?? null;
      this.gpuMode = backend.trackTimestamp ? 'timestamp' : this.device ? 'queue' : 'none';
    }
  }

  begin(rafTime: number): void {
    this.frameStart = performance.now();
    this.computeCalls = this.renderer.info.compute.calls;
    if (this.lastRaf >= 0 && this.frames >= this.warmupFrames) this.interval.push(rafTime - this.lastRaf);
    this.lastRaf = rafTime;
  }

  /** Call right after the frame's render() has been submitted. */
  end(consumedInputTime: number): void {
    const now = performance.now();
    const cpu = now - this.frameStart;
    this.frames++;
    if (this.frames <= this.warmupFrames) return;
    this.cpu.push(cpu);
    if (cpu > this.budgetMs) this.overBudget++;
    if (cpu > this.budgetMs * 2) this.hitches++;
    if (consumedInputTime >= 0) this.inputToSubmit.push(now - consumedInputTime);

    // One GPU measurement in flight at a time; never stall the frame on it.
    if (this.gpuPending) return;
    if (this.gpuMode === 'timestamp') {
      this.gpuPending = true;
      const calls = this.renderer.info.compute.calls;
      const computed = calls !== this.computeCalls;
      Promise.all([
        this.renderer.resolveTimestampsAsync('render'),
        computed ? this.renderer.resolveTimestampsAsync('compute') : Promise.resolve(0),
      ])
        .then(([render, compute]) => {
          if (typeof render === 'number' && Number.isFinite(render) && render > 0) this.gpuRender.push(render);
          if (typeof compute === 'number' && Number.isFinite(compute) && compute >= 0) this.gpuCompute.push(compute);
          if (typeof render === 'number' && Number.isFinite(render) && render > 0 && typeof compute === 'number' && Number.isFinite(compute) && compute >= 0)
            this.gpu.push(render + compute);
          if (consumedInputTime >= 0) this.inputToGpu.push(performance.now() - consumedInputTime);
        })
        .catch(() => { this.timingErrors++; })
        .finally(() => (this.gpuPending = false));
    } else if (this.gpuMode === 'queue' && this.device) {
      this.gpuPending = true;
      const submitted = now;
      this.device.queue
        .onSubmittedWorkDone()
        .then(() => {
          const done = performance.now();
          this.gpu.push(done - submitted);
          if (consumedInputTime >= 0) this.inputToGpu.push(done - consumedInputTime);
        })
        .catch(() => { this.timingErrors++; })
        .finally(() => (this.gpuPending = false));
    }
  }

  summary() {
    const r = (x: number) => Math.round(x * 100) / 100;
    return {
      frames: this.frames,
      budgetMs: r(this.budgetMs),
      gpuMode: this.gpuMode,
      timingErrors: this.timingErrors,
      gpuSamples: this.gpu.count,
      gpuRender: { samples: this.gpuRender.count, p95: this.gpuRender.count ? r(this.gpuRender.percentile(0.95)) : null },
      gpuCompute: { samples: this.gpuCompute.count, p95: this.gpuCompute.count ? r(this.gpuCompute.percentile(0.95)) : null },
      cpu: { p50: r(this.cpu.percentile(0.5)), p95: r(this.cpu.percentile(0.95)), max: r(this.cpu.max()) },
      gpu: { p50: r(this.gpu.percentile(0.5)), p95: r(this.gpu.percentile(0.95)), max: r(this.gpu.max()) },
      interval: { p50: r(this.interval.percentile(0.5)), p95: r(this.interval.percentile(0.95)) },
      inputToSubmit: { p50: r(this.inputToSubmit.percentile(0.5)), p95: r(this.inputToSubmit.percentile(0.95)) },
      inputToGpu: { p50: r(this.inputToGpu.percentile(0.5)), p95: r(this.inputToGpu.percentile(0.95)) },
      overBudgetPct: r((this.overBudget / Math.max(1, this.frames - this.warmupFrames)) * 100),
      hitches: this.hitches,
    };
  }
}
