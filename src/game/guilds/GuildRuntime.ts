import { Vector3 } from 'three';
import type { FlightScene } from '@/world/scenes/FlightScene';
import { COMMODITIES, cargoUsed, type EconFaction, type TradeLedger } from '@/game/economy';
import { loadProfile, saveContracts, saveLedger } from '@/game/Profile';
import { saveWorld, tick, world, type WorldState } from '@/game/world/WorldState';
import { registerVoice, npcVoice, CAST_VOICES } from '@/audio/voice';
import { findStation, type Contract, type Receipt } from '@/game/contracts/contracts';
import { SYSTEM_OFFSET } from '@/world/StarSystemView';
import { bindGuildTab } from '@/ui/GuildTab';
import { OutpostRuntime } from '@/game/outposts/OutpostRuntime';
import { claim, outpostOf, outpostStationId, siteById, STAGES } from '@/game/outposts/outposts';
import { GUILD_IDS, GUILD_VOICES, GUILDS, hallAt, type GuildId } from './guilds';
import { arcContract, arcOf, completeStep, pendingChoice } from './arcs';
import { guildOffers, GRAM_PRICE } from './board';
import { awardMerit, checkArrears, duesPeriods, isMember, join, promote, promotionBlock, rankOf, type GuildResult } from './membership';

/**
 * The flight scene's side of guilds: hooks the ContractDesk's receipts (guild
 * merit, clan grams, arc steps, outpost raids), keeps the world clock moving
 * when nothing else does, saves the world, checks dues, and serves the
 * GUILD HALL dock tab (src/ui/GuildTab.ts). All state is the shared
 * WorldState; the pure rules are membership.ts / arcs.ts / board.ts.
 */
export class GuildRuntime {
  readonly outposts: OutpostRuntime;
  /** Lines for the next dock log (settlements happen while berthing). */
  private notes: { text: string; cls?: string }[] = [];
  private lastClock = -1;
  private arrearsT = 0;
  private saveT = 0;
  private dirty = false;

  constructor(readonly scene: FlightScene) {
    for (const [id, v] of Object.entries(GUILD_VOICES)) if (!CAST_VOICES[id]) registerVoice(id, npcVoice(hash(id), { ...v, faction: this.factionOf(id) }));
    this.outposts = new OutpostRuntime(scene, (t, c) => this.note(t, c));
    scene.contracts.onReceipt.add((k, r) => this.onReceipt(k, r));
    world().on(() => (this.dirty = true));
    window.addEventListener('pagehide', () => saveWorld(world().state));
    bindGuildTab(this);
    // Membership captures apply before any ?dock= berth opens the hall.
    this.stageMembership();
  }

  private factionOf(id: string): string {
    const g = GUILD_IDS.find((x) => GUILDS[x].master === id || GUILDS[x].quartermaster === id);
    return g ? GUILDS[g].faction : id.startsWith('gd-') ? (['gd-wick', 'gd-tey', 'gd-breaker'].includes(id) ? 'rustwake' : id === 'gd-verity' || id === 'gd-casimir' ? 'choir' : 'concord') : 'concord';
  }

  note(text: string, cls?: string): void {
    this.notes.push({ text, cls });
    if (this.notes.length > 8) this.notes.shift();
    this.scene.contracts.toast(text, cls === 'err' ? '#ff5f7a' : '#7dffb2');
  }

  /** Apply a membership result: world, standing, notes. */
  apply(r: GuildResult): void {
    world().update(() => r.world);
    if (Object.keys(r.rep).length) {
      const l = this.scene.ledger;
      const rep = { ...l.rep };
      for (const [f, d] of Object.entries(r.rep) as [EconFaction, number][]) rep[f] = Math.max(-100, Math.min(100, rep[f] + d));
      this.setLedger({ ...l, rep });
    }
    for (const n of r.notes) this.notes.push({ text: n.text, cls: n.cls });
  }

  ledger(): TradeLedger {
    return this.scene.ledger;
  }

  setLedger(l: TradeLedger): void {
    this.scene.ledger = l;
    saveLedger(l);
  }

  /** The dock log lines gathered since the last berth (merit, grams, raids). */
  onDocked(stationId: string): { text: string; cls?: string }[] {
    const out = this.notes.splice(0);
    const w = world().state;
    const g = this.hallGuild(stationId);
    if (g && isMember(w, g)) {
      if (!promotionBlock(w, g, this.scene.ledger.rep)) out.push({ text: `${GUILDS[g].short}: A RANK AWAITS YOU IN THE HALL`, cls: 'ok' });
      if (duesPeriods(w, g) > 0) out.push({ text: `${GUILDS[g].short}: ${GUILDS[g].dues.label} OWED — SEE THE HALL`, cls: 'err' });
      if (pendingChoice(w, g)) out.push({ text: `${GUILDS[g].short}: THE HALL IS WAITING FOR YOUR ANSWER`, cls: 'ok' });
    }
    return out;
  }

  /** The guild whose hall (or outpost annex) is at this station. */
  hallGuild(stationId: string): GuildId | null {
    const o = outpostOf(world().state);
    if (o && stationId === outpostStationId(o.site)) return o.stage >= 4 && !o.damaged ? o.guild : null;
    const f = findStation(this.scene.contracts.reach, stationId);
    return f ? hallAt(f.station) : null;
  }

  isOutpost(stationId: string): boolean {
    const o = outpostOf(world().state);
    return !!o && stationId === outpostStationId(o.site);
  }

  episode(): number {
    return loadProfile().episode;
  }

  // ── receipts ──────────────────────────────────────────────────────

  private onReceipt(k: Contract, r: Receipt): void {
    this.outposts.onReceipt(k, r);
    const g = k.guild as GuildId | undefined;
    if (!g || !(g in GUILDS)) return;
    if (r.result === 'paid') {
      if (k.merit) this.apply(awardMerit(world().state, g, k.merit, k.arc ? `arc:${k.arc}` : `work:${k.kind}`));
      if (k.grams) this.payGrams(k.grams);
      if (k.arc) {
        world().update((w) => completeStep(w, k.arc!));
        const step = arcOf(g).find((s) => s.id === k.arc);
        if (step?.choice) this.note(`${GUILDS[g].short} · ${step.title.toUpperCase()} — THE HALL WAITS FOR YOUR ANSWER`, 'ok');
        else this.note(`${GUILDS[g].short} · ARC STEP COMPLETE · ${step?.title.toUpperCase() ?? ''}`, 'ok');
      }
    } else if (k.merit && r.result !== 'lapsed') {
      // The guild notices failure; it notices abandonment more.
      this.apply(awardMerit(world().state, g, -Math.round(k.merit * (r.result === 'abandoned' ? 0.6 : 0.4)), `failed:${k.kind}`));
    } else if (k.merit) this.apply(awardMerit(world().state, g, -Math.round(k.merit * 0.3), 'lapsed'));
  }

  /** Clan pay: Ebon in 10 g flasks, into the hold if there's room, else at the Schedule floor. */
  private payGrams(grams: number): void {
    const flasks = Math.round(grams / 10);
    const l = this.scene.ledger;
    const room = Math.max(0, l.capacity - cargoUsed(l));
    const put = Math.min(room, flasks);
    const cash = (flasks - put) * 10 * GRAM_PRICE;
    this.setLedger({ ...l, credits: l.credits + cash, cargo: { ...l.cargo, ebon: (l.cargo.ebon ?? 0) + put } });
    this.notes.push({ text: `THE MOOT PAYS IN GAS · ${put * 10} g ABOARD${cash ? ` · ${cash.toLocaleString('en-US')} sh FOR WHAT WOULDN'T FIT` : ''}`, cls: 'ok' });
  }

  // ── frame ─────────────────────────────────────────────────────────

  update(dt: number, time: number): void {
    // The world clock: if nothing else advanced it since last frame, we do.
    const w = world().state;
    if (dt > 0 && (this.lastClock < 0 || w.clock === this.lastClock)) world().update((x) => tick(x, dt));
    this.lastClock = world().state.clock;
    this.outposts.update(dt, time);
    this.arrearsT += dt;
    if (this.arrearsT > 10) {
      this.arrearsT = 0;
      const r = checkArrears(world().state);
      if (r.notes.length) {
        this.apply(r);
        for (const n of r.notes) this.scene.contracts.toast(n.text, '#ff5f7a');
      }
    }
    this.saveT += dt;
    if (this.dirty && this.saveT > 5) {
      this.saveT = 0;
      this.dirty = false;
      saveWorld(world().state);
    }
  }

  // ── hall actions (the dock tab calls these) ───────────────────────

  offers(g: GuildId, stationId: string): Contract[] {
    const desk = this.scene.contracts;
    const w = world().state;
    const list = guildOffers({
      reach: desk.reach,
      station: stationId,
      clock: desk.book.clock,
      rep: this.scene.ledger.rep,
      tier: desk.tier(),
      goods: COMMODITIES,
      guild: g,
      rank: rankOf(w, g),
    });
    return list.filter((k) => !desk.book.seen.includes(k.id) && !desk.book.active.some((a) => a.id === k.id));
  }

  arcContract(stepId: string, stationId: string): Contract | null {
    const desk = this.scene.contracts;
    return arcContract(stepId, { reach: desk.reach, station: stationId, clock: desk.book.clock });
  }

  /** Arc ids on the book right now. */
  activeArcs(): string[] {
    return this.scene.contracts.book.active.filter((k) => k.arc).map((k) => k.arc!);
  }

  join(g: GuildId): GuildResult {
    const r = join(world().state, g, this.scene.ledger.rep);
    if (!r.error) this.apply(r);
    return r;
  }

  promote(g: GuildId): GuildResult {
    const r = promote(world().state, g, this.scene.ledger.rep);
    if (!r.error) this.apply(r);
    return r;
  }

  saveNow(): void {
    saveWorld(world().state);
    saveContracts(this.scene.contracts.book);
  }

  // ── captures ──────────────────────────────────────────────────────

  /**
   * ?guild=<id>:<rank>[:<merit>] — membership for captures (several, comma-separated).
   * ?outpost=<stage>[&osite=<system>][&ophase=fly|docked][&odamaged=1] — an outpost at
   * that restoration stage in `osite` (default: the quietest system), with the
   * pilot flying past it or berthed in it.
   */
  private stageMembership(): void {
    const q = new URLSearchParams(location.search);
    const gq = q.get('guild');
    const s = this.scene;
    if (gq) {
      let w: WorldState = world().state;
      for (const part of gq.split(',')) {
        const [id, rk, mr] = part.split(':');
        if (!(id in GUILDS)) continue;
        const g = id as GuildId;
        const rank = Math.max(1, Math.min(6, Number(rk) || 1));
        w = { ...w, facts: { ...w.facts, [`guild.${g}.rank`]: String(rank), [`guild.${g}.title`]: GUILDS[g].ranks[rank - 1].title }, counters: { ...w.counters, [`guild.${g}.merit`]: Number(mr) || Math.round(GUILDS[g].ranks[rank - 1].merit + 60), [`guild.${g}.duesAt`]: w.clock } };
        if (q.get('arcdone')) for (let n = 1; n <= Number(q.get('arcdone')); n++) w = { ...w, facts: { ...w.facts, [`arc.${g}.${n}`]: true } };
        if (q.get('choice')) w = { ...w, facts: { ...w.facts, [`arc.${g}.pending`]: arcOf(g)[3].id, [`arc.${g}.1`]: true, [`arc.${g}.2`]: true, [`arc.${g}.3`]: true, [`arc.${g}.4`]: true } };
      }
      world().update(() => w);
      s.ledger = { ...s.ledger, credits: Math.max(s.ledger.credits, 24_000), rep: { concord: 40, choir: 30, rustwake: 20 } };
    }
  }

  stageFromQuery(): void {
    const q = new URLSearchParams(location.search);
    const gq = q.get('guild');
    const s = this.scene;
    const oq = q.get('outpost');
    if (oq === null) return;
    const stage = Math.max(0, Math.min(STAGES.length - 1, Number(oq) || 0));
    const desk = s.contracts;
    const siteId = q.get('osite') ?? 'anchorage';
    const site = siteById(desk.reach, siteId);
    if (!site) return;
    let w: WorldState = world().state;
    if (!outpostOf(w)) {
      const g: GuildId = (gq?.split(':')[0] as GuildId) || 'keeping';
      w = { ...w, facts: { ...w.facts, [`guild.${g}.rank`]: w.facts[`guild.${g}.rank`] ?? '3' } };
      w = claim(w, { ...s.ledger, credits: 1e6 }, site, g).world;
    }
    w = { ...w, counters: { ...w.counters, 'outpost.stage': stage }, facts: { ...w.facts, 'outpost.damaged': q.get('odamaged') === '1' } };
    world().update(() => w);
    s.warpTo(site.system);
    s.quiet();
    this.outposts.sync();
    if (q.get('ophase') === 'docked' && stage >= 2) {
      s.berthAt(outpostStationId(site.id), 0.8);
      return;
    }
    // Fly past it: 2.6 km off its quarter, the hulk filling the right of frame.
    const c = new Vector3(...site.pos).add(SYSTEM_OFFSET);
    const ax = new Vector3(...site.axis);
    const side = new Vector3(0, 1, 0).cross(ax).normalize();
    const pos = c.clone().addScaledVector(ax, 2400).addScaledVector(side, -1500).add(new Vector3(0, 450, 0));
    const aim = c.clone().addScaledVector(side, -700);
    s.placePlayer(pos, aim.sub(pos).normalize(), 40);
  }
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
