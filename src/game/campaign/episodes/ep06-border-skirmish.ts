/** ep06-border-skirmish: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { LANTERN_GUARD, CANTOR, VESPER, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, onActive, killsOf, ahead, by, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP06: CampaignMission = {
  id: 'ep06-border-skirmish',
  chapter: 2,
  episode: 6,
  title: 'BORDER SKIRMISH',
  milestones: [6],
  system: 'zephacis',
  tagline: 'Same as here, only less of it.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD FLIGHT.',
    'Routine escort. FFC Plumb Line is surveying Ebon drift along the Zephacis border. You will fly cover to Survey Mark Z-7 and back. Expected contact: none. Expected duration: long. Expected complaint from Lieutenant Castellanos: continuous.',
    'This is Vanguard 1\'s first flight as Point. Commander Kade flies Two. The squadron will take it from there.',
    'The cockpit you are sitting in has been flown by sixty-seven pilots. The seat is original. Try not to be the one who replaces it.',
    'Keep the light. — Oyelaran',
  ),
  objectives: [
    obj('formup', 'Form up on the Plumb Line', (c) => c.distanceTo('plumb') < 1000),
    obj('escort', 'Escort the Plumb Line to Survey Mark Z-7', (c) => c.distanceTo('mark') < 2500, { failed: (c) => !c.alive('plumb'), setsFlag: 'ambush' }),
    obj('screen', 'Engage the Choir screen', (c) => c.kills('choir') >= 4, { failed: (c) => !c.alive('plumb') }),
    obj('canticle', 'Cripple the Zenith cruiser Canticle of Ascent', (c) => c.alive('canticle') && c.hull('canticle') < 0.35, { setsFlag: 'canticle-crippled' }),
    obj('mark', 'Mark the ejected data core before it sinks into the ring', (c) => c.distanceTo('coredrift') < 1500),
    obj('survey', 'Keep the Plumb Line\'s hull above 50%', (c) => c.objectiveDone('mark'), { optional: true, failed: (c) => c.hull('plumb') < 0.5 }),
    cue('canticle-flees', 'depart:canticle', (c) => c.flag('canticle-crippled')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(200, -60, 900), 'plumb', 'FFC Plumb Line', 'escort', { routeTo: 'mark' }),
    spawn(CANTOR, 'choir', 4, ahead(2800, 700, 11500), 'screen', 'Choir Screen', 'hostile', { whenFlag: 'ambush', delay: 3 }),
    spawn(VESPER, 'choir', 1, ahead(-1800, 300, 13000), 'canticle', 'Canticle of Ascent', 'capital', { whenFlag: 'ambush' }),
    spawn(CANTOR, 'choir', 2, by('canticle', 600, 200, 300), 'latescreen', 'Choir Screen', 'hostile', { whenFlag: 'ambush', delay: 50 }),
  ],
  setpieces: [
    piece('beacon', 'mark', ahead(0, 0, 10000), { label: 'Survey Mark Z-7' }),
    piece('wreckage', 'ring', ahead(0, -2500, 17000), { kind: 'planetary-ring', radius: 9000, label: 'Zephacis II ring' }),
    piece('beacon', 'coredrift', by('canticle', 0, -500, 700), { whenFlag: 'canticle-crippled', label: 'Ejected core (drifting)', color: '#ff5fd0' }),
  ],
  chatter: [
    beat('cockpit', START, [
      say('system', 'GOOD MORNING, POINT.'),
      say('kade', 'Vanguard, Abbess. Welcome to the worst job in the fleet: escorting a surveyor who measures dirt.'),
      say('jackpot', 'New Point! Jackpot, Three. I run the kill pool. A gram a head. Sweetheart deals for the skipper.'),
      say('kade', 'There is no sweetheart deal.'),
      say('jackpot', 'There\'s no sweetheart deal.'),
    ]),
    beat('roll-call', at(18), [
      say('sparrow', 'Sparrow, Five! Hi. It\'s an honour. I read about the Observance. And the Null. Sorry. Hi.'),
      say('salt', 'Salt. Six. Don\'t read about anything, kid. It\'s all ration cards and lies.'),
      say('candle', 'And you know me, Point. The engine and I are glad you\'re aboard. In that order.'),
      say('kade', 'That\'s the family. Don\'t get attached. I say that to everyone. It never works.'),
    ]),
    beat('rim', at(45), [
      say('jackpot', 'Boss. You ever wonder what\'s past the rim?'),
      say('kade', 'Same as here, Jackpot. Only less of it.'),
      say('jackpot', 'That\'s bleak, Boss.'),
      say('kade', 'That\'s the rim.'),
    ]),
    beat('grams', at(80), [
      say('salt', 'Nine years of cuts, and they still find grams to measure Ebon drift. Wonder who that\'s for.'),
      say('sparrow', 'Maybe it matters.'),
      say('salt', 'Everything matters, kid. That\'s what they tell you right before they cut it.'),
    ]),
    beat('ambush', onFlag('ambush'), [
      say('system', 'INTONATION. MULTIPLE. BEARING ZERO-ONE-ZERO.'),
      say('kade', 'Bandits! Vanguard, break and engage! Plumb Line, turn for home. Now!'),
      say('jackpot', 'That\'s a cruiser. Why is there a cruiser? Nobody said cruiser!'),
      say('salt', 'Vesper-class, out here, alone? It\'s not raiding. It\'s hiding something.'),
    ], 3),
    beat('pool', killsOf('choir', 2), [say('jackpot', 'That\'s two for the pool! Point, you\'re making me look bad on your first day!')]),
    beat('falter', killsOf('choir', 4), [say('candle', 'Their song\'s faltering. Press them.')]),
    beat('limp', onActive('canticle'), [
      say('kade', 'Point, the cruiser. Cut its drive. I want it limping, not dead.'),
      say('salt', 'Why not dead?'),
      say('kade', 'Because something that runs this hard has something to lose.'),
    ], 2),
    beat('eject', onDone('canticle'), [
      say('system', 'CRUISER EJECTING. OBJECT: ARMOURED DATA CORE. TRAJECTORY: PLANETARY RING.'),
      say('sparrow', 'It threw something away! Why would it—'),
      say('kade', 'Because it would rather we never find it than they lose it. Mark it, Point.'),
    ], 3),
    beat('fled', onFlag('depart:canticle'), [say('jackpot', 'And she\'s gone. Limping home to sing about it.')]),
    beat('hurt', HULL_LOW, [say('kade', 'Point! You\'re trailing plasma. Get behind me. Now.')]),
    beat('mark', SUCCESS, [
      say('kade', 'Core\'s in the ring. Two thousand kilometres of ice gravel. We\'re coming back for it.'),
      say('kade', 'Dawn Actual, Vanguard. All accounted for. We have a story for you.'),
      say('oyelaran', 'Come home first, Abbess. Stories keep. Keep the light.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'Vanguard, disengage. We\'re leaving. Nobody argues.')]),
  ],
  codexOnStart: ['fac-vanguard'],
  codex: ['ppl-kade', 'ppl-oyelaran', 'hist-attrition'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Routine escort, Zephacis border. Unscheduled contact with a Choir Vesper-class cruiser, identified from its Intonation as the Canticle of Ascent. Six Cantors destroyed. The cruiser escaped, crippled, after ejecting an armoured data core into the Zephacis II ring.\n\n' +
    'Survey Mark Z-7 was not surveyed. The Plumb Line\'s crew have asked that the squadron be thanked, and that Lieutenant Castellanos be asked to stop singing on the return leg.\n\n' +
    'A sixth mug has been taken down from the hook in the ready room and washed.\n\n' +
    'NULL COUNT: 983.',
};
