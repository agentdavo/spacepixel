import './dock.css';
import {
  COMMODITIES,
  COMMODITY,
  FACTION_LABEL,
  KIND_LABEL,
  MISSILE_MAX,
  buy,
  cargoUsed,
  quote,
  rearm,
  rearmCost,
  repair,
  repairCost,
  rumours,
  sell,
  standingLabel,
  hazard,
  HAZARD_DEMAND,
  type CommodityId,
  type EconFaction,
  type MarketSpec,
  type TradeLedger,
} from '@/game/economy';
import { getAudio } from '@/audio';
import { loadCrew, repairMultiplier } from '@/game/crew';

/**
 * The docked screen (docking & trade): a DOM overlay in the CRT/OVA style of
 * the title and briefing cards. Everything it shows comes from the pure
 * economy module; it owns no state beyond the selected row — the ledger and
 * hull live with the flight scene, which persists them.
 *
 *   ↑↓ select · → / B buy · ← / V sell · hold Shift ×5 · R repair · E rearm · Enter launch
 */
export interface DockContext {
  station: MarketSpec & { name: string };
  systemName: string;
  berth: string;
  /** Every market in the Reach (for the rumour ticker's price tips). */
  markets: readonly (MarketSpec & { name: string })[];
  ledger(): TradeLedger;
  setLedger(l: TradeLedger): void;
  /** Player hull, 0..1. */
  hull(): number;
  setHull(h: number): void;
  /** Repair-cost multiplier for the airframe size (shipyard hulls; default 1). */
  hullSize?(): number;
  onLaunch(): void;
  /** Extra opening lines for the dock log (contract settlements, …). */
  notices?: { text: string; cls?: string }[];
}

/**
 * Extra dock tabs (shipyard, outfitting, contracts, concourse …) register here
 * and appear after MARKET; digits 1–6 switch tabs. A tab owns its panel's DOM
 * and gets first refusal on keys while active (return true = handled).
 */
export interface DockTabApi {
  /** Line in the dock log (cls: '' | 'ok' | 'err'). */
  say(text: string, cls?: string): void;
  /** Redraw the header stats (shares, cargo, standing) after changing the ledger. */
  refresh(): void;
}
export interface DockTab {
  id: string;
  label: string;
  /** Hide the tab at stations that don't offer it. */
  available?(ctx: DockContext): boolean;
  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void;
  onKey?(e: KeyboardEvent): boolean;
  unmount?(): void;
}
const TABS: DockTab[] = [];
export function registerDockTab(tab: DockTab): void {
  const i = TABS.findIndex((t) => t.id === tab.id);
  if (i >= 0) TABS[i] = tab;
  else TABS.push(tab);
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;

export class DockScreen {
  private el: HTMLDivElement | null = null;
  private ctx: DockContext | null = null;
  private sel = 0;
  private log: { text: string; cls: string }[] = [];
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** null = the built-in market tab. */
  private tab: DockTab | null = null;
  private tabs: DockTab[] = [];

  constructor(private root: HTMLElement) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  open(ctx: DockContext): void {
    this.close();
    this.ctx = ctx;
    this.sel = 0;
    const l = ctx.ledger();
    this.log = [{ text: `BERTH ${ctx.berth} · ${ctx.station.name.toUpperCase()} · SEALS GREEN. WELCOME ABOARD, VANGUARD.`, cls: 'ok' }];
    if (l.rep[ctx.station.faction] < -20) this.log.push({ text: 'THE DECK CREW WATCHES YOU. TARIFFS APPLY TO THE UNTRUSTED.', cls: 'err' });
    for (const n of ctx.notices ?? []) this.log.push({ text: n.text, cls: n.cls ?? '' });
    const el = document.createElement('div');
    el.className = `dock-screen ${ctx.station.faction}`;
    this.el = el;
    this.root.append(el);
    const ticker = rumours({ station: ctx.station, systemName: ctx.systemName, clock: l.clock, markets: ctx.markets, ledger: l });
    el.innerHTML = `
      <div class="dock-head">
        <div>
          <div class="stripe"></div>
          <div class="kicker">${KIND_LABEL[ctx.station.kind]} · ${FACTION_LABEL[ctx.station.faction]} · ${esc(ctx.systemName.toUpperCase())} · BERTH ${ctx.berth}${hazard(ctx.station) > 0 ? ` · <span style="color:#ff9b3f">HAZARD PAY +${Math.round(hazard(ctx.station) * HAZARD_DEMAND * 100)}%</span>` : ''}</div>
          <h2>${esc(ctx.station.name.toUpperCase())}</h2>
        </div>
        <div class="dock-stats"></div>
      </div>
      <nav class="dock-tabs"></nav>
      <div class="dock-panel" hidden></div>
      <div class="dock-body">
        <section class="dock-market"><h3>MARKET // ASK · BID IN SHARES</h3><table></table><div class="dock-blurb"></div></section>
        <section class="dock-services">
          <div class="dock-svc hull"></div>
          <div class="dock-svc rails"></div>
          <div class="dock-svc"><h3>STANDING</h3><div class="dock-rep"></div></div>
          <div class="dock-log"></div>
          <div class="dock-keys">↑↓ SELECT · → B BUY · ← V SELL · SHIFT ×5 · R REPAIR · E REARM · M STAR MAP</div>
          <button class="dock-launch">LAUNCH <small>ENTER</small></button>
        </section>
      </div>
      <div class="dock-ticker"><span>${ticker.map(esc).join('<em>◆</em>')}</span></div>`;
    el.querySelector('.dock-launch')!.addEventListener('click', () => this.launch());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', this.onKey);
    this.tabs = TABS.filter((t) => t.available?.(ctx) ?? true);
    this.tab = null;
    this.renderTabs();
    this.render();
    // ?docktab=<id>: open on a registered tab (captures).
    const want = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('docktab') : null;
    const wi = want ? this.tabs.findIndex((t) => t.id === want) : -1;
    if (wi >= 0) this.switchTab(wi + 1);
  }

  private renderTabs(): void {
    const nav = this.el?.querySelector('.dock-tabs');
    if (!nav) return;
    const all = [{ id: 'market', label: 'MARKET' }, ...this.tabs];
    const cur = this.tab?.id ?? 'market';
    nav.innerHTML = all.map((t, i) => `<button data-tab="${i}" class="${t.id === cur ? 'on' : ''}"><small>${i + 1}</small>${esc(t.label)}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.switchTab(Number(b.dataset.tab))));
  }

  /** 0 = market, 1.. = registered tabs. */
  private switchTab(i: number): void {
    const el = this.el;
    const ctx = this.ctx;
    if (!el || !ctx || i > this.tabs.length) return;
    const next = i === 0 ? null : this.tabs[i - 1];
    if (next === this.tab) return;
    this.tab?.unmount?.();
    this.tab = next;
    const panel = el.querySelector('.dock-panel') as HTMLElement;
    const body = el.querySelector('.dock-body') as HTMLElement;
    panel.innerHTML = '';
    panel.hidden = !next;
    body.hidden = !!next;
    if (next) next.mount(panel, ctx, { say: (t, c) => (this.say(t, c), this.render()), refresh: () => this.render() });
    getAudio().ui('move');
    this.renderTabs();
    this.render();
  }

  close(): void {
    this.tab?.unmount?.();
    this.tab = null;
    window.removeEventListener('keydown', this.onKey);
    this.el?.remove();
    this.el = null;
    this.ctx = null;
  }

  private launch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    getAudio().ui('confirm');
    this.close();
    ctx.onLaunch();
  }

  private say(text: string, cls = ''): void {
    this.log.push({ text, cls });
    if (this.log.length > 4) this.log.shift();
  }

  private trade(cid: CommodityId, dir: 'buy' | 'sell', n: number): void {
    const ctx = this.ctx!;
    const r = (dir === 'buy' ? buy : sell)(ctx.ledger(), ctx.station, cid, n);
    const c = COMMODITY[cid];
    if (r.units) {
      ctx.setLedger(r.ledger);
      this.say(`${dir === 'buy' ? 'BOUGHT' : 'SOLD'} ${r.units} × ${c.name.toUpperCase()} ${dir === 'buy' ? 'FOR' : '—'} ${sh(r.total)}${r.error ? ` · ${r.error}` : ''}`, 'ok');
      getAudio().ui('confirm');
    } else {
      this.say(`${c.name.toUpperCase()}: ${r.error ?? 'NO TRADE'}`, 'err');
      getAudio().ui('move');
    }
    this.render();
  }

  private repair(): void {
    const ctx = this.ctx!;
    const mechanic = repairMultiplier(loadCrew());
    const r = repair(ctx.ledger(), ctx.station, ctx.hull(), ctx.hullSize?.() ?? 1, mechanic);
    if (r.cost > 0) {
      ctx.setLedger(r.ledger);
      ctx.setHull(r.hull);
      this.say(`HULL PATCHED TO ${Math.round(r.hull * 100)}% — ${sh(r.cost)}. ${mechanic < 1 ? 'TWO-COATS DOES THE LABOUR; THE YARD SELLS THE PLATE.' : 'THE WARDENS SAY THE WORDS.'}`, 'ok');
    } else this.say(ctx.hull() >= 1 ? 'HULL IS WHOLE. NOTHING TO KEEP.' : 'INSUFFICIENT SHARES FOR REPAIRS', ctx.hull() >= 1 ? '' : 'err');
    this.render();
  }

  private rearm(): void {
    const ctx = this.ctx!;
    const r = rearm(ctx.ledger(), ctx.station);
    if (r.cost > 0) {
      ctx.setLedger(r.ledger);
      this.say(`RAILS LOADED: ${r.ledger.missiles}/${MISSILE_MAX} SALVOS — ${sh(r.cost)}`, 'ok');
    } else this.say(ctx.ledger().missiles >= MISSILE_MAX ? 'RAILS ALREADY FULL' : 'INSUFFICIENT SHARES TO REARM', ctx.ledger().missiles >= MISSILE_MAX ? '' : 'err');
    this.render();
  }

  private key(e: KeyboardEvent): void {
    if (!this.ctx) return;
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      return this.switchTab(Number(digit[1]) - 1);
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      return this.launch();
    }
    if (this.tab) {
      if (this.tab.onKey?.(e)) e.preventDefault();
      return;
    }
    const n = e.shiftKey ? 5 : 1;
    const cid = COMMODITIES[this.sel].id;
    switch (e.code) {
      case 'ArrowUp':
        this.sel = (this.sel + COMMODITIES.length - 1) % COMMODITIES.length;
        break;
      case 'ArrowDown':
        this.sel = (this.sel + 1) % COMMODITIES.length;
        break;
      case 'ArrowRight':
      case 'KeyB':
        return this.trade(cid, 'buy', n);
      case 'ArrowLeft':
      case 'KeyV':
        return this.trade(cid, 'sell', n);
      case 'KeyR':
        return this.repair();
      case 'KeyE':
        return this.rearm();
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        return this.launch();
      default:
        return;
    }
    e.preventDefault();
    getAudio().ui('move');
    this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    const el = this.el;
    if (!ctx || !el) return;
    const l = ctx.ledger();
    const st = ctx.station;
    const f = st.faction;
    el.querySelector('.dock-stats')!.innerHTML = `
      <div><span>SHARES</span><b>${sh(l.credits)}</b></div>
      <div><span>CARGO POD</span><b>${cargoUsed(l)}/${l.capacity}</b></div>
      <div><span>STANDING</span><b>${standingLabel(l.rep[f])}</b></div>`;

    const rows = COMMODITIES.map((c, i) => {
      const q = quote(st, c.id, l);
      const held = l.cargo[c.id] ?? 0;
      const sel = i === this.sel ? ' sel' : '';
      if (!q)
        return `<tr class="none${sel}" data-i="${i}"><td class="name">${c.name}<span class="unit">${c.unit}</span></td><td>—</td><td>not traded</td><td></td><td class="held">${held || ''}</td><td></td></tr>`;
      const tag = q.stance === 'surplus' ? 'SURPLUS' : q.stance === 'demand' ? 'DEMAND' : 'STEADY';
      return `<tr class="${sel}" data-i="${i}">
        <td class="name">${c.name}<span class="unit">${c.unit}</span></td>
        <td><span class="tag ${q.stance}">${tag}</span></td>
        <td class="ask">${q.buy.toLocaleString('en-US')}</td>
        <td>${q.sell.toLocaleString('en-US')}</td>
        <td class="held">${held || '·'}</td>
        <td><button class="dock-btn" data-sell="${c.id}" ${held ? '' : 'disabled'}>SELL</button> <button class="dock-btn" data-buy="${c.id}" ${q.buy <= l.credits && cargoUsed(l) < l.capacity ? '' : 'disabled'}>BUY</button></td>
      </tr>`;
    }).join('');
    const table = el.querySelector('.dock-market table')!;
    table.innerHTML = `<tr><th>COMMODITY</th><th>MARKET</th><th>ASK</th><th>BID</th><th>HOLD</th><th></th></tr>${rows}`;
    table.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) =>
      tr.addEventListener('pointerenter', () => {
        const i = Number(tr.dataset.i);
        if (i !== this.sel) {
          this.sel = i;
          this.render();
        }
      }),
    );
    table.querySelectorAll<HTMLButtonElement>('button[data-buy]').forEach((b) => b.addEventListener('click', (e) => this.trade(b.dataset.buy as CommodityId, 'buy', e.shiftKey ? 5 : 1)));
    table.querySelectorAll<HTMLButtonElement>('button[data-sell]').forEach((b) => b.addEventListener('click', (e) => this.trade(b.dataset.sell as CommodityId, 'sell', e.shiftKey ? 5 : 1)));
    const c = COMMODITIES[this.sel];
    el.querySelector('.dock-blurb')!.textContent = `${c.name.toUpperCase()} — ${c.blurb}`;

    const hull = ctx.hull();
    const mechanic = repairMultiplier(loadCrew());
    const rc = repairCost(st, l, hull, ctx.hullSize?.() ?? 1, mechanic);
    el.querySelector('.dock-svc.hull')!.innerHTML = `
      <div class="row"><h3>HULL · AIRFRAME 0413</h3><span>${Math.round(hull * 100)}%</span></div>
      <div class="meter"><i style="width:${Math.round(hull * 100)}%"></i></div>
      <div class="row"><span>${rc > 0 ? (mechanic < 1 ? 'Two-Coats has his sleeves up (−30%).' : 'Wardens standing by.') : 'The seal holds.'}</span><button class="dock-btn" data-act="repair" ${rc > 0 && l.credits > 0 ? '' : 'disabled'}>REPAIR${rc > 0 ? ` — ${sh(rc)}` : ''}</button></div>`;
    const ac = rearmCost(st, l);
    el.querySelector('.dock-svc.rails')!.innerHTML = `
      <div class="row"><h3>MICRO-MISSILE RAILS</h3><span class="pips">${'■'.repeat(l.missiles)}${'□'.repeat(MISSILE_MAX - l.missiles)}</span></div>
      <div class="row" style="margin-top:8px"><span>${l.missiles}/${MISSILE_MAX} salvos</span><button class="dock-btn" data-act="rearm" ${ac > 0 && l.credits > 0 ? '' : 'disabled'}>REARM${ac > 0 ? ` — ${sh(ac)}` : ''}</button></div>`;
    el.querySelector<HTMLButtonElement>('[data-act="repair"]')?.addEventListener('click', () => this.repair());
    el.querySelector<HTMLButtonElement>('[data-act="rearm"]')?.addEventListener('click', () => this.rearm());

    const fac: EconFaction[] = ['concord', 'choir', 'rustwake'];
    el.querySelector('.dock-rep')!.innerHTML = fac
      .map((k) => {
        const r = l.rep[k];
        const col = k === 'choir' ? '#ff5fb4' : k === 'rustwake' ? '#ffc46b' : '#6fe6ff';
        const w = Math.abs(r) / 2;
        const left = r >= 0 ? 50 : 50 - w;
        return `<span style="color:${col}">${FACTION_LABEL[k]}</span><div class="bar"><i style="left:${left}%;width:${w}%;background:${col}"></i></div><span>${standingLabel(r)} ${r >= 0 ? '+' : ''}${Math.round(r)}</span>`;
      })
      .join('');
    el.querySelector('.dock-log')!.innerHTML = this.log.map((m) => `<div class="${m.cls}">› ${esc(m.text)}</div>`).join('');
  }
}

/**
 * Cutaway framing for the docking / launch sequences: letterbox bars, an ink
 * panel frame, a skewed caption plate, a recording timecode and an iris-out.
 */
export class DockCinema {
  private el = document.createElement('div');
  private iris: HTMLDivElement;
  private tc: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.el.className = 'dock-cinema';
    this.el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="frame"></div><div class="tc"></div><div class="plate"><small></small><b></b><span></span></div><div class="iris"></div>`;
    this.iris = this.el.querySelector('.iris')!;
    this.tc = this.el.querySelector('.tc')!;
    root.append(this.el);
  }

  show(kicker: string, title: string, sub: string): void {
    const p = this.el.querySelector('.plate')!;
    p.querySelector('small')!.textContent = kicker;
    p.querySelector('b')!.textContent = title;
    p.querySelector('span')!.textContent = sub;
    this.el.classList.add('show');
    this.setIris(1);
  }

  /** 1 = open, 0 = closed to black. */
  setIris(open: number): void {
    const r = open >= 1 ? 150 : Math.max(0, open) * 75;
    this.iris.style.setProperty('--r', `${r}vmax`);
  }

  timecode(t: number): void {
    const s = Math.floor(t);
    const f = Math.floor((t - s) * 24);
    this.tc.textContent = `REC  00:00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  hide(): void {
    this.el.classList.remove('show');
    this.setIris(1);
  }
}
