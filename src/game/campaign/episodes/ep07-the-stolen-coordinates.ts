/** ep07-the-stolen-coordinates: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { DAWN, CANTOR, SCRAPJACK, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, onActive, killsOf, ahead, by, obj, piece, squad, spawn, psalmWithdraws, briefing } from '../authoring.ts';

export const EP07: CampaignMission = {
  id: 'ep07-the-stolen-coordinates',
  chapter: 2,
  episode: 7,
  title: 'THE STOLEN COORDINATES',
  milestones: [7],
  system: 'zephacis',
  tagline: 'Forty-one waypoints.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD.',
    'The Canticle\'s core went into the Zephacis II ring two days ago. Zenith salvage is already on the way; so, Continuity believes, is anyone else who can read a transponder.',
    'The core sings when lost — Choir cores do. Follow the song into the ice. Recover it. Bring it home. Commander Aubrac is aboard the Dawn and will decrypt it over the uplink as you fly.',
    'Whatever is on that core, a Zenith cruiser would rather have thrown it into a ring than lose it to us. That makes it the most valuable thing in the Reach this week.',
    'Expect company. Expect Psalm.',
  ),
  objectives: [
    obj('search', 'Follow the core\'s song into the ring', (c) => c.distanceTo('ping') < 1000, { setsFlag: 'found' }),
    obj('recover', 'Recover the Canticle\'s data core', (c) => c.flag('canticle-core-recovered')),
    obj('measure', 'Hold off Psalm\'s Measure', (c) => c.kills('choir') >= 4 && c.flag('depart:psalm')),
    obj('dawn', 'Deliver the core to the Hesperus Dawn', (c) => c.distanceTo('dawn') < 1800),
    psalmWithdraws('psalm-withdraws', 4),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(DAWN, 'concord', 1, ahead(0, -600, -5000), 'dawn', 'CVS-07 Hesperus Dawn', 'static'),
    spawn(SCRAPJACK, 'rustwake', 3, by('ping', 900, 300, 600), 'marsh', 'Clan Marsh', 'wing', { whenFlag: 'found', delay: 3 }),
    spawn(CANTOR, 'choir', 1, ahead(3500, 1500, 12500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'canticle-core-recovered', delay: 20 }),
    spawn(CANTOR, 'choir', 4, ahead(3000, 1200, 13000), 'pmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'canticle-core-recovered', delay: 18 }),
  ],
  setpieces: [
    piece('wreckage', 'ring', ahead(0, -200, 8000), { kind: 'planetary-ring', radius: 7000, density: 'dense', label: 'Zephacis II ring' }),
    piece('beacon', 'ping', ahead(200, -150, 7200), { label: 'Core transponder (intermittent)', color: '#ff5fd0' }),
    piece('blackbox', 'canticle-core', ahead(320, -220, 8800), { label: 'Canticle of Ascent — data core' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard, we\'re in the ring. Ice, gravel, and one armoured core that somebody wants very badly.'),
      say('jackpot', 'Needle, haystack, et cetera. Pool\'s open: first to find it gets ten grams.'),
      say('salt', 'You don\'t have ten grams.'),
      say('jackpot', 'I have faith.'),
    ]),
    beat('lamb', at(20), [
      say('system', 'TRANSPONDER. INTERMITTENT. FOUR TONES, RISING. THE CORE IS SINGING.'),
      say('candle', 'Choir cores hum when they\'re lost. Like lambs.'),
    ]),
    beat('magpie', onFlag('found'), [
      say('magpie', 'Well, well. Abbess Kade and her flying museum.'),
      say('kade', 'Magpie. Who hired you?'),
      say('magpie', 'The Zenith Treasury. Very generous. Four hundred grams for that core. What are you offering?'),
      say('kade', 'Nothing.'),
      say('magpie', '...Friends\' rate! Clan Marsh, change of employer! I never liked their singing anyway.'),
      say('salt', 'That is the most Rustwake sentence I have ever heard.'),
    ], 2),
    beat('decrypt', onFlag('canticle-core-recovered'), [
      say('system', 'CORE SECURED. UPLINK TO HESPERUS DAWN. DECRYPT BEGINS.'),
      say('ledger', 'Ledger here. I\'m on the Dawn. Keep that core alive and keep talking to me.'),
      say('ledger', 'Survey log. Six years in the void past the Null. They call the route "the Stair".', 6),
      say('ledger', 'Forty-one waypoints. Null Lantern to... a Lantern. Intact. Pre-Shattering. Two hundred kilometres across.', 6),
      say('sparrow', 'Intact? A whole one? That\'s impossible.'),
      say('ledger', 'They call it the Great Ring. The Zenith\'s known about it for six years. We\'ve known for forty seconds.'),
    ], 3),
    beat('psalm', onActive('measure'), [
      say('psalm', 'Directorate. That core is the property of His Serene Altitude. Return it.'),
      say('kade', 'Come and get it, Psalm.'),
      say('psalm', 'Be witnessed, then. All of you.'),
      say('jackpot', 'She\'s singing. Why is she singing? I hate it when she sings.'),
    ], 2),
    beat('angrier', killsOf('choir', 2), [say('salt', 'Two down. The rest are angrier.')]),
    beat('withdraw', onFlag('depart:psalm'), [
      say('psalm', 'Keep it, then. You do not know what you are carrying.'),
      say('psalm', '...Neither, I think, do I.'),
      say('kade', 'That almost sounded honest.'),
    ]),
    beat('invoice', onDone('measure'), [say('magpie', 'That was fun! Invoice to follow. Friends\' rate is still a rate, Abbess.')]),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re carrying the core. You don\'t get to die carrying it.')]),
    beat('home', SUCCESS, [
      say('oyelaran', 'Core received. Well flown, Vanguard.'),
      say('oyelaran', 'Commander Aubrac has asked for a locked room and a pot of coffee. She says there\'s a second cache.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'Core\'s gone. Whatever it was, it\'s singing for them now.')]),
  ],
  codex: ['log-canticle'],
  modifiers: { ambience: 'battle' },
  debrief:
    'Canticle data core recovered from the Zephacis II ring and delivered to the Hesperus Dawn. Primary cache decrypted: a six-year Choir survey of the void beyond the Null Lantern, and a 41-waypoint route — "the Stair" — to an intact pre-Shattering Lantern two hundred kilometres across.\n\n' +
    'Five Choir Cantors destroyed. Psalm withdrew. Clan Marsh has invoiced the Directorate for "one change of heart, friends\' rate", for which there is no Allocation code.\n\n' +
    'A secondary cache remains encrypted. Commander Aubrac has not slept.\n\n' +
    'NULL COUNT: 971.',
};
