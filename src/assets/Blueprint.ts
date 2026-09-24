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
  | { kind: 'torus'; radius: number; tube: number; segments?: number; tubeSegments?: number }
  /** Surface of revolution around Z: `profile` is a list of [radius, z] points, back to front. */
  | { kind: 'lathe'; profile: [number, number][]; segments?: number; phase?: number }
  /**
   * Chamfered arch in the XY plane (a rib / hoop / flying arch). Swept from
   * `start` through `arc` degrees counter-clockwise from +X (default 0 → 180,
   * an arch over +Y). `thickness` is radial, `depth` runs along Z.
   */
  | { kind: 'rib'; radius: number; thickness: number; depth: number; arc?: number; start?: number; segments?: number; c?: number }
  /**
   * Composite gun turret sitting on y = 0, barrels pointing +Z. Base ring and
   * chamfered housing use the part's paint, barrels use `Part.trim`.
   */
  | {
      kind: 'turret';
      radius: number;
      height: number;
      barrels?: number;
      barrelLength: number;
      barrelRadius?: number;
      /** Housing size [w, h, d]; defaults from radius. */
      housing?: Vec3;
    }
  /**
   * Seeded scatter of small plated boxes over a `w` × `d` patch of the XZ
   * plane (normal +Y) — machinery, vents, conduits. About a fifth of them are
   * painted with `Part.trim` (if set).
   */
  | { kind: 'greeble'; w: number; d: number; count: number; seed?: number; size?: [number, number]; height?: [number, number] };

/**
 * A named hinge. Parts that reference it are merged into their own child mesh
 * pivoting about `pivot` (ship coordinates, unscaled, in the pose the parts
 * were authored in). Mirrored parts automatically get a mirrored twin joint
 * called `${id}.L` that moves symmetrically.
 */
export interface Articulation {
  id: string;
  pivot: Vec3;
  /** Hinge axis in ship coordinates (normalised at build time). */
  axis: Vec3;
  /** Parent joint id — joints nest (e.g. a wing fold inside a swing wing). */
  parent?: string;
  /** Angle limits in degrees, relative to the authored pose. Channels map 0..1 across this. */
  range?: [number, number];
  /** Initial angle in degrees (default 0 = authored pose). */
  rest?: number;
  /** Control channel that drives this joint, e.g. 'sweep', 'fold', 'bay', 'radar'. */
  channel?: string;
  /**
   * Set false for centreline joints: mirrored parts then ride on this joint
   * itself instead of on a mirrored `.L` twin.
   */
  mirror?: boolean;
}

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
  /** Secondary paint for composite shapes (turret barrels, greeble caps). */
  trim?: Paint;
  /** Resolve the paint slot against another faction's livery (salvaged parts). */
  livery?: FactionId;
  /** Explicit colour, overriding the paint slot's colour (surface preset still follows `paint`). */
  color?: string;
  /**
   * 0..1 enclosure (hangar interiors): the cel shader has no shadows, so a
   * bay's inner faces would take full sun and a grazing rim light. Shade
   * mutes rim and glints and pulls direct light toward a dim shadow tint.
   * Emissives (deck lights) are unaffected.
   */
  shade?: number;
  /** Hinge this part moves with: a joint id from `Blueprint.articulations`, or an inline definition. */
  articulation?: string | Articulation;
  /**
   * Linear/radial array. Copy i is transformed by translate(step·i) ·
   * rotateXYZ(rot·i) applied on top of the part's own transform.
   */
  repeat?: { count: number; step?: Vec3; rot?: Vec3 };
  /** Emit a hardpoint socket at this part's origin (one per repeat/mirror copy). */
  socket?: { id: string; kind: Hardpoint['kind'] };
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
  /** Parent the socket to a joint so it moves with it (mirrored copy uses `${id}.L`). */
  articulation?: string;
  /** Socket orientation, Euler XYZ degrees (default: facing +Z). */
  rot?: Vec3;
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
  /** Hinged part groups (variable-geometry wings, bay doors, radar dishes). */
  articulations?: Articulation[];
  /** Per-design livery tweaks layered over the faction livery (build-time overrides still win). */
  livery?: Partial<Livery>;
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
