import { Vector3, type PerspectiveCamera } from 'three';
import type { FlightModel } from '@/sim/FlightModel';
import type { WorldSpace } from '@/core/WorldSpace';

/**
 * Minimal flight HUD on one 2D canvas (M19 turns this into the full CRT HUD).
 * Aim marks are projected from the ship's *real* nose and velocity, never the
 * lagging camera, so aim is exact while the camera swings.
 */
const GREEN = '#7dffb2';
const AMBER = '#ffc46b';
const RED = '#ff5f7a';

const _p = new Vector3();
const _d = new Vector3();

export class FlightHud {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor(root: HTMLElement) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private project(universe: Vector3, world: WorldSpace, cam: PerspectiveCamera): { x: number; y: number } | null {
    world.toRender(universe, _p).project(cam);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h };
  }

  update(f: FlightModel, cam: PerspectiveCamera, world: WorldSpace, time: number): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.lineWidth = 1.5;
    c.font = '13px "Share Tech Mono", monospace';
    c.shadowColor = 'rgba(125,255,178,0.6)';
    c.shadowBlur = 6;

    // Gun cross: 450 m down the nose.
    const aim = this.project(_d.copy(f.position).addScaledVector(f.forward(_d.clone()), 450), world, cam);
    if (aim) {
      c.strokeStyle = GREEN;
      c.beginPath();
      c.arc(aim.x, aim.y, 14, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(aim.x + dx * 20, aim.y + dy * 20);
        c.lineTo(aim.x + dx * 30, aim.y + dy * 30);
      }
      c.stroke();
    }

    // Velocity vector: where the ship is actually going.
    if (f.speed > 1) {
      _d.copy(f.velocity).normalize();
      const vv = this.project(_p.copy(f.position).addScaledVector(_d, 450), world, cam);
      if (vv) {
        c.strokeStyle = AMBER;
        c.beginPath();
        c.arc(vv.x, vv.y, 6, 0, Math.PI * 2);
        c.moveTo(vv.x - 14, vv.y);
        c.lineTo(vv.x - 6, vv.y);
        c.moveTo(vv.x + 6, vv.y);
        c.lineTo(vv.x + 14, vv.y);
        c.moveTo(vv.x, vv.y - 6);
        c.lineTo(vv.x, vv.y - 12);
        c.stroke();
      }
    }

    // Readouts (bottom-left block).
    const x0 = 24;
    let y = this.h - 118;
    c.fillStyle = GREEN;
    c.fillText(`SPD ${f.speed.toFixed(0).padStart(4, ' ')} m/s`, x0, y);
    y += 20;
    this.bar(x0, y, 'THR', f.throttle, GREEN);
    y += 20;
    const locked = f.boostLocked;
    this.bar(x0, y, 'AB ', f.boostGauge, locked ? RED : f.boosting ? '#ffffff' : AMBER);
    y += 20;
    c.fillStyle = f.flightAssist ? GREEN : (time * 2) % 1 < 0.5 ? RED : AMBER;
    c.fillText(f.flightAssist ? 'FA  ON' : 'FA  OFF — NEWTONIAN', x0, y);
    y += 20;
    const g = f.bodyAccel.length() / 9.81;
    c.fillStyle = g > 8 ? RED : GREEN;
    c.fillText(`G   ${g.toFixed(1)}`, x0, y);
  }

  private bar(x: number, y: number, label: string, v: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = GREEN;
    c.fillText(label, x, y);
    c.strokeStyle = color;
    c.strokeRect(x + 36, y - 10, 120, 10);
    c.fillStyle = color;
    c.fillRect(x + 36, y - 10, 120 * Math.max(0, Math.min(1, v)), 10);
  }
}
