import type { Universe, StarSystem } from '@/universe/Universe';
import { route } from '@/universe/Universe';
import { systemTraffic, type TrafficSummary } from '@/universe/traffic';
import { KIND_LABEL } from '@/universe/bodies';

/**
 * Milestone 15 — sector star map (M). A full-screen CRT-style overlay of the
 * Meridian Reach: systems coloured by holder, Lantern lanes, the current
 * system, and the planned route to a clicked destination. The route drives
 * the in-flight NAV marker.
 */
const FACTION_COLOR: Record<string, string> = {
  concord: '#6fe6ff',
  choir: '#ff5fb4',
  rustwake: '#ffc46b',
  contested: '#c9a6ff',
  unknown: '#7d7d8c',
};

export class StarMap {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  open = false;
  destination: string | null = null;
  private hover: string | null = null;
  /** Timetable summaries per system (sailings/h, per-Lantern volume, patrols, piracy). */
  private traffic = new Map<string, TrafficSummary>();

  constructor(
    root: HTMLElement,
    private universe: Universe,
    private currentId: () => string,
  ) {
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;z-index:24;pointer-events:auto;cursor:crosshair;background:rgba(3,6,12,0.88)';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (const sys of universe.systems.values()) this.traffic.set(sys.id, systemTraffic(universe.seed, sys));
    this.canvas.addEventListener('pointermove', (e) => (this.hover = this.pick(e.clientX, e.clientY)));
    this.canvas.addEventListener('pointerdown', (e) => {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.destination = id === this.currentId() ? null : id;
      e.stopPropagation();
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.canvas.style.display = this.open ? 'block' : 'none';
  }

  /** Remaining route (current → destination), or empty. */
  route(): string[] {
    return this.destination ? route(this.universe, this.currentId(), this.destination) : [];
  }

  private layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // The survey panel takes the right-hand 400 px on wide screens.
    const panel = w > 1000 ? 400 : 0;
    const s = Math.min((w - 120 - panel) / 100, (h - 160) / 64);
    return { ox: (w - panel - 100 * s) / 2, oy: (h - 64 * s) / 2 + 20, s };
  }

  private toScreen(sys: StarSystem) {
    const { ox, oy, s } = this.layout();
    return { x: ox + sys.map.x * s, y: oy + sys.map.y * s };
  }

  private pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = 22;
    for (const sys of this.universe.systems.values()) {
      const p = this.toScreen(sys);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = sys.id;
      }
    }
    return best;
  }

  draw(time: number): void {
    if (!this.open) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.font = '12px "Share Tech Mono", monospace';

    // Grid.
    const { ox, oy, s } = this.layout();
    c.strokeStyle = 'rgba(125,255,178,0.07)';
    c.lineWidth = 1;
    for (let gx = 0; gx <= 100; gx += 10) {
      c.beginPath();
      c.moveTo(ox + gx * s, oy);
      c.lineTo(ox + gx * s, oy + 64 * s);
      c.stroke();
    }
    for (let gy = 0; gy <= 64; gy += 8) {
      c.beginPath();
      c.moveTo(ox, oy + gy * s);
      c.lineTo(ox + 100 * s, oy + gy * s);
      c.stroke();
    }

    const cur = this.currentId();
    const path = this.route();
    const onPath = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) onPath.add([path[i], path[i + 1]].sort().join('|'));

    // Lanes.
    for (const sys of this.universe.systems.values()) {
      const a = this.toScreen(sys);
      for (const g of sys.gates) {
        if (g.to < sys.id) continue;
        const b = this.toScreen(this.universe.systems.get(g.to)!);
        const hot = onPath.has([sys.id, g.to].sort().join('|'));
        const vol = this.laneVolume(sys.id, g.to);
        const risky = Math.max(this.traffic.get(sys.id)?.piracy ?? 0, this.traffic.get(g.to)?.piracy ?? 0);
        c.strokeStyle = hot ? '#ffffff' : `rgba(160,190,255,${(0.16 + Math.min(0.3, vol / 900)).toFixed(3)})`;
        c.lineWidth = hot ? 2.5 : 1 + Math.min(3, vol / 110);
        c.setLineDash(hot ? [8, 5] : []);
        c.lineDashOffset = hot ? -time * 30 : 0;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.setLineDash([]);
        // Convoys: dots running both ways, one per ~90 sailings/h; amber on raided lanes.
        const n = Math.max(1, Math.round(vol / 90));
        c.fillStyle = risky > 0.2 ? 'rgba(255,196,107,0.85)' : 'rgba(200,225,255,0.8)';
        for (let k = 0; k < n; k++) {
          for (const dirn of [1, -1]) {
            const u = (((time * 0.05 + k / n + (dirn < 0 ? 0.5 / n : 0)) % 1) + 1) % 1;
            const f = dirn > 0 ? u : 1 - u;
            c.fillRect(a.x + (b.x - a.x) * f - 1.5, a.y + (b.y - a.y) * f - 1.5, 3, 3);
          }
        }
      }
    }
    c.setLineDash([]);

    // Systems.
    for (const sys of this.universe.systems.values()) {
      const p = this.toScreen(sys);
      const col = FACTION_COLOR[sys.faction] ?? '#fff';
      const r = sys.blurb ? 7 : 5;
      c.fillStyle = '#' + sys.starColor.getHexString();
      c.beginPath();
      c.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      c.stroke();
      const tr = this.traffic.get(sys.id);
      if (tr) {
        // Traffic halo: radius by sailings per hour.
        c.strokeStyle = 'rgba(160,190,255,0.22)';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(p.x, p.y, r + 5 + Math.min(12, tr.perHour / 70), 0, Math.PI * 2);
        c.stroke();
        if (tr.piracy > 0.1) {
          c.fillStyle = '#ffc46b';
          c.fillText('⚠', p.x - r - 16, p.y + 4);
        }
      }
      if (sys.id === cur) {
        c.strokeStyle = '#7dffb2';
        c.lineWidth = 2;
        const pr = r + 9 + Math.sin(time * 4) * 2;
        c.strokeRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
      }
      if (sys.id === this.destination) {
        c.strokeStyle = '#ffffff';
        c.beginPath();
        c.arc(p.x, p.y, r + 12, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = sys.id === this.hover ? '#ffffff' : col;
      c.fillText(sys.name.toUpperCase(), p.x + r + 7, p.y + 4);
      // Stations: one small square per dock, in its owner's colour.
      sys.stations.forEach((st, i) => {
        c.fillStyle = FACTION_COLOR[st.faction] ?? '#fff';
        c.fillRect(p.x + r + 8 + i * 7, p.y + 9, 4, 4);
      });
    }

    // Header + hover details.
    c.fillStyle = '#ffffff';
    c.font = '700 18px "Oxanium", sans-serif';
    c.fillText('MERIDIAN REACH // LANTERN NETWORK', 40, 44);
    c.font = '12px "Share Tech Mono", monospace';
    c.fillStyle = '#7dffb2';
    c.fillText(`CURRENT  ${this.universe.systems.get(cur)?.name.toUpperCase()}`, 40, 68);
    if (path.length > 1) c.fillText(`ROUTE    ${path.map((id) => this.universe.systems.get(id)!.name).join(' → ')}  (${path.length - 1} jumps)`, 40, 86);
    const hv = this.hover ? this.universe.systems.get(this.hover) : null;
    if (hv) {
      c.fillStyle = '#ffffff';
      c.fillText(`${hv.name.toUpperCase()} · CLASS ${hv.starClass} · ${hv.faction.toUpperCase()} · THREAT ${(hv.threat * 100).toFixed(0)}%`, 40, h - 50);
      if (hv.blurb) c.fillText(hv.blurb, 40, h - 32);
      hv.stations.forEach((st, i) => {
        c.fillStyle = FACTION_COLOR[st.faction] ?? '#fff';
        c.fillText(`■ ${st.name.toUpperCase()} · ${st.kind === 'orbital' ? 'ORBITAL PORT' : st.kind.toUpperCase()}`, 40, h - 70 - (hv.stations.length - 1 - i) * 16);
      });
    }
    this.drawSurvey(this.hover ?? this.destination ?? cur, w, h);
    c.fillStyle = 'rgba(125,255,178,0.7)';
    c.textAlign = 'right';
    c.fillText('[M] close · click a system to plot a route · fly through the marked Lantern to jump · ■ = dockable station · ⚠ = raiders', w - 24, h - 32);
    c.textAlign = 'left';
  }

  /** Mean sailings per hour on the lane between two systems (both Lantern ends). */
  private laneVolume(a: string, b: string): number {
    const ta = this.traffic.get(a)?.byGate[b] ?? 0;
    const tb = this.traffic.get(b)?.byGate[a] ?? 0;
    return (ta + tb) / 2;
  }

  /** Right-hand survey panel: bodies with kind, moons and a line of flavour; traffic. */
  private drawSurvey(id: string, w: number, h: number): void {
    const sys = this.universe.systems.get(id);
    if (!sys || w <= 1000) return;
    const c = this.ctx;
    const x = w - 390;
    let y = 44;
    const width = 360;
    c.fillStyle = 'rgba(3,10,16,0.72)';
    c.strokeStyle = 'rgba(125,255,178,0.35)';
    const lines: { text: string; color: string; font?: string }[] = [];
    lines.push({ text: `SURVEY // ${sys.name.toUpperCase()}`, color: '#ffffff', font: '700 14px "Oxanium", sans-serif' });
    const tr = this.traffic.get(sys.id);
    if (tr) {
      const pir = tr.piracy > 0.3 ? 'HIGH' : tr.piracy > 0.15 ? 'MODERATE' : tr.piracy > 0 ? 'LOW' : 'NONE';
      lines.push({ text: `TRAFFIC ~${Math.round(tr.perHour)} sailings/h · PATROLS ${tr.patrol ? tr.patrol.toUpperCase() : 'NONE'}`, color: '#7dffb2' });
      lines.push({ text: `RAIDERS ${pir}${tr.piracy > 0.15 ? ' — convoys advised' : ''}`, color: tr.piracy > 0.15 ? '#ffc46b' : '#7dffb2' });
    }
    for (const pl of sys.planets) {
      const k = pl.preset.kind ?? 'gas';
      const tag = pl.landmark ? pl.landmark.toUpperCase() : `${KIND_LABEL[k].toUpperCase()}${pl.preset.ring ? ', RINGED' : ''}`;
      const moons = pl.moons?.length ? ` · ${pl.moons.length} MOON${pl.moons.length > 1 ? 'S' : ''}` : '';
      lines.push({ text: `◯ ${pl.preset.name.toUpperCase()} — ${tag}${moons}`, color: pl.landmark ? '#ffc46b' : '#d8d0ff' });
      if (pl.description) for (const ln of wrap(c, pl.description, width - 18)) lines.push({ text: `   ${ln}`, color: 'rgba(216,208,255,0.7)' });
      for (const m of pl.moons ?? []) lines.push({ text: `   · ${m.preset.name} (${KIND_LABEL[m.preset.kind ?? 'rocky']})`, color: 'rgba(216,208,255,0.6)' });
    }
    const maxLines = Math.floor((h - 150) / 15);
    const shown = lines.slice(0, maxLines);
    c.fillRect(x - 12, y - 18, width + 24, shown.length * 15 + 16);
    c.strokeRect(x - 12, y - 18, width + 24, shown.length * 15 + 16);
    for (const l of shown) {
      c.font = l.font ?? '11px "Share Tech Mono", monospace';
      c.fillStyle = l.color;
      c.fillText(l.text, x, y);
      y += 15;
    }
    c.font = '12px "Share Tech Mono", monospace';
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  c.font = '11px "Share Tech Mono", monospace';
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (c.measureText(t).width > width && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}
