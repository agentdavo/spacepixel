import { Vector3 } from 'three';
import { PAL, PK, type ParticleKind, type ParticlePalette } from './kinds';

/**
 * Description of one spawn request: `count` particles of one kind, emitted as
 * a burst at `pos` or strung along the segment `pos → to`. The compute pass
 * expands a request into particles on the GPU; the CPU never touches a
 * particle. Reuse one object (see `spawn()`), emit() copies it.
 */
export interface SpawnDesc {
  kind: ParticleKind;
  palette: ParticlePalette;
  count: number;
  /** Universe position (float64). */
  pos: Vector3;
  /** Optional segment end (universe). Particles are spaced evenly along pos → to. */
  to: Vector3 | null;
  /** Inherited velocity (m/s, world axes). Drag pulls the burst velocity toward this. */
  baseVel: Vector3;
  /** Emission axis (unit or zero). For RING/SHIELD this is the plane normal (zero = face camera). */
  dir: Vector3;
  /** Cone spread: 0 = along dir, 1 = full sphere. */
  spread: number;
  speedMin: number;
  speedMax: number;
  lifeMin: number;
  lifeMax: number;
  /** Start / end size (metres; radius for blobs, half-width for sparks). */
  size0: number;
  size1: number;
  /** ± fraction of per-particle size variation. */
  sizeJitter: number;
  /** Exponential drag toward baseVel (1/s). */
  drag: number;
  /** Random start delay 0..delay seconds (particle is invisible until its age reaches 0). */
  delay: number;
  /** Random position offset radius (metres). */
  jitter: number;
  /** Radial: burst velocity points along the jitter offset (fireballs expand from their centre). */
  radial: boolean;
  /** Starting age of the particle at `pos` and at `to` (segments: emulates continuous emission). */
  ageA: number;
  ageB: number;
}

export function makeSpawn(): SpawnDesc {
  return {
    kind: PK.FIRE,
    palette: PAL.WARM,
    count: 1,
    pos: new Vector3(),
    to: null,
    baseVel: new Vector3(),
    dir: new Vector3(),
    spread: 1,
    speedMin: 0,
    speedMax: 0,
    lifeMin: 1,
    lifeMax: 1,
    size0: 1,
    size1: 1,
    sizeJitter: 0,
    drag: 0,
    delay: 0,
    jitter: 0,
    radial: false,
    ageA: 0,
    ageB: 0,
  };
}

/** Reset a reusable SpawnDesc to defaults (no allocation). */
export function resetSpawn(d: SpawnDesc): SpawnDesc {
  d.kind = PK.FIRE;
  d.palette = PAL.WARM;
  d.count = 1;
  d.to = null;
  d.baseVel.set(0, 0, 0);
  d.dir.set(0, 0, 0);
  d.spread = 1;
  d.speedMin = d.speedMax = 0;
  d.lifeMin = d.lifeMax = 1;
  d.size0 = d.size1 = 1;
  d.sizeJitter = 0;
  d.drag = 0;
  d.delay = 0;
  d.jitter = 0;
  d.radial = false;
  d.ageA = d.ageB = 0;
  return d;
}

