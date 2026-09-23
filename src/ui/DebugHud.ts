import type { Engine, FrameContext, Updatable } from '@/core/Engine';
import type { InkPipeline } from '@/render/post/InkPipeline';
import type { GameScene } from '@/world/GameScene';
import type { DebugView } from '@/core/Flags';
import { flags } from '@/core/Flags';

const VIEWS: DebugView[] = ['final', 'color', 'normal', 'depth', 'id', 'edges'];

/**
 * Developer overlay for the render-core milestones. Keyboard:
 *   1–6  G-buffer / debug views      I  toggle ink
 *   C    next camera shot            B  toggle line boil
 */
export class DebugHud implements Updatable {
  private el: HTMLDivElement;
  private shotEl: HTMLDivElement;
  private view: DebugView = flags.view;
  private acc = 0;
  private graph = document.createElement('canvas');
  private graphCtx: CanvasRenderingContext2D;

  constructor(
    private engine: Engine,
    private ink: InkPipeline,
    public game: GameScene,
    public sceneName: string,
    root: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-debug';
    this.shotEl = document.createElement('div');
    this.shotEl.className = 'hud-shot';
    this.graph.width = 260;
    this.graph.height = 64;
    this.graph.className = 'hud-graph';
    this.graphCtx = this.graph.getContext('2d')!;
    if (flags.hud) root.append(this.el, this.shotEl);

    window.addEventListener('keydown', (e) => {
      const fn = /^F([1-6])$/.exec(e.code);
      if (fn) {
        e.preventDefault();
        this.view = VIEWS[Number(fn[1]) - 1];
        this.ink.setView(this.view);
      } else if (e.key === 'i' || e.key === 'I') {
        this.ink.settings.enabled = !this.ink.settings.enabled;
        this.ink.applySettings();
      } else if (e.key === 'c' || e.key === 'C') {
        this.game.cycleCamera?.();
      } else if (e.key === 'b' || e.key === 'B') {
        this.ink.settings.boilAmount = this.ink.settings.boilAmount > 0 ? 0 : 0.35;
        this.ink.applySettings();
      }
      this.render();
    });
    this.render();
  }

  update(ctx: FrameContext): void {
    this.drawGraph();
    this.acc += ctx.dt;
    if (this.acc > 0.25) {
      this.acc = 0;
      this.render();
    }
  }

  private render(): void {
    const { info, stats } = this.engine;
    const s = this.ink.settings;
    const p = this.engine.perf.summary();
    const backend = info.isWebGPU
      ? `<b>WebGPU</b> <span class="sub">(native WGSL ink)</span>`
      : `<span class="warn">WebGL2 fallback</span> <span class="sub">(TSL ink twin)</span>`;
    this.el.innerHTML = `
      <div class="title">PROJECT VANGUARD</div>
      <div class="sub">DEV BUILD // SCENE ${this.sceneName.toUpperCase()}</div>
      <div>BACKEND  ${backend}</div>
      <div>ADAPTER  <b>${info.adapterDescription || 'n/a'}</b></div>
      <div>FRAME    <b>${stats.fps.toFixed(1)}</b> fps · <b>${stats.frameMs.toFixed(1)}</b> ms · budget <b>${p.budgetMs.toFixed(1)}</b></div>
      <div>CPU      p50 <b>${p.cpu.p50}</b> p95 <b>${p.cpu.p95}</b> ms <span class="${p.cpu.p95 > p.budgetMs ? 'warn' : 'sub'}">${p.cpu.p95 > p.budgetMs ? 'OVER' : 'ok'}</span></div>
      <div>GPU      p50 <b>${p.gpu.p50}</b> p95 <b>${p.gpu.p95}</b> ms <span class="sub">(${p.gpuMode})</span></div>
      <div>INPUT→SUBMIT <b>${p.inputToSubmit.p50}</b> ms · →GPU <b>${p.inputToGpu.p50}</b> ms</div>
      <div>VIEW     <b>${this.view.toUpperCase()}</b> · INK <b>${s.enabled ? 'ON' : 'OFF'}</b> · BOIL <b>${s.boilAmount > 0 ? 'ON' : 'OFF'}</b></div>
      <div class="keys">[F1-F6] view  [I] ink  [B] boil  [C] camera</div>
      <div class="keys">mouse/arrows steer · Q/E roll · W/S throttle · SHIFT burner · Z assist · X stop</div>
      <div class="keys">SPACE guns · F salvo · T target · J cruise · V cam · M map · TAB tactical · 1-4 wing orders</div>`;
    this.el.append(this.graph);
    this.shotEl.textContent = this.game.cameraLabel?.() ?? this.sceneName.toUpperCase();
  }

  /** CPU (green) and GPU (cyan) frame times against the budget line (amber). */
  private drawGraph(): void {
    const c = this.graphCtx;
    const { cpu, gpu, budgetMs } = this.engine.perf;
    const W = this.graph.width;
    const H = this.graph.height;
    const scale = H / (budgetMs * 2); // budget sits at half height
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, W, H);
    const plot = (ring: typeof cpu, color: string) => {
      c.strokeStyle = color;
      c.beginPath();
      for (let k = 0; k < Math.min(ring.count, W); k++) {
        const x = W - 1 - k;
        const y = H - Math.min(H, ring.at(k) * scale);
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    };
    plot(gpu, '#6fe6ff');
    plot(cpu, '#7dffb2');
    c.strokeStyle = '#ffc46b';
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(0, H / 2);
    c.lineTo(W, H / 2);
    c.stroke();
    c.setLineDash([]);
  }
}
