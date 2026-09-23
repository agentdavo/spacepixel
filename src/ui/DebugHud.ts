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

  constructor(
    private engine: Engine,
    private ink: InkPipeline,
    private game: GameScene,
    private sceneName: string,
    root: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-debug';
    this.shotEl = document.createElement('div');
    this.shotEl.className = 'hud-shot';
    if (flags.hud) root.append(this.el, this.shotEl);

    window.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) {
        this.view = VIEWS[n - 1];
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
    this.acc += ctx.dt;
    if (this.acc > 0.25) {
      this.acc = 0;
      this.render();
    }
  }

  private render(): void {
    const { info, stats } = this.engine;
    const s = this.ink.settings;
    const backend = info.isWebGPU
      ? `<b>WebGPU</b> <span class="sub">(native WGSL ink)</span>`
      : `<span class="warn">WebGL2 fallback</span> <span class="sub">(TSL ink twin)</span>`;
    this.el.innerHTML = `
      <div class="title">PROJECT VANGUARD</div>
      <div class="sub">RENDER CORE // M1–M3 LOOK DEV</div>
      <div>BACKEND  ${backend}</div>
      <div>ADAPTER  <b>${info.adapterDescription || 'n/a'}</b></div>
      <div>FRAME    <b>${stats.fps.toFixed(1)}</b> fps · <b>${stats.frameMs.toFixed(1)}</b> ms</div>
      <div>VIEW     <b>${this.view.toUpperCase()}</b> · INK <b>${s.enabled ? 'ON' : 'OFF'}</b> · BOIL <b>${s.boilAmount > 0 ? 'ON' : 'OFF'}</b></div>
      <div class="keys">[1-6] view  [I] ink  [B] boil  [C] camera</div>`;
    this.shotEl.textContent = this.game.cameraLabel?.() ?? this.sceneName.toUpperCase();
  }
}
