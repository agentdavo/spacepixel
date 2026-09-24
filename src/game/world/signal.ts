/**
 * The Signal: the Monolith counting down the primes (docs/LORE.md, "The
 * Signal, the Builders and the Breath"; docs/CAMPAIGN.md, "The Signal clock").
 *
 * The count is a pure function of the world: the last story episode
 * completed pins it to that episode's debrief count (the CAMPAIGN.md table),
 * and free-flight time between episodes ticks it down one prime per
 * BURST_PERIOD of world clock — but never down to (or past) the next
 * episode's count, which the story owns. Before Episode 5 the player has not
 * heard it (null). After Episode 19 it stops at 2; after Episode 20 it counts
 * up.
 *
 * Pure (no DOM, no three, no Math.random): tests/world-sim.test.ts.
 */
import { counter, fact, type WorldState } from './WorldState.ts';

/** In lore one burst every 25 h 51 min; in free flight one per 15 minutes of world clock. */
export const BURST_PERIOD = 900;
/** The real interval, for the Breath countdown after Episode 13. */
export const BURST_HOURS = 25 + 51 / 60;

/** Debrief count per episode (docs/CAMPAIGN.md). Episode 16's pilgrimage races 97 → 5. */
export const SIGNAL_ANCHORS: Readonly<Record<number, number>> = {
  5: 1009,
  6: 983,
  7: 971,
  8: 947,
  9: 911,
  10: 887,
  11: 409,
  12: 293,
  13: 241,
  14: 157,
  15: 97,
  16: 5,
  17: 5,
  18: 3,
  19: 2,
};

/** Counts the HUD and the news treat as omens (first burst below each). */
export const OMENS: readonly number[] = [997, 499, 293, 241, 199, 101, 97, 53, 13, 7, 5, 3, 2];

const PRIMES: number[] = (() => {
  const out: number[] = [];
  const sieve = new Uint8Array(2100);
  for (let i = 2; i < sieve.length; i++) {
    if (sieve[i]) continue;
    out.push(i);
    for (let j = i * i; j < sieve.length; j += i) sieve[j] = 1;
  }
  return out;
})();

export function isPrime(n: number): boolean {
  return PRIMES.includes(n);
}

/** The prime `steps` places below `p` (p itself when steps = 0). */
export function primeBelow(p: number, steps: number): number {
  const i = PRIMES.indexOf(p);
  if (i < 0) throw new Error(`${p} is not a prime the Signal counts`);
  return PRIMES[Math.max(0, i - steps)];
}

/** Primes from 2 up to and including p (π(p)). */
export function primeIndex(p: number): number {
  return PRIMES.filter((x) => x <= p).length;
}

/** Highest story episode completed (0 = none). Facts `story.ep<N>.done`. */
export function lastEpisode(w: WorldState): number {
  let n = 0;
  for (let e = 1; e <= 20; e++) if (fact(w, `story.ep${e}.done`)) n = e;
  return n;
}

export interface SignalState {
  /** Pulses in the last burst (null before Episode 5: nobody has heard it). */
  count: number | null;
  /** Counting down (the Breath coming), stopped (Ep 19) or counting up (Ep 20). */
  mode: 'hidden' | 'down' | 'stopped' | 'up';
  /** Episode 12: the source is known. */
  source: 'null' | 'monolith';
  /** Episode 13: days to the Breath at the true burst rate (null until known / after it came). */
  breathDays: number | null;
  /** World seconds to the next burst (null when the count is held by the story). */
  nextIn: number | null;
}

/** The Signal as the world stands. */
export function signalState(w: WorldState): SignalState {
  const ep = lastEpisode(w);
  const source = ep >= 12 ? 'monolith' : 'null';
  if (ep < 5) return { count: null, mode: 'hidden', source, breathDays: null, nextIn: null };
  const since = Math.max(0, w.clock - counter(w, 'signal.anchor'));
  const bursts = Math.floor(since / BURST_PERIOD);
  const nextIn = BURST_PERIOD - (since % BURST_PERIOD);
  if (ep >= 20) {
    // "NULL COUNT: 2. NULL COUNT: 3." — counting up from 2.
    const i = Math.min(PRIMES.length - 1, bursts);
    return { count: PRIMES[i], mode: 'up', source, breathDays: null, nextIn };
  }
  if (ep === 19) return { count: 2, mode: 'stopped', source, breathDays: null, nextIn: null };
  const start = SIGNAL_ANCHORS[ep];
  const floor = SIGNAL_ANCHORS[ep + 1] ?? 2;
  // Free flight ticks the count down, but the next episode's debrief owns its number.
  const maxSteps = Math.max(0, primeIndex(start) - primeIndex(floor) - 1);
  const steps = Math.min(bursts, maxSteps);
  const count = primeBelow(start, steps);
  const held = steps >= maxSteps;
  const breathDays = ep >= 13 ? Math.round(((primeIndex(count) - 1) * BURST_HOURS) / 24) : null;
  return { count, mode: 'down', source, breathDays, nextIn: held ? null : nextIn };
}

/** "1,009" */
export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** The intercept line for a burst (radio / news). */
export function burstLine(count: number, s: Pick<SignalState, 'source' | 'breathDays' | 'mode'>): string {
  const from = s.source === 'monolith' ? 'MONOLITH' : 'NULL PICKET';
  if (s.mode === 'up') return `${from} INTERCEPT · ${fmtCount(count)} PULSES. IT IS COUNTING UP.`;
  if (count === 997) return `${from} INTERCEPT · 997 PULSES. THREE DIGITS NOW.`;
  if (count === 499) return `${from} INTERCEPT · 499 PULSES. HALFWAY FROM WHERE IT STARTED.`;
  if (count === 101) return `${from} INTERCEPT · 101 PULSES. THE PICKETS HAVE STOPPED JOKING ABOUT IT.`;
  if (count < 100 && s.breathDays !== null) return `${from} INTERCEPT · ${count} PULSES. BREATH IN ${s.breathDays} DAYS.`;
  if (s.breathDays !== null) return `${from} INTERCEPT · ${fmtCount(count)} PULSES · BREATH IN ${s.breathDays} DAYS`;
  return `${from} INTERCEPT · ${fmtCount(count)} PULSES. EACH ONE PRIME. EACH ONE THE NEXT DOWN.`;
}
