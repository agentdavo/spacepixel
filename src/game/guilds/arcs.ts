/**
 * Guild arcs (batch 5 · milestone 2) — four hand-written missions per guild,
 * gated by guild rank and campaign episode, flown as ordinary contracts: the
 * ContractDesk books them, runs their operation through the CampaignRunner
 * (spawns, set pieces, escorts, dwell zones, voiced chatter) and settles them
 * at the hall. Finishing a step sets `arc.<guild>.<n>` and its facts; each
 * arc's last step ends in a choice made at the hall whose fact the rest of
 * the Reach reads (world simulation, NPC arcs, rivals):
 *
 *   keeping.core        'sealed' | 'opened'      the Lesson of Hours' core
 *   continuity.ledger   'filed'  | 'leaked'      Engagement 114 (schedule.leaked)
 *   allocation.quota    'delivered' | 'diverted' Quota Night (anchorage.fed)
 *   rustwake.seam       'tey' | 'breakers'       the Ember's last skim
 *   houses.oath         'sworn' | 'declined'     the honour path (player.defected)
 *
 * Pure (type imports + plain data): runs under node --test.
 */
import type { CampaignContext, CampaignMission, CampaignObjective, ChatterBeat, ChatterLine, ChatterTrigger, Placement, SetPieceSpec, SpawnSpec } from '../campaign/types';
import type { OpBuild, OpOptions } from '../contracts/ops';
import { BOARD_PERIOD, findStation, hops, type Contract, type ContractKind, type ReachMap, type ReachStation, type ReachSystem, type Tier, type V3 } from '../contracts/contracts.ts';
import { fact, record, setFact, type WorldState } from '../world/WorldState.ts';
import type { EconFaction } from '../economy';
import { GUILDS, type GuildId } from './guilds.ts';
import { awardMerit, expel, rankOf, type GuildResult, type Rep } from './membership.ts';

// ── data types ──────────────────────────────────────────────────────────

/** Where the work is: a point off a Lantern, or a lane between a Lantern and a station bay. */
export type Where =
  | { system: string; gate?: number; dist: number; lat?: number }
  | { system: string; route: 'gate-station' | 'station-gate'; station?: string; gate?: number };

export interface ArcChoice {
  id: string;
  label: string;
  /** Who answers, and what they say. */
  who: string;
  line: string;
  facts: Record<string, string | boolean>;
  merit?: Partial<Record<GuildId, number>>;
  rep?: Rep;
  expel?: GuildId[];
  /** World event recorded (scope below). */
  event: string;
  scope: `system:${string}` | `faction:${string}` | `guild:${string}`;
}

export interface ArcStep {
  id: string;
  guild: GuildId;
  n: number;
  title: string;
  /** One line for the arc list. */
  synopsis: string;
  brief: string;
  rank: number;
  episode: number;
  kind: ContractKind;
  tier: Tier;
  reward: number;
  merit: number;
  rep: number;
  /** Standing lost with another side on settlement (sorties against the Directorate, customs fights). */
  enemy?: { faction: EconFaction; rep: number };
  where: Where;
  /** The operation: spawns, set pieces, objectives, chatter. */
  build(k: Kit): void;
  /** Facts set when the step is turned in. */
  facts?: Record<string, string | boolean>;
  choice?: { who: string; prompt: string; options: [ArcChoice, ArcChoice] };
}

// ── the mission kit (a tiny DSL over CampaignMission data) ───────────────

type Pred = (c: CampaignContext) => boolean;

export class Kit {
  readonly spawns: SpawnSpec[] = [];
  readonly setpieces: SetPieceSpec[] = [];
  readonly objectives: CampaignObjective[] = [];
  readonly chatter: ChatterBeat[] = [];
  readonly nav: Record<string, string> = {};
  readonly labels: Record<string, string> = {};
  /** Operation centre / lane ends, system-local metres. */
  readonly c: V3;
  readonly start: V3;
  readonly end: V3;
  private n = 0;

  constructor(
    readonly k: Contract,
    private offset: V3,
    private stage: boolean,
  ) {
    const op = k.op!;
    this.c = op.center;
    this.start = op.start ?? op.center;
    this.end = op.end ?? op.center;
  }

  /** Absolute placement at a system-local point plus an offset. */
  at(v: V3, o: V3 = [0, 0, 0]): Placement {
    return { at: 'point', point: [v[0] + this.offset[0], v[1] + this.offset[1], v[2] + this.offset[2]], offset: o };
  }
  /** Compressed delays for screenshot staging. */
  d(normal: number, staged = 1): number {
    return this.stage ? staged : normal;
  }
  /** Unit vector along the lane. */
  dir(): V3 {
    const d: V3 = [this.end[0] - this.start[0], this.end[1] - this.start[1], this.end[2] - this.start[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }
  /** Point `f` (0..1) of the way down the lane. */
  along(f: number, o: V3 = [0, 0, 0]): V3 {
    return [this.start[0] + (this.end[0] - this.start[0]) * f + o[0], this.start[1] + (this.end[1] - this.start[1]) * f + o[1], this.start[2] + (this.end[2] - this.start[2]) * f + o[2]];
  }

  spawn(s: SpawnSpec): this {
    this.spawns.push(s);
    return this;
  }
  piece(kind: SetPieceSpec['kind'], tag: string, place: Placement, params?: SetPieceSpec['params'], label?: string): this {
    this.setpieces.push({ kind, tag, place, params });
    if (label) this.labels[tag] = label;
    return this;
  }
  beacon(tag: string, place: Placement, label: string, extra: SetPieceSpec['params'] = {}, color = '#6fe6ff'): this {
    return this.piece('beacon', tag, place, { label, color, ...extra }, label.toUpperCase());
  }
  /** A visible objective; `nav` = tag for the marker. */
  goal(id: string, text: string, done: Pred, nav?: string, extra: Partial<CampaignObjective> = {}): this {
    this.objectives.push({ id, text, done, ...extra });
    if (nav) this.nav[id] = nav;
    return this;
  }
  /** A hidden script cue that sets `flag`. */
  cue(flag: string, when: Pred): this {
    this.objectives.push({ id: `cue${this.n++}`, text: `[cue] ${flag}`, hidden: true, optional: true, done: when, setsFlag: flag });
    return this;
  }
  beat(trigger: ChatterTrigger, lines: ChatterLine[], priority = 1): this {
    this.chatter.push({ id: `b${this.n++}`, trigger, lines, priority });
    return this;
  }
}

const say = (who: string, text: string, delay?: number): ChatterLine => (delay === undefined ? { who, text } : { who, text, delay });
const hiss = (who: string, text: string, delay?: number): ChatterLine => (delay === undefined ? { who, text, static: true } : { who, text, static: true, delay });
const onFlag = (flag: string): ChatterTrigger => ({ on: 'flag', flag });
const start: ChatterTrigger = { on: 'start' };
const win: ChatterTrigger = { on: 'success' };
const lose: ChatterTrigger = { on: 'failure' };

/** Standard escort: a ship from the lane start to `dest`, failing if it dies. */
function escort(b: Kit, o: { blueprint: string; faction: 'concord' | 'choir' | 'rustwake'; name: string; tag: string; destLabel: string; meet?: boolean }): void {
  b.spawn({ blueprint: o.blueprint, faction: o.faction, count: 1, place: b.at(b.start), tag: o.tag, name: o.name, role: 'escort', routeTo: 'dest' });
  b.beacon('dest', b.at(b.end), o.destLabel);
  b.labels[o.tag] = o.name.toUpperCase();
  if (o.meet !== false) {
    b.cue(`halt:${o.tag}`, () => true);
    b.cue(`resume:${o.tag}`, (c) => c.distanceTo(o.tag) < 2500);
    b.goal('meet', `Rendezvous with the ${o.name}`, (c) => c.flag(`resume:${o.tag}`), o.tag, { failed: (c) => c.aliveCount(o.tag) === 0 });
  }
}

function raiders(b: Kit, o: { tag: string; after: string; blueprint: string; faction: 'concord' | 'choir' | 'rustwake'; name: string; count: number; place: Placement; delay: number; staged?: number }): void {
  b.spawn({ blueprint: o.blueprint, faction: o.faction, count: o.count, place: o.place, tag: o.tag, name: o.name, role: 'hostile', whenFlag: o.after, delay: b.d(o.delay, o.staged ?? 1) });
}

// ── the arcs ────────────────────────────────────────────────────────────

const S = (s: ArcStep): ArcStep => s;

export const ARCS: ArcStep[] = [
  // ════ ORDER OF THE KEEPING — "The Seven Keepings" ════
  S({
    id: 'keeping-1',
    guild: 'keeping',
    n: 1,
    title: 'First Keeping: The Seal Holds',
    synopsis: 'Recover the sealed core of a golden-age school tender from the Timetable Graveyard — unopened, whatever the Breakers say.',
    brief:
      'Postulant. In the Graveyard, where the ring throws its shadow, lies the Lesson of Hours: a school tender, caught half through the Great Lantern on the day the stars went out.\n\nHer core is still sealed. The Breakers want it for scrap; the Office wants it for questions. The Keeping wants it kept.\n\nHold at the survey mark while I say the words. Then take the core aboard — gently — and bring it home. First keeping: the seal holds.',
    rank: 1,
    episode: 1,
    kind: 'salvage',
    tier: 1,
    reward: 2400,
    merit: 60,
    rep: 3,
    where: { system: 'anchorage', gate: 0, dist: 9000, lat: 0.6 },
    facts: { 'keeping.tender-core': 'cloister' },
    build(b) {
      b.piece('wreckage', 'graveyard', b.at(b.c), { radius: 1500, count: 260, label: 'Timetable Graveyard' }, 'TIMETABLE GRAVEYARD');
      b.piece('derelict', 'tender', b.at(b.c, [0, 0, 400]), { length: 700, belt: 900, tumble: 0.15, label: 'School tender Lesson of Hours' }, 'LESSON OF HOURS');
      b.beacon('survey', b.at(b.c, [900, 250, 0]), 'Survey mark', { hold: b.d(10, 2), radius: 600 });
      b.piece('blackbox', 'core', b.at(b.c, [-150, 380, 700]), { whenFlag: 'survey-held' }, 'SEALED CORE');
      raiders(b, { tag: 'breakers', after: 'core-recovered', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Graveyard Breaker', count: 3, place: b.at(b.c, [2600, 400, 2200]), delay: 6 });
      b.cue('breakers-seen', (c) => c.alive('breakers'));
      b.goal('survey', 'Hold at the survey mark while the words are said', (c) => c.flag('survey-held'), 'survey');
      b.goal('core', 'Take the sealed core aboard — do not scan it', (c) => c.flag('core-recovered'), 'core');
      b.goal('clear', 'Drive off the Breakers, or get 9 km clear', (c) => c.flag('breakers-seen') && (c.aliveCount('breakers') === 0 || c.distanceTo('survey') > 9000), 'breakers');
      b.beat(start, [say('gd-sorrel', 'That is the Lesson of Hours. Two hundred children were aboard her when the ring went dark.'), say('gd-sorrel', 'Hold at the mark. I will say the words. First keeping: the seal holds.', 3)]);
      b.beat(onFlag('survey-held'), [say('gd-sorrel', 'The seal holds. Take the core aboard. Gently.'), say('system', 'SEALED CORE LOCATED. PASSENGER MANIFEST AVAILABLE. DISPLAY?', 3), say('gd-sorrel', 'No. No, thank you.', 2)]);
      b.beat(onFlag('breakers-seen'), [hiss('gd-breaker', 'Everything in the Graveyard is Breakers’ salvage, warden. Even the holy bits.'), say('gd-sorrel', 'Then the Breakers may come and argue with the pilot.')], 2);
      b.beat(win, [say('gd-sorrel', 'Bring her home, Postulant. The Cloister will keep her.')]);
    },
  }),
  S({
    id: 'keeping-2',
    guild: 'keeping',
    n: 2,
    title: 'Third Keeping: The Fire Is Fed',
    synopsis: 'Escort the warden barge Saint Maudlin and the tender’s core across Meridian; when her drive stalls, hold the raiders off while Brother Oake relights it by litany.',
    brief:
      'The core must go to the clean-room at the Tey works to be re-housed. It travels aboard the Saint Maudlin, which is as old as her cargo and about as fast.\n\nBrother Oake has the barge. He is young. He counts the Keepings too quickly when he is frightened, and he will be frightened.\n\nThird keeping: the fire is fed and not starved. If her drive falters, the wardens will feed it. You will keep everyone else away while they do.',
    rank: 2,
    episode: 1,
    kind: 'escort',
    tier: 2,
    reward: 3600,
    merit: 80,
    rep: 3,
    where: { system: 'meridian', route: 'gate-station', station: 'tey refinery' },
    facts: { 'keeping.core-rehoused': true },
    build(b) {
      // She is already under way: catch her up. The stall (halt:barge) comes at midway.
      escort(b, { blueprint: 'ffc-lantern-guard', faction: 'concord', name: 'Saint Maudlin', tag: 'barge', destLabel: 'Tey clean-room', meet: false });
      // Midway: a wide interaction radius, so the stall comes wherever you fly her quarter.
      b.beacon('midway', b.at(b.along(0.45)), 'Midway', { radius: 3500 }, '#ffd23a');
      b.goal('meet', 'Catch up with the Saint Maudlin', (c) => c.distanceTo('barge') < 2500, 'barge', { failed: (c) => c.aliveCount('barge') === 0, setsFlag: 'met' });
      b.cue('halt:barge', (c) => c.flag('met') && c.distanceTo('midway') <= 0 && c.distanceTo('barge') < 3500);
      b.cue('stall', (c) => c.flag('halt:barge'));
      raiders(b, { tag: 'raiders-a', after: 'stall', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 3, place: { at: 'tag', tag: 'barge', offset: [1800, 300, -2600] }, delay: 4 });
      raiders(b, { tag: 'raiders-b', after: 'stall', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 3, place: { at: 'tag', tag: 'barge', offset: [-1600, -200, 2800] }, delay: 42, staged: 6 });
      b.cue('b-seen', (c) => c.alive('raiders-b'));
      b.cue('relit', (c) => c.flag('b-seen') && c.aliveCount('raiders') === 0);
      b.goal('defend', 'Stay with her — hold the raiders off when she stalls', (c) => c.flag('relit'), 'barge', { failed: (c) => c.aliveCount('barge') === 0 });
      b.goal('escort', 'See the Saint Maudlin to the Tey clean-room', (c) => c.flag('barge-arrived'), 'barge', { failed: (c) => c.aliveCount('barge') === 0 });
      b.beat(start, [say('gd-oake', 'Saint Maudlin to escort — oh, good, you are real. Close to two kilometres and we light.')]);
      b.beat(onFlag('stall'), [
        say('system', 'SAINT MAUDLIN: DRIVE PRESSURE FALLING. FEED STARVED.'),
        say('gd-oake', 'She is starving — we are stopping — the wardens are going to the fire.', 2),
        say('gd-oake', 'First keeping: the seal holds.', 6),
        say('gd-oake', 'Second keeping: the feed runs clean.', 12),
        say('gd-oake', 'Third keeping: the fire is fed and not starved.', 12),
        say('gd-oake', 'Fourth keeping: the cold is let out.', 12),
      ], 2);
      b.beat(onFlag('b-seen'), [say('gd-oake', 'Fifth keeping: the old words are said. — More of them, pilot! Astern!'), say('gd-oake', 'Sixth keeping: we do not ask the engine why.', 14)], 2);
      b.beat(onFlag('relit'), [say('gd-oake', 'Seventh keeping. We thank it. And we go.'), say('system', 'SAINT MAUDLIN: DRIVE LIT.', 2), say('gd-oake', 'Lit!', 1)], 3);
      b.cue('resume:barge', (c) => c.flag('relit'));
      b.beat(win, [say('gd-sorrel', 'The Maudlin is berthed and the core is in the clean-room. You kept the fire fed, Keeper of the Feed.')]);
      b.beat(lose, [say('gd-oake', 'We are breaking up — the core — forgive us —')], 3);
    },
  }),
  S({
    id: 'keeping-3',
    guild: 'keeping',
    n: 3,
    title: 'Fifth Keeping: The Old Words',
    synopsis: 'Listen to the dead flight cores in Lysowick’s pressed-flower debris — and hear a number no warden was meant to hear.',
    brief:
      'In Lysowick the wrecks of four engagements lie layered like pressed flowers: seventy-one, eighty-eight, one-oh-two. Their cores are sealed and still talking. They say the old words — timetable words — to no one.\n\nFifth keeping: the old words are said. Somebody should be there to hear them. Hold beside each field until its core has spoken, and bring the recording to the chapter-house.\n\nThe Office does not like wardens listening. Be quick, Fire-Warden.',
    rank: 3,
    episode: 2,
    kind: 'recon',
    tier: 2,
    reward: 4200,
    merit: 100,
    rep: 4,
    where: { system: 'lysowick', gate: 1, dist: 10000, lat: -0.5 },
    facts: { 'keeping.old-words': true },
    build(b) {
      const fields: [string, string, V3][] = [
        ['e71', 'Engagement 71', [0, 0, 0]],
        ['e88', 'Engagement 88', [3200, 500, 1800]],
        ['e102', 'Engagement 102', [-2600, -400, 3400]],
      ];
      fields.forEach(([tag, label, o], i) => {
        b.piece('wreckage', tag, b.at(b.c, o), { radius: 900, count: 150, label }, label.toUpperCase());
        b.beacon(`w${i + 1}`, b.at(b.c, [o[0] + 350, o[1] + 200, o[2]]), `Core ${label.split(' ')[1]}`, { hold: b.d(8, 1), radius: 650 }, '#ffd23a');
        b.goal(`w${i + 1}`, `Hear the core of ${label}`, (c) => c.flag(`w${i + 1}-held`), `w${i + 1}`);
      });
      raiders(b, { tag: 'office', after: 'w3-held', blueprint: 'vf27-kestrel', faction: 'concord', name: 'Unmarked Kestrel', count: 3, place: b.at(b.c, [4200, 900, -3600]), delay: 5 });
      b.cue('office-seen', (c) => c.alive('office'));
      b.goal('break', 'Keep the recording — 12 km clear, or down the unmarked Kestrels', (c) => c.flag('office-seen') && (c.aliveCount('office') === 0 || c.distanceTo('e71') > 12000), 'office');
      b.beat(start, [say('cl-pell', 'Three fields, three cores. Sit with each until it speaks. Do not answer it.')]);
      b.beat(onFlag('w1-held'), [hiss('system', 'CORE 71: …SERVICE TO MERIDIAN IS DELAYED. WE APOLOGISE —'), say('cl-pell', 'The old words. Good. Next.')]);
      b.beat(onFlag('w2-held'), [hiss('system', 'CORE 88: …EXPENDITURE WITHIN SCHEDULE. RELEASE: FOUR HUNDRED GRAMS —'), say('cl-pell', 'That is not a timetable word.', 2)]);
      b.beat(onFlag('w3-held'), [hiss('system', 'CORE 102: …EXPECTED EXPENDITURE: ELEVEN. SCHEDULED. SCHEDULED. SCHEDULED.'), say('cl-pell', 'Why would a fighter’s core know what it was expected to cost?', 2)]);
      b.beat(onFlag('office-seen'), [hiss('gd-halvard', 'Warden’s pilot. You will transmit that recording to the Office and then forget it.'), say('cl-pell', 'The Office always wants the words. Keep them.', 2)], 2);
      b.beat(win, [say('cl-pell', 'You have it. Come home, and we will decide who else may hear it. Nobody, I think.')]);
    },
  }),
  S({
    id: 'keeping-4',
    guild: 'keeping',
    n: 4,
    title: 'The Sixth Keeping',
    synopsis: 'Carry the re-housed core to the dead Great Lantern, where it wakes and asks for a destination — then decide whether it is sealed or opened.',
    brief:
      'The Lesson of Hours’ core has begun to hum. It hums louder near Lanterns. The Mother believes it wants to see its ring again before it sleeps.\n\nFly it to the dead Lantern in Anchorage and hold beside the ring while it speaks. The Office knows. The Breakers know. Everyone always knows.\n\nSixth keeping: we do not ask the engine why. But, Cold-Warden — this one may ask us.',
    rank: 4,
    episode: 3,
    kind: 'recon',
    tier: 3,
    reward: 5200,
    merit: 120,
    rep: 5,
    where: { system: 'anchorage', gate: 1, dist: 6000, lat: 0.3 },
    build(b) {
      b.piece('wreckage', 'deadring', b.at(b.c, [0, 0, 1200]), { radius: 1800, count: 240, label: 'The dead ring' }, 'THE DEAD RING');
      b.beacon('ring', b.at(b.c), 'Dead ring — the core hums', { hold: b.d(22, 3), radius: 900 }, '#e8d27a');
      b.cue('ring-in', (c) => c.distanceTo('ring') <= 0);
      raiders(b, { tag: 'breakers', after: 'ring-in', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Graveyard Breaker', count: 4, place: b.at(b.c, [-3000, 500, -2600]), delay: 7, staged: 2 });
      b.spawn({ blueprint: 'ffc-lantern-guard', faction: 'concord', count: 1, place: b.at(b.c, [2200, 600, -1800]), tag: 'diligence', name: 'Office corvette Due Diligence', role: 'static', whenFlag: 'ring-held' });
      b.cue('breakers-seen', (c) => c.alive('breakers'));
      b.goal('ring', 'Hold at the dead ring while the core speaks', (c) => c.flag('ring-held'), 'ring');
      b.goal('clear', 'Drive off the Breakers', (c) => c.flag('breakers-seen') && c.aliveCount('breakers') === 0, 'breakers');
      b.beat(start, [say('gd-sorrel', 'There is the ring. Four hundred and thirty-one years dark. Take her close, and hold.')]);
      b.beat(onFlag('ring-in'), [say('system', 'CORE (LESSON OF HOURS): SERVICE WILL RESUME SHORTLY.'), say('system', 'REQUEST: DESTINATION. REQUEST: DESTINATION.', 4), say('gd-sorrel', 'It is asking where to go. Sixth keeping… but it is asking us.', 3)]);
      b.beat(onFlag('breakers-seen'), [hiss('gd-breaker', 'A humming core! That’s worth a hulk, warden. Hand it over and we’ll say a prayer for you.')], 2);
      b.beat(onFlag('ring-held'), [say('system', 'DESTINATION FIELD EMPTY. THIS IS NOT AN ERROR.'), hiss('gd-halvard', 'Office corvette Due Diligence. The Office will take custody of that core. It will be opened, studied, and returned. Probably.', ), say('gd-sorrel', 'Bring it to me first, Cold-Warden. Then choose.', 2)], 2);
      b.beat(win, [say('gd-sorrel', 'Come home. The chapter-house is waiting, and so is the Office.')]);
    },
    choice: {
      who: 'gd-sorrel',
      prompt: 'The Office wants it opened. The Keeping says a sealed heart is a holy heart. It is your hand on the case, Keeper. What is done with it?',
      options: [
        {
          id: 'sealed',
          label: 'Seal it in the Cloister',
          who: 'gd-sorrel',
          line: 'Sixth keeping. She will sleep beside Hollis Marrow’s reactors, and we will not ask her why. Thank you.',
          facts: { 'keeping.core': 'sealed' },
          merit: { keeping: 140, continuity: -80 },
          event: 'keeping.core.sealed',
          scope: 'guild:keeping',
        },
        {
          id: 'opened',
          label: 'Give it to the Office to be opened',
          who: 'gd-halvard',
          line: 'The Office thanks you. The wardens will not — but the Office remembers its friends longer.',
          facts: { 'keeping.core': 'opened' },
          merit: { keeping: -160, continuity: 140 },
          event: 'keeping.core.opened',
          scope: 'guild:continuity',
        },
      ],
    },
  }),

  // ════ OFFICE OF CONTINUITY — "Audit of Record" ════
  S({
    id: 'continuity-1',
    guild: 'continuity',
    n: 1,
    title: 'Routine Traffic',
    synopsis: 'Empty a dead drop in Pelourin and see a frightened clan informant, Lamplighter Wick, safely out through the Lantern.',
    brief:
      'Office of Continuity. Purely routine.\n\nA dead drop off the Pelourin Lantern holds a tape from one of our friends in the clans. Hold beside it until it trusts you, take the tape, and then — this is the part the file calls routine — see our friend out of the system alive.\n\nHis name is Wick. He talks a great deal. Try not to listen.',
    rank: 1,
    episode: 1,
    kind: 'escort',
    tier: 1,
    reward: 2200,
    merit: 60,
    rep: 3,
    where: { system: 'pelourin', gate: 0, dist: 7000, lat: -0.7 },
    facts: { 'continuity.wick': 'safe' },
    build(b) {
      const out: V3 = [b.c[0] + 5200, b.c[1] + 300, b.c[2] - 5200];
      b.beacon('drop', b.at(b.c), 'Dead drop', { hold: b.d(8, 1), radius: 500 });
      b.piece('blackbox', 'tape', b.at(b.c, [0, 120, 180]), { whenFlag: 'drop-held' }, 'TAPE');
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 1, place: b.at(b.c, [-600, 80, -400]), tag: 'wick', name: 'Wick’s cutter', role: 'escort', routeTo: 'out', whenFlag: 'tape-recovered' });
      b.beacon('out', b.at(out), 'Lantern approach');
      b.labels.wick = 'WICK';
      raiders(b, { tag: 'enforcers', after: 'tape-recovered', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Clan enforcer', count: 3, place: b.at(b.c, [-2800, 400, 2600]), delay: 9 });
      b.cue('enf-seen', (c) => c.alive('enforcers'));
      b.cue('depart:wick', (c) => c.flag('wick-arrived'));
      b.goal('drop', 'Hold beside the dead drop', (c) => c.flag('drop-held'), 'drop');
      b.goal('tape', 'Take the tape', (c) => c.flag('tape-recovered'), 'tape');
      b.goal('wick', 'See Wick to the Lantern approach', (c) => c.flag('wick-arrived'), 'wick', { failed: (c) => c.flag('tape-recovered') && c.aliveCount('wick') === 0 && !c.flag('wick-arrived') });
      b.beat(start, [say('cl-moss', 'The drop is marked. Sit beside it. Do not hail anybody. Especially not Wick.')]);
      b.beat(onFlag('tape-recovered'), [say('gd-wick', 'Is that Continuity? Tell me that’s Continuity. The Moot knows I talked, they know —'), say('cl-moss', 'Mister Wick, please follow the pilot.', 3)]);
      b.beat(onFlag('enf-seen'), [hiss('cl-ferrow', 'Lamplighter! The Moot wants a word, and the word is traitor.'), say('gd-wick', 'That’s the Speaker. That’s the actual Speaker. Pilot —', 2)], 2);
      b.beat(win, [say('cl-moss', 'Wick is through the Lantern. His file is closed — in the kind sense. Come in, Stringer.')]);
      b.beat(lose, [say('cl-moss', 'Ah. His file is closed, then. In the other sense.')], 3);
    },
  }),
  S({
    id: 'continuity-2',
    guild: 'continuity',
    n: 2,
    title: 'Spying on Our Own',
    synopsis: 'Shadow a Board of Allocation tender across Meridian and photograph who she meets at the refinery. It is not who the Board says.',
    brief:
      'The Good Allocation carries the Board’s post to the Tey works every week. The Board has been careless lately. We would like to know how careless.\n\nFollow her — close enough to see, far enough not to be seen, within five kilometres. When she stops, hold at the observation mark and let the camera run.\n\nShe is one of ours, Courier. So are we. That is what makes it interesting.',
    rank: 2,
    episode: 2,
    kind: 'recon',
    tier: 2,
    reward: 3400,
    merit: 80,
    rep: 3,
    where: { system: 'meridian', route: 'gate-station', station: 'tey refinery' },
    facts: { 'continuity.board-tape': true },
    build(b) {
      b.spawn({ blueprint: 'ffc-lantern-guard', faction: 'concord', count: 1, place: b.at(b.start), tag: 'tender', name: 'Good Allocation', role: 'escort', routeTo: 'meet' });
      b.labels.tender = 'GOOD ALLOCATION';
      const meet = b.along(0.8, [900, 200, 0]);
      b.beacon('meet', b.at(meet), 'Meeting point', {}, '#ffd23a');
      b.spawn({ blueprint: 'choir-vesper', faction: 'choir', count: 1, place: b.at(meet, [400, 150, 600]), tag: 'treasury', name: 'Treasury tender Seventh Tithe', role: 'static' });
      b.cue('tail-on', (c) => c.distanceTo('tender') < 5000);
      b.cue('shadow-lost', (c) => c.flag('tail-on') && !c.flag('tender-arrived') && c.distanceTo('tender') > 8000);
      b.beacon('obs', b.at(meet, [-1800, 600, -900]), 'Observation mark', { hold: b.d(14, 2), radius: 700, whenFlag: 'tender-arrived' }, '#ff5fb4');
      raiders(b, { tag: 'cantors', after: 'obs-held', blueprint: 'choir-cantor', faction: 'choir', name: 'Treasury Cantor', count: 2, place: b.at(meet, [1600, 400, 2400]), delay: 3 });
      b.cue('seen', (c) => c.alive('cantors'));
      b.goal('tail', 'Shadow the Good Allocation — stay within 5 km until she stops', (c) => c.flag('tender-arrived'), 'tender', { failed: (c) => c.flag('shadow-lost') || c.aliveCount('tender') === 0 });
      b.goal('obs', 'Photograph the meeting — hold at the observation mark', (c) => c.flag('obs-held'), 'obs');
      b.goal('break', 'Break contact — 12 km clear, or down the Cantors', (c) => c.flag('seen') && (c.aliveCount('cantors') === 0 || c.distanceTo('meet') > 12000), 'cantors');
      b.beat(start, [say('gd-halvard', 'There she goes. Stay on her quarter, Courier. Five kilometres. She is not expecting company.')]);
      b.beat(onFlag('tender-arrived'), [say('system', 'TREASURY TRANSPONDER. ZENITH HEGEMONY. INSIDE THE MERIDIAN LANTERN.'), say('gd-halvard', 'Well. Now we know. Get the pictures.', 2)], 2);
      b.beat(onFlag('seen'), [say('system', 'ACTIVE SCAN. YOU HAVE BEEN NOTICED.'), say('gd-halvard', 'The Treasury does not like cameras. Leave.', 2)], 2);
      b.beat(onFlag('shadow-lost'), [say('gd-halvard', 'We have lost her. How very disappointing.')], 3);
      b.beat(win, [say('gd-halvard', 'Bring the plates home. Do not develop them. Do not, above all, describe them to anyone at the Board.')]);
    },
  }),
  S({
    id: 'continuity-3',
    guild: 'continuity',
    n: 3,
    title: 'The Deserter’s Ledger',
    synopsis: 'Hunt down Paymaster Crowe, who ran from the Board with its books, and recover the ledger he is trying to sell.',
    brief:
      'Paymaster Ansel Crowe left the Board of Allocation eleven days ago with a Harrier, three hired Scrapjacks and the Board’s private books. He is in Lysowick, trying to sell them.\n\nClose his file. Recover the ledger. Do not read it; it is not for Auditors.\n\nIf he talks on an open band, Auditor, and he will — do not answer him.',
    rank: 3,
    episode: 2,
    kind: 'bounty',
    tier: 2,
    reward: 4600,
    merit: 100,
    rep: 4,
    where: { system: 'lysowick', gate: 2, dist: 9000, lat: 0.6 },
    facts: { 'continuity.crowe': 'closed', 'continuity.ledger-held': true },
    build(b) {
      b.piece('wreckage', 'lair', b.at(b.c), { radius: 1000, count: 180, label: 'Crowe — last seen' }, 'LAST KNOWN POSITION');
      b.cue('found', (c) => c.distanceTo('lair') < b.d(6000, 1e9));
      b.spawn({ blueprint: 'vf31-harrier', faction: 'concord', count: 1, place: b.at(b.c, [0, 200, 700]), tag: 'crowe', name: 'Paymaster Crowe', role: 'hostile', whenFlag: 'found' });
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 3, place: b.at(b.c, [400, 150, 1000]), tag: 'hired', name: 'Hired knife', role: 'hostile', whenFlag: 'found' });
      b.cue('crowe-seen', (c) => c.alive('crowe'));
      b.cue('crowe-dead', (c) => c.flag('crowe-seen') && !c.alive('crowe'));
      b.piece('blackbox', 'ledger', { at: 'tag', tag: 'lair', offset: [0, 300, 600] }, { whenFlag: 'crowe-dead' }, 'THE LEDGER');
      b.goal('find', 'Find Paymaster Crowe', (c) => c.flag('found'), 'lair');
      b.goal('kill', 'Close Crowe’s file', (c) => c.flag('crowe-dead'), 'crowe');
      b.goal('ledger', 'Recover the ledger', (c) => c.flag('ledger-recovered'), 'ledger');
      b.beat(onFlag('crowe-seen'), [hiss('gd-crowe', 'Continuity? You fool — I have the Board’s books. Do you know what is in them? Do you want to?'), say('gd-halvard', 'Paymaster Crowe is unwell. Close his file.', 2)], 2);
      b.beat({ on: 'kills', faction: 'rustwake', count: 2 }, [hiss('gd-crowe', 'Eleven fighters! Engagement one-one-four! Eleven, budgeted like fuel — listen to me!')], 2);
      b.beat(onFlag('crowe-dead'), [say('system', 'LEDGER BEACON ACQUIRED — MARKED.'), say('gd-halvard', 'Take the ledger. Do not open it. You were not listening to him, were you?', 2)], 2);
      b.beat(win, [say('gd-halvard', 'File closed. Come home, Auditor.')]);
    },
  }),
  S({
    id: 'continuity-4',
    guild: 'continuity',
    n: 4,
    title: 'Engagement 114',
    synopsis: 'Crowe’s ledger names a battle before it happens: eleven fighters at the Null picket. Go and watch it arrive on time — then file it, or leak it.',
    brief:
      'I read it, Case Officer. Of course I read it.\n\nCrowe’s ledger has a line for tomorrow: Engagement one-one-four, the Null picket. Expected expenditure: eleven fighters. Ebon released to market: four hundred grams. Price floor: eighty-eight.\n\nGo to the Null. Hold at the observation point. See whether the Hegemony keeps its appointments. Then come home, and we will decide — you and I — what the Office has seen.',
    rank: 4,
    episode: 4,
    kind: 'recon',
    tier: 3,
    reward: 6000,
    merit: 120,
    rep: 4,
    where: { system: 'null', gate: 0, dist: 9000, lat: 0.4 },
    build(b) {
      b.beacon('obs', b.at(b.c), 'Null observation point', { hold: b.d(24, 3), radius: 1000 }, '#ff5fb4');
      b.cue('obs-in', (c) => c.distanceTo('obs') <= 0);
      b.spawn({ blueprint: 'vf27-kestrel', faction: 'concord', count: 2, place: b.at(b.c, [-1400, 200, 900]), tag: 'picket', name: 'Null Picket', role: 'wing' });
      raiders(b, { tag: 'measure', after: 'obs-in', blueprint: 'choir-cantor', faction: 'choir', name: 'Measure Cantor', count: 4, place: b.at(b.c, [2400, 700, 5200]), delay: 14, staged: 2 });
      raiders(b, { tag: 'measure-p', after: 'obs-in', blueprint: 'choir-psalter', faction: 'choir', name: 'Psalter', count: 1, place: b.at(b.c, [-2200, 500, 5600]), delay: 20, staged: 3 });
      b.cue('measure-seen', (c) => c.alive('measure'));
      b.goal('obs', 'Hold at the observation point — let the tape run', (c) => c.flag('obs-held'), 'obs');
      b.goal('break', 'Survive the engagement — break contact 12 km out, or break the Measure', (c) => c.flag('measure-seen') && (c.aliveCount('measure') === 0 || c.distanceTo('obs') > 12000), 'measure');
      b.beat(start, [say('gd-halvard', 'The Null. The picket does not know you are coming. Neither, officially, does the Office.')]);
      b.beat(onFlag('obs-in'), [say('system', 'NULL COUNT LOGGED. SIGNAL BURST: PRIME.'), say('gd-halvard', 'Now we wait. The ledger says fourteen hundred hours.', 3)]);
      b.beat(onFlag('measure-seen'), [say('system', 'CHOIR MEASURE INBOUND. TIME: AS SCHEDULED.'), hiss('system', '(sung) Be witnessed, be witnessed, the Measure ascends —', ), say('gd-halvard', 'To the minute. Of course it is.', 2)], 2);
      b.beat(win, [say('gd-halvard', 'Eleven. To the minute, give or take you. Come home, Case Officer. We have something to decide.')]);
    },
    choice: {
      who: 'gd-halvard',
      prompt: 'The Office can file this. The Schedule stays where it is, the war stays where it is, and you rise. Or you can do something unwise with it. I will not stop you. I will only write it down.',
      options: [
        {
          id: 'filed',
          label: 'File it. The Office knows best.',
          who: 'gd-halvard',
          line: 'Filed. You have a future, Case Officer. I envy it a little.',
          facts: { 'continuity.ledger': 'filed' },
          merit: { continuity: 160 },
          event: 'schedule.filed',
          scope: 'faction:concord',
        },
        {
          id: 'leaked',
          label: 'Leak it on the clans’ channel nine',
          who: 'cl-ferrow',
          line: 'Channel nine’s singing it already, flyer. Eleven fighters, budgeted like fuel. The whole Belt knows by morning.',
          facts: { 'continuity.ledger': 'leaked', 'schedule.leaked': true },
          merit: { rustwake: 120 },
          rep: { rustwake: 10, concord: -10 },
          expel: ['continuity'],
          event: 'schedule.leaked',
          scope: 'faction:concord',
        },
      ],
    },
  }),

  // ════ BOARD OF ALLOCATION — "Quota Night" ════
  S({
    id: 'allocation-1',
    guild: 'allocation',
    n: 1,
    title: 'Every Gram Accounted',
    synopsis: 'Escort the tanker Good Measure and forty kilograms of Ebon from the Tey works out to the Meridian Lantern.',
    brief:
      'By allocation of the Board:\n\nThe tanker Good Measure leaves the Tey works with forty kilograms of Ebon-gas for the Anchorage lane. That is enough to carry a carrier through a Lantern, or to feed a raider clan for a year. Both facts are known in the Belt.\n\nEscort her out to the Lantern. Every gram accounted, Tally-Hand. Including yours.',
    rank: 1,
    episode: 1,
    kind: 'escort',
    tier: 1,
    reward: 2300,
    merit: 60,
    rep: 3,
    where: { system: 'meridian', route: 'station-gate', station: 'tey refinery' },
    build(b) {
      escort(b, { blueprint: 'ffc-lantern-guard', faction: 'concord', name: 'Good Measure', tag: 'tanker', destLabel: 'Meridian Lantern' });
      raiders(b, { tag: 'raiders-1', after: 'resume:tanker', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 2, place: { at: 'tag', tag: 'tanker', offset: [2400, 400, 3000] }, delay: 20, staged: 2 });
      raiders(b, { tag: 'raiders-2', after: 'resume:tanker', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 3, place: { at: 'tag', tag: 'tanker', offset: [-2600, 300, 2600] }, delay: 60, staged: 6 });
      b.cue('seen', (c) => c.alive('raiders'));
      b.cue('depart:tanker', (c) => c.flag('tanker-arrived'));
      b.goal('escort', 'Escort the Good Measure to the Lantern', (c) => c.flag('tanker-arrived'), 'tanker', { failed: (c) => c.aliveCount('tanker') === 0 });
      b.goal('raiders', 'Drive off the raiders', (c) => c.flag('seen') && c.aliveCount('raiders') === 0, 'raiders', { optional: true });
      b.beat(start, [say('cl-halloran', 'Good Measure is holding off the works. Close up and she lights. Forty kilograms, pilot. I have counted them twice.')]);
      b.beat(onFlag('resume:tanker'), [say('system', 'BLACK-LIGHT SIGNATURE IN THE TANKER HOLD. THE DARK IS DARKER.'), say('cl-halloran', 'That is what forty kilos looks like. Try not to stare.', 2)]);
      b.beat(onFlag('seen'), [say('system', 'DRIVE SIGNATURES CLOSING ON THE TANKER. WEAPONS FREE.')], 2);
      b.beat(win, [say('gd-rourke', 'Quota through the Lantern. The Board thanks you in advance for next quarter.')]);
      b.beat(lose, [say('cl-halloran', 'Forty kilograms. …I will have to write that down.')], 3);
    },
  }),
  S({
    id: 'allocation-2',
    guild: 'allocation',
    n: 2,
    title: 'Short Weight',
    synopsis: 'Three flasks went missing from a tanker’s manifest in the Rustwake Belt. Find where they “evaporated” to, before the claim-jumpers do.',
    brief:
      'The Pennywhistle arrived three flasks short. Her captain says evaporation. Evaporation does not leave a transponder, and these three are pinging away in the skim-lane off the Moot-Hold.\n\nRecover all three. The clans will watch you do it — the skimmers are neutral, so long as nobody shoots them — and somebody who is not a clan will try to get there first.\n\nThirty grams, Consignment Officer. The Board notices thirty grams.',
    rank: 2,
    episode: 1,
    kind: 'salvage',
    tier: 2,
    reward: 3300,
    merit: 80,
    rep: 3,
    where: { system: 'rustwake', gate: 1, dist: 8000, lat: 0.5 },
    facts: { 'allocation.short-weight': 'recovered' },
    build(b) {
      b.piece('wreckage', 'skim', b.at(b.c), { radius: 1600, count: 200, label: 'Skim-lane debris' }, 'SKIM-LANE');
      const spots: V3[] = [[900, 200, 600], [-1300, -300, 1500], [400, 500, -1700]];
      spots.forEach((o, i) => b.piece('blackbox', `flask${i + 1}`, b.at(b.c, o), {}, `FLASK ${i + 1}`));
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 2, place: b.at(b.c, [-2200, 600, -600]), tag: 'skimmers', name: 'Clan skimmer', role: 'static' });
      b.cue('jumped', (c) => c.flag('flask1-recovered') || c.flag('flask2-recovered') || c.flag('flask3-recovered'));
      raiders(b, { tag: 'jumpers', after: 'jumped', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Claim-jumper', count: 3, place: b.at(b.c, [3000, 500, -2600]), delay: 8 });
      b.cue('seen', (c) => c.alive('jumpers'));
      b.goal('f1', 'Recover flask 1', (c) => c.flag('flask1-recovered'), 'flask1', { optional: false });
      b.goal('f2', 'Recover flask 2', (c) => c.flag('flask2-recovered'), 'flask2');
      b.goal('f3', 'Recover flask 3', (c) => c.flag('flask3-recovered'), 'flask3');
      b.goal('clear', 'See off the claim-jumpers', (c) => c.flag('seen') && c.aliveCount('jumpers') === 0, 'jumpers');
      b.beat(start, [say('cl-halloran', 'Three flasks, three pings. The skimmers are neutral. Keep it that way.')]);
      b.beat(onFlag('jumped'), [hiss('gd-tey', 'Those flasks fell off a tender, Directorate. Things fall off tenders in the Belt.'), say('cl-halloran', 'Then they can fall back on.', 2)]);
      b.beat(onFlag('seen'), [say('system', 'UNREGISTERED CUTTERS. NO CLAN TRANSPONDER.'), hiss('gd-tey', 'Not ours, flyer. Shoot them with our blessing.', 2)], 2);
      b.beat(win, [say('cl-halloran', 'Thirty grams recovered. The captain’s evaporation will be discussed with him at length.')]);
    },
  }),
  S({
    id: 'allocation-3',
    guild: 'allocation',
    n: 3,
    title: 'The Ration Line',
    synopsis: 'Hold the Lysowick picket’s supply depot while the ration barges unload — through a Choir raid nobody scheduled.',
    brief:
      'The Lysowick picket eats on Thursdays. It is Thursday.\n\nTwo ration barges are unloading at the forward depot off the Lysowick Lantern. The unloading takes as long as it takes. Stay inside the depot perimeter until it is done, and keep the barges breathing.\n\nThe Choir has been told this depot is not on the Schedule, Convoy Warden. Somebody may have told them wrong.',
    rank: 3,
    episode: 2,
    kind: 'patrol',
    tier: 2,
    reward: 4400,
    merit: 100,
    rep: 4,
    where: { system: 'lysowick', gate: 0, dist: 8000, lat: -0.4 },
    facts: { 'allocation.ration-line': 'held' },
    build(b) {
      b.beacon('depot', b.at(b.c), 'Forward depot', { hold: b.d(30, 3), radius: 1100 }, '#7dffb2');
      b.spawn({ blueprint: 'ffc-lantern-guard', faction: 'concord', count: 2, place: b.at(b.c, [300, -100, 200]), tag: 'barge', name: 'Ration barge', role: 'static' });
      b.cue('in', (c) => c.distanceTo('depot') <= 0);
      raiders(b, { tag: 'raid-1', after: 'in', blueprint: 'choir-cantor', faction: 'choir', name: 'Measure Cantor', count: 3, place: b.at(b.c, [2800, 600, 4200]), delay: 8, staged: 1 });
      raiders(b, { tag: 'raid-2', after: 'in', blueprint: 'choir-psalter', faction: 'choir', name: 'Psalter', count: 2, place: b.at(b.c, [-3200, 400, 3600]), delay: 34, staged: 4 });
      b.cue('seen', (c) => c.alive('raid'));
      b.goal('depot', 'Hold the depot perimeter while the barges unload', (c) => c.flag('depot-held'), 'depot', { failed: (c) => c.flag('in') && c.aliveCount('barge') === 0 });
      b.goal('clear', 'Break the raid', (c) => c.flag('seen') && c.aliveCount('raid') === 0, 'raid', { failed: (c) => c.flag('in') && c.aliveCount('barge') === 0 });
      b.beat(start, [say('gd-rourke', 'Two barges, one depot, a picket that would like its dinner. Hold the perimeter, Warden.')]);
      b.beat(onFlag('seen'), [say('system', 'CHOIR MEASURE INBOUND. UNSCHEDULED EXPENDITURE.'), say('gd-rourke', 'Unscheduled. How irritating. Do see to it.', 2)], 2);
      b.beat(onFlag('depot-held'), [say('cl-halloran', 'Last pallet’s off. The picket eats.')]);
      b.beat(win, [say('gd-rourke', 'Depot held, barges intact. Expenditure: minimal. The Allocator-General will be told your name. He may even remember it.')]);
    },
  }),
  S({
    id: 'allocation-4',
    guild: 'allocation',
    n: 4,
    title: 'Quota Night',
    synopsis: 'See the quarter’s Ebon quota to a rendezvous in Fenazar — where the buyer flies Hegemony colours — and choose where forty kilograms really go.',
    brief:
      'The quarter’s quota, Quota-Master: forty kilograms of Ebon aboard the Amber Tithe, from the Fenazar picket to a rendezvous the Board has chosen.\n\nYou will see her there. You will not ask with whom. The Board has considered every gram and every contingency, and it has considered you.\n\nClan raiders know the quota moves tonight. Everybody always knows.',
    rank: 4,
    episode: 3,
    kind: 'escort',
    tier: 3,
    reward: 6200,
    merit: 120,
    rep: 4,
    where: { system: 'fenazar', route: 'station-gate' },
    build(b) {
      b.spawn({ blueprint: 'ffc-lantern-guard', faction: 'concord', count: 1, place: b.at(b.start), tag: 'tanker', name: 'Amber Tithe', role: 'escort', routeTo: 'dest' });
      b.labels.tanker = 'AMBER TITHE';
      b.beacon('dest', b.at(b.along(0.85, [1200, 300, 0])), 'Rendezvous', {}, '#ffd23a');
      b.spawn({ blueprint: 'choir-vesper', faction: 'choir', count: 1, place: b.at(b.along(0.85, [1700, 500, 700])), tag: 'buyer', name: 'Treasury tender Amber Hymn', role: 'static' });
      b.cue('halt:tanker', () => true);
      b.cue('resume:tanker', (c) => c.distanceTo('tanker') < 2500);
      raiders(b, { tag: 'raiders-1', after: 'resume:tanker', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Quota-raider', count: 3, place: { at: 'tag', tag: 'tanker', offset: [2400, 300, 3200] }, delay: 22, staged: 2 });
      raiders(b, { tag: 'raiders-2', after: 'resume:tanker', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Quota-raider', count: 4, place: { at: 'tag', tag: 'tanker', offset: [-2800, 500, 2400] }, delay: 70, staged: 6 });
      b.cue('seen', (c) => c.alive('raiders'));
      b.goal('meet', 'Rendezvous with the Amber Tithe', (c) => c.flag('resume:tanker'), 'tanker', { failed: (c) => c.aliveCount('tanker') === 0 });
      b.goal('escort', 'See the Amber Tithe to the rendezvous', (c) => c.flag('tanker-arrived'), 'tanker', { failed: (c) => c.aliveCount('tanker') === 0 });
      b.goal('raiders', 'Drive off the raiders', (c) => c.flag('seen') && c.aliveCount('raiders') === 0, 'raiders', { optional: true });
      b.beat(start, [say('gd-rourke', 'Forty kilograms, Quota-Master. See her to the rendezvous. The rendezvous will see to the rest.')]);
      b.beat(onFlag('seen'), [hiss('system', '…quota moves tonight, channel nine, quota moves tonight…'), say('system', 'RAIDERS CLOSING ON THE TANKER.', 2)], 2);
      b.beat(onFlag('tanker-arrived'), [say('system', 'RENDEZVOUS TRANSPONDER: TREASURY OF THE ZENITH HEGEMONY.'), say('cl-halloran', 'Pilot. Off the book. Anchorage’s ration line is short this quarter. Forty kilograms would feed it for a year. I didn’t say this.', 3)], 2);
      b.beat(win, [say('gd-rourke', 'Come in and sign for it. You and I have a small matter of paperwork.')]);
      b.beat(lose, [say('gd-rourke', 'Expenditure: forty kilograms. That is going to be a very long form.')], 3);
    },
    choice: {
      who: 'gd-rourke',
      prompt: 'The Treasury is waiting for its grams. So, I hear, is Anchorage. The Board has a view on this, Quota-Master. I suspect you have another.',
      options: [
        {
          id: 'delivered',
          label: 'Deliver the quota as scheduled',
          who: 'gd-rourke',
          line: 'Delivered. Expenditure within schedule. You will go far — the Board sees to that personally.',
          facts: { 'allocation.quota': 'delivered' },
          merit: { allocation: 160 },
          event: 'quota.delivered',
          scope: 'faction:choir',
        },
        {
          id: 'diverted',
          label: 'Divert the grams to the Anchorage ration line',
          who: 'cl-halloran',
          line: 'Forty kilograms to the ration line. Nobody starves at Anchorage this winter. Nobody will ever say your name about it, either. …Thank you.',
          facts: { 'allocation.quota': 'diverted', 'anchorage.fed': true },
          merit: { keeping: 60 },
          rep: { concord: 6, choir: -8 },
          expel: ['allocation'],
          event: 'quota.diverted',
          scope: 'system:anchorage',
        },
      ],
    },
  }),

  // ════ RUSTWAKE CLANS — "Clan Marks" ════
  S({
    id: 'rustwake-1',
    guild: 'rustwake',
    n: 1,
    title: 'Hullrat’s Errand',
    synopsis: 'Beat the Graveyard Breakers to the still-singing drive crystal of a fresh Cantor hulk in Corouhold.',
    brief:
      'Fresh Cantor hulk off the Corouhold Lantern, hullrat. Drive crystal’s still singing — you can hear it on the hull if you put your helmet to it, which don’t.\n\nSurvey it, pull the crystal, and get it back to Tinker before the Breakers do. Magnus Ure’s crews are already burning for it. They’ll say it’s theirs by right of being closer.\n\nBe closer.',
    rank: 1,
    episode: 1,
    kind: 'salvage',
    tier: 1,
    reward: 2200,
    merit: 60,
    rep: 3,
    where: { system: 'corouhold', gate: 0, dist: 9000, lat: 0.5 },
    build(b) {
      b.piece('wreckage', 'hulk', b.at(b.c), { radius: 900, count: 160, label: 'Cantor hulk' }, 'CANTOR HULK');
      b.beacon('survey', b.at(b.c, [500, 200, 0]), 'Survey mark', { hold: b.d(8, 1), radius: 600 });
      b.piece('blackbox', 'crystal', b.at(b.c, [-200, 300, 400]), { whenFlag: 'survey-held' }, 'DRIVE CRYSTAL');
      raiders(b, { tag: 'breakers', after: 'survey-held', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Breaker crew', count: 3, place: b.at(b.c, [2800, 500, 2400]), delay: 6 });
      b.cue('seen', (c) => c.alive('breakers'));
      b.goal('survey', 'Survey the hulk', (c) => c.flag('survey-held'), 'survey');
      b.goal('crystal', 'Pull the drive crystal', (c) => c.flag('crystal-recovered'), 'crystal');
      b.goal('clear', 'See off the Breakers, or get 9 km clear', (c) => c.flag('seen') && (c.aliveCount('breakers') === 0 || c.distanceTo('survey') > 9000), 'breakers');
      b.beat(start, [say('cl-rusk', 'Look at her. Fresh as bread. Survey first — the crystal bites if you rush it.')]);
      b.beat(onFlag('seen'), [hiss('gd-breaker', 'Tinker’s hullrat! That crystal’s Breaker salvage, by right of being closer!'), say('cl-rusk', 'Be closer, then!', 2)], 2);
      b.beat(win, [say('cl-rusk', 'Ha! Still warm. The Moot’ll hear of this, hullrat. Might even learn your name.')]);
    },
  }),
  S({
    id: 'rustwake-2',
    guild: 'rustwake',
    n: 2,
    title: 'Haul-Song',
    synopsis: 'Run the clan tender Nobody’s Daughter past a Directorate customs picket that has no business being in Yoriamere.',
    brief:
      'Nobody’s Daughter carries nobody’s cargo out of the Yoriamere free port tonight, marked hand. There is a Directorate customs picket sitting on the Lantern lane that was not there last week and has no allocation to be there this week.\n\nSee her through. Shoot what shoots at her. The Moot will square it with the Directorate, or it won’t, and either way it won’t be your problem.\n\nThe skippers sing on the way out. Sing along if you know it.',
    rank: 2,
    episode: 1,
    kind: 'escort',
    tier: 2,
    reward: 3400,
    merit: 80,
    rep: 3,
    enemy: { faction: 'concord', rep: -2 },
    where: { system: 'yoriamere', route: 'station-gate' },
    facts: { 'rustwake.haul-song': true },
    build(b) {
      escort(b, { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Nobody’s Daughter', tag: 'tender', destLabel: 'Yoriamere Lantern' });
      raiders(b, { tag: 'customs-1', after: 'resume:tender', blueprint: 'vf27-kestrel', faction: 'concord', name: 'Customs cutter', count: 2, place: { at: 'tag', tag: 'tender', offset: [2000, 400, 3600] }, delay: 18, staged: 2 });
      raiders(b, { tag: 'customs-2', after: 'resume:tender', blueprint: 'vf27-kestrel', faction: 'concord', name: 'Customs cutter', count: 3, place: { at: 'tag', tag: 'tender', offset: [-2400, 200, 3200] }, delay: 55, staged: 6 });
      b.cue('seen', (c) => c.alive('customs'));
      b.cue('depart:tender', (c) => c.flag('tender-arrived'));
      b.goal('escort', 'See Nobody’s Daughter through the Lantern', (c) => c.flag('tender-arrived'), 'tender', { failed: (c) => c.aliveCount('tender') === 0 });
      b.goal('customs', 'Break the customs picket', (c) => c.flag('seen') && c.aliveCount('customs') === 0, 'customs', { optional: true });
      b.beat(start, [say('cl-ferrow', 'There she is. Close up, marked hand. She won’t light for strangers.')]);
      b.beat(onFlag('resume:tender'), [hiss('cl-ashgrove', '(sung) Oh the Ember’s low and the gas is dear, and the Board don’t know that we’re out of here —'), say('cl-ferrow', 'Every time. Every single time she sings that one.', 3)]);
      b.beat(onFlag('seen'), [hiss('system', 'Clan tender, heave to for Continuity inspection. That is not a request.'), say('cl-ferrow', 'Neither’s this.', 2)], 2);
      b.beat(win, [say('cl-ferrow', 'Through! The Moot sings your name tonight. Badly, but loud.')]);
      b.beat(lose, [say('cl-ferrow', 'Nobody’s Daughter… Nobody’s now.')], 3);
    },
  }),
  S({
    id: 'rustwake-3',
    guild: 'rustwake',
    n: 3,
    title: 'The Outlaw Queen',
    synopsis: 'The Moot votes Ottoline Gutter-Crown done: break her court aboard a dead freighter in Quilegard and bring back her crown-beacon.',
    brief:
      'Ottoline Gutter-Crown crowned herself queen of a dead freighter off the Quilegard Lantern and taxed three clan tenders dry. The Moot voted last night. It was loud.\n\nShe is done. Break her court, put her down, and bring back the crown-beacon she welded to her bridge. We’ll hang it in the Moot-Hold. Upside down.\n\nTwice-marked hands do this sort of thing, flyer. That’s why they’re twice-marked.',
    rank: 3,
    episode: 2,
    kind: 'bounty',
    tier: 2,
    reward: 4600,
    merit: 100,
    rep: 4,
    where: { system: 'quilegard', gate: 0, dist: 9000, lat: -0.5 },
    facts: { 'rustwake.gutter-crown': 'dead' },
    build(b) {
      b.piece('derelict', 'court', b.at(b.c), { length: 600, belt: 700, tumble: 0.2, label: 'The dead freighter' }, 'THE COURT');
      b.cue('found', (c) => c.distanceTo('court') < b.d(6000, 1e9));
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 1, place: b.at(b.c, [0, 300, 900]), tag: 'queen', name: 'Ottoline Gutter-Crown', role: 'hostile', whenFlag: 'found' });
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 4, place: b.at(b.c, [500, 200, 1200]), tag: 'courtiers', name: 'Courtier', role: 'hostile', whenFlag: 'found' });
      b.cue('queen-seen', (c) => c.alive('queen'));
      b.cue('queen-dead', (c) => c.flag('queen-seen') && !c.alive('queen'));
      b.piece('blackbox', 'crown', { at: 'tag', tag: 'court', offset: [0, 400, 500] }, { whenFlag: 'queen-dead' }, 'CROWN-BEACON');
      b.goal('find', 'Find the outlaw court', (c) => c.flag('found'), 'court');
      b.goal('kill', 'Put down Ottoline Gutter-Crown', (c) => c.flag('queen-dead'), 'queen');
      b.goal('crown', 'Take the crown-beacon', (c) => c.flag('crown-recovered'), 'crown');
      b.beat(onFlag('queen-seen'), [hiss('mark-ottoline-gutter-crown', 'Who comes to my court without paying the toll? Kneel, flyer, or be salvage.'), say('cl-ferrow', 'The Moot sends its regards, Ottoline.', 2)], 2);
      b.beat(onFlag('queen-dead'), [say('system', 'CROWN-BEACON TRANSPONDER — MARKED.'), say('cl-ferrow', 'Get the crown. Mind the welds.', 2)], 2);
      b.beat(win, [say('cl-ferrow', 'Long live nobody. Come home, twice-marked. There’s drinking to be done about this.')]);
    },
  }),
  S({
    id: 'rustwake-4',
    guild: 'rustwake',
    n: 4,
    title: 'The Ember’s Last Skim',
    synopsis: 'Guard the Moot’s skim-tender at the Ember’s last rich seam through a Treasury raid — then shout for Clan Tey or the Graveyard Breakers.',
    brief:
      'The Ember has five winters left. It has said that for thirty. But this time Hester Tey found a seam in the corona richer than anything since her great-grandfather’s, and Magnus Ure says the Breakers found it first.\n\nThe Moot sends the Long Haul Home to skim it while it argues. Guard her at the seam. The Treasury has heard, and the Treasury does not argue; it sends Cantors.\n\nThe Moot votes when you’re back, Haul-Captain. Votes by shouting. You flew it — you shout first.',
    rank: 4,
    episode: 3,
    kind: 'escort',
    tier: 3,
    reward: 5800,
    merit: 120,
    rep: 5,
    where: { system: 'rustwake', route: 'station-gate', station: 'moot-hold' },
    build(b) {
      b.spawn({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: 1, place: b.at(b.start), tag: 'tender', name: 'Long Haul Home', role: 'escort', routeTo: 'dest' });
      b.labels.tender = 'LONG HAUL HOME';
      const seam = b.along(0.6, [1800, 600, 0]);
      b.beacon('dest', b.at(seam), 'The seam', {}, '#ffae4f');
      b.cue('halt:tender', () => true);
      b.cue('resume:tender', (c) => c.distanceTo('tender') < 2500);
      b.beacon('skim', b.at(seam, [0, 150, 0]), 'Skim perimeter', { hold: b.d(26, 3), radius: 1200, whenFlag: 'tender-arrived' }, '#ffae4f');
      raiders(b, { tag: 'treasury', after: 'tender-arrived', blueprint: 'choir-cantor', faction: 'choir', name: 'Treasury Cantor', count: 4, place: b.at(seam, [3000, 800, 3600]), delay: 8, staged: 1 });
      raiders(b, { tag: 'treasury-p', after: 'tender-arrived', blueprint: 'choir-psalter', faction: 'choir', name: 'Treasury Psalter', count: 2, place: b.at(seam, [-3200, 600, 3000]), delay: 30, staged: 4 });
      b.cue('seen', (c) => c.alive('treasury'));
      b.goal('meet', 'Rendezvous with the Long Haul Home', (c) => c.flag('resume:tender'), 'tender', { failed: (c) => c.aliveCount('tender') === 0 });
      b.goal('go', 'Take her to the seam', (c) => c.flag('tender-arrived'), 'tender', { failed: (c) => c.aliveCount('tender') === 0 });
      b.goal('skim', 'Guard the skim — hold the perimeter', (c) => c.flag('skim-held'), 'skim', { failed: (c) => c.aliveCount('tender') === 0 });
      b.goal('clear', 'Break the Treasury raid', (c) => c.flag('seen') && c.aliveCount('treasury') === 0, 'treasury', { failed: (c) => c.aliveCount('tender') === 0 });
      b.beat(start, [say('gd-tey', 'The seam is where my great-grandfather said it would be. Take the tender in, Haul-Captain.')]);
      b.beat(onFlag('tender-arrived'), [hiss('gd-breaker', 'Tey’s seam? Tey’s seam! Breaker sensors saw it first, you old —'), hiss('gd-tey', 'Your sensors are Tey salvage, Magnus.', 2), say('cl-ferrow', 'Both of you shut up. Skim.', 2)]);
      b.beat(onFlag('seen'), [say('system', 'TREASURY MEASURE INBOUND. HYMN ON OPEN BANDS.'), hiss('system', '(sung) What is gathered must be tithed —', 2)], 2);
      b.beat(onFlag('skim-held'), [say('system', 'SKIM COMPLETE. HOLD READS BLACK.'), say('gd-tey', 'Look at the edges of things. Violet. That’s money, and that’s blood.', 2)]);
      b.beat(win, [say('cl-ferrow', 'Home, Haul-Captain. The Moot’s waiting, and it’s already shouting.')]);
    },
    choice: {
      who: 'cl-ferrow',
      prompt: 'Clan Tey found the Ember. The Breakers found everything else. The seam feeds one of them for five winters — the real five. The Moot says: you flew it, you shout first.',
      options: [
        {
          id: 'tey',
          label: 'Shout for Clan Tey',
          who: 'gd-tey',
          line: 'Absalom’s seam, back with Absalom’s blood. Thank you, Ember-kin. The Tey will not forget a gram of it.',
          facts: { 'rustwake.seam': 'tey' },
          merit: { rustwake: 150 },
          rep: { concord: 2 },
          event: 'seam.tey',
          scope: 'system:rustwake',
        },
        {
          id: 'breakers',
          label: 'Shout for the Graveyard Breakers',
          who: 'gd-breaker',
          line: 'HA! Breakers’ gas! Your paint’s gold in every yard we own, Haul-Captain. Every one.',
          facts: { 'rustwake.seam': 'breakers' },
          merit: { rustwake: 150 },
          event: 'seam.breakers',
          scope: 'system:rustwake',
        },
      ],
    },
  }),

  // ════ ASCENDANT HOUSES OF HESPER — "The Honour Path" ════
  S({
    id: 'houses-1',
    guild: 'houses',
    n: 1,
    title: 'To Be Witnessed',
    synopsis: 'Guard a House pilgrim-barge to the foundry-gardens of Hesper, and let the Houses watch how a Directorate pilot keeps what is not hers.',
    brief:
      '(sung) Be witnessed.\n\nThe Clement Hour carries pilgrims from the Hesper Lantern — which hums, and has not opened since the Shattering — in to the foundry-gardens. The clans raid pilgrim-barges; the clans raid everything.\n\nThe Houses would see whether you guard what is not yours, guest. That is the whole of the first test. It is also, if you understand it, the whole of the last.',
    rank: 1,
    episode: 1,
    kind: 'escort',
    tier: 1,
    reward: 2600,
    merit: 60,
    rep: 3,
    where: { system: 'hesper', route: 'gate-station', station: 'foundry-garden' },
    build(b) {
      escort(b, { blueprint: 'choir-vesper', faction: 'choir', name: 'Clement Hour', tag: 'barge', destLabel: 'Foundry-gardens' });
      raiders(b, { tag: 'raiders-1', after: 'resume:barge', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 2, place: { at: 'tag', tag: 'barge', offset: [2200, 300, 3000] }, delay: 18, staged: 2 });
      raiders(b, { tag: 'raiders-2', after: 'resume:barge', blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider', count: 3, place: { at: 'tag', tag: 'barge', offset: [-2400, 500, 2600] }, delay: 58, staged: 6 });
      b.cue('seen', (c) => c.alive('raiders'));
      b.goal('escort', 'Guard the Clement Hour to the gardens', (c) => c.flag('barge-arrived'), 'barge', { failed: (c) => c.aliveCount('barge') === 0 });
      b.goal('raiders', 'Drive off the raiders', (c) => c.flag('seen') && c.aliveCount('raiders') === 0, 'raiders', { optional: true });
      b.beat(start, [say('gd-casimir', '(sung) Be witnessed. The Clement Hour waits for you. She is old, and slow, and full of people who have come a long way to pray.')]);
      b.beat(onFlag('resume:barge'), [say('system', 'LANTERN RESONANCE DETECTED. THE HESPER LANTERN IS HUMMING.'), say('gd-casimir', 'It always hums. It has never opened. We listen anyway.', 3)]);
      b.beat(onFlag('seen'), [say('system', 'CLAN RAIDERS. NO MOOT TRANSPONDER.'), say('gd-casimir', 'Guard her, guest. We are watching how.', 2)], 2);
      b.beat(win, [say('gd-casimir', '(sung) Witnessed. The Houses have seen you, pilot of the Directorate. They will remember.')]);
    },
  }),
  S({
    id: 'houses-2',
    guild: 'houses',
    n: 2,
    title: 'Unwitnessed',
    synopsis: 'End the silence of Ismene, a Cantor who stopped singing and flies better for it — and hear what she says about the quiet.',
    brief:
      'Ismene was a Cantor of the Lesser Measure. Eleven weeks ago she stopped singing. A Cantor who stops singing flies worse; everyone knows this. Ismene flies well. That is the problem.\n\nShe waits off the Uliaban Lantern with the two who stopped with her. End it, Postulant. She will talk to you. The unwitnessed always do.\n\nDo not listen too closely to the quiet.',
    rank: 2,
    episode: 2,
    kind: 'bounty',
    tier: 2,
    reward: 3800,
    merit: 80,
    rep: 3,
    where: { system: 'uliaban', gate: 0, dist: 8000, lat: 0.5 },
    facts: { 'houses.ismene': 'silenced' },
    build(b) {
      b.piece('wreckage', 'lair', b.at(b.c), { radius: 800, count: 120, label: 'The quiet place' }, 'THE QUIET PLACE');
      b.cue('found', (c) => c.distanceTo('lair') < b.d(6000, 1e9));
      b.spawn({ blueprint: 'choir-cantor', faction: 'choir', count: 1, place: b.at(b.c, [0, 200, 700]), tag: 'ismene', name: 'Unwitnessed Ismene', role: 'hostile', whenFlag: 'found' });
      b.spawn({ blueprint: 'choir-cantor', faction: 'choir', count: 2, place: b.at(b.c, [400, 100, 1000]), tag: 'silent', name: 'Silent Cantor', role: 'hostile', whenFlag: 'found' });
      b.cue('seen', (c) => c.alive('ismene'));
      b.goal('find', 'Find the unwitnessed', (c) => c.flag('found'), 'lair');
      b.goal('kill', 'End Ismene’s silence', (c) => c.flag('seen') && !c.alive('ismene'), 'ismene');
      b.goal('wing', 'The two who stopped with her', (c) => c.flag('seen') && c.aliveCount('silent') === 0, 'silent', { optional: true });
      b.beat(onFlag('seen'), [
        hiss('mark-unwitnessed-ismene', 'Directorate. They sent a Directorate pilot to make me sing. How like them.'),
        hiss('mark-unwitnessed-ismene', 'They sing because they are afraid of the quiet. Listen to it with me. Just once.', 4),
        say('gd-casimir', 'Do not answer her, Postulant.', 3),
      ], 2);
      b.beat(win, [say('gd-casimir', 'The silence is ended. The House thanks you. It will not thank her. (sung) Ascend.')]);
    },
  }),
  S({
    id: 'houses-3',
    guild: 'houses',
    n: 3,
    title: 'The Lesser Measure',
    synopsis: 'Fly in a Choir Measure beside Cantor Verity at Zephacis, against Directorate Kestrels off the Schedule — your own side’s paint in your sights.',
    brief:
      'A Lesser Measure of House Casimir flies the Zephacis line tonight against Directorate Kestrels who are not on any Schedule — raiders in picket paint, the Houses believe.\n\nFly with them, Cantor. Form on Verity; she will sing, and you will learn why the Measures sing.\n\nThe Directorate will see your transponder beside ours. That is what it means to walk the honour path. We will not pretend otherwise, and neither should you.',
    rank: 3,
    episode: 3,
    kind: 'sortie',
    tier: 2,
    reward: 5000,
    merit: 100,
    rep: 5,
    enemy: { faction: 'concord', rep: -4 },
    where: { system: 'zephacis', gate: 1, dist: 8000, lat: 0.5 },
    facts: { 'houses.flew-measure': true },
    build(b) {
      b.beacon('rally', b.at(b.c), 'Measure rally point', {}, '#ff5fb4');
      b.spawn({ blueprint: 'choir-cantor', faction: 'choir', count: 3, place: b.at(b.c, [-200, 60, -250]), tag: 'measure', name: 'Cantor of Casimir', role: 'wing' });
      raiders(b, { tag: 'kestrels-1', after: 'rallied', blueprint: 'vf27-kestrel', faction: 'concord', name: 'Off-Schedule Kestrel', count: 3, place: b.at(b.c, [900, 600, 5600]), delay: 5 });
      raiders(b, { tag: 'kestrels-2', after: 'rallied', blueprint: 'vf31-harrier', faction: 'concord', name: 'Off-Schedule Harrier', count: 2, place: b.at(b.c, [-1200, 400, 6200]), delay: 38, staged: 5 });
      b.cue('seen', (c) => c.alive('kestrels'));
      b.goal('rally', 'Form on Cantor Verity’s Measure', (c) => c.distanceTo('rally') < 1500, 'rally', { setsFlag: 'rallied' });
      b.goal('break', 'Break the off-Schedule flight — 5 fighters', (c) => c.kills('concord') >= 5, 'kestrels');
      b.beat(start, [say('gd-verity', '(sung) Form on me, Cantor! Sing if you can — shout if you can’t!')]);
      b.beat(onFlag('seen'), [hiss('system', 'Unidentified Choir flight, you are — wait. That transponder is Directorate.'), say('gd-verity', 'They see you. Good. Let them.', 2), say('gd-verity', '(sung) What is lifted must be worthy —', 2)], 2);
      b.beat({ on: 'kills', faction: 'concord', count: 3 }, [say('gd-verity', 'Ha! You sing flat, Cantor. The Hymn does not mind.')]);
      b.beat(win, [say('gd-verity', '(sung) What is worthy climbs alone! …Home, Cantor. The Herald will want to hear it from me first.')]);
    },
  }),
  S({
    id: 'houses-4',
    guild: 'houses',
    n: 4,
    title: 'What Is Lifted',
    synopsis: 'Fly the Observance at Tessaly as a Cantor, guns cold, until a Directorate provocateur fires on the Herald’s barge — then answer the Houses’ last question.',
    brief:
      'The Observance flies at Tessaly this week. You will fly it on our side of the Line, Cantor — guns cold, three markers, the Herald’s barge behind you.\n\nSomeone will break it. Someone always does, now. It will not be the Houses, and it will not be you.\n\nWhen it is done, come to the Spire. The Houses have a question to ask you, and it is the last one.',
    rank: 4,
    episode: 4,
    kind: 'patrol',
    tier: 3,
    reward: 6400,
    merit: 120,
    rep: 5,
    where: { system: 'tessaly', gate: 0, dist: 9000, lat: 0.3 },
    build(b) {
      const wps: V3[] = [[0, 0, 0], [2600, 300, 1800], [5200, 0, 3200]];
      wps.forEach((o, i) => {
        b.beacon(`m${i + 1}`, b.at(b.c, o), `Observance marker ${i + 1}`, {}, '#ff5fb4');
        b.goal(`m${i + 1}`, `Observance marker ${i + 1}/3 — guns cold`, (c) => c.distanceTo(`m${i + 1}`) < 700, `m${i + 1}`, { setsFlag: `m${i + 1}` });
      });
      b.spawn({ blueprint: 'choir-vesper', faction: 'choir', count: 1, place: b.at(b.c, [-400, 200, -900]), tag: 'herald', name: 'Herald’s barge', role: 'static' });
      b.spawn({ blueprint: 'choir-cantor', faction: 'choir', count: 2, place: b.at(b.c, [-250, 60, -300]), tag: 'measure', name: 'Cantor of Casimir', role: 'wing' });
      raiders(b, { tag: 'provocateurs', after: 'm3', blueprint: 'vf27-kestrel', faction: 'concord', name: 'Provocateur', count: 4, place: b.at(b.c, [2600, 500, -2400]), delay: 4 });
      b.cue('broken', (c) => c.alive('provocateurs'));
      b.goal('cold', 'No kills before the Line is broken', (c) => c.flag('broken'), undefined, { optional: true, failed: (c) => !c.flag('broken') && (c.kills('concord') > 0 || c.kills('choir') > 0) });
      b.goal('defend', 'Defend the Herald’s barge', (c) => c.flag('broken') && c.aliveCount('provocateurs') === 0, 'provocateurs', { failed: (c) => c.aliveCount('herald') === 0 });
      b.beat(start, [say('gd-casimir', 'Fly the Line as one of us, Cantor. Guns cold. If someone breaks the Observance, it will not be the Houses.')]);
      b.beat(onFlag('m2'), [say('system', 'DIRECTORATE MEASURE ACROSS THE LINE. GUNS COLD. COUNTING.'), say('gd-verity', 'They are counting us. We are counting them. Everybody counts twice.', 3)]);
      b.beat(onFlag('broken'), [hiss('system', 'Nothing personal, turncoat. It’s on the Schedule.'), say('gd-casimir', 'The Line is broken. Not by us. Defend the barge.', 2)], 2);
      b.beat(win, [say('gd-casimir', '(sung) Witnessed. Come to the Spire, Cantor. The Houses are waiting.')]);
      b.beat(lose, [say('gd-verity', 'The Herald — the Herald is gone —')], 3);
    },
    choice: {
      who: 'gd-casimir',
      prompt: 'House Casimir offers you its name. Take the Oath and you are ours — a Knight-Cantor in time, Ascendant after. Your Directorate will call it defection. Refuse, and you remain what you are: witnessed, honoured, and outside.',
      options: [
        {
          id: 'sworn',
          label: 'Take the Oath of House Casimir',
          who: 'gd-casimir',
          line: '(sung) What is lifted must be worthy. What is worthy climbs alone. — You are ours now, Cantor. Be witnessed, always.',
          facts: { 'houses.oath': 'sworn', 'player.defected': true },
          merit: { houses: 200 },
          rep: { concord: -35, choir: 25 },
          expel: ['continuity', 'allocation'],
          event: 'player.defected',
          scope: 'faction:choir',
        },
        {
          id: 'declined',
          label: 'Decline, and stay unsworn',
          who: 'gd-casimir',
          line: 'Then be witnessed as you are. The Houses honour a refusal more than most oaths. We will not ask again. …We may hope.',
          facts: { 'houses.oath': 'declined' },
          merit: { houses: 60 },
          rep: { concord: 4 },
          event: 'houses.declined',
          scope: 'guild:houses',
        },
      ],
    },
  }),
];

export const ARC_BY_ID: Record<string, ArcStep> = Object.fromEntries(ARCS.map((a) => [a.id, a]));

export function arcOf(g: GuildId): ArcStep[] {
  return ARCS.filter((a) => a.guild === g).sort((a, b) => a.n - b.n);
}

// ── state ───────────────────────────────────────────────────────────────

export type ArcStatus = 'done' | 'choice' | 'active' | 'available' | 'locked';

export function stepDone(w: WorldState, s: ArcStep): boolean {
  return fact(w, `arc.${s.guild}.${s.n}`) === true;
}

/** The step waiting for its choice at the hall, if any. */
export function pendingChoice(w: WorldState, g: GuildId): ArcStep | null {
  const id = fact(w, `arc.${g}.pending`);
  return typeof id === 'string' && id ? (ARC_BY_ID[id] ?? null) : null;
}

/**
 * Where each step of `g`'s arc stands for this pilot. `activeIds` = arc ids
 * of contracts on the book; `episode` = the next campaign episode.
 */
export function arcState(w: WorldState, g: GuildId, episode: number, activeIds: readonly string[] = []): { step: ArcStep; status: ArcStatus; why?: string }[] {
  const rank = rankOf(w, g);
  const pending = pendingChoice(w, g);
  return arcOf(g).map((step, i, all) => {
    if (pending?.id === step.id) return { step, status: 'choice' as const };
    if (stepDone(w, step)) return { step, status: 'done' as const };
    if (activeIds.includes(step.id)) return { step, status: 'active' as const };
    const prev = all[i - 1];
    if (prev && (!stepDone(w, prev) || pendingChoice(w, g)?.id === prev.id)) return { step, status: 'locked' as const, why: `AFTER “${prev.title.toUpperCase()}”` };
    if (rank < step.rank) return { step, status: 'locked' as const, why: `RANK ${step.rank} · ${GUILDS[g].ranks[step.rank - 1].name.toUpperCase()}` };
    if (episode < step.episode) return { step, status: 'locked' as const, why: `AFTER EPISODE ${String(step.episode).padStart(2, '0')}` };
    return { step, status: 'available' as const };
  });
}

// ── contracts ───────────────────────────────────────────────────────────

export interface ArcInput {
  reach: ReachMap;
  /** The hall the step is taken at (and paid at). */
  station: string;
  clock: number;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const addV = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v: V3): V3 => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];

/** Resolve a step's `where` in the Reach (falls back to the hall's own system). */
export function resolveWhere(reach: ReachMap, where: Where, hallSystem: string, salt: string): { sys: ReachSystem; center: V3; start?: V3; end?: V3; endName?: string } | null {
  const sys = reach.systems.find((s) => s.id === where.system) ?? reach.systems.find((s) => s.id === hallSystem);
  if (!sys) return null;
  const h = hashStr(salt);
  if ('route' in where) {
    const gateStations = sys.stations.filter((s) => s.planet === undefined);
    const re = where.station ? new RegExp(where.station, 'i') : null;
    const st: ReachStation | undefined = (re && sys.stations.find((s) => re.test(s.name))) || gateStations[0] || sys.stations[0];
    if (!st || !sys.gates.length) return null;
    const gate = where.gate !== undefined ? sys.gates[where.gate % sys.gates.length] : [...sys.gates].sort((a, b) => dist(a.pos, st.pos) - dist(b.pos, st.pos))[0];
    const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
    const bay = addV(st.pos, st.axis, st.planet !== undefined ? 3000 : 2600);
    const gatePt = addV(gate.pos, inward, where.route === 'gate-station' ? 900 : 500);
    const gName = reach.systems.find((s) => s.id === gate.to)?.name ?? gate.to;
    const [a, b] = where.route === 'gate-station' ? [gatePt, bay] : [bay, gatePt];
    return { sys, center: round(a), start: round(a), end: round(b), endName: where.route === 'gate-station' ? st.name : `${gName} Lantern` };
  }
  const gate = sys.gates[(where.gate ?? 0) % Math.max(1, sys.gates.length)];
  if (!gate) return { sys, center: [0, 0, 0] };
  const inward: V3 = [-gate.normal[0], -gate.normal[1], -gate.normal[2]];
  const side: V3 = [-gate.normal[2], 0, gate.normal[0]];
  const sl = Math.hypot(side[0], side[2]) || 1;
  const lat = where.lat ?? ((h % 100) / 100 - 0.5);
  const c = addV(addV(gate.pos, inward, where.dist), [side[0] / sl, 0, side[2] / sl], lat * where.dist * 0.6);
  c[1] += ((h >>> 8) % 1200) - 600;
  return { sys, center: round(c) };
}

/** The contract for arc step `id`, offered at `inp.station` (a hall of its guild). */
export function arcContract(id: string, inp: ArcInput): Contract | null {
  const s = ARC_BY_ID[id];
  if (!s) return null;
  const here = findStation(inp.reach, inp.station);
  if (!here) return null;
  const at = resolveWhere(inp.reach, s.where, here.system.id, s.id);
  if (!at) return null;
  const jumps = hops(inp.reach, here.system.id).get(at.sys.id) ?? 0;
  const g = GUILDS[s.guild];
  const epoch = Math.floor(Math.max(0, inp.clock) / BOARD_PERIOD);
  const reward = Math.round((s.reward + 250 * jumps) / 50) * 50;
  const k: Contract = {
    id: `arc:${s.id}@${epoch}`,
    kind: s.kind,
    tier: s.tier,
    client: g.master,
    faction: g.faction,
    title: `${g.short} · ${s.title}`,
    brief: s.brief,
    origin: here.station.id,
    originName: here.station.name,
    originSystem: here.system.id,
    payAt: here.station.id,
    payAtName: here.station.name,
    payAtSystem: here.system.id,
    op: {
      system: at.sys.id,
      center: at.center,
      start: at.start,
      end: at.end,
      endKind: at.end ? 'station' : undefined,
      endName: at.endName,
      hostiles: 0,
      waves: 0,
      enemy: { blueprint: 'rw-scrapjack', faction: 'rustwake', name: 'Raider' },
      seed: hashStr(`${s.id}@${epoch}`),
    },
    reward,
    rep: s.rep,
    enemy: s.enemy,
    penalty: Math.round((reward * 0.2) / 50) * 50,
    repPenalty: 1,
    duration: 2400 + 600 * jumps,
    expires: inp.clock + BOARD_PERIOD * 50,
    jumps,
    state: 'offered',
    guild: s.guild,
    merit: s.merit,
    arc: s.id,
  };
  return k;
}

/** Build the in-space operation for an arc contract (called from contracts/ops.ts). */
export function buildArcOp(k: Contract, offset: V3, opts: OpOptions = {}): OpBuild | null {
  const s = k.arc ? ARC_BY_ID[k.arc] : undefined;
  if (!s || !k.op) return null;
  const kit = new Kit(k, offset, !!opts.stage);
  s.build(kit);
  const mission: CampaignMission = {
    id: `contract:${k.id}`,
    chapter: 1,
    episode: 0,
    title: k.title,
    milestones: [],
    system: k.op.system,
    briefing: k.brief,
    tagline: '',
    // Visible goals first (the runner activates objective 0 and unlocks goals in
    // order); hidden cues are optional and run in parallel from the start.
    objectives: [...kit.objectives.filter((o) => !o.hidden), ...kit.objectives.filter((o) => o.hidden)],
    spawns: kit.spawns,
    setpieces: kit.setpieces,
    chatter: kit.chatter,
    codex: [],
    debrief: '',
  };
  return { mission, nav: kit.nav, labels: kit.labels, completes: true };
}

// ── completion & choices ────────────────────────────────────────────────

/**
 * An arc contract was turned in: mark the step, set its facts, record the
 * event, and (for a finale) leave its choice pending at the hall.
 */
export function completeStep(w: WorldState, id: string): WorldState {
  const s = ARC_BY_ID[id];
  if (!s || stepDone(w, s)) return w;
  let next = setFact(w, `arc.${s.guild}.${s.n}`, true);
  for (const [f, v] of Object.entries(s.facts ?? {})) next = setFact(next, f, v);
  next = record(next, 'guild.arc', `guild:${s.guild}`, { step: s.id, n: s.n });
  if (s.choice) next = setFact(next, `arc.${s.guild}.pending`, s.id);
  return next;
}

/** Make the finale's choice: facts, merit, standing, expulsions; the arc is done. */
export function choose(w: WorldState, stepId: string, optionId: string): GuildResult & { option?: ArcChoice } {
  const s = ARC_BY_ID[stepId];
  const opt = s?.choice?.options.find((o) => o.id === optionId);
  if (!s || !opt) return { world: w, rep: {}, notes: [{ text: 'NO SUCH CHOICE', cls: 'err' }], error: 'NO SUCH CHOICE' };
  if (pendingChoice(w, s.guild)?.id !== s.id) return { world: w, rep: {}, notes: [{ text: 'NOTHING TO DECIDE', cls: 'err' }], error: 'NOTHING TO DECIDE' };
  let next = setFact(w, `arc.${s.guild}.pending`, '');
  next = setFact(next, `arc.${s.guild}.done`, true);
  next = setFact(next, `arc.${s.guild}.choice`, opt.id);
  for (const [f, v] of Object.entries(opt.facts)) next = setFact(next, f, v);
  next = record(next, opt.event, opt.scope, { arc: s.guild, choice: opt.id });
  const notes: GuildResult['notes'] = [{ text: `${GUILDS[s.guild].short} · ${opt.label.toUpperCase()}`, cls: 'ok' }];
  for (const [g, m] of Object.entries(opt.merit ?? {}) as [GuildId, number][]) {
    const r = awardMerit(next, g, m, `choice:${opt.id}`);
    next = r.world;
    notes.push(...r.notes);
    // Merit taken below zero by a choice costs membership.
    if (m < 0 && rankOf(next, g) > 0 && (next.counters[`guild.${g}.merit`] ?? 0) < 0) {
      const e = expel(next, g, opt.label.toLowerCase());
      next = e.world;
      notes.push(...e.notes);
    }
  }
  for (const g of opt.expel ?? []) {
    const e = expel(next, g, opt.label.toLowerCase());
    next = e.world;
    notes.push(...e.notes);
  }
  return { world: next, rep: { ...(opt.rep ?? {}) }, notes, option: opt };
}
