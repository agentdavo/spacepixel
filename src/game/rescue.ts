/**
 * Free-flight death: what the salvage tow costs (pure; tests/rescue.test.ts).
 *
 * Nobody dies for good in the free Reach — a salvage tug finds airframe 0413
 * and tows it to the last berth — but it is not free:
 *
 *   insurance   the Board's salvage underwriters bill a fee in shares:
 *               base + a slice of what you hold, capped, never more than you have
 *   cargo       the pod was jettisoned or looted: every loose unit is gone.
 *               Contract consignments travel under seal and survive (their
 *               contracts still stand).
 *   hull        you come back at TOW_HULL, patched enough to sit on a berth
 */
import type { CommodityId, EconFaction, TradeLedger } from './economy';

export const TOW_HULL = 0.35;
export const INSURANCE_BASE = 250;
export const INSURANCE_SHARE = 0.06;
export const INSURANCE_CAP = 1800;

export interface RescueTerms {
  fee: number;
  /** Units lost, per commodity (sealed consignments excluded). */
  lost: { id: CommodityId; units: number }[];
  ledger: TradeLedger;
}

/** Insurance fee for a pilot holding `credits` (before the "never more than you have" clamp). */
export function insuranceFee(credits: number): number {
  return Math.min(INSURANCE_CAP, Math.round((INSURANCE_BASE + Math.max(0, credits) * INSURANCE_SHARE) / 10) * 10);
}

/**
 * Apply the tow to a ledger. `sealed` = units of each commodity held under
 * contract (haul consignments), which survive.
 */
export function rescueTerms(ledger: TradeLedger, sealed: Partial<Record<CommodityId, number>> = {}): RescueTerms {
  const fee = Math.min(ledger.credits, insuranceFee(ledger.credits));
  const cargo: TradeLedger['cargo'] = {};
  const lost: RescueTerms['lost'] = [];
  for (const [id, n] of Object.entries(ledger.cargo) as [CommodityId, number][]) {
    const keep = Math.min(n, sealed[id] ?? 0);
    if (keep > 0) cargo[id] = keep;
    if (n - keep > 0) lost.push({ id, units: n - keep });
  }
  return { fee, lost, ledger: { ...ledger, credits: ledger.credits - fee, cargo, rep: { ...ledger.rep } } };
}

/** Who comes for you, by the faction of the space you went down in. */
export function tugFor(faction: EconFaction | string): { name: string; outfit: string } {
  switch (faction) {
    case 'choir':
      return { name: 'TUG SEVENFOLD MERCY', outfit: 'Treasury salvage, under protest' };
    case 'rustwake':
      return { name: 'TUG FINDERS KEEPERS', outfit: 'Clan salvage — they kept the finder’s fee' };
    default:
      return { name: 'TUG PATIENT HANDS', outfit: 'Order of the Keeping, salvage chapter' };
  }
}
