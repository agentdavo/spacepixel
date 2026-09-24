/**
 * World scenarios for the balance sim (`npm run econ-sim`, tests): install a
 * WorldState's readers on the economy and the lanes, measure, uninstall.
 * The default Reach (no world installed) is what the bands assert; these
 * show how far the story and the pilot move it.
 */
import { COMMODITIES, midPrice, newLedger, setMarketWorld, type CommodityId } from '../economy.ts';
import { setTrafficWorld } from '../../universe/traffic.ts';
import { summarise, type EconSummary, type SimMarket } from '../econSim.ts';
import type { WorldState } from './WorldState.ts';
import { attitude, patrolOffset, piracyOffset, priceOffset, trafficOffset } from './sim.ts';

/** Put a world's readers on the economy and the lanes (`sysOf`: station → system). */
export function installWorld(w: WorldState, sysOf: (stationId: string) => string): void {
  setMarketWorld({ price: (spec, cid) => priceOffset(w, sysOf(spec.id), spec.id, cid, spec.kind), attitude: (spec) => attitude(w, spec, sysOf(spec.id)) });
  setTrafficWorld({ volume: (id) => trafficOffset(w, id), piracy: (id) => piracyOffset(w, id), patrol: (id) => patrolOffset(w, id) });
}
export function clearWorld(): void {
  setMarketWorld(null);
  setTrafficWorld(null);
}

/** Run `fn` with a world installed (always uninstalls). */
export function withWorld<T>(w: WorldState, sysOf: (stationId: string) => string, fn: () => T): T {
  installWorld(w, sysOf);
  try {
    return fn();
  } finally {
    clearWorld();
  }
}

/** Mean mid price of `cid` over the markets of `kind` that trade it (clock 600, fresh ledger). */
export function meanMid(markets: readonly SimMarket[], cid: CommodityId, kind?: string): number {
  const l = { ...newLedger(), clock: 600, pressure: {} };
  const xs = markets.filter((m) => !kind || m.kind === kind).map((m) => midPrice(m, cid, l)).filter((x) => Number.isFinite(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export interface EconShift {
  before: EconSummary;
  after: EconSummary;
  /** Mean refinery Ebon mid, default vs world. */
  ebon: [number, number];
  /** Share of the world's best safe holds (per scan) that carry any Ebon. */
  ebonInSafe: number;
  /** Mean mid per commodity, default vs world. */
  mids: Record<CommodityId, [number, number]>;
}

/** The whole economy under a world vs the default Reach. */
export function econShift(w: WorldState, markets: readonly SimMarket[], hops: (a: string, b: string) => number, samples = 12): EconShift {
  const sysOf = (id: string) => markets.find((m) => m.id === id)?.system ?? '';
  const before = summarise(markets, hops, samples, 2);
  const mids0 = Object.fromEntries(COMMODITIES.map((c) => [c.id, meanMid(markets, c.id)])) as Record<CommodityId, number>;
  const e0 = meanMid(markets, 'ebon', 'refinery');
  return withWorld(w, sysOf, () => {
    const after = summarise(markets, hops, samples, 2);
    const e1 = meanMid(markets, 'ebon', 'refinery');
    const withEbon = after.scans.filter((s) => (s.bestSafe?.mix.ebon ?? 0) > 0).length;
    const mids = Object.fromEntries(COMMODITIES.map((c) => [c.id, [mids0[c.id], meanMid(markets, c.id)]])) as Record<CommodityId, [number, number]>;
    return { before, after, ebon: [e0, e1] as [number, number], ebonInSafe: withEbon / Math.max(1, after.scans.length), mids };
  });
}

/** Post-game pass/fail: Ebon collapses and leaves the trade; the Reach still pays a living. */
export const POSTGAME = {
  /** Refinery Ebon falls at least this far. */
  ebonDrop: 0.6,
  /** At most this share of best safe holds still carry Ebon. */
  ebonInSafe: 0.1,
  /** A safe hold still earns this (median). */
  safeMedianMin: 900,
};
