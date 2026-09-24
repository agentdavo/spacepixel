/**
 * Small world changes for the replay tape. A dock-screen action or a
 * conversation used to put the whole WorldState on the tape (a few KB with a
 * full log); the tape now carries only what changed: facts, counters and
 * modifiers set or removed, the clock, and the log's new tail.
 *
 * Pure (node-testable). `applyWorldDiff(a, diffWorld(a, b))` equals `b`.
 */
import { sanitizeWorld, type WorldEvent, type WorldMod, type WorldState } from './WorldState.ts';

interface KeyDiff<V> {
  set?: Record<string, V>;
  del?: string[];
}

export interface WorldDiff {
  clock?: number;
  facts?: KeyDiff<string | boolean>;
  counters?: KeyDiff<number>;
  /** Changed channels by scope; `del` lists [scope, channel]. */
  mods?: { set?: Record<string, Record<string, WorldMod>>; del?: [string, string][] };
  /** The log: drop `drop` events off the front (the cap), then append `add`; or replace it (`all`). */
  log?: { drop: number; add: WorldEvent[] } | { all: WorldEvent[] };
}

function keys<V>(a: Record<string, V>, b: Record<string, V>, same: (x: V, y: V) => boolean): KeyDiff<V> | undefined {
  if (a === b) return undefined;
  const d: KeyDiff<V> = {};
  for (const [k, v] of Object.entries(b)) if (!(k in a) || !same(a[k], v)) (d.set ??= {})[k] = v;
  for (const k of Object.keys(a)) if (!(k in b)) (d.del ??= []).push(k);
  return d.set || d.del ? d : undefined;
}

const eq = <V>(x: V, y: V) => x === y;
const sameMod = (x: WorldMod, y: WorldMod) => x.value === y.value && x.decay === y.decay;
const sameEvent = (x: WorldEvent, y: WorldEvent) => x === y || JSON.stringify(x) === JSON.stringify(y);

function logDiff(a: WorldEvent[], b: WorldEvent[]): WorldDiff['log'] {
  if (a === b) return undefined;
  // The log only grows at the back and loses its oldest events to the cap:
  // find where the old log's tail starts the new one.
  for (let drop = 0; drop <= a.length; drop++) {
    const kept = a.length - drop;
    if (kept > b.length) continue;
    let ok = true;
    for (let i = 0; i < kept && ok; i++) ok = sameEvent(a[drop + i], b[i]);
    if (!ok) continue;
    const add = b.slice(kept);
    return drop || add.length ? { drop, add } : undefined;
  }
  return { all: b };
}

/** What changed from `a` to `b` (empty object: nothing). */
export function diffWorld(a: WorldState, b: WorldState): WorldDiff {
  const d: WorldDiff = {};
  if (a.clock !== b.clock) d.clock = b.clock;
  const facts = keys(a.facts, b.facts, eq);
  if (facts) d.facts = facts;
  const counters = keys(a.counters, b.counters, eq);
  if (counters) d.counters = counters;
  if (a.mods !== b.mods) {
    const m: NonNullable<WorldDiff['mods']> = {};
    for (const [s, chans] of Object.entries(b.mods)) {
      const k = keys(a.mods[s] ?? {}, chans, sameMod);
      if (k?.set) (m.set ??= {})[s] = k.set;
      for (const c of k?.del ?? []) (m.del ??= []).push([s, c]);
    }
    for (const [s, chans] of Object.entries(a.mods)) if (!(s in b.mods)) for (const c of Object.keys(chans)) (m.del ??= []).push([s, c]);
    if (m.set || m.del) d.mods = m;
  }
  const log = logDiff(a.log, b.log);
  if (log) d.log = log;
  return d;
}

export function isEmptyDiff(d: WorldDiff): boolean {
  return Object.keys(d).length === 0;
}

function applyKeys<V>(a: Record<string, V>, d: KeyDiff<V> | undefined): Record<string, V> {
  if (!d) return a;
  const out = { ...a, ...d.set };
  for (const k of d.del ?? []) delete out[k];
  return out;
}

/** `a` with a recorded change applied (sanitized: a tape is untrusted input). */
export function applyWorldDiff(a: WorldState, raw: unknown): WorldState {
  if (!raw || typeof raw !== 'object') return a;
  const d = raw as WorldDiff;
  const w: WorldState = { ...a };
  if (typeof d.clock === 'number') w.clock = d.clock;
  w.facts = applyKeys(a.facts, d.facts);
  w.counters = applyKeys(a.counters, d.counters);
  if (d.mods) {
    const mods: WorldState['mods'] = { ...a.mods };
    for (const [s, chans] of Object.entries(d.mods.set ?? {})) mods[s] = { ...mods[s], ...chans };
    for (const [s, c] of d.mods.del ?? []) {
      if (!mods[s]) continue;
      const next = { ...mods[s] };
      delete next[c];
      if (Object.keys(next).length) mods[s] = next;
      else delete mods[s];
    }
    w.mods = mods;
  }
  if (d.log) w.log = 'all' in d.log ? d.log.all : [...a.log.slice(d.log.drop), ...d.log.add];
  return sanitizeWorld(w);
}
