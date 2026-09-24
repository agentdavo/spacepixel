/**
 * Guild membership rules — pure functions over the shared WorldState.
 *
 * Joining, merit (and the conflicts that drain it), rank-ups (with top-rank
 * exclusivity and standing gates), dues and arrears, leaving and expulsion.
 * Every function takes a WorldState and returns a new one plus whatever the
 * caller must apply elsewhere (standing deltas for the trade ledger, lines
 * for the dock log). Events are recorded with scope `guild:<id>` so the world
 * simulation, NPC arcs and rivals can react.
 *
 * Pure: runs under node --test (tests/guilds.test.ts).
 */
import { bump, counter, fact, record, setFact, type WorldState } from '../world/WorldState.ts';
import type { EconFaction, TradeLedger } from '../economy';
import { DUES_PERIOD, GUILD_IDS, GUILDS, MAX_RANK, RANK_MERIT, TOP_RANK, hostility, sworn, type GuildId } from './guilds.ts';

export type Rep = Partial<Record<EconFaction, number>>;

export interface GuildResult {
  world: WorldState;
  /** Standing changes for the trade ledger. */
  rep: Rep;
  /** Dock-log lines. */
  notes: { text: string; cls?: 'ok' | 'err' }[];
  error?: string;
}

const key = (g: GuildId, k: string) => `guild.${g}.${k}`;
const ok = (world: WorldState, notes: GuildResult['notes'] = [], rep: Rep = {}): GuildResult => ({ world, rep, notes });
const fail = (world: WorldState, error: string): GuildResult => ({ world, rep: {}, notes: [{ text: error, cls: 'err' }], error });

// ── reading ─────────────────────────────────────────────────────────────

export function rankOf(w: WorldState, g: GuildId): number {
  const v = Number(fact(w, key(g, 'rank')) ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(MAX_RANK, Math.floor(v))) : 0;
}

export function meritOf(w: WorldState, g: GuildId): number {
  return counter(w, key(g, 'merit'));
}

export function isMember(w: WorldState, g: GuildId): boolean {
  return rankOf(w, g) > 0;
}

export function isExpelled(w: WorldState, g: GuildId): boolean {
  return fact(w, key(g, 'expelled')) === true;
}

export function memberships(w: WorldState): { guild: GuildId; rank: number; merit: number }[] {
  return GUILD_IDS.filter((g) => isMember(w, g)).map((g) => ({ guild: g, rank: rankOf(w, g), merit: meritOf(w, g) }));
}

/** Highest rank held in any guild (outposts need 3). */
export function highestRank(w: WorldState): { guild: GuildId | null; rank: number } {
  let best: { guild: GuildId | null; rank: number } = { guild: null, rank: 0 };
  for (const g of GUILD_IDS) {
    const r = rankOf(w, g);
    if (r > best.rank) best = { guild: g, rank: r };
  }
  return best;
}

/** What NPCs call you in guild `g` ("" when not a member). */
export function titleIn(w: WorldState, g: GuildId): string {
  const r = rankOf(w, g);
  return r > 0 ? GUILDS[g].ranks[r - 1].title : '';
}

export function rankName(g: GuildId, r: number): string {
  return r > 0 ? GUILDS[g].ranks[r - 1].name : 'Not a member';
}

/** Merit progress toward the next rank: 0..1 (1 at the top). */
export function rankProgress(w: WorldState, g: GuildId): { rank: number; merit: number; from: number; to: number | null; t: number } {
  const rank = rankOf(w, g);
  const merit = meritOf(w, g);
  const from = RANK_MERIT[Math.max(1, rank)];
  const to = rank >= MAX_RANK ? null : RANK_MERIT[rank + 1];
  const t = to === null ? 1 : Math.max(0, Math.min(1, (merit - from) / (to - from)));
  return { rank, merit, from, to, t };
}

/** Quartermaster discount by rank (0 … 25 %). */
export function discount(rank: number): number {
  return [0, 0, 0.05, 0.1, 0.15, 0.2, 0.25][Math.max(0, Math.min(MAX_RANK, rank))];
}

// ── joining ─────────────────────────────────────────────────────────────

export function canJoin(w: WorldState, g: GuildId, rep: Record<EconFaction, number>): string | null {
  if (isMember(w, g)) return 'ALREADY A MEMBER';
  if (isExpelled(w, g)) return g === 'rustwake' ? 'THE MOOT SCRAPED YOUR MARK. IT DOES NOT PAINT TWICE.' : 'EXPELLED — THE DOOR DOES NOT OPEN AGAIN';
  const gd = GUILDS[g];
  if ((rep[gd.faction] ?? 0) < gd.join.standing) return `NEEDS ${gd.faction === 'choir' ? 'HEGEMONY' : gd.faction === 'rustwake' ? 'RUSTWAKE' : 'DIRECTORATE'} STANDING ${gd.join.standing >= 0 ? '+' : ''}${gd.join.standing}`;
  if (fact(w, 'player.defected') === true && GUILDS[g].faction === 'concord' && g !== 'keeping') return 'YOU TOOK THE OATH OF A HOUSE. THE DIRECTORATE REMEMBERS.';
  for (const h of sworn(g)) if (rankOf(w, h) >= 4) return `THEY WILL NOT ADMIT A ${GUILDS[h].ranks[rankOf(w, h) - 1].name.toUpperCase()} OF THE ${GUILDS[h].short}`;
  return null;
}

function setRank(w: WorldState, g: GuildId, r: number): WorldState {
  const t = r > 0 ? GUILDS[g].ranks[r - 1].title : '';
  return setFact(setFact(w, key(g, 'rank'), String(r)), key(g, 'title'), t);
}

export function join(w: WorldState, g: GuildId, rep: Record<EconFaction, number>): GuildResult {
  const why = canJoin(w, g, rep);
  if (why) return fail(w, why);
  let next = setRank(w, g, 1);
  next = { ...next, counters: { ...next.counters, [key(g, 'merit')]: 0, [key(g, 'duesAt')]: next.clock, [key(g, 'arrears')]: 0 } };
  if (fact(next, key(g, 'left')) === true) next = setFact(next, key(g, 'left'), false);
  next = record(next, 'guild.join', `guild:${g}`, { rank: 1 });
  return ok(next, [{ text: `ADMITTED · ${GUILDS[g].name.toUpperCase()} · ${GUILDS[g].ranks[0].name.toUpperCase()}`, cls: 'ok' }]);
}

// ── merit & conflicts ───────────────────────────────────────────────────

/**
 * Earn merit in `g`. Rival guilds you also belong to lose a share of it
 * (hostility); a rival whose merit goes below zero expels you.
 */
export function awardMerit(w: WorldState, g: GuildId, amount: number, why = 'work'): GuildResult {
  if (!isMember(w, g) || amount === 0) return ok(w);
  let next = bump(w, key(g, 'merit'), Math.round(amount));
  next = record(next, 'guild.merit', `guild:${g}`, { amount: Math.round(amount), why });
  const notes: GuildResult['notes'] = [{ text: `MERIT ${amount > 0 ? '+' : ''}${Math.round(amount)} · ${GUILDS[g].short}`, cls: amount > 0 ? 'ok' : 'err' }];
  if (amount > 0) {
    for (const h of GUILD_IDS) {
      const k = hostility(g, h);
      if (!k || !isMember(next, h)) continue;
      const loss = Math.round(amount * k);
      if (!loss) continue;
      next = bump(next, key(h, 'merit'), -loss);
      notes.push({ text: `THE ${GUILDS[h].short} HEARD WHO YOU WORK FOR · MERIT −${loss}`, cls: 'err' });
      if (meritOf(next, h) < 0) {
        const r = expel(next, h, `worked for the ${GUILDS[g].short}`);
        next = r.world;
        notes.push(...r.notes);
      }
    }
  }
  return ok(next, notes);
}

// ── rank ────────────────────────────────────────────────────────────────

/** Why the next rank can't be conferred yet (null = it can). `arcDone` = the guild arc's finale is behind you. */
export function promotionBlock(w: WorldState, g: GuildId, rep: Record<EconFaction, number>): string | null {
  const r = rankOf(w, g);
  if (r === 0) return 'NOT A MEMBER';
  if (r >= MAX_RANK) return 'HIGHEST RANK';
  const next = r + 1;
  if (meritOf(w, g) < RANK_MERIT[next]) return `MERIT ${meritOf(w, g)}/${RANK_MERIT[next]}`;
  const need = GUILDS[g].rankStanding[next];
  if ((rep[GUILDS[g].faction] ?? 0) < need) return `STANDING ${need >= 0 ? '+' : ''}${need} NEEDED`;
  if (next >= TOP_RANK) {
    for (const h of GUILD_IDS) if (h !== g && rankOf(w, h) >= TOP_RANK) return `EXCLUSIVE — YOU ARE ${GUILDS[h].ranks[rankOf(w, h) - 1].name.toUpperCase()} OF THE ${GUILDS[h].short}`;
    if (fact(w, `arc.${g}.done`) !== true) return 'COMPLETE THE GUILD’S ARC FIRST';
    // The honour path's top ranks are for the sworn.
    if (g === 'houses' && fact(w, 'houses.oath') !== 'sworn') return 'ONLY THE SWORN RISE FURTHER';
  }
  if (duesPeriods(w, g) >= 2) return 'DUES IN ARREARS';
  return null;
}

export function promote(w: WorldState, g: GuildId, rep: Record<EconFaction, number>): GuildResult {
  const why = promotionBlock(w, g, rep);
  if (why) return fail(w, why);
  const r = rankOf(w, g) + 1;
  let next = setRank(w, g, r);
  next = record(next, 'guild.rank', `guild:${g}`, { rank: r });
  const gd = GUILDS[g];
  const repDelta: Rep = {};
  for (const [f, d] of Object.entries(gd.rankUpRep) as [EconFaction, number][]) repDelta[f] = d;
  const notes: GuildResult['notes'] = [{ text: `RAISED · ${gd.ranks[r - 1].name.toUpperCase()} OF THE ${gd.short}`, cls: 'ok' }];
  for (const [f, d] of Object.entries(repDelta)) notes.push({ text: `${f === 'concord' ? 'THE DIRECTORATE' : f === 'choir' ? 'THE HEGEMONY' : 'THE CLANS'} NOTICED · STANDING ${d! > 0 ? '+' : ''}${d}`, cls: d! < 0 ? 'err' : 'ok' });
  return ok(next, notes, repDelta);
}

// ── dues ────────────────────────────────────────────────────────────────

/** Whole dues periods owed. */
export function duesPeriods(w: WorldState, g: GuildId): number {
  if (!isMember(w, g)) return 0;
  return Math.max(0, Math.floor((w.clock - counter(w, key(g, 'duesAt'))) / DUES_PERIOD));
}

export function duesOwed(w: WorldState, g: GuildId): number {
  return duesPeriods(w, g) * GUILDS[g].dues.perRank * rankOf(w, g);
}

/** Settle every period owed in shares, or one period in goods (`inKind`). */
export function payDues(w: WorldState, g: GuildId, l: TradeLedger, inKind = false): { world: WorldState; ledger: TradeLedger; error?: string; text: string } {
  const n = duesPeriods(w, g);
  if (!n) return { world: w, ledger: l, text: 'NOTHING OWED', error: 'NOTHING OWED' };
  const gd = GUILDS[g];
  const at = counter(w, key(g, 'duesAt'));
  if (inKind) {
    const alt = gd.dues.alt;
    if (!alt) return { world: w, ledger: l, error: 'THIS GUILD TAKES SHARES', text: 'THIS GUILD TAKES SHARES' };
    if ((l.cargo[alt.cid] ?? 0) < alt.units) return { world: w, ledger: l, error: `NEED ${alt.label.toUpperCase()}`, text: `NEED ${alt.label.toUpperCase()}` };
    const cargo = { ...l.cargo, [alt.cid]: (l.cargo[alt.cid] ?? 0) - alt.units };
    if (!cargo[alt.cid]) delete cargo[alt.cid];
    let next = { ...w, counters: { ...w.counters, [key(g, 'duesAt')]: at + DUES_PERIOD, [key(g, 'arrears')]: Math.max(0, counter(w, key(g, 'arrears')) - 1) } };
    next = record(next, 'guild.dues', `guild:${g}`, { periods: 1, inKind: alt.cid });
    return { world: next, ledger: { ...l, cargo }, text: `${gd.dues.label} PAID IN KIND · ${alt.label.toUpperCase()}` };
  }
  const due = duesOwed(w, g);
  if (l.credits < due) return { world: w, ledger: l, error: `INSUFFICIENT SHARES — ${due.toLocaleString('en-US')} sh OWED`, text: '' };
  let next = { ...w, counters: { ...w.counters, [key(g, 'duesAt')]: at + n * DUES_PERIOD, [key(g, 'arrears')]: 0 } };
  next = record(next, 'guild.dues', `guild:${g}`, { periods: n, shares: due });
  return { world: next, ledger: { ...l, credits: l.credits - due }, text: `${gd.dues.label} PAID · ${due.toLocaleString('en-US')} sh` };
}

/**
 * Arrears: from the second period owed, each new period costs 10 % of merit
 * (once per period); at four the guild expels you. Call occasionally.
 */
export function checkArrears(w: WorldState): GuildResult {
  let next = w;
  const notes: GuildResult['notes'] = [];
  for (const g of GUILD_IDS) {
    if (!isMember(next, g)) continue;
    const n = duesPeriods(next, g);
    if (n >= 4) {
      const r = expel(next, g, 'dues unpaid');
      next = r.world;
      notes.push(...r.notes);
      continue;
    }
    const hit = counter(next, key(g, 'arrears'));
    if (n >= 2 && hit < n - 1) {
      const loss = Math.max(5, Math.round(meritOf(next, g) * 0.1));
      next = bump(next, key(g, 'merit'), -loss);
      next = { ...next, counters: { ...next.counters, [key(g, 'arrears')]: n - 1 } };
      next = record(next, 'guild.arrears', `guild:${g}`, { periods: n, merit: -loss });
      notes.push({ text: `${GUILDS[g].dues.label} IN ARREARS · ${GUILDS[g].short} MERIT −${loss}`, cls: 'err' });
    }
  }
  return ok(next, notes);
}

// ── leaving ─────────────────────────────────────────────────────────────

export function leave(w: WorldState, g: GuildId): GuildResult {
  if (!isMember(w, g)) return fail(w, 'NOT A MEMBER');
  const r = rankOf(w, g);
  let next = setRank(w, g, 0);
  next = setFact(next, key(g, 'left'), true);
  next = { ...next, counters: { ...next.counters, [key(g, 'merit')]: 0 } };
  next = record(next, 'guild.leave', `guild:${g}`, { rank: r });
  return ok(next, [{ text: `LEFT THE ${GUILDS[g].short} · ${GUILDS[g].farewell.toUpperCase()}` }]);
}

export function expel(w: WorldState, g: GuildId, why: string): GuildResult {
  if (!isMember(w, g)) return ok(w);
  const r = rankOf(w, g);
  let next = setRank(w, g, 0);
  next = setFact(next, key(g, 'expelled'), true);
  next = { ...next, counters: { ...next.counters, [key(g, 'merit')]: 0 } };
  next = record(next, 'guild.expelled', `guild:${g}`, { rank: r, why });
  return ok(next, [{ text: `EXPELLED FROM THE ${GUILDS[g].short} — ${why.toUpperCase()}`, cls: 'err' }]);
}

/** Title line for a greeting ({title} filled). */
export function greeting(w: WorldState, g: GuildId): string {
  const r = rankOf(w, g);
  const gd = GUILDS[g];
  const line = r === 0 ? gd.greet[0] : r < 4 ? gd.greet[1] : gd.greet[2];
  const t = titleIn(w, g) || 'pilot';
  return line.replace(/\{title\}/g, t.charAt(0).toUpperCase() + t.slice(1));
}
