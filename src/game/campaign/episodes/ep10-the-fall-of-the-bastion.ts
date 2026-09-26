/** ep10-the-fall-of-the-bastion: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { LANTERN_GUARD, CANTOR, PSALTER, CATHEDRAL, say, hiss, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, onActive, killsOf, ahead, by, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP10: CampaignMission = {
  id: 'ep10-the-fall-of-the-bastion',
  chapter: 2,
  episode: 10,
  title: 'THE FALL OF THE BASTION',
  milestones: [10],
  system: 'anchorage',
  tagline: 'Deck is green.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD.',
    'The Bastion is at anchor off Anchorage: Hesperus Dawn, Lodestar, Constant, and eleven escorts. The Allocator-General arrived this morning with a Board order for the Patience\'s archive. I have told him, truthfully, that the archive is aboard a derelict in a radiation belt with a warden who does not answer the radio. He has been very understanding.',
    'Fly combat air patrol over the anchorage. Routine.',
    'Abbess, if anything is not routine, you are released to act on your own judgment. I have written that down and signed it. It is in your seat pocket, with something else of mine I would like you to keep for me.',
    'Keep the light.',
  ),
  objectives: [
    obj('cap', 'Fly combat air patrol over the Bastion', (c) => c.distanceTo('bastion') < 3000),
    obj('intercept', 'Intercept the bombers — the carriers can\'t dodge', (c) => c.kills('choir') >= 5, { setsFlag: 'resume:lifeboats' }),
    obj('lifeboats', 'Cover the lifeboat corvettes to the Graveyard lane', (c) => c.flag('lifeboats-arrived'), { failed: (c) => !c.alive('lifeboats') }),
    obj('jump', 'Jump out. Rendezvous with the Long Patience', (c) => c.jumps >= 1),
    cue('lifeboats-hold', 'halt:lifeboats', () => true),
    cue('pryce-leaves', 'depart:allocation', (c) => c.time > 55),
    cue('attack', 'bastion-attack', (c) => c.time > 72 && c.objectiveDone('cap')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, by('bastion', 400, 300, 200), 'allocation', 'Allocation Launch', 'static'),
    spawn(LANTERN_GUARD, 'concord', 2, by('bastion', -300, -200, -600), 'lifeboats', 'Lifeboat Corvette', 'escort', { routeTo: 'lane', memberOffsets: [[0, 0, 0], [240, 12, -45]] }),
    spawn(CANTOR, 'choir', 6, ahead(0, 800, 11000), 'strike', 'Choir Strike', 'hostile', { whenFlag: 'bastion-attack', delay: 6 }),
    spawn(PSALTER, 'choir', 4, ahead(1800, 400, 12000), 'bombers', 'Psalter', 'hostile', { whenFlag: 'bastion-attack', delay: 12 }),
    spawn(CATHEDRAL, 'choir', 2, ahead(-4000, 2000, 16000), 'cathedrals', 'Cathedral', 'capital', { whenFlag: 'bastion-attack' }),
    spawn(CANTOR, 'choir', 4, by('lifeboats', 2500, 600, 2500), 'hunt', 'Choir Hunter', 'hostile', { whenFlag: 'resume:lifeboats', delay: 25 }),
  ],
  setpieces: [
    piece('bastion', 'bastion', ahead(0, -800, 4000), { flagship: 'Hesperus Dawn', carriers: 3, escorts: 11 }),
    piece('beacon', 'lane', ahead(-6000, -200, -8000), { label: 'Graveyard lane' }),
    piece('wreckage', 'graveyard', ahead(-9000, 0, -11000), { radius: 4000, era: 'golden-age', label: 'The Timetable Graveyard' }),
    // Evacuation aftermath only. No objectives, kills, chatter or Schedule effects.
    piece('kessen-cameo', 'kessen-evacuation', by('lane', -160, -14, 100), { whenFlag: 'bastion-destroyed', tableau: 'evacuation' }),
  ],
  chatter: [
    beat('open', START, [
      say('oyelaran', 'Vanguard, Dawn Actual. The Allocator-General has asked, very politely, for the archive.'),
      say('kade', 'And you said?'),
      say('oyelaran', 'I said I\'m an old man, and forgetful.'),
      say('jackpot', 'Captain, I love you.'),
      say('oyelaran', 'Fly your patrol, Lieutenant.'),
    ]),
    beat('pryce', at(34), [
      say('pryce', 'Captain Oyelaran, thank you for your hospitality. I\'ll return with a fuller order. Keep the light.'),
      say('oyelaran', 'Keep the light, Allocator.'),
    ]),
    beat('early', onFlag('depart:allocation'), [
      say('salt', 'His launch is leaving early. Why is his launch leaving early?'),
      say('kade', 'Vanguard, tighten up. Something\'s wrong.'),
    ], 2),
    beat('lantern', at(66), [
      say('sparrow', 'Abbess, the Lantern — it\'s opening. Nothing\'s scheduled. Nothing\'s—'),
      say('system', 'INTONATION.'),
    ], 3),
    beat('attack', onFlag('bastion-attack'), [
      say('control', 'Cathedrals through the Anchorage Lantern! Two— four— they have our codes. They have the gate codes!'),
      say('oyelaran', 'All squadrons launch. All of them. Everything with a seat.'),
      say('kade', 'Vanguard, on me! Kill the bombers first. The carriers can\'t dodge!'),
    ], 4),
    beat('pool', killsOf('choir', 3), [say('jackpot', 'Scratch three! Pool\'s suspended! Everybody\'s getting paid today!')]),
    beat('deck', onDone('intercept'), [
      say('oyelaran', 'Lodestar is gone. Constant is gone. We\'re holding the hangar doors open, Control. Keep them open.'),
      say('control', 'Lifeboat corvettes away. Vanguard, cover them to the Graveyard lane.'),
      say('control', 'Deck is green. Deck is green, Vanguard, go, go.'),
    ], 4),
    beat('fall', onFlag('bastion-destroyed'), [
      hiss('control', 'Deck is green. Deck is—'),
      hiss('oyelaran', 'Kade. The chart is in your seat pocket. Take it back to her.'),
      hiss('oyelaran', 'Tell her the lines go somewhere.'),
      hiss('oyelaran', 'All Vanguard: you are released. Go where the light is. Keep the light.'),
      say('system', 'CVS-07 HESPERUS DAWN. CARRIER LOST.'),
      say('sparrow', 'No. No, no, no—'),
      say('kade', 'Vanguard. Eyes on the lifeboats. We grieve later. That\'s an order.'),
    ], 5),
    beat('candle', onFlag('lifeboats-arrived'), [
      say('kade', 'Lifeboats are at the lane. Candle, it\'s Abbess. Is she awake?'),
      hiss('candle', 'She\'s awake, Abbess. I\'ve lit her. Come to me. Bring everyone.'),
    ], 3),
    beat('sold', onActive('jump'), [
      say('salt', 'The Board sold the Bastion. You all know that, right? Pryce sold it and walked out the door.'),
      say('kade', 'I know. Jump.'),
    ]),
    beat('hurt', HULL_LOW, [say('kade', 'Point, don\'t you dare. Not today. Not you too.')]),
    beat('count', SUCCESS, [
      say('kade', 'Vanguard, count off.'),
      say('jackpot', 'Three.'),
      say('sparrow', '...Five.'),
      say('salt', 'Six.'),
      say('kade', 'One\'s with us. Candle\'s waiting. That\'s everyone. That\'s everyone we have.'),
    ]),
    beat('lost', FAILURE, [say('kade', '...Keep the light.')]),
  ],
  codex: ['log-dawn', 'log-chart'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Bastion is lost. CVS-07 Hesperus Dawn, CVS Lodestar, CVS Constant, eleven escorts. 4,112 crew.\n\n' +
    'The Choir fleet entered Anchorage using current Directorate gate codes. The Allocator-General\'s launch departed the anchorage 17 seconds before the Lantern opened.\n\n' +
    'The Board of Allocation has declared the 13th Independent Squadron "missing, presumed expended." Two lifeboat corvettes and five fighters reached the Long Patience in the Corouhold belt. Warden Oduya had lit her galley lamps and made soup.\n\n' +
    'In the seat pocket of Vanguard 2: a signed order releasing the squadron to its own judgment, and a child\'s star-chart, drawn in crayon on the back of a ration card.\n\n' +
    'NULL COUNT: 887.',
};
