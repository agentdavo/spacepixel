import { DataTexture, LinearFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, Color } from 'three';

/**
 * A toon ramp maps the lighting term N·L (0..1) to a light multiplier. Stops are
 * hard bands with a tiny feather so band edges stay crisp but don't alias.
 * Ramps are grayscale "light amount" — the shadow hue comes from the LightRig's
 * shadow tint so the same ramp works under any star.
 */
export interface RampStop {
  /** N·L value where this band begins (0..1). */
  at: number;
  /** Light amount for this band: 0 = full shadow tint, 1 = full key light. */
  value: number;
}

export const RAMPS = {
  /** Classic 90s 2-tone + highlight band: shadow / lit / hot. */
  classic: [
    { at: 0.0, value: 0.0 },
    { at: 0.46, value: 0.78 },
    { at: 0.9, value: 1.0 },
  ],
  /** Harder, more dramatic single terminator (capital ships, planets). */
  dramatic: [
    { at: 0.0, value: 0.0 },
    { at: 0.52, value: 1.0 },
  ],
  /** Three soft-ish bands for organic / crystalline Choir hulls. */
  triple: [
    { at: 0.0, value: 0.0 },
    { at: 0.3, value: 0.45 },
    { at: 0.62, value: 0.85 },
    { at: 0.93, value: 1.0 },
  ],
} satisfies Record<string, RampStop[]>;

export type RampName = keyof typeof RAMPS;

const cache = new Map<string, DataTexture>();

export function buildRamp(stops: RampStop[], width = 256, feather = 1.5 / 256): DataTexture {
  const data = new Uint8Array(width * 4);
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  for (let i = 0; i < width; i++) {
    const x = i / (width - 1);
    let v = sorted[0].value;
    for (let s = 1; s < sorted.length; s++) {
      const t = smooth(sorted[s].at - feather, sorted[s].at + feather, x);
      v += (sorted[s].value - v) * t;
    }
    const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
    data[i * 4] = b;
    data[i * 4 + 1] = b;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, width, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function getRamp(name: RampName): DataTexture {
  let tex = cache.get(name);
  if (!tex) cache.set(name, (tex = buildRamp(RAMPS[name])));
  return tex;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Convenience for palette definitions. */
export const hex = (h: string): Color => new Color(h);
