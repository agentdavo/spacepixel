import './outfit.css';
import { registerDockTab, type DockContext, type DockTabApi } from './DockScreen';
import { HullSheet } from './HullSheet';
import { getAudio } from '@/audio';
import { SAVE_FAILURE } from '@/game/CareerStore';
import { loadProfile } from '@/game/Profile';
import { outfitter } from '@/game/outfitting/Outfitter';
import { computeFit, slotsFor, stockFit } from '@/game/outfitting/fit';
import { activeShip, buyHull, entryOf, hullLock, hullsAt, sellShip, shipValue, switchShip, MAX_OWNED, type OwnedShip } from '@/game/outfitting/hangar';
import type { CatalogEntry } from '@/game/shipyard/catalog';

/**
 * Dock tab "SHIPYARD": your hangar (owned hulls travel with you — board any
 * of them here) and the hulls this station's yard sells, filtered by faction
 * and standing. A rotating cel model sheet of the selected hull, a stat
 * comparison against the ship you fly, and the deal: price, trade-in, net.
 *
 *   ↑↓ select · B buy (trade in current) · N buy and keep · A board · X sell (twice)
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

type Row = { kind: 'owned'; ship: OwnedShip; e: CatalogEntry } | { kind: 'sale'; e: CatalogEntry; lock: string | null };

function hardpoints(e: CatalogEntry): string {
  const s = slotsFor(e);
  const n = (k: string) => s.filter((x) => x.kind === k).length;
  return `${n('gun')}G · ${n('missile')}M · ${n('turret')}T · ${s.filter((x) => x.kind === 'bay' || x.kind === 'hangar').length}U`;
}

class ShipyardTab {
  readonly id = 'shipyard';
  readonly label = 'SHIPYARD';
  private panel: HTMLElement | null = null;
  private ctx: DockContext | null = null;
  private api: DockTabApi | null = null;
  private rows: Row[] = [];
  private sel = 0;
  private sheet: HullSheet | null = null;
  private armedSell: string | null = null;
  private note: { text: string; cls: string } | null = null;

  available(): boolean {
    return !!outfitter();
  }

  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void {
    this.panel = panel;
    this.ctx = ctx;
    this.api = api;
    this.note = null;
    this.collect();
    // Start on the next hull up the ladder (the thing you came to look at).
    const tier = entryOf(activeShip(outfitter()!.hangar)).tier;
    const up = this.rows.findIndex((r) => r.kind === 'sale' && r.e.tier > tier && !r.lock);
    const i = up >= 0 ? up : this.rows.findIndex((r) => r.kind === 'sale');
    this.sel = i >= 0 ? i : 0;
    this.render();
  }

  unmount(): void {
    this.sheet?.stop();
    this.sheet = null;
    this.panel = null;
    this.ctx = null;
    this.api = null;
  }

  private collect(): void {
    const o = outfitter()!;
    const ctx = this.ctx!;
    const l = ctx.ledger();
    this.rows = [
      ...o.hangar.ships.map((ship): Row => ({ kind: 'owned', ship, e: entryOf(ship) })),
      ...hullsAt(ctx.station).map((e): Row => ({ kind: 'sale', e, lock: hullLock(e, ctx.station, l) })),
    ];
    this.sel = Math.max(0, Math.min(this.sel, this.rows.length - 1));
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.panel) return false;
    const row = this.rows[this.sel];
    switch (e.code) {
      case 'ArrowUp':
        this.select(this.sel - 1);
        return true;
      case 'ArrowDown':
        this.select(this.sel + 1);
        return true;
      case 'KeyB':
        if (row?.kind === 'sale') this.buy(row.e, true);
        return true;
      case 'KeyN':
        if (row?.kind === 'sale') this.buy(row.e, false);
        return true;
      case 'KeyA':
        if (row?.kind === 'owned') this.board(row.ship);
        return true;
      case 'KeyX':
        if (row?.kind === 'owned') this.sell(row.ship);
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
    this.armedSell = null;
    getAudio().ui('move');
    this.render();
  }

  private done(r: { error?: string; message?: string }, ok: () => boolean): void {
    const error = r.error ?? (ok() ? undefined : SAVE_FAILURE);
    if (error) {
      this.note = { text: error, cls: 'err' };
      getAudio().ui('move');
    } else {
      this.note = { text: r.message ?? 'DONE', cls: 'ok' };
      getAudio().ui('confirm');
      this.api?.say(r.message ?? '', 'ok');
    }
    this.collect();
    this.render();
  }

  private buy(e: CatalogEntry, tradeIn: boolean): void {
    const o = outfitter()!;
    const ctx = this.ctx!;
    const r = buyHull(o.hangar, ctx.ledger(), e.id, ctx.station, { tradeIn, condition: o.condition() });
    this.done(r, () => {
      if (!o.commit(r)) return false;
      // Select the new ship in your hangar.
      this.collect();
      this.sel = Math.max(0, this.rows.findIndex((x) => x.kind === 'owned' && x.ship.uid === o.hangar.active));
      return true;
    });
  }

  private board(s: OwnedShip): void {
    const o = outfitter()!;
    const ctx = this.ctx!;
    const r = switchShip(o.hangar, ctx.ledger(), s.uid, o.condition());
    this.done(r, () => o.commit(r));
  }

  private sell(s: OwnedShip): void {
    const o = outfitter()!;
    const ctx = this.ctx!;
    if (this.armedSell !== s.uid) {
      this.armedSell = s.uid;
      this.note = { text: `SELL ${entryOf(s).name.toUpperCase()} FOR ${sh(shipValue(s))}? PRESS X AGAIN.`, cls: 'err' };
      this.render();
      return;
    }
    this.armedSell = null;
    const r = sellShip(o.hangar, ctx.ledger(), s.uid);
    this.done(r, () => o.commit(r));
  }

  private render(): void {
    const panel = this.panel;
    const ctx = this.ctx;
    const o = outfitter();
    if (!panel || !ctx || !o) return;
    const l = ctx.ledger();
    const act = activeShip(o.hangar);
    const owned = this.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'owned');
    const sale = this.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'sale');
    const rowHtml = ({ r, i }: { r: Row; i: number }) => {
      const e = r.e;
      const sel = i === this.sel ? ' sel' : '';
      if (r.kind === 'owned') {
        const on = r.ship.uid === act.uid;
        const cond = on ? o.condition() : r.ship.condition;
        return `<div class="sy-row${sel}" data-row="${i}"><span class="tier">T${ROMAN[e.tier]}</span><span class="name">${esc(e.designation)} ${esc(e.name.toUpperCase())}<small>${esc(e.role.toUpperCase())}</small></span>${on ? '<b class="active">ABOARD</b>' : `<span class="price">${sh(shipValue({ ...r.ship, condition: cond }))}</span>`}<span class="sub">HULL ${Math.round(cond * 100)}% · ${hardpoints(e)} · ${computeFit(e, r.ship.fit).cargo} HOLD</span></div>`;
      }
      return `<div class="sy-row${sel}${r.lock ? ' locked' : ''}" data-row="${i}"><span class="tier">T${ROMAN[e.tier]}</span><span class="name">${esc(e.designation)} ${esc(e.name.toUpperCase())}<small>${esc(e.role.toUpperCase())}</small></span><span class="price">${sh(e.price)}</span><span class="sub">${r.lock ? `<span class="lock">${esc(r.lock)}</span>` : `${esc(e.manufacturer.toUpperCase())} · ${e.length} M · CREW ${e.crew}`}</span></div>`;
    };
    const row = this.rows[this.sel];
    panel.innerHTML = `
      <div class="sy">
        <div class="sy-list">
          <h3 class="sy-h">YOUR HANGAR <small>${o.hangar.ships.length}/${MAX_OWNED} · FERRIED WITH YOU</small></h3>
          ${owned.map(rowHtml).join('')}
          <h3 class="sy-h">THE YARD <small>${sale.length ? `${sale.length} HULLS` : 'NOTHING FOR SALE HERE'}</small></h3>
          ${sale.map(rowHtml).join('') || '<div class="sy-row"><span></span><span class="name">This berth sells no hulls. Try a bastion or an orbital port.</span></div>'}
        </div>
        ${row ? this.cardHtml(row, act, l.credits) : '<div class="sy-card"></div>'}
      </div>
      <div class="sy-note ${this.note?.cls ?? ''}">${this.note ? `› ${esc(this.note.text)}` : '› ↑↓ SELECT · B BUY (TRADE IN) · N BUY & KEEP · A BOARD · X SELL · ENTER LAUNCH'}</div>`;
    panel.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => el.addEventListener('click', () => this.select(Number(el.dataset.row))));
    panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = this.rows[this.sel];
        if (!r) return;
        const a = b.dataset.act;
        if (r.kind === 'sale' && (a === 'buy' || a === 'keep')) this.buy(r.e, a === 'buy');
        else if (r.kind === 'owned' && a === 'board') this.board(r.ship);
        else if (r.kind === 'owned' && a === 'sell') this.sell(r.ship);
      }),
    );
    // The model sheet (kept across renders while the selection holds).
    const cv = panel.querySelector<HTMLCanvasElement>('.sy-sheet canvas');
    if (cv && row) {
      this.sheet?.stop();
      this.sheet = new HullSheet(cv);
      this.sheet.setHull(row.e.blueprint, row.kind === 'owned' ? loadProfile().livery : undefined);
      this.sheet.caption = `${row.e.designation} · ${row.e.length} M · CREW ${row.e.crew} · ${row.e.camera === 'bridge' ? 'BRIDGE COMMAND' : 'CHASE'}`;
      this.sheet.draw(performance.now() / 1000);
      this.sheet.start();
    }
  }

  private cardHtml(row: Row, act: OwnedShip, credits: number): string {
    const o = outfitter()!;
    const e = row.e;
    const mine = o.current()?.summary ?? computeFit(entryOf(act), act.fit).summary;
    const theirs = computeFit(e, row.kind === 'owned' ? row.ship.fit : stockFit(e)).summary;
    const ae = entryOf(act);
    const lines: [string, number, number, boolean?][] = [
      ['HULL', mine.hull, theirs.hull],
      ['SHIELD', mine.shield, theirs.shield],
      ['SPEED m/s', mine.speed, theirs.speed],
      ['BOOST m/s', mine.boost, theirs.boost],
      ['ACCEL m/s²', mine.accel, theirs.accel],
      ['TURN °/s', mine.turn, theirs.turn],
      ['CARGO', mine.cargo, theirs.cargo],
      ['GUNS dps', mine.gunDps, theirs.gunDps],
      ['TURRETS dps', mine.turretDps, theirs.turretDps],
      ['CREW', ae.crew, e.crew, true],
      ['LENGTH m', ae.length, e.length, true],
    ];
    const cmp = lines
      .map(([k, a, b, neutral]) => {
        const m = Math.max(a, b, 1);
        const cls = neutral || a === b ? '' : b > a ? 'up' : 'dn';
        return `<span class="k">${k}</span><span class="a">${Math.round(a).toLocaleString('en-US')}</span><span class="b ${cls}">${Math.round(b).toLocaleString('en-US')}</span><span class="bar"><i style="width:${(b / m) * 100}%"></i><em style="width:${(a / m) * 100}%"></em></span>`;
      })
      .join('');
    let deal = '';
    let actions = '';
    let stamp = '';
    if (row.kind === 'sale') {
      const value = shipValue({ ...act, condition: o.condition() });
      const net = e.price - value;
      stamp = row.lock ? `<div class="stamp lock">${esc(row.lock.startsWith('NEEDS') ? 'RESTRICTED' : 'N/A')}</div>` : '';
      deal = `<dl><dt>PRICE</dt><dd>${sh(e.price)}</dd><dt>TRADE-IN · ${esc(ae.name.toUpperCase())}</dt><dd>− ${sh(value)}</dd><dt>NET</dt><dd class="net ${net > credits ? 'dn' : ''}">${sh(Math.max(0, net))}</dd></dl>`;
      actions = `<button class="sy-buy" data-act="buy" ${row.lock || net > credits ? 'disabled' : ''}>BUY · TRADE IN <small>B</small></button><button class="dock-btn" data-act="keep" ${row.lock || e.price > credits ? 'disabled' : ''}>BUY & KEEP <small>N</small></button>`;
    } else {
      const on = row.ship.uid === act.uid;
      stamp = on ? '<div class="stamp">ABOARD</div>' : '';
      deal = `<dl><dt>CONDITION</dt><dd>${Math.round((on ? o.condition() : row.ship.condition) * 100)}%</dd><dt>YARD VALUE</dt><dd>${sh(shipValue({ ...row.ship, condition: on ? o.condition() : row.ship.condition }))}</dd><dt>HARDPOINTS</dt><dd>${hardpoints(e)}</dd></dl>`;
      actions = on ? '<span class="sy-kicker">YOUR SHIP · REFIT IN OUTFITTING</span>' : `<button class="sy-buy" data-act="board">BOARD <small>A</small></button><button class="dock-btn warn" data-act="sell">SELL <small>X</small></button>`;
    }
    const fac = e.faction;
    return `<div class="sy-card ${fac}">
      <div><div class="sy-stripe"></div><span class="sy-kicker">${row.kind === 'owned' ? 'YOUR HANGAR' : 'MODEL SHEET'} // TIER ${ROMAN[e.tier]} ${esc(e.role.toUpperCase())} · ${esc(e.manufacturer.toUpperCase())}</span><h2>${esc(e.designation)} ${esc(e.name.toUpperCase())}</h2></div>
      <div class="sy-mid">
        <div class="sy-sheet"><canvas></canvas><i></i>${stamp}</div>
        <div class="sy-cmp"><span class="k"></span><span class="a">YOURS</span><span class="b">THIS</span><span></span>${cmp}</div>
      </div>
      <div class="sy-blurb">${esc(e.blurb)}</div>
      <div class="sy-deal">${deal}<div class="sy-actions">${actions}</div></div>
    </div>`;
  }
}

registerDockTab(new ShipyardTab());
