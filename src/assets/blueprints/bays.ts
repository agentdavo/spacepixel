import type { Paint, Part } from '../Blueprint';

/**
 * Hollow hangar bays (docking & trade). A real recessed box a ship flies
 * INTO, instead of a lit panel it slides behind:
 *
 *   - a structural collar (four slabs around the mouth) — the outside;
 *   - dark liners on the floor, ceiling and walls, with frame ribs every
 *     ~30 m so the depth reads (and the ink pass has edges to draw);
 *   - deck lights in two rows running inward, a ceiling strip, and a lit
 *     berth door on the back wall — small, thin emissives so the bloom
 *     never washes the bay out;
 *   - a thin lit lip around the mouth (the force-field curtain itself is a
 *     separate additive mesh: `world/BayCurtain.ts`).
 *
 * Units are the blueprint's (1 = 100 m at scale 100). The bay opens toward
 * +Z; `mouth` is the z of the mouth plane, `back` the z of the back wall.
 */
export interface BaySpec {
  /** Mouth centre (x, y) and plane z. */
  x?: number;
  y: number;
  mouth: number;
  back: number;
  /** Opening size. */
  w: number;
  h: number;
  /** Collar size around the opening (outer w, h); the collar may be off-centre vertically via `collarY`. */
  outerW: number;
  outerH: number;
  collarY?: number;
  /** How far the collar runs back from the mouth (default: to the back wall). */
  collarDepth?: number;
  paint?: Paint;
  /** Deck light colour override (default: the livery's glow). */
  light?: string;
  /** Name prefix (so a ship can carry more than one bay). */
  id?: string;
}

/**
 * Enclosure (Part.shade) for the bay's surfaces: the cel shader casts no
 * shadows, so without it the liners took full sun and the grazing rim light
 * turned a dark recess bright teal. Liners sit nearly in the dark, ribs and
 * the deck stripe catch a little, the collar is mostly in its own shadow.
 */
export const LINER_SHADE = 0.9;
const RIB_SHADE = 0.75;
const COLLAR_SHADE = 0.6;

/** Interior half-extents in metres at `scale` (for cameras / docking depth). */
export function bayInterior(s: BaySpec, scale: number): { hw: number; hh: number; depth: number } {
  return { hw: (s.w / 2) * scale, hh: (s.h / 2) * scale, depth: (s.mouth - s.back) * scale };
}

export function hollowBay(s: BaySpec): Part[] {
  const x = s.x ?? 0;
  const id = s.id ?? 'bay';
  const paint = s.paint ?? 'secondary';
  const cy = s.collarY ?? s.y;
  const depth = s.collarDepth ?? s.mouth - s.back + 0.05;
  const zc = s.mouth - depth / 2;
  const inD = s.mouth - s.back; // interior depth
  const zi = s.mouth - inD / 2; // interior centre
  const top = cy + s.outerH / 2;
  const bottom = cy - s.outerH / 2;
  const mTop = s.y + s.h / 2;
  const mBot = s.y - s.h / 2;
  const sideW = (s.outerW - s.w) / 2;
  const liner = 0.02;
  const ribs = Math.max(2, Math.round(inD / 0.3));
  const ribStep = inD / ribs;
  const lights = Math.max(4, Math.round(inD / 0.14));
  const lightStep = (inD - 0.1) / lights;
  const c = Math.min(0.12, Math.min(top - mTop, mBot - bottom, sideW) * 0.4);
  const parts: Part[] = [
    // Collar: the structure around the hole.
    { name: `${id}-collar-top`, paint, shade: COLLAR_SHADE, pos: [x, (top + mTop) / 2, zc], shape: { kind: 'box', w: s.outerW, h: top - mTop, d: depth, c } },
    { name: `${id}-collar-bottom`, paint, shade: COLLAR_SHADE, pos: [x, (bottom + mBot) / 2, zc], shape: { kind: 'box', w: s.outerW, h: mBot - bottom, d: depth, c } },
    { name: `${id}-collar-side`, paint, shade: COLLAR_SHADE, mirror: x === 0, pos: [x + (s.w + sideW) / 2, s.y, zc], shape: { kind: 'box', w: sideW, h: s.h + 0.02, d: depth, c: c * 0.5 } },
    // Dark liners (inside faces of the bay).
    { name: `${id}-floor`, paint: 'dark', shade: LINER_SHADE, pos: [x, mBot + liner / 2, zi], shape: { kind: 'box', w: s.w, h: liner, d: inD } },
    { name: `${id}-ceiling`, paint: 'dark', shade: LINER_SHADE, pos: [x, mTop - liner / 2, zi], shape: { kind: 'box', w: s.w, h: liner, d: inD } },
    { name: `${id}-wall`, paint: 'dark', shade: LINER_SHADE, mirror: x === 0, pos: [x + s.w / 2 - liner / 2, s.y, zi], shape: { kind: 'box', w: liner, h: s.h, d: inD } },
    { name: `${id}-back`, paint: 'dark', shade: LINER_SHADE, pos: [x, s.y, s.back + liner], shape: { kind: 'box', w: s.w, h: s.h, d: liner * 2 } },
    // Frame ribs: a hoop every ~30 m, so the eye (and the ink) reads depth.
    {
      name: `${id}-rib-wall`,
      paint: 'metal',
      shade: RIB_SHADE,
      mirror: x === 0,
      pos: [x + s.w / 2 - liner - 0.02, s.y, s.mouth - ribStep * 0.5],
      repeat: { count: ribs, step: [0, 0, -ribStep] },
      shape: { kind: 'box', w: 0.04, h: s.h - liner * 2, d: 0.05 },
    },
    {
      name: `${id}-rib-ceiling`,
      paint: 'metal',
      shade: RIB_SHADE,
      pos: [x, mTop - liner - 0.02, s.mouth - ribStep * 0.5],
      repeat: { count: ribs, step: [0, 0, -ribStep] },
      shape: { kind: 'box', w: s.w - liner * 2, h: 0.04, d: 0.05 },
    },
    // Deck: guide stripes and two rows of lights running inward.
    { name: `${id}-deck-stripe`, paint: 'accent', shade: RIB_SHADE, mirror: x === 0, pos: [x + s.w * 0.18, mBot + liner + 0.003, zi], shape: { kind: 'box', w: 0.025, h: 0.006, d: inD - 0.06 } },
    {
      name: `${id}-deck-light`,
      paint: 'glow',
      emissive: 0.55,
      color: s.light,
      mirror: x === 0,
      pos: [x + s.w * 0.36, mBot + liner + 0.008, s.mouth - 0.08],
      repeat: { count: lights, step: [0, 0, -lightStep] },
      shape: { kind: 'box', w: 0.035, h: 0.016, d: 0.035 },
    },
    { name: `${id}-ceiling-strip`, paint: 'glass', emissive: 0.45, pos: [x, mTop - liner - 0.006, zi], shape: { kind: 'box', w: 0.03, h: 0.012, d: inD - 0.1 } },
    // The berth door on the back wall: a thin lit outline.
    { name: `${id}-door-top`, paint: 'glow', emissive: 0.5, color: s.light, pos: [x, s.y + s.h * 0.22, s.back + liner * 2 + 0.004], repeat: { count: 2, step: [0, -s.h * 0.44, 0] }, shape: { kind: 'box', w: s.w * 0.46, h: 0.018, d: 0.008 } },
    { name: `${id}-door-side`, paint: 'glow', emissive: 0.5, color: s.light, mirror: x === 0, pos: [x + s.w * 0.23, s.y, s.back + liner * 2 + 0.004], shape: { kind: 'box', w: 0.018, h: s.h * 0.44 + 0.018, d: 0.008 } },
    // Lit lip around the mouth (thin: it frames the hole, it doesn't flood it).
    { name: `${id}-lip`, paint: 'glow', emissive: 0.7, color: s.light, pos: [x, mTop + 0.012, s.mouth + 0.005], repeat: { count: 2, step: [0, -(s.h + 0.024), 0] }, shape: { kind: 'box', w: s.w + 0.05, h: 0.022, d: 0.03 } },
    { name: `${id}-lip-side`, paint: 'glow', emissive: 0.7, color: s.light, mirror: x === 0, pos: [x + s.w / 2 + 0.012, s.y, s.mouth + 0.005], shape: { kind: 'box', w: 0.022, h: s.h + 0.02, d: 0.03 } },
  ];
  return parts;
}
