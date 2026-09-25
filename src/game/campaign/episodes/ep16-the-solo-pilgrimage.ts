/** ep16-the-solo-pilgrimage: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { say, hiss, beat, START, at, onFlag, onDone, ahead, obj, piece, briefing } from '../authoring.ts';

export const EP16: CampaignMission = {
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
