import type { RampName } from '@/render/materials/ToonRamp';

export type Vec3 = [number, number, number];

/** Paint slots resolved against a faction livery at build time. */
export type Paint = 'primary' | 'secondary' | 'accent' | 'dark' | 'metal' | 'glass' | 'glow';

/**
 * A loft cross-section: a chamfered trapezoid (top width `w`, bottom width
 * `wb`, height `h`) centred at (x, y) on the plane at `z`. Chamfered corners
 * are what give 90s mecha their crisp faceted highlights.
 */
export interface Station {
  z: number;
  w: number;
  h: number;
  wb?: number;
  x?: number;
  y?: number;
  /** Corner chamfer in metres (clamped to the section size). */
  c?: number;
}

export type Shape =
  | { kind: 'loft'; stations: Station[]; capStart?: boolean; capEnd?: boolean }
  | {
      kind: 'wing';
      /** Root chord, tip chord, span, sweep of tip leading edge (+ = swept back). */
      root: number;
      tip: number;
      span: number;
      sweep: number;
      thickness: number;
      tipThickness?: number;
      /** 0 = slab, 1 = diamond airfoil. */
      bevel?: number;
    }
  | { kind: 'cylinder'; rFront: number; rBack: number; length: number; segments?: number; open?: boolean }
  | { kind: 'dome'; radius: number; scale?: Vec3; segments?: number; hemisphere?: boolean }
  | { kind: 'box'; w: number; h: number; d: number; c?: number }
  | { kind: 'torus'; radius: number; tube: number; segments?: number; tubeSegments?: number };

export interface Part {
  name?: string;
  shape: Shape;
  pos?: Vec3;
  /** Euler XYZ in degrees. */
  rot?: Vec3;
  scale?: Vec3;
  paint: Paint;
  /** Duplicate across the ship's X=0 plane. */
  mirror?: boolean;
  /**
   * Parts sharing a group share an ink region id (no panel line between them).
   * Defaults to a unique group per part.
   */
  group?: number;
  emissive?: number;
  gloss?: number;
}

export interface EngineMount {
  pos: Vec3;
  radius: number;
  /** Plume length at full throttle, metres. */
  plume: number;
  mirror?: boolean;
}

export interface Hardpoint {
  id: string;
  pos: Vec3;
  kind: 'gun' | 'missile' | 'turret' | 'beam' | 'hangar';
  mirror?: boolean;
}

export type ShipClass =
  | 'interceptor'
  | 'strike-fighter'
  | 'bomber'
  | 'corvette'
  | 'frigate'
  | 'carrier'
  | 'dreadnought';

export interface Blueprint {
  id: string;
  name: string;
  designation: string;
  faction: FactionId;
  shipClass: ShipClass;
  /** Uniform scale applied to the whole design (lets capital ships be modelled in "hundreds of metres"). */
  scale?: number;
  ramp?: RampName;
  parts: Part[];
  engines: EngineMount[];
  hardpoints?: Hardpoint[];
  /** Flavour text for the database / briefing screens. */
  notes?: string;
}

export type FactionId = 'concord' | 'choir' | 'rustwake';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  metal: string;
  glass: string;
  glow: string;
  /** Engine plume core colour. */
  plumeCore: string;
}
