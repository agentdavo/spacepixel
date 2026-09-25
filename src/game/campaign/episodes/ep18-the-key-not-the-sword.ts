/** ep18-the-key-not-the-sword: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { HARRIER, LANTERN_GUARD, INDOMITABLE, CANTOR, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, onActive, near, killsOf, ahead, by, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP18: CampaignMission = {
  id: 'ep18-the-key-not-the-sword',
  chapter: 4,
  episode: 18,
  title: 'THE KEY, NOT THE SWORD',
  milestones: [18],
  system: 'meridian',
  tagline: 'Do not open it. Play it.',
  briefing: briefing(
    'OFFICE OF CONTINUITY — YEVGENIA AUBRAC, FOR THE LAST TIME UNDER THAT TITLE.',
    'Allocation Hour broadcasts from the Castellan relay at 1900. Every screen in the Directorate will be on. I have the Schedule: every engagement, every price floor, every signature, including mine. I am going to read it aloud.',
    'Pryce knows. He has brought the Indomitable to Meridian to take the Patience, and Treasury Cantors to help him, which should tell you everything. He means to use her as a sword: every Hegemony gate at once, before the crest.',
    'Get my launch to the relay. Hold it while I read. Then go home to the Patience. Candle says he has done something terrible and needs to tell us about it.',
    'Keep the light. I mean it now.',
  ),
  objectives: [
    obj('relay', 'Escort Ledger\'s launch to the Allocation Hour relay', (c) => c.flag('ledger-launch-arrived'), { failed: (c) => !c.alive('ledger-launch') }),
    obj('broadcast', 'Hold the relay while Ledger reads the Schedule', (c) => c.flag('relay-held'), { failed: (c) => !c.alive('ledger-launch') }),
    obj('loyalists', 'Defeat Pryce\'s loyalists and the Treasury Cantors', (c) => c.kills('concord') >= 4 && c.kills('choir') >= 4),
    obj('berth', 'Return to the Patience', (c) => c.flag('berth-held')),
    cue('pryce-taken', 'depart:pryce-flag', (c) => c.objectiveDone('loyalists')),
  ],
  spawns: [
    ...squad('kade', 'sparrow', 'salt'),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(200, -50, 700), 'ledger-launch', 'Continuity Launch', 'escort', { routeTo: 'relay' }),
    spawn(INDOMITABLE, 'concord', 1, ahead(5000, -800, 14000), 'indomitable', 'BB-01 Indomitable', 'static'),
    spawn(LANTERN_GUARD, 'concord', 1, by('indomitable', -1500, 400, -1000), 'pryce-flag', 'Allocation Flag', 'static'),
    spawn(HARRIER, 'concord', 4, ahead(3500, 900, 9000), 'alloc-guard', 'Allocation Guard', 'hostile', { whenFlag: 'ledger-launch-arrived', delay: 5 }),
    spawn(CANTOR, 'choir', 4, ahead(-3200, 1000, 9500), 'treasury', 'Treasury Cantor', 'hostile', { whenFlag: 'ledger-launch-arrived', delay: 8 }),
  ],
  setpieces: [
    piece('beacon', 'relay', ahead(0, 300, 8000), { label: 'Allocation Hour relay, Castellan ring', hold: 55, radius: 700 }),
    piece('wreckage', 'yards', ahead(-3500, -1200, 7000), { kind: 'shipyard-scaffold', radius: 3000, label: 'Castellan ring yards' }),
    piece('derelict', 'patience', ahead(-2000, -600, -6000), { name: 'The Long Patience', class: 'Clavis', state: 'lit' }),
    piece('beacon', 'berth', by('patience', 0, 400, 0), { label: 'The Patience — spine gallery', hold: 45, radius: 500 }),
  ],
  chatter: [
    beat('open', START, [
      say('ledger', 'Vanguard, Ledger. Four minutes to Allocation Hour. I\'m going to read them the Schedule. All of it.'),
      say('kade', 'Pryce will come.'),
      say('ledger', 'Pryce is already here. He brought the Indomitable. He wants the Gladius.'),
      say('candle', 'She\'s not a sword. I keep telling you. She is not a sword.'),
    ], 2),
    beat('pryce', at(20), [
      say('pryce', 'Commander Kade. The Board recognises your service and your grief. Surrender the Gladius to the Indomitable.'),
      say('pryce', 'With it we open every Hegemony gate before the crest. Hesper falls in a day. Isn\'t that what you wanted?'),
      say('kade', 'I wanted the Bastion back, Allocator.'),
      say('pryce', 'Expenditures are regrettable. Outcomes are what matter.'),
    ]),
    beat('together', onFlag('ledger-launch-arrived'), [
      say('system', 'DIRECTORATE HARRIERS. FOUR. ALLOCATION GUARD. ALSO: CHOIR CANTORS, TREASURY LIVERY.'),
      say('sparrow', 'He brought Zenith fighters. To Meridian. To our capital.'),
      say('kade', 'The Schedule doesn\'t have sides, Sparrow. It never did.'),
    ], 3),
    beat('reading', onActive('broadcast'), [
      say('ledger', 'This is Yevgenia Aubrac, Office of Continuity. I am reading from the Schedule of Engagements.', 4),
      say('ledger', 'Engagement 114, Lysowick. Expected expenditure: eleven fighters. The 13th Squadron requested by name.', 8),
      say('ledger', 'Engagement 131, Anchorage. The Bastion. Expected expenditure: four thousand, one hundred and twelve.', 8),
      say('ledger', 'Signed: Corwin Pryce. Varro Quillon.', 6),
      say('ledger', 'Audited and approved: Yevgenia Aubrac. I knew. I am sorry. I am so sorry.', 6),
    ], 4),
    beat('rook', onFlag('relay-held'), [
      say('rook', 'Indomitable to all Directorate units. I have heard the Allocation Hour.'),
      say('rook', 'Allocator-General Pryce is relieved of authority. By me. All ships: hold fire on the 13th.'),
      say('pryce', 'Captain Rook, you are making an expenditure you cannot afford.'),
      say('rook', 'Put it on my ration card, Allocator.'),
    ], 5),
    beat('running', killsOf('choir', 2), [say('sparrow', 'Treasury Cantors breaking! They\'re running for the Lantern!')]),
    beat('lever', onDone('loyalists'), [
      say('pryce', 'You think it\'s a key. It\'s a lever. Somebody will always pull it. Better us than them.'),
      say('rook', 'Take him below.'),
    ], 3),
    beat('confession', near('berth', 550), [
      say('candle', 'Abbess. Point. I did a terrible thing. I broke the Sixth Keeping. I asked her why.'),
      say('candle', 'I opened her archive to the last log. Her master\'s voice. Four hundred and thirty-one years old.'),
      say('candle', '"The key is not in the ship. The ship is the key. Do not open it; play it."'),
      say('candle', 'Twelve nodes along her spine, in the Choir\'s intervals. She\'s an instrument. She was never a sword.'),
      say('kade', 'Then what plays her?'),
      say('candle', 'The Hymn. The Choir\'s been singing her tuning for two hundred years and never knew what it was for.'),
      say('sparrow', 'More than one kind of song. The Litany and the Hymn. The machines and the music.'),
      say('kade', 'Then we need a Cantor.'),
    ], 5),
    beat('hurt', HULL_LOW, [say('salt', 'Point, you\'re smoking. Rook\'s got the heavy lifting. Fall back to me.')]),
    beat('psalm', SUCCESS, [
      say('system', 'INCOMING. CHOIR CARRIER. INTONATION. ONE SHIP. WEAPONS COLD.'),
      say('psalm', 'Vanguard. This is Isaura Sarre-Aurelian. I have come to ask my question in person.'),
      say('psalm', 'And I think, Brother Candle, I know the song.'),
    ]),
    beat('lost', FAILURE, [say('ledger', 'Relay\'s down. They heard half. Half is worse than nothing. Half is how things break.')]),
  ],
  codex: ['log-patience'],
  modifiers: { ambience: 'battle' },
  debrief:
    'The Schedule of Engagements was read in full on the Allocation Hour to eleven million people. Captain Mireya Rook of BB-01 Indomitable relieved the Allocator-General of authority. Corwin Pryce is in custody. Varro Quillon\'s launch was last seen entering the Tessaly Lantern.\n\n' +
    'Warden-Brother Oduya has confessed to breaking the Sixth Keeping. The Order has not yet ruled on his penance. The Patience is not a weapon. She is an instrument, and her tuning is the Hymn of Ascent.\n\n' +
    'Dame-Cantor Isaura Sarre-Aurelian came aboard the Patience at 2214, alone, weapons cold. She asked to see the spine.\n\n' +
    'NULL COUNT: 3.',
};
