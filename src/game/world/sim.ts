/**
 * The world simulation (batch 5 · item 4): what turns story facts, player
 * actions and slow background drift into lasting changes in the Reach, and
 * the readers the economy, traffic, docking and contract boards apply.
 *
 * Everything is a pure function of a WorldState (src/game/world/WorldState.ts)
 * and a small ReachInfo (ids, names, stations) — no DOM, no three, no
 * Math.random: every roll is a hash of (seed, clock slot), so two machines
 * with the same world see the same Reach (MP-0 determinism).
 *
 * Channels (per scope: `system:<id>`, `system:*` = the whole Reach,
 * `station:<id>`, `faction:<f>`, `guild:<id>`):
 *
 *   price:<commodity>  fractional price offset (+0.2 = 20 % dearer)
 *   traffic            fractional sailings offset (+0.3 = 30 % more)
 *   piracy             additive raid rate per hauler sailing (base 0–0.2)
 *   patrol             fractional patrol-sailing offset
 *   attitude           −1..1 how a station / faction regards the pilot
 *
 * Two sources feed every channel:
 *   1. Story (lasting): derived at read time from `story.ep<N>.done` facts
 *      through STORY_RULES — never decays, never stored as a mod, so a
 *      player nudge on the same channel can't wash it out.
 *   2. Dynamic (decaying): `nudge`d mods written by player actions,
 *      background news and the Schedule; they decay back to 0.
 *
 * Other systems read through `worldMod` / `sysMod` (both sources), never
 * `mod` directly, so the chapter state shows everywhere.
 */
import type { CommodityId, EconFaction } from '../economy.ts';
import { bump, counter, fact, mod, nudge, record, setFact, type WorldEvent, type WorldScope, type WorldState } from './WorldState.ts';
import { lastEpisode } from './signal.ts';

// ── The Reach as the simulation sees it ─────────────────────────────────

export interface ReachStationInfo {
  id: string;
  name: string;
  kind: string;
  faction: EconFaction;
}
export interface ReachSystemInfo {
  id: string;
  name: string;
  faction: string;
  threat: number;
  stations: ReachStationInfo[];
  gates: string[];
}
export interface ReachInfo {
  seed: number;
  systems: ReachSystemInfo[];
}

/** Stable 32-bit hash (FNV-1a). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Deterministic 0..1 from a key and a sub-roll index. */
export function roll(key: string, n = 0): number {
  let h = hashStr(`${key}#${n}`);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function pickOf<T>(list: readonly T[], u: number): T | undefined {
  return list.length ? list[Math.min(list.length - 1, Math.floor(u * list.length))] : undefined;
}

const REACH: WorldScope = 'system:*';
export const sysScope = (id: string): WorldScope => `system:${id}`;
export const stationScope = (id: string): WorldScope => `station:${id}`;

// ── 1. Story facts → lasting changes ────────────────────────────────────

export interface StoryEffect {
  scope: WorldScope;
  channel: string;
  by: number;
}
export interface StoryRule {
  ep: number;
  /** Chapter facts set on completion (besides `story.ep<N>.done`). */
  facts: string[];
  /** Lasting modifiers while the episode stands completed. */
  mods: StoryEffect[];
  /** The dock-ticker headline this chapter leaves behind. */
  news: string;
}

const fx = (scope: WorldScope, channel: string, by: number): StoryEffect => ({ scope, channel, by });

/**
 * What each episode changes in the sandbox (docs/CAMPAIGN.md). Only
 * episodes that leave a mark on prices, lanes or doors carry mods; every
 * one leaves a headline.
 */
export const STORY_RULES: readonly StoryRule[] = [
  { ep: 1, facts: [], mods: [], news: 'Anchorage timetable beacon logs a reply from a Kestrel core. The wardens say it was an echo.' },
  { ep: 2, facts: [], mods: [], news: 'A stalled barge relit on the Seventh Keeping. The Cloister is taking bookings for blessings.' },
  { ep: 3, facts: ['psalm.met'], mods: [], news: 'A Cantor sang on the Treaty Line and nobody fired. Continuity is transcribing the intervals.' },
  {
    ep: 4,
    facts: ['ebon.shells'],
    mods: [fx('system:rustwake', 'price:ebon', 0.06)],
    news: 'Three shell accounts deep: Rustwake Ebon traced to the Zenith Treasury. The clans raise their price on principle.',
  },
  {
    ep: 5,
    facts: ['signal.heard'],
    mods: [fx('system:null', 'traffic', -0.3), fx('system:null', 'patrol', 0.5)],
    news: 'NULL PICKETS DOUBLED. Both Boards decline comment on "routine instrument noise".',
  },
  {
    ep: 6,
    facts: ['border.skirmish'],
    mods: [fx('system:zephacis', 'patrol', 0.4), fx('system:zephacis', 'traffic', -0.15), fx('system:zephacis', 'price:munitions', 0.12)],
    news: 'Zephacis border skirmish: convoys rerouted, munitions short on the ringed giant.',
  },
  { ep: 7, facts: ['coordinates.stolen'], mods: [fx('guild:continuity', 'attitude', -0.1)], news: 'A cruiser\'s black box is missing from the Counting House evidence locker. Continuity is asking pilots questions.' },
  {
    ep: 8,
    facts: ['schedule.known'],
    mods: [fx('system:lysowick', 'traffic', -0.2), fx('system:lysowick', 'price:spares', 0.1)],
    news: 'Engagement 114 at Lysowick: "expenditure within schedule". Somebody on the exchange floor asked whose schedule.',
  },
  { ep: 9, facts: ['patience.found'], mods: [fx('system:corouhold', 'patrol', 0.3), fx('system:corouhold', 'piracy', 0.06)], news: 'Choir hunters seen in Corouhold\'s radiation belts, following a map of their own.' },
  {
    ep: 10,
    facts: ['bastion.fallen'],
    mods: [
      // Refugees: the home fleet's families, the yards' crews.
      fx('system:anchorage', 'price:rations', 0.28),
      fx('system:anchorage', 'price:medical', 0.32),
      fx('system:anchorage', 'traffic', 0.35),
      fx('system:anchorage', 'patrol', -0.4),
      fx('system:anchorage', 'piracy', 0.08),
      fx('system:meridian', 'price:medical', 0.12),
      fx(REACH, 'price:munitions', 0.08),
    ],
    news: 'THE BASTION IS LOST. Refugee convoys crowd the Anchorage lanes; rations and medical stores wanted at any price.',
  },
  {
    ep: 11,
    facts: ['vanguard.nomads'],
    mods: [fx('faction:concord', 'attitude', -0.15), fx('faction:rustwake', 'attitude', 0.2)],
    news: 'The 13th Squadron is listed MISSING, PRESUMED EXPENDED. The clans say otherwise, loudly, in grams.',
  },
  { ep: 12, facts: ['monolith.found'], mods: [], news: 'Survey buoys at the rim report a reflection that moves a second late. The Choir calls it witnessed.' },
  { ep: 13, facts: ['oracle.heard'], mods: [fx('system:null', 'traffic', -0.2)], news: 'The Signal is a clock. Pilots are doing the arithmetic on the backs of ration cards.' },
  {
    ep: 14,
    facts: ['schism', 'rot.open'],
    mods: [
      // Tessaly's fields are contested; the joint hunter squads fly in the open.
      fx('system:tessaly', 'piracy', 0.14),
      fx('system:tessaly', 'patrol', 0.35),
      fx('system:tessaly', 'price:ebon', 0.18),
      fx('system:rustwake', 'traffic', 0.2),
      fx(REACH, 'price:ebon', 0.05),
    ],
    news: 'Directorate Harriers flying formation with Treasury Cantors. Tessaly field quotas suspended; tankers run in convoy.',
  },
  { ep: 15, facts: ['nexus.siege'], mods: [fx(REACH, 'price:munitions', 0.06)], news: 'Every yard in the Reach is short of munitions. Nobody will say where they went.' },
  { ep: 16, facts: ['pilgrimage'], mods: [], news: 'The Hesper Lantern, sealed since the Shattering, opened for four minutes. The Spire denies it.' },
  { ep: 17, facts: ['zenith.revealed'], mods: [fx('faction:choir', 'attitude', 0.2)], news: 'Cantors on open bands asking a question instead of singing. The Measures fly at half strength.' },
  {
    ep: 18,
    facts: ['schedule.read', 'ebon.floor.lifted'],
    mods: [fx('guild:continuity', 'attitude', 0.45), fx(REACH, 'price:munitions', -0.1)],
    news: 'THE SCHEDULE READ ALOUD on the Allocation Hour. Engagement 131: expected expenditure 4,112. The Board is in session.',
  },
  {
    ep: 19,
    facts: ['gates.aligned', 'lantern.toll.free'],
    mods: [
      // An aligned Lantern needs no fuel: it drinks the Breath.
      fx(REACH, 'price:ebon', -0.7),
      fx(REACH, 'traffic', 0.35),
      fx(REACH, 'price:relics', 0.2),
      fx(REACH, 'price:luxury', 0.12),
      fx('system:tessaly', 'price:ebon', -0.18),
    ],
    news: 'SIX OF SIX LANTERNS IN TUNE. Ebon trades for the price of its flask. Relic buyers want timetables — the old routes are coming back.',
  },
  { ep: 20, facts: ['horizon.open'], mods: [fx('system:null', 'traffic', 1.2), fx('system:null', 'patrol', -0.5)], news: 'The Null Lantern is lit. Clan Marsh is first in line. DESTINATION NOT YET SCHEDULED.' },
];

const RULE_BY_EP = new Map(STORY_RULES.map((r) => [r.ep, r]));

/**
 * Lasting changes from guild arc choices (src/game/guilds/arcs.ts writes the
 * facts): a fact (optionally with a value) → modifiers + a headline. Derived
 * at read time like STORY_RULES.
 */
export interface FactRule {
  fact: string;
  is?: string | boolean;
  mods: StoryEffect[];
  news: string;
}
export const FACT_RULES: readonly FactRule[] = [
  {
    fact: 'keeping.core',
    is: 'sealed',
    mods: [fx('guild:keeping', 'attitude', 0.3), fx('guild:continuity', 'attitude', -0.1)],
    news: 'The Cloister has sealed a golden-age core beside Hollis Marrow\'s reactors. The wardens will not say what it was.',
  },
  {
    fact: 'keeping.core',
    is: 'opened',
    mods: [fx('guild:continuity', 'attitude', 0.15), fx('guild:keeping', 'attitude', -0.3), fx(REACH, 'price:cores', 0.08)],
    news: 'The Office of Continuity opened a sealed core. Every warden in the Reach has stopped speaking to its inspectors; sealed cores are dearer for it.',
  },
  { fact: 'continuity.ledger', is: 'filed', mods: [fx('guild:continuity', 'attitude', 0.15)], news: 'Engagement 114\'s ledger filed and forgotten. Continuity thanks its case officers for their discretion.' },
  {
    fact: 'schedule.leaked',
    mods: [fx(REACH, 'price:ebon', 0.12), fx(REACH, 'price:munitions', 0.06), fx('guild:continuity', 'attitude', -0.4), fx('faction:rustwake', 'attitude', 0.15), fx('system:lysowick', 'traffic', -0.15)],
    news: 'CHANNEL NINE: "Engagement 114 — eleven fighters, budgeted like fuel." The exchange floor is pricing a war it can no longer see coming.',
  },
  { fact: 'allocation.quota', is: 'delivered', mods: [fx('faction:choir', 'attitude', 0.05)], news: 'Quota Night: expenditure within schedule. The Treasury received its grams on the minute.' },
  {
    fact: 'anchorage.fed',
    // Diverted grams ease the refugee demand the Bastion's fall put on Anchorage.
    mods: [fx('system:anchorage', 'price:rations', -0.2), fx('system:anchorage', 'price:medical', -0.12), fx('system:anchorage', 'attitude', 0.25)],
    news: 'Forty kilograms to the Anchorage ration line. Nobody starves there this winter. Nobody says whose grams.',
  },
  { fact: 'rustwake.seam', is: 'tey', mods: [fx('system:rustwake', 'price:ebon', -0.08), fx('faction:concord', 'attitude', 0.03)], news: 'Clan Tey holds the Ember\'s last seam: Ebon cheap at the Tey works for five winters. The real five.' },
  {
    fact: 'rustwake.seam',
    is: 'breakers',
    mods: [fx('system:rustwake', 'price:relics', -0.12), fx('system:rustwake', 'price:spares', -0.08), fx('system:rustwake', 'piracy', -0.04)],
    news: 'The Graveyard Breakers hold the Ember seam. Their yards pay in gas and sell wrecks cheap.',
  },
  {
    fact: 'player.defected',
    // Directorate patrols treat the pilot as hostile (traffic reader `hostilePatrol`).
    mods: [fx('faction:concord', 'attitude', -0.45), fx('faction:choir', 'attitude', 0.35), fx(REACH, 'patrol', 0.1)],
    news: 'A Directorate pilot took the Oath of House Casimir. Directorate pickets are logging a Kestrel under a Cantor\'s name.',
  },
];

/** Guild-choice rules in force (fact present, value matching). */
export function factRulesInForce(w: WorldState): FactRule[] {
  return FACT_RULES.filter((r) => {
    const v = fact(w, r.fact);
    return r.is === undefined ? !!v : v === r.is;
  });
}

/** Directorate patrols hunt a pilot who took a House's oath. */
export function hostilePatrol(w: WorldState, flag: string): boolean {
  return flag === 'concord' && !!fact(w, 'player.defected');
}

/** Facts the dev query / captures and tests fast-forward. */
export function storyFacts(ep: number): string[] {
  return [`story.ep${ep}.done`, ...(RULE_BY_EP.get(ep)?.facts ?? [])];
}

/**
 * An episode completed: write its facts, anchor the Signal clock, record the
 * event. Idempotent (a replayed episode changes nothing).
 */
export function completeEpisode(w: WorldState, ep: number): WorldState {
  if (fact(w, `story.ep${ep}.done`)) return w;
  const before = lastEpisode(w);
  let n = w;
  for (const f of storyFacts(ep)) n = setFact(n, f);
  // The Signal count re-anchors to the newest debrief.
  if (ep > before) n = { ...n, counters: { ...n.counters, 'signal.anchor': n.clock } };
  n = record(n, 'story', undefined, { ep });
  return n;
}

/** Old careers (profile.episode) and captures: every episode below `nextEpisode` completed. */
export function backfillStory(w: WorldState, nextEpisode: number): WorldState {
  let n = w;
  for (let e = 1; e < Math.min(21, nextEpisode); e++) n = completeEpisode(n, e);
  return n;
}

let storyCache: { facts: WorldState['facts']; mods: Map<string, number> } | null = null;

/** Lasting story modifier on (scope, channel), derived from completed episodes. */
export function storyMod(w: WorldState, scope: WorldScope, channel: string): number {
  if (storyCache?.facts !== w.facts) {
    const mods = new Map<string, number>();
    const add = (m: StoryEffect) => mods.set(`${m.scope}|${m.channel}`, (mods.get(`${m.scope}|${m.channel}`) ?? 0) + m.by);
    for (const r of STORY_RULES) if (fact(w, `story.ep${r.ep}.done`)) r.mods.forEach(add);
    for (const r of factRulesInForce(w)) r.mods.forEach(add);
    storyCache = { facts: w.facts, mods };
  }
  return storyCache.mods.get(`${scope}|${channel}`) ?? 0;
}

// ── Readers (what the rest of the game applies) ────────────────────────

/** Story + dynamic modifier on one scope. */
export function worldMod(w: WorldState, scope: WorldScope, channel: string): number {
  return storyMod(w, scope, channel) + mod(w, scope, channel);
}

/** A system's modifier: the Reach-wide value plus the system's own. */
export function sysMod(w: WorldState, sysId: string, channel: string): number {
  return worldMod(w, REACH, channel) + worldMod(w, sysScope(sysId), channel);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * After the Symphony of Gates nobody *needs* Ebon: the demand side of the
 * market (bastions, carriers, ports that burned it for Lantern transits)
 * falls further than the refineries, so the old Ebon run pays nothing.
 */
export const EBON_UNNEEDED: Readonly<Record<string, number>> = { refinery: 0, salvage: -0.1, freeport: -0.1, orbital: -0.16, surface: -0.17, bastion: -0.17, carrier: -0.18 };

/** Price offset at a station (of `kind`) for a commodity (fraction; −0.9..+1.5). */
export function priceOffset(w: WorldState, sysId: string, stationId: string, cid: CommodityId, kind?: string): number {
  const ch = `price:${cid}`;
  let v = sysMod(w, sysId, ch) + worldMod(w, stationScope(stationId), ch);
  if (cid === 'ebon' && kind && fact(w, 'gates.aligned')) v += EBON_UNNEEDED[kind] ?? 0;
  // The Schedule's floor (88 sh a gram) holds Ebon up until the Schedule is read aloud.
  if (cid === 'ebon' && !fact(w, 'ebon.floor.lifted')) v = Math.max(v, -0.05);
  return clamp(v, -0.9, 1.5);
}

/** Sailings multiplier offset for a system's lanes (−0.8..+2). */
export function trafficOffset(w: WorldState, sysId: string): number {
  return clamp(sysMod(w, sysId, 'traffic'), -0.8, 2);
}

/** Additive raid rate for a system (the caller clamps the total to 0..0.5). */
export function piracyOffset(w: WorldState, sysId: string): number {
  return clamp(sysMod(w, sysId, 'piracy'), -0.5, 0.5);
}

/** Patrol sailings multiplier offset (−0.7..+2). */
export function patrolOffset(w: WorldState, sysId: string): number {
  return clamp(sysMod(w, sysId, 'patrol'), -0.7, 2);
}

/**
 * How a station regards the pilot, −1..1: its own attitude, its system's,
 * its faction's, and — at Directorate berths — the Office of Continuity's
 * (full weight at bastions, where Continuity keeps its desks).
 */
export function attitude(w: WorldState, st: { id: string; faction: string; kind: string }, sysId: string): number {
  let v = worldMod(w, stationScope(st.id), 'attitude') + worldMod(w, sysScope(sysId), 'attitude') + worldMod(w, `faction:${st.faction}`, 'attitude');
  if (st.faction === 'concord') v += worldMod(w, 'guild:continuity', 'attitude') * (st.kind === 'bastion' ? 1 : 0.5);
  return clamp(v, -1, 1);
}

/** Berth refused at or below this attitude. */
export const ATTITUDE_DENY = -0.8;
/** Tariff (extra spread) from a cold attitude: up to +20 % at −1. Warm attitudes never narrow it. */
export function tariff(att: number): number {
  return Math.max(0, -att) * 0.2;
}
/** Contract fees scale with how the posting station regards the pilot: ±15 %. */
export function payMul(att: number): number {
  return 1 + 0.15 * clamp(att, -1, 1);
}

export function greeting(att: number, faction: string): string {
  if (att <= -0.5) return faction === 'choir' ? 'THE DECK CANTOR DOES NOT SING FOR YOU. BERTH GRANTED UNDER PROTEST.' : 'DECK CHIEF: "YOU\'RE THAT ONE. SIGN FOR EVERYTHING, TWICE."';
  if (att <= -0.2) return 'THE DECK CREW REMEMBERS YOU. NOT FONDLY. TARIFFS APPLY.';
  if (att >= 0.5) return faction === 'rustwake' ? 'THE HOLD CHEERS YOU IN. SOMEBODY HAS ALREADY POURED YOU A DRINK.' : 'DECK CHIEF: "VANGUARD. GOOD TO HAVE YOU. BERTH\'S ON THE HOUSE."';
  if (att >= 0.2) return 'THE DECK CREW KNOWS YOUR CALLSIGN. A GOOD SIGN.';
  return '';
}

/**
 * Lantern toll per jump in shares: one gram of Ebon at the Reach price.
 * Zero once the gates are aligned — an aligned Lantern drinks the Breath.
 */
export function lanternToll(w: WorldState): number {
  if (fact(w, 'lantern.toll.free')) return 0;
  return Math.round(110 * (1 + clamp(worldMod(w, REACH, 'price:ebon'), -0.05, 1.5)));
}

/** Contract-board weight multipliers for a system's boards (kind → ×). */
export function boardWeights(w: WorldState, sysId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const pir = piracyOffset(w, sysId);
  if (pir > 0.03) {
    out.bounty = 1 + pir * 6;
    out.escort = 1 + pir * 5;
  } else if (pir < -0.03) out.bounty = Math.max(0.3, 1 + pir * 6);
  const tr = trafficOffset(w, sysId);
  if (tr > 0.1) {
    out.haul = 1 + tr;
    out.courier = 1 + tr * 0.6;
  }
  if (sysMod(w, sysId, 'patrol') > 0.2) out.patrol = 1.5;
  if (fact(w, 'gates.aligned')) out.recon = 1.6; // the dark gates want surveying
  return out;
}

// ── 2. Player actions → local changes ───────────────────────────────────

/**
 * An ambush broken (or lost) on a lane. Every raider downed thins the bands
 * working this system for hours; three clean saves and the haulers call the
 * run safe.
 */
export function actAmbush(w: WorldState, sysId: string, victim: EconFaction, raidersKilled: number, saved: boolean): WorldState {
  const s = sysScope(sysId);
  let n = w;
  if (saved || raidersKilled > 0) {
    n = nudge(n, s, 'piracy', -0.03 * Math.max(1, raidersKilled), 0.02, 0.5);
    n = nudge(n, s, 'traffic', 0.05 * Math.max(1, raidersKilled), 0.03, 1);
    n = nudge(n, `faction:${victim}`, 'attitude', saved ? 0.04 : 0.01, 0.01, 1);
    n = bump(n, `lane.${sysId}.cleared`);
    if (counter(n, `lane.${sysId}.cleared`) >= 3 && !fact(n, `lane.${sysId}.safe`)) {
      n = setFact(n, `lane.${sysId}.safe`);
      n = record(n, 'lane.safe', s, { sys: sysId });
    }
  } else n = nudge(n, s, 'piracy', 0.02, 0.02, 0.5);
  // The ambush itself is logged by the rivals' director (`ambush.broken` / `ambush.lost`); only the lane's new standing is ours.
  return n;
}

/** The pilot shot a faction's ship in free flight: patrols come looking, doors cool. */
export function actKill(w: WorldState, sysId: string, faction: EconFaction): WorldState {
  let n = nudge(w, sysScope(sysId), 'patrol', 0.12, 0.25, 1.5);
  n = nudge(n, `faction:${faction}`, 'attitude', -0.04, 0.01, 1);
  n = bump(n, `kills.${faction}`);
  const k = counter(n, `kills.${faction}`);
  if (k % 5 === 0) n = record(n, 'kills', sysScope(sysId), { faction, total: k });
  return n;
}

/**
 * Heavy trading leaves a mark longer than the 15-minute market pressure:
 * every unit sold (units > 0) sags the station's price a little for hours,
 * every unit bought (units < 0) lifts it (±20 % cap). A run of 8+ units in
 * a short while (a `vol:` tally that drains in minutes) makes the news.
 */
export function actTrade(w: WorldState, stationId: string, sysId: string, cid: CommodityId, units: number): WorldState {
  if (!units) return w;
  const sc = stationScope(stationId);
  const before = mod(w, sc, `vol:${cid}`);
  let n = nudge(w, sc, `price:${cid}`, -0.008 * units, 0.03, 0.2);
  n = nudge(n, sc, `vol:${cid}`, units, 40, 100);
  const after = mod(n, sc, `vol:${cid}`);
  if (Math.abs(after) >= 8 && Math.abs(before) < 8) n = record(n, units > 0 ? 'trade.dump' : 'trade.corner', sc, { cid, units: Math.round(Math.abs(after)), sys: sysId });
  return n;
}

/** A contract paid at a station: its people remember who did the work. */
export function actContract(w: WorldState, stationId: string, faction: EconFaction): WorldState {
  let n = nudge(w, stationScope(stationId), 'attitude', 0.07, 0.01, 1);
  n = nudge(n, `faction:${faction}`, 'attitude', 0.015, 0.005, 1);
  return bump(n, `contracts.${stationId}`);
}

// ── 3. Background drift: the Reach breathes ─────────────────────────────

/** One background event per slot of world clock (~4 an hour). */
export const NEWS_PERIOD = 900;

interface Template {
  id: string;
  weight: (w: WorldState) => number;
  /** Where it happens; null skips the slot. */
  where: (r: ReachInfo, u: number) => { sys: ReachSystemInfo; st?: ReachStationInfo } | null;
  apply: (w: WorldState, sys: string, st?: string) => WorldState;
}

const bySys = (r: ReachInfo, ok: (s: ReachSystemInfo) => boolean, u: number) => {
  const list = r.systems.filter(ok);
  const sys = pickOf(list, u);
  return sys ? { sys } : null;
};
const byStation = (r: ReachInfo, ok: (st: ReachStationInfo, s: ReachSystemInfo) => boolean, u: number) => {
  const list = r.systems.flatMap((sys) => sys.stations.filter((st) => ok(st, sys)).map((st) => ({ sys, st })));
  return pickOf(list, u) ?? null;
};
const lawless = (s: ReachSystemInfo) => s.faction === 'contested' || s.faction === 'rustwake';

export const BACKGROUND: readonly Template[] = [
  {
    id: 'convoy-lost',
    weight: (w) => (fact(w, 'gates.aligned') ? 0.4 : 1.2),
    where: (r, u) => bySys(r, lawless, u),
    apply: (w, s) => nudge(nudge(nudge(w, sysScope(s), 'piracy', 0.06, 0.04, 0.5), sysScope(s), 'traffic', -0.12, 0.08), sysScope(s), 'price:rations', 0.06, 0.04),
  },
  {
    id: 'refinery-strike',
    weight: (w) => (fact(w, 'gates.aligned') ? 0.2 : 1),
    where: (r, u) => byStation(r, (st) => st.kind === 'refinery', u),
    apply: (w, s, st) => nudge(nudge(w, stationScope(st!), 'price:ebon', 0.18, 0.05, 0.5), sysScope(s), 'traffic', -0.08, 0.08),
  },
  {
    id: 'clan-feud',
    weight: () => 0.8,
    where: (r, u) => bySys(r, (s) => s.faction === 'rustwake', u),
    apply: (w, s) => nudge(nudge(w, sysScope(s), 'piracy', 0.08, 0.04, 0.5), sysScope(s), 'patrol', 0.2, 0.1),
  },
  {
    id: 'ember-flare',
    weight: (w) => (fact(w, 'gates.aligned') ? 0 : 0.6),
    where: (r, u) => byStation(r, (st) => st.kind === 'refinery' && st.faction === 'rustwake', u),
    apply: (w, _s, st) => nudge(w, stationScope(st!), 'price:ebon', -0.12, 0.05, 0.5),
  },
  {
    id: 'relic-find',
    weight: () => 0.7,
    where: (r, u) => byStation(r, (st) => st.kind === 'salvage', u),
    apply: (w, _s, st) => nudge(w, stationScope(st!), 'price:relics', -0.16, 0.05, 0.5),
  },
  {
    id: 'allocation',
    weight: () => 0.8,
    where: (r, u) => bySys(r, (s) => s.faction === 'concord', u),
    apply: (w, s) => nudge(nudge(w, sysScope(s), 'price:rations', -0.07, 0.04), sysScope(s), 'price:munitions', 0.07, 0.04),
  },
  {
    id: 'observance',
    weight: (w) => (fact(w, 'zenith.revealed') ? 0.3 : 0.7),
    where: (r, u) => bySys(r, (s) => s.faction === 'choir', u),
    apply: (w, s) => nudge(nudge(w, sysScope(s), 'patrol', 0.3, 0.12), sysScope(s), 'traffic', -0.06, 0.06),
  },
  {
    id: 'medical-shortage',
    weight: () => 0.6,
    where: (r, u) => byStation(r, (st) => st.kind === 'orbital' || st.kind === 'bastion' || st.kind === 'surface', u),
    apply: (w, _s, st) => nudge(w, stationScope(st!), 'price:medical', 0.16, 0.05, 0.5),
  },
  {
    id: 'refugees',
    weight: (w) => (fact(w, 'bastion.fallen') && !fact(w, 'gates.aligned') ? 1.2 : 0),
    where: (r, u) => bySys(r, (s) => s.id === 'anchorage' || (s.faction === 'concord' && u > 0.7), u),
    apply: (w, s) => nudge(nudge(w, sysScope(s), 'traffic', 0.1, 0.05), sysScope(s), 'price:rations', 0.08, 0.04),
  },
  {
    id: 'joint-squad',
    weight: (w) => (fact(w, 'rot.open') && !fact(w, 'schedule.read') ? 1 : 0),
    where: (r, u) => bySys(r, (s) => s.faction === 'contested' || s.id === 'tessaly', u),
    apply: (w, s) => nudge(nudge(w, sysScope(s), 'patrol', 0.2, 0.1), sysScope(s), 'piracy', 0.05, 0.04, 0.5),
  },
  {
    id: 'lantern-hums',
    weight: (w) => (fact(w, 'gates.aligned') ? 1.4 : 0),
    where: (r, u) => bySys(r, (s) => s.faction !== 'unknown', u),
    apply: (w, s) => nudge(w, sysScope(s), 'traffic', 0.15, 0.05),
  },
];

/** Roll background slot `slot` (deterministic from the Reach seed) and apply it. */
export function backgroundEvent(w: WorldState, reach: ReachInfo, slot: number): WorldState {
  const key = `${reach.seed}:bg:${slot}`;
  const live = BACKGROUND.map((t) => ({ t, wt: t.weight(w) })).filter((x) => x.wt > 0);
  let r = roll(key, 0) * live.reduce((s, x) => s + x.wt, 0);
  let tpl = live[live.length - 1]?.t;
  for (const x of live) if ((r -= x.wt) <= 0) {
    tpl = x.t;
    break;
  }
  if (!tpl) return w;
  const at = tpl.where(reach, roll(key, 1));
  if (!at) return w;
  const n = tpl.apply(w, at.sys.id, at.st?.id);
  return record(n, 'news', sysScope(at.sys.id), { k: tpl.id, sys: at.sys.id, ...(at.st ? { st: at.st.id } : {}) });
}

/** Events in `after`'s log that `before` didn't have (robust to the log cap). */
export function since(before: WorldState, after: WorldState): WorldEvent[] {
  if (after.log === before.log) return [];
  const last = before.log[before.log.length - 1];
  if (!last) return [...after.log];
  const i = after.log.lastIndexOf(last);
  return i >= 0 ? after.log.slice(i + 1) : [...after.log];
}

/** Dev / captures: a world with every episode up to `ep` completed, `clock` seconds in. */
export function fastForward(ep: number, clock = 0, base: WorldState = { version: 1, clock: 0, facts: {}, counters: {}, mods: {}, log: [] }): WorldState {
  let w: WorldState = { ...base, clock };
  for (let e = 1; e <= Math.min(20, ep); e++) w = completeEpisode(w, e);
  return w;
}

export { lastEpisode };
