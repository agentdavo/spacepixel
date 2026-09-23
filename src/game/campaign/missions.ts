/**
 * PROJECT VANGUARD — the campaign, as data. 20 episodes in 4 chapters.
 * Story reference: docs/CAMPAIGN.md (outline) and docs/LORE.md (bible).
 *
 * ─── RUNTIME NOTES (for the CampaignRunner author) ────────────────────────
 * Predicates only use the CampaignContext API from ./types. On top of the
 * built-in set-piece flags (`${tag}-recovered`, `-scanned`, `-contact`,
 * `-reached`, `-complete`, `-exited`, `-destroyed`, and `bastion-attack`),
 * these missions rely on the following conventions:
 *
 *  1. SCRIPT CUES. Objectives with `hidden: true, optional: true` are script
 *     triggers, never shown in the HUD. When their predicate passes they set
 *     their `setsFlag`. Flags with these prefixes are commands:
 *       destroy:<tag>  cinematic destruction of the tagged ship(s); overrides
 *                      PLOT_ARMOUR (Episode 15: Jackpot).
 *       depart:<tag>   tagged ship(s) break off and jump / fly out, then are
 *                      removed. Not counted as kills.
 *       halt:<tag>     an 'escort' stops on its route; resume:<tag> continues.
 *  2. ESCORT ARRIVAL. When every surviving ship of an 'escort' group is within
 *     800 m of its `routeTo` target, set flag `${tag}-arrived`.
 *  3. BEACON DWELL. A 'beacon' set piece with `params.hold` (seconds) and
 *     optional `params.radius` (m, default 300) sets `${tag}-held` once the
 *     player has stayed inside the radius for `hold` seconds (show a ring).
 *     Beacons without `hold` are plain nav points / props.
 *  4. DEFERRED SET PIECES. A set piece with `params.whenFlag` appears only
 *     when that flag is set; its Placement is resolved at that moment.
 *  5. DEFERRED SPAWNS. When a SpawnSpec has both `whenFlag` and `delay`, the
 *     delay counts from the moment the flag is set.
 *  6. MULTI-SYSTEM (Episode 19). The mission keeps running across jumps;
 *     deferred spawns and set pieces resolve in the player's current system.
 *  7. ALLEGIANCE BY ROLE. `role` overrides faction alignment: 'hostile' on a
 *     'concord' ship is a renegade (Eps 14, 18); 'wing' on 'choir' or
 *     'rustwake' ships is an ally; 'static' ships of any faction are
 *     non-hostile unless the player damages them (Ep 3 Observance, Ep 17).
 *  8. kills(faction) counts every ship of that faction destroyed during the
 *     mission, by anyone. depart:/destroy: removals are not counted.
 *  9. PLOT_ARMOUR (exported below) lists tags that must not die from damage:
 *     clamp their hull at ~0.15. (Objectives read hull() < 0.35-0.45 to fire
 *     withdrawal cues, so clamping below that keeps the story moving.)
 * 10. MONOLITH distances (the 20 km `-contact` and distanceTo) are measured
 *     from the sphere's surface, `params.radius`. MEGAGATE distances are to
 *     the centre of the throat.
 * 11. Offsets: metres, +Z = the player's initial heading, +Y = up.
 * 12. Chatter: `static: true` renders as a garbled intercept. Lines starting
 *     "(sung)" are the Choir's Hymn: italicise, add a music glyph if the font
 *     has one.
 * 13. Procedural system ids (seed 1994): 'zephacis', 'lysowick', 'corouhold'.
 *     If the generator changes, use SYSTEM_FALLBACK.
 */
import type {
  CampaignContext,
  CampaignMission,
  CampaignObjective,
  ChatterBeat,
  ChatterLine,
  ChatterTrigger,
  Placement,
  SetPieceKind,
  SetPieceSpec,
  SpawnSpec,
} from './types';
import type { FactionId } from '@/assets/Blueprint';

// ── Exports for the runtime ─────────────────────────────────────────────

/** Tags that must never be destroyed by damage (see note 9). */
export const PLOT_ARMOUR: string[] = ['kade', 'jackpot', 'candle', 'sparrow', 'salt', 'psalm', 'magpie', 'canticle', 'altitude', 'indomitable'];

/** Procedural systems used by the campaign, and a key-system fallback for each. */
export const SYSTEM_FALLBACK: Record<string, string> = {
  zephacis: 'tessaly',
  lysowick: 'meridian',
  corouhold: 'rustwake',
};

// ── Blueprint ids (src/assets/blueprints) ───────────────────────────────

const KESTREL = 'vf27-kestrel';
const HARRIER = 'vf31-harrier';
const LANTERN_GUARD = 'ffc-lantern-guard';
const DAWN = 'cvs07-hesperus-dawn';
const INDOMITABLE = 'bb-indomitable';
const CANTOR = 'choir-cantor';
const PSALTER = 'choir-psalter';
const VESPER = 'choir-vesper';
const CATHEDRAL = 'choir-cathedral';
const SCRAPJACK = 'rw-scrapjack';

// ── Authoring helpers ───────────────────────────────────────────────────

type Pred = (c: CampaignContext) => boolean;

const say = (who: string, text: string, delay?: number): ChatterLine => (delay === undefined ? { who, text } : { who, text, delay });
const hiss = (who: string, text: string, delay?: number): ChatterLine => ({ ...say(who, text, delay), static: true });
const beat = (id: string, trigger: ChatterTrigger, lines: ChatterLine[], priority?: number): ChatterBeat =>
  priority === undefined ? { id, trigger, lines } : { id, trigger, lines, priority };

const START: ChatterTrigger = { on: 'start' };
const SUCCESS: ChatterTrigger = { on: 'success' };
const FAILURE: ChatterTrigger = { on: 'failure' };
const HULL_LOW: ChatterTrigger = { on: 'hull-low' };
const at = (t: number): ChatterTrigger => ({ on: 'time', at: t });
const onFlag = (flag: string): ChatterTrigger => ({ on: 'flag', flag });
const onDone = (objective: string): ChatterTrigger => ({ on: 'objective-done', objective });
const onActive = (objective: string): ChatterTrigger => ({ on: 'objective-active', objective });
const near = (tag: string, distance: number): ChatterTrigger => ({ on: 'near', tag, distance });
const killsOf = (faction: FactionId, count: number): ChatterTrigger => ({ on: 'kills', faction, count });

const ahead = (x: number, y: number, z: number): Placement => ({ at: 'player', offset: [x, y, z] });
const by = (tag: string, x: number, y: number, z: number): Placement => ({ at: 'tag', tag, offset: [x, y, z] });

const obj = (id: string, text: string, done: Pred, extra: Partial<CampaignObjective> = {}): CampaignObjective => ({ id, text, done, ...extra });
/** A hidden script cue: sets `flag` when `when` passes. */
const cue = (id: string, flag: string, when: Pred): CampaignObjective => ({ id, text: `[cue] ${flag}`, hidden: true, optional: true, done: when, setsFlag: flag });

const piece = (kind: SetPieceKind, tag: string, place: Placement, params?: Record<string, number | string | boolean>): SetPieceSpec =>
  params ? { kind, tag, place, params } : { kind, tag, place };

type SquadId = 'kade' | 'jackpot' | 'candle' | 'sparrow' | 'salt';
const SQUAD: Record<SquadId, { name: string; blueprint: string; slot: [number, number, number] }> = {
  kade: { name: 'Vanguard 2 · Abbess', blueprint: KESTREL, slot: [-45, 8, -55] },
  jackpot: { name: 'Vanguard 3 · Jackpot', blueprint: KESTREL, slot: [45, 8, -55] },
  candle: { name: 'Vanguard 4 · Candle', blueprint: HARRIER, slot: [-95, -6, -110] },
  sparrow: { name: 'Vanguard 5 · Sparrow', blueprint: KESTREL, slot: [95, -6, -110] },
  salt: { name: 'Vanguard 6 · Salt', blueprint: HARRIER, slot: [0, 20, -150] },
};
const squad = (...who: SquadId[]): SpawnSpec[] =>
  who.map((id) => ({ blueprint: SQUAD[id].blueprint, faction: 'concord', count: 1, place: ahead(...SQUAD[id].slot), tag: id, name: SQUAD[id].name, role: 'wing' }));

const spawn = (blueprint: string, faction: FactionId, count: number, place: Placement, tag: string, name: string, role: SpawnSpec['role'], extra: Partial<SpawnSpec> = {}): SpawnSpec => ({
  blueprint,
  faction,
  count,
  place,
  tag,
  name,
  role,
  ...extra,
});

/** Psalm withdraws (depart) when hurt or when her Measure is broken. */
const psalmWithdraws = (id: string, killsNeeded: number): CampaignObjective =>
  cue(id, 'depart:psalm', (c) => c.alive('psalm') && (c.hull('psalm') < 0.45 || c.kills('choir') >= killsNeeded));

const briefing = (...paras: string[]): string => paras.join('\n\n');

// ════════════════════════════════════════════════════════════════════════
// CHAPTER I — THE MYTH AND THE MACHINE
// Before Vanguard: the player is a ferry and picket pilot, "Four-One-Three",
// flying Kestrel airframe 0413, whose golden-age flight computer remembers.
// ════════════════════════════════════════════════════════════════════════

const EP01: CampaignMission = {
  id: 'ep01-the-long-dark',
  chapter: 1,
  episode: 1,
  title: 'THE LONG DARK',
  milestones: [1],
  system: 'anchorage',
  tagline: 'Service will resume shortly.',
  briefing: briefing(
    'CLOISTER OF THE KEEPING, ANCHORAGE. TO: FERRY PILOT, AIRFRAME 0413.',
    'The airframe is kept. Its heart is older than the Directorate, older than the Relighting, older than the dark. You will carry it from the Cloister cradle to the fleet yards by the long road, through the Graveyard, as every reborn Kestrel has done for two hundred years, so that it may see what it survived.',
    'Warden-Brother Oduya will fly chase and read the Keepings. Follow the survey buoys. Do not touch the wrecks; they are not ours. If you find anyone stripping the dead, you are armed, and the Graveyard is Directorate space.',
    'You will pass the Great Lantern. It has been dark for 431 years. A beacon there still broadcasts. Do not switch it off.',
    'Keep the light.',
  ),
  objectives: [
    obj('buoy1', 'Follow the survey buoys into the Graveyard (1/3)', (c) => c.distanceTo('buoy1') < 300),
    obj('buoy2', 'Follow the survey buoys (2/3)', (c) => c.distanceTo('buoy2') < 300),
    obj('buoy3', 'Follow the survey buoys (3/3)', (c) => c.distanceTo('buoy3') < 300, { setsFlag: 'thieves' }),
    obj('thieves', 'Drive the scavengers off the school tender', (c) => c.kills('rustwake') >= 3),
    obj('beacon', 'Approach the Timetable beacon at the Great Lantern', (c) => c.distanceTo('timetable') < 400),
    obj('yards', 'Deliver airframe 0413 to Anchorage Yards', (c) => c.distanceTo('yards') < 600),
  ],
  spawns: [
    spawn(HARRIER, 'concord', 1, ahead(-50, 10, -60), 'candle', 'Brother Oduya · Candle', 'wing'),
    spawn(SCRAPJACK, 'rustwake', 3, by('graveyard', 600, 200, 1200), 'thieves', 'Scav Cutter', 'hostile', { whenFlag: 'thieves', delay: 4 }),
  ],
  setpieces: [
    piece('wreckage', 'graveyard', ahead(0, 0, 8000), { radius: 4500, density: 'heavy', era: 'golden-age', label: 'The Timetable Graveyard' }),
    piece('wreckage', 'greatring', ahead(0, 800, 13500), { shape: 'ring', radius: 6000, lit: false, label: 'Anchorage Great Lantern (dark)' }),
    piece('beacon', 'buoy1', ahead(0, 0, 2500), { label: 'Survey buoy 1' }),
    piece('beacon', 'buoy2', ahead(1400, 300, 5600), { label: 'Survey buoy 2' }),
    piece('beacon', 'buoy3', ahead(-900, -300, 9000), { label: 'Survey buoy 3' }),
    piece('beacon', 'timetable', ahead(0, 600, 12500), { label: 'Timetable beacon', loop: 'Service will resume shortly.', color: '#6fe6ff' }),
    piece('beacon', 'yards', ahead(-4000, -500, 15500), { label: 'Anchorage Yards' }),
  ],
  chatter: [
    beat('open', START, [
      say('system', 'CORE WAKING. GOOD MORNING, PILOT. TIMETABLE NOMINAL.'),
      say('candle', 'Hm. It hasn\'t said "good morning" to anyone in forty years. It likes you, Four-One-Three.'),
      say('candle', 'Brother Oduya, flying chase. Before we light, the Keepings. Humour an old warden.'),
      say('candle', 'First keeping: the seal holds. Second: the feed runs clean. Third: the fire is fed and not starved.'),
      say('candle', 'Fourth: the cold is let out. Fifth: the old words are said. Sixth: we do not ask the engine why.'),
      say('candle', 'Seventh: we thank it, and we go. Go on, Four-One-Three. Go.'),
    ], 2),
    beat('graveyard', near('graveyard', 5000), [
      say('candle', 'There. The Graveyard. Don\'t stare too long. Everyone does.'),
      say('candle', 'Liners. Freighters. A school tender. All of them caught halfway through when the dark came.'),
      say('system', 'PASSENGER MANIFESTS AVAILABLE. DISPLAY?'),
      say('candle', 'No. No, thank you.'),
    ]),
    beat('thieves', onFlag('thieves'), [
      say('system', 'CONTACTS IN THE WRECKS. RUSTWAKE TRANSPONDERS. THREE.'),
      say('candle', 'Cutters. They\'re stripping the school tender. That\'s a grave, you thieving— forgive me.'),
      say('candle', 'Weapons free, Four-One-Three. Shoot the living. Leave the dead be.'),
    ], 2),
    beat('first-kill', killsOf('rustwake', 1), [say('candle', 'Mind the hulls behind them. There are children\'s shoes in that tender. I checked, once.')]),
    beat('clear', onDone('thieves'), [
      say('candle', 'Gone. May they find something honest to steal.'),
      say('system', 'TIMETABLE CARRIER DETECTED. BEARING: GREAT LANTERN.'),
    ]),
    beat('announcement', near('timetable', 1600), [
      hiss('system', '[chime] Meridian Concord Timetable Authority. A service announcement for passengers at Anchorage Great Lantern.'),
      hiss('system', 'Service to Meridian, Hesper, Tessaly and all points coreward is delayed. We apologise for the inconvenience.'),
      hiss('system', 'Vessels in transit: please hold your position. A tender is on its way.'),
      hiss('system', 'Service will resume shortly. Thank you for travelling with the Timetable. [chime]'),
      say('candle', 'Four hundred and thirty-one years it\'s been saying that.'),
      say('candle', 'We don\'t switch it off. Somebody ought to keep the promise, even if it\'s only a machine.'),
    ], 3),
    beat('echo', onDone('beacon'), [
      say('system', 'SERVICE WILL RESUME SHORTLY.', 2),
      say('candle', '...Your core just said that back to it.'),
    ]),
    beat('hurt', HULL_LOW, [say('candle', 'You\'re bleeding air, Four-One-Three. The old girl can take it. Can you?')]),
    beat('home', SUCCESS, [
      say('candle', 'Anchorage Yards, this is Brother Oduya. Airframe 0413 is delivered, and kept.'),
      say('candle', 'I think I\'ll ask for a transfer. I find I don\'t want to let this engine out of my sight.'),
    ]),
    beat('lost', FAILURE, [say('candle', 'Four-One-Three? ...Recovery team to the Graveyard. Bring the core home. Always bring the core home.')]),
  ],
  codexOnStart: ['hist-shattering'],
  codex: ['hist-timetable', 'log-timetable-beacon', 'tech-fossil'],
  modifiers: { ambience: 'sublime' },
  debrief:
    'Airframe 0413 delivered to Anchorage Yards. Three Rustwake cutters destroyed in the Graveyard; the school tender is undisturbed.\n\n' +
    'The beacon recording has been added to the Cloister archive, where there are now 4,017 copies of it, one for every reborn Kestrel that has passed the Great Lantern since 224 AS.\n\n' +
    'Warden-Brother Ilesanmi Oduya has requested transfer to fleet duty as a warden-pilot, citing "a disinclination to let this engine out of my sight." Request under review.',
};

const EP02: CampaignMission = {
  id: 'ep02-fossil-fire',
  chapter: 1,
  episode: 2,
  title: 'FOSSIL FIRE',
  milestones: [2],
  system: 'meridian',
  tagline: 'We do not ask the engine why.',
  briefing: briefing(
    'DIRECTORATE TECHNICAL SERVICE (KEEPING), MERIDIAN. TO: 0413, ATTACHED ESCORT.',
    'The warden barge Saint Hollis is carrying a golden-age jump heart from the Cloister to BB-01 Indomitable, at anchor off the Castellan ring yards. The heart has been sealed for six hundred years. It will remain sealed. Wardens aboard will install it by the Keepings.',
    'The heart is worth more than Meridian\'s water allocation for a year. Its route was restricted. Assume it has been sold.',
    'Escort the barge across the yards. If the barge\'s own drive falters — it is nearly as old as its cargo — the wardens will relight it. They will not hurry. You will give them the time.',
    'Warden-pilot Oduya accompanies you under dispensation.',
  ),
  objectives: [
    obj('rendezvous', 'Form up on the warden barge Saint Hollis', (c) => c.distanceTo('barge') < 800),
    obj('raid', 'Escort the barge; destroy the raiders', (c) => c.kills('rustwake') >= 4, { failed: (c) => !c.alive('barge'), setsFlag: 'halt:barge' }),
    obj('stall', 'Guard the stalled barge while the wardens relight its drive', (c) => c.kills('rustwake') >= 8, { failed: (c) => !c.alive('barge'), setsFlag: 'resume:barge' }),
    obj('deliver', 'See the heart delivered to the Indomitable', (c) => c.flag('barge-arrived'), { failed: (c) => !c.alive('barge') }),
    obj('unscratched', 'Keep the barge\'s hull above 60%', (c) => c.flag('barge-arrived'), { optional: true, failed: (c) => c.hull('barge') < 0.6 }),
  ],
  spawns: [
    spawn(HARRIER, 'concord', 1, ahead(-50, 10, -60), 'candle', 'Brother Oduya · Candle', 'wing'),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(300, -50, 700), 'barge', 'Warden Barge Saint Hollis', 'escort', { routeTo: 'indomitable' }),
    spawn(INDOMITABLE, 'concord', 1, ahead(0, -500, 9500), 'indomitable', 'BB-01 Indomitable', 'static'),
    spawn(SCRAPJACK, 'rustwake', 4, ahead(-2600, 500, 3800), 'raidersA', 'Raider', 'hostile', { delay: 40 }),
    spawn(SCRAPJACK, 'rustwake', 4, by('barge', 2400, -300, -1800), 'raidersB', 'Raider', 'hostile', { whenFlag: 'halt:barge', delay: 10 }),
  ],
  setpieces: [
    piece('wreckage', 'yards', ahead(-3000, -1500, 6000), { kind: 'shipyard-scaffold', radius: 3500, label: 'Castellan ring yards' }),
    piece('beacon', 'yard-lights', ahead(2000, 400, 4500), { label: 'Yard traffic buoy' }),
  ],
  chatter: [
    beat('open', START, [
      say('candle', 'Four-One-Three, meet the Saint Hollis. Ugly barge. Beautiful cargo.'),
      say('candle', 'A golden-age jump heart for the Indomitable. Sealed six centuries. Nobody alive knows what\'s inside it.'),
      say('rook', 'Indomitable to barge. We have waited nine years for that heart, Brother. Do not make it ten.'),
      say('candle', 'Captain Rook. The Keeping is never late. Occasionally it is delayed.'),
    ]),
    beat('raid', at(36), [
      say('system', 'CONTACTS. RUSTWAKE TRANSPONDERS. FOUR. VECTOR: THE BARGE.'),
      say('candle', 'Somebody sold our route. A heart\'s worth a clan\'s lifetime to the right buyer.'),
    ], 2),
    beat('stall', onDone('raid'), [
      say('system', 'BARGE DRIVE FAULT. FEED PRESSURE ZERO.'),
      say('candle', 'Her heart\'s stalled. The wardens aboard will relight it by the Keepings.'),
      say('candle', 'It takes as long as it takes. Keep them off her. More coming from astern.'),
    ], 3),
    beat('litany', onActive('stall'), [
      say('candle', 'First keeping. The seal holds.', 14),
      say('candle', 'Second keeping. The feed runs clean.', 14),
      say('candle', 'Third keeping. The fire is fed, and not starved.', 14),
      say('candle', 'Fourth keeping. The cold is let out.', 14),
      say('candle', 'Fifth keeping. The old words are said.', 14),
      say('candle', 'Sixth keeping. We do not ask the engine why.', 14),
      say('candle', 'Seventh keeping. We thank it. And we go.', 14),
    ], 2),
    beat('lit', onDone('stall'), [
      say('system', 'FEED PRESSURE NOMINAL. BARGE UNDER WAY.'),
      say('candle', 'Lit.'),
      say('rook', 'Indomitable. We heard your wardens on the open band, Brother. My whole bridge went quiet.'),
    ], 3),
    beat('big', near('indomitable', 3500), [
      say('candle', 'Look at her. Two kilometres of borrowed miracle. Every gun on her is older than the Reach.'),
      say('system', 'BB-01. GOLDEN-AGE KEEL. REFIT COUNT: NINETEEN.'),
    ]),
    beat('hurt', HULL_LOW, [say('candle', 'You\'re scorched. Stay close to me. I bless engines, not pilots, but I\'ll make an exception.')]),
    beat('delivered', SUCCESS, [
      say('rook', 'Heart received. Brother, what does it do, precisely?'),
      say('candle', 'It works, Captain. We don\'t ask the rest.'),
      say('rook', '...That will have to do.'),
    ]),
    beat('lost', FAILURE, [say('candle', 'Six hundred years, and we lost it in an afternoon.')]),
  ],
  codexOnStart: ['fac-keeping'],
  codex: ['tech-keepings', 'fac-directorate', 'tech-kestrel'],
  modifiers: { ambience: 'normal' },
  debrief:
    'The golden-age jump heart has been installed in BB-01 Indomitable. The barge\'s drive relit on the Seventh Keeping, as is customary.\n\n' +
    'Eight raiders destroyed. Continuity notes that the raiders\' route data originated in a Directorate supply office. The inquiry has been allocated.\n\n' +
    'Warden Oduya\'s transfer to fleet duty is approved. He has asked that it be to "wherever 0413 is going." The request has been noted as irregular and granted.',
};

/** Observance protocol: firing on Psalm or her Measure before the breach is a failure. */
const brokeObservance: Pred = (c) => !c.flag('breach') && (c.hull('psalm') < 0.9 || c.hull('measure') < 0.9);

const EP03: CampaignMission = {
  id: 'ep03-two-heavens',
  chapter: 1,
  episode: 3,
  title: 'TWO HEAVENS',
  milestones: [3],
  system: 'tessaly',
  tagline: 'Be witnessed.',
  briefing: briefing(
    'CVS-07 HESPERUS DAWN, TREATY LINE, TESSALY APPROACHES. TO: 0413.',
    'Once a week, by the Observance of 403, one Directorate fighter and one Choir Measure fly the Treaty Line together with weapons cold, so that both sides remember where it is. You are this week\'s Measure.',
    'Fly the three markers. Match the Choir\'s pace. Do not fire. Do not answer their singing. They will sing.',
    'Across the Line: the Zenith Hegemony, which believes humanity fell from the stars for its sins and must climb back one pure generation at a time. On this side: the Directorate, which believes in grams. Allocation will want a count of every round you fire today. The correct count is zero.',
    'Be polite. Keep the light. — Oyelaran, Captain.',
  ),
  objectives: [
    obj('obs1', 'Fly the Measure: Observance marker 1', (c) => c.distanceTo('obs1') < 250, { failed: brokeObservance }),
    obj('obs2', 'Fly the Measure: Observance marker 2', (c) => c.distanceTo('obs2') < 250, { failed: brokeObservance }),
    obj('obs3', 'Fly the Measure: Observance marker 3', (c) => c.distanceTo('obs3') < 250, { failed: brokeObservance, setsFlag: 'breach' }),
    obj('zealots', 'Destroy the Cantors who broke the Observance', (c) => c.kills('choir') >= 4, { failed: (c) => c.hull('psalm') < 0.5 }),
    obj('return', 'Return to the Hesperus Dawn', (c) => c.distanceTo('dawn') < 1800),
    obj('cold', 'Keep your guns cold during the Observance', (c) => c.flag('breach'), { optional: true, failed: (c) => !c.flag('breach') && c.kills('choir') > 0 }),
    cue('novice-sent-home', 'depart:novice', (c) => c.flag('breach') && c.alive('zealots')),
  ],
  spawns: [
    spawn(DAWN, 'concord', 1, ahead(-3200, -700, -2800), 'dawn', 'CVS-07 Hesperus Dawn', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(420, 0, 400), 'psalm', 'Psalm', 'static'),
    spawn(CANTOR, 'choir', 2, ahead(520, 30, 360), 'measure', 'Hesper Measure', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(640, -30, 320), 'novice', 'Cantor Aurel-Ninth', 'static'),
    spawn(CATHEDRAL, 'choir', 1, ahead(2000, 2500, 30000), 'magnificat', 'Cathedral Magnificat', 'static'),
    spawn(CANTOR, 'choir', 4, ahead(3200, 900, 8000), 'zealots', 'Tessaly Zealot', 'hostile', { whenFlag: 'breach', delay: 14 }),
  ],
  setpieces: [
    piece('beacon', 'obs1', ahead(0, 0, 3000), { label: 'Observance marker I', color: '#ffe28a' }),
    piece('beacon', 'obs2', ahead(900, 200, 5200), { label: 'Observance marker II', color: '#ffe28a' }),
    piece('beacon', 'obs3', ahead(-500, -200, 7400), { label: 'Observance marker III', color: '#ffe28a' }),
    piece('beacon', 'line', ahead(0, 0, 9000), { label: 'THE TREATY LINE', style: 'marker-chain' }),
    piece('wreckage', 'campaigns', ahead(-5000, -1200, 11000), { radius: 3000, label: 'Tessaly Campaigns debris, 395-402 AS' }),
  ],
  chatter: [
    beat('open', START, [
      say('oyelaran', 'Four-One-Three, Dawn Actual. You\'re our Measure today. Guns cold, eyes open, and be polite.'),
      say('oyelaran', 'Both sides fly the Line together once a week, so nobody forgets where it is. We\'ve done it for twenty-eight years.'),
      say('control', 'Dawn Control. The Observance begins on the Intonation. You\'ll know it when you hear it.'),
    ]),
    beat('intonation', at(10), [
      say('system', 'CHOIR CARRIER. INTONATION DETECTED. FOUR TONES, RISING.'),
      say('psalm', 'Directorate Measure. I am Psalm, First Cantor of Hesper. You are witnessed.'),
      say('psalm', 'Fly true. The Altitude observes. So do I.'),
    ], 2),
    beat('pattern', onDone('obs1'), [
      say('psalm', 'You fly an old pattern, Directorate. Older than your Directorate. Do you know what it remembers?'),
      say('system', 'SERVICE RESUMES SHORTLY.'),
      say('psalm', '...Curious.'),
    ]),
    beat('hymn', onDone('obs2'), [
      say('oyelaran', 'Listen to their open band. They sing the whole Line. Always have.'),
      say('psalm', '(sung) Out of the dust we were lifted. Out of the dark we were shown.'),
      say('psalm', '(sung) What is lifted must be worthy. What is worthy climbs alone.'),
    ]),
    beat('breach', onFlag('breach'), [
      say('system', 'WEAPONS FIRE. CHOIR CANTOR AUREL-NINTH. HE IS FIRING ON YOU.'),
      say('psalm', 'Ninth. You have broken the Observance.'),
      say('system', 'CHOIR FIRE. AUREL-NINTH\'S WEAPONS POD DESTROYED. SHE SHOT HER OWN WINGMAN.'),
      say('psalm', 'Your weapons are forfeit. Go home unwitnessed.'),
      say('psalm', 'Directorate. The Hegemony does not break the Observance. He will be corrected. You have my apology.'),
    ], 3),
    beat('zealots', onActive('zealots'), [
      say('control', 'Dawn Control! Four more Cantors off the Tessaly picket, weapons hot. They\'re taking the breach as licence!'),
      say('oyelaran', 'Weapons free on the four. Only the four. Do not touch her Measure.'),
      say('psalm', 'They are not mine. Do as you must. I will witness it.'),
    ], 2),
    beat('remember', killsOf('choir', 2), [say('psalm', 'Well flown. I will remember your pattern.')]),
    beat('holds', onDone('zealots'), [
      say('psalm', 'It is finished. The Line holds. Ascend, Directorate.'),
      say('oyelaran', 'Come home, Four-One-Three. Keep the light.'),
    ]),
    beat('deck', near('dawn', 3000), [say('control', 'Green deck, Four-One-Three. The captain wants to buy you a coffee. It\'s terrible coffee.')]),
    beat('hurt', HULL_LOW, [say('oyelaran', 'Disengage if you have to. No line on a chart is worth your seat.')]),
    beat('forms', SUCCESS, [
      say('control', 'Allocation\'s already pinged us. "Unscheduled expenditure, 1.4 grams." They want a form.'),
      say('oyelaran', 'Unscheduled. As if the rest of it were on a timetable.'),
    ]),
    beat('broken', FAILURE, [say('oyelaran', 'We fired on the Measure. Twenty-eight years of Observance. Oh, Four-One-Three.')]),
  ],
  codexOnStart: ['fac-zenith'],
  codex: ['fac-choir', 'ppl-psalm', 'fac-allocation'],
  modifiers: { ambience: 'normal' },
  debrief:
    'The Observance of Week 1,461 is complete. The Treaty Line holds.\n\n' +
    'Four Choir Cantors destroyed after an unprovoked breach. The Hegemony has formally apologised through the Line — the first apology in the Observance\'s history — and reports that Cantor Aurel-Ninth has been "corrected". Continuity does not know what this means and does not want to.\n\n' +
    'Allocation has approved your expenditure of 1.4 grams as "regrettable but within forecast." Captain Oyelaran has asked whose forecast. No answer has been received.',
};

const EP04: CampaignMission = {
  id: 'ep04-black-light',
  chapter: 1,
  episode: 4,
  title: 'BLACK LIGHT',
  milestones: [4],
  system: 'rustwake',
  tagline: 'Every gram accounted.',
  briefing: briefing(
    'BOARD OF ALLOCATION, CONVOY DESK. TO: 0413, ESCORT.',
    'Three Rustwake tankers carrying 120 kilograms of Ember-skim Ebon-gas will cross the Belt to the Rustwake Lantern for delivery to the Tey refinery. The convoy is contracted from Clan Marsh (master: T. Marsh, hauler Magpie\'s Due). The Directorate does not trust Clan Marsh. Clan Marsh does not trust the Directorate. This is called a market.',
    'Commander Aubrac of the Office of Continuity will ride the audit corvette and count the grams in and out.',
    'Every political conflict in the Reach is a dispute over what is in those tankers. Choir raiders know the route. So, probably, does everyone.',
    'Do not shoot anything that glows black. That is the cargo.',
  ),
  objectives: [
    obj('formup', 'Form up on the Magpie\'s Due', (c) => c.distanceTo('magpie') < 800),
    obj('raid', 'Break the Choir raid on the convoy', (c) => c.kills('choir') >= 5, { failed: (c) => c.aliveCount('tankers') < 2, setsFlag: 'raid-broken' }),
    obj('torpedoes', 'Intercept the second torpedo run', (c) => c.kills('choir') >= 7, { failed: (c) => c.aliveCount('tankers') < 2 }),
    obj('lantern', 'See the convoy to the Rustwake Lantern buoy', (c) => c.flag('tankers-arrived'), { failed: (c) => c.aliveCount('tankers') < 2 }),
    obj('every-gram', 'Lose no tankers', (c) => c.flag('tankers-arrived'), { optional: true, failed: (c) => c.aliveCount('tankers') < 3 }),
  ],
  spawns: [
    spawn(SCRAPJACK, 'rustwake', 1, ahead(0, 50, 900), 'magpie', 'Magpie\'s Due', 'escort', { routeTo: 'rwbuoy' }),
    spawn(SCRAPJACK, 'rustwake', 3, ahead(250, -40, 750), 'tankers', 'Marsh Tanker', 'escort', { routeTo: 'rwbuoy' }),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(-400, 80, 600), 'audit', 'FFC Audit (Continuity)', 'escort', { routeTo: 'rwbuoy' }),
    spawn(SCRAPJACK, 'rustwake', 2, ahead(-200, 100, 800), 'clan', 'Clan Marsh', 'wing'),
    spawn(CANTOR, 'choir', 3, ahead(3000, 800, 5200), 'raidC', 'Choir Raider', 'hostile', { delay: 38 }),
    spawn(PSALTER, 'choir', 2, ahead(-2800, -600, 5600), 'raidP', 'Psalter', 'hostile', { delay: 42 }),
    spawn(PSALTER, 'choir', 2, by('tankers', 2600, 900, -2200), 'raidT', 'Psalter', 'hostile', { whenFlag: 'raid-broken', delay: 6 }),
  ],
  setpieces: [
    piece('wreckage', 'belt', ahead(0, -1500, 6000), { kind: 'asteroids', radius: 7000, label: 'The Rustwake Belt' }),
    piece('beacon', 'rwbuoy', ahead(600, 0, 10500), { label: 'Rustwake Lantern approach buoy' }),
  ],
  chatter: [
    beat('open', START, [
      say('magpie', 'Well, look at this! A Directorate babysitter in a museum piece. Welcome to the Rustwake, Kestrel!'),
      say('magpie', 'Three tankers of Ember-skim, forty kilos each. Don\'t shoot anything glowing black. It\'s mine.'),
      say('ledger', 'Audit corvette. Commander Aubrac, Office of Continuity. I\'m here to count the grams. Ignore me.'),
      say('magpie', 'Everybody ignores the auditor, love. Right up until she finds something.'),
    ]),
    beat('black-light', at(22), [
      say('system', 'EBON SIGNATURE, TANKER TWO. CONTAINMENT NOMINAL.'),
      say('magpie', 'Look at her hold through your gun camera. See how the edges of things go violet? That\'s black light.'),
      say('magpie', 'That\'s money. That\'s the only light in the Reach anybody ever fought over.'),
      say('magpie', '(sung) Oh, the Ember\'s low and the gram is high, and the Board\'s got its hand in your pocket...'),
      say('ledger', 'I can hear you, Captain.'),
      say('magpie', 'That\'s the idea, love.'),
    ]),
    beat('raid', at(38), [
      say('system', 'CHOIR CARRIER. INTONATION. FIVE CONTACTS. TWO PSALTER TORPEDO BOMBERS.'),
      say('magpie', 'Hymn-singers! Clan Marsh, guns out! Kestrel, the Psalters want the tankers, not you!'),
    ], 3),
    beat('bill', killsOf('choir', 3), [say('magpie', 'Ha! Put that on the Board\'s bill!')]),
    beat('second-run', onDone('raid'), [
      say('system', 'TWO MORE. TORPEDO SOLUTION ON TANKER THREE.'),
      say('magpie', 'Tem Marsh does not lose tankers! Tem Marsh does not— Kestrel, please!'),
    ], 3),
    beat('manifest', onDone('torpedoes'), [
      say('ledger', 'Escort. Something\'s wrong with the manifest. Half this cargo is consigned onward, three shell accounts deep.'),
      say('ledger', 'The last account is the Zenith Treasury.'),
      say('magpie', 'Everybody buys from everybody, sweetheart. The war\'s just how the price gets set.'),
      say('ledger', '...That isn\'t in any audit I\'ve signed.'),
      say('magpie', 'Then you\'ve been signing the wrong audits.'),
    ], 2),
    beat('hurt', HULL_LOW, [say('magpie', 'Kestrel, you\'re leaking! I can patch that for forty grams. Thirty. Twenty for the pretty plane.')]),
    beat('home', SUCCESS, [
      say('magpie', 'Gas is home and the Lantern\'s lit. Kestrel, you ever need anything not strictly legal, you call Magpie.'),
      say('ledger', 'I didn\'t hear that.'),
      say('magpie', 'You heard everything, love. That\'s your whole job.'),
    ]),
    beat('lost', FAILURE, [say('magpie', 'My tankers. Forty years of clan savings, burning black. Go home, Directorate.')]),
  ],
  codexOnStart: ['tech-ebon'],
  codex: ['fac-rustwake', 'ppl-magpie', 'hist-relighting'],
  modifiers: { ambience: 'normal' },
  debrief:
    'Convoy delivered. 120 kg declared at the Belt; 119.6 kg received at the Lantern. The discrepancy is within tolerance and has been logged as "evaporation".\n\n' +
    'Commander Aubrac\'s audit notes that 58 kg of the cargo was pre-sold, through three intermediaries, to the Zenith Treasury. Her report has been received by the Board of Allocation and filed under "Market Conditions".\n\n' +
    'Clan Marsh has invoiced the Directorate for one tanker hull scratch, at triple rate. The invoice has been paid.',
};

const EP05: CampaignMission = {
  id: 'ep05-whispers-in-the-static',
  chapter: 1,
  episode: 5,
  title: 'WHISPERS IN THE STATIC',
  milestones: [5],
  system: 'null',
  tagline: 'One thousand and nine.',
  briefing: briefing(
    'OFFICE OF CONTINUITY. CLASSIFICATION: CANDLE-BLACK. TO: 0413.',
    'You are relieving the pilot of Null Picket Station 2 for one rotation. The Null system has two rings. The lit one brought you from Halaedon. The other leads nowhere, and has for 431 years. By treaty, the Directorate and the Hegemony each keep one picket on it. Nobody remembers why that treaty was signed.',
    'Recover the recorders from Survey Buoys North and Void. Then hold at the dead ring\'s throat and listen on the long band.',
    'You will hear something. You will record it. You will not discuss it with the picket crew, who have heard it for 134 days and signed forms to say they haven\'t.',
    'I asked for you by airframe. Your core hears things. — Y. Aubrac',
  ),
  objectives: [
    obj('relieve', 'Relieve the picket at Null Station 2', (c) => c.distanceTo('station') < 1000),
    obj('north', 'Recover the recorder from Survey Buoy North', (c) => c.distanceTo('buoyN') < 200),
    obj('void', 'Recover the recorder from Survey Buoy Void', (c) => c.distanceTo('buoyV') < 200),
    obj('listen', 'Hold at the dead ring\'s throat and listen', (c) => c.flag('throat-held'), { setsFlag: 'burst' }),
    obj('measure', 'Survive Psalm\'s Measure', (c) => c.kills('choir') >= 3 && c.flag('depart:psalm')),
    obj('home', 'Return to Null Station 2', (c) => c.distanceTo('station') < 1000),
    psalmWithdraws('psalm-withdraws', 3),
  ],
  spawns: [
    spawn(VESPER, 'choir', 1, ahead(6000, 1200, 14500), 'hegpicket', 'Hegemony Null Picket', 'static'),
    spawn(CANTOR, 'choir', 1, by('hegpicket', -400, 0, -600), 'psalm', 'Psalm', 'hostile', { whenFlag: 'burst', delay: 22 }),
    spawn(CANTOR, 'choir', 3, by('hegpicket', -300, 100, -900), 'pmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'burst', delay: 22 }),
  ],
  setpieces: [
    piece('beacon', 'station', ahead(0, -200, 1800), { label: 'Null Picket Station 2' }),
    piece('beacon', 'buoyN', ahead(-3500, 1500, 6500), { label: 'Survey Buoy North' }),
    piece('beacon', 'buoyV', ahead(900, -400, 11500), { label: 'Survey Buoy Void' }),
    piece('wreckage', 'nullring', ahead(0, 0, 15500), { shape: 'ring', radius: 9000, lit: false, label: 'The Null Lantern (dead)' }),
    piece('beacon', 'throat', ahead(0, 0, 15500), { label: 'Ring throat', hold: 20, radius: 700 }),
  ],
  chatter: [
    beat('open', START, [
      say('system', 'NULL SYSTEM. LANTERN TRAFFIC: NONE. TRAFFIC OF ANY KIND: NONE.'),
      say('ledger', 'Four-One-Three, Continuity. Aubrac again. Fetch the recorders, then go and sit in the dead ring and listen.'),
      say('ledger', 'Don\'t tell the picket crew what you hear. They know already. It\'s done things to them.'),
    ]),
    beat('log', onDone('relieve'), [
      say('system', 'PICKET LOG TRANSFERRED. FLAGGED ENTRY, DAY 6: "SOMEBODY OUT THERE IS COUNTING DOWN THE PRIMES."'),
      say('system', 'FLAGGED ENTRY, DAY 31: "I THINK THEY\'RE AS SCARED AS WE ARE."'),
    ]),
    beat('ring', near('nullring', 7000), [
      say('system', 'LANTERN DETECTED. STATUS: DARK. DESTINATION: —'),
      say('system', 'DESTINATION FIELD EMPTY. THIS IS NOT AN ERROR.'),
    ]),
    beat('hegpicket', near('hegpicket', 6000), [say('ledger', 'That\'s the Hegemony picket. They\'ll be listening too. Try not to wave.')]),
    beat('burst', onFlag('burst'), [
      hiss('system', 'CARRIER. NARROW BAND. BEARING: THROUGH THE RING. INTO THE VOID.'),
      hiss('system', 'PULSES: ...1,005. 1,006. 1,007. 1,008. 1,009. END OF BURST.'),
      say('ledger', 'One thousand and nine. Yesterday was one thousand and thirteen.'),
      say('ledger', 'They\'re all prime. Every burst. It\'s counting down, Four-One-Three.'),
      say('system', 'RESPONSE TRANSMITTED.'),
      say('ledger', 'Response? What response? Who authorised—'),
      say('system', 'ONE PULSE. PROTOCOL: TIMETABLE. "ACKNOWLEDGE RECEIPT."'),
      say('ledger', '...Your flight computer just said hello to it.'),
    ], 3),
    beat('psalm', onActive('measure'), [
      say('system', 'INTONATION. HEGEMONY PICKET LAUNCHING.'),
      say('psalm', 'Directorate. Your machine answered the Voice. That is not permitted. That is not ever permitted.'),
      say('psalm', 'Be witnessed. And then be still.'),
    ], 2),
    beat('penance', killsOf('choir', 1), [say('psalm', 'They sent me to the edge of the world for my wingman\'s sin. And here you are, at the edge, sinning.')]),
    beat('withdraw', onFlag('depart:psalm'), [
      say('psalm', 'Enough. The Voice did not answer us, in 134 days of hymns. It answered you. I must ask why.'),
      say('psalm', 'Ascend, Directorate. If you can.'),
    ]),
    beat('hurt', HULL_LOW, [say('ledger', 'Four-One-Three, I need that recording more than I need you to be brave.')]),
    beat('orders', SUCCESS, [
      say('oyelaran', 'Four-One-Three, Hesperus Dawn Actual. Orders from the Board. You\'re reassigned.'),
      say('oyelaran', 'The 13th Independent needs a Point. Their last one\'s mug is still on the hook.'),
      say('oyelaran', 'Come aboard. Meet your squadron. Keep the light.'),
    ]),
    beat('lost', FAILURE, [say('ledger', 'Recording lost. Continuity will list this as equipment failure. I\'m so sorry.')]),
  ],
  codexOnStart: ['tech-lanterns'],
  codex: ['anom-signal', 'log-null-picket', 'tech-cantus'],
  modifiers: { ambience: 'dread' },
  debrief:
    'Recording secured. Continuity has classified it CANDLE-BLACK. The Hegemony picket has returned to its station; neither side has filed a report of the engagement, by what appears to be mutual, unspoken agreement.\n\n' +
    'The Order of the Keeping has been asked to inspect airframe 0413\'s flight computer for faults. The Order declines, citing the Sixth Keeping.\n\n' +
    'Pilot 0413 is reassigned to CVS-07 Hesperus Dawn, 13th Independent Squadron, as Vanguard 1.\n\n' +
    'NULL COUNT: 1,009.',
};

// ════════════════════════════════════════════════════════════════════════
// CHAPTER II — THE SPARK AND THE FRYING PAN
// ════════════════════════════════════════════════════════════════════════

const EP06: CampaignMission = {
  id: 'ep06-border-skirmish',
  chapter: 2,
  episode: 6,
  title: 'BORDER SKIRMISH',
  milestones: [6],
  system: 'zephacis',
  tagline: 'Same as here, only less of it.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD FLIGHT.',
    'Routine escort. FFC Plumb Line is surveying Ebon drift along the Zephacis border. You will fly cover to Survey Mark Z-7 and back. Expected contact: none. Expected duration: long. Expected complaint from Lieutenant Castellanos: continuous.',
    'This is Vanguard 1\'s first flight as Point. Commander Kade flies Two. The squadron will take it from there.',
    'The cockpit you are sitting in has been flown by sixty-seven pilots. The seat is original. Try not to be the one who replaces it.',
    'Keep the light. — Oyelaran',
  ),
  objectives: [
    obj('formup', 'Form up on the Plumb Line', (c) => c.distanceTo('plumb') < 1000),
    obj('escort', 'Escort the Plumb Line to Survey Mark Z-7', (c) => c.distanceTo('mark') < 2500, { failed: (c) => !c.alive('plumb'), setsFlag: 'ambush' }),
    obj('screen', 'Engage the Choir screen', (c) => c.kills('choir') >= 4, { failed: (c) => !c.alive('plumb') }),
    obj('canticle', 'Cripple the Zenith cruiser Canticle of Ascent', (c) => c.alive('canticle') && c.hull('canticle') < 0.35, { setsFlag: 'canticle-crippled' }),
    obj('mark', 'Mark the ejected data core before it sinks into the ring', (c) => c.distanceTo('coredrift') < 1500),
    obj('survey', 'Keep the Plumb Line\'s hull above 50%', (c) => c.objectiveDone('mark'), { optional: true, failed: (c) => c.hull('plumb') < 0.5 }),
    cue('canticle-flees', 'depart:canticle', (c) => c.flag('canticle-crippled')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(200, -60, 900), 'plumb', 'FFC Plumb Line', 'escort', { routeTo: 'mark' }),
    spawn(CANTOR, 'choir', 4, ahead(2800, 700, 11500), 'screen', 'Choir Screen', 'hostile', { whenFlag: 'ambush', delay: 3 }),
    spawn(VESPER, 'choir', 1, ahead(-1800, 300, 13000), 'canticle', 'Canticle of Ascent', 'capital', { whenFlag: 'ambush' }),
    spawn(CANTOR, 'choir', 2, by('canticle', 600, 200, 300), 'latescreen', 'Choir Screen', 'hostile', { whenFlag: 'ambush', delay: 50 }),
  ],
  setpieces: [
    piece('beacon', 'mark', ahead(0, 0, 10000), { label: 'Survey Mark Z-7' }),
    piece('wreckage', 'ring', ahead(0, -2500, 17000), { kind: 'planetary-ring', radius: 9000, label: 'Zephacis II ring' }),
    piece('beacon', 'coredrift', by('canticle', 0, -500, 700), { whenFlag: 'canticle-crippled', label: 'Ejected core (drifting)', color: '#ff5fd0' }),
  ],
  chatter: [
    beat('cockpit', START, [
      say('system', 'GOOD MORNING, POINT.'),
      say('kade', 'Vanguard, Abbess. Welcome to the worst job in the fleet: escorting a surveyor who measures dirt.'),
      say('jackpot', 'New Point! Jackpot, Three. I run the kill pool. A gram a head. Sweetheart deals for the skipper.'),
      say('kade', 'There is no sweetheart deal.'),
      say('jackpot', 'There\'s no sweetheart deal.'),
    ]),
    beat('roll-call', at(18), [
      say('sparrow', 'Sparrow, Five! Hi. It\'s an honour. I read about the Observance. And the Null. Sorry. Hi.'),
      say('salt', 'Salt. Six. Don\'t read about anything, kid. It\'s all ration cards and lies.'),
      say('candle', 'And you know me, Point. The engine and I are glad you\'re aboard. In that order.'),
      say('kade', 'That\'s the family. Don\'t get attached. I say that to everyone. It never works.'),
    ]),
    beat('rim', at(45), [
      say('jackpot', 'Boss. You ever wonder what\'s past the rim?'),
      say('kade', 'Same as here, Jackpot. Only less of it.'),
      say('jackpot', 'That\'s bleak, Boss.'),
      say('kade', 'That\'s the rim.'),
    ]),
    beat('grams', at(80), [
      say('salt', 'Nine years of cuts, and they still find grams to measure Ebon drift. Wonder who that\'s for.'),
      say('sparrow', 'Maybe it matters.'),
      say('salt', 'Everything matters, kid. That\'s what they tell you right before they cut it.'),
    ]),
    beat('ambush', onFlag('ambush'), [
      say('system', 'INTONATION. MULTIPLE. BEARING ZERO-ONE-ZERO.'),
      say('kade', 'Bandits! Vanguard, break and engage! Plumb Line, turn for home. Now!'),
      say('jackpot', 'That\'s a cruiser. Why is there a cruiser? Nobody said cruiser!'),
      say('salt', 'Vesper-class, out here, alone? It\'s not raiding. It\'s hiding something.'),
    ], 3),
    beat('pool', killsOf('choir', 2), [say('jackpot', 'That\'s two for the pool! Point, you\'re making me look bad on your first day!')]),
    beat('falter', killsOf('choir', 4), [say('candle', 'Their song\'s faltering. Press them.')]),
    beat('limp', onActive('canticle'), [
      say('kade', 'Point, the cruiser. Cut its drive. I want it limping, not dead.'),
      say('salt', 'Why not dead?'),
      say('kade', 'Because something that runs this hard has something to lose.'),
    ], 2),
    beat('eject', onDone('canticle'), [
      say('system', 'CRUISER EJECTING. OBJECT: ARMOURED DATA CORE. TRAJECTORY: PLANETARY RING.'),
      say('sparrow', 'It threw something away! Why would it—'),
      say('kade', 'Because it would rather we never find it than they lose it. Mark it, Point.'),
    ], 3),
    beat('fled', onFlag('depart:canticle'), [say('jackpot', 'And she\'s gone. Limping home to sing about it.')]),
    beat('hurt', HULL_LOW, [say('kade', 'Point! You\'re trailing plasma. Get behind me. Now.')]),
    beat('mark', SUCCESS, [
      say('kade', 'Core\'s in the ring. Two thousand kilometres of ice gravel. We\'re coming back for it.'),
      say('kade', 'Dawn Actual, Vanguard. All accounted for. We have a story for you.'),
      say('oyelaran', 'Come home first, Abbess. Stories keep. Keep the light.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'Vanguard, disengage. We\'re leaving. Nobody argues.')]),
  ],
  codexOnStart: ['fac-vanguard'],
  codex: ['ppl-kade', 'ppl-oyelaran', 'hist-attrition'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Routine escort, Zephacis border. Unscheduled contact with a Choir Vesper-class cruiser, identified from its Intonation as the Canticle of Ascent. Six Cantors destroyed. The cruiser escaped, crippled, after ejecting an armoured data core into the Zephacis II ring.\n\n' +
    'Survey Mark Z-7 was not surveyed. The Plumb Line\'s crew have asked that the squadron be thanked, and that Lieutenant Castellanos be asked to stop singing on the return leg.\n\n' +
    'A sixth mug has been taken down from the hook in the ready room and washed.\n\n' +
    'NULL COUNT: 983.',
};

const EP07: CampaignMission = {
  id: 'ep07-the-stolen-coordinates',
  chapter: 2,
  episode: 7,
  title: 'THE STOLEN COORDINATES',
  milestones: [7],
  system: 'zephacis',
  tagline: 'Forty-one waypoints.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD.',
    'The Canticle\'s core went into the Zephacis II ring two days ago. Zenith salvage is already on the way; so, Continuity believes, is anyone else who can read a transponder.',
    'The core sings when lost — Choir cores do. Follow the song into the ice. Recover it. Bring it home. Commander Aubrac is aboard the Dawn and will decrypt it over the uplink as you fly.',
    'Whatever is on that core, a Zenith cruiser would rather have thrown it into a ring than lose it to us. That makes it the most valuable thing in the Reach this week.',
    'Expect company. Expect Psalm.',
  ),
  objectives: [
    obj('search', 'Follow the core\'s song into the ring', (c) => c.distanceTo('ping') < 1000, { setsFlag: 'found' }),
    obj('recover', 'Recover the Canticle\'s data core', (c) => c.flag('canticle-core-recovered')),
    obj('measure', 'Hold off Psalm\'s Measure', (c) => c.kills('choir') >= 4 && c.flag('depart:psalm')),
    obj('dawn', 'Deliver the core to the Hesperus Dawn', (c) => c.distanceTo('dawn') < 1800),
    psalmWithdraws('psalm-withdraws', 4),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(DAWN, 'concord', 1, ahead(0, -600, -5000), 'dawn', 'CVS-07 Hesperus Dawn', 'static'),
    spawn(SCRAPJACK, 'rustwake', 3, by('ping', 900, 300, 600), 'marsh', 'Clan Marsh', 'wing', { whenFlag: 'found', delay: 3 }),
    spawn(CANTOR, 'choir', 1, ahead(3500, 1500, 12500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'canticle-core-recovered', delay: 20 }),
    spawn(CANTOR, 'choir', 4, ahead(3000, 1200, 13000), 'pmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'canticle-core-recovered', delay: 18 }),
  ],
  setpieces: [
    piece('wreckage', 'ring', ahead(0, -200, 8000), { kind: 'planetary-ring', radius: 7000, density: 'dense', label: 'Zephacis II ring' }),
    piece('beacon', 'ping', ahead(200, -150, 7200), { label: 'Core transponder (intermittent)', color: '#ff5fd0' }),
    piece('blackbox', 'canticle-core', ahead(320, -220, 8800), { label: 'Canticle of Ascent — data core' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard, we\'re in the ring. Ice, gravel, and one armoured core that somebody wants very badly.'),
      say('jackpot', 'Needle, haystack, et cetera. Pool\'s open: first to find it gets ten grams.'),
      say('salt', 'You don\'t have ten grams.'),
      say('jackpot', 'I have faith.'),
    ]),
    beat('lamb', at(20), [
      say('system', 'TRANSPONDER. INTERMITTENT. FOUR TONES, RISING. THE CORE IS SINGING.'),
      say('candle', 'Choir cores hum when they\'re lost. Like lambs.'),
    ]),
    beat('magpie', onFlag('found'), [
      say('magpie', 'Well, well. Abbess Kade and her flying museum.'),
      say('kade', 'Magpie. Who hired you?'),
      say('magpie', 'The Zenith Treasury. Very generous. Four hundred grams for that core. What are you offering?'),
      say('kade', 'Nothing.'),
      say('magpie', '...Friends\' rate! Clan Marsh, change of employer! I never liked their singing anyway.'),
      say('salt', 'That is the most Rustwake sentence I have ever heard.'),
    ], 2),
    beat('decrypt', onFlag('canticle-core-recovered'), [
      say('system', 'CORE SECURED. UPLINK TO HESPERUS DAWN. DECRYPT BEGINS.'),
      say('ledger', 'Ledger here. I\'m on the Dawn. Keep that core alive and keep talking to me.'),
      say('ledger', 'Survey log. Six years in the void past the Null. They call the route "the Stair".', 6),
      say('ledger', 'Forty-one waypoints. Null Lantern to... a Lantern. Intact. Pre-Shattering. Two hundred kilometres across.', 6),
      say('sparrow', 'Intact? A whole one? That\'s impossible.'),
      say('ledger', 'They call it the Great Ring. The Zenith\'s known about it for six years. We\'ve known for forty seconds.'),
    ], 3),
    beat('psalm', onActive('measure'), [
      say('psalm', 'Directorate. That core is the property of His Serene Altitude. Return it.'),
      say('kade', 'Come and get it, Psalm.'),
      say('psalm', 'Be witnessed, then. All of you.'),
      say('jackpot', 'She\'s singing. Why is she singing? I hate it when she sings.'),
    ], 2),
    beat('angrier', killsOf('choir', 2), [say('salt', 'Two down. The rest are angrier.')]),
    beat('withdraw', onFlag('depart:psalm'), [
      say('psalm', 'Keep it, then. You do not know what you are carrying.'),
      say('psalm', '...Neither, I think, do I.'),
      say('kade', 'That almost sounded honest.'),
    ]),
    beat('invoice', onDone('measure'), [say('magpie', 'That was fun! Invoice to follow. Friends\' rate is still a rate, Abbess.')]),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re carrying the core. You don\'t get to die carrying it.')]),
    beat('home', SUCCESS, [
      say('oyelaran', 'Core received. Well flown, Vanguard.'),
      say('oyelaran', 'Commander Aubrac has asked for a locked room and a pot of coffee. She says there\'s a second cache.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'Core\'s gone. Whatever it was, it\'s singing for them now.')]),
  ],
  codex: ['log-canticle'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Canticle data core recovered from the Zephacis II ring and delivered to the Hesperus Dawn. Primary cache decrypted: a six-year Choir survey of the void beyond the Null Lantern, and a 41-waypoint route — "the Stair" — to an intact pre-Shattering Lantern two hundred kilometres across.\n\n' +
    'Five Choir Cantors destroyed. Psalm withdrew. Clan Marsh has invoiced the Directorate for "one change of heart, friends\' rate", for which there is no Allocation code.\n\n' +
    'A secondary cache remains encrypted. Commander Aubrac has not slept.\n\n' +
    'NULL COUNT: 971.',
};

const EP08: CampaignMission = {
  id: 'ep08-the-internal-rot',
  chapter: 2,
  episode: 8,
  title: 'THE INTERNAL ROT',
  milestones: [8],
  system: 'lysowick',
  tagline: 'Engagement 114.',
  briefing: briefing(
    'BOARD OF ALLOCATION, FLEET OPERATIONS. TO: 13TH INDEPENDENT SQUADRON.',
    'Proceed to the Lysowick picket line. Arrive no later than 1355. Hold the line against anticipated Hegemony fleet sortie commencing 1400.',
    'Your squadron has been selected for its visibility and experience. The Board thanks you for your service.',
    '— C. Pryce, Allocator-General',
    'ADDENDUM, HAND-DELIVERED, NOT LOGGED: The second cache was a Schedule. Joint, signed by Pryce and the Zenith\'s Treasurer. Today is Engagement 114. It forecasts eleven Directorate fighters lost. It asks for you by name. I can\'t stop the order. I can tell you what they expect, so you can do something else. — Ledger',
  ),
  objectives: [
    obj('station', 'Take station at the Lysowick picket line', (c) => c.distanceTo('line') < 1500),
    obj('onschedule', 'Engagement 114 begins: engage the Choir wave', (c) => c.kills('choir') >= 3),
    obj('conductor', 'Break the Schedule: destroy the Choir conductor', (c) => c.kills('choir') >= 3 && !c.alive('conductor') && c.time > 75, { setsFlag: 'off-script' }),
    obj('rout', 'Clear the remaining Choir fighters', (c) => c.kills('choir') >= 7),
    obj('forecast', 'Beat the forecast: keep at least three picket Kestrels alive', (c) => c.objectiveDone('rout'), { optional: true, failed: (c) => c.aliveCount('picketwing') < 3 }),
    cue('guards-withdraw', 'depart:guards', (c) => c.time > 180),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(KESTREL, 'concord', 4, ahead(-600, 100, 1500), 'picketwing', 'Lysowick Picket', 'wing'),
    spawn(LANTERN_GUARD, 'concord', 2, ahead(900, -300, 2400), 'guards', 'FFC Lysowick Guard', 'static'),
    spawn(CANTOR, 'choir', 6, ahead(1500, 600, 9500), 'wave', 'Choir Wave', 'hostile', { delay: 60 }),
    spawn(VESPER, 'choir', 1, ahead(-1200, 900, 11500), 'conductor', 'Vesper Conductor', 'capital', { delay: 70 }),
  ],
  setpieces: [
    piece('beacon', 'line', ahead(0, 0, 3000), { label: 'Lysowick picket line' }),
    piece('wreckage', 'layers', ahead(2000, -800, 6500), { radius: 4000, layers: 3, label: 'Debris of Engagements 71, 88 and 102' }),
  ],
  chatter: [
    beat('open', START, [
      say('ledger', 'Vanguard, Ledger. Off the record. Nobody on this channel but you.'),
      say('ledger', 'Engagement 114. Expected Directorate losses: eleven fighters. 13th Squadron requested by name.'),
      say('jackpot', 'Requested by — are we famous?'),
      say('ledger', 'The note says "costly and visible".'),
      say('jackpot', '...That\'s worse.'),
    ], 2),
    beat('argument', at(22), [
      say('kade', 'So they sell us to each other by the kilo.'),
      say('salt', 'Of course they do. I ran Ebon convoys six years. The raids always hit the day after a price dip.'),
      say('sparrow', 'No. The Directorate wouldn\'t. There are forms. There are audits.'),
      say('salt', 'The Directorate\'s a board, kid. Boards do what the numbers say.'),
      say('kade', 'Then we change the numbers.'),
    ]),
    beat('layers', near('layers', 2500), [
      say('candle', 'Three battles\' worth of wreckage in one place. Same place. Same shapes. Like pressed flowers.'),
      say('system', 'DEBRIS DATING: 422, 426, 429. ENGAGEMENTS 71, 88, 102.'),
    ]),
    beat('clock', at(52), [
      say('system', 'TIME: 1359:50.'),
      say('system', '1400:00. INTONATION.', 10),
      say('jackpot', 'Right on time. You could set a clock by it. Somebody did.'),
    ], 3),
    beat('decisive', at(80), [
      say('kade', 'That Vesper\'s conducting. The Schedule says nobody dies decisively today.'),
      say('kade', 'Point. Make it decisive.'),
    ], 2),
    beat('withdraw', onFlag('depart:guards'), [
      say('sparrow', 'Lantern Guards, where are you going? We need your guns!'),
      say('system', 'LANTERN GUARD FLIGHT. ORDERS: ALLOCATION. WITHDRAW AT 1402.'),
      say('sparrow', '...They\'re pulling our cover. On schedule.'),
      say('candle', 'Seventh keeping: we thank it, and we go. They left out the thanking.'),
    ], 2),
    beat('embarrass', killsOf('choir', 3), [say('salt', 'Three. Forecast says they lose nine. Let\'s embarrass the forecast.')]),
    beat('overheard', onFlag('off-script'), [
      hiss('system', 'UNLISTED BAND. ENCRYPTION: ALLOCATION/TREASURY. YOUR CORE KNOWS THIS CIPHER.'),
      hiss('quillon', 'Allocation, Treasury. Engagement 114 has deviated. Our conductor is lost. Please advise.'),
      hiss('pryce', 'Treasury, Allocation. Regrettable. A correction will be scheduled.'),
      hiss('quillon', 'And the 13th?'),
      hiss('pryce', 'Costly and visible. I\'ll see to it personally.'),
      say('kade', '...Everyone get that?'),
      say('jackpot', 'Every word, Boss.'),
    ], 4),
    beat('balance', onDone('rout'), [
      say('ledger', 'Final count: Directorate losses under forecast. Hegemony conductor lost.'),
      say('ledger', 'First engagement in nine years that didn\'t balance. They\'ll notice. I should have said something years ago.'),
    ]),
    beat('hurt', HULL_LOW, [say('candle', 'Point, you\'re burning. The forecast doesn\'t get you. Not today.')]),
    beat('home', SUCCESS, [say('oyelaran', 'Vanguard, come home. Abbess, my ready room. Bring the auditor. I think I need to see the numbers.')]),
    beat('balanced', FAILURE, [say('ledger', 'Losses on forecast. Everything balanced. God help us.')]),
  ],
  codex: ['log-schedule', 'ppl-pryce'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Engagement 114, Lysowick. Directorate losses: below forecast. Hegemony losses: six Cantors and one Vesper conductor, above forecast.\n\n' +
    'The Lysowick Lantern Guards withdrew at 1402 on orders from Allocation. The order has since been deleted from the fleet record. Commander Aubrac holds a copy. She also holds a recording of the Allocator-General and the Hierarch-Treasurer of the Zenith Hegemony discussing the 13th Squadron on a shared band.\n\n' +
    'Captain Oyelaran has read the Schedule. He has asked Commander Aubrac for a copy, "for my granddaughter, when she is old enough to be angry."\n\n' +
    'NULL COUNT: 947.',
};

const EP09: CampaignMission = {
  id: 'ep09-the-ghost-ship',
  chapter: 2,
  episode: 9,
  title: 'THE GHOST SHIP',
  milestones: [9],
  system: 'corouhold',
  tagline: 'Status: delayed.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD. THIS FLIGHT IS NOT LOGGED.',
    'The Allocator-General has frozen the Canticle core "pending Board review". I am reviewing it faster.',
    'Waypoint one of the Stair crosses the Corouhold gas giant\'s radiation belts. The Canticle flagged a golden-age mass drifting inside them and marked it, in the Choir\'s own hand, AVOID.',
    'Canopy shielding gives you ten minutes in the belt. Scan the mass. If it has an archive, bring it out. If the Choir followed their own map here, and they will have, do not let them have it.',
    'I am an old man, and forgetful, and I will not remember sending you. Keep the light.',
  ),
  objectives: [
    obj('belt', 'Enter the Corouhold radiation belt', (c) => c.distanceTo('patience') < 6000),
    obj('scan', 'Scan the derelict (hold within 300 m)', (c) => c.flag('patience-scanned')),
    obj('archive', 'Recover the archive core from the derelict\'s spine', (c) => c.flag('archive-core-recovered')),
    obj('hunters', 'Drive off the Choir hunters', (c) => c.kills('choir') >= 5),
    obj('exit', 'Clear the belt before your dose limit', (c) => c.distanceTo('patience') > 7000),
    cue('candle-stays', 'depart:candle', (c) => c.objectiveDone('hunters')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(CANTOR, 'choir', 3, ahead(3000, 1200, 12000), 'hunters', 'Choir Hunter', 'hostile', { whenFlag: 'patience-scanned', delay: 20 }),
    spawn(PSALTER, 'choir', 2, ahead(-2600, 800, 12500), 'hunterP', 'Psalter', 'hostile', { whenFlag: 'patience-scanned', delay: 26 }),
  ],
  setpieces: [
    piece('wreckage', 'belt', ahead(0, 0, 7000), { kind: 'radiation-belt', radius: 9000, tint: '#9fffb0', label: 'Corouhold radiation belt' }),
    piece('derelict', 'patience', ahead(0, -300, 7000), { name: 'The Long Patience', class: 'Clavis', length: 1100, state: 'dark', radiation: true }),
    piece('blackbox', 'archive-core', ahead(0, -120, 7450), { label: 'Archive core (spine node 1)' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Waypoint one of the Stair. The Choir marked it "avoid". So naturally.'),
      say('jackpot', 'When the Zenith say avoid, I say: pool\'s open.'),
      say('system', 'RADIATION. CANOPY DOSE LIMIT: TEN MINUTES.'),
      say('salt', 'Ten minutes. Plenty of time to find out what the Choir\'s scared of.'),
    ]),
    beat('sight', near('patience', 4500), [
      say('sparrow', 'Oh. Oh, look at her.'),
      say('candle', 'Golden age. Pre-Shattering. Whole. Oh, you beauty. You poor, patient beauty.'),
      say('system', 'HULL NAME, TIMETABLE REGISTRY: THE LONG PATIENCE. CLASS: CLAVIS. STATUS: DELAYED.'),
    ], 2),
    beat('hold', onActive('scan'), [say('kade', 'Point, hold within three hundred metres. Let your core talk to hers. They\'re the same vintage.')]),
    beat('awake', onDone('scan'), [
      say('system', 'SCAN COMPLETE. CREW: FORTY. LIFE SIGNS: NONE. ARCHIVE: AWAKE.'),
      say('candle', 'Awake? After four hundred years?'),
      say('system', 'THE ARCHIVE REPORTS THAT IT HAS BEEN WAITING TO BE ASKED.'),
    ], 3),
    beat('hunters', onFlag('patience-scanned'), [
      say('system', 'INTONATION. FIVE CONTACTS, INBOUND.', 20),
      say('salt', 'They followed the Stair. Of course they did. It\'s their map.'),
    ], 2),
    beat('witty', killsOf('choir', 3), [
      say('jackpot', 'Hunters hunted! Ha! Radiation\'s making me witty.'),
      say('kade', 'Radiation\'s making you something.'),
    ]),
    beat('blueprints', onDone('archive'), [
      say('ledger', 'Archive uplink received. There are blueprints in here. For her. For her whole class.'),
      say('ledger', 'A Clavis can open any Lantern regardless of lock state. Any Lantern, Abbess.'),
      say('salt', 'That\'s not a ship. That\'s a skeleton key to every door in the Reach.'),
      say('kade', 'Which is why nobody\'s going to be allowed to have it.'),
    ], 3),
    beat('stay', onDone('hunters'), [
      say('candle', 'Abbess. I\'m staying with her.'),
      say('kade', 'Candle, the dose—'),
      say('candle', 'Her shielding\'s better than our canopies. She has wardens\' quarters. Nobody\'s kept her in four hundred years.'),
      say('kade', '...Keep her, then. We\'ll come back for you.'),
      say('candle', 'I know you will.'),
    ], 3),
    beat('hurt', HULL_LOW, [say('kade', 'Point, radiation plus a hull breach is a bad sum. Pull back to me.')]),
    beat('out', SUCCESS, [say('kade', 'Vanguard, we\'re clear. Four of us going home. One staying with a ghost. God help me, I think that\'s right.')]),
    beat('dose', FAILURE, [
      say('system', 'DOSE LIMIT EXCEEDED.'),
      say('kade', 'Everyone out. She\'s waited four hundred years; she can wait for us.'),
    ]),
  ],
  codex: ['tech-clavis'],
  modifiers: { timeLimit: 600, ambience: 'dread' },
  debrief:
    'Derelict identified: The Long Patience, golden-age Clavis-class gate tender, crew of forty, lost in the Shattering. Archive core recovered; it contains complete self-documentation of the Clavis class, which the Board of Allocation has already, somehow, heard about and designated the GLADIUS PROGRAM.\n\n' +
    'Warden-Brother Oduya remains aboard the Patience, attempting to wake her engines by the Keepings. He reports that her corridors are clean, her lamps are lit, and her galley clock is stopped at eleven hours before the Shattering.\n\n' +
    'NULL COUNT: 911.',
};

const EP10: CampaignMission = {
  id: 'ep10-the-fall-of-the-bastion',
  chapter: 2,
  episode: 10,
  title: 'THE FALL OF THE BASTION',
  milestones: [10],
  system: 'anchorage',
  tagline: 'Deck is green.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD.',
    'The Bastion is at anchor off Anchorage: Hesperus Dawn, Lodestar, Constant, and eleven escorts. The Allocator-General arrived this morning with a Board order for the Patience\'s archive. I have told him, truthfully, that the archive is aboard a derelict in a radiation belt with a warden who does not answer the radio. He has been very understanding.',
    'Fly combat air patrol over the anchorage. Routine.',
    'Abbess, if anything is not routine, you are released to act on your own judgment. I have written that down and signed it. It is in your seat pocket, with something else of mine I would like you to keep for me.',
    'Keep the light.',
  ),
  objectives: [
    obj('cap', 'Fly combat air patrol over the Bastion', (c) => c.distanceTo('bastion') < 3000),
    obj('intercept', 'Intercept the bombers — the carriers can\'t dodge', (c) => c.kills('choir') >= 5, { setsFlag: 'resume:lifeboats' }),
    obj('lifeboats', 'Cover the lifeboat corvettes to the Graveyard lane', (c) => c.flag('lifeboats-arrived'), { failed: (c) => !c.alive('lifeboats') }),
    obj('jump', 'Jump out. Rendezvous with the Long Patience', (c) => c.jumps >= 1),
    cue('lifeboats-hold', 'halt:lifeboats', () => true),
    cue('pryce-leaves', 'depart:allocation', (c) => c.time > 55),
    cue('attack', 'bastion-attack', (c) => c.time > 72 && c.objectiveDone('cap')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, by('bastion', 400, 300, 200), 'allocation', 'Allocation Launch', 'static'),
    spawn(LANTERN_GUARD, 'concord', 2, by('bastion', -300, -200, -600), 'lifeboats', 'Lifeboat Corvette', 'escort', { routeTo: 'lane' }),
    spawn(CANTOR, 'choir', 6, ahead(0, 800, 11000), 'strike', 'Choir Strike', 'hostile', { whenFlag: 'bastion-attack', delay: 6 }),
    spawn(PSALTER, 'choir', 4, ahead(1800, 400, 12000), 'bombers', 'Psalter', 'hostile', { whenFlag: 'bastion-attack', delay: 12 }),
    spawn(CATHEDRAL, 'choir', 2, ahead(-4000, 2000, 16000), 'cathedrals', 'Cathedral', 'capital', { whenFlag: 'bastion-attack' }),
    spawn(CANTOR, 'choir', 4, by('lifeboats', 2500, 600, 2500), 'hunt', 'Choir Hunter', 'hostile', { whenFlag: 'resume:lifeboats', delay: 25 }),
  ],
  setpieces: [
    piece('bastion', 'bastion', ahead(0, -800, 4000), { flagship: 'Hesperus Dawn', carriers: 3, escorts: 11 }),
    piece('beacon', 'lane', ahead(-6000, -200, -8000), { label: 'Graveyard lane' }),
    piece('wreckage', 'graveyard', ahead(-9000, 0, -11000), { radius: 4000, era: 'golden-age', label: 'The Timetable Graveyard' }),
  ],
  chatter: [
    beat('open', START, [
      say('oyelaran', 'Vanguard, Dawn Actual. The Allocator-General has asked, very politely, for the archive.'),
      say('kade', 'And you said?'),
      say('oyelaran', 'I said I\'m an old man, and forgetful.'),
      say('jackpot', 'Captain, I love you.'),
      say('oyelaran', 'Fly your patrol, Lieutenant.'),
    ]),
    beat('pryce', at(34), [
      say('pryce', 'Captain Oyelaran, thank you for your hospitality. I\'ll return with a fuller order. Keep the light.'),
      say('oyelaran', 'Keep the light, Allocator.'),
    ]),
    beat('early', onFlag('depart:allocation'), [
      say('salt', 'His launch is leaving early. Why is his launch leaving early?'),
      say('kade', 'Vanguard, tighten up. Something\'s wrong.'),
    ], 2),
    beat('lantern', at(66), [
      say('sparrow', 'Abbess, the Lantern — it\'s opening. Nothing\'s scheduled. Nothing\'s—'),
      say('system', 'INTONATION.'),
    ], 3),
    beat('attack', onFlag('bastion-attack'), [
      say('control', 'Cathedrals through the Anchorage Lantern! Two— four— they have our codes. They have the gate codes!'),
      say('oyelaran', 'All squadrons launch. All of them. Everything with a seat.'),
      say('kade', 'Vanguard, on me! Kill the bombers first. The carriers can\'t dodge!'),
    ], 4),
    beat('pool', killsOf('choir', 3), [say('jackpot', 'Scratch three! Pool\'s suspended! Everybody\'s getting paid today!')]),
    beat('deck', onDone('intercept'), [
      say('oyelaran', 'Lodestar is gone. Constant is gone. We\'re holding the hangar doors open, Control. Keep them open.'),
      say('control', 'Lifeboat corvettes away. Vanguard, cover them to the Graveyard lane.'),
      say('control', 'Deck is green. Deck is green, Vanguard, go, go.'),
    ], 4),
    beat('fall', onFlag('bastion-destroyed'), [
      hiss('control', 'Deck is green. Deck is—'),
      hiss('oyelaran', 'Kade. The chart is in your seat pocket. Take it back to her.'),
      hiss('oyelaran', 'Tell her the lines go somewhere.'),
      hiss('oyelaran', 'All Vanguard: you are released. Go where the light is. Keep the light.'),
      say('system', 'CVS-07 HESPERUS DAWN. CARRIER LOST.'),
      say('sparrow', 'No. No, no, no—'),
      say('kade', 'Vanguard. Eyes on the lifeboats. We grieve later. That\'s an order.'),
    ], 5),
    beat('candle', onFlag('lifeboats-arrived'), [
      say('kade', 'Lifeboats are at the lane. Candle, it\'s Abbess. Is she awake?'),
      hiss('candle', 'She\'s awake, Abbess. I\'ve lit her. Come to me. Bring everyone.'),
    ], 3),
    beat('sold', onActive('jump'), [
      say('salt', 'The Board sold the Bastion. You all know that, right? Pryce sold it and walked out the door.'),
      say('kade', 'I know. Jump.'),
    ]),
    beat('hurt', HULL_LOW, [say('kade', 'Point, don\'t you dare. Not today. Not you too.')]),
    beat('count', SUCCESS, [
      say('kade', 'Vanguard, count off.'),
      say('jackpot', 'Three.'),
      say('sparrow', '...Five.'),
      say('salt', 'Six.'),
      say('kade', 'One\'s with us. Candle\'s waiting. That\'s everyone. That\'s everyone we have.'),
    ]),
    beat('lost', FAILURE, [say('kade', '...Keep the light.')]),
  ],
  codex: ['log-dawn', 'log-chart'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Bastion is lost. CVS-07 Hesperus Dawn, CVS Lodestar, CVS Constant, eleven escorts. 4,112 crew.\n\n' +
    'The Choir fleet entered Anchorage using current Directorate gate codes. The Allocator-General\'s launch departed the anchorage 17 seconds before the Lantern opened.\n\n' +
    'The Board of Allocation has declared the 13th Independent Squadron "missing, presumed expended." Two lifeboat corvettes and five fighters reached the Long Patience in the Corouhold belt. Warden Oduya had lit her galley lamps and made soup.\n\n' +
    'In the seat pocket of Vanguard 2: a signed order releasing the squadron to its own judgment, and a child\'s star-chart, drawn in crayon on the back of a ration card.\n\n' +
    'NULL COUNT: 887.',
};

// ════════════════════════════════════════════════════════════════════════
// CHAPTER III — INTO THE DEEP VOID
// ════════════════════════════════════════════════════════════════════════

const EP11: CampaignMission = {
  id: 'ep11-crossing-the-dead-zone',
  chapter: 3,
  episode: 11,
  title: 'CROSSING THE DEAD ZONE',
  milestones: [11],
  system: 'deadzone',
  tagline: 'Fly by eye.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 80 AFTER THE BASTION.',
    'Twenty-two raids. Nine Ebon convoys robbed, from both sides, equally. Five fighters, two lifeboat corvettes, one Rustwake hauler and a golden-age ghost ship that can open any Lantern it likes. Wanted by the Directorate for desertion, by the Hegemony for theft, and by Clan Marsh for unpaid invoices.',
    'Last night the Patience opened the Null Lantern. It had never been opened. Beyond it lies the Caul, where instruments die and the Canticle spent six years learning to fly by hymn.',
    'We will fly it by eye. Vanguard scouts ahead along the Canticle\'s flare-buoys. The Patience follows your flares, blind, twenty kilometres behind.',
    'Trust nothing that glows green. — K.',
  ),
  objectives: [
    obj('wp1', 'Find Stair waypoint 1 (look for the pink flare)', (c) => c.distanceTo('wp1') < 400),
    obj('wp2', 'Find Stair waypoint 2 by eye', (c) => c.distanceTo('wp2') < 400, { setsFlag: 'fog-ambush' }),
    obj('fog', 'Survive the hunters in the fog', (c) => c.kills('choir') >= 3 && c.flag('depart:psalm')),
    obj('wp3', 'Find Stair waypoint 3', (c) => c.distanceTo('wp3') < 400),
    obj('exit', 'Break out of the Caul', (c) => c.flag('caul-exited')),
    psalmWithdraws('psalm-withdraws', 3),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(CANTOR, 'choir', 1, by('wp2', 1800, 500, 1500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'fog-ambush', delay: 6 }),
    spawn(CANTOR, 'choir', 3, by('wp2', -1500, -400, 1800), 'fogmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'fog-ambush', delay: 4 }),
  ],
  setpieces: [
    piece('nebula', 'caul', ahead(0, 0, 12500), { radius: 11500, color: '#8a7aa0', lightning: true, visibility: 600 }),
    piece('beacon', 'wp1', ahead(-600, 200, 4000), { label: 'Stair 1', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'wp2', ahead(900, -300, 9000), { label: 'Stair 2', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'wp3', ahead(-300, 600, 15500), { label: 'Stair 3', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'teybeacon', ahead(300, -100, 6500), { label: 'Rustwake beacon (Clan Tey)', color: '#ffae4f' }),
    piece('wreckage', 'tey-wreck', ahead(340, -140, 6600), { radius: 120, label: 'Clan Tey hauler' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard. Eighty days since the Bastion. We\'re out of gas, out of friends, and out of Reach.'),
      say('candle', 'The Patience is behind you, twenty kilometres back, blind as a mole. Where you fly, she follows.'),
      say('system', 'SENSORS DEGRADING. SERVICE SUSPENDED.'),
      say('kade', 'Instruments off. Fly by eye. Find the pink lights.'),
    ], 2),
    beat('bruise', at(24), [
      say('jackpot', 'It\'s like flying inside a bruise.'),
      say('salt', 'Poetic.'),
      say('jackpot', 'I\'ve been hanging around Sparrow.'),
    ]),
    beat('wp1', onDone('wp1'), [
      say('sparrow', 'Waypoint one! I see the next flare. Maybe. Everything\'s grey. Everything\'s the same grey.'),
      say('kade', 'Trust your eyes over your instruments. Your eyes are older.'),
    ]),
    beat('tey', near('teybeacon', 1400), [
      say('system', 'BEACON. RUSTWAKE. CLAN TEY. RECORDING LOOP.'),
      hiss('system', '"Day forty. Can\'t see. Compass spinning. Tell Mother we found the—"'),
      say('magpie', 'Clan Tey. My grandmother\'s cousins. They went in when I was a girl.'),
      say('magpie', 'Found the what, you silly buggers? Found the what?'),
    ]),
    beat('ambush', onFlag('fog-ambush'), [
      hiss('system', 'INTONA—'),
      say('kade', 'Contact! Somewhere! Everybody call visuals!'),
      hiss('psalm', 'Directorate. You are in the Caul. So am I. We are both blind. Let us see who sings better.'),
      say('jackpot', 'Oh, come ON.'),
    ], 3),
    beat('splash', killsOf('choir', 1), [
      say('sparrow', 'Splash one, I think! I can\'t tell! Did I get it?'),
      say('salt', 'You got it. It\'s on fire. Fire\'s the one thing you can see in here.'),
    ]),
    beat('withdraw', onFlag('depart:psalm'), [
      hiss('psalm', 'Enough. The Caul will take whichever of us it prefers.'),
      hiss('psalm', 'Ascend, Directorate. If you can find which way is up.'),
    ]),
    beat('lights', onDone('wp3'), [say('candle', 'I can see your flares from the Patience. A line of lights in the dark. Oh, that\'s beautiful. Keep going.')]),
    beat('out', onFlag('caul-exited'), [
      say('system', 'SENSORS RESTORED.'),
      say('sparrow', 'Oh.'),
      say('kade', '...Everyone. Look up.'),
      say('system', 'OBJECT AHEAD. DIAMETER: 3,470 KILOMETRES.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re hit and I can\'t see you. Say something. Waggle your wings. Anything.')]),
    beat('lost', FAILURE, [say('kade', 'Point? Point! ...Flares out, everyone. Light the way back. In case.')]),
  ],
  codexOnStart: ['anom-caul'],
  codex: ['hist-long-dark'],
  modifiers: { navDegraded: true, ambience: 'dread' },
  debrief:
    'The Caul crossed in six hours by the Patience\'s clock and nine by the fighters\', which no one can explain. Three Stair waypoints confirmed. Clan Tey\'s beacon recovered; Captain Marsh has asked to keep it.\n\n' +
    'Beyond the Caul, the Canticle\'s survey logs describe "the Anchor". The squadron has seen it now. The squadron has, by unanimous and unspoken agreement, stopped making jokes about the Canticle\'s crew weeping.\n\n' +
    'NULL COUNT: 409.',
};

const EP12: CampaignMission = {
  id: 'ep12-encounter-with-the-monolith',
  chapter: 3,
  episode: 12,
  title: 'ENCOUNTER WITH THE MONOLITH',
  milestones: [12],
  system: 'monolith',
  tagline: 'Eleven million years.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 99.',
    'A sphere the size of a moon. No orbit. No emissions. Colder than the space around it. The Canticle called it the Anchor and left survey buoys along its approach.',
    'Vanguard will fly a formation survey to the sphere\'s equator, recover what the Canticle left, and hold station.',
    'There are no hostiles on any instrument. The instruments work again. That is not reassuring.',
    'Warden Oduya reports that the Patience\'s archive has gone quiet, "like a dog when its owner comes home." Commander Aubrac reports that the Signal is louder here than at the Null. Much louder.',
    'Weapons safe. Nobody shoots anything. — K.',
  ),
  objectives: [
    obj('approach', 'Approach the object', (c) => c.flag('anchor-contact')),
    obj('sv1', 'Recover the Canticle\'s survey buoy (1/2)', (c) => c.distanceTo('sv1') < 250),
    obj('sv2', 'Recover the Canticle\'s survey buoy (2/2)', (c) => c.distanceTo('sv2') < 250),
    obj('equator', 'Hold formation above the equator and listen', (c) => c.flag('equator-held')),
  ],
  spawns: [...squad('kade', 'jackpot', 'sparrow', 'salt')],
  setpieces: [
    piece('monolith', 'anchor', ahead(0, 0, 32000 + 1735000), { radius: 1735000, temperature: 'below-background', surface: 'mirror-matte' }),
    piece('nebula', 'caulwall', ahead(0, 0, -16000), { radius: 12000, color: '#8a7aa0', lightning: true, backdropOnly: true }),
    piece('beacon', 'sv1', ahead(-2500, 800, 15000), { label: 'Canticle survey buoy', color: '#ff5fd0' }),
    piece('beacon', 'sv2', ahead(1800, -400, 22000), { label: 'Canticle survey buoy', color: '#ff5fd0' }),
    piece('beacon', 'equator', ahead(0, 0, 28000), { label: 'Equatorial station', hold: 30, radius: 500 }),
    piece('derelict', 'patience', ahead(0, -600, -4000), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
  ],
  chatter: [
    beat('silence', START, [
      say('kade', 'Vanguard. Nobody talk for a minute.'),
      say('jackpot', '...Boss, I can\'t. It\'s the size of a moon. It\'s the size of a moon and it\'s perfectly smooth.', 14),
      say('salt', 'It\'s not reflecting the nebula. It\'s reflecting something. Just not the nebula.'),
      say('system', 'OBJECT. NO ORBIT. NO EMISSIONS. TEMPERATURE: BELOW BACKGROUND.'),
      say('sparrow', 'Colder than space. How can it be colder than space?'),
    ]),
    beat('dog', at(45), [say('candle', 'The Patience can see it too. Her archive\'s gone quiet. I\'ve never heard a machine be quiet on purpose.')]),
    beat('wall', onFlag('anchor-contact'), [
      say('system', 'CAUL LIGHTNING TERMINATES. BOUNDARY: TWENTY KILOMETRES FROM SURFACE.'),
      say('system', 'CHRONOMETER DRIFT: MINUS 0.8 SECONDS PER HOUR.'),
      say('kade', 'Clocks are slow. Everything\'s slow. Keep formation tight.'),
    ], 2),
    beat('hymn-buoy', onDone('sv1'), [
      say('system', 'CHOIR SURVEY BUOY. MESSAGE: "WE HAVE BEEN WITNESSED."'),
      say('salt', 'Six years of Zenith survey, and the note they leave is a hymn.'),
    ]),
    beat('age', onDone('sv2'), [
      say('system', 'SURFACE DATING BY EXPOSURE: ELEVEN MILLION YEARS.'),
      say('jackpot', 'Eleven million. Pool closes. Nobody\'s ever beating that.'),
      say('sparrow', 'Humans aren\'t even— we\'re not eleven million years old.'),
      say('kade', 'No. We\'re not.'),
    ]),
    beat('name', near('equator', 3000), [
      say('jackpot', 'I\'m calling it the Monolith. There was an old film. Never seen it. Heard about it. A big black slab, and apes.'),
      say('salt', 'It\'s a sphere, and it isn\'t black.'),
      say('jackpot', 'You\'re the ape in this scenario, Salt.'),
    ]),
    beat('reflection', near('equator', 900), [
      say('sparrow', 'Abbess, my reflection on the surface. It\'s moving a second after I do.'),
      say('kade', 'Then wave at it. Politely.'),
    ]),
    beat('signal', onFlag('equator-held'), [
      say('system', 'CARRIER DETECTED. SOURCE: THE OBJECT.'),
      say('system', 'PULSES: 293.'),
      say('kade', '...It\'s the Signal.'),
      say('sparrow', 'It\'s been coming from here. All this time.'),
      say('system', 'RESPONSE TRANSMITTED. ONE PULSE.'),
      say('system', 'THE OBJECT HAS ACKNOWLEDGED. IT IS PREPARING TO SPEAK.'),
    ], 4),
    beat('listen', SUCCESS, [say('kade', 'Nobody moves. Nobody shoots. We listen.')]),
  ],
  codex: ['anom-anchor'],
  modifiers: { ambience: 'sublime' },
  debrief:
    'The Anchor surveyed. Diameter 3,470 km. Age by surface exposure, eleven million years. Local time runs 0.8 seconds per hour slow. The Caul\'s lightning stops twenty kilometres from its surface as though at a wall.\n\n' +
    'The squadron calls it the Monolith, because Lieutenant Castellanos did. The Signal originates here. It is not a beacon. It is the object itself, counting.\n\n' +
    'NULL COUNT: 293.',
};

const EP13: CampaignMission = {
  id: 'ep13-the-oracle-broadcast',
  chapter: 3,
  episode: 13,
  title: 'THE ORACLE BROADCAST',
  milestones: [13],
  system: 'monolith',
  tagline: 'We are not gone. We are ahead.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 109.',
    'The Monolith has been trying to talk to us for ten days. It uses 0413\'s golden-age core as a dictionary, because it is the only thing in the flotilla that speaks a language it recognises. Translation improves only with proximity, and only in segments.',
    'Three listening points around the equator. Vanguard 1 holds at each while the archive streams. The rest of us keep the Choir off: Psalm\'s Measure arrived through the Caul yesterday, with a jamming Vesper. The Zenith does not want the Anchor to speak to us.',
    'Six years they sang to it. It never answered them.',
    'Listen well. — K.',
  ),
  objectives: [
    obj('ls1', 'Hold at Listening Point 1', (c) => c.flag('ls1-held')),
    obj('jammer', 'Destroy the Choir jammer and its screen', (c) => c.kills('choir') >= 4),
    obj('ls2', 'Hold at Listening Point 2', (c) => c.flag('ls2-held')),
    obj('measure', 'Drive off Psalm\'s Measure', (c) => c.kills('choir') >= 9 && c.flag('depart:psalm')),
    obj('ls3', 'Hold at Listening Point 3 and receive the archive', (c) => c.flag('ls3-held')),
    psalmWithdraws('psalm-withdraws', 8),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(VESPER, 'choir', 1, by('ls1', 2500, 1500, 3000), 'jammer', 'Vesper Silence of Hesper', 'capital', { whenFlag: 'ls1-held' }),
    spawn(CANTOR, 'choir', 3, by('ls1', 2000, 1200, 2500), 'jamscreen', 'Choir Screen', 'hostile', { whenFlag: 'ls1-held', delay: 2 }),
    spawn(CANTOR, 'choir', 1, by('ls2', -2500, 1500, 2500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'ls2-held', delay: 4 }),
    spawn(CANTOR, 'choir', 3, by('ls2', -2200, 1300, 2800), 'pmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'ls2-held', delay: 4 }),
    spawn(PSALTER, 'choir', 2, by('ls2', -3000, 1800, 3200), 'ppsalter', 'Psalter', 'hostile', { whenFlag: 'ls2-held', delay: 8 }),
  ],
  setpieces: [
    piece('monolith', 'anchor', ahead(0, -1739000, 0), { radius: 1735000 }),
    piece('beacon', 'ls1', ahead(0, 0, 2500), { label: 'Listening point I', hold: 20, radius: 300, color: '#e8fff8' }),
    piece('beacon', 'ls2', ahead(6000, 0, 7000), { label: 'Listening point II', hold: 25, radius: 300, color: '#e8fff8' }),
    piece('beacon', 'ls3', ahead(-2000, 0, 13000), { label: 'Listening point III', hold: 60, radius: 350, color: '#e8fff8' }),
    piece('derelict', 'patience', ahead(-3000, 1200, -3000), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Point, the Monolith wants you. The rest of us are furniture. Let\'s be well-armed furniture.'),
      say('system', 'CARRIER FROM THE OBJECT. STRUCTURED. TRANSLATION CONFIDENCE: 4%.'),
    ]),
    beat('seg1', near('ls1', 320), [
      say('oracle', 'WE ARE WHO BUILT THE ROAD.'),
      say('oracle', 'YOU ARE WHO FOUND IT.'),
      say('oracle', 'THIS IS THE THING THAT KEEPS THE ROAD. LISTEN.'),
      say('system', 'TRANSLATION CONFIDENCE: 31%. USING TIMETABLE CORE AS DICTIONARY.'),
    ], 4),
    beat('jammer', onFlag('ls1-held'), [
      say('system', 'INTONATION. VESPER. BROADBAND JAMMING.'),
      hiss('psalm', 'His Altitude forbids the Anchor to speak to the unascended. Stand away from it.'),
      say('kade', 'Kill the Vesper. Point, you too. It can\'t talk to you through that noise.'),
    ], 3),
    beat('jam-clear', onDone('jammer'), [say('system', 'JAMMING ENDS. THE OBJECT RESUMES. IT DID NOT STOP WHILE IT WAS JAMMED. IT WAITED.')]),
    beat('seg2', near('ls2', 320), [
      say('oracle', 'The galaxy breathes. Each breath is a wave, crossing the disc outward from the heart.'),
      say('oracle', 'Worlds do not feel it. Roads do. A road in tune carries the breath. A road out of tune breaks.'),
      say('system', 'TRANSLATION CONFIDENCE: 78%.'),
      say('candle', 'A road out of tune breaks. Abbess... the Shattering. That\'s what the Shattering was.'),
    ], 4),
    beat('psalm', onFlag('ls2-held'), [
      say('psalm', 'It speaks to you. Six years we sang to it and it never spoke to us.'),
      say('psalm', 'Why you? Why the unascended?'),
      say('jackpot', 'Maybe it likes our taste in music.'),
    ], 3),
    beat('measure-pain', killsOf('choir', 6), [say('psalm', 'Answer me, Directorate! What did you bring that we did not?')]),
    beat('withdraw', onFlag('depart:psalm'), [
      say('psalm', 'I will listen from the Caul, then. If it will not speak to me, I will hear what it tells you.'),
      say('kade', 'Psalm. ...Listen well.'),
    ]),
    beat('seg3', near('ls3', 370), [
      say('oracle', 'Each breath is deeper than the last. We measured it for a very long time. Then we decided.', 2),
      say('oracle', 'We went outward, past the edge of the disc, where the breath does not reach.'),
      say('oracle', 'We are not gone. We are ahead.'),
      say('oracle', 'We left the road lit. We left anchors to hold it. We left keys to tune it.'),
      say('oracle', 'We left a clock, so whoever came after would know when to tune. We counted in the numbers that cannot be divided.'),
      say('sparrow', 'The Signal. It\'s a clock. It\'s their clock.'),
      say('oracle', 'When the clock reaches the smallest of the numbers, the breath arrives.'),
      say('ledger', 'The count is 241. Fifty-two bursts to two. Fifty-six days.'),
      say('oracle', 'Tune the road, and follow. Or do not tune it, and stay. Either is permitted.'),
      say('oracle', 'Only do not leave it half-tuned. That is how roads break.'),
      say('oracle', 'We hoped someone would come. We hoped they would bring a key.'),
      say('oracle', 'We hoped they would bring more than one kind of song.'),
    ], 5),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re the only one it talks to. Don\'t you dare make it wait another eleven million years.')]),
    beat('after', SUCCESS, [
      say('kade', '...Everybody get that?'),
      say('jackpot', 'Boss, I don\'t think I\'m ever going to be funny again.'),
      say('kade', 'Give it a day.'),
    ]),
    beat('lost', FAILURE, [say('system', 'TRANSLATION INTERRUPTED. THE OBJECT WILL WAIT.')]),
  ],
  codex: ['log-oracle'],
  modifiers: { ambience: 'sublime' },
  debrief:
    'The Anchor Archive received in full, as transcribed in the codex. The Builders did not vanish. They left the galaxy ahead of a periodic compression wave — "the Breath" — which powers a Lantern in tune and shatters one that is not.\n\n' +
    'The Signal is the Builders\' clock. When it reaches 2, the Breath arrives. At the current rate of one burst per 25 hours 51 minutes, that is fifty-six days from now.\n\n' +
    'The Choir jammer destroyed. Psalm withdrew into the Caul and has not left it. The flotilla\'s listening watch reports that someone in there is singing, very quietly, on the Anchor\'s frequency.\n\n' +
    'NULL COUNT: 241.',
};

const EP14: CampaignMission = {
  id: 'ep14-the-schism',
  chapter: 3,
  episode: 14,
  title: 'THE SCHISM',
  milestones: [14],
  system: 'rustwake',
  tagline: 'Go where the light is.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 126.',
    'The Patience\'s spine needs Ebon to open anything. Clan Marsh will give us forty kilograms from the moot-hold at Rustwake, for nothing, which Magpie says is the most expensive thing she has ever done.',
    'What we do with it is not agreed.',
    'Salt wants the Nexus, and through it, and away. The Oracle said follow; the Builders left a road; let the empires keep their war. Abbess wants Meridian and the Counting House and then Hesper. Four thousand one hundred and twelve people, she says. Sparrow keeps saying the Oracle said to tune the road, and nobody knows what she means, including Sparrow.',
    'Escort the tankers. Then we decide. — Ledger, for the flotilla',
  ),
  objectives: [
    obj('tankers', 'Escort Magpie\'s tankers from the moot-hold to the Patience', (c) => c.flag('tankers-arrived'), { failed: (c) => c.aliveCount('tankers') < 1 }),
    obj('hunters', 'Destroy the joint Directorate–Zenith hunter group', (c) => c.kills('concord') >= 4 && c.kills('choir') >= 3),
    obj('decide', 'Return to the Patience', (c) => c.distanceTo('patience') < 2000),
    cue('salt-leaves', 'depart:salt', (c) => c.objectiveDone('hunters')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(SCRAPJACK, 'rustwake', 1, ahead(-200, 60, 600), 'magpie', 'Magpie\'s Due', 'wing'),
    spawn(SCRAPJACK, 'rustwake', 2, ahead(150, -40, 800), 'tankers', 'Marsh Tanker', 'escort', { routeTo: 'patience' }),
    spawn(HARRIER, 'concord', 3, ahead(3200, 900, 7000), 'hk-dir', 'Allocation Hunter', 'hostile', { delay: 55 }),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(3800, 1300, 8500), 'hk-guard', 'FFC Correction', 'hostile', { delay: 60 }),
    spawn(CANTOR, 'choir', 3, ahead(2800, 700, 7400), 'hk-zen', 'Treasury Cantor', 'hostile', { delay: 55 }),
  ],
  setpieces: [
    piece('wreckage', 'belt', ahead(0, -1200, 4000), { kind: 'asteroids', radius: 7000, label: 'The Rustwake Belt' }),
    piece('beacon', 'moothold', ahead(-500, 0, -1200), { label: 'Clan moot-hold' }),
    piece('derelict', 'patience', ahead(0, -300, 9000), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
  ],
  chatter: [
    beat('open', START, [
      say('magpie', 'Welcome to the moot, Vanguard! Thirty clans, one hold, and everybody shouting. It\'s lovely.'),
      say('magpie', 'Forty kilos for the Patience. Friends\' rate. Which is nothing. Don\'t tell the clans.'),
      say('kade', 'Tem. Thank you.'),
      say('magpie', 'Don\'t thank me. Just don\'t die before you tell me what you\'re going to do with it.'),
    ]),
    beat('follow', at(18), [
      say('salt', 'I\'ll tell you what we do with it. We go through the Nexus. The Oracle said follow. So we follow.'),
      say('kade', 'And leave the Reach to Pryce?'),
      say('salt', 'The Reach left us, Abbess. At Anchorage. On schedule.'),
    ]),
    beat('strike', at(36), [
      say('kade', 'They sold four thousand people for a price floor. I\'m going to Meridian. To the Counting House.'),
      say('jackpot', 'And then Hesper. I want to meet the Zenith and tell him his hymn is flat.'),
      say('sparrow', 'The Oracle didn\'t say fight or run. It said tune the road.'),
      say('salt', 'It said either is permitted. First honest thing anyone\'s said to me in nine years.'),
    ]),
    beat('hunters', at(56), [
      say('system', 'CONTACTS. DIRECTORATE HARRIERS. CHOIR CANTORS. FLYING TOGETHER.'),
      say('jackpot', 'Together? In formation? That\'s— that\'s obscene.'),
      say('kade', 'That\'s the Schedule. They\'ve stopped pretending.'),
    ], 3),
    beat('stripes', killsOf('concord', 1), [
      say('sparrow', 'I just shot down a Directorate pilot. He had our stripes.'),
      say('candle', 'He had Pryce\'s orders, child. Fly now. Grieve later. It\'s what she\'d say.'),
      say('kade', 'It\'s what I\'m saying.'),
    ], 2),
    beat('tey', killsOf('choir', 2), [say('magpie', 'That\'s for Clan Tey! And that one\'s for my tankers last spring!')]),
    beat('salt', onDone('hunters'), [
      say('salt', 'Abbess. I\'m taking a skiff and twenty kilos. Some of the clans want out too. There\'s a route to the Null.'),
      say('kade', 'Salt.'),
      say('salt', 'I\'m not asking. I\'m telling you where I\'ll be. If you get the road open, I\'ll be first through it.'),
      say('jackpot', 'You owe the pool forty grams.'),
      say('salt', 'Put it on my tab.'),
      say('kade', '...Go where the light is, Soren.'),
    ], 4),
    beat('gone', onFlag('depart:salt'), [
      say('sparrow', 'He didn\'t say goodbye.'),
      say('kade', 'He never does. It\'s how you know he\'s coming back.'),
    ]),
    beat('spine', onDone('decide'), [
      say('candle', 'Abbess. The Patience\'s spine is humming. It has been since the Monolith. In the Choir\'s intervals.'),
      say('kade', 'Meaning?'),
      say('candle', 'Meaning I think we\'ve misunderstood her. I think we\'ve all misunderstood her.'),
    ], 2),
    beat('hurt', HULL_LOW, [say('kade', 'Point! Not here. Not in the middle of a family argument.')]),
    beat('armada', SUCCESS, [
      say('ledger', 'Flotilla, Ledger. Long-range from Psalm\'s side of the Caul, unencrypted. I think she meant us to hear it.'),
      say('ledger', 'The Zenith has launched the Choir. All of it. Cathedrals. Course: the Nexus.'),
      say('kade', 'Then we don\'t have to decide. We hold the Ring.'),
    ]),
    beat('lost', FAILURE, [say('magpie', 'Gas is gone. Clans are gone. Well. At least nobody has to decide anything now.')]),
  ],
  codex: ['log-sparrow'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Forty kilograms of Ebon transferred to the Long Patience. Enough to open one Lantern.\n\n' +
    'A joint Directorate–Hegemony hunter group — Allocation Harriers and Treasury Cantors flying in formation — destroyed at the Rustwake moot-hold. The clans who saw it have voted, by shouting, to stop selling to either side.\n\n' +
    'Lieutenant Soren Achterberg has left the flotilla with a Rustwake skiff, twenty kilograms of Ebon and eleven clan haulers, bound for the Null. His mug stays on the hook.\n\n' +
    'The Choir fleet is moving on the Nexus. The flotilla will meet it there.\n\n' +
    'NULL COUNT: 157.',
};

const EP15: CampaignMission = {
  id: 'ep15-the-siege-of-the-nexus',
  chapter: 3,
  episode: 15,
  title: 'THE SIEGE OF THE NEXUS',
  milestones: [15],
  system: 'nexus',
  tagline: 'Hold the Ring.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 139.',
    'The Nexus: a Lantern two hundred kilometres across, whole, unlit, holding the map of every road in the galaxy in the light along its rim. Whoever holds it can open every gate at once, or close every gate forever.',
    'The Zenith\'s armada is coming to do the second. Two Cathedrals, their Vesper spire-tenders, and more Cantors than we have rounds. The tenders carry the keys the Cathedrals need to sing the Ring shut. Kill the tenders and the Cathedrals are just very large churches.',
    'We have four Kestrels, Clan Marsh, two lifeboat corvettes, and a ghost ship with enough gas to open one door once.',
    'Hold the Ring. — K.',
  ),
  objectives: [
    obj('ring', 'Reach the Nexus', (c) => c.flag('nexus-reached')),
    obj('wave1', 'Break the first Psalter wave', (c) => c.kills('choir') >= 6, { setsFlag: 'wave1-broken' }),
    obj('tenders', 'Destroy the Vesper spire-tenders and their escorts', (c) => c.kills('choir') >= 16),
    obj('hold', 'Return to the throat of the Ring', (c) => c.distanceTo('nexus') < 2500),
    cue('salt-returns', 'salt-returns', (c) => c.kills('choir') >= 9),
    cue('jackpot-falls', 'destroy:jackpot', (c) => c.flag('salt-returns') && c.kills('choir') >= 11),
    cue('cathedrals-turn', 'depart:cathedrals', (c) => c.objectiveDone('tenders')),
    cue('psalm-turns', 'depart:psalm', (c) => c.objectiveDone('tenders') || (c.alive('psalm') && c.hull('psalm') < 0.4)),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow'),
    spawn(SCRAPJACK, 'rustwake', 1, ahead(-220, 40, -200), 'magpie', 'Magpie\'s Due', 'wing'),
    spawn(SCRAPJACK, 'rustwake', 3, ahead(-300, -40, -300), 'clan', 'Clan Marsh', 'wing'),
    spawn(LANTERN_GUARD, 'concord', 2, ahead(0, -400, -2500), 'flotilla', 'Lifeboat Corvette', 'static'),
    spawn(PSALTER, 'choir', 4, ahead(2500, 1000, 26000), 'wave1P', 'Psalter', 'hostile', { whenFlag: 'nexus-reached', delay: 12 }),
    spawn(CANTOR, 'choir', 2, ahead(2000, 800, 25500), 'wave1C', 'Cantor', 'hostile', { whenFlag: 'nexus-reached', delay: 10 }),
    spawn(CATHEDRAL, 'choir', 2, ahead(-8000, 3000, 38000), 'cathedrals', 'Cathedral', 'capital', { whenFlag: 'nexus-reached', delay: 30 }),
    spawn(VESPER, 'choir', 3, ahead(-3000, 1500, 30000), 'tenders', 'Vesper Spire-Tender', 'capital', { whenFlag: 'wave1-broken', delay: 5 }),
    spawn(CANTOR, 'choir', 3, ahead(-2500, 1200, 29000), 'tenderescort', 'Cantor', 'hostile', { whenFlag: 'wave1-broken', delay: 5 }),
    spawn(CANTOR, 'choir', 1, ahead(-2000, 1800, 29500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'wave1-broken', delay: 8 }),
    spawn(HARRIER, 'concord', 1, ahead(0, 200, 8000), 'salt', 'Vanguard 6 · Salt', 'wing', { whenFlag: 'salt-returns' }),
    spawn(SCRAPJACK, 'rustwake', 6, ahead(300, 300, 8200), 'freehaulers', 'Rustwake Free Haulers', 'wing', { whenFlag: 'salt-returns', delay: 2 }),
    spawn(CANTOR, 'choir', 4, ahead(4000, 2000, 30000), 'wave3', 'Cantor', 'hostile', { whenFlag: 'salt-returns', delay: 4 }),
  ],
  setpieces: [
    piece('megagate', 'nexus', ahead(0, 0, 24000), { radius: 20000, state: 'unlit', rimArchive: true, label: 'The Nexus' }),
    piece('derelict', 'patience', ahead(0, -600, -1500), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard. This is it. The Zenith are coming to close it forever.'),
      say('candle', 'The Patience is in position. The spine has gas for one opening. One. Choose your moment, Abbess.'),
      say('magpie', 'Clan Marsh and three friends. It\'s all the clans would spare. The rest are hiding under their bunks.'),
      say('jackpot', 'Very sensible people, the rest.'),
    ]),
    beat('whole', near('nexus', 15000), [
      say('system', 'OBJECT. LANTERN. DIAMETER: 40 KILOMETRES. STATUS: WHOLE.'),
      say('sparrow', 'It\'s whole. It\'s the only whole thing I\'ve ever seen.'),
    ], 2),
    beat('rim', at(55), [
      say('jackpot', 'Boss. What you said about the rim. "Less of it."'),
      say('kade', 'What about it?'),
      say('jackpot', 'Nothing. Just— I think you might\'ve been wrong. Don\'t tell anyone I said so.'),
    ]),
    beat('armada', onFlag('nexus-reached'), [
      say('system', 'INTONATION. MANY. MANY.'),
      say('kade', 'Here they come. Kill the Psalters before they reach the flotilla!'),
    ], 3),
    beat('tenders', onDone('wave1'), [
      say('system', 'CATHEDRALS: TWO. VESPER TENDERS DEPLOYING.'),
      say('candle', 'The Vespers carry the spire keys. Without them the Cathedrals can\'t sing the seal.'),
      say('psalm', 'Vanguard. His Altitude asks you to stand aside. He says this is a mercy. He says you will understand.'),
      say('kade', 'Tell him we\'ll understand from right here.'),
    ], 3),
    beat('salt', onFlag('salt-returns'), [
      say('system', 'RUSTWAKE TRANSPONDERS, ASTERN. SEVEN. VANGUARD SIX AMONG THEM.'),
      say('salt', 'Vanguard, Salt. Heard there was a party. Brought some friends. And the forty grams.'),
      say('jackpot', 'SALT! You beautiful, miserable— the pool is REOPENED!'),
      say('magpie', 'Took you long enough.'),
      say('salt', 'Hello, Tem.'),
    ], 4),
    beat('jackpot', onFlag('destroy:jackpot'), [
      say('jackpot', 'Salt, Cathedral lance on your six— I\'ve got it. I\'ve got it—'),
      say('jackpot', 'Tell the pool it all goes to Sparrow. She\'s the only one who never cheated.'),
      say('system', 'VANGUARD 3. SIGNAL LOST.'),
      say('salt', 'Teo? ...TEO!'),
      say('sparrow', 'No— he was just— he was just talking—'),
      say('kade', 'Keep flying. Vanguard, keep flying. He\'d want the pool paid out. We fly.'),
    ], 5),
    beat('turn', onDone('tenders'), [
      say('system', 'VESPER TENDERS DESTROYED. CATHEDRALS TURNING.'),
      say('psalm', 'His Altitude recalls the Choir to Hesper. The Ring is yours. For now.'),
      say('psalm', 'I heard your wingman, before he fell. He was laughing.'),
      say('psalm', 'You are witnessed. All of you. Him most of all.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re coming apart. Get behind the Patience and let Candle look at you.')]),
    beat('open-ring', SUCCESS, [
      say('oracle', 'THE ROAD IS HALF-TUNED.'),
      say('oracle', 'A KEY IS PRESENT. ONE MAY ENTER.'),
      say('candle', 'Abbess. The Ring\'s opening a corridor. Not a jump. A corridor. It wants one pilot.'),
      say('kade', '...Point. Your core\'s the dictionary. It wants you.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'The Ring\'s lost. Everyone back to the Patience. Everyone who\'s left.')]),
  ],
  codex: ['anom-nexus'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Siege of the Nexus. Two Cathedrals turned back; three Vesper spire-tenders and thirteen Choir fighters destroyed. The Ring holds.\n\n' +
    'Lieutenant Teodor Castellanos, Vanguard 3, killed in action covering Lieutenant Achterberg\'s return. His mug stays on the hook. The kill pool, per his last instruction, has been paid in full to Ensign Talbot, who has refused it, and then, at Commander Kade\'s order, accepted it.\n\n' +
    'The Nexus has opened a corridor. It is asking for one pilot.\n\n' +
    'NULL COUNT: 97.',
};

// ════════════════════════════════════════════════════════════════════════
// CHAPTER IV — THE EPIC RESOLUTION
// ════════════════════════════════════════════════════════════════════════

const EP16: CampaignMission = {
  id: 'ep16-the-solo-pilgrimage',
  chapter: 4,
  episode: 16,
  title: 'THE SOLO PILGRIMAGE',
  milestones: [16],
  system: 'nexus',
  tagline: 'Ninety-seven. Eighty-nine. Eighty-three.',
  briefing: briefing(
    'VANGUARD 2 TO VANGUARD 1. PERSONAL.',
    'I don\'t know what\'s in there. Neither does Candle, who has now said all seven Keepings four times and started over. Neither does the Oracle, or if it does, it isn\'t telling me. It asked for you.',
    'Your core is six hundred years old and it remembers every pilot who ever sat in that seat. It speaks the Timetable\'s language. It said hello to the Signal before any of us knew the Signal could hear. I think it\'s been waiting for this longer than you have been alive.',
    'Go in. Look. Come back.',
    'That\'s the whole order. — Saoirse',
  ),
  objectives: [
    obj('enter', 'Enter the corridor', (c) => c.distanceTo('corridor') < 1000),
    obj('follow', 'Follow the light', (c) => c.flag('corridor-complete')),
  ],
  spawns: [],
  setpieces: [
    piece('megagate', 'nexus', ahead(0, 0, -30000), { radius: 20000, state: 'opening' }),
    piece('pilgrimage', 'corridor', ahead(0, 0, 2000), { length: 60000, stages: 5, palette: 'white-teal-magenta', duration: 280 }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Point. Whatever\'s in there, it\'s asking for you. Not me. Not any of us.'),
      say('kade', 'Come back. That\'s the whole order. Come back.'),
      say('candle', 'First keeping: the seal holds. I\'ll say the rest while you\'re gone.'),
      say('sparrow', 'Bring me back a poem.'),
    ]),
    beat('light', onDone('enter'), [
      say('system', 'CORRIDOR. NO STARS. NO INSTRUMENTS. NO—'),
      say('system', 'THERE IS A LIGHT.', 4),
    ], 3),
    beat('count-a', at(45), [
      hiss('system', 'NULL COUNT: 89.'),
      hiss('system', '83.', 3),
      hiss('system', '79. 73. 71.', 3),
      say('system', 'CHRONOMETER DISAGREES WITH ITSELF. BOTH ARE CORRECT.'),
    ]),
    beat('voices', at(75), [
      say('system', 'ARCHIVED VOICE. PILOT 22. YEAR 301.'),
      hiss('system', '"Tell my mother the Lantern lit. Tell her I saw it light."'),
      say('system', 'ARCHIVED VOICE. PILOT 51. YEAR 402.'),
      hiss('system', '"Kestrel, if I don\'t make it, you look after the next one."'),
      say('system', 'ARCHIVED VOICE. PILOT 66. YEAR 430.'),
      hiss('system', '"Tell Abbess I\'m sorry about the canard."'),
    ]),
    beat('kept', at(120), [
      say('system', 'I REMEMBER ALL OF THEM, POINT.'),
      say('system', 'SIXTY-SEVEN. I KEPT THEM.', 3),
    ], 2),
    beat('oracle', at(155), [
      say('oracle', 'YOU CARRY A KEEPER\'S MACHINE. YOUR KIND HAS KEPT IT FOUR HUNDRED YEARS WITHOUT KNOWING WHY.'),
      say('oracle', 'WE WILL SHOW YOU WHY. LOOK.'),
    ], 3),
    beat('road', at(190), [
      say('oracle', 'This is the road lit. Every light a door. Every door open.'),
      say('oracle', 'This is what you lost. This is what you may have again.'),
      say('oracle', 'It will be heavy. It is always heavy. We carried it too.'),
    ], 3),
    beat('count-b', at(235), [
      hiss('system', 'NULL COUNT: 13.'),
      hiss('system', '11.', 4),
      hiss('system', '7.', 4),
    ]),
    beat('out', onFlag('corridor-complete'), [
      say('system', 'CORRIDOR ENDS. STARS. A LANTERN. SYSTEM: HESPER DEEP.'),
      say('system', 'NULL COUNT: 5. ELAPSED INSIDE: FOUR MINUTES. ELAPSED OUTSIDE: TWENTY-FOUR DAYS.'),
      say('system', 'INTONATION. CATHEDRAL. IT IS VERY CLOSE.'),
    ], 5),
  ],
  codex: ['anom-builders'],
  modifiers: { noWingmen: true, ambience: 'sublime' },
  debrief:
    'Vanguard 1 entered the Nexus corridor at count 97.\n\n' +
    'Vanguard 1 emerged from the Hesper Deep Lantern — sealed, by Choir record, since the Shattering — at count 5. Twenty-four days had passed by every clock in the Reach. Airframe 0413\'s flight recorder logged four minutes and eleven seconds.\n\n' +
    'The recorder holds 280 seconds of imagery from inside the corridor. The squadron has watched it once. No one has asked to watch it again, and no one has asked for it to be deleted.\n\n' +
    'NULL COUNT: 5.',
};

const EP17: CampaignMission = {
  id: 'ep17-the-revelation-of-the-zenith',
  chapter: 4,
  episode: 17,
  title: 'THE REVELATION OF THE ZENITH',
  milestones: [17],
  system: 'hesper',
  tagline: 'A cradle is a safe place to be a child forever.',
  briefing: briefing(
    'INTERCEPT. CHOIR COMMAND BAND. HESPER DEEP. TRANSLATED FROM THE LITURGICAL.',
    'To all Measures of the Spire: a Directorate fighter has come out of the Hesper Lantern.',
    'Nothing has come out of the Hesper Lantern in four hundred and thirty-one years. His Serene Altitude has heard it hum for forty-one of those years and has said it would open only once, at the end of all things.',
    'The fighter is alone. It is damaged. It is within twelve kilometres of the Altitude.',
    'The First Cantor will intercept. The First Cantor will not destroy it until His Altitude has seen it.',
    'Be witnessed.',
  ),
  objectives: [
    obj('survive', 'Survive Psalm\'s Measure', (c) => c.kills('choir') >= 4, { setsFlag: 'altitude-speaks' }),
    obj('approach', 'Approach the Altitude', (c) => c.distanceTo('altitude') < 3000),
    obj('audience', 'Hear the Zenith', (c) => c.flag('audience-held')),
    obj('escape', 'Escape through the Hesper Lantern', (c) => c.jumps >= 1),
    cue('psalm-stands-down', 'depart:psalm', (c) => c.flag('altitude-speaks')),
  ],
  spawns: [
    spawn(CATHEDRAL, 'choir', 1, ahead(0, 1500, 12000), 'altitude', 'Cathedral Altitude', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(1500, 600, 5000), 'psalm', 'Psalm', 'hostile', { delay: 6 }),
    spawn(CANTOR, 'choir', 4, ahead(1800, 800, 5500), 'spiremeasure', 'Hesper Measure', 'hostile', { delay: 5 }),
    spawn(CANTOR, 'choir', 4, by('altitude', -2000, 500, -1500), 'treasury', 'Treasury Cantor', 'hostile', { whenFlag: 'audience-held', delay: 4 }),
  ],
  setpieces: [
    piece('beacon', 'audience', by('altitude', 0, -600, -2200), { label: 'Before the Altitude', hold: 70, radius: 600, color: '#ff3fa8' }),
    piece('wreckage', 'gardens', ahead(-6000, -2000, 9000), { kind: 'crystal-foundry', radius: 4000, label: 'Foundry-gardens of Hesper' }),
  ],
  chatter: [
    beat('open', START, [
      say('system', 'HESPER DEEP. CHOIR CAPITAL. THE LANTERN BEHIND YOU IS HUMMING.'),
      say('system', 'CATHEDRAL AHEAD. DESIGNATION: ALTITUDE. THRONE-SHIP OF THE ZENITH.'),
      say('psalm', 'You came out of the Hesper Lantern. Nothing comes out of the Hesper Lantern.'),
      say('psalm', 'Be witnessed, Directorate. And then be still.'),
    ], 3),
    beat('together', killsOf('choir', 2), [say('psalm', 'You fly as if the machine were flying you. Or as if you were flying together.')]),
    beat('enough', onFlag('altitude-speaks'), [
      say('zenith', 'Isaura. Enough.'),
      say('psalm', 'Grandfather— Your Altitude. The pilot came through the Ring.'),
      say('zenith', 'I know, child. I heard it open. Let the pilot come to me. I should like to speak to someone who has seen it.'),
    ], 4),
    beat('welcome', near('altitude', 3500), [
      say('zenith', 'Welcome, Pilot. You have seen the road lit. So did I, once, in a text I spent nine years learning to read.'),
      say('zenith', 'Come closer. I am old, and what I have to say is not a thing one shouts.'),
    ], 3),
    beat('truth', near('audience', 650), [
      say('zenith', 'The Breath comes in two days. Your Directorate thinks the Ring is a weapon. My Treasurer thinks it is a market.'),
      say('zenith', 'It is a door. And humanity is not ready to walk through it.'),
      say('zenith', 'We had the whole road once. Two thousand years. Do you know what we did with it? We scheduled it.'),
      say('zenith', 'We laid up the keys to save money. The Breath came. Forty thousand souls went into the Lanterns and never came out.'),
      say('zenith', 'So I will seal them. Every Lantern, at once, cleanly, from the Ring. No shattering. No one lost in the throats.'),
      say('zenith', 'Humanity stays where it stands. Every world an Earth. Every Earth a cradle.'),
      say('zenith', 'And a cradle is a safe place to be a child forever.'),
      say('psalm', 'Even us, Grandfather? Even the Ascended?'),
      say('zenith', 'Especially us, Isaura. I have read our hymns. We are not worthy of the stars. No one is.'),
      say('psalm', '...Then what have we been ascending toward?'),
      say('system', 'THE ZENITH HAS CLOSED THE CHANNEL.', 6),
    ], 5),
    beat('treasury', onFlag('audience-held'), [
      say('system', 'CANTORS. FOUR. TREASURY LIVERY. WEAPONS HOT.'),
      say('psalm', 'Those are not his. They are Treasury\'s. Go, Directorate. The Lantern will take you. I am coming back to hold them.'),
      say('psalm', 'Tell your Abbess the Choir has a question it cannot answer. Tell her I am asking it.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('system', 'HULL CRITICAL. I HAVE LOST SIXTY-SEVEN PILOTS, POINT. I WOULD PREFER NOT TO LOSE SIXTY-EIGHT.')]),
    beat('home', SUCCESS, [
      say('kade', 'POINT! Point, you— twenty-four days, you— where have you been?'),
      say('kade', '...Never mind. Never mind. You came back. That was the whole order.'),
    ]),
    beat('lost', FAILURE, [say('psalm', 'You are witnessed, Directorate. I am sorry. I think you had something to tell us.')]),
  ],
  codex: ['ppl-zenith'],
  modifiers: { noWingmen: true, ambience: 'dread' },
  debrief:
    'Vanguard 1 rejoined the flotilla after an audience with Ottavian Sarre-Aurelian, the Nineteenth Zenith, aboard the throne-ship Altitude at Hesper Deep.\n\n' +
    'The Zenith\'s intention: to use the Nexus at the crest of the Breath to seal every Lantern in the galaxy permanently, leaving humanity alive, safe, and alone on whatever world it stands on.\n\n' +
    'The Directorate\'s intention, according to a Board order intercepted this morning: to take the Long Patience — "the Gladius" — and use it to open every Hegemony Lantern at once before the crest.\n\n' +
    'Two days. Two plans. Neither of them is tuning.\n\n' +
    'NULL COUNT: 5.',
};

const EP18: CampaignMission = {
  id: 'ep18-the-key-not-the-sword',
  chapter: 4,
  episode: 18,
  title: 'THE KEY, NOT THE SWORD',
  milestones: [18],
  system: 'meridian',
  tagline: 'Do not open it. Play it.',
  briefing: briefing(
    'OFFICE OF CONTINUITY — YEVGENIA AUBRAC, FOR THE LAST TIME UNDER THAT TITLE.',
    'Allocation Hour broadcasts from the Castellan relay at 1900. Every screen in the Directorate will be on. I have the Schedule: every engagement, every price floor, every signature, including mine. I am going to read it aloud.',
    'Pryce knows. He has brought the Indomitable to Meridian to take the Patience, and Treasury Cantors to help him, which should tell you everything. He means to use her as a sword: every Hegemony gate at once, before the crest.',
    'Get my launch to the relay. Hold it while I read. Then go home to the Patience. Candle says he has done something terrible and needs to tell us about it.',
    'Keep the light. I mean it now.',
  ),
  objectives: [
    obj('relay', 'Escort Ledger\'s launch to the Allocation Hour relay', (c) => c.flag('ledger-launch-arrived'), { failed: (c) => !c.alive('ledger-launch') }),
    obj('broadcast', 'Hold the relay while Ledger reads the Schedule', (c) => c.flag('relay-held'), { failed: (c) => !c.alive('ledger-launch') }),
    obj('loyalists', 'Defeat Pryce\'s loyalists and the Treasury Cantors', (c) => c.kills('concord') >= 4 && c.kills('choir') >= 4),
    obj('berth', 'Return to the Patience', (c) => c.flag('berth-held')),
    cue('pryce-taken', 'depart:pryce-flag', (c) => c.objectiveDone('loyalists')),
  ],
  spawns: [
    ...squad('kade', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(200, -50, 700), 'ledger-launch', 'Continuity Launch', 'escort', { routeTo: 'relay' }),
    spawn(INDOMITABLE, 'concord', 1, ahead(5000, -800, 14000), 'indomitable', 'BB-01 Indomitable', 'static'),
    spawn(LANTERN_GUARD, 'concord', 1, by('indomitable', -1500, 400, -1000), 'pryce-flag', 'Allocation Flag', 'static'),
    spawn(HARRIER, 'concord', 4, ahead(3500, 900, 9000), 'alloc-guard', 'Allocation Guard', 'hostile', { whenFlag: 'ledger-launch-arrived', delay: 5 }),
    spawn(CANTOR, 'choir', 4, ahead(-3200, 1000, 9500), 'treasury', 'Treasury Cantor', 'hostile', { whenFlag: 'ledger-launch-arrived', delay: 8 }),
  ],
  setpieces: [
    piece('beacon', 'relay', ahead(0, 300, 8000), { label: 'Allocation Hour relay, Castellan ring', hold: 55, radius: 700 }),
    piece('wreckage', 'yards', ahead(-3500, -1200, 7000), { kind: 'shipyard-scaffold', radius: 3000, label: 'Castellan ring yards' }),
    piece('derelict', 'patience', ahead(-2000, -600, -6000), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
    piece('beacon', 'berth', by('patience', 0, 400, 0), { label: 'The Patience — spine gallery', hold: 45, radius: 500 }),
  ],
  chatter: [
    beat('open', START, [
      say('ledger', 'Vanguard, Ledger. Four minutes to Allocation Hour. I\'m going to read them the Schedule. All of it.'),
      say('kade', 'Pryce will come.'),
      say('ledger', 'Pryce is already here. He brought the Indomitable. He wants the Gladius.'),
      say('candle', 'She\'s not a sword. I keep telling you. She is not a sword.'),
    ], 2),
    beat('pryce', at(20), [
      say('pryce', 'Commander Kade. The Board recognises your service and your grief. Surrender the Gladius to the Indomitable.'),
      say('pryce', 'With it we open every Hegemony gate before the crest. Hesper falls in a day. Isn\'t that what you wanted?'),
      say('kade', 'I wanted the Bastion back, Allocator.'),
      say('pryce', 'Expenditures are regrettable. Outcomes are what matter.'),
    ]),
    beat('together', onFlag('ledger-launch-arrived'), [
      say('system', 'DIRECTORATE HARRIERS. FOUR. ALLOCATION GUARD. ALSO: CHOIR CANTORS, TREASURY LIVERY.'),
      say('sparrow', 'He brought Zenith fighters. To Meridian. To our capital.'),
      say('kade', 'The Schedule doesn\'t have sides, Sparrow. It never did.'),
    ], 3),
    beat('reading', onActive('broadcast'), [
      say('ledger', 'This is Yevgenia Aubrac, Office of Continuity. I am reading from the Schedule of Engagements.', 4),
      say('ledger', 'Engagement 114, Lysowick. Expected expenditure: eleven fighters. The 13th Squadron requested by name.', 8),
      say('ledger', 'Engagement 131, Anchorage. The Bastion. Expected expenditure: four thousand, one hundred and twelve.', 8),
      say('ledger', 'Signed: Corwin Pryce. Varro Quillon.', 6),
      say('ledger', 'Audited and approved: Yevgenia Aubrac. I knew. I am sorry. I am so sorry.', 6),
    ], 4),
    beat('rook', onFlag('relay-held'), [
      say('rook', 'Indomitable to all Directorate units. I have heard the Allocation Hour.'),
      say('rook', 'Allocator-General Pryce is relieved of authority. By me. All ships: hold fire on the 13th.'),
      say('pryce', 'Captain Rook, you are making an expenditure you cannot afford.'),
      say('rook', 'Put it on my ration card, Allocator.'),
    ], 5),
    beat('running', killsOf('choir', 2), [say('sparrow', 'Treasury Cantors breaking! They\'re running for the Lantern!')]),
    beat('lever', onDone('loyalists'), [
      say('pryce', 'You think it\'s a key. It\'s a lever. Somebody will always pull it. Better us than them.'),
      say('rook', 'Take him below.'),
    ], 3),
    beat('confession', near('berth', 550), [
      say('candle', 'Abbess. Point. I did a terrible thing. I broke the Sixth Keeping. I asked her why.'),
      say('candle', 'I opened her archive to the last log. Her master\'s voice. Four hundred and thirty-one years old.'),
      say('candle', '"The key is not in the ship. The ship is the key. Do not open it; play it."'),
      say('candle', 'Twelve nodes along her spine, in the Choir\'s intervals. She\'s an instrument. She was never a sword.'),
      say('kade', 'Then what plays her?'),
      say('candle', 'The Hymn. The Choir\'s been singing her tuning for two hundred years and never knew what it was for.'),
      say('sparrow', 'More than one kind of song. The Litany and the Hymn. The machines and the music.'),
      say('kade', 'Then we need a Cantor.'),
    ], 5),
    beat('hurt', HULL_LOW, [say('salt', 'Point, you\'re smoking. Rook\'s got the heavy lifting. Fall back to me.')]),
    beat('psalm', SUCCESS, [
      say('system', 'INCOMING. CHOIR CARRIER. INTONATION. ONE SHIP. WEAPONS COLD.'),
      say('psalm', 'Vanguard. This is Isaura Sarre-Aurelian. I have come to ask my question in person.'),
      say('psalm', 'And I think, Brother Candle, I know the song.'),
    ]),
    beat('lost', FAILURE, [say('ledger', 'Relay\'s down. They heard half. Half is worse than nothing. Half is how things break.')]),
  ],
  codex: ['log-patience'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Schedule of Engagements was read in full on the Allocation Hour to eleven million people. Captain Mireya Rook of BB-01 Indomitable relieved the Allocator-General of authority. Corwin Pryce is in custody. Varro Quillon\'s launch was last seen entering the Tessaly Lantern.\n\n' +
    'Warden-Brother Oduya has confessed to breaking the Sixth Keeping. The Order has not yet ruled on his penance. The Patience is not a weapon. She is an instrument, and her tuning is the Hymn of Ascent.\n\n' +
    'Dame-Cantor Isaura Sarre-Aurelian came aboard the Patience at 2214, alone, weapons cold. She asked to see the spine.\n\n' +
    'NULL COUNT: 3.',
};

const EP19: CampaignMission = {
  id: 'ep19-the-symphony-of-gates',
  chapter: 4,
  episode: 19,
  title: 'THE SYMPHONY OF GATES',
  milestones: [19],
  system: 'meridian',
  tagline: 'Two.',
  briefing: briefing(
    'ALL STATIONS. ALL STATIONS. THIS IS LEDGER. PLAN OF THE CREST.',
    'The last burst — 2 — arrives in nine minutes. The Breath follows. Every lit Lantern in the Reach must be in phase when it passes, or they ring, and crack, and it is the Shattering again.',
    'THE RING: the Patience, Warden Oduya on the spine, Dame-Cantor Sarre-Aurelian singing. THE REACH: Indomitable at Meridian. Clan Marsh at Rustwake. Psalm\'s defectors at Tessaly and Hesper. Lt. Achterberg at the Null.',
    'VANGUARD 1: your core is the only thing that speaks both the Patience\'s tuning and the Lanterns\' language. You carry the phase. Three Lanterns, three jumps, one after another, as fast as you can fly.',
    'Loyalists and Treasury holdouts will try to stop you. The Zenith is at the Ring.',
    'Nobody say "last flight". — K.',
  ),
  objectives: [
    obj('tune1', 'Carry the phase: hold at the Meridian tuning point', (c) => c.flag('tune-meridian-held')),
    obj('jump1', 'Jump. Carry the phase onward', (c) => c.jumps >= 1, { setsFlag: 'leg2' }),
    obj('tune2', 'Hold at the second tuning point', (c) => c.flag('tune-second-held')),
    obj('jump2', 'Jump again', (c) => c.jumps >= 2, { setsFlag: 'leg3' }),
    obj('tune3', 'Hold at the third tuning point', (c) => c.flag('tune-third-held'), { setsFlag: 'crest' }),
    obj('crest', 'Hold as the Breath arrives', (c) => c.flag('crest-watch-held')),
  ],
  spawns: [
    ...squad('kade', 'sparrow'),
    spawn(INDOMITABLE, 'concord', 1, ahead(-4000, -900, 9000), 'indomitable', 'BB-01 Indomitable', 'static'),
    spawn(CANTOR, 'choir', 4, ahead(3000, 900, 8000), 'loyal1', 'Treasury Holdout', 'hostile', { delay: 22 }),
    spawn(SCRAPJACK, 'rustwake', 3, ahead(-400, 100, 1500), 'marsh', 'Clan Marsh', 'wing', { whenFlag: 'leg2' }),
    spawn(CANTOR, 'choir', 4, ahead(2500, 800, 6500), 'loyal2', 'Spire Loyalist', 'hostile', { whenFlag: 'leg2', delay: 8 }),
    spawn(PSALTER, 'choir', 2, ahead(-2800, 600, 7000), 'spirepsalters', 'Spire Psalter', 'hostile', { whenFlag: 'leg2', delay: 12 }),
    spawn(CANTOR, 'choir', 3, ahead(-300, 150, 1200), 'witnesses', 'Psalm\'s Witnesses', 'wing', { whenFlag: 'leg3' }),
    spawn(VESPER, 'choir', 1, ahead(-2000, 1500, 9000), 'spirevesper', 'Spire Vesper', 'capital', { whenFlag: 'leg3', delay: 6 }),
    spawn(CANTOR, 'choir', 5, ahead(2600, 1000, 8000), 'loyal3', 'Spire Loyalist', 'hostile', { whenFlag: 'leg3', delay: 10 }),
  ],
  setpieces: [
    piece('beacon', 'tune-meridian', ahead(0, 400, 5000), { label: 'Meridian tuning point', hold: 20, radius: 450, color: '#e8fff8' }),
    piece('beacon', 'tune-second', ahead(0, 300, 4000), { whenFlag: 'leg2', label: 'Tuning point II', hold: 20, radius: 450, color: '#e8fff8' }),
    piece('beacon', 'tune-third', ahead(0, 300, 4500), { whenFlag: 'leg3', label: 'Tuning point III', hold: 30, radius: 450, color: '#e8fff8' }),
    piece('beacon', 'crest-watch', ahead(0, 600, 1500), { whenFlag: 'crest', label: 'Hold for the crest', hold: 50, radius: 900, color: '#ffffff' }),
  ],
  chatter: [
    beat('open', START, [
      say('ledger', 'All stations, Ledger. Count is 3. Final burst in nine minutes. Then the Breath.'),
      hiss('candle', 'The Patience is ready. She\'s humming. Isaura\'s in the spine gallery. She says she knows the song.'),
      hiss('psalm', 'I have sung it since I was four, Brother. I did not know it had a purpose. Begin when you are ready.'),
      say('kade', 'Vanguard, Abbess. Last fl— no. We don\'t say that. Let\'s go to work.'),
    ], 3),
    beat('holdouts', at(24), [
      say('system', 'TREASURY HOLDOUTS. FOUR. THEY ARE SINGING THE WRONG VERSE.'),
      say('rook', 'Indomitable has your back, Point. Every gun I have is older than the Reach. Let\'s use them.'),
    ]),
    beat('first', onDone('tune1'), [
      say('system', 'LANTERN TONE: IN TUNE. FIRST OF SIX.'),
      say('rook', 'Meridian Lantern is in phase. Indomitable holds. Go, Point.'),
    ], 3),
    beat('leg2', onFlag('leg2'), [
      say('magpie', 'Clan Marsh holding the second light! Loyalist hymn-singers all over us! Sing louder, Isaura!'),
      hiss('psalm', '(sung) Out of the dust we were lifted—'),
      hiss('candle', 'Not that verse, Isaura. The old one. The one from before the words.'),
      hiss('psalm', '(sung) ...'),
    ], 3),
    beat('second', onDone('tune2'), [
      say('magpie', 'It\'s in tune! It\'s singing! You should hear it, it\'s— I\'m not crying. Nobody said anything.'),
      say('system', 'SECOND OF SIX. TESSALY REPORTS: THIRD OF SIX. HESPER REPORTS: FOURTH OF SIX.'),
    ], 3),
    beat('leg3', onFlag('leg3'), [
      say('salt', 'Null Lantern. It\'s lighting, Point. The Null\'s lighting. It\'s never lit. It doesn\'t go anywhere.'),
      say('salt', '...It goes somewhere now.'),
      say('system', 'WARNING. CATHEDRAL ALTITUDE AT THE RING. SPIRES CHARGING.'),
      hiss('candle', 'Abbess, the Zenith is aligning the Ring for his seal. If he fires it half-tuned—'),
      say('kade', 'Then every gate breaks. Point, finish the last one. I\'ll talk to him.'),
    ], 4),
    beat('plea', near('tune-third', 2000), [
      say('kade', 'Your Altitude. This is Saoirse Kade. I\'m a warden\'s orphan. I don\'t know hymns. I know engines.'),
      say('kade', 'An engine in tune doesn\'t need a cradle. Neither do we. Let us try.'),
      hiss('zenith', '...Isaura. Is that you singing?'),
      hiss('psalm', 'Yes, Grandfather.'),
      hiss('zenith', 'You have it in the right key. We never had it in the right key.'),
    ], 5),
    beat('two', onFlag('crest'), [
      say('system', 'NULL COUNT: 2.', 2),
      say('system', 'THE CLOCK HAS STOPPED.', 5),
      say('ledger', 'Crest in sixty seconds. All stations. All stations, hold.'),
      say('oracle', 'THE ROAD IS TUNED. THE BREATH ARRIVES.', 10),
      say('system', 'LANTERN TONE: SIX OF SIX. SIXTY OF SIXTY. FOUR HUNDRED OF—', 8),
      say('system', 'COUNT UNAVAILABLE. THEY ARE ALL LIGHTING.'),
      hiss('zenith', '...It is in tune.', 4),
      hiss('zenith', 'Isaura. Sing the last verse for me. I find I have forgotten it.'),
    ], 5),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you ARE the tuning. If you go, it goes. Stay alive. That\'s the whole job.')]),
    beat('chart', SUCCESS, [
      say('sparrow', 'Abbess. Look at the sky.'),
      say('kade', 'I\'m looking.'),
      say('sparrow', 'It\'s the chart. It\'s Ada\'s chart. All the lines.'),
      say('kade', '...They go somewhere.'),
    ]),
    beat('lost', FAILURE, [say('ledger', 'Half-tuned. It\'s ringing. God. Everyone out of the throats—')]),
  ],
  codex: ['anom-compression'],
  modifiers: { ambience: 'sublime' },
  debrief:
    'At the final burst the Signal stopped. Eleven minutes later the Breath crossed the Reach.\n\n' +
    'Nothing broke.\n\n' +
    'The six Lanterns of the Reach held phase and did not ring. Beyond them, one after another, then too many to count, the dead Lanterns of the galaxy lit. The Oracle reports that the road is open "to the edge of the disc and past it."\n\n' +
    'The throne-ship Altitude did not fire its seal. Its spires were recorded singing, in the right key, until the crest had passed.',
};

const EP20: CampaignMission = {
  id: 'ep20-the-open-horizon',
  chapter: 4,
  episode: 20,
  title: 'THE OPEN HORIZON',
  milestones: [20],
  system: 'null',
  tagline: 'Only more of it.',
  briefing: briefing(
    'VANGUARD. PATROL ORDER. NO SIGNATURE.',
    'There is no Board to sign it. There is no Bastion to fly from. There is a ghost ship that is not a ghost any more, and a squadron of five, and a Lantern at the edge of the Reach that has led nowhere for four hundred and thirty-one years and this morning began to hum.',
    'Patrol to the Null. Look at it. Come home.',
    'Nobody is shooting at anybody today. Try not to be disappointed.',
  ),
  objectives: [
    obj('formup', 'Form up on Abbess', (c) => c.distanceTo('kade') < 500),
    obj('lantern', 'Fly to the Null Lantern', (c) => c.flag('nulllantern-reached')),
    obj('threshold', 'Hold at the threshold', (c) => c.flag('threshold-held')),
  ],
  spawns: [...squad('kade', 'candle', 'sparrow', 'salt'), spawn(SCRAPJACK, 'rustwake', 6, ahead(6000, -800, 14000), 'queue', 'Rustwake Hauler (queued)', 'static')],
  setpieces: [
    piece('megagate', 'nulllantern', ahead(0, 0, 16000), { radius: 9000, state: 'lit', label: 'The Null Lantern' }),
    piece('beacon', 'threshold', ahead(0, 0, 13500), { label: 'Threshold', hold: 45, radius: 600, color: '#ffffff' }),
    piece('beacon', 'station', ahead(-1500, -300, 1200), { label: 'Null Picket Station 2 (unmanned)' }),
  ],
  chatter: [
    beat('open', START, [
      say('system', 'GOOD MORNING, POINT.'),
      say('kade', 'Vanguard, Abbess. Patrol to the Null. Nobody\'s shooting at anybody today.'),
      say('sparrow', 'Abbess, the count\'s back.'),
      say('system', 'NULL COUNT: 2.', 3),
      say('system', 'NULL COUNT: 3.', 5),
      say('sparrow', 'It\'s counting up.'),
      say('kade', '...Is it.'),
    ]),
    beat('eighth', at(40), [
      say('candle', 'Before we go on. Humour an old warden.'),
      say('candle', 'First keeping: the seal holds. Second: the feed runs clean. Third: the fire is fed and not starved.'),
      say('candle', 'Fourth: the cold is let out. Fifth: the old words are said.'),
      say('candle', 'Sixth: we do not ask the engine why.', 4),
      say('candle', 'Seventh: we thank it, and we go.'),
      say('candle', 'Eighth keeping: we ask it why. And we listen.', 3),
      say('sparrow', 'There isn\'t an eighth keeping.'),
      say('candle', 'There is now.'),
    ]),
    beat('queue', at(105), [
      say('salt', 'There\'s a queue at the Lantern. Rustwake haulers. They want to see where it goes.'),
      say('magpie', 'Not see, love. Go. Clan Marsh is first in line. I\'ve been first in line for everything I ever wanted.'),
    ]),
    beat('hesper', at(140), [
      say('psalm', 'Vanguard One. From Hesper. Be witnessed.'),
      say('psalm', 'My grandfather took the Altitude through the Hesper Lantern this morning. Outward. Alone. He left no message.'),
      say('psalm', '...That is not true. He left one. He said: "Tell the pilot I was wrong about the children."'),
    ]),
    beat('forecast', at(185), [say('ledger', 'Ledger. The Board\'s dissolved. Nobody knows what comes next. For once in my life I don\'t have a forecast.')]),
    beat('lit', near('nulllantern', 6000), [
      say('system', 'LANTERN. STATUS: LIT. DESTINATION: —'),
      say('system', 'DESTINATION NOT YET SCHEDULED. THIS IS NOT AN ERROR.'),
    ]),
    beat('ada', near('threshold', 2500), [
      say('sparrow', 'Abbess. Ada\'s chart. Can I read the edge?'),
      say('kade', 'Go ahead.'),
      say('sparrow', '"They go somewhere." And then, smaller: "Grandpa, where do they go." It runs off the card.'),
      say('kade', 'I\'ll take it to her. Tomorrow.'),
      say('sparrow', 'Tell her what?'),
      say('kade', 'That we\'re going to find out.'),
    ]),
    beat('rim', near('threshold', 550), [
      say('kade', 'Jackpot asked me once what was past the rim.', 6),
      say('kade', 'Same as here, Jackpot.', 5),
      say('kade', 'Only more of it.', 4),
      say('system', 'SERVICE RESUMED. THANK YOU FOR YOUR PATIENCE.', 8),
    ], 5),
  ],
  codex: [],
  modifiers: { ambience: 'sublime' },
  debrief: 'The Lanterns are humming.\n\nKeep the light.',
};

export const MISSIONS: CampaignMission[] = [
  EP01,
  EP02,
  EP03,
  EP04,
  EP05,
  EP06,
  EP07,
  EP08,
  EP09,
  EP10,
  EP11,
  EP12,
  EP13,
  EP14,
  EP15,
  EP16,
  EP17,
  EP18,
  EP19,
  EP20,
];
