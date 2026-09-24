import { Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpace } from '@/core/WorldSpace';
import type { ShipEntity } from '@/sim/Fleet';
import type { BodyInstance } from '@/world/StarSystemView';
import type { Ambush, Traffic, TrafficShip } from '@/world/Traffic';
import { KIND_LABEL } from '@/universe/bodies';
import { TRAFFIC_ROLES } from '@/universe/traffic';
import { HUD, centerBand, claim, claimRect, fitText, hailBottom } from './hudLayout';
import { LABEL_PRIORITY, hudLabels } from './HudLabels';

/**
 * The living-Reach overlay (its own canvas above the flight HUD):
 *
 *  - planet / moon / landmark markers with kind and range (km above the
 *    surface), the nearest body's survey line;
 *  - ambient traffic tags within a few km, the Lantern arrivals board;
 *  - distress calls (raider ambushes) with a marker you can fly to;
 *  - the hail card (H): name, registry, flag, route, manifest, a line of chatter;
 *  - bounty / standing banners from the traffic reward hook.
 */
const GREEN = '#7dffb2';
const CYAN = '#6fe6ff';
const AMBER = '#ffc46b';
const RED = '#ff5f7a';
const PINK = '#ff5fb4';
const BODY = '#d8d0ff';

const FLAG_NAME: Record<string, string> = { concord: 'DIRECTORATE', choir: 'HEGEMONY', rustwake: 'RUSTWAKE' };
const FLAG_COL: Record<string, string> = { concord: CYAN, choir: PINK, rustwake: AMBER };

const CHATTER: Record<string, string[]> = {
  concord: ['Keep the light, Vanguard.', "Manifest's clean, Lieutenant. Counted twice.", "Allocation says we're on time. First time this year.", 'Lit. Good hunting.'],
  choir: ['The Hymn be with you, Directorate. From a distance.', 'We sing on the long lanes. You may listen.', 'Ascend, or be kept, pilot.'],
  rustwake: ['Nothing in the black is ever truly lost, pilot. Except customers.', 'Buying, selling, not stopping.', 'Both paints welcome. Both sides pay.'],
};

const _p = new Vector3();

export class ReachHud {
  private w = 1;
  private h = 1;
  private hailed: { t: TrafficShip; until: number; line: string } | null = null;
  private banner: { text: string; sub: string; color: string; until: number } | null = null;
  /** 0..1 instrument noise (Dead Zone): markers flicker like the main HUD. */
  navNoise = 0;

  /**
   * Draws into the flight HUD's own canvas (after it has cleared and drawn
   * for the frame): a second full-screen canvas layer costs a composite
   * every frame, which software rasterisers feel.
   */
  constructor(private ctx: CanvasRenderingContext2D) {}

  private project(u: Vector3, world: WorldSpace, cam: PerspectiveCamera): { x: number; y: number; behind: boolean } {
    world.toRender(u, _p).project(cam);
    const behind = _p.z > 1 || _p.z < -1;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h, behind };
  }

  /** Show a hail card for `t` (or a "no contact" line). */
  hail(t: TrafficShip | null, time: number): void {
    if (!t) {
      this.flash('NO CONTACT IN THE HAIL CONE', 'point the nose at a ship within 12 km and press H', GREEN, time, 2.5);
      return;
    }
    const pool = t.role === 'pirate' ? ["Keep flying, Kestrel. This one's ours."] : t.ambush ? ['Mayday, mayday: raiders on us, anyone on this band!'] : t.role === 'patrol' ? (t.flag === 'choir' ? ['Directorate craft, you are observed. Keep your guns cold.'] : ['Picket copies, Vanguard. Lane is quiet.']) : CHATTER[t.flag];
    this.hailed = { t, until: time + 8, line: pool[(t.ship.id * 7) % pool.length] };
  }

  flash(text: string, sub: string, color: string, time: number, secs = 5): void {
    this.banner = { text, sub, color, until: time + secs };
  }

  draw(o: {
    time: number;
    cam: PerspectiveCamera;
    world: WorldSpace;
    player: ShipEntity;
    bodies: readonly BodyInstance[];
    traffic: Traffic;
    navGate: { to: string; name: string; center: Vector3 } | null;
    ringDensity: number;
  }): void {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    const c = this.ctx;
    c.save();
    c.shadowBlur = 0;
    const { cam, world, player, time } = o;
    const pp = player.flight.position;
    c.font = '12px "Share Tech Mono", monospace';
    c.lineWidth = 1.2;
    // No shadowBlur: software canvases pay for it per glyph, every frame.
    const noisy = () => this.navNoise > 0 && Math.random() < this.navNoise * 0.85;

    // ── bodies ──────────────────────────────────────────────────────
    const fovScale = this.h / (2 * Math.tan((cam.fov * Math.PI) / 360));
    let nearest: BodyInstance | null = null;
    let nearAlt = Infinity;
    // Label budget: the biggest discs first; moons only when close.
    const ranked = [...o.bodies].sort((a, b) => b.radius / Math.max(1, b.position.distanceTo(pp)) - a.radius / Math.max(1, a.position.distanceTo(pp)));
    const labelled = new Set(ranked.filter((b) => !b.parent || b.position.distanceTo(pp) - b.radius < 150_000).slice(0, 5));
    for (const b of o.bodies) {
      const dist = b.position.distanceTo(pp);
      const alt = dist - b.radius;
      if (alt < nearAlt) {
        nearAlt = alt;
        nearest = b;
      }
      if (noisy()) continue;
      const pt = this.project(b.position, world, cam);
      if (pt.behind) continue;
      const rpx = (b.radius * fovScale) / Math.max(1, dist);
      const moon = !!b.parent;
      // Big discs: tag the limb, not the centre; tiny ones get a ring marker.
      const onScreen = pt.x > -rpx && pt.x < this.w + rpx && pt.y > -rpx && pt.y < this.h + rpx;
      if (!onScreen) continue;
      const col = b.landmark ? AMBER : moon ? 'rgba(216,208,255,0.75)' : BODY;
      c.strokeStyle = col;
      c.fillStyle = col;
      // Label anchor: the ring marker, or the end of the limb tick on a big disc.
      let lx = pt.x;
      let ly = pt.y;
      let lr = 4;
      if (rpx < 26) {
        const r = Math.max(moon ? 4 : 6, rpx + 4);
        c.beginPath();
        c.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        c.stroke();
        lr = r + 1;
      } else {
        // Limb tick at upper-right of the disc.
        const a = -Math.PI / 4;
        const ex = pt.x + Math.cos(a) * rpx;
        const ey = pt.y + Math.sin(a) * rpx;
        if (ex < 10 || ex > this.w - 160 || ey < 40 || ey > this.h - 40) continue;
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex + 14, ey - 14);
        c.lineTo(ex + 30, ey - 14);
        c.stroke();
        lx = ex + 30;
        ly = ey - 14;
      }
      if (!labelled.has(b)) continue;
      const range = alt > 10_000 ? `${(alt / 1000).toFixed(0)} km` : `${(alt / 1000).toFixed(1)} km`;
      hudLabels.add({
        id: `body:${b.name}`,
        x: lx,
        y: ly,
        r: lr,
        lines: [
          { text: `${b.name.toUpperCase()}  ${range}`, color: col },
          { text: `${(b.landmark ?? KIND_LABEL[b.kind]).toUpperCase()}${moon ? ` · MOON OF ${b.parent!.name.toUpperCase()}` : ''}`, color: col, alpha: 0.65 },
        ],
        priority: b.landmark ? LABEL_PRIORITY.planet + 5 : moon ? LABEL_PRIORITY.moon : LABEL_PRIORITY.planet,
      });
    }
    // Survey line for the nearest body (lower centre, above the dock prompt).
    if (nearest && nearAlt < 60_000) {
      c.textAlign = 'center';
      c.fillStyle = 'rgba(216,208,255,0.85)';
      c.fillText(fitText(c, `${nearest.name.toUpperCase()} · ${(nearAlt / 1000).toFixed(1)} km — ${nearest.description}`, centerBand(this.w).width, 12, 10, '"Share Tech Mono", monospace'), this.w / 2, this.h - 58);
      c.font = '12px "Share Tech Mono", monospace';
      c.textAlign = 'left';
    }
    if (o.ringDensity > 0.02) {
      c.textAlign = 'center';
      c.fillStyle = o.ringDensity > 0.15 ? AMBER : GREEN;
      c.fillText(`RING PLANE · DEBRIS ${o.ringDensity > 0.15 ? 'DENSE' : 'LIGHT'}`, this.w / 2, HUD.statusSubY + (this.navNoise > 0 ? 18 : 0));
      c.textAlign = 'left';
    }

    // ── traffic tags ────────────────────────────────────────────────
    for (const t of o.traffic.ships) {
      if (!t.ship.alive || noisy()) continue;
      const d = t.ship.flight.position.distanceTo(pp);
      // Raiders already wear hostile brackets; tag the lane traffic (and the hauler in trouble).
      if (t.role === 'pirate' || d > (t.ambush ? 9000 : 5000)) continue;
      const pt = this.project(t.ship.flight.position, world, cam);
      if (pt.behind || pt.x < 0 || pt.x > this.w || pt.y < 0 || pt.y > this.h) continue;
      const half = Math.max(9, (t.ship.radius * fovScale) / Math.max(d, 1));
      const lines = [{ text: `${TRAFFIC_ROLES[t.role].prefix} ${t.manifest.name.toUpperCase()}`, color: t.role === 'patrol' ? FLAG_COL[t.flag] : 'rgba(125,255,178,0.8)', alpha: t.ambush ? 1 : 0.75 }];
      if (t.ambush) lines.push({ text: 'MAYDAY', color: RED, alpha: (time * 3) % 1 < 0.6 ? 1 : 0 });
      hudLabels.add({ id: `tr:${t.ship.id}`, x: pt.x, y: pt.y, r: half, lines, priority: t.ambush ? LABEL_PRIORITY.distress : LABEL_PRIORITY.traffic });
    }

    // ── distress calls (under the contract toasts) ──────────────────
    const toasts = claimRect('toasts');
    let y = Math.max(96, toasts ? toasts.y + toasts.h + 22 : 0);
    for (const a of o.traffic.ambushes) {
      if (a.resolved) continue;
      this.distress(a, pp, world, cam, time, y);
      y += 18;
    }

    // ── arrivals board at the nav Lantern ──────────────────────────
    if (o.navGate && o.navGate.center.distanceTo(pp) < 25_000) {
      const list = o.traffic.arrivals(o.navGate.to, 2);
      const pt = this.project(o.navGate.center, world, cam);
      if (list.length && !pt.behind && pt.x > 0 && pt.x < this.w && pt.y > 0 && pt.y < this.h) {
        // Its own label, anchored on the nav diamond: it gives way to the Lantern's name (and everything else).
        hudLabels.add({
          id: 'arrivals',
          x: pt.x,
          y: pt.y,
          r: 14,
          lines: list.map((s) => {
            const m = Math.floor(s.eta / 60);
            const sec = Math.floor(s.eta % 60);
            return { text: `INBOUND ${m}:${String(sec).padStart(2, '0')}  ${TRAFFIC_ROLES[s.role].label.toUpperCase()} ${s.name.toUpperCase()}`, color: 'rgba(111,230,255,0.8)' };
          }),
          priority: LABEL_PRIORITY.arrivals,
        });
      }
    }

    // ── hail card ───────────────────────────────────────────────────
    if (this.hailed && time < this.hailed.until && this.hailed.t.ship.alive) this.hailCard(this.hailed.t, this.hailed.line, pp, o.traffic);
    else {
      this.hailed = null;
      claim('hail', null);
    }

    // ── banner ──────────────────────────────────────────────────────
    if (this.banner && time < this.banner.until) {
      const b = this.banner;
      c.textAlign = 'center';
      c.font = '700 18px "Oxanium", sans-serif';
      c.fillStyle = b.color;
      c.fillText(b.text, this.w / 2, this.h * 0.28);
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillText(fitText(c, b.sub, centerBand(this.w).width, 12, 10, '"Share Tech Mono", monospace'), this.w / 2, this.h * 0.28 + 20);
      c.textAlign = 'left';
    }
    c.restore();
  }

  private distress(a: Ambush, pp: Vector3, world: WorldSpace, cam: PerspectiveCamera, time: number, y: number): void {
    const c = this.ctx;
    const d = a.position.distanceTo(pp);
    if (d > 40_000) return;
    const v = a.victim;
    const live = a.raiders.filter((r) => r.ship.alive).length;
    const blink = (time * 2.5) % 1 < 0.65;
    c.textAlign = 'center';
    c.fillStyle = blink ? RED : 'rgba(255,95,122,0.6)';
    c.font = '700 14px "Oxanium", sans-serif';
    c.fillText(fitText(c, `DISTRESS · ${TRAFFIC_ROLES[v.role].label.toUpperCase()} ${v.manifest.name.toUpperCase()} · ${live} ${a.band.toUpperCase()} RAIDERS · ${(d / 1000).toFixed(1)} km`, centerBand(this.w).width, 14, 11, '"Oxanium", sans-serif', '700 '), this.w / 2, y);
    c.font = '12px "Share Tech Mono", monospace';
    c.textAlign = 'left';
    const pt = this.project(a.position, world, cam);
    if (!pt.behind && pt.x > 0 && pt.x < this.w && pt.y > 0 && pt.y < this.h) {
      const r = 16 + Math.sin(time * 6) * 3;
      c.strokeStyle = RED;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(pt.x, pt.y - r);
      c.lineTo(pt.x + r, pt.y);
      c.lineTo(pt.x, pt.y + r);
      c.lineTo(pt.x - r, pt.y);
      c.closePath();
      c.stroke();
      c.lineWidth = 1.2;
      hudLabels.obstacle(pt.x - r, pt.y - r, r * 2, r * 2);
    } else {
      // Edge arrow toward the call.
      world.toRender(a.position, _p).applyMatrix4(cam.matrixWorldInverse);
      const ang = Math.atan2(-_p.y, _p.x);
      const rr = Math.min(this.w, this.h) / 2 - 90;
      const x = this.w / 2 + Math.cos(ang) * rr;
      const yy = this.h / 2 + Math.sin(ang) * rr;
      c.fillStyle = RED;
      c.beginPath();
      c.moveTo(x + Math.cos(ang) * 12, yy + Math.sin(ang) * 12);
      c.lineTo(x + Math.cos(ang + 2.5) * 9, yy + Math.sin(ang + 2.5) * 9);
      c.lineTo(x + Math.cos(ang - 2.5) * 9, yy + Math.sin(ang - 2.5) * 9);
      c.closePath();
      c.fill();
    }
  }

  private hailCard(t: TrafficShip, line: string, pp: Vector3, traffic: Traffic): void {
    const c = this.ctx;
    // Bottom-right, stacked above the weapons block (hudLayout).
    const x = this.w - HUD.margin - 312;
    const y0 = hailBottom(this.h) - (8 + 6 * 17 + 40);
    const rows: [string, string][] = [
      ['CALLSIGN', `${t.manifest.name.toUpperCase()}  ${t.manifest.registry}`],
      ['TYPE', `${TRAFFIC_ROLES[t.role].label.toUpperCase()} · ${t.ship.model.blueprint.name.toUpperCase()} HULL`],
      ['FLAG', t.role === 'pirate' ? 'NONE (TRANSPONDER DARK)' : FLAG_NAME[t.flag]],
      ['ROUTE', `${traffic.origin(t).toUpperCase()} → ${traffic.destination(t).toUpperCase()}`],
      ['CARGO', t.manifest.cargo.length ? t.manifest.cargo.map((m) => `${m.tons} t ${m.label}`).join(', ').toUpperCase() : 'NONE DECLARED'],
      ['RANGE', `${(t.ship.flight.position.distanceTo(pp) / 1000).toFixed(2)} km · ${t.ship.flight.speed.toFixed(0)} m/s`],
    ];
    c.fillStyle = 'rgba(0,10,6,0.72)';
    c.fillRect(x - 12, y0 - 24, 324, 32 + rows.length * 17 + 40);
    claim('hail', { x: x - 12, y: y0 - 24, w: 324, h: 32 + rows.length * 17 + 40 });
    c.strokeStyle = FLAG_COL[t.flag] ?? GREEN;
    c.strokeRect(x - 12, y0 - 24, 324, 32 + rows.length * 17 + 40);
    c.fillStyle = FLAG_COL[t.flag] ?? GREEN;
    c.font = '700 13px "Oxanium", sans-serif';
    c.fillText('HAIL // OPEN BAND', x, y0 - 6);
    c.font = '11px "Share Tech Mono", monospace';
    rows.forEach(([k, v], i) => {
      c.fillStyle = 'rgba(125,255,178,0.6)';
      c.fillText(k, x, y0 + 14 + i * 17);
      c.fillStyle = '#e8fff2';
      c.fillText(clip(c, v, 230), x + 70, y0 + 14 + i * 17);
    });
    c.fillStyle = t.ambush && t.role !== 'pirate' ? RED : '#ffffff';
    c.fillText(clip(c, `"${line}"`, 300), x, y0 + 22 + rows.length * 17);
    c.font = '12px "Share Tech Mono", monospace';
  }
}

function clip(c: CanvasRenderingContext2D, s: string, w: number): string {
  if (c.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 4 && c.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
