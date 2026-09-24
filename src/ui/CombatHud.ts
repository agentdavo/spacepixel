import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import type { ShipEntity } from '@/sim/Fleet';
import { gunOf, isExposed, missileOf, selectedSubsystem, subsystemPosition } from '@/sim/Combat';
import { BLEED_AT, FACING, FACING_NAMES, ZONE_NAMES, isOnline, type DamageState, type Subsystem } from '@/sim/Damage';
import { AIM_SPHERE } from '@/sim/Subsystems';
import { hostile } from '@/sim/Fleet';
import type { WeaponEvent } from '@/sim/Weapons';
import { HUD, claimRect, targetBottom, weaponsRect } from './hudLayout';
import { hudLabels } from './HudLabels';

/**
 * Combat readouts on their own canvas (layered over FlightHud):
 *
 * - Weapons block (bottom right): selected gun and damage type [R], missile
 *   type and reload [Y], own shield (one segment per facing, widths following
 *   the trim) and hull bars, the shield trim line [, . /] with transfer and
 *   emitter status, and a four-zone damage silhouette (nose, wings, engines)
 *   ringed by the fore / aft shield arcs (capitals: the facing glyph).
 * - Target panel (left): name, role, range; shield facings (the glyph: fore /
 *   aft arcs for fighters, four arcs for corvettes plus an inner dorsal /
 *   ventral ring for big capitals; a lettered segment bar under it with lost
 *   emitters crossed out), hull, and the subsystem list (selected, then
 *   exposed, then shielded, then wrecked) with a kill feed row ("TURRET 3
 *   DESTROYED") on top for a few seconds.
 * - Sub-target bracket on the selected subsystem in the view (white when
 *   exposed, cyan PROTECTED while its shield facing holds; flashes on hits;
 *   health bar), corner brackets on the target's other exposed mounts, dim
 *   pips on shielded ones, crosses on destroyed ones.
 * - Own hardware lost (player-flown warships): a red line in the weapons block.
 * - Kill paths (Structure.ts): the target's keel sections (bow / midships /
 *   stern) and a critical reactor's fuse and venting under its hull bar;
 *   callouts under the reticle when a capital near you goes critical, vents,
 *   strikes, breaks up or detonates; a white-out on a reactor detonation
 *   (`flash`, fed from DestructionFx); the salvage prompt near a wreck.
 */
const GREEN = '#7dffb2';
const AMBER = '#ffc46b';
const RED = '#ff5f7a';
const CYAN = '#6fe6ff';
const PINK = '#ff5fb4';
const DIM = 'rgba(125,255,178,0.35)';
const TYPE_COLOR: Record<string, string> = { kinetic: AMBER, laser: CYAN, harmonic: PINK, explosive: '#ff9a4a' };

/** Glyph angle of each outer facing (canvas: FORE up, AFT down, PORT left, STBD right). */
const GLYPH_ANGLE = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];

const _p = new Vector3();
const _w = new Vector3();

/** Kill-feed row / own-loss line lifetime (s). */
const FEED_TIME = 4;
const PROTECTED = 'rgba(111,230,255,0.55)';

interface FeedLine {
  text: string;
  color: string;
  t: number;
  /** Whose mount (named in the row when it isn't the current target). */
  ship: ShipEntity | null;
}

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
  /** 0..1 white-out (a reactor detonation in view); set each frame by the flight scene. */
  flash = 0;
  /** Wreck salvage in reach (src/game/salvage.ts), null = none; set each frame by the flight scene. */
  salvage: { label: string; lots: string; progress: number; working: boolean; hint: string } | null = null;
  /** Kill-path callout under the reticle ("CATHEDRAL-12 · REACTOR CRITICAL"). */
  private callout: FeedLine | null = null;
  /** Subsystem kill feed (newest first) and the player's own last hardware loss. */
  private feed: FeedLine[] = [];
  private ownLoss: FeedLine | null = null;
  /** Last time each subsystem was struck by the player (hit flash on its bracket). */
  private struck = new Map<Subsystem, number>();
  private clock = 0;

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

  /** Blank the layer (cutaways). */
  clear(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  set visible(v: boolean) {
    this.canvas.style.display = v ? '' : 'none';
  }

  private project(universe: Vector3, world: WorldSpace, cam: PerspectiveCamera): { x: number; y: number } | null {
    world.toRender(universe, _p).project(cam);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h };
  }

  /**
   * Once per sim tick: this tick's weapon events → kill feed ("TURRET 3
   * DESTROYED" for mounts the player's side knocks out), own losses, and hit
   * flashes on struck subsystems. `time` = sim clock (s).
   */
  consume(events: readonly WeaponEvent[], player: ShipEntity, time: number): void {
    this.clock = time;
    for (const e of events) {
      const s = e.ship;
      const sub = e.sub;
      if (s && s !== player && s.combat.dmg.capital) this.killPathCallout(e, s, player, time);
      if (!s || !sub) continue;
      if (e.kind !== 'subsystem') {
        if (e.shooter === player) this.struck.set(sub, time);
        continue;
      }
      if (s === player) {
        this.ownLoss = { text: `${sub.label} LOST`, color: RED, t: time, ship: s };
      } else if (hostile(s, player) && e.shooter && (e.shooter === player || e.shooter.team === player.team)) {
        const by = e.shooter === player ? '' : ` · ${e.shooter.name.toUpperCase()}`;
        this.feed.unshift({ text: `${sub.label} DESTROYED${by}`, color: e.shooter === player ? '#ffffff' : AMBER, t: time, ship: s });
        if (this.feed.length > 2) this.feed.length = 2;
      }
    }
    if (this.struck.size > 64) for (const [k, t] of this.struck) if (time - t > 1) this.struck.delete(k);
  }

  /** Capital crises worth a line under the reticle: a core going critical / vented, and how she died. */
  private killPathCallout(e: WeaponEvent, s: ShipEntity, player: ShipEntity, time: number): void {
    if (s.flight.position.distanceTo(player.flight.position) > 12000) return;
    const name = s.name.toUpperCase();
    let text = '';
    let color = AMBER;
    if (e.kind === 'reactor-critical') {
      text = `${name} · REACTOR CRITICAL`;
      color = RED;
    } else if (e.kind === 'reactor-vented') text = `${name} · REACTOR VENTED`;
    else if (e.kind === 'kill') {
      const how = e.cause === 'reactor' ? 'REACTOR DETONATION' : e.cause === 'structural' ? 'BROKEN IN TWO' : e.cause === 'bridge' ? 'STRUCK · DRIFTING DEAD' : 'DESTROYED';
      text = `${name} · ${how}`;
      color = e.cause === 'reactor' ? RED : e.cause === 'bridge' ? CYAN : AMBER;
    }
    if (text) this.callout = { text, color, t: time, ship: s };
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
    if (this.flash > 0.01) {
      c.fillStyle = `rgba(255,255,255,${Math.min(0.85, this.flash).toFixed(3)})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    if (!player.alive) return;
    this.weapons(player, time);
    if (showTarget && target && target.alive) {
      this.targetPanel(player, target, time);
      this.subBrackets(player, target, cam, world, time);
    }
    this.killPathLines(time);
  }

  /** The kill-path callout and the salvage prompt, centred under the reticle. */
  private killPathLines(time: number): void {
    const c = this.ctx;
    const x = this.w / 2;
    let y = this.h / 2 + 96;
    c.textAlign = 'center';
    const k = this.callout;
    if (k && this.clock - k.t < FEED_TIME) {
      c.globalAlpha = Math.min(1, (FEED_TIME - (this.clock - k.t)) * 1.5);
      c.fillStyle = k.color === RED && (time * 3) % 1 > 0.6 ? AMBER : k.color;
      c.fillText(k.text, x, y);
      c.globalAlpha = 1;
      y += 20;
    }
    const sv = this.salvage;
    if (sv) {
      c.fillStyle = sv.working ? GREEN : DIM;
      c.fillText(`SALVAGE · ${sv.label}`, x, y);
      c.fillStyle = DIM;
      c.fillText(sv.hint || sv.lots, x, y + 16);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(x - 80, y + 23, 160, 4);
      c.fillStyle = GREEN;
      c.fillRect(x - 80, y + 23, 160 * Math.max(0, Math.min(1, sv.progress)), 4);
    }
    c.textAlign = 'left';
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
    hudLabels.obstacle(r.x, r.y - HUD.weaponsLine, r.w, r.h + HUD.weaponsLine);
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
    y += 20;
    const st = cs.dmg;
    this.facingBar(x, y, 'SHD', st, time, false);
    y += 16;
    this.bar(x, y, 'HUL', p.hull / p.hullMax, p.hull / p.hullMax < 0.3 ? RED : AMBER);
    // Shield trim [, . /], charge moving between facings, emitters.
    const genUp = isOnline(st, 'shieldGen');
    let em = 0;
    let emN = 0;
    for (const s of st.subsystems) {
      if (s.kind !== 'shieldEmitter') continue;
      emN++;
      if (!s.destroyed) em++;
    }
    c.fillStyle = !genUp ? ((time * 3) % 1 < 0.6 ? RED : AMBER) : st.trim >= 0 ? '#ffffff' : CYAN;
    c.font = '11px "Share Tech Mono", monospace';
    // Compact: [,./] AUTO FWD ⇄ · E 5/6 (trimLabel spells it out for comms).
    const n = st.facings.length;
    const set = st.trim < 0 ? (n < 2 ? 'BUBBLE' : 'BAL') : n === 2 ? (st.trim === FACING.FORE ? 'FWD' : 'AFT') : `+${FACING_NAMES[st.trim]}`;
    const trim = !genUp ? 'SHIELD GEN DOWN' : `[,./] ${st.trimAuto ? 'AUTO ' : ''}${set}${st.flow > 0 ? ' ⇄' : ''}${emN ? ` · E ${em}/${emN}` : ''}`;
    c.fillText(trim, x, y + 16);
    c.font = '13px "Share Tech Mono", monospace';
    y += 16;
    const cx = x + 196;
    const cy = y - 6;
    if (st.capital) this.facingGlyph(cx, cy, 24, st, time);
    // Zone silhouette: a little plan view of the fighter, inside its shield arcs.
    if (!st.capital) {
      this.facingGlyph(cx, cy - 7, 32, st, time);
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
        c.fillText(`${ZONE_NAMES[worst]} ${st.zones[worst] > 0.75 ? 'CRITICAL' : 'DAMAGED'}`, x, y + 18);
      }
      if (st.tether > 0) {
        c.fillStyle = (time * 4) % 1 < 0.6 ? RED : AMBER;
        c.fillText('HARPOONED — THRUST 50%', x, y + 34);
      }
    }
    // Own hardware shot off (warships): capitals use the zone line, others the one under it.
    const loss = this.ownLoss;
    if (loss && this.clock - loss.t < FEED_TIME && !(st.tether > 0)) {
      c.fillStyle = (time * 4) % 1 < 0.6 ? RED : AMBER;
      c.fillText(loss.text, x, y + (st.capital ? 22 : 40));
    }
  }

  /** Capitals: keel sections (B M S, red when failing) or, while critical, the reactor's fuse and the crew's venting. */
  private keelLine(x: number, y: number, st: DamageState, time: number): void {
    const S = st.structure;
    if (!st.capital || !S.sections.length) return;
    const c = this.ctx;
    c.font = '11px "Share Tech Mono", monospace';
    const R = S.reactor;
    if (R.phase === 'critical') {
      c.fillStyle = (time * 3) % 1 < 0.6 ? RED : '#ffffff';
      c.fillText(`CORE CRITICAL ${R.t.toFixed(1)}s · VENT ${Math.round(R.vent * 100)}%`, x, y);
    } else {
      c.fillStyle = DIM;
      c.fillText('KEEL', x, y);
      let px = x + 30;
      for (let i = 0; i < S.sections.length; i++) {
        const sec = S.sections[i];
        const k = sec.hp / sec.hpMax;
        c.fillStyle = k < 0.25 ? RED : k < 0.6 ? AMBER : GREEN;
        c.fillText('BMS'[i], px, y);
        c.fillRect(px + 9, y - 6, 20 * Math.max(0, k), 4);
        px += 36;
      }
      if (R.phase === 'vented') {
        c.fillStyle = AMBER;
        c.fillText('VNT', px, y);
      }
    }
    c.font = '13px "Share Tech Mono", monospace';
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

  /** Colour of a facing at charge fraction `k` (blinks red when down, amber while it bleeds through). */
  private facingColor(k: number, time: number): string {
    return k <= 0 ? ((time * 3) % 1 < 0.5 ? RED : 'rgba(255,95,122,0.3)') : k < BLEED_AT ? AMBER : CYAN;
  }

  /**
   * Shield bar split into one segment per facing, each as wide as its share
   * of capacity (so the trim shows as a wide segment, outlined white) and
   * filled by its charge. A facing without an emitter keeps a crossed-out
   * sliver. `letters`: facing initials above the segments (target panel).
   */
  private facingBar(x: number, y: number, label: string, st: DamageState, time: number, letters: boolean): void {
    const c = this.ctx;
    const n = st.facings.length;
    c.fillStyle = GREEN;
    c.fillText(label, x, y);
    if (!n) return;
    const W = 120;
    const gap = n > 1 ? 2 : 0;
    const min = 6;
    let sum = 0;
    for (let f = 0; f < n; f++) sum += Math.max(st.facingCap[f], 1e-6);
    const free = W - gap * (n - 1) - min * n;
    let px = x + 34;
    if (letters) c.font = '9px "Share Tech Mono", monospace';
    for (let f = 0; f < n; f++) {
      const cap = st.facingCap[f];
      const w = min + (free * Math.max(cap, 1e-6)) / sum;
      const k = cap > 0 ? Math.min(1, st.facings[f] / cap) : 0;
      const col = this.facingColor(k, time);
      c.strokeStyle = f === st.trim ? '#ffffff' : col;
      c.strokeRect(px, y - 9, w, 9);
      c.fillStyle = col;
      if (cap > 0) c.fillRect(px, y - 9, w * k, 9);
      else {
        c.beginPath();
        c.moveTo(px, y - 9);
        c.lineTo(px + w, y);
        c.moveTo(px + w, y - 9);
        c.lineTo(px, y);
        c.stroke();
      }
      if (letters && n > 1) {
        c.fillStyle = cap <= 0 ? RED : f === st.trim ? '#ffffff' : DIM;
        c.fillText(FACING_NAMES[f][0], px + w / 2 - 3, y - 12);
      }
      px += w + gap;
    }
    if (letters) c.font = '13px "Share Tech Mono", monospace';
  }

  /**
   * Plan-view facing glyph (nose up): one bubble ring; fore / aft half arcs;
   * four arcs (+ port left, starboard right); six adds an inner ring,
   * dorsal upper half / ventral lower. Brightness is charge, the trimmed
   * facing is drawn heavier, a lost emitter's arc is a dark stub.
   */
  private facingGlyph(cx: number, cy: number, R: number, st: DamageState, time: number, labels = false): void {
    const c = this.ctx;
    const n = st.facings.length;
    if (!n) return;
    const span = n === 1 ? Math.PI : n === 2 ? 1.15 : 0.72;
    for (let f = 0; f < n; f++) {
      const cap = st.facingCap[f];
      const k = cap > 0 ? Math.min(1, st.facings[f] / cap) : 0;
      const inner = f >= FACING.DORSAL;
      const r = inner ? R * 0.5 : R;
      const a = inner ? (f === FACING.DORSAL ? -Math.PI / 2 : Math.PI / 2) : GLYPH_ANGLE[f];
      const s = inner ? 1.35 : span;
      c.lineWidth = (inner ? 3 : 4) + (f === st.trim ? 2 : 0);
      c.strokeStyle = cap <= 0 ? 'rgba(255,95,122,0.35)' : this.facingColor(k, time);
      c.globalAlpha = cap <= 0 || k <= 0 ? 1 : 0.35 + 0.65 * k;
      c.beginPath();
      c.arc(cx, cy, r, a - s, a + s);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.lineWidth = 1.5;
    if (!labels) return;
    c.font = '10px "Share Tech Mono", monospace';
    for (let f = 0; f < Math.min(n, 4); f++) {
      const a = GLYPH_ANGLE[f];
      c.fillStyle = st.facingCap[f] <= 0 || st.facings[f] <= 0 ? RED : f === st.trim ? '#ffffff' : CYAN;
      c.fillText(FACING_NAMES[f][0], cx + Math.cos(a) * (R + 10) - 3, cy + Math.sin(a) * (R + 10) + 4);
    }
    c.font = '13px "Share Tech Mono", monospace';
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
    let live = 0;
    for (const f of this.feed) if (this.clock - f.t < FEED_TIME) live++;
    // Header, feed and list rows share one budget (the layout test caps the panel at 14 rows).
    const rows = Math.max(0, Math.min(subs.length ? subs.length + live + 1 : 0, 14, Math.floor((targetBottom(this.h) - top - 112) / 15)));
    c.fillStyle = 'rgba(0,10,6,0.45)';
    c.fillRect(x - 12, y - 18, 262, 112 + rows * 15);
    hudLabels.obstacle(x - 12, y - 18, 262, 112 + rows * 15);
    const dist = t.flight.position.distanceTo(player.flight.position);
    c.fillStyle = PINK;
    c.fillText(`${t.name.toUpperCase()}`, x, y);
    y += 16;
    c.fillStyle = DIM;
    c.fillText(`${t.model.blueprint.designation} ${t.combat.stats.role.toUpperCase()} · ${(dist / 1000).toFixed(2)} km`, x, y);
    y += 14;

    // Shield facings: the plan-view glyph, then one lettered segment per facing.
    const cx = x + 34;
    const cy = y + 30;
    const R = 24;
    this.facingGlyph(cx, cy, R, st, time, st.facings.length >= 4);
    // Hull silhouette dot (red when low).
    c.fillStyle = t.hull / t.hullMax < 0.3 ? RED : AMBER;
    c.beginPath();
    c.arc(cx, cy, st.facings.length > 4 ? 4 : 6, 0, Math.PI * 2);
    c.fill();
    this.facingBar(x + 80, cy - 8, 'SHD', st, time, true);
    this.bar(x + 80, cy + 10, 'HUL', t.hull / t.hullMax, t.hull / t.hullMax < 0.3 ? RED : AMBER);
    this.keelLine(x + 80, cy + 27, st, time);
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
    let intact = 0;
    let open = 0;
    for (const s of subs) {
      if (s.destroyed) continue;
      intact++;
      if (isExposed(t, s)) open++;
    }
    const head = `[B] SUBSYSTEMS ${intact}/${subs.length}`;
    c.fillStyle = DIM;
    c.fillText(head, x, y);
    if (open) {
      c.fillStyle = AMBER;
      c.fillText(`· ${open} EXPOSED`, x + c.measureText(`${head} `).width, y);
    }
    y += 16;
    // Kill feed: the newest "… DESTROYED" lines take the first rows. (The header line above
    // sits in the last row's slot of the panel budget: list one row fewer so nothing spills out.)
    let rowsLeft = rows - 1;
    for (const f of this.feed) {
      if (rowsLeft <= 1 || this.clock - f.t >= FEED_TIME) continue;
      c.fillStyle = f.color;
      c.globalAlpha = Math.min(1, (FEED_TIME - (this.clock - f.t)) * 1.5);
      c.fillText(`✕ ${f.ship && f.ship !== t ? `${f.ship.name.toUpperCase()} · ` : ''}${f.text}`, x, y, 238);
      c.globalAlpha = 1;
      y += 15;
      rowsLeft--;
    }
    // Selected first (so it is always listed), then exposed, shielded, wrecked.
    const rank = (s: Subsystem) => (s === sel ? 0 : s.destroyed ? 3 : isExposed(t, s) ? 1 : 2);
    const order = subs.map((s, i) => ({ s, k: rank(s) * 1000 + i })).sort((a, b) => a.k - b.k);
    for (let i = 0; i < Math.min(rowsLeft, order.length); i++) {
      const s = order[i].s;
      const k = s.hp / s.hpMax;
      const isSel = s === sel;
      const exposed = !s.destroyed && isExposed(t, s);
      const col = s.destroyed ? 'rgba(255,95,122,0.55)' : isSel ? '#ffffff' : !exposed ? PROTECTED : k < 0.5 ? AMBER : GREEN;
      c.fillStyle = col;
      c.fillText(`${isSel ? '▶' : ' '} ${s.label}`, x, y);
      if (s.destroyed) {
        c.fillRect(x + 12, y - 4, c.measureText(s.label).width + 4, 1.5);
        c.fillText('DESTROYED', x + 150, y);
      } else {
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(x + 150, y - 7, 70, 5);
        c.fillStyle = col;
        c.fillRect(x + 150, y - 7, 70 * k, 5);
        if (!exposed) {
          // Protected: a shield outline round the bar.
          c.strokeStyle = PROTECTED;
          c.lineWidth = 1;
          c.strokeRect(x + 149.5, y - 8.5, 71, 8);
          c.lineWidth = 1.5;
        }
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
      const r = (s.radius * AIM_SPHERE * fovScale) / Math.max(d, 1);
      const exposed = !s.destroyed && isExposed(t, s);
      if (s === sel) {
        const flash = this.clock - (this.struck.get(s) ?? -9) < 0.12;
        const pulse = 1 + 0.12 * Math.sin(time * 8);
        const h = Math.max(10, r) * pulse;
        const col = flash ? AMBER : exposed ? '#ffffff' : CYAN;
        c.strokeStyle = col;
        c.lineWidth = flash ? 3 : 2;
        c.beginPath();
        c.moveTo(pt.x, pt.y - h - 6);
        c.lineTo(pt.x + h + 6, pt.y);
        c.lineTo(pt.x, pt.y + h + 6);
        c.lineTo(pt.x - h - 6, pt.y);
        c.closePath();
        c.stroke();
        const lx = pt.x + h + 12;
        const k = s.hp / s.hpMax;
        c.fillStyle = col;
        c.fillText(`${s.label}  ${Math.round(k * 100)}%`, lx, pt.y + 1);
        // Health bar under the label; a protected mount says so.
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(lx, pt.y + 6, 80, 4);
        c.fillStyle = k < 0.35 ? RED : k < 0.65 ? AMBER : GREEN;
        c.fillRect(lx, pt.y + 6, 80 * k, 4);
        if (!exposed) {
          c.fillStyle = CYAN;
          c.fillText('PROTECTED', lx, pt.y + 24);
        }
        hudLabels.obstacle(pt.x - h - 6, pt.y - h - 6, lx + 90 - (pt.x - h - 6), h * 2 + 12);
        c.lineWidth = 1.5;
      } else if (dist < 9000) {
        c.beginPath();
        if (s.destroyed) {
          c.strokeStyle = 'rgba(255,95,122,0.7)';
          c.moveTo(pt.x - 3, pt.y - 3);
          c.lineTo(pt.x + 3, pt.y + 3);
          c.moveTo(pt.x + 3, pt.y - 3);
          c.lineTo(pt.x - 3, pt.y + 3);
        } else if (exposed) {
          // Open to fire: corner brackets sized to the mount.
          const e = Math.max(4, Math.min(r, 40));
          const k = Math.max(2, e * 0.45);
          c.strokeStyle = 'rgba(255,196,107,0.85)';
          for (const [sx, sy] of CORNERS) {
            c.moveTo(pt.x + sx * e, pt.y + sy * (e - k));
            c.lineTo(pt.x + sx * e, pt.y + sy * e);
            c.lineTo(pt.x + sx * (e - k), pt.y + sy * e);
          }
        } else {
          c.strokeStyle = 'rgba(111,230,255,0.3)';
          c.rect(pt.x - 2, pt.y - 2, 4, 4);
        }
        c.stroke();
      }
    }
  }
}

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
