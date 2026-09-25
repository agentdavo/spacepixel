/** ep20-the-open-horizon: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { SCRAPJACK, say, beat, START, at, near, ahead, obj, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP20: CampaignMission = {
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
