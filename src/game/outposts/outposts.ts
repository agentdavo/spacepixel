/**
 * Outposts (batch 5 · milestone 3) — claim a dead hulk in a quiet system and
 * restore it in stages, as your guild's base. Pure data + functions over the
 * shared WorldState (node-testable); the rebuild you see and the berth you
 * dock at are src/game/outposts/OutpostView.ts and OutpostRuntime.ts.
 *
 *   0 CLAIMED   a dark hulk, tumbling; a claim beacon
 *   1 SEALED    hull sealed, running lights on, the tumble stopped   · storage
 *   2 BERTH     power to the ring (it spins) and the docking bay     · berth, repair
 *   3 MARKET    the market deck opens, hangar racks for your ships   · market, hangar
 *   4 ANNEX     a guild hall annex (the guild's banner lights)       · guild hall
 *   5 GUNS      guns on the rim; a picket that fights raiders        · defences
 *
 * Each stage wants market goods and salvage delivered plus shares. Raiders
 * come for it now and then once there is something to take (stage ≥ 2): a
 * defence contract appears on your book; fly it, or the outpost is damaged
 * (services offline until patched) — unless its guns hold.
 *
 * World state (never a private copy):
 *   facts     outpost.site, outpost.guild, outpost.name, outpost.damaged
 *   counters  outpost.stage, outpost.got.<commodity>, outpost.store.<commodity>,
 *             outpost.raidAt, outpost.raids, outpost.defended
 *   events    outpost.claimed · outpost.stage · outpost.raid · outpost.defended · outpost.damaged · outpost.patched
 *             (scope station:outpost-<site>)
 */
import type { CommodityId, TradeLedger } from '../economy';
import type { Contract, ReachMap, ReachSystem, V3 } from '../contracts/contracts';
import { bump, counter, fact, record, setFact, type WorldState } from '../world/WorldState.ts';
import { GUILDS, OUTPOST_RANK, type GuildId } from '../guilds/guilds.ts';
import { highestRank, rankOf } from '../guilds/membership.ts';

export type OutpostService = 'storage' | 'berth' | 'repair' | 'market' | 'hangar' | 'annex' | 'defences';

export interface OutpostStage {
  n: number;
  id: string;
  name: string;
  /** What the crews say they are doing (the dock log / tab). */
  work: string;
  /** Goods to deliver for this stage (0 = the claim). */
  goods: Partial<Record<CommodityId, number>>;
  shares: number;
  services: OutpostService[];
}

export const STAGES: OutpostStage[] = [
  { n: 0, id: 'claimed', name: 'CLAIMED — A DEAD HULK', work: 'A claim beacon on a dead hulk. Nothing works. Nothing has worked for a very long time.', goods: {}, shares: 2500, services: [] },
  { n: 1, id: 'sealed', name: 'HULL SEALED · LIGHTS ON', work: 'Patch the breaches, pump air, stop the tumble. Light her up.', goods: { spares: 6, relics: 2 }, shares: 3000, services: ['storage'] },
  { n: 2, id: 'berth', name: 'RING SPUN · BAY OPEN', work: 'Power to the ring, clear the docking bay, hang an atmosphere curtain.', goods: { spares: 4, rations: 6, medical: 3 }, shares: 4500, services: ['berth', 'repair'] },
  { n: 3, id: 'market', name: 'MARKET DECK · HANGAR RACKS', work: 'Open the market deck to passing haulers; rack space for your own ships.', goods: { cores: 2, rations: 6, luxury: 2 }, shares: 6000, services: ['market', 'hangar'] },
  { n: 4, id: 'annex', name: 'GUILD HALL ANNEX', work: 'A hall annex for your guild: its banner on the spire, its quartermaster aboard.', goods: { relics: 3, ebon: 2 }, shares: 8000, services: ['annex'] },
  { n: 5, id: 'guns', name: 'GUNS ON THE RIM', work: 'Turrets on the ring, a picket on the berth. Let the raiders come.', goods: { munitions: 8, cores: 1 }, shares: 9000, services: ['defences'] },
];
export const MAX_STAGE = STAGES.length - 1;

/** Raids: first one 50–80 min of world time after the bay opens, then every 60–110 min. */
export const RAID_MIN = 3600;
export const RAID_SPAN = 3000;
/** Hours the pilot has to come and fight before the raid resolves by itself. */
export const RAID_WINDOW = 1200;
export const PATCH_COST = { goods: { spares: 4 } as Partial<Record<CommodityId, number>>, shares: 2000 };

// ── sites ───────────────────────────────────────────────────────────────

export interface OutpostSite {
  id: string;
  system: string;
  systemName: string;
  name: string;
  /** System-local position (m) and the bay axis (toward the nearest Lantern). */
  pos: V3;
  axis: V3;
  /** Which factions' pilots would call this a quiet system. */
  faction: string;
  threat: number;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const HULK_NAMES = ['Patient Error', 'Late Arrival', 'Last Connection', 'Platform Nine', 'Terminus', 'Held Service', 'Ninth Departure', 'Replacement Service', 'Quiet Carriage', 'Lost Property'];

/**
 * Claimable hulks: one per quiet system (threat ≤ 0.35, not Hegemony or the
 * Null), 16 km in from its last Lantern and well off the lane, 15 km or more
 * from any station. The Houses' converts may also claim in the quietest
 * Hegemony system. Deterministic from the Reach.
 */
export function outpostSites(reach: ReachMap, guild?: GuildId): OutpostSite[] {
  const out: OutpostSite[] = [];
  const choir = reach.systems.filter((s) => s.faction === 'choir' && s.gates.length).sort((a, b) => a.threat - b.threat)[0];
  for (const s of reach.systems) {
    const quiet = s.threat <= 0.35 && s.faction !== 'choir' && s.faction !== 'unknown';
    const house = guild === 'houses' && choir && s.id === choir.id;
    if ((!quiet && !house) || !s.gates.length) continue;
    out.push(siteIn(s));
  }
  return out.sort((a, b) => a.threat - b.threat || a.id.localeCompare(b.id));
}

function siteIn(s: ReachSystem): OutpostSite {
  const h = hashStr(`outpost:${s.id}`);
  const g = s.gates[s.gates.length - 1];
  const inward: V3 = [-g.normal[0], -g.normal[1], -g.normal[2]];
  const side: V3 = [-g.normal[2], 0, g.normal[0]];
  const sl = Math.hypot(side[0], side[2]) || 1;
  const sgn = h & 1 ? 1 : -1;
  const pos: V3 = [g.pos[0] + inward[0] * 16000 + (side[0] / sl) * 11000 * sgn, g.pos[1] + inward[1] * 16000 + (((h >>> 4) % 3000) - 1500), g.pos[2] + inward[2] * 16000 + (side[2] / sl) * 11000 * sgn];
  // Keep clear of the system's stations.
  for (let pass = 0; pass < 4; pass++)
    for (const st of s.stations) {
      const d: V3 = [pos[0] - st.pos[0], pos[1] - st.pos[1], pos[2] - st.pos[2]];
      const l = Math.hypot(...d);
      if (l >= 15000) continue;
      const k = (16000 - l) / (l || 1);
      pos[0] += d[0] * k;
      pos[1] += d[1] * k;
      pos[2] += d[2] * k;
    }
  const to: V3 = [g.pos[0] - pos[0], g.pos[1] - pos[1], g.pos[2] - pos[2]];
  const tl = Math.hypot(...to) || 1;
  return {
    id: s.id,
    system: s.id,
    systemName: s.name,
    name: `${HULK_NAMES[h % HULK_NAMES.length]}`,
    pos: pos.map(Math.round) as V3,
    axis: [to[0] / tl, to[1] / tl, to[2] / tl],
    faction: s.faction,
    threat: s.threat,
  };
}

export function siteById(reach: ReachMap, id: string): OutpostSite | null {
  const s = reach.systems.find((x) => x.id === id);
  return s && s.gates.length ? siteIn(s) : null;
}

/** Station id of the outpost's berth (docking, contracts payAt). */
export function outpostStationId(site: string): string {
  return `outpost-${site}`;
}

// ── state ───────────────────────────────────────────────────────────────

export interface OutpostState {
  site: string;
  guild: GuildId;
  name: string;
  stage: number;
  got: Partial<Record<CommodityId, number>>;
  store: Partial<Record<CommodityId, number>>;
  damaged: boolean;
  raidAt: number;
}

const GOODS: CommodityId[] = ['ebon', 'relics', 'cores', 'spares', 'rations', 'munitions', 'medical', 'luxury'];

export function outpostOf(w: WorldState): OutpostState | null {
  const site = fact(w, 'outpost.site');
  if (typeof site !== 'string' || !site) return null;
  const got: OutpostState['got'] = {};
  const store: OutpostState['store'] = {};
  for (const c of GOODS) {
    const a = counter(w, `outpost.got.${c}`);
    if (a) got[c] = a;
    const b = counter(w, `outpost.store.${c}`);
    if (b) store[c] = b;
  }
  const g = fact(w, 'outpost.guild');
  return {
    site,
    guild: (typeof g === 'string' && g in GUILDS ? g : 'keeping') as GuildId,
    name: String(fact(w, 'outpost.name') ?? 'Outpost'),
    stage: Math.max(0, Math.min(MAX_STAGE, counter(w, 'outpost.stage'))),
    got,
    store,
    damaged: fact(w, 'outpost.damaged') === true,
    raidAt: counter(w, 'outpost.raidAt'),
  };
}

export function hasService(o: OutpostState | null, s: OutpostService): boolean {
  if (!o) return false;
  if (o.damaged && s !== 'berth' && s !== 'storage' && s !== 'repair') return false;
  return STAGES.slice(0, o.stage + 1).some((st) => st.services.includes(s));
}

/** Can this pilot claim a hulk? (null = yes) */
export function claimBlock(w: WorldState): string | null {
  if (outpostOf(w)) return 'YOU ALREADY HOLD AN OUTPOST';
  if (highestRank(w).rank < OUTPOST_RANK) return `RANK ${OUTPOST_RANK} IN ANY GUILD NEEDED`;
  return null;
}

const scope = (site: string) => `station:${outpostStationId(site)}` as const;

export function claim(w: WorldState, l: TradeLedger, site: OutpostSite, guild: GuildId): { world: WorldState; ledger: TradeLedger; error?: string; text: string } {
  const why = claimBlock(w) ?? (rankOf(w, guild) < OUTPOST_RANK ? `RANK ${OUTPOST_RANK} IN THE ${GUILDS[guild].short} NEEDED` : null);
  if (why) return { world: w, ledger: l, error: why, text: why };
  const cost = STAGES[0].shares;
  if (l.credits < cost) return { world: w, ledger: l, error: `CLAIM FEE ${cost.toLocaleString('en-US')} sh`, text: '' };
  let next = setFact(setFact(setFact(w, 'outpost.site', site.id), 'outpost.guild', guild), 'outpost.name', site.name);
  next = setFact(next, 'outpost.damaged', false);
  next = { ...next, counters: { ...next.counters, 'outpost.stage': 0, 'outpost.raidAt': 0 } };
  next = record(next, 'outpost.claimed', scope(site.id), { system: site.system, guild });
  return { world: next, ledger: { ...l, credits: l.credits - cost }, text: `CLAIM FILED · THE ${site.name.toUpperCase()} · ${site.systemName.toUpperCase()} · ${cost.toLocaleString('en-US')} sh` };
}

/** What the next stage still needs (goods outstanding and shares). Null at the top. */
export function nextNeeds(o: OutpostState): { stage: OutpostStage; goods: Partial<Record<CommodityId, number>>; shares: number } | null {
  if (o.damaged) return { stage: { ...STAGES[o.stage], name: 'PATCH THE DAMAGE', work: 'Raiders holed the hub. Patch it before anything else runs.' }, goods: minus(PATCH_COST.goods, o.got), shares: PATCH_COST.shares };
  const st = STAGES[o.stage + 1];
  if (!st) return null;
  return { stage: st, goods: minus(st.goods, o.got), shares: st.shares };
}

function minus(need: Partial<Record<CommodityId, number>>, got: Partial<Record<CommodityId, number>>): Partial<Record<CommodityId, number>> {
  const out: Partial<Record<CommodityId, number>> = {};
  for (const [c, n] of Object.entries(need) as [CommodityId, number][]) {
    const left = n - (got[c] ?? 0);
    if (left > 0) out[c] = left;
  }
  return out;
}

/** Hand goods from the hold to the restoration crews (only what the next stage needs). */
export function deliver(w: WorldState, l: TradeLedger): { world: WorldState; ledger: TradeLedger; moved: Partial<Record<CommodityId, number>> } {
  const o = outpostOf(w);
  const needs = o && nextNeeds(o);
  if (!o || !needs) return { world: w, ledger: l, moved: {} };
  const cargo = { ...l.cargo };
  const moved: Partial<Record<CommodityId, number>> = {};
  let next = w;
  for (const [c, n] of Object.entries(needs.goods) as [CommodityId, number][]) {
    const k = Math.min(n, cargo[c] ?? 0);
    if (k <= 0) continue;
    cargo[c] = (cargo[c] ?? 0) - k;
    if (!cargo[c]) delete cargo[c];
    moved[c] = k;
    next = bump(next, `outpost.got.${c}`, k);
  }
  return { world: next, ledger: { ...l, cargo }, moved };
}

/** Everything delivered and the shares in hand: finish the stage (or the patch). */
export function build(w: WorldState, l: TradeLedger): { world: WorldState; ledger: TradeLedger; error?: string; text: string } {
  const o = outpostOf(w);
  const needs = o && nextNeeds(o);
  if (!o || !needs) return { world: w, ledger: l, error: 'NOTHING LEFT TO BUILD', text: '' };
  if (Object.keys(needs.goods).length) return { world: w, ledger: l, error: 'GOODS STILL OUTSTANDING', text: '' };
  if (l.credits < needs.shares) return { world: w, ledger: l, error: `INSUFFICIENT SHARES — ${needs.shares.toLocaleString('en-US')} sh`, text: '' };
  const counters = { ...w.counters };
  for (const c of GOODS) delete counters[`outpost.got.${c}`];
  let next: WorldState = { ...w, counters };
  let text: string;
  if (o.damaged) {
    next = setFact(next, 'outpost.damaged', false);
    next = record(next, 'outpost.patched', scope(o.site));
    text = 'DAMAGE PATCHED · SERVICES BACK ONLINE';
  } else {
    const n = o.stage + 1;
    next = { ...next, counters: { ...next.counters, 'outpost.stage': n } };
    // The bay opening puts it on the raiders' charts.
    if (n === 2) next = { ...next, counters: { ...next.counters, 'outpost.raidAt': w.clock + RAID_MIN + (hashStr(o.site) % RAID_SPAN) } };
    next = record(next, 'outpost.stage', scope(o.site), { stage: n, id: STAGES[n].id });
    text = `STAGE ${n} · ${STAGES[n].name}`;
  }
  return { world: next, ledger: { ...l, credits: l.credits - needs.shares }, text };
}

/** Storage locker (stage ≥ 1): move cargo between the hold and the outpost. */
export function stow(w: WorldState, l: TradeLedger, c: CommodityId, n: number): { world: WorldState; ledger: TradeLedger; moved: number } {
  const o = outpostOf(w);
  if (!hasService(o, 'storage') || n === 0) return { world: w, ledger: l, moved: 0 };
  const cargo = { ...l.cargo };
  let moved: number;
  if (n > 0) {
    moved = Math.min(n, cargo[c] ?? 0);
    cargo[c] = (cargo[c] ?? 0) - moved;
  } else {
    const free = l.capacity - Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
    moved = -Math.min(-n, counter(w, `outpost.store.${c}`), Math.max(0, free));
    cargo[c] = (cargo[c] ?? 0) - moved;
  }
  if (!cargo[c]) delete cargo[c];
  if (!moved) return { world: w, ledger: l, moved: 0 };
  return { world: bump(w, `outpost.store.${c}`, moved), ledger: { ...l, cargo }, moved };
}

// ── raids ───────────────────────────────────────────────────────────────

/** Is a raid due now? (stage ≥ 2, not already running, clock past raidAt) */
export function raidDue(w: WorldState, running: boolean): boolean {
  const o = outpostOf(w);
  return !!o && o.stage >= 2 && !running && o.raidAt > 0 && w.clock >= o.raidAt;
}

/** Schedule the next raid after one has resolved. */
function reschedule(w: WorldState, site: string): WorldState {
  const n = counter(w, 'outpost.raids');
  return { ...w, counters: { ...w.counters, 'outpost.raidAt': w.clock + RAID_MIN + 600 + (hashStr(`${site}:${n}`) % RAID_SPAN) } };
}

/** The raid begins: count it, push the next one out, record it. */
export function raidBegins(w: WorldState): WorldState {
  const o = outpostOf(w);
  if (!o) return w;
  let next = bump(w, 'outpost.raids');
  next = reschedule(next, o.site);
  return record(next, 'outpost.raid', scope(o.site), { stage: o.stage });
}

/** The raid is over: defended (you came and won) or not (you didn't — the guns may still hold). */
export function raidResolved(w: WorldState, defended: boolean): { world: WorldState; text: string; held: boolean } {
  const o = outpostOf(w);
  if (!o) return { world: w, text: '', held: true };
  if (defended) {
    const next = record(bump(w, 'outpost.defended'), 'outpost.defended', scope(o.site), { by: 'pilot' });
    return { world: next, text: `THE ${o.name.toUpperCase()} HELD · RAIDERS BROKEN`, held: true };
  }
  // Unattended: the guns hold two raids in three.
  const guns = o.stage >= 5 && hashStr(`${o.site}:${counter(w, 'outpost.raids')}`) % 3 !== 0;
  if (guns) return { world: record(w, 'outpost.defended', scope(o.site), { by: 'guns' }), text: `THE ${o.name.toUpperCase()}’S GUNS HELD WITHOUT YOU`, held: true };
  let next = setFact(w, 'outpost.damaged', true);
  next = record(next, 'outpost.damaged', scope(o.site), { stage: o.stage });
  return { world: next, text: `THE ${o.name.toUpperCase()} WAS HIT · SERVICES OFFLINE UNTIL PATCHED`, held: false };
}

/** The defence contract for a raid (payAt: the outpost berth). */
export function raidContract(w: WorldState, reach: ReachMap, clock: number): Contract | null {
  const o = outpostOf(w);
  const site = o && siteById(reach, o.site);
  if (!o || !site) return null;
  const n = counter(w, 'outpost.raids');
  const hostiles = 3 + Math.min(3, Math.floor(n / 2));
  const bay = outpostStationId(site.id);
  const reward = 1500 + 400 * o.stage;
  return {
    id: `outpost:${site.id}#${n}`,
    kind: 'patrol',
    // Tier III = guns on the rim (defence.ts puts the picket in the fight).
    tier: o.stage >= 5 ? 3 : 2,
    client: GUILDS[o.guild].quartermaster,
    faction: GUILDS[o.guild].faction,
    title: `Defend the ${o.name}`,
    brief: `Raiders on the ${o.name}’s scope, ${site.systemName}. They want what the crews have built. Get there and break them before they break it.`,
    origin: bay,
    originName: o.name,
    originSystem: site.system,
    payAt: bay,
    payAtName: o.name,
    payAtSystem: site.system,
    op: {
      system: site.system,
      center: site.pos,
      hostiles,
      waves: o.stage >= 4 ? 2 : 1,
      enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Hulk-raider' },
      seed: hashStr(`${site.id}:${n}`),
    },
    reward,
    rep: 0,
    penalty: 0,
    repPenalty: 0,
    duration: RAID_WINDOW,
    expires: clock + RAID_WINDOW,
    jumps: 0,
    state: 'offered',
    outpost: site.id,
  };
}
