/**
 * Contracts board (batch 3 · milestone 10) — pure data + functions.
 *
 * No DOM, no three, no clocks — type imports plus the pure ship catalogue —
 * so the whole module runs under `node --test` (tests/contracts.test.ts). Every board is a pure
 * function of (station, board epoch, standing bucket, ship tier): the same
 * inputs always post the same jobs, and a contract's id encodes all four.
 *
 * Kinds
 *   courier   sealed case to a station by a deadline (tier ≥ 2: interceptors)
 *   haul      bulk consignment loaded into the cargo pod, delivered elsewhere
 *   escort    see a freighter down a lane to a Lantern or station
 *   bounty    kill a named raider and their wing
 *   patrol    sweep a set of nav points, clear what you find
 *   salvage   survey a wreck, recover its flight core (blackbox), get clear
 *   recon     hold an observation point in a dangerous system, break contact
 *   sortie    (rare) join a Directorate skirmish against a Choir Measure
 *   priority  the next campaign episode, posted at every Directorate station
 *
 * Money: rewards in Directorate shares (sh), standing per faction. Courier
 * and haul jobs are paid by the consignee on delivery; everything flown in
 * space is paid when you dock back at the client's station. Late or
 * abandoned jobs cost a penalty (30 % of the fee) and twice the standing.
 *
 * Geometry is stored system-local (metres, before SYSTEM_OFFSET) so a
 * contract is plain JSON and survives the save file.
 */
import type { Character } from '../campaign/types';
import type { RunnerSnapshot } from '../CampaignRunner';
import { CATALOG_BY_ID } from '../shipyard/catalog.ts';
import type { CommodityId, EconFaction, StationKind, TradeLedger } from '../economy';

export type ContractKind = 'courier' | 'haul' | 'escort' | 'bounty' | 'patrol' | 'salvage' | 'recon' | 'sortie' | 'priority';
export type Tier = 1 | 2 | 3;
export type V3 = [number, number, number];
export type ContractState = 'offered' | 'active' | 'ready' | 'done' | 'failed';

// ── The Reach, as the board sees it ──────────────────────────────────────

export interface ReachStation {
  id: string;
  name: string;
  kind: StationKind;
  faction: EconFaction;
  /** System-local position (m). */
  pos: V3;
  /** Out of the docking bay. */
  axis: V3;
  /** Set for stations hung over a planet (orbital ports, skim refineries). */
  planet?: number;
}

export interface ReachGate {
  to: string;
  pos: V3;
  normal: V3;
}

export interface ReachSystem {
  id: string;
  name: string;
  faction: string;
  threat: number;
  stations: ReachStation[];
  gates: ReachGate[];
}

export interface ReachMap {
  systems: ReachSystem[];
}

/** A commodity the haul generator can consign (normally economy.COMMODITIES). */
export interface Good {
  id: CommodityId;
  name: string;
  unit: string;
  base: number;
}

// ── Contracts ────────────────────────────────────────────────────────────

/** In-space operation (run by the CampaignRunner via src/game/contracts/ops.ts). */
export interface ContractOp {
  system: string;
  /** Centre of the operation, system-local metres. */
  center: V3;
  /** Escort: freighter start and route end. */
  start?: V3;
  end?: V3;
  endKind?: 'gate' | 'station';
  endName?: string;
  /** Patrol nav points. */
  waypoints?: V3[];
  /** Hostiles per wave, and waves. */
  hostiles: number;
  waves: number;
  /** Hostile blueprint + faction. */
  enemy: { blueprint: string; faction: 'rustwake' | 'choir' | 'concord'; name: string };
  /** Bounty target; `id` is its comms character (MARK_CAST). */
  mark?: { id: string; name: string; blueprint: string; faction: 'rustwake' | 'choir' | 'concord' };
  freighter?: { name: string; blueprint: string };
  wreck?: 'wreckage' | 'derelict';
  /** Dwell seconds (recon / salvage survey). */
  hold?: number;
  seed: number;
}

export interface Contract {
  id: string;
  kind: ContractKind;
  tier: Tier;
  /** Client character id (CLIENTS, or the campaign cast for priority orders). */
  client: string;
  /** Client faction: standing moves here. */
  faction: EconFaction;
  title: string;
  brief: string;
  origin: string;
  originName: string;
  originSystem: string;
  /** Courier / haul destination station. */
  dest?: string;
  destName?: string;
  destSystem?: string;
  /** Where the fee is paid. */
  payAt: string;
  payAtName: string;
  payAtSystem: string;
  cargo?: { id: CommodityId; units: number; name: string; unit: string };
  op?: ContractOp;
  /** Fee in shares, standing gained with `faction`. */
  reward: number;
  rep: number;
  /** Sorties: standing lost with the other side. */
  enemy?: { faction: EconFaction; rep: number };
  penalty: number;
  repPenalty: number;
  /** Seconds (board clock) allowed after acceptance. */
  duration: number;
  /** Board clock when the offer lapses. */
  expires: number;
  /** Gate hops from the origin to where the work is. */
  jumps: number;
  state: ContractState;
  acceptedAt?: number;
  due?: number;
  /** Courier / haul interceptors already sprung. */
  ambushed?: boolean;
  /** Priority orders: the campaign episode number. */
  episode?: number;
  /** Operation progress saved when the pilot left the system (or was towed home) mid-op. */
  progress?: RunnerSnapshot;
  /** Offered in conversation (src/game/contracts/named.ts), not posted on a board. */
  named?: string;
  /** Guild work (src/game/guilds): merit paid on settlement, and Ebon grams for clan jobs. */
  guild?: string;
  merit?: number;
  grams?: number;
  /** A hand-written guild arc mission (src/game/guilds/arcs.ts builds its operation). */
  arc?: string;
  /** An outpost's defence (src/game/outposts). */
  outpost?: string;
}

export interface Receipt {
  id: string;
  title: string;
  result: 'paid' | 'failed' | 'abandoned' | 'lapsed';
  /** Shares received (paid) or charged (negative). */
  amount: number;
  rep: number;
  faction: EconFaction;
  at: number;
}

/** Everything contract-related the save file keeps. */
export interface ContractBook {
  /** Board clock: seconds of free flight (paused while docked and in story episodes). */
  clock: number;
  active: Contract[];
  /** Ids taken or declined (hidden from the board). Pruned. */
  seen: string[];
  completed: number;
  failed: number;
  earned: number;
  log: Receipt[];
}

export const MAX_ACTIVE = 5;
/** A board reposts every 10 minutes of free flight. */
export const BOARD_PERIOD = 600;
export const TIER_LABEL: Record<Tier, string> = { 1: 'ROUTINE', 2: 'HAZARDOUS', 3: 'DEADLY' };
export const KIND_LABEL: Record<ContractKind, string> = {
  courier: 'COURIER',
  haul: 'CARGO HAUL',
  escort: 'ESCORT',
  bounty: 'BOUNTY',
  patrol: 'PATROL SWEEP',
  salvage: 'SALVAGE RECOVERY',
  recon: 'RECONNAISSANCE',
  sortie: 'FACTION SORTIE',
  priority: 'PRIORITY ORDERS',
};

/** Ship tier by blueprint (the shipwright extends this). Unknown hulls fly as tier 1. */
export const SHIP_TIER: Record<string, Tier> = {
  'vf27-kestrel': 1,
  'rw-scrapjack': 1,
  'choir-cantor': 1,
  'vf31-harrier': 2,
  'sb9-warhorse': 2,
  'choir-psalter': 2,
  'ffc-lantern-guard': 3,
  'choir-vesper': 3,
};
export function shipTier(blueprintId: string): Tier {
  const t = SHIP_TIER[blueprintId];
  if (t) return t;
  // Shipyard hulls: catalogue tier T1–2 → I, T3–4 → II, T5–6 → III.
  const e = CATALOG_BY_ID[blueprintId];
  return e ? (e.tier >= 5 ? 3 : e.tier >= 3 ? 2 : 1) : 1;
}

// ── Reward bands ─────────────────────────────────────────────────────────

/** Base fee (sh) at tier I, before jumps, tier multiplier and standing. */
export const REWARD_BASE: Record<ContractKind, number> = {
  courier: 520,
  haul: 380,
  escort: 1500,
  bounty: 2300,
  patrol: 1350,
  salvage: 1650,
  recon: 1900,
  sortie: 5200,
  priority: 0,
};
const PER_JUMP: Record<ContractKind, number> = { courier: 460, haul: 340, escort: 0, bounty: 300, patrol: 280, salvage: 300, recon: 320, sortie: 300, priority: 0 };
export const TIER_MUL: Record<Tier, number> = { 1: 1, 2: 1.75, 3: 2.8 };
const REP_BASE: Record<ContractKind, number> = { courier: 2, haul: 2, escort: 3, bounty: 4, patrol: 3, salvage: 3, recon: 4, sortie: 6, priority: 0 };

/** Fee: base + per-jump + (haul) cargo value share, × tier, × standing (−12 % … +25 %). */
export function contractFee(kind: ContractKind, tier: Tier, jumps: number, rep: number, cargoValue = 0): number {
  const raw = (REWARD_BASE[kind] + PER_JUMP[kind] * jumps + cargoValue * 0.1) * TIER_MUL[tier];
  return round50(raw * (1 + clamp(rep, -50, 100) / 400));
}

export function contractRep(kind: ContractKind, tier: Tier): number {
  return Math.round(REP_BASE[kind] * (1 + 0.5 * (tier - 1)) * 10) / 10;
}

function duration(kind: ContractKind, tier: Tier, jumps: number): number {
  switch (kind) {
    case 'courier':
      return Math.round((300 + 240 * jumps) * (tier === 3 ? 0.8 : 1));
    case 'haul':
      return 480 + 300 * jumps;
    case 'escort':
      return 900;
    case 'sortie':
      return 900 + 300 * jumps;
    case 'recon':
      return 1500 + 300 * jumps;
    default:
      return 1200 + 300 * jumps;
  }
}

// ── Clients ──────────────────────────────────────────────────────────────

export interface Client extends Character {
  faction: EconFaction;
  /** Station kinds they post from, and the jobs they post. */
  posts: StationKind[];
  kinds: ContractKind[];
}

const c = (
  id: string,
  callsign: string,
  name: string,
  role: string,
  faction: EconFaction,
  voice: string,
  portrait: Character['portrait'],
  commsColor: string,
  posts: StationKind[],
  kinds: ContractKind[],
): Client => ({ id, callsign, name, role, faction, voice, portrait, commsColor, posts, kinds });

/** Named clients (portraits drawn by the comms portrait generator). */
export const CLIENTS: Client[] = [
  // ── Terran Directorate ──
  c('cl-halloran', 'ALLOCATION', 'Quartermaster Ines Halloran', 'Board of Allocation, Castellan ring', 'concord', 'Counts in grams, thanks nobody, pays to the share.',
    { skin: '#efd0b4', hair: '#3a2c2a', eyes: '#4a6a9a', suit: '#2b4ea8', hairStyle: 'bob', accessory: 'glasses', seed: 1101 }, '#7dffb2',
    ['orbital', 'refinery', 'bastion'], ['courier', 'haul', 'escort']),
  c('cl-okafor', 'LANTERN WATCH', 'Picket Captain Delphine Okafor', 'Lantern Watch, MCDF picket command', 'concord', 'Clipped, tired, fair. Has buried pilots and says so.',
    { skin: '#6e452c', hair: '#141418', eyes: '#d8a040', suit: '#1f2f5a', hairStyle: 'shaved', accessory: 'headset', seed: 1102 }, '#56c8ff',
    ['bastion', 'orbital'], ['patrol', 'bounty', 'recon', 'sortie', 'escort']),
  c('cl-moss', 'CONTINUITY', 'Auditor Arvid Moss', 'Office of Continuity', 'concord', 'Soft voice, hard eyes. Never says what is in the case.',
    { skin: '#e8c8a8', hair: '#c8ccd0', eyes: '#6a7a8a', suit: '#26252e', hairStyle: 'swept', accessory: 'none', seed: 1103 }, '#b8e07a',
    ['orbital', 'bastion', 'refinery'], ['courier', 'recon']),
  c('cl-tey', 'TEY WORKS', 'Foreman Bram Tey-Hollis', 'Tey refinery, fourth generation', 'concord', 'Big laugh, bigger ledger. Treats Ebon like family silver.',
    { skin: '#c98e5e', hair: '#8a4a22', eyes: '#3a5a4a', suit: '#b0643a', hairStyle: 'short', accessory: 'scar', seed: 1104 }, '#ffc46b',
    ['refinery', 'orbital'], ['haul', 'escort', 'salvage']),
  c('cl-pell', 'KEEPING', 'Warden-Sister Maudie Pell', 'Order of the Keeping, Cloister salvage', 'concord', 'Gentle, unhurried, absolutely immovable about the dead.',
    { skin: '#f0d8c0', hair: '#e8e4dc', eyes: '#8a6a3a', suit: '#7a5a3a', hairStyle: 'long', accessory: 'none', seed: 1105 }, '#e8d27a',
    ['salvage', 'bastion', 'orbital'], ['salvage', 'courier', 'patrol']),
  c('cl-albescu', 'YARDMASTER', 'Yardmaster Kenji Albescu', 'Anchorage fleet yards', 'concord', 'Talks to hulls. Swears in torque values.',
    { skin: '#d9b08c', hair: '#26283a', eyes: '#4fb0a0', suit: '#eceae4', hairStyle: 'spiky', accessory: 'headset', seed: 1106 }, '#7dffb2',
    ['bastion', 'salvage', 'refinery'], ['haul', 'escort', 'salvage', 'bounty']),
  // ── Zenith Hegemony ──
  c('cl-vell', 'MEASURE', 'Cantor-Adjutant Seraphine Vell', 'The Choir, Treaty Line Measure', 'choir', 'Sings her orders a half-tone flat when she is angry. Be witnessed.',
    { skin: '#f6dcc6', hair: '#b56bff', eyes: '#ff5fb4', suit: '#1d1a26', hairStyle: 'long', accessory: 'visor', seed: 1201 }, '#ff5fb4',
    ['bastion', 'orbital', 'refinery'], ['bounty', 'patrol', 'recon', 'escort']),
  c('cl-masse', 'TREASURY', 'Tithe-Clerk Oriel Masse', 'Treasury of the Hegemony, Tessaly', 'choir', 'Prays over invoices. Means both.',
    { skin: '#e6c09a', hair: '#1f1a26', eyes: '#c98bff', suit: '#3b2f5a', hairStyle: 'ponytail', accessory: 'glasses', seed: 1202 }, '#e07ad0',
    ['refinery', 'orbital', 'freeport'], ['haul', 'courier', 'escort']),
  c('cl-carrow', 'GARDENS', 'Gardener-Abbess Lune Carrow', 'Foundry-gardens of Hesper', 'choir', 'Warm, precise, curious about everything the Directorate throws away.',
    { skin: '#caa07e', hair: '#2e5a3a', eyes: '#9fffb0', suit: '#5d4a86', hairStyle: 'swept', accessory: 'none', seed: 1203 }, '#c9a6ff',
    ['orbital', 'freeport', 'refinery'], ['haul', 'salvage', 'courier']),
  // ── Rustwake Clans ──
  c('cl-ferrow', 'THE MOOT', 'Moot-Speaker Ada Ferrow', 'Speaker of the Moot-Hold', 'rustwake', 'Loud enough to win a vote alone. Debts in grams, favours in blood.',
    { skin: '#b87a4a', hair: '#d14b1f', eyes: '#ffd21f', suit: '#6b4a2c', hairStyle: 'spiky', accessory: 'eyepatch', seed: 1301 }, '#ffae4f',
    ['freeport', 'salvage', 'refinery'], ['bounty', 'escort', 'patrol', 'courier']),
  c('cl-rusk', 'TINKER', 'Tobiah "Tinker" Rusk', 'Scrapjack breaker crew boss', 'rustwake', 'Grins at wrecks. Can price a hull from its silhouette.',
    { skin: '#d9a47a', hair: '#4a4f5a', eyes: '#6fe6ff', suit: '#8a5a2a', hairStyle: 'short', accessory: 'headset', seed: 1302 }, '#ffc46b',
    ['salvage', 'freeport'], ['salvage', 'haul', 'bounty']),
  c('cl-ashgrove', 'SKIMMER', 'Skim-Captain Nell Ashgrove', 'Ember skim-tender Long Haul Home', 'rustwake', 'Sings haul-songs off-key over the band. Pays early, which is suspicious.',
    { skin: '#f0d2b8', hair: '#f2efe6', eyes: '#b56bff', suit: '#b0643a', hairStyle: 'ponytail', accessory: 'scar', seed: 1303 }, '#ffd27a',
    ['refinery', 'freeport', 'orbital'], ['haul', 'escort', 'recon', 'courier']),
  c('cl-oyelaran', 'HAUL-SONG', 'Dima Oyelaran', 'Freeport broker, channel nine', 'rustwake', 'Knows everyone’s price. Lower than yours.',
    { skin: '#5a3a26', hair: '#1a1410', eyes: '#e8a23a', suit: '#2c231c', hairStyle: 'bob', accessory: 'glasses', seed: 1304 }, '#ffc46b',
    ['freeport', 'orbital', 'salvage'], ['courier', 'haul', 'recon', 'bounty']),
];

export function clientById(id: string): Client | undefined {
  return CLIENTS.find((x) => x.id === id);
}

/** Named raiders for bounty boards. */
const MARKS: { name: string; blueprint: string; faction: 'rustwake' | 'concord' | 'choir'; note: string }[] = [
  { name: "Hollis 'Ninefingers' Crane", blueprint: 'rw-scrapjack', faction: 'rustwake', note: 'Outlawed by the Moot for selling clan routes to both Boards.' },
  { name: 'Red Sabine', blueprint: 'rw-scrapjack', faction: 'rustwake', note: 'Paints her kills on the hull. The hull is running out of room.' },
  { name: 'The Brothers Vey', blueprint: 'rw-scrapjack', faction: 'rustwake', note: 'Two cutters, one grudge, no clan that will have them.' },
  { name: 'Ottoline Gutter-Crown', blueprint: 'rw-scrapjack', faction: 'rustwake', note: 'Crowned herself queen of a dead freighter. Taxes anyone who passes.' },
  { name: 'Corporal Aldo Skerry', blueprint: 'vf27-kestrel', faction: 'concord', note: 'Deserter. Took a Kestrel, eleven grams of Ebon and the picket’s coffee.' },
  { name: 'Unwitnessed Ismene', blueprint: 'choir-cantor', faction: 'choir', note: 'A Cantor who stopped singing. The Choir wants the silence ended.' },
];

export function markId(name: string): string {
  return `mark-${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** Comms characters for the bounty marks (they talk on open bands). */
export const MARK_CAST: Character[] = MARKS.map((m, i) => {
  const h = hashStr(m.name);
  const hairs = ['#d14b1f', '#e8e4dc', '#26283a', '#7a2a2a', '#b56bff', '#141418'];
  const styles: Character['portrait']['hairStyle'][] = ['spiky', 'long', 'shaved', 'swept', 'ponytail', 'short'];
  const acc: NonNullable<Character['portrait']['accessory']>[] = ['eyepatch', 'scar', 'none', 'scar', 'visor', 'eyepatch'];
  return {
    id: markId(m.name),
    callsign: m.name.toUpperCase(),
    name: m.name,
    role: m.faction === 'rustwake' ? 'Outlaw — no clan, no Moot' : m.faction === 'concord' ? 'Deserter, MCDF' : 'Unwitnessed',
    faction: m.faction,
    voice: m.note,
    portrait: {
      skin: ['#e8c4a0', '#b87a4a', '#6b4228', '#f0d2b8'][h % 4],
      hair: hairs[i % hairs.length],
      eyes: ['#ff5f7a', '#ffd21f', '#9fffb0'][h % 3],
      suit: m.faction === 'choir' ? '#1d1a26' : m.faction === 'concord' ? '#6c737e' : '#34151c',
      hairStyle: styles[i % styles.length],
      accessory: acc[i % acc.length],
      seed: 1400 + i,
    },
    commsColor: '#ff5f7a',
  };
});

const FREIGHTERS = ['Patient Ox', 'Good Allocation', 'Ninth Measure', 'Long Haul Home', 'Saint Brannoc', 'Pennywhistle', 'Kept Promise', 'Amber Tithe', 'Slow Mercy', 'Harrow Queen'];

// ── RNG / helpers ────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function round50(v: number): number {
  return Math.max(50, Math.round(v / 50) * 50);
}
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r1 = (v: number) => Math.round(v);
const roundV = (v: V3): V3 => [r1(v[0]), r1(v[1]), r1(v[2])];

/** Horizontal-ish unit vector perpendicular to `n`. */
function lateral(n: V3, rnd: () => number): V3 {
  const side: V3 = [-n[2], 0, n[0]];
  const l = Math.hypot(side[0], side[2]) || 1;
  const s = rnd() < 0.5 ? -1 : 1;
  return [(side[0] / l) * s, (rnd() - 0.5) * 0.3, (side[2] / l) * s];
}

export function systemIndex(reach: ReachMap): Map<string, ReachSystem> {
  return new Map(reach.systems.map((s) => [s.id, s]));
}

/** Gate hops from `from` to every reachable system. */
export function hops(reach: ReachMap, from: string): Map<string, number> {
  const idx = systemIndex(reach);
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const g of idx.get(cur)?.gates ?? []) {
      if (d.has(g.to) || !idx.has(g.to)) continue;
      d.set(g.to, d.get(cur)! + 1);
      q.push(g.to);
    }
  }
  return d;
}

export function findStation(reach: ReachMap, id: string): { station: ReachStation; system: ReachSystem } | null {
  for (const system of reach.systems) {
    const station = system.stations.find((s) => s.id === id);
    if (station) return { station, system };
  }
  return null;
}

// ── Board generation ─────────────────────────────────────────────────────

export interface BoardInput {
  reach: ReachMap;
  /** The station whose board this is. */
  station: string;
  /** Board clock (s). */
  clock: number;
  /** Player standing per faction. */
  rep: Record<EconFaction, number>;
  /** Player ship tier. */
  tier: Tier;
  goods: readonly Good[];
  /** Pending campaign episode (Directorate stations post it as priority orders). */
  priority?: { episode: number; title: string; tagline: string } | null;
}

const KIND_WEIGHTS: Record<StationKind, Partial<Record<ContractKind, number>>> = {
  refinery: { haul: 3, courier: 2, escort: 3, bounty: 1, patrol: 1, salvage: 0.5, recon: 0.4 },
  salvage: { salvage: 4, haul: 2, courier: 1, escort: 1, bounty: 1.2, patrol: 0.6 },
  bastion: { patrol: 3, bounty: 3, recon: 2, courier: 1, escort: 1, salvage: 0.6, sortie: 0.5 },
  freeport: { courier: 3, haul: 2, bounty: 2, escort: 2, salvage: 1, recon: 1 },
  orbital: { courier: 3, haul: 3, escort: 2, patrol: 1, recon: 0.6, bounty: 0.6, sortie: 0.25 },
  carrier: { patrol: 2, bounty: 2, recon: 2, sortie: 0.6 },
  surface: { courier: 3, haul: 3, escort: 1 },
};

/** What a station kind ships out as bulk consignments. */
const EXPORTS: Record<StationKind, CommodityId[]> = {
  refinery: ['ebon', 'ebon', 'cores'],
  salvage: ['relics', 'spares', 'spares'],
  bastion: ['munitions', 'rations'],
  freeport: ['luxury', 'relics', 'spares', 'medical'],
  orbital: ['rations', 'medical', 'luxury'],
  carrier: ['munitions'],
  surface: ['spares', 'munitions'],
};

function weighted<T extends string>(w: Partial<Record<T, number>>, rnd: () => number): T {
  const entries = Object.entries(w) as [T, number][];
  let total = 0;
  for (const [, v] of entries) total += v;
  let r = rnd() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function boardEpoch(clock: number): number {
  return Math.floor(Math.max(0, clock) / BOARD_PERIOD);
}

/** Standing bucket that seeds a board (new work opens every 20 points). */
export function repBucket(rep: number): number {
  return Math.floor(clamp(rep, -100, 100) / 20);
}

/** Which tiers a station will offer this pilot (ship tier ± 1, gated by standing). */
export function tierFor(roll: number, shipT: Tier, rep: number): Tier {
  let t = shipT + (roll < 0.25 ? -1 : roll < 0.8 ? 0 : 1);
  t = clamp(t, 1, 3);
  if (t === 3 && rep < 20) t = 2;
  if (t >= 2 && rep < -20) t = 1;
  return t as Tier;
}

/**
 * The board at `station` right now: priority orders first (Directorate
 * stations, while an episode is pending), then 2–6 seeded offers.
 */
export function generateBoard(input: BoardInput): Contract[] {
  const found = findStation(input.reach, input.station);
  if (!found) return [];
  const { station, system } = found;
  const rep = input.rep[station.faction] ?? 0;
  const epoch = boardEpoch(input.clock);
  const bucket = repBucket(rep);
  const key = `${station.id}#${epoch}.${bucket}.${input.tier}`;
  const rnd = mulberry32(hashStr(key));
  const out: Contract[] = [];
  if (input.priority && station.faction === 'concord') out.push(priorityOrders(station, system, input.priority, input.clock));
  if (rep <= -50) return out;
  let n = 3 + Math.floor(rnd() * 3) + (station.kind === 'freeport' || station.kind === 'bastion' ? 1 : 0);
  if (rep < -20) n = Math.min(n, 2);
  const ctx: GenCtx = { input, station, system, rep, rnd, hops: hops(input.reach, system.id), idx: systemIndex(input.reach), epoch };
  const weights = { ...KIND_WEIGHTS[station.kind] };
  // Sorties: Directorate stations only, trusted pilots in capable ships.
  if (station.faction !== 'concord' || rep < 30 || input.tier < 2) delete weights.sortie;
  for (let k = 0; k < n; k++) {
    const kind = weighted(weights, rnd);
    const tier = tierFor(rnd(), input.tier, rep);
    const made = makeContract(ctx, kind, tier, `${key}.${k}`);
    if (made) out.push(made);
    if (kind === 'sortie') delete weights.sortie; // one per board at most
  }
  return out;
}

/**
 * One offer of `kind` at `input.station`, seeded by `key` (the same key always
 * makes the same job). Guild boards compose their own boards from this.
 */
export function makeOffer(input: BoardInput, kind: ContractKind, tier: Tier, key: string): Contract | null {
  const found = findStation(input.reach, input.station);
  if (!found) return null;
  const { station, system } = found;
  const rep = input.rep[station.faction] ?? 0;
  const rnd = mulberry32(hashStr(key));
  const ctx: GenCtx = { input, station, system, rep, rnd, hops: hops(input.reach, system.id), idx: systemIndex(input.reach), epoch: boardEpoch(input.clock) };
  return makeContract(ctx, kind, tier, key);
}

interface GenCtx {
  input: BoardInput;
  station: ReachStation;
  system: ReachSystem;
  rep: number;
  rnd: () => number;
  hops: Map<string, number>;
  idx: Map<string, ReachSystem>;
  epoch: number;
}

function pickClient(g: GenCtx, kind: ContractKind): Client {
  const pool = CLIENTS.filter((x) => x.faction === g.station.faction && x.kinds.includes(kind));
  const local = pool.filter((x) => x.posts.includes(g.station.kind));
  const from = local.length ? local : pool.length ? pool : CLIENTS.filter((x) => x.faction === g.station.faction);
  return from[Math.floor(g.rnd() * from.length)] ?? CLIENTS[0];
}

/** Systems `min..max` jumps away (optionally filtered), nearest first. */
function systemsWithin(g: GenCtx, min: number, max: number, ok: (s: ReachSystem) => boolean = () => true): ReachSystem[] {
  const out: ReachSystem[] = [];
  for (const [id, h] of g.hops) {
    if (h < min || h > max) continue;
    const s = g.idx.get(id);
    if (s && s.faction !== 'unknown' && ok(s)) out.push(s);
  }
  return out.sort((a, b) => g.hops.get(a.id)! - g.hops.get(b.id)! || a.id.localeCompare(b.id));
}

function pick<T>(a: readonly T[], rnd: () => number): T | undefined {
  return a.length ? a[Math.floor(rnd() * a.length)] : undefined;
}

/** A point inside a system near one of its Lanterns, `d` metres in, offset to the side. */
function nearGate(s: ReachSystem, rnd: () => number, dMin: number, dMax: number): V3 {
  const gate = s.gates[Math.floor(rnd() * s.gates.length)] ?? { pos: [0, 0, 0] as V3, normal: [0, 0, 1] as V3, to: '' };
  const d = dMin + rnd() * (dMax - dMin);
  const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
  const lat = lateral(gate.normal, rnd);
  return roundV(add(add(gate.pos, inward, d), lat, (rnd() * 0.8 + 0.3) * d * 0.6));
}

function enemyFor(s: ReachSystem, rnd: () => number): ContractOp['enemy'] {
  if (s.faction === 'choir' && rnd() < 0.6) return { blueprint: 'choir-cantor', faction: 'choir', name: 'Measure Cantor' };
  return { blueprint: 'rw-scrapjack', faction: 'rustwake', name: rnd() < 0.5 ? 'Raider' : 'Scav Cutter' };
}

function makeContract(g: GenCtx, kind: ContractKind, tier: Tier, id: string): Contract | null {
  const { station, system, rnd, rep } = g;
  const client = pickClient(g, kind);
  const base = {
    id,
    kind,
    tier,
    client: client.id,
    faction: station.faction,
    origin: station.id,
    originName: station.name,
    originSystem: system.id,
    payAt: station.id,
    payAtName: station.name,
    payAtSystem: system.id,
    expires: (g.epoch + 1) * BOARD_PERIOD,
    state: 'offered' as const,
  };
  const hostiles = tier + 1;
  const seed = Math.floor(rnd() * 1e9);
  const finish = (c: Omit<Contract, 'reward' | 'rep' | 'penalty' | 'repPenalty' | 'duration' | 'title' | 'brief'>, cargoValue = 0): Contract => {
    const reward = contractFee(kind, tier, c.jumps, rep, cargoValue);
    const gain = contractRep(kind, tier);
    const full: Contract = {
      ...c,
      title: '',
      brief: '',
      reward,
      rep: gain,
      penalty: round50(reward * 0.3),
      repPenalty: Math.round(gain * 15) / 10,
      duration: duration(kind, tier, c.jumps),
    };
    full.title = titleOf(full, g.idx);
    full.brief = briefOf(full, client, g.idx, rnd);
    return full;
  };

  switch (kind) {
    case 'courier':
    case 'haul': {
      const far = systemsWithin(g, 1, 3, (s) => s.stations.length > 0);
      const cands: { s: ReachStation; sys: ReachSystem }[] = [];
      for (const sys of far) for (const s of sys.stations) cands.push({ s, sys });
      if (!cands.length) for (const s of system.stations) if (s.id !== station.id) cands.push({ s, sys: system });
      // Nearer destinations are likelier.
      cands.sort((a, b) => g.hops.get(a.sys.id)! - g.hops.get(b.sys.id)!);
      const d = cands[Math.floor(Math.pow(rnd(), 1.6) * cands.length)];
      if (!d) return null;
      const jumps = g.hops.get(d.sys.id) ?? 0;
      const courier = kind === 'courier';
      let cargo: Contract['cargo'];
      let value = 0;
      if (!courier) {
        const cid = pick(EXPORTS[station.kind], rnd) ?? 'rations';
        const good = g.input.goods.find((x) => x.id === cid) ?? g.input.goods[0];
        if (!good) return null;
        const units = Math.max(2, Math.min(12, Math.round((3 + tier * 2 + rnd() * 3) * (good.base > 900 ? 0.5 : 1))));
        cargo = { id: good.id, units, name: good.name, unit: good.unit };
        value = units * good.base;
      }
      const ambush = tier >= 2;
      return finish(
        {
          ...base,
          dest: d.s.id,
          destName: d.s.name,
          destSystem: d.sys.id,
          payAt: d.s.id,
          payAtName: d.s.name,
          payAtSystem: d.sys.id,
          cargo,
          jumps,
          op: ambush ? { system: d.sys.id, center: d.s.pos, hostiles: tier, waves: 1, enemy: enemyFor(d.sys, rnd), seed } : undefined,
        },
        value,
      );
    }
    case 'escort': {
      // A lane inside the client's system: incoming at a Lantern → a gate station, or a gate station → out through its Lantern.
      const gateStations = system.stations.filter((s) => s.planet === undefined);
      const nearestGate = (p: V3) => [...system.gates].sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
      let start: V3;
      let end: V3;
      let endKind: 'gate' | 'station';
      let endName: string;
      const home = gateStations.find((s) => s.id === station.id) ?? pick(gateStations, rnd);
      if (!home || !system.gates.length) return null;
      const gate = nearestGate(home.pos);
      const gName = g.idx.get(gate.to)?.name ?? gate.to;
      const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
      const bay = add(home.pos, home.axis, 2600);
      if (rnd() < 0.5) {
        start = add(gate.pos, inward, 900);
        end = bay;
        endKind = 'station';
        endName = home.name;
      } else {
        start = bay;
        end = add(gate.pos, inward, 500);
        endKind = 'gate';
        endName = `${gName} Lantern`;
      }
      const f = pick(FREIGHTERS, rnd)!;
      const blueprint = station.faction === 'choir' ? 'choir-vesper' : station.faction === 'rustwake' ? 'rw-scrapjack' : 'ffc-lantern-guard';
      return finish({
        ...base,
        jumps: 0,
        op: {
          system: system.id,
          center: roundV(start),
          start: roundV(start),
          end: roundV(end),
          endKind,
          endName,
          hostiles,
          waves: tier === 1 ? 1 : 2,
          enemy: enemyFor(system, rnd),
          freighter: { name: f, blueprint },
          seed,
        },
      });
    }
    case 'bounty': {
      const where = pick(systemsWithin(g, 0, 2, (s) => s.gates.length > 0 && (s.threat >= 0.25 || s.faction === 'rustwake' || s.faction === 'contested')), rnd) ?? system;
      // Rustwake outlaws are fair game everywhere; deserters only on their own side's boards.
      const mark = pick(MARKS.filter((m) => m.faction === 'rustwake' || m.faction === station.faction), rnd) ?? MARKS[0];
      return finish({
        ...base,
        jumps: g.hops.get(where.id) ?? 0,
        op: {
          system: where.id,
          center: nearGate(where, rnd, 6000, 12000),
          hostiles: tier,
          waves: 1,
          enemy: { blueprint: mark.faction === 'rustwake' ? 'rw-scrapjack' : mark.blueprint, faction: mark.faction, name: 'Wing' },
          mark: { id: markId(mark.name), name: mark.name, blueprint: mark.blueprint, faction: mark.faction },
          seed,
        },
      });
    }
    case 'patrol': {
      const where = pick(systemsWithin(g, 0, 1, (s) => s.gates.length > 0), rnd) ?? system;
      const center = nearGate(where, rnd, 5000, 9000);
      const n = tier === 1 ? 3 : 4;
      const a0 = rnd() * Math.PI * 2;
      const waypoints: V3[] = [];
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const r = 3000 + rnd() * 1500;
        waypoints.push(roundV([center[0] + Math.cos(a) * r, center[1] + (rnd() - 0.5) * 800, center[2] + Math.sin(a) * r]));
      }
      return finish({ ...base, jumps: g.hops.get(where.id) ?? 0, op: { system: where.id, center, waypoints, hostiles, waves: 1, enemy: enemyFor(where, rnd), seed } });
    }
    case 'salvage': {
      const where = pick(systemsWithin(g, 0, 2, (s) => s.gates.length > 0), rnd) ?? system;
      return finish({
        ...base,
        jumps: g.hops.get(where.id) ?? 0,
        op: { system: where.id, center: nearGate(where, rnd, 7000, 13000), hostiles: tier, waves: tier >= 2 ? 1 : 0, enemy: enemyFor(where, rnd), wreck: tier >= 2 ? 'derelict' : 'wreckage', hold: 6 + tier * 2, seed },
      });
    }
    case 'recon': {
      const risky = systemsWithin(g, 1, 2, (s) => s.gates.length > 0 && (s.threat >= 0.35 || s.faction === 'choir' || s.faction === 'contested') && s.faction !== station.faction);
      const where = pick(risky, rnd) ?? pick(systemsWithin(g, 1, 2, (s) => s.gates.length > 0), rnd);
      if (!where) return null;
      return finish({
        ...base,
        jumps: g.hops.get(where.id) ?? 0,
        op: { system: where.id, center: nearGate(where, rnd, 8000, 14000), hostiles: tier + 1, waves: 1, enemy: enemyFor(where, rnd), hold: 16 + tier * 6, seed },
      });
    }
    case 'sortie': {
      const front =
        systemsWithin(g, 0, 3, (s) => s.faction === 'contested' && s.gates.length > 0)[0] ??
        systemsWithin(g, 1, 3, (s) => s.faction === 'choir' && s.gates.length > 0)[0];
      if (!front) return null;
      const made = finish({
        ...base,
        jumps: g.hops.get(front.id) ?? 0,
        op: { system: front.id, center: nearGate(front, rnd, 6000, 10000), hostiles: 2 + tier, waves: tier === 3 ? 3 : 2, enemy: { blueprint: 'choir-cantor', faction: 'choir', name: 'Measure Cantor' }, seed },
      });
      made.enemy = { faction: 'choir', rep: -Math.round(made.rep) };
      return made;
    }
    default:
      return null;
  }
}

function priorityOrders(station: ReachStation, system: ReachSystem, p: { episode: number; title: string; tagline: string }, clock: number): Contract {
  const ep = String(p.episode).padStart(2, '0');
  return {
    id: `priority:ep${ep}`,
    kind: 'priority',
    tier: 1,
    client: 'kade',
    faction: 'concord',
    title: `EPISODE ${ep} — ${p.title}`,
    brief: [
      `Four-One-Three. Abbess. The squadron is recalled; the flight line wants us inside the hour.`,
      `"${p.tagline}" That is all the Board would put in writing. The rest is under seal until you are strapped in.`,
      `Finish what you are carrying if you can. Accept these orders and we go now. Keep the light.`,
    ].join('\n\n'),
    origin: station.id,
    originName: station.name,
    originSystem: system.id,
    payAt: station.id,
    payAtName: station.name,
    payAtSystem: system.id,
    reward: 0,
    rep: 0,
    penalty: 0,
    repPenalty: 0,
    duration: 0,
    expires: clock + BOARD_PERIOD * 100,
    jumps: 0,
    state: 'offered',
    episode: p.episode,
  };
}

// ── Words ────────────────────────────────────────────────────────────────

function sysName(idx: Map<string, ReachSystem>, id: string | undefined): string {
  return (id && idx.get(id)?.name) || id || '';
}

function titleOf(k: Contract, idx: Map<string, ReachSystem>): string {
  const op = k.op;
  switch (k.kind) {
    case 'courier':
      return `Sealed case to ${k.destName}`;
    case 'haul':
      return `${k.cargo!.units} × ${k.cargo!.name} to ${k.destName}`;
    case 'escort':
      return `See the ${op!.freighter!.name} to ${op!.endKind === 'gate' ? 'the ' : ''}${op!.endName}`;
    case 'bounty':
      return `Bounty: ${op!.mark!.name}`;
    case 'patrol':
      return `Sweep ${op!.waypoints!.length} nav points, ${sysName(idx, op!.system)}`;
    case 'salvage':
      return `Recover a flight core, ${sysName(idx, op!.system)}`;
    case 'recon':
      return `Eyes on ${sysName(idx, op!.system)}`;
    case 'sortie':
      return `Sortie: break a Measure at ${sysName(idx, op!.system)}`;
    default:
      return k.title;
  }
}

const VOICE: Record<EconFaction, { open: string[]; close: string[] }> = {
  concord: {
    open: ['By allocation of the Board:', 'Directorate tasking, open to independent pilots.', 'The Schedule has a gap in it, pilot. You fill it.'],
    close: ['Keep the light.', 'Fee is budgeted. Expenditure is not.', 'Sign here, and here. The Office of Continuity thanks you.'],
  },
  choir: {
    open: ['Be witnessed, pilot of the Directorate.', 'The Altitude does not hire. The Treasury, however, pays.', '(sung) A small work, for a small price, gladly given.'],
    close: ['Ascend.', 'Be witnessed.', 'Payment is a prayer. Ours are always answered.'],
  },
  rustwake: {
    open: ['Word on channel nine, flyer:', 'The Moot put this up. The Moot pays in shares, grams or favours — your pick.', 'Honest work, which is to say, it is about the gas.'],
    close: ['Nothing in the black is ever truly lost.', 'Do it clean and there is more.', 'Owe us nothing and we are friends.'],
  },
};

function briefOf(k: Contract, cl: Client, idx: Map<string, ReachSystem>, rnd: () => number): string {
  const v = VOICE[cl.faction];
  const open = pick(v.open, rnd)!;
  const close = pick(v.close, rnd)!;
  const op = k.op;
  const where = op ? sysName(idx, op.system) : '';
  const hops = k.jumps === 0 ? 'in this system' : k.jumps === 1 ? 'one Lantern out' : `${k.jumps} Lanterns out`;
  let body: string;
  switch (k.kind) {
    case 'courier':
      body = `A sealed case — do not open it, do not scan it, do not ask. Deliver it to ${k.destName} in ${sysName(idx, k.destSystem)}, ${hops}. The consignee pays on receipt.${k.tier >= 2 ? ' Someone else knows it is moving. Expect company at the far end.' : ''}`;
      break;
    case 'haul':
      body = `A consignment of ${k.cargo!.units} × ${k.cargo!.name.toLowerCase()} goes into your pod here and come out at ${k.destName}, ${hops}. Every unit is counted at both ends. Sell one on the way and it is theft, and we will know.${k.tier >= 2 ? ' Raiders have been sniffing the lanes for loaded pods.' : ''}`;
      break;
    case 'escort':
      body = `The ${op!.freighter!.name} runs ${op!.endKind === 'gate' ? `out to the ${op!.endName}` : `in to ${op!.endName}`}. She cannot fight and she cannot run. Fly close, keep the raiders off her hull, and come back here for your fee. ${op!.waves > 1 ? 'Expect them twice.' : 'Expect them once.'}`;
      break;
    case 'bounty': {
      const m = MARKS.find((x) => x.name === op!.mark!.name);
      body = `${op!.mark!.name}. ${m?.note ?? ''} Last seen near a Lantern in ${where}, ${hops}, flying with ${op!.hostiles} ${op!.hostiles === 1 ? 'wingman' : 'wingmen'}. Dead is the only proof we accept. Report back here to be paid.`;
      break;
    }
    case 'patrol':
      body = `${op!.waypoints!.length} nav points off the Lantern in ${where}. Fly them in order, look at everything, and clear whatever is hiding in the rocks. Pickets are thin this quarter; you are the picket.`;
      break;
    case 'salvage':
      body = `A ${op!.wreck === 'derelict' ? 'golden-age hull, turning in its own radiation' : 'fresh debris field from a lane ambush'} in ${where}, ${hops}. Survey it, find the flight core and bring it home. The dead keep their own; we only want what they remember.${k.tier >= 2 ? ' Scavengers will be listening for the core beacon.' : ''}`;
      break;
    case 'recon':
      body = `We need eyes in ${where}. Fly to the observation point and hold for ${op!.hold} seconds of clean recording. They will notice. When they come, break contact — get twelve kilometres clear or put them down — and bring the tape home.`;
      break;
    case 'sortie':
      body = `Engagement off-Schedule in ${where}, ${hops}. A Choir Measure is pressing the picket. Rendezvous with our flight at the rally point and break them: ${op!.hostiles * op!.waves} fighters. This one is not in anybody's budget. The Hegemony will remember your face.`;
      break;
    default:
      body = '';
  }
  return `${open}\n\n${body}\n\n${close}`;
}

// ── The book: accept, decline, settle, lapse ─────────────────────────────

export function newBook(): ContractBook {
  return { clock: 0, active: [], seen: [], completed: 0, failed: 0, earned: 0, log: [] };
}

/** Repair a book loaded from storage (drops malformed contracts). */
export function normaliseBook(raw: unknown): ContractBook {
  const b = newBook();
  if (!raw || typeof raw !== 'object') return b;
  const r = raw as Partial<ContractBook>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  b.clock = Math.max(0, n(r.clock, 0));
  b.completed = Math.max(0, n(r.completed, 0));
  b.failed = Math.max(0, n(r.failed, 0));
  b.earned = n(r.earned, 0);
  b.seen = Array.isArray(r.seen) ? r.seen.filter((s): s is string => typeof s === 'string').slice(-120) : [];
  b.log = Array.isArray(r.log) ? r.log.filter((x) => x && typeof x === 'object' && typeof x.id === 'string').slice(-12) : [];
  b.active = Array.isArray(r.active)
    ? r.active.filter((x): x is Contract => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.kind === 'string' && typeof x.payAt === 'string' && (x.state === 'active' || x.state === 'ready'))
    : [];
  return b;
}

function cloneBook(b: ContractBook): ContractBook {
  return { ...b, active: b.active.map((x) => ({ ...x })), seen: [...b.seen], log: [...b.log] };
}

function cloneLedger(l: TradeLedger): TradeLedger {
  return { ...l, cargo: { ...l.cargo }, rep: { ...l.rep } };
}

function cargoUsed(l: TradeLedger): number {
  let n = 0;
  for (const v of Object.values(l.cargo)) n += v ?? 0;
  return n;
}

function seen(b: ContractBook, id: string): void {
  if (!b.seen.includes(id)) b.seen.push(id);
  if (b.seen.length > 120) b.seen.splice(0, b.seen.length - 120);
}

function logIt(b: ContractBook, r: Receipt): void {
  b.log.push(r);
  if (b.log.length > 12) b.log.shift();
}

/** Board minus what this pilot already took or turned down. */
export function openOffers(board: readonly Contract[], book: ContractBook): Contract[] {
  return board.filter((x) => x.kind === 'priority' || (!book.seen.includes(x.id) && !book.active.some((a) => a.id === x.id)));
}

export interface BookResult {
  book: ContractBook;
  ledger: TradeLedger;
  error?: string;
  receipts?: Receipt[];
}

/**
 * Take a job. Haul consignments go into the cargo pod now (they count against
 * capacity and show in the hold). Priority orders are not booked: the host
 * starts the episode.
 */
export function acceptContract(book: ContractBook, ledger: TradeLedger, offer: Contract): BookResult {
  if (offer.kind === 'priority') return { book, ledger };
  if (book.active.some((x) => x.id === offer.id)) return { book, ledger, error: 'ALREADY ACCEPTED' };
  if (book.active.length >= MAX_ACTIVE) return { book, ledger, error: `CONTRACT SLOTS FULL (${MAX_ACTIVE})` };
  if (offer.expires <= book.clock) return { book, ledger, error: 'OFFER LAPSED' };
  const l = cloneLedger(ledger);
  if (offer.cargo) {
    const free = l.capacity - cargoUsed(l);
    if (free < offer.cargo.units) return { book, ledger, error: `CARGO POD: NEED ${offer.cargo.units}, ${Math.max(0, free)} FREE` };
    l.cargo[offer.cargo.id] = (l.cargo[offer.cargo.id] ?? 0) + offer.cargo.units;
  }
  const b = cloneBook(book);
  b.active.push({ ...offer, state: 'active', acceptedAt: b.clock, due: b.clock + offer.duration });
  seen(b, offer.id);
  return { book: b, ledger: l };
}

export function declineContract(book: ContractBook, id: string): ContractBook {
  const b = cloneBook(book);
  seen(b, id);
  return b;
}

/** Apply a failure: fee penalty (never below zero shares), standing, consignment repossessed. */
function failInto(b: ContractBook, l: TradeLedger, k: Contract, result: Receipt['result']): Receipt {
  const charge = Math.min(l.credits, k.penalty);
  l.credits -= charge;
  l.rep[k.faction] = clamp(l.rep[k.faction] - k.repPenalty, -100, 100);
  if (k.cargo) {
    const have = l.cargo[k.cargo.id] ?? 0;
    const back = Math.min(have, k.cargo.units);
    if (have - back > 0) l.cargo[k.cargo.id] = have - back;
    else delete l.cargo[k.cargo.id];
  }
  b.active = b.active.filter((x) => x.id !== k.id);
  b.failed++;
  const r: Receipt = { id: k.id, title: k.title, result, amount: -charge, rep: -k.repPenalty, faction: k.faction, at: b.clock };
  logIt(b, r);
  return r;
}

export function abandonContract(book: ContractBook, ledger: TradeLedger, id: string): BookResult {
  const k = book.active.find((x) => x.id === id);
  if (!k) return { book, ledger, error: 'NO SUCH CONTRACT' };
  const b = cloneBook(book);
  const l = cloneLedger(ledger);
  const r = failInto(b, l, k, 'abandoned');
  return { book: b, ledger: l, receipts: [r] };
}

/** Fail a contract in flight (freighter lost, …). */
export function failContract(book: ContractBook, ledger: TradeLedger, id: string): BookResult {
  const k = book.active.find((x) => x.id === id);
  if (!k) return { book, ledger };
  const b = cloneBook(book);
  const l = cloneLedger(ledger);
  const r = failInto(b, l, k, 'failed');
  return { book: b, ledger: l, receipts: [r] };
}

/** The in-space part is done: return to the client for the fee. */
export function markReady(book: ContractBook, id: string): ContractBook {
  const b = cloneBook(book);
  const k = b.active.find((x) => x.id === id);
  if (k && k.state === 'active' && k.kind !== 'courier' && k.kind !== 'haul') k.state = 'ready';
  return b;
}

/** Can this contract be turned in at `stationId` right now? */
export function payableAt(k: Contract, stationId: string, ledger: TradeLedger): boolean {
  if (k.payAt !== stationId) return false;
  if (k.kind === 'courier') return k.state === 'active';
  if (k.kind === 'haul') return k.state === 'active' && (ledger.cargo[k.cargo!.id] ?? 0) >= k.cargo!.units;
  return k.state === 'ready';
}

/** Docked at `stationId`: pay every contract that can be turned in here. */
export function settleAt(book: ContractBook, ledger: TradeLedger, stationId: string, only?: string): BookResult {
  const due = book.active.filter((k) => (!only || k.id === only) && payableAt(k, stationId, ledger));
  if (!due.length) return { book, ledger, receipts: [] };
  const b = cloneBook(book);
  const l = cloneLedger(ledger);
  const receipts: Receipt[] = [];
  for (const k of due) {
    if (k.cargo) {
      const left = (l.cargo[k.cargo.id] ?? 0) - k.cargo.units;
      if (left > 0) l.cargo[k.cargo.id] = left;
      else delete l.cargo[k.cargo.id];
    }
    l.credits += k.reward;
    l.rep[k.faction] = clamp(l.rep[k.faction] + k.rep, -100, 100);
    if (k.enemy) l.rep[k.enemy.faction] = clamp(l.rep[k.enemy.faction] + k.enemy.rep, -100, 100);
    b.active = b.active.filter((x) => x.id !== k.id);
    b.completed++;
    b.earned += k.reward;
    const r: Receipt = { id: k.id, title: k.title, result: 'paid', amount: k.reward, rep: k.rep, faction: k.faction, at: b.clock };
    logIt(b, r);
    receipts.push(r);
  }
  return { book: b, ledger: l, receipts };
}

/**
 * Advance the board clock; active contracts past their deadline lapse
 * (penalty applied). Contracts already `ready` have no deadline — the fee
 * waits for you.
 */
export function tickBook(book: ContractBook, ledger: TradeLedger, dt: number): BookResult {
  const clock = book.clock + Math.max(0, dt);
  const late = book.active.filter((k) => k.state === 'active' && k.due !== undefined && k.due <= clock);
  if (!late.length) {
    book.clock = clock; // hot path: no allocation
    return { book, ledger };
  }
  const b = cloneBook(book);
  b.clock = clock;
  const l = cloneLedger(ledger);
  const receipts = late.map((k) => failInto(b, l, k, 'lapsed'));
  return { book: b, ledger: l, receipts };
}

/** The system the pilot should head for next with this contract. */
export function nextSystem(k: Contract): string {
  if (k.state === 'ready') return k.payAtSystem;
  if (k.op && (k.kind !== 'courier' && k.kind !== 'haul')) return k.op.system;
  return k.payAtSystem;
}

/** One-line status for the HUD / board. */
export function statusLine(k: Contract, currentSystem: string, sysName: (id: string) => string): string {
  if (k.state === 'ready') return `RETURN TO ${k.payAtName.toUpperCase()}${k.payAtSystem !== currentSystem ? ` · ${sysName(k.payAtSystem).toUpperCase()}` : ''} FOR PAYMENT`;
  if (k.kind === 'courier' || k.kind === 'haul') return `DELIVER TO ${k.payAtName.toUpperCase()}${k.payAtSystem !== currentSystem ? ` · ${sysName(k.payAtSystem).toUpperCase()}` : ''}`;
  if (k.op && k.op.system !== currentSystem) return `PROCEED TO ${sysName(k.op.system).toUpperCase()}`;
  return 'IN PROGRESS';
}

export function formatClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
