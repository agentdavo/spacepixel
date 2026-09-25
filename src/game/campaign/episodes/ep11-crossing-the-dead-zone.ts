/** ep11-crossing-the-dead-zone: authored mission data; execution belongs to CampaignRunner. */
import type { CampaignMission } from '../types.ts';
import { CANTOR, say, hiss, beat, START, FAILURE, HULL_LOW, at, onFlag, onDone, near, killsOf, ahead, by, obj, piece, squad, spawn, psalmWithdraws, briefing } from '../authoring.ts';

export const EP11: CampaignMission = {
  id: 'ep11-crossing-the-dead-zone',
  chapter: 3,
  episode: 11,
  title: 'CROSSING THE DEAD ZONE',
  milestones: [11],
  system: 'deadzone',
  tagline: 'Fly by eye.',
  briefing: briefing(
    'THE LONG PATIENCE. FLOTILLA LOG, DAY 80 AFTER THE BASTION.',
    'Twenty-two raids. Nine Ebon convoys robbed, from both sides, equally. Five fighters, two lifeboat corvettes, one Rustwake hauler and a golden-age ghost ship that can open any Lantern it likes. Wanted by the Directorate for desertion, by the Hegemony for theft, and by Clan Marsh for unpaid invoices.',
    'Last night the Patience opened the Null Lantern. It had never been opened. Beyond it lies the Caul, where instruments die and the Canticle spent six years learning to fly by hymn.',
    'We will fly it by eye. Vanguard scouts ahead along the Canticle\'s flare-buoys. The Patience follows your flares, blind, twenty kilometres behind.',
    'Trust nothing that glows green. — K.',
  ),
  objectives: [
    obj('wp1', 'Find Stair waypoint 1 (look for the pink flare)', (c) => c.distanceTo('wp1') < 400),
    obj('wp2', 'Find Stair waypoint 2 by eye', (c) => c.distanceTo('wp2') < 400, { setsFlag: 'fog-ambush' }),
    obj('fog', 'Survive the hunters in the fog', (c) => c.kills('choir') >= 3 && c.flag('depart:psalm')),
    obj('wp3', 'Find Stair waypoint 3', (c) => c.distanceTo('wp3') < 400),
    obj('exit', 'Break out of the Caul', (c) => c.flag('caul-exited')),
    psalmWithdraws('psalm-withdraws', 3),
  ],
  spawns: [
    ...squad('kade', 'jackpot', 'sparrow', 'salt'),
    spawn(CANTOR, 'choir', 1, by('wp2', 1800, 500, 1500), 'psalm', 'Psalm', 'hostile', { whenFlag: 'fog-ambush', delay: 6 }),
    spawn(CANTOR, 'choir', 3, by('wp2', -1500, -400, 1800), 'fogmeasure', 'Hesper Measure', 'hostile', { whenFlag: 'fog-ambush', delay: 4 }),
  ],
  setpieces: [
    piece('nebula', 'caul', ahead(0, 0, 12500), { radius: 11500, color: '#8a7aa0', lightning: true, visibility: 600 }),
    piece('beacon', 'wp1', ahead(-600, 200, 4000), { label: 'Stair 1', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'wp2', ahead(900, -300, 9000), { label: 'Stair 2', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'wp3', ahead(-300, 600, 15500), { label: 'Stair 3', flare: true, color: '#ff5fd0' }),
    piece('beacon', 'teybeacon', ahead(300, -100, 6500), { label: 'Rustwake beacon (Clan Tey)', color: '#ffae4f' }),
    piece('wreckage', 'tey-wreck', ahead(340, -140, 6600), { radius: 120, label: 'Clan Tey hauler' }),
  ],
  chatter: [
    beat('open', START, [
      say('kade', 'Vanguard. Eighty days since the Bastion. We\'re out of gas, out of friends, and out of Reach.'),
      say('candle', 'The Patience is behind you, twenty kilometres back, blind as a mole. Where you fly, she follows.'),
      say('system', 'SENSORS DEGRADING. SERVICE SUSPENDED.'),
      say('kade', 'Instruments off. Fly by eye. Find the pink lights.'),
    ], 2),
    beat('bruise', at(24), [
      say('jackpot', 'It\'s like flying inside a bruise.'),
      say('salt', 'Poetic.'),
      say('jackpot', 'I\'ve been hanging around Sparrow.'),
    ]),
    beat('wp1', onDone('wp1'), [
      say('sparrow', 'Waypoint one! I see the next flare. Maybe. Everything\'s grey. Everything\'s the same grey.'),
      say('kade', 'Trust your eyes over your instruments. Your eyes are older.'),
    ]),
    beat('tey', near('teybeacon', 1400), [
      say('system', 'BEACON. RUSTWAKE. CLAN TEY. RECORDING LOOP.'),
      hiss('system', '"Day forty. Can\'t see. Compass spinning. Tell Mother we found the—"'),
      say('magpie', 'Clan Tey. My grandmother\'s cousins. They went in when I was a girl.'),
      say('magpie', 'Found the what, you silly buggers? Found the what?'),
    ]),
    beat('ambush', onFlag('fog-ambush'), [
      hiss('system', 'INTONA—'),
      say('kade', 'Contact! Somewhere! Everybody call visuals!'),
      hiss('psalm', 'Directorate. You are in the Caul. So am I. We are both blind. Let us see who sings better.'),
      say('jackpot', 'Oh, come ON.'),
    ], 3),
    beat('splash', killsOf('choir', 1), [
      say('sparrow', 'Splash one, I think! I can\'t tell! Did I get it?'),
      say('salt', 'You got it. It\'s on fire. Fire\'s the one thing you can see in here.'),
    ]),
    beat('withdraw', onFlag('depart:psalm'), [
      hiss('psalm', 'Enough. The Caul will take whichever of us it prefers.'),
      hiss('psalm', 'Ascend, Directorate. If you can find which way is up.'),
    ]),
    beat('lights', onDone('wp3'), [say('candle', 'I can see your flares from the Patience. A line of lights in the dark. Oh, that\'s beautiful. Keep going.')]),
    beat('out', onFlag('caul-exited'), [
      say('system', 'SENSORS RESTORED.'),
      say('sparrow', 'Oh.'),
      say('kade', '...Everyone. Look up.'),
      say('system', 'OBJECT AHEAD. DIAMETER: 3,470 KILOMETRES.'),
    ], 4),
    beat('hurt', HULL_LOW, [say('kade', 'Point, you\'re hit and I can\'t see you. Say something. Waggle your wings. Anything.')]),
    beat('lost', FAILURE, [say('kade', 'Point? Point! ...Flares out, everyone. Light the way back. In case.')]),
  ],
  codexOnStart: ['anom-caul'],
  codex: ['hist-long-dark'],
  modifiers: { navDegraded: true, ambience: 'dread' },
  debrief:
    'The Caul crossed in six hours by the Patience\'s clock and nine by the fighters\', which no one can explain. Three Stair waypoints confirmed. Clan Tey\'s beacon recovered; Captain Marsh has asked to keep it.\n\n' +
    'Beyond the Caul, the Canticle\'s survey logs describe "the Anchor". The squadron has seen it now. The squadron has, by unanimous and unspoken agreement, stopped making jokes about the Canticle\'s crew weeping.\n\n' +
    'NULL COUNT: 409.',
};
