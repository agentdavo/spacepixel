import { ClampToEdgeWrapping, Color, DataTexture, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

export interface ColorStop {
  at: number;
  color: string;
  /** Optional coverage (0 = hole). Used for ring gaps via alpha test. */
  alpha?: number;
}

/**
 * A hard-stepped colour palette baked into a 1D texture: the "paint pots" for
 * posterised backgrounds (nebulae, gas giant bands, planetary rings). Steps
 * are feathered by ~1 texel so they stay crisp without aliasing.
 */
export function buildPalette(stops: ColorStop[], width = 512, repeat = false, featherFrac = 1.2 / width): DataTexture {
  const data = new Uint8Array(width * 4);
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const cols = sorted.map((s) => new Color(s.color)); // sRGB hex → linear working space
  const feather = featherFrac;
  const tmp = new Color();
  for (let i = 0; i < width; i++) {
    const x = i / (width - 1);
    tmp.copy(cols[0]);
    let a = sorted[0].alpha ?? 1;
    for (let s = 1; s < sorted.length; s++) {
      const t = Math.min(1, Math.max(0, (x - (sorted[s].at - feather)) / (2 * feather)));
      const k = t * t * (3 - 2 * t);
      tmp.lerp(cols[s], k);
      a += ((sorted[s].alpha ?? 1) - a) * k;
    }
    // Store in sRGB-ish gamma so 8 bits don't band in the darks; decoded in shader.
    data[i * 4] = Math.round(Math.pow(tmp.r, 1 / 2.2) * 255);
    data[i * 4 + 1] = Math.round(Math.pow(tmp.g, 1 / 2.2) * 255);
    data[i * 4 + 2] = Math.round(Math.pow(tmp.b, 1 / 2.2) * 255);
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const tex = new DataTexture(data, width, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
