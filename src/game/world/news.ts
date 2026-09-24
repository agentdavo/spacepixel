/**
 * What the Reach is talking about: dock-ticker headlines and concourse
 * rumours drawn from the world (chapter facts, the event log, the Schedule,
 * the Signal). Pure; DockScreen and Concourse pass the lines to
 * economy.rumours() as `news`.
 */
import { fact, type WorldEvent, type WorldState } from './WorldState.ts';
import { STORY_RULES, factRulesInForce, hashStr, lastEpisode, type ReachInfo } from './sim.ts';
import { currentSchedule, engagementStatus, FLOOR } from './schedule.ts';
import { fmtCount, signalState } from './signal.ts';

const COMMODITY_NAME: Record<string, string> = {
  ebon: 'Ebon-gas',
  relics: 'fossil relics',
  cores: 'reactor cores',
  spares: 'machine spares',
  rations: 'rations',
  munitions: 'munitions',
  medical: 'medical stores',
  luxury: 'luxuries',
};

function names(reach: ReachInfo) {
  const sys = new Map<string, string>();
  const st = new Map<string, string>();
  for (const s of reach.systems) {
    sys.set(s.id, s.name);
    for (const x of s.stations) st.set(x.id, x.name);
  }
  return { sys: (id: unknown) => sys.get(String(id)) ?? String(id), st: (id: unknown) => st.get(String(id)) ?? String(id) };
}

/** One event as a ticker line (null for events nobody talks about). */
export function eventLine(e: WorldEvent, reach: ReachInfo, w: WorldState): string | null {
  const n = names(reach);
  const d = e.data ?? {};
  const S = n.sys(d.sys);
  const known = !!fact(w, 'schedule.known');
  switch (e.kind) {
    case 'news':
      switch (d.k) {
        case 'convoy-lost':
          return `CONVOY LOST on the ${S} lanes. Raiders took two haulers and the escort's pride. Rations dearer there this week.`;
        case 'refinery-strike':
          return `REFINERY STRIKE at ${n.st(d.st)}: the skimmers want their grams on time. Ebon short until it's settled.`;
        case 'clan-feud':
          return `CLAN FEUD in ${S}: two holds not speaking, both shooting. Moot Watch patrols doubled; haulers keep their heads down.`;
        case 'ember-flare':
          return `The Ember flared at ${n.st(d.st)}. A fat skim: Ebon cheap there while it lasts.`;
        case 'relic-find':
          return `Scrapjacks cracked a golden-age hull near ${n.st(d.st)}. Relics going for scrap prices.`;
        case 'allocation':
          return `ALLOCATION HOUR: ${S} ration cards re-weighted. Rations eased, munitions quota up.`;
        case 'observance':
          return `(sung) An Observance in ${S}. The Measures fly the Treaty Line at half-throttle, singing.`;
        case 'medical-shortage':
          return `${n.st(d.st).toUpperCase()} short of medical stores. Burn gel paying double.`;
        case 'refugees':
          return `Another refugee convoy into ${S}, carrying what the Bastion's families could lift. Rations wanted.`;
        case 'joint-squad':
          return `Harriers and Cantors seen flying formation in ${S}. "That's the Schedule. They've stopped pretending."`;
        case 'lantern-hums':
          return `A dark Lantern near ${S} hummed on open bands last night. Survey crews are queueing.`;
      }
      return null;
    case 'schedule.fought':
      return known
        ? `ENGAGEMENT ${d.n} AT ${S.toUpperCase()}: expenditure within schedule. ${d.dir} and ${d.heg} fighters. ${d.ebon} g Ebon to market at the ${FLOOR} floor.`
        : `Border clash at ${S}: ${d.dir} Directorate fighters lost, ${d.heg} Choir. Ebon eased on the exchange floor, as it always does.`;
    case 'schedule.flown':
      return `ENGAGEMENT ${d.n} AT ${S.toUpperCase()} flown as ordered. The 13th came home on the forecast.`;
    case 'schedule.broken':
      return `ENGAGEMENT ${d.n} WAS DECISIVE. ${d.how === 'protected' ? 'Somebody killed the ship nobody was allowed to touch.' : 'A pilot refused the withdrawal order.'} Ebon spiking; Continuity asking for names.`;
    case 'lane.safe':
      return `Haulers are calling the ${S} run safe again. The Point cleared it — three ambushes broken.`;
    case 'lane.cleared':
      return d.saved ? `Raiders broken on the ${S} lanes by a Directorate pilot. The haulers are buying the rounds.` : null;
    case 'lane.lost':
      return `A hauler lost on the ${S} lanes. The bands are bolder there.`;
    case 'trade.dump':
      return `Somebody dumped ${d.units} lots of ${COMMODITY_NAME[String(d.cid)] ?? d.cid} at ${n.st(String(e.scope ?? '').replace(/^station:/, ''))}. The board there hasn't recovered.`;
    case 'trade.corner':
      return `Somebody bought ${n.st(String(e.scope ?? '').replace(/^station:/, ''))} out of ${COMMODITY_NAME[String(d.cid)] ?? d.cid}. Prices there are still climbing.`;
    case 'signal.burst':
      return typeof d.line === 'string' ? d.line : null;
    case 'kills':
      return `${String(d.faction).toUpperCase() === 'CHOIR' ? 'Choir' : String(d.faction) === 'rustwake' ? 'Clan' : 'Directorate'} pickets are hunting a pilot in ${S}. ${d.total} ships down.`;
  }
  return null;
}

/** The standing headline for the chapter the story has reached. */
export function chapterLine(w: WorldState): string | null {
  const ep = lastEpisode(w);
  for (let e = ep; e >= 1; e--) {
    const r = STORY_RULES.find((x) => x.ep === e);
    if (r && (r.mods.length || e === ep)) return r.news;
  }
  return null;
}

export interface NewsAt {
  sysId: string;
  stationId?: string;
}

/**
 * Up to `n` lines for a docked screen: the chapter headline, the Signal,
 * the next engagement, then recent events — local ones first. Stable within
 * a 5-minute bucket of the world clock.
 */
export function worldNews(w: WorldState, reach: ReachInfo, at: NewsAt, n = 3): string[] {
  const out: string[] = [];
  const head = chapterLine(w);
  if (head) out.push(head);
  // Guild choices that changed the Reach (the latest two).
  for (const r of factRulesInForce(w).slice(-2)) out.push(r.news);
  const sig = signalState(w);
  if (sig.count !== null) {
    out.push(
      sig.mode === 'stopped'
        ? 'NULL COUNT: 2. THE CLOCK HAS STOPPED.'
        : sig.mode === 'up'
          ? `NULL COUNT: ${fmtCount(sig.count)}. It is counting up.`
          : `NULL COUNT: ${fmtCount(sig.count)}${sig.breathDays !== null ? ` · the Breath in ${sig.breathDays} days` : ''}. ${sig.source === 'monolith' ? 'The Monolith is counting.' : 'Both Boards decline comment.'}`,
    );
  }
  const next = currentSchedule(w, reach).find((e) => engagementStatus(w, e) === 'upcoming' || engagementStatus(w, e) === 'open');
  if (next) out.push(`SCHEDULE: Engagement ${next.number}, ${next.systemName} — expected expenditure ${next.directorate} and ${next.hegemony}. The exchange floor has already priced it.`);
  const horizon = w.clock - 3 * 3600;
  const local: string[] = [];
  const far: string[] = [];
  for (let i = w.log.length - 1; i >= 0 && local.length + far.length < 12; i--) {
    const e = w.log[i];
    if (e.t < horizon) break;
    if (e.kind === 'signal.burst') continue; // the count line covers it
    const line = eventLine(e, reach, w);
    if (!line) continue;
    const here = e.scope === `system:${at.sysId}` || (at.stationId && e.scope === `station:${at.stationId}`);
    (here ? local : far).push(line);
  }
  const h = hashStr(`${at.stationId ?? at.sysId}:${Math.floor(w.clock / 300)}`);
  const pool = [...local, ...far];
  for (let k = 0; k < pool.length && out.length < n + 2; k++) {
    const line = k < local.length ? pool[k] : pool[local.length + ((h + k) % Math.max(1, far.length))];
    if (line && !out.includes(line)) out.push(line);
  }
  return out.slice(0, n + 2);
}
