import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import type { ShipEntity } from '@/sim/Fleet';
import { gunOf, missileOf, selectedSubsystem, subsystemPosition } from '@/sim/Combat';
import { FACING_NAMES, ZONE_NAMES } from '@/sim/Damage';
import { HUD, claimRect, targetBottom, weaponsRect } from './hudLayout';

/**
 * Combat readouts on their own canvas (layered over FlightHud):
 *
 * - Weapons block (bottom right): selected gun and damage type [R], missile
 *   type and reload [Y], own shield / hull bars and a four-zone damage
 *   silhouette (nose, wings, engines).
 * - Target panel (left): name, role, range; shield facings (a four-segment
 *   diamond for capitals, a ring for fighters), hull, and the subsystem list
 *   with the B-selected one highlighted.
 * - Sub-target bracket on the selected subsystem in the view, and pips on
 *   the target's other subsystems (crossed out when destroyed).
 */
const GREEN = '#7dffb2';
const AMBER = '#ffc46b';
const RED = '#ff5f7a';
const CYAN = '#6fe6ff';
const PINK = '#ff5fb4';
const DIM = 'rgba(125,255,178,0.35)';
const TYPE_COLOR: Record<string, string> = { kinetic: AMBER, laser: CYAN, harmonic: PINK, explosive: '#ff9a4a' };

const _p = new Vector3();
const _w = new Vector3();

export class CombatHud {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Fitted turrets (shipyard hulls): set each frame by the flight scene; null = none. */
  turrets: { mounts: number; engaged: number; mode: 'free' | 'target' | 'hold'; pd: boolean } | null = null;
  /** Hangar complement launched / total; null = no hangar. */
  hangar: { up: number; total: number } | null = null;

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

  set visible(v: boolean) {
    this.canvas.style.display = v ? '' : 'none';
  }

  private project(universe: Vector3, world: WorldSpace, cam: PerspectiveCamera): { x: number; y: number } | null {
    world.toRender(universe, _p).project(cam);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h };
  }

  /** Call once per frame (after the camera is final). `target` = the player's lock target. */
  draw(player: ShipEntity, target: ShipEntity | null, cam: PerspectiveCamera, world: WorldSpace, time: number, showTarget = true): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.font = '13px "Share Tech Mono", monospace';
    c.shadowColor = 'rgba(125,255,178,0.6)';
    c.shadowBlur = 6;
    c.lineWidth = 1.5;
    if (!player.alive) return;
    this.weapons(player, time);
    if (showTarget && target && target.alive) {
      this.targetPanel(player, target, time);
      this.subBrackets(player, target, cam, world, time);
    }
  }

  private weapons(p: ShipEntity, time: number): void {
    const c = this.ctx;
    const r = weaponsRect(this.w, this.h);
    const x = r.x + 12;
    let y = r.y + 18;
    const gun = gunOf(p);
    const msl = missileOf(p);
    const cs = p.combat;
    c.fillStyle = 'rgba(0,10,6,0.45)';
    c.fillRect(r.x, r.y, r.w, r.h);
    const tu = this.turrets;
    const hg = this.hangar;
    if (tu || hg) {
      // Outfitted hulls: turret discipline [U] and the hangar complement, on the line above the block (hudLayout.weaponsLine).
      let t = '';
      if (tu && tu.mounts) t += `[U] TURRETS ${tu.engaged}/${tu.mounts} ${tu.mode === 'free' ? 'FREE' : tu.mode === 'target' ? 'TGT' : 'HOLD'}`;
      if (tu?.pd) t += `${t ? ' · ' : ''}PD`;
      if (hg) t += `${t ? ' · ' : ''}BAY ${hg.up}/${hg.total}`;
      const w = Math.min(Math.max(r.w, c.measureText(t).width + 24), HUD.objectivesW);
      c.fillStyle = 'rgba(0,10,6,0.45)';
      c.fillRect(r.x + r.w - w, r.y - HUD.weaponsLine, w, 22);
      c.fillStyle = tu?.mode === 'hold' ? AMBER : GREEN;
      c.fillText(t, r.x + r.w - w + 12, r.y - HUD.weaponsLine + 16);
    }
    c.fillStyle = GREEN;
    if (gun) {
      c.fillText(`[R] ${gun.name}`, x, y);
      c.fillStyle = TYPE_COLOR[gun.type] ?? GREEN;
      c.fillText(gun.type.toUpperCase(), x + 170, y);
    }
    y += 18;
    if (msl) {
      c.fillStyle = cs.missileReload > 0 ? DIM : GREEN;
      c.fillText(`[Y] ${msl.name}${msl.salvo > 1 ? ` ×${msl.salvo}` : ''}`, x, y);
      const k = 1 - cs.missileReload / msl.reload;
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(x + 4, y + 5, 150, 3);
      c.fillStyle = k >= 1 ? GREEN : AMBER;
      c.fillRect(x + 4, y + 5, 150 * Math.max(0, Math.min(1, k)), 3);
    }
    y += 24;
    this.bar(x, y, 'SHD', p.shield / p.shieldMax, p.shield > 0 ? CYAN : (time * 3) % 1 < 0.5 ? RED : 'rgba(255,95,122,0.4)');
    y += 16;
    this.bar(x, y, 'HUL', p.hull / p.hullMax, p.hull / p.hullMax < 0.3 ? RED : AMBER);
    // Zone silhouette: a little plan view of the fighter.
    const st = cs.dmg;
    if (!st.capital) {
      const cx = x + 196;
      const cy = y + 12;
      const col = (v: number) => (v > 0.75 ? RED : v > 0.35 ? AMBER : v > 0.02 ? '#d8ff9a' : DIM);
      c.lineWidth = 3;
      // Nose
      c.strokeStyle = col(st.zones[0]);
      c.beginPath();
      c.moveTo(cx, cy - 26);
      c.lineTo(cx, cy - 8);
      c.stroke();
      // Wings (port = left of the plan view)
      c.strokeStyle = col(st.zones[1]);
      c.beginPath();
      c.moveTo(cx - 3, cy - 4);
      c.lineTo(cx - 20, cy + 8);
      c.stroke();
      c.strokeStyle = col(st.zones[2]);
      c.beginPath();
      c.moveTo(cx + 3, cy - 4);
      c.lineTo(cx + 20, cy + 8);
      c.stroke();
      // Engines
      c.strokeStyle = col(st.zones[3]);
      c.beginPath();
      c.moveTo(cx - 5, cy + 12);
      c.lineTo(cx + 5, cy + 12);
      c.stroke();
      c.lineWidth = 1.5;
      const worst = st.zones.indexOf(Math.max(...st.zones));
      if (st.zones[worst] > 0.35) {
        c.fillStyle = st.zones[worst] > 0.75 ? RED : AMBER;
        c.fillText(`${ZONE_NAMES[worst]} ${st.zones[worst] > 0.75 ? 'CRITICAL' : 'DAMAGED'}`, x, y + 22);
      }
      if (st.tether > 0) {
        c.fillStyle = (time * 4) % 1 < 0.6 ? RED : AMBER;
        c.fillText('HARPOONED — THRUST 50%', x, y + 40);
      }
    }
  }

  private bar(x: number, y: number, label: string, v: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = GREEN;
    c.fillText(label, x, y);
    c.strokeStyle = color;
    c.strokeRect(x + 34, y - 9, 120, 9);
    c.fillStyle = color;
    c.fillRect(x + 34, y - 9, 120 * Math.max(0, Math.min(1, v)), 9);
  }

  private targetPanel(player: ShipEntity, t: ShipEntity, time: number): void {
    const c = this.ctx;
    const st = t.combat.dmg;
    const x = 24;
    // Below the dev line (or the expanded debug panel), above the comms stack.
    const debug = claimRect('debug');
    const top = Math.max(HUD.targetY, debug ? debug.y + debug.h + 12 : 0);
    let y = top + 18;
    const subs = st.subsystems;
    const rows = Math.max(0, Math.min(subs.length, 14, Math.floor((targetBottom(this.h) - top - 112) / 15)));
    c.fillStyle = 'rgba(0,10,6,0.45)';
    c.fillRect(x - 12, y - 18, 262, 112 + rows * 15);
    const dist = t.flight.position.distanceTo(player.flight.position);
    c.fillStyle = PINK;
    c.fillText(`${t.name.toUpperCase()}`, x, y);
    y += 16;
    c.fillStyle = DIM;
    c.fillText(`${t.model.blueprint.designation} ${t.combat.stats.role.toUpperCase()} · ${(dist / 1000).toFixed(2)} km`, x, y);
    y += 14;

    // Shield facings: diamond of four segments (capitals) or a ring (fighters).
    const cx = x + 34;
    const cy = y + 30;
    const R = 24;
    c.lineWidth = 5;
    if (st.capital) {
      // FORE up, AFT down, PORT left, STBD right (plan view, nose up).
      const ang = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];
      for (let f = 0; f < 4; f++) {
        const k = st.facings[f] / Math.max(st.facingMax, 1);
        c.strokeStyle = k <= 0 ? ((time * 3) % 1 < 0.5 ? RED : 'rgba(255,95,122,0.3)') : k < 0.35 ? AMBER : CYAN;
        c.globalAlpha = k <= 0 ? 1 : 0.35 + 0.65 * k;
        c.beginPath();
        c.arc(cx, cy, R, ang[f] - 0.72, ang[f] + 0.72);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.lineWidth = 1.5;
      c.fillStyle = CYAN;
      c.font = '10px "Share Tech Mono", monospace';
      for (let f = 0; f < 4; f++) {
        const k = st.facings[f] / Math.max(st.facingMax, 1);
        const a = [-Math.PI / 2, Math.PI / 2, Math.PI, 0][f];
        c.fillStyle = k <= 0 ? RED : CYAN;
        c.fillText(FACING_NAMES[f][0], cx + Math.cos(a) * (R + 10) - 3, cy + Math.sin(a) * (R + 10) + 4);
      }
      c.font = '13px "Share Tech Mono", monospace';
    } else {
      const k = t.shield / t.shieldMax;
      c.strokeStyle = k <= 0 ? RED : CYAN;
      c.globalAlpha = 0.3;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      c.stroke();
      c.lineWidth = 1.5;
    }
    // Hull silhouette dot (red when low).
    c.fillStyle = t.hull / t.hullMax < 0.3 ? RED : AMBER;
    c.beginPath();
    c.arc(cx, cy, 6, 0, Math.PI * 2);
    c.fill();
    this.bar(x + 80, cy - 8, 'SHD', t.shield / Math.max(1, t.shieldMax), CYAN);
    this.bar(x + 80, cy + 10, 'HUL', t.hull / t.hullMax, t.hull / t.hullMax < 0.3 ? RED : AMBER);
    y = cy + 44;

    if (!subs.length) {
      if (!st.capital) {
        const worst = st.zones.indexOf(Math.max(...st.zones));
        if (st.zones[worst] > 0.2) {
          c.fillStyle = st.zones[worst] > 0.75 ? RED : AMBER;
          c.fillText(`${ZONE_NAMES[worst]} HIT`, x, y);
        }
      }
      return;
    }
    const sel = selectedSubsystem(player, t);
    c.fillStyle = DIM;
    c.fillText(`[B] SUBSYSTEMS ${subs.filter((s) => !s.destroyed).length}/${subs.length}`, x, y);
    y += 16;
    // Selected first (so it is always listed), then the rest in order.
    const order = sel ? [sel, ...subs.filter((s) => s !== sel)] : subs;
    for (let i = 0; i < rows; i++) {
      const s = order[i];
      const k = s.hp / s.hpMax;
      const isSel = s === sel;
      c.fillStyle = s.destroyed ? 'rgba(255,95,122,0.55)' : isSel ? '#ffffff' : k < 0.5 ? AMBER : GREEN;
      c.fillText(`${isSel ? '▶' : ' '} ${s.label}`, x, y);
      if (s.destroyed) {
        c.fillRect(x + 12, y - 4, c.measureText(s.label).width + 4, 1.5);
        c.fillText('DESTROYED', x + 150, y);
      } else {
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(x + 150, y - 7, 70, 5);
        c.fillStyle = isSel ? '#ffffff' : k < 0.5 ? AMBER : GREEN;
        c.fillRect(x + 150, y - 7, 70 * k, 5);
      }
      y += 15;
    }
  }

  private subBrackets(player: ShipEntity, t: ShipEntity, cam: PerspectiveCamera, world: WorldSpace, time: number): void {
    const subs = t.combat.dmg.subsystems;
    if (!subs.length) return;
    const c = this.ctx;
    const sel = selectedSubsystem(player, t);
    const dist = t.flight.position.distanceTo(player.flight.position);
    const fovScale = this.h / (2 * Math.tan(((cam.fov * Math.PI) / 180) / 2));
    for (const s of subs) {
      const pt = this.project(subsystemPosition(t, s, _w), world, cam);
      if (!pt || pt.x < 0 || pt.y < 0 || pt.x > this.w || pt.y > this.h) continue;
      const d = world.toRender(_w, _p).length();
      if (s === sel) {
        const r = Math.max(10, (s.radius * fovScale) / Math.max(d, 1));
        const pulse = 1 + 0.12 * Math.sin(time * 8);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        const h = r * pulse;
        c.beginPath();
        c.moveTo(pt.x, pt.y - h - 6);
        c.lineTo(pt.x + h + 6, pt.y);
        c.lineTo(pt.x, pt.y + h + 6);
        c.lineTo(pt.x - h - 6, pt.y);
        c.closePath();
        c.stroke();
        c.fillStyle = '#ffffff';
        c.fillText(`${s.label}  ${Math.round((s.hp / s.hpMax) * 100)}%`, pt.x + h + 12, pt.y + 4);
        c.lineWidth = 1.5;
      } else if (dist < 9000) {
        c.strokeStyle = s.destroyed ? 'rgba(255,95,122,0.7)' : 'rgba(255,95,180,0.55)';
        c.beginPath();
        if (s.destroyed) {
          c.moveTo(pt.x - 3, pt.y - 3);
          c.lineTo(pt.x + 3, pt.y + 3);
          c.moveTo(pt.x + 3, pt.y - 3);
          c.lineTo(pt.x - 3, pt.y + 3);
        } else c.rect(pt.x - 2, pt.y - 2, 4, 4);
        c.stroke();
      }
    }
  }
}
