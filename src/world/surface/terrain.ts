import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { SurfaceTerrain } from '@/universe/Universe';

/**
 * The ground under a surface port (planetary ports), on the CPU: a height
 * field per terrain kind, baked into a radial grid mesh centred on the port
 * (dense near the city, ~36 km out to the horizon), with per-vertex:
 *
 *   h01   0..1 into the planet's own height ramp (its painted contour bands)
 *   wet   0..1 water depth (ocean: the sea is the flattened part of the mesh)
 *   glow  0..1 lava / black-light veins (volcanic, Lantern-lit)
 *
 * Metres, surface frame (+Y up, port at the origin). Pure and seeded: the
 * same port always gets the same ground.
 */
export interface GroundSpec {
  terrain: SurfaceTerrain;
  seed: number;
  /** Planet's sea level in its height ramp (ocean worlds). */
  seaLevel?: number;
  /** Height of the port apron (m). */
  apron: number;
}

export const GROUND_RADIUS = 36_000;
/** Flat apron radius around the tether foot (m). */
export const APRON_RADIUS = 2000;

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise, ~−0.5..0.5 at wavelength `w` metres. */
export function fbm(x: number, y: number, w: number, seed: number, oct = 5): number {
  let f = 0;
  let amp = 0.5;
  let fr = 1 / w;
  for (let o = 0; o < oct; o++) {
    f += (vnoise(x * fr, y * fr, seed + o * 17) - 0.5) * amp;
    amp *= 0.5;
    fr *= 2.03;
  }
  return f;
}

function ridge(x: number, y: number, w: number, seed: number): number {
  let f = 0;
  let amp = 0.55;
  let fr = 1 / w;
  for (let o = 0; o < 4; o++) {
    f += (1 - Math.abs(vnoise(x * fr, y * fr, seed + o * 31) * 2 - 1)) * amp;
    amp *= 0.5;
    fr *= 2.1;
  }
  return f; // ~0..1
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface GroundSample {
  /** Height (m), water surface for wet points. */
  h: number;
  h01: number;
  wet: number;
  glow: number;
}

/** Ground at (x, z) in the surface frame. */
export function groundAt(g: GroundSpec, x: number, z: number, out: GroundSample = { h: 0, h01: 0, wet: 0, glow: 0 }): GroundSample {
  const r = Math.hypot(x, z);
  const s = g.seed;
  // Mountains ring the valley the port sits in; the apron is flat.
  const far = smooth(APRON_RADIUS, APRON_RADIUS + 5000, r);
  let h = 0;
  let glow = 0;
  let wet = 0;
  let h01 = 0.5;
  switch (g.terrain) {
    case 'rocky':
    case 'lantern': {
      h = 260 * fbm(x, z, 5200, s) + 1500 * far * Math.pow(ridge(x, z, 9000, s + 5), 2.2) + 80;
      h01 = 0.18 + h / 1900;
      if (g.terrain === 'lantern') {
        const v = Math.abs(fbm(x, z, 2600, s + 9, 3));
        glow = smooth(0.02, 0.0, v) * 0.9;
      }
      break;
    }
    case 'desert': {
      const a = 0.7 + (s % 7) * 0.2;
      const u = x * Math.cos(a) + z * Math.sin(a);
      const dunes = Math.abs(Math.sin(u / 420 + 3 * fbm(x, z, 2600, s))) * 70;
      const mesa = Math.floor(Math.max(0, fbm(x, z, 7000, s + 3) + 0.08) * 7) * 180 * far;
      h = dunes + 160 * fbm(x, z, 6000, s + 1) + mesa + 40;
      h01 = 0.2 + h / 1500;
      break;
    }
    case 'ice': {
      h = 300 * fbm(x, z, 6400, s) + 700 * far * Math.pow(ridge(x, z, 8000, s + 2), 2) + 60;
      h01 = 0.22 + h / 1400;
      break;
    }
    case 'volcanic': {
      h = 320 * fbm(x, z, 5000, s) + 1300 * far * Math.pow(ridge(x, z, 10000, s + 7), 2.5) + 50;
      h01 = 0.15 + h / 1900;
      const crack = Math.abs(fbm(x, z, 1800, s + 11, 3));
      glow = smooth(0.018, 0.0, crack) * smooth(APRON_RADIUS * 1.3, APRON_RADIUS * 2.2, r);
      break;
    }
    case 'ocean': {
      // A shelf-sea: islands and banks; the port stands on a raised shelf.
      const raw = 520 * fbm(x, z, 7000, s) + 900 * far * (Math.pow(ridge(x, z, 12000, s + 4), 3) - 0.18) - 60;
      const sea = g.seaLevel ?? 0.515;
      if (raw < 0) {
        wet = Math.min(1, -raw / 420);
        h = 0;
        h01 = sea * (1 - wet * 0.85);
      } else {
        h = raw;
        h01 = sea + 0.012 + (raw / 1200) * (1 - sea);
      }
      break;
    }
    case 'cloud': {
      // Gas giant: a rolling cloud sea far below the floating city; h01 walks the band palette.
      h = -1100 + 160 * fbm(x, z, 3800, s);
      h01 = (((z / 26000 + 0.5 * fbm(x, z, 9000, s + 3) + 2) % 1) + 1) % 1;
      break;
    }
  }
  // Flatten the apron (not the cloud sea: the city floats over it).
  if (g.terrain !== 'cloud') {
    const k = smooth(APRON_RADIUS * 0.85, APRON_RADIUS * 1.5, r);
    const apronH01 = g.terrain === 'ocean' ? (g.seaLevel ?? 0.515) + 0.04 : 0.3;
    h = g.apron + (h - g.apron) * k;
    h01 = apronH01 + (h01 - apronH01) * k;
    wet *= k;
  }
  out.h = h;
  out.h01 = Math.min(0.999, Math.max(0.001, h01));
  out.wet = wet;
  out.glow = glow;
  return out;
}

/** The radial ground mesh (dense at the city, coarse at the horizon). */
export function buildGround(g: GroundSpec, rings = 84, segs = 144): BufferGeometry {
  const pos: number[] = [];
  const h01: number[] = [];
  const wet: number[] = [];
  const glow: number[] = [];
  const s: GroundSample = { h: 0, h01: 0, wet: 0, glow: 0 };
  // Ring 0 is the centre point.
  groundAt(g, 0, 0, s);
  pos.push(0, s.h, 0);
  h01.push(s.h01);
  wet.push(s.wet);
  glow.push(s.glow);
  for (let i = 1; i <= rings; i++) {
    const r = GROUND_RADIUS * Math.pow(i / rings, 2.1);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      groundAt(g, x, z, s);
      // The far rim drops away under the horizon haze.
      const drop = i === rings ? -4000 : 0;
      pos.push(x, s.h + drop, z);
      h01.push(s.h01);
      wet.push(s.wet);
      glow.push(s.glow);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs;
    const b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('h01', new Float32BufferAttribute(h01, 1));
  geo.setAttribute('wet', new Float32BufferAttribute(wet, 1));
  geo.setAttribute('glow', new Float32BufferAttribute(glow, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
