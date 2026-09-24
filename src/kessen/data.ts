/**
 * The Kessen: design data for the mecha race (see docs/KESSEN.md).
 *
 * Kept self-contained on purpose: the race is not a `FactionId` yet (that
 * union keys many economy tables), and the name may still change, so every
 * display string lives here behind the stable id `kessen`.
 */

export const KESSEN = {
  id: 'kessen',
  name: 'The Kessen',
  homeworld: 'Kessendra',
  short: 'KS',
  motto: 'I will not be carried.',
} as const;

/** Paint slots a frame part can use. `glow` parts are emissive (the Loom teal by default). */
export type FramePaint = 'primary' | 'secondary' | 'dark' | 'accent' | 'metal' | 'hazard' | 'bright' | 'glow';

export type FrameLivery = Record<Exclude<FramePaint, 'glow'>, string> & { glow: string };

/** Gunmetal slate over bone plate, railway-signal red, Loom teal. */
export const KESSEN_LIVERY: FrameLivery = {
  primary: '#5d6875',
  secondary: '#ddd3bd',
  dark: '#2a2f37',
  accent: '#d63a2c',
  metal: '#8d959f',
  hazard: '#e8b42a',
  bright: '#c9ced4',
  glow: '#74f6e2',
};

export type Stature = 1 | 2 | 3 | 4 | 5;

export interface StatureInfo {
  stature: Stature;
  roman: string;
  name: string;
  /** Standing height in metres. */
  height: number;
  plan: PlanId;
}

/** The five combat levels are five size classes, one pilot per frame for life. */
export const STATURES: StatureInfo[] = [
  { stature: 1, roman: 'I', name: 'Fettler', height: 2.6, plan: 'fettler' },
  { stature: 2, roman: 'II', name: 'Shunter', height: 4.8, plan: 'shunter' },
  { stature: 3, roman: 'III', name: 'Linesman', height: 7.2, plan: 'linesman' },
  { stature: 4, roman: 'IV', name: 'Derrick', height: 9.0, plan: 'derrick' },
  { stature: 5, roman: 'V', name: 'Gantry', height: 11.5, plan: 'gantry' },
];

export type PlanId = 'fettler' | 'shunter' | 'linesman' | 'derrick' | 'gantry';
export type HeadStyle = 'fettler' | 'mono' | 'visor' | 'crest' | 'hood' | 'sensor';
export type PauldronStyle = 'none' | 'round' | 'block' | 'tall';
export type FeetStyle = 'block' | 'skate' | 'wide';
export type PackStyle = 'small' | 'jets' | 'bigjets' | 'crane';

/** Canonical body proportions per Stature (frames are built ~8 m tall, then scaled). */
export interface BodyPlan {
  legK: number;
  armK: number;
  bulk: number;
  chestK: number;
  shW: number;
  headK: number;
  hipW: number;
  head: HeadStyle;
  pauldron: PauldronStyle;
  feet: FeetStyle;
  pack: PackStyle;
}

export const PLANS: Record<PlanId, BodyPlan> = {
  fettler: { legK: 0.92, armK: 1.0, bulk: 1.3, chestK: 1.15, shW: 1.2, headK: 1.35, hipW: 0.62, head: 'fettler', pauldron: 'round', feet: 'block', pack: 'small' },
  shunter: { legK: 1.12, armK: 1.02, bulk: 0.92, chestK: 0.95, shW: 1.18, headK: 1.0, hipW: 0.58, head: 'mono', pauldron: 'round', feet: 'skate', pack: 'jets' },
  linesman: { legK: 1.02, armK: 1.02, bulk: 1.0, chestK: 1.1, shW: 1.35, headK: 0.95, hipW: 0.62, head: 'visor', pauldron: 'block', feet: 'block', pack: 'jets' },
  derrick: { legK: 0.86, armK: 1.05, bulk: 1.38, chestK: 1.38, shW: 1.62, headK: 0.85, hipW: 0.78, head: 'hood', pauldron: 'block', feet: 'wide', pack: 'bigjets' },
  gantry: { legK: 1.02, armK: 1.08, bulk: 1.25, chestK: 1.42, shW: 1.78, headK: 0.9, hipW: 0.76, head: 'crest', pauldron: 'tall', feet: 'wide', pack: 'crane' },
};

export type WeaponKind =
  | 'scribeRifle'
  | 'knockerCarbine'
  | 'knockerPistol'
  | 'knockerCannon'
  | 'spikeDriver'
  | 'rivetGun'
  | 'scribeKnife'
  | 'heatChisel'
  | 'maul'
  | 'piledriver'
  | 'knellLance'
  | 'longScribe'
  | 'cinders'
  | 'mortar'
  | 'lidEmitter'
  | 'bufferKite'
  | 'bufferBoard'
  | 'bufferWall'
  | 'tongsArm'
  | 'cloak';

/** Socket bones that carry kit. */
export type SocketBone = 'weapon_R' | 'weapon_L' | 'shield_L' | 'mount_L' | 'mount_R' | 'backpack';

export interface WeaponMount {
  kind: WeaponKind;
  bone: SocketBone;
}

/** Stance a variant holds at rest (see `POSES` in clips.ts). */
export type Stance = 'ready' | 'aim' | 'dual' | 'heavy' | 'guard' | 'cast' | 'drive' | 'lance';

export interface FrameVariant {
  id: string;
  name: string;
  stature: Stature;
  /** Stencil code, e.g. `III·PL`. */
  code: string;
  role: string;
  stance: Stance;
  head?: HeadStyle;
  weapons: WeaponMount[];
}

/** Fourteen variants across the five Statures. */
export const VARIANTS: FrameVariant[] = [
  { id: 'awl', name: 'Awl', stature: 1, code: 'I·AW', role: 'Infiltrator', stance: 'ready',
    weapons: [{ kind: 'scribeKnife', bone: 'weapon_R' }, { kind: 'knockerPistol', bone: 'weapon_L' }, { kind: 'cloak', bone: 'backpack' }] },
  { id: 'rivet', name: 'Rivet', stature: 1, code: 'I·RV', role: 'Breacher / boarder', stance: 'ready',
    weapons: [{ kind: 'rivetGun', bone: 'weapon_R' }, { kind: 'bufferBoard', bone: 'shield_L' }] },
  { id: 'tongs', name: 'Tongs', stature: 1, code: 'I·TG', role: 'Field fitter', stance: 'ready',
    weapons: [{ kind: 'knockerPistol', bone: 'weapon_R' }, { kind: 'tongsArm', bone: 'backpack' }, { kind: 'bufferBoard', bone: 'shield_L' }] },
  { id: 'gimlet', name: 'Gimlet', stature: 2, code: 'II·GM', role: 'Skirmisher', stance: 'dual',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'knockerCarbine', bone: 'weapon_L' }] },
  { id: 'spanner', name: 'Spanner', stature: 2, code: 'II·SP', role: 'Missile skirmisher', stance: 'ready',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'cinders', bone: 'mount_L' }, { kind: 'cinders', bone: 'mount_R' }] },
  { id: 'plumb', name: 'Plumb', stature: 3, code: 'III·PL', role: 'Line frame', stance: 'aim',
    weapons: [{ kind: 'scribeRifle', bone: 'weapon_R' }, { kind: 'bufferKite', bone: 'shield_L' }, { kind: 'cinders', bone: 'mount_L' }] },
  { id: 'chisel', name: 'Chisel', stature: 3, code: 'III·CH', role: 'Assault', stance: 'heavy',
    weapons: [{ kind: 'knockerCannon', bone: 'weapon_R' }, { kind: 'heatChisel', bone: 'weapon_L' }] },
  { id: 'gauge', name: 'Gauge', stature: 3, code: 'III·GA', role: 'Marksman / spotter', stance: 'aim', head: 'sensor',
    weapons: [{ kind: 'spikeDriver', bone: 'weapon_R' }] },
  { id: 'maul', name: 'Maul', stature: 4, code: 'IV·ML', role: 'Breaker', stance: 'guard',
    weapons: [{ kind: 'maul', bone: 'weapon_R' }, { kind: 'bufferWall', bone: 'shield_L' }] },
  { id: 'bellows', name: 'Bellows', stature: 4, code: 'IV·BL', role: 'Shield projector', stance: 'cast',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'lidEmitter', bone: 'mount_L' }, { kind: 'lidEmitter', bone: 'mount_R' }] },
  { id: 'tamper', name: 'Tamper', stature: 4, code: 'IV·TP', role: 'Artillery', stance: 'ready',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'mortar', bone: 'mount_L' }, { kind: 'longScribe', bone: 'mount_R' }] },
  { id: 'anvil', name: 'Anvil', stature: 5, code: 'V·AN', role: 'Command / shield wall', stance: 'heavy',
    weapons: [{ kind: 'knockerCannon', bone: 'weapon_R' }, { kind: 'bufferWall', bone: 'shield_L' }] },
  { id: 'piledriver', name: 'Piledriver', stature: 5, code: 'V·PD', role: 'Capital killer', stance: 'drive',
    weapons: [{ kind: 'piledriver', bone: 'shield_L' }, { kind: 'knockerCannon', bone: 'weapon_R' }] },
  { id: 'knell', name: 'Knell', stature: 5, code: 'V·KN', role: 'Resonance lance', stance: 'lance',
    weapons: [{ kind: 'knellLance', bone: 'weapon_R' }, { kind: 'lidEmitter', bone: 'mount_L' }] },
];

export const VARIANT_BY_ID: Record<string, FrameVariant> = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

export function statureOf(v: FrameVariant): StatureInfo {
  return STATURES[v.stature - 1];
}
