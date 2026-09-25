import type { PolityId } from './civilizations.ts';
export interface Anchor { id: string; name: string; purpose: string; }
export interface RegionManifest { id: string; name: string; count: number; owner: PolityId | 'mixed'; wave: number; x: number; y: number; anchors: Anchor[]; }
/** Appending a region never advances another region's random stream. IDs are save contracts. */
export const REGIONS: RegionManifest[] = [
  { id: 'reach', name: 'Meridian Reach', count: 22, owner: 'mixed', wave: 0, x: 0, y: 0, anchors: [] },
  { id: 'marches', name: 'Fractured Marches', count: 28, owner: 'mixed', wave: 1, x: 130, y: 0, anchors: [
    { id: 'threshold', name: 'Threshold', purpose: 'Contact port where returning survey crews exchange safe route records.' },
    { id: 'stillwater', name: 'Stillwater', purpose: 'A pressure habitat whose medical stores depend on the reopened route.' },
    { id: 'foundry', name: 'Common Foundry', purpose: 'Oruni workers maintain a shared repair yard under a disputed supply charter.' },
    { id: 'shelter', name: 'Shelter', purpose: 'A neutral convoy refuge that needs both assemblies to keep its docks supplied.' },
  ] },
  { id: 'pelagic', name: 'Pelagic Expanse', count: 26, owner: 'pelagic', wave: 2, x: 260, y: 0, anchors: [
    { id: 'basin', name: 'First Basin', purpose: 'Public rescue harbor with competing habitat allocations.' },
    { id: 'undertow', name: 'Undertow', purpose: 'Pressure-vessel repair and reclaimed water exchange.' },
    { id: 'shoal', name: 'Glass Shoal', purpose: 'Survey station measuring a shifting approach corridor.' },
  ] },
  { id: 'migrant', name: 'Migrant Roads', count: 22, owner: 'migrant', wave: 2, x: 260, y: 95, anchors: [
    { id: 'meeting', name: 'House Meeting', purpose: 'Mobile-house assembly and route history exchange.' },
    { id: 'tender', name: 'Long Rest', purpose: 'Radiator refitting and convoy shelter.' },
    { id: 'settlement', name: 'Fixed Star', purpose: 'A settled minority negotiates access to house supply routes.' },
  ] },
  { id: 'mantle', name: 'Mantle Provinces', count: 24, owner: 'mantle', wave: 3, x: 130, y: 95, anchors: [
    { id: 'council', name: 'Deep Council', purpose: 'Civic foundries debate export allocations.' },
    { id: 'cut', name: 'Free Cut', purpose: 'An independent excavation city repairs foreign hulls.' },
    { id: 'anvil', name: 'Anvil Watch', purpose: 'Fortified approach protecting civilian industrial traffic.' },
  ] },
  { id: 'linked', name: 'Linked Territories', count: 24, owner: 'linked', wave: 3, x: 0, y: 95, anchors: [
    { id: 'consent', name: 'Consent', purpose: 'Relay republic with strict rules for shared information.' },
    { id: 'quiet', name: 'Quiet Assembly', purpose: 'A privacy community trades through independent couriers.' },
    { id: 'relay', name: 'Relay Nine', purpose: 'A damaged communications interchange splits the local route network.' },
  ] },
  { id: 'seedward', name: 'Seedward Reaches', count: 22, owner: 'seedward', wave: 4, x: -130, y: 95, anchors: [
    { id: 'nursery', name: 'First Nursery', purpose: 'A protected habitat maintains the region’s replacement stock.' },
    { id: 'bough', name: 'Open Bough', purpose: 'Commercial growers seek new trade partners.' },
    { id: 'winter', name: 'Long Winter', purpose: 'An isolated habitat needs specialist maintenance supplies.' },
  ] },
  { id: 'archive', name: 'Archive Shoals', count: 24, owner: 'archive', wave: 4, x: -130, y: 0, anchors: [
    { id: 'witness', name: 'Witness', purpose: 'Public memory archive with independently represented citizens.' },
    { id: 'copy', name: 'Second Record', purpose: 'A port negotiating copied identity rights.' },
    { id: 'blank', name: 'Blank Interval', purpose: 'An isolated survey archive whose charts require verification.' },
  ] },
];
