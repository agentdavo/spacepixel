/** ep15-the-siege-of-the-nexus: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { HARRIER, LANTERN_GUARD, CANTOR, PSALTER, VESPER, CATHEDRAL, SCRAPJACK, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, near, ahead, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP15: CampaignMission = {
  id: 'ep15-the-siege-of-the-nexus',
  chapter: 3,
  episode: 15,
  title: 'THE SIEGE OF THE NEXUS',
  milestones: [15],
  system: 'nexus',
  tagline: 'Hold the Ring.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 139.',
    'The Nexus: a Lantern two hundred kilometres across, whole, unlit, holding the map of every road in the galaxy in the light along its rim. Whoever holds it can open every gate at once, or close every gate forever.',
    'The Zenith\'s armada is coming to do the second. Two Cathedrals, their Vesper spire-tenders, and more Cantors than we have rounds. The tenders carry the keys the Cathedrals need to sing the Ring shut. Kill the tenders and the Cathedrals are just very large churches.',
    'We have four Kestrels, Clan Marsh, two lifeboat corvettes, and a ghost ship with enough gas to open one door once.',
    'Hold the Ring. — K.',
  ),
  objectives: [
    obj('ring', 'Reach the Nexus', (c) => c.flag('nexus-reached')),
    obj('wave1', 'Break the first Psalter wave', (c) => c.kills('choir') >= 6, { setsFlag: 'wave1-broken' }),
    obj('tenders', 'Destroy the Vesper spire-tenders and their escorts', (c) => c.kills('choir') >= 16),
    obj('hold', 'Return to the throat of the Ring', (c) => c.distanceTo('nexus') < 2500),
    cue('salt-returns', 'salt-returns', (c) => c.kills('choir') >= 9),
    cue('jackpot-falls', 'destroy:jackpot', (c) => c.flag('salt-returns') && c.kills('choir') >= 11),
    cue('cathedrals-turn', 'depart:cathedrals', (c) => c.objectiveDone('tenders')),
    cue('psalm-turns', 'depart:psalm', (c) => c.objectiveDone('tenders') || (c.alive('psalm') && c.hull('psalm') < 0.4)),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow'),
    spawn(SCRAPJACK, 'rustwake', 1, ahead(-220, 40, -200), 'magpie', 'Magpie\'s Due', 'wing'),
    spawn(SCRAPJACK, 'rustwake', 3, ahead(-300, -40, -300), 'clan', 'Clan Marsh', 'wing'),
    spawn(LANTERN_GUARD, 'concord', 2, ahead(0, -400, -2500), 'flotilla', 'Lifeboat Corvette', 'static'),
    spawn(PSALTER, 'choir', 4, ahead(2500, 1000, 26000), 'wave1P', 'Psalter', 'hostile', { whenFlag: 'nexus-reached', delay: 12 }),
    spawn(CANTOR, 'choir', 2, ahead(2000, 800, 25500), 'wave1C', 'Cantor', 'hostile', { whenFlag: 'nexus-reached', delay: 10 }),
    spawn(CATHEDRAL, 'choir', 2, ahead(-8000, 3000, 38000), 'cathedrals', 'Cathedral', 'capital', { whenFlag: 'nexus-reached', delay: 30 }),
    spawn(VESPER, 'choir', 3, ahead(-3000, 1500, 30000), 'tenders', 'Vesper Spire-Tender', 'capital', { whenFlag: 'wave1-broken', delay: 5 }),
    spawn(CANTOR, 'choir', 3, ahead(-2500, 1200, 29000), 'tenderescort', 'Cantor', 'hostile', { whenFlag: 'wave1-broken', delay: 5 }),
    spawn(CANTOR, 'choir', 1, ahead(-2000, 1800, 29500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'wave1-broken', delay: 8 }),
    spawn(HARRIER, 'concord', 1, ahead(0, 200, 8000), 'salt', 'Vanguard 6 · Salt', 'wing', { whenFlag: 'salt-returns' }),
    spawn(SCRAPJACK, 'rustwake', 6, ahead(300, 300, 8200), 'freehaulers', 'Rustwake Free Haulers', 'wing', { whenFlag: 'salt-returns', delay: 2 }),
    spawn(CANTOR, 'choir', 4, ahead(4000, 2000, 30000), 'wave3', 'Cantor', 'hostile', { whenFlag: 'salt-returns', delay: 4 }),
  ],
  setpieces: [
    piece('megagate', 'nexus', ahead(0, 0, 24000), { radius: 20000, state: 'unlit', rimArchive: true, label: 'The Nexus' }),
    piece('derelict', 'patience', ahead(0, -600, -1500), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard. This is it. The Zenith are coming to close it forever.'),
      say('candle', 'The Patience is in position. The spine has gas for one opening. One. Choose your moment, Abbess.'),
      say('magpie', 'Clan Marsh and three friends. It\'s all the clans would spare. The rest are hiding under their bunks.'),
      say('jackpot', 'Very sensible people, the rest.'),
    ]),
    beat('whole', near('nexus', 15000), [
      say('system', 'OBJECT. LANTERN. DIAMETER: 40 KILOMETRES. STATUS: WHOLE.'),
      say('sparrow', 'It\'s whole. It\'s the only whole thing I\'ve ever seen.'),
    ], 2),
    beat('rim', at(55), [
      say('jackpot', 'Boss. What you said about the rim. "Less of it."'),
      say('kade', 'What about it?'),
      say('jackpot', 'Nothing. Just— I think you might\'ve been wrong. Don\'t tell anyone I said so.'),
    ]),
    beat('armada', onFlag('nexus-reached'), [
      say('system', 'INTONATION. MANY. MANY.'),
      say('kade', 'Here they come. Kill the Psalters before they reach the flotilla!'),
    ], 3),
    beat('tenders', onDone('wave1'), [
      say('system', 'CATHEDRALS: TWO. VESPER TENDERS DEPLOYING.'),
      say('candle', 'The Vespers carry the spire keys. Without them the Cathedrals can\'t sing the seal.'),
      say('psalm', 'Vanguard. His Altitude asks you to stand aside. He says this is a mercy. He says you will understand.'),
      say('kade', 'Tell him we\'ll understand from right here.'),
    ], 3),
    beat('salt', onFlag('salt-returns'), [
      say('system', 'RUSTWAKE TRANSPONDERS, ASTERN. SEVEN. VANGUARD SIX AMONG THEM.'),
      say('salt', 'Vanguard, Salt. Heard there was a party. Brought some friends. And the forty grams.'),
      say('jackpot', 'SALT! You beautiful, miserable— the pool is REOPENED!'),
      say('magpie', 'Took you long enough.'),
      say('salt', 'Hello, Tem.'),
    ], 4),
    beat('jackpot', onFlag('destroy:jackpot'), [
      say('jackpot', 'Salt, Cathedral lance on your six— I\'ve got it. I\'ve got it—'),
      say('jackpot', 'Tell the pool it all goes to Sparrow. She\'s the only one who never cheated.'),
      say('system', 'VANGUARD 3. SIGNAL LOST.'),
      say('salt', 'Teo? ...TEO!'),
      say('sparrow', 'No— he was just— he was just talking—'),
      say('kade', 'Keep flying. Vanguard, keep flying. He\'d want the pool paid out. We fly.'),
    ], 5),
    beat('turn', onDone('tenders'), [
      say('system', 'VESPER TENDERS DESTROYED. CATHEDRALS TURNING.'),
      say('psalm', 'His Altitude recalls the Choir to Hesper. The Ring is yours. For now.'),
      say('psalm', 'I heard your wingman, before he fell. He was laughing.'),
      say('psalm', 'You are witnessed. All of you. Him most of all.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re coming apart. Get behind the Patience and let Candle look at you.')]),
    beat('open-ring', SUCCESS, [
      say('oracle', 'THE ROAD IS HALF-TUNED.'),
      say('oracle', 'A KEY IS PRESENT. ONE MAY ENTER.'),
      say('candle', 'Abbess. The Ring\'s opening a corridor. Not a jump. A corridor. It wants one pilot.'),
      say('kade', '...Point. Your core\'s the dictionary. It wants you.'),
    ]),
    beat('lost', FAILURE, [say('kade', 'The Ring\'s lost. Everyone back to the Patience. Everyone who\'s left.')]),
  ],
  codex: ['anom-nexus'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Siege of the Nexus. Two Cathedrals turned back; three Vesper spire-tenders and thirteen Choir fighters destroyed. The Ring holds.\n\n' +
    'Lieutenant Teodor Castellanos, Vanguard 3, killed in action covering Lieutenant Achterberg\'s return. His mug stays on the hook. The kill pool, per his last instruction, has been paid in full to Ensign Talbot, who has refused it, and then, at Commander Kade\'s order, accepted it.\n\n' +
    'The Nexus has opened a corridor. It is asking for one pilot.\n\n' +
    'NULL COUNT: 97.',
};
