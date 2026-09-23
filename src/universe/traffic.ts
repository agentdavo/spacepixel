import { Vector3 } from 'three';
import type { Livery } from '../assets/Blueprint';
import type { CommodityId, EconFaction, StationKind, TradeLedger } from '../game/economy';
import type { StarSystem } from './Universe';

/**
 * The Reach's traffic, as data and pure functions of (seed, system, clock).
 *
 * Every system has a lane graph — Lanterns, stations and the belt as nodes —
 * and every lane has a timetable: sailing k departs at a hashed time inside
 * its slot, flies slow for the first/last few km (departure, approach) and
 * fast in between (lane cruise). So "what is on the lanes right now" is a
 * pure function of the clock: the runtime (`world/Traffic.ts`) only
 * materialises the sailings near the player, and a sailing that leaves and
 * re-enters range comes back exactly where the timetable says.
 *
 * Hull choices are DATA: `TRAFFIC_ROLES[role].hulls[faction]` lists blueprint
 * ids in preference order and the runtime flies the first one that exists —
 * add a civilian design (e.g. `civ-freighter`) to the blueprint registry or a
 * shipyard catalog and it is picked up with no code change here.
 *
 * Units: metres / seconds, system-local positions (StarSystemView adds SYSTEM_OFFSET).
 */

export type TrafficRole = 'freighter' | 'tanker' | 'liner' | 'courier' | 'miner' | 'patrol' | 'pirate';

export interface RoleDef {
  label: string;
  /** Blueprint ids by flag, preferred first (future civilian ids first, existing designs as fallback). */
  hulls: Record<EconFaction, string[]>;
  /** Civilian paint over the flag's livery (optional per flag). */
  livery?: Partial<Record<EconFaction, Partial<Livery>>>;
  /** Manoeuvring speed near nodes (m/s). */
  speed: number;
  /** Lane cruise between nodes (m/s). */
  laneSpeed: number;
  hull: number;
  shield: number;
  /** Manifest pool. */
  cargo: CommodityId[];
  /** Wing size for patrols / pirate bands [min, max]. */
  wing?: [number, number];
  /** Registry prefix on the hail card. */
  prefix: string;
}

const HAULER_PAINT: Partial<Record<EconFaction, Partial<Livery>>> = {
  concord: { primary: '#d9d3c4', secondary: '#8a3b2a', accent: '#ffcf3a' },
  choir: { primary: '#6b5a8e', secondary: '#2a2238', accent: '#ffc2ea' },
  rustwake: { primary: '#9a6a44', secondary: '#4f5b3a', accent: '#ffd21f' },
};

export const TRAFFIC_ROLES: Record<TrafficRole, RoleDef> = {
  freighter: {
    label: 'freighter',
    hulls: { concord: ['civ-freighter', 'ffc-lantern-guard'], choir: ['civ-freighter', 'choir-vesper'], rustwake: ['civ-freighter', 'rw-hauler', 'sb9-warhorse'] },
    livery: HAULER_PAINT,
    speed: 110,
    laneSpeed: 1700,
    hull: 420,
    shield: 120,
    cargo: ['rations', 'spares', 'medical', 'munitions', 'relics', 'luxury'],
    prefix: 'FV',
  },
  tanker: {
    label: 'Ebon tanker',
    hulls: { concord: ['civ-tanker', 'ffc-lantern-guard'], choir: ['civ-tanker', 'choir-vesper'], rustwake: ['civ-tanker', 'sb9-warhorse'] },
    livery: { concord: { primary: '#e8e2d2', secondary: '#3b2a5a', accent: '#b77bff' }, choir: HAULER_PAINT.choir, rustwake: { primary: '#6e5a4a', secondary: '#2f2a3e', accent: '#b77bff' } },
    speed: 90,
    laneSpeed: 1400,
    hull: 500,
    shield: 160,
    cargo: ['ebon'],
    prefix: 'TK',
  },
  liner: {
    label: 'liner',
    hulls: { concord: ['civ-liner', 'ffc-lantern-guard'], choir: ['civ-liner', 'choir-vesper'], rustwake: ['civ-liner', 'ffc-lantern-guard'] },
    livery: { concord: { primary: '#f4f1ea', secondary: '#1f6f8a', accent: '#ff7a1c' }, choir: { primary: '#e8dcf4', secondary: '#5d4a86', accent: '#ff3fa8' }, rustwake: HAULER_PAINT.rustwake },
    speed: 140,
    laneSpeed: 2400,
    hull: 360,
    shield: 200,
    cargo: ['luxury', 'medical'],
    prefix: 'LN',
  },
  courier: {
    label: 'courier',
    hulls: { concord: ['civ-courier', 'vf31-harrier'], choir: ['civ-courier', 'choir-psalter'], rustwake: ['civ-courier', 'rw-scrapjack'] },
    speed: 200,
    laneSpeed: 3000,
    hull: 110,
    shield: 70,
    cargo: ['medical', 'cores', 'luxury', 'relics'],
    prefix: 'CR',
  },
  miner: {
    label: 'ore miner',
    hulls: { concord: ['civ-miner', 'sb9-warhorse'], choir: ['civ-miner', 'choir-psalter'], rustwake: ['civ-miner', 'sb9-warhorse'] },
    livery: HAULER_PAINT,
    speed: 80,
    laneSpeed: 1100,
    hull: 260,
    shield: 60,
    cargo: ['spares', 'relics'],
    prefix: 'MN',
  },
  patrol: {
    label: 'patrol',
    hulls: { concord: ['vf27-kestrel'], choir: ['choir-cantor'], rustwake: ['rw-scrapjack'] },
    speed: 180,
    laneSpeed: 900,
    hull: 100,
    shield: 60,
    cargo: ['munitions'],
    wing: [2, 4],
    prefix: 'PK',
  },
  pirate: {
    label: 'raider',
    hulls: { concord: ['rw-scrapjack'], choir: ['rw-scrapjack'], rustwake: ['rw-scrapjack'] },
    livery: { rustwake: { primary: '#3a3230', secondary: '#7a1f1f', accent: '#ff4a2a' } },
    speed: 200,
    laneSpeed: 1200,
    hull: 100,
    shield: 50,
    cargo: ['munitions'],
    wing: [2, 3],
    prefix: '',
  },
};

export const CARGO_LABEL: Record<CommodityId, string> = {
  ebon: 'Ebon-gas',
  relics: 'fossil relics',
  cores: 'reactor cores',
  spares: 'machine spares',
  rations: 'rations',
  munitions: 'munitions',
  medical: 'medical stores',
  luxury: 'luxuries',
};

const NAMES: Record<EconFaction, string[]> = {
  concord: ['Patient Ledger', 'Good Allocation', 'Keep the Light', "Hollis's Promise", 'Grams to Spare', 'Twelfth Winter', 'Candle Years', 'Honest Weight', 'Counted Blessing', 'Service Resumes', 'Quota Maid', 'Seventh Keeping', 'Tey Standard', 'Allocation Hour', 'Sealed Heart', 'Ration Day'],
  choir: ['Seventh Intonation', 'Hymn-Carrier', 'Ascendant Tallow', 'Glass Canticle', 'Foundry Psalm', 'Matins Bell', 'Prime Interval', 'Rising Fourth', 'Vigil of Hesper', 'Quiet Choir', 'Spire-Bound', 'Descant'],
  rustwake: ['Nothing Lost', 'Scrap Heaven', 'Dregs & Glory', 'Salvage Right', 'Old Grudge', 'Barter Queen', 'Ember Daughter', 'Both Paints', 'Loud Moot', 'Haul-Song', 'Second Hand', 'Found Money', 'Unlisted', 'Sweet Dross'],
};
const PIRATE_BANDS = ['Blackwake', 'Red Tithe', 'Dross Kings', 'Cinder Jacks', 'Lampless'];

// ── hashing ─────────────────────────────────────────────────────────────

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Deterministic 0..1 from integers. */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function pickW<T>(u: number, items: readonly [T, number][]): T {
  let r = u * items.reduce((s, x) => s + x[1], 0);
  for (const [it, w] of items) if ((r -= w) <= 0) return it;
  return items[items.length - 1][0];
}

// ── lane graph ──────────────────────────────────────────────────────────

export interface TrafficNode {
  kind: 'gate' | 'station' | 'belt';
  /** Gate: destination system id · station: station id · belt: 'belt'. */
  id: string;
  name: string;
  /** System-local metres: gate centre, a point off the station's bay, belt centre. */
  position: Vector3;
  faction: EconFaction | null;
  stationKind?: StationKind;
  /** Gates: unit normal (fly through along +normal to leave). */
  normal?: Vector3;
}

export interface TrafficLane {
  index: number;
  /** Per-(seed, system, lane) hash salt: every roll on this lane keys off it. */
  salt: number;
  from: TrafficNode;
  to: TrafficNode;
  length: number;
  /** Mean seconds between departures. */
  period: number;
  phase: number;
  roles: [TrafficRole, number][];
  /** Flag weights for civilian sailings. */
  flags: [EconFaction, number][];
  kind: 'arrival' | 'departure' | 'transit' | 'local' | 'mining' | 'patrol';
}

const KIND_MIX: Record<StationKind, [TrafficRole, number][]> = {
  orbital: [['liner', 3], ['freighter', 4], ['courier', 2], ['tanker', 1]],
  refinery: [['tanker', 5], ['freighter', 2], ['courier', 1]],
  salvage: [['freighter', 4], ['courier', 1], ['miner', 1]],
  freeport: [['freighter', 4], ['courier', 2], ['tanker', 1], ['liner', 1]],
  bastion: [['courier', 3], ['freighter', 2], ['tanker', 1]],
  carrier: [['courier', 1]],
};
const KIND_WEIGHT: Record<StationKind, number> = { orbital: 1.4, freeport: 1.25, refinery: 1.0, salvage: 0.85, bastion: 0.55, carrier: 0.3 };

/** Traffic volume multiplier by system holder (fewer sailings where it's dangerous). */
export function systemVolume(sys: Pick<StarSystem, 'faction' | 'threat'>): number {
  const base = sys.faction === 'concord' ? 1 : sys.faction === 'choir' ? 0.85 : sys.faction === 'rustwake' ? 0.95 : sys.faction === 'contested' ? 0.65 : 0.18;
  return base * (1 - 0.3 * sys.threat);
}

/** Lawless / border: where Rustwake raiders work the lanes (0..1). */
export function piracy(sys: Pick<StarSystem, 'faction' | 'threat'>): number {
  if (sys.faction === 'rustwake') return 0.22;
  if (sys.faction === 'contested') return 0.34;
  if (sys.faction === 'concord') return sys.threat > 0.25 ? 0.06 : 0;
  return 0;
}

function sysFlag(sys: StarSystem): EconFaction {
  return sys.faction === 'concord' || sys.faction === 'choir' || sys.faction === 'rustwake' ? sys.faction : 'rustwake';
}

/** The belt beside the first Lantern (mirrors StarSystemView's placement). */
export function beltCentre(sys: StarSystem): Vector3 | null {
  const g0 = sys.gates[0];
  if (!g0) return null;
  const side = new Vector3(0, 1, 0).cross(g0.normal).normalize();
  return g0.position.clone().addScaledVector(g0.normal, -4500).addScaledVector(side, 7000);
}

/** Lanes of one system, deterministic from (seed, id). */
export function systemLanes(seed: number, sys: StarSystem): TrafficLane[] {
  const vol = systemVolume(sys);
  const flag = sysFlag(sys);
  const gates: TrafficNode[] = sys.gates.map((g) => ({ kind: 'gate', id: g.to, name: `Lantern → ${g.to}`, position: g.position.clone(), faction: null, normal: g.normal.clone() }));
  const stations: TrafficNode[] = sys.stations.map((st) => ({
    kind: 'station',
    id: st.id,
    name: st.name,
    position: st.position.clone().addScaledVector(st.axis, 1400),
    faction: st.faction,
    stationKind: st.kind,
  }));
  const bc = beltCentre(sys);
  const belt: TrafficNode | null = bc ? { kind: 'belt', id: 'belt', name: 'the belt', position: bc, faction: null } : null;
  const lanes: TrafficLane[] = [];
  const add = (from: TrafficNode, to: TrafficNode, period: number, roles: [TrafficRole, number][], flags: [EconFaction, number][], kind: TrafficLane['kind']) => {
    const index = lanes.length;
    const salt = hashStr(`${seed}:${sys.id}:${index}`);
    lanes.push({ index, salt, from, to, length: from.position.distanceTo(to.position), period: period / Math.max(0.05, vol), phase: hash01(salt, index, 7) * period, roles, flags, kind });
  };
  const flagsFor = (st: TrafficNode): [EconFaction, number][] => {
    const f = st.faction ?? flag;
    return f === 'rustwake' ? [['rustwake', 1]] : [[f, 3], ['rustwake', 1]];
  };
  for (const st of stations) {
    const k = st.stationKind ?? 'freeport';
    for (const g of gates) {
      const p = (58 / KIND_WEIGHT[k]) * Math.sqrt(gates.length);
      add(g, st, p, KIND_MIX[k], flagsFor(st), 'arrival');
      add(st, g, p * 1.1, KIND_MIX[k], flagsFor(st), 'departure');
    }
  }
  for (let i = 0; i < gates.length; i++)
    for (let j = 0; j < gates.length; j++) {
      if (i === j) continue;
      add(gates[i], gates[j], 120, [['liner', 3], ['courier', 3], ['freighter', 3], ['tanker', 1]], [[flag, 2], ['rustwake', 1], [flag === 'choir' ? 'concord' : 'choir', sys.faction === 'contested' ? 1 : 0.2]], 'transit');
    }
  for (let i = 0; i < stations.length; i++)
    for (let j = 0; j < stations.length; j++) {
      if (i === j) continue;
      add(stations[i], stations[j], 180, [['freighter', 3], ['tanker', 2], ['courier', 1]], flagsFor(stations[i]), 'local');
    }
  if (belt)
    for (const st of stations) {
      if (st.stationKind !== 'salvage' && st.stationKind !== 'refinery' && st.stationKind !== 'freeport') continue;
      add(st, belt, 150, [['miner', 1]], flagsFor(st), 'mining');
      add(belt, st, 160, [['miner', 1]], flagsFor(st), 'mining');
    }
  // Patrols: out from the bastion (or first Lantern) to each Lantern.
  const home = stations.find((s) => s.stationKind === 'bastion') ?? stations.find((s) => s.faction === 'rustwake') ?? null;
  const pf: EconFaction = home?.faction ?? flag;
  const origin = home ?? gates[0];
  if (origin && sys.faction !== 'unknown') {
    for (const g of gates) {
      if (g === origin) continue;
      add(origin, g, 300, [['patrol', 1]], [[pf, 1]], 'patrol');
      add(g, origin, 320, [['patrol', 1]], [[pf, 1]], 'patrol');
    }
  }
  return lanes;
}

// ── timetable ───────────────────────────────────────────────────────────

export interface Sailing {
  /** Stable id: `${system}:${lane}:${k}`. */
  key: string;
  lane: TrafficLane;
  k: number;
  depart: number;
  duration: number;
  role: TrafficRole;
  flag: EconFaction;
  hash: number;
}

function slowZone(lane: TrafficLane): number {
  return Math.min(3200, lane.length * 0.3);
}

export function sailingDuration(lane: TrafficLane, role: TrafficRole): number {
  const r = TRAFFIC_ROLES[role];
  const d0 = slowZone(lane);
  return (2 * d0) / r.speed + Math.max(0, lane.length - 2 * d0) / r.laneSpeed;
}

export function sailing(sysId: string, lane: TrafficLane, k: number): Sailing {
  const h = hash01(lane.salt, k, 5);
  const role = pickW(hash01(lane.salt, k, 11), lane.roles);
  const flag = pickW(hash01(lane.salt, k, 13), lane.flags);
  return { key: `${sysId}:${lane.index}:${k}`, lane, k, depart: lane.phase + (k + 0.8 * h) * lane.period, duration: sailingDuration(lane, role), role, flag, hash: h };
}

/** Every sailing under way at `clock` (departed, not yet arrived). */
export function sailingsAt(sysId: string, lanes: readonly TrafficLane[], clock: number, out: Sailing[] = []): Sailing[] {
  out.length = 0;
  for (const lane of lanes) {
    const maxDur = (2 * 3200) / 80 + lane.length / 900 + 1; // bound on any role's duration
    const k0 = Math.floor((clock - lane.phase - maxDur) / lane.period) - 1;
    const k1 = Math.floor((clock - lane.phase) / lane.period);
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const s = sailing(sysId, lane, k);
      if (clock >= s.depart && clock < s.depart + s.duration) out.push(s);
    }
  }
  return out;
}

/** Next arrival at a gate node after `clock` (for the HUD's arrivals board). */
export function nextArrivals(sysId: string, lanes: readonly TrafficLane[], gateId: string, clock: number, n = 3): Sailing[] {
  const list: Sailing[] = [];
  for (const lane of lanes) {
    if (lane.from.kind !== 'gate' || lane.from.id !== gateId) continue;
    const k0 = Math.max(0, Math.floor((clock - lane.phase) / lane.period));
    for (let k = k0; k < k0 + 3; k++) {
      const s = sailing(sysId, lane, k);
      if (s.depart >= clock) list.push(s);
    }
  }
  return list.sort((a, b) => a.depart - b.depart).slice(0, n);
}

/** Distance flown along the lane and current speed, `t` seconds after departure. */
export function laneProgress(lane: TrafficLane, role: TrafficRole, t: number): { dist: number; speed: number; cruising: boolean } {
  const r = TRAFFIC_ROLES[role];
  const d0 = slowZone(lane);
  const t0 = d0 / r.speed;
  const mid = Math.max(0, lane.length - 2 * d0);
  const t1 = t0 + mid / r.laneSpeed;
  if (t <= t0) return { dist: Math.max(0, t) * r.speed, speed: r.speed, cruising: false };
  if (t <= t1) return { dist: d0 + (t - t0) * r.laneSpeed, speed: r.laneSpeed, cruising: true };
  return { dist: Math.min(lane.length, d0 + mid + (t - t1) * r.speed), speed: r.speed, cruising: false };
}

export function lanePoint(lane: TrafficLane, dist: number, out = new Vector3()): Vector3 {
  const k = lane.length > 0 ? Math.min(1, Math.max(0, dist / lane.length)) : 0;
  return out.copy(lane.from.position).lerp(lane.to.position, k);
}

// ── manifests, names, ambushes ──────────────────────────────────────────

export interface Manifest {
  name: string;
  registry: string;
  cargo: { id: CommodityId; label: string; tons: number }[];
}

export function manifest(s: Sailing): Manifest {
  const def = TRAFFIC_ROLES[s.role];
  const u = (n: number) => hash01(s.lane.salt ^ 0x5bd1e995, s.k * 131 + n, 101);
  const pool = NAMES[s.flag];
  const name = s.role === 'patrol' ? `${s.flag === 'choir' ? 'Measure' : s.flag === 'rustwake' ? 'Moot Watch' : 'Picket'} ${1 + (s.k % 9)}` : pool[Math.floor(u(1) * pool.length)];
  const registry = `${def.prefix}-${String(Math.floor(u(2) * 9000) + 1000)}`;
  const n = s.role === 'tanker' || s.role === 'patrol' ? 1 : 1 + Math.floor(u(3) * 3);
  const cargo: Manifest['cargo'] = [];
  for (let i = 0; i < n; i++) {
    const id = def.cargo[Math.floor(u(4 + i) * def.cargo.length)];
    if (cargo.some((c) => c.id === id)) continue;
    cargo.push({ id, label: CARGO_LABEL[id], tons: s.role === 'courier' ? 1 + Math.floor(u(9 + i) * 4) : 6 + Math.floor(u(9 + i) * 60) });
  }
  return { name, registry, cargo };
}

export interface AmbushPlan {
  /** Distance along the lane where the raiders strike. */
  at: number;
  raiders: number;
  band: string;
}

/** Deterministic: will raiders hit this sailing, and where? */
export function ambushOf(sys: Pick<StarSystem, 'faction' | 'threat'>, s: Sailing): AmbushPlan | null {
  if (s.role !== 'freighter' && s.role !== 'tanker' && s.role !== 'miner') return null;
  const rate = piracy(sys);
  if (rate <= 0 || hash01(s.lane.salt, s.k, 31) >= rate) return null;
  const d0 = slowZone(s.lane);
  const nearStart = hash01(s.lane.salt, s.k, 37) < 0.5;
  const off = d0 * (0.35 + hash01(s.lane.salt, s.k, 41) * 0.5);
  return {
    at: nearStart ? off : Math.max(0, s.lane.length - off),
    raiders: 2 + (hash01(s.lane.salt, s.k, 43) < 0.4 ? 1 : 0),
    band: PIRATE_BANDS[Math.floor(hash01(s.lane.salt, s.k, 47) * PIRATE_BANDS.length)],
  };
}

/** Wing size for a patrol sailing (leader included). */
export function wingSize(s: Sailing): number {
  const [a, b] = TRAFFIC_ROLES[s.role].wing ?? [1, 1];
  return a + Math.floor(hash01(s.lane.salt, s.k, 53) * (b - a + 1));
}

// ── summaries for the star map ──────────────────────────────────────────

export interface TrafficSummary {
  /** Sailings per hour, all lanes. */
  perHour: number;
  /** Per destination gate: sailings per hour through it. */
  byGate: Record<string, number>;
  patrol: EconFaction | null;
  piracy: number;
}

export function systemTraffic(seed: number, sys: StarSystem): TrafficSummary {
  const lanes = systemLanes(seed, sys);
  const byGate: Record<string, number> = {};
  let perHour = 0;
  let patrol: EconFaction | null = null;
  for (const l of lanes) {
    const ph = 3600 / l.period;
    perHour += ph;
    for (const n of [l.from, l.to]) if (n.kind === 'gate') byGate[n.id] = (byGate[n.id] ?? 0) + ph;
    if (l.kind === 'patrol') patrol = l.flags[0][0];
  }
  return { perHour, byGate, patrol, piracy: piracy(sys) };
}

// ── standing reward hook ────────────────────────────────────────────────

/**
 * Bounty for a broken ambush: shares per raider the player downed, plus a
 * standing bump with the victim's flag if the hauler lived. Pure: returns a
 * new ledger (callers persist it).
 */
export function ambushReward(l: TradeLedger, victim: EconFaction, raidersKilled: number, saved: boolean): { ledger: TradeLedger; credits: number; rep: number } {
  const credits = raidersKilled * 240 + (saved ? 450 : 0);
  const rep = (saved ? 4 : 0) + raidersKilled * 0.8;
  const rp = { ...l.rep, [victim]: Math.max(-100, Math.min(100, l.rep[victim] + rep)) };
  return { ledger: { ...l, credits: l.credits + credits, rep: rp }, credits, rep };
}
