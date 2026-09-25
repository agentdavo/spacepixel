import type { Blueprint, Part, Vec3 } from '../assets/Blueprint';
import type { CatalogEntry, ShipRole } from '../game/shipyard/catalog';
export interface PilotHull { id: string; name: string; polity: 'pelagic' | 'mantle'; role: ShipRole; length: number; width: number; height: number; civil: boolean; notes: string; }
/** Authored blockouts, not accepted production art. Each has a different role and arrangement. */
export const PILOT_HULLS: PilotHull[] = [
  { id: 'pa-skimmer', name: 'Skimmer', polity: 'pelagic', role: 'interceptor', length: 22, width: 16, height: 4, civil: false, notes: 'Twin pressure pods with a wide steering plane; protects rescue approaches.' },
  { id: 'pa-lifeline', name: 'Lifeline', polity: 'pelagic', role: 'courier', length: 36, width: 13, height: 9, civil: true, notes: 'Stacked rescue chambers beneath a protected service spine.' },
  { id: 'pa-basin', name: 'Basin', polity: 'pelagic', role: 'freighter', length: 132, width: 62, height: 32, civil: true, notes: 'Four pressure tanks around a central cargo corridor.' },
  { id: 'pa-breakwater', name: 'Breakwater', polity: 'pelagic', role: 'corvette', length: 176, width: 76, height: 30, civil: false, notes: 'Separated forward pressure bodies leave the centreline clear for screening batteries.' },
  { id: 'mc-flint', name: 'Flint', polity: 'mantle', role: 'heavy-fighter', length: 26, width: 15, height: 9, civil: false, notes: 'Compact stepped armour and recessed forward guns.' },
  { id: 'mc-keystone', name: 'Keystone', polity: 'mantle', role: 'courier', length: 48, width: 22, height: 14, civil: true, notes: 'Protected sample courier with a ventral cargo keel.' },
  { id: 'mc-foundry', name: 'Foundry', polity: 'mantle', role: 'freighter', length: 148, width: 64, height: 52, civil: true, notes: 'Broad furnace body with lateral raw-material blocks and a sheltered command recess.' },
  { id: 'mc-bastion', name: 'Bastion', polity: 'mantle', role: 'corvette', length: 200, width: 84, height: 58, civil: false, notes: 'A deep layered citadel with dorsal and ventral defensive mounts.' },
];
const box = (name: string, pos: Vec3, size: Vec3, paint: Part['paint'] = 'primary'): Part => ({ name, pos, paint, shape: { kind: 'box', w: size[0], h: size[1], d: size[2], c: Math.min(...size) * 0.18 } });
export function pilotBlueprint(h: PilotHull): Blueprint {
  const L = h.length, W = h.width, H = h.height, nac = h.polity === 'pelagic';
  const parts: Part[] = [];
  if (nac) {
    for (const side of [-1, 1]) parts.push({ name: side < 0 ? 'port-pressure-body' : 'starboard-pressure-body', paint: 'primary', pos: [side * W * 0.28, 0, 0], shape: { kind: 'lathe', segments: 8, profile: [[0, -L * .5], [H * .38, -L * .38], [H * .48, L * .2], [H * .28, L * .44], [0, L * .5]] } });
    parts.push(box('enclosed-service-bridge', [0, 0, -L * .12], [W * .66, H * .22, L * .18], 'secondary'));
    if (h.role === 'interceptor') parts.push(box('steering-plane', [0, 0, -L * .27], [W, H * .1, L * .17], 'accent'));
    if (h.role === 'courier') parts.push(box('rescue-chambers', [0, -H * .32, L * .07], [W * .4, H * .36, L * .45], 'accent'));
    if (h.role === 'freighter') for (const x of [-.2, .2]) parts.push(box('cargo-pressure-cell', [W * x, H * .32, -L * .1], [W * .23, H * .3, L * .55], 'secondary'));
    if (h.role === 'corvette') parts.push(box('armoured-keel', [0, -H * .22, -L * .08], [W * .3, H * .3, L * .72], 'secondary'));
  } else {
    parts.push(box('citadel', [0, 0, 0], [W * .76, H * .7, L]));
    for (const z of [-.26, 0, .26]) parts.push(box('layered-armour', [0, H * .35, L * z], [W * (.86 - z * .2), H * .22, L * .2], 'secondary'));
    if (h.role === 'heavy-fighter') parts.push(box('recessed-bow-guard', [0, -H * .1, L * .34], [W, H * .4, L * .25], 'secondary'));
    if (h.role === 'courier') parts.push(box('sample-keel', [0, -H * .4, 0], [W * .45, H * .3, L * .7], 'accent'));
    if (h.role === 'freighter') for (const x of [-.4, .4]) parts.push(box('mineral-vault', [W * x, -H * .12, 0], [W * .2, H * .7, L * .62], 'accent'));
    if (h.role === 'corvette') parts.push(box('lower-citadel', [0, -H * .4, -.05 * L], [W * .65, H * .3, L * .8], 'secondary'));
  }
  parts.push(box('command', [0, H * .32, L * .22], [W * .22, H * .16, L * .12], 'glass'));
  if (!h.civil) for (const x of [-.2, .2]) parts.push(box('fixed-gun', [x * W, -H * .12, L * .36], [W * .055, H * .08, L * .2], 'metal'));
  if (L > 100) parts.push({ name: 'dorsal-defence', paint: 'secondary', trim: 'metal', pos: [0, H * .5, -L * .22], shape: { kind: 'turret', radius: W * .055, height: H * .08, barrels: 2, barrelLength: L * .06 }, socket: { id: 'pd', kind: 'turret' }, rig: { traverse: [-160, 160], elevation: [-2, 80] } });
  return { id: h.id, name: h.name, designation: h.id.toUpperCase(), faction: h.polity, shipClass: L > 100 ? 'corvette' : h.civil ? 'strike-fighter' : 'interceptor', notes: `PROTOTYPE — ${h.notes}`, parts,
    livery: nac ? { primary: '#c1e0d7', secondary: '#285a66', accent: '#e6bc74', dark: '#152d39', glow: '#71ded0' } : { primary: '#a9947e', secondary: '#41434a', accent: '#e79c55', dark: '#242730', glow: '#ffd098' },
    engines: [-1, 1].map(side => ({ pos: [side * W * .25, -H * .15, -L * .48] as Vec3, radius: Math.min(H * .18, W * .06), plume: L * .3 })),
    hardpoints: [...(L > 100 ? [{ id: 'bridge', kind: 'gun' as const, pos: [0, H * .4, L * .22] as Vec3 }] : []), ...(h.civil ? [] : [-1, 1].map((side, i) => ({ id: `gun-${i}`, kind: 'gun' as const, pos: [side * W * .2, -H * .12, L * .47] as Vec3 })))],
  };
}
export function pilotCatalog(h: PilotHull): CatalogEntry {
  const big = h.length > 100, nac = h.polity === 'pelagic';
  return { id: h.id, blueprint: h.id, name: h.name, designation: h.id.toUpperCase(), faction: h.polity, manufacturer: nac ? 'Pelagic Basin Works' : 'Common Foundry', tier: big ? 4 : 2, role: h.role,
    price: 0, purchasable: false, flyable: true, crew: big ? 80 : 3, length: h.length, camera: big ? 'bridge' : 'chase',
    hardpoints: { guns: h.civil ? [] : [0, 1].map(i => ({ socket: `gun-${i}`, size: big ? 'M' as const : 'S' as const, family: nac ? 'laser' as const : 'kinetic' as const })), missiles: [], turrets: big ? [{ socket: 'pd', size: 'S', arc: 'dorsal', family: 'flak', assisted: true }] : [], utility: { shield: big ? 3 : 2, armour: big ? 3 : 2, engine: big ? 3 : 2, reactor: big ? 3 : 2, extra: 1 } },
    stats: { hull: (big ? 2600 : 160) * (nac ? 1 : 1.3), shield: big ? 1000 : 100, speed: (big ? 100 : 250) * (nac ? 1 : .8), boost: big ? 160 : 340, accel: big ? 12 : 70, turn: big ? 12 : 72, roll: big ? 16 : 90, agility: big ? .15 : .6, cargo: h.civil ? (big ? 320 : 32) : 12 },
    blurb: `Prototype: ${h.notes}` };
}
