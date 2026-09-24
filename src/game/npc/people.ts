/**
 * People the NPC arcs and rivals put on concourses who are not on the
 * recurring roster (src/dialog/people.ts): arc-only characters, and rivals
 * gone to ground. Registered as dialog GUESTS so the concourse can draw,
 * voice and name them; also exported as comms Characters for the contracts
 * radio (arc jobs speak with their client's face).
 */
import type { Character } from '../campaign/types';
import { personById, registerGuests, type Person } from '../../dialog/people.ts';
import { CLIENTS } from '../contracts/contracts.ts';
import { RIVALS, rivalPersonId } from '../rivals/rivals.ts';

const okafor = CLIENTS.find((c) => c.id === 'cl-okafor')!;

export const ARC_GUESTS: Person[] = [
  {
    id: 'tomas-sorel',
    name: 'Tomas Sorel',
    callsign: 'TOMAS',
    role: 'Salvage rigger, Pelestead (late of the Hesperus Dawn)',
    faction: 'concord',
    archetype: 'dock',
    mood: 'cheerful',
    portrait: { skin: '#e6c4a4', hair: '#5a3a2a', eyes: '#5a9a7a', suit: '#c86a2a', hairStyle: 'short', accessory: 'headset', seed: 1471 },
    color: '#d8e8f0',
    voice: { sex: 'm', age: 'young', temper: 'loud' },
    greeting: 'Sorel. Yes, that one. I owe her boots.',
  },
  {
    id: 'picket-okafor',
    name: okafor.name,
    callsign: 'CPT. OKAFOR',
    role: 'Picket captain, Lantern Watch',
    faction: 'concord',
    archetype: 'officer',
    mood: 'weary',
    portrait: okafor.portrait,
    color: okafor.commsColor,
    voice: { sex: 'f', age: 'adult', temper: 'weary' },
    greeting: 'Lantern Watch. Make it quick, pilot. I have a missing ensign.',
  },
];

/** Beaten rivals, standing on a concourse (the ally path). */
export const RIVAL_GUESTS: Person[] = RIVALS.filter((r) => r.hides).map((r) => ({
  id: rivalPersonId(r),
  name: r.name,
  callsign: r.callsign,
  role: r.role,
  faction: r.faction,
  archetype: r.faction === 'choir' ? 'cantor' : 'pilot',
  mood: r.faction === 'choir' ? 'grieving' : 'wry',
  portrait: r.portrait,
  color: r.color,
  voice: r.voice,
  greeting: r.faction === 'choir' ? '...' : 'Don\'t shoot. I\'m on my break.',
}));

registerGuests([...ARC_GUESTS, ...RIVAL_GUESTS]);

const asCharacter = (p: Person): Character => ({
  id: p.id,
  callsign: p.callsign,
  name: p.name,
  role: p.role,
  faction: p.faction === 'none' ? 'unknown' : p.faction,
  voice: p.greeting,
  portrait: p.portrait,
  commsColor: p.color,
});

/** Comms characters for the arc jobs' clients (so their radio lines have faces). */
export const ARC_CLIENTS: Character[] = [...['odile', 'nadia', 'imre', 'maud', 'toma'].map((id) => personById(id)).filter((p): p is Person => !!p), ...ARC_GUESTS].map(asCharacter);

