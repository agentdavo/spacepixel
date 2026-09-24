import type { Cond, Conversation, DialogChoice, DialogState, DialogWorld, Effect } from './types';

/**
 * The dialog engine — pure functions over plain data. A running conversation
 * is just (conversation, node id, world); every step returns a new world, so
 * the UI can apply ledger / flag changes, and tests can walk every branch.
 */

export function newDialogState(): DialogState {
  return { flags: {}, seen: {}, rumours: [], tips: [], codex: [], contracts: [], recruits: [] };
}

const inRange = (v: number, min?: number, max?: number) => (min === undefined || v >= min) && (max === undefined || v <= max);

export function evalCond(c: Cond | undefined, w: DialogWorld): boolean {
  if (!c) return true;
  if ('flag' in c) return !!w.state.flags[c.flag];
  if ('notFlag' in c) return !w.state.flags[c.notFlag];
  if ('episode' in c) return inRange(w.episode, c.episode.min, c.episode.max);
  if ('standing' in c) return inRange(w.ledger.rep[c.standing] ?? 0, c.min, c.max);
  if ('credits' in c) return w.ledger.credits >= c.credits;
  if ('cargo' in c) return inRange(w.ledger.cargo[c.cargo] ?? 0, c.min ?? 1, c.max);
  if ('cargoSpace' in c) return w.ledger.capacity - cargoUsed(w) >= c.cargoSpace;
  if ('stationFaction' in c) return !!w.station && (Array.isArray(c.stationFaction) ? c.stationFaction : [c.stationFaction]).includes(w.station.faction);
  if ('stationKind' in c) return !!w.station && (Array.isArray(c.stationKind) ? c.stationKind : [c.stationKind]).includes(w.station.kind);
  if ('seen' in c) return inRange(w.state.seen[c.seen] ?? 0, c.min ?? 1, c.max);
  if ('fact' in c) return c.is === undefined ? !!w.facts?.[c.fact] : w.facts?.[c.fact] === c.is;
  if ('counter' in c) return inRange(w.counters?.[c.counter] ?? 0, c.min, c.max);
  if ('all' in c) return c.all.every((x) => evalCond(x, w));
  if ('any' in c) return c.any.some((x) => evalCond(x, w));
  if ('not' in c) return !evalCond(c.not, w);
  return false;
}

function cargoUsed(w: DialogWorld): number {
  let n = 0;
  for (const v of Object.values(w.ledger.cargo)) n += v ?? 0;
  return n;
}

/** Fill {vars} in a line. Unknown vars are left as-is. */
export function fill(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/**
 * Apply effects to a world, returning a new one. Money and cargo are clamped:
 * a take that cannot be paid takes what there is (callers gate choices on
 * credits / cargo so this is a safety net, not a rule).
 */
export function applyEffects(effects: readonly Effect[] | undefined, w: DialogWorld): DialogWorld {
  if (!effects?.length) return w;
  const state: DialogState = {
    flags: { ...w.state.flags },
    seen: { ...w.state.seen },
    rumours: [...w.state.rumours],
    tips: [...w.state.tips],
    codex: [...w.state.codex],
    contracts: [...w.state.contracts],
    recruits: [...w.state.recruits],
  };
  const ledger = { ...w.ledger, cargo: { ...w.ledger.cargo }, rep: { ...w.ledger.rep } };
  let facts = w.facts;
  const push = (list: string[], v: string) => {
    if (!list.includes(v)) list.push(v);
    if (list.length > 40) list.shift();
  };
  for (const e of effects) {
    if ('setFlag' in e) state.flags[e.setFlag] = true;
    else if ('clearFlag' in e) delete state.flags[e.clearFlag];
    else if ('standing' in e) ledger.rep[e.standing] = Math.max(-100, Math.min(100, (ledger.rep[e.standing] ?? 0) + e.delta));
    else if ('credits' in e) ledger.credits = Math.max(0, Math.round(ledger.credits + e.credits));
    else if ('cargo' in e) {
      let d = e.delta;
      if (d > 0) {
        let used = 0;
        for (const v of Object.values(ledger.cargo)) used += v ?? 0;
        d = Math.min(d, Math.max(0, ledger.capacity - used));
      }
      const q = Math.max(0, (ledger.cargo[e.cargo] ?? 0) + d);
      if (q) ledger.cargo[e.cargo] = q;
      else delete ledger.cargo[e.cargo];
    } else if ('codex' in e) push(state.codex, e.codex);
    else if ('rumour' in e) push(state.rumours, fill(e.rumour, w.vars));
    else if ('tip' in e) push(state.tips, fill(e.tip, w.vars));
    else if ('contract' in e) push(state.contracts, e.contract);
    else if ('recruit' in e) push(state.recruits, e.recruit);
    else if ('fact' in e) facts = { ...facts, [e.fact]: e.value ?? true };
  }
  return { ...w, state, ledger, ...(facts ? { facts } : {}) };
}

/** Where a conversation starts for this world (first matching entry). */
export function entryNode(conv: Conversation, w: DialogWorld): string {
  for (const e of conv.entry) if (evalCond(e.if, w)) return e.node;
  return conv.entry[conv.entry.length - 1].node;
}

export interface ChoiceView {
  choice: DialogChoice;
  index: number;
  available: boolean;
}

/** Choices at a node: available ones, plus locked ones that asked to be shown. */
export function choicesAt(conv: Conversation, nodeId: string, w: DialogWorld): ChoiceView[] {
  const n = conv.nodes[nodeId];
  if (!n?.choices) return [];
  const out: ChoiceView[] = [];
  n.choices.forEach((choice, index) => {
    const ok = evalCond(choice.if, w);
    if (ok || choice.locked) out.push({ choice, index, available: ok });
  });
  return out;
}

/** Is the conversation on offer in this world? */
export function offered(conv: Conversation, w: DialogWorld): boolean {
  if (conv.repeatable === false && (w.state.seen[conv.id] ?? 0) > 0) return false;
  return evalCond(conv.when, w);
}

export interface Step {
  world: DialogWorld;
  /** Node to show next; null = conversation over. */
  node: string | null;
  /** Effects applied by this step (for the UI log / hooks). */
  applied: Effect[];
}

/** Enter a node: apply its effects. */
export function enter(conv: Conversation, nodeId: string, w: DialogWorld): Step {
  const n = conv.nodes[nodeId];
  if (!n) return { world: finish(conv, w), node: null, applied: [] };
  return { world: applyEffects(n.effects, w), node: nodeId, applied: [...(n.effects ?? [])] };
}

/** Start a conversation: the entry node, entered. */
export function begin(conv: Conversation, w: DialogWorld): Step {
  return enter(conv, entryNode(conv, w), w);
}

/**
 * Advance from `nodeId`: pick choice `index` (when the node has choices) or
 * follow `next`. Unavailable choices are refused (returns the same node).
 */
export function advance(conv: Conversation, nodeId: string, w: DialogWorld, index?: number): Step {
  const n = conv.nodes[nodeId];
  if (!n) return { world: finish(conv, w), node: null, applied: [] };
  if (n.choices?.length) {
    const c = index === undefined ? undefined : n.choices[index];
    if (!c || !evalCond(c.if, w)) return { world: w, node: nodeId, applied: [] };
    const w2 = applyEffects(c.effects, w);
    if (c.next === null) return { world: finish(conv, w2), node: null, applied: [...(c.effects ?? [])] };
    const s = enter(conv, c.next, w2);
    return { ...s, applied: [...(c.effects ?? []), ...s.applied] };
  }
  if (n.next) return enter(conv, n.next, w);
  return { world: finish(conv, w), node: null, applied: [] };
}

function finish(conv: Conversation, w: DialogWorld): DialogWorld {
  return { ...w, state: { ...w.state, seen: { ...w.state.seen, [conv.id]: (w.state.seen[conv.id] ?? 0) + 1 } } };
}

/** Structural problems in a set of conversations (tests + dev). */
export function validate(convs: readonly Conversation[], speakers: ReadonlySet<string>, codexIds?: ReadonlySet<string>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const c of convs) {
    if (ids.has(c.id)) errs.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (!c.entry.length) errs.push(`${c.id}: no entry`);
    for (const e of c.entry) if (!c.nodes[e.node]) errs.push(`${c.id}: entry → missing node ${e.node}`);
    const reach = new Set<string>();
    const walk = (id: string) => {
      if (reach.has(id) || !c.nodes[id]) return;
      reach.add(id);
      const n = c.nodes[id];
      if (n.next) walk(n.next);
      for (const ch of n.choices ?? []) if (ch.next) walk(ch.next);
    };
    for (const e of c.entry) walk(e.node);
    for (const [id, n] of Object.entries(c.nodes)) {
      if (!reach.has(id)) errs.push(`${c.id}/${id}: unreachable`);
      if (n.who !== 'self' && !speakers.has(n.who)) errs.push(`${c.id}/${id}: unknown speaker ${n.who}`);
      if (n.next && !c.nodes[n.next]) errs.push(`${c.id}/${id}: next → missing ${n.next}`);
      if (n.next && n.choices?.length) errs.push(`${c.id}/${id}: both next and choices`);
      for (const ch of n.choices ?? []) if (ch.next && !c.nodes[ch.next]) errs.push(`${c.id}/${id}: choice → missing ${ch.next}`);
      if (n.line.length > 240) errs.push(`${c.id}/${id}: line too long (${n.line.length})`);
      const effs = [...(n.effects ?? []), ...(n.choices ?? []).flatMap((ch) => ch.effects ?? [])];
      if (codexIds) for (const e of effs) if ('codex' in e && !codexIds.has(e.codex)) errs.push(`${c.id}/${id}: unknown codex ${e.codex}`);
      // Every choice list must leave a way out.
      if (n.choices?.length && !n.choices.some((ch) => !ch.if)) errs.push(`${c.id}/${id}: every choice is conditional (dead end possible)`);
    }
  }
  return errs;
}
