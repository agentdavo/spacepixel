/** ep04-black-light: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { LANTERN_GUARD, CANTOR, PSALTER, SCRAPJACK, say, beat, START, SUCCESS, FAILURE, HULL_LOW, at, onDone, killsOf, ahead, by, obj, piece, spawn, briefing } from '../authoring.ts';

export const EP04: CampaignMission = {
  id: 'ep04-black-light',
  chapter: 1,
  episode: 4,
  title: 'BLACK LIGHT',
  milestones: [4],
  system: 'rustwake',
  tagline: 'Every gram accounted.',
  briefing: briefing(
    'BOARD OF ALLOCATION, CONVOY DESK. TO: 0413, ESCORT.',
    'Three Rustwake tankers carrying 120 kilograms of Ember-skim Ebon-gas will cross the Belt to the Rustwake Lantern for delivery to the Tey refinery. The convoy is contracted from Clan Marsh (master: T. Marsh, hauler Magpie\'s Due). The Directorate does not trust Clan Marsh. Clan Marsh does not trust the Directorate. This is called a market.',
    'Commander Aubrac of the Office of Continuity will ride the audit corvette and count the grams in and out.',
    'Every political conflict in the Reach is a dispute over what is in those tankers. Choir raiders know the route. So, probably, does everyone.',
    'Do not shoot anything that glows black. That is the cargo.',
  ),
  objectives: [
    obj('formup', 'Form up on the Magpie\'s Due', (c) => c.distanceTo('magpie') < 800),
    obj('raid', 'Break the Choir raid on the convoy', (c) => c.kills('choir') >= 5, { failed: (c) => c.aliveCount('tankers') < 2, setsFlag: 'raid-broken' }),
    obj('torpedoes', 'Intercept the second torpedo run', (c) => c.kills('choir') >= 7, { failed: (c) => c.aliveCount('tankers') < 2 }),
    obj('lantern', 'See the convoy to the Rustwake Lantern buoy', (c) => c.flag('tankers-arrived'), { failed: (c) => c.aliveCount('tankers') < 2 }),
    obj('every-gram', 'Lose no tankers', (c) => c.flag('tankers-arrived'), { optional: true, failed: (c) => c.aliveCount('tankers') < 3 }),
  ],
  spawns: [
    spawn(SCRAPJACK, 'rustwake', 1, ahead(0, 50, 900), 'magpie', 'Magpie\'s Due', 'escort', { routeTo: 'rwbuoy' }),
    spawn(SCRAPJACK, 'rustwake', 3, ahead(250, -40, 750), 'tankers', 'Marsh Tanker', 'escort', { routeTo: 'rwbuoy' }),
    spawn(LANTERN_GUARD, 'concord', 1, ahead(-400, 80, 600), 'audit', 'FFC Audit (Continuity)', 'escort', { routeTo: 'rwbuoy' }),
    spawn(SCRAPJACK, 'rustwake', 2, ahead(-200, 100, 800), 'clan', 'Clan Marsh', 'wing'),
    spawn(CANTOR, 'choir', 3, ahead(3000, 800, 5200), 'raidC', 'Choir Raider', 'hostile', { delay: 38 }),
    spawn(PSALTER, 'choir', 2, ahead(-2800, -600, 5600), 'raidP', 'Psalter', 'hostile', { delay: 42 }),
    spawn(PSALTER, 'choir', 2, by('tankers', 2600, 900, -2200), 'raidT', 'Psalter', 'hostile', { whenFlag: 'raid-broken', delay: 6 }),
  ],
  setpieces: [
    piece('wreckage', 'belt', ahead(0, -1500, 6000), { kind: 'asteroids', radius: 7000, label: 'The Rustwake Belt' }),
    piece('beacon', 'rwbuoy', ahead(600, 0, 10500), { label: 'Rustwake Lantern approach buoy' }),
  ],
  chatter: [
    beat('open', START, [
      say('magpie', 'Well, look at this! A Directorate babysitter in a museum piece. Welcome to the Rustwake, Kestrel!'),
      say('magpie', 'Three tankers of Ember-skim, forty kilos each. Don\'t shoot anything glowing black. It\'s mine.'),
      say('ledger', 'Audit corvette. Commander Aubrac, Office of Continuity. I\'m here to count the grams. Ignore me.'),
      say('magpie', 'Everybody ignores the auditor, love. Right up until she finds something.'),
    ]),
    beat('black-light', at(22), [
      say('system', 'EBON SIGNATURE, TANKER TWO. CONTAINMENT NOMINAL.'),
      say('magpie', 'Look at her hold through your gun camera. See how the edges of things go violet? That\'s black light.'),
      say('magpie', 'That\'s money. That\'s the only light in the Reach anybody ever fought over.'),
      say('magpie', '(sung) Oh, the Ember\'s low and the gram is high, and the Board\'s got its hand in your pocket...'),
      say('ledger', 'I can hear you, Captain.'),
      say('magpie', 'That\'s the idea, love.'),
    ]),
    beat('raid', at(38), [
      say('system', 'CHOIR CARRIER. INTONATION. FIVE CONTACTS. TWO PSALTER TORPEDO BOMBERS.'),
      say('magpie', 'Hymn-singers! Clan Marsh, guns out! Kestrel, the Psalters want the tankers, not you!'),
    ], 3),
    beat('bill', killsOf('choir', 3), [say('magpie', 'Ha! Put that on the Board\'s bill!')]),
    beat('second-run', onDone('raid'), [
      say('system', 'TWO MORE. TORPEDO SOLUTION ON TANKER THREE.'),
      say('magpie', 'Tem Marsh does not lose tankers! Tem Marsh does not— Kestrel, please!'),
    ], 3),
    beat('manifest', onDone('torpedoes'), [
      say('ledger', 'Escort. Something\'s wrong with the manifest. Half this cargo is consigned onward, three shell accounts deep.'),
      say('ledger', 'The last account is the Zenith Treasury.'),
      say('magpie', 'Everybody buys from everybody, sweetheart. The war\'s just how the price gets set.'),
      say('ledger', '...That isn\'t in any audit I\'ve signed.'),
      say('magpie', 'Then you\'ve been signing the wrong audits.'),
    ], 2),
    beat('hurt', HULL_LOW, [say('magpie', 'Kestrel, you\'re leaking! I can patch that for forty grams. Thirty. Twenty for the pretty plane.')]),
    beat('home', SUCCESS, [
      say('magpie', 'Gas is home and the Lantern\'s lit. Kestrel, you ever need anything not strictly legal, you call Magpie.'),
      say('ledger', 'I didn\'t hear that.'),
      say('magpie', 'You heard everything, love. That\'s your whole job.'),
    ]),
    beat('lost', FAILURE, [say('magpie', 'My tankers. Forty years of clan savings, burning black. Go home, Directorate.')]),
  ],
  codexOnStart: ['tech-ebon'],
  codex: ['fac-rustwake', 'ppl-magpie', 'hist-relighting'],
  modifiers: { ambience: 'normal' },
  debrief:
    'Convoy delivered. 120 kg declared at the Belt; 119.6 kg received at the Lantern. The discrepancy is within tolerance and has been logged as "evaporation".\n\n' +
    'Commander Aubrac\'s audit notes that 58 kg of the cargo was pre-sold, through three intermediaries, to the Zenith Treasury. Her report has been received by the Board of Allocation and filed under "Market Conditions".\n\n' +
    'Clan Marsh has invoiced the Directorate for one tanker hull scratch, at triple rate. The invoice has been paid.',
};
