/**
 * A guild's quartermaster: its relic-grade Mk V stock (outfitting/items.ts
 * GUILD_ITEMS), rank-locked and discounted by rank, fitted straight onto the
 * active ship's first matching slot.
 *
 * Pure: runs under node --test.
 */
import { GUILD_ITEMS, type Item } from '../outfitting/items.ts';
import { fits, slotsFor, type Slot } from '../outfitting/fit.ts';
import { activeShip, buyItem, entryOf, type Hangar, type ShopResult, type StationLike } from '../outfitting/hangar.ts';
import type { TradeLedger } from '../economy';
import { discount } from './membership.ts';
import { GUILDS, type GuildId } from './guilds.ts';

export interface StockLine {
  item: Item;
  price: number;
  /** Why it can't be bought now (rank), or null. */
  lock: string | null;
  /** The active ship's slot it would go into (null = nothing fits). */
  slot: Slot | null;
  fitted: boolean;
}

export function stockOf(g: GuildId): Item[] {
  return GUILD_ITEMS.filter((i) => i.guild?.id === g).sort((a, b) => (a.guild!.rank - b.guild!.rank) || a.price - b.price);
}

export function qmPrice(it: Item, rank: number): number {
  return Math.round((it.price * (1 - discount(rank))) / 10) * 10;
}

/** The first slot on the active ship this item fits (the class must match for utility items). */
export function slotFor(h: Hangar, it: Item): Slot | null {
  const e = entryOf(activeShip(h));
  return slotsFor(e).find((s) => fits(it, s)) ?? null;
}

/**
 * What the quartermaster shows this pilot: every guild item for the active
 * ship's classes (one line per family that fits; other classes hidden).
 */
export function stockFor(g: GuildId, rank: number, h: Hangar): StockLine[] {
  const ship = activeShip(h);
  const out: StockLine[] = [];
  for (const it of stockOf(g)) {
    const slot = slotFor(h, it);
    if (!slot && 'cls' in it) continue; // another class of utility item: not for this hull
    const need = it.guild!.rank;
    out.push({
      item: it,
      price: qmPrice(it, rank),
      lock: rank < need ? `RANK ${need} · ${GUILDS[g].ranks[need - 1].name.toUpperCase()}` : null,
      slot,
      fitted: !!slot && ship.fit[slot.id] === it.id,
    });
  }
  return out;
}

/** Buy and fit (the old item sells back at half price, as at any yard). */
export function buyFromQuartermaster(h: Hangar, l: TradeLedger, g: GuildId, rank: number, itemId: string, st: StationLike): ShopResult {
  const it = stockOf(g).find((i) => i.id === itemId);
  if (!it) return { hangar: h, ledger: l, error: 'NOT IN THIS QUARTERMASTER’S STOCK' };
  if (rank < it.guild!.rank) return { hangar: h, ledger: l, error: `RANK ${it.guild!.rank} NEEDED` };
  const slot = slotFor(h, it);
  if (!slot) return { hangar: h, ledger: l, error: 'NOTHING ON THIS HULL TAKES IT' };
  return buyItem(h, l, h.active, slot.id, it.id, st, { price: qmPrice(it, rank) });
}
