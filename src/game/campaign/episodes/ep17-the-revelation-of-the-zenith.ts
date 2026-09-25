/** ep17-the-revelation-of-the-zenith: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { CANTOR, CATHEDRAL, say, beat, START, SUCCESS, FAILURE, HULL_LOW, onFlag, near, killsOf, ahead, by, obj, cue, piece, spawn, briefing } from '../authoring.ts';

export const EP17: CampaignMission = {
  id: 'ep17-the-revelation-of-the-zenith',
  chapter: 4,
  episode: 17,
  title: 'THE REVELATION OF THE ZENITH',
  milestones: [17],
  system: 'hesper',
  tagline: 'A cradle is a safe place to be a child forever.',
  briefing: briefing(
    'INTERCEPT. CHOIR COMMAND BAND. HESPER DEEP. TRANSLATED FROM THE LITURGICAL.',
    'To all Measures of the Spire: a Directorate fighter has come out of the Hesper Lantern.',
    'Nothing has come out of the Hesper Lantern in four hundred and thirty-one years. His Serene Altitude has heard it hum for forty-one of those years and has said it would open only once, at the end of all things.',
    'The fighter is alone. It is damaged. It is within twelve kilometres of the Altitude.',
    'The First Cantor will intercept. The First Cantor will not destroy it until His Altitude has seen it.',
    'Be witnessed.',
  ),
  objectives: [
    obj('survive', 'Survive Psalm\'s Measure', (c) => c.kills('choir') >= 4, { setsFlag: 'altitude-speaks' }),
    obj('approach', 'Approach the Altitude', (c) => c.distanceTo('altitude') < 3000),
    obj('audience', 'Hear the Zenith', (c) => c.flag('audience-held')),
    obj('escape', 'Escape through the Hesper Lantern', (c) => c.jumps >= 1),
    cue('psalm-stands-down', 'depart:psalm', (c) => c.flag('altitude-speaks')),
  ],
  spawns: [
    spawn(CATHEDRAL, 'choir', 1, ahead(0, 1500, 12000), 'altitude', 'Cathedral Altitude', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(1500, 600, 5000), 'psalm', 'Psalm', 'hostile', { delay: 6 }),
    spawn(CANTOR, 'choir', 4, ahead(1800, 800, 5500), 'spiremeasure', 'Hesper Measure', 'hostile', { delay: 5 }),
    spawn(CANTOR, 'choir', 4, by('altitude', -2000, 500, -1500), 'treasury', 'Treasury Cantor', 'hostile', { whenFlag: 'audience-held', delay: 4 }),
  ],
  setpieces: [
    piece('beacon', 'audience', by('altitude', 0, -600, -2200), { label: 'Before the Altitude', hold: 70, radius: 600, color: '#ff3fa8' }),
    piece('wreckage', 'gardens', ahead(-6000, -2000, 9000), { kind: 'crystal-foundry', radius: 4000, label: 'Foundry-gardens of Hesper' }),
  ],
  chatter: [
    beat('open', START, [
      say('system', 'HESPER DEEP. CHOIR CAPITAL. THE LANTERN BEHIND YOU IS HUMMING.'),
      say('system', 'CATHEDRAL AHEAD. DESIGNATION: ALTITUDE. THRONE-SHIP OF THE ZENITH.'),
      say('psalm', 'You came out of the Hesper Lantern. Nothing comes out of the Hesper Lantern.'),
      say('psalm', 'Be witnessed, Directorate. And then be still.'),
    ], 3),
    beat('together', killsOf('choir', 2), [say('psalm', 'You fly as if the machine were flying you. Or as if you were flying together.')]),
    beat('enough', onFlag('altitude-speaks'), [
      say('zenith', 'Isaura. Enough.'),
      say('psalm', 'Grandfather— Your Altitude. The pilot came through the Ring.'),
      say('zenith', 'I know, child. I heard it open. Let the pilot come to me. I should like to speak to someone who has seen it.'),
    ], 4),
    beat('welcome', near('altitude', 3500), [
      say('zenith', 'Welcome, Pilot. You have seen the road lit. So did I, once, in a text I spent nine years learning to read.'),
      say('zenith', 'Come closer. I am old, and what I have to say is not a thing one shouts.'),
    ], 3),
    beat('truth', near('audience', 650), [
      say('zenith', 'The Breath comes in two days. Your Directorate thinks the Ring is a weapon. My Treasurer thinks it is a market.'),
      say('zenith', 'It is a door. And humanity is not ready to walk through it.'),
      say('zenith', 'We had the whole road once. Two thousand years. Do you know what we did with it? We scheduled it.'),
      say('zenith', 'We laid up the keys to save money. The Breath came. Forty thousand souls went into the Lanterns and never came out.'),
      say('zenith', 'So I will seal them. Every Lantern, at once, cleanly, from the Ring. No shattering. No one lost in the throats.'),
      say('zenith', 'Humanity stays where it stands. Every world an Earth. Every Earth a cradle.'),
      say('zenith', 'And a cradle is a safe place to be a child forever.'),
      say('psalm', 'Even us, Grandfather? Even the Ascended?'),
      say('zenith', 'Especially us, Isaura. I have read our hymns. We are not worthy of the stars. No one is.'),
      say('psalm', '...Then what have we been ascending toward?'),
      say('system', 'THE ZENITH HAS CLOSED THE CHANNEL.', 6),
    ], 5),
    beat('treasury', onFlag('audience-held'), [
      say('system', 'CANTORS. FOUR. TREASURY LIVERY. WEAPONS HOT.'),
      say('psalm', 'Those are not his. They are Treasury\'s. Go, Directorate. The Lantern will take you. I am coming back to hold them.'),
      say('psalm', 'Tell your Abbess the Choir has a question it cannot answer. Tell her I am asking it.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('system', 'HULL CRITICAL. I HAVE LOST SIXTY-SEVEN PILOTS, POINT. I WOULD PREFER NOT TO LOSE SIXTY-EIGHT.')]),
    beat('home', SUCCESS, [
      say('kade', 'POINT! Point, you— twenty-four days, you— where have you been?'),
      say('kade', '...Never mind. Never mind. You came back. That was the whole order.'),
    ]),
    beat('lost', FAILURE, [say('psalm', 'You are witnessed, Directorate. I am sorry. I think you had something to tell us.')]),
  ],
  codex: ['ppl-zenith'],
  modifiers: { noWingmen: true, ambience: 'dread' },
  debrief:
    'Vanguard 1 rejoined the flotilla after an audience with Ottavian Sarre-Aurelian, the Nineteenth Zenith, aboard the throne-ship Altitude at Hesper Deep.\n\n' +
    'The Zenith\'s intention: to use the Nexus at the crest of the Breath to seal every Lantern in the galaxy permanently, leaving humanity alive, safe, and alone on whatever world it stands on.\n\n' +
    'The Directorate\'s intention, according to a Board order intercepted this morning: to take the Long Patience — "the Gladius" — and use it to open every Hegemony Lantern at once before the crest.\n\n' +
    'Two days. Two plans. Neither of them is tuning.\n\n' +
    'NULL COUNT: 5.',
};
