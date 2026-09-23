import { Vector3 } from 'three';
import { PAL, PK, type ParticlePalette } from './kinds';
import type { Particles } from './Particles';
import { makeSpawn, resetSpawn } from './spawn';

export interface TrailStyle {
  /** Puff radius when emitted / fully bloomed (m). */
  size0: number;
  size1: number;
  /** Puff lifetime range (s). */
  lifeMin: number;
  lifeMax: number;
  /** Distance between puffs (m). */
  spacing: number;
  /** Random lateral offset (m) — makes the trail lumpy and painterly. */
  jitter: number;
  /** Random drift speed of each puff (m/s). */
  drift: number;
  /** Radius of the additive head glint (0 = none). */
  glint: number;
  palette: ParticlePalette;
  /** Upper bound on puffs per update (very fast movers get sparser, never costlier). */
  maxPerUpdate: number;
}

/** Macross "Itano circus" missile smoke: fat white puffs that linger and thicken. */
export const TRAIL_MISSILE: TrailStyle = {
  size0: 0.55,
  size1: 3.4,
  lifeMin: 2.4,
  lifeMax: 3.6,
  spacing: 1.5,
  jitter: 0.35,
  drift: 1.2,
  glint: 1.6,
  palette: PAL.WARM,
  maxPerUpdate: 48,
};

/** Short, thin engine exhaust puffs for fighters. */
export const TRAIL_ENGINE: TrailStyle = {
  size0: 0.4,
  size1: 1.6,
  lifeMin: 0.7,
  lifeMax: 1.1,
  spacing: 2.2,
  jitter: 0.2,
  drift: 0.6,
  glint: 0,
  palette: PAL.WARM,
  maxPerUpdate: 24,
};

export type TrailHandle = number;

/**
 * Smoke/exhaust ribbons for missiles and engines.
 *
 *   const h = fx.trails.create(TRAIL_MISSILE);
 *   fx.trails.update(h, missileUniversePos);   // every frame
 *   fx.trails.release(h);                      // missile dead; puffs linger & die naturally
 *
 * Each update() costs one spawn request (plus one for the head glint): the
 * puffs along the segment travelled since the last update are strung out by
 * the compute shader with staggered ages, so emission looks continuous at any
 * frame rate. Handles are recycled from a free list; nothing allocates per
 * frame. 100+ simultaneous trails are just 100–200 requests per frame.
 */
export class Trails {
  readonly maxTrails: number;
  private readonly fx: Particles;
  private readonly last: Float64Array;
  private readonly acc: Float64Array;
  private readonly state: Uint8Array; // 0 free · 1 active, no position yet · 2 active
  private readonly styles: TrailStyle[];
  private readonly free: Int32Array;
  private freeTop: number;
  private readonly desc = makeSpawn();
  private readonly p0 = new Vector3();
  private readonly p1 = new Vector3();

  constructor(fx: Particles, maxTrails = 512) {
    this.fx = fx;
    this.maxTrails = maxTrails;
    this.last = new Float64Array(maxTrails * 3);
    this.acc = new Float64Array(maxTrails);
    this.state = new Uint8Array(maxTrails);
    this.styles = new Array<TrailStyle>(maxTrails).fill(TRAIL_MISSILE);
    this.free = new Int32Array(maxTrails);
    for (let i = 0; i < maxTrails; i++) this.free[i] = maxTrails - 1 - i;
    this.freeTop = maxTrails;
  }

  /** Allocate a trail. Returns -1 when all handles are in use (updates on -1 are ignored). */
  create(style: TrailStyle = TRAIL_MISSILE): TrailHandle {
    if (this.freeTop === 0) return -1;
    const h = this.free[--this.freeTop];
    this.state[h] = 1;
    this.acc[h] = 0;
    this.styles[h] = style;
    return h;
  }

  /** Stop emitting. The handle is recycled immediately; existing puffs live out their lives. */
  release(h: TrailHandle): void {
    if (h < 0 || h >= this.maxTrails || this.state[h] === 0) return;
    this.state[h] = 0;
    this.free[this.freeTop++] = h;
  }

  /** Teleport without drawing smoke across the gap. */
  reset(h: TrailHandle): void {
    if (h >= 0 && this.state[h] !== 0) this.state[h] = 1;
  }

  /** Advance a trail's emitter to `pos` (universe), laying puffs along the way. */
  update(h: TrailHandle, pos: Vector3): void {
    if (h < 0 || h >= this.maxTrails || this.state[h] === 0) return;
    const o = h * 3;
    const L = this.last;
    const st = this.styles[h];
    if (this.state[h] === 1) {
      L[o] = pos.x;
      L[o + 1] = pos.y;
      L[o + 2] = pos.z;
      this.state[h] = 2;
      return;
    }
    const dx = pos.x - L[o];
    const dy = pos.y - L[o + 1];
    const dz = pos.z - L[o + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dt = this.fx.lastDt;
    const d = this.desc;

    if (len > 1e-6) {
      const total = this.acc[h] + len;
      let n = Math.floor(total / st.spacing);
      if (n > 0) {
        const dA = st.spacing - this.acc[h];
        let dB = dA + (n - 1) * st.spacing;
        this.acc[h] = total - n * st.spacing;
        if (n > st.maxPerUpdate) {
          n = st.maxPerUpdate;
          dB = Math.min(dB, len);
        }
        const fa = dA / len;
        const fb = dB / len;
        this.p0.set(L[o] + dx * fa, L[o + 1] + dy * fa, L[o + 2] + dz * fa);
        this.p1.set(L[o] + dx * fb, L[o + 1] + dy * fb, L[o + 2] + dz * fb);
        resetSpawn(d);
        d.kind = PK.PUFF;
        d.palette = st.palette;
        d.count = n;
        d.pos.copy(this.p0);
        d.to = this.p1;
        d.spread = 1;
        d.speedMin = st.drift * 0.3;
        d.speedMax = st.drift;
        d.drag = 0.5;
        d.lifeMin = st.lifeMin;
        d.lifeMax = st.lifeMax;
        d.size0 = st.size0;
        d.size1 = st.size1;
        d.sizeJitter = 0.3;
        d.jitter = st.jitter;
        d.ageA = (1 - fa) * dt;
        d.ageB = (1 - fb) * dt;
        this.fx.emit(d);
      } else {
        this.acc[h] = total;
      }
    }

    if (st.glint > 0) {
      resetSpawn(d);
      d.kind = PK.GLINT;
      d.palette = st.palette;
      d.count = 1;
      d.pos.copy(pos);
      d.lifeMin = d.lifeMax = Math.max(dt, 1 / 240) * 0.5;
      d.size0 = d.size1 = st.glint;
      this.fx.emit(d);
    }

    L[o] = pos.x;
    L[o + 1] = pos.y;
    L[o + 2] = pos.z;
  }

  get activeCount(): number {
    return this.maxTrails - this.freeTop;
  }
}
