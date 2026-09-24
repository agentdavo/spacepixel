/**
 * Planet surface LOD — pure (unit-tested in tests/planet-lod.test.ts).
 *
 * The painted surface (PlanetMaterial.ts) is the heaviest shader on screen
 * when a world fills the sky: five-octave fBm height, Worley craters or
 * veins, a four-octave cloud deck, city lights. Most of the time a body is a
 * disc a few dozen px across, where none of that survives the sampling. So
 * the detail follows the disc's radius on screen (drawing-buffer px):
 *
 *   0 full  ≥ FULL_PX       as authored;
 *   1 mid   FAR_PX…FULL_PX  one or two fewer octaves everywhere;
 *   2 far   < FAR_PX        the impostor: low-poly sphere, two-octave
 *                           height, no Worley, flat cloud / city tints.
 *
 * Switches need the size to clear a threshold by HYST (a disc hovering on a
 * line doesn't flicker between levels).
 */
export type PlanetLod = 0 | 1 | 2;

export const PLANET_LOD = { FULL_PX: 240, FAR_PX: 36, HYST: 0.15 };

/** Radius (px) of a sphere of radius `r` seen from `dist` with a vertical FOV `fovDeg` on a `heightPx` viewport. */
export function discRadiusPx(r: number, dist: number, fovDeg: number, heightPx: number): number {
  if (dist <= r) return Infinity;
  const focal = heightPx / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return (r / Math.sqrt(dist * dist - r * r)) * focal;
}

/** Detail level for a disc of `px` radius, given the current level (hysteresis). */
export function planetLodFor(px: number, cur: PlanetLod): PlanetLod {
  const { FULL_PX, FAR_PX, HYST } = PLANET_LOD;
  const want: PlanetLod = px >= FULL_PX ? 0 : px >= FAR_PX ? 1 : 2;
  if (want === cur) return cur;
  // Toward more detail: switch at the line. Toward less: only once clear of it.
  if (want < cur) return want;
  const line = cur === 0 ? FULL_PX : FAR_PX;
  if (px >= line * (1 - HYST)) return cur;
  return px >= FAR_PX * (1 - HYST) ? 1 : 2;
}
