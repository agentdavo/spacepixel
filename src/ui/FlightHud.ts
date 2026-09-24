import { Vector3, type PerspectiveCamera } from 'three';
import type { FlightModel } from '@/sim/FlightModel';
import type { WorldSpace } from '@/core/WorldSpace';
import { hostile as isHostile, type Fleet, type ShipEntity } from '@/sim/Fleet';
import type { LockState } from '@/sim/Missiles';
import { leadSpeedOf, selectedSubsystem, subsystemPosition } from '@/sim/Combat';
import type { MissionRunner } from '@/game/Missions';
import { HUD, centerBand, corridorY, fitText, freeSpan, objectivesX, placeIn, promptY } from './hudLayout';
import { LABEL_PRIORITY, hudLabels } from './HudLabels';

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
const F13 = '13px "Share Tech Mono", monospace';

export class FlightHud {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** 0..1 instrument failure (Dead Zone): marks drop out, jitter, and lie. */
  navNoise = 0;

  /** True if a nav/target mark should be skipped this frame. */
  private glitch(): boolean {
    return this.navNoise > 0 && Math.random() < this.navNoise * 0.85;
  }

  constructor(root: HTMLElement) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize(window.innerWidth, window.innerHeight);
  }

  /** The HUD's 2D context, for overlays that draw into the same canvas (one layer, one clear). */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
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
    const j = this.navNoise * 40;
    return { x: (_p.x * 0.5 + 0.5) * this.w + (Math.random() - 0.5) * j, y: (-_p.y * 0.5 + 0.5) * this.h + (Math.random() - 0.5) * j };
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
      // World-space labels never cover the gun cross.
      hudLabels.reticle(aim.x, aim.y, 36);
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
        hudLabels.obstacle(vv.x - 14, vv.y - 12, 28, 20);
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
      if (this.glitch()) continue;
      const hostile = isHostile(s, player);
      const isTarget = s === lock.target;
      const pt = this.project(s.flight.position, world, cam);
      if (!pt) continue;
      const dist = world.toRender(s.flight.position, _p).length();
      const half = Math.max(isTarget ? 16 : 9, (s.radius * fovScale) / Math.max(dist, 1));
      c.strokeStyle = hostile ? (isTarget ? PINK : 'rgba(255,95,180,0.7)') : 'rgba(125,255,178,0.6)';
      c.lineWidth = isTarget ? 2 : 1.2;
      this.brackets(pt.x, pt.y, half, half * 0.35);
      // Brackets are obstacles for every label; the target's own label is pinned (always shown, placed first).
      if (!isTarget) hudLabels.obstacle(pt.x - half, pt.y - half, half * 2, half * 2);
      if (isTarget) {
        hudLabels.add({
          id: 'target',
          x: pt.x,
          y: pt.y,
          r: half + 2,
          lines: [{ text: `${s.name.toUpperCase()}  ${(dist / 1000).toFixed(2)} km`, color: PINK, font: F13 }],
          bars: [
            { value: s.shield / s.shieldMax, color: '#6fe6ff' },
            { value: s.hull / s.hullMax, color: AMBER },
          ],
          priority: LABEL_PRIORITY.target,
          pinned: true,
        });
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
        // Gun lead pip: where to aim so the selected gun's bolts intercept (the B-selected subsystem, if any).
        const sub = selectedSubsystem(player, s);
        _r.subVectors(sub ? subsystemPosition(s, sub, _r) : s.flight.position, player.flight.position);
        _vt.subVectors(s.flight.velocity, player.flight.velocity);
        const t = intercept(_r, _vt, leadSpeedOf(player));
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

  /** Nav marker for the next Lantern on the route: diamond, name, range, ETA. */
  drawNav(name: string, universe: Vector3, from: Vector3, cam: PerspectiveCamera, world: WorldSpace, time: number): void {
    const c = this.ctx;
    if (this.glitch()) return;
    const dist = universe.distanceTo(from);
    const label = `LANTERN → ${name.toUpperCase()}  ${dist > 10_000 ? (dist / 1000).toFixed(0) : (dist / 1000).toFixed(1)} km`;
    const pt = this.project(universe, world, cam);
    const cyan = '#6fe6ff';
    c.strokeStyle = cyan;
    c.fillStyle = cyan;
    c.lineWidth = 1.5;
    if (pt && pt.x > 0 && pt.x < this.w && pt.y > 0 && pt.y < this.h) {
      const r = 11 + Math.sin(time * 5) * 2;
      c.beginPath();
      c.moveTo(pt.x, pt.y - r);
      c.lineTo(pt.x + r, pt.y);
      c.lineTo(pt.x, pt.y + r);
      c.lineTo(pt.x - r, pt.y);
      c.closePath();
      c.stroke();
      hudLabels.add({ id: 'nav', x: pt.x, y: pt.y, r: 13, lines: [{ text: label, color: cyan, font: F13 }], priority: LABEL_PRIORITY.nav });
    } else {
      world.toRender(universe, _p).applyMatrix4(cam.matrixWorldInverse);
      const ang = Math.atan2(-_p.y, _p.x);
      const rr = Math.min(this.w, this.h) / 2 - 70;
      const x = this.w / 2 + Math.cos(ang) * rr;
      const y = this.h / 2 + Math.sin(ang) * rr;
      c.beginPath();
      c.arc(x, y, 6, 0, Math.PI * 2);
      c.stroke();
      c.fillText(label, x - 60, y + 22);
    }
  }

  /** Top-centre status strip: system, drive state, transit banner. */
  drawStatus(system: string, cruise: 'off' | 'spool' | 'on', banner: string): void {
    const c = this.ctx;
    c.textAlign = 'center';
    c.fillStyle = GREEN;
    c.fillText(`${system.toUpperCase()}${cruise === 'on' ? '  ·  CRUISE' : cruise === 'spool' ? '  ·  CRUISE SPOOLING' : ''}`, this.w / 2, 28);
    if (this.navNoise > 0.2 && Math.random() < 0.7) {
      c.fillStyle = RED;
      c.fillText('NAV: NO FIX · RADAR: NO RETURN · FLY BY EYE', this.w / 2, 48);
    }
    if (banner) {
      c.fillStyle = '#ffffff';
      c.font = '700 20px "Oxanium", sans-serif';
      c.fillText(banner, this.w / 2, this.h * 0.2);
      c.font = '13px "Share Tech Mono", monospace';
    }
    c.textAlign = 'left';
  }

  /** Objectives panel (top-right) + mission outcome banner. */
  drawObjectives(m: MissionRunner, time: number): void {
    const c = this.ctx;
    const x = objectivesX(this.w) + 12;
    let y = HUD.objectivesY;
    c.fillStyle = 'rgba(0,10,6,0.55)';
    c.fillRect(x - 12, y - 20, HUD.objectivesW, 30 + m.def.objectives.length * 20);
    c.fillStyle = '#ffffff';
    c.fillText(fitText(c, `${m.def.episode} · ${m.def.title}`, HUD.objectivesW - 20, 13, 11, '"Share Tech Mono", monospace'), x, y);
    c.font = '13px "Share Tech Mono", monospace';
    y += 22;
    m.def.objectives.forEach((o, i) => {
      const st = m.state[i];
      if (st === 'locked') c.fillStyle = 'rgba(125,255,178,0.35)';
      else if (st === 'done') c.fillStyle = GREEN;
      else if (st === 'failed') c.fillStyle = RED;
      else c.fillStyle = (time * 1.5) % 1 < 0.75 ? AMBER : '#ffffff';
      const box = st === 'done' ? '[■]' : st === 'failed' ? '[×]' : '[ ]';
      c.fillText(fitText(c, `${box} ${o.text}${o.optional ? ' (opt)' : ''}`, HUD.objectivesW - 20, 13, 11, '"Share Tech Mono", monospace'), x, y);
      c.font = '13px "Share Tech Mono", monospace';
      y += 20;
    });
    if (m.outcome !== 'running') {
      c.textAlign = 'center';
      c.font = '800 44px "Oxanium", sans-serif';
      c.fillStyle = m.outcome === 'success' ? '#ffffff' : RED;
      c.shadowColor = m.outcome === 'success' ? 'rgba(255,122,28,0.9)' : 'rgba(255,0,60,0.9)';
      c.fillText(m.outcome === 'success' ? 'MISSION COMPLETE' : 'MISSION FAILED', this.w / 2, this.h * 0.42);
      c.font = '13px "Share Tech Mono", monospace';
      c.textAlign = 'left';
      c.shadowColor = 'rgba(125,255,178,0.6)';
    }
  }

  /**
   * M17 tactical overlay: reference grid on the player's altitude plane,
   * range rings, every ship as a symbol with an altitude stalk to the grid
   * and a 3 s velocity vector. Friendly = circle, hostile = diamond.
   */
  drawTactical(
    player: ShipEntity,
    fleet: Fleet,
    cam: PerspectiveCamera,
    world: WorldSpace,
    status: string,
    markers: { label: string; pos: Vector3; radius: number }[] = [],
  ): void {
    const c = this.ctx;
    const pp = player.flight.position;
    const y0 = pp.y;
    const line = (a: Vector3, b: Vector3) => {
      const pa = this.project(a, world, cam);
      const pb = this.project(b, world, cam);
      if (!pa || !pb) return;
      c.moveTo(pa.x, pa.y);
      c.lineTo(pb.x, pb.y);
    };
    // Grid (500 m) snapped to world so it slides under the ship.
    const step = 500;
    const ext = 4000;
    const gx = Math.round(pp.x / step) * step;
    const gz = Math.round(pp.z / step) * step;
    c.strokeStyle = 'rgba(111,230,255,0.16)';
    c.lineWidth = 1;
    c.beginPath();
    for (let k = -ext; k <= ext; k += step) {
      line(_r.set(gx + k, y0, gz - ext), _vt.set(gx + k, y0, gz + ext));
      line(_r.set(gx - ext, y0, gz + k), _vt.set(gx + ext, y0, gz + k));
    }
    c.stroke();
    // Range rings.
    c.strokeStyle = 'rgba(111,230,255,0.35)';
    for (const r of [1000, 2000, 3000]) {
      c.beginPath();
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        const p = this.project(_r.set(pp.x + Math.cos(t) * r, y0, pp.z + Math.sin(t) * r), world, cam);
        if (!p) continue;
        if (a === 0) c.moveTo(p.x, p.y);
        else c.lineTo(p.x, p.y);
      }
      c.stroke();
    }
    // Lanterns and other landmarks: projected rings with labels.
    c.strokeStyle = '#6fe6ff';
    c.fillStyle = '#6fe6ff';
    for (const m of markers) {
      c.beginPath();
      for (let a = 0; a <= 32; a++) {
        const t = (a / 32) * Math.PI * 2;
        const p = this.project(_r.set(m.pos.x + Math.cos(t) * m.radius, m.pos.y, m.pos.z + Math.sin(t) * m.radius), world, cam);
        if (!p) continue;
        if (a === 0) c.moveTo(p.x, p.y);
        else c.lineTo(p.x, p.y);
      }
      c.stroke();
      const p = this.project(m.pos, world, cam);
      if (p) c.fillText(m.label, p.x + 8, p.y + 4);
    }
    // Ships (labels staggered so tight formations stay readable).
    let labelRow = 0;
    for (const s of fleet.ships) {
      if (!s.alive) continue;
      const sp = s.flight.position;
      const p = this.project(sp, world, cam);
      const g = this.project(_r.set(sp.x, y0, sp.z), world, cam);
      if (!p || !g) continue;
      const hostile = isHostile(s, player);
      const col = s === player ? '#ffffff' : hostile ? PINK : GREEN;
      c.strokeStyle = col;
      c.fillStyle = col;
      c.lineWidth = 1.3;
      // Altitude stalk + foot.
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(g.x, g.y);
      c.lineTo(p.x, p.y);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.ellipse(g.x, g.y, 5, 2.5, 0, 0, Math.PI * 2);
      c.stroke();
      // Velocity vector (3 s).
      const v = this.project(_vt.copy(sp).addScaledVector(s.flight.velocity, 3), world, cam);
      if (v) {
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(v.x, v.y);
        c.stroke();
      }
      // Symbol.
      c.beginPath();
      if (s === player) {
        c.moveTo(p.x, p.y - 8);
        c.lineTo(p.x + 6, p.y + 6);
        c.lineTo(p.x - 6, p.y + 6);
        c.closePath();
      } else if (hostile) {
        c.moveTo(p.x, p.y - 7);
        c.lineTo(p.x + 7, p.y);
        c.lineTo(p.x, p.y + 7);
        c.lineTo(p.x - 7, p.y);
        c.closePath();
      } else {
        c.arc(p.x, p.y, 6, 0, Math.PI * 2);
      }
      c.stroke();
      c.fillText(`${s.name.toUpperCase()}  ${(sp.y - y0 >= 0 ? '+' : '') + Math.round(sp.y - y0)}m`, p.x + 10, p.y - 8 - (labelRow++ % 3) * 13);
    }
    c.fillStyle = '#6fe6ff';
    c.fillText('TACTICAL // TIME ×0.25 · 1 FORM UP · 2 ATTACK MY TARGET · 3 ENGAGE AT WILL · 4 COVER ME · WHEEL ZOOM', 24, 60);
    if (status) {
      c.fillStyle = '#ffffff';
      c.fillText(status, 24, 80);
    }
  }

  /** Campaign objectives panel (hidden script cues already filtered out). */
  drawCampaign(title: string, objectives: { text: string; state: string; optional: boolean }[], outcome: string, time: number): void {
    const c = this.ctx;
    const x = objectivesX(this.w) + 12;
    let y = HUD.objectivesY;
    const shown = objectives.filter((o) => o.state !== 'locked').length;
    c.fillStyle = 'rgba(0,10,6,0.55)';
    c.fillRect(x - 12, y - 20, HUD.objectivesW, 30 + shown * 20);
    c.fillStyle = '#ffffff';
    c.fillText(fitText(c, title, HUD.objectivesW - 20, 13, 11, '"Share Tech Mono", monospace'), x, y);
    c.font = '13px "Share Tech Mono", monospace';
    y += 22;
    for (const o of objectives) {
      if (o.state === 'locked') continue;
      c.fillStyle = o.state === 'done' ? GREEN : o.state === 'failed' ? RED : (time * 1.5) % 1 < 0.75 ? AMBER : '#ffffff';
      const box = o.state === 'done' ? '[■]' : o.state === 'failed' ? '[×]' : '[ ]';
      c.fillText(fitText(c, `${box} ${o.text}${o.optional ? ' (opt)' : ''}`, HUD.objectivesW - 20, 13, 11, '"Share Tech Mono", monospace'), x, y);
      c.font = '13px "Share Tech Mono", monospace';
      y += 20;
    }
    if (outcome === 'success' || outcome === 'failure') {
      c.textAlign = 'center';
      c.font = '800 44px "Oxanium", sans-serif';
      c.fillStyle = outcome === 'success' ? '#ffffff' : RED;
      c.fillText(outcome === 'success' ? 'EPISODE COMPLETE' : 'MISSION FAILED', this.w / 2, this.h * 0.42);
      c.font = '13px "Share Tech Mono", monospace';
      c.textAlign = 'left';
    }
  }

  /** Beacon dwell zone: projected ring + progress arc. */
  drawDwell(universe: Vector3, radius: number, progress: number, cam: PerspectiveCamera, world: WorldSpace): void {
    const pt = this.project(universe, world, cam);
    if (!pt) return;
    const dist = world.toRender(universe, _p).length();
    const fovScale = this.h / (2 * Math.tan(((cam.fov * Math.PI) / 180) / 2));
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
    c.fillText(progress >= 1 ? 'HELD' : `HOLD ${(progress * 100).toFixed(0)}%`, pt.x - 22, pt.y + r + 22);
  }

  /** Blank the canvas (docking cutaways own the screen). */
  clear(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /**
   * Station / carrier nav markers (docking & trade): a small square per
   * dockable with name, kind and range; the highlighted one (nearest inside
   * 5 km, or the berth you're cleared for) is drawn bold.
   */
  drawStations(
    list: { name: string; pos: Vector3; faction: string; kind: string }[],
    from: Vector3,
    highlight: string | null,
    cam: PerspectiveCamera,
    world: WorldSpace,
  ): void {
    const c = this.ctx;
    for (const st of list) {
      if (this.glitch()) continue;
      const pt = this.project(st.pos, world, cam);
      if (!pt || pt.x < 0 || pt.x > this.w || pt.y < 0 || pt.y > this.h) continue;
      const hot = st.name === highlight;
      const col = st.faction === 'choir' ? PINK : st.faction === 'rustwake' ? AMBER : '#6fe6ff';
      const dist = st.pos.distanceTo(from);
      const range = dist > 10_000 ? `${(dist / 1000).toFixed(0)} km` : `${(dist / 1000).toFixed(1)} km`;
      c.strokeStyle = col;
      c.fillStyle = col;
      c.globalAlpha = hot ? 1 : 0.75;
      c.lineWidth = hot ? 2 : 1.2;
      const r = hot ? 9 : 6;
      c.strokeRect(pt.x - r, pt.y - r, r * 2, r * 2);
      c.beginPath();
      c.moveTo(pt.x - r - 4, pt.y);
      c.lineTo(pt.x - r, pt.y);
      c.moveTo(pt.x + r, pt.y);
      c.lineTo(pt.x + r + 4, pt.y);
      c.stroke();
      c.globalAlpha = 1;
      hudLabels.add({
        id: `st:${st.name}`,
        x: pt.x,
        y: pt.y,
        r: r + 4,
        lines: [
          { text: `${st.name.toUpperCase()}  ${range}`, color: col, font: F13, alpha: hot ? 1 : 0.75 },
          { text: st.kind.toUpperCase(), color: col, font: F13, alpha: 0.7 },
        ],
        priority: hot ? LABEL_PRIORITY.dockTarget : LABEL_PRIORITY.station,
      });
    }
  }

  /**
   * ILS-style approach corridor out of a docking bay: a string of boxes every
   * 350 m to 3.5 km (tighter near the mouth), a dashed centreline, a flight
   * director diamond 600 m ahead of you on the centreline, and deviation /
   * range / closure readouts. Boxes you're inside light cyan, others amber.
   */
  drawDockCorridor(bay: Vector3, axis: Vector3, up: Vector3, pos: Vector3, relVel: Vector3, name: string, cam: PerspectiveCamera, world: WorldSpace, time: number, scale = 1): void {
    const c = this.ctx;
    const right = _r.crossVectors(up, axis).normalize();
    const rel = _d.subVectors(pos, bay);
    const lz = rel.dot(axis);
    const lx = rel.dot(right);
    const ly = rel.dot(up);
    const corner = _vt;
    const pts: { x: number; y: number }[] = [];
    c.lineWidth = 1.5;
    for (let k = 10; k >= 1; k--) {
      // Big hulls (and the descent corridor) fly a longer, wider corridor: `scale`.
      const d = k * 350 * scale;
      const half = (40 + d * 0.05) * Math.sqrt(scale);
      const inside = Math.abs(lx) < half && Math.abs(ly) < half * 0.7;
      // Only the gates still ahead of you (and never more than ~2 km of them).
      if (d > lz - 150 * scale || d < lz - 2200 * scale) continue;
      pts.length = 0;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        corner.copy(bay).addScaledVector(axis, d).addScaledVector(right, sx * half).addScaledVector(up, sy * half * 0.7);
        const p = this.project(corner, world, cam);
        if (p) pts.push(p);
      }
      if (pts.length < 4) continue;
      c.strokeStyle = inside ? '#6fe6ff' : AMBER;
      c.fillStyle = c.strokeStyle;
      c.globalAlpha = 0.95 - Math.max(0, lz - d - 1200) / 2000;
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.stroke();
      // Corner ticks: the OVA "gate" look.
      for (const p of pts) c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    c.globalAlpha = 0.6;
    c.setLineDash([6, 8]);
    c.lineDashOffset = -time * 40;
    c.strokeStyle = '#6fe6ff';
    const a = this.project(bay, world, cam);
    const b = this.project(corner.copy(bay).addScaledVector(axis, Math.max(600, Math.min(4000, lz + 800))), world, cam);
    if (a && b) {
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.setLineDash([]);
    c.globalAlpha = 1;
    // Flight director: where to point the nose.
    const fd = this.project(corner.copy(bay).addScaledVector(axis, Math.max(0, lz - 600)), world, cam);
    if (fd) {
      const r = 10 + Math.sin(time * 6) * 2;
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(fd.x, fd.y - r);
      c.lineTo(fd.x + r, fd.y);
      c.lineTo(fd.x, fd.y + r);
      c.lineTo(fd.x - r, fd.y);
      c.closePath();
      c.stroke();
    }
    if (a) {
      c.strokeStyle = GREEN;
      c.lineWidth = 2;
      c.strokeRect(a.x - 12, a.y - 8, 24, 16);
    }
    // Deviation needles (localizer / glideslope) and readouts, lower centre (clear of the radio panels).
    const cy = corridorY(this.h);
    const span = freeSpan(this.w, cy, 150);
    const spanW = Math.min(560, span.x1 - span.x0);
    const cx = placeIn(this.w, span, spanW);
    const half = 40 + Math.max(0, lz) * 0.05;
    const nx = Math.max(-1, Math.min(1, lx / (half * 2)));
    const ny = Math.max(-1, Math.min(1, ly / (half * 1.4)));
    c.fillStyle = 'rgba(0,10,6,0.5)';
    c.fillRect(cx - 60, cy - 40, 120, 80);
    c.strokeStyle = 'rgba(111,230,255,0.6)';
    c.lineWidth = 1;
    c.strokeRect(cx - 60, cy - 40, 120, 80);
    c.beginPath();
    c.moveTo(cx, cy - 40);
    c.lineTo(cx, cy + 40);
    c.moveTo(cx - 60, cy);
    c.lineTo(cx + 60, cy);
    c.stroke();
    c.strokeStyle = Math.abs(nx) < 0.5 && Math.abs(ny) < 0.5 ? GREEN : AMBER;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - nx * 58, cy - 38);
    c.lineTo(cx - nx * 58, cy + 38);
    c.moveTo(cx - 58, cy + ny * 38);
    c.lineTo(cx + 58, cy + ny * 38);
    c.stroke();
    const range = Math.hypot(lx, ly, lz);
    const closure = -relVel.dot(axis);
    c.textAlign = 'center';
    c.fillStyle = '#6fe6ff';
    c.fillText(`APPROACH ${name.toUpperCase()}`, cx, cy - 52);
    c.fillStyle = '#ffffff';
    c.fillText(fitText(c, `RNG ${(range / 1000).toFixed(2)} km · CLS ${closure.toFixed(0)} m/s · LAT ${Math.abs(lx).toFixed(0)} m ${lx >= 0 ? 'R' : 'L'} · VRT ${Math.abs(ly).toFixed(0)} m ${ly >= 0 ? 'HI' : 'LO'}`, spanW, 13, 10, '"Share Tech Mono", monospace'), cx, cy + 58);
    c.fillStyle = range < 1400 ? GREEN : 'rgba(125,255,178,0.75)';
    c.fillText(fitText(c, lz < 60 ? 'BEHIND THE BAY — CIRCLE OUT TO THE CORRIDOR' : range < 1000 ? 'GUIDANCE ENGAGING' : 'AUTO-DOCK AT 1.0 km · [G] CANCEL', spanW, 13, 10, '"Share Tech Mono", monospace'), cx, cy + 76);
    c.font = '13px "Share Tech Mono", monospace';
    c.textAlign = 'left';
  }

  /**
   * One-line docking prompt / controller message: the prompt row above the
   * subtitle band, fitted to the centre band and slid clear of the radio
   * panels (hudLayout).
   */
  drawDockMessage(text: string, color: string): void {
    if (!text) return;
    const c = this.ctx;
    c.textAlign = 'center';
    const y = promptY(this.h);
    const span = freeSpan(this.w, y - 5, 26);
    const fitted = fitText(c, text, Math.min(centerBand(this.w).width, span.x1 - span.x0) - 28, 15, 11, '"Share Tech Mono", monospace');
    const w = c.measureText(fitted).width + 28;
    const x = placeIn(this.w, span, w);
    c.fillStyle = 'rgba(0,10,6,0.6)';
    c.fillRect(x - w / 2, y - 18, w, 26);
    c.fillStyle = color;
    c.fillText(fitted, x, y);
    c.font = '13px "Share Tech Mono", monospace';
    c.textAlign = 'left';
  }

  /** Missile rails + trade summary, under the flight block. */
  drawLoadout(missiles: number, max: number, credits: number, cargo: number, capacity: number): void {
    const c = this.ctx;
    const x0 = 24;
    const y = this.h - 18;
    c.fillStyle = missiles > 0 ? GREEN : RED;
    c.fillText(`MSL ${'■'.repeat(Math.max(0, missiles))}${'□'.repeat(Math.max(0, max - missiles))}`, x0, y);
    c.fillStyle = 'rgba(125,255,178,0.75)';
    c.fillText(`${credits.toLocaleString('en-US')} sh · HOLD ${cargo}/${capacity}`, x0 + 150, y);
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

  private drawFlightBlock(f: FlightModel, time: number): void {
    const c = this.ctx;
    const x0 = 24;
    let y = this.h - 118;
    hudLabels.obstacle(x0 - 8, y - 16, 340, this.h - y + 16);
    c.fillStyle = GREEN;
    c.fillText(f.speed < 1000 ? `SPD ${f.speed.toFixed(0).padStart(4, ' ')} m/s` : `SPD ${(f.speed / 1000).toFixed(f.speed < 10_000 ? 2 : 1).padStart(4, ' ')} km/s`, x0, y);
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
