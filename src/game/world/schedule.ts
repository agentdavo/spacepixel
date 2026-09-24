/**
 * The Schedule of Engagements (batch 5 · item 5; docs/LORE.md "The Rot").
 *
 * Every quarter the Allocator-General and the Hierarch-Treasurer co-sign
 * where the war will be fought, how many fighters each side will "expend",
 * how much Ebon each loss releases to market, and the floor (88 sh a gram).
 * *No engagement shall be decisive.*
 *
 * Here a quarter is QUARTER seconds of world clock (free flight). The
 * quarter's engagements are a pure function of (Reach seed, quarter,
 * corrections owed from breaks in the quarter before) — so the map shows the
 * same Schedule to everyone with the same world, and breaking one changes
 * the *next* Schedule, never the one on the table.
 *
 * Visible once Episode 8 is flown (`schedule.known`); suspended when it is
 * read aloud in Episode 18 (`schedule.read`).
 *
 * The pilot can take one as ordered (a contracts-runtime operation: the
 * `sortie` op with `contract.schedule` set, built in contracts/ops.ts) —
 * hold the line, let the Measure expend its quota, withdraw on Allocation's
 * order, and be paid in shares — or break it: destroy the protected
 * "conductor" or refuse to withdraw. Breaking is recorded as world events
 * and facts (`schedule.broken.<id>`): prices spike, the Office of Continuity
 * turns cold, rumours spread, and next quarter's Schedule carries a
 * correction with the 13th requested by name.
 *
 * Pure: tests/schedule.test.ts.
 */
import type { Contract, ReachMap, ReachSystem, V3 } from '../contracts/contracts.ts';
import { findStation, hops } from '../contracts/contracts.ts';
import { bump, counter, fact, nudge, record, setFact, type WorldState } from './WorldState.ts';
import { roll, sysScope, type ReachInfo } from './sim.ts';

/** One quarter of world clock: 40 minutes of free flight. */
export const QUARTER = 2400;
/** An engagement is open this long either side of its hour. */
export const WINDOW = 360;
/** The agreed floor, shares per gram. */
export const FLOOR = 88;

export interface Engagement {
  /** `E137` */
  id: string;
  number: number;
  quarter: number;
  system: string;
  systemName: string;
  /** World clock (s) of the engagement hour. */
  at: number;
  /** Expected expenditure, fighters. */
  directorate: number;
  hegemony: number;
  /** Ebon released to market by the losses, grams. */
  ebon: number;
  /** The Hegemony ship neither side may touch. */
  protectedName: string;
  /** Owed for a broken engagement last quarter: the 13th requested by name. */
  correction: boolean;
  /** Joint squads fly (after the Schism). */
  joint: boolean;
}

export type EngagementStatus = 'upcoming' | 'open' | 'fought' | 'flown' | 'broken';

export const quarterOf = (clock: number): number => Math.floor(Math.max(0, clock) / QUARTER);

/** Is there a Schedule to show? */
export function scheduleVisible(w: WorldState): boolean {
  return !!fact(w, 'schedule.known') && !fact(w, 'schedule.read');
}

const CONDUCTORS = ['Vesper Antiphon', 'Vesper Gradual', 'Vesper Introit', 'Vesper Compline', 'Vesper Tenebrae', 'Vesper Sursum'];

/** Where the war is fought: the contested line, the Treaty Line at Tessaly, now and then the Null pickets. */
function battlefields(reach: ReachInfo): { id: string; name: string; w: number }[] {
  const out: { id: string; name: string; w: number }[] = [];
  for (const s of reach.systems) {
    if (s.faction === 'contested') out.push({ id: s.id, name: s.name, w: 1 + s.threat });
    else if (s.id === 'tessaly') out.push({ id: s.id, name: s.name, w: 1.4 });
    else if (s.id === 'null') out.push({ id: s.id, name: s.name, w: 0.35 });
  }
  return out;
}

/** The quarter's Schedule. Deterministic. */
export function scheduleFor(w: WorldState, reach: ReachInfo, quarter: number): Engagement[] {
  const fields = battlefields(reach);
  if (!fields.length) return [];
  const owed = fact(w, `schedule.correction.q${quarter}`);
  const key = `${reach.seed}:schedule:${quarter}:${counter(w, `schedule.corrections.q${quarter}`)}`;
  const n = 3 + Math.floor(roll(key, 0) * 3);
  const total = fields.reduce((s, f) => s + f.w, 0);
  const out: Engagement[] = [];
  const joint = !!fact(w, 'rot.open');
  let number = 115 + quarter * 6; // ≤ 5 a quarter, plus the skipped 131
  for (let i = 0; i < n; i++) {
    if (number === 131) number++; // Engagement 131 is the Bastion's. It is not on any board.
    let sysId: string;
    let name: string;
    const correction = i === 0 && typeof owed === 'string';
    if (correction) {
      sysId = owed as string;
      name = reach.systems.find((s) => s.id === sysId)?.name ?? sysId;
    } else {
      let r = roll(key, 10 + i) * total;
      let f = fields[fields.length - 1];
      for (const x of fields) if ((r -= x.w) <= 0) {
        f = x;
        break;
      }
      sysId = f.id;
      name = f.name;
    }
    const k = correction ? 1.6 : 1;
    const directorate = Math.round((4 + roll(key, 20 + i) * 9) * k);
    const hegemony = Math.round((3 + roll(key, 30 + i) * 8) * k);
    const ebon = Math.round((directorate + hegemony) * (18 + roll(key, 40 + i) * 12));
    const slot = (QUARTER - 2 * WINDOW) / n;
    const at = Math.round(quarter * QUARTER + WINDOW + slot * (i + 0.2 + 0.6 * roll(key, 50 + i)));
    out.push({
      id: `E${number}`,
      number,
      quarter,
      system: sysId,
      systemName: name,
      at,
      directorate,
      hegemony,
      ebon,
      protectedName: CONDUCTORS[Math.floor(roll(key, 60 + i) * CONDUCTORS.length)],
      correction,
      joint,
    });
    number++;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** This quarter's Schedule (empty when not visible). */
export function currentSchedule(w: WorldState, reach: ReachInfo): Engagement[] {
  return scheduleVisible(w) ? scheduleFor(w, reach, quarterOf(w.clock)) : [];
}

export function engagementStatus(w: WorldState, e: Engagement): EngagementStatus {
  if (fact(w, `schedule.broken.${e.id}`)) return 'broken';
  if (fact(w, `schedule.flown.${e.id}`)) return 'flown';
  if (w.clock > e.at + WINDOW) return 'fought';
  if (w.clock >= e.at - WINDOW) return 'open';
  return 'upcoming';
}

/** Can the pilot still take this one as ordered? */
export function takeable(w: WorldState, e: Engagement): boolean {
  const s = engagementStatus(w, e);
  return s === 'upcoming' || s === 'open';
}

// ── Outcomes ───────────────────────────────────────────────────────────

/** The Ebon each scheduled loss releases: a dip the floor catches. */
function release(w: WorldState, e: Engagement): WorldState {
  let n = nudge(w, 'system:*', 'price:ebon', -Math.min(0.06, e.ebon / 8000), 0.04, 0.5);
  n = nudge(n, sysScope(e.system), 'price:munitions', 0.08, 0.05, 0.5);
  return nudge(n, sysScope(e.system), 'traffic', -0.2, 0.15);
}

/** Fought without the pilot, as scheduled. */
export function foughtAsScheduled(w: WorldState, e: Engagement): WorldState {
  return record(release(w, e), 'schedule.fought', sysScope(e.system), { id: e.id, n: e.number, sys: e.system, dir: e.directorate, heg: e.hegemony, ebon: e.ebon });
}

/** Flown as ordered: the numbers came out right. Continuity approves. */
export function flyAsOrdered(w: WorldState, e: Engagement): WorldState {
  if (fact(w, `schedule.flown.${e.id}`) || fact(w, `schedule.broken.${e.id}`)) return w;
  let n = setFact(release(w, e), `schedule.flown.${e.id}`);
  n = nudge(n, 'guild:continuity', 'attitude', 0.08, 0.004, 1);
  n = bump(n, 'schedule.flown');
  return record(n, 'schedule.flown', sysScope(e.system), { id: e.id, n: e.number, sys: e.system });
}

/**
 * Made decisive. The market that priced the war in advance panics, the
 * Office of Continuity turns hostile, and next quarter owes a correction.
 */
export function breakEngagement(w: WorldState, e: Engagement, how: 'protected' | 'refused'): WorldState {
  if (fact(w, `schedule.broken.${e.id}`)) return w;
  let n = setFact(w, `schedule.broken.${e.id}`, how);
  n = setFact(n, 'continuity.hostile');
  // The price of a war nobody scheduled.
  n = nudge(n, 'system:*', 'price:ebon', 0.25, 0.04, 1.5);
  n = nudge(n, 'system:*', 'price:munitions', 0.1, 0.04, 1);
  n = nudge(n, sysScope(e.system), 'price:munitions', 0.15, 0.05, 1);
  n = nudge(n, sysScope(e.system), 'piracy', 0.08, 0.03, 0.5);
  // The auditors remember; so does the Treasury.
  n = nudge(n, 'guild:continuity', 'attitude', -0.5, 0.004, 1);
  n = nudge(n, 'faction:concord', 'attitude', -0.1, 0.01, 1);
  n = nudge(n, 'faction:choir', 'attitude', -0.15, 0.01, 1);
  n = nudge(n, 'faction:rustwake', 'attitude', 0.08, 0.01, 1);
  n = bump(n, 'schedule.broken');
  // The next Schedule changes: a correction at the same field, the 13th by name.
  const q = e.quarter + 1;
  n = bump(n, `schedule.corrections.q${q}`);
  n = setFact(n, `schedule.correction.q${q}`, e.system);
  return record(n, 'schedule.broken', sysScope(e.system), { id: e.id, n: e.number, sys: e.system, how });
}

/**
 * Engagements whose window closed between two clocks, fought as scheduled
 * (stepWorld calls this every frame of free flight).
 */
export function resolveSchedule(w: WorldState, from: number, to: number, reach: ReachInfo): WorldState {
  if (!fact(w, 'story.ep1.done') && !fact(w, 'schedule.known')) return w; // before the career has a story, the war is off-screen
  if (fact(w, 'schedule.read')) return w;
  let n = w;
  for (let q = quarterOf(from - WINDOW); q <= quarterOf(to); q++)
    for (const e of scheduleFor(n, reach, q)) {
      const end = e.at + WINDOW;
      if (end > from && end <= to && !fact(n, `schedule.flown.${e.id}`) && !fact(n, `schedule.broken.${e.id}`)) n = foughtAsScheduled(n, e);
    }
  return n;
}

// ── The contract ───────────────────────────────────────────────────────

/** Office of Continuity pays in shares: a base plus a share per scheduled loss. */
export function scheduleFee(e: Engagement): number {
  return Math.round((700 + 110 * (e.directorate + e.hegemony) + (e.correction ? 900 : 0)) / 50) * 50;
}

/** Choir fighters the op spawns and the quota the Schedule expects the Measure to expend. */
export function measureOf(e: Engagement): { measure: number; quota: number } {
  const measure = Math.max(3, Math.min(6, Math.ceil(e.hegemony * 0.6)));
  return { measure, quota: Math.max(2, Math.min(measure - 1, Math.round(measure * 0.5))) };
}

function nearestConcord(reach: ReachMap, from: string): { id: string; name: string; system: string } {
  const h = hops(reach, from);
  let best: { id: string; name: string; system: string } | null = null;
  let bd = Infinity;
  for (const s of reach.systems) {
    const d = h.get(s.id);
    if (d === undefined || d >= bd) continue;
    const st = s.stations.find((x) => x.faction === 'concord');
    if (st) {
      bd = d;
      best = { id: st.id, name: st.name, system: s.id };
    }
  }
  return best ?? { id: 'meridian-orbital-0', name: 'Meridian', system: 'meridian' };
}

function battlePoint(s: ReachSystem, e: Engagement): V3 {
  const g = s.gates[Math.floor(roll(e.id, 1) * s.gates.length)] ?? { pos: [0, 0, 0] as V3, normal: [0, 0, 1] as V3 };
  const d = 7000 + roll(e.id, 2) * 3000;
  return [Math.round(g.pos[0] - g.normal[0] * d + roll(e.id, 3) * 1500), Math.round(g.pos[1] + 400), Math.round(g.pos[2] - g.normal[2] * d + roll(e.id, 4) * 1500)];
}

/**
 * The engagement as a contract on the pilot's book (kind `sortie`, with
 * `schedule` set): the op is built by contracts/ops.ts, paid at the nearest
 * Directorate berth by the Office of Continuity.
 */
export function scheduleContract(e: Engagement, reach: ReachMap, bookClock: number, worldClock: number): Contract | null {
  const sys = reach.systems.find((s) => s.id === e.system);
  if (!sys) return null;
  const pay = nearestConcord(reach, e.system);
  const { measure, quota } = measureOf(e);
  const left = Math.max(120, e.at + WINDOW - worldClock);
  const reward = scheduleFee(e);
  return {
    id: `schedule:${e.id}`,
    kind: 'sortie',
    tier: 2,
    client: 'pell',
    faction: 'concord',
    title: `Engagement ${e.number} · ${e.systemName}`,
    brief:
      `ORDERS OF THE BOARD OF ALLOCATION. Engagement ${e.number}, ${e.systemName}. Expected expenditure: ${e.directorate} Directorate, ${e.hegemony} Hegemony. ` +
      `Ebon release ${e.ebon} g at the floor of ${FLOOR} sh. Hold the line, let the Measure expend ${quota}, withdraw on order. ` +
      `The ${e.protectedName} is not to be engaged. No engagement shall be decisive.`,
    origin: pay.id,
    originName: pay.name,
    originSystem: pay.system,
    payAt: pay.id,
    payAtName: pay.name,
    payAtSystem: pay.system,
    op: {
      system: e.system,
      center: battlePoint(sys, e),
      hostiles: measure,
      waves: 1,
      enemy: { blueprint: 'choir-cantor', faction: 'choir', name: 'Measure Cantor' },
      seed: e.number,
    },
    reward,
    rep: 3,
    enemy: { faction: 'choir', rep: -2 },
    penalty: 0,
    repPenalty: 0,
    duration: left,
    expires: bookClock + left,
    jumps: Math.max(0, hops(reach, pay.system).get(e.system) ?? 0),
    state: 'offered',
    schedule: { id: e.id, number: e.number, quota, protectedName: e.protectedName, correction: e.correction },
  };
}

/** The engagement a schedule contract refers to (by id), from the quarter it was posted in. */
export function engagementById(w: WorldState, reach: ReachInfo, id: string): Engagement | null {
  const num = Number(id.replace(/^E/, ''));
  if (!Number.isFinite(num)) return null;
  const q = Math.max(0, Math.floor((num - 115) / 6));
  for (const qq of [q, q - 1, q + 1]) {
    if (qq < 0) continue;
    const e = scheduleFor(w, reach, qq).find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

/** Findable for tests / tooling. */
export { findStation };
