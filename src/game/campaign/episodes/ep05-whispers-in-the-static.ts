/** ep05-whispers-in-the-static: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { CANTOR, VESPER, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, onFlag, onDone, onActive, near, killsOf, ahead, by, obj, piece, spawn, psalmWithdraws, briefing } from '../authoring.ts';

export const EP05: CampaignMission = {
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
