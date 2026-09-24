/**
 * Combat data: per-blueprint ship stats, gun and missile specs, loadouts and
 * capital subsystem layouts. Plain tables — no logic, no value imports (the
 * node:test suites import this file directly).
 *
 * Damage types and what they are good against (multipliers in Damage.ts):
 *
 *   kinetic    autocannon, scattergun, flak   weak vs shields, strong vs hull
 *   laser      pulse lasers                   even
 *   harmonic   Choir hymn pulse, beam-lances  strong vs shields, weak vs hull
 *   explosive  missiles, torpedoes            weak vs shields, wrecks subsystems
 */
import type { FactionId } from '@/assets/Blueprint';

export type DamageType = 'kinetic' | 'laser' | 'harmonic' | 'explosive';

// ── ships ─────────────────────────────────────────────────────────────

export interface ShipStats {
  /** Short role line for HUD / hangar. */
  role: string;
  hull: number;
  /** Total shield. Capitals split it over four facings (fore/aft/port/starboard). */
  shield: number;
  /** Fraction of max regenerated per second once `shieldDelay` has passed. */
  shieldRegen: number;
  /** Seconds after the last hit before shields regenerate. */
  shieldDelay: number;
  /** 1 = one bubble (fighters), 4 = directional facings (capitals). */
  facings: 1 | 4;
  /** Inertia multiplier: thrust accelerations are divided by it. */
  mass: number;
  /** Turn-rate multiplier. */
  agility: number;
  /** Top-speed multiplier (cruise, afterburner scale with it). */
  speed: number;
  /** Sensor signature: 1 = Kestrel. Bigger locks faster and from further out. */
  signature: number;
  /** Exact flight-spec overrides (kept where the AI sim was tuned against them). */
  flight?: Partial<Record<'maxSpeed' | 'boostSpeed' | 'pitchRate' | 'yawRate' | 'rollRate', number>>;
}

export const SHIP_STATS: Record<string, ShipStats> = {
  'vf27-kestrel': { role: 'all-rounder', hull: 110, shield: 70, shieldRegen: 0.15, shieldDelay: 3, facings: 1, mass: 1, agility: 1, speed: 1, signature: 1 },
  'vf31-harrier': { role: 'interceptor', hull: 90, shield: 60, shieldRegen: 0.2, shieldDelay: 2.5, facings: 1, mass: 0.85, agility: 1.15, speed: 1.12, signature: 0.85 },
  'sb9-warhorse': { role: 'heavy strike', hull: 240, shield: 120, shieldRegen: 0.1, shieldDelay: 4, facings: 1, mass: 1.6, agility: 0.62, speed: 0.82, signature: 1.7 },
  'choir-cantor': {
    role: 'interceptor',
    hull: 90,
    shield: 80,
    shieldRegen: 0.22,
    shieldDelay: 2.5,
    facings: 1,
    mass: 1,
    agility: 1.1,
    speed: 1.07,
    signature: 0.9,
    flight: { maxSpeed: 235, boostSpeed: 440, pitchRate: 2.3, yawRate: 1.4, rollRate: 4.0 },
  },
  'choir-psalter': { role: 'torpedo bomber', hull: 170, shield: 150, shieldRegen: 0.15, shieldDelay: 3.5, facings: 1, mass: 1.4, agility: 0.7, speed: 0.86, signature: 1.5 },
  'rw-scrapjack': { role: 'brawler', hull: 200, shield: 30, shieldRegen: 0.08, shieldDelay: 5, facings: 1, mass: 1.35, agility: 0.8, speed: 0.85, signature: 1.25 },
  // Corvettes fly on the fighter base spec (escort routes and the AI were tuned on it), just heavier.
  'ffc-lantern-guard': { role: 'picket corvette', hull: 6000, shield: 2400, shieldRegen: 0.04, shieldDelay: 6, facings: 4, mass: 1.25, agility: 0.8, speed: 0.9, signature: 6 },
  'choir-vesper': { role: 'escort corvette', hull: 5000, shield: 3200, shieldRegen: 0.05, shieldDelay: 5, facings: 4, mass: 1.2, agility: 0.85, speed: 0.95, signature: 6 },
  'cvs07-hesperus-dawn': { role: 'carrier', hull: 36000, shield: 7000, shieldRegen: 0.03, shieldDelay: 8, facings: 4, mass: 1, agility: 1, speed: 1, signature: 20 },
  'bb-indomitable': { role: 'dreadnought', hull: 48000, shield: 9000, shieldRegen: 0.03, shieldDelay: 8, facings: 4, mass: 1, agility: 0.8, speed: 0.9, signature: 25 },
  'choir-cathedral': { role: 'dreadnought', hull: 40000, shield: 9000, shieldRegen: 0.04, shieldDelay: 7, facings: 4, mass: 1, agility: 1, speed: 1, signature: 25 },
};

/** Fallback for designs without an entry (glTF heroes, test ships). */
export const DEFAULT_FIGHTER_STATS: ShipStats = SHIP_STATS['vf27-kestrel'];
export const DEFAULT_CAPITAL_STATS: ShipStats = { role: 'capital', hull: 20000, shield: 8000, shieldRegen: 0.03, shieldDelay: 8, facings: 4, mass: 1, agility: 1, speed: 1, signature: 20 };

// ── guns ──────────────────────────────────────────────────────────────

export type GunId =
  | 'laser'
  | 'autocannon'
  | 'hymn'
  | 'lance'
  | 'scatter'
  | 'flak'
  | 'battery'
  | 'rustflak'
  // Outfitting (src/game/outfitting): heavier guns for M / L slots and turrets.
  | 'cannon'
  | 'heavylaser'
  | 'railgun'
  | 'massdriver'
  | 'flakcannon'
  | 'greatlance';

/** Visual family: which instanced bolt mesh draws it (WeaponVisuals). */
export type BoltStyle = 'streak' | 'slug' | 'shard' | 'pellet';

export interface GunSpec {
  id: GunId;
  /** HUD name. */
  name: string;
  type: DamageType;
  /** Shots per second (alternating between gun sockets). */
  rate: number;
  /** Muzzle speed m/s (added to the ship's velocity). */
  speed: number;
  /** Bolt life, s (range = speed × life). */
  life: number;
  /** Damage per bolt (per pellet for spread guns). */
  damage: number;
  /** Pellets per shot (spread guns). */
  pellets: number;
  /** Cone half-angle of the pellet spread, rad. */
  spread: number;
  /** Continuous beam instead of bolts (fire = a burst of `duration`, then `rate` is 1/cooldown). */
  beam?: { length: number; width: number; duration: number; dps: number };
  /** Capital turrets: shots per burst, gap between them, pause between bursts (s). */
  burst?: { count: number; gap: number; interval: number; scatter: number };
  style: BoltStyle;
  color: string;
  core: string;
  /** Bolt thickness (m) and streak length (m). */
  width: number;
  length: number;
  /** Synth voice + timbre for the audio façade. */
  sfx: 'laser' | 'cannon';
  timbre: FactionId;
}

export const GUNS: Record<GunId, GunSpec> = {
  // Directorate MCDF: disciplined, kinetic + laser.
  laser: { id: 'laser', name: 'PULSE LASER', type: 'laser', rate: 12, speed: 1600, life: 1.15, damage: 6, pellets: 1, spread: 0, style: 'streak', color: '#4fd8ff', core: '#ffffff', width: 1.6, length: 44, sfx: 'laser', timbre: 'concord' },
  autocannon: { id: 'autocannon', name: 'GU-11 AUTOCANNON', type: 'kinetic', rate: 16, speed: 1250, life: 1.2, damage: 5, pellets: 1, spread: 0.004, style: 'slug', color: '#ffd35a', core: '#fff6d8', width: 1.3, length: 9, sfx: 'cannon', timbre: 'concord' },
  // Zenith Hegemony: the Choir sings.
  hymn: { id: 'hymn', name: 'HYMN PULSE', type: 'harmonic', rate: 7, speed: 1700, life: 1.05, damage: 9, pellets: 1, spread: 0, style: 'shard', color: '#ff3fb4', core: '#ffe0f4', width: 2.2, length: 26, sfx: 'laser', timbre: 'choir' },
  lance: {
    id: 'lance',
    name: 'BEAM-LANCE',
    type: 'harmonic',
    rate: 0.7,
    speed: 0,
    life: 0,
    damage: 0,
    pellets: 1,
    spread: 0,
    beam: { length: 1300, width: 1.6, duration: 0.45, dps: 95 },
    style: 'streak',
    color: '#ff4fd8',
    core: '#ffc0f0',
    width: 1.6,
    length: 0,
    sfx: 'laser',
    timbre: 'choir',
  },
  // Rustwake: whatever fires.
  scatter: { id: 'scatter', name: 'SCATTERGUN', type: 'kinetic', rate: 2.6, speed: 1100, life: 0.72, damage: 4.5, pellets: 8, spread: 0.03, style: 'pellet', color: '#ff9a2e', core: '#ffe6b0', width: 1.1, length: 4, sfx: 'cannon', timbre: 'rustwake' },
  // Capital point defence.
  flak: { id: 'flak', name: 'FLAK', type: 'kinetic', rate: 11, speed: 1100, life: 2.4, damage: 4, pellets: 1, spread: 0, burst: { count: 3, gap: 0.09, interval: 1.6, scatter: 0.03 }, style: 'slug', color: '#ffc46b', core: '#ffffff', width: 1.6, length: 10, sfx: 'cannon', timbre: 'concord' },
  battery: { id: 'battery', name: 'CHOIR BATTERY', type: 'harmonic', rate: 11, speed: 1300, life: 2.0, damage: 5, pellets: 1, spread: 0, burst: { count: 3, gap: 0.1, interval: 1.7, scatter: 0.028 }, style: 'shard', color: '#ff3fb4', core: '#ffe0f4', width: 2.2, length: 22, sfx: 'laser', timbre: 'choir' },
  rustflak: { id: 'rustflak', name: 'SCRAP FLAK', type: 'kinetic', rate: 11, speed: 1000, life: 2.2, damage: 4, pellets: 3, spread: 0.02, burst: { count: 2, gap: 0.12, interval: 1.8, scatter: 0.04 }, style: 'pellet', color: '#ff9a2e', core: '#ffe6b0', width: 1.4, length: 5, sfx: 'cannon', timbre: 'rustwake' },
  // ── outfitting guns (M / L slots, turrets) ──
  cannon: { id: 'cannon', name: 'GU-17 CANNON', type: 'kinetic', rate: 5, speed: 1400, life: 1.3, damage: 13, pellets: 1, spread: 0.003, style: 'slug', color: '#ffc23f', core: '#fff2cc', width: 1.9, length: 13, sfx: 'cannon', timbre: 'concord' },
  heavylaser: { id: 'heavylaser', name: 'HEAVY PULSE LASER', type: 'laser', rate: 4.5, speed: 1750, life: 1.3, damage: 15, pellets: 1, spread: 0, style: 'streak', color: '#6fe0ff', core: '#ffffff', width: 2.6, length: 64, sfx: 'laser', timbre: 'concord' },
  railgun: { id: 'railgun', name: 'HEAVY RAILGUN', type: 'kinetic', rate: 0.9, speed: 3400, life: 1.1, damage: 70, pellets: 1, spread: 0, style: 'slug', color: '#bfe8ff', core: '#ffffff', width: 2.4, length: 80, sfx: 'cannon', timbre: 'concord' },
  massdriver: { id: 'massdriver', name: 'MASS DRIVER', type: 'kinetic', rate: 0.35, speed: 2400, life: 1.6, damage: 100, pellets: 1, spread: 0, style: 'slug', color: '#ffe08a', core: '#ffffff', width: 4.2, length: 34, sfx: 'cannon', timbre: 'rustwake' },
  flakcannon: { id: 'flakcannon', name: 'FLAK CANNON', type: 'kinetic', rate: 2, speed: 1150, life: 1.5, damage: 5, pellets: 6, spread: 0.022, style: 'pellet', color: '#ffb05a', core: '#fff0d0', width: 1.5, length: 5, sfx: 'cannon', timbre: 'rustwake' },
  greatlance: {
    id: 'greatlance',
    name: 'GREAT LANCE',
    type: 'harmonic',
    rate: 0.3,
    speed: 0,
    life: 0,
    damage: 0,
    pellets: 1,
    spread: 0,
    beam: { length: 2400, width: 3.2, duration: 0.9, dps: 200 },
    style: 'streak',
    color: '#ff4fd8',
    core: '#ffd0f4',
    width: 3.2,
    length: 0,
    sfx: 'laser',
    timbre: 'choir',
  },
};

export const GUN_LIST: GunSpec[] = Object.values(GUNS);
export const GUN_INDEX: Record<GunId, number> = Object.fromEntries(GUN_LIST.map((g, i) => [g.id, i])) as Record<GunId, number>;

/** Capital beam lances (the existing sweeping beams), by faction. */
export interface LanceSpec {
  type: DamageType;
  range: number;
  width: number;
  duration: number;
  /** dps vs capitals / vs fighters. */
  dpsCapital: number;
  dpsFighter: number;
}
export const CAPITAL_LANCE: LanceSpec = { type: 'harmonic', range: 6000, width: 5, duration: 2.2, dpsCapital: 900, dpsFighter: 60 };

// ── missiles ──────────────────────────────────────────────────────────

export type MissileId = 'micro' | 'torpedo' | 'harpoon';

export interface MissileSpec {
  id: MissileId;
  name: string;
  type: DamageType;
  salvo: number;
  stagger: number; // s between launches in a salvo
  eject: number; // m/s sideways kick off the rail
  boost: number; // m/s² forward acceleration
  maxSpeed: number;
  maxAccel: number; // m/s² turn authority
  navN: number;
  life: number;
  fuse: number; // m
  damage: number;
  spiral: number; // m/s² peak wobble accel
  /** Hit points: > 0 means point defence and gunfire can shoot it down. */
  hp: number;
  /** Seconds between salvos. */
  reload: number;
  /** Lock: seconds to lock, cone half-angle (deg), range (m). */
  lockTime: number;
  lockCone: number;
  lockRange: number;
  /** Harpoon: seconds the target is tethered (thrust and top speed halved). */
  tether?: number;
  /** Body visual: length / thickness multipliers and glow colour. */
  body: { length: number; width: number; color: string };
}

export const MISSILES: Record<MissileId, MissileSpec> = {
  micro: {
    id: 'micro',
    name: 'MICRO-MISSILE SWARM',
    type: 'explosive',
    salvo: 12,
    stagger: 0.045,
    eject: 55,
    boost: 420,
    maxSpeed: 950,
    maxAccel: 320,
    navN: 4,
    life: 7,
    fuse: 6,
    damage: 22,
    spiral: 260,
    hp: 0,
    reload: 3,
    lockTime: 1.1,
    lockCone: 14,
    lockRange: 3200,
    body: { length: 1, width: 1, color: '#ffd27a' },
  },
  torpedo: {
    id: 'torpedo',
    name: 'HEAVY TORPEDO',
    type: 'explosive',
    salvo: 1,
    stagger: 0,
    eject: 12,
    boost: 70,
    maxSpeed: 430,
    maxAccel: 55,
    navN: 3,
    life: 22,
    fuse: 30,
    damage: 800,
    spiral: 0,
    hp: 40,
    reload: 12,
    lockTime: 2.2,
    lockCone: 10,
    lockRange: 6500,
    body: { length: 3.2, width: 3, color: '#ff7a3a' },
  },
  harpoon: {
    id: 'harpoon',
    name: 'HARPOON',
    type: 'kinetic',
    salvo: 1,
    stagger: 0,
    eject: 20,
    boost: 700,
    maxSpeed: 1100,
    maxAccel: 260,
    navN: 4,
    life: 5,
    fuse: 7,
    damage: 45,
    spiral: 30,
    hp: 0,
    reload: 6,
    lockTime: 0.8,
    lockCone: 12,
    lockRange: 1800,
    tether: 4,
    body: { length: 1.8, width: 1.3, color: '#ffb13f' },
  },
};

export const MISSILE_LIST: MissileSpec[] = Object.values(MISSILES);

// ── loadouts ──────────────────────────────────────────────────────────

export interface Loadout {
  /** Fighter guns in cycle order (R). Empty for capitals. */
  guns: GunId[];
  /** Missile types in cycle order (Y). */
  missiles: MissileId[];
  /** Capital turrets fire this. */
  turret?: GunId;
  // ── outfitted ships (src/game/outfitting): all optional, parallel to `guns` / `missiles` ──
  /** Sockets each gun fires from (alternating); default 'gun' / 'gun.L'. */
  gunSockets?: string[][];
  /** Damage multiplier per gun (Mk tier). */
  gunMul?: number[];
  /** Fire-rate multiplier per gun (more barrels of the same gun). */
  gunRate?: number[];
  /** Per-ship missile specs (Mk tier, extra racks) overriding MISSILES[id]. */
  missileSpecs?: MissileSpec[];
  /** Fitted turret mounts (fired by src/game/outfitting/turrets.ts, not Capitals). */
  mounts?: MountSpec[];
  /** Point-defence clusters: dps against torpedoes / missiles within ~900 m. */
  pd?: number;
}

/** One fitted turret (a mirrored pair is one mount with two sockets). */
export interface MountSpec {
  /** Catalogue socket id (mirrored twin `${socket}.L` is resolved at runtime). */
  socket: string;
  mirror: boolean;
  arc: 'dorsal' | 'ventral' | 'broadside' | 'aft' | 'bow';
  size: 'S' | 'M' | 'L';
  gun: GunId;
  /** Damage and fire-rate multipliers (Mk tier, turret size). */
  dmgMul: number;
  rateMul: number;
  /** Aim scatter, radians. */
  scatter: number;
  /** Item id, for the HUD. */
  item: string;
}

export const LOADOUTS: Record<string, Loadout> = {
  'vf27-kestrel': { guns: ['laser', 'autocannon'], missiles: ['micro', 'torpedo'] },
  'vf31-harrier': { guns: ['autocannon', 'laser'], missiles: ['micro'] },
  'sb9-warhorse': { guns: ['autocannon', 'laser'], missiles: ['torpedo', 'micro'] },
  'choir-cantor': { guns: ['hymn', 'lance'], missiles: [] },
  'choir-psalter': { guns: ['hymn', 'lance'], missiles: ['torpedo'] },
  'rw-scrapjack': { guns: ['scatter', 'laser'], missiles: ['harpoon', 'micro'] },
  'ffc-lantern-guard': { guns: [], missiles: [], turret: 'flak' },
  'choir-vesper': { guns: [], missiles: [], turret: 'battery' },
  'cvs07-hesperus-dawn': { guns: [], missiles: [], turret: 'flak' },
  'bb-indomitable': { guns: [], missiles: [], turret: 'flak' },
  'choir-cathedral': { guns: [], missiles: [], turret: 'battery' },
};

export const DEFAULT_LOADOUT: Record<FactionId, Loadout> = {
  concord: { guns: ['laser', 'autocannon'], missiles: ['micro'], turret: 'flak' },
  choir: { guns: ['hymn', 'lance'], missiles: [], turret: 'battery' },
  rustwake: { guns: ['scatter', 'laser'], missiles: ['harpoon'], turret: 'rustflak' },
};

// ── capital subsystems ────────────────────────────────────────────────

/**
 * Where the bridge and shield generator sit, as fractions of the hull's
 * bounding box (x: −1 port … +1 starboard-left, z: −1 stern … +1 bow). The
 * point is dropped onto the hull's top surface at build time. A named socket
 * wins over the fractions when present.
 */
export interface CapitalLayout {
  bridge: { socket?: string; x: number; z: number };
  shieldGen: { x: number; z: number };
}

export const CAPITAL_LAYOUT: Record<string, CapitalLayout> = {
  'ffc-lantern-guard': { bridge: { socket: 'bridge', x: 0, z: 0.1 }, shieldGen: { x: 0, z: -0.35 } },
  'choir-vesper': { bridge: { x: 0, z: 0.35 }, shieldGen: { x: 0, z: -0.25 } },
  'cvs07-hesperus-dawn': { bridge: { x: 0.42, z: -0.03 }, shieldGen: { x: -0.25, z: -0.62 } },
  'bb-indomitable': { bridge: { socket: 'bridge', x: 0, z: 0.1 }, shieldGen: { x: 0, z: -0.2 } },
  'choir-cathedral': { bridge: { x: 0, z: 0.72 }, shieldGen: { x: 0, z: -0.52 } },
};

export const DEFAULT_LAYOUT: CapitalLayout = { bridge: { x: 0, z: 0.3 }, shieldGen: { x: 0, z: -0.3 } };

/** Subsystem hit points as a fraction of hull, and routing radius as a fraction of ship length. */
export const SUBSYSTEM_TUNING = {
  turret: { hp: 0.018, radius: 0.024, label: 'TURRET' },
  lance: { hp: 0.035, radius: 0.03, label: 'LANCE' },
  hangar: { hp: 0.045, radius: 0.035, label: 'HANGAR' },
  engine: { hp: 0.04, radius: 0, label: 'ENGINE' },
  shieldGen: { hp: 0.05, radius: 0.04, label: 'SHIELD GEN' },
  bridge: { hp: 0.05, radius: 0.035, label: 'BRIDGE' },
} as const;
