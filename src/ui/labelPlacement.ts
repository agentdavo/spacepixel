/**
 * World-space label declutter — pure placement (no canvas, no three.js;
 * unit-tested in tests/label-placement.test.ts).
 *
 * Every marker that wants a text label (target, nav Lantern, contract
 * diamonds, stations, planets and moons, traffic tags, the arrivals board)
 * submits a request: its anchor (the marker centre and the radius the marker
 * itself covers), the label box size and a priority. Placement is greedy:
 *
 *   1. highest priority first (ties: nearer the screen centre first);
 *   2. each label tries candidate slots around its anchor — right, upper
 *      right, lower right, left, upper left, lower left, above, below —
 *      first hugging the marker, then on two further rings with a leader
 *      line back to it; the slot it held last frame is tried first
 *      (hysteresis: labels don't flicker between slots);
 *   3. a slot is taken if it stays on screen and clears every obstacle:
 *      the reticle keep-out, HUD panels, every marker, and every label
 *      already placed;
 *   4. no free slot: the label is hidden (the caller fades it out) —
 *      unless it is pinned (the locked target), which takes its first
 *      on-screen slot clear of the reticle, overlapping other labels if
 *      it must. Nothing ever covers the reticle.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelRequest {
  id: string;
  /** Anchor: the marker centre (px) and the radius the marker covers. */
  ax: number;
  ay: number;
  ar: number;
  /** Label box size (px). */
  w: number;
  h: number;
  /** Higher places first. */
  priority: number;
  /** Always shown (takes its first on-screen slot even if it overlaps). */
  pinned?: boolean;
  /** Slot index it held last frame (tried first). */
  prefer?: number;
}

export interface LabelPlacement {
  id: string;
  visible: boolean;
  /** Top-left of the label box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Slot index (ring × 8 + direction), −1 when hidden. */
  slot: number;
  /** Placed off the marker: draw a leader line from (lx0, ly0) to (lx1, ly1). */
  leader: boolean;
  lx0: number;
  ly0: number;
  lx1: number;
  ly1: number;
}

export interface PlacementOptions {
  width: number;
  height: number;
  /** Hard keep-outs no label may cover, pinned ones included: the reticle. */
  keepOut?: readonly Box[];
  /** Soft obstacles: HUD panels, unlabelled markers. */
  obstacles?: readonly Box[];
  /** Screen-edge margin (px). */
  margin?: number;
  /** Gap between marker and label (px). */
  gap?: number;
  /** Extra distance per outer ring (px). */
  ringStep?: number;
  /** Rings (1 = hug the marker only). */
  rings?: number;
}

/** Directions: right, upper right, lower right, left, upper left, lower left, above, below. */
const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [1, 1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
  [0, -1],
  [0, 1],
];
export const SLOTS_PER_RING = DIRS.length;

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Label box for slot `slot` around a request: the box's near edge (or, on
 * the diagonals, its near corner) sits `d` = marker radius + gap + ring
 * steps from the anchor, so it never covers the marker's square.
 */
export function slotBox(r: LabelRequest, slot: number, gap: number, ringStep: number): Box {
  const ring = Math.floor(slot / SLOTS_PER_RING);
  const [dx, dy] = DIRS[slot % SLOTS_PER_RING];
  const d = r.ar + gap + ring * ringStep;
  const cx = r.ax + dx * d;
  const cy = r.ay + dy * d;
  // Anchor the box by the edge facing the marker.
  const x = dx > 0.1 ? cx : dx < -0.1 ? cx - r.w : cx - r.w / 2;
  const y = dy > 0.1 ? cy : dy < -0.1 ? cy - r.h : cy - r.h / 2;
  return { x, y, w: r.w, h: r.h };
}

function markerBox(r: LabelRequest): Box {
  return { x: r.ax - r.ar, y: r.ay - r.ar, w: r.ar * 2, h: r.ar * 2 };
}

/** Nearest point on a box to (px, py). */
function nearestOnBox(b: Box, px: number, py: number): [number, number] {
  return [Math.max(b.x, Math.min(b.x + b.w, px)), Math.max(b.y, Math.min(b.y + b.h, py))];
}

export function placeLabels(reqs: readonly LabelRequest[], o: PlacementOptions): LabelPlacement[] {
  const margin = o.margin ?? 6;
  const gap = o.gap ?? 6;
  const ringStep = o.ringStep ?? 24;
  const rings = Math.max(1, o.rings ?? 3);
  const cx = o.width / 2;
  const cy = o.height / 2;
  const order = reqs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.priority - a.r.priority || Math.hypot(a.r.ax - cx, a.r.ay - cy) - Math.hypot(b.r.ax - cx, b.r.ay - cy) || a.i - b.i);
  const keepOut = o.keepOut ?? [];
  const taken: Box[] = [...keepOut, ...(o.obstacles ?? [])];
  // Every marker is an obstacle for every label (its own included: a label never covers its marker).
  for (const r of reqs) taken.push(markerBox(r));
  const onScreen = (b: Box) => b.x >= margin && b.y >= margin && b.x + b.w <= o.width - margin && b.y + b.h <= o.height - margin;
  const clear = (b: Box, list: readonly Box[]) => {
    for (const t of list) if (boxesOverlap(b, t)) return false;
    return true;
  };
  const out: LabelPlacement[] = new Array(reqs.length);
  const total = rings * SLOTS_PER_RING;
  const order2: number[] = [];
  for (const { r, i } of order) {
    // Candidate order: last frame's slot, then ring by ring.
    order2.length = 0;
    if (r.prefer !== undefined && r.prefer >= 0 && r.prefer < total) order2.push(r.prefer);
    for (let s = 0; s < total; s++) if (s !== r.prefer) order2.push(s);
    let chosen = -1;
    for (const s of order2) {
      const b = slotBox(r, s, gap, ringStep);
      if (onScreen(b) && clear(b, taken)) {
        chosen = s;
        break;
      }
    }
    // Pinned: the first on-screen slot clear of the keep-outs (the reticle), overlaps allowed; else the default slot.
    if (chosen < 0 && r.pinned) {
      chosen = 0;
      for (const s of order2) {
        const b = slotBox(r, s, gap, ringStep);
        if (onScreen(b) && clear(b, keepOut)) {
          chosen = s;
          break;
        }
      }
    }
    if (chosen < 0) {
      out[i] = { id: r.id, visible: false, x: r.ax, y: r.ay, w: r.w, h: r.h, slot: -1, leader: false, lx0: 0, ly0: 0, lx1: 0, ly1: 0 };
      continue;
    }
    const b = slotBox(r, chosen, gap, ringStep);
    taken.push(b);
    const [lx1, ly1] = nearestOnBox(b, r.ax, r.ay);
    const len = Math.hypot(lx1 - r.ax, ly1 - r.ay) || 1;
    out[i] = {
      id: r.id,
      visible: true,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      slot: chosen,
      leader: chosen >= SLOTS_PER_RING,
      lx0: r.ax + ((lx1 - r.ax) / len) * r.ar,
      ly0: r.ay + ((ly1 - r.ay) / len) * r.ar,
      lx1,
      ly1,
    };
  }
  return out;
}
