import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import { HUD, centerBand, claim, fitText, objectivesX } from './hudLayout';

/**
 * Free-roam contract overlay: its own canvas over the flight HUD, so the
 * flight HUD stays untouched. Top-right objective panel (the campaign panel's
 * spot — contracts are suspended during episodes), OVA-orange nav diamonds
 * with an edge arrow when off-screen, dwell rings, and short toasts.
 */
export interface HudContract {
  kind: string;
  title: string;
  status: string;
  timer: string;
  urgent: boolean;
  tracked: boolean;
}

const ORANGE = '#ffb347';
const GREEN = '#7dffb2';
const RED = '#ff5f7a';
const _p = new Vector3();

export class ContractHud {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private toasts: { text: string; color: string; t0: number }[] = [];

  constructor(root: HTMLElement) {
    this.canvas.className = 'contract-hud';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Clear for a new frame (and track the window size). */
  begin(): void {
    claim('toasts', null);
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.font = '13px "Share Tech Mono", monospace';
    c.lineWidth = 1.5;
    c.shadowColor = 'rgba(255,160,60,0.55)';
    c.shadowBlur = 6;
  }

  toast(text: string, color = ORANGE): void {
    this.toasts.push({ text, color, t0: performance.now() });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  private project(universe: Vector3, world: WorldSpace, cam: PerspectiveCamera): { x: number; y: number; behind: boolean } {
    world.toRender(universe, _p).project(cam);
    const behind = _p.z > 1 || _p.z < -1;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h, behind };
  }

  /** Top-right: the active contracts, tracked one first-class. */
  panel(rows: HudContract[], hint: boolean): void {
    const c = this.ctx;
    // The shared objectives column (hudLayout): same spot as campaign / mission objectives.
    const W = HUD.objectivesW;
    const x = objectivesX(this.w) + 12;
    let y = HUD.objectivesY;
    const h = 30 + rows.length * 38 + (hint ? 16 : 0);
    c.save();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(12,6,0,0.55)';
    c.fillRect(x - 12, y - 20, W, h);
    c.fillStyle = ORANGE;
    c.fillRect(x - 12, y - 20, 3, h);
    c.restore();
    c.fillStyle = '#ffffff';
    c.font = '700 13px "Oxanium", sans-serif';
    c.fillText(`CONTRACTS · ${rows.length} ACTIVE`, x, y);
    c.font = '13px "Share Tech Mono", monospace';
    y += 22;
    for (const r of rows) {
      c.fillStyle = r.tracked ? ORANGE : 'rgba(255,179,71,0.6)';
      c.fillText(`${r.tracked ? '▶' : '·'} ${r.kind}`, x, y);
      const kw = c.measureText(`▶ ${r.kind}  `).width;
      c.fillStyle = r.tracked ? '#ffffff' : 'rgba(255,255,255,0.7)';
      c.fillText(clip(c, r.title, W - 62 - kw - 52), x + kw, y);
      if (r.timer) {
        c.textAlign = 'right';
        c.fillStyle = r.urgent ? RED : r.timer === 'DONE' ? GREEN : 'rgba(255,255,255,0.75)';
        c.fillText(r.timer, x + W - 22, y);
        c.textAlign = 'left';
      }
      y += 16;
      c.fillStyle = r.tracked ? GREEN : 'rgba(125,255,178,0.55)';
      c.fillText(`  ${clip(c, r.status, W - 36)}`, x, y);
      y += 22;
    }
    if (hint) {
      c.fillStyle = 'rgba(255,179,71,0.55)';
      c.fillText('[C] TRACK NEXT · [M] ROUTE', x, y - 4);
    }
  }

  /** Nav diamond on a contract target, or an arrow at the screen edge. */
  marker(pos: Vector3, label: string, kind: string, from: Vector3, cam: PerspectiveCamera, world: WorldSpace, time: number, primary: boolean): void {
    const c = this.ctx;
    const d = pos.distanceTo(from);
    const range = d > 10_000 ? `${(d / 1000).toFixed(0)} km` : d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`;
    const pt = this.project(pos, world, cam);
    c.strokeStyle = c.fillStyle = primary ? ORANGE : 'rgba(255,179,71,0.55)';
    c.lineWidth = primary ? 2 : 1.2;
    const on = !pt.behind && pt.x > 20 && pt.x < this.w - 20 && pt.y > 20 && pt.y < this.h - 20;
    if (on) {
      const r = (primary ? 13 : 9) + (primary ? Math.sin(time * 5) * 2 : 0);
      c.beginPath();
      c.moveTo(pt.x, pt.y - r);
      c.lineTo(pt.x + r, pt.y);
      c.lineTo(pt.x, pt.y + r);
      c.lineTo(pt.x - r, pt.y);
      c.closePath();
      c.stroke();
      if (primary) {
        c.beginPath();
        c.moveTo(pt.x, pt.y - r - 7);
        c.lineTo(pt.x, pt.y - r - 2);
        c.moveTo(pt.x, pt.y + r + 2);
        c.lineTo(pt.x, pt.y + r + 7);
        c.stroke();
      }
      c.fillText(`${label}  ${range}`, pt.x + r + 8, pt.y + 1);
      c.globalAlpha = 0.7;
      c.fillText(`CONTRACT · ${kind}`, pt.x + r + 8, pt.y + 15);
      c.globalAlpha = 1;
      return;
    }
    // Off-screen: arrow on an ellipse toward the target.
    world.toRender(pos, _p).applyMatrix4(cam.matrixWorldInverse);
    const ang = Math.atan2(-_p.y, _p.x);
    const rx = this.w / 2 - 60;
    const ry = this.h / 2 - 60;
    const x = this.w / 2 + Math.cos(ang) * rx;
    const y = this.h / 2 + Math.sin(ang) * ry;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(12, 0);
    c.lineTo(-6, -8);
    c.lineTo(-2, 0);
    c.lineTo(-6, 8);
    c.closePath();
    primary ? c.fill() : c.stroke();
    c.restore();
    if (primary) {
      c.textAlign = x > this.w / 2 ? 'right' : 'left';
      c.fillText(`${label}  ${range}`, x + (x > this.w / 2 ? -18 : 18), y + (y > this.h / 2 ? -12 : 20));
      c.textAlign = 'left';
    }
  }

  /** Beacon dwell zone: dashed ring + progress arc (as the campaign HUD draws it). */
  dwell(pos: Vector3, radius: number, progress: number, cam: PerspectiveCamera, world: WorldSpace): void {
    const pt = this.project(pos, world, cam);
    if (pt.behind) return;
    const dist = world.toRender(pos, _p).length();
    const fovScale = this.h / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const r = Math.max(14, Math.min(this.h * 0.45, (radius * fovScale) / Math.max(dist, 1)));
    const c = this.ctx;
    c.strokeStyle = 'rgba(111,230,255,0.5)';
    c.lineWidth = 1.5;
    c.setLineDash([6, 6]);
    c.beginPath();
    c.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = progress >= 1 ? GREEN : '#6fe6ff';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(pt.x, pt.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    c.stroke();
    c.fillStyle = '#6fe6ff';
    c.textAlign = 'center';
    c.fillText(progress >= 1 ? 'HELD' : `HOLD ${(progress * 100).toFixed(0)}%`, pt.x, pt.y + r + 22);
    c.textAlign = 'left';
  }

  /**
   * Toasts: centre, under the status strip, fitted to the centre band (clear
   * of the target panel and the objectives column); 5 s each. Claims their
   * rows so the distress list starts below them.
   */
  drawToasts(): void {
    const now = performance.now();
    this.toasts = this.toasts.filter((t) => now - t.t0 < 5000);
    const c = this.ctx;
    let y = HUD.toastY;
    const band = centerBand(this.w).width;
    claim('toasts', this.toasts.length ? { x: this.w / 2 - band / 2, y: y - 17, w: band, h: this.toasts.length * HUD.toastRow } : null);
    c.textAlign = 'center';
    for (const t of this.toasts) {
      const a = Math.min(1, (5000 - (now - t.t0)) / 600);
      const text = fitText(c, t.text, band - 36, 15, 11, '"Oxanium", sans-serif', '700 ');
      const w = c.measureText(text).width + 36;
      c.globalAlpha = a;
      c.save();
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(8,4,0,0.7)';
      c.beginPath();
      c.moveTo(this.w / 2 - w / 2 + 10, y - 17);
      c.lineTo(this.w / 2 + w / 2 + 10, y - 17);
      c.lineTo(this.w / 2 + w / 2 - 10, y + 9);
      c.lineTo(this.w / 2 - w / 2 - 10, y + 9);
      c.closePath();
      c.fill();
      c.fillStyle = t.color;
      c.fillRect(this.w / 2 - w / 2 - 4, y - 17, 4, 26);
      c.restore();
      c.fillStyle = t.color;
      c.fillText(text, this.w / 2, y);
      y += HUD.toastRow;
    }
    c.globalAlpha = 1;
    c.textAlign = 'left';
    c.font = '13px "Share Tech Mono", monospace';
  }
}

function clip(c: CanvasRenderingContext2D, s: string, max: number): string {
  if (c.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 4 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
