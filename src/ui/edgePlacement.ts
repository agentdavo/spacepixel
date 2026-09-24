/**
 * Off-screen edge arrows — pure placement (no canvas, no three.js;
 * unit-tested in tests/edge-placement.test.ts).
 *
 * Everything off screen that the HUD points at (the locked target, the nav
 * Lantern, contract objectives, distress calls) gets an arrow on one shared
 * track: a rectangle inset `inset` px from the screen edge. An arrow's true
 * spot is where the ray from the screen centre along its direction crosses
 * that rectangle; the rectangle is unrolled into a 1-D clockwise perimeter
 * coordinate `s` (0 = top-left corner, then top → right → bottom → left),
 * so corners wrap for free.
 *
 * Packing is greedy, like the label packer (labelPlacement.ts):
 *
 *   1. pinned first (target, nav), then priority, then id;
 *   2. each arrow claims an interval of the track: the arrow itself, or the
 *      arrow and its text when it carries some (text sits inward of the
 *      arrow, so along a top / bottom edge the interval is the text width,
 *      along a side edge the text height);
 *   3. HUD panels that cross the track band block a stretch of it: an
 *      arrow whose true spot is inside one is pushed out to the nearer free
 *      end;
 *   4. from there it slides to the nearest spot clear of every arrow
 *      already placed (and, in 2-D, of their text boxes and the panels),
 *      at most `maxSlide` px; the spot nearest where it stood last frame is
 *      kept while it is not much worse (hysteresis: no side flipping);
 *   5. an arrow that would collide with one of its own kind folds into it
 *      instead: the leader (the highest-priority member) shows a ×N badge;
 *   6. still no room: pinned arrows take their spot anyway (overlap allowed),
 *      the rest are hidden (the caller fades them out).
 */
import type { Box } from './labelPlacement';

// (Kept import-free at runtime so node's test runner loads it bare.)
function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Screen direction (radians; 0 = right, +π/2 = down) toward a point given in
 * camera space (+x right, +y up, −z forward). Works for points behind the
 * camera too: the arrow points the way to turn. (Never derive it from the
 * projected NDC position: projection flips points behind the camera.)
 * Dead astern (x = y = 0) points down.
 */
export function edgeAngle(x: number, y: number): number {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return Math.PI / 2;
  return Math.atan2(-y, x);
}

export interface EdgeGeometry {
  width: number;
  height: number;
  /** Track inset from the screen edge (px). */
  inset: number;
}

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

function dims(g: EdgeGeometry): { x0: number; y0: number; w: number; h: number; p: number } {
  const w = Math.max(1, g.width - 2 * g.inset);
  const h = Math.max(1, g.height - 2 * g.inset);
  return { x0: g.inset, y0: g.inset, w, h, p: 2 * (w + h) };
}

export function perimeterLength(g: EdgeGeometry): number {
  return dims(g).p;
}

/** Wrap `s` into [0, P). */
export function wrap(s: number, p: number): number {
  return ((s % p) + p) % p;
}

/** Signed shortest perimeter distance from a to b. */
export function circDelta(a: number, b: number, p: number): number {
  let d = wrap(b - a, p);
  if (d > p / 2) d -= p;
  return d;
}

/** Perimeter coordinate of a point on the track rectangle. */
function pointToPerimeter(x: number, y: number, g: EdgeGeometry): number {
  const { x0, y0, w, h, p } = dims(g);
  const lx = Math.max(0, Math.min(w, x - x0));
  const ly = Math.max(0, Math.min(h, y - y0));
  const dTop = Math.abs(ly);
  const dRight = Math.abs(w - lx);
  const dBottom = Math.abs(h - ly);
  const dLeft = Math.abs(lx);
  const m = Math.min(dTop, dRight, dBottom, dLeft);
  if (m === dTop) return lx;
  if (m === dRight) return w + ly;
  if (m === dBottom) return w + h + (w - lx);
  return wrap(2 * w + h + (h - ly), p);
}

/** Where the ray from the screen centre along `angle` crosses the track (perimeter coordinate). */
export function angleToPerimeter(angle: number, g: EdgeGeometry): number {
  const { x0, y0, w, h } = dims(g);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = Math.abs(dx) > 1e-9 ? w / 2 / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return pointToPerimeter(cx + dx * t, cy + dy * t, g);
}

/** Screen point and side of a perimeter coordinate. */
export function perimeterPoint(s: number, g: EdgeGeometry): { x: number; y: number; side: EdgeSide } {
  const { x0, y0, w, h, p } = dims(g);
  const q = wrap(s, p);
  if (q < w) return { x: x0 + q, y: y0, side: 'top' };
  if (q < w + h) return { x: x0 + w, y: y0 + (q - w), side: 'right' };
  if (q < 2 * w + h) return { x: x0 + w - (q - w - h), y: y0 + h, side: 'bottom' };
  return { x: x0, y: y0 + h - (q - 2 * w - h), side: 'left' };
}

/**
 * Arrow box and (optional) text box at a track point. Text sits inward of
 * the arrow: under it on the top edge, over it on the bottom, beside it on
 * the side edges, clamped inside the screen.
 */
export function edgeBoxes(x: number, y: number, side: EdgeSide, arrow: number, tw: number, th: number, g: EdgeGeometry): { arrow: Box; text: Box | null } {
  const a = { x: x - arrow / 2, y: y - arrow / 2, w: arrow, h: arrow };
  if (tw <= 0 || th <= 0) return { arrow: a, text: null };
  const clampX = (v: number) => Math.max(4, Math.min(g.width - 4 - tw, v));
  const clampY = (v: number) => Math.max(4, Math.min(g.height - 4 - th, v));
  let t: Box;
  if (side === 'top') t = { x: clampX(x - tw / 2), y: y + arrow / 2 + 3, w: tw, h: th };
  else if (side === 'bottom') t = { x: clampX(x - tw / 2), y: y - arrow / 2 - 3 - th, w: tw, h: th };
  else if (side === 'left') t = { x: x + arrow / 2 + 4, y: clampY(y - th / 2), w: tw, h: th };
  else t = { x: x - arrow / 2 - 4 - tw, y: clampY(y - th / 2), w: tw, h: th };
  return { arrow: a, text: t };
}

function union(a: Box, b: Box | null): Box {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export interface EdgeRequest {
  id: string;
  /** Grouping key: arrows of one kind that would collide fold into one. */
  kind: string;
  /** Screen direction (edgeAngle). */
  angle: number;
  priority: number;
  /** Always shown (target, nav); never grouped. */
  pinned?: boolean;
  /** Arrow size (px); default `opts.arrow`. */
  size?: number;
  /** Text box carried inward of the arrow (px), 0 for none. */
  tw?: number;
  th?: number;
  /** Perimeter coordinate it was packed at last frame (hysteresis). */
  prev?: number;
}

export interface EdgePlacement {
  id: string;
  visible: boolean;
  /** Perimeter coordinate of the arrow (its packed spot) and of its true spot. */
  s: number;
  s0: number;
  /** Packed spot minus true spot (signed, px along the track). */
  offset: number;
  x: number;
  y: number;
  side: EdgeSide;
  /** Arrow + text, at the packed spot. */
  box: Box;
  /** Members folded into this arrow (itself included); 0 when hidden. */
  count: number;
  /** Folded into this leader (hidden). */
  groupedInto?: string;
}

export interface EdgeOptions extends EdgeGeometry {
  /** Default arrow size (px). */
  arrow?: number;
  /** Clear gap between neighbouring arrows (px). */
  gap?: number;
  /** Farthest an arrow slides to clear another (px). */
  maxSlide?: number;
  /** Hysteresis: last frame's offset is kept while within this of the nearest free spot (px). */
  hold?: number;
  /** HUD panels: block the stretch of track they cross. */
  panels?: readonly Box[];
}

interface Claim {
  c: number;
  e: number;
}

/** Stretches of track (centre, half-extent) a panel covers: the band ±`band` px around each side. */
export function blockedStretches(panels: readonly Box[], g: EdgeGeometry, band: number): Claim[] {
  const { x0, y0, w, h } = dims(g);
  const out: Claim[] = [];
  const add = (a: number, b: number) => b > a && out.push({ c: (a + b) / 2, e: (b - a) / 2 });
  for (const b of panels) {
    // Top: y = y0, s = x - x0.
    if (b.y < y0 + band && b.y + b.h > y0 - band) add(Math.max(0, b.x - x0), Math.min(w, b.x + b.w - x0));
    // Right: x = x0 + w, s = w + (y - y0).
    if (b.x < x0 + w + band && b.x + b.w > x0 + w - band) add(w + Math.max(0, b.y - y0), w + Math.min(h, b.y + b.h - y0));
    // Bottom: y = y0 + h, s = w + h + (x0 + w - x).
    if (b.y < y0 + h + band && b.y + b.h > y0 + h - band) add(w + h + Math.max(0, x0 + w - (b.x + b.w)), w + h + Math.min(w, x0 + w - b.x));
    // Left: x = x0, s = 2w + h + (y0 + h - y).
    if (b.x < x0 + band && b.x + b.w > x0 - band) add(2 * w + h + Math.max(0, y0 + h - (b.y + b.h)), 2 * w + h + Math.min(h, y0 + h - b.y));
  }
  return out;
}

export function placeEdges(reqs: readonly EdgeRequest[], o: EdgeOptions): EdgePlacement[] {
  const g: EdgeGeometry = { width: o.width, height: o.height, inset: o.inset };
  const P = perimeterLength(g);
  const arrow0 = o.arrow ?? 28;
  const gap = o.gap ?? 6;
  const maxSlide = o.maxSlide ?? 120;
  const hold = o.hold ?? 30;
  const panels = o.panels ?? [];
  const blocked = blockedStretches(panels, g, arrow0 / 2);
  const order = reqs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(!!b.r.pinned) - Number(!!a.r.pinned) || b.r.priority - a.r.priority || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));
  const claims: (Claim & { idx: number })[] = [];
  const boxes: Box[] = [];
  const out: EdgePlacement[] = new Array(reqs.length);

  // Half-extent along the track of an arrow (+ its text) at s.
  const halfAt = (r: EdgeRequest, s: number) => {
    const size = r.size ?? arrow0;
    const tw = r.tw ?? 0;
    const th = r.th ?? 0;
    const side = perimeterPoint(s, g).side;
    const along = tw > 0 && th > 0 ? (side === 'top' || side === 'bottom' ? Math.max(size, tw) : size / 2 + Math.max(size / 2, th)) : size;
    return along / 2 + gap / 2;
  };
  const clearOf = (list: readonly Claim[], c: number, e: number) => {
    for (const k of list) if (Math.abs(circDelta(k.c, c, P)) < k.e + e) return false;
    return true;
  };
  const boxAt = (r: EdgeRequest, s: number) => {
    const pt = perimeterPoint(s, g);
    const b = edgeBoxes(pt.x, pt.y, pt.side, r.size ?? arrow0, r.tw ?? 0, r.th ?? 0, g);
    return { pt, box: union(b.arrow, b.text), text: b.text };
  };
  const free = (r: EdgeRequest, s: number) => {
    const e = halfAt(r, s);
    if (!clearOf(claims, s, e) || !clearOf(blocked, s, e)) return false;
    const { box, text } = boxAt(r, s);
    for (const b of boxes) if (boxesOverlap(box, b)) return false;
    if (text) for (const p of panels) if (boxesOverlap(text, p)) return false;
    return true;
  };
  // Push a spot out of the panel stretches it falls in (to the nearer free end).
  const pushOut = (r: EdgeRequest, s: number) => {
    for (let n = 0; n < 8; n++) {
      const e = halfAt(r, s);
      const hit = blocked.find((k) => Math.abs(circDelta(k.c, s, P)) < k.e + e);
      if (!hit) return s;
      const a = wrap(hit.c - hit.e - e - 0.5, P);
      const b = wrap(hit.c + hit.e + e + 0.5, P);
      // The nearer end; if that lands in another stretch, the loop pushes on.
      s = Math.abs(circDelta(s, a, P)) <= Math.abs(circDelta(s, b, P)) ? a : b;
    }
    return s;
  };
  const search = (r: EdgeRequest, base: number, limit: number): number | null => {
    const step = 2;
    for (let k = 0; k * step <= limit; k++) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const s = wrap(base + sign * k * step, P);
        if (free(r, s)) return s;
      }
    }
    return null;
  };
  const place = (r: EdgeRequest, i: number, s: number, s0: number) => {
    const { pt, box } = boxAt(r, s);
    claims.push({ c: s, e: halfAt(r, s), idx: i });
    boxes.push(box);
    out[i] = { id: r.id, visible: true, s, s0, offset: circDelta(s0, s, P), x: pt.x, y: pt.y, side: pt.side, box, count: 1 };
  };
  const hide = (r: EdgeRequest, i: number, s0: number, groupedInto?: string) => {
    const pt = perimeterPoint(s0, g);
    out[i] = { id: r.id, visible: false, s: s0, s0, offset: 0, x: pt.x, y: pt.y, side: pt.side, box: boxAt(r, s0).box, count: 0, groupedInto };
  };

  for (const { r, i } of order) {
    const s0 = angleToPerimeter(r.angle, g);
    // Fold into a same-kind arrow it would collide with.
    if (!r.pinned) {
      const e = halfAt(r, s0);
      const lead = claims.find((k) => {
        const q = reqs[k.idx];
        return !q.pinned && q.kind === r.kind && Math.abs(circDelta(k.c, s0, P)) < k.e + e;
      });
      if (lead) {
        const L = out[lead.idx];
        L.count++;
        // Room for the ×N badge.
        lead.e = Math.max(lead.e, halfAt(reqs[lead.idx], lead.c) + 8);
        hide(r, i, s0, L.id);
        continue;
      }
    }
    const base = pushOut(r, s0);
    let s = search(r, base, maxSlide);
    // Hysteresis: the free spot nearest last frame's wins while it is not much farther from the true spot.
    if (r.prev !== undefined && s !== null) {
      const near = search(r, r.prev, maxSlide);
      if (near !== null) {
        const d = Math.abs(circDelta(s0, near, P));
        if (d <= Math.abs(circDelta(s0, s, P)) + hold && d <= Math.abs(circDelta(s0, base, P)) + maxSlide) s = near;
      }
    }
    if (s === null && r.pinned) s = search(r, base, P / 2) ?? base;
    if (s === null) {
      // No room: fold into the nearest arrow of its kind within reach, else hide.
      let best: (Claim & { idx: number }) | null = null;
      for (const k of claims) {
        const q = reqs[k.idx];
        if (q.pinned || q.kind !== r.kind) continue;
        const d = Math.abs(circDelta(k.c, s0, P));
        if (d <= maxSlide + k.e && (!best || d < Math.abs(circDelta(best.c, s0, P)))) best = k;
      }
      if (best) {
        out[best.idx].count++;
        hide(r, i, s0, out[best.idx].id);
      } else hide(r, i, s0);
      continue;
    }
    place(r, i, s, s0);
  }
  return out;
}
