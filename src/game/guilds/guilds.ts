/**
 * Guilds (batch 5 · milestone 1) — the five lore guilds as plain data.
 *
 *   keeping      Order of the Keeping — engine-wardens: tech, relics, repair
 *   continuity   Office of Continuity — intelligence: couriers, audits, spying on your own side
 *   allocation   Board of Allocation — logistics: convoys, Ebon quotas
 *   rustwake     the Rustwake clans — salvage, smuggling, raids; clan marks
 *   houses       Ascendant Houses of Hesper — the Choir's honour path (and, perhaps, defection)
 *
 * Halls sit at specific stations (seats by id, the rest by station kind ×
 * faction). Ranks, rewards, dues and conflicts are data here; the rules that
 * move them live in membership.ts, and every fact about the pilot's standing
 * in a guild lives in the shared WorldState (never a private copy):
 *
 *   counters  guild.<id>.merit           merit earned (conflicts can drain it)
 *             guild.<id>.duesAt          world clock dues were last settled
 *             guild.<id>.arrears         dues periods already penalised
 *   facts     guild.<id>.rank            "0".."6" (string: facts are strings/booleans)
 *             guild.<id>.title           the title NPCs use ("Fire-Warden")
 *             guild.<id>.left / .expelled
 *
 * Pure (type imports only): runs under node --test.
 */
import type { Character } from '../campaign/types';
import type { ContractKind } from '../contracts/contracts';
import type { CommodityId, EconFaction, StationKind } from '../economy';

export type GuildId = 'keeping' | 'continuity' | 'allocation' | 'rustwake' | 'houses';
export const GUILD_IDS: readonly GuildId[] = ['keeping', 'continuity', 'allocation', 'rustwake', 'houses'];

export interface Rank {
  /** Full rank name on the ladder. */
  name: string;
  /** What NPCs call you ("Be witnessed, Cantor"). */
  title: string;
  /** Merit needed to be raised to this rank. */
  merit: number;
  /** One line of lore (the Keeping's ranks are the Seven Keepings). */
  line: string;
  /** What the rank opens (shown on the ladder). */
  perk: string;
}

export interface Guild {
  id: GuildId;
  name: string;
  short: string;
  /** Standing moves with this faction (contracts, rank-ups). */
  faction: EconFaction;
  color: string;
  motto: string;
  blurb: string;
  /** What a hall is called ("chapter-house"). */
  hall: string;
  /** Seat of the guild (station id in the seed-1994 Reach). */
  seat: string;
  /** Guild master (seat) and quartermaster (every hall) — comms characters. */
  master: string;
  quartermaster: string;
  ranks: Rank[];
  /** To be admitted: standing with `faction`. */
  join: { standing: number };
  /** Standing with `faction` needed per rank (index = rank). */
  rankStanding: number[];
  /** Guild work: board kinds and weights (reusing the contract generator's kinds). */
  work: Partial<Record<ContractKind, number>>;
  /** Dues per period, per rank; `alt` pays one period in goods instead. */
  dues: { perRank: number; alt?: { cid: CommodityId; units: number; label: string }; label: string };
  /** Standing change with other factions per rank gained (the guild's enemies notice). */
  rankUpRep: Partial<Record<EconFaction, number>>;
  /** Voice lines (hall greetings), by rank band: [outsider, member, senior]. */
  greet: [string, string, string];
  /** Said when you leave. */
  farewell: string;
}

/** Merit thresholds, rank 1..6 (index 0 = not a member). A rank-up is ~45 minutes of guild work. */
export const RANK_MERIT = [0, 0, 100, 260, 480, 760, 1100];
export const MAX_RANK = 6;
/** Ranks at or above this are exclusive: you may hold one only in a single guild. */
export const TOP_RANK = 5;
/** Outposts: rank 3 in any guild lets you claim a hulk. */
export const OUTPOST_RANK = 3;
/** Dues fall due every two hours of world time. */
export const DUES_PERIOD = 7200;

const R = (name: string, title: string, rank: number, line: string, perk: string): Rank => ({ name, title, merit: RANK_MERIT[rank], line, perk });

export const GUILDS: Record<GuildId, Guild> = {
  keeping: {
    id: 'keeping',
    name: 'Order of the Keeping',
    short: 'KEEPING',
    faction: 'concord',
    color: '#e8d27a',
    motto: 'What works is kept. What is kept is not opened.',
    blurb: 'The engine-wardens: brown robes, shaved heads, a torque-key on a cord. They keep every fossil engine in the Reach alive by litany and will not unseal a single core. Neutral in the war as far as anyone can be — both sides need their drives lit.',
    hall: 'Chapter-house of the Keeping',
    seat: 'anchorage-salvage-1',
    master: 'gd-sorrel',
    quartermaster: 'cl-pell',
    ranks: [
      R('Postulant of the Seal', 'Postulant', 1, 'First keeping: the seal holds.', 'Guild work · the chapter-house quartermaster'),
      R('Keeper of the Feed', 'Feed-Keeper', 2, 'Second keeping: the feed runs clean.', 'Wardens repair your hull at a tithe (−15 %)'),
      R('Fire-Warden', 'Fire-Warden', 3, 'Third keeping: the fire is fed and not starved.', 'Sealed Heart reactor · claim a hulk as an outpost'),
      R('Cold-Warden', 'Cold-Warden', 4, 'Fourth keeping: the cold is let out.', 'Litany Ward shields · the Sixth Keeping'),
      R('Warden of the Old Words', 'Word-Warden', 5, 'Fifth keeping: the old words are said.', 'Relic drive (Mk V) · exclusive rank'),
      R('Sealed Keeper', 'Keeper', 6, 'Sixth keeping: we do not ask the engine why.', 'The Cloister’s own reactor · a voice in the Chapter'),
    ],
    join: { standing: -100 },
    rankStanding: [0, -100, -100, -40, -20, 0, 10],
    work: { salvage: 4, courier: 2, patrol: 1.5, escort: 1 },
    dues: { perRank: 120, alt: { cid: 'spares', units: 1, label: 'a crate of machine spares' }, label: 'TITHE' },
    rankUpRep: {},
    greet: [
      'Count the Keepings before you light, pilot. Every time. Then we will talk.',
      'Lit. The seal holds, {title}. The engines of the Reach have need of you.',
      '{title}. Sit. The old words keep better with company.',
    ],
    farewell: 'Seventh keeping: we thank it, and we go. Go, then — and thank it.',
  },
  continuity: {
    id: 'continuity',
    name: 'Office of Continuity',
    short: 'CONTINUITY',
    faction: 'concord',
    color: '#b8e07a',
    motto: 'Everything continues. Everything is recorded.',
    blurb: 'The Directorate’s intelligence and audit arm. Couriers who never ask, auditors who never stop, and a quiet floor in every bastion where they read everyone’s post — their own side’s first.',
    hall: 'Continuity quiet floor',
    seat: 'meridian-bastion-2',
    master: 'gd-halvard',
    quartermaster: 'cl-moss',
    ranks: [
      R('Stringer', 'Stringer', 1, 'You are on nobody’s list. Keep it that way.', 'Sealed work · the Office quartermaster'),
      R('Courier of Record', 'Courier', 2, 'Sign here, and here. Do not read either.', 'Continuity Courier drive (Mk V)'),
      R('Field Auditor', 'Auditor', 3, 'Every manifest is a confession, if you read it slowly.', 'Auditor’s Needle lasers · claim a hulk as an outpost'),
      R('Case Officer', 'Case Officer', 4, 'You run people now. They will not all come home.', 'Quiet Rail missiles · Engagement 114'),
      R('Controller', 'Controller', 5, 'The Office does not have enemies. It has files.', 'Exclusive rank · the Office’s own shields'),
      R('Principal of Continuity', 'Principal', 6, 'You have seen the Schedule. You may say nothing.', 'A desk at the Counting House'),
    ],
    join: { standing: 10 },
    rankStanding: [0, 10, 15, 20, 30, 45, 60],
    work: { courier: 3, recon: 3, bounty: 1.5, escort: 0.6 },
    dues: { perRank: 90, label: 'CLEARANCE FEE' },
    rankUpRep: { rustwake: -2 },
    greet: [
      'You are not expected. Sit down anyway; we will find a file for you.',
      'Ah. {title}. Your post is waiting, and so, I am afraid, are the questions.',
      '{title}. Close the door. No — the other one as well.',
    ],
    farewell: 'You will be missed, of course. And recorded.',
  },
  allocation: {
    id: 'allocation',
    name: 'Board of Allocation',
    short: 'ALLOCATION',
    faction: 'concord',
    color: '#7dffb2',
    motto: 'Every gram accounted.',
    blurb: 'Who eats, flies and dies, in grams. The Board’s logistics wing runs the convoys, sets the Ebon quotas and budgets for expenditure. Allocator-General Pryce never says “death”. His officers learn not to either.',
    hall: 'Allocation counting room',
    seat: 'meridian-orbital-0',
    master: 'gd-rourke',
    quartermaster: 'cl-halloran',
    ranks: [
      R('Tally-Hand', 'Tally-Hand', 1, 'Count it twice. Sign once.', 'Convoy work · the counting-room quartermaster'),
      R('Consignment Officer', 'Consignment Officer', 2, 'The manifest is the cargo. The cargo is only freight.', 'Allocation Hold cargo bays (Mk V)'),
      R('Convoy Warden', 'Convoy Warden', 3, 'Expenditure within schedule.', 'Quota Plate armour · claim a hulk as an outpost'),
      R('Quota-Master', 'Quota-Master', 4, 'Eleven million mouths. You know the number now.', 'Quota Night'),
      R('Deputy Allocator', 'Deputy Allocator', 5, 'Discretionary expenditure is at your discretion.', 'Exclusive rank · the Board’s own reactors'),
      R('Allocator of the Schedule', 'Allocator', 6, 'No engagement shall be decisive.', 'A signature on the Schedule'),
    ],
    join: { standing: 0 },
    rankStanding: [0, 0, 5, 15, 25, 40, 55],
    work: { haul: 3, escort: 3, courier: 1.5, patrol: 1 },
    dues: { perRank: 150, alt: { cid: 'rations', units: 4, label: 'four pallets of rations' }, label: 'QUOTA LEVY' },
    rankUpRep: { rustwake: -1 },
    greet: [
      'You are not on the Schedule, pilot. That can be arranged, for a price.',
      '{title}. Sit. The quota does not wait and neither, I am told, do you.',
      '{title}. The Allocator-General sends his regards. He sent them in grams.',
    ],
    farewell: 'Your line is closed. The Board thanks you for your expenditure.',
  },
  rustwake: {
    id: 'rustwake',
    name: 'Rustwake Clans',
    short: 'CLANS',
    faction: 'rustwake',
    color: '#ffae4f',
    motto: 'Nothing in the black is ever truly lost.',
    blurb: 'Thirty-odd clans skimming the Ember’s last breath: Clan Tey and the Graveyard Breakers, the Moot-Hold, the Scrapjack crews. They vote by shouting, pay in grams and favours, and mark their own in paint.',
    hall: 'Clan moot',
    seat: 'rustwake-freeport-0',
    master: 'cl-ferrow',
    quartermaster: 'cl-rusk',
    ranks: [
      R('Hullrat', 'hullrat', 1, 'No mark yet. Nobody owes you anything. Yet.', 'Clan work, paid in grams · the breakers’ stall'),
      R('First Mark', 'marked hand', 2, 'One stripe of clan paint, scratched on by the Moot-Speaker.', 'Clan Harpoon launchers (Mk V)'),
      R('Second Mark', 'twice-marked', 3, 'Two stripes. The Moot knows your name when it shouts.', 'Ember Scrap Pair · claim a hulk as an outpost'),
      R('Haul-Captain', 'Haul-Captain', 4, 'You sing the haul-song first now.', 'Graveyard Hulk Drive · the Ember’s Last Skim'),
      R('Moot-Voice', 'Moot-Voice', 5, 'When you shout, clans vote.', 'Exclusive rank · the Breakers’ plate'),
      R('Ember-Chief', 'Ember-Chief', 6, 'The Ember has five winters left. They are yours to count.', 'A clan of your own'),
    ],
    join: { standing: -15 },
    rankStanding: [0, -15, -5, 0, 10, 25, 40],
    work: { salvage: 3, escort: 2, bounty: 2, haul: 1.5 },
    dues: { perRank: 100, alt: { cid: 'ebon', units: 1, label: 'ten grams to the Moot' }, label: 'MOOT SHARE' },
    rankUpRep: { concord: -1 },
    greet: [
      'Directorate paint, is it? Everybody’s got a paint job. Speak up, hullrat-to-be.',
      'Oi — {title}! Pull up a crate. Channel nine’s been asking after you.',
      '{title}. The Moot stands when you walk in. Mostly because it’s been drinking.',
    ],
    farewell: 'Scrape your mark off yourself. The Moot won’t do it for you.',
  },
  houses: {
    id: 'houses',
    name: 'Ascendant Houses of Hesper',
    short: 'HOUSES',
    faction: 'choir',
    color: '#ff5fd0',
    motto: 'What is lifted must be worthy.',
    blurb: 'Eleven Houses — nineteen once — keep the Hegemony’s pedigree and elect the Zenith for life. They do not hire. They witness. A Directorate pilot on the honour path is a scandal, a curiosity and, if the Houses are patient, a convert.',
    hall: 'House embassy',
    seat: 'hesper-orbital-0',
    master: 'gd-casimir',
    quartermaster: 'cl-carrow',
    ranks: [
      R('Witnessed Guest', 'guest', 1, 'Be witnessed. It is the first thing, and the last.', 'The honour path · the embassy’s gardener'),
      R('Postulant of the Measure', 'Postulant', 2, 'You fly beside the Measure. You do not yet sing.', 'Chord of the House emitters (Mk V)'),
      R('Cantor of the Lesser Measure', 'Cantor', 3, '(sung) What is lifted must be worthy.', 'Choral Ward (Mk V) · claim a hulk as an outpost'),
      R('Cantor of the Greater Measure', 'Cantor', 4, '(sung) What is worthy climbs alone.', 'What Is Lifted'),
      R('Knight-Cantor of a House', 'Knight-Cantor', 5, 'A House has put its name on your hull.', 'Exclusive rank · the House’s harmonic core'),
      R('Ascendant', 'Ascendant', 6, 'Adopted. Your children, should you have any, will be witnessed.', 'A seat in the Houses'),
    ],
    join: { standing: 0 },
    rankStanding: [0, 0, 10, 20, 35, 50, 65],
    work: { escort: 3, bounty: 2, recon: 1.5, patrol: 1.5 },
    dues: { perRank: 200, alt: { cid: 'luxury', units: 1, label: 'an offering of choir-glass' }, label: 'OFFERING' },
    rankUpRep: { concord: -3 },
    greet: [
      '(sung) Be witnessed. …A Directorate pilot, at our door. How unusual. Come in.',
      'Be witnessed, {title}. The Houses remember who comes back.',
      '{title}. (sung) Ascend. The Altitude has asked your name twice this week.',
    ],
    farewell: 'You were witnessed. That cannot be taken back. Ascend, elsewhere.',
  },
};

// ── halls ───────────────────────────────────────────────────────────────

export interface HallStation {
  id: string;
  kind: StationKind;
  faction: EconFaction;
}

/** Seats and a few explicit halls, by station id (seed-1994 Reach). */
const EXPLICIT: Record<string, GuildId> = {
  'anchorage-salvage-1': 'keeping', // the Cloister chapter-house at the Graveyard
  'anchorage-bastion-0': 'keeping', // wardens of the fleet yards
  'meridian-bastion-2': 'continuity',
  'null-bastion-0': 'continuity', // where the Signal is logged, and suppressed
  'meridian-orbital-0': 'allocation', // the Counting House's counting room
  'meridian-refinery-1': 'allocation', // Tey refinery: quotas at the source
  'rustwake-freeport-0': 'rustwake', // the Moot-Hold
  'hesper-orbital-0': 'houses', // the Spire
  'hesper-freeport-1': 'houses',
};

/**
 * Which guild keeps a hall at this station, if any (at most one per station).
 * Seats and explicit halls first; elsewhere by kind × faction: Directorate
 * breakers' yards host the Keeping, picket bastions Continuity, refineries
 * and orbital ports the Board; clan free ports and breakers the Moot;
 * Hegemony orbital ports a House embassy.
 */
export function hallAt(st: HallStation): GuildId | null {
  if (st.id.startsWith('outpost-')) return null; // outposts carry an annex, not a hall (outposts.ts)
  const e = EXPLICIT[st.id];
  if (e) return e;
  if (st.kind === 'carrier') return null;
  switch (st.faction) {
    case 'concord':
      return st.kind === 'salvage' ? 'keeping' : st.kind === 'bastion' ? 'continuity' : st.kind === 'refinery' || st.kind === 'orbital' ? 'allocation' : null;
    case 'rustwake':
      return st.kind === 'freeport' || st.kind === 'salvage' ? 'rustwake' : null;
    case 'choir':
      return st.kind === 'orbital' ? 'houses' : null;
    default:
      return null;
  }
}

export function isSeat(g: GuildId, stationId: string): boolean {
  return GUILDS[g].seat === stationId;
}

// ── conflicts ───────────────────────────────────────────────────────────

/**
 * How much merit a guild loses (as a fraction of what you earn with the
 * other) when you work for its rival. Symmetric. The Keeping is neutral-ish:
 * only the Houses' converts trouble it.
 */
const HOSTILITY: [GuildId, GuildId, number][] = [
  ['continuity', 'rustwake', 0.5],
  ['houses', 'continuity', 0.5],
  ['houses', 'allocation', 0.35],
  ['allocation', 'rustwake', 0.2],
  ['houses', 'keeping', 0.1],
];

export function hostility(a: GuildId, b: GuildId): number {
  if (a === b) return 0;
  for (const [x, y, k] of HOSTILITY) if ((x === a && y === b) || (x === b && y === a)) return k;
  return 0;
}

/** Guilds that will not admit a senior (rank ≥ 4) member of `g`. */
export function sworn(g: GuildId): GuildId[] {
  return GUILD_IDS.filter((h) => hostility(g, h) >= 0.35);
}

/** Merit per guild contract (by kind, before the tier multiplier). */
export const WORK_MERIT: Partial<Record<ContractKind, number>> = { courier: 24, haul: 26, escort: 34, bounty: 38, patrol: 30, salvage: 34, recon: 36 };
export const TIER_MERIT = [0, 1, 1.4, 1.85];

// ── people ──────────────────────────────────────────────────────────────

const ch = (id: string, callsign: string, name: string, role: string, faction: Character['faction'], voice: string, portrait: Character['portrait'], commsColor: string): Character => ({ id, callsign, name, role, faction, voice, portrait, commsColor });

/**
 * Guild masters (new faces) — the quartermasters are the contract clients
 * already on the boards (Pell, Moss, Halloran, Rusk, Carrow) and the Moot's
 * Speaker Ada Ferrow. Arc missions add a few more voices.
 */
export const GUILD_CAST: Character[] = [
  ch('gd-sorrel', 'WARDEN-MOTHER', 'Warden-Mother Agathe Sorrel', 'Mother of the Cloister chapter-house, Anchorage', 'concord', 'Eighty and unhurried; counts the Keepings on knuckles swollen by forty winters of cold engines.',
    { skin: '#e9c9a8', hair: '#e8e4dc', eyes: '#8a6a3a', suit: '#6b4a2c', hairStyle: 'shaved', accessory: 'hood', seed: 5101 }, '#e8d27a'),
  ch('gd-halvard', 'CONTROLLER', 'Controller Imre Halvard', 'Office of Continuity, Meridian quiet floor', 'concord', 'Pleasant, patient, never raises his voice. Remembers your mother’s ration number.',
    { skin: '#d8b89a', hair: '#3a3a44', eyes: '#6a8a9a', suit: '#26252e', hairStyle: 'swept', accessory: 'glasses', seed: 5102 }, '#b8e07a'),
  ch('gd-rourke', 'DEP. ALLOCATOR', 'Deputy Allocator Faustin Rourke', 'Board of Allocation, the Counting House', 'concord', 'Brisk, cheerful, frightening. Says “expenditure” the way other men say “weather”.',
    { skin: '#efd0b4', hair: '#8a5a3a', eyes: '#4a6a9a', suit: '#2b4ea8', hairStyle: 'short', accessory: 'none', seed: 5103 }, '#7dffb2'),
  ch('gd-casimir', 'HERALD', 'Dame-Herald Celestine of House Casimir', 'Herald of the Ascendant Houses, the Spire', 'choir', 'Sings her consonants. Treats every Directorate pilot as a promising child.',
    { skin: '#f6dcc6', hair: '#d8c8ff', eyes: '#ff5fb4', suit: '#3b2f5a', hairStyle: 'long', accessory: 'none', seed: 5104 }, '#ff5fd0'),
  // Arc voices.
  ch('gd-oake', 'SAINT MAUDLIN', 'Warden-Brother Oswin Oake', 'Barge-warden, the Saint Maudlin', 'concord', 'Young, earnest, counts the Keepings too fast when he is frightened.',
    { skin: '#c98e5e', hair: '#141418', eyes: '#3a5a4a', suit: '#7a5a3a', hairStyle: 'shaved', accessory: 'headset', seed: 5105 }, '#e8d27a'),
  ch('gd-wick', 'WICK', 'Lamplighter Jory Wick', 'Clan informant, formerly of the Tey skim-crews', 'rustwake', 'Talks too much when nervous, which is always.',
    { skin: '#d9a47a', hair: '#d14b1f', eyes: '#6fe6ff', suit: '#8a5a2a', hairStyle: 'spiky', accessory: 'goggles', seed: 5106 }, '#ffae4f'),
  ch('gd-crowe', 'PAYMASTER', 'Paymaster Ansel Crowe', 'Deserter, formerly Board of Allocation', 'concord', 'An accountant who ran with the books. Sweats, bargains, never shouts.',
    { skin: '#e8c4a0', hair: '#26283a', eyes: '#9fffb0', suit: '#6c737e', hairStyle: 'bob', accessory: 'glasses', seed: 5107 }, '#ff5f7a'),
  ch('gd-tey', 'OLD TEY', 'Hester Tey, clan-mother', 'Clan Tey, the Ember skim-lanes', 'rustwake', 'Great-granddaughter of Absalom Tey. Speaks slowly, as if every word cost a gram.',
    { skin: '#b87a4a', hair: '#e8e4dc', eyes: '#ffd21f', suit: '#6b4a2c', hairStyle: 'ponytail', accessory: 'scar', seed: 5108 }, '#ffae4f'),
  ch('gd-breaker', 'BONE-BOSS', 'Bone-Boss Magnus Ure', 'Graveyard Breakers, crew boss', 'rustwake', 'Laughs like a cutting torch. Owns eleven hulks and wants a twelfth.',
    { skin: '#6e452c', hair: '#141418', eyes: '#ff9b3f', suit: '#34151c', hairStyle: 'short', accessory: 'beard', seed: 5109 }, '#ffc46b'),
  ch('gd-verity', 'LESSER MEASURE', 'Cantor Verity of House Casimir', 'Leader of a Lesser Measure', 'choir', 'Nineteen, fearless, sings on the attack a half-tone sharp.',
    { skin: '#e6c09a', hair: '#b56bff', eyes: '#ff5fb4', suit: '#1d1a26', hairStyle: 'ponytail', accessory: 'visor', seed: 5110 }, '#ff5fb4'),
];

export function guildCharacter(id: string): Character | undefined {
  return GUILD_CAST.find((c) => c.id === id);
}

/** Voice traits for the guild cast (concourse / hall voices). */
export const GUILD_VOICES: Record<string, { sex: 'f' | 'm'; age: 'young' | 'adult' | 'old'; temper?: 'calm' | 'nervous' | 'weary' | 'loud' }> = {
  'gd-sorrel': { sex: 'f', age: 'old', temper: 'calm' },
  'gd-halvard': { sex: 'm', age: 'adult', temper: 'calm' },
  'gd-rourke': { sex: 'm', age: 'adult', temper: 'loud' },
  'gd-casimir': { sex: 'f', age: 'adult', temper: 'calm' },
  'gd-oake': { sex: 'm', age: 'young', temper: 'nervous' },
  'gd-wick': { sex: 'm', age: 'young', temper: 'nervous' },
  'gd-crowe': { sex: 'm', age: 'adult', temper: 'nervous' },
  'gd-tey': { sex: 'f', age: 'old', temper: 'weary' },
  'gd-breaker': { sex: 'm', age: 'adult', temper: 'loud' },
  'gd-verity': { sex: 'f', age: 'young', temper: 'loud' },
  'cl-pell': { sex: 'f', age: 'old', temper: 'calm' },
  'cl-moss': { sex: 'm', age: 'old', temper: 'calm' },
  'cl-halloran': { sex: 'f', age: 'adult', temper: 'weary' },
  'cl-ferrow': { sex: 'f', age: 'adult', temper: 'loud' },
  'cl-rusk': { sex: 'm', age: 'adult' },
  'cl-carrow': { sex: 'f', age: 'adult', temper: 'calm' },
};
