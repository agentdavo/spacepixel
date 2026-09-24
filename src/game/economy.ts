/**
 * Docking & trade — the Reach economy as pure functions.
 *
 * No DOM, no three, no clocks: every price is a function of (station, commodity,
 * ledger, play-clock), so the same inputs always quote the same numbers and the
 * whole thing is unit-tested (`tests/economy.test.ts`).
 *
 *   mid  = base × character(kind × faction) × hazard × (1 + slow drift) × player pressure
 *   buy  = mid × (1 + spread/2)      (what the station charges)
 *   sell = mid × (1 − spread/2)      (what the station pays)
 *   spread = kind spread, narrowed up to 30 % by honour, widened by hostility
 *
 * - Station kind sets supply/demand: a Lantern refinery sells Ebon-gas cheap
 *   and pays well for rations; a bastion sells munitions and wants cores.
 * - Faction flavours it: the Directorate rations Ebon, the Hegemony holds the
 *   Tessaly fields, the Rustwake skims the dregs and sells to everyone.
 *   Only CHARACTER (45 %) of that stance reaches the price: a safe haul pays
 *   a living (1.5–4k sh a hold), not a jackpot.
 * - Hazard: markets in dangerous space (contested lines, Hegemony space, the
 *   Null Lantern's shadow; `MarketSpec.risk`) pay up to +30 % for what they
 *   need and dump what they make 12 % cheaper — the fat runs need guns.
 *   Balance: `npm run econ-sim` (bands asserted, also in tests/econ-sim.test.ts).
 * - Drift is two slow sines per (station, commodity), periods 7–80 minutes of
 *   play, ±11 %.
 * - Pressure: every unit the player sells here gluts the market (price falls
 *   ~3 % per unit), every unit bought tightens it; it relaxes with a 15-minute
 *   time constant. Round-tripping at one station always loses money.
 * - Reputation (−100..100 per faction) sets the spread and a service markup;
 *   at −50 or below the station refuses docking. Trade builds standing; shooting a faction's ships costs it.
 *
 * Currency is the Directorate *share* (sh); Ebon's Schedule floor is 88 sh a
 * gram, so a 10 g flask trades around a thousand shares.
 */

export type CommodityId = 'ebon' | 'relics' | 'cores' | 'spares' | 'rations' | 'munitions' | 'medical' | 'luxury';
export type StationKind = 'refinery' | 'salvage' | 'bastion' | 'freeport' | 'orbital' | 'carrier' | 'surface';
export type EconFaction = 'concord' | 'choir' | 'rustwake';

export interface Commodity {
  id: CommodityId;
  name: string;
  unit: string;
  /** Reach-wide reference price, shares per unit. */
  base: number;
  blurb: string;
}

export const COMMODITIES: readonly Commodity[] = [
  { id: 'ebon', name: 'Ebon-gas', unit: '10 g flask', base: 1100, blurb: 'Black-light isotope under magnetic confinement. The dark gets darker. Tastes of pennies.' },
  { id: 'relics', name: 'Fossil relics', unit: 'crate', base: 640, blurb: 'Golden-age salvage: timetable plaques, sealed modules, parts nobody alive can make.' },
  { id: 'cores', name: 'Reactor cores', unit: 'sealed core', base: 1450, blurb: 'A sealed heart is a holy heart. Wardens will not ask what is inside. Neither should you.' },
  { id: 'spares', name: 'Machine spares', unit: 'crate', base: 320, blurb: 'Copied fossil parts — the shape exactly right, the reason unknown. Torque-keyed and blessed.' },
  { id: 'rations', name: 'Rations', unit: 'pallet', base: 45, blurb: 'Allocation-grade protein and starch. Counted by the gram, eaten by the million.' },
  { id: 'munitions', name: 'Munitions', unit: 'crate', base: 210, blurb: 'Gun charges and micro-missile rails. The Schedule budgets for expenditure.' },
  { id: 'medical', name: 'Medical stores', unit: 'case', base: 280, blurb: 'Burn gel, radiation tabs, Cloister-grown antibiotics.' },
  { id: 'luxury', name: 'Luxuries', unit: 'case', base: 520, blurb: 'Hesper choir-glass, Cradle-pattern wine, real coffee. The Board does not approve.' },
];

export const COMMODITY: Record<CommodityId, Commodity> = Object.fromEntries(COMMODITIES.map((c) => [c.id, c])) as Record<CommodityId, Commodity>;

export const KIND_LABEL: Record<StationKind, string> = {
  refinery: 'LANTERN REFINERY',
  salvage: 'FOSSIL SALVAGE YARD',
  bastion: 'MILITARY BASTION',
  freeport: 'FREE PORT',
  orbital: 'ORBITAL PORT · LANDING CORRIDOR',
  carrier: 'FLEET CARRIER · HANGAR DECK',
  surface: 'SURFACE PORT · PLANETFALL',
};

export const FACTION_LABEL: Record<EconFaction, string> = {
  concord: 'TERRAN DIRECTORATE',
  choir: 'ZENITH HEGEMONY',
  rustwake: 'RUSTWAKE CLANS',
};

/**
 * Supply (< 1: sells cheap) and demand (> 1: pays well) per station kind.
 * A commodity missing from a row is not traded there.
 */
const KIND_MUL: Record<StationKind, Partial<Record<CommodityId, number>>> = {
  refinery: { ebon: 0.62, rations: 1.35, medical: 1.3, spares: 1.4, cores: 1.12, munitions: 1.1, luxury: 1.2 },
  salvage: { relics: 0.58, spares: 0.7, cores: 0.86, rations: 1.3, munitions: 1.25, medical: 1.2, ebon: 1.12, luxury: 1.05 },
  bastion: { munitions: 0.68, rations: 0.92, ebon: 1.42, medical: 1.36, cores: 1.3, spares: 1.22 },
  freeport: { ebon: 1.05, relics: 0.92, cores: 1.0, spares: 1.0, rations: 1.05, munitions: 1.18, medical: 1.08, luxury: 0.84 },
  orbital: { rations: 0.64, medical: 0.74, luxury: 0.8, relics: 1.36, ebon: 1.3, cores: 1.26, spares: 1.12, munitions: 1.0 },
  carrier: { munitions: 0.85, rations: 1.0, medical: 1.24, ebon: 1.46, spares: 1.3 },
  // A city on the ground: it eats, heals and spends (food, medicine, luxuries
  // up the tether from off-world), and its foundries turn out spares and charges.
  surface: { rations: 1.3, medical: 1.3, luxury: 1.3, ebon: 1.2, cores: 1.16, spares: 0.72, munitions: 0.82, relics: 1.08 },
};

const FACTION_MUL: Record<EconFaction, Partial<Record<CommodityId, number>>> = {
  // The Board rations Ebon and feeds everyone.
  concord: { ebon: 1.08, rations: 0.92, cores: 0.95, luxury: 1.1 },
  // Tessaly's fields, Hesper's foundry-gardens; relics are relics of the fall.
  choir: { ebon: 0.9, luxury: 0.85, relics: 1.18, medical: 1.1, munitions: 1.06 },
  // Skim the dregs, break the wrecks, sell to everyone.
  rustwake: { ebon: 0.93, relics: 0.9, spares: 0.92, munitions: 1.15, rations: 1.1 },
};

const SPREAD: Record<StationKind, number> = { refinery: 0.12, salvage: 0.12, bastion: 0.12, freeport: 0.07, orbital: 0.1, carrier: 0.16, surface: 0.1 };

/** Anything with an id, a kind and a faction can hold a market (stations, carriers). */
export interface MarketSpec {
  id: string;
  kind: StationKind;
  faction: EconFaction;
  /**
   * 0..1 danger of the space the market sits in (system threat, contested
   * or hostile allegiance, the Null Lantern's neighbourhood). Missing = 0.
   * Dangerous markets pay a hazard premium for what they need and dump what
   * they make: the fat margins are where the guns are.
   */
  risk?: number;
}

export interface PressureCell {
  /** Net units the player sold here (negative = bought). */
  v: number;
  /** Play-clock (s) when `v` was last written. */
  t: number;
}

/** Everything the player owns that trading touches. Persisted by Profile.ts. */
export interface TradeLedger {
  credits: number;
  cargo: Partial<Record<CommodityId, number>>;
  /** Cargo pod capacity, units. */
  capacity: number;
  rep: Record<EconFaction, number>;
  /** Micro-missile salvos on the rails. */
  missiles: number;
  /** Play-clock, seconds of flight (drives drift and pressure decay). */
  clock: number;
  pressure: Record<string, Partial<Record<CommodityId, PressureCell>>>;
  /** Last station docked at (for the campaign / continue). */
  lastDock?: string;
}

export const MISSILE_MAX = 8;
export const MISSILE_PRICE = 140;
export const HULL_PRICE = 16; // per hull point (of 100)
export const DOCK_DENY_REP = -50;
const PRESSURE_TAU = 900;
const PRESSURE_K = 0.03;

export function newLedger(): TradeLedger {
  return {
    credits: 2500,
    cargo: { rations: 2 },
    capacity: 16,
    rep: { concord: 20, choir: -20, rustwake: 0 },
    missiles: MISSILE_MAX,
    clock: 0,
    pressure: {},
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Repair a ledger loaded from storage: fill gaps, drop junk, clamp ranges. */
export function normaliseLedger(raw: unknown): TradeLedger {
  const base = newLedger();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<TradeLedger>;
  const cargo: TradeLedger['cargo'] = {};
  for (const c of COMMODITIES) {
    const q = Math.floor(num(r.cargo?.[c.id], 0));
    if (q > 0) cargo[c.id] = q;
  }
  const rep = { ...base.rep };
  for (const f of Object.keys(rep) as EconFaction[]) rep[f] = clamp(num(r.rep?.[f], rep[f]), -100, 100);
  return {
    credits: Math.max(0, Math.floor(num(r.credits, base.credits))),
    cargo: r.cargo ? cargo : base.cargo,
    capacity: Math.max(1, Math.floor(num(r.capacity, base.capacity))),
    rep,
    missiles: clamp(Math.floor(num(r.missiles, base.missiles)), 0, MISSILE_MAX),
    clock: Math.max(0, num(r.clock, 0)),
    pressure: r.pressure && typeof r.pressure === 'object' ? r.pressure : {},
    lastDock: typeof r.lastDock === 'string' ? r.lastDock : undefined,
  };
}

/** Stable 32-bit string hash (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Slow price drift for (station, commodity) at play-clock `t` (s): about ±11 %. */
export function drift(stationId: string, cid: CommodityId, t: number): number {
  const h = hash(`${stationId}/${cid}`);
  const p1 = 1800 + (h % 3000); // 30–80 min
  const p2 = 420 + ((h >>> 12) % 360); // 7–13 min
  const ph = ((h >>> 20) / 4096) * Math.PI * 2;
  return 0.08 * Math.sin((t / p1) * Math.PI * 2 + ph) + 0.03 * Math.sin((t / p2) * Math.PI * 2 + ph * 1.7);
}

export function cargoUsed(l: TradeLedger): number {
  let n = 0;
  for (const c of COMMODITIES) n += l.cargo[c.id] ?? 0;
  return n;
}

/** Current pressure (decayed to `clock`). */
export function pressureAt(l: TradeLedger, stationId: string, cid: CommodityId): number {
  const cell = l.pressure[stationId]?.[cid];
  if (!cell) return 0;
  return cell.v * Math.exp(-Math.max(0, l.clock - cell.t) / PRESSURE_TAU);
}

/** Service (repair / rearm) price multiplier: hostile −100 → +30 %, honoured +100 → −6 %. */
export function serviceMarkup(rep: number): number {
  return 1 + (clamp(-rep, 0, 100) / 100) * 0.3 - (clamp(rep, 0, 100) / 100) * 0.06;
}

/**
 * Bid/ask spread from station kind and standing. Always wider than the
 * per-unit pressure step (PRESSURE_K), so buying and selling back at the
 * same station can never make money.
 */
export function spreadFor(kind: StationKind, rep: number): number {
  return SPREAD[kind] * (1 - (clamp(rep, 0, 100) / 100) * 0.3) + (clamp(-rep, 0, 100) / 100) * 0.4;
}

export function trades(spec: MarketSpec, cid: CommodityId): boolean {
  return KIND_MUL[spec.kind][cid] !== undefined;
}

/** Supply/demand character of a commodity at a station (before drift). */
export function stance(spec: MarketSpec, cid: CommodityId): 'surplus' | 'demand' | 'steady' | 'none' {
  const k = KIND_MUL[spec.kind][cid];
  if (k === undefined) return 'none';
  const m = k * (FACTION_MUL[spec.faction][cid] ?? 1);
  return m < 0.86 ? 'surplus' : m > 1.18 ? 'demand' : 'steady';
}

/**
 * How much of the kind × faction character reaches the price. The tables
 * above read as the station's *stance* (surplus / demand labels); prices
 * only move a fraction of that way, so a safe Ebon haul is a living, not a
 * jackpot (balanced by `npm run econ-sim`).
 */
export const CHARACTER = 0.45;
/** Hazard premium at full risk: demand goods pay this much more, surplus goods dump this much cheaper. */
export const HAZARD_DEMAND = 0.3;
export const HAZARD_SURPLUS = 0.12;
/** Risk below this is ordinary traffic: no premium. */
const HAZARD_FLOOR = 0.3;

/** 0..1 hazard from a market's risk (0 in home space). */
export function hazard(spec: MarketSpec): number {
  return clamp(((spec.risk ?? 0) - HAZARD_FLOOR) / (1 - HAZARD_FLOOR), 0, 1);
}

// ── World readers (installed by src/game/world/live.ts; none = the default Reach) ──

/**
 * The world's say in a market: lasting story changes (the Bastion's
 * refugees, the Ebon collapse after the Symphony of Gates), the pilot's
 * footprint (heavy trading, broken Schedules) and background news. Kept as a
 * hook so this module stays pure and the balance sim runs the default world.
 */
export interface MarketWorld {
  /** Fractional price offset for `cid` at this market (+0.2 = 20 % dearer). */
  price(spec: MarketSpec, cid: CommodityId): number;
  /** −1..1: how this market regards the pilot (cold = tariffs, −0.8 = no berth). */
  attitude(spec: MarketSpec): number;
}
let marketWorld: MarketWorld | null = null;
export function setMarketWorld(w: MarketWorld | null): void {
  marketWorld = w;
}
/** The installed world's price offset for `cid` at a market (0 without one). */
export function marketWorldPrice(spec: MarketSpec, cid: CommodityId): number {
  return marketWorld ? marketWorld.price(spec, cid) : 0;
}
/** The installed world's attitude at a market (0 without one). */
export function marketAttitude(spec: MarketSpec): number {
  return marketWorld ? marketWorld.attitude(spec) : 0;
}
/** Extra spread from a cold attitude: up to +20 % at −1. Warm attitudes never narrow it (no round-trip profit). */
export const TARIFF_MAX = 0.2;
export const ATTITUDE_DENY = -0.8;

/** Mid-market price (no spread, no tariff), or NaN if not traded here. */
export function midPrice(spec: MarketSpec, cid: CommodityId, l: TradeLedger): number {
  const k = KIND_MUL[spec.kind][cid];
  if (k === undefined) return NaN;
  const f = FACTION_MUL[spec.faction][cid] ?? 1;
  const raw = k * f;
  let m = 1 + (raw - 1) * CHARACTER;
  const h = hazard(spec);
  if (h > 0) m *= raw > 1 ? 1 + HAZARD_DEMAND * h : raw < 1 ? 1 - HAZARD_SURPLUS * h : 1;
  const p = Math.exp(-PRESSURE_K * pressureAt(l, spec.id, cid));
  const wm = marketWorld ? Math.max(0.1, 1 + marketWorld.price(spec, cid)) : 1;
  return COMMODITY[cid].base * m * (1 + drift(spec.id, cid, l.clock)) * p * wm;
}

export interface Quote {
  id: CommodityId;
  /** Station's asking price (player buys at this). */
  buy: number;
  /** Station's bid (player sells at this). */
  sell: number;
  stance: 'surplus' | 'demand' | 'steady';
}

export function quote(spec: MarketSpec, cid: CommodityId, l: TradeLedger): Quote | null {
  const mid = midPrice(spec, cid, l);
  if (!Number.isFinite(mid)) return null;
  const s = spreadFor(spec.kind, l.rep[spec.faction]) + (marketWorld ? Math.max(0, -marketWorld.attitude(spec)) * TARIFF_MAX : 0);
  const buy = Math.max(2, Math.ceil(mid * (1 + s / 2)));
  const sell = Math.min(buy - 1, Math.max(1, Math.floor(mid * (1 - s / 2))));
  return { id: cid, buy, sell, stance: stance(spec, cid) as Quote['stance'] };
}

export function marketBoard(spec: MarketSpec, l: TradeLedger): Quote[] {
  return COMMODITIES.map((c) => quote(spec, c.id, l)).filter((q): q is Quote => q !== null);
}

export interface TradeResult {
  ledger: TradeLedger;
  /** Units actually moved (partial fills when credits / hold / stock run out). */
  units: number;
  /** Shares paid (buy) or received (sell). */
  total: number;
  error?: string;
}

function clone(l: TradeLedger): TradeLedger {
  const pressure: TradeLedger['pressure'] = {};
  for (const [k, v] of Object.entries(l.pressure)) pressure[k] = { ...v };
  return { ...l, cargo: { ...l.cargo }, rep: { ...l.rep }, pressure };
}

function push(l: TradeLedger, stationId: string, cid: CommodityId, dv: number): void {
  const now = pressureAt(l, stationId, cid);
  (l.pressure[stationId] ??= {})[cid] = { v: now + dv, t: l.clock };
}

/** Trade volume builds standing: +1 per 1,500 sh with that faction, capped at 100. */
function standing(l: TradeLedger, f: EconFaction, total: number): void {
  l.rep[f] = clamp(l.rep[f] + total / 1500, -100, 100);
}

/** Buy up to `qty` units, one at a time (each unit tightens the market a notch). */
export function buy(ledger: TradeLedger, spec: MarketSpec, cid: CommodityId, qty = 1): TradeResult {
  if (!trades(spec, cid)) return { ledger, units: 0, total: 0, error: 'NOT TRADED HERE' };
  const l = clone(ledger);
  let units = 0;
  let total = 0;
  let error: string | undefined;
  for (let i = 0; i < qty; i++) {
    if (cargoUsed(l) >= l.capacity) {
      error = 'CARGO POD FULL';
      break;
    }
    const q = quote(spec, cid, l)!;
    if (q.buy > l.credits) {
      error = 'INSUFFICIENT SHARES';
      break;
    }
    l.credits -= q.buy;
    l.cargo[cid] = (l.cargo[cid] ?? 0) + 1;
    push(l, spec.id, cid, -1);
    units++;
    total += q.buy;
  }
  if (!units) return { ledger, units: 0, total: 0, error };
  standing(l, spec.faction, total);
  return { ledger: l, units, total, error };
}

/** Sell up to `qty` units (each unit gluts the market a notch). */
export function sell(ledger: TradeLedger, spec: MarketSpec, cid: CommodityId, qty = 1): TradeResult {
  if (!trades(spec, cid)) return { ledger, units: 0, total: 0, error: 'NOT TRADED HERE' };
  const l = clone(ledger);
  let units = 0;
  let total = 0;
  let error: string | undefined;
  for (let i = 0; i < qty; i++) {
    if ((l.cargo[cid] ?? 0) <= 0) {
      error = 'NONE IN HOLD';
      break;
    }
    const q = quote(spec, cid, l)!;
    l.credits += q.sell;
    l.cargo[cid] = (l.cargo[cid] ?? 0) - 1;
    if (!l.cargo[cid]) delete l.cargo[cid];
    push(l, spec.id, cid, +1);
    units++;
    total += q.sell;
  }
  if (!units) return { ledger, units: 0, total: 0, error };
  standing(l, spec.faction, total);
  return { ledger: l, units, total, error };
}

/**
 * Cost to repair from `hull` to full (0..1 fractions of a 100-point hull).
 * `size` scales it for bigger airframes (the shipyard passes √(hull / Kestrel hull));
 * `labour` for a hired mechanic (src/game/crew.ts).
 */
export function repairCost(spec: MarketSpec, l: TradeLedger, hull: number, size = 1, labour = 1): number {
  const missing = Math.max(0, Math.round((1 - clamp(hull, 0, 1)) * 100));
  const yard = spec.kind === 'bastion' || spec.kind === 'salvage' || spec.kind === 'carrier' ? 0.8 : 1;
  return Math.ceil(missing * HULL_PRICE * yard * labour * serviceMarkup(l.rep[spec.faction]) * Math.max(1, size));
}

/** Repair as much as the player can afford. Returns the new hull fraction. */
export function repair(ledger: TradeLedger, spec: MarketSpec, hull: number, size = 1, labour = 1): { ledger: TradeLedger; hull: number; cost: number } {
  const full = repairCost(spec, ledger, hull, size, labour);
  if (full <= 0) return { ledger, hull, cost: 0 };
  const l = clone(ledger);
  if (l.credits >= full) {
    l.credits -= full;
    return { ledger: l, hull: 1, cost: full };
  }
  const missing = Math.round((1 - hull) * 100);
  const perPoint = full / missing;
  const points = Math.floor(l.credits / perPoint);
  const cost = Math.ceil(points * perPoint);
  l.credits = Math.max(0, l.credits - cost);
  return { ledger: l, hull: Math.min(1, hull + points / 100), cost };
}

export function rearmCost(spec: MarketSpec, l: TradeLedger): number {
  const k = KIND_MUL[spec.kind].munitions ?? 1.2;
  return Math.ceil((MISSILE_MAX - l.missiles) * MISSILE_PRICE * k * serviceMarkup(l.rep[spec.faction]));
}

/** Refill the missile rails, as many salvos as affordable. */
export function rearm(ledger: TradeLedger, spec: MarketSpec): { ledger: TradeLedger; cost: number } {
  const missing = MISSILE_MAX - ledger.missiles;
  if (missing <= 0) return { ledger, cost: 0 };
  const per = rearmCost(spec, ledger) / missing;
  const n = Math.min(missing, Math.floor(ledger.credits / per));
  if (n <= 0) return { ledger, cost: 0 };
  const l = clone(ledger);
  const cost = Math.ceil(n * per);
  l.credits = Math.max(0, l.credits - cost);
  l.missiles += n;
  return { ledger: l, cost };
}

/** Docking permission from standing (and, when given, the station's world attitude). */
export function dockingClearance(l: TradeLedger, f: EconFaction, attitude = 0): { ok: boolean; reason?: string } {
  if (l.rep[f] <= DOCK_DENY_REP) return { ok: false, reason: f === 'choir' ? 'UNWITNESSED — THE HEGEMONY DENIES YOU BERTH' : 'STANDING TOO LOW — BERTH DENIED' };
  if (attitude <= ATTITUDE_DENY) return { ok: false, reason: f === 'concord' ? 'BERTH DENIED — THE OFFICE OF CONTINUITY HAS YOUR NAME' : 'BERTH DENIED — THEY REMEMBER WHAT YOU DID' };
  return { ok: true };
}

/** Shooting a faction's ship costs standing with it (free-roam). */
export function reputationForKill(ledger: TradeLedger, f: EconFaction): TradeLedger {
  const l = clone(ledger);
  l.rep[f] = clamp(l.rep[f] - 1.5, -100, 100);
  return l;
}

export function standingLabel(rep: number): string {
  return rep >= 60 ? 'HONOURED' : rep >= 20 ? 'TRUSTED' : rep > -20 ? 'NEUTRAL' : rep > DOCK_DENY_REP ? 'SUSPECT' : 'BARRED';
}

/** Best place to sell `cid` among `markets` (highest bid), excluding `except`. */
export function bestBid(markets: readonly MarketSpec[], cid: CommodityId, l: TradeLedger, except?: string): { spec: MarketSpec; price: number } | null {
  let best: { spec: MarketSpec; price: number } | null = null;
  for (const m of markets) {
    if (m.id === except) continue;
    const q = quote(m, cid, l);
    if (q && (!best || q.sell > best.price)) best = { spec: m, price: q.sell };
  }
  return best;
}

/** Cheapest place to buy `cid` among `markets` (lowest ask), excluding `except`. */
export function bestAsk(markets: readonly MarketSpec[], cid: CommodityId, l: TradeLedger, except?: string): { spec: MarketSpec; price: number } | null {
  let best: { spec: MarketSpec; price: number } | null = null;
  for (const m of markets) {
    if (m.id === except) continue;
    const q = quote(m, cid, l);
    if (q && (!best || q.buy < best.price)) best = { spec: m, price: q.buy };
  }
  return best;
}

// ── News & rumours (the docked screen's ticker) ────────────────────────────

type Named = MarketSpec & { name: string };

const NEWS: Record<EconFaction | 'any', string[]> = {
  any: [
    'NULL PICKETS: SIGNAL BURST LOGGED AGAIN. BOTH BOARDS DECLINE COMMENT.',
    'Anchorage timetable beacon still promising service will resume shortly. Year 431 of the delay.',
    'Ebon floor holds at 88 sh a gram. Nobody on the exchange floor remembers voting for it.',
    'Engine-wardens ask pilots to count the Seven Keepings before lighting — "every time, Point, every time."',
    'Observance flown on the Treaty Line this week. Guns cold. Both sides counted each other twice.',
    'Relic buyers want timetable plaques. The ones that say DELAYED fetch double.',
  ],
  concord: [
    'ALLOCATION HOUR: ration cards re-weighted. Munitions quota up four percent.',
    'Board of Allocation reports expenditure "within schedule". Nobody asks whose schedule.',
    'Castellan yards need machine spares. The wardens will bless anything with a torque-key slot.',
    'Office of Continuity reminds pilots: undeclared Ebon is theft from eleven million people.',
    'Hesperus Dawn crew mugs still on the hook. Keep the light.',
  ],
  choir: [
    '(sung) Be witnessed. The Measures fly at dawn. The foundry-gardens want medical stores.',
    'The Hymn of Ascent carried on open bands last night. Cantors report the drive crystals ran warm.',
    'Treasury notice: Tessaly field quotas raised. Hierarch-Treasurer Quillon offers a prayer and a price.',
    'Unwitnessed traders are reminded that the Altitude sees every manifest.',
    'Choir-glass from Hesper fetches a fortune in Directorate space. The Board does not approve.',
  ],
  rustwake: [
    'MOOT CALLED at the hold. Votes by shouting. Debts settled in grams and favours.',
    'Magpie says she charges the Directorate triple, the Hegemony double, and friends nothing.',
    'Scrapjack crews breaking a Cantor hull in the Belt. Paint on both sides, as usual.',
    'Haul-song on channel nine all night. The only untaxed music in the Reach.',
    'The Ember is dimming again. Skimmers say it has five winters left. They said that last winter.',
  ],
};

/** Ticker lines for a docked station: lore, local market colour, and a price tip. Stable per 5 minutes of play. */
export function rumours(o: { station: Named; systemName: string; clock: number; markets: readonly Named[]; ledger: TradeLedger; news?: readonly string[] }): string[] {
  const { station, ledger } = o;
  const h = hash(`${station.id}:${Math.floor(o.clock / 300)}`);
  const pickFrom = (list: string[], k: number) => list[(h >>> (k * 3)) % list.length];
  // World headlines (src/game/world/news.ts) lead; the stock colour follows.
  const lines = [...(o.news ?? []), pickFrom(NEWS[station.faction], 0), pickFrom(NEWS.any, 1), pickFrom(NEWS[station.faction], 5)];
  if (lines[lines.length - 1] === lines[lines.length - 3]) lines.pop();

  // Local colour: what this station is long on.
  const board = marketBoard(station, ledger);
  const surplus = board.filter((q) => q.stance === 'surplus');
  if (surplus.length) {
    const q = surplus[h % surplus.length];
    lines.push(`${station.name.toUpperCase()} is long on ${COMMODITY[q.id].name.toLowerCase()} — asking ${q.buy} sh a ${COMMODITY[q.id].unit}.`);
  }

  // The tip: the widest margin from here to somewhere else in the Reach.
  let best: { cid: CommodityId; to: Named; margin: number; bid: number; ask: number } | null = null;
  for (const q of board) {
    const b = bestBid(o.markets, q.id, ledger, station.id);
    if (!b) continue;
    const margin = b.price - q.buy;
    if (!best || margin > best.margin) best = { cid: q.id, to: b.spec as Named, margin, bid: b.price, ask: q.buy };
  }
  if (best && best.margin > 0) {
    lines.push(`BAND TALK: ${best.to.name} paying ${best.bid} sh for ${COMMODITY[best.cid].name.toLowerCase()}. Buy here at ${best.ask} sh.`);
  }
  return lines;
}
