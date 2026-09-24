import type { FlightSpec } from '@/sim/FlightModel';
import { CATALOG_BY_ID, type CatalogEntry } from './catalog';

/**
 * Flight-model and camera parameters derived from the catalogue, so every
 * hull flies the same FlightModel with handling that scales with its size:
 * bigger = slower, lazier turns, more inertia (longer rate response), and a
 * chase camera that sits proportionally further back.
 *
 * Pure functions of catalogue data (plus a base spec for the fields the
 * catalogue does not describe, e.g. cruise drive and boost gauge).
 */

const DEG = Math.PI / 180;

/** FlightSpec for a catalogue entry, layered over `base` (normally KESTREL_SPEC). */
export function flightSpecFor(e: CatalogEntry, base: FlightSpec): FlightSpec {
  const s = e.stats;
  const L = Math.max(10, e.length);
  // Inertia: fighters converge body rates in ~30 ms; a 370 m frigate in ~0.6 s.
  const rateResponse = Math.max(1.6, Math.min(base.rateResponse, base.rateResponse * Math.pow(17 / L, 0.85)));
  const pitch = s.turn * DEG;
  return {
    ...base,
    maxSpeed: s.speed,
    boostSpeed: s.boost,
    mainAccel: s.accel,
    boostAccel: s.accel * (s.boost > s.speed * 1.6 ? 2.5 : 1.6),
    lateralAccel: s.accel * (L > 60 ? 0.6 : 1.15),
    pitchRate: pitch,
    yawRate: pitch * 0.6,
    rollRate: s.roll * DEG,
    rateResponse,
    // Big drives burn longer but recover slower.
    boostDrain: base.boostDrain * (L > 60 ? 0.6 : 1),
    boostRegen: base.boostRegen * (L > 60 ? 0.7 : 1),
    // Capital hulls spool the cruise drive longer.
    cruiseSpool: base.cruiseSpool * (L > 100 ? 2.2 : L > 40 ? 1.5 : 1),
  };
}

/**
 * Catalogue-driven spec by blueprint id for AI spawns — undefined for hulls
 * that aren't catalogued or that predate the shipyard (their sim spec rules).
 */
export function shipyardFlightSpec(blueprintId: string, base: FlightSpec): FlightSpec | undefined {
  const e = CATALOG_BY_ID[blueprintId];
  return e && !e.legacy ? flightSpecFor(e, base) : undefined;
}

/**
 * Bridge eye above / behind the bridge socket and the aim distance, as
 * fractions of hull length. Warships with a forward battery (`overBattery`)
 * ride higher and further back so the superfiring mount sits in the bottom
 * sixth of the frame, not the bottom third; merchant bridges (at the stern,
 * over a long flat deck) keep the low eye.
 */
export const BRIDGE_EYE = {
  battery: { up: 0.16, back: 0.08, lookAhead: 5 },
  deck: { up: 0.05, back: 0.03, lookAhead: 6 },
};

export interface ChaseFraming {
  /** Ship-frame camera offset, metres (behind = −Z). */
  offset: [number, number, number];
  lookAhead: number;
  speedPullback: number;
  /** Spring smooth times grow with mass so the frame "weighs" the hull. */
  posSmooth: number;
  lookSmooth: number;
  upSmooth: number;
  shake: number;
  /** Suggested near plane, metres. */
  near: number;
}

/**
 * Chase framing scaled to hull length — the Kestrel's (0, 5.2, −26) at 17 m
 * grows proportionally, with a gentle curve so a frigate isn't a speck.
 */
export function chaseFraming(lengthM: number): ChaseFraming {
  const k = Math.max(1, lengthM / 17);
  const back = 26 * Math.pow(k, 0.92);
  return {
    offset: [0, 5.2 * Math.pow(k, 0.95), -back],
    lookAhead: 90 * k,
    speedPullback: 5 * k,
    posSmooth: 0.16 * Math.min(4, Math.pow(k, 0.35)),
    lookSmooth: 0.09 * Math.min(4, Math.pow(k, 0.35)),
    upSmooth: 0.28 * Math.min(3, Math.pow(k, 0.3)),
    shake: 0.12 * Math.min(4, k),
    near: Math.max(0.3, lengthM * 0.01),
  };
}

/**
 * Bridge camera: an eye above and a little behind the bridge socket, looking
 * over the bow (the Yamato shot). With a forward battery the eye rides high
 * enough that the forward mounts (barrels trained up included, mostly) sit
 * low in the frame and the bow reads below the reticle. `bridge` is the
 * socket position in ship metres.
 */
export function bridgeFraming(bridge: [number, number, number], lengthM: number, overBattery = false): ChaseFraming {
  const base = chaseFraming(lengthM);
  const k = overBattery ? BRIDGE_EYE.battery : BRIDGE_EYE.deck;
  return {
    ...base,
    offset: [bridge[0], bridge[1] + lengthM * k.up, bridge[2] - lengthM * k.back],
    lookAhead: lengthM * k.lookAhead,
    speedPullback: 0,
    posSmooth: 0.05,
    lookSmooth: 0.12,
    upSmooth: 0.2,
    shake: 0.02 * lengthM * 0.01,
    near: 0.5,
  };
}

/** Does this hull have a forward battery the bridge looks over? */
export function hasBowBattery(e: CatalogEntry | undefined): boolean {
  return !!e?.hardpoints.turrets.some((t) => t.arc === 'bow');
}
