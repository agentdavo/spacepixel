/**
 * Campaign data contract (narrative batch). Everything here is plain data +
 * small predicates, so the writing lives in data files and the runtime
 * (src/game/CampaignRunner.ts) stays small.
 *
 * Faction ids are internal and stable: 'concord' = Terran Directorate,
 * 'choir' = Zenith Hegemony, 'rustwake' = Ebon-gas scavenger clans,
 * 'unknown' = the Builders / anomalies.
 */
import type { FactionId } from '@/assets/Blueprint';

// ── Cast ──────────────────────────────────────────────────────────────

/** Parameters for a procedurally drawn anime comms portrait (no image assets). */
export interface PortraitSpec {
  skin: string;
  hair: string;
  eyes: string;
  /** Flight-suit / uniform colour. */
  suit: string;
  hairStyle: 'short' | 'long' | 'spiky' | 'bob' | 'shaved' | 'ponytail' | 'swept';
  /** Helmet visor down (face partly hidden), eyepatch, scar etc. */
  accessory?: 'visor' | 'eyepatch' | 'scar' | 'glasses' | 'headset' | 'none' | 'beard' | 'cap' | 'hood' | 'goggles';
  /** Deterministic variation seed. */
  seed: number;
}

export interface Character {
  id: string;
  callsign: string;
  name: string;
  role: string;
  faction: FactionId | 'unknown';
  /** One-line personality note for writers. */
  voice: string;
  portrait: PortraitSpec;
  /** Tint of their comms panel (Directorate green, Zenith magenta, …). */
  commsColor: string;
}

// ── Radio chatter ─────────────────────────────────────────────────────

export interface ChatterLine {
  /** Character id, or 'system' for ship computer / signal intercepts. */
  who: string;
  text: string;
  /** Seconds to wait after the previous line in the beat (default ~ reading time). */
  delay?: number;
  /** Render as a garbled intercept / static-laced transmission. */
  static?: boolean;
  /** Optional second-language (Japanese flavour) subtitle line. */
  jp?: string;
}

export type ChatterTrigger =
  | { on: 'start' }
  | { on: 'time'; at: number }
  | { on: 'objective-active'; objective: string }
  | { on: 'objective-done'; objective: string }
  | { on: 'kills'; faction: FactionId; count: number }
  | { on: 'near'; tag: string; distance: number }
  | { on: 'hull-low' }
  | { on: 'flag'; flag: string }
  | { on: 'jump' }
  | { on: 'success' }
  | { on: 'failure' };

export interface ChatterBeat {
  id: string;
  trigger: ChatterTrigger;
  lines: ChatterLine[];
  /** Higher interrupts lower-priority beats already playing. */
  priority?: number;
}

// ── Codex ─────────────────────────────────────────────────────────────

export interface CodexEntry {
  id: string;
  title: string;
  category: 'history' | 'factions' | 'technology' | 'people' | 'anomalies' | 'logs';
  /** Multi-paragraph literary text. Plain text; blank lines separate paragraphs. */
  body: string;
}

// ── Mission setup ─────────────────────────────────────────────────────

/** Where to place something, relative to the mission's anchor. */
export type Placement =
  | { at: 'player'; offset: [number, number, number] }
  | { at: 'gate'; gateIndex?: number; offset: [number, number, number] }
  | { at: 'tag'; tag: string; offset: [number, number, number] }
  /** Absolute universe position (free-roam contracts, which know the system's geometry). */
  | { at: 'point'; point: [number, number, number]; offset: [number, number, number] };

export interface SpawnSpec {
  /** Blueprint id (see src/assets/blueprints). */
  blueprint: string;
  faction: FactionId;
  count: number;
  place: Placement;
  /** Tag used by objectives/chatter (`ctx.alive('convoy')`). Numbered if count > 1. */
  tag?: string;
  /** Callsign / display name prefix. */
  name?: string;
  /** AI role. 'escort' ships fly a route to `routeTo` tag and must survive. */
  role?: 'hostile' | 'wing' | 'escort' | 'static' | 'capital';
  routeTo?: string;
  /** Seconds after mission start (reinforcement waves). */
  delay?: number;
  /** Spawn only when this flag is set. */
  whenFlag?: string;
}

export type SetPieceKind =
  | 'kessen-cameo' // presentation only: existing frames, no combat or objective effects
  | 'derelict' // pre-Shattering ghost ship in a radiation belt
  | 'blackbox' // recoverable data core (fly within 60 m to recover → sets flag `${tag}-recovered`)
  | 'monolith' // moon-sized Builder sphere
  | 'megagate' // intact pre-Shattering mega-gate (the Nexus)
  | 'nebula' // dense nebula volume: nav failure + visibility loss inside
  | 'bastion' // Directorate carrier fleet (can be destroyed in a scripted sequence)
  | 'wreckage' // debris field of a battle
  | 'beacon' // nav point / survey buoy
  | 'pilgrimage'; // the 2001-style solo sequence corridor

export interface SetPieceSpec {
  kind: SetPieceKind;
  tag: string;
  place: Placement;
  /** Free-form per-kind parameters (radius, state, colours…). */
  params?: Record<string, number | string | boolean>;
}

// ── Missions ──────────────────────────────────────────────────────────

/** Read-only view of the live mission the predicates test against. */
export interface CampaignContext {
  time: number;
  systemId: string;
  jumps: number;
  playerAlive: boolean;
  playerHull: number; // 0..1
  kills(faction: FactionId): number;
  /** Any ship or set piece with this tag (or tag prefix) alive/present? */
  alive(tag: string): boolean;
  /** How many tagged ships are alive. */
  aliveCount(tag: string): number;
  /** Hull fraction 0..1 of the named/tagged ship (min across a group). */
  hull(tag: string): number;
  /** Player distance (m) to a tagged ship/set piece, or Infinity. */
  distanceTo(tag: string): number;
  /** Named story flags set by set pieces, chatter or objectives. */
  flag(name: string): boolean;
  objectiveDone(id: string): boolean;
}

export interface CampaignObjective {
  id: string;
  text: string;
  /** Set-piece tag to mark while this visible objective is active. */
  navTag?: string;
  optional?: boolean;
  /** Hidden until activated (twists). */
  hidden?: boolean;
  done(ctx: CampaignContext): boolean;
  failed?(ctx: CampaignContext): boolean;
  /** Flag to set when this objective completes. */
  setsFlag?: string;
}

export interface CampaignMission {
  id: string;
  /** Chapter I–IV and running episode number (1..20). */
  chapter: 1 | 2 | 3 | 4;
  episode: number;
  title: string;
  /** Which narrative milestones (1..20) this mission delivers. */
  milestones: number[];
  /** Star system id in the generated universe, or a special id ('deadzone', 'monolith', 'nexus'). */
  system: string;
  /** Teletyped briefing (literary, in-world voice). */
  briefing: string;
  /** Short eyecatch subtitle shown on the episode title card. */
  tagline: string;
  objectives: CampaignObjective[];
  spawns: SpawnSpec[];
  setpieces: SetPieceSpec[];
  chatter: ChatterBeat[];
  /** Codex entries unlocked on success (or at start if listed in `codexOnStart`). */
  codex: string[];
  codexOnStart?: string[];
  /** Mission-wide modifiers. */
  modifiers?: {
    navDegraded?: boolean; // HUD nav/radar glitches (Dead Zone)
    noWingmen?: boolean; // solo missions
    timeLimit?: number; // seconds
    ambience?: 'normal' | 'sublime' | 'dread' | 'battle';
  };
  /** Debrief text shown on success. */
  debrief: string;
  /**
   * Free-roam docking (G) during this episode. Default false: story pacing
   * owns the episode unless the mission is about a station call.
   */
  allowDocking?: boolean;
}

export interface Campaign {
  title: string;
  cast: Character[];
  codex: CodexEntry[];
  missions: CampaignMission[];
}
