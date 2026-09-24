/**
 * The world simulation at runtime: installs the readers (economy prices and
 * tariffs, traffic volume / piracy / patrols) against the live `world()`,
 * steps it through free flight, persists it, and turns the player's deeds
 * and the story's episodes into world writes (src/game/world/sim.ts,
 * schedule.ts, signal.ts hold the rules; this file only wires them).
 *
 *   ?world=ep<N>          fast-forward the story facts (episodes 1..N done); never saved
 *   &wclock=<s>           …and set the world clock (Schedule / Signal captures)
 *   &wbreak=1             …and break this quarter's first engagement (its consequences)
 *   &wclear=<system>      …and break three ambushes on that system's lanes
 */
import type { Universe } from '@/universe/Universe';
import { setTrafficWorld } from '@/universe/traffic';
import { setMarketWorld, type CommodityId, type EconFaction, type MarketSpec } from '../economy';
import { saveWorld, setFact, world, type WorldEvent, type WorldState } from './WorldState';
import { actAmbush, actContract, actKill, actTrade, attitude, backfillStory, completeEpisode, fastForward, hostilePatrol, patrolOffset, piracyOffset, priceOffset, since, trafficOffset, type ReachInfo } from './sim';
import { stepWorld } from './step';
import { breakEngagement, currentSchedule, flyAsOrdered, engagementById, type Engagement } from './schedule';
import { worldNews } from './news';

/** The Reach as the simulation sees it. */
export function reachInfo(u: Universe): ReachInfo {
  return {
    seed: u.seed,
    systems: [...u.systems.values()].map((s) => ({
      id: s.id,
      name: s.name,
      faction: s.faction,
      threat: s.threat,
      // Surface ports (planetfall markets) count as the system's stations too.
      stations: [...s.stations, ...(s.surfacePorts ?? [])].map((st) => ({ id: st.id, name: st.name, kind: st.kind, faction: st.faction })),
      gates: s.gates.map((g) => g.to),
    })),
  };
}

let devMode: boolean | null = null;
/** A `?world=` capture world: fast-forwarded once, never saved, never backfilled. */
export function isDevWorld(): boolean {
  if (devMode === null) {
    const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    devMode = /^ep\d+$/.test(q.get('world') ?? '');
    if (devMode) {
      const ep = Number(q.get('world')!.slice(2));
      const clock = Math.max(0, Number(q.get('wclock')) || 0);
      world().update(() => fastForward(ep, clock));
    }
  }
  return devMode;
}

/** Save unless this is a capture world. */
export function persistWorld(): void {
  if (!isDevWorld()) saveWorld(world().state);
}

/** Main's career loop: an episode debriefed as a success. */
export function episodeCompleted(ep: number): void {
  world().update((w) => completeEpisode(w, ep));
  persistWorld();
}

/** Old careers: every episode below the profile's next one counts as flown. */
export function syncStory(nextEpisode: number): void {
  if (isDevWorld()) return;
  const before = world().state;
  world().update((w) => backfillStory(w, nextEpisode));
  if (world().state !== before) persistWorld();
}

type Listener = (e: WorldEvent) => void;

/**
 * The live world for one flight scene. One per page (the flight scene is a
 * singleton); `initWorld` returns the existing runtime on a second call.
 */
export class WorldRuntime {
  readonly reach: ReachInfo;
  private stationSys = new Map<string, string>();
  private listeners = new Set<Listener>();
  private saveT = 0;

  constructor(readonly universe: Universe) {
    this.reach = reachInfo(universe);
    for (const s of this.reach.systems) for (const st of s.stations) this.stationSys.set(st.id, s.id);
    isDevWorld();
    const read = () => world().state;
    setMarketWorld({
      price: (spec, cid) => priceOffset(read(), this.systemOf(spec), spec.id, cid, spec.kind),
      attitude: (spec) => this.attitudeAt(spec),
    });
    setTrafficWorld({
      volume: (id) => trafficOffset(read(), id),
      piracy: (id) => piracyOffset(read(), id),
      patrol: (id) => patrolOffset(read(), id),
      hostilePatrol: (flag) => hostilePatrol(read(), flag),
    });
    this.captureFlags();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => persistWorld());
  }

  get state(): WorldState {
    return world().state;
  }

  /** The system a market sits in (carriers: wherever the pilot is). */
  systemOf(spec: { id: string }): string {
    return this.stationSys.get(spec.id) ?? this.here();
  }

  /** Set by the flight scene: the current system id. */
  here: () => string = () => this.universe.start;

  attitudeAt(spec: Pick<MarketSpec, 'id' | 'faction' | 'kind'>): number {
    return attitude(world().state, spec, this.systemOf(spec));
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(events: WorldEvent[]): void {
    for (const e of events) for (const l of this.listeners) l(e);
  }

  private apply(fn: (w: WorldState) => WorldState): void {
    const before = world().state;
    world().update(fn);
    this.emit(since(before, world().state));
  }

  /** One frame of free flight (not docked, not in a story episode). */
  step(dt: number): void {
    if (!(dt > 0)) return;
    const r = stepWorld(world().state, dt, this.reach);
    world().update(() => r.w);
    this.emit(r.events);
    this.saveT += dt;
    if (this.saveT > 15) {
      this.saveT = 0;
      persistWorld();
    }
  }

  // ── the pilot's deeds ────────────────────────────────────────────────

  kill(sysId: string, faction: EconFaction): void {
    this.apply((w) => actKill(w, sysId, faction));
  }
  ambush(sysId: string, victim: EconFaction, raidersKilled: number, saved: boolean): void {
    this.apply((w) => actAmbush(w, sysId, victim, raidersKilled, saved));
    persistWorld();
  }
  trade(stationId: string, cid: CommodityId, units: number): void {
    this.apply((w) => actTrade(w, stationId, this.systemOf({ id: stationId }), cid, units));
  }
  contractPaid(stationId: string, faction: EconFaction): void {
    this.apply((w) => actContract(w, stationId, faction));
    persistWorld();
  }

  // ── the Schedule ─────────────────────────────────────────────────────

  schedule(): Engagement[] {
    return currentSchedule(world().state, this.reach);
  }
  engagement(id: string): Engagement | null {
    return engagementById(world().state, this.reach, id);
  }
  /**
   * Careers from before the world clock ran: adopt the play clock once (a
   * world that has never ticked), so NPC arcs and rivals keep their times.
   */
  adoptClock(playClock: number): void {
    if (world().state.clock === 0 && playClock > 0 && !isDevWorld()) world().update((w) => ({ ...w, clock: playClock }));
  }

  /** An episode debriefed as a success. */
  episode(ep: number): void {
    this.apply((w) => completeEpisode(w, ep));
    persistWorld();
  }
  /** Orders taken: the engagement waits for the pilot instead of being fought without them. */
  takeSchedule(id: string): void {
    this.apply((w) => setFact(w, `schedule.taken.${id}`));
    persistWorld();
  }
  scheduleOutcome(id: string, broken: false | 'protected' | 'refused'): void {
    const e = this.engagement(id);
    if (!e) return;
    this.apply((w) => (broken ? breakEngagement(w, e, broken) : flyAsOrdered(w, e)));
    persistWorld();
  }

  /** Ticker / rumour lines for a berth. */
  news(stationId: string, n = 3): string[] {
    return worldNews(world().state, this.reach, { sysId: this.systemOf({ id: stationId }), stationId }, n);
  }

  /** `&wbreak=1` / `&wclear=<sys>` on a capture world. */
  private captureFlags(): void {
    if (!isDevWorld()) return;
    const q = new URLSearchParams(location.search);
    if (q.get('wbreak')) {
      const e = this.schedule()[0];
      if (e) world().update((w) => breakEngagement(w, e, 'protected'));
    }
    const clear = q.get('wclear');
    if (clear) for (let i = 0; i < 3; i++) world().update((w) => actAmbush(w, clear, 'concord', 3, true));
  }
}

let rt: WorldRuntime | null = null;
export function initWorld(u: Universe): WorldRuntime {
  return (rt ??= new WorldRuntime(u));
}
/** The runtime, once the flight scene has made it (null on the title / showcase). */
export function worldRuntime(): WorldRuntime | null {
  return rt;
}
