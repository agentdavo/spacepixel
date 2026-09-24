/**
 * One step of the Reach: decay, background news, the Schedule's hours, the
 * Signal's bursts. Pure (tests/world-sim.test.ts); the runtime
 * (src/game/world/live.ts) calls it every frame of free flight.
 */
import { tick, record, type WorldEvent, type WorldState } from './WorldState.ts';
import { backgroundEvent, NEWS_PERIOD, since, type ReachInfo } from './sim.ts';
import { resolveSchedule } from './schedule.ts';
import { burstLine, signalState } from './signal.ts';

export interface StepResult {
  w: WorldState;
  /** Events recorded this step (background news, Schedule, Signal bursts). */
  events: WorldEvent[];
}

/**
 * Advance the world by `dt` seconds of free flight: modifiers decay, every
 * background slot that elapsed rolls an event (a long catch-up rolls at most
 * eight), Schedule engagements whose window closed are fought as scheduled,
 * and a changed Signal count records a burst.
 */
export function stepWorld(w: WorldState, dt: number, reach: ReachInfo): StepResult {
  if (!(dt > 0)) return { w, events: [] };
  const from = w.clock;
  const sigBefore = signalState(w).count;
  let n = tick(w, dt);
  const to = n.clock;
  const s0 = Math.floor(from / NEWS_PERIOD);
  const s1 = Math.floor(to / NEWS_PERIOD);
  for (let s = Math.max(s0 + 1, s1 - 7); s <= s1; s++) n = backgroundEvent(n, reach, s);
  n = resolveSchedule(n, from, to, reach);
  const sig = signalState(n);
  if (sig.count !== null && sigBefore !== null && sig.count !== sigBefore) n = record(n, 'signal.burst', 'system:null', { count: sig.count, line: burstLine(sig.count, sig) });
  return { w: n, events: since(w, n) };
}
