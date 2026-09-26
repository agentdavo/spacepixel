import './guild.css';
import { registerDockTab, type DockContext, type DockTabApi } from './DockScreen';
import { drawPortrait } from './Portrait';
import { Subtitles } from './Subtitles';
import { getAudio } from '@/audio';
import { SAVE_FAILURE } from '@/game/CareerStore';
import { getVoice } from '@/audio/voice';
import { COMMODITY, cargoUsed, repairCost, type CommodityId, type TradeLedger } from '@/game/economy';
import { KIND_LABEL, TIER_LABEL, hops, type Contract } from '@/game/contracts/contracts';
import { world } from '@/game/world/WorldState';
import { outfitter } from '@/game/outfitting/Outfitter';
import { GUNS, MAKERS, MK_LABEL, rawGunDps, type Item } from '@/game/outfitting/items';
import { GUILDS, GUILD_IDS, MAX_RANK, OUTPOST_RANK, hostility, isSeat, type GuildId } from '@/game/guilds/guilds';
import { canJoin, duesOwed, duesPeriods, greeting, isMember, leave, meritOf, payDues, promotionBlock, rankOf, rankProgress, titleIn, discount } from '@/game/guilds/membership';
import { arcState, choose, pendingChoice, type ArcStep } from '@/game/guilds/arcs';
import { buyFromQuartermaster, stockFor } from '@/game/guilds/quartermaster';
import { build, claim, claimBlock, deliver, hasService, nextNeeds, outpostOf, outpostSites, stow, STAGES } from '@/game/outposts/outposts';
import type { GuildRuntime } from '@/game/guilds/GuildRuntime';

/**
 * Dock tabs "GUILD HALL" (at a guild's hall, or your outpost's annex) and
 * "OUTPOST" (at your outpost's berth). The hall: its master or quartermaster
 * on a CRT (the comms portrait generator, mouth moving while the voiced,
 * subtitled greeting plays), your rank on the guild's ladder and the merit
 * bar to the next, dues, joining / rank / leaving; and four panels —
 *
 *   WORK            guild-flavoured contracts (booked on the ContractDesk)
 *   QUARTERMASTER   relic-grade Mk V stock, rank-locked, fitted on the spot
 *   ARC             the guild's hand-written missions, and the finale's choice
 *   OUTPOST         claim a hulk (rank 3), deliver goods, build stages, storage
 *
 * Captures: ?dock=docked&station=<hall>&docktab=guild&guild=keeping.3[&gpanel=arc|qm|outpost]
 */
let rt: GuildRuntime | null = null;
export function bindGuildTab(r: GuildRuntime): void {
  rt = r;
}

type Panel = 'work' | 'qm' | 'arc' | 'outpost';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sh = (n: number) => `${Math.round(n).toLocaleString('en-US')} sh`;
const PANELS: { id: Panel; label: string }[] = [
  { id: 'work', label: 'GUILD WORK' },
  { id: 'qm', label: 'QUARTERMASTER' },
  { id: 'arc', label: 'ARC' },
  { id: 'outpost', label: 'OUTPOST' },
];

function itemLine(it: Item): string {
  switch (it.kind) {
    case 'gun':
      return it.guns.map((g) => `${GUNS[g].name} ${Math.round(rawGunDps(GUNS[g]) * it.dmg)} dps`).join(' + ');
    case 'missile':
      return `${it.missiles.map((m) => (m === 'micro' ? 'SWARM' : m.toUpperCase())).join(' + ')} · DMG ×${it.dmg.toFixed(2)} · SALVO ×${it.salvo}`;
    case 'shield':
      return `CAP ×${it.capacity.toFixed(2)} · REGEN ×${it.regen.toFixed(2)} · DELAY ×${it.delay.toFixed(2)}`;
    case 'armour':
      return `HULL ×${it.hull.toFixed(2)} · MASS ×${it.mass.toFixed(2)}`;
    case 'engine':
      return `SPEED ×${it.speed.toFixed(2)} · ACCEL ×${it.accel.toFixed(2)} · TURN ×${it.turn.toFixed(2)}`;
    case 'reactor':
      return `OUTPUT ×${it.output.toFixed(2)}`;
    case 'bay':
      return `HOLD +${Math.round(it.cargo * 100)}%`;
    default:
      return '';
  }
}

function goodsLine(g: Partial<Record<CommodityId, number>>, have?: Partial<Record<CommodityId, number>>): string {
  const e = Object.entries(g) as [CommodityId, number][];
  if (!e.length) return '<span class="dim">nothing</span>';
  return e.map(([c, n]) => `<span class="${have && (have[c] ?? 0) >= n ? 'ok' : ''}">${n} × ${esc(COMMODITY[c].name.toLowerCase())}${have ? ` <small>(${have[c] ?? 0} aboard)</small>` : ''}</span>`).join(' · ');
}

class GuildTab {
  private ctx!: DockContext;
  private api!: DockTabApi;
  private root!: HTMLElement;
  private guild: GuildId | null = null;
  private panel: Panel = 'work';
  private subs: Subtitles | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private stage: { canvas: HTMLCanvasElement; c2d: CanvasRenderingContext2D } | null = null;
  private speaker = '';
  private sel = 0;
  private armLeave = false;
  private log: { text: string; cls?: string }[] = [];

  constructor(readonly mode: 'hall' | 'outpost') {}

  available(ctx: DockContext): boolean {
    if (!rt) return false;
    if (this.mode === 'outpost') return rt.isOutpost(ctx.station.id);
    return !!rt.hallGuild(ctx.station.id);
  }

  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void {
    this.ctx = ctx;
    this.api = api;
    const r = rt!;
    const o = outpostOf(world().state);
    this.guild = this.mode === 'outpost' ? (o?.guild ?? null) : r.hallGuild(ctx.station.id);
    const g = this.guild ? GUILDS[this.guild] : null;
    const q = new URLSearchParams(location.search);
    this.panel = this.mode === 'outpost' ? 'outpost' : ((q.get('gpanel') as Panel | null) ?? (pendingChoice(world().state, this.guild!) ? 'arc' : 'work'));
    this.sel = 0;
    this.log = [];
    const seat = this.guild && isSeat(this.guild, ctx.station.id);
    this.speaker = g ? (seat ? g.master : g.quartermaster) : '';
    const who = r.scene.contracts.character(this.speaker);
    panel.innerHTML = `
      <div class="gh" style="--gc:${g?.color ?? '#ffae4f'}">
        <section class="gh-hall">
          <div class="gh-head">
            <div class="gh-stripe"></div>
            <small>${esc(this.mode === 'outpost' ? 'YOUR OUTPOST' : `${(seat ? 'SEAT OF THE GUILD · ' : '') + (g?.hall ?? '')}`.toUpperCase())}</small>
            <h2>${esc((g?.name ?? 'Outpost').toUpperCase())}</h2>
            <em>${esc(g?.motto ?? '')}</em>
          </div>
          <div class="gh-master">
            <div class="gh-port"><canvas width="200" height="200"></canvas></div>
            <div class="gh-id"><small>${esc(seat ? 'MASTER OF THE HALL' : 'QUARTERMASTER')}</small><b>${esc(who?.name ?? '')}</b><span>${esc(who?.role ?? '')}</span></div>
          </div>
          <div class="gh-subs"></div>
          <div class="gh-rank"></div>
          <ol class="gh-ladder"></ol>
          <div class="gh-actions"></div>
          <div class="gh-rel"></div>
        </section>
        <section class="gh-main">
          <nav class="gh-nav"></nav>
          <div class="gh-body"></div>
          <div class="gh-log"></div>
        </section>
      </div>`;
    this.root = panel.querySelector('.gh')!;
    const cv = this.root.querySelector<HTMLCanvasElement>('.gh-port canvas')!;
    this.stage = { canvas: cv, c2d: cv.getContext('2d')! };
    this.subs = new Subtitles(this.root.querySelector('.gh-subs')!, 'dock');
    if (this.guild && who) void this.subs.say({ who: who.id, speaker: who.callsign, color: g!.color, text: greeting(world().state, this.guild), voice: true });
    // Screenshot mode: the greeting lands fully typed.
    if (q.get('shot') === '1') this.subs.skip();
    this.render();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.subs?.destroy();
    this.subs = null;
    getVoice().stopAll();
    rt?.saveNow();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const tabs = this.panels();
      const i = tabs.findIndex((p) => p.id === this.panel);
      this.panel = tabs[(i + (e.code === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length].id;
      this.sel = 0;
      getAudio().ui('move');
      this.render();
      return true;
    }
    return false;
  }

  // ── helpers ───────────────────────────────────────────────────────

  private l(): TradeLedger {
    return this.ctx.ledger();
  }

  private setL(l: TradeLedger): void {
    this.ctx.setLedger(l);
    rt!.scene.ledger = l;
  }

  private say(text: string, cls = ''): void {
    this.log.push({ text, cls });
    if (this.log.length > 3) this.log.shift();
    this.api.say(text, cls);
  }

  /** A voiced line from someone in the hall. */
  private speak(who: string, text: string): void {
    const c = rt!.scene.contracts.character(who);
    this.speaker = who;
    this.subs?.clear();
    void this.subs?.say({ who, speaker: c?.callsign ?? who.toUpperCase(), color: c?.commsColor ?? '#ffffff', text, voice: true });
  }

  private panels(): { id: Panel; label: string }[] {
    return this.mode === 'outpost' ? PANELS.filter((p) => p.id === 'outpost') : PANELS;
  }

  // ── rendering ─────────────────────────────────────────────────────

  private render(): void {
    const r = rt!;
    const w = world().state;
    const g = this.guild;
    const root = this.root;
    const gd = g ? GUILDS[g] : null;

    // Rank, merit bar, ladder.
    const rankEl = root.querySelector('.gh-rank')!;
    const ladder = root.querySelector('.gh-ladder')!;
    const actions = root.querySelector('.gh-actions')!;
    if (gd && g) {
      const p = rankProgress(w, g);
      const block = isMember(w, g) ? promotionBlock(w, g, this.l().rep) : null;
      rankEl.innerHTML = p.rank
        ? `<div class="row"><b>${esc(gd.ranks[p.rank - 1].name.toUpperCase())}</b><span>“${esc(titleIn(w, g))}”</span></div>
           <div class="bar"><i style="width:${Math.round(p.t * 100)}%"></i></div>
           <div class="row sub"><span>MERIT ${meritOf(w, g)}${p.to !== null ? ` / ${p.to}` : ''}</span><span>${p.to !== null ? `NEXT · ${esc(gd.ranks[p.rank].name.toUpperCase())}` : 'THE TOP OF THE LADDER'}</span></div>
           <div class="line">${esc(gd.ranks[p.rank - 1].line)}</div>`
        : `<div class="row"><b>NOT A MEMBER</b></div><div class="line">${esc(gd.blurb)}</div>`;
      ladder.innerHTML = gd.ranks
        .map((rk, i) => `<li class="${i + 1 === p.rank ? 'on' : i + 1 < p.rank ? 'past' : ''}"><em>${i + 1}</em><b>${esc(rk.name)}</b><span>${esc(rk.perk)}</span></li>`)
        .join('');
      const dues = duesOwed(w, g);
      const why = canJoin(w, g, this.l().rep);
      const btn = (act: string, label: string, on = true, cls = '') => `<button class="dock-btn ${cls}" data-act="${act}" ${on ? '' : 'disabled'}>${label}</button>`;
      const bits: string[] = [];
      if (!isMember(w, g)) bits.push(btn('join', 'PETITION TO JOIN', !why), why ? `<span class="why">${esc(why)}</span>` : '');
      else {
        bits.push(btn('promote', `PETITION FOR RANK${block ? '' : ' ★'}`, !block, block ? '' : 'hot'));
        if (block && block !== 'HIGHEST RANK') bits.push(`<span class="why">${esc(block)}</span>`);
        if (duesPeriods(w, g) > 0) {
          bits.push(btn('dues', `${gd.dues.label} — ${sh(dues)}`, this.l().credits >= dues));
          if (gd.dues.alt) bits.push(btn('dueskind', `PAY IN KIND (${gd.dues.alt.label.toUpperCase()})`, (this.l().cargo[gd.dues.alt.cid] ?? 0) >= gd.dues.alt.units));
        } else bits.push(`<span class="ok">${gd.dues.label} PAID · ${gd.dues.perRank * rankOf(w, g)} sh A PERIOD</span>`);
        // Keeping perk: the wardens patch your hull at a tithe.
        const wr = this.wardenRepair();
        if (wr) bits.push(btn('repair', `WARDENS’ REPAIR — ${sh(wr)}`, this.l().credits >= wr));
        bits.push(btn('leave', this.armLeave ? 'CONFIRM — LEAVE THE GUILD' : 'LEAVE', true, this.armLeave ? 'warn' : 'quiet'));
      }
      actions.innerHTML = bits.join('');
      actions.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act!)));
      // Relations with the other guilds.
      const rel = GUILD_IDS.filter((h) => h !== g && hostility(g, h) > 0).map((h) => `<span class="${isMember(w, h) ? 'hot' : ''}">${GUILDS[h].short} ${hostility(g, h) >= 0.35 ? 'HOSTILE' : 'WARY'}${isMember(w, h) ? ` · YOU: ${esc(GUILDS[h].ranks[rankOf(w, h) - 1].title.toUpperCase())}` : ''}</span>`);
      root.querySelector('.gh-rel')!.innerHTML = rel.length ? `<small>RIVALS</small> ${rel.join(' ')}` : '<small>RIVALS</small> <span>NEUTRAL IN EVERY QUARREL</span>';
    } else {
      rankEl.innerHTML = '';
      ladder.innerHTML = '';
      actions.innerHTML = '';
    }

    // Sub-panels.
    const nav = root.querySelector('.gh-nav')!;
    nav.innerHTML = this.panels()
      .map((p) => `<button data-p="${p.id}" class="${p.id === this.panel ? 'on' : ''}">${p.label}${p.id === 'arc' && g && pendingChoice(w, g) ? ' ★' : ''}</button>`)
      .join('');
    nav.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.panel = b.dataset.p as Panel;
        this.sel = 0;
        getAudio().ui('move');
        this.render();
      }),
    );
    const body = root.querySelector('.gh-body') as HTMLElement;
    if (this.panel === 'work') body.innerHTML = this.workHtml();
    else if (this.panel === 'qm') body.innerHTML = this.qmHtml();
    else if (this.panel === 'arc') body.innerHTML = this.arcHtml();
    else body.innerHTML = this.outpostHtml();
    body.querySelectorAll<HTMLElement>('[data-do]').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.do!, b.dataset.arg)));
    body.querySelectorAll<HTMLElement>('[data-sel]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel = Number(b.dataset.sel);
        this.render();
      }),
    );
    root.querySelector('.gh-log')!.innerHTML = this.log.map((m) => `<div class="${m.cls ?? ''}">› ${esc(m.text)}</div>`).join('');
    void r;
  }

  private workHtml(): string {
    const r = rt!;
    const g = this.guild!;
    const w = world().state;
    if (!isMember(w, g)) return `<div class="gh-empty">The ${esc(GUILDS[g].short)} gives its work to its own. Petition to join.</div>`;
    const offers = r.offers(g, this.ctx.station.id);
    const mine = r.scene.contracts.book.active.filter((k) => k.guild === g);
    const row = (k: Contract, i: number, accepted: boolean) => `
      <div class="gh-row${this.sel === i && !accepted ? ' sel' : ''}" data-sel="${accepted ? -1 : i}">
        <span class="kind">${KIND_LABEL[k.kind]}</span><span class="tier t${k.tier}">${TIER_LABEL[k.tier]}</span>
        <span class="title">${esc(k.title)}</span>
        <span class="fee">${sh(k.reward)}${k.grams ? ` + ${k.grams} g` : ''} <em>+${k.merit ?? 0} MERIT</em></span>
        ${accepted ? `<b class="st">${k.state === 'ready' ? 'RETURN FOR PAY' : 'ON YOUR BOOK'}</b>` : `<button class="dock-btn" data-do="accept" data-arg="${esc(k.id)}">ACCEPT</button>`}
      </div>`;
    const sel = offers[this.sel] ?? offers[0];
    return `
      <h3>${esc(GUILDS[g].short)} WORK <small>· MERIT, SHARES${g === 'rustwake' ? ' AND GRAMS' : ''}</small></h3>
      ${offers.length ? offers.map((k, i) => row(k, i, false)).join('') : '<div class="gh-empty">Nothing posted. The board turns over every ten minutes of flight.</div>'}
      ${mine.length ? `<h3>ON YOUR BOOK</h3>${mine.map((k) => row(k, -1, true)).join('')}` : ''}
      ${sel ? `<div class="gh-brief"><small>${esc(sel.originName.toUpperCase())} · ${sel.jumps ? `${sel.jumps} LANTERN${sel.jumps > 1 ? 'S' : ''} OUT` : 'THIS SYSTEM'}</small>${sel.brief.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}`;
  }

  private qmHtml(): string {
    const g = this.guild!;
    const w = world().state;
    const o = outfitter();
    if (!o) return '<div class="gh-empty">The quartermaster is at lunch.</div>';
    const rank = rankOf(w, g);
    const lines = stockFor(g, rank, o.hangar);
    return `
      <h3>QUARTERMASTER <small>· RELIC-GRADE ${MK_LABEL[5]} · ${rank ? `YOUR DISCOUNT ${Math.round(discount(rank) * 100)}%` : 'MEMBERS ONLY'}</small></h3>
      ${lines
        .map(
          (x) => `<div class="gh-row qm${x.lock || !rank ? ' locked' : ''}">
            <span class="kind">${esc(MAKERS[x.item.maker].short)}</span><span class="tier">${MK_LABEL[x.item.mk]}</span>
            <span class="title">${esc(x.item.name)}<small>${esc(itemLine(x.item))}</small></span>
            <span class="fee">${x.fitted ? 'FITTED' : sh(x.price)}<em>${x.slot ? `→ ${esc(x.slot.label.toUpperCase())}` : 'NO SLOT ON THIS HULL'}</em></span>
            ${x.lock ? `<b class="st lock">${esc(x.lock)}</b>` : `<button class="dock-btn" data-do="buy" data-arg="${x.item.id}" ${!rank || x.fitted || !x.slot || this.l().credits < x.price ? 'disabled' : ''}>BUY &amp; FIT</button>`}
          </div>`,
        )
        .join('')}
      <div class="gh-note">${esc(MAKERS[stockFor(g, 6, o.hangar)[0]?.item.maker ?? 'cloister'].blurb)} The old item goes back to the yard at half price.</div>`;
  }

  private arcHtml(): string {
    const r = rt!;
    const g = this.guild!;
    const w = world().state;
    const rows = arcState(w, g, r.episode(), r.activeArcs());
    const pending = pendingChoice(w, g);
    const label: Record<string, string> = { done: 'DONE', choice: 'ANSWER', active: 'ON YOUR BOOK', available: 'AVAILABLE', locked: 'LOCKED' };
    const sel = rows[this.sel] ?? rows[0];
    let card = '';
    if (pending?.choice) {
      const c = pending.choice;
      card = `<div class="gh-choice"><small>${esc(pending.title.toUpperCase())} · THE HALL ASKS</small><p>${esc(c.prompt)}</p>
        <div class="opts">${c.options.map((o) => `<button class="dock-btn big" data-do="choose" data-arg="${o.id}">${esc(o.label.toUpperCase())}</button>`).join('')}</div></div>`;
    } else if (sel) {
      const s = sel.step;
      card = `<div class="gh-brief"><small>STEP ${s.n} · ${KIND_LABEL[s.kind]} · ${esc(this.whereName(s))} · ${sh(s.reward)} · +${s.merit} MERIT</small>${s.brief.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}
        ${sel.status === 'available' ? `<button class="dock-btn big" data-do="arc" data-arg="${s.id}">TAKE IT ON</button>` : sel.status === 'locked' ? `<b class="st lock">${esc(sel.why ?? 'LOCKED')}</b>` : ''}
        ${s.choice ? '<div class="gh-note">This step ends in a choice with lasting consequences.</div>' : ''}</div>`;
    }
    // A pending choice is the whole point of the visit: it goes first.
    return `
      ${pending ? card : ''}
      <h3>${esc(GUILDS[g].short)} ARC</h3>
      ${rows
        .map(
          (x, i) => `<div class="gh-row arc ${x.status}${i === this.sel ? ' sel' : ''}" data-sel="${i}">
            <span class="kind">STEP ${x.step.n}</span><span class="tier">R${x.step.rank}</span>
            <span class="title">${esc(x.step.title)}<small>${esc(x.step.synopsis)}</small></span>
            <b class="st ${x.status}">${label[x.status]}</b>
          </div>`,
        )
        .join('')}
      ${pending ? '' : card}`;
  }

  private whereName(s: ArcStep): string {
    const sys = rt!.scene.contracts.reach.systems.find((x) => x.id === s.where.system);
    return (sys?.name ?? s.where.system).toUpperCase();
  }

  private outpostHtml(): string {
    const r = rt!;
    const w = world().state;
    const o = outpostOf(w);
    const desk = r.scene.contracts;
    if (!o) {
      const block = claimBlock(w);
      const g = this.guild;
      const sites = outpostSites(desk.reach, g ?? undefined);
      const from = r.scene.currentSystemId();
      const h = hops(desk.reach, from);
      sites.sort((a, b) => (h.get(a.system) ?? 99) - (h.get(b.system) ?? 99));
      return `
        <h3>OUTPOST <small>· CLAIM A HULK AS THE ${esc(g ? GUILDS[g].short : 'GUILD')}’S BASE</small></h3>
        <div class="gh-note">Dead hulks drift in the quiet systems — golden-age station hulls nobody has kept. At rank ${OUTPOST_RANK} a guild will back your claim. Restore it in stages with goods and shares: lights, a spinning ring and a berth, a market deck, a guild annex, guns on the rim. Raiders will notice.</div>
        ${block ? `<b class="st lock">${esc(block)}</b>` : ''}
        ${sites
          .slice(0, 6)
          .map(
            (s) => `<div class="gh-row"><span class="kind">${esc(s.systemName.toUpperCase())}</span><span class="tier">${h.get(s.system) ?? '?'} J</span>
              <span class="title">The ${esc(s.name)}<small>threat ${Math.round(s.threat * 100)}% · ${esc(s.faction)} space</small></span>
              <span class="fee">${sh(STAGES[0].shares)}</span>
              <button class="dock-btn" data-do="claim" data-arg="${s.id}" ${block || !g || rankOf(w, g) < OUTPOST_RANK || this.l().credits < STAGES[0].shares ? 'disabled' : ''}>CLAIM</button></div>`,
          )
          .join('')}`;
    }
    const need = nextNeeds(o);
    const atOutpost = rt!.isOutpost(this.ctx.station.id);
    const cargo = this.l().cargo;
    const stages = STAGES.map((s) => `<li class="${s.n <= o.stage ? 'past' : ''}${s.n === o.stage ? ' on' : ''}"><em>${s.n}</em><b>${esc(s.name)}</b><span>${s.services.length ? esc(s.services.join(' · ').toUpperCase()) : '—'}</span></li>`).join('');
    const store = Object.entries(o.store) as [CommodityId, number][];
    return `
      <h3>THE ${esc(o.name.toUpperCase())} <small>· ${esc(GUILDS[o.guild].short)} · ${esc(desk.sysName(o.site).toUpperCase())}${o.damaged ? ' · <span class="err">DAMAGED</span>' : ''}</small></h3>
      <ol class="gh-stages">${stages}</ol>
      ${
        need
          ? `<div class="gh-brief"><small>NEXT · ${esc(need.stage.name)}</small><p>${esc(need.stage.work)}</p>
            <p>STILL NEEDED: ${goodsLine(need.goods, cargo)} · ${sh(need.shares)}</p>
            <button class="dock-btn big" data-do="deliver" ${Object.keys(need.goods).some((c) => (cargo[c as CommodityId] ?? 0) > 0) ? '' : 'disabled'}>HAND OVER CARGO</button>
            <button class="dock-btn big hot" data-do="build" ${Object.keys(need.goods).length || this.l().credits < need.shares ? 'disabled' : ''}>${o.damaged ? 'PATCH THE HUB' : 'BUILD'} — ${sh(need.shares)}</button></div>`
          : '<div class="gh-note">Fully restored. The crews have started calling her home.</div>'
      }
      ${
        hasService(o, 'storage') && atOutpost
          ? `<h3>STORAGE LOCKER <small>· CARGO ${cargoUsed(this.l())}/${this.l().capacity}</small></h3>
            <div class="gh-store">${(Object.keys(COMMODITY) as CommodityId[])
              .filter((c) => (cargo[c] ?? 0) > 0 || (o.store[c] ?? 0) > 0)
              .map((c) => `<div><span>${esc(COMMODITY[c].name)}</span><em>HOLD ${cargo[c] ?? 0} · LOCKER ${o.store[c] ?? 0}</em><button class="dock-btn" data-do="stow" data-arg="${c}" ${(cargo[c] ?? 0) > 0 ? '' : 'disabled'}>STOW</button><button class="dock-btn" data-do="take" data-arg="${c}" ${(o.store[c] ?? 0) > 0 ? '' : 'disabled'}>TAKE</button></div>`)
              .join('') || '<div class="dim">Hold and locker both empty.</div>'}</div>`
          : hasService(o, 'storage')
            ? `<div class="gh-note">Storage locker aboard: ${store.length ? store.map(([c, n]) => `${n} × ${esc(COMMODITY[c].name.toLowerCase())}`).join(', ') : 'empty'}. Dock at the outpost to use it.</div>`
            : ''
      }
      <div class="gh-note">${o.stage >= 2 ? `Raiders know she is worth taking. ${o.stage >= 5 ? 'The rim guns hold two raids in three without you.' : 'Nothing defends her but you.'}` : 'Nobody raids a dead hulk. Yet.'}</div>`;
  }

  /** Keeping rank ≥ 2: hull repair at 85 % of the yard price (0 = not offered). */
  private wardenRepair(): number {
    if (this.guild !== 'keeping' || rankOf(world().state, 'keeping') < 2) return 0;
    const hull = this.ctx.hull();
    if (hull >= 1) return 0;
    return Math.ceil(repairCost(this.ctx.station, this.l(), hull, this.ctx.hullSize?.() ?? 1) * 0.85);
  }

  // ── actions ───────────────────────────────────────────────────────

  private act(a: string, arg?: string): void {
    const r = rt!;
    const g = this.guild;
    const w = world().state;
    const ok = () => getAudio().ui('confirm');
    const bad = () => getAudio().ui('error');
    if (a !== 'leave') this.armLeave = false;
    switch (a) {
      case 'join': {
        if (!g) break;
        const res = r.join(g);
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          ok();
          for (const n of res.notes) this.say(n.text, n.cls);
          this.speak(this.speaker, greeting(world().state, g));
        }
        break;
      }
      case 'promote': {
        if (!g) break;
        const res = r.promote(g);
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          ok();
          this.setL(r.ledger());
          for (const n of res.notes) this.say(n.text, n.cls);
          const rk = GUILDS[g].ranks[rankOf(world().state, g) - 1];
          this.speak(this.speaker, `${rk.line} Rise, ${rk.title}.`);
        }
        break;
      }
      case 'repair': {
        const cost = this.wardenRepair();
        if (!cost || this.l().credits < cost) {
          bad();
          break;
        }
        if (!this.ctx.commitRepair?.({ ...this.l(), credits: this.l().credits - cost }, 1)) {
          bad();
          this.say(SAVE_FAILURE, 'err');
          break;
        }
        ok();
        this.ctx.setHull(1);
        this.say(`HULL WHOLE — ${sh(cost)}. THE WARDENS SAID THE WORDS.`, 'ok');
        break;
      }
      case 'dues':
      case 'dueskind': {
        if (!g) break;
        const res = payDues(w, g, this.l(), a === 'dueskind');
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          ok();
          r.setWorld(res.world);
          this.setL(res.ledger);
          this.say(res.text, 'ok');
        }
        break;
      }
      case 'leave': {
        if (!g) break;
        if (!this.armLeave) {
          this.armLeave = true;
          break;
        }
        this.armLeave = false;
        const res = leave(w, g);
        r.apply(res, true);
        for (const n of res.notes) this.say(n.text, n.cls);
        this.speak(this.speaker, GUILDS[g].farewell);
        break;
      }
      case 'accept': {
        if (!g || !arg) break;
        const k = r.offers(g, this.ctx.station.id).find((x) => x.id === arg);
        if (!k) break;
        const err = r.scene.contracts.accept(k, { ledger: () => this.l(), setLedger: (l) => this.setL(l) });
        if (err) {
          bad();
          this.say(err, 'err');
        } else {
          ok();
          this.say(`GUILD WORK ACCEPTED · ${k.title.toUpperCase()}`, 'ok');
        }
        break;
      }
      case 'arc': {
        if (!arg) break;
        const k = r.arcContract(arg, this.ctx.station.id);
        if (!k) {
          bad();
          this.say('THAT WORK CANNOT BE FLOWN FROM HERE', 'err');
          break;
        }
        const err = r.scene.contracts.accept(k, { ledger: () => this.l(), setLedger: (l) => this.setL(l) });
        if (err) {
          bad();
          this.say(err, 'err');
        } else {
          ok();
          this.say(`ARC · ${k.title.toUpperCase()} · ON YOUR BOOK`, 'ok');
          this.speak(k.client, 'Then go. The hall will be here when you come back — make sure you are too.');
        }
        break;
      }
      case 'choose': {
        if (!g || !arg) break;
        const p = pendingChoice(w, g);
        if (!p) break;
        const res = choose(w, p.id, arg);
        if (res.error) {
          bad();
          this.say(res.error, 'err');
          break;
        }
        ok();
        r.apply(res, true);
        this.setL(r.ledger());
        for (const n of res.notes) this.say(n.text, n.cls);
        if (res.option) this.speak(res.option.who, res.option.line);
        break;
      }
      case 'buy': {
        const o = outfitter();
        if (!g || !arg || !o) break;
        const res = buyFromQuartermaster(o.hangar, this.l(), g, rankOf(w, g), arg, this.ctx.station);
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          if (o.commit(res)) {
            ok();
            this.say(res.message ?? 'FITTED', 'ok');
          } else {
            bad();
            this.say(SAVE_FAILURE, 'err');
          }
        }
        break;
      }
      case 'claim': {
        if (!g || !arg) break;
        const site = outpostSites(r.scene.contracts.reach, g).find((s) => s.id === arg);
        if (!site) break;
        const res = claim(w, this.l(), site, g);
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          ok();
          r.setWorld(res.world);
          this.setL(res.ledger);
          this.say(res.text, 'ok');
          this.speak(this.speaker, `The ${site.name}. Dead a long time. We will make her keep again — bring spares and relics, and she will see.`);
        }
        break;
      }
      case 'deliver': {
        const res = deliver(w, this.l());
        const moved = Object.entries(res.moved);
        if (!moved.length) {
          bad();
          this.say('NOTHING ABOARD THE CREWS NEED', 'err');
          break;
        }
        ok();
        r.setWorld(res.world);
        this.setL(res.ledger);
        this.say(`HANDED OVER · ${moved.map(([c, n]) => `${n} × ${COMMODITY[c as CommodityId].name.toUpperCase()}`).join(' · ')}`, 'ok');
        break;
      }
      case 'build': {
        const res = build(w, this.l());
        if (res.error) {
          bad();
          this.say(res.error, 'err');
        } else {
          ok();
          r.setWorld(res.world);
          this.setL(res.ledger);
          this.say(res.text, 'ok');
          const o = outpostOf(world().state);
          if (o) this.speak(GUILDS[o.guild].quartermaster, o.stage >= 5 ? 'Guns on the rim. Let them come.' : `${STAGES[o.stage].name.charAt(0)}${STAGES[o.stage].name.slice(1).toLowerCase()}. She is waking up.`);
        }
        break;
      }
      case 'stow':
      case 'take': {
        if (!arg) break;
        const res = stow(w, this.l(), arg as CommodityId, a === 'stow' ? (this.l().cargo[arg as CommodityId] ?? 0) : -99);
        if (!res.moved) {
          bad();
          break;
        }
        ok();
        r.setWorld(res.world);
        this.setL(res.ledger);
        this.say(`${a === 'stow' ? 'STOWED' : 'TAKEN ABOARD'} ${Math.abs(res.moved)} × ${COMMODITY[arg as CommodityId].name.toUpperCase()}`, 'ok');
        break;
      }
    }
    this.api.refresh();
    this.render();
  }

  private frame(dt: number): void {
    this.time += dt;
    this.subs?.update(dt);
    const talking = !!this.subs?.busy && !this.subs.typed;
    const who = rt?.scene.contracts.character(this.subs?.current?.who ?? this.speaker);
    if (this.stage && who) drawPortrait(this.stage.c2d, who.portrait, this.stage.canvas.width, this.stage.canvas.height, { talking, time: this.time, kind: 'human', tint: who.commsColor });
  }
}

let active: GuildTab | null = null;
for (const mode of ['hall', 'outpost'] as const) {
  const proto = new GuildTab(mode);
  registerDockTab({
    id: mode === 'hall' ? 'guild' : 'outpost',
    label: mode === 'hall' ? 'GUILD HALL' : 'OUTPOST',
    available: (ctx) => proto.available(ctx),
    mount(panel, ctx, api) {
      active = new GuildTab(mode);
      active.mount(panel, ctx, api);
    },
    onKey: (e) => active?.onKey(e) ?? false,
    unmount() {
      active?.unmount();
      active = null;
    },
  });
}
void MAX_RANK;
