import { flags } from '@/core/Flags';
import { Engine } from '@/core/Engine';
import { input } from '@/core/Input';
import { createRenderer } from '@/render/RendererFactory';
import { InkPipeline } from '@/render/post/InkPipeline';
import { SCENES, DEFAULT_SCENE } from '@/world/scenes';
import type { GameScene } from '@/world/GameScene';
import { DebugHud } from '@/ui/DebugHud';
import { titleScreen, briefingScreen } from '@/ui/Screens';
import { FIRST_LIGHT } from '@/game/Missions';
import { DynamicResolution } from '@/core/DynamicResolution';

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
  const uiRoot = document.getElementById('ui-root')!;
  const info = await createRenderer(canvas);
  const engine = new Engine(info);

  let ink: InkPipeline | null = null;
  let debugHud: DebugHud | null = null;

  /** (Re)build the running scene + its ink pipeline. */
  async function load(name: string): Promise<GameScene> {
    engine.clearSystems();
    input.override = null;
    const game = await SCENES[name]();
    engine.onResize(game);
    ink = new InkPipeline(info.renderer, game.scene, game.camera, info.isWebGPU);
    ink.settings.enabled = flags.ink;
    ink.applySettings();
    ink.setView(flags.view);
    engine.onResize(ink);
    const pipeline = ink;
    engine.addSystem(game);
    engine.addSystem({ update: (ctx) => pipeline.update(ctx.time) });
    if (flags.quality === 'low') pipeline.setRenderScale(0.75);
    const dynres = new DynamicResolution(engine.perf, pipeline);
    dynres.enabled = flags.dynres;
    engine.addSystem({ update: (ctx) => dynres.update(ctx.dt) });
    if (!debugHud) debugHud = new DebugHud(engine, pipeline, game, name, uiRoot);
    debugHud.game = game;
    debugHud.sceneName = name;
    engine.addSystem(debugHud);
    engine.setRender(() => pipeline.render());
    console.info(`[vanguard] scene=${name}`);
    return game;
  }

  const direct = flags.scene && SCENES[flags.scene];
  const first = await load(direct ? flags.scene : 'showcase');
  engine.start();
  window.__VANGUARD__ = {
    ...window.__VANGUARD__,
    ready: true,
    frame: () => engine.frameContext.frame,
    backend: info.backendName,
    hooks: { ...window.__VANGUARD__?.hooks, perf: () => engine.perf.summary() },
  };
  console.info(`[vanguard] ${info.backendName} backend · ${info.adapterDescription}`);

  if (direct) {
    if (new URLSearchParams(location.search).get('mission') === '1') first.startMission?.(FIRST_LIGHT);
    return;
  }

  // Front end: title card over the live showcase → briefing → flight.
  for (;;) {
    const choice = await titleScreen(uiRoot);
    if (choice === 'launch') {
      await briefingScreen(uiRoot, FIRST_LIGHT);
      const game = await load(DEFAULT_SCENE);
      game.startMission?.(FIRST_LIGHT);
      return;
    }
    if (choice === 'hangar') {
      await load('hangar');
      return;
    }
    return; // showcase: stay
  }
}

boot().catch(fail);
