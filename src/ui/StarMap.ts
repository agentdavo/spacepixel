import type { Universe, StarSystem } from '@/universe/Universe';
import { route } from '@/universe/Universe';

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

  constructor(
    root: HTMLElement,
    private universe: Universe,
    private currentId: () => string,
  ) {
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;z-index:24;pointer-events:auto;cursor:crosshair;background:rgba(3,6,12,0.88)';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
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
    const s = Math.min((w - 120) / 100, (h - 160) / 64);
    return { ox: (w - 100 * s) / 2, oy: (h - 64 * s) / 2 + 20, s };
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
        c.strokeStyle = hot ? '#ffffff' : 'rgba(160,190,255,0.28)';
        c.lineWidth = hot ? 2.5 : 1;
        c.setLineDash(hot ? [8, 5] : []);
        c.lineDashOffset = hot ? -time * 30 : 0;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
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
    c.fillStyle = 'rgba(125,255,178,0.7)';
    c.fillText('[M] close · click a system to plot a route · fly through the marked Lantern to jump · ■ = dockable station', w - 760, h - 32);
  }
}
