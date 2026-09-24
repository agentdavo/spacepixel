import type { PortraitSpec } from '@/game/campaign/types';
import type { DFaction, DStationKind } from './types';

/**
 * People at stations (the concourse). A roster of named, recurring people who
 * travel the Reach on their own schedules, plus locals generated per station
 * and time slot — all deterministic from (station id, play clock), so the
 * same visit shows the same faces and they rotate as time passes.
 *
 * Pure data + functions (no DOM): tests/dialog.test.ts walks it.
 */
export type Archetype = 'dock' | 'trader' | 'officer' | 'broker' | 'cantor' | 'refugee' | 'bartender' | 'warden' | 'pilot' | 'teacher' | 'inspector' | 'gardener' | 'pupil';
export type Mood = 'weary' | 'cheerful' | 'suspicious' | 'grieving' | 'devout' | 'mercenary' | 'nervous' | 'bored' | 'hopeful' | 'proud' | 'wry';

export interface Person {
  id: string;
  name: string;
  /** Short plate name (subtitles, comms). */
  callsign: string;
  role: string;
  faction: DFaction | 'none';
  archetype: Archetype;
  mood: Mood;
  portrait: PortraitSpec;
  color: string;
  voice: { sex: 'f' | 'm'; age: 'young' | 'adult' | 'old'; temper?: 'calm' | 'nervous' | 'weary' | 'loud' };
  /** One-line hello when you walk up. */
  greeting: string;
  recurring?: boolean;
}

/** Where a recurring person can turn up. */
interface Haunt {
  factions?: DFaction[];
  kinds?: DStationKind[];
  systems?: string[];
  /** Only from / until these episodes (profile.episode). */
  from?: number;
  until?: number;
}

export interface StationRef {
  id: string;
  faction: DFaction;
  kind: DStationKind;
}

const COL: Record<DFaction | 'none', string> = { concord: '#6fe6ff', choir: '#ff5fd0', rustwake: '#ffae4f', none: '#e8e0c8' };

const P = (skin: string, hair: string, eyes: string, suit: string, hairStyle: PortraitSpec['hairStyle'], accessory: PortraitSpec['accessory'], seed: number): PortraitSpec => ({ skin, hair, eyes, suit, hairStyle, accessory, seed });

/** The recurring people of the Reach. Conversations live in conversations.ts. */
export const ROSTER: (Person & { haunt: Haunt })[] = [
  {
    id: 'odile',
    name: 'Odile Fenn',
    callsign: 'ODILE',
    role: 'Keeper of the Last Timetable (the bar moves; so does she)',
    faction: 'none',
    archetype: 'bartender',
    mood: 'wry',
    portrait: P('#e9c9a8', '#d8d4dc', '#7a5a9a', '#6b3a2a', 'bob', 'none', 611),
    color: '#ffd89a',
    voice: { sex: 'f', age: 'old', temper: 'calm' },
    greeting: 'Sit anywhere. The board says DELAYED. It always has.',
    recurring: true,
    haunt: { kinds: ['freeport', 'orbital', 'salvage'] },
  },
  {
    id: 'cass',
    name: 'Cassius "Old Cass" Brand',
    callsign: 'OLD CASS',
    role: 'Breaker, Timetable Graveyard crews',
    faction: 'concord',
    archetype: 'dock',
    mood: 'weary',
    portrait: P('#c8966a', '#bfbfc4', '#6a8a9a', '#c86a2a', 'short', 'beard', 612),
    color: '#ffc46b',
    voice: { sex: 'm', age: 'old', temper: 'weary' },
    greeting: 'Mind the plaques. They are older than your whole Directorate.',
    recurring: true,
    haunt: { kinds: ['salvage'], factions: ['concord', 'rustwake'] },
  },
  {
    id: 'maud',
    name: 'Warden-Sister Maud Okonkwo',
    callsign: 'SISTER MAUD',
    role: 'Engine-warden of the Order of the Keeping, on circuit',
    faction: 'concord',
    archetype: 'warden',
    mood: 'devout',
    portrait: P('#7a4a30', '#141414', '#e8a23a', '#7a5a3a', 'shaved', 'none', 613),
    color: '#e8d27a',
    voice: { sex: 'f', age: 'adult', temper: 'calm' },
    greeting: 'First keeping: the seal holds. Good morning, pilot.',
    recurring: true,
    haunt: { factions: ['concord'], kinds: ['bastion', 'orbital', 'refinery', 'salvage', 'carrier'] },
  },
  {
    id: 'jory',
    name: 'Jory Tey',
    callsign: 'JORY TEY',
    role: 'Clan broker: gas, favours, and the family story',
    faction: 'rustwake',
    archetype: 'broker',
    mood: 'mercenary',
    portrait: P('#b07a50', '#2a1a14', '#9fffb0', '#8a4a2a', 'spiky', 'goggles', 614),
    color: '#ffae4f',
    voice: { sex: 'm', age: 'adult', temper: 'loud' },
    greeting: 'Tey. Yes, that Tey. Gas or the story?',
    recurring: true,
    haunt: { factions: ['rustwake'], kinds: ['freeport', 'refinery', 'salvage'] },
  },
  {
    id: 'lucan',
    name: 'Cantor-Novice Lucan Vey',
    callsign: 'LUCAN VEY',
    role: 'Choir Cantor, grounded after the Observance',
    faction: 'choir',
    archetype: 'cantor',
    mood: 'grieving',
    portrait: P('#f4e2e6', '#e0d0ff', '#ff5fb0', '#2a1f3a', 'long', 'hood', 615),
    color: '#ff5fd0',
    voice: { sex: 'm', age: 'young', temper: 'calm' },
    greeting: 'Be witnessed, Directorate. I am not flying today.',
    recurring: true,
    haunt: { factions: ['choir'] },
  },
  {
    id: 'pell',
    name: 'Inspector Pell Varga',
    callsign: 'INSP. VARGA',
    role: 'Auditor, Office of Continuity',
    faction: 'concord',
    archetype: 'inspector',
    mood: 'suspicious',
    portrait: P('#ecd0b8', '#3a3a44', '#6a7a9a', '#3a3a44', 'swept', 'glasses', 616),
    color: '#ffe28a',
    voice: { sex: 'm', age: 'adult', temper: 'calm' },
    greeting: 'Purely routine. Everything is purely routine.',
    recurring: true,
    haunt: { factions: ['concord'], kinds: ['bastion', 'orbital', 'refinery'] },
  },
  {
    id: 'nadia',
    name: 'Nadia Sorel',
    callsign: 'NADIA',
    role: 'Refugee from Lysowick',
    faction: 'none',
    archetype: 'refugee',
    mood: 'hopeful',
    portrait: P('#e6c4a4', '#5a3a2a', '#5a9a7a', '#5a5048', 'ponytail', 'hood', 617),
    color: '#d8e8f0',
    voice: { sex: 'f', age: 'young', temper: 'nervous' },
    greeting: 'Sorry — are you a pilot?',
    recurring: true,
    haunt: { kinds: ['freeport', 'orbital', 'salvage'] },
  },
  {
    id: 'toma',
    name: 'Ensign Toma Kerrigan',
    callsign: 'ENS. KERRIGAN',
    role: 'Null Lantern picket pilot, on leave',
    faction: 'concord',
    archetype: 'pilot',
    mood: 'nervous',
    portrait: P('#f0d0b0', '#c05a2a', '#5ad0ff', '#eceae4', 'spiky', 'headset', 618),
    color: '#7dffb2',
    voice: { sex: 'm', age: 'young', temper: 'nervous' },
    greeting: 'Three months on the Null picket. Do not ask.',
    recurring: true,
    haunt: { factions: ['concord'], kinds: ['bastion', 'orbital', 'carrier'] },
  },
  {
    id: 'imre',
    name: 'Schoolmistress Imre Dalca',
    callsign: 'MISS DALCA',
    role: 'Teacher, on the heritage tour with Class Four',
    faction: 'concord',
    archetype: 'teacher',
    mood: 'cheerful',
    portrait: P('#f2d6c0', '#8a4a2a', '#3a8a6a', '#2b4ea8', 'bob', 'glasses', 619),
    color: '#9dff8a',
    voice: { sex: 'f', age: 'adult', temper: 'calm' },
    greeting: 'Class, say good afternoon to the pilot.',
    recurring: true,
    haunt: { factions: ['concord'], kinds: ['orbital', 'salvage', 'bastion'] },
  },
  {
    id: 'sabine',
    name: 'Gardener-Cantor Sabine Aurel',
    callsign: 'SABINE AUREL',
    role: 'Tender of the Hesper foundry-gardens',
    faction: 'choir',
    archetype: 'gardener',
    mood: 'proud',
    portrait: P('#f8e0d8', '#f2c8e8', '#c080ff', '#f2eefa', 'long', 'none', 620),
    color: '#ff9ae0',
    voice: { sex: 'f', age: 'adult', temper: 'calm' },
    greeting: 'You smell of ozone and old coffee. Be witnessed anyway.',
    recurring: true,
    haunt: { factions: ['choir'], kinds: ['freeport', 'orbital', 'refinery'] },
  },
  {
    id: 'brennick',
    name: '"Two-Coats" Brennick',
    callsign: 'TWO-COATS',
    role: 'Scrapjack mechanic (both sides\' paint)',
    faction: 'rustwake',
    archetype: 'dock',
    mood: 'cheerful',
    portrait: P('#d8a878', '#e8e0d0', '#ffb347', '#6a5a8a', 'short', 'cap', 621),
    color: '#ffc46b',
    voice: { sex: 'm', age: 'adult', temper: 'loud' },
    greeting: 'Orange under violet under orange. A hull remembers.',
    recurring: true,
    haunt: { factions: ['rustwake'], kinds: ['salvage', 'freeport'] },
  },
  {
    id: 'rosa',
    name: 'Chief Petty Officer Rosa Lindqvist',
    callsign: 'CPO LINDQVIST',
    role: 'Deck crew, CVS-07 Hesperus Dawn (shore leave)',
    faction: 'concord',
    archetype: 'dock',
    mood: 'proud',
    portrait: P('#f2dcc8', '#e8d070', '#4a8ac0', '#2b4ea8', 'ponytail', 'headset', 622),
    color: '#56c8ff',
    voice: { sex: 'f', age: 'adult', temper: 'loud' },
    greeting: 'Dawn deck crew. You fly 0413? Deck talks about you.',
    recurring: true,
    haunt: { factions: ['concord'], kinds: ['bastion', 'orbital', 'carrier'] },
  },
  {
    id: 'idris',
    name: 'Measure-Captain Idris Solenne',
    callsign: 'M-CPT SOLENNE',
    role: 'Choir officer, Treaty Line Watch',
    faction: 'choir',
    archetype: 'officer',
    mood: 'proud',
    portrait: P('#e8c8b8', '#1d1729', '#ff3fa8', '#1d1729', 'swept', 'scar', 623),
    color: '#ff5fd0',
    voice: { sex: 'f', age: 'adult', temper: 'calm' },
    greeting: 'We fly the Observance tomorrow. I am practising politeness.',
    recurring: true,
    haunt: { factions: ['choir'], kinds: ['bastion', 'orbital', 'refinery'] },
  },
  {
    id: 'magpie',
    name: 'Temperance "Tem" Marsh',
    callsign: 'MAGPIE',
    role: 'Rustwake hauler captain, the Magpie\'s Due',
    faction: 'rustwake',
    archetype: 'broker',
    mood: 'mercenary',
    portrait: P('#b87a4a', '#f2efe6', '#9fffb0', '#b0643a', 'spiky', 'eyepatch', 12),
    color: '#ffae4f',
    voice: { sex: 'f', age: 'adult', temper: 'loud' },
    greeting: 'Well, look what the Lantern dragged through.',
    recurring: true,
    haunt: { factions: ['rustwake'], kinds: ['freeport', 'refinery', 'salvage'] },
  },
];

/** Non-roster speakers that appear inside conversations. */
export const EXTRAS: Person[] = [
  {
    id: 'imre-pupil',
    name: 'Pieter, Class Four',
    callsign: 'PIETER',
    role: 'Pupil, age nine',
    faction: 'concord',
    archetype: 'pupil',
    mood: 'hopeful',
    portrait: P('#f0d2b0', '#3a2a1a', '#5ad0ff', '#2b4ea8', 'spiky', 'none', 624),
    color: '#9dff8a',
    voice: { sex: 'm', age: 'young', temper: 'nervous' },
    greeting: 'Is that a real flight suit?',
  },
];

// ── deterministic helpers ──────────────────────────────────────────────

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

// ── generated locals ───────────────────────────────────────────────────

const GIVEN: Record<DFaction, { f: string[]; m: string[] }> = {
  concord: {
    f: ['Brigid', 'Dessa', 'Fenna', 'Ines', 'Mara', 'Orla', 'Petra', 'Rhiannon', 'Tamsin', 'Vesna', 'Willa', 'Hana', 'Adaeze', 'Mirela'],
    m: ['Anselm', 'Corin', 'Emrys', 'Gideon', 'Halloran', 'Jonah', 'Kasimir', 'Niall', 'Quentin', 'Ulric', 'Yusuf', 'Tobias', 'Chidi', 'Radek'],
  },
  choir: {
    f: ['Beatrix', 'Delphine', 'Fiora', 'Honorine', 'Justina', 'Melisande', 'Octavia', 'Perpetua', 'Theodora', 'Seraphine', 'Anthea'],
    m: ['Aurelio', 'Caelan', 'Evander', 'Galen', 'Isidore', 'Leontes', 'Valerian', 'Cassian', 'Severin', 'Lucius', 'Orestes'],
  },
  rustwake: {
    f: ['Ash', 'Cinder', 'Ivy', 'Jinx', 'Lark', 'Nettle', 'Tansy', 'Sable', 'Yarrow', 'Moss', 'Kettle'],
    m: ['Bram', 'Dog', 'Fen', 'Grit', 'Hob', 'Pike', 'Slag', 'Tuck', 'Wedge', 'Cotter', 'Rivet'],
  },
};
const FAMILY: Record<DFaction, string[]> = {
  concord: ['Achebe', 'Brandt', 'Castell', 'Dunmore', 'Farrow', 'Grange', 'Holt', 'Ivers', 'Kwan', 'Larkin', 'Marr', 'Novak', 'Okoro', 'Pask', 'Rourke', 'Stroud', 'Tallis', 'Weir'],
  choir: ['of House Arden', 'Castamere', 'Lirio', 'Montclair', 'Ostrova', 'Serafin', 'Tiberine', 'Valcourt', 'of House Quell', 'Aubade'],
  rustwake: ['of Clan Harrow', 'Coldiron', 'Brightwater', 'Ninefingers', 'Pollard', 'of Clan Slagg', 'Kettleby', 'Marsh', 'of the Ember-Moot'],
};

const ARCH_BY_KIND: Record<DStationKind, Archetype[]> = {
  refinery: ['dock', 'dock', 'trader', 'officer', 'broker', 'refugee'],
  salvage: ['dock', 'dock', 'broker', 'trader', 'refugee'],
  bastion: ['officer', 'pilot', 'dock', 'officer', 'trader'],
  freeport: ['trader', 'broker', 'refugee', 'trader', 'dock', 'cantor'],
  orbital: ['trader', 'refugee', 'officer', 'dock', 'trader'],
  carrier: ['pilot', 'dock', 'officer', 'pilot'],
};

const ROLES: Record<Archetype, Partial<Record<DFaction, string[]>> & { any: string[] }> = {
  dock: { any: ['Deck hand', 'Tether rigger', 'Crane operator', 'Cargo loader', 'Seal fitter'], rustwake: ['Scrapjack cutter', 'Skim-line rigger'] },
  trader: { any: ['Independent hauler', 'Ration contractor', 'Relic dealer', 'Spares chandler'], choir: ['Choir-glass merchant'], rustwake: ['Clan hauler'] },
  officer: { any: ['Station officer'], concord: ['Allocation officer', 'Picket lieutenant', 'Quartermaster'], choir: ['Measure-Sergeant', 'Treasury clerk', 'Deacon of the Watch'], rustwake: ['Moot steward'] },
  broker: { any: ['Broker (gas and favours)', 'Rumour-seller', 'Fence'] },
  cantor: { any: ['Cantor of the Hesper Measure', 'Cantor, on pilgrimage', 'Psalter crew'] },
  refugee: { any: ['Refugee from Lysowick', 'Refugee from Zephacis', 'Displaced ration-card holder'] },
  pilot: { any: ['Kestrel pilot, off watch', 'Harrier pilot, awaiting orders'] },
  bartender: { any: ['Bar keeper'] },
  warden: { any: ['Engine-warden'] },
  teacher: { any: ['Teacher'] },
  inspector: { any: ['Inspector'] },
  gardener: { any: ['Gardener'] },
  pupil: { any: ['Pupil'] },
};

const MOODS: Record<Archetype, Mood[]> = {
  dock: ['weary', 'cheerful', 'bored', 'wry'],
  trader: ['mercenary', 'cheerful', 'suspicious', 'wry'],
  officer: ['proud', 'suspicious', 'bored', 'weary'],
  broker: ['mercenary', 'wry', 'suspicious'],
  cantor: ['devout', 'proud', 'hopeful'],
  refugee: ['grieving', 'hopeful', 'weary', 'nervous'],
  pilot: ['nervous', 'bored', 'cheerful', 'wry'],
  bartender: ['wry'],
  warden: ['devout'],
  teacher: ['cheerful'],
  inspector: ['suspicious'],
  gardener: ['proud'],
  pupil: ['hopeful'],
};

const SKIN = ['#f6dcc6', '#f0d2b8', '#e8c4a0', '#d9b08c', '#c98e5e', '#b87a4a', '#8a5a3a', '#6b4228', '#5a3a26'];
const HAIR = ['#26283a', '#141414', '#4a2a1a', '#8a4a2a', '#c05a2a', '#d8a040', '#e8d070', '#bfbfc4', '#e8e8e8', '#2a3a6a', '#5a2a4a', '#3a5a3a'];
const EYES = ['#3a5a8a', '#4fb0a0', '#6a4a2a', '#5ad0ff', '#8a9a8a', '#c8a060', '#9a7ad0', '#3a8a6a'];
const SUIT: Record<DFaction, string[]> = {
  concord: ['#2b4ea8', '#eceae4', '#1f2f5a', '#3a3a44', '#c86a2a'],
  choir: ['#1d1729', '#5d4a86', '#f2eefa', '#2a1f3a', '#8a2a6a'],
  rustwake: ['#b0643a', '#6b4a2c', '#5d6b3f', '#8a6a3a', '#4a3a2a'],
};
const STYLES: PortraitSpec['hairStyle'][] = ['short', 'long', 'spiky', 'bob', 'shaved', 'ponytail', 'swept'];

const ACCESSORY: Record<Archetype, PortraitSpec['accessory'][]> = {
  dock: ['cap', 'headset', 'goggles', 'none', 'cap'],
  trader: ['none', 'glasses', 'none', 'scar'],
  officer: ['none', 'glasses', 'headset'],
  broker: ['goggles', 'eyepatch', 'none', 'scar'],
  cantor: ['hood', 'hood', 'none'],
  refugee: ['hood', 'none', 'none'],
  pilot: ['headset', 'none', 'scar'],
  bartender: ['none'],
  warden: ['none'],
  teacher: ['glasses'],
  inspector: ['glasses'],
  gardener: ['none'],
  pupil: ['none'],
};

const GREET: Record<Archetype, string[]> = {
  dock: ['Mind the tether, pilot.', 'Shift change in ten. Make it quick.', 'You flew in on that? Brave.'],
  trader: ['Buying or selling? Everyone is one or the other.', 'Prices are a rumour. I trade in rumours.', 'Looking for cargo? I am looking for a pilot.'],
  officer: ['Papers in order, pilot?', 'Keep it brief. The Watch never sleeps.', 'Be witnessed. Briefly.'],
  broker: ['Everything has a price. Some prices are words.', 'Gas, favours, or gossip?', 'Nothing in the black is ever truly lost.'],
  cantor: ['Be witnessed, pilot.', 'Ascend, stranger. Or at least sit down.', 'Do you sing? No. Your kind count.'],
  refugee: ['Spare a moment?', 'Are you going anywhere near Lysowick?', 'I am not begging. I am asking.'],
  pilot: ['Off watch. Talk to me about anything but the war.', 'Nice ride. Fossil, like mine.', 'Kill pool is closed, sorry.'],
  bartender: ['What will it be?'],
  warden: ['The seal holds.'],
  teacher: ['Good afternoon.'],
  inspector: ['Routine check.'],
  gardener: ['Be witnessed.'],
  pupil: ['Hello!'],
};

/** Generate a local (not in the roster) for a station slot. */
export function localPerson(station: StationRef, slot: number, k: number): Person {
  const seed = hashStr(`${station.id}:${slot}:${k}`);
  const r = rng(seed);
  const archetype = pick(r, ARCH_BY_KIND[station.kind]);
  const faction: DFaction = archetype === 'trader' || archetype === 'refugee' ? (r() < 0.6 ? station.faction : pick(r, ['concord', 'choir', 'rustwake'] as const)) : archetype === 'cantor' ? 'choir' : station.faction;
  const sex = r() < 0.5 ? 'f' : 'm';
  const given = pick(r, GIVEN[faction][sex]);
  const family = pick(r, FAMILY[faction]);
  const name = `${given} ${family}`;
  const roles = [...(ROLES[archetype][faction] ?? []), ...ROLES[archetype].any];
  const age = r() < 0.2 ? 'old' : r() < 0.3 ? 'young' : 'adult';
  let accessory = pick(r, ACCESSORY[archetype]);
  if (sex === 'm' && age === 'old' && r() < 0.6) accessory = 'beard';
  const mood = pick(r, MOODS[archetype]);
  const hair = age === 'old' ? pick(r, ['#bfbfc4', '#e8e8e8', '#9a9aa2']) : pick(r, HAIR);
  return {
    id: `local:${station.id}:${slot}:${k}`,
    name,
    callsign: given.toUpperCase(),
    role: pick(r, roles),
    faction,
    archetype,
    mood,
    portrait: P(pick(r, SKIN), hair, pick(r, EYES), archetype === 'dock' ? pick(r, ['#c86a2a', '#d8a040', '#6b4a2c', SUIT[faction][0]]) : pick(r, SUIT[faction]), pick(r, STYLES), accessory, 1000 + (seed % 90000)),
    color: COL[faction],
    voice: { sex, age, temper: mood === 'nervous' ? 'nervous' : mood === 'weary' || mood === 'grieving' ? 'weary' : mood === 'cheerful' || mood === 'mercenary' ? 'loud' : 'calm' },
    greeting: pick(r, GREET[archetype]),
  };
}

// ── who is here ────────────────────────────────────────────────────────

/** Play-clock seconds per rotation of the concourse. */
export const PEOPLE_SLOT = 1200;

function haunts(h: Haunt, s: StationRef, episode: number): boolean {
  if (h.factions && !h.factions.includes(s.faction)) return false;
  if (h.kinds && !h.kinds.includes(s.kind)) return false;
  if (h.systems && !h.systems.some((id) => s.id.startsWith(id + '-'))) return false;
  if (h.from !== undefined && episode < h.from) return false;
  if (h.until !== undefined && episode > h.until) return false;
  return true;
}

/**
 * Where a recurring person is during a slot: one station among those they
 * haunt (or in transit, ~1 slot in 6). Deterministic.
 */
export function whereIs(id: string, stations: readonly StationRef[], clock: number, episode: number): StationRef | null {
  const p = ROSTER.find((x) => x.id === id);
  if (!p) return null;
  const pool = stations.filter((s) => haunts(p.haunt, s, episode));
  if (!pool.length) return null;
  const slot = Math.floor(clock / PEOPLE_SLOT);
  const h = hashStr(`${id}:${slot}`);
  if (h % 6 === 0) return null;
  return pool[(h >>> 4) % pool.length];
}

/**
 * The 2–4 people at `station` right now: recurring people whose schedule puts
 * them here (at most two), then locals for this station and slot.
 */
export function peopleAt(station: StationRef, stations: readonly StationRef[], clock: number, episode: number): Person[] {
  const all = stations.some((s) => s.id === station.id) ? stations : [...stations, station];
  const slot = Math.floor(clock / PEOPLE_SLOT);
  const named: Person[] = [];
  for (const p of ROSTER) {
    if (named.length >= 2) break;
    const at = whereIs(p.id, all, clock, episode);
    if (at?.id === station.id) {
      const { haunt: _h, ...person } = p;
      void _h;
      named.push(person);
    }
  }
  const h = hashStr(`${station.id}:${slot}:count`);
  const total = Math.max(2, Math.min(4, named.length + 1 + (h % 3)));
  const out = [...named];
  for (let k = 0; out.length < total; k++) out.push(localPerson(station, slot, k));
  return out;
}

export function personById(id: string): Person | null {
  const p = ROSTER.find((x) => x.id === id) ?? EXTRAS.find((x) => x.id === id);
  if (!p) return null;
  const { haunt: _h, ...rest } = p as Person & { haunt?: Haunt };
  void _h;
  return rest;
}
