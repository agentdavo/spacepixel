/**
 * Guild work — guild-flavoured contracts built from the contract generator's
 * own kinds (makeOffer), re-voiced by the guild's quartermaster and paid in
 * shares plus merit (and, for the clans, part of the fee in Ebon grams).
 * They are ordinary Contracts: the ContractDesk books, runs and settles them;
 * the guild runtime pays the merit when the receipt comes back.
 *
 * Pure: runs under node --test.
 */
import { BOARD_PERIOD, boardEpoch, makeOffer, type BoardInput, type Contract, type ContractKind, type Tier } from '../contracts/contracts.ts';
import { GUILDS, TIER_MERIT, WORK_MERIT, type GuildId } from './guilds.ts';

/** Ebon floor: the Schedule's 88 sh a gram (a 10 g flask ≈ 880 sh). */
export const GRAM_PRICE = 88;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(w: Partial<Record<ContractKind, number>>, r: number): ContractKind {
  const e = Object.entries(w) as [ContractKind, number][];
  let total = 0;
  for (const [, v] of e) total += v;
  let x = r * total;
  for (const [k, v] of e) {
    x -= v;
    if (x <= 0) return k;
  }
  return e[e.length - 1][0];
}

/** Merit a guild job pays. */
export function workMerit(kind: ContractKind, tier: Tier): number {
  return Math.round((WORK_MERIT[kind] ?? 25) * TIER_MERIT[tier]);
}

/** Guild voices: how the quartermaster opens and closes a brief. */
const VOICE: Record<GuildId, { open: string[]; close: string[]; title: Partial<Record<ContractKind, string>> }> = {
  keeping: {
    open: ['Chapter-house tasking. Count the Keepings before you light.', 'The wardens ask, pilot. They do not order. They rarely need to.'],
    close: ['Lit, and go.', 'What works is kept. Bring it back working.'],
    title: { salvage: 'Recover a sealed core', courier: 'Carry a blessed core', patrol: 'Walk the wardens’ beat', escort: 'Guard a warden barge' },
  },
  continuity: {
    open: ['Office of Continuity. Purely routine.', 'This conversation is not taking place. The fee, however, is real.'],
    close: ['Everything continues. Everything is recorded.', 'You were never here. Sign on your way out.'],
    title: { courier: 'Continuity post', recon: 'Quiet eyes', bounty: 'Close a file', escort: 'See a witness home' },
  },
  allocation: {
    open: ['By allocation of the Board:', 'The quota is set. The quota is always set. You make it true.'],
    close: ['Every gram accounted.', 'Expenditure within schedule, if you please.'],
    title: { haul: 'Quota consignment', escort: 'Convoy duty', courier: 'Allocation dispatch', patrol: 'Lane audit' },
  },
  rustwake: {
    open: ['Moot business, flyer. Pay’s half in shares, half in grams.', 'Word from the clans, and the clans pay in gas.'],
    close: ['Nothing in the black is ever truly lost.', 'Do it clean and the Moot remembers your paint.'],
    title: { salvage: 'Clan salvage', escort: 'Run the lane', bounty: 'Moot justice', haul: 'Clan haul' },
  },
  houses: {
    open: ['(sung) Be witnessed. The Houses ask a small work of you.', 'The Houses do not hire, pilot. They extend an honour. It happens to pay.'],
    close: ['Ascend.', 'Be witnessed — by us, and only by us.'],
    title: { escort: 'Guard a House barge', bounty: 'End an unwitnessing', recon: 'Witness for the House', patrol: 'Walk the Measure’s line' },
  },
};

export interface GuildBoardInput extends BoardInput {
  guild: GuildId;
  rank: number;
}

/**
 * The guild's board at a hall right now: 2–4 jobs (more as you rise), keyed
 * like the station board (station × epoch × rank × ship tier), so the same
 * visit posts the same work. Empty for non-members.
 */
export function guildOffers(inp: GuildBoardInput): Contract[] {
  if (inp.rank <= 0) return [];
  const g = GUILDS[inp.guild];
  const epoch = boardEpoch(inp.clock);
  const key = `guild:${inp.guild}:${inp.station}#${epoch}.${inp.rank}.${inp.tier}`;
  const rnd = rng(hash(key));
  const n = 2 + Math.min(2, Math.floor(inp.rank / 2));
  const out: Contract[] = [];
  for (let i = 0; i < n + 3 && out.length < n; i++) {
    const kind = weighted(g.work, rnd());
    // Tier follows ship and rank: seniors get the hard jobs.
    const roll = rnd();
    let tier = Math.min(3, Math.max(1, inp.tier + (roll < 0.3 ? -1 : roll > 0.75 && inp.rank >= 3 ? 1 : 0))) as Tier;
    if (inp.rank < 2 && tier === 3) tier = 2;
    const base = makeOffer({ ...inp, priority: null }, kind, tier, `${key}.${i}`);
    if (!base) continue;
    out.push(dress(base, inp.guild, rnd));
  }
  return out;
}

/** Re-voice a generated contract as guild work. */
export function dress(k: Contract, gid: GuildId, rnd: () => number = Math.random): Contract {
  const g = GUILDS[gid];
  const v = VOICE[gid];
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const paras = k.brief.split('\n\n');
  const body = paras.length >= 3 ? paras.slice(1, -1).join('\n\n') : k.brief;
  const merit = workMerit(k.kind, k.tier);
  const out: Contract = {
    ...k,
    guild: gid,
    merit,
    client: g.quartermaster,
    title: `${v.title[k.kind] ?? g.short.charAt(0) + g.short.slice(1).toLowerCase()} — ${k.title}`,
    brief: `${pick(v.open)}\n\n${body}\n\n${pick(v.close)}`,
    // Guild rates: a little better than the open board.
    reward: Math.round((k.reward * 1.1) / 50) * 50,
  };
  if (gid === 'rustwake') {
    // Half the fee in grams (10 g flasks at the Schedule floor), the rest in shares.
    const flasks = Math.max(1, Math.round((out.reward * 0.5) / (GRAM_PRICE * 10)));
    out.grams = flasks * 10;
    out.reward = Math.max(50, Math.round((out.reward - flasks * 10 * GRAM_PRICE) / 50) * 50);
  }
  return out;
}

/** Guild jobs expire with the board epoch like everything else. */
export function repostIn(clock: number): number {
  return (boardEpoch(clock) + 1) * BOARD_PERIOD - clock;
}
