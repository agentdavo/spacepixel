import './concourse.css';
import { registerDockTab, type DockContext, type DockTabApi } from './DockScreen';
import { drawPortrait } from './Portrait';
import { Subtitles } from './Subtitles';
import { unlockCodexEntry } from './Codex';
import { CODEX } from '@/game/campaign/codex';
import { FACTION_LABEL, rumours, type TradeLedger } from '@/game/economy';
import { loadProfile } from '@/game/Profile';
import { describeSettings } from '@/game/Settings';
import { getAudio } from '@/audio';
import { CAST_VOICES, getVoice, npcVoice, registerVoice } from '@/audio/voice';
import { advance, begin, choicesAt, fill, offered, type ChoiceView } from '@/dialog/engine';
import { conversationsWith } from '@/dialog/conversations';
import { EXTRAS, GUESTS, hashStr, peopleAt, personById, type Person } from '@/dialog/people';
import { advanceNpcs, applyDialogFacts, dialogFacts, npcConversation, npcPlacement, npcVars } from '@/game/npc/live';
import { smallTalk } from '@/dialog/smalltalk';
import { dialogHooks, loadDialogState, saveDialogState } from '@/dialog/state';
import type { Conversation, DialogWorld, DFaction, DStationKind, Effect } from '@/dialog/types';

/**
 * CONCOURSE — the people at a station (a dock tab). Two to four faces:
 * recurring named people on their own schedules around the Reach, and locals
 * who rotate with the play clock. Pick someone and talk: branching,
 * data-driven conversations (src/dialog) voiced in person and subtitled,
 * with choices that can cost shares, move standing, trade cargo, unlock the
 * codex, fill the notebook with rumours and tips, or put contracts and hires
 * on the table for the systems that handle them (dialogHooks).
 *
 *   ↑↓ select · SPACE / → talk, choose, skip · ESC / ← leave · F7 voice · F8 subtitles · F9 日本語
 *
 * Captures: ?dock=docked&docktab=concourse[&talk=<person id>][&talkpath=0.2]
 */

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const MOOD_LABEL: Record<string, string> = {
  weary: 'WEARY',
  cheerful: 'CHEERFUL',
  suspicious: 'WARY',
  grieving: 'GRIEVING',
  devout: 'DEVOUT',
  mercenary: 'MERCENARY',
  nervous: 'NERVOUS',
  bored: 'BORED',
  hopeful: 'HOPEFUL',
  proud: 'PROUD',
  wry: 'WRY',
};
const FACTION_TAG: Record<string, string> = { ...FACTION_LABEL, none: 'UNALIGNED' };
const CODEX_TITLE = new Map(CODEX.map((c) => [c.id, c.title]));

/** Extra lore rumours the concourse can pass along (alongside the station ticker). */
const HEARSAY = [
  'The Anchorage beacon skipped a word last night. Service will resume — and then nothing, for eleven seconds.',
  'A Kestrel came off the line at Castellan with a core that will not accept a pilot name. They say it displays POINT.',
  'The Choir\'s drive crystals run warm near the Hesper Lantern. It has not opened since the Shattering. It still hums.',
  'The Ember has five winters left. The clans have said that for thirty winters.',
  'Someone on the Null picket swears the dead ring there is colder than space.',
  'Engine-wardens say you should never ask an engine why. A young one asked anyway, and was sent to count rivets for a year.',
  'The Board\'s ration algorithm has a line for "discretionary expenditure". Nobody has seen what it spends.',
];

interface Talk {
  conv: Conversation;
  node: string | null;
  person: Person;
  choices: ChoiceView[];
  sel: number;
  /** Line finished; choices showing. */
  ready: boolean;
}

class ConcourseTab {
  private ctx!: DockContext;
  private api!: DockTabApi;
  private root!: HTMLElement;
  private people: Person[] = [];
  private sel = 0;
  private talk: Talk | null = null;
  private subs: Subtitles | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private cards: { canvas: HTMLCanvasElement; c2d: CanvasRenderingContext2D }[] = [];
  private stage: { canvas: HTMLCanvasElement; c2d: CanvasRenderingContext2D } | null = null;
  private world: DialogWorld | null = null;
  private greeted = -1;
  /** Screenshot mode: lines appear fully typed (captures land mid-conversation). */
  private readonly instantText = new URLSearchParams(location.search).get('shot') === '1';

  mount(panel: HTMLElement, ctx: DockContext, api: DockTabApi): void {
    this.ctx = ctx;
    this.api = api;
    const l = ctx.ledger();
    const st = ctx.station;
    const stations = ctx.markets.map((m) => ({ id: m.id, faction: m.faction, kind: m.kind }));
    const episode = loadProfile().episode;
    // NPC arcs catch up with the world first: they decide who is standing here.
    advanceNpcs(l.clock, episode);
    const placed = npcPlacement(stations);
    this.people = peopleAt({ id: st.id, faction: st.faction, kind: st.kind }, stations, l.clock, episode, placed);
    // Captures / dev: ?talk=<id> brings a roster person here and opens the conversation.
    const q = new URLSearchParams(location.search);
    const want = q.get('talk');
    if (want && !this.people.some((p) => p.id === want)) {
      const p = personById(want);
      if (p) this.people.unshift(p);
    }
    for (const p of [...this.people, ...EXTRAS, ...GUESTS]) if (!CAST_VOICES[p.id]) registerVoice(p.id, npcVoice(hashStr(p.id), { ...p.voice, faction: p.faction }));

    panel.innerHTML = `
      <div class="cc">
        <section class="cc-people">
          <h3>CONCOURSE // ${esc(ctx.station.name.toUpperCase())}</h3>
          <div class="cc-list"></div>
          <div class="cc-note"><h4>NOTEBOOK</h4><div class="cc-note-body"></div></div>
        </section>
        <section class="cc-talk">
          <div class="cc-stage">
            <div class="cc-port"><canvas></canvas></div>
            <div class="cc-id"><small class="cc-fac"></small><b class="cc-name"></b><span class="cc-role"></span><span class="cc-mood"></span></div>
          </div>
          <div class="cc-subs"></div>
          <ol class="cc-choices"></ol>
          <div class="cc-log"></div>
          <div class="cc-keys">↑↓ SELECT · SPACE / → TALK · CHOOSE · ESC / ← LEAVE<br/><span class="cc-settings"></span></div>
        </section>
      </div>`;
    this.root = panel.querySelector('.cc')!;
    const list = this.root.querySelector('.cc-list')!;
    this.cards = [];
    this.people.forEach((p, i) => {
      const card = document.createElement('button');
      card.className = 'cc-card';
      card.style.setProperty('--pc', p.color);
      card.innerHTML = `<canvas width="72" height="72"></canvas><div><b>${esc(p.name)}</b><span>${esc(p.role)}</span><em>${FACTION_TAG[p.faction] ?? ''} · ${MOOD_LABEL[p.mood] ?? p.mood.toUpperCase()}${placed.get(p.id) === st.id ? ' · <i>THREAD</i>' : p.recurring ? ' · <i>REGULAR</i>' : ''}</em></div>`;
      card.addEventListener('click', () => {
        if (this.talk) return;
        this.select(i);
        this.startTalk();
      });
      card.addEventListener('pointerenter', () => !this.talk && this.select(i));
      list.append(card);
      const canvas = card.querySelector('canvas')!;
      this.cards.push({ canvas, c2d: canvas.getContext('2d')! });
    });
    const sc = this.root.querySelector<HTMLCanvasElement>('.cc-port canvas')!;
    sc.width = 200;
    sc.height = 200;
    this.stage = { canvas: sc, c2d: sc.getContext('2d')! };
    this.subs = new Subtitles(this.root.querySelector('.cc-subs')!, 'dock');
    this.root.querySelector('.cc-settings')!.textContent = describeSettings();
    this.sel = 0;
    this.select(want ? Math.max(0, this.people.findIndex((p) => p.id === want)) : 0, !want);
    this.renderNotebook();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if (want) {
      this.startTalk();
      const path = (q.get('talkpath') ?? '').split('.').filter(Boolean).map(Number);
      for (const i of path) this.choose(i);
    }
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.subs?.destroy();
    this.subs = null;
    this.talk = null;
    getVoice().stopAll();
  }

  onKey(e: KeyboardEvent): boolean {
    const k = e.code;
    if (this.talk) {
      const t = this.talk;
      if (k === 'Escape' || k === 'ArrowLeft' || k === 'Backspace') {
        this.endTalk('You step away.');
        return true;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        if (t.ready && t.choices.length) {
          const n = t.choices.length;
          t.sel = (t.sel + (k === 'ArrowUp' ? n - 1 : 1)) % n;
          this.renderChoices();
          getAudio().ui('move');
        }
        return true;
      }
      if (k === 'Space' || k === 'ArrowRight' || k === 'KeyT') {
        if (!t.ready) this.subs?.skip();
        else if (t.choices.length) this.choose(t.choices[t.sel].index);
        else this.step();
        return true;
      }
      return false;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const n = this.people.length;
      this.select((this.sel + (k === 'ArrowUp' ? n - 1 : 1)) % n);
      getAudio().ui('move');
      return true;
    }
    if (k === 'Space' || k === 'ArrowRight' || k === 'KeyT') {
      this.startTalk();
      return true;
    }
    return false;
  }

  // ── people ────────────────────────────────────────────────────────

  private select(i: number, greet = true): void {
    this.sel = i;
    this.cards.forEach((c, j) => c.canvas.parentElement!.classList.toggle('on', j === i));
    const p = this.people[i];
    if (!p) return;
    const r = this.root;
    r.style.setProperty('--pc', p.color);
    r.querySelector('.cc-fac')!.textContent = `${FACTION_TAG[p.faction] ?? ''}${p.recurring ? ' · REGULAR' : ''}`;
    r.querySelector('.cc-name')!.textContent = p.name;
    r.querySelector('.cc-role')!.textContent = p.role;
    r.querySelector('.cc-mood')!.textContent = MOOD_LABEL[p.mood] ?? '';
    this.renderChoices();
    if (greet && this.greeted !== i && !this.talk) {
      this.greeted = i;
      this.subs?.clear();
      void this.subs?.say({ who: p.id, speaker: p.callsign, color: p.color, text: p.greeting, voice: true });
    }
  }

  private worldNow(): DialogWorld {
    const l = this.ctx.ledger();
    const st = this.ctx.station;
    return {
      state: this.world?.state ?? loadDialogState(),
      ledger: { credits: l.credits, cargo: { ...l.cargo }, capacity: l.capacity, rep: { ...l.rep } },
      episode: loadProfile().episode,
      station: { id: st.id, faction: st.faction as DFaction, kind: st.kind as DStationKind },
      vars: this.vars(),
      ...dialogFacts(),
    };
  }

  private vars(): Record<string, string> {
    const p = this.people[this.sel];
    const l = this.ctx.ledger();
    const lines = rumours({ station: this.ctx.station, systemName: this.ctx.systemName, clock: l.clock, markets: this.ctx.markets, ledger: l, news: this.ctx.news?.() });
    const tip = lines.find((x) => x.startsWith('BAND TALK'))?.replace(/^BAND TALK:\s*/, '') ?? 'Nothing\'s moving much. Rations always sell somewhere hungry.';
    const pool = [...lines.filter((x) => !x.startsWith('BAND TALK') && !x.includes(' is long on ')), ...HEARSAY];
    const h = hashStr(`${p?.id ?? ''}:${Math.floor(l.clock / 300)}`);
    const rumour = pool[h % pool.length].replace(/^\(sung\)\s*/, '');
    return { station: this.ctx.station.name, system: this.ctx.systemName, callsign: loadProfile().callsign, tip, rumour: rumour.charAt(0) + rumour.slice(1), ...npcVars(p?.id ?? '', h) };
  }

  private conversationFor(p: Person, w: DialogWorld): Conversation {
    // A story first: the step of their arc (or a rival gone to ground).
    const story = npcConversation(p.id);
    if (story && offered(story, w)) return story;
    const named = conversationsWith(p.id)
      .filter((c) => offered(c, w))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return named[0] ?? smallTalk(p);
  }

  // ── conversation ──────────────────────────────────────────────────

  private startTalk(): void {
    const p = this.people[this.sel];
    if (!p || this.talk) return;
    getAudio().ui('confirm');
    this.world = this.worldNow();
    const conv = this.conversationFor(p, this.world);
    const s = begin(conv, this.world);
    this.apply(s.world, s.applied);
    this.talk = { conv, node: s.node, person: p, choices: [], sel: 0, ready: false };
    this.root.classList.add('talking');
    this.showNode();
  }

  private showNode(): void {
    const t = this.talk;
    if (!t || !this.world) return;
    if (!t.node) return this.endTalk();
    const n = t.conv.nodes[t.node];
    t.ready = false;
    t.choices = [];
    this.renderChoices();
    const self = n.who === 'self';
    const who = self ? null : (personById(n.who) ?? (n.who === t.person.id ? t.person : null));
    const text = fill(n.line, this.world.vars);
    this.subs?.clear();
    void this.subs
      ?.say({
        who: who?.id ?? n.who,
        speaker: self ? undefined : (who?.callsign ?? n.who.toUpperCase()),
        color: who?.color ?? t.person.color,
        text,
        jp: n.jp,
        voice: !self,
        sticky: !!n.choices?.length,
        minHold: self ? 2.4 : 0,
      })
      .then(() => {
        // Line cleared by itself (no choices): follow the conversation.
        if (this.talk === t && !t.ready && !n.choices?.length) this.step();
      });
    if (this.instantText) this.subs?.skip();
    this.watchReady();
  }

  /** Poll until the line has typed, then show the choices. */
  private watchReady(): void {
    const t = this.talk;
    if (!t || !t.node) return;
    const n = t.conv.nodes[t.node];
    if (!n.choices?.length) return;
    const check = () => {
      if (this.talk !== t || t.ready) return;
      if (this.subs?.typed) {
        t.ready = true;
        t.choices = choicesAt(t.conv, t.node!, this.world!);
        t.sel = Math.max(0, t.choices.findIndex((c) => c.available));
        this.renderChoices();
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  private step(): void {
    const t = this.talk;
    if (!t || !t.node || !this.world) return;
    const s = advance(t.conv, t.node, this.world);
    this.apply(s.world, s.applied);
    t.node = s.node;
    this.showNode();
  }

  private choose(index: number): void {
    const t = this.talk;
    if (!t || !t.node || !this.world) return;
    const n = t.conv.nodes[t.node];
    const c = n.choices?.[index];
    if (!c) return;
    const s = advance(t.conv, t.node, this.world, index);
    if (s.node === t.node && s.world === this.world) {
      getAudio().ui('error');
      return;
    }
    getAudio().ui('confirm');
    this.apply(s.world, s.applied);
    t.node = s.node;
    this.api.say(`“${c.text.replace(/\s*\(.*\)$/, '')}”`);
    if (!s.node) return this.endTalk();
    this.showNode();
  }

  private endTalk(msg?: string): void {
    const t = this.talk;
    this.talk = null;
    this.subs?.clear();
    this.root.classList.remove('talking');
    if (t && msg) this.api.say(msg);
    this.renderChoices();
  }

  /** Commit a step's world: ledger, dialog memory, codex, hooks, dock log. */
  private apply(w: DialogWorld, applied: Effect[]): void {
    const before = this.world;
    this.world = w;
    saveDialogState(w.state);
    if (!applied.length) return;
    const l = this.ctx.ledger();
    const next: TradeLedger = { ...l, credits: w.ledger.credits, cargo: { ...w.ledger.cargo }, rep: { ...l.rep, ...w.ledger.rep } };
    const changed = next.credits !== l.credits || JSON.stringify(next.cargo) !== JSON.stringify(l.cargo) || JSON.stringify(next.rep) !== JSON.stringify(l.rep);
    if (changed) {
      this.ctx.setLedger(next);
      this.api.refresh();
    }
    const stId = this.ctx.station.id;
    // World facts from the conversation: arcs and rivals react at once.
    const facts = applied.filter((e): e is Extract<Effect, { fact: string }> => 'fact' in e);
    if (facts.length) {
      const moves = applyDialogFacts(facts);
      this.world = { ...w, ...dialogFacts() };
      if (moves.length) this.api.say(`THREAD · ${moves[moves.length - 1].outcome ? 'CLOSED' : 'MOVED ON'} — SEE THREADS`, 'ok');
    }
    const say = this.api.say;
    const log: string[] = [];
    this.api = { ...this.api, say: (t, c) => (log.push(t), say(t, c)) };
    for (const e of applied) {
      dialogHooks.onEffect?.(e, stId);
      if ('credits' in e) this.api.say(`${e.credits > 0 ? 'RECEIVED' : 'PAID'} ${Math.abs(e.credits).toLocaleString('en-US')} sh`, 'ok');
      else if ('cargo' in e) this.api.say(`CARGO ${e.delta > 0 ? '+' : ''}${e.delta} ${e.cargo.toUpperCase()}`, 'ok');
      else if ('standing' in e) this.api.say(`STANDING · ${FACTION_LABEL[e.standing]} ${e.delta > 0 ? '+' : ''}${e.delta}`, e.delta > 0 ? 'ok' : 'err');
      else if ('codex' in e) {
        if (unlockCodexEntry(e.codex)) this.api.say(`CODEX UNLOCKED · ${(CODEX_TITLE.get(e.codex) ?? e.codex).toUpperCase()}`, 'ok');
      } else if ('rumour' in e || 'tip' in e) this.renderNotebook();
      else if ('contract' in e) {
        const r = dialogHooks.onContract?.(e.contract, stId);
        this.api.say(r ? r.text : `CONTRACT OFFERED · ${e.contract.toUpperCase()}`, r && !r.ok ? 'err' : 'ok');
        if (r) this.api.refresh();
      } else if ('recruit' in e) {
        const r = dialogHooks.onRecruit?.(e.recruit, stId);
        this.api.say(r ? r.text : `HIRE AVAILABLE · ${e.recruit.toUpperCase()}`, r && !r.ok ? 'err' : 'ok');
      }
    }
    void before;
    // Jobs booked through hooks write world facts too (contract.<key>): conditions should see them.
    if (applied.some((e) => 'contract' in e)) this.world = { ...this.world!, ...dialogFacts() };
    this.api = { ...this.api, say };
    if (log.length) this.root.querySelector('.cc-log')!.textContent = `› ${log.join(' · ')}`;
  }

  // ── rendering ─────────────────────────────────────────────────────

  private renderChoices(): void {
    const ol = this.root.querySelector('.cc-choices')!;
    const t = this.talk;
    if (!t) {
      const p = this.people[this.sel];
      ol.innerHTML = p ? `<li class="on idle"><b>▸</b> TALK TO ${esc(p.callsign)}</li>` : '';
      ol.querySelector('li')?.addEventListener('click', () => this.startTalk());
      return;
    }
    if (!t.ready) {
      ol.innerHTML = '';
      return;
    }
    if (!t.choices.length) {
      ol.innerHTML = `<li class="on idle"><b>▸</b> ${t.conv.nodes[t.node!]?.next ? 'CONTINUE' : 'END'}</li>`;
      ol.querySelector('li')?.addEventListener('click', () => this.step());
      return;
    }
    ol.innerHTML = t.choices
      .map((c, i) => `<li data-i="${i}" class="${i === t.sel ? 'on' : ''} ${c.available ? '' : 'locked'}"><b>${i === t.sel ? '▸' : ' '}</b>${esc(fill(c.choice.text, this.world?.vars))}${!c.available && c.choice.locked ? ` <small>${esc(c.choice.locked)}</small>` : ''}</li>`)
      .join('');
    ol.querySelectorAll<HTMLLIElement>('li').forEach((li) => {
      const i = Number(li.dataset.i);
      li.addEventListener('pointerenter', () => {
        if (this.talk && this.talk.sel !== i) {
          this.talk.sel = i;
          this.renderChoices();
        }
      });
      li.addEventListener('click', () => this.talk && this.choose(this.talk.choices[i].index));
    });
  }

  private renderNotebook(): void {
    const s = this.world?.state ?? loadDialogState();
    const items = [...s.tips.slice(-2).map((t) => ({ k: 'TIP', t })), ...s.rumours.slice(-3).map((t) => ({ k: 'HEARD', t }))];
    const body = this.root?.querySelector('.cc-note-body');
    if (!body) return;
    body.innerHTML = items.length ? items.map((x) => `<div><em>${x.k}</em> ${esc(x.t)}</div>`).join('') : '<div class="dim">Nothing yet. People talk, if you let them.</div>';
  }

  private frame(dt: number): void {
    this.time += dt;
    this.subs?.update(dt);
    const talking = !!this.subs?.busy && !this.subs.typed;
    const cur = this.subs?.current;
    const speaker = cur ? (this.people.find((p) => p.id === cur.who) ?? personById(cur.who)) : null;
    const shown = speaker ?? this.talk?.person ?? this.people[this.sel];
    if (this.stage && shown) {
      drawPortrait(this.stage.c2d, shown.portrait, this.stage.canvas.width, this.stage.canvas.height, { talking: talking && !!speaker, time: this.time, kind: 'human', tint: shown.color });
    }
    this.cards.forEach((c, i) => {
      const p = this.people[i];
      const live = talking && speaker?.id === p.id;
      drawPortrait(c.c2d, p.portrait, c.canvas.width, c.canvas.height, { talking: live, time: this.time + i * 1.7, kind: 'human', tint: p.color });
    });
  }
}

let tab: ConcourseTab | null = null;
registerDockTab({
  id: 'concourse',
  label: 'CONCOURSE',
  mount(panel, ctx, api) {
    tab = new ConcourseTab();
    tab.mount(panel, ctx, api);
  },
  onKey: (e) => tab?.onKey(e) ?? false,
  unmount() {
    tab?.unmount();
    tab = null;
  },
});
