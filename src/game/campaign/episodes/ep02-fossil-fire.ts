/** ep02-fossil-fire: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { HARRIER, LANTERN_GUARD, INDOMITABLE, SCRAPJACK, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onDone, onActive, near, ahead, by, obj, piece, spawn, briefing } from '../authoring.ts';

export const EP02: CampaignMission = {
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
