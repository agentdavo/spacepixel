import type { FactionId } from '@/assets/Blueprint';

/**
 * The ship catalogue: every flyable / purchasable hull plus the AI-only
 * designs the universe needs (Rustwake raiders, civilian traffic, line
 * warships), as plain data.
 *
 * Deliberately self-contained (type-only imports) so it runs under node for
 * tests and in any UI. Stats are *hints* in the game's existing units —
 * Kestrel = 100 hull / 60 shield / 220 m/s — for the integrator to map onto
 * the per-blueprint combat stats and weapon families in src/sim. Socket ids
 * refer to the blueprint's hardpoint sockets (mirrored twins are `${id}.L`).
 *
 * Tier ladder: T1 Kestrel → T2 Super Kestrel → T3 Gauntlet → T4 Bulwark →
 * T5 Resolute → T6 Valiant (flown from the bridge). Alternates at T2–T4 are
 * bought from other yards, some only at a faction standing.
 */

/** Who builds and sells it. `civil` = merchant-marine traffic (flies under a Directorate flag). */
export type CatalogFaction = FactionId | 'civil';

export type SlotSize = 'S' | 'M' | 'L';

export type ShipRole =
  | 'interceptor'
  | 'space-superiority'
  | 'heavy-fighter'
  | 'strike'
  | 'brawler'
  | 'gunship'
  | 'corvette'
  | 'frigate'
  | 'destroyer'
  | 'raider'
  | 'gunboat'
  | 'carrier'
  | 'courier'
  | 'freighter'
  | 'tanker'
  | 'liner'
  | 'miner';

/** Fixed forward guns (fire along the socket's +Z). */
export interface GunSlot {
  /** Socket id on the built ship (mirrored twin `${socket}.L` if `mirror`). */
  socket: string;
  size: SlotSize;
  mirror?: boolean;
  /** Repeat copies on the blueprint (`${socket}-0..n-1`). */
  count?: number;
  /** Spinal mounts fire only where the whole ship points. */
  spinal?: boolean;
  /** Suggested weapon family (integrator maps onto src/sim loadouts). */
  family?: 'kinetic' | 'laser' | 'beam' | 'mass-driver' | 'grapple';
}

export interface MissileRack {
  socket: string;
  mirror?: boolean;
  /** Launch cells (or repeat copies, `${socket}-0..n-1`) per side. */
  count?: number;
  /** Rounds per rack. */
  capacity: number;
  kind: 'micro' | 'rail' | 'torpedo' | 'vls' | 'harpoon' | 'rocket';
}

export interface TurretMount {
  socket: string;
  size: SlotSize;
  mirror?: boolean;
  /** Where it can train (the blueprint joint on channel 'turret' matches the socket id). */
  arc: 'dorsal' | 'ventral' | 'broadside' | 'aft' | 'bow';
  family?: 'kinetic' | 'laser' | 'beam' | 'flak';
  /** Fires on AI / assisted aim when the player is flying. */
  assisted?: boolean;
}

export interface UtilitySlots {
  /** Shield generator class 0 (none) … 5 (capital). */
  shield: number;
  /** Armour class 0 … 5. */
  armour: number;
  /** Drive class 0 … 5. */
  engine: number;
  /** Reactor class 0 … 5. */
  reactor: number;
  /** Free utility bays (ECM, tractor, scanner, cargo pods …). */
  extra: number;
  /** Hangar bays for small craft. */
  hangar?: number;
}

export interface HardpointLayout {
  guns: GunSlot[];
  missiles: MissileRack[];
  turrets: TurretMount[];
  utility: UtilitySlots;
}

export interface StatHints {
  /** Hull points (Kestrel 100; capital ≈ 20 000). */
  hull: number;
  /** Shield points (Kestrel 60). */
  shield: number;
  /** Cruise-assisted top speed at full throttle, m/s. */
  speed: number;
  /** Afterburner speed, m/s. */
  boost: number;
  /** Main-engine acceleration, m/s². */
  accel: number;
  /** Pitch rate, deg/s (yaw ≈ 0.6×, roll from `roll`). */
  turn: number;
  /** Roll rate, deg/s. */
  roll: number;
  /** 0..1 summary for UI bars (Kestrel ≈ 0.75). */
  agility: number;
  /** Cargo capacity in trade units (Kestrel pod = 16). */
  cargo: number;
}

export interface CatalogEntry {
  /** Catalogue id (== blueprint id). */
  id: string;
  /** Blueprint id in BLUEPRINTS. */
  blueprint: string;
  name: string;
  designation: string;
  faction: CatalogFaction;
  /** Yard / builder shown in the shipyard UI. */
  manufacturer: string;
  /** Progression tier 1–6 (AI-only hulls get the tier they'd fight at). */
  tier: number;
  role: ShipRole;
  /** Price in shares (0 = not for sale). */
  price: number;
  /** Sold in shipyards. */
  purchasable: boolean;
  /** The player flight model and cameras handle it. */
  flyable: boolean;
  /** Standing needed at the seller (economy `rep`, −100..100). */
  requires?: { faction: FactionId; standing: number };
  crew: number;
  /** Overall length, metres (built model, rest pose). */
  length: number;
  /** Suggested chase camera: behind the hull, or on the bridge. */
  camera: 'chase' | 'bridge';
  hardpoints: HardpointLayout;
  stats: StatHints;
  /** One-line pitch for the shipyard card. */
  blurb: string;
  /**
   * Hull predates the shipyard: its in-sim flight spec (src/sim/Fleet) stays
   * authoritative for AI; the catalogue stats apply when the player flies it.
   */
  legacy?: boolean;
}

const util = (shield: number, armour: number, engine: number, reactor: number, extra: number, hangar?: number): UtilitySlots => ({
  shield,
  armour,
  engine,
  reactor,
  extra,
  ...(hangar ? { hangar } : {}),
});

export const CATALOG: CatalogEntry[] = [
  // ── Directorate progression line ─────────────────────────────────────
  {
    id: 'vf27-kestrel',
    legacy: true,
    blueprint: 'vf27-kestrel',
    name: 'Kestrel',
    designation: 'VF-27',
    faction: 'concord',
    manufacturer: 'Anchorage Yards (MCDF pattern)',
    tier: 1,
    role: 'interceptor',
    price: 12_000,
    purchasable: true,
    flyable: true,
    crew: 1,
    length: 17,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'gun', size: 'S', mirror: true, family: 'laser' }],
      missiles: [{ socket: 'rail', mirror: true, capacity: 4, kind: 'micro' }],
      turrets: [],
      utility: util(1, 1, 1, 1, 1),
    },
    stats: { hull: 100, shield: 60, speed: 220, boost: 460, accel: 60, turn: 120, roll: 206, agility: 0.75, cargo: 16 },
    blurb: 'The squadron workhorse. Swing wings, twin lasers, micro-missile rails and a sealed flight core older than the Directorate.',
  },
  {
    id: 'vf27s-super-kestrel',
    blueprint: 'vf27s-super-kestrel',
    name: 'Super Kestrel',
    designation: 'VF-27S',
    faction: 'concord',
    manufacturer: 'Anchorage Yards',
    tier: 2,
    role: 'space-superiority',
    price: 22_000,
    purchasable: true,
    flyable: true,
    crew: 1,
    length: 17,
    camera: 'chase',
    hardpoints: {
      guns: [
        { socket: 'gun', size: 'S', mirror: true, family: 'laser' },
        { socket: 'gunpod', size: 'M', family: 'kinetic' },
      ],
      missiles: [
        { socket: 'rail', mirror: true, capacity: 4, kind: 'micro' },
        { socket: 'shoulder', mirror: true, count: 3, capacity: 6, kind: 'micro' },
      ],
      turrets: [],
      utility: util(1, 1, 2, 1, 1),
    },
    stats: { hull: 115, shield: 70, speed: 235, boost: 520, accel: 70, turn: 112, roll: 190, agility: 0.7, cargo: 12 },
    blurb: 'Kestrel with the super pack: dorsal boosters, shoulder missile pods, a GU-17 gun pod. Faster, heavier, louder.',
  },
  {
    id: 'vf40-gauntlet',
    blueprint: 'vf40-gauntlet',
    name: 'Gauntlet',
    designation: 'VF-40',
    faction: 'concord',
    manufacturer: 'Anchorage Yards',
    tier: 3,
    role: 'heavy-fighter',
    price: 58_000,
    purchasable: true,
    flyable: true,
    crew: 2,
    length: 28,
    camera: 'chase',
    hardpoints: {
      guns: [
        { socket: 'gun', size: 'S', mirror: true, family: 'laser' },
        { socket: 'cannon', size: 'M', family: 'kinetic' },
      ],
      missiles: [
        { socket: 'pylon-0', mirror: true, capacity: 1, kind: 'rail' },
        { socket: 'pylon-1', mirror: true, capacity: 1, kind: 'rail' },
        { socket: 'pylon-2', mirror: true, capacity: 2, kind: 'micro' },
      ],
      turrets: [{ socket: 'dorsal', size: 'S', arc: 'dorsal', family: 'laser', assisted: true }],
      utility: util(2, 2, 2, 2, 2),
    },
    stats: { hull: 180, shield: 110, speed: 205, boost: 420, accel: 55, turn: 92, roll: 150, agility: 0.55, cargo: 24 },
    blurb: 'Twin-engine heavy escort. Six pylons, a chin cannon and a remote dorsal turret the flight computer fights with.',
  },
  {
    id: 'gs12-bulwark',
    blueprint: 'gs12-bulwark',
    name: 'Bulwark',
    designation: 'GS-12',
    faction: 'concord',
    manufacturer: 'Castellan Ring Works',
    tier: 4,
    role: 'gunship',
    price: 125_000,
    purchasable: true,
    flyable: true,
    crew: 4,
    length: 56,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'nose-gun', size: 'M', mirror: true, family: 'kinetic' }],
      missiles: [{ socket: 'rack', mirror: true, count: 6, capacity: 12, kind: 'rocket' }],
      turrets: [
        { socket: 'turret-dorsal', size: 'M', arc: 'dorsal', family: 'kinetic', assisted: true },
        { socket: 'turret-chin', size: 'S', arc: 'ventral', family: 'laser', assisted: true },
      ],
      utility: util(3, 3, 3, 3, 3),
    },
    stats: { hull: 600, shield: 300, speed: 150, boost: 290, accel: 30, turn: 48, roll: 75, agility: 0.32, cargo: 120 },
    blurb: 'Assault gunship and boarding tender: a cut-down frigate twin on the back, a chin turret, rocket racks and a hatch.',
  },
  {
    id: 'cr5-resolute',
    blueprint: 'cr5-resolute',
    name: 'Resolute',
    designation: 'CR-5',
    faction: 'concord',
    manufacturer: 'Castellan Ring Works',
    tier: 5,
    role: 'corvette',
    price: 240_000,
    purchasable: true,
    flyable: true,
    requires: { faction: 'concord', standing: 30 },
    crew: 20,
    length: 177,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'driver', size: 'L', spinal: true, family: 'mass-driver' }],
      missiles: [{ socket: 'vls', count: 12, capacity: 12, kind: 'vls' }],
      turrets: [
        { socket: 'main-a', size: 'M', arc: 'bow', family: 'kinetic', assisted: true },
        { socket: 'main-b', size: 'M', arc: 'aft', family: 'kinetic', assisted: true },
        { socket: 'main-v', size: 'M', arc: 'ventral', family: 'kinetic', assisted: true },
        { socket: 'pd', size: 'S', mirror: true, arc: 'broadside', family: 'flak', assisted: true },
      ],
      utility: util(4, 4, 4, 4, 4),
    },
    stats: { hull: 3000, shield: 1400, speed: 110, boost: 190, accel: 14, turn: 22, roll: 32, agility: 0.16, cargo: 600 },
    blurb: 'Fast attack corvette. Twenty crew, three twin mounts and a spinal mass-driver you aim with the whole ship.',
  },
  {
    id: 'ffl3-valiant',
    blueprint: 'ffl3-valiant',
    name: 'Valiant',
    designation: 'FFL-3',
    faction: 'concord',
    manufacturer: 'Directorate Reserve Fleet (Anchorage)',
    tier: 6,
    role: 'frigate',
    price: 420_000,
    purchasable: true,
    flyable: true,
    requires: { faction: 'concord', standing: 60 },
    crew: 140,
    length: 380,
    camera: 'bridge',
    hardpoints: {
      guns: [],
      missiles: [{ socket: 'torpedo', mirror: true, count: 2, capacity: 8, kind: 'torpedo' }],
      turrets: [
        { socket: 'main-a', size: 'L', arc: 'bow', family: 'kinetic', assisted: true },
        { socket: 'main-b', size: 'L', arc: 'bow', family: 'kinetic', assisted: true },
        { socket: 'main-x', size: 'L', arc: 'aft', family: 'kinetic', assisted: true },
        { socket: 'sec', size: 'S', mirror: true, arc: 'broadside', family: 'flak', assisted: true },
        { socket: 'sec-aft', size: 'S', mirror: true, arc: 'broadside', family: 'flak', assisted: true },
      ],
      utility: util(5, 5, 4, 5, 6, 4),
    },
    stats: { hull: 9000, shield: 4000, speed: 70, boost: 110, accel: 7, turn: 8, roll: 11, agility: 0.06, cargo: 2400 },
    blurb: 'Your own capital: outboard drive nacelles, two triple mounts forward, a ventral bay for four fighters. Commanded from the bridge.',
  },

  // ── Alternates from other yards ──────────────────────────────────────
  {
    id: 'vf31-harrier',
    legacy: true,
    blueprint: 'vf31-harrier',
    name: 'Harrier',
    designation: 'VF-31',
    faction: 'concord',
    manufacturer: 'Anchorage Yards',
    tier: 3,
    role: 'strike',
    price: 45_000,
    purchasable: true,
    flyable: true,
    crew: 2,
    length: 22,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'gun', size: 'S', mirror: true, family: 'laser' }],
      missiles: [
        { socket: 'pod', mirror: true, capacity: 8, kind: 'micro' },
        { socket: 'wing-rail', mirror: true, capacity: 1, kind: 'rail' },
      ],
      turrets: [],
      utility: util(2, 2, 2, 2, 1),
    },
    stats: { hull: 150, shield: 90, speed: 210, boost: 430, accel: 55, turn: 100, roll: 166, agility: 0.6, cargo: 20 },
    blurb: 'Two-seat swing-wing strike fighter with conformal ordnance pods. The cheap way to carry a lot of missiles.',
  },
  {
    id: 'sb9-warhorse',
    legacy: true,
    blueprint: 'sb9-warhorse',
    name: 'Warhorse',
    designation: 'SB-9',
    faction: 'concord',
    manufacturer: 'Castellan Ring Works',
    tier: 4,
    role: 'strike',
    price: 98_000,
    purchasable: true,
    flyable: true,
    crew: 3,
    length: 35,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'chin-gun', size: 'M', family: 'kinetic' }],
      missiles: [
        { socket: 'torpedo', capacity: 2, kind: 'torpedo' },
        { socket: 'wing-pylon', mirror: true, capacity: 2, kind: 'rail' },
      ],
      turrets: [
        { socket: 'dorsal-turret', size: 'S', arc: 'dorsal', family: 'kinetic', assisted: true },
        { socket: 'tail-gun', size: 'S', arc: 'aft', family: 'kinetic', assisted: true },
      ],
      utility: util(3, 3, 2, 3, 2),
    },
    stats: { hull: 420, shield: 200, speed: 160, boost: 300, accel: 34, turn: 55, roll: 86, agility: 0.36, cargo: 60 },
    blurb: 'Heavy strike bomber with a torpedo bay and two gunners. The alternative to a gunship if you only need one big hit.',
  },
  {
    id: 'choir-seraph',
    blueprint: 'choir-seraph',
    name: 'Seraph',
    designation: 'SC-9',
    faction: 'choir',
    manufacturer: 'Hesper Foundry-Gardens',
    tier: 3,
    role: 'interceptor',
    price: 85_000,
    purchasable: true,
    flyable: true,
    requires: { faction: 'choir', standing: 50 },
    crew: 1,
    length: 21,
    camera: 'chase',
    hardpoints: {
      guns: [
        { socket: 'tine', size: 'S', mirror: true, family: 'beam' },
        { socket: 'emitter', size: 'M', count: 4, family: 'beam' },
      ],
      missiles: [],
      turrets: [],
      utility: util(3, 1, 3, 2, 1),
    },
    stats: { hull: 110, shield: 150, speed: 250, boost: 500, accel: 72, turn: 140, roll: 240, agility: 0.88, cargo: 8 },
    blurb: 'A crystal dart inside a singing halo: four ring emitters fire as one chord. Sold only to those the gardens trust.',
  },
  {
    id: 'rw-knuckleduster',
    blueprint: 'rw-knuckleduster',
    name: 'Knuckleduster',
    designation: 'RW-B',
    faction: 'rustwake',
    manufacturer: 'Clan Tey salvage docks',
    tier: 3,
    role: 'brawler',
    price: 52_000,
    purchasable: true,
    flyable: true,
    requires: { faction: 'rustwake', standing: 25 },
    crew: 2,
    length: 32,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'claw', size: 'M', mirror: true, family: 'grapple' }],
      missiles: [{ socket: 'rockets', mirror: true, count: 2, capacity: 8, kind: 'rocket' }],
      turrets: [{ socket: 'dorsal', size: 'S', arc: 'dorsal', family: 'kinetic', assisted: true }],
      utility: util(1, 4, 2, 2, 2),
    },
    stats: { hull: 260, shield: 60, speed: 180, boost: 380, accel: 50, turn: 75, roll: 115, agility: 0.45, cargo: 40 },
    blurb: 'Ore-tug brawler with a ram prow, two grapple arms and a Directorate turret its previous owners would like back.',
  },
  {
    id: 'rw-scrapjack',
    legacy: true,
    blueprint: 'rw-scrapjack',
    name: 'Scrapjack',
    designation: 'RW-M',
    faction: 'rustwake',
    manufacturer: 'Rustwake (every one different)',
    tier: 2,
    role: 'interceptor',
    price: 16_000,
    purchasable: true,
    flyable: true,
    requires: { faction: 'rustwake', standing: 0 },
    crew: 1,
    length: 17,
    camera: 'chase',
    hardpoints: {
      guns: [
        { socket: 'gun', size: 'M', family: 'kinetic' },
        { socket: 'claw', size: 'S', family: 'grapple' },
      ],
      missiles: [{ socket: 'rockets', count: 4, capacity: 8, kind: 'rocket' }],
      turrets: [],
      utility: util(1, 2, 1, 1, 2),
    },
    stats: { hull: 120, shield: 40, speed: 215, boost: 440, accel: 58, turn: 108, roll: 180, agility: 0.68, cargo: 28 },
    blurb: 'A hauler cab with a Directorate wing, a Hegemony blade and an ore-tug engine. Cheap, tough, never twice the same.',
  },
  {
    id: 'civ-swallow',
    blueprint: 'civ-swallow',
    name: 'Swallow',
    designation: 'XC-2',
    faction: 'civil',
    manufacturer: 'Swift Couriers of the Accord',
    tier: 2,
    role: 'courier',
    price: 18_000,
    purchasable: true,
    flyable: true,
    crew: 2,
    length: 30,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'gun', size: 'S', family: 'laser' }],
      missiles: [],
      turrets: [],
      utility: util(2, 1, 3, 2, 3),
    },
    stats: { hull: 90, shield: 50, speed: 260, boost: 540, accel: 66, turn: 84, roll: 130, agility: 0.5, cargo: 40 },
    blurb: 'Golden-age express courier: gull wings, a T-tail and the fastest drive a civilian can legally buy.',
  },
  {
    id: 'civ-tallow',
    blueprint: 'civ-tallow',
    name: 'Tallow',
    designation: 'MB',
    faction: 'civil',
    manufacturer: 'Meridian Ore Company',
    tier: 4,
    role: 'miner',
    price: 90_000,
    purchasable: true,
    flyable: true,
    crew: 9,
    length: 159,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'drill', size: 'L', spinal: true, family: 'grapple' }],
      missiles: [],
      turrets: [],
      utility: util(2, 3, 2, 3, 4),
    },
    stats: { hull: 1800, shield: 300, speed: 55, boost: 80, accel: 6, turn: 14, roll: 18, agility: 0.08, cargo: 1800 },
    blurb: 'Asteroid mining barge: a spinning cutter head, a hopper the size of a nave, and the reason Meridian eats.',
  },
  {
    id: 'civ-longhaul',
    blueprint: 'civ-longhaul',
    name: 'Longhaul',
    designation: 'MV',
    faction: 'civil',
    manufacturer: 'Anchorage Bulk Carriers',
    tier: 5,
    role: 'freighter',
    price: 190_000,
    purchasable: true,
    flyable: true,
    crew: 6,
    length: 256,
    camera: 'bridge',
    hardpoints: {
      guns: [],
      missiles: [],
      turrets: [{ socket: 'pd', size: 'S', arc: 'aft', family: 'flak', assisted: true }],
      utility: util(3, 2, 3, 3, 6),
    },
    stats: { hull: 4000, shield: 800, speed: 60, boost: 85, accel: 5, turn: 9, roll: 12, agility: 0.05, cargo: 5000 },
    blurb: 'The bulk freighter of the Reach: a cab, a spine and twenty-five standard boxes. Trade at scale.',
  },

  // ── AI-only: Rustwake clans ──────────────────────────────────────────
  {
    id: 'rw-gaff',
    blueprint: 'rw-gaff',
    name: 'Gaff',
    designation: 'RW-H',
    faction: 'rustwake',
    manufacturer: 'Rustwake clans',
    tier: 2,
    role: 'raider',
    price: 0,
    purchasable: false,
    flyable: true,
    crew: 1,
    length: 19,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'gun', size: 'S', family: 'kinetic' }],
      missiles: [{ socket: 'harpoon', capacity: 1, kind: 'harpoon' }],
      turrets: [],
      utility: util(1, 1, 2, 1, 1),
    },
    stats: { hull: 110, shield: 30, speed: 240, boost: 480, accel: 64, turn: 112, roll: 190, agility: 0.7, cargo: 20 },
    blurb: 'Harpoon raider: spears a target, reels it in and lets the clan cut it open.',
  },
  {
    id: 'rw-bulldog',
    blueprint: 'rw-bulldog',
    name: 'Bulldog',
    designation: 'RW-G',
    faction: 'rustwake',
    manufacturer: 'Rustwake clans',
    tier: 4,
    role: 'gunboat',
    price: 0,
    purchasable: false,
    flyable: true,
    crew: 6,
    length: 66,
    camera: 'chase',
    hardpoints: {
      guns: [{ socket: 'driver', size: 'L', spinal: true, family: 'mass-driver' }],
      missiles: [],
      turrets: [
        { socket: 'turret-fore', size: 'M', arc: 'dorsal', family: 'kinetic' },
        { socket: 'turret-aft', size: 'M', arc: 'dorsal', family: 'kinetic' },
      ],
      utility: util(1, 4, 2, 3, 2),
    },
    stats: { hull: 900, shield: 150, speed: 120, boost: 200, accel: 20, turn: 30, roll: 40, agility: 0.2, cargo: 300 },
    blurb: 'An ore-tug fuel tank with a cab, two turrets and a mass-driver welded on. The welds are the strongest part.',
  },
  {
    id: 'rw-mother-lode',
    blueprint: 'rw-mother-lode',
    name: 'Mother Lode',
    designation: 'RW-C',
    faction: 'rustwake',
    manufacturer: 'Rustwake clans',
    tier: 6,
    role: 'carrier',
    price: 0,
    purchasable: false,
    flyable: false,
    crew: 400,
    length: 439,
    camera: 'bridge',
    hardpoints: {
      guns: [],
      missiles: [],
      turrets: [{ socket: 'pd', size: 'S', arc: 'dorsal', family: 'flak' }],
      utility: util(3, 3, 3, 4, 8, 12),
    },
    stats: { hull: 12000, shield: 2500, speed: 45, boost: 60, accel: 4, turn: 4, roll: 5, agility: 0.03, cargo: 8000 },
    blurb: 'Clan home and hauler-carrier: three hab drums, a sawn-off flight deck, a prize crane and a star-scoop.',
  },

  // ── AI-only: civilian traffic ────────────────────────────────────────
  {
    id: 'civ-umbra',
    blueprint: 'civ-umbra',
    name: 'Umbra',
    designation: 'EGT',
    faction: 'civil',
    manufacturer: 'Tey Ebon Works',
    tier: 5,
    role: 'tanker',
    price: 0,
    purchasable: false,
    flyable: true,
    crew: 12,
    length: 293,
    camera: 'bridge',
    hardpoints: { guns: [], missiles: [], turrets: [], utility: util(4, 3, 3, 4, 2) },
    stats: { hull: 5000, shield: 2000, speed: 50, boost: 70, accel: 4, turn: 7, roll: 9, agility: 0.04, cargo: 6000 },
    blurb: 'Ebon-gas tanker: four confinement spheres glowing black-light violet. Every raider in the Reach wants one.',
  },
  {
    id: 'civ-meridian-star',
    blueprint: 'civ-meridian-star',
    name: 'Meridian Star',
    designation: 'TSS',
    faction: 'civil',
    manufacturer: 'Timetable Line (golden-age)',
    tier: 6,
    role: 'liner',
    price: 0,
    purchasable: false,
    flyable: true,
    crew: 380,
    length: 432,
    camera: 'bridge',
    hardpoints: { guns: [], missiles: [], turrets: [], utility: util(4, 2, 3, 4, 4) },
    stats: { hull: 8000, shield: 3000, speed: 80, boost: 110, accel: 5, turn: 6, roll: 8, agility: 0.04, cargo: 400 },
    blurb: 'Golden-age express liner: three promenade decks, an observation dome, 2,400 berths and never once late.',
  },

  // ── AI-only: mid-tier warships ───────────────────────────────────────
  {
    id: 'ddg40-arbiter',
    blueprint: 'ddg40-arbiter',
    name: 'Arbiter',
    designation: 'DDG-40',
    faction: 'concord',
    manufacturer: 'Castellan Ring Works',
    tier: 6,
    role: 'destroyer',
    price: 0,
    purchasable: false,
    flyable: false,
    crew: 310,
    length: 644,
    camera: 'bridge',
    hardpoints: {
      guns: [{ socket: 'breaker', size: 'L', spinal: true, family: 'mass-driver' }],
      missiles: [{ socket: 'vls', count: 12, capacity: 48, kind: 'vls' }],
      turrets: [
        { socket: 'prong-a', size: 'M', mirror: true, arc: 'bow', family: 'kinetic' },
        { socket: 'prong-b', size: 'M', mirror: true, arc: 'bow', family: 'kinetic' },
        { socket: 'main-x', size: 'L', arc: 'aft', family: 'kinetic' },
        { socket: 'ventral', size: 'M', arc: 'ventral', family: 'laser' },
      ],
      utility: util(5, 5, 4, 5, 6, 2),
    },
    stats: { hull: 14000, shield: 6000, speed: 60, boost: 90, accel: 5, turn: 5, roll: 6, agility: 0.03, cargo: 1200 },
    blurb: 'Fork-bow destroyer: the prongs carry the forward battery and cradle a spinal gate-breaker.',
  },
  {
    id: 'choir-canticle',
    blueprint: 'choir-canticle',
    name: 'Canticle',
    designation: 'SFF-3',
    faction: 'choir',
    manufacturer: 'Hesper Foundry-Gardens',
    tier: 6,
    role: 'frigate',
    price: 0,
    purchasable: false,
    flyable: false,
    crew: 220,
    length: 476,
    camera: 'bridge',
    hardpoints: {
      guns: [{ socket: 'lance', size: 'L', spinal: true, family: 'beam' }],
      missiles: [],
      turrets: [
        ...[0, 1, 2, 3, 4, 5, 6].map((i): TurretMount => ({ socket: `pipe-${i}`, size: 'M', arc: 'dorsal', family: 'beam' })),
        { socket: 'emitter-f', size: 'M', mirror: true, arc: 'broadside', family: 'beam' },
        { socket: 'emitter-a', size: 'S', mirror: true, arc: 'aft', family: 'beam' },
      ],
      utility: util(5, 3, 4, 5, 4),
    },
    stats: { hull: 11000, shield: 8000, speed: 65, boost: 95, accel: 5, turn: 6, roll: 7, agility: 0.04, cargo: 900 },
    blurb: 'Organ-pipe line frigate: seven resonance pipes tuned a fifth apart — a beam battery, or a hymn.',
  },
];

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID[id];
}

/** Ships a shipyard of `faction` sells, cheapest first (standing filters are the UI's job). */
export function forSale(faction?: CatalogFaction): CatalogEntry[] {
  return CATALOG.filter((e) => e.purchasable && (!faction || e.faction === faction)).sort((a, b) => a.price - b.price);
}

/** The main Directorate progression line, tier order. */
export const PROGRESSION: string[] = ['vf27-kestrel', 'vf27s-super-kestrel', 'vf40-gauntlet', 'gs12-bulwark', 'cr5-resolute', 'ffl3-valiant'];

/** Traffic hulls for AI routes between stations. */
export const TRAFFIC: string[] = ['civ-swallow', 'civ-tallow', 'civ-longhaul', 'civ-umbra', 'civ-meridian-star'];

/** Can a ledger with these standings buy it? */
export function canBuy(e: CatalogEntry, rep: Partial<Record<FactionId, number>>, shares: number): boolean {
  if (!e.purchasable || shares < e.price) return false;
  if (e.requires && (rep[e.requires.faction] ?? 0) < e.requires.standing) return false;
  return true;
}

/** Trade-in value (shipyards buy back at 60 %). */
export function tradeIn(e: CatalogEntry): number {
  return Math.round(e.price * 0.6);
}
