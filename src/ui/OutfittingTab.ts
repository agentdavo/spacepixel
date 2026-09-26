import './outfit.css';
import { registerDockTab, type DockContext, type DockTabApi } from './DockScreen';
import { getAudio } from '@/audio';
import { SAVE_FAILURE } from '@/game/CareerStore';
import { outfitter } from '@/game/outfitting/Outfitter';
import { computeFit, slotDraw, slotsFor, type FitSummary, type Slot } from '@/game/outfitting/fit';
import { activeShip, buyItem, entryOf, itemsAt, sellItem, RESALE, type Lock } from '@/game/outfitting/hangar';
import { GUNS, MAKERS, MK_LABEL, item, rawGunDps, type Item } from '@/game/outfitting/items';

/**
 * Dock tab "OUTFITTING": the slots of the ship you fly, the items this
 * station stocks for the selected slot (with stat deltas and power draw),
 * and the power budget bar. Buying fits the item at once and sells the old
 * one back at half price; the ship is refitted in the berth.
 *
 *   ↑↓ select · ←→ slots / items · B buy & fit · V strip slot (sell)
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;
const GROUP: Record<string, string> = { gun: 'WEAPONS', missile: 'WEAPONS', turret: 'WEAPONS', reactor: 'SYSTEMS', shield: 'SYSTEMS', armour: 'SYSTEMS', engine: 'SYSTEMS', bay: 'BAYS', hangar: 'BAYS' };
const KIND: Record<string, string> = { gun: 'GUN', missile: 'RACK', turret: 'TURRET', reactor: 'REACTOR', shield: 'SHIELD', armour: 'ARMOUR', engine: 'DRIVE', bay: 'BAY', hangar: 'HANGAR' };

interface Offer {
  item: Item;
  price: number;
  lock: Lock;
}

/** One line about what an item does. */
function itemLine(it: Item): string {
  switch (it.kind) {
    case 'gun':
      return it.guns.map((g) => `${GUNS[g].name} ${Math.round(rawGunDps(GUNS[g]) * it.dmg)} dps`).join(' + ') + ` · ${GUNS[it.guns[0]].type.toUpperCase()}`;
    case 'missile':
      return it.missiles.map((m) => (m === 'micro' ? 'SWARM' : m.toUpperCase())).join(' + ') + ` · DMG ×${it.dmg.toFixed(2)}${it.salvo !== 1 ? ` · SALVO ×${it.salvo}` : ''}`;
    case 'turret':
      return `${GUNS[it.gun].name} · ${Math.round(rawGunDps(GUNS[it.gun]) * it.dmg * it.rate)} dps · ${GUNS[it.gun].type.toUpperCase()}`;
    case 'shield':
      return `CAP ×${it.capacity.toFixed(2)} · REGEN ×${it.regen.toFixed(2)} · DELAY ×${it.delay.toFixed(2)}`;
    case 'armour':
      return `HULL ×${it.hull.toFixed(2)} · MASS ×${it.mass.toFixed(2)}`;
    case 'engine':
      return `SPEED ×${it.speed.toFixed(2)} · ACCEL ×${it.accel.toFixed(2)} · TURN ×${it.turn.toFixed(2)}`;
    case 'reactor':
      return `OUTPUT ×${it.output.toFixed(2)}`;
    case 'bay':
      return it.role === 'cargo' ? `HOLD +${Math.round(it.cargo * 100)}%` : it.role === 'pd' ? `POINT DEFENCE ${it.pd} dps` : `SHIELD REGEN +${Math.round(it.regen * 100)}%`;
    case 'hangar':
      return `LAUNCHES ONE ${it.craft === 'rw-gaff' ? 'GAFF' : 'KESTREL'} WHEN HOSTILES CLOSE`;
  }
}

class OutfittingTab {
  readonly id = 'outfitting';
  readonly label = 'OUTFITTING';
  private panel: HTMLElement | null = null;
  private ctx: DockContext | null = null;
  private api: DockTabApi | null = null;
  private slots: Slot[] = [];
  private offers: Offer[] = [];
  private slot = 0;
  /** Picker row; −1 = the "strip slot" row. */
  private pick = 0;
  private focus: 'slots' | 'items' = 'slots';
  private note: { text: string; cls: string } | null = null;

  available(): boolean {
    return !!outfitter();
  }

  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void {
    this.panel = panel;
    this.ctx = ctx;
    this.api = api;
    this.note = null;
    this.slot = 0;
    this.focus = 'slots';
    this.collect(true);
    this.render();
  }

  unmount(): void {
    this.panel = null;
    this.ctx = null;
    this.api = null;
  }

  private collect(resetPick: boolean): void {
    const o = outfitter()!;
    const e = entryOf(activeShip(o.hangar));
    this.slots = slotsFor(e);
    this.slot = Math.max(0, Math.min(this.slot, this.slots.length - 1));
    const s = this.slots[this.slot];
    this.offers = s ? itemsAt(this.ctx!.station, s, this.ctx!.ledger()) : [];
    if (resetPick) {
      // Start on the fitted item if the yard stocks it, else the first offer.
      const fitted = activeShip(o.hangar).fit[s?.id ?? ''];
      const i = this.offers.findIndex((x) => x.item.id === fitted);
      this.pick = i >= 0 ? i : this.offers.length ? 0 : -1;
    }
    this.pick = Math.max(s && !s.required ? -1 : 0, Math.min(this.pick, this.offers.length - 1));
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.panel) return false;
    switch (e.code) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const d = e.code === 'ArrowUp' ? -1 : 1;
        if (this.focus === 'slots') {
          this.slot = (this.slot + d + this.slots.length) % this.slots.length;
          this.collect(true);
        } else {
          const lo = this.slots[this.slot]?.required ? 0 : -1;
          const n = this.offers.length - lo;
          this.pick = ((this.pick - lo + d + n) % n) + lo;
        }
        getAudio().ui('move');
        this.render();
        return true;
      }
      case 'ArrowRight':
      case 'ArrowLeft':
        this.focus = e.code === 'ArrowRight' ? 'items' : 'slots';
        getAudio().ui('move');
        this.render();
        return true;
      case 'KeyB':
        this.buy();
        return true;
      case 'KeyV':
        this.strip();
        return true;
      default:
        return false;
    }
  }

  private result(r: { error?: string; message?: string }, commit: () => boolean): void {
    const error = r.error ?? (commit() ? undefined : SAVE_FAILURE);
    if (error) {
      this.note = { text: error, cls: 'err' };
      getAudio().ui('move');
    } else {
      this.note = { text: r.message ?? 'FITTED', cls: 'ok' };
      getAudio().ui('confirm');
      this.api?.say(r.message ?? '', 'ok');
    }
    this.collect(false);
    this.render();
  }

  private buy(): void {
    if (this.pick < 0) return this.strip();
    const o = outfitter()!;
    const ctx = this.ctx!;
    const s = this.slots[this.slot];
    const off = this.offers[this.pick];
    if (!s || !off) return;
    const r = buyItem(o.hangar, ctx.ledger(), o.hangar.active, s.id, off.item.id, ctx.station);
    this.result(r, () => o.commit(r));
  }

  private strip(): void {
    const o = outfitter()!;
    const ctx = this.ctx!;
    const s = this.slots[this.slot];
    if (!s) return;
    const r = sellItem(o.hangar, ctx.ledger(), o.hangar.active, s.id);
    this.result(r, () => o.commit(r));
  }

  private render(): void {
    const panel = this.panel;
    const ctx = this.ctx;
    const o = outfitter();
    if (!panel || !ctx || !o) return;
    const l = ctx.ledger();
    const ship = activeShip(o.hangar);
    const e = entryOf(ship);
    const cur = computeFit(e, ship.fit);
    const s = this.slots[this.slot];
    const off = this.pick >= 0 ? this.offers[this.pick] : null;
    const previewFit = s ? { ...ship.fit, [s.id]: this.pick < 0 ? null : (off?.item.id ?? ship.fit[s.id]) } : ship.fit;
    const prev = computeFit(e, previewFit);
    const episode = o.current() && JSON.stringify(o.current()!.summary) !== JSON.stringify(cur.summary);

    // Power bar: current draw, the preview's draw as a marker.
    const out = cur.power.output;
    const pct = (v: number) => Math.min(100, (v / Math.max(out, prev.power.output, 1)) * 100);
    const hot = cur.power.draw > out ? 'over' : cur.power.draw > out * 0.85 ? 'hot' : '';
    const power = `<div class="of-power"><div class="lbl"><span>POWER BUDGET</span><b>${cur.power.draw} / ${out} MW</b></div><div class="meter"><i class="${hot}" style="width:${pct(cur.power.draw)}%"></i><em style="left:${pct(prev.power.draw)}%"></em></div></div>`;

    let group = '';
    const slotRows = this.slots
      .map((sl, i) => {
        const it = item(ship.fit[sl.id]);
        const g = GROUP[sl.kind];
        const head = g !== group ? `<h3 class="of-h">${(group = g)}</h3>` : '';
        const size = sl.size ?? (sl.cls ? `C${sl.cls}` : '');
        return `${head}<div class="of-row${i === this.slot ? ' sel' : ''}" data-slot="${i}"><span class="slot"><span class="kind">${KIND[sl.kind]} ${size}</span> · ${esc(sl.label)}</span><span class="pw">${it ? `${slotDraw(sl, it)} MW` : ''}</span><span class="it${it ? '' : ' empty'}">${it ? `${esc(it.name)}<span class="mk">${MK_LABEL[it.mk]}</span>` : 'EMPTY'}</span></div>`;
      })
      .join('');

    const fittedId = s ? ship.fit[s.id] : null;
    const itemRows =
      (s && !s.required ? `<div class="of-row item${this.pick === -1 ? ' sel' : ''}" data-pick="-1"><span class="it empty">STRIP SLOT${fittedId ? ` · SELL FOR ${sh((item(fittedId)?.price ?? 0) * RESALE)}` : ''}</span><span></span><span></span></div>` : '') +
      (this.offers.length
        ? this.offers
            .map((x, i) => {
              const it = x.item;
              return `<div class="of-row item${i === this.pick ? ' sel' : ''}${x.lock ? ' locked' : ''}${it.id === fittedId ? ' fitted' : ''}" data-pick="${i}"><span class="it">${esc(it.name)}<span class="mk">${MK_LABEL[it.mk]}</span></span><span class="pw">${slotDraw(s!, it)} MW</span><span class="price">${it.id === fittedId ? 'FITTED' : sh(x.price)}</span><span class="sub">${esc(MAKERS[it.maker].short)} · ${x.lock ? `<span class="lock">${esc(x.lock.reason)}</span>` : esc(itemLine(it))}</span></div>`;
            })
            .join('')
        : '<div class="of-row"><span class="it empty">Nothing for this slot at this yard.</span></div>');

    // Stat comparison: fitted vs preview.
    const rows: [string, keyof FitSummary, string?][] = [
      ['HULL', 'hull'],
      ['SHIELD', 'shield'],
      ['REGEN /s', 'regen'],
      ['DELAY s', 'delay'],
      ['SPEED', 'speed'],
      ['BOOST', 'boost'],
      ['ACCEL', 'accel'],
      ['TURN °/s', 'turn'],
      ['CARGO', 'cargo'],
      ['GUNS dps', 'gunDps'],
      ['TURRETS dps', 'turretDps'],
      ['PD dps', 'pd'],
    ];
    const a = cur.summary;
    const b = prev.summary;
    const stats =
      rows
        .map(([k, key]) => {
          const x = a[key] as number;
          const y = b[key] as number;
          const better = key === 'delay' ? y < x : y > x;
          const cls = x === y ? '' : better ? 'up' : 'dn';
          return `<span class="k">${k}</span><span class="a">${x.toLocaleString('en-US')}</span><span class="b ${cls}">${y.toLocaleString('en-US')}</span>`;
        })
        .join('') +
      `<span class="k">MISSILES</span><span class="a">${esc(a.missiles)}</span><span class="b ${a.missiles !== b.missiles ? 'up' : ''}">${esc(b.missiles)}</span>` +
      `<span class="k">POWER MW</span><span class="a">${cur.power.draw}/${cur.power.output}</span><span class="b ${prev.power.draw > prev.power.output ? 'dn' : ''}">${prev.power.draw}/${prev.power.output}</span>`;
    const it = off?.item;
    const card = `<div class="of-card ${it ? MAKERS[it.maker].faction : ''}">
        <div><span class="maker">${it ? `${esc(MAKERS[it.maker].name.toUpperCase())} · ${KIND[it.kind]}` : 'STRIP SLOT'}</span><h2>${it ? `${esc(it.name)} ${MK_LABEL[it.mk]}` : esc(s?.label ?? '')}</h2></div>
        <div class="blurb">${it ? esc(it.blurb) : 'Pull the item and sell it back at half price. Saves power; loses whatever it did.'}${it?.requires ? `<br><span class="${off?.lock ? 'lock dn' : 'up'}">REQUIRES ${it.requires.faction === 'concord' ? 'DIRECTORATE' : it.requires.faction === 'choir' ? 'HEGEMONY' : 'RUSTWAKE'} STANDING ${it.requires.standing >= 0 ? '+' : ''}${it.requires.standing}</span>` : ''}</div>
        <div class="of-stats"><span class="k"></span><span class="a">FITTED</span><span class="b">WITH THIS</span>${stats}</div>
        <div class="sy-actions">${it ? `<button class="sy-buy" data-act="buy" ${off?.lock || it.id === fittedId || (off?.price ?? 0) > l.credits + (item(fittedId)?.price ?? 0) * RESALE ? 'disabled' : ''}>BUY & FIT · ${sh(off?.price ?? 0)} <small>B</small></button>` : ''}${s && !s.required && fittedId ? '<button class="dock-btn warn" data-act="strip">STRIP <small>V</small></button>' : ''}</div>
      </div>`;

    panel.innerHTML = `
      <div class="of">
        <div class="of-col${this.focus === 'slots' ? '' : ' blur'}">
          <div class="of-ship"><b>${esc(e.designation)} ${esc(e.name.toUpperCase())}</b><small>TIER ${e.tier} · ${esc(e.role.toUpperCase())}</small></div>
          ${power}
          ${slotRows}
        </div>
        <div class="of-col${this.focus === 'items' ? '' : ' blur'}">
          <h3 class="of-h">${esc(s ? `${KIND[s.kind]} ${s.size ?? (s.cls ? `C${s.cls}` : '')} · ${s.label}` : '')} <small>${this.offers.length} IN STOCK</small></h3>
          ${itemRows}
        </div>
        ${card}
      </div>
      <div class="of-note ${this.note?.cls ?? ''}">${this.note ? `› ${esc(this.note.text)}` : `› ↑↓ SELECT · ←→ SLOTS / ITEMS · B BUY & FIT · V STRIP · OLD ITEMS SELL BACK AT ${RESALE * 100}%${episode ? ' · FLEET SHIP THIS EPISODE — REFIT APPLIES AFTER' : ''}`}</div>`;
    panel.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) =>
      el.addEventListener('click', () => {
        this.slot = Number(el.dataset.slot);
        this.focus = 'slots';
        this.collect(true);
        getAudio().ui('move');
        this.render();
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-pick]').forEach((el) =>
      el.addEventListener('click', () => {
        this.pick = Number(el.dataset.pick);
        this.focus = 'items';
        getAudio().ui('move');
        this.render();
      }),
    );
    panel.querySelector<HTMLButtonElement>('[data-act="buy"]')?.addEventListener('click', () => this.buy());
    panel.querySelector<HTMLButtonElement>('[data-act="strip"]')?.addEventListener('click', () => this.strip());
    panel.querySelector('.of-row.sel')?.scrollIntoView({ block: 'nearest' });
    for (const col of panel.querySelectorAll('.of-col')) col.querySelector('.of-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
}

registerDockTab(new OutfittingTab());
