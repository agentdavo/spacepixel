import type { StarMap } from './StarMap';
import type { WorldRuntime } from '@/game/world/live';
import { FLOOR, QUARTER, engagementStatus, quarterOf, type Engagement, type EngagementStatus } from '@/game/world/schedule';
import { fmtCount, signalState } from '@/game/world/signal';
import { fact } from '@/game/world/WorldState';

/**
 * The Schedule of Engagements on the star map (batch 5 · item 5), in the
 * map's CRT style: a crossed-sabre marker at each field with its countdown,
 * and a panel in the bottom of the right-hand column — the quarter's
 * engagements, expected expenditure, Ebon to market, the floor. `[` / `]`
 * select (and plot a route), `O` takes the selected one as ordered (a
 * contract on the book). The header line carries the Signal count.
 *
 * Shown once Episode 8 is flown; after Episode 18 the panel says the
 * Schedule was read aloud; after Episode 19, that nothing is scheduled.
 */
export interface ScheduleDesk {
  acceptSchedule(e: Engagement): { text: string; ok: boolean };
  /** Engagement ids already on the pilot's book. */
  booked(): Set<string>;
}

const AMBER = '#ffb347';
const EBON = '#b77bff';
const RED = '#ff5f7a';
const GREEN = '#7dffb2';
const STATUS_COL: Record<EngagementStatus, string> = { upcoming: AMBER, open: '#ffffff', fought: 'rgba(200,200,220,0.45)', flown: GREEN, broken: RED };
const STATUS_TAG: Record<EngagementStatus, string> = { upcoming: '', open: 'OPEN', fought: 'FOUGHT', flown: 'FLOWN', broken: 'DECISIVE' };

export function fmtT(s: number): string {
  const a = Math.max(0, Math.round(Math.abs(s)));
  return `${s < 0 ? '+' : '−'}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

export class ScheduleOverlay {
  private sel = 0;
  private flash: { text: string; ok: boolean; until: number } | null = null;
  private now = 0;

  constructor(
    private map: StarMap,
    private rt: WorldRuntime,
    private desk: ScheduleDesk,
  ) {
    map.layers.push((c, at, time) => this.draw(c, at, time));
    window.addEventListener('keydown', (e) => this.key(e));
  }

  private list(): Engagement[] {
    return this.rt.schedule();
  }

  private key(e: KeyboardEvent): void {
    if (!this.map.open) return;
    const list = this.list();
    if (!list.length) return;
    if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
      this.sel = (this.sel + (e.code === 'BracketRight' ? 1 : list.length - 1)) % list.length;
      this.map.destination = list[this.sel].system;
    } else if (e.code === 'KeyO') {
      const eng = list[Math.min(this.sel, list.length - 1)];
      const r = this.desk.acceptSchedule(eng);
      this.flash = { ...r, until: this.now + 4 };
      if (r.ok) this.map.destination = eng.system;
    }
  }

  private draw(c: CanvasRenderingContext2D, at: (id: string) => { x: number; y: number } | null, time: number): void {
    this.now = time;
    const w = this.rt.state;
    const W = window.innerWidth;
    const H = window.innerHeight;
    c.save();
    this.drawSignal(c, W);
    const known = !!fact(w, 'schedule.known');
    if (!known) {
      this.map.surveyReserve = 0;
      c.restore();
      return;
    }
    const list = this.list();
    const booked = this.desk.booked();
    if (this.sel >= list.length) this.sel = 0;

    // Field markers.
    for (const e of list) {
      const p = at(e.system);
      if (!p) continue;
      const st = engagementStatus(w, e);
      const col = STATUS_COL[st];
      const x = p.x + 16;
      const y = p.y + 22;
      c.strokeStyle = col;
      c.fillStyle = col;
      c.lineWidth = 1.6;
      // Crossed sabres in a diamond.
      const r = st === 'open' ? 7 + Math.sin(time * 6) * 1.5 : 6;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.moveTo(x - 3.5, y - 3.5);
      c.lineTo(x + 3.5, y + 3.5);
      c.moveTo(x + 3.5, y - 3.5);
      c.lineTo(x - 3.5, y + 3.5);
      c.stroke();
      if (st === 'open' || st === 'broken') {
        c.globalAlpha = 0.35 + 0.25 * Math.sin(time * 4);
        c.beginPath();
        c.arc(x, y, 14 + ((time * 10) % 10), 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
      c.font = '11px "Share Tech Mono", monospace';
      const label = st === 'upcoming' || st === 'open' ? `ENG ${e.number} T${fmtT(e.at - w.clock)}` : `ENG ${e.number} ${STATUS_TAG[st]}`;
      c.fillText(label, x + 11, y + 4);
      if (booked.has(e.id)) {
        c.fillStyle = AMBER;
        c.fillText('◆ ORDERS', x + 11, y + 17);
      }
    }

    // Panel: bottom of the right-hand column.
    const pw = Math.min(372, W - 32);
    const x0 = W - pw - 18;
    const rows: { text: string; color: string; font?: string }[] = [];
    const q = quarterOf(w.clock);
    rows.push({ text: `SCHEDULE OF ENGAGEMENTS // QUARTER ${q + 1}`, color: '#ffffff', font: '700 14px "Oxanium", sans-serif' });
    if (fact(w, 'gates.aligned')) {
      rows.push({ text: 'NO ENGAGEMENTS SCHEDULED.', color: GREEN });
      rows.push({ text: 'DESTINATION NOT YET SCHEDULED. THIS IS NOT AN ERROR.', color: 'rgba(125,255,178,0.7)' });
    } else if (fact(w, 'schedule.read')) {
      rows.push({ text: 'READ ALOUD ON THE ALLOCATION HOUR. SUSPENDED.', color: AMBER });
      rows.push({ text: '"Engagement 131, Anchorage. Expected expenditure: 4,112."', color: 'rgba(255,255,255,0.7)' });
    } else {
      rows.push({ text: `CO-SIGNED PRYCE · QUILLON · FLOOR ${FLOOR} sh/g · NEXT QUARTER T${fmtT((q + 1) * QUARTER - w.clock)}`, color: 'rgba(255,179,71,0.75)' });
      rows.push({ text: '"NO ENGAGEMENT SHALL BE DECISIVE."', color: 'rgba(255,179,71,0.75)' });
      list.forEach((e, i) => {
        const st = engagementStatus(w, e);
        const t = st === 'upcoming' || st === 'open' ? `T${fmtT(e.at - w.clock)}` : STATUS_TAG[st];
        const sel = i === this.sel;
        rows.push({
          text: `${sel ? '▶' : ' '} ${e.number} ${e.systemName.toUpperCase().padEnd(13).slice(0, 13)} ${t.padEnd(8)} EXP ${String(e.directorate).padStart(2)}/${String(e.hegemony).padEnd(2)} EBON ${String(e.ebon).padStart(4)} g${booked.has(e.id) ? ' ◆' : ''}${e.correction ? ' !' : ''}`,
          color: sel ? '#ffffff' : STATUS_COL[st],
        });
      });
      const e = list[this.sel];
      if (e) {
        const st = engagementStatus(w, e);
        rows.push({ text: `PROTECTED: ${e.protectedName.toUpperCase()}${e.correction ? ' · CORRECTION — 13TH REQUESTED BY NAME' : e.joint ? ' · JOINT SQUADS' : ''}`, color: EBON });
        const can = (st === 'upcoming' || st === 'open') && !booked.has(e.id);
        rows.push({ text: can ? '[ ] SELECT · [O] FLY AS ORDERED — OR BREAK IT' : booked.has(e.id) ? '◆ ON YOUR BOOK — TAKE STATION ON THE LINE' : '[ ] SELECT', color: can ? AMBER : 'rgba(255,179,71,0.6)' });
      }
      const broken = w.log.filter((x) => x.kind === 'schedule.broken').length;
      if (fact(w, 'continuity.hostile')) rows.push({ text: `OFFICE OF CONTINUITY: HOSTILE${broken ? ` · ${broken} BROKEN` : ''}`, color: RED });
    }
    if (this.flash && this.flash.until > time) rows.push({ text: this.flash.text, color: this.flash.ok ? GREEN : RED });
    const lh = 16;
    const ph = rows.length * lh + 18;
    const y0 = H - 54 - ph;
    this.map.surveyReserve = ph + 34;
    c.fillStyle = 'rgba(16,8,2,0.82)';
    c.strokeStyle = 'rgba(255,179,71,0.55)';
    c.lineWidth = 1;
    c.fillRect(x0 - 12, y0, pw + 24, ph);
    c.strokeRect(x0 - 12, y0, pw + 24, ph);
    // Signal-orange ID band.
    c.fillStyle = AMBER;
    c.fillRect(x0 - 12, y0, 4, ph);
    let y = y0 + 20;
    for (const r of rows) {
      c.font = r.font ?? '11px "Share Tech Mono", monospace';
      c.fillStyle = r.color;
      c.fillText(r.text, x0, y, pw);
      y += lh;
    }
    // Scanlines, lightly.
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let sy = y0; sy < y0 + ph; sy += 3) c.fillRect(x0 - 12, sy, pw + 24, 1);
    c.restore();
  }

  /** The Signal count under the map header. */
  private drawSignal(c: CanvasRenderingContext2D, W: number): void {
    const s = signalState(this.rt.state);
    if (s.count === null) return;
    const label = s.mode === 'stopped' ? 'NULL COUNT 2 · THE CLOCK HAS STOPPED' : s.mode === 'up' ? `NULL COUNT ${fmtCount(s.count)} · COUNTING UP` : `NULL COUNT ${fmtCount(s.count)}${s.breathDays !== null ? ` · BREATH IN ${s.breathDays} d` : ''}${s.nextIn !== null ? ` · NEXT BURST T${fmtT(s.nextIn)}` : ''}${s.source === 'monolith' ? ' · SOURCE: MONOLITH' : ''}`;
    c.font = '12px "Share Tech Mono", monospace';
    c.textAlign = 'right';
    c.fillStyle = EBON;
    c.fillText(label, W > 1000 ? W - 430 : W - 24, 44);
    c.textAlign = 'left';
  }
}
