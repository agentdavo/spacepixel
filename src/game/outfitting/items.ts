import type { FactionId } from '@/assets/Blueprint';
import { GUNS, MISSILES, type GunId, type GunSpec, type MissileId } from '../../sim/Loadouts.ts';

/**
 * The equipment catalogue: everything a shipyard can bolt onto a hull, as
 * plain data generated from a few tables. No DOM, no three, value imports
 * only from pure modules, so it runs under node:test.
 *
 * Slots (see fit.ts): guns S/M/L, missile racks S/M/L, turret mounts S/M/L,
 * and utility slots with a class 1–5 — shield generator, armour, drive,
 * reactor — plus free bays (cargo, point defence, capacitors) and hangar
 * bays. Weapons fit any slot of their size or bigger; utility items fit a
 * slot of exactly their class.
 *
 * Every item comes in Mk I–IV from a named manufacturer. Utility items are
 * *relative*: a Mk I of the hull's own yard is what the hull's base numbers
 * already assume, and each Mk adds ~15 %. Makers have a house style —
 * Directorate yards are the baseline; Hegemony choir-forges are better and
 * hungrier (more power, dearer, standing-locked); Rustwake salvage is cheap,
 * heavy and a little worse.
 *
 * Every item draws power (MW); the reactor's output is the budget.
 */

export type SlotKind = 'gun' | 'missile' | 'turret' | 'shield' | 'armour' | 'engine' | 'reactor' | 'bay' | 'hangar';
export type WeaponSize = 'S' | 'M' | 'L';
export type Mk = 1 | 2 | 3 | 4;
export type MakerId = 'anchorage' | 'castellan' | 'aegis' | 'hesper' | 'cantus' | 'tey' | 'graveyard';

export interface Maker {
  id: MakerId;
  name: string;
  /** Short plate for tight UI (e.g. item rows). */
  short: string;
  faction: FactionId;
  blurb: string;
}

export const MAKERS: Record<MakerId, Maker> = {
  anchorage: { id: 'anchorage', name: 'Anchorage Arms', short: 'ANCHORAGE', faction: 'concord', blurb: 'The Directorate yard that built the Kestrel. Guns, racks and drives to the Schedule.' },
  castellan: { id: 'castellan', name: 'Castellan Ring Works', short: 'CASTELLAN', faction: 'concord', blurb: 'Heavy mounts, plate and reactors for everything bigger than a fighter.' },
  aegis: { id: 'aegis', name: 'Lantern Aegis Office', short: 'AEGIS', faction: 'concord', blurb: 'Shield generators and point defence, certified by the Lantern wardens.' },
  hesper: { id: 'hesper', name: 'Hesper Choir-Forge', short: 'HESPER', faction: 'choir', blurb: 'Grown, not built. Hymn emitters, lances and shields that sing when struck.' },
  cantus: { id: 'cantus', name: 'Cantus Resonance Forge', short: 'CANTUS', faction: 'choir', blurb: 'Batteries, resonant plate and reactors tuned a fifth apart.' },
  tey: { id: 'tey', name: 'Clan Tey Salvage', short: 'TEY', faction: 'rustwake', blurb: 'Pulled out of the Graveyard, stripped, welded, sold. Every one a little different.' },
  graveyard: { id: 'graveyard', name: 'Graveyard Breakers', short: 'BREAKERS', faction: 'rustwake', blurb: 'Drives and drivers from golden-age hulks. They run hot. They run.' },
};

export const MK_LABEL = ['', 'MK I', 'MK II', 'MK III', 'MK IV'] as const;

/** Per-Mk multipliers (index 1..4). */
const MK_PERF = [0, 1, 1.15, 1.3, 1.45];
const MK_DMG = [0, 1, 1.12, 1.25, 1.4];
const MK_POWER = [0, 1, 1.15, 1.3, 1.5];
const MK_PRICE = [0, 1, 2.4, 5, 9];
const MK_RELOAD = [0, 1, 0.92, 0.85, 0.78];

/** House style per faction: performance, power draw, price. */
const HOUSE: Record<FactionId, { perf: number; power: number; price: number }> = {
  concord: { perf: 1, power: 1, price: 1 },
  choir: { perf: 1.08, power: 1.2, price: 1.35 },
  rustwake: { perf: 0.94, power: 0.9, price: 0.72 },
};

/** Standing with the maker's faction needed for Mk III / Mk IV (and anything Hegemony-grown). */
const STANDING: Record<FactionId, [number, number, number]> = {
  // [Mk I–II, Mk III, Mk IV]
  concord: [-100, 20, 50],
  choir: [-40, 30, 60],
  rustwake: [-100, 10, 40],
};

interface ItemBase {
  id: string;
  name: string;
  kind: SlotKind;
  mk: Mk;
  maker: MakerId;
  faction: FactionId;
  /** Shares. */
  price: number;
  /** MW drawn while fitted. */
  power: number;
  requires?: { faction: FactionId; standing: number };
  blurb: string;
}

export interface GunItem extends ItemBase {
  kind: 'gun';
  size: WeaponSize;
  /** Guns it gives the R cycle (combo mounts give two). */
  guns: GunId[];
  /** Damage multiplier. */
  dmg: number;
}

export interface MissileItem extends ItemBase {
  kind: 'missile';
  size: WeaponSize;
  missiles: MissileId[];
  dmg: number;
  /** Reload multiplier. */
  reload: number;
  /** Salvo multiplier (bigger pods fire more). */
  salvo: number;
}

export interface TurretItem extends ItemBase {
  kind: 'turret';
  size: WeaponSize;
  gun: GunId;
  dmg: number;
  /** Fire-rate multiplier on the gun's own rate (or burst interval). */
  rate: number;
  /** Aim scatter, radians. */
  scatter: number;
}

export interface ShieldItem extends ItemBase {
  kind: 'shield';
  cls: number;
  capacity: number;
  regen: number;
  /** Regen delay multiplier (lower is better). */
  delay: number;
}

export interface ArmourItem extends ItemBase {
  kind: 'armour';
  cls: number;
  hull: number;
  /** Mass multiplier: divides acceleration, √ divides turn rate. */
  mass: number;
}

export interface EngineItem extends ItemBase {
  kind: 'engine';
  cls: number;
  speed: number;
  accel: number;
  turn: number;
}

export interface ReactorItem extends ItemBase {
  kind: 'reactor';
  cls: number;
  /** Output multiplier on the hull's rated power. */
  output: number;
}

export interface BayItem extends ItemBase {
  kind: 'bay';
  role: 'cargo' | 'pd' | 'capacitor';
  /** Cargo: fraction of the hull's base hold added. */
  cargo: number;
  /** Point defence dps against missiles / torpedoes. */
  pd: number;
  /** Capacitor: shield regen bonus (fraction). */
  regen: number;
}

export interface HangarItem extends ItemBase {
  kind: 'hangar';
  /** Blueprint of the craft launched from the bay. */
  craft: string;
}

export type Item = GunItem | MissileItem | TurretItem | ShieldItem | ArmourItem | EngineItem | ReactorItem | BayItem | HangarItem;
export type WeaponItem = GunItem | MissileItem | TurretItem;
export type UtilityItem = ShieldItem | ArmourItem | EngineItem | ReactorItem;

export const SIZE_RANK: Record<WeaponSize, number> = { S: 1, M: 2, L: 3 };
const r = (n: number) => Math.round(n / 10) * 10;
const r1 = (n: number) => Math.round(n * 100) / 100;

function requires(f: FactionId, mk: Mk): ItemBase['requires'] {
  const s = STANDING[f][mk <= 2 ? 0 : mk - 2];
  return s > -100 ? { faction: f, standing: s } : undefined;
}

function base(id: string, name: string, kind: SlotKind, mk: Mk, maker: MakerId, price: number, power: number, blurb: string): ItemBase {
  const f = MAKERS[maker].faction;
  const h = HOUSE[f];
  return {
    id: `${id}-mk${mk}`,
    name,
    kind,
    mk,
    maker,
    faction: f,
    price: r(price * MK_PRICE[mk] * h.price),
    power: r1(power * MK_POWER[mk] * h.power),
    requires: requires(f, mk),
    blurb,
  };
}

/** Raw (all-hits, no damage-type) damage per second of a gun as a fixed mount. */
export function rawGunDps(g: GunSpec): number {
  if (g.beam) return g.beam.dps * g.beam.duration * g.rate;
  if (g.burst) return (g.burst.count * g.damage * g.pellets) / g.burst.interval;
  return g.rate * g.damage * g.pellets;
}

// ── weapons ───────────────────────────────────────────────────────────

interface GunDef {
  key: string;
  name: string;
  size: WeaponSize;
  guns: GunId[];
  maker: MakerId;
  price: number;
  power: number;
  blurb: string;
}

const GUN_DEFS: GunDef[] = [
  { key: 'g-twin', name: 'PL/GU-11 TWIN MOUNT', size: 'S', guns: ['laser', 'autocannon'], maker: 'anchorage', price: 1100, power: 3, blurb: 'Kestrel pattern: a pulse laser and an autocannon on one breech. R swaps between them.' },
  { key: 'g-laser', name: 'PULSE LASER PAIR', size: 'S', guns: ['laser'], maker: 'anchorage', price: 900, power: 2.5, blurb: 'Even against shields and plate. The first gun every Vanguard pilot learns.' },
  { key: 'g-auto', name: 'GU-11 AUTOCANNON PAIR', size: 'S', guns: ['autocannon'], maker: 'anchorage', price: 900, power: 2, blurb: 'Kinetic: bounces off shields, chews hull. Switch to it when the bubble drops.' },
  { key: 'g-chord', name: 'TINE CHORD', size: 'S', guns: ['hymn', 'lance'], maker: 'hesper', price: 1400, power: 4, blurb: 'Hymn pulse and a short beam-lance, as the Cantors fly them. Strips shields fast; weak on plate.' },
  { key: 'g-hymn', name: 'HYMN PULSE EMITTERS', size: 'S', guns: ['hymn'], maker: 'hesper', price: 1100, power: 3, blurb: 'Harmonic pulse: shields shatter, hull shrugs.' },
  { key: 'g-scrap', name: 'SCRAP PAIR', size: 'S', guns: ['scatter', 'laser'], maker: 'tey', price: 800, power: 2.5, blurb: 'A scattergun and a salvaged laser on a welded yoke. Point blank or nothing.' },
  { key: 'g-scatter', name: 'SCATTERGUN', size: 'S', guns: ['scatter'], maker: 'tey', price: 700, power: 2, blurb: 'Eight pellets a shot. Get close.' },
  { key: 'g-cannon', name: 'GU-17 CANNON POD', size: 'M', guns: ['cannon'], maker: 'anchorage', price: 2600, power: 4.5, blurb: 'Heavy kinetic slugs from a conformal pod. The gunship pilot\'s hammer.' },
  { key: 'g-hlaser', name: 'HEAVY PULSE LASER', size: 'M', guns: ['heavylaser'], maker: 'anchorage', price: 2800, power: 5, blurb: 'A frigate secondary cut down to a hardpoint. Slow, bright, hits hard.' },
  { key: 'g-lance', name: 'BEAM-LANCE', size: 'M', guns: ['lance'], maker: 'hesper', price: 3200, power: 5.5, blurb: 'A held harmonic beam. Sweep it across a shield and watch it go.' },
  { key: 'g-flak', name: 'FLAK CANNON', size: 'M', guns: ['flakcannon'], maker: 'tey', price: 2000, power: 4, blurb: 'Six-pellet flak shells. Fills the sky in front of you with steel.' },
  { key: 'g-rail', name: 'HEAVY RAILGUN', size: 'L', guns: ['railgun'], maker: 'castellan', price: 9000, power: 9, blurb: 'Hypervelocity slugs, 3.4 km/s. Long reach, slow cycle, holes in capital plate.' },
  { key: 'g-driver', name: 'MASS DRIVER', size: 'L', guns: ['massdriver'], maker: 'graveyard', price: 8000, power: 10, blurb: 'A spinal coil pulled from a golden-age hulk. Aim with the whole ship.' },
  { key: 'g-glance', name: 'GREAT LANCE', size: 'L', guns: ['greatlance'], maker: 'hesper', price: 12000, power: 12, blurb: 'The Canticle\'s spinal voice, scaled down. A long harmonic beam that takes a facing off.' },
];

interface MissileDef {
  key: string;
  name: string;
  size: WeaponSize;
  missiles: MissileId[];
  maker: MakerId;
  price: number;
  power: number;
  salvo: number;
  blurb: string;
}

const MISSILE_DEFS: MissileDef[] = [
  { key: 'm-railpair', name: 'MCDF RAIL PAIR', size: 'S', missiles: ['micro', 'torpedo'], maker: 'anchorage', price: 900, power: 0.6, salvo: 1, blurb: 'Kestrel rails: a micro-missile swarm and one heavy torpedo. Y swaps.' },
  { key: 'm-micro', name: 'MICRO-MISSILE RACK', size: 'S', missiles: ['micro'], maker: 'anchorage', price: 700, power: 0.5, salvo: 1, blurb: 'Twelve-round swarm. The Itano circus in a box.' },
  { key: 'm-rocket', name: 'SCRAP ROCKET POD', size: 'S', missiles: ['micro'], maker: 'tey', price: 500, power: 0.4, salvo: 0.75, blurb: 'Rustwake unguided-ish rockets. Nine of every twelve find something.' },
  { key: 'm-swarm', name: 'SWARM POD', size: 'M', missiles: ['micro'], maker: 'anchorage', price: 1800, power: 1, salvo: 1.5, blurb: 'Eighteen micro-missiles a salvo from a heavy pylon pod.' },
  { key: 'm-harpoon', name: 'HARPOON LAUNCHER', size: 'M', missiles: ['harpoon'], maker: 'graveyard', price: 1500, power: 0.8, salvo: 1, blurb: 'Spears a fighter and tethers it: half thrust for four seconds.' },
  { key: 'm-torp', name: 'HEAVY TORPEDO TUBE', size: 'L', missiles: ['torpedo'], maker: 'castellan', price: 5000, power: 2, salvo: 1, blurb: '800-point warhead. Slow; point defence can kill it. Aim it at the subsystem you want gone.' },
  { key: 'm-psalm', name: 'PSALM TORPEDO CELL', size: 'L', missiles: ['torpedo', 'micro'], maker: 'cantus', price: 6500, power: 2.6, salvo: 1, blurb: 'A torpedo and a swarm from one resonant cell. Y swaps.' },
];

interface TurretDef {
  key: string;
  name: string;
  size: WeaponSize;
  gun: GunId;
  maker: MakerId;
  price: number;
  power: number;
  blurb: string;
}

const TURRET_DEFS: TurretDef[] = [
  { key: 't-twin', name: 'TWIN PULSE TURRET', size: 'S', gun: 'laser', maker: 'anchorage', price: 3500, power: 3, blurb: 'Remote twin laser. The flight computer tracks what you target.' },
  { key: 't-pd', name: 'PD FLAK TURRET', size: 'S', gun: 'flak', maker: 'castellan', price: 3200, power: 2.5, blurb: 'Flak bursts; shoots torpedoes down before it shoots fighters.' },
  { key: 't-scrapflak', name: 'SCRAP FLAK TURRET', size: 'S', gun: 'rustflak', maker: 'tey', price: 2400, power: 2.2, blurb: 'Salvaged flak mount. Loud, wild, cheap.' },
  { key: 't-hymn', name: 'HYMN TURRET', size: 'S', gun: 'hymn', maker: 'cantus', price: 4200, power: 3.5, blurb: 'A singing emitter on a ring. Strips shields for the heavy guns.' },
  { key: 't-heavy', name: 'HEAVY TWIN MOUNT', size: 'M', gun: 'cannon', maker: 'castellan', price: 9000, power: 6, blurb: 'Frigate-pattern twin cannon. The Resolute\'s main battery.' },
  { key: 't-hlaser', name: 'HEAVY PULSE TURRET', size: 'M', gun: 'heavylaser', maker: 'anchorage', price: 9500, power: 6.5, blurb: 'Twin heavy lasers: even damage against anything.' },
  { key: 't-battery', name: 'CHOIR BATTERY', size: 'M', gun: 'battery', maker: 'cantus', price: 11000, power: 7, blurb: 'Harmonic shard bursts. Shields go down; plate holds.' },
  { key: 't-lance', name: 'LANCE TURRET', size: 'M', gun: 'lance', maker: 'cantus', price: 12500, power: 8, blurb: 'A beam-lance that trains by itself. Sweeps on and holds.' },
  { key: 't-flakbat', name: 'FLAK BATTERY', size: 'M', gun: 'flakcannon', maker: 'tey', price: 7000, power: 5, blurb: 'Six-barrel flak cluster. Fighters hate it.' },
  { key: 't-rail', name: 'TRIPLE RAIL MOUNT', size: 'L', gun: 'railgun', maker: 'castellan', price: 26000, power: 13, blurb: 'Three railguns in one house. The Valiant\'s forward battery.' },
  { key: 't-glance', name: 'GREAT LANCE TURRET', size: 'L', gun: 'greatlance', maker: 'cantus', price: 34000, power: 16, blurb: 'A long harmonic beam on a barbette. Capital work.' },
  { key: 't-driver', name: 'DRIVER TURRET', size: 'L', gun: 'massdriver', maker: 'graveyard', price: 22000, power: 13, blurb: 'A mass driver somebody welded onto a ring. It turns. Slowly.' },
];

/** Raw dps a turret of each size should deal at Mk I (all hits). */
const TURRET_DPS: Record<WeaponSize, number> = { S: 6, M: 11, L: 22 };
const TURRET_SCATTER: Record<WeaponSize, number> = { S: 0.012, M: 0.008, L: 0.004 };

// ── utility ───────────────────────────────────────────────────────────

/** Power draw by class 1..5. */
const SHIELD_POWER = [0, 3, 6, 11, 20, 36];
const ENGINE_POWER = [0, 2.5, 4.5, 8, 15, 28];
const CLASS_PRICE = (c: number) => Math.pow(c, 1.7);

const UTIL_MAKERS: Record<'shield' | 'armour' | 'engine' | 'reactor', MakerId[]> = {
  shield: ['aegis', 'hesper', 'tey'],
  armour: ['castellan', 'cantus', 'tey'],
  engine: ['anchorage', 'hesper', 'graveyard'],
  reactor: ['castellan', 'cantus', 'graveyard'],
};

const UTIL_NAME: Record<'shield' | 'armour' | 'engine' | 'reactor', Record<FactionId, string>> = {
  shield: { concord: 'SHIELD GENERATOR', choir: 'CHORAL WARD', rustwake: 'PATCHED SHIELD RIG' },
  armour: { concord: 'COMPOSITE PLATE', choir: 'RESONANT LATTICE', rustwake: 'SCRAP PLATE' },
  engine: { concord: 'FUSION DRIVE', choir: 'CANTOR DRIVE', rustwake: 'HULK DRIVE' },
  reactor: { concord: 'FUSION REACTOR', choir: 'HARMONIC CORE', rustwake: 'SALVAGED PILE' },
};

const UTIL_BLURB: Record<'shield' | 'armour' | 'engine' | 'reactor', string> = {
  shield: 'Capacity, recharge rate and the delay before it starts. Big hulls split it over four facings.',
  armour: 'More hull. More mass: slower to accelerate and turn.',
  engine: 'Top speed, acceleration and turn authority.',
  reactor: 'The power budget. Every fitted item draws from it.',
};

function buildItems(): Item[] {
  const out: Item[] = [];
  const mks: Mk[] = [1, 2, 3, 4];
  for (const d of GUN_DEFS) {
    for (const mk of mks) out.push({ ...base(d.key, d.name, 'gun', mk, d.maker, d.price, d.power, d.blurb), kind: 'gun', size: d.size, guns: d.guns, dmg: MK_DMG[mk] });
  }
  for (const d of MISSILE_DEFS) {
    for (const mk of mks)
      out.push({ ...base(d.key, d.name, 'missile', mk, d.maker, d.price, d.power, d.blurb), kind: 'missile', size: d.size, missiles: d.missiles, dmg: MK_DMG[mk], reload: MK_RELOAD[mk], salvo: d.salvo });
  }
  for (const d of TURRET_DEFS) {
    const raw = rawGunDps(GUNS[d.gun]);
    for (const mk of mks)
      out.push({
        ...base(d.key, d.name, 'turret', mk, d.maker, d.price, d.power, d.blurb),
        kind: 'turret',
        size: d.size,
        gun: d.gun,
        dmg: MK_DMG[mk],
        rate: r1(TURRET_DPS[d.size] / raw),
        scatter: TURRET_SCATTER[d.size],
      });
  }
  for (const kind of ['shield', 'armour', 'engine', 'reactor'] as const) {
    for (const maker of UTIL_MAKERS[kind]) {
      const f = MAKERS[maker].faction;
      const h = HOUSE[f];
      for (let c = 1; c <= 5; c++) {
        for (const mk of mks) {
          const p = MK_PERF[mk];
          const name = `C${c} ${UTIL_NAME[kind][f]}`;
          const key = `${kind}-c${c}-${maker}`;
          const blurb = `${UTIL_BLURB[kind]} ${MAKERS[maker].blurb}`;
          if (kind === 'shield') {
            const choir = f === 'choir';
            out.push({
              ...base(key, name, kind, mk, maker, 800 * CLASS_PRICE(c), SHIELD_POWER[c], blurb),
              kind,
              cls: c,
              capacity: r1(p * (choir ? 1.1 : h.perf)),
              regen: r1((1 + (mk - 1) * 0.1) * (choir ? 1.2 : h.perf)),
              delay: r1((1 - (mk - 1) * 0.05) * (f === 'rustwake' ? 1.1 : choir ? 0.9 : 1)),
            });
          } else if (kind === 'armour') {
            out.push({
              ...base(key, name, kind, mk, maker, 600 * CLASS_PRICE(c), 0, blurb),
              kind,
              cls: c,
              hull: r1(p * (f === 'rustwake' ? 1.08 : f === 'choir' ? 0.95 : 1)),
              mass: r1((1 + (mk - 1) * 0.04) * (f === 'rustwake' ? 1.1 : f === 'choir' ? 0.94 : 1)),
            });
          } else if (kind === 'engine') {
            out.push({
              ...base(key, name, kind, mk, maker, 900 * CLASS_PRICE(c), ENGINE_POWER[c], blurb),
              kind,
              cls: c,
              speed: r1((1 + (mk - 1) * 0.05) * (f === 'choir' ? 1.05 : f === 'rustwake' ? 1.02 : 1)),
              accel: r1((1 + (mk - 1) * 0.1) * h.perf),
              turn: r1((1 + (mk - 1) * 0.04) * (f === 'choir' ? 1.05 : f === 'rustwake' ? 0.96 : 1)),
            });
          } else {
            out.push({ ...base(key, name, kind, mk, maker, 1000 * CLASS_PRICE(c), 0, blurb), kind, cls: c, output: r1(p * h.perf) });
          }
        }
      }
    }
  }
  const bays: { key: string; name: string; role: BayItem['role']; maker: MakerId; price: number; power: number; blurb: string }[] = [
    { key: 'b-cargo', name: 'CARGO BAY EXTENSION', role: 'cargo', maker: 'castellan', price: 1500, power: 0, blurb: 'Racks and a pressure skin: more hold.' },
    { key: 'b-hold', name: 'SCRAP HOLD', role: 'cargo', maker: 'tey', price: 1100, power: 0, blurb: 'A cargo box welded where something else used to be.' },
    { key: 'b-pd', name: 'POINT-DEFENCE CLUSTER', role: 'pd', maker: 'aegis', price: 4000, power: 2, blurb: 'Automatic gatlings that shoot inbound missiles and torpedoes.' },
    { key: 'b-pdscrap', name: 'CHAFF-AND-GUN RIG', role: 'pd', maker: 'tey', price: 2800, power: 1.6, blurb: 'Rustwake point defence: loud, mostly effective.' },
    { key: 'b-cap', name: 'SHIELD CAPACITOR', role: 'capacitor', maker: 'aegis', price: 3000, power: 1.5, blurb: 'Banks charge between hits: faster shield recovery.' },
    { key: 'b-choircap', name: 'CHORAL CAPACITOR', role: 'capacitor', maker: 'hesper', price: 3800, power: 1.8, blurb: 'A resonant bank. The shield comes back singing.' },
  ];
  for (const b of bays) {
    for (const mk of mks) {
      const p = MK_PERF[mk] * HOUSE[MAKERS[b.maker].faction].perf;
      out.push({
        ...base(b.key, b.name, 'bay', mk, b.maker, b.price, b.power, b.blurb),
        kind: 'bay',
        role: b.role,
        cargo: b.role === 'cargo' ? r1(0.25 * p) : 0,
        pd: b.role === 'pd' ? r1(30 * p) : 0,
        regen: b.role === 'capacitor' ? r1(0.3 * p) : 0,
      });
    }
  }
  out.push({ ...base('h-kestrel', 'KESTREL FLIGHT', 'hangar', 1, 'anchorage', 9000, 3, 'One Kestrel and a pilot on the ship\'s books. Launches when hostiles close; replaced when you dock.'), kind: 'hangar', craft: 'vf27-kestrel' });
  out.push({ ...base('h-gaff', 'GAFF RAIDER', 'hangar', 1, 'graveyard', 6000, 2.5, 'A Rustwake harpoon raider and a pilot who asks few questions.'), kind: 'hangar', craft: 'rw-gaff' });
  return out;
}

export const ITEMS: Item[] = buildItems();
export const ITEM_BY_ID: Record<string, Item> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function item(id: string | null | undefined): Item | undefined {
  return id ? ITEM_BY_ID[id] : undefined;
}

/** Id of the item family `key` at `mk` (e.g. itemId('g-laser', 2) → 'g-laser-mk2'). */
export function itemId(key: string, mk: Mk = 1): string {
  return `${key}-mk${mk}`;
}

/** Family key of an item id (drops the Mk suffix). */
export function itemKey(id: string): string {
  return id.replace(/-mk\d$/, '');
}

/** Display: "PULSE LASER PAIR MK II". */
export function itemLabel(i: Item): string {
  return `${i.name} ${MK_LABEL[i.mk]}`;
}

/** Guns / missiles / turrets: the size letter; utility: the class. */
export function itemSize(i: Item): WeaponSize | number | null {
  if (i.kind === 'gun' || i.kind === 'missile' || i.kind === 'turret') return i.size;
  if (i.kind === 'shield' || i.kind === 'armour' || i.kind === 'engine' || i.kind === 'reactor') return i.cls;
  return null;
}

export { GUNS, MISSILES };
