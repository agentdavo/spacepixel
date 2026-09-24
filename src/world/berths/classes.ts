/**
 * Berth size classes (docking for every hull size). Pure: numbers in, numbers out.
 *
 *   ≤ 40 m     fighters, heavy fighters   → BAY      the hollow hangar recess (as before)
 *   40–200 m   gunships, corvettes        → CLAMP    a gantry arm swings out and clamps the flank
 *   > 200 m    frigates, big civil hulls  → MOORING  hold station alongside a pylon on a lit tether;
 *                                                     a lighter runs the crew across
 *
 * Carriers take fighters in their hangar and corvettes alongside (on a
 * tether, riding the carrier's velocity); frigates are turned away.
 *
 * Every class flies the same controller (world/Docking.ts): request → ILS
 * corridor → guidance → berthed → launch. What scales with hull length is
 * the approach: a longer corridor, a wider (but still bounded) capture
 * window, a closing-speed cap before guidance will take the ship, a slower
 * final, and longer attach / release beats.
 */
export type BerthClass = 'bay' | 'clamp' | 'mooring';

export const BAY_MAX_LENGTH = 40;
export const CLAMP_MAX_LENGTH = 200;

export function berthClassFor(length: number): BerthClass {
  return length <= BAY_MAX_LENGTH ? 'bay' : length <= CLAMP_MAX_LENGTH ? 'clamp' : 'mooring';
}

export const BERTH_LABEL: Record<BerthClass, string> = {
  bay: 'HANGAR BAY',
  clamp: 'CLAMP BERTH',
  mooring: 'MOORING',
};

export interface ApproachProfile {
  cls: BerthClass | 'descent';
  /** Guidance takes the ship inside this range of the berth (m). */
  autoRange: number;
  /** Clearance lapses beyond this range (m). */
  lapseRange: number;
  /** Capture window: max lateral offset from the corridor centreline (m) … */
  lateralTol: number;
  /** … and the ship must be at least this far out along the corridor (m). */
  minOut: number;
  /** Max closing speed guidance accepts (m/s). */
  maxClosing: number;
  /** Seconds of guided approach from capture to all-stop. */
  tAuto: number;
  /** Arm swing / tether shot after all-stop (s). */
  tAttach: number;
  /** Release beat before the drive lights (s). */
  tRelease: number;
  /** Launch run: seconds and metres out along the corridor. */
  tLaunch: number;
  launchRun: number;
  /** Corridor gate spacing / size multiplier for the HUD. */
  corridorScale: number;
}

/** Approach numbers for a hull of `length` metres in class `cls`. */
export function approachProfile(cls: BerthClass, length: number): ApproachProfile {
  const L = Math.max(10, length);
  switch (cls) {
    case 'bay':
      return { cls, autoRange: 1000, lapseRange: 7500, lateralTol: 700, minOut: 60, maxClosing: Infinity, tAuto: 7, tAttach: 0, tRelease: 0, tLaunch: 3.4, launchRun: 560, corridorScale: 1 };
    case 'clamp':
      return {
        cls,
        autoRange: 1000 + 3.5 * L,
        lapseRange: 8000 + 4 * L,
        lateralTol: Math.min(1100, 520 + 2.2 * L),
        minOut: 80 + 0.6 * L,
        maxClosing: 260 - 0.4 * L,
        tAuto: 9 + L / 40,
        tAttach: 2.6,
        tRelease: 1.8,
        tLaunch: 5 + L / 120,
        launchRun: 600 + 2 * L,
        corridorScale: 1 + L / 180,
      };
    case 'mooring':
      return {
        cls,
        autoRange: 1400 + 3 * L,
        lapseRange: 9000 + 4 * L,
        lateralTol: Math.min(1500, 700 + 1.6 * L),
        minOut: 120 + 0.5 * L,
        maxClosing: Math.max(120, 230 - 0.2 * L),
        tAuto: 12 + L / 60,
        tAttach: 3,
        tRelease: 2.4,
        tLaunch: 6.5 + L / 200,
        launchRun: 900 + 2 * L,
        corridorScale: 1.4 + L / 260,
      };
  }
}

/** What a friendly carrier offers a hull of class `cls`: its hangar, a berth alongside, or nothing. */
export function carrierBerth(cls: BerthClass): 'hangar' | 'alongside' | null {
  return cls === 'bay' ? 'hangar' : cls === 'clamp' ? 'alongside' : null;
}

/**
 * Ease for the guided approach, 0..1 → 0..1 position along the path.
 * Fighters arrive on a quadratic ease-out; big hulls on a cubic one (a
 * longer, slower final: the last 15 % of the path takes ~40 % of the time).
 */
export function approachEase(cls: BerthClass | 'descent', u: number): { e: number; dedu: number } {
  const x = Math.min(1, Math.max(0, u));
  if (cls === 'bay') return { e: 1 - (1 - x) * (1 - x), dedu: 2 * (1 - x) };
  const v = 1 - x;
  return { e: 1 - v * v * v, dedu: 3 * v * v };
}
