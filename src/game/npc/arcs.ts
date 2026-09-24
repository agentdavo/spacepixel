/**
 * Persistent NPC arcs (batch 5 · milestone 7) — the engine.
 *
 * An arc is a small state machine for one recurring person: steps with a
 * place (which station's concourse they stand on), a status line for the
 * THREADS tab, an optional conversation and named contract, and transitions
 * that fire on world facts, counters, the campaign episode or elapsed play
 * time. Arcs advance while you are away: `tickArcs` runs whenever the game
 * looks (docking, the concourse, every half minute of flight) and catches up
 * any number of timed steps at once, dating each from when it *would* have
 * happened. Arcs can end well, badly, or be missed if ignored too long.
 *
 * Everything lives in the shared world memory (src/game/world/WorldState.ts),
 * never in a private save:
 *
 *   fact    npc.<arc>.step      current step id
 *   counter npc.<arc>.since     world clock when the step began
 *   fact    npc.<arc>.outcome   'good' | 'bad' | 'missed' once it ends
 *   event   npc.arc  (scope npc:<person>)  { arc, step, outcome? }
 *
 * Pure (type imports + WorldState) so tests/npc-arcs.test.ts walks every arc.
 */
import type { Cond, Conversation, DialogNode } from '../../dialog/types';
import { counter, fact, record, setFact, type WorldState } from '../world/WorldState.ts';
import { ARCS } from './arcData.ts';

export type ArcOutcome = 'good' | 'bad' | 'missed';

/** When a step moves on (or an arc begins). */
export type Trigger =
  | { fact: string; is?: string | boolean }
  | { counter: string; min: number }
  /** Seconds of world clock since the current step began. */
  | { after: number }
  /** World clock at least this (arc starts). */
  | { clock: number }
  /** Campaign episode reached (profile.episode). */
  | { episode: number }
  | { all: Trigger[] }
  | { any: Trigger[] }
  | { not: Trigger };

export interface ArcTalk {
  title: string;
  entry: { if?: Cond; node: string }[];
  nodes: Record<string, DialogNode>;
  /** Default true: the step's talk can be had again until the step moves on. */
  repeatable?: boolean;
}

export interface ArcStep {
  /**
   * Where the host stands: station-id prefixes (`rustwake-freeport` matches
   * `rustwake-freeport-0`), first that exists wins. [] = on no concourse.
   */
  at: string[];
  /** Who you talk to at this step (default: the arc's person). */
  host?: string;
  /** One line for the THREADS tab. */
  status: string;
  talk?: ArcTalk;
  /** The named contract this step offers (shown on the THREADS tab). */
  contract?: string;
  next?: { to: string; when: Trigger }[];
  end?: ArcOutcome;
  /** World facts set on entering the step. */
  sets?: Record<string, string | boolean>;
}

export interface Arc {
  id: string;
  person: string;
  title: string;
  /** Writers' one-liner. */
  blurb: string;
  start: Trigger;
  first: string;
  steps: Record<string, ArcStep>;
}

export interface ArcCtx {
  /** World clock (seconds of play). */
  now: number;
  episode: number;
}

export const arcKey = (arc: string, k: 'step' | 'since' | 'outcome') => `npc.${arc}.${k}`;

function setCounter(w: WorldState, key: string, v: number): WorldState {
  return w.counters[key] === v ? w : { ...w, counters: { ...w.counters, [key]: v } };
}

export function evalTrigger(t: Trigger, w: WorldState, ctx: ArcCtx, since?: number): boolean {
  if ('fact' in t) return t.is === undefined ? !!fact(w, t.fact) : fact(w, t.fact) === t.is;
  if ('counter' in t) return counter(w, t.counter) >= t.min;
  if ('after' in t) return since !== undefined && ctx.now - since >= t.after;
  if ('clock' in t) return ctx.now >= t.clock;
  if ('episode' in t) return ctx.episode >= t.episode;
  if ('all' in t) return t.all.every((x) => evalTrigger(x, w, ctx, since));
  if ('any' in t) return t.any.some((x) => evalTrigger(x, w, ctx, since));
  if ('not' in t) return !evalTrigger(t.not, w, ctx, since);
  return false;
}

/** When a (true) trigger became true: timed triggers date from their deadline, the rest from now. */
function firedAt(t: Trigger, w: WorldState, ctx: ArcCtx, since: number): number {
  if ('after' in t) return since + t.after;
  if ('clock' in t) return t.clock;
  if ('any' in t) {
    let best = Infinity;
    for (const x of t.any) if (evalTrigger(x, w, ctx, since)) best = Math.min(best, firedAt(x, w, ctx, since));
    return best === Infinity ? ctx.now : best;
  }
  if ('all' in t) return t.all.reduce((m, x) => Math.max(m, 'after' in x || 'any' in x || 'all' in x ? firedAt(x, w, ctx, since) : ctx.now), -Infinity);
  return ctx.now;
}

/** Can this trigger fire by time alone (an arc never stalls forever)? */
export function timed(t: Trigger): boolean {
  if ('after' in t) return true;
  if ('any' in t) return t.any.some(timed);
  return false;
}

export interface ArcMove {
  arc: string;
  from: string | null;
  to: string;
  outcome?: ArcOutcome;
}

function enter(w: WorldState, arc: Arc, stepId: string, at: number): WorldState {
  const step = arc.steps[stepId];
  w = setFact(w, arcKey(arc.id, 'step'), stepId);
  w = setCounter(w, arcKey(arc.id, 'since'), at);
  for (const [k, v] of Object.entries(step?.sets ?? {})) w = setFact(w, k, v);
  if (step?.end) w = setFact(w, arcKey(arc.id, 'outcome'), step.end);
  return record(w, 'npc.arc', `npc:${arc.person}`, { arc: arc.id, step: stepId, ...(step?.end ? { outcome: step.end } : {}) });
}

/** Advance one arc as far as the world allows (catching up timed steps). */
export function tickArc(w: WorldState, arc: Arc, ctx: ArcCtx, moves: ArcMove[] = []): WorldState {
  const had = fact(w, arcKey(arc.id, 'step'));
  let cur: string;
  if (typeof had === 'string') cur = had;
  else {
    if (!evalTrigger(arc.start, w, ctx)) return w;
    // Began when its clock came round, even if nobody was looking.
    w = enter(w, arc, arc.first, Math.min(ctx.now, firedAt(arc.start, w, ctx, 0)));
    moves.push({ arc: arc.id, from: null, to: arc.first });
    cur = arc.first;
  }
  for (let guard = 0; guard < 16; guard++) {
    const step: ArcStep | undefined = arc.steps[cur];
    if (!step || step.end) break;
    const since = counter(w, arcKey(arc.id, 'since'));
    const now = w;
    const hit = (step.next ?? []).find((n) => evalTrigger(n.when, now, ctx, since));
    if (!hit) break;
    // A timed move happened when its time came, not when we looked.
    const at = Math.min(ctx.now, firedAt(hit.when, w, ctx, since));
    w = enter(w, arc, hit.to, at);
    const end = arc.steps[hit.to]?.end;
    moves.push({ arc: arc.id, from: cur, to: hit.to, ...(end ? { outcome: end } : {}) });
    cur = hit.to;
  }
  return w;
}

/** Advance every arc. */
export function tickArcs(w: WorldState, ctx: ArcCtx, arcs: readonly Arc[] = ARCS): { world: WorldState; moves: ArcMove[] } {
  const moves: ArcMove[] = [];
  for (const a of arcs) w = tickArc(w, a, ctx, moves);
  return { world: w, moves };
}

export interface ArcView {
  arc: Arc;
  stepId: string;
  step: ArcStep;
  since: number;
  outcome: ArcOutcome | null;
}

/** Where an arc stands, or null if it hasn't begun. */
export function arcView(w: WorldState, arc: Arc): ArcView | null {
  const id = fact(w, arcKey(arc.id, 'step'));
  if (typeof id !== 'string' || !arc.steps[id]) return null;
  const o = fact(w, arcKey(arc.id, 'outcome'));
  return { arc, stepId: id, step: arc.steps[id], since: counter(w, arcKey(arc.id, 'since')), outcome: o === 'good' || o === 'bad' || o === 'missed' ? o : null };
}

export function arcViews(w: WorldState, arcs: readonly Arc[] = ARCS): ArcView[] {
  return arcs.map((a) => arcView(w, a)).filter((v): v is ArcView => !!v);
}

/** First station matching a step's `at` prefixes. */
export function resolveAt<S extends { id: string }>(at: readonly string[], stations: readonly S[]): S | null {
  for (const pre of at) {
    const s = stations.find((x) => x.id === pre || x.id.startsWith(pre + '-'));
    if (s) return s;
  }
  return null;
}

/**
 * Where arcs put people: person id → station id (null = on no concourse).
 * A step hosted by someone else takes the arc's person off the concourse.
 */
export function arcPlacement(w: WorldState, stations: readonly { id: string }[], arcs: readonly Arc[] = ARCS): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const v of arcViews(w, arcs)) {
    const host = v.step.host ?? v.arc.person;
    const at = resolveAt(v.step.at, stations)?.id ?? null;
    if (host !== v.arc.person && !out.has(v.arc.person)) out.set(v.arc.person, null);
    out.set(host, at);
  }
  return out;
}

const convCache = new Map<string, Conversation>();

/** The conversation for step `stepId` of `arc` (stable object per step). */
export function stepConversation(arc: Arc, stepId: string): Conversation | null {
  const step = arc.steps[stepId];
  if (!step?.talk) return null;
  const id = `arc-${arc.id}-${stepId}`;
  let c = convCache.get(id);
  if (!c) {
    c = { id, title: step.talk.title, with: step.host ?? arc.person, entry: step.talk.entry, nodes: step.talk.nodes, priority: 100, repeatable: step.talk.repeatable ?? true };
    convCache.set(id, c);
  }
  return c;
}

/** The arc conversation `personId` has to offer right now, if any. */
export function arcConversationFor(w: WorldState, personId: string, arcs: readonly Arc[] = ARCS): Conversation | null {
  for (const v of arcViews(w, arcs)) {
    if ((v.step.host ?? v.arc.person) !== personId) continue;
    const c = stepConversation(v.arc, v.stepId);
    if (c) return c;
  }
  return null;
}

/** Every step conversation (tests: validate the writing). */
export function allArcConversations(arcs: readonly Arc[] = ARCS): Conversation[] {
  return arcs.flatMap((a) => Object.keys(a.steps).map((s) => stepConversation(a, s)).filter((c): c is Conversation => !!c));
}

/** Structural problems in the arc set (tests + dev). */
export function validateArcs(arcs: readonly Arc[] = ARCS): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const a of arcs) {
    if (ids.has(a.id)) errs.push(`${a.id}: duplicate arc`);
    ids.add(a.id);
    if (!a.steps[a.first]) errs.push(`${a.id}: first step ${a.first} missing`);
    const ends = new Set<ArcOutcome>();
    for (const [sid, s] of Object.entries(a.steps)) {
      if (s.end) ends.add(s.end);
      if (s.end && s.next?.length) errs.push(`${a.id}/${sid}: an ending with transitions`);
      if (!s.end && !s.next?.length) errs.push(`${a.id}/${sid}: dead end without an outcome`);
      for (const n of s.next ?? []) if (!a.steps[n.to]) errs.push(`${a.id}/${sid}: → missing ${n.to}`);
      // Every live step must be able to move on by time alone (arcs never stall forever).
      if (!s.end && !(s.next ?? []).some((n) => timed(n.when))) errs.push(`${a.id}/${sid}: no timed way on`);
      if (s.status.length > 160) errs.push(`${a.id}/${sid}: status too long`);
    }
    if (!ends.has('good')) errs.push(`${a.id}: no good ending`);
    if (!ends.has('bad') && !ends.has('missed')) errs.push(`${a.id}: no bad or missed ending`);
    // Reachability.
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id) || !a.steps[id]) return;
      seen.add(id);
      for (const n of a.steps[id].next ?? []) walk(n.to);
    };
    walk(a.first);
    for (const sid of Object.keys(a.steps)) if (!seen.has(sid)) errs.push(`${a.id}/${sid}: unreachable`);
  }
  return errs;
}

export { ARCS };
