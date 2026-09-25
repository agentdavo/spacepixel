/** Stable content identities. Geography, ancestry, citizenship and hull design are independent. */
export const POLITY_IDS = ['concord', 'choir', 'rustwake', 'standing', 'pelagic', 'mantle', 'migrant', 'linked', 'seedward', 'archive'] as const;
export type PolityId = typeof POLITY_IDS[number];
export type PeopleId = 'human' | 'kessen' | 'nacrean' | 'oruni' | 'veyri' | 'serev' | 'aruun' | 'vorr';
export type LanguageId = 'common' | 'hesper' | 'cant' | 'works' | 'nacric' | 'orunic' | 'veyric' | 'serevic' | 'aruunic' | 'vorr';
export interface People { id: PeopleId; name: string; habitat: string; communication: string; }
export interface Culture { id: string; people: PeopleId; language: LanguageId; custom: string; disagreement: string; }
export interface Polity { id: PolityId; name: string; people: PeopleId[]; culture: string; tradition: string; language: LanguageId; color: string; }
export interface Tradition { id: string; polity: PolityId; silhouette: string; doctrine: string; limitation: string; }
export interface Organization { id: string; polity: PolityId; name: string; purpose: string; }
export interface CivilizationPack { version: 1; peoples: People[]; cultures: Culture[]; polities: Polity[]; traditions: Tradition[]; organizations: Organization[]; }

const rows: [PolityId, string, PeopleId, LanguageId, string, string, string, string][] = [
  ['concord', 'Terran Directorate', 'human', 'common', '#6fe6ff', 'Wedges, wings and practical deck markings', 'Mutual support and escorted logistics', 'Dependence on organized supply'],
  ['choir', 'Zenith Hegemony', 'human', 'hesper', '#ff5fb4', 'Spired hulls and axial batteries', 'Concentrated capital fire', 'Limited flexibility away from the firing axis'],
  ['rustwake', 'Rustwake Ebon-Gas Clans', 'human', 'cant', '#ffc46b', 'Asymmetric salvage and exposed workshops', 'Raiding, recovery and improvisation', 'Inconsistent supply and maintenance'],
  ['standing', 'The Standing', 'kessen', 'works', '#dbcfa3', 'Five frame statures and industrial consists', 'Existing environmental cameo scope', 'The Seam is not an ordinary gate route'],
  ['pelagic', 'Pelagic Assemblies', 'nacrean', 'nacric', '#70ddd0', 'Paired pressure bodies and enclosed service channels', 'Screening, rescue and convoy manoeuvre', 'Pressure maintenance consumes space and supplies'],
  ['mantle', 'Mantle Compact', 'oruni', 'orunic', '#e7aa6e', 'Layered armour masses and recessed weapons', 'Protected logistics and positional fire', 'Heavy hulls accelerate slowly'],
  ['migrant', 'Migrant Houses', 'veyri', 'veyric', '#9ac9f5', 'Open trusses and long radiator vanes', 'Reconnaissance and coordinated withdrawal', 'Exposed services need tenders'],
  ['linked', 'Linked Republics', 'serev', 'serevic', '#bb9be8', 'Braided bodies with visible relay nodes', 'Distributed sensing and formation support', 'Relay disruption isolates formations'],
  ['seedward', 'Seedwardens', 'aruun', 'aruunic', '#b8ce72', 'Ribbed ceramic shells and protected nurseries', 'Endurance and habitat recovery', 'Specialized supplies and slow replacement'],
  ['archive', 'Archive Commonwealth', 'vorr', 'vorr', '#a8c6d4', 'Tessellated vaults with sparse lights', 'Precision sensing and economical fire', 'Uncertain information and isolated infrastructure'],
];
const peoples: People[] = [
  { id: 'human', name: 'Humanity', habitat: 'Diverse planetary and orbital communities', communication: 'Speech, writing and gesture' },
  { id: 'kessen', name: 'Kessen', habitat: 'Human-descended communities of the Standing', communication: 'Works Tongue and industrial signs' },
  { id: 'nacrean', name: 'Nacreans', habitat: 'Aquatic pressure habitats', communication: 'Harmonic pulses and clicks' },
  { id: 'oruni', name: 'Oruni', habitat: 'Dense-world subterranean cities', communication: 'Percussion and vibration' },
  { id: 'veyri', name: 'Veyri', habitat: 'Low-gravity mobile settlements', communication: 'Whistled contours and timed pauses' },
  { id: 'serev', name: 'Serev', habitat: 'Linked communities of individual citizens', communication: 'Parallel light signals and serial radio' },
  { id: 'aruun', name: 'Aruun', habitat: 'Maintained symbiotic habitats', communication: 'Breath, overtones and symbols' },
  { id: 'vorr', name: 'Vorr', habitat: 'Computational habitats and memory infrastructure', communication: 'Structured packets and audible notation' },
];
const customs: Record<PolityId, [string, string]> = {
  concord: ['Log supplies before launch', 'Civilian allocation versus fleet demand'],
  choir: ['Witness important commitments', 'Institutional authority versus individual conscience'],
  rustwake: ['A recovered object carries an obligation', 'Shared salvage versus private claims'],
  standing: ['Name the work and the workers', 'Preserve existing Kessen canon and autonomy'],
  pelagic: ['Offer pressure-safe shelter before bargaining', 'Open rescue access versus habitat rationing'],
  mantle: ['Publicly record the labor behind a promise', 'Foundry councils versus independent excavation cities'],
  migrant: ['Exchange route histories when houses meet', 'Mobile houses versus settled minorities'],
  linked: ['Ask consent before joining a shared conversation', 'Connection versus privacy'],
  seedward: ['Account for the habitat cost of each departure', 'Custodians versus commercial expansion'],
  archive: ['Attribute a memory before quoting it', 'Continuity rights versus duplication rights'],
};
export const CIVILIZATIONS: CivilizationPack = {
  version: 1, peoples,
  cultures: rows.map(([id, , people, language]) => ({ id: `${id}-culture`, people, language, custom: customs[id][0], disagreement: customs[id][1] })),
  polities: rows.map(([id, name, people, language, color]) => ({ id, name, people: [people], culture: `${id}-culture`, tradition: `${id}-tradition`, language, color })),
  traditions: rows.map(([id, , , , , silhouette, doctrine, limitation]) => ({ id: `${id}-tradition`, polity: id, silhouette, doctrine, limitation })),
  organizations: rows.flatMap(([id, name]) => [
    { id: `${id}-exchange`, polity: id, name: `${name} Exchange`, purpose: 'Civilian trade and port representation' },
    { id: `${id}-services`, polity: id, name: `${name} Service Guild`, purpose: 'Maintenance, rescue and labor representation' },
  ]),
};
export const POLITIES = Object.fromEntries(CIVILIZATIONS.polities.map(p => [p.id, p])) as Record<PolityId, Polity>;
export const TRADITIONS = Object.fromEntries(CIVILIZATIONS.traditions.map(p => [p.id, p]));
export function isPolity(value: unknown): value is PolityId { return POLITY_IDS.includes(value as PolityId); }
export function polityRecord<T>(value: (id: PolityId) => T): Record<PolityId, T> {
  return Object.fromEntries(POLITY_IDS.map(id => [id, value(id)])) as Record<PolityId, T>;
}

/** Reject ambiguous IDs and broken content references before building a world. */
export function validateCivilizations(pack: CivilizationPack): string[] {
  const errors: string[] = [];
  for (const [name, list] of Object.entries(pack)) {
    if (!Array.isArray(list)) continue;
    const ids = new Set<string>();
    for (const item of list) {
      if (!/^[a-z][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) errors.push(`${name}: invalid/duplicate id ${item.id}`);
      ids.add(item.id);
    }
  }
  const has = (list: { id: string }[], id: string, origin: string) => { if (!list.some(x => x.id === id)) errors.push(`${origin}: unresolved ${id}`); };
  for (const p of pack.polities) {
    p.people.forEach(id => has(pack.peoples, id, p.id));
    has(pack.cultures, p.culture, p.id); has(pack.traditions, p.tradition, p.id);
  }
  for (const c of pack.cultures) has(pack.peoples, c.people, c.id);
  for (const t of pack.traditions) has(pack.polities, t.polity, t.id);
  for (const o of pack.organizations) has(pack.polities, o.polity, o.id);
  return errors;
}

/** Capture or transfer changes ownership without rewriting engineering or crew origin. */
export interface VesselIdentity { owner: PolityId; tradition: string; crew: PeopleId[]; organization?: string; }
export function transferOwnership(vessel: VesselIdentity, owner: PolityId): VesselIdentity {
  return { ...vessel, owner, crew: [...vessel.crew], organization: undefined };
}
