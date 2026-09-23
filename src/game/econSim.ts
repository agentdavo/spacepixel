import { COMMODITIES, buy, newLedger, quote, sell, type CommodityId, type MarketSpec, type TradeLedger } from './economy.ts';

/**
 * Trade-route analysis for balancing (`npm run econ-sim`, tests/econ-sim.test.ts).
 * Pure: markets in, numbers out.
 *
 * A "run" is one full hold bought at A and sold at B. The buyer is a savvy
 * player: each unit is whichever commodity has the best marginal margin
 * right now, so a mixed hold dodges the market pressure a single-commodity
 * hold would pile up. Standing is held fixed across the run (trade raises
 * it, which would narrow the spread mid-hold).
 */
export interface SimMarket extends MarketSpec {
  name: string;
  system: string;
}

export interface HoldResult {
  from: SimMarket;
  to: SimMarket;
  profit: number;
  /** Shares tied up in the hold (what it takes to fly this run). */
  outlay: number;
  units: number;
  mix: Partial<Record<CommodityId, number>>;
  /** max(risk of either end). */
  risk: number;
}

/** Best mixed hold from `a` to `b`, `capacity` units, `credits` to spend (default: unlimited). */
export function bestHold(a: SimMarket, b: SimMarket, base: TradeLedger, capacity = base.capacity, credits = Infinity): HoldResult {
  const rep = { ...base.rep };
  let l: TradeLedger = { ...base, cargo: {}, capacity: 1e9, credits: 1e12, rep: { ...rep } };
  const start = l.credits;
  let outlay = 0;
  let units = 0;
  const mix: HoldResult['mix'] = {};
  for (let i = 0; i < capacity; i++) {
    let best: CommodityId | null = null;
    let bestM = 0;
    let bestAsk = 0;
    for (const c of COMMODITIES) {
      const qa = quote(a, c.id, l);
      const qb = quote(b, c.id, l);
      if (!qa || !qb) continue;
      if (outlay + qa.buy > credits) continue;
      const m = qb.sell - qa.buy;
      if (m > bestM) {
        bestM = m;
        best = c.id;
        bestAsk = qa.buy;
      }
    }
    if (!best) break;
    l = buy(l, a, best, 1).ledger;
    l = sell(l, b, best, 1).ledger;
    l.rep = { ...rep };
    outlay += bestAsk;
    units++;
    mix[best] = (mix[best] ?? 0) + 1;
  }
  return { from: a, to: b, profit: l.credits - start, outlay, units, mix, risk: Math.max(a.risk ?? 0, b.risk ?? 0) };
}

export interface RouteScan {
  clock: number;
  best: HoldResult | null;
  bestSafe: HoldResult | null;
  bestRisky: HoldResult | null;
  /** Best run a fresh pilot (starting purse) can afford, safe routes only. */
  bestStarter: HoldResult | null;
}

/** Stations up to this risk count as "safe" (home space, quiet Rustwake lanes). */
export const SAFE_RISK = 0.35;

/**
 * Scan every ordered pair of markets whose systems are within `maxHops`
 * lanes (hops(a, b) returns Infinity when unreachable) at play-clock `clock`.
 */
export function scanRoutes(markets: readonly SimMarket[], hops: (a: string, b: string) => number, clock: number, maxHops = 2, ledger: TradeLedger = newLedger()): RouteScan {
  const l = { ...ledger, clock, pressure: {} };
  const starterCredits = newLedger().credits;
  const out: RouteScan = { clock, best: null, bestSafe: null, bestRisky: null, bestStarter: null };
  for (const a of markets)
    for (const b of markets) {
      if (a.id === b.id || hops(a.system, b.system) > maxHops) continue;
      const r = bestHold(a, b, l);
      if (r.units === 0) continue;
      if (!out.best || r.profit > out.best.profit) out.best = r;
      if (r.risk <= SAFE_RISK) {
        if (!out.bestSafe || r.profit > out.bestSafe.profit) out.bestSafe = r;
        const s = bestHold(a, b, l, l.capacity, starterCredits);
        if (s.units && (!out.bestStarter || s.profit > out.bestStarter.profit)) out.bestStarter = s;
      } else if (!out.bestRisky || r.profit > out.bestRisky.profit) out.bestRisky = r;
    }
  return out;
}

export interface EconSummary {
  scans: RouteScan[];
  safe: { median: number; max: number };
  risky: { median: number; max: number };
  starter: { median: number };
}

const med = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Scan at `samples` clock points over ~4 h of play (drift periods are 7–80 min). */
export function summarise(markets: readonly SimMarket[], hops: (a: string, b: string) => number, samples = 12, maxHops = 2): EconSummary {
  const scans: RouteScan[] = [];
  for (let i = 0; i < samples; i++) scans.push(scanRoutes(markets, hops, 600 + i * 1270, maxHops));
  const safe = scans.map((s) => s.bestSafe?.profit ?? 0);
  const risky = scans.map((s) => s.bestRisky?.profit ?? 0);
  return {
    scans,
    safe: { median: med(safe), max: Math.max(...safe) },
    risky: { median: med(risky), max: Math.max(...risky) },
    starter: { median: med(scans.map((s) => s.bestStarter?.profit ?? 0)) },
  };
}

/** Balance bands the sim asserts (shares per 16-unit hold). */
export const BANDS = {
  safeMedian: [1500, 4000] as const,
  safeMax: 5000,
  riskyMax: 9000,
  /** A fresh pilot's first run (2,500 sh purse) must still make something. */
  starterMin: 300,
};
