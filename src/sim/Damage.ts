/**
 * Damage routing — pure functions over plain data (unit-tested in
 * tests/combat.test.ts; no three.js, no scene).
 *
 * Ship-local frame: +Z nose, +Y up, +X port (left), −X starboard.
 *
 *   hit ─► shield layer ─► hull layer ─► subsystem / zone
 *
 * - Shields are split into directional facings, each its own pool. How many
 *   is data (ShipStats.facings): fighters and gunships 2 (fore / aft, the
 *   X-Wing / Wing Commander halves), corvettes 4 (+ port / starboard), big
 *   capitals 6 (+ dorsal / ventral); 1 is a plain bubble. The facings are
 *   always the first n of FACING, so FORE is 0 and AFT 1 on every hull. A
 *   hit picks the facing whose axis best matches the impact point measured
 *   against the hull's half extents. A collapsed facing lets fire through to
 *   the hull there only.
 * - Power management: the shield `trim` reinforces one facing (fighters:
 *   shields forward / aft; capitals: any facing) by re-weighting capacity,
 *   and charge flows toward the trimmed split over time (`transfer`, with a
 *   loss), never instantly. The ship's shield officer (`trimAuto`: every AI
 *   ship, the player on AUTO) reinforces the facing under the most fire.
 * - A facing below BLEED_AT of its capacity bleeds part of each hit through
 *   to the hull; a facing that collapses stays down for a cooldown before it
 *   can regenerate or take transferred charge.
 * - Capitals project each facing from a shield emitter subsystem; losing one
 *   drops that facing for good (until repaired), losing the shield generator
 *   drops them all.
 * - Damage types scale each layer (DAMAGE_MUL): kinetic chews hull, harmonic
 *   strips shields, explosives wreck subsystems — and splash across the
 *   facings next to the one they hit (SPLASH).
 * - Capitals: a hull hit goes to the nearest intact subsystem within its
 *   radius of the impact point (turrets, lances, hangars, engines, shield
 *   generator and emitters, bridge), else to bare hull (and leaves a scar).
 * - Fighters: four zones by impact direction (nose, port wing, starboard wing,
 *   engines) accumulate damage that degrades flight.
 */
import type { DamageType } from './Loadouts';

export const DAMAGE_MUL: Record<DamageType, { shield: number; hull: number; subsystem: number }> = {
  kinetic: { shield: 0.5, hull: 1.4, subsystem: 1.2 },
  laser: { shield: 1.0, hull: 1.0, subsystem: 1.0 },
  harmonic: { shield: 1.7, hull: 0.6, subsystem: 0.8 },
  explosive: { shield: 0.7, hull: 1.5, subsystem: 1.6 },
};

// ── zones & facings ───────────────────────────────────────────────────

export const ZONE = { NOSE: 0, WING_L: 1, WING_R: 2, ENGINE: 3 } as const;
export const ZONE_NAMES = ['NOSE', 'PORT WING', 'STBD WING', 'ENGINES'] as const;
/**
 * Shield facings in canonical order. A ship with n facings uses the first n
 * (1 bubble · 2 fore/aft · 4 + flanks · 6 + dorsal/ventral), so the indices
 * mean the same thing on every hull.
 */
export const FACING = { FORE: 0, AFT: 1, PORT: 2, STBD: 3, DORSAL: 4, VENTRAL: 5 } as const;
export const FACING_NAMES = ['FORE', 'AFT', 'PORT', 'STBD', 'DORSAL', 'VENTRAL'] as const;
/** Ship-local outward axis of each facing (shield FX, emitter placement, facing pick). */
export const FACING_AXIS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];
/** The facing on the other side of the hull. */
export const OPPOSITE_FACING = [1, 0, 3, 2, 5, 4] as const;
/** How a shield can be split (ShipStats.facings). */
export type FacingCount = 1 | 2 | 4 | 6;

// ── shield tuning ─────────────────────────────────────────────────────

/** Share of total capacity a reinforced facing may hold: 1.6× its balanced share (fighters 80 / 20). */
export const TRIM_FOCUS = 1.6;
/** A facing below this fraction of its capacity bleeds part of each hit through… */
export const BLEED_AT = 0.15;
/** …up to this fraction of the hit, as the facing runs out. */
export const BLEED_MAX = 0.4;
/** A collapsed facing waits this × shieldDelay (from the collapse) before regen / transfer can refill it. */
export const COLLAPSE_COOLDOWN = 1.5;
/** Charge that arrives when moved between facings (the rest is lost as heat). */
export const TRANSFER_EFF = 0.85;
/** Class default transfer rate: fraction of total capacity that can move per second (× ShipStats.shieldTransfer). */
export const TRANSFER_RATE = { small: 0.12, capital: 0.003 } as const;
/** Explosive hits on a shield also take this × the shield damage off the neighbouring facings (never collapsing them). */
export const SPLASH = 0.25;
/** Shield officer: incoming-fire memory (s), the share of the total that counts as "under fire", and hold time between changes (s). */
export const TRIM_HEAT_TAU = 2.5;
export const TRIM_HEAT_MIN = 0.04;
export const TRIM_HOLD = 2;

/**
 * Fighter zone from an impact direction in ship-local space (need not be
 * normalised). Nose: the front cone; engines: the rear cone; else the wing on
 * that side.
 */
export function fighterZone(x: number, y: number, z: number): number {
  const len = Math.hypot(x, y, z) || 1;
  const fz = z / len;
  if (fz > 0.55) return ZONE.NOSE;
  if (fz < -0.5) return ZONE.ENGINE;
  return x >= 0 ? ZONE.WING_L : ZONE.WING_R;
}

/**
 * Four-way (fore / aft / port / starboard) facing from a ship-local point
 * relative to the hull centre — the classic capital split, kept for callers
 * that only know x / z. Normalising by the half extents makes a long hull's
 * flanks read as port / starboard even well forward of amidships.
 */
export function shieldFacing(x: number, z: number, halfW: number, halfL: number): number {
  return pickFacing(4, x / Math.max(halfW, 1e-6), 0, z / Math.max(halfL, 1e-6));
}

/**
 * Facing among the first `n` whose axis best matches a direction already
 * normalised by the hull's half extents (ties go to the earlier facing, so
 * fore / aft win on the diagonals as they always have).
 */
export function pickFacing(n: number, nx: number, ny: number, nz: number): number {
  let best = 0;
  let bd = -Infinity;
  for (let f = 0; f < n; f++) {
    const a = FACING_AXIS[f];
    const d = a[0] * nx + a[1] * ny + a[2] * nz;
    if (d > bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

// ── state ─────────────────────────────────────────────────────────────

export type SubsystemKind = 'turret' | 'lance' | 'hangar' | 'engine' | 'shieldGen' | 'shieldEmitter' | 'bridge';

export interface Subsystem {
  /** Socket id (or 'engine-N', 'shield-gen', 'emitter-<facing>', 'bridge'). */
  id: string;
  kind: SubsystemKind;
  label: string;
  /** Ship-local position (m, relative to the model origin). */
  x: number;
  y: number;
  z: number;
  /** Routing radius (m): hull hits within this of the centre hit the subsystem. */
  radius: number;
  hp: number;
  hpMax: number;
  destroyed: boolean;
  /** Shield emitters: the facing (FACING index) it projects. */
  facing?: number;
}

/** A hull scorch left by damage that hit bare plating (capitals). */
export interface Scar {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Accumulated damage 0..1 (drives how dark it paints). */
  level: number;
}

export interface DamageState {
  capital: boolean;
  /** Hull bounding box centre and half extents (ship-local). */
  cx: number;
  cy: number;
  cz: number;
  halfW: number;
  halfH: number;
  halfL: number;
  /** Shield charge per facing (the first n of FACING; see FacingCount). */
  facings: number[];
  /** Balanced per-facing capacity (total / n): the "full" reference older callers compare against. */
  facingMax: number;
  /** Per-facing capacity now: total × trim weight, 0 where the emitter is lost. Charge may sit above it briefly after a re-trim (it flows off). */
  facingCap: number[];
  /** Shield trim: −1 balanced, else the facing being reinforced. Change it with setTrim / stepTrim. */
  trim: number;
  /** The shield officer sets `trim` from incoming fire (AI ships always; the player's AUTO setting). */
  trimAuto: boolean;
  /** Seconds before the shield officer may re-trim (hysteresis). */
  trimHold: number;
  /** Fraction of total capacity per second that can move between facings. */
  transfer: number;
  /** Charge leaving facings on the last step (points per second) — the HUD's "transferring" cue. */
  flow: number;
  /** Per facing: seconds left before a collapsed facing may regenerate or take transferred charge. */
  cooldown: number[];
  /** Per facing: recent incoming damage (raw, decaying with TRIM_HEAT_TAU) — what the shield officer reads. */
  heat: number[];
  /** Fighter zone damage 0..1 [nose, port wing, starboard wing, engines]. */
  zones: number[];
  /** Hull damage a zone absorbs before it reads 1.0. */
  zoneHp: number;
  subsystems: Subsystem[];
  scars: Scar[];
  scarRadius: number;
  shieldRegen: number;
  shieldDelay: number;
  /** Bitmask of facings that collapsed / began regenerating — consumed by FX. */
  collapsed: number;
  regenStarted: number;
  /** Bitmask of pools currently at zero (to detect the start of regeneration). */
  down: number;
  /** Bumped whenever something visible changes (paint / HUD refresh). */
  version: number;
  /** Rustwake harpoon tether, seconds left. */
  tether: number;
}

export interface Pools {
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
}

export interface Extents {
  cx: number;
  cy: number;
  cz: number;
  halfW: number;
  halfH: number;
  halfL: number;
}

/**
 * `facings` defaults to 4 for capitals and 2 (fore / aft) otherwise;
 * `transfer` multiplies the class transfer rate (ShipStats.shieldTransfer).
 */
export function createDamageState(capital: boolean, shieldMax: number, hullMax: number, ext: Extents, shieldRegen: number, shieldDelay: number, facings: number = capital ? 4 : 2, transfer = 1): DamageState {
  const n = Math.max(1, Math.min(FACING_NAMES.length, Math.round(facings)));
  const facingMax = shieldMax / n;
  return {
    capital,
    ...ext,
    facings: new Array<number>(n).fill(facingMax),
    facingMax,
    facingCap: new Array<number>(n).fill(facingMax),
    trim: -1,
    trimAuto: false,
    trimHold: 0,
    transfer: (capital ? TRANSFER_RATE.capital : TRANSFER_RATE.small) * transfer,
    flow: 0,
    cooldown: new Array<number>(n).fill(0),
    heat: new Array<number>(n).fill(0),
    zones: [0, 0, 0, 0],
    zoneHp: hullMax * 0.45,
    subsystems: [],
    scars: [],
    scarRadius: Math.max(ext.halfL, ext.halfW) * 0.07,
    shieldRegen,
    shieldDelay,
    collapsed: 0,
    regenStarted: 0,
    down: 0,
    version: 0,
    tether: 0,
  };
}

export function addSubsystem(st: DamageState, s: Omit<Subsystem, 'hp' | 'destroyed'>): Subsystem {
  const sub: Subsystem = { ...s, hp: s.hpMax, destroyed: false };
  st.subsystems.push(sub);
  return sub;
}

/** Restore everything (respawn / repair). Keeps the trim setting. */
export function resetDamage(st: DamageState, pools: Pools): void {
  st.zones.fill(0);
  for (const s of st.subsystems) {
    s.hp = s.hpMax;
    s.destroyed = false;
  }
  updateCaps(st);
  for (let i = 0; i < st.facings.length; i++) st.facings[i] = st.facingCap[i];
  st.cooldown.fill(0);
  st.heat.fill(0);
  st.flow = 0;
  st.scars.length = 0;
  st.collapsed = st.regenStarted = st.down = 0;
  st.tether = 0;
  st.version++;
  pools.hull = pools.hullMax;
  syncShield(st, pools);
}

/** Keep `pools.shield` equal to the sum of the facings. */
export function syncShield(st: DamageState, pools: Pools): void {
  let s = 0;
  for (const f of st.facings) s += f;
  pools.shield = s;
}

/**
 * Re-size the shield (outfitting refit, a scene rewriting shieldMax): keeps
 * each facing's fraction of its capacity (an empty shield comes up full).
 */
export function setShieldCapacity(st: DamageState, pools: Pools, shieldMax: number): void {
  const n = st.facings.length;
  const k = st.facingMax > 0 ? shieldMax / n / st.facingMax : 0;
  st.facingMax = shieldMax / n;
  updateCaps(st);
  for (let i = 0; i < n; i++) st.facings[i] = k > 0 ? st.facings[i] * k : st.facingCap[i];
  pools.shieldMax = shieldMax;
  syncShield(st, pools);
}

/**
 * Something outside the damage model wrote `pools.shield` (respawn refills,
 * scripted drains): spread the difference over the facings. A refill tops
 * every facing up to its share (never lowering one); a drain scales them
 * all down. No-op when the pools already agree.
 */
export function adoptShield(st: DamageState, pools: Pools): void {
  let sum = 0;
  for (const f of st.facings) sum += f;
  const want = pools.shield;
  if (Math.abs(want - sum) <= 0.5) return;
  const n = st.facings.length;
  if (want > sum) {
    let capSum = 0;
    for (const c of st.facingCap) capSum += c;
    for (let i = 0; i < n; i++) {
      const each = capSum > 0 ? Math.min(st.facingCap[i], (want * st.facingCap[i]) / capSum) : 0;
      if (each > st.facings[i]) {
        st.facings[i] = each;
        st.cooldown[i] = 0;
      }
    }
    st.down = 0;
    for (let i = 0; i < n; i++) if (st.facings[i] <= 0) st.down |= 1 << i;
  } else {
    const k = sum > 0 ? Math.max(0, want) / sum : 0;
    for (let i = 0; i < n; i++) {
      st.facings[i] *= k;
      if (st.facings[i] <= 0) st.down |= 1 << i;
    }
  }
  st.version++;
  syncShield(st, pools);
}

// ── power management ──────────────────────────────────────────────────

/** Is facing `f`'s emitter intact (always true without emitters: fighters, older hulls)? */
export function emitterOnline(st: DamageState, f: number): boolean {
  for (const s of st.subsystems) if (s.kind === 'shieldEmitter' && s.facing === f) return !s.destroyed;
  return true;
}

/** Recompute `facingCap` from the trim and the emitters (call after either changes). */
export function updateCaps(st: DamageState): void {
  const n = st.facings.length;
  const total = st.facingMax * n;
  const t = st.trim >= 0 && st.trim < n && n > 1 ? st.trim : -1;
  const focus = t >= 0 ? Math.min(0.8, TRIM_FOCUS / n) : 1 / n;
  const rest = n > 1 ? (1 - focus) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const w = t < 0 ? 1 / n : i === t ? focus : rest;
    st.facingCap[i] = emitterOnline(st, i) ? total * w : 0;
  }
  st.version++;
}

/** Set the trim (−1 balanced, else the facing to reinforce). Charge follows over time (transferShields). */
export function setTrim(st: DamageState, trim: number): void {
  const t = trim >= 0 && trim < st.facings.length && st.facings.length > 1 ? trim : -1;
  if (t === st.trim) return;
  st.trim = t;
  updateCaps(st);
}

/**
 * Player trim keys. Two facings: a slider, `dir` +1 toward FORE, −1 toward
 * AFT (AFT ↔ BALANCED ↔ FORE). More facings: `dir` cycles BALANCED → FORE →
 * AFT → PORT → … and back. `dir` 0 re-balances. Manual trim turns AUTO off.
 */
export function stepTrim(st: DamageState, dir: number): void {
  st.trimAuto = false;
  const n = st.facings.length;
  if (dir === 0 || n < 2) return setTrim(st, -1);
  if (n === 2) {
    // Slider position: −1 aft · 0 balanced · +1 fore.
    const pos = st.trim === FACING.FORE ? 1 : st.trim === FACING.AFT ? -1 : 0;
    const next = Math.max(-1, Math.min(1, pos + Math.sign(dir)));
    return setTrim(st, next > 0 ? FACING.FORE : next < 0 ? FACING.AFT : -1);
  }
  // Cycle through −1 (balanced), 0 … n−1.
  const next = ((st.trim + 1 + Math.sign(dir) + n + 1) % (n + 1)) - 1;
  setTrim(st, next);
}

/** HUD / comms name of the current trim. */
export function trimLabel(st: DamageState): string {
  const n = st.facings.length;
  const t = st.trim;
  const base = n < 2 ? 'BUBBLE' : t < 0 ? 'BALANCED' : n === 2 ? (t === FACING.FORE ? 'FORWARD' : 'AFT') : `${FACING_NAMES[t]} REINFORCED`;
  return st.trimAuto ? `AUTO · ${base}` : base;
}

/** Facing `f`'s charge as a fraction of its current capacity (0 when it has none). */
export function facingStrength(st: DamageState, f: number): number {
  const c = st.facingCap[f];
  return c > 0 ? Math.min(1, st.facings[f] / c) : 0;
}

/** Is facing `f` holding (above `frac` of the balanced share)? */
export function facingUp(st: DamageState, f: number, frac = 0.03): boolean {
  return st.facings[f] > st.facingMax * frac;
}

/**
 * Move charge toward the trimmed split: each facing's target is its share of
 * the charge (in proportion to capacity); up to `transfer` × total per second
 * leaves the facings above target and TRANSFER_EFF of it arrives at those
 * below. Facings in collapse cooldown or without an emitter take nothing.
 */
export function transferShields(st: DamageState, pools: Pools, dt: number): void {
  const n = st.facings.length;
  st.flow = 0;
  if (n < 2 || st.transfer <= 0 || dt <= 0) return;
  const F = st.facings;
  const C = st.facingCap;
  let charge = 0;
  let capSum = 0;
  for (let i = 0; i < n; i++) {
    charge += F[i];
    if (C[i] > 0 && st.cooldown[i] <= 0) capSum += C[i];
  }
  if (charge <= 0) return;
  const fill = capSum > 0 ? Math.min(1, charge / capSum) : 0;
  let sur = 0;
  let def = 0;
  for (let i = 0; i < n; i++) {
    const d = F[i] - (C[i] > 0 && st.cooldown[i] <= 0 ? C[i] * fill : 0);
    if (d > 0) sur += d;
    else def -= d;
  }
  const total = st.facingMax * n;
  if (sur <= total * 0.002) return;
  const out = Math.min(sur, st.transfer * total * dt);
  const inn = Math.min(def, out * TRANSFER_EFF);
  const ko = out / sur;
  const ki = def > 0 ? inn / def : 0;
  for (let i = 0; i < n; i++) {
    const d = F[i] - (C[i] > 0 && st.cooldown[i] <= 0 ? C[i] * fill : 0);
    F[i] -= d * (d > 0 ? ko : ki);
    if (F[i] > 0 && st.down & (1 << i)) {
      st.down &= ~(1 << i);
      st.regenStarted |= 1 << i;
    }
  }
  st.flow = out / dt;
  syncShield(st, pools);
}

/**
 * The shield officer: reinforce the facing taking most of the recent fire
 * (fighters: the attacker's side; capitals: the facing under the heaviest
 * guns), back to balanced once the fire dies down. Heat decays every step
 * whoever is trimming.
 */
export function autoTrim(st: DamageState, dt: number, active: boolean): void {
  const n = st.facings.length;
  const k = Math.exp(-dt / TRIM_HEAT_TAU);
  let hot = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    st.heat[i] *= k;
    sum += st.heat[i];
    if (st.heat[i] > st.heat[hot]) hot = i;
  }
  if (!active || n < 2) return;
  if (st.trimHold > 0) {
    st.trimHold -= dt;
    return;
  }
  const floor = st.facingMax * n * TRIM_HEAT_MIN;
  // Reinforce the hot facing when it dominates (and can hold a charge); keep the trim while fire lingers; else balance.
  const want = st.heat[hot] > floor && st.heat[hot] >= sum * 0.5 && st.facingCap[hot] > 0 ? hot : sum > floor * 0.5 ? st.trim : -1;
  if (want !== st.trim) {
    setTrim(st, want);
    st.trimHold = TRIM_HOLD;
  }
}

/** Per-step shield power: collapse cooldowns, the shield officer, charge transfer (regenShields runs after). */
export function stepShieldPower(st: DamageState, pools: Pools, dt: number, officer: boolean): void {
  for (let i = 0; i < st.cooldown.length; i++) if (st.cooldown[i] > 0) st.cooldown[i] = Math.max(0, st.cooldown[i] - dt);
  autoTrim(st, dt, officer || st.trimAuto);
  transferShields(st, pools, dt);
}

// ── routing ───────────────────────────────────────────────────────────

/** Nearest intact subsystem whose routing sphere contains the point, or null. */
export function pickSubsystem(subs: readonly Subsystem[], x: number, y: number, z: number): Subsystem | null {
  let best: Subsystem | null = null;
  let bd = Infinity;
  for (const s of subs) {
    if (s.destroyed) continue;
    const d = Math.hypot(x - s.x, y - s.y, z - s.z);
    if (d <= s.radius && d / s.radius < bd) {
      bd = d / s.radius;
      best = s;
    }
  }
  return best;
}

export function isOnline(st: DamageState, kind: SubsystemKind): boolean {
  let any = false;
  for (const s of st.subsystems) {
    if (s.kind !== kind) continue;
    any = true;
    if (!s.destroyed) return true;
  }
  return !any;
}

export interface HitInput {
  amount: number;
  type: DamageType;
  /** Impact point in ship-local space, or null for untargeted damage (collisions, legacy callers). */
  local: { x: number; y: number; z: number } | null;
  /** True when the impact point is on the shield shell (the layer is decided by the caller's geometry). */
  onShield?: boolean;
  /**
   * Aimed hit: the ray entered this subsystem's hit sphere (Combat.raycastShip),
   * so the hull hit routes to it rather than to whatever is nearest the point.
   */
  sub?: Subsystem | null;
}

export interface HitResult {
  /** A shield layer was up where it hit. */
  shielded: boolean;
  shieldDamage: number;
  hullDamage: number;
  /** Shield facing hit (FACING index: fighters 0 / 1, capitals up to 5); untargeted hits take the strongest. −1 = no hit. */
  facing: number;
  facingCollapsed: boolean;
  /** The hit facing's charge / capacity after the hit (0..1); −1 = no hit. */
  strength: number;
  /** Fraction of the hit (0..BLEED_MAX) that bled through a failing facing to the hull. */
  bleed: number;
  /** Explosive splash taken off the neighbouring facings (shield points). */
  splash: number;
  /** Fighter zone hit (−1 capitals / untargeted). */
  zone: number;
  subsystem: Subsystem | null;
  subsystemDestroyed: boolean;
}

export function createHitResult(): HitResult {
  return { shielded: false, shieldDamage: 0, hullDamage: 0, facing: -1, facingCollapsed: false, strength: -1, bleed: 0, splash: 0, zone: -1, subsystem: null, subsystemDestroyed: false };
}

/** Which facing a hit lands on (untargeted hits go to the strongest). */
export function facingOf(st: DamageState, local: HitInput['local']): number {
  const n = st.facings.length;
  if (local) return pickFacing(n, (local.x - st.cx) / Math.max(st.halfW, 1e-6), (local.y - st.cy) / Math.max(st.halfH, 1e-6), (local.z - st.cz) / Math.max(st.halfL, 1e-6));
  let best = 0;
  for (let i = 1; i < n; i++) if (st.facings[i] > st.facings[best]) best = i;
  return best;
}

/** Knock a facing down: charge gone, FX bit, and the collapse cooldown before it can come back. */
function collapse(st: DamageState, f: number): void {
  if (st.facings[f] > 0) st.collapsed |= 1 << f;
  st.facings[f] = 0;
  st.down |= 1 << f;
  st.cooldown[f] = st.shieldDelay * COLLAPSE_COOLDOWN;
  st.version++;
}

/**
 * Apply one hit. Mutates `pools` (hull / shield) and `st`. Returns `out`.
 * Does not handle death, plot armour or events — the caller does.
 */
export function applyHit(st: DamageState, pools: Pools, hit: HitInput, out: HitResult = createHitResult()): HitResult {
  const mul = DAMAGE_MUL[hit.type];
  out.shielded = false;
  out.shieldDamage = out.hullDamage = 0;
  out.facing = -1;
  out.facingCollapsed = false;
  out.strength = -1;
  out.bleed = 0;
  out.splash = 0;
  out.zone = -1;
  out.subsystem = null;
  out.subsystemDestroyed = false;

  // ── shield layer ─────────────────────────────────────────────────
  let raw = hit.amount; // undamped damage that reaches the hull
  const n = st.facings.length;
  if (n) {
    const f = facingOf(st, hit.local);
    out.facing = f;
    st.heat[f] += raw;
    const pool = st.facings[f];
    if (pool > 0) {
      out.shielded = true;
      // Bleed-through: a failing facing lets part of the hit past.
      const lim = BLEED_AT * Math.max(st.facingCap[f], pool);
      const through = pool < lim ? raw * BLEED_MAX * (1 - pool / lim) : 0;
      raw -= through;
      const eff = raw * mul.shield;
      if (eff < pool) {
        st.facings[f] = pool - eff;
        out.shieldDamage = eff;
        raw = 0;
      } else {
        out.shieldDamage = pool;
        raw *= 1 - pool / eff;
        collapse(st, f);
        out.facingCollapsed = true;
      }
      raw += through;
      out.bleed = hit.amount > 0 ? through / hit.amount : 0;
      // Explosive blast wraps round the shell: the neighbouring facings (a
      // fighter's other half) lose some too, but a splash never drops one.
      if (hit.type === 'explosive' && out.shieldDamage > 0 && n > 1) {
        const opp = n > 2 ? OPPOSITE_FACING[f] : -1;
        const each = (out.shieldDamage * SPLASH) / (n > 2 ? n - 2 : 1);
        for (let j = 0; j < n; j++) {
          if (j === f || j === opp || st.facings[j] <= 1) continue;
          const d = Math.min(each, st.facings[j] - 1);
          st.facings[j] -= d;
          out.splash += d;
        }
      }
    }
    out.strength = facingStrength(st, f);
    syncShield(st, pools);
  }
  if (raw <= 0) return out;

  // ── hull layer ───────────────────────────────────────────────────
  let hull = raw * mul.hull;
  const p = hit.local;
  // Anything with hardware on the hull (capitals, gunships with turret mounts) routes to it.
  const aimed = hit.sub && !hit.sub.destroyed ? hit.sub : null;
  const sub = aimed ?? (p && st.subsystems.length ? pickSubsystem(st.subsystems, p.x, p.y, p.z) : null);
  if (sub) {
    out.subsystem = sub;
    out.subsystemDestroyed = hitSubsystem(st, pools, sub, raw * mul.subsystem);
    // Armoured mounts: the hull behind a subsystem only takes half.
    hull *= 0.5;
  } else if (st.capital && p) {
    addScar(st, p.x, p.y, p.z, hull / Math.max(pools.hullMax, 1));
  }
  if (!st.capital && p) {
    const z = fighterZone(p.x - st.cx, p.y - st.cy, p.z - st.cz);
    out.zone = z;
    const before = st.zones[z];
    st.zones[z] = Math.min(1, before + hull / Math.max(st.zoneHp, 1e-6));
    if (Math.floor(st.zones[z] * 10) !== Math.floor(before * 10)) st.version++;
  }
  pools.hull -= hull;
  out.hullDamage = hull;
  return out;
}

/**
 * Damage one subsystem directly: a routed hull hit, blast splash, a hangar's
 * secondary explosion (src/sim/Subsystems.ts). Returns true when this hit
 * destroyed it. Destruction consequences that live in the damage state are
 * applied here (a dead shield generator drops every facing, a dead emitter
 * its own); the rest follow
 * from `destroyed` (Capitals / ShipTurrets stop the mount, capitalEffects).
 */
export function hitSubsystem(st: DamageState, pools: Pools, sub: Subsystem, amount: number): boolean {
  if (sub.destroyed || amount <= 0) return false;
  sub.hp -= amount;
  st.version++;
  if (sub.hp > 0) return false;
  sub.hp = 0;
  sub.destroyed = true;
  const n = st.facings.length;
  if (sub.kind === 'shieldGen') {
    // The generator feeds every emitter: all facings drop, no regen.
    for (let i = 0; i < n; i++) collapse(st, i);
    syncShield(st, pools);
  } else if (sub.kind === 'shieldEmitter' && sub.facing !== undefined && sub.facing < n) {
    // That facing's projector is gone: it drops and stays down.
    collapse(st, sub.facing);
    updateCaps(st);
    syncShield(st, pools);
  }
  return true;
}

const MAX_SCARS = 24;

/** Record bare-hull damage as a scorch mark, merging with a nearby scar. */
export function addScar(st: DamageState, x: number, y: number, z: number, frac: number): void {
  const r = st.scarRadius;
  // Plating scorches fast: a few percent of hull in one spot reads as fully burnt.
  const add = frac * 18;
  for (const s of st.scars) {
    if (Math.hypot(x - s.x, y - s.y, z - s.z) < r) {
      const before = s.level;
      s.level = Math.min(1, s.level + add);
      if (Math.floor(s.level * 8) !== Math.floor(before * 8)) st.version++;
      return;
    }
  }
  if (st.scars.length >= MAX_SCARS) {
    // Replace the faintest.
    let k = 0;
    for (let i = 1; i < st.scars.length; i++) if (st.scars[i].level < st.scars[k].level) k = i;
    if (st.scars[k].level > add) return;
    st.scars.splice(k, 1);
  }
  st.scars.push({ x, y, z, radius: r, level: Math.min(1, add) });
  st.version++;
}

// ── regeneration ──────────────────────────────────────────────────────

/**
 * Shield regeneration after `shieldDelay` s without hits: each facing refills
 * toward its capacity at `shieldRegen` × its balanced share per second (the
 * trim moves capacity, not generator output; transfer fills a reinforced
 * facing past its share). A facing in its
 * collapse cooldown, or without an emitter, stays down; a destroyed shield
 * generator stops all of it. Sets `regenStarted` bits when a collapsed pool
 * starts coming back. (Cooldowns tick in stepShieldPower.)
 */
export function regenShields(st: DamageState, pools: Pools, sinceHit: number, dt: number): void {
  if (sinceHit < st.shieldDelay) return;
  if (!isOnline(st, 'shieldGen')) return;
  let any = false;
  for (let i = 0; i < st.facings.length; i++) {
    const cap = st.facingCap[i];
    if (cap <= 0 || st.cooldown[i] > 0 || st.facings[i] >= cap) continue;
    if (st.down & (1 << i)) {
      st.down &= ~(1 << i);
      st.regenStarted |= 1 << i;
    }
    st.facings[i] = Math.min(cap, st.facings[i] + st.facingMax * st.shieldRegen * dt);
    any = true;
  }
  if (any) syncShield(st, pools);
}

// ── effects ───────────────────────────────────────────────────────────

export interface FighterEffects {
  /** Main / boost thrust multiplier. */
  thrustMul: number;
  /** Top-speed multiplier. */
  speedMul: number;
  /** Afterburner out. */
  noBoost: boolean;
  /** Uncommanded roll (−1..1 stick units), from wing asymmetry. */
  rollDrift: number;
  /** Extra gun scatter (rad), from nose / avionics damage. */
  gunSpread: number;
  /** Lock-time multiplier (avionics). */
  lockMul: number;
  /** 0 none · 1 grey smoke · 2 heavy black smoke + fire. */
  smoke: 0 | 1 | 2;
}

export function fighterEffects(st: DamageState, hullFrac: number, out: FighterEffects = { thrustMul: 1, speedMul: 1, noBoost: false, rollDrift: 0, gunSpread: 0, lockMul: 1, smoke: 0 }): FighterEffects {
  const [nose, wl, wr, eng] = st.zones;
  const tether = st.tether > 0 ? 0.5 : 1;
  out.thrustMul = (1 - 0.55 * eng) * tether;
  out.speedMul = (1 - 0.3 * eng) * tether;
  out.noBoost = eng >= 0.8 || st.tether > 0;
  // Port wing (+X) losing lift rolls the ship to port (negative roll = left).
  out.rollDrift = Math.max(-0.35, Math.min(0.35, (wr - wl) * 0.35));
  out.gunSpread = nose * 0.015;
  out.lockMul = 1 + nose;
  out.smoke = hullFrac < 0.3 ? 2 : hullFrac < 0.6 ? 1 : 0;
  return out;
}

export interface CapitalEffects {
  /** Throttle multiplier from surviving engines (0 = dead in space). */
  speedMul: number;
  /** All engines out: flight assist off, the hull drifts on its last vector. */
  drift: boolean;
  shieldsOnline: boolean;
  /** Fire control (bridge): 1 coordinated · 0.35 local control only. */
  coordination: number;
}

export function capitalEffects(st: DamageState, out: CapitalEffects = { speedMul: 1, drift: false, shieldsOnline: true, coordination: 1 }): CapitalEffects {
  let engines = 0;
  let alive = 0;
  for (const s of st.subsystems) {
    if (s.kind !== 'engine') continue;
    engines++;
    if (!s.destroyed) alive++;
  }
  out.speedMul = engines ? alive / engines : 1;
  out.drift = engines > 0 && alive === 0;
  out.shieldsOnline = isOnline(st, 'shieldGen');
  out.coordination = isOnline(st, 'bridge') ? 1 : 0.35;
  return out;
}
