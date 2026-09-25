/** ep12-encounter-with-the-monolith: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { say, beat, START, SUCCESS, at, onFlag, onDone, near, ahead, obj, piece, squad, briefing } from '../authoring.ts';

export const EP12: CampaignMission = {
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
