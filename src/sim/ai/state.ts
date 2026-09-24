import { Vector3 } from 'three';
import type { ShipEntity } from '../Fleet';
import { createPilotState, type PilotState, type SteerGains } from './Pilot';

/**
 * Per-ship AI state. Stored in `ShipEntity.brain`; this module is the only
 * place that knows its shape. Plain data, allocated once per ship.
 */

/** Wingman orders (M13 squadron command). */
export type Order = 'formUp' | 'attackMyTarget' | 'engageAtWill' | 'coverMe' | 'breakAndAttack';

export type FormationKind = 'fingerFour' | 'echelonRight' | 'echelonLeft' | 'lineAbreast';

/** What the ship is doing right now (one active maneuver at a time). */
export type Maneuver =
  | 'form' // hold formation slot on the leader
  | 'patrol' // no target: cruise / rejoin
  | 'pursue' // chase + lead-shoot
  | 'headOn' // nose-to-nose firing pass
  | 'break' // max-rate turn into an attacker on our tail
  | 'jink' // evasive roll + pitch oscillation
  | 'barrelRoll' // evasive corkscrew
  | 'immelmann' // pull through a half loop, roll upright → reversed heading
  | 'splitS' // half roll inverted, pull through → reversed heading
  | 'extend' // boom-and-zoom: burn away to open range before re-engaging
  | 'scatter'; // breakAndAttack opening: split from formation under burner

/** Personality. All 0..1 except reaction (seconds). */
export interface Personality {
  /** Presses attacks, closes to short range, favours the player, ignores threats longer. */
  aggression: number;
  /** Aim accuracy, trigger discipline, steering sharpness, maneuver choice. */
  skill: number;
  /** Perception latency, seconds (applied to what the pilot sees, never to physics). */
  reaction: number;
}

export const PERSONALITIES = {
  ace: { aggression: 0.75, skill: 0.95, reaction: 0.12 },
  veteran: { aggression: 0.55, skill: 0.75, reaction: 0.2 },
  rookie: { aggression: 0.4, skill: 0.35, reaction: 0.4 },
  /** Choir Cantors: fearless, sharp, a little slow to read a fight. */
  zealot: { aggression: 0.9, skill: 0.65, reaction: 0.25 },
} satisfies Record<string, Personality>;

export interface Brain {
  readonly kind: 'fighter';
  personality: Personality;
  gains: SteerGains;
  pilot: PilotState;
  /** Fly this ship even if it is the player's (demo / autopilot). */
  autopilot: boolean;
  /**
   * Another system writes this ship's controls (ambient traffic on its lane,
   * a raider's strafing run): `updateAI` skips it until this is cleared.
   */
  scripted: boolean;

  // ── squadron ───────────────────────────────────────────────────────
  order: Order;
  leader: ShipEntity | null;
  formation: FormationKind;
  slotIndex: number;
  spacing: number;
  /** Slot offset in the formation frame (left = +X, up = +Y, fwd = +Z, like a ship body). */
  slot: Vector3;
  /**
   * Formation frame "up": the leader's up vector, low-passed. Slots hang off
   * the leader's heading plus this, so a leader's quick aileron roll doesn't
   * fling wingmen round a corkscrew — they bank with sustained turns only.
   */
  formUp: Vector3;
  formUpInit: boolean;

  // ── maneuver ───────────────────────────────────────────────────────
  maneuver: Maneuver;
  maneuverT: number;
  maneuverMax: number;
  phase: number;
  /** Maneuver reference (entry heading, break / scatter direction). */
  refDir: Vector3;
  refUp: Vector3;
  /** Accumulated roll angle within a maneuver phase (rad). */
  rollAccum: number;
  /** +1 / −1: handedness for rolls and jinks. */
  sense: number;
  threat: ShipEntity | null;
  nextThink: number;
  /** Deterministic RNG state (mulberry32). */
  rng: number;

  // ── perception of the current target (lagged by `reaction`) ─────────
  perceivedId: number;
  pPos: Vector3;
  pVel: Vector3;
  pAcc: Vector3;
  lastTVel: Vector3;
  /** Current lead / aim point (world) — HUD, debug lines. */
  aim: Vector3;
  noisePhase: number;
  /** Collision-avoidance urgency on the last flown frame (0..1): strafing runs on a capital break off when it rises. */
  urgency: number;
}

export function gainsFor(p: Personality): SteerGains {
  return { kp: 3.5 + 3 * p.skill, kd: 0.35, bank: 1, authority: 0.8 + 0.2 * p.skill };
}

export function createBrain(seed: number, p: Personality = PERSONALITIES.veteran): Brain {
  return {
    kind: 'fighter',
    personality: { ...p },
    gains: gainsFor(p),
    pilot: createPilotState(),
    autopilot: false,
    scripted: false,
    order: 'engageAtWill',
    leader: null,
    formation: 'fingerFour',
    slotIndex: 0,
    spacing: 40,
    slot: new Vector3(),
    formUp: new Vector3(0, 1, 0),
    formUpInit: false,
    maneuver: 'patrol',
    maneuverT: 0,
    maneuverMax: Infinity,
    phase: 0,
    refDir: new Vector3(0, 0, 1),
    refUp: new Vector3(0, 1, 0),
    rollAccum: 0,
    sense: 1,
    threat: null,
    nextThink: 0,
    rng: (seed * 2654435761) >>> 0 || 1,
    perceivedId: -1,
    pPos: new Vector3(),
    pVel: new Vector3(),
    pAcc: new Vector3(),
    lastTVel: new Vector3(),
    aim: new Vector3(),
    noisePhase: (seed * 1.618) % (Math.PI * 2),
    urgency: 0,
  };
}

export function isBrain(b: unknown): b is Brain {
  return typeof b === 'object' && b !== null && (b as Brain).kind === 'fighter';
}

/** Capital ships are not flown by the fighter brain (their turrets are). */
export function isCapital(s: ShipEntity): boolean {
  return s.radius > 60;
}

/** The ship's brain, created on first use (personality by faction). */
export function brainOf(s: ShipEntity): Brain {
  if (isBrain(s.brain)) return s.brain;
  // Seeded from the ship's own stream (world seed × id), not the bare id: a
  // different world seed flies different dice, the same seed the same ones.
  const b = createBrain(s.rng ? s.rng.fork('brain').seed : s.id, s.faction === 'choir' ? PERSONALITIES.zealot : PERSONALITIES.veteran);
  s.brain = b;
  return b;
}

export function setPersonality(s: ShipEntity, p: Personality): void {
  const b = brainOf(s);
  b.personality = { ...p };
  b.gains = gainsFor(p);
}

/** mulberry32 — deterministic, allocation-free. Returns [0, 1). */
export function rand(b: Brain): number {
  let t = (b.rng = (b.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function setManeuver(b: Brain, m: Maneuver, duration = Infinity): void {
  b.maneuver = m;
  b.maneuverT = 0;
  b.maneuverMax = duration;
  b.phase = 0;
  b.rollAccum = 0;
}
