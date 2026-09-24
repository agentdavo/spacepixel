/**
 * Rivals (batch 5 · milestone 8): named aces and bounty targets who remember
 * you and escalate. Pure data + functions over the shared world memory
 * (src/game/world/WorldState.ts); the flight runtime is RivalDirector.ts.
 *
 * Each rival has a face and a voice, a ship per tier (they come back
 * upgraded), a personality (radio lines + AI personality: aggression / skill /
 * reaction), the systems they hunt, and a grudge meter (0–10) fed by what you
 * do: kill their wingmen, break their ambushes, take their bounty, beat them.
 * They wake on world conditions, intercept on lanes (or lead a traffic
 * ambush) when the grudge and their cooldowns allow, retreat when beaten and
 * return a tier up — until the tier where going down is for good. Two of them
 * (Ismene, Skerry) go to ground after their first beating and can be turned
 * into wingmen in conversation.
 *
 *   fact    npc.<id>.status   dormant | hunting | retreated | hiding | dead | ally | spared | jailed
 *   counter npc.<id>.grudge   0..10
 *   counter npc.<id>.tier     0..2   (ship + wing + skill)
 *   counter npc.<id>.next     world clock before which they won't show again
 *   counter npc.<id>.met / .beaten / .wins
 *   counter rivals.next       global cooldown (no rival spam)
 *   events  rival.wakes / rival.met / rival.beaten / rival.killed / rival.won / rival.wing-down
 */
import type { PortraitSpec } from '../campaign/types';
import type { Conversation, DialogChoice, DialogNode, Effect } from '../../dialog/types';
import { MARK_CAST, markId } from '../contracts/contracts.ts';
import { counter, fact, record, setFact, type WorldEvent, type WorldState } from '../world/WorldState.ts';
import { evalTrigger, type ArcCtx, type Trigger } from '../npc/arcs.ts';
import { recall } from '../npc/memory.ts';

export type RivalStatus = 'dormant' | 'hunting' | 'retreated' | 'hiding' | 'dead' | 'ally' | 'spared' | 'jailed';
export type RivalFaction = 'rustwake' | 'choir' | 'concord';
export type LineKind = 'intro' | 'taunt' | 'grudge' | 'wing' | 'retreat' | 'back' | 'death' | 'win' | 'ally';

export interface RivalShip {
  blueprint: string;
  wing: { blueprint: string; count: number };
  /** AI personality (src/sim/ai/state.ts): aim, trigger discipline, steering. */
  skill: number;
  aggression: number;
  reaction: number;
  /** Hull multiplier over the stock hull. */
  hull: number;
}

export interface Rival {
  id: string;
  name: string;
  callsign: string;
  /** The bounty-board name when they are one of the board's marks (contracts.ts MARKS). */
  mark?: string;
  faction: RivalFaction;
  role: string;
  personality: 'showman' | 'cold' | 'zealot' | 'wry' | 'honourable' | 'professional';
  blurb: string;
  portrait: PortraitSpec;
  color: string;
  voice: { sex: 'f' | 'm'; age: 'young' | 'adult' | 'old'; temper: 'calm' | 'nervous' | 'weary' | 'loud' };
  /** Ship by tier (0, 1, 2). */
  ships: [RivalShip, RivalShip, RivalShip];
  /** System factions / ids they hunt in. */
  haunts: { factions: string[]; systems?: string[] };
  /** Dormant → hunting when this holds. */
  wakes: Trigger;
  /** Lane intercepts need at least this much grudge. */
  minGrudge: number;
  /** Leads Rustwake traffic ambushes. */
  ambusher?: boolean;
  /** From this tier on, going down is for good. */
  mortalTier: number;
  /** Goes to ground on these concourses after the first beating (ally path). */
  hides?: string[];
  /** Grudge from a world event (already filtered to their haunts or naming them). */
  grudge(e: WorldEvent): number;
  lines: Record<LineKind, string[]>;
}

const M = 60;

/** Lane cooldown after any rival encounter (no rival spam). */
export const GLOBAL_COOLDOWN = 12 * M;
/** A rival won't show again this soon after meeting you. */
export const RIVAL_COOLDOWN = 25 * M;
/** After a beating: time to lick wounds (and upgrade). */
export const RETREAT_COOLDOWN = 40 * M;
/** How long a beaten rival stays findable on a concourse. */
export const HIDE_WINDOW = 90 * M;
export const GRUDGE_MAX = 10;

const markPortrait = (name: string): PortraitSpec => MARK_CAST.find((c) => c.id === markId(name))!.portrait;
const ship = (blueprint: string, wingBp: string, count: number, skill: number, aggression: number, reaction: number, hull: number): RivalShip => ({ blueprint, wing: { blueprint: wingBp, count }, skill, aggression, reaction, hull });
const kindOf = (e: WorldEvent) => (typeof e.data?.kind === 'string' ? e.data.kind : '');

export const RIVALS: Rival[] = [
  {
    id: 'red-sabine',
    name: 'Red Sabine',
    callsign: 'RED SABINE',
    mark: 'Red Sabine',
    faction: 'rustwake',
    role: 'Outlaw raider — paints her kills on the hull',
    personality: 'showman',
    blurb: 'Leads lane ambushes in clan and border space. Every pilot she beats goes on the hull in paint. She wants your shade of Directorate white.',
    portrait: markPortrait('Red Sabine'),
    color: '#ff5f7a',
    voice: { sex: 'f', age: 'adult', temper: 'loud' },
    ships: [ship('rw-scrapjack', 'rw-scrapjack', 2, 0.7, 0.85, 0.22, 1.6), ship('rw-knuckleduster', 'rw-scrapjack', 2, 0.8, 0.9, 0.18, 2.0), ship('rw-knuckleduster', 'rw-scrapjack', 3, 0.9, 0.95, 0.15, 2.6)],
    haunts: { factions: ['rustwake', 'contested'] },
    wakes: { clock: 20 * M },
    minGrudge: 2,
    ambusher: true,
    mortalTier: 2,
    grudge: (e) => (e.kind === 'ambush.broken' ? 1 : e.kind === 'contract.done' && kindOf(e) === 'bounty' ? 1 : 0),
    lines: {
      intro: ['Directorate white! I\'ve wanted that shade for my hull. Hold still, love — I\'m painting you on.', 'Red Sabine, open band. Say your name slowly so I spell it right on the hull.'],
      taunt: ['There\'s a space under my canopy just your size.', 'Wobble all you like. Paint doesn\'t care.', 'Every kill on my hull had a lovely paint job too.'],
      grudge: ['{memory} I remember. I painted a little question mark where you should be.', '{memory} That was my prize, you thief.'],
      wing: ['That was my wing! That\'s two coats of paint you owe me.', 'You scratched my boy! Oh, I\'ll do you in gloss for that.'],
      retreat: ['Not today — I\'ve a bigger brush at home! Keep the canopy clean for me!', 'Breaking off! Don\'t you dare let anyone else paint you!'],
      back: ['New hull, new paint, same old grudge. Miss me?', 'Look what the clans built me. Pretty, isn\'t she? Your colour\'s next.'],
      death: ['Paint me — paint me gold —', 'Oh. Oh, that\'s a lovely shade of —'],
      win: ['Tell the tug to go gentle. I want your paint intact.'],
      ally: ['—'],
    },
  },
  {
    id: 'ninefingers',
    name: "Hollis 'Ninefingers' Crane",
    callsign: 'NINEFINGERS',
    mark: "Hollis 'Ninefingers' Crane",
    faction: 'rustwake',
    role: 'Outlaw broker — bought Magpie\'s paper',
    personality: 'cold',
    blurb: 'Outlawed by the Moot for selling clan routes to both Boards. Buys debts, collects in hulls. Hunts Magpie, and anyone who flies with her.',
    portrait: markPortrait("Hollis 'Ninefingers' Crane"),
    color: '#ffae4f',
    voice: { sex: 'm', age: 'old', temper: 'calm' },
    ships: [ship('rw-gaff', 'rw-scrapjack', 2, 0.66, 0.6, 0.22, 1.5), ship('rw-scrapjack', 'rw-scrapjack', 2, 0.76, 0.65, 0.2, 2.0), ship('rw-knuckleduster', 'rw-scrapjack', 3, 0.86, 0.7, 0.16, 2.4)],
    haunts: { factions: ['rustwake', 'contested'] },
    wakes: { any: [{ fact: 'npc.ninefingers.hunting', is: 'magpie' }, { clock: 70 * M }] },
    minGrudge: 2,
    ambusher: true,
    mortalTier: 2,
    grudge: (e) => (e.kind === 'contract.done' && e.data?.client === 'magpie' ? 2 : e.kind === 'ambush.broken' ? 1 : 0),
    lines: {
      intro: ['You\'ll be Magpie\'s friend. Friends are expensive. I\'ve come to collect the interest.', 'Crane. Nine fingers, nine debts outstanding. You\'re the tenth.'],
      taunt: ['Everything has a price. Yours is falling.', 'I bought a Moot vote once. You\'re cheaper.', 'Nothing in the black is ever truly lost. It\'s just bought.'],
      grudge: ['{memory} I wrote it down. I write everything down.', '{memory} That\'s on your account now, with interest.'],
      wing: ['That cutter was on loan. You\'ve just bought it.', 'Put it on the bill.'],
      retreat: ['Debt deferred, not forgiven. We\'ll settle.', 'Breaking off. Interest accrues, pilot.'],
      back: ['I\'ve refinanced. Better ship, same terms.', 'Did you think the debt died with the hull?'],
      death: ['Tell the Moot — tell them I —', 'Paid in f—'],
      win: ['Consider it a partial payment.'],
      ally: ['—'],
    },
  },
  {
    id: 'ismene',
    name: 'Unwitnessed Ismene',
    callsign: 'ISMENE',
    mark: 'Unwitnessed Ismene',
    faction: 'choir',
    role: 'A Cantor who stopped singing',
    personality: 'zealot',
    blurb: 'Disgraced, silent, and flying anyway. The Choir wants her silence ended; she hunts Directorate pilots to earn a Measure back. Beaten once, she goes to ground.',
    portrait: markPortrait('Unwitnessed Ismene'),
    color: '#ff5fd0',
    voice: { sex: 'f', age: 'young', temper: 'calm' },
    ships: [ship('choir-cantor', 'choir-cantor', 1, 0.72, 0.9, 0.24, 1.6), ship('choir-seraph', 'choir-cantor', 2, 0.82, 0.9, 0.2, 2.0), ship('choir-seraph', 'choir-seraph', 2, 0.9, 0.95, 0.16, 2.4)],
    haunts: { factions: ['choir', 'contested'] },
    wakes: { any: [{ clock: 50 * M }, { episode: 4 }] },
    minGrudge: 1,
    mortalTier: 2,
    hides: ['coraex-freeport', 'zephacis-freeport'],
    grudge: (e) => (e.kind === 'contract.done' && kindOf(e) === 'sortie' ? 2 : 0),
    lines: {
      intro: ['I do not sing any more, Directorate. I only count. One.', 'Unwitnessed. That is my name now. Be witnessed, anyway.'],
      taunt: ['Two.', 'Three. You are loud in the dark.', '(a single struck note on the open band, then silence)'],
      grudge: ['{memory} I witnessed it. Someone had to.', '{memory} The Measure asked. I answered.'],
      wing: ['Sister — no. Count. Keep counting.', 'She sang for me. I could not sing for her.'],
      retreat: ['Not witnessed. Not yet.', 'Breaking. Remember this interval.'],
      back: ['I have a new Measure. It does not sing either.', 'They gave me a Seraph. It is very quiet.'],
      death: ['(sung, very quietly) Out of the dust —', 'Witness m—'],
      win: ['Unwitnessed. Like me.'],
      ally: ['Ismene, on your wing. I will count your kills.', '(sung) Be witnessed — there. I said it.', 'Flying beside a fossil. The Altitude would faint.'],
    },
  },
  {
    id: 'skerry',
    name: 'Corporal Aldo Skerry',
    callsign: 'SKERRY',
    mark: 'Corporal Aldo Skerry',
    faction: 'concord',
    role: 'Deserter, Null picket — took a Kestrel and the coffee',
    personality: 'wry',
    blurb: 'Walked off the Null picket because he couldn\'t listen to the count any more. Robs lone pilots for Ebon. Beaten once, he hides in the clan moots.',
    portrait: markPortrait('Corporal Aldo Skerry'),
    color: '#9fffb0',
    voice: { sex: 'm', age: 'adult', temper: 'weary' },
    ships: [ship('vf27-kestrel', 'vf27-kestrel', 1, 0.74, 0.5, 0.2, 1.5), ship('vf27s-super-kestrel', 'vf27-kestrel', 1, 0.82, 0.55, 0.18, 1.9), ship('vf27s-super-kestrel', 'vf27-kestrel', 2, 0.9, 0.6, 0.15, 2.3)],
    haunts: { factions: ['concord', 'contested', 'rustwake'] },
    wakes: { clock: 40 * M },
    minGrudge: 0,
    mortalTier: 2,
    hides: ['pelourin-freeport', 'quilegard-freeport'],
    grudge: (e) => (e.kind === 'contract.done' && kindOf(e) === 'bounty' && e.data?.mark === 'Corporal Aldo Skerry' ? 3 : 0),
    lines: {
      intro: ['Corporal Skerry, late of the Null picket. Nothing personal — I just need your Ebon. And your coffee.', 'Same paint as me, pilot. Different opinions. Hand over the gas.'],
      taunt: ['I was a good picket pilot. That\'s the problem.', 'Don\'t make me good at this.', 'You hear it too, don\'t you? The count.'],
      grudge: ['{memory} Heard about that on channel nine. You\'re famous, in a small way.', '{memory} I\'d have done the same. That\'s what worries me.'],
      wing: ['Sorry, kid. Sorry.', 'He was just along for the coffee.'],
      retreat: ['Right, that\'s enough heroics for one quarter. Bye!', 'Breaking off. Tell Continuity I said hello, or don\'t.'],
      back: ['Traded up. Super Kestrel. Don\'t ask what it cost; it cost the coffee.', 'Back again. I\'m bad at retiring.'],
      death: ['Tell the picket — I heard it too —', 'Keep the—'],
      win: ['No hard feelings. The tug\'s on me. Well. On you.'],
      ally: ['Skerry on your wing. Just like old times, except I\'m wanted.', 'Nice kill. I\'ll put the kettle on — oh wait.', 'You hear the count out here? No? Good.'],
    },
  },
  {
    id: 'metronome',
    name: 'Cantor-Captain Severin Ashgrove',
    callsign: 'THE METRONOME',
    faction: 'choir',
    role: 'Measure ace, Treaty Line — keeps time for the Choir',
    personality: 'honourable',
    blurb: 'The Choir\'s best timekeeper. Counts your hits aloud and apologises for the ones that land. Hunts pilots who break the Choir off the Schedule.',
    portrait: { skin: '#f0dcd0', hair: '#e8e4f0', eyes: '#ff3fa8', suit: '#1d1729', hairStyle: 'long', accessory: 'visor', seed: 1461 },
    color: '#ff5fb4',
    voice: { sex: 'm', age: 'adult', temper: 'calm' },
    ships: [ship('choir-seraph', 'choir-cantor', 2, 0.8, 0.7, 0.18, 1.8), ship('choir-seraph', 'choir-cantor', 3, 0.88, 0.72, 0.15, 2.2), ship('choir-seraph', 'choir-seraph', 2, 0.95, 0.75, 0.12, 2.8)],
    haunts: { factions: ['choir'], systems: ['zephacis', 'pelourin', 'oryrin'] },
    wakes: { any: [{ episode: 6 }, { clock: 80 * M }, { fact: 'contract.choir-line-escort', is: 'done' }] },
    minGrudge: 2,
    mortalTier: 2,
    grudge: (e) => (e.kind === 'contract.done' && kindOf(e) === 'sortie' ? 3 : e.kind === 'contract.done' && e.data?.client === 'idris' ? -1 : 0),
    lines: {
      intro: ['Cantor-Captain Ashgrove. They call me the Metronome. You are off the beat, Directorate. Allow me.', 'Be witnessed. I will keep time; you will keep up.'],
      taunt: ['One, and two, and — hit. Forgive me.', 'Your rhythm is very Directorate. All counting, no music.', 'Four-four time. Try to keep it.'],
      grudge: ['{memory} It was off the Schedule. Someone must keep time.', '{memory} I noted the tempo. It was ragged.'],
      wing: ['A rest in the bar. We will sing it later.', 'She had perfect pitch. Remember that.'],
      retreat: ['Fermata. I will hold this note until we meet again.', 'Breaking off, with respect. The Measure resumes.'],
      back: ['Da capo. From the top, pilot.', 'A new Measure, better tuned. Shall we?'],
      death: ['(sung) — and the last bar is silence —', 'Rest — rest —'],
      win: ['Forgive me. It was in time.'],
      ally: ['—'],
    },
  },
  {
    id: 'knife',
    name: 'Marek Vosk',
    callsign: 'THE KNIFE',
    faction: 'concord',
    role: 'Office of Continuity — the Hired Knife',
    personality: 'professional',
    blurb: 'Continuity\'s deniable interceptor. Doesn\'t file reports; files people. Wakes when you carry things Continuity would rather stayed uncounted.',
    portrait: { skin: '#e2c2a4', hair: '#2a2a30', eyes: '#b8e07a', suit: '#26252e', hairStyle: 'swept', accessory: 'scar', seed: 1462 },
    color: '#b8e07a',
    voice: { sex: 'm', age: 'adult', temper: 'calm' },
    ships: [ship('vf31-harrier', 'vf31-harrier', 1, 0.8, 0.6, 0.18, 1.7), ship('vf40-gauntlet', 'vf31-harrier', 2, 0.87, 0.65, 0.15, 2.2), ship('vf40-gauntlet', 'vf40-gauntlet', 2, 0.93, 0.7, 0.12, 2.8)],
    haunts: { factions: ['concord', 'contested'] },
    wakes: { any: [{ fact: 'contract.pell-witness', is: 'active' }, { fact: 'npc.pell.witness' }, { fact: 'contract.continuity-courier', is: 'done' }, { episode: 9 }] },
    minGrudge: 1,
    mortalTier: 2,
    grudge: (e) => (e.kind === 'npc.arc' && e.data?.arc === 'pell' && e.data?.step === 'witnessed' ? 3 : e.kind === 'contract.done' && e.data?.client === 'pell' ? 1 : 0),
    lines: {
      intro: ['Vosk. Continuity. You are carrying something that is not yours. Neither, technically, is your life.', 'This is not personal. It is an allocation.'],
      taunt: ['I have your ration card number. It is short.', 'Every gram of you is on a form somewhere.', 'Hold still. It keeps the paperwork tidy.'],
      grudge: ['{memory} It was noted. I am the note.', '{memory} Continuity remembers. That is its whole purpose.'],
      wing: ['Expended. Noted.', 'That was a good pilot. On paper.'],
      retreat: ['Withdrawing. The file stays open.', 'We will resume at a time of Continuity\'s choosing.'],
      back: ['Reallocated. Upgraded. Returned.', 'New airframe. Same form.'],
      death: ['Unscheduled —', 'File it under —'],
      win: ['Salvage tug requisitioned. You\'re welcome.'],
      ally: ['—'],
    },
  },
];

export const RIVAL_BY_ID = new Map(RIVALS.map((r) => [r.id, r]));

/** Comms / concourse id: bounty marks keep their board id so every surface shows the same face. */
export function rivalPersonId(r: Rival): string {
  return r.mark ? markId(r.mark) : `rival-${r.id}`;
}

export function rivalByPerson(id: string): Rival | undefined {
  return RIVALS.find((r) => rivalPersonId(r) === id);
}

export function rivalByMark(markIdOrName: string): Rival | undefined {
  return RIVALS.find((r) => r.mark && (markId(r.mark) === markIdOrName || r.mark === markIdOrName));
}

// ── state ─────────────────────────────────────────────────────────────

export const rk = (id: string, k: string) => `npc.${id}.${k}`;

export interface RivalState {
  status: RivalStatus;
  grudge: number;
  tier: number;
  next: number;
  met: number;
  beaten: number;
  wins: number;
}

const STATUSES: RivalStatus[] = ['dormant', 'hunting', 'retreated', 'hiding', 'dead', 'ally', 'spared', 'jailed'];

export function rivalState(w: WorldState, id: string): RivalState {
  const s = fact(w, rk(id, 'status'));
  return {
    status: typeof s === 'string' && (STATUSES as string[]).includes(s) ? (s as RivalStatus) : 'dormant',
    grudge: counter(w, rk(id, 'grudge')),
    tier: Math.min(2, counter(w, rk(id, 'tier'))),
    next: counter(w, rk(id, 'next')),
    met: counter(w, rk(id, 'met')),
    beaten: counter(w, rk(id, 'beaten')),
    wins: counter(w, rk(id, 'wins')),
  };
}

const setC = (w: WorldState, key: string, v: number): WorldState => (w.counters[key] === v ? w : { ...w, counters: { ...w.counters, [key]: v } });

export function setStatus(w: WorldState, id: string, s: RivalStatus): WorldState {
  return setFact(w, rk(id, 'status'), s);
}

/** Out of the fight for good (or on your side). */
export const gone = (s: RivalStatus) => s === 'dead' || s === 'ally' || s === 'spared' || s === 'jailed';

export function addGrudge(w: WorldState, id: string, n: number): WorldState {
  if (!n || gone(rivalState(w, id).status)) return w;
  return setC(w, rk(id, 'grudge'), Math.max(0, Math.min(GRUDGE_MAX, counter(w, rk(id, 'grudge')) + n)));
}

function hunts(r: Rival, sys: { id: string; faction: string }): boolean {
  return r.haunts.factions.includes(sys.faction) || !!r.haunts.systems?.includes(sys.id);
}

/**
 * Time passes for rivals: dormant ones wake when their condition holds;
 * retreated ones come back when their cooldown runs out; one who went to
 * ground and wasn't found goes back to hunting.
 */
export function tickRivals(w: WorldState, ctx: ArcCtx, rivals: readonly Rival[] = RIVALS): WorldState {
  for (const r of rivals) {
    const st = rivalState(w, r.id);
    if (st.status === 'dormant' && evalTrigger(r.wakes, w, ctx)) {
      w = setStatus(w, r.id, 'hunting');
      w = record(w, 'rival.wakes', `npc:${r.id}`, { rival: r.id, name: r.name });
    } else if ((st.status === 'retreated' || st.status === 'hiding') && ctx.now >= st.next) {
      w = setStatus(w, r.id, 'hunting');
    }
  }
  return w;
}

/** A world event lands: grudges move (in their hunting grounds, or when it names them). */
export function grudgeFromEvent(w: WorldState, e: WorldEvent, sys?: { id: string; faction: string }, rivals: readonly Rival[] = RIVALS): WorldState {
  for (const r of rivals) {
    const about = e.data?.rival === r.id;
    if (!about && sys && !hunts(r, sys)) continue;
    const n = r.grudge(e);
    if (n) w = addGrudge(w, r.id, n);
  }
  return w;
}

// ── encounters ────────────────────────────────────────────────────────

export interface EncounterQuery {
  now: number;
  system: { id: string; faction: string; name?: string };
  /** Lane intercept, or joining a Rustwake traffic ambush. */
  mode: 'lane' | 'ambush';
  seed: number;
  /** Captures / dev: this rival, now, whatever the dice say. */
  force?: string;
}

export interface Encounter {
  rival: Rival;
  tier: number;
  ship: RivalShip;
  /** First time you've met. */
  first: boolean;
  /** Came back upgraded since last time. */
  returning: boolean;
}

function roll(seed: number, id: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Chance a hunting rival shows up on one check. */
export function showChance(r: Rival, grudge: number, mode: 'lane' | 'ambush'): number {
  return Math.min(0.9, mode === 'ambush' ? 0.35 + 0.06 * grudge : 0.12 + 0.07 * (grudge - r.minGrudge));
}

/** Does a rival turn up now? Deterministic from (world, query). */
export function pickEncounter(w: WorldState, q: EncounterQuery, rivals: readonly Rival[] = RIVALS): Encounter | null {
  const make = (r: Rival): Encounter => {
    const st = rivalState(w, r.id);
    return { rival: r, tier: st.tier, ship: r.ships[st.tier], first: st.met === 0, returning: st.beaten > 0 };
  };
  if (q.force) {
    const r = rivals.find((x) => x.id === q.force);
    return r && !gone(rivalState(w, r.id).status) ? make(r) : null;
  }
  if (q.now < counter(w, 'rivals.next')) return null;
  const cands = rivals
    .map((r) => ({ r, st: rivalState(w, r.id) }))
    .filter(({ r, st }) => st.status === 'hunting' && q.now >= st.next && hunts(r, q.system) && (q.mode === 'ambush' ? !!r.ambusher : st.grudge >= r.minGrudge))
    .sort((a, b) => b.st.grudge - a.st.grudge || (a.r.id < b.r.id ? -1 : 1));
  for (const { r, st } of cands) if (roll(q.seed, r.id) < showChance(r, st.grudge, q.mode)) return make(r);
  return null;
}

/** The rival is on scope: met, cooldowns start. */
export function beginEncounter(w: WorldState, id: string, now: number, sysName: string): WorldState {
  const st = rivalState(w, id);
  const r = RIVAL_BY_ID.get(id);
  w = setC(w, rk(id, 'met'), st.met + 1);
  w = setC(w, rk(id, 'next'), now + RIVAL_COOLDOWN);
  w = setC(w, 'rivals.next', now + GLOBAL_COOLDOWN);
  if (st.met === 0) w = record(w, 'rival.met', `npc:${id}`, { rival: id, name: r?.name ?? id, sys: sysName });
  return w;
}

export type EncounterEnd = 'killed' | 'retreated' | 'won' | 'lost-contact';

/**
 * How it ended. `killed` below their mortal tier means they ejected (their
 * people fish them out): it counts as a beating. At or past it, they're dead
 * for good.
 */
export function endEncounter(w: WorldState, id: string, end: EncounterEnd, now: number, sysName: string): WorldState {
  const r = RIVAL_BY_ID.get(id);
  if (!r) return w;
  const st = rivalState(w, id);
  const name = r.name;
  if (end === 'killed' && st.tier >= r.mortalTier) {
    w = setStatus(w, id, 'dead');
    return record(w, 'rival.killed', `npc:${id}`, { rival: id, name, sys: sysName });
  }
  if (end === 'killed' || end === 'retreated') {
    const beaten = st.beaten + 1;
    w = setC(w, rk(id, 'beaten'), beaten);
    w = setC(w, rk(id, 'tier'), Math.min(2, st.tier + 1));
    w = addGrudge(w, id, 3);
    const hide = !!r.hides && beaten === 1;
    w = setStatus(w, id, hide ? 'hiding' : 'retreated');
    w = setC(w, rk(id, 'next'), now + (hide ? HIDE_WINDOW : RETREAT_COOLDOWN));
    return record(w, 'rival.beaten', `npc:${id}`, { rival: id, name, sys: sysName, ...(end === 'killed' ? { ejected: true } : {}) });
  }
  if (end === 'won') {
    w = setC(w, rk(id, 'wins'), st.wins + 1);
    w = addGrudge(w, id, -1);
    w = setC(w, rk(id, 'next'), now + 30 * M);
    return record(w, 'rival.won', `npc:${id}`, { rival: id, name, sys: sysName });
  }
  return setC(w, rk(id, 'next'), now + 20 * M);
}

/** You shot down one of their wing. */
export function wingDown(w: WorldState, id: string, sysName: string, wingman: string): WorldState {
  w = addGrudge(w, id, 1);
  return record(w, 'rival.wing-down', `npc:${id}`, { rival: id, name: RIVAL_BY_ID.get(id)?.name ?? id, sys: sysName, wingman });
}

/** You took a bounty on them off a board (they hear). */
export function bountyTaken(w: WorldState, id: string): WorldState {
  return addGrudge(w, id, 2);
}

/**
 * Their bounty op finished with the mark down (contracts runtime). Below the
 * mortal tier it's a beating (an escape pod the board didn't see); at it,
 * the end.
 */
export function markDown(w: WorldState, id: string, now: number, sysName: string): WorldState {
  const st = rivalState(w, id);
  if (gone(st.status)) return w;
  if (st.status === 'dormant') w = setStatus(w, id, 'hunting');
  return endEncounter(w, id, 'killed', now, sysName);
}

// ── lines ─────────────────────────────────────────────────────────────

/** Memory kinds a rival brings up. */
const RIVAL_KINDS = ['rival.beaten', 'rival.wing-down', 'rival.won', 'rival.met', 'ambush.broken', 'ambush.lost', 'contract.done', 'contract.failed'];

/**
 * A radio line of `kind` for rival `r`. `grudge` lines need a memory to
 * quote (else a taunt); `{memory}` is the recalled event, `{callsign}` yours.
 */
export function rivalLine(w: WorldState, r: Rival, kind: LineKind, seed: number, vars: Record<string, string> = {}): string {
  let k = kind;
  let memory: string | null = null;
  if (k === 'grudge') {
    memory = recall(w, { about: r.id, kinds: RIVAL_KINDS, only: RIVAL_KINDS, seed })?.text ?? null;
    if (!memory) k = 'taunt';
  }
  const list = r.lines[k];
  const line = list[seed % list.length];
  return line.replace(/\{(\w+)\}/g, (m, key: string) => (key === 'memory' ? (memory ?? '') : (vars[key] ?? m))).trim();
}

// ── gone to ground: the ally path ──────────────────────────────────────

const say = (who: string, line: string, next?: string, effects?: Effect[]): DialogNode => ({ who, line, ...(next ? { next } : {}), ...(effects ? { effects } : {}) });
const ask = (who: string, line: string, choices: DialogChoice[]): DialogNode => ({ who, line, choices });
const ch = (text: string, next: string | null, extra: Partial<DialogChoice> = {}): DialogChoice => ({ text, next, ...extra });

const ISMENE = rivalPersonId(RIVALS[2]);
const SKERRY = rivalPersonId(RIVALS[3]);

/** Conversations with a beaten rival found on a concourse. */
export const RIVAL_TALKS: Record<string, Conversation> = {
  ismene: {
    id: 'rival-ismene-ground',
    title: 'The Silent Cantor',
    with: ISMENE,
    priority: 100,
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask(ISMENE, '(She sits facing the window, not drinking.) The fossil that ran me off. {memory} The Choir wants my silence ended. Why are you here?', [
        ch('Lucan Vey stopped singing too. He started again. Sing — I\'ll listen.', 'sing', { if: { flag: 'lucan-sang' }, locked: '(someone who stopped singing once could tell you how to ask)' }),
        ch('The Choir wants your silence ended. I don\'t. Stop hunting.', 'spare', { effects: [{ fact: 'npc.ismene.status', value: 'spared' }, { standing: 'choir', delta: 2 }] }),
        ch('Why did you stop?', 'why'),
        ch('(Leave her be.)', null),
      ]),
      why: say(ISMENE, 'My Measure broke the Observance. Dame-Cantor Psalm shot our weapons off and apologised across the Line. It is hard to sing when you were wrong in front of everyone.', 'hello'),
      sing: say(ISMENE, '(sung, barely) Out of the dust we were lifted. Out of the dark we were shown.', 'sing2', [{ fact: 'npc.ismene.status', value: 'ally' }, { standing: 'choir', delta: 3 }]),
      sing2: say(ISMENE, '...Lucan was right. It is easier with someone listening. I will fly your wing, fossil. Unwitnessed by the Choir. Witnessed by you.'),
      spare: say(ISMENE, 'Mercy from a Directorate pilot. The Altitude would call it a trick. I will call it a rest in the bar, and go home. Ascend.'),
    },
  },
  skerry: {
    id: 'rival-skerry-ground',
    title: 'Coffee for a Deserter',
    with: SKERRY,
    priority: 100,
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask(SKERRY, 'Oh, it\'s you. The one who shot my canopy full of holes. {memory} Call Continuity — forty shares, which is insulting — or sit down. Coffee\'s on you.', [
        ch('Fly with me, Corporal.', 'wing', { if: { any: [{ fact: 'npc.toma.home' }, { standing: 'rustwake', min: 15 }] }, effects: [{ fact: 'npc.skerry.status', value: 'ally' }], locked: '(he needs a reason to come in from the cold)' }),
        ch('Why did you run?', 'why'),
        ch('I\'m calling Continuity.', 'jail', { effects: [{ fact: 'npc.skerry.status', value: 'jailed' }, { standing: 'concord', delta: 4 }, { credits: 40 }] }),
        ch('(Leave him to his coffee.)', null),
      ]),
      why: say(SKERRY, 'The count. Every twenty-five hours and fifty-one minutes, primes, going down. Everyone on the picket pretended it was solar. I couldn\'t pretend any more.', 'why2'),
      why2: say(SKERRY, 'Kerrigan could, just about. Kid was sweating it. If he\'s come in alright, maybe I could too.', 'hello'),
      wing: say(SKERRY, 'Kerrigan\'s alright? Then — yeah. Alright. Skerry, on your wing. Same paint, even. I\'ll try not to rob anyone.'),
      jail: say(SKERRY, 'Forty shares. I\'m worth forty shares. Well. Keep the light, pilot. Somebody should.'),
    },
  },
};

/** Where beaten rivals have gone to ground (person id → station prefix list). */
export function rivalHideouts(w: WorldState): { personId: string; rival: Rival; at: string[] }[] {
  return RIVALS.filter((r) => r.hides && rivalState(w, r.id).status === 'hiding').map((r) => ({ personId: rivalPersonId(r), rival: r, at: r.hides! }));
}

/** The conversation a hiding rival offers, by concourse person id. */
export function rivalConversationFor(w: WorldState, personId: string): Conversation | null {
  const r = rivalByPerson(personId);
  if (!r || rivalState(w, r.id).status !== 'hiding') return null;
  return RIVAL_TALKS[r.id] ?? null;
}

/** Rivals flying on your wing. */
export function allies(w: WorldState): Rival[] {
  return RIVALS.filter((r) => rivalState(w, r.id).status === 'ally');
}

