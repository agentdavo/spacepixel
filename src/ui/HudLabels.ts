import { placeLabels, type Box, type LabelRequest } from './labelPlacement';
import { circDelta, edgeAngle, edgeBoxes, perimeterLength, perimeterPoint, placeEdges, wrap, type EdgeGeometry, type EdgeRequest } from './edgePlacement';
import { claimed } from './hudLayout';

/**
 * The flight HUD's world-space label layer. Markers (brackets, diamonds,
 * rings) are still drawn by their own layers (FlightHud, CombatHud,
 * ContractHud, ReachHud) the moment they are computed; their *text* is
 * queued here and placed once per frame, after every layer has spoken, by
 * the pure packer in labelPlacement.ts: priority order, greedy slots around
 * the marker with leader lines, low-priority labels fade out when they would
 * collide, and nothing covers the reticle or a HUD panel.
 *
 * Off-screen markers queue an edge arrow instead (`edge()`): the arrows are
 * packed first, on one track round the screen edge (edgePlacement.ts), and
 * then stand as obstacles for the on-screen labels.
 *
 * Priorities (higher wins the good slots):
 *   100 locked target (pinned) · 90 tracked contract · 80 nav Lantern ·
 *    75 dock target / nearest station · 70 distress / traffic in trouble ·
 *    60 other contracts · 50 stations · 40 planets · 30 lane traffic ·
 *    25 moons. The arrivals board (65) rides the nav diamond's slot
 *   below the Lantern's name, one ring out at most (it hides rather than
 *   wander off on a long leader line).
 */
export const LABEL_PRIORITY = {
  target: 100,
  contract: 90,
  nav: 80,
  dockTarget: 75,
  distress: 70,
  contractOther: 60,
  station: 50,
  planet: 40,
  traffic: 30,
  moon: 25,
  arrivals: 65,
} as const;

export interface LabelLine {
  text: string;
  color: string;
  /** CSS font; default 12px Share Tech Mono. */
  font?: string;
  alpha?: number;
}

export interface HudLabel {
  /** Stable id (per marker) — carries the fade and the slot hysteresis across frames. */
  id: string;
  x: number;
  y: number;
  /** Radius the marker covers (px). */
  r: number;
  lines: LabelLine[];
  priority: number;
  pinned?: boolean;
  /** Extra bars under the text (the target's shield / hull), px. */
  bars?: { value: number; color: string }[];
  /** Slot to try first when it has none from last frame. */
  slot?: number;
  /** Rings of slots it may use (default all). */
  rings?: number;
}

/** An off-screen marker: an arrow on the screen-edge track, pointing the way. */
export interface EdgeArrow {
  /** Stable id: carries the fade, the slide and the smoothing across frames. */
  id: string;
  /** Screen direction (0 = right, +π/2 = down) — or give `dir`, the camera-space position. */
  angle?: number;
  dir?: { x: number; y: number };
  color: string;
  /** tri: filled triangle · notch: notched chevron · ring: circle · dot: filled circle. */
  shape: 'tri' | 'notch' | 'ring' | 'dot';
  /** Filled (tri / notch); an outline otherwise. */
  fill?: boolean;
  /** Arrow length (px); default 14. */
  size?: number;
  /** Grouping key (target, nav, contract, distress). */
  kind: string;
  priority: number;
  /** Always shown, never grouped (target, nav). */
  pinned?: boolean;
  /** Text carried inward of the arrow. */
  lines?: LabelLine[];
}

const EDGE_INSET = 36;
const EDGE_SLOT = 28;
const EDGE_SPEED = 600;
const BADGE_FONT = '700 11px "Share Tech Mono", monospace';

const FONT = '12px "Share Tech Mono", monospace';
const LINE_H = 13;
const FADE_IN = 8;
const FADE_OUT = 5;

interface Memory {
  alpha: number;
  slot: number;
  box: Box;
  lines: LabelLine[];
  bars?: HudLabel['bars'];
  leader: [number, number, number, number] | null;
  seen: number;
}

export class HudLabels {
  private queue: HudLabel[] = [];
  private obstacles: Box[] = [];
  private keepOut: Box[] = [];
  private mem = new Map<string, Memory>();
  private frame = 0;
  private lastT = -1;
  private edges: EdgeArrow[] = [];
  private edgeMem = new Map<string, EdgeMemory>();

  add(l: HudLabel): void {
    this.queue.push(l);
  }

  /** An off-screen marker's edge arrow (packed and drawn in flush, before the labels). */
  edge(a: EdgeArrow): void {
    this.edges.push(a);
  }

  /** A marker (or HUD element) labels must not cover. */
  obstacle(x: number, y: number, w: number, h: number): void {
    this.obstacles.push({ x, y, w, h });
  }

  /** Hard keep-out: the reticle (a circle of radius `r` at x, y). */
  reticle(x: number, y: number, r: number): void {
    this.keepOut.push({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
  }

  /** Drop this frame's queue (cutaways: the HUD is cleared). */
  discard(): void {
    this.queue.length = 0;
    this.obstacles.length = 0;
    this.keepOut.length = 0;
    this.edges.length = 0;
  }

  /** Place and draw everything queued this frame onto `c` (CSS px space), then clear the queue. */
  flush(c: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, time - this.lastT));
    this.lastT = time;
    this.frame++;
    c.save();
    c.shadowBlur = 0;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    // Measure.
    const reqs: LabelRequest[] = this.queue.map((l) => {
      let lw = 0;
      for (const ln of l.lines) {
        c.font = ln.font ?? FONT;
        lw = Math.max(lw, c.measureText(ln.text).width);
      }
      const bh = l.bars?.length ? l.bars.length * 6 + 2 : 0;
      if (l.bars?.length) lw = Math.max(lw, 72);
      const held = this.mem.get(l.id)?.slot;
      return { id: l.id, ax: l.x, ay: l.y, ar: l.r, w: Math.ceil(lw) + 4, h: l.lines.length * LINE_H + 3 + bh, priority: l.priority, pinned: l.pinned, prefer: held !== undefined && held >= 0 ? held : l.slot, rings: l.rings };
    });
    const panels: Box[] = [...claimed()];
    // Edge arrows first: they stand as obstacles for the labels.
    const arrows = this.flushEdges(c, w, h, dt, panels);
    const placed = placeLabels(reqs, { width: w, height: h, keepOut: this.keepOut, obstacles: [...this.obstacles, ...panels, ...arrows] });
    placed.forEach((p, i) => {
      const l = this.queue[i];
      let m = this.mem.get(l.id);
      if (!m) {
        m = { alpha: 0, slot: -1, box: { x: p.x, y: p.y, w: p.w, h: p.h }, lines: l.lines, leader: null, seen: this.frame };
        this.mem.set(l.id, m);
      }
      m.seen = this.frame;
      m.lines = l.lines;
      m.bars = l.bars;
      if (p.visible) {
        m.alpha = Math.min(1, m.alpha + dt * FADE_IN);
        m.slot = p.slot;
        m.box = { x: p.x, y: p.y, w: p.w, h: p.h };
        m.leader = p.leader ? [p.lx0, p.ly0, p.lx1, p.ly1] : null;
      } else {
        // Collides: fade out where it last stood (never jump onto something else).
        m.alpha = Math.max(0, m.alpha - dt * FADE_OUT);
        m.slot = -1;
      }
    });
    // Draw (and forget labels whose markers are gone).
    for (const [id, m] of this.mem) {
      if (m.seen !== this.frame) {
        this.mem.delete(id);
        continue;
      }
      if (m.alpha <= 0.01) continue;
      this.draw(c, m);
    }
    c.restore();
    this.discard();
  }

  /**
   * Pack this frame's edge arrows (edgePlacement.ts), ease each toward its
   * spot (at most EDGE_SPEED px/s along the track), fade the hidden ones out,
   * draw them, and return their boxes (obstacles for the labels).
   */
  private flushEdges(c: CanvasRenderingContext2D, w: number, h: number, dt: number, panels: readonly Box[]): Box[] {
    const g: EdgeGeometry = { width: w, height: h, inset: EDGE_INSET };
    const P = perimeterLength(g);
    // Big obstacles are HUD panels too (the flight block, the weapons block).
    const blocks = [...panels, ...this.obstacles.filter((b) => b.w * b.h >= 3000)];
    const reqs: EdgeRequest[] = this.edges.map((a) => {
      let tw = 0;
      for (const ln of a.lines ?? []) {
        c.font = ln.font ?? FONT;
        tw = Math.max(tw, c.measureText(ln.text).width);
      }
      const n = a.lines?.length ?? 0;
      return {
        id: a.id,
        kind: a.kind,
        angle: angleOf(a),
        priority: a.priority,
        pinned: a.pinned,
        tw: n ? Math.ceil(tw) + 4 : 0,
        th: n ? n * LINE_H + 3 : 0,
        prev: this.edgeMem.get(a.id)?.packed,
      };
    });
    const placed = placeEdges(reqs, { ...g, arrow: EDGE_SLOT, panels: blocks });
    placed.forEach((p, i) => {
      const a = this.edges[i];
      let m = this.edgeMem.get(a.id);
      if (!m) {
        m = { s: p.s, alpha: 0, packed: undefined, arrow: a, angle: reqs[i].angle, tw: reqs[i].tw!, th: reqs[i].th!, count: 1, seen: this.frame };
        this.edgeMem.set(a.id, m);
      }
      m.seen = this.frame;
      m.arrow = a;
      m.angle = reqs[i].angle;
      m.tw = reqs[i].tw!;
      m.th = reqs[i].th!;
      if (p.visible) {
        if (m.alpha <= 0.01) m.s = p.s; // (re)appearing: no slide in from a stale spot
        const d = circDelta(m.s, p.s, P);
        const step = EDGE_SPEED * dt;
        m.s = wrap(Math.abs(d) <= step ? p.s : m.s + Math.sign(d) * step, P);
        m.packed = p.s;
        m.count = p.count;
        m.alpha = Math.min(1, m.alpha + dt * FADE_IN);
      } else {
        m.packed = undefined;
        m.alpha = Math.max(0, m.alpha - dt * FADE_OUT);
      }
    });
    const boxes: Box[] = [];
    for (const [id, m] of this.edgeMem) {
      if (m.seen !== this.frame) {
        this.edgeMem.delete(id);
        continue;
      }
      if (m.alpha <= 0.01) continue;
      const pt = perimeterPoint(m.s, g);
      const b = edgeBoxes(pt.x, pt.y, pt.side, EDGE_SLOT, m.tw, m.th, g);
      if (m.alpha > 0.3) {
        boxes.push(b.arrow);
        if (b.text) boxes.push(b.text);
      }
      this.drawEdge(c, m, pt.x, pt.y, pt.side, b.text);
    }
    return boxes;
  }

  private drawEdge(c: CanvasRenderingContext2D, m: EdgeMemory, x: number, y: number, side: string, text: Box | null): void {
    const a = m.arrow;
    const ang = m.angle;
    const k = (a.size ?? 14) / 14;
    c.globalAlpha = m.alpha;
    c.fillStyle = c.strokeStyle = a.color;
    c.lineWidth = a.fill ? 2 : 1.5;
    c.beginPath();
    if (a.shape === 'ring' || a.shape === 'dot') {
      c.arc(x, y, 6 * k, 0, Math.PI * 2);
      if (a.shape === 'dot') c.fill();
      else {
        c.stroke();
        // A tick on the ring pointing the way.
        c.beginPath();
        c.moveTo(x + Math.cos(ang) * 8 * k, y + Math.sin(ang) * 8 * k);
        c.lineTo(x + Math.cos(ang) * 13 * k, y + Math.sin(ang) * 13 * k);
        c.stroke();
      }
    } else if (a.shape === 'notch') {
      c.save();
      c.translate(x, y);
      c.rotate(ang);
      c.moveTo(12 * k, 0);
      c.lineTo(-6 * k, -8 * k);
      c.lineTo(-2 * k, 0);
      c.lineTo(-6 * k, 8 * k);
      c.closePath();
      if (a.fill) c.fill();
      else c.stroke();
      c.restore();
    } else {
      const r0 = 14 * k;
      const r1 = 10 * k;
      c.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
      c.lineTo(x + Math.cos(ang + 2.5) * r1, y + Math.sin(ang + 2.5) * r1);
      c.lineTo(x + Math.cos(ang - 2.5) * r1, y + Math.sin(ang - 2.5) * r1);
      c.closePath();
      if (a.fill ?? true) c.fill();
      else c.stroke();
    }
    if (m.count > 1) {
      // ×N badge: beside the arrow along the track.
      c.font = BADGE_FONT;
      c.textAlign = side === 'right' ? 'right' : 'left';
      const bx = side === 'top' || side === 'bottom' ? x + 13 : side === 'left' ? x - 10 : x + 10;
      const by = side === 'top' || side === 'bottom' ? y + 4 : y + (text ? -EDGE_SLOT / 2 - 2 : 20);
      c.fillText(`×${m.count}`, bx, by);
      c.textAlign = 'left';
    }
    if (text && a.lines) {
      a.lines.forEach((ln, i) => {
        c.font = ln.font ?? FONT;
        c.fillStyle = ln.color;
        c.globalAlpha = m.alpha * (ln.alpha ?? 1);
        c.fillText(ln.text, text.x + 2, text.y + 11 + i * LINE_H);
      });
    }
    c.globalAlpha = 1;
  }

  private draw(c: CanvasRenderingContext2D, m: Memory): void {
    const b = m.box;
    if (m.leader) {
      const [x0, y0, x1, y1] = m.leader;
      c.globalAlpha = m.alpha * 0.6;
      c.strokeStyle = m.lines[0]?.color ?? '#7dffb2';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
    m.lines.forEach((ln, k) => {
      c.font = ln.font ?? FONT;
      c.fillStyle = ln.color;
      c.globalAlpha = m.alpha * (ln.alpha ?? 1);
      c.fillText(ln.text, b.x + 2, b.y + 11 + k * LINE_H);
    });
    if (m.bars) {
      let y = b.y + m.lines.length * LINE_H + 4;
      c.globalAlpha = m.alpha;
      for (const bar of m.bars) {
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(b.x + 2, y, 70, 4);
        c.fillStyle = bar.color;
        c.fillRect(b.x + 2, y, 70 * Math.max(0, Math.min(1, bar.value)), 4);
        y += 6;
      }
    }
    c.globalAlpha = 1;
  }
}

interface EdgeMemory {
  /** Displayed perimeter coordinate (eased toward the packed spot). */
  s: number;
  alpha: number;
  /** Where it was packed last frame (hysteresis); undefined while hidden. */
  packed: number | undefined;
  arrow: EdgeArrow;
  angle: number;
  tw: number;
  th: number;
  count: number;
  seen: number;
}

function angleOf(a: EdgeArrow): number {
  return a.angle ?? (a.dir ? edgeAngle(a.dir.x, a.dir.y) : 0);
}

/** The one label layer every flight HUD layer queues into (FlightScene flushes it). */
export const hudLabels = new HudLabels();
