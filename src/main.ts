import { flags } from '@/core/Flags';
import { Engine, type Updatable } from '@/core/Engine';
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
import type { TrailerScene } from '@/world/scenes/TrailerScene';
import { disposeTree, DISPOSE_PARTS, GpuEpoch, releaseRendererCaches } from '@/core/dispose';
import { PhotoMode } from '@/ui/PhotoMode';
import { getAudio } from '@/audio';
import { DynamicResolution } from '@/core/DynamicResolution';
import { episodeCompleted, syncStory } from '@/game/world/live';
import { installStorageShim, loadReplay, replayBootUrl, setPendingReplay } from '@/game/ReplayDirector';

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

/**
 * ?replay=<slot|url>: read the tape, make sure the page runs the query it
 * was recorded with (flags are read at module load, so reload there if
 * not), shim storage with its profile and hand it to the flight scene.
 */
async function prepareReplay(): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  const ref = q.get('replay');
  if (!ref) return false;
  const file = await loadReplay(ref);
  const seek = q.has('rseek') ? Number(q.get('rseek')) : -1;
  const want = new URLSearchParams(replayBootUrl(file, ref, seek).slice(1));
  const have = new URLSearchParams(location.search);
  want.sort();
  have.sort();
  if (want.toString() !== have.toString()) {
    location.replace(`${location.pathname}?${want.toString()}`);
    return new Promise(() => {}); // navigating
  }
  installStorageShim(file.header.storage);
  setPendingReplay(file, seek);
  console.info(`[vanguard] replay ${ref}: ${file.ticks} ticks (${(file.ticks / 60).toFixed(1)} s), seed ${file.header.seed}`);
  return true;
}

async function boot(): Promise<void> {
  await prepareReplay();
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root')!;
  const info = await createRenderer(canvas);
  const engine = new Engine(info);

  let ink: InkPipeline | null = null;
  let debugHud: DebugHud | null = null;
  let current: GameScene | null = null;
  const photo = new PhotoMode(canvas, uiRoot);
  const gpu = new GpuEpoch(info.renderer as unknown as ConstructorParameters<typeof GpuEpoch>[0]);

  /** (Re)build the running scene + its ink pipeline; the old one is torn down (GPU + DOM). */
  async function load(name: string): Promise<GameScene> {
    engine.clearSystems();
    input.override = null;
    photo.exit();
    // Nothing draws until the new scene is up: the old one is being torn down.
    engine.setRender(() => {});
    if (current) {
      current.dispose?.();
      disposeTree(current.scene);
      current = null;
    }
    if (DISPOSE_PARTS.ink) ink?.dispose();
    if (DISPOSE_PARTS.textures) gpu.flush();
    releaseRendererCaches(info.renderer);
    ink = null;
    const game = await SCENES[name]();
    current = game;
    engine.onResize(game);
    ink = new InkPipeline(info.renderer, game.scene, game.camera, info.isWebGPU);
    ink.settings.enabled = flags.ink;
    ink.applySettings();
    ink.setView(flags.view);
    engine.onResize(ink);
    const pipeline = ink;
    const sim = game as GameScene & Pick<Updatable, 'fixedUpdate' | 'timeScale'>;
    // Photo mode (F10) freezes the scene and flies the lens itself. The
    // wrapper must pass the fixed step through, or the flight sim never ticks.
    engine.addSystem({
      fixedUpdate: sim.fixedUpdate ? (t) => sim.fixedUpdate!(t) : undefined,
      timeScale: sim.fixedUpdate ? () => (photo.active ? 0 : (sim.timeScale?.() ?? 1)) : undefined,
      update: (ctx) => {
        if (photo.request) {
          photo.request = false;
          photo.enter(game.camera);
        }
        if (photo.active) photo.update(ctx.dt);
        else game.update(ctx);
      },
    });
    engine.addSystem({ update: (ctx) => pipeline.update(ctx.time) });
    if (flags.quality === 'low') pipeline.setRenderScale(0.75);
    const dynres = new DynamicResolution(engine.perf, pipeline);
    dynres.enabled = flags.dynres;
    engine.addSystem({ update: (ctx) => dynres.update(ctx.dt) });
    if (!debugHud) debugHud = new DebugHud(engine, pipeline, game, name, uiRoot);
    debugHud.game = game;
    debugHud.ink = pipeline;
    debugHud.sceneName = name;
    engine.addSystem(debugHud);
    engine.setRender(() => {
      pipeline.render();
      if (photo.capture) photo.save();
    });
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
    hooks: {
      ...window.__VANGUARD__?.hooks,
      perf: () => engine.perf.summary(),
      step: (n: number) => engine.step(n),
      /** The renderer itself (leak probes, dev tools). */
      renderer: () => info.renderer,
      /** GPU objects the renderer holds (attract-check leak test): info.memory + cached pipelines / programs. */
      memory: () => {
        const r = info.renderer as unknown as { info: { memory: Record<string, number> }; _pipelines?: { caches: Map<unknown, unknown>; programs: Record<string, Map<unknown, unknown>> } };
        const p = r._pipelines;
        return { ...r.info.memory, pipelines: p?.caches.size ?? 0, programs: p ? Object.values(p.programs).reduce((n, m) => n + m.size, 0) : 0 };
      },
    },
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
    await playReel('prologue', false);
  }

  /**
   * A reel (the prologue or the 90 s trailer) that hands back when it ends or
   * is skipped. As an attract reel, any key, click or stick returns to the title.
   */
  async function playReel(name: 'prologue' | 'trailer', attract: boolean): Promise<void> {
    const reel = (await load(name)) as PrologueScene | TrailerScene;
    reel.exitOnSkip = true;
    const poke = () => reel.skip();
    if (attract) {
      window.addEventListener('keydown', poke, true);
      window.addEventListener('pointerdown', poke, true);
      window.addEventListener('gamepadconnected', poke);
    }
    await reel.done;
    window.removeEventListener('keydown', poke, true);
    window.removeEventListener('pointerdown', poke, true);
    window.removeEventListener('gamepadconnected', poke);
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
      // The briefing already plays in the episode's score.
      getAudio().setPlace(m.system, null, m.episode, 1);
      getAudio().music.setMood('briefing', 2);
      await briefingScreen(uiRoot, briefingOf(m));
      if (!flight) flight = (await load(DEFAULT_SCENE)) as FlightScene;
      const result = await flight.startCampaign(m);
      const next = await showDebrief(uiRoot, { title: m.title, debrief: result.outcome === 'success' ? m.debrief : 'The Keeping teaches: what fails can be flown again.', codexUnlocked: result.codex, outcome: result.outcome, episode: m.episode });
      // Story → sandbox: the episode's facts change the Reach (src/game/world/sim.ts STORY_RULES).
      if (result.outcome === 'success') {
        if (flight) flight.worldEpisode(m.episode);
        else episodeCompleted(m.episode);
      }
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
  // idle, the title runs an attract loop — the prologue, then the trailer,
  // alternating — and comes back to the title between reels (any input stops it).
  // ?idle=S shortens the idle wait, ?reel=N plays reels N× faster (attract-check).
  const idleMs = (Number(q.get('idle')) || 45) * 1000;
  const ATTRACT = ['prologue', 'trailer'] as const;
  let attracts = 0;
  const attractStats = { reels: 0, titles: 0 };
  window.__VANGUARD__!.hooks = { ...window.__VANGUARD__!.hooks, attract: attractStats };
  for (;;) {
    // The title (and the attract reels) play the original score unless the player pinned one.
    getAudio().setPlace(null, null, null, 1);
    getAudio().music.setMood('title');
    attractStats.titles++;
    const choice = await titleScreen(uiRoot, { idleMs });
    if (choice === 'prologue' || choice === 'trailer' || choice === 'attract') {
      if (choice !== 'attract') getAudio().ui('confirm');
      const reel = choice === 'attract' ? ATTRACT[attracts++ % ATTRACT.length] : choice;
      await playReel(reel, choice === 'attract');
      attractStats.reels++;
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
