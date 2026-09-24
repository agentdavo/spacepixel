import '@/ui/outfit.css';
import '@/ui/Concourse'; // registers the CONCOURSE dock tab
import { DockScreen, type DockContext } from '@/ui/DockScreen';
import { HullSheet } from '@/ui/HullSheet';
import { newLedger, type MarketSpec, type TradeLedger } from '@/game/economy';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { computeFit, stockFit } from '@/game/outfitting/fit';
import { berth } from '@/world/Docking';
import { getVoice } from '@/audio/voice';
import { CONCOURSE_PERSON } from './trailer';

/**
 * The trailer's UI shots: the real dock screen (market, concourse) opened on
 * a demo ledger in display-only mode — no keys, nothing saved — and a
 * shipyard model sheet (the shipyard tab's card and cel turntable) cycling up
 * the Vanguard ladder on the film's clock. Framed inside the letterbox.
 */
export type UiShot = 'market' | 'concourse' | 'shipyard';

const LADDER = ['vf27-kestrel', 'vf40-gauntlet', 'gs12-bulwark', 'cr5-resolute', 'ffl3-valiant'] as const;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** A good-looking mid-career ledger: shares banked, a mixed hold, standing earned. */
function demoLedger(): TradeLedger {
  const l = newLedger();
  l.credits = 18_450;
  l.cargo = { ebon: 4, relics: 3, rations: 2, medical: 1 };
  l.rep = { ...l.rep, concord: 34, choir: -22, rustwake: 12 };
  l.missiles = 3;
  l.clock = 5400;
  return l;
}

export class TrailerUi {
  private readonly dock: DockScreen;
  private ledger = demoLedger();
  private yard: HTMLDivElement | null = null;
  private sheet: HullSheet | null = null;
  private hull = -1;
  private live: UiShot | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly station: MarketSpec & { name: string },
    private readonly systemName: string,
    private readonly markets: readonly (MarketSpec & { name: string })[],
  ) {
    this.dock = new DockScreen(root);
  }

  private context(): DockContext {
    return {
      station: this.station,
      systemName: this.systemName,
      berth: berth(this.station),
      markets: this.markets,
      ledger: () => this.ledger,
      setLedger: (l) => (this.ledger = l),
      hull: () => 0.62,
      setHull: () => {},
      onLaunch: () => {},
      notices: [{ text: 'BAND TALK: TEY REFINERY PAYING 1,600 SH FOR REACTOR CORES.', cls: 'ok' }],
      demo: { person: CONCOURSE_PERSON },
    };
  }

  /** Cut to a UI shot (null: none). */
  show(kind: UiShot | null): void {
    if (kind === this.live) return;
    const was = this.live;
    this.live = kind;
    if (kind !== 'market' && kind !== 'concourse') {
      if (this.dock.isOpen) {
        this.dock.close();
        getVoice().stopAll();
      }
    } else {
      if (!this.dock.isOpen || (was !== 'market' && was !== 'concourse')) {
        this.ledger = demoLedger();
        this.dock.open(this.context());
        this.dock.element?.classList.add('trailer-dock');
      }
      this.dock.showTab(kind);
    }
    if (kind === 'shipyard') this.openYard();
    else this.closeYard();
  }

  private openYard(): void {
    if (this.yard) return;
    const el = document.createElement('div');
    el.className = 'trailer-yard';
    el.innerHTML = `<div class="sy-card concord"><div><div class="sy-stripe"></div><span class="sy-kicker"></span><h2></h2></div><div class="sy-mid"><div class="sy-sheet"><canvas></canvas><i></i></div><div class="sy-cmp"></div></div><div class="sy-blurb"></div><div class="sy-deal"></div></div>`;
    this.root.append(el);
    this.yard = el;
    this.sheet = new HullSheet(el.querySelector('canvas')!);
    this.hull = -1;
  }

  private closeYard(): void {
    this.yard?.remove();
    this.yard = null;
    this.sheet = null;
  }

  /** Per frame on the film clock (shot-local seconds). */
  update(local: number): void {
    if (!this.yard || !this.sheet) return;
    const i = Math.min(LADDER.length - 1, Math.floor(local / 0.8));
    if (i !== this.hull) {
      this.hull = i;
      this.fillYard(LADDER[i], local);
    }
    // A brisk turntable (the tab's own spins at 0.45 rad/s).
    this.sheet.draw(local * 2.4);
  }

  private fillYard(id: string, local: number): void {
    const el = this.yard!;
    const e = CATALOG_BY_ID[id];
    const base = CATALOG_BY_ID['vf27-kestrel'];
    const mine = computeFit(base, stockFit(base)).summary;
    const theirs = computeFit(e, stockFit(e)).summary;
    el.querySelector('.sy-kicker')!.textContent = `MODEL SHEET // TIER ${ROMAN[e.tier]} ${e.role.toUpperCase()} · ${e.manufacturer.toUpperCase()}`;
    el.querySelector('h2')!.textContent = `${e.designation} ${e.name.toUpperCase()}`;
    el.querySelector('.sy-blurb')!.textContent = e.blurb;
    const rows: [string, number, number][] = [
      ['HULL', mine.hull, theirs.hull],
      ['SHIELD', mine.shield, theirs.shield],
      ['SPEED m/s', mine.speed, theirs.speed],
      ['CARGO', mine.cargo, theirs.cargo],
      ['GUNS dps', mine.gunDps, theirs.gunDps],
      ['TURRETS dps', mine.turretDps, theirs.turretDps],
      ['CREW', base.crew, e.crew],
      ['LENGTH m', base.length, e.length],
    ];
    el.querySelector('.sy-cmp')!.innerHTML =
      '<span class="k"></span><span class="a">YOURS</span><span class="b">THIS</span><span></span>' +
      rows
        .map(([k, a, b]) => {
          const m = Math.max(a, b, 1);
          const cls = a === b ? '' : b > a ? 'up' : 'dn';
          return `<span class="k">${k}</span><span class="a">${Math.round(a).toLocaleString('en-US')}</span><span class="b ${cls}">${Math.round(b).toLocaleString('en-US')}</span><span class="bar"><i style="width:${(b / m) * 100}%"></i><em style="width:${(a / m) * 100}%"></em></span>`;
        })
        .join('');
    el.querySelector('.sy-deal')!.innerHTML = `<dl><dt>PRICE</dt><dd>${sh(e.price)}</dd><dt>LENGTH · CREW</dt><dd>${e.length} M · ${e.crew}</dd></dl><div class="sy-actions"><button class="sy-buy">${esc(id === 'vf27-kestrel' ? 'ABOARD' : 'BUY · TRADE IN')}</button></div>`;
    this.sheet!.setHull(e.blueprint, undefined, local * 2.4);
    this.sheet!.caption = `${e.designation} · ${e.length} M · CREW ${e.crew}`;
  }

  dispose(): void {
    this.dock.close();
    this.closeYard();
  }
}
