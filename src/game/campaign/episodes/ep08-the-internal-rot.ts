/** ep08-the-internal-rot: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { KESTREL, LANTERN_GUARD, CANTOR, VESPER, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, near, killsOf, ahead, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP08: CampaignMission = {
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
