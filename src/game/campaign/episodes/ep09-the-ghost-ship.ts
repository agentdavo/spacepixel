/** ep09-the-ghost-ship: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { CANTOR, PSALTER, say, beat, START, SUCCESS, FAILURE, HULL_LOW, onFlag, onDone, onActive, near, killsOf, ahead, obj, cue, piece, squad, spawn, briefing } from '../authoring.ts';

export const EP09: CampaignMission = {
  id: 'ep09-the-ghost-ship',
  chapter: 2,
  episode: 9,
  title: 'THE GHOST SHIP',
  milestones: [9],
  system: 'corouhold',
  tagline: 'Status: delayed.',
  briefing: briefing(
    'HESPERUS DAWN ACTUAL TO VANGUARD. THIS FLIGHT IS NOT LOGGED.',
    'The Allocator-General has frozen the Canticle core "pending Board review". I am reviewing it faster.',
    'Waypoint one of the Stair crosses the Corouhold gas giant\'s radiation belts. The Canticle flagged a golden-age mass drifting inside them and marked it, in the Choir\'s own hand, AVOID.',
    'Canopy shielding gives you ten minutes in the belt. Scan the mass. If it has an archive, bring it out. If the Choir followed their own map here, and they will have, do not let them have it.',
    'I am an old man, and forgetful, and I will not remember sending you. Keep the light.',
  ),
  objectives: [
    obj('belt', 'Enter the Corouhold radiation belt', (c) => c.distanceTo('patience') < 6000),
    obj('scan', 'Scan the derelict (hold within 300 m)', (c) => c.flag('patience-scanned')),
    obj('archive', 'Recover the archive core from the derelict\'s spine', (c) => c.flag('archive-core-recovered')),
    obj('hunters', 'Drive off the Choir hunters', (c) => c.kills('choir') >= 5),
    obj('exit', 'Clear the belt before your dose limit', (c) => c.distanceTo('patience') > 7000),
    cue('candle-stays', 'depart:candle', (c) => c.objectiveDone('hunters')),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'candle', 'sparrow', 'salt'),
    spawn(CANTOR, 'choir', 3, ahead(3000, 1200, 12000), 'hunters', 'Choir Hunter', 'hostile', { whenFlag: 'patience-scanned', delay: 20 }),
    spawn(PSALTER, 'choir', 2, ahead(-2600, 800, 12500), 'hunterP', 'Psalter', 'hostile', { whenFlag: 'patience-scanned', delay: 26 }),
  ],
  setpieces: [
    piece('wreckage', 'belt', ahead(0, 0, 7000), { kind: 'radiation-belt', radius: 9000, tint: '#9fffb0', label: 'Corouhold radiation belt' }),
    piece('derelict', 'patience', ahead(0, -300, 7000), { name: 'The Long Patience', class: 'Clavis', length: 1100, state: 'dark', radiation: true }),
    piece('blackbox', 'archive-core', ahead(0, -120, 7450), { label: 'Archive core (spine node 1)' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Waypoint one of the Stair. The Choir marked it "avoid". So naturally.'),
      say('jackpot', 'When the Zenith say avoid, I say: pool\'s open.'),
      say('system', 'RADIATION. CANOPY DOSE LIMIT: TEN MINUTES.'),
      say('salt', 'Ten minutes. Plenty of time to find out what the Choir\'s scared of.'),
    ]),
    beat('sight', near('patience', 4500), [
      say('sparrow', 'Oh. Oh, look at her.'),
      say('candle', 'Golden age. Pre-Shattering. Whole. Oh, you beauty. You poor, patient beauty.'),
      say('system', 'HULL NAME, TIMETABLE REGISTRY: THE LONG PATIENCE. CLASS: CLAVIS. STATUS: DELAYED.'),
    ], 2),
    beat('hold', onActive('scan'), [say('kade', 'Point, hold within three hundred metres. Let your core talk to hers. They\'re the same vintage.')]),
    beat('awake', onDone('scan'), [
      say('system', 'SCAN COMPLETE. CREW: FORTY. LIFE SIGNS: NONE. ARCHIVE: AWAKE.'),
      say('candle', 'Awake? After four hundred years?'),
      say('system', 'THE ARCHIVE REPORTS THAT IT HAS BEEN WAITING TO BE ASKED.'),
    ], 3),
    beat('hunters', onFlag('patience-scanned'), [
      say('system', 'INTONATION. FIVE CONTACTS, INBOUND.', 20),
      say('salt', 'They followed the Stair. Of course they did. It\'s their map.'),
    ], 2),
    beat('witty', killsOf('choir', 3), [
      say('jackpot', 'Hunters hunted! Ha! Radiation\'s making me witty.'),
      say('kade', 'Radiation\'s making you something.'),
    ]),
    beat('blueprints', onDone('archive'), [
      say('ledger', 'Archive uplink received. There are blueprints in here. For her. For her whole class.'),
      say('ledger', 'A Clavis can open any Lantern regardless of lock state. Any Lantern, Abbess.'),
      say('salt', 'That\'s not a ship. That\'s a skeleton key to every door in the Reach.'),
      say('kade', 'Which is why nobody\'s going to be allowed to have it.'),
    ], 3),
    beat('stay', onDone('hunters'), [
      say('candle', 'Abbess. I\'m staying with her.'),
      say('kade', 'Candle, the dose—'),
      say('candle', 'Her shielding\'s better than our canopies. She has wardens\' quarters. Nobody\'s kept her in four hundred years.'),
      say('kade', '...Keep her, then. We\'ll come back for you.'),
      say('candle', 'I know you will.'),
    ], 3),
    beat('hurt', HULL_LOW, [say('kade', 'Point, radiation plus a hull breach is a bad sum. Pull back to me.')]),
    beat('out', SUCCESS, [say('kade', 'Vanguard, we\'re clear. Four of us going home. One staying with a ghost. God help me, I think that\'s right.')]),
    beat('dose', FAILURE, [
      say('system', 'DOSE LIMIT EXCEEDED.'),
      say('kade', 'Everyone out. She\'s waited four hundred years; she can wait for us.'),
    ]),
  ],
  codex: ['tech-clavis'],
  modifiers: { timeLimit: 600, ambience: 'dread' },
  debrief:
    'Derelict identified: The Long Patience, golden-age Clavis-class gate tender, crew of forty, lost in the Shattering. Archive core recovered; it contains complete self-documentation of the Clavis class, which the Board of Allocation has already, somehow, heard about and designated the GLADIUS PROGRAM.\n\n' +
    'Warden-Brother Oduya remains aboard the Patience, attempting to wake her engines by the Keepings. He reports that her corridors are clean, her lamps are lit, and her galley clock is stopped at eleven hours before the Shattering.\n\n' +
    'NULL COUNT: 911.',
};
