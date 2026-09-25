import './contracts.css';
import { registerDockTab, type DockContext, type DockTabApi } from './DockScreen';
import { drawPortrait, portraitKind } from './Portrait';
import { getAudio } from '@/audio';
import { FACTION_LABEL, type TradeLedger } from '@/game/economy';
import { KIND_LABEL, MAX_ACTIVE, TIER_LABEL, formatClock, hasContractClients, payableAt, type Contract } from '@/game/contracts/contracts';
import type { ContractDesk, LedgerIO } from '@/game/contracts/ContractDesk';

/**
 * Dock tab "CONTRACTS": the station's board, your accepted jobs, and a
 * mission-brief card in the OVA briefing style — client portrait (the comms
 * portrait generator, mouth flapping while the brief teletypes), kind and
 * tier plate, terms, route. ↑↓ select · A accept · D decline · T turn in ·
 * X abandon (twice).
 */
let desk: ContractDesk | null = null;
export function bindContractsTab(d: ContractDesk): void {
  desk = d;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;
const FC: Record<string, string> = { concord: '#6fe6ff', choir: '#ff5fb4', rustwake: '#ffc46b' };

interface Row {
  k: Contract;
  section: 'priority' | 'board' | 'accepted';
}

class ContractsTab {
  readonly id = 'contracts';
  readonly label = 'CONTRACTS';
  private panel: HTMLElement | null = null;
  private ctx: DockContext | null = null;
  private api: DockTabApi | null = null;
  private rows: Row[] = [];
  private sel = 0;
  private raf = 0;
  private t0 = 0;
  private armedAbandon: string | null = null;
  private note: { text: string; cls: string } | null = null;

  available(ctx: DockContext): boolean {
    return !!desk?.hasBoard(ctx.station.id);
  }

  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void {
    this.panel = panel;
    this.ctx = ctx;
    this.api = api;
    this.sel = 0;
    this.note = null;
    const r = desk?.lastReceipts;
    if (r && r.station === ctx.station.id && r.receipts.length) this.note = { text: r.receipts.map((x) => `SETTLED · ${x.title} · +${sh(x.amount)}`).join('  ◆  '), cls: 'ok' };
    this.render(true);
    const tick = () => {
      this.animate();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.panel = null;
    this.ctx = null;
    this.api = null;
  }

  private io(): LedgerIO {
    const ctx = this.ctx!;
    return { ledger: () => ctx.ledger(), setLedger: (l: TradeLedger) => ctx.setLedger(l) };
  }

  private collect(): void {
    const d = desk!;
    const st = this.ctx!.station.id;
    const offers = d.offers(st);
    this.rows = [
      ...offers.filter((k) => k.kind === 'priority').map((k) => ({ k, section: 'priority' as const })),
      ...offers.filter((k) => k.kind !== 'priority').map((k) => ({ k, section: 'board' as const })),
      ...d.book.active.map((k) => ({ k, section: 'accepted' as const })),
    ];
    this.sel = Math.max(0, Math.min(this.sel, this.rows.length - 1));
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.panel || !desk) return false;
    const row = this.rows[this.sel];
    switch (e.code) {
      case 'ArrowUp':
        this.select(this.sel - 1);
        return true;
      case 'ArrowDown':
        this.select(this.sel + 1);
        return true;
      case 'KeyA':
        if (row) this.accept(row);
        return true;
      case 'KeyD':
        if (row?.section === 'board') this.decline(row);
        return true;
      case 'KeyT':
        if (row?.section === 'accepted') this.turnIn(row);
        return true;
      case 'KeyX':
        if (row?.section === 'accepted') this.abandon(row);
        return true;
      default:
        return false;
    }
  }

  private select(i: number): void {
    if (!this.rows.length) return;
    const n = (i + this.rows.length) % this.rows.length;
    if (n === this.sel) return;
    this.sel = n;
    this.armedAbandon = null;
    getAudio().ui('move');
    this.render(true);
  }

  private accept(row: Row): void {
    if (row.section === 'accepted') return;
    const err = desk!.accept(row.k, this.io());
    if (err) {
      this.flash(err, 'err');
      getAudio().ui('move');
    } else if (row.k.kind !== 'priority') {
      this.flash(`ACCEPTED · ${row.k.title.toUpperCase()}${row.k.cargo ? ` · ${row.k.cargo.units} × ${row.k.cargo.name.toUpperCase()} LOADED` : ''}`, 'ok');
      getAudio().ui('confirm');
      this.api?.refresh();
    }
    this.render(true);
  }

  private decline(row: Row): void {
    desk!.decline(row.k);
    this.flash(`DECLINED · ${row.k.title.toUpperCase()}`, '');
    getAudio().ui('move');
    this.render(true);
  }

  private turnIn(row: Row): void {
    const got = desk!.turnIn(this.ctx!.station.id, this.io(), row.k.id);
    if (got.length) {
      this.flash(`PAID · ${got[0].title.toUpperCase()} · +${sh(got[0].amount)} · STANDING +${got[0].rep}`, 'ok');
      getAudio().ui('confirm');
      this.api?.refresh();
    } else this.flash(this.why(row.k), 'err');
    this.render(true);
  }

  private abandon(row: Row): void {
    if (this.armedAbandon !== row.k.id) {
      this.armedAbandon = row.k.id;
      this.flash(`ABANDON ${row.k.title.toUpperCase()}? PENALTY ${sh(row.k.penalty)} · STANDING −${row.k.repPenalty}. PRESS X AGAIN.`, 'err');
      this.render(false);
      return;
    }
    this.armedAbandon = null;
    const r = desk!.abandon(row.k, this.io());
    if (r) this.flash(`ABANDONED · ${row.k.title.toUpperCase()} · ${sh(r.amount)}`, 'err');
    this.api?.refresh();
    this.render(true);
  }

  private why(k: Contract): string {
    if (k.payAt !== this.ctx!.station.id) return `PAYABLE AT ${k.payAtName.toUpperCase()} (${desk!.sysName(k.payAtSystem).toUpperCase()})`;
    if (k.kind === 'haul') return `CONSIGNMENT SHORT — ${k.cargo!.units} × ${k.cargo!.name.toUpperCase()} REQUIRED`;
    return 'WORK NOT COMPLETE';
  }

  private flash(text: string, cls: string): void {
    this.note = { text, cls };
  }

  private render(restartTeletype: boolean): void {
    const panel = this.panel;
    const ctx = this.ctx;
    const d = desk;
    if (!panel || !ctx || !d) return;
    this.collect();
    if (restartTeletype) this.t0 = performance.now();
    const ledger = ctx.ledger();
    const hasIssuers = hasContractClients(ctx.station.faction);
    const emptyBoard = hasIssuers
      ? 'Nothing posted for a pilot of your standing. Check back after the repost.'
      : 'No local contract issuers are registered at this port.' + (ctx.station.id.startsWith('marches:') ? ' Use FIRST CONTACT for local supply agreements.' : '');
    const sections: [Row['section'], string][] = [
      ['priority', 'PRIORITY'],
      ['board', hasIssuers ? `BOARD // ${this.rows.filter((r) => r.section === 'board').length} POSTED · REPOST IN ${formatClock(d.repostIn())}` : 'BOARD // NO LOCAL ISSUERS'],
      ['accepted', `ACCEPTED // ${d.book.active.length}/${MAX_ACTIVE}`],
    ];
    const list = sections
      .map(([sec, head]) => {
        const rows = this.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.section === sec);
        if (!rows.length && sec === 'priority') return '';
        const body = rows.length
          ? rows.map(({ r, i }) => this.rowHtml(r, i, ledger)).join('')
          : `<div class="ct-empty">${sec === 'board' ? emptyBoard : 'No contracts in hand.'}</div>`;
        return `<h3 class="ct-h ${sec}">${head}</h3>${body}`;
      })
      .join('');
    const b = d.book;
    const row = this.rows[this.sel];
    panel.innerHTML = `
      <div class="ct">
        <div class="ct-list">${list}
          <div class="ct-record">RECORD · ${b.completed} COMPLETED · ${b.failed} FAILED · ${sh(b.earned)} EARNED · SHIP TIER ${'I'.repeat(d.tier())}</div>
        </div>
        ${row ? this.cardHtml(row, ledger) : '<div class="ct-card empty"><div class="ct-empty">Select a contract.</div></div>'}
      </div>
      <div class="ct-note ${this.note?.cls ?? ''}">${this.note ? `› ${esc(this.note.text)}` : '› ↑↓ SELECT · A ACCEPT · D DECLINE · T TURN IN · X ABANDON · ENTER LAUNCH'}</div>`;
    panel.querySelectorAll<HTMLElement>('[data-row]').forEach((el) =>
      el.addEventListener('click', () => {
        const i = Number(el.dataset.row);
        if (i !== this.sel) this.select(i);
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((el) =>
      el.addEventListener('click', () => {
        const r = this.rows[this.sel];
        if (!r) return;
        const act = el.dataset.act;
        if (act === 'accept') this.accept(r);
        else if (act === 'decline') this.decline(r);
        else if (act === 'turnin') this.turnIn(r);
        else if (act === 'abandon') this.abandon(r);
      }),
    );
    this.animate();
  }

  private rowHtml(r: Row, i: number, ledger: TradeLedger): string {
    const k = r.k;
    const d = desk!;
    const sel = i === this.sel ? ' sel' : '';
    const tier = k.kind === 'priority' ? '★' : '●'.repeat(k.tier) + '○'.repeat(3 - k.tier);
    let right: string;
    if (r.section === 'accepted') {
      const pay = payableAt(k, this.ctx!.station.id, ledger);
      const left = k.state === 'active' && k.due !== undefined ? k.due - d.book.clock : null;
      right = pay ? '<b class="pay">TURN IN</b>' : k.state === 'ready' ? '<b class="ready">READY</b>' : `<span class="${left !== null && left < 90 ? 'urgent' : ''}">⧗ ${formatClock(left ?? 0)}</span>`;
    } else if (k.kind === 'priority') right = '<b class="prio">STORY</b>';
    else right = `<span class="fee">${sh(k.reward)}</span>`;
    const where = k.kind === 'priority' ? 'REPORT TO THE FLIGHT LINE' : this.whereText(k);
    return `<div class="ct-row ${r.section}${sel} k-${k.kind}" data-row="${i}">
      <span class="kind">${KIND_LABEL[k.kind]}</span><span class="tier t${k.tier}">${tier}</span>
      <span class="title">${esc(k.title)}</span>${right}
      <span class="where">${esc(where)}</span>
    </div>`;
  }

  private whereText(k: Contract): string {
    const d = desk!;
    const sys = k.op && k.kind !== 'courier' && k.kind !== 'haul' ? k.op.system : k.payAtSystem;
    const j = d.jumpsTo(sys);
    const hops = j <= 0 ? 'THIS SYSTEM' : `${j} JUMP${j > 1 ? 'S' : ''}`;
    return `${d.sysName(sys).toUpperCase()} · ${hops}`;
  }

  private cardHtml(r: Row, ledger: TradeLedger): string {
    const k = r.k;
    const d = desk!;
    const cl = d.character(k.client);
    const col = FC[k.faction] ?? '#7dffb2';
    const stamp = r.section === 'accepted' ? (k.state === 'ready' ? 'COMPLETE' : 'ACCEPTED') : k.kind === 'priority' ? 'PRIORITY' : '';
    const terms: [string, string][] = [];
    if (k.kind === 'priority') {
      terms.push(['ORDERS', `Episode ${String(k.episode ?? 0).padStart(2, '0')} — the story continues`], ['CONTRACTS', 'Accepted jobs keep; their clocks pause during the episode']);
    } else {
      terms.push(['FEE', sh(k.reward)], ['STANDING', `+${k.rep} ${FACTION_LABEL[k.faction]}${k.enemy ? ` · ${k.enemy.rep} ${FACTION_LABEL[k.enemy.faction]}` : ''}`]);
      terms.push(['DEADLINE', r.section === 'accepted' && k.due !== undefined ? (k.state === 'ready' ? 'Met — collect at your leisure' : `${formatClock(k.due - d.book.clock)} remaining`) : `${formatClock(k.duration)} from acceptance`]);
      terms.push(['PENALTY', `${sh(k.penalty)} · standing −${k.repPenalty}`]);
      if (k.cargo) terms.push(['CARGO', `${k.cargo.units} × ${k.cargo.name} (${k.cargo.unit}) — loaded here, uses ${k.cargo.units} pod slots`]);
      if (k.kind === 'courier') terms.push(['CARGO', 'One sealed case — no pod space']);
      const op = k.op && k.kind !== 'courier' && k.kind !== 'haul' ? k.op : null;
      if (op) terms.push(['OPERATION', `${d.sysName(op.system)}${op.hostiles ? ` · expect ${op.hostiles * Math.max(1, op.waves)}+ hostiles` : ''}`]);
      terms.push(['PAID AT', `${k.payAtName}, ${d.sysName(k.payAtSystem)}`]);
      if (r.section === 'board' && k.expires - d.book.clock < 120) terms.push(['OFFER', `lapses in ${formatClock(k.expires - d.book.clock)}`]);
    }
    const pay = r.section === 'accepted' && payableAt(k, this.ctx!.station.id, ledger);
    const actions =
      r.section === 'accepted'
        ? `<button class="dock-btn" data-act="turnin" ${pay ? '' : 'disabled'}>TURN IN <small>T</small></button><button class="dock-btn warn" data-act="abandon">ABANDON <small>X</small></button>`
        : `<button class="ct-accept" data-act="accept">${k.kind === 'priority' ? 'ACCEPT ORDERS' : 'ACCEPT'} <small>A</small></button>${k.kind === 'priority' ? '' : '<button class="dock-btn" data-act="decline">DECLINE <small>D</small></button>'}`;
    return `<div class="ct-card ${k.faction}" style="--cc:${cl?.commsColor ?? col};--fcol:${col}">
      <div class="ct-card-head">
        <div class="ct-stripe"></div>
        <span class="ct-kicker">MISSION BRIEF // ${KIND_LABEL[k.kind]}${k.kind === 'priority' ? '' : ` · TIER ${'I'.repeat(k.tier)} ${TIER_LABEL[k.tier]}`}</span>
        <h2>${esc(k.title.toUpperCase())}</h2>
        ${stamp ? `<div class="ct-stamp ${stamp.toLowerCase()}">${stamp}</div>` : ''}
      </div>
      <div class="ct-card-body">
        <div class="ct-client">
          <div class="ct-portrait"><canvas width="168" height="196"></canvas><i></i></div>
          <div class="ct-who"><b>${esc(cl?.callsign ?? 'CLIENT')}</b><span>${esc(cl?.name ?? '')}</span><small>${esc(cl?.role ?? '')}</small></div>
        </div>
        <div class="ct-text"><div class="ct-brief"></div>
          <dl class="ct-terms">${terms.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
        </div>
      </div>
      <div class="ct-actions">${actions}</div>
    </div>`;
  }

  /** Portrait (talking while the brief types) + teletype. */
  private animate(): void {
    const panel = this.panel;
    const row = this.rows[this.sel];
    if (!panel || !row || !desk) return;
    const t = (performance.now() - this.t0) / 1000;
    const text = row.k.brief;
    const n = Math.min(text.length, Math.floor(t * 110));
    const brief = panel.querySelector<HTMLElement>('.ct-brief');
    if (brief && brief.dataset.n !== String(n)) {
      brief.dataset.n = String(n);
      brief.innerHTML = `${esc(text.slice(0, n))}${n < text.length ? '<span class="ct-cursor">&nbsp;</span>' : ''}`;
    }
    const cv = panel.querySelector<HTMLCanvasElement>('.ct-portrait canvas');
    const cl = desk.character(row.k.client);
    if (cv && cl) {
      const c = cv.getContext('2d')!;
      c.clearRect(0, 0, cv.width, cv.height);
      drawPortrait(c, cl.portrait, cv.width, cv.height, { time: t + 3, talking: n < text.length, tint: cl.commsColor, kind: portraitKind(cl.id, cl) });
    }
  }
}

registerDockTab(new ContractsTab());
