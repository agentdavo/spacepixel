/**
 * NPC arcs + rivals at runtime: the glue between the pure modules (arcs.ts,
 * rivals.ts, memory.ts) and the live world (`world()`), the concourse, the
 * contracts runtime and the flight scene. Everything it writes goes to the
 * shared world memory; it keeps no state of its own beyond a save debounce.
 *
 *   advanceNpcs(clock)        arcs + rivals catch up with the world clock
 *   noteContract(k, state)    contract facts / events (named jobs, bounties on rivals)
 *   noteEvent(kind, …)        a world event that moves rivals' grudges
 *   npcPlacement(stations)    who stands where (arcs, rivals gone to ground)
 *   npcConversation(person)   the arc / rival conversation someone has now
 *   npcVars(person, seed)     `{memory}` for their lines
 *
 * Captures / dev (read once): ?npc=odile:shut,magpie:hunted sets arc steps;
 * ?rivalstate=ismene:hiding:4[:tier[:met]] sets a rival's status (grudge, tier, times met);
 * ?npcmemory=1 seeds a few remembered events so `{memory}` has something to say.
 */
import { counter, fact, sanitizeWorld, setFact, world, type WorldEvent, type WorldScope, type WorldState } from '../world/WorldState';
import { loadProfile } from '../Profile';
import type { Contract } from '../contracts/contracts';
import type { Conversation } from '@/dialog/types';
import { ARCS, arcConversationFor, arcKey, arcPlacement, resolveAt, tickArcs, type ArcMove } from './arcs';
import { memoryLine } from './memory';
import { RIVALS, bountyTaken, grudgeFromEvent, markDown, rivalByMark, rivalByPerson, rivalConversationFor, rivalHideouts, rk, setStatus, tickRivals, type RivalStatus } from '../rivals/rivals';
import { persistWorld } from '../world/live';
import './people'; // registers arc guests and rivals gone to ground with the concourse

/**
 * The NPC clock is the world clock (src/game/world owns it: WorldRuntime.step
 * in the fixed sim step, free flight only; old saves adopt the play clock
 * once, WorldRuntime.adoptClock). The argument is kept for call sites.
 */
export function npcNow(_ledgerClock?: number): number {
  return world().state.clock;
}

let lastClock = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

function hookSave(): void {
  if (hooked) return;
  hooked = true;
  world().on(() => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistWorld();
    }, 1500);
  });
  try {
    window.addEventListener('pagehide', () => persistWorld());
  } catch {
    /* no window (tools) */
  }
}

/** Arcs and rivals catch up with the world (call on docking, the concourse, periodically in flight). */
export function advanceNpcs(ledgerClock = lastClock, episode = loadProfile().episode): ArcMove[] {
  hookSave();
  lastClock = Math.max(lastClock, ledgerClock);
  stageOnce();
  const ctx = { now: npcNow(lastClock), episode };
  let moves: ArcMove[] = [];
  world().update((w) => {
    const r = tickArcs(w, ctx);
    moves = r.moves;
    return tickRivals(r.world, ctx);
  });
  return moves;
}

/** Record a world event and let it move rivals' grudges (`sys`: where it happened). */
export function noteEvent(kind: string, scope: WorldScope | undefined, data: WorldEvent['data'], sys?: { id: string; faction: string }): void {
  hookSave();
  world().event(kind, scope, data);
  const e = world().state.log[world().state.log.length - 1];
  world().update((w) => grudgeFromEvent(w, e, sys));
}

export type ContractNote = 'active' | 'ready' | 'done' | 'failed' | 'lapsed' | 'abandoned';

/**
 * The contracts runtime reports a contract changing state. Named jobs keep a
 * fact (`contract.<key>` — arcs wait on these); finished and failed work is
 * remembered in the log; bounties on a rival move that rival.
 */
export function noteContract(k: Contract, state: ContractNote, sysName: (id: string) => string, sysFaction: (id: string) => string = () => ''): void {
  hookSave();
  if (k.named) world().update((w) => setFact(w, `contract.${k.named}`, state));
  const mark = k.kind === 'bounty' && k.op?.mark ? rivalByMark(k.op.mark.id) : undefined;
  const opSys = k.op?.system ?? k.payAtSystem;
  if (mark && state === 'active') world().update((w) => bountyTaken(w, mark.id));
  if (mark && state === 'ready') world().update((w) => markDown(w, mark.id, npcNow(lastClock), sysName(opSys)));
  if (state === 'done' || state === 'failed' || state === 'lapsed') {
    const data: Record<string, string | number | boolean> = { kind: k.kind, title: k.title, client: k.client, sys: sysName(opSys) };
    if (k.named) data.named = k.named;
    if (k.op?.freighter) data.freighter = k.op.freighter.name;
    if (k.op?.mark) data.mark = k.op.mark.name;
    if (k.destName) data.dest = k.destName;
    noteEvent(state === 'done' ? 'contract.done' : 'contract.failed', `system:${opSys}`, data, { id: opSys, faction: sysFaction(opSys) });
  }
  advanceNpcs();
}

/** Who stands where because of a story: arcs, and rivals gone to ground. */
export function npcPlacement(stations: readonly { id: string }[]): Map<string, string | null> {
  const w = world().state;
  const out = arcPlacement(w, stations);
  for (const h of rivalHideouts(w)) out.set(h.personId, resolveAt(h.at, stations)?.id ?? null);
  return out;
}

/** The story conversation a person has for you right now (arc step, or a rival's), if any. */
export function npcConversation(personId: string): Conversation | null {
  const w = world().state;
  return arcConversationFor(w, personId) ?? rivalConversationFor(w, personId);
}

/** Vars for a person's lines: `{memory}`. */
export function npcVars(personId: string, seed: number): Record<string, string> {
  return { memory: memoryLine(world().state, rivalByPerson(personId)?.id ?? personId, seed) };
}

/** Write facts from dialog effects (`{ fact }`) into the world, then let arcs react. */
export function applyDialogFacts(facts: { fact: string; value?: string | boolean }[]): ArcMove[] {
  if (!facts.length) return [];
  world().update((w) => facts.reduce((acc, f) => setFact(acc, f.fact, f.value ?? true), w));
  return advanceNpcs();
}

/** Facts and counters for dialog conditions. */
export function dialogFacts(): { facts: Record<string, string | boolean>; counters: Record<string, number> } {
  const w = world().state;
  return { facts: w.facts, counters: w.counters };
}

// ── capture staging ───────────────────────────────────────────────────

let staged = false;

function stageOnce(): void {
  if (staged) return;
  staged = true;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    return;
  }
  const arcs = q.get('npc');
  const rivals = q.get('rivalstate');
  const mem = q.get('npcmemory');
  if (!arcs && !rivals && !mem) return;
  world().update((w0) => {
    let w: WorldState = w0;
    const now = npcNow(lastClock);
    for (const pair of (arcs ?? '').split(',').filter(Boolean)) {
      const [id, step] = pair.split(':');
      const arc = ARCS.find((a) => a.id === id);
      if (!arc || !arc.steps[step]) continue;
      w = setFact(w, arcKey(id, 'step'), step);
      w = { ...w, counters: { ...w.counters, [arcKey(id, 'since')]: now } };
      if (arc.steps[step].end) w = setFact(w, arcKey(id, 'outcome'), arc.steps[step].end!);
      for (const [k, v] of Object.entries(arc.steps[step].sets ?? {})) w = setFact(w, k, v);
    }
    for (const trip of (rivals ?? '').split(',').filter(Boolean)) {
      const [id, status, grudge, tier, met] = trip.split(':');
      if (!RIVALS.some((r) => r.id === id)) continue;
      w = setStatus(w, id, (status || 'hunting') as RivalStatus);
      const c: Record<string, number> = { [rk(id, 'next')]: now + (status === 'hiding' ? 5400 : 0) };
      if (grudge) c[rk(id, 'grudge')] = Number(grudge) || 0;
      if (tier) c[rk(id, 'tier')] = Math.min(2, Number(tier) || 0);
      if (met) c[rk(id, 'met')] = Number(met) || 0;
      if (Number(tier) > 0) c[rk(id, 'beaten')] = Number(tier);
      w = { ...w, counters: { ...w.counters, ...c } };
    }
    return w;
  });
  if (mem) {
    const seed: [string, WorldScope | undefined, WorldEvent['data']][] = [
      ['contract.failed', 'system:halaedon', { kind: 'escort', sys: 'Halaedon', freighter: 'Kittiwake', title: 'Clan convoy' }],
      ['ambush.broken', 'system:quilegard', { sys: 'Quilegard', victim: 'Patient Ox', band: 'Blackwake' }],
      ['rival.beaten', 'npc:ismene', { rival: 'ismene', name: 'Unwitnessed Ismene', sys: 'Coraex' }],
      ['rival.wing-down', 'npc:red-sabine', { rival: 'red-sabine', name: 'Red Sabine', sys: 'Pelourin', wingman: 'Sabine\'s boy Tuck' }],
    ];
    for (const [k, s, d] of seed) if (!world().state.log.some((e) => e.kind === k && e.data?.sys === d?.sys)) world().event(k, s, d);
  }
}

// ── replays (MP-0) ────────────────────────────────────────────────────

let recorder: ((w: WorldState) => void) | null = null;

/**
 * Every world change reaches `fn` (the flight scene hands it to the replay
 * recorder, which keeps only changes made outside a sim tick: conversations,
 * the dock screen). In-tick changes (rivals, arcs ticking in flight) replay
 * by themselves.
 */
export function recordWorldChanges(fn: (w: WorldState) => void): void {
  const first = !recorder;
  recorder = fn;
  if (first) world().on((w) => recorder?.(w));
}

/** A replay tape's world change (the same one the live session made from a conversation). */
export function applyRecordedWorld(raw: unknown): void {
  world().update(() => sanitizeWorld(raw));
}

/** For the THREADS tab. */
export function npcWorld(): WorldState {
  return world().state;
}

export { fact, counter };
