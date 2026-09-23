import type { Character } from './types';

/**
 * The cast of PROJECT VANGUARD (see docs/LORE.md → "The Cast").
 *
 * Portrait palettes follow 90s OVA model-sheet logic: one signature hair
 * colour per character that reads at thumbnail size, eyes that echo their
 * faction accent, and flight suits in faction livery. Comms tints: Directorate
 * greens and blues, Zenith magentas, Rustwake amber, the flight computer in
 * cathode cyan and the Oracle in a white that is almost not a colour.
 */
export const CAST: Character[] = [
  // ── Vanguard: MCDF 13th Independent Squadron ──────────────────────────
  {
    id: 'vanguard1',
    callsign: 'VANGUARD 1',
    name: 'The Point',
    role: 'Point pilot, 13th Independent Squadron (the player)',
    faction: 'concord',
    voice: 'Silent. Others finish their sentences. Known for flying airframe 0413 as if it were not six hundred years old.',
    portrait: { skin: '#e8c4a0', hair: '#26283a', eyes: '#3a5a8a', suit: '#eceae4', hairStyle: 'short', accessory: 'visor', seed: 413 },
    commsColor: '#7dffb2',
  },
  {
    id: 'kade',
    callsign: 'ABBESS',
    name: 'Lt. Cmdr. Saoirse Kade',
    role: 'Squadron commander, Vanguard 2',
    faction: 'concord',
    voice: 'Nineteen years in the cockpit. Dry as a checklist, kind only in actions. Raised by engine-wardens; swears like one.',
    portrait: { skin: '#f0d2b8', hair: '#c8ccd8', eyes: '#4fb0a0', suit: '#2b4ea8', hairStyle: 'swept', accessory: 'scar', seed: 2 },
    commsColor: '#7dffb2',
  },
  {
    id: 'jackpot',
    callsign: 'JACKPOT',
    name: 'Lt. Teodor Castellanos',
    role: 'Wingman, Vanguard 3',
    faction: 'concord',
    voice: 'Runs the kill pool and the jokes. Collects golden-age junk. Talks fastest when he is most afraid.',
    portrait: { skin: '#c98e5e', hair: '#e0562a', eyes: '#f2b13a', suit: '#eceae4', hairStyle: 'spiky', accessory: 'headset', seed: 3 },
    commsColor: '#9dff8a',
  },
  {
    id: 'candle',
    callsign: 'CANDLE',
    name: 'Warden-Brother Ilesanmi Oduya',
    role: 'Engine-warden of the Order of the Keeping; strike pilot, Vanguard 4',
    faction: 'concord',
    voice: 'Big, gentle, unhurried. Counts the Seven Keepings under his breath. Blesses engines, not people, and means it as a compliment.',
    portrait: { skin: '#6b4228', hair: '#141414', eyes: '#e8a23a', suit: '#7a5a3a', hairStyle: 'shaved', accessory: 'headset', seed: 4 },
    commsColor: '#e8d27a',
  },
  {
    id: 'sparrow',
    callsign: 'SPARROW',
    name: 'Ensign Wren Talbot',
    role: 'Wingman, Vanguard 5',
    faction: 'concord',
    voice: 'Nineteen. Believes every word of the recruiting poster, until she does not. Quotes golden-age poets at bad moments.',
    portrait: { skin: '#f6dcc6', hair: '#d8a040', eyes: '#5ad0ff', suit: '#eceae4', hairStyle: 'ponytail', accessory: 'none', seed: 5 },
    commsColor: '#8affd8',
  },
  {
    id: 'salt',
    callsign: 'SALT',
    name: 'Lt. Soren Achterberg',
    role: 'Strike pilot, Vanguard 6; former Ebon-gas convoy escort',
    faction: 'concord',
    voice: 'Knows what a gram costs and who paid it. Cynical in the way of people who used to hope. Never says goodbye.',
    portrait: { skin: '#d9b08c', hair: '#4a4f5a', eyes: '#8a9a8a', suit: '#5d6b3f', hairStyle: 'long', accessory: 'glasses', seed: 6 },
    commsColor: '#b8e07a',
  },

  // ── The Bastion: carrier command ──────────────────────────────────────
  {
    id: 'oyelaran',
    callsign: 'DAWN ACTUAL',
    name: 'Captain Augustin Oyelaran',
    role: 'Commanding officer, CVS-07 Hesperus Dawn',
    faction: 'concord',
    voice: 'Grandfatherly, formal, tired. Signs off every order with "Keep the light." Keeps a child\'s crayon star-chart taped to the CAG board.',
    portrait: { skin: '#5a3a26', hair: '#e8e8e8', eyes: '#6a4a2a', suit: '#1f2f5a', hairStyle: 'short', accessory: 'glasses', seed: 7 },
    commsColor: '#56c8ff',
  },
  {
    id: 'control',
    callsign: 'DAWN CONTROL',
    name: 'Lt. (jg) Hana Okafor',
    role: 'Flight deck controller, CVS-07 Hesperus Dawn',
    faction: 'concord',
    voice: 'Brisk, precise, secretly sentimental. Calls every landing "green deck" even when it is not.',
    portrait: { skin: '#e6c09a', hair: '#1f2a44', eyes: '#3a8a6a', suit: '#2b4ea8', hairStyle: 'bob', accessory: 'headset', seed: 8 },
    commsColor: '#56c8ff',
  },
  {
    id: 'rook',
    callsign: 'INDOMITABLE',
    name: 'Captain Mireya Rook',
    role: 'Commanding officer, BB-01 Indomitable, last Directorate dreadnought in the Reach',
    faction: 'concord',
    voice: 'Iron and patience. Obeys every order to the letter, which is how she finds the one she will not obey.',
    portrait: { skin: '#caa07e', hair: '#7a2a2a', eyes: '#c8a060', suit: '#1f2f5a', hairStyle: 'swept', accessory: 'none', seed: 9 },
    commsColor: '#56c8ff',
  },

  // ── The Directorate apparatus ─────────────────────────────────────────
  {
    id: 'ledger',
    callsign: 'LEDGER',
    name: 'Commander Yevgenia Aubrac',
    role: 'Auditor, Directorate Office of Continuity (intelligence)',
    faction: 'concord',
    voice: 'Speaks in figures because figures do not flinch. The only person who read the whole Schedule, and the last to forgive herself for it.',
    portrait: { skin: '#f2d8c0', hair: '#1a1a24', eyes: '#9a7ad0', suit: '#3a3a44', hairStyle: 'bob', accessory: 'glasses', seed: 10 },
    commsColor: '#ffe28a',
  },
  {
    id: 'pryce',
    callsign: 'ALLOCATION',
    name: 'Allocator-General Corwin Pryce',
    role: 'Chair of the Directorate Board of Allocation',
    faction: 'concord',
    voice: 'Reasonable. Always reasonable. Describes deaths as line items and believes he is the adult in the room.',
    portrait: { skin: '#e8c8b0', hair: '#9a9aa2', eyes: '#6a7a8a', suit: '#2a2d3a', hairStyle: 'swept', accessory: 'none', seed: 11 },
    commsColor: '#a8c8ff',
  },

  // ── Rustwake ──────────────────────────────────────────────────────────
  {
    id: 'magpie',
    callsign: 'MAGPIE',
    name: 'Temperance "Tem" Marsh',
    role: 'Rustwake hauler captain and Ebon-gas smuggler, the Magpie\'s Due',
    faction: 'rustwake',
    voice: 'Loud, generous, mercenary, sings haul-songs off-key. Prices everything in grams, including loyalty, and undercharges friends.',
    portrait: { skin: '#b87a4a', hair: '#f2efe6', eyes: '#9fffb0', suit: '#b0643a', hairStyle: 'spiky', accessory: 'eyepatch', seed: 12 },
    commsColor: '#ffae4f',
  },

  // ── The Zenith Hegemony ───────────────────────────────────────────────
  {
    id: 'psalm',
    callsign: 'PSALM',
    name: 'Dame-Cantor Isaura Sarre-Aurelian',
    role: 'Choir ace, First Cantor of the Hesper Measure; granddaughter of the Zenith',
    faction: 'choir',
    voice: 'Formal, luminous, lethal. Speaks in liturgy and means every word. Honour is the only thing she has never been told to question.',
    portrait: { skin: '#f8e8ec', hair: '#e8e0ff', eyes: '#ff3fa8', suit: '#1d1729', hairStyle: 'long', accessory: 'none', seed: 13 },
    commsColor: '#ff5fd0',
  },
  {
    id: 'zenith',
    callsign: 'THE ZENITH',
    name: 'Ottavian Sarre-Aurelian, Nineteenth Zenith, His Serene Altitude',
    role: 'Supreme commander of the Zenith Hegemony',
    faction: 'choir',
    voice: 'An old scholar-king who has read the end of the world for forty years. Tender, exhausted, absolutely certain. Never raises his voice.',
    portrait: { skin: '#f0e0e0', hair: '#b8a8d8', eyes: '#c080ff', suit: '#f2eefa', hairStyle: 'swept', accessory: 'none', seed: 19 },
    commsColor: '#ff3fa8',
  },
  {
    id: 'quillon',
    callsign: 'TREASURY',
    name: 'Hierarch-Treasurer Varro Quillon',
    role: 'Keeper of the Zenith\'s Ebon-gas treasury; Pryce\'s counterpart in the Schedule',
    faction: 'choir',
    voice: 'Silk over arithmetic. Prays beautifully and counts while he does it.',
    portrait: { skin: '#e6d0c8', hair: '#3a2a4a', eyes: '#d060a0', suit: '#5d4a86', hairStyle: 'short', accessory: 'glasses', seed: 14 },
    commsColor: '#d060a0',
  },

  // ── Voices without faces ──────────────────────────────────────────────
  {
    id: 'system',
    callsign: 'FCS',
    name: 'Flight Computer (golden-age core, airframe 0413)',
    role: 'Ship computer; also renders signal intercepts',
    faction: 'concord',
    voice: 'ALL CAPS. Terse. Six hundred years old and occasionally says something in the Timetable\'s dead dialect.',
    portrait: { skin: '#6fe6ff', hair: '#0a2a3a', eyes: '#e8fbff', suit: '#0a1a24', hairStyle: 'shaved', accessory: 'visor', seed: 0 },
    commsColor: '#6fe6ff',
  },
  {
    id: 'oracle',
    callsign: 'ORACLE',
    name: 'The Anchor Archive',
    role: 'Automated voice of the Builders\' Monolith',
    faction: 'unknown',
    voice: 'Calm, plural, translated. Uses "we" for the Builders and "you" as if it has been expecting you for a very long time.',
    portrait: { skin: '#ffffff', hair: '#d8fff6', eyes: '#ffffff', suit: '#0a0f14', hairStyle: 'shaved', accessory: 'none', seed: 431 },
    commsColor: '#e8fff8',
  },
];
