import type { FactionId } from '@/assets/Blueprint';
import { CATALOG, CATALOG_BY_ID, tradeIn, type CatalogEntry } from '../shipyard/catalog.ts';
import { cargoUsed, serviceMarkup, type StationKind, type TradeLedger } from '../economy.ts';
import { ITEMS, MAKERS, item, itemLabel, type Item } from './items.ts';
import { computeFit, fits, normaliseFit, sameFit, slotsFor, stockFit, type Fit, type Slot } from './fit.ts';

/**
 * The pilot's hangar: owned hulls, each with a fit, and the active one.
 * Owned ships travel with you (the Directorate ferries them), so any
 * shipyard can switch you between them. Pure shop logic over (hangar,
 * ledger) pairs, like economy.ts: every operation returns new objects and
 * an error string instead of throwing.
 */

export interface OwnedShip {
  /** Stable id within the hangar. */
  uid: string;
  /** Catalogue / blueprint id. */
  hull: string;
  fit: Fit;
  /** Hull condition 0..1 (the active ship's lives in the flight scene until it is stored). */
  condition: number;
}

export interface Hangar {
  v: 1;
  active: string;
  ships: OwnedShip[];
  seq: number;
}

export const MAX_OWNED = 6;
/** Items sell back at half price. */
export const RESALE = 0.5;

export function newHangar(): Hangar {
  const k = CATALOG_BY_ID['vf27-kestrel'];
  return { v: 1, active: 's1', seq: 1, ships: [{ uid: 's1', hull: k.id, fit: stockFit(k), condition: 1 }] };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Repair a hangar loaded from storage: unknown hulls dropped, fits normalised, an active ship guaranteed. */
export function normaliseHangar(raw: unknown): Hangar {
  if (!raw || typeof raw !== 'object') return newHangar();
  const r = raw as Partial<Hangar>;
  const ships: OwnedShip[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(r.ships) ? r.ships : []) {
    const e = s && typeof s === 'object' ? CATALOG_BY_ID[(s as OwnedShip).hull] : undefined;
    if (!e || !e.flyable) continue;
    let uid = typeof s.uid === 'string' && s.uid ? s.uid : `s${ships.length + 1}`;
    while (seen.has(uid)) uid += 'x';
    seen.add(uid);
    ships.push({ uid, hull: e.id, fit: normaliseFit(e, s.fit), condition: Math.max(0.05, Math.min(1, num(s.condition, 1))) });
    if (ships.length >= MAX_OWNED) break;
  }
  if (!ships.length) return newHangar();
  const active = ships.some((s) => s.uid === r.active) ? (r.active as string) : ships[0].uid;
  return { v: 1, active, seq: Math.max(ships.length, Math.floor(num(r.seq, ships.length))), ships };
}

export function activeShip(h: Hangar): OwnedShip {
  return h.ships.find((s) => s.uid === h.active) ?? h.ships[0];
}

export function entryOf(s: OwnedShip): CatalogEntry {
  return CATALOG_BY_ID[s.hull];
}

// ── what a station sells ─────────────────────────────────────────────

export interface StationLike {
  id: string;
  kind: StationKind;
  faction: FactionId;
}

/** Highest Mk a station stocks. */
export function maxMk(kind: StationKind): number {
  return kind === 'bastion' || kind === 'carrier' ? 4 : kind === 'refinery' ? 2 : 3;
}

/** Does this station's yard stock `it` (before standing)? */
export function stocks(st: StationLike, it: Item): boolean {
  const f = MAKERS[it.maker].faction;
  const top = maxMk(st.kind);
  // Carriers are fleet stores: weapons and point defence only.
  if (st.kind === 'carrier' && !(it.kind === 'gun' || it.kind === 'missile' || it.kind === 'turret' || (it.kind === 'bay' && it.role === 'pd'))) return false;
  if (f === st.faction) return it.mk <= top;
  // Free ports and breakers' yards trade in anything salvageable.
  if (st.kind === 'freeport') return f === 'rustwake' ? it.mk <= 3 : it.mk <= 2;
  if (st.kind === 'salvage') return f === 'rustwake' ? it.mk <= 3 : f === 'concord' && it.mk <= 1;
  return false;
}

export type Lock = null | { reason: string };

export function standingLock(it: { requires?: { faction: FactionId; standing: number } }, l: TradeLedger): Lock {
  const q = it.requires;
  if (!q) return null;
  return (l.rep[q.faction] ?? 0) >= q.standing ? null : { reason: `NEEDS ${q.faction === 'concord' ? 'DIRECTORATE' : q.faction === 'choir' ? 'HEGEMONY' : 'RUSTWAKE'} STANDING ${q.standing >= 0 ? '+' : ''}${q.standing}` };
}

/** Items for `slot` this station sells, cheapest first, with a lock reason where standing bars them. */
export function itemsAt(st: StationLike, slot: Slot, l: TradeLedger): { item: Item; price: number; lock: Lock }[] {
  return ITEMS.filter((i) => fits(i, slot) && stocks(st, i))
    .sort((a, b) => a.mk - b.mk || a.price - b.price)
    .map((i) => ({ item: i, price: itemPrice(i, st, l), lock: standingLock(i, l) }));
}

/** Station price of an item: the service markup follows standing. */
export function itemPrice(it: Item, st: StationLike, l: TradeLedger): number {
  return Math.round((it.price * serviceMarkup(l.rep[st.faction] ?? 0)) / 10) * 10;
}

/** Hulls this station's yard sells. */
export function hullsAt(st: StationLike): CatalogEntry[] {
  return CATALOG.filter((e) => {
    if (!e.purchasable) return false;
    if (e.faction === 'civil') return st.kind === 'orbital' || st.kind === 'freeport' || (st.kind === 'refinery' && e.tier <= 4);
    if (e.faction !== st.faction) return st.kind === 'freeport' && e.faction === 'rustwake';
    if (st.kind === 'carrier') return e.tier <= 3 && e.length < 40;
    if (st.kind === 'bastion') return true;
    if (st.kind === 'orbital') return e.tier <= 5;
    return e.tier <= 4;
  }).sort((a, b) => a.tier - b.tier || a.price - b.price);
}

// ── values ───────────────────────────────────────────────────────────

/** Resale value of the non-stock items in a fit. */
export function fitResale(e: CatalogEntry, fit: Fit): number {
  const stock = stockFit(e);
  let v = 0;
  for (const s of slotsFor(e)) {
    const id = fit[s.id];
    if (id && id !== stock[s.id]) v += (item(id)?.price ?? 0) * RESALE;
  }
  return Math.round(v);
}

/** What a yard pays for an owned ship: 60 % of the hull (less damage) + half its upgrades. */
export function shipValue(s: OwnedShip): number {
  const e = entryOf(s);
  return Math.round(tradeIn(e) * (0.6 + 0.4 * s.condition) + fitResale(e, s.fit));
}

// ── operations ───────────────────────────────────────────────────────

export interface ShopResult {
  hangar: Hangar;
  ledger: TradeLedger;
  error?: string;
  /** Log line on success. */
  message?: string;
}

const cloneLedger = (l: TradeLedger): TradeLedger => ({ ...l, cargo: { ...l.cargo }, rep: { ...l.rep }, pressure: l.pressure });
const cloneHangar = (h: Hangar): Hangar => ({ ...h, ships: h.ships.map((s) => ({ ...s, fit: { ...s.fit } })) });
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;

/** Cargo capacity the ledger should carry for the active ship. */
export function holdOf(s: OwnedShip): number {
  return computeFit(entryOf(s), s.fit).cargo;
}

/** Keep `ledger.capacity` in step with the active ship's hold. */
export function syncHold(h: Hangar, l: TradeLedger): TradeLedger {
  const cap = holdOf(activeShip(h));
  return l.capacity === cap ? l : { ...l, capacity: cap };
}

/**
 * Buy `itemId` into `slotId` of ship `uid` (the old item sells back at half
 * price). Checks stock, standing, shares and the power budget. A guild
 * quartermaster (`qm`) sells its own stock at its own price instead.
 */
export function buyItem(h: Hangar, l: TradeLedger, uid: string, slotId: string, itemId: string, st: StationLike, qm?: { price: number }): ShopResult {
  const ship = h.ships.find((s) => s.uid === uid);
  const it = item(itemId);
  if (!ship || !it) return { hangar: h, ledger: l, error: 'NO SUCH ITEM' };
  const e = entryOf(ship);
  const slot = slotsFor(e).find((s) => s.id === slotId);
  if (!slot || !fits(it, slot)) return { hangar: h, ledger: l, error: 'DOES NOT FIT THAT SLOT' };
  if (!qm && !stocks(st, it)) return { hangar: h, ledger: l, error: 'NOT STOCKED HERE' };
  const lock = qm ? null : standingLock(it, l);
  if (lock) return { hangar: h, ledger: l, error: lock.reason };
  if (ship.fit[slotId] === itemId) return { hangar: h, ledger: l, error: 'ALREADY FITTED' };
  const old = item(ship.fit[slotId]);
  const refund = old ? Math.round(old.price * RESALE) : 0;
  const price = qm ? qm.price : itemPrice(it, st, l);
  if (l.credits + refund < price) return { hangar: h, ledger: l, error: `INSUFFICIENT SHARES — ${sh(price - refund)} NEEDED` };
  const fit = { ...ship.fit, [slotId]: itemId };
  const r = computeFit(e, fit);
  if (r.power.draw > r.power.output + 1e-6) return { hangar: h, ledger: l, error: `POWER BUDGET EXCEEDED — ${r.power.draw} / ${r.power.output} MW. FIT A BETTER REACTOR` };
  if (uid === h.active && cargoUsed(l) > r.cargo) return { hangar: h, ledger: l, error: `HOLD TOO SMALL FOR YOUR CARGO (${cargoUsed(l)}/${r.cargo})` };
  const hangar = cloneHangar(h);
  hangar.ships.find((s) => s.uid === uid)!.fit = fit;
  let ledger = cloneLedger(l);
  ledger.credits = Math.max(0, ledger.credits + refund - price);
  if (uid === h.active) ledger = syncHold(hangar, ledger);
  return { hangar, ledger, message: `FITTED ${itemLabel(it)} — ${sh(price)}${old ? ` · ${itemLabel(old)} SOLD ${sh(refund)}` : ''}` };
}

/** Strip a slot (sells the item back at half price). Drives, reactors and plate can only be swapped. */
export function sellItem(h: Hangar, l: TradeLedger, uid: string, slotId: string): ShopResult {
  const ship = h.ships.find((s) => s.uid === uid);
  if (!ship) return { hangar: h, ledger: l, error: 'NO SUCH SHIP' };
  const e = entryOf(ship);
  const slot = slotsFor(e).find((s) => s.id === slotId);
  const old = item(ship.fit[slotId]);
  if (!slot || !old) return { hangar: h, ledger: l, error: 'SLOT IS EMPTY' };
  if (slot.required) return { hangar: h, ledger: l, error: `${slot.kind === 'engine' ? 'DRIVE' : slot.kind.toUpperCase()} CAN ONLY BE SWAPPED` };
  const fit = { ...ship.fit, [slotId]: null };
  const r = computeFit(e, fit);
  if (uid === h.active && cargoUsed(l) > r.cargo) return { hangar: h, ledger: l, error: `SELL CARGO FIRST (${cargoUsed(l)}/${r.cargo})` };
  const hangar = cloneHangar(h);
  hangar.ships.find((s) => s.uid === uid)!.fit = fit;
  let ledger = cloneLedger(l);
  const refund = Math.round(old.price * RESALE);
  ledger.credits += refund;
  if (uid === h.active) ledger = syncHold(hangar, ledger);
  return { hangar, ledger, message: `${itemLabel(old)} SOLD — ${sh(refund)}` };
}

/** Can the pilot buy this hull here? (null = yes) */
export function hullLock(e: CatalogEntry, st: StationLike, l: TradeLedger): string | null {
  if (!hullsAt(st).includes(e)) return 'NOT SOLD HERE';
  const q = e.requires;
  if (q && (l.rep[q.faction] ?? 0) < q.standing) return standingLock(e, l)?.reason ?? 'STANDING TOO LOW';
  return null;
}

/**
 * Buy a hull (stock fit). With `tradeIn`, the active ship goes to the yard
 * (its value comes off the price) and the new hull becomes active; without,
 * the new one joins the hangar and becomes active.
 */
export function buyHull(h: Hangar, l: TradeLedger, hullId: string, st: StationLike, opts: { tradeIn: boolean; condition?: number }): ShopResult {
  const e = CATALOG_BY_ID[hullId];
  if (!e) return { hangar: h, ledger: l, error: 'NO SUCH HULL' };
  const lock = hullLock(e, st, l);
  if (lock) return { hangar: h, ledger: l, error: lock };
  const cur = activeShip(h);
  const curCond = opts.condition ?? cur.condition;
  const credit = opts.tradeIn ? shipValue({ ...cur, condition: curCond }) : 0;
  if (!opts.tradeIn && h.ships.length >= MAX_OWNED) return { hangar: h, ledger: l, error: `HANGAR FULL (${MAX_OWNED} SHIPS) — TRADE ONE IN` };
  if (l.credits + credit < e.price) return { hangar: h, ledger: l, error: `INSUFFICIENT SHARES — ${sh(e.price - credit - l.credits)} SHORT` };
  const fresh: OwnedShip = { uid: `s${h.seq + 1}`, hull: e.id, fit: stockFit(e), condition: 1 };
  if (cargoUsed(l) > holdOf(fresh)) return { hangar: h, ledger: l, error: `SELL CARGO FIRST — ${e.name.toUpperCase()} HOLDS ${holdOf(fresh)}` };
  const hangar = cloneHangar(h);
  hangar.seq++;
  if (opts.tradeIn) hangar.ships = hangar.ships.filter((s) => s.uid !== cur.uid);
  else {
    const c = hangar.ships.find((s) => s.uid === cur.uid);
    if (c) c.condition = curCond;
  }
  hangar.ships.push(fresh);
  hangar.active = fresh.uid;
  let ledger = cloneLedger(l);
  ledger.credits = ledger.credits + credit - e.price;
  ledger = syncHold(hangar, ledger);
  return {
    hangar,
    ledger,
    message: `${e.designation} ${e.name.toUpperCase()} COMMISSIONED — ${sh(e.price)}${opts.tradeIn ? ` · ${entryOf(cur).name.toUpperCase()} TRADED IN FOR ${sh(credit)}` : ''}`,
  };
}

/** Make an owned ship the active one. */
export function switchShip(h: Hangar, l: TradeLedger, uid: string, condition?: number): ShopResult {
  const next = h.ships.find((s) => s.uid === uid);
  if (!next) return { hangar: h, ledger: l, error: 'NO SUCH SHIP' };
  if (uid === h.active) return { hangar: h, ledger: l, error: 'ALREADY YOUR SHIP' };
  if (cargoUsed(l) > holdOf(next)) return { hangar: h, ledger: l, error: `SELL CARGO FIRST — ${entryOf(next).name.toUpperCase()} HOLDS ${holdOf(next)}` };
  const hangar = cloneHangar(h);
  const cur = hangar.ships.find((s) => s.uid === h.active);
  if (cur && condition !== undefined) cur.condition = Math.max(0.05, Math.min(1, condition));
  hangar.active = uid;
  return { hangar, ledger: syncHold(hangar, cloneLedger(l)), message: `TRANSFERRED TO ${entryOf(next).designation} ${entryOf(next).name.toUpperCase()}` };
}

/** Sell an owned ship that isn't the active one. */
export function sellShip(h: Hangar, l: TradeLedger, uid: string): ShopResult {
  const s = h.ships.find((x) => x.uid === uid);
  if (!s) return { hangar: h, ledger: l, error: 'NO SUCH SHIP' };
  if (uid === h.active) return { hangar: h, ledger: l, error: 'CANNOT SELL THE SHIP YOU ARE ABOARD' };
  const v = shipValue(s);
  const hangar = cloneHangar(h);
  hangar.ships = hangar.ships.filter((x) => x.uid !== uid);
  const ledger = cloneLedger(l);
  ledger.credits += v;
  return { hangar, ledger, message: `${entryOf(s).name.toUpperCase()} SOLD TO THE YARD — ${sh(v)}` };
}

export { sameFit, stockFit };
