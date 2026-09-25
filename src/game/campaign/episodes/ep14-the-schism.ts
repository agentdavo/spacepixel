/** ep14-the-schism: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { HARRIER, LANTERN_GUARD, CANTOR, SCRAPJACK, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, killsOf, ahead, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP14: CampaignMission = {
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
