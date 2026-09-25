/** ep13-the-oracle-broadcast: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { CANTOR, PSALTER, VESPER, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, onFlag, onDone, near, killsOf, ahead, by, obj, piece, squad, spawn, psalmWithdraws, briefing } from '../authoring.ts';

export const EP13: CampaignMission = {
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
