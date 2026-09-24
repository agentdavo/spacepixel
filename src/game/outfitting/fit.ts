import type { FactionId } from '@/assets/Blueprint';
import { CATALOG_BY_ID, type CatalogEntry, type GunSlot, type MissileRack, type TurretMount } from '../shipyard/catalog.ts';
import { statsFromCatalog } from '../shipyard/combatStats.ts';
import { DEFAULT_FIGHTER_STATS, DEFAULT_LOADOUT, GUNS, LOADOUTS, MISSILES, SHIP_STATS, type GunId, type Loadout, type MissileId, type MissileSpec, type MountSpec, type ShipStats } from '../../sim/Loadouts.ts';
import {
  ITEMS,
  ITEM_BY_ID,
  SIZE_RANK,
  item,
  itemId,
  rawGunDps,
  type ArmourItem,
  type BayItem,
  type EngineItem,
  type HangarItem,
  type Item,
  type MakerId,
  type ReactorItem,
  type ShieldItem,
  type SlotKind,
  type WeaponSize,
} from './items.ts';

/**
 * A hull's slots, its stock fit, and what a fit makes of it: combat stats,
 * weapons loadout, flight multipliers, cargo and the power budget. Pure —
 * the runtime side (src/game/outfitting/apply.ts) pushes a FitResult into a
 * live ShipEntity.
 *
 * Base numbers (the catalogue's stat hints, or the legacy combat table for
 * the Kestrel line) are what the *stock* fit gives; every other item is a
 * ratio against the stock item in that slot. A stock legacy hull therefore
 * flies and fights exactly as before.
 */

export interface Slot {
  /** Stable id within the hull: `gun:<socket>`, `msl:<socket>`, `tur:<socket>`, `shield`, `bay-1` … */
  id: string;
  kind: SlotKind;
  /** Weapons: S / M / L. */
  size?: WeaponSize;
  /** Utility: class 1..5. */
  cls?: number;
  /** Short human label ("WING PAIR", "DORSAL MOUNT", …). */
  label: string;
  socket?: string;
  mirror?: boolean;
  count?: number;
  arc?: TurretMount['arc'];
  spinal?: boolean;
  /** Catalogue weapon family / rack kind (drives the stock pick). */
  family?: string;
  /** Engine, reactor: can be swapped but never removed. */
  required?: boolean;
}

/** Item id per slot id (null = empty). */
export type Fit = Record<string, string | null>;

const RACK_SIZE: Record<MissileRack['kind'], WeaponSize> = { micro: 'S', rocket: 'S', rail: 'M', harpoon: 'M', vls: 'L', torpedo: 'L' };
const ARC_LABEL: Record<TurretMount['arc'], string> = { dorsal: 'DORSAL', ventral: 'VENTRAL', broadside: 'BROADSIDE', aft: 'AFT', bow: 'BOW' };

function sockLabel(s: string): string {
  return s.replace(/[-_]/g, ' ').toUpperCase();
}

export function slotsFor(e: CatalogEntry): Slot[] {
  const hp = e.hardpoints;
  const out: Slot[] = [];
  hp.guns.forEach((g: GunSlot) =>
    out.push({
      id: `gun:${g.socket}`,
      kind: 'gun',
      size: g.size,
      label: `${sockLabel(g.socket)}${g.mirror ? ' PAIR' : ''}${g.count ? ` ×${g.count}` : ''}${g.spinal ? ' · SPINAL' : ''}`,
      socket: g.socket,
      mirror: !!g.mirror,
      count: g.count,
      spinal: g.spinal,
      family: g.family,
    }),
  );
  hp.missiles.forEach((m) =>
    out.push({
      id: `msl:${m.socket}`,
      kind: 'missile',
      size: RACK_SIZE[m.kind],
      label: `${sockLabel(m.socket)}${m.mirror ? ' PAIR' : ''} · ${m.kind.toUpperCase()}`,
      socket: m.socket,
      mirror: !!m.mirror,
      count: m.count,
      family: m.kind,
    }),
  );
  hp.turrets.forEach((t) =>
    out.push({
      id: `tur:${t.socket}`,
      kind: 'turret',
      size: t.size,
      label: `${sockLabel(t.socket)}${t.mirror ? ' PAIR' : ''} · ${ARC_LABEL[t.arc]}`,
      socket: t.socket,
      mirror: !!t.mirror,
      arc: t.arc,
      family: t.family,
    }),
  );
  const u = hp.utility;
  if (u.reactor > 0) out.push({ id: 'reactor', kind: 'reactor', cls: u.reactor, label: `REACTOR · C${u.reactor}`, required: true });
  if (u.shield > 0) out.push({ id: 'shield', kind: 'shield', cls: u.shield, label: `SHIELD · C${u.shield}` });
  if (u.armour > 0) out.push({ id: 'armour', kind: 'armour', cls: u.armour, label: `ARMOUR · C${u.armour}`, required: true });
  if (u.engine > 0) out.push({ id: 'engine', kind: 'engine', cls: u.engine, label: `DRIVE · C${u.engine}`, required: true });
  for (let i = 1; i <= u.extra; i++) out.push({ id: `bay-${i}`, kind: 'bay', label: `UTILITY BAY ${i}` });
  for (let i = 1; i <= (u.hangar ?? 0); i++) out.push({ id: `hangar-${i}`, kind: 'hangar', label: `HANGAR BAY ${i}` });
  return out;
}

/**
 * Can `it` go in `slot`? Guns and turrets: the slot's size exactly (a corvette
 * hardpoint doesn't take a fighter gun). Racks: that size or smaller.
 * Utility: same kind and class.
 */
export function fits(it: Item, slot: Slot): boolean {
  if (it.kind !== slot.kind) return false;
  if (it.kind === 'gun' || it.kind === 'turret') return it.size === (slot.size ?? 'S');
  if (it.kind === 'missile') return SIZE_RANK[it.size] <= SIZE_RANK[slot.size ?? 'S'];
  if (it.kind === 'shield' || it.kind === 'armour' || it.kind === 'engine' || it.kind === 'reactor') return it.cls === slot.cls;
  return true;
}

// ── stock fits ───────────────────────────────────────────────────────

type Yard = 'concord' | 'choir' | 'rustwake';
const yardOf = (e: CatalogEntry): Yard => (e.faction === 'civil' ? 'concord' : (e.faction as Yard));
const UTIL_MAKER: Record<Yard, Record<'shield' | 'armour' | 'engine' | 'reactor', MakerId>> = {
  concord: { shield: 'aegis', armour: 'castellan', engine: 'anchorage', reactor: 'castellan' },
  choir: { shield: 'hesper', armour: 'cantus', engine: 'hesper', reactor: 'cantus' },
  rustwake: { shield: 'tey', armour: 'tey', engine: 'graveyard', reactor: 'graveyard' },
};

/** Hand-picked stock items where the generic rules would lose a legacy loadout. */
const STOCK_OVERRIDE: Record<string, Fit> = {
  'vf27-kestrel': { 'gun:gun': itemId('g-twin'), 'msl:rail': itemId('m-railpair') },
  'vf27s-super-kestrel': { 'gun:gun': itemId('g-twin'), 'msl:rail': itemId('m-railpair') },
  'vf31-harrier': { 'gun:gun': itemId('g-twin'), 'msl:wing-rail': itemId('m-micro') },
  'rw-scrapjack': { 'gun:gun': itemId('g-scrap'), 'gun:claw': itemId('g-auto') },
  'sb9-warhorse': { 'msl:torpedo': itemId('m-torp') },
};

function stockGun(slot: Slot, y: Yard): string {
  const s = slot.size ?? 'S';
  const f = slot.family ?? 'kinetic';
  if (f === 'mass-driver') return 'g-driver';
  if (f === 'beam') return s === 'S' ? 'g-hymn' : s === 'M' ? 'g-lance' : 'g-glance';
  if (y === 'rustwake' && s !== 'L') return s === 'M' ? 'g-scrap' : f === 'laser' ? 'g-laser' : 'g-scatter';
  if (f === 'laser') return s === 'S' ? 'g-laser' : s === 'M' ? 'g-hlaser' : 'g-rail';
  return s === 'S' ? 'g-auto' : s === 'M' ? 'g-cannon' : f === 'grapple' ? 'g-driver' : 'g-rail';
}

function stockMissile(slot: Slot, y: Yard): string {
  switch (slot.family) {
    case 'harpoon':
      return 'm-harpoon';
    case 'torpedo':
    case 'vls':
      return y === 'choir' ? 'm-psalm' : 'm-torp';
    case 'rail':
      return y === 'rustwake' ? 'm-harpoon' : 'm-swarm';
    default:
      return y === 'rustwake' ? 'm-rocket' : 'm-micro';
  }
}

function stockTurret(slot: Slot, y: Yard): string {
  const s = slot.size ?? 'S';
  const f = slot.family ?? 'kinetic';
  if (f === 'beam') return s === 'S' ? 't-hymn' : s === 'M' ? 't-lance' : 't-glance';
  if (f === 'flak' && s !== 'S') return y === 'choir' ? 't-battery' : 't-flakbat';
  if (f === 'flak' || (f === 'kinetic' && s === 'S')) return y === 'rustwake' ? 't-scrapflak' : y === 'choir' ? 't-hymn' : 't-pd';
  if (y === 'choir') return s === 'L' ? 't-glance' : 't-battery';
  if (f === 'laser') return s === 'S' ? 't-twin' : s === 'M' ? 't-hlaser' : 't-rail';
  if (y === 'rustwake') return s === 'L' ? 't-driver' : 't-flakbat';
  return s === 'M' ? 't-heavy' : 't-rail';
}

function stockUtility(kind: 'shield' | 'armour' | 'engine' | 'reactor', cls: number, y: Yard): string {
  return itemId(`${kind}-c${cls}-${UTIL_MAKER[y][kind]}`);
}

/** The fit a hull leaves the yard with (all Mk I, the builder's own makers). */
export function stockFit(e: CatalogEntry): Fit {
  const y = yardOf(e);
  const fit: Fit = {};
  const over = STOCK_OVERRIDE[e.id] ?? {};
  for (const s of slotsFor(e)) {
    let id: string | null = null;
    if (s.kind === 'gun') id = itemId(stockGun(s, y));
    else if (s.kind === 'missile') id = itemId(stockMissile(s, y));
    else if (s.kind === 'turret') id = itemId(stockTurret(s, y));
    else if (s.kind === 'shield' || s.kind === 'armour' || s.kind === 'engine' || s.kind === 'reactor') id = stockUtility(s.kind, s.cls ?? 1, y);
    else if (s.kind === 'hangar') id = itemId(y === 'rustwake' ? 'h-gaff' : 'h-kestrel');
    if (over[s.id] !== undefined) id = over[s.id];
    // Never hand out something the slot can't take.
    const it = item(id);
    fit[s.id] = it && fits(it, s) ? id : null;
  }
  return fit;
}

export function sameFit(a: Fit, b: Fit): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/** Repair a stored fit against the hull's slots: unknown / misfitting items fall back to stock. */
export function normaliseFit(e: CatalogEntry, raw: unknown): Fit {
  const stock = stockFit(e);
  if (!raw || typeof raw !== 'object') return stock;
  const r = raw as Record<string, unknown>;
  const out: Fit = {};
  for (const s of slotsFor(e)) {
    const v = r[s.id];
    if (v === null && !s.required) out[s.id] = null;
    else if (typeof v === 'string' && ITEM_BY_ID[v] && fits(ITEM_BY_ID[v], s)) out[s.id] = v;
    else out[s.id] = stock[s.id];
  }
  return out;
}

// ── power ────────────────────────────────────────────────────────────

/** MW an item draws in a slot (a mirrored turret pair is two turrets). */
export function slotDraw(slot: Slot, it: Item | undefined): number {
  if (!it) return 0;
  return it.power * (it.kind === 'turret' && slot.mirror ? 2 : 1);
}

export function fitDraw(e: CatalogEntry, fit: Fit): number {
  let n = 0;
  for (const s of slotsFor(e)) n += slotDraw(s, item(fit[s.id]));
  return Math.round(n * 10) / 10;
}

/** Rated reactor output of the hull (MW) with its stock reactor: stock load + 20 % headroom. */
export function ratedPower(e: CatalogEntry): number {
  return Math.ceil(fitDraw(e, stockFit(e)) * 1.2 + 1);
}

export function fitOutput(e: CatalogEntry, fit: Fit): number {
  const stock = item(stockFit(e).reactor) as ReactorItem | undefined;
  const cur = item(fit.reactor) as ReactorItem | undefined;
  if (!stock) return ratedPower(e);
  return Math.round(ratedPower(e) * ((cur?.output ?? 0) / stock.output) * 10) / 10;
}

// ── fit → numbers ────────────────────────────────────────────────────

export interface FitResult {
  stats: ShipStats;
  loadout: Loadout;
  /** Multipliers on the hull's base flight spec. */
  flight: { speed: number; accel: number; turn: number };
  /** Cargo hold, trade units. */
  cargo: number;
  power: { draw: number; output: number };
  /** Hangar complement: craft blueprint per filled bay. */
  hangar: string[];
  /** Summary numbers for the UI. */
  summary: FitSummary;
}

export interface FitSummary {
  hull: number;
  shield: number;
  /** Shield points per second once regenerating. */
  regen: number;
  delay: number;
  speed: number;
  boost: number;
  accel: number;
  /** Pitch rate, deg/s. */
  turn: number;
  cargo: number;
  /** Raw dps of the forward guns (best single gun + extra barrels) and of all turrets. */
  gunDps: number;
  turretDps: number;
  missiles: string;
  pd: number;
  facings: number;
}

/** Combat stats the hull has with its stock fit. */
export function baseStats(e: CatalogEntry): ShipStats {
  if (e.legacy) return SHIP_STATS[e.id] ?? DEFAULT_FIGHTER_STATS;
  return SHIP_STATS[e.id] ?? statsFromCatalog(e);
}

const ratio = (cur: number | undefined, stock: number | undefined, empty: number) => (stock ? (cur ?? empty) / stock : 1);

/** Candidate socket names for a slot (the runtime keeps those the model has). */
export function slotSockets(s: Slot): string[] {
  const b = s.socket ?? '';
  const out = [b];
  if (s.mirror) out.push(`${b}.L`);
  if (s.count) for (let i = 0; i < s.count; i++) out.push(`${b}-${i}`, ...(s.mirror ? [`${b}-${i}.L`] : []));
  return out;
}

export function computeFit(e: CatalogEntry, fit: Fit): FitResult {
  const slots = slotsFor(e);
  const stock = stockFit(e);
  const base = baseStats(e);
  const at = <T extends Item>(id: string) => item(fit[id]) as T | undefined;
  const st = <T extends Item>(id: string) => item(stock[id]) as T | undefined;

  const sh = at<ShieldItem>('shield');
  const sh0 = st<ShieldItem>('shield');
  const ar = at<ArmourItem>('armour');
  const ar0 = st<ArmourItem>('armour');
  const en = at<EngineItem>('engine');
  const en0 = st<EngineItem>('engine');
  let capRegen = 0;
  let cargoAdd = 0;
  let pd = 0;
  const hangar: string[] = [];
  for (const s of slots) {
    const it = item(fit[s.id]);
    if (it?.kind === 'bay') {
      const b = it as BayItem;
      capRegen += b.regen;
      cargoAdd += b.cargo;
      pd += b.pd;
    } else if (it?.kind === 'hangar') hangar.push((it as HangarItem).craft);
  }
  const mass = ratio(ar?.mass, ar0?.mass, 0.9);
  const stats: ShipStats = {
    ...base,
    hull: Math.round(base.hull * ratio(ar?.hull, ar0?.hull, 0.8)),
    shield: sh ? Math.round(base.shield * ratio(sh.capacity, sh0?.capacity, 0)) : 0,
    shieldRegen: base.shieldRegen * (sh ? ratio(sh.regen, sh0?.regen, 1) : 1) * (1 + capRegen),
    shieldDelay: base.shieldDelay * (sh ? ratio(sh.delay, sh0?.delay, 1) : 1),
    mass: base.mass * mass,
  };
  // Facing transfer rate (× class rate): only written when the fit moves it off the hull's own (stock fits stay number-for-number).
  const transfer = (base.shieldTransfer ?? 1) * (sh ? ratio(sh.transfer, sh0?.transfer, 1) : 1);
  if (transfer !== (base.shieldTransfer ?? 1) || base.shieldTransfer !== undefined) stats.shieldTransfer = transfer;
  const flight = {
    speed: ratio(en?.speed, en0?.speed, 0.4),
    accel: ratio(en?.accel, en0?.accel, 0.3) / mass,
    turn: ratio(en?.turn, en0?.turn, 0.5) / Math.sqrt(mass),
  };

  // Weapons.
  const guns: { id: GunId; sockets: string[]; mul: number; rate: number }[] = [];
  const msl: { id: MissileId; dmg: number; reload: number; salvo: number; racks: number }[] = [];
  const mounts: MountSpec[] = [];
  for (const s of slots) {
    const it = item(fit[s.id]);
    if (!it) continue;
    if (it.kind === 'gun') {
      for (const g of it.guns) {
        const prev = guns.find((x) => x.id === g);
        if (prev) {
          prev.sockets.push(...slotSockets(s));
          prev.mul = (prev.mul * prev.rate + it.dmg) / (prev.rate + 1);
          prev.rate += 1;
        } else guns.push({ id: g, sockets: slotSockets(s), mul: it.dmg, rate: 1 });
      }
    } else if (it.kind === 'missile') {
      for (const m of it.missiles) {
        const prev = msl.find((x) => x.id === m);
        if (prev) {
          prev.racks++;
          prev.dmg = Math.max(prev.dmg, it.dmg);
          prev.reload = Math.min(prev.reload, it.reload);
          prev.salvo = Math.max(prev.salvo, it.salvo);
        } else msl.push({ id: m, dmg: it.dmg, reload: it.reload, salvo: it.salvo, racks: 1 });
      }
    } else if (it.kind === 'turret') {
      mounts.push({ socket: s.socket ?? '', mirror: !!s.mirror, arc: s.arc ?? 'dorsal', size: it.size, gun: it.gun, dmgMul: it.dmg, rateMul: it.rate, scatter: it.scatter, item: it.id });
    }
  }
  const missileSpecs: MissileSpec[] = msl.map((m) => {
    const b = MISSILES[m.id];
    const salvo = b.salvo > 1 ? Math.max(1, Math.round(b.salvo * m.salvo * (1 + 0.5 * Math.min(2, m.racks - 1)))) : Math.min(3, m.racks);
    return { ...b, damage: Math.round(b.damage * m.dmg), reload: b.reload * m.reload, salvo };
  });
  const stockLegacy = e.legacy && sameFit(fit, stock) && LOADOUTS[e.id];
  const loadout: Loadout = stockLegacy
    ? { ...LOADOUTS[e.id], ...(mounts.length ? { mounts } : {}), ...(pd ? { pd } : {}) }
    : {
        guns: guns.map((g) => g.id),
        missiles: msl.map((m) => m.id),
        turret: (LOADOUTS[e.id] ?? DEFAULT_LOADOUT[yardOf(e) as FactionId]).turret,
        gunSockets: guns.map((g) => g.sockets),
        gunMul: guns.map((g) => Math.round(g.mul * 1000) / 1000),
        gunRate: guns.map((g) => g.rate),
        missileSpecs,
        ...(mounts.length ? { mounts } : {}),
        ...(pd ? { pd } : {}),
      };

  const cargo = Math.round(e.stats.cargo * (1 + cargoAdd));
  const power = { draw: fitDraw(e, fit), output: fitOutput(e, fit) };
  // Summary (UI): the catalogue flight hints × multipliers, legacy hulls from their combat table.
  const gunDps = guns.reduce((m, g) => Math.max(m, rawGunDps(GUNS[g.id]) * g.mul * g.rate), 0);
  const turretDps = mounts.reduce((n, m) => n + rawGunDps(GUNS[m.gun]) * m.dmgMul * m.rateMul * (m.mirror ? 2 : 1), 0);
  const sp = e.stats;
  const summary: FitSummary = {
    hull: stats.hull,
    shield: stats.shield,
    regen: Math.round(stats.shield * stats.shieldRegen),
    delay: Math.round(stats.shieldDelay * 10) / 10,
    speed: Math.round(sp.speed * flight.speed),
    boost: Math.round(sp.boost * flight.speed),
    accel: Math.round(sp.accel * flight.accel),
    turn: Math.round(sp.turn * flight.turn),
    cargo,
    gunDps: Math.round(gunDps),
    turretDps: Math.round(turretDps),
    missiles: missileSpecs.map((m) => `${m.id === 'micro' ? 'SWARM' : m.id.toUpperCase()}${m.salvo > 1 ? `×${m.salvo}` : ''}`).join(' · ') || '—',
    pd,
    facings: stats.facings,
  };
  return { stats, loadout, flight, cargo, power, hangar, summary };
}

/** Catalogue entry for a hull id (throws on unknown: callers validate ids first). */
export function hullEntry(id: string): CatalogEntry {
  const e = CATALOG_BY_ID[id];
  if (!e) throw new Error(`Unknown hull ${id}`);
  return e;
}

/** Every catalogued item that fits `slot`, cheapest first. */
export function itemsForSlot(slot: Slot): Item[] {
  return ITEMS.filter((i) => fits(i, slot)).sort((a, b) => a.price - b.price);
}
