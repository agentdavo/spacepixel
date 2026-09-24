import { placeLabels, type Box, type LabelRequest } from './labelPlacement';
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
 * Priorities (higher wins the good slots):
 *   100 locked target (pinned) · 90 tracked contract · 80 nav Lantern ·
 *    75 dock target / nearest station · 70 distress / traffic in trouble ·
 *    60 other contracts · 50 stations · 40 planets · 30 lane traffic ·
 *    25 moons · 20 arrivals board
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
  arrivals: 20,
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
}

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

  add(l: HudLabel): void {
    this.queue.push(l);
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
      return { id: l.id, ax: l.x, ay: l.y, ar: l.r, w: Math.ceil(lw) + 4, h: l.lines.length * LINE_H + 3 + bh, priority: l.priority, pinned: l.pinned, prefer: this.mem.get(l.id)?.slot };
    });
    const panels: Box[] = [...claimed()];
    const placed = placeLabels(reqs, { width: w, height: h, keepOut: this.keepOut, obstacles: [...this.obstacles, ...panels] });
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

/** The one label layer every flight HUD layer queues into (FlightScene flushes it). */
export const hudLabels = new HudLabels();
