/**
 * Salvaging wrecks the fighting leaves behind (src/sim/Destruction.ts).
 *
 * Fly within SALVAGE_RANGE of a wreck piece's plating, match its drift
 * (relative speed under SALVAGE_SPEED) and hold: the cutting crews work the
 * breaks for a time that grows with the lot. When it's done the lot goes
 * into the hold — fossil relics first (they're worth the most), then sealed
 * reactor cores, then machine spares — as far as the cargo pod has room. What
 * doesn't fit stays aboard the wreck for a second pass.
 *
 * What a wreck yields depends on how she died: a struck hull (bridge kill)
 * is intact and aboard everything is still there; a snapped spine leaves two
 * halves worth cutting; a reactor detonation leaves almost nothing.
 *
 * Pure (type imports only): tested under node (tests/destruction.test.ts).
 */
import type { CommodityId, TradeLedger } from './economy.ts';
import type { SalvageYield } from '../sim/Destruction.ts';

export const SALVAGE_RANGE = 450;
export const SALVAGE_SPEED = 35;
/** Seconds of cutting per lot (relic, core or spare crate) on the piece. */
export const SALVAGE_SECONDS_PER_LOT = 1.5;
const ORDER: (keyof SalvageYield)[] = ['relics', 'cores', 'spares'];

export function lots(y: SalvageYield): number {
  return y.relics + y.cores + y.spares;
}

/** Progress per second at this distance (m from the plating) and relative speed (m/s): 0 = out of reach. */
export function salvageRate(y: SalvageYield, dist: number, relSpeed: number): number {
  const n = lots(y);
  if (n <= 0 || dist > SALVAGE_RANGE || relSpeed > SALVAGE_SPEED) return 0;
  return 1 / Math.max(3, n * SALVAGE_SECONDS_PER_LOT);
}

/** Work a piece for `dt`: returns true on the tick the cutting finishes. */
export function stepSalvage(w: { salvaged: number; taken: boolean; salvage: SalvageYield }, rate: number, dt: number): boolean {
  if (w.taken || rate <= 0) return false;
  w.salvaged = Math.min(1, w.salvaged + rate * dt);
  return w.salvaged >= 1;
}

/**
 * Move a finished lot into the hold: relics, then cores, then spares, as far
 * as capacity allows. Returns the new ledger, what was taken and what is left
 * on the wreck.
 */
export function claimSalvage(l: TradeLedger, y: SalvageYield): { ledger: TradeLedger; got: Partial<Record<CommodityId, number>>; left: SalvageYield } {
  let used = 0;
  for (const v of Object.values(l.cargo)) used += v ?? 0;
  let room = Math.max(0, l.capacity - used);
  const cargo = { ...l.cargo };
  const got: Partial<Record<CommodityId, number>> = {};
  const left: SalvageYield = { ...y };
  for (const k of ORDER) {
    const n = Math.min(room, left[k]);
    if (n <= 0) continue;
    cargo[k] = (cargo[k] ?? 0) + n;
    got[k] = n;
    left[k] -= n;
    room -= n;
  }
  return { ledger: { ...l, cargo }, got, left };
}
