import { Vector3, type PerspectiveCamera } from 'three';
import type { FlightModel } from '@/sim/FlightModel';
import type { WorldSpace } from '@/core/WorldSpace';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import type { LockState } from '@/sim/Missiles';
import { LASER } from '@/sim/Weapons';

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
const _r = new Vector3();
const _vt = new Vector3();
const PINK = '#ff5fb4';

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
    this.drawFlightBlock(f, time);
  }

  /** Target boxes, lock-on, lead pip, off-screen arrow (M11). */
  drawTargets(player: ShipEntity, fleet: Fleet, lock: LockState, cam: PerspectiveCamera, world: WorldSpace, time: number): void {
    const c = this.ctx;
    const fovScale = this.h / (2 * Math.tan(((cam.fov * Math.PI) / 180) / 2));
    for (const s of fleet.ships) {
      if (!s.alive || s === player) continue;
      const hostile = s.faction !== player.faction;
      const isTarget = s === lock.target;
      const pt = this.project(s.flight.position, world, cam);
      if (!pt) continue;
      const dist = world.toRender(s.flight.position, _p).length();
      const half = Math.max(isTarget ? 16 : 9, (s.radius * fovScale) / Math.max(dist, 1));
      c.strokeStyle = hostile ? (isTarget ? PINK : 'rgba(255,95,180,0.7)') : 'rgba(125,255,178,0.6)';
      c.lineWidth = isTarget ? 2 : 1.2;
      this.brackets(pt.x, pt.y, half, half * 0.35);
      if (isTarget) {
        c.fillStyle = PINK;
        c.fillText(`${s.name.toUpperCase()}  ${(dist / 1000).toFixed(2)} km`, pt.x + half + 8, pt.y - half + 10);
        this.miniBar(pt.x + half + 8, pt.y - half + 16, s.shield / s.shieldMax, '#6fe6ff');
        this.miniBar(pt.x + half + 8, pt.y - half + 22, s.hull / s.hullMax, AMBER);
        // Lock-on: a diamond collapsing onto the target, then a hard red box.
        if (lock.locked) {
          if ((time * 4) % 1 < 0.7) {
            c.strokeStyle = RED;
            c.lineWidth = 2.5;
            c.strokeRect(pt.x - half - 6, pt.y - half - 6, (half + 6) * 2, (half + 6) * 2);
            c.fillStyle = RED;
            c.fillText('LOCK', pt.x - 16, pt.y + half + 22);
          }
        } else if (lock.progress > 0) {
          const r = half + 6 + (1 - lock.progress) * 90;
          const a = time * 3 + (1 - lock.progress) * 2;
          c.strokeStyle = AMBER;
          c.lineWidth = 1.5;
          c.beginPath();
          for (let k = 0; k <= 4; k++) {
            const ang = a + (k * Math.PI) / 2;
            const x = pt.x + Math.cos(ang) * r;
            const y = pt.y + Math.sin(ang) * r;
            if (k === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
          c.stroke();
        }
        // Gun lead pip: where to aim so 1600 m/s bolts intercept.
        _r.subVectors(s.flight.position, player.flight.position);
        _vt.subVectors(s.flight.velocity, player.flight.velocity);
        const t = intercept(_r, _vt, LASER.speed);
        if (t > 0) {
          const lead = this.project(_d.copy(player.flight.position).add(_r).addScaledVector(_vt, t), world, cam);
          if (lead) {
            c.strokeStyle = AMBER;
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(lead.x, lead.y - 7);
            c.lineTo(lead.x + 7, lead.y);
            c.lineTo(lead.x, lead.y + 7);
            c.lineTo(lead.x - 7, lead.y);
            c.closePath();
            c.stroke();
          }
        }
      }
    }
    // Off-screen / behind: arrow on the screen edge toward the target.
    const t = lock.target;
    if (t && t.alive) {
      world.toRender(t.flight.position, _p).applyMatrix4(cam.matrixWorldInverse);
      const onScreen = this.project(t.flight.position, world, cam);
      const inView = onScreen && onScreen.x > 0 && onScreen.x < this.w && onScreen.y > 0 && onScreen.y < this.h;
      if (!inView) {
        const ang = Math.atan2(-_p.y, _p.x);
        const cx = this.w / 2;
        const cy = this.h / 2;
        const rr = Math.min(cx, cy) - 40;
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr;
        c.fillStyle = PINK;
        c.beginPath();
        c.moveTo(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14);
        c.lineTo(x + Math.cos(ang + 2.5) * 10, y + Math.sin(ang + 2.5) * 10);
        c.lineTo(x + Math.cos(ang - 2.5) * 10, y + Math.sin(ang - 2.5) * 10);
        c.fill();
      }
    }
  }

  private brackets(x: number, y: number, h: number, l: number): void {
    const c = this.ctx;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.moveTo(x + sx * h, y + sy * (h - l));
      c.lineTo(x + sx * h, y + sy * h);
      c.lineTo(x + sx * (h - l), y + sy * h);
    }
    c.stroke();
  }

  private miniBar(x: number, y: number, v: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(x, y, 70, 4);
    c.fillStyle = color;
    c.fillRect(x, y, 70 * Math.max(0, Math.min(1, v)), 4);
  }

  private drawFlightBlock(f: FlightModel, time: number): void {
    const c = this.ctx;
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

/** Smallest positive t with |r + v·t| = s·t (projectile intercept), or -1. */
export function intercept(r: Vector3, v: Vector3, s: number): number {
  const a = v.dot(v) - s * s;
  const b = 2 * r.dot(v);
  const cc = r.dot(r);
  if (Math.abs(a) < 1e-6) return b < 0 ? -cc / b : -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : -1;
}
