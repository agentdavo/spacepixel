/**
 * The Kessen rig: one 42-bone hierarchy shared by every frame. Proportions
 * change per Stature, the names never do, so every clip plays on every frame.
 *
 * Rigid-part skinning: each armour plate rides 100 % on one bone (correct for
 * plate mecha, and cheap). Axes: +Y up, +Z forward, the L side is +X.
 */
export const BONE_TREE = [
  ['root', null],
  ['hips', 'root'],
  ['skirt_F', 'hips'],
  ['skirt_B', 'hips'],
  ['skirt_L', 'hips'],
  ['skirt_R', 'hips'],
  ['thigh_L', 'hips'],
  ['shin_L', 'thigh_L'],
  ['foot_L', 'shin_L'],
  ['toe_L', 'foot_L'],
  ['thigh_R', 'hips'],
  ['shin_R', 'thigh_R'],
  ['foot_R', 'shin_R'],
  ['toe_R', 'foot_R'],
  ['spine', 'hips'],
  ['chest', 'spine'],
  ['neck', 'chest'],
  ['head', 'neck'],
  ['crest', 'head'],
  ['hatch', 'chest'],
  ['shoulder_L', 'chest'],
  ['pauldron_L', 'shoulder_L'],
  ['upperarm_L', 'shoulder_L'],
  ['forearm_L', 'upperarm_L'],
  ['hand_L', 'forearm_L'],
  ['fingers_L', 'hand_L'],
  ['thumb_L', 'hand_L'],
  ['shoulder_R', 'chest'],
  ['pauldron_R', 'shoulder_R'],
  ['upperarm_R', 'shoulder_R'],
  ['forearm_R', 'upperarm_R'],
  ['hand_R', 'forearm_R'],
  ['fingers_R', 'hand_R'],
  ['thumb_R', 'hand_R'],
  ['backpack', 'chest'],
  ['jet_L', 'backpack'],
  ['jet_R', 'backpack'],
  ['mount_L', 'chest'],
  ['mount_R', 'chest'],
  ['weapon_R', 'hand_R'],
  ['weapon_L', 'hand_L'],
  ['shield_L', 'forearm_L'],
] as const;

export type BoneName = (typeof BONE_TREE)[number][0];

export const BONE_NAMES: readonly BoneName[] = BONE_TREE.map(([n]) => n);

/** Euler XYZ in radians. Negative X swings a limb forward. */
export type Rot = readonly [number, number, number];

/** A pose: a rotation per bone (bones left out rest at zero) plus how far the hips sink. */
export type Pose = { readonly [K in BoneName]?: Rot } & { readonly hipsDrop?: number };
