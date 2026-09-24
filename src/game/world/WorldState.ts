/**
 * The Reach's memory: what has happened, to whom, and where. One small
 * persistent store shared by guilds, the world simulation (prices, traffic,
 * patrols, station attitude), the Schedule, NPC arcs and rivals.
 *
 * Pure data + pure functions (node-testable); the only side effects are the
 * guarded localStorage load/save at the bottom. Systems never keep private
 * copies of world facts: they read here and append events here.
 *
 *   facts     — named booleans/strings ("bastion.fallen", "guild.keeping.rank")
 *   counters  — named numbers ("kills.renegade", "lane.meridian-tessaly.cleared")
 *   mods      — per system / per station modifiers (price, traffic, patrol,
 *               attitude), each decaying back to 0 at its own rate
 *   log       — append-only event log (capped), the source of "the Reach
 *               remembers": who did what, where, when (world clock seconds)
 */

export type WorldScope = `system:${string}` | `station:${string}` | `faction:${string}` | `guild:${string}` | `npc:${string}`;

/** A modifier on one scope. `value` decays toward 0 by `decay` per world-hour. */
export interface WorldMod {
  value: number;
  decay: number;
}

export interface WorldEvent {
  /** World clock (seconds of free-flight time since the career began). */
  t: number;
  kind: string;
  /** Where / whom it concerns. */
  scope?: WorldScope;
  /** Short machine-readable details (ids, amounts). */
  data?: Record<string, string | number | boolean>;
}

export interface WorldState {
  version: 1;
  clock: number;
  facts: Record<string, string | boolean>;
  counters: Record<string, number>;
  /** mods[scope][channel] — channels e.g. 'price:ebon', 'traffic', 'patrol', 'attitude'. */
  mods: Record<string, Record<string, WorldMod>>;
  log: WorldEvent[];
}

export const LOG_CAP = 400;

export function emptyWorld(): WorldState {
  return { version: 1, clock: 0, facts: {}, counters: {}, mods: {}, log: [] };
}

// ── facts & counters ──────────────────────────────────────────────────

export function fact(w: WorldState, key: string): string | boolean | undefined {
  return w.facts[key];
}

export function setFact(w: WorldState, key: string, value: string | boolean = true): WorldState {
  if (w.facts[key] === value) return w;
  return { ...w, facts: { ...w.facts, [key]: value } };
}

export function counter(w: WorldState, key: string): number {
  return w.counters[key] ?? 0;
}

export function bump(w: WorldState, key: string, by = 1): WorldState {
  return { ...w, counters: { ...w.counters, [key]: (w.counters[key] ?? 0) + by } };
}

// ── modifiers ─────────────────────────────────────────────────────────

export function mod(w: WorldState, scope: WorldScope, channel: string): number {
  return w.mods[scope]?.[channel]?.value ?? 0;
}

/** Add to a modifier (clamped to ±limit); `decay` per world-hour replaces the old rate. */
export function nudge(w: WorldState, scope: WorldScope, channel: string, by: number, decay = 0.1, limit = 1): WorldState {
  const cur = w.mods[scope]?.[channel]?.value ?? 0;
  const value = Math.max(-limit, Math.min(limit, cur + by));
  return { ...w, mods: { ...w.mods, [scope]: { ...w.mods[scope], [channel]: { value, decay } } } };
}

// ── events & time ─────────────────────────────────────────────────────

export function record(w: WorldState, kind: string, scope?: WorldScope, data?: WorldEvent['data']): WorldState {
  const e: WorldEvent = { t: w.clock, kind, ...(scope ? { scope } : {}), ...(data ? { data } : {}) };
  const log = w.log.length >= LOG_CAP ? [...w.log.slice(w.log.length - LOG_CAP + 1), e] : [...w.log, e];
  return { ...w, log };
}

/** Events matching a filter, newest first. */
export function recall(w: WorldState, match: { kind?: string; scope?: WorldScope; since?: number }, limit = 20): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = w.log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = w.log[i];
    if (match.kind && e.kind !== match.kind) continue;
    if (match.scope && e.scope !== match.scope) continue;
    if (match.since !== undefined && e.t < match.since) break;
    out.push(e);
  }
  return out;
}

/** Advance the world clock; modifiers decay toward 0. */
export function tick(w: WorldState, dtSeconds: number): WorldState {
  if (dtSeconds <= 0) return w;
  const h = dtSeconds / 3600;
  const mods: WorldState['mods'] = {};
  for (const [scope, chans] of Object.entries(w.mods)) {
    const next: Record<string, WorldMod> = {};
    for (const [ch, m] of Object.entries(chans)) {
      const step = m.decay * h;
      const value = Math.abs(m.value) <= step ? 0 : m.value - Math.sign(m.value) * step;
      if (value !== 0) next[ch] = { value, decay: m.decay };
    }
    if (Object.keys(next).length) mods[scope] = next;
  }
  return { ...w, clock: w.clock + dtSeconds, mods };
}

/** Repair anything a bad or older save could hold. */
export function sanitizeWorld(raw: unknown): WorldState {
  const w = emptyWorld();
  if (!raw || typeof raw !== 'object') return w;
  const r = raw as Partial<WorldState>;
  if (typeof r.clock === 'number' && isFinite(r.clock) && r.clock >= 0) w.clock = r.clock;
  if (r.facts && typeof r.facts === 'object') for (const [k, v] of Object.entries(r.facts)) if (typeof v === 'string' || typeof v === 'boolean') w.facts[k] = v;
  if (r.counters && typeof r.counters === 'object') for (const [k, v] of Object.entries(r.counters)) if (typeof v === 'number' && isFinite(v)) w.counters[k] = v;
  if (r.mods && typeof r.mods === 'object')
    for (const [s, chans] of Object.entries(r.mods)) {
      if (!chans || typeof chans !== 'object') continue;
      for (const [c, m] of Object.entries(chans)) if (m && typeof m.value === 'number' && typeof m.decay === 'number' && isFinite(m.value)) (w.mods[s] ??= {})[c] = { value: m.value, decay: m.decay };
    }
  if (Array.isArray(r.log)) w.log = r.log.filter((e) => e && typeof e.t === 'number' && typeof e.kind === 'string').slice(-LOG_CAP);
  return w;
}

// ── persistence (guarded) ─────────────────────────────────────────────

const KEY = 'vanguard.world.v1';

export function loadWorld(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeWorld(JSON.parse(raw)) : emptyWorld();
  } catch {
    return emptyWorld();
  }
}

export function saveWorld(w: WorldState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* private window / quota: the Reach forgets, the game goes on */
  }
}

// ── the live instance ─────────────────────────────────────────────────

type Listener = (w: WorldState, e: WorldEvent | null) => void;

/**
 * The running game's single world. Systems call `world.update(fn)` with a
 * pure transform, or `world.event(...)`; listeners hear every change.
 */
export class World {
  private listeners = new Set<Listener>();
  constructor(public state: WorldState = emptyWorld()) {}

  update(fn: (w: WorldState) => WorldState): void {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l(next, null);
  }

  event(kind: string, scope?: WorldScope, data?: WorldEvent['data']): void {
    this.state = record(this.state, kind, scope, data);
    const e = this.state.log[this.state.log.length - 1];
    for (const l of this.listeners) l(this.state, e);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

let live: World | null = null;
/** The shared world (loaded lazily from storage). */
export function world(): World {
  return (live ??= new World(loadWorld()));
}
