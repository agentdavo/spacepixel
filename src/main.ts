import { flags } from '@/core/Flags';
import { Engine } from '@/core/Engine';
import { createRenderer } from '@/render/RendererFactory';
import { InkPipeline } from '@/render/post/InkPipeline';
import { SCENES, DEFAULT_SCENE } from '@/world/scenes';
import { DebugHud } from '@/ui/DebugHud';

declare global {
  interface Window {
    __VANGUARD__?: {
      ready: boolean;
      frame: () => number;
      backend: string;
      error?: string;
      /** Scene-specific test hooks (e.g. scripted input for screenshots). */
      hooks?: Record<string, unknown>;
    };
  }
}

function fail(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  console.error(err);
  const el = document.createElement('div');
  el.className = 'hud-error';
  el.textContent = `VANGUARD BOOT FAILURE\n\n${msg}`;
  document.getElementById('ui-root')?.append(el);
  window.__VANGUARD__ = { ready: false, frame: () => 0, backend: 'none', error: msg };
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const info = await createRenderer(canvas);
  const engine = new Engine(info);

  const sceneName = SCENES[flags.scene] ? flags.scene : DEFAULT_SCENE;
  const game = await SCENES[sceneName]();
  engine.onResize(game);

  const ink = new InkPipeline(info.renderer, game.scene, game.camera, info.isWebGPU);
  ink.settings.enabled = flags.ink;
  ink.applySettings();
  ink.setView(flags.view);
  engine.onResize(ink);

  engine.addSystem(game);
  engine.addSystem({ update: (ctx) => ink.update(ctx.time) });
  engine.addSystem(new DebugHud(engine, ink, game, sceneName, document.getElementById('ui-root')!));
  engine.setRender(() => ink.render());

  engine.start();
  window.__VANGUARD__ = {
    ...window.__VANGUARD__,
    ready: true,
    frame: () => engine.frameContext.frame,
    backend: info.backendName,
    hooks: { ...window.__VANGUARD__?.hooks, perf: () => engine.perf.summary() },
  };
  console.info(`[vanguard] ${info.backendName} backend · ${info.adapterDescription} · scene=${sceneName}`);
}

boot().catch(fail);
