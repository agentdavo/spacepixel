import './threads.css';
import { registerDockTab, type DockContext } from './DockScreen';
import { drawPortrait } from './Portrait';
import { personById } from '@/dialog/people';
import { ARCS, arcViews, resolveAt, type ArcView } from '@/game/npc/arcs';
import { ARC_JOB_LABEL, isArcContract } from '@/game/npc/arcContracts';
import { advanceNpcs, npcNow, npcWorld } from '@/game/npc/live';
import { recall } from '@/game/npc/memory';
import { RIVALS, rivalHideouts, rivalState, type Rival, type RivalState } from '@/game/rivals/rivals';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { fact } from '@/game/world/WorldState';
import { loadProfile } from '@/game/Profile';

/**
 * THREADS — a dock tab: the people whose lives are moving without you (NPC
 * arcs: where they were last seen, what they need, how it ended) and the
 * rivals who remember you (ship and tier, grudge meter, status, the last
 * thing they hold against you). Read-only; everything comes from the world
 * memory via src/game/npc/live.ts.
 *
 * Captures: ?dock=docked&docktab=threads[&npc=odile:shut,…][&rivalstate=…][&npcmemory=1]
 */
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const OUTCOME: Record<string, { tag: string; cls: string }> = {
  good: { tag: 'ENDED WELL', cls: 'good' },
  bad: { tag: 'ENDED BADLY', cls: 'bad' },
  missed: { tag: 'MISSED', cls: 'missed' },
};

const STATUS: Record<RivalState['status'], { tag: string; cls: string }> = {
  dormant: { tag: 'RUMOURED', cls: 'dim' },
  hunting: { tag: 'HUNTING YOU', cls: 'hot' },
  retreated: { tag: 'LICKING WOUNDS', cls: 'warm' },
  hiding: { tag: 'GONE TO GROUND', cls: 'warm' },
  dead: { tag: 'DEAD', cls: 'dead' },
  ally: { tag: 'ON YOUR WING', cls: 'good' },
  spared: { tag: 'SPARED · STOOD DOWN', cls: 'good' },
  jailed: { tag: 'TURNED IN', cls: 'dim' },
};

function ago(s: number): string {
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const h = s / 3600;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h ago`;
}

class ThreadsTab {
  private root: HTMLElement | null = null;

  mount(panel: HTMLElement, ctx: DockContext): void {
    const l = ctx.ledger();
    advanceNpcs(l.clock, loadProfile().episode);
    const w = npcWorld();
    const now = npcNow(l.clock);
    const stations = ctx.markets;
    const place = (at: readonly string[]) => {
      const s = resolveAt(at, stations);
      if (!s) return null;
      const sys = s.id.split('-')[0];
      return `${s.name}${s.name.toLowerCase().includes(sys) ? '' : ` · ${sys.toUpperCase()}`}`;
    };

    const views = arcViews(w);
    const open = views.filter((v) => !v.outcome);
    const closed = views.filter((v) => v.outcome);
    const unknown = ARCS.length - views.length;
    const arcCard = (v: ArcView) => {
      const host = personById(v.step.host ?? v.arc.person);
      const who = personById(v.arc.person);
      const where = v.step.at.length ? place(v.step.at) : null;
      const o = v.outcome ? OUTCOME[v.outcome] : null;
      const job = v.step.contract && isArcContract(v.step.contract) ? v.step.contract : null;
      const jobState = job ? fact(w, `contract.${job}`) : undefined;
      const jobTag = job && !o ? `<div class="th-job ${jobState === 'active' ? 'on' : jobState === 'ready' ? 'ready' : ''}">${jobState === 'active' ? 'ON YOUR BOOK' : jobState === 'ready' ? 'DONE — COLLECT' : 'JOB OFFERED'} · ${esc(ARC_JOB_LABEL[job])}</div>` : '';
      return `<article class="th-card ${o?.cls ?? 'open'}" style="--pc:${who?.color ?? '#7dffb2'}">
        <canvas width="64" height="64" data-portrait="${esc(v.arc.person)}"></canvas>
        <div>
          <header><b>${esc(who?.name ?? v.arc.person)}</b><em>${esc(v.arc.title.toUpperCase())}</em>${o ? `<i class="${o.cls}">${o.tag}</i>` : '<i class="open">OPEN</i>'}</header>
          <p>${esc(v.step.status)}</p>
          <small>${where ? `${host && host.id !== v.arc.person ? `ASK ${esc(host.callsign)} · ` : 'LAST SEEN · '}${esc(where.toUpperCase())}` : 'WHEREABOUTS UNKNOWN'} · ${ago(Math.max(0, now - v.since))}</small>
          ${jobTag}
        </div>
      </article>`;
    };

    const hide = new Map(rivalHideouts(w).map((h) => [h.rival.id, h.at]));
    const rivalCard = (r: Rival) => {
      const st = rivalState(w, r.id);
      const s = STATUS[st.status];
      const ship = r.ships[st.tier];
      const shipName = CATALOG_BY_ID[ship.blueprint]?.name ?? ship.blueprint.replace(/^[a-z]+-/, '').replace(/-/g, ' ');
      const mem = st.met || st.beaten ? recall(w, { about: r.id, only: ['rival.met', 'rival.beaten', 'rival.wing-down', 'rival.won', 'rival.killed', 'ambush.broken'] }) : null;
      const hideAt = hide.get(r.id);
      const where = hideAt ? place(hideAt) : null;
      const meter = Array.from({ length: 10 }, (_, i) => `<span class="${i < st.grudge ? 'on' : ''}"></span>`).join('');
      return `<article class="th-rival ${s.cls}" style="--pc:${r.color}">
        <canvas width="64" height="64" data-rival="${esc(r.id)}"></canvas>
        <div>
          <header><b>${esc(r.callsign)}</b><em>${esc(r.name)}</em><i class="${s.cls}">${s.tag}</i></header>
          <p class="th-ship">${esc(shipName.toUpperCase())} ${'◆'.repeat(st.tier + 1)}${'◇'.repeat(2 - st.tier)} · +${ship.wing.count} WING · ${esc(r.personality.toUpperCase())}</p>
          <div class="th-grudge"><small>GRUDGE</small><div class="th-meter">${meter}</div><small>${st.met ? `MET ×${st.met}` : 'NEVER MET'}${st.beaten ? ` · BEATEN ×${st.beaten}` : ''}${st.wins ? ` · BEAT YOU ×${st.wins}` : ''}</small></div>
          <p class="th-mem">${where ? `Word is they’re at ${esc(where)}. ` : ''}${mem ? `“${esc(mem.text)}”` : esc(r.blurb)}</p>
        </div>
      </article>`;
    };

    panel.innerHTML = `
      <div class="th">
        <section class="th-col">
          <h3>THREADS // PEOPLE WHOSE LIVES MOVED ON</h3>
          ${open.length ? open.map(arcCard).join('') : '<div class="th-empty">No open threads. People talk, if you let them — try the concourse.</div>'}
          ${closed.length ? `<h4>CLOSED</h4>${closed.map(arcCard).join('')}` : ''}
          ${unknown ? `<div class="th-empty">${unknown} more ${unknown === 1 ? 'story hasn’t' : 'stories haven’t'} started yet.</div>` : ''}
        </section>
        <section class="th-col">
          <h3>RIVALS // THEY REMEMBER YOU</h3>
          ${RIVALS.map(rivalCard).join('')}
        </section>
      </div>`;
    this.root = panel.querySelector('.th');
    // Portraits (static: a dossier, not a conversation).
    this.root?.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]').forEach((c) => {
      const p = personById(c.dataset.portrait!);
      if (p) drawPortrait(c.getContext('2d')!, p.portrait, c.width, c.height, { kind: 'human', tint: p.color, time: 0 });
    });
    this.root?.querySelectorAll<HTMLCanvasElement>('canvas[data-rival]').forEach((c) => {
      const r = RIVALS.find((x) => x.id === c.dataset.rival);
      if (!r) return;
      const st = rivalState(w, r.id);
      drawPortrait(c.getContext('2d')!, r.portrait, c.width, c.height, { kind: 'human', tint: r.color, time: 0, static: st.status === 'dormant' ? 0.55 : st.status === 'dead' ? 0.35 : 0 });
    });
  }

  unmount(): void {
    this.root = null;
  }
}

const tab = new ThreadsTab();
registerDockTab({
  id: 'threads',
  label: 'THREADS',
  mount: (panel, ctx) => tab.mount(panel, ctx),
  unmount: () => tab.unmount(),
});
