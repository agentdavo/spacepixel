/** ep01-the-long-dark: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { HARRIER, SCRAPJACK, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, onFlag, onDone, near, killsOf, ahead, by, obj, piece, spawn, briefing } from '../authoring.ts';

export const EP01: CampaignMission = {
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
    obj('buoy1', 'Follow the survey buoys into the Graveyard (1/3)', (c) => c.distanceTo('buoy1') < 300, { navTag: 'buoy1' }),
    obj('buoy2', 'Follow the survey buoys (2/3)', (c) => c.distanceTo('buoy2') < 300, { navTag: 'buoy2' }),
    obj('buoy3', 'Follow the survey buoys (3/3)', (c) => c.distanceTo('buoy3') < 300, { navTag: 'buoy3', setsFlag: 'thieves' }),
    obj('thieves', 'Drive the scavengers off the school tender', (c) => c.kills('rustwake') >= 3),
    obj('beacon', 'Approach the Timetable beacon at the Great Lantern', (c) => c.distanceTo('timetable') < 400, { navTag: 'timetable' }),
    obj('yards', 'Deliver airframe 0413 to Anchorage Yards', (c) => c.distanceTo('yards') < 600, { navTag: 'yards' }),
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
