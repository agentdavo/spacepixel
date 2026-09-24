import { flags } from '@/core/Flags';
import { Engine } from '@/core/Engine';
import { input } from '@/core/Input';
import { createRenderer } from '@/render/RendererFactory';
import { InkPipeline } from '@/render/post/InkPipeline';
import { SCENES, DEFAULT_SCENE } from '@/world/scenes';
import type { GameScene } from '@/world/GameScene';
import { DebugHud } from '@/ui/DebugHud';
import { titleScreen, briefingScreen } from '@/ui/Screens';
import { FIRST_LIGHT, type MissionDef } from '@/game/Missions';
import { MISSIONS } from '@/game/campaign/missions';
import type { CampaignMission } from '@/game/campaign/types';
import { showEyecatch, showDebrief } from '@/ui/Eyecatch';
import { loadProfile, saveProfile } from '@/game/Profile';
import type { FlightScene } from '@/world/scenes/FlightScene';
import type { PrologueScene } from '@/world/scenes/PrologueScene';
import { getAudio } from '@/audio';
import { DynamicResolution } from '@/core/DynamicResolution';
import { episodeCompleted, syncStory } from '@/game/world/live';

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
    hooks: { ...window.__VANGUARD__?.hooks, perf: () => engine.perf.summary(), step: (n: number) => engine.step(n) },
  };
  console.info(`[vanguard] ${info.backendName} backend · ${info.adapterDescription}`);

  const q = new URLSearchParams(location.search);
  if (direct) {
    if (q.get('mission') === '1') first.startMission?.(FIRST_LIGHT);
    // ?scene=flight&episode=N: drop straight into a campaign episode (dev / captures).
    const ep = Number(q.get('episode'));
    if (ep >= 1 && ep <= MISSIONS.length && 'startCampaign' in first) void (first as FlightScene).startCampaign(MISSIONS[ep - 1]);
    return;
  }

  /** The ~60 s cold open (src/cinema/prologue.ts); resolves when it ends or is skipped. */
  async function playPrologue(): Promise<void> {
    const reel = (await load('prologue')) as PrologueScene;
    reel.exitOnSkip = true;
    await reel.done;
  }

  /**
   * The career loop: (prologue, once) → eyecatch → briefing → episode →
   * debrief → free flight from a Directorate station (trade, contracts) →
   * "priority orders" at any Directorate station → the next episode. The
   * campaign's order never changes; the player chooses when it continues.
   * After the last episode the Reach simply stays open.
   */
  async function runCampaign(startFree = false): Promise<void> {
    const profile = loadProfile();
    // Careers from before the world state: every episode already flown counts in the Reach.
    syncStory(profile.episode);
    if (!startFree && !profile.seenPrologue && profile.episode <= 1) {
      await playPrologue();
      profile.seenPrologue = true;
      saveProfile(profile);
    }
    let flight: FlightScene | null = null;
    let free = startFree;
    let fromEpisode = false;
    for (;;) {
      const m: CampaignMission | undefined = MISSIONS[profile.episode - 1];
      if (free || !m) {
        if (!flight) flight = (await load(DEFAULT_SCENE)) as FlightScene;
        const desk = flight.contracts;
        // After an episode: the nearest Directorate berth. From the title: where you last docked.
        const last = flight.ledger.lastDock;
        const station = !fromEpisode && last && desk.hasBoard(last) ? last : desk.homeStation();
        await flight.startFreeRoam(station, m ? { episode: m.episode, title: m.title, tagline: m.tagline } : null);
        free = false;
        if (!m) return; // unreachable: with nothing pending, free flight never ends
      }
      await showEyecatch(uiRoot, { chapter: m.chapter, episode: m.episode, title: m.title, tagline: m.tagline });
      getAudio().music.setMood('briefing', 2);
      await briefingScreen(uiRoot, briefingOf(m));
      if (!flight) flight = (await load(DEFAULT_SCENE)) as FlightScene;
      const result = await flight.startCampaign(m);
      const next = await showDebrief(uiRoot, { title: m.title, debrief: result.outcome === 'success' ? m.debrief : 'The Keeping teaches: what fails can be flown again.', codexUnlocked: result.codex, outcome: result.outcome, episode: m.episode });
      // Story → sandbox: the episode's facts change the Reach (src/game/world/sim.ts STORY_RULES).
      if (result.outcome === 'success') episodeCompleted(m.episode);
      if (result.outcome === 'success' && next === 'continue') {
        profile.episode = Math.min(MISSIONS.length + 1, m.episode + 1);
        saveProfile(profile);
      }
      // "Continue" opens the Reach (success or not); "retry" flies the episode again.
      free = next === 'continue';
      fromEpisode = true;
    }
  }

  // Front end: title card over the live showcase → briefing → flight. Left
  // idle, the title plays the prologue as an attract reel, then comes back.
  for (;;) {
    getAudio().music.setMood('title');
    const choice = await titleScreen(uiRoot, { idleMs: 45_000 });
    if (choice === 'prologue' || choice === 'attract') {
      if (choice === 'prologue') getAudio().ui('confirm');
      await playPrologue();
      await load('showcase');
      continue;
    }
    getAudio().ui('confirm');
    if (choice === 'launch' || choice === 'free') {
      await runCampaign(choice === 'free');
      return;
    }
    if (choice === 'hangar' || choice === 'paint') {
      await load(choice);
      return;
    }
    return; // showcase: stay
  }
}

boot().catch(fail);

/** Adapt a campaign episode to the briefing screen's shape. */
function briefingOf(m: CampaignMission): MissionDef {
  return {
    id: m.id,
    episode: `EPISODE ${String(m.episode).padStart(2, '0')}`,
    title: m.title,
    system: m.system,
    briefing: m.briefing,
    objectives: m.objectives.filter((o) => !o.hidden).map((o) => ({ id: o.id, text: o.text, optional: o.optional, done: () => false })),
  };
}
