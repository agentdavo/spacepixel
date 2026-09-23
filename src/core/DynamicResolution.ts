import type { Perf } from './Perf';
import type { InkPipeline } from '@/render/post/InkPipeline';

/**
 * Hold the frame rate, give up pixels: a small controller that watches
 * measured GPU frame time and steps the scene-pass resolution between
 * `min` and 1.0. Hysteresis + a cooldown stop it oscillating. Disabled when
 * no real GPU timing is available (nothing honest to steer by).
 */
export class DynamicResolution {
  enabled = true;
  min = 0.6;
  private cooldown = 0;

  constructor(
    private perf: Perf,
    private ink: InkPipeline,
  ) {}

  update(dt: number): void {
    if (!this.enabled || this.perf.gpuMode === 'none') return;
    this.cooldown -= dt;
    if (this.cooldown > 0 || this.perf.gpu.count < 20) return;
    // Median of the last 20 GPU samples.
    const recent: number[] = [];
    for (let k = 0; k < 20; k++) recent.push(this.perf.gpu.at(k));
    recent.sort((a, b) => a - b);
    const gpu = recent[10];
    const budget = this.perf.budgetMs;
    const s = this.ink.renderScale;
    if (gpu > budget * 0.92 && s > this.min) {
      this.ink.setRenderScale(s - 0.1);
      this.cooldown = 0.75;
    } else if (gpu < budget * 0.6 && s < 1) {
      this.ink.setRenderScale(s + 0.05);
      this.cooldown = 1.5;
    }
  }
}
