/** ep19-the-symphony-of-gates: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { INDOMITABLE, CANTOR, PSALTER, VESPER, SCRAPJACK, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, near, ahead, by, obj, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP19: CampaignMission = {
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
    // Witnesses at the first approach, well before the protected crest sequence.
    piece('kessen-cameo', 'kessen-witness', by('tune-meridian', 65, -14, -100), { tableau: 'witness', hideWhenFlag: 'leg2' }),
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
