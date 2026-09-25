/** ep03-two-heavens: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignContext, CampaignMission } from '../types.ts';
import { DAWN, CANTOR, CATHEDRAL, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onFlag, onDone, onActive, near, killsOf, ahead, obj, cue, piece, spawn, briefing } from '../authoring.ts';

type Pred = (c: CampaignContext) => boolean;
const brokeObservance: Pred = (c) => !c.flag('breach') && (c.hull('psalm') < 0.9 || c.hull('measure') < 0.9);

export const EP03: CampaignMission = {
  id: 'ep03-two-heavens',
  chapter: 1,
  episode: 3,
  title: 'TWO HEAVENS',
  milestones: [3],
  system: 'tessaly',
  tagline: 'Be witnessed.',
  briefing: briefing(
    'CVS-07 HESPERUS DAWN, TREATY LINE, TESSALY APPROACHES. TO: 0413.',
    'Once a week, by the Observance of 403, one Directorate fighter and one Choir Measure fly the Treaty Line together with weapons cold, so that both sides remember where it is. You are this week\'s Measure.',
    'Fly the three markers. Match the Choir\'s pace. Do not fire. Do not answer their singing. They will sing.',
    'Across the Line: the Zenith Hegemony, which believes humanity fell from the stars for its sins and must climb back one pure generation at a time. On this side: the Directorate, which believes in grams. Allocation will want a count of every round you fire today. The correct count is zero.',
    'Be polite. Keep the light. — Oyelaran, Captain.',
  ),
  objectives: [
    obj('obs1', 'Fly the Measure: Observance marker 1', (c) => c.distanceTo('obs1') < 250, { failed: brokeObservance }),
    obj('obs2', 'Fly the Measure: Observance marker 2', (c) => c.distanceTo('obs2') < 250, { failed: brokeObservance }),
    obj('obs3', 'Fly the Measure: Observance marker 3', (c) => c.distanceTo('obs3') < 250, { failed: brokeObservance, setsFlag: 'breach' }),
    obj('zealots', 'Destroy the Cantors who broke the Observance', (c) => c.kills('choir') >= 4, { failed: (c) => c.hull('psalm') < 0.5 }),
    obj('return', 'Return to the Hesperus Dawn', (c) => c.distanceTo('dawn') < 1800),
    obj('cold', 'Keep your guns cold during the Observance', (c) => c.flag('breach'), { optional: true, failed: (c) => !c.flag('breach') && c.kills('choir') > 0 }),
    cue('novice-sent-home', 'depart:novice', (c) => c.flag('breach') && c.alive('zealots')),
  ],
  spawns: [
    spawn(DAWN, 'concord', 1, ahead(-3200, -700, -2800), 'dawn', 'CVS-07 Hesperus Dawn', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(420, 0, 400), 'psalm', 'Psalm', 'static'),
    spawn(CANTOR, 'choir', 2, ahead(520, 30, 360), 'measure', 'Hesper Measure', 'static'),
    spawn(CANTOR, 'choir', 1, ahead(640, -30, 320), 'novice', 'Cantor Aurel-Ninth', 'static'),
    spawn(CATHEDRAL, 'choir', 1, ahead(2000, 2500, 30000), 'magnificat', 'Cathedral Magnificat', 'static'),
    spawn(CANTOR, 'choir', 4, ahead(3200, 900, 8000), 'zealots', 'Tessaly Zealot', 'hostile', { whenFlag: 'breach', delay: 14 }),
  ],
  setpieces: [
    piece('beacon', 'obs1', ahead(0, 0, 3000), { label: 'Observance marker I', color: '#ffe28a' }),
    piece('beacon', 'obs2', ahead(900, 200, 5200), { label: 'Observance marker II', color: '#ffe28a' }),
    piece('beacon', 'obs3', ahead(-500, -200, 7400), { label: 'Observance marker III', color: '#ffe28a' }),
    piece('beacon', 'line', ahead(0, 0, 9000), { label: 'THE TREATY LINE', style: 'marker-chain' }),
    piece('wreckage', 'campaigns', ahead(-5000, -1200, 11000), { radius: 3000, label: 'Tessaly Campaigns debris, 395-402 AS' }),
  ],
  chatter: [
    beat('open', START, [
      say('oyelaran', 'Four-One-Three, Dawn Actual. You\'re our Measure today. Guns cold, eyes open, and be polite.'),
      say('oyelaran', 'Both sides fly the Line together once a week, so nobody forgets where it is. We\'ve done it for twenty-eight years.'),
      say('control', 'Dawn Control. The Observance begins on the Intonation. You\'ll know it when you hear it.'),
    ]),
    beat('intonation', at(10), [
      say('system', 'CHOIR CARRIER. INTONATION DETECTED. FOUR TONES, RISING.'),
      say('psalm', 'Directorate Measure. I am Psalm, First Cantor of Hesper. You are witnessed.'),
      say('psalm', 'Fly true. The Altitude observes. So do I.'),
    ], 2),
    beat('pattern', onDone('obs1'), [
      say('psalm', 'You fly an old pattern, Directorate. Older than your Directorate. Do you know what it remembers?'),
      say('system', 'SERVICE RESUMES SHORTLY.'),
      say('psalm', '...Curious.'),
    ]),
    beat('hymn', onDone('obs2'), [
      say('oyelaran', 'Listen to their open band. They sing the whole Line. Always have.'),
      say('psalm', '(sung) Out of the dust we were lifted. Out of the dark we were shown.'),
      say('psalm', '(sung) What is lifted must be worthy. What is worthy climbs alone.'),
    ]),
    beat('breach', onFlag('breach'), [
      say('system', 'WEAPONS FIRE. CHOIR CANTOR AUREL-NINTH. HE IS FIRING ON YOU.'),
      say('psalm', 'Ninth. You have broken the Observance.'),
      say('system', 'CHOIR FIRE. AUREL-NINTH\'S WEAPONS POD DESTROYED. SHE SHOT HER OWN WINGMAN.'),
      say('psalm', 'Your weapons are forfeit. Go home unwitnessed.'),
      say('psalm', 'Directorate. The Hegemony does not break the Observance. He will be corrected. You have my apology.'),
    ], 3),
    beat('zealots', onActive('zealots'), [
      say('control', 'Dawn Control! Four more Cantors off the Tessaly picket, weapons hot. They\'re taking the breach as licence!'),
      say('oyelaran', 'Weapons free on the four. Only the four. Do not touch her Measure.'),
      say('psalm', 'They are not mine. Do as you must. I will witness it.'),
    ], 2),
    beat('remember', killsOf('choir', 2), [say('psalm', 'Well flown. I will remember your pattern.')]),
    beat('holds', onDone('zealots'), [
      say('psalm', 'It is finished. The Line holds. Ascend, Directorate.'),
      say('oyelaran', 'Come home, Four-One-Three. Keep the light.'),
    ]),
    beat('deck', near('dawn', 3000), [say('control', 'Green deck, Four-One-Three. The captain wants to buy you a coffee. It\'s terrible coffee.')]),
    beat('hurt', HULL_LOW, [say('oyelaran', 'Disengage if you have to. No line on a chart is worth your seat.')]),
    beat('forms', SUCCESS, [
      say('control', 'Allocation\'s already pinged us. "Unscheduled expenditure, 1.4 grams." They want a form.'),
      say('oyelaran', 'Unscheduled. As if the rest of it were on a timetable.'),
    ]),
    beat('broken', FAILURE, [say('oyelaran', 'We fired on the Measure. Twenty-eight years of Observance. Oh, Four-One-Three.')]),
  ],
  codexOnStart: ['fac-zenith'],
  codex: ['fac-choir', 'ppl-psalm', 'fac-allocation'],
  modifiers: { ambience: 'normal' },
  debrief:
    'The Observance of Week 1,461 is complete. The Treaty Line holds.\n\n' +
    'Four Choir Cantors destroyed after an unprovoked breach. The Hegemony has formally apologised through the Line — the first apology in the Observance\'s history — and reports that Cantor Aurel-Ninth has been "corrected". Continuity does not know what this means and does not want to.\n\n' +
    'Allocation has approved your expenditure of 1.4 grams as "regrettable but within forecast." Captain Oyelaran has asked whose forecast. No answer has been received.',
};
