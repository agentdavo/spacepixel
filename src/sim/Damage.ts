/**
 * Damage routing — pure functions over plain data (unit-tested in
 * tests/combat.test.ts; no three.js, no scene).
 *
 * Ship-local frame: +Z nose, +Y up, +X port (left), −X starboard.
 *
 *   hit ─► shield layer ─► hull layer ─► subsystem / zone
 *
 * - Shields: fighters have one bubble; capitals have four facings (fore, aft,
 *   port, starboard) with separate pools, picked from where the hit lands on
 *   the hull's bounding box. A collapsed facing lets fire through to the hull.
 * - Damage types scale each layer (DAMAGE_MUL): kinetic chews hull, harmonic
 *   strips shields, explosives wreck subsystems.
 * - Capitals: a hull hit goes to the nearest intact subsystem within its
 *   radius of the impact point (turrets, lances, hangars, engines, shield
 *   generator, bridge), else to bare hull (and leaves a scar).
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
export const FACING = { FORE: 0, AFT: 1, PORT: 2, STBD: 3 } as const;
export const FACING_NAMES = ['FORE', 'AFT', 'PORT', 'STBD'] as const;

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
 * Capital shield facing from a ship-local point relative to the hull centre.
 * Normalising by the half extents makes a long hull's flanks read as port /
 * starboard even well forward of amidships.
 */
export function shieldFacing(x: number, z: number, halfW: number, halfL: number): number {
  const nx = x / Math.max(halfW, 1e-6);
  const nz = z / Math.max(halfL, 1e-6);
  if (Math.abs(nz) >= Math.abs(nx)) return nz >= 0 ? FACING.FORE : FACING.AFT;
  return nx >= 0 ? FACING.PORT : FACING.STBD;
}

// ── state ─────────────────────────────────────────────────────────────

export type SubsystemKind = 'turret' | 'lance' | 'hangar' | 'engine' | 'shieldGen' | 'bridge';

export interface Subsystem {
  /** Socket id (or 'engine-N', 'shield-gen', 'bridge'). */
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
  /** Capital shield facings (empty for fighters). */
  facings: number[];
  facingMax: number;
  /** Fighter zone damage 0..1 [nose, port wing, starboard wing, engines]. */
  zones: number[];
  /** Hull damage a zone absorbs before it reads 1.0. */
  zoneHp: number;
  subsystems: Subsystem[];
  scars: Scar[];
  scarRadius: number;
  shieldRegen: number;
  shieldDelay: number;
  /** Bitmask of facings (bit 0 for a fighter's bubble) that collapsed / began regenerating — consumed by FX. */
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

export function createDamageState(capital: boolean, shieldMax: number, hullMax: number, ext: Extents, shieldRegen: number, shieldDelay: number): DamageState {
  const facingMax = capital ? shieldMax / 4 : 0;
  return {
    capital,
    ...ext,
    facings: capital ? [facingMax, facingMax, facingMax, facingMax] : [],
    facingMax,
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

/** Restore everything (respawn / repair). */
export function resetDamage(st: DamageState, pools: Pools): void {
  for (let i = 0; i < st.facings.length; i++) st.facings[i] = st.facingMax;
  st.zones.fill(0);
  for (const s of st.subsystems) {
    s.hp = s.hpMax;
    s.destroyed = false;
  }
  st.scars.length = 0;
  st.collapsed = st.regenStarted = st.down = 0;
  st.tether = 0;
  st.version++;
  pools.hull = pools.hullMax;
  pools.shield = pools.shieldMax;
}

/** Keep `pools.shield` equal to the sum of the facings (capitals). */
export function syncShield(st: DamageState, pools: Pools): void {
  if (!st.capital) return;
  let s = 0;
  for (const f of st.facings) s += f;
  pools.shield = s;
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
  /** Capital facing hit (−1 fighters / untargeted). */
  facing: number;
  facingCollapsed: boolean;
  /** Fighter zone hit (−1 capitals / untargeted). */
  zone: number;
  subsystem: Subsystem | null;
  subsystemDestroyed: boolean;
}

export function createHitResult(): HitResult {
  return { shielded: false, shieldDamage: 0, hullDamage: 0, facing: -1, facingCollapsed: false, zone: -1, subsystem: null, subsystemDestroyed: false };
}

/** Which capital facing a hit lands on (untargeted hits go to the strongest). */
export function facingOf(st: DamageState, local: HitInput['local']): number {
  if (local) return shieldFacing(local.x - st.cx, local.z - st.cz, st.halfW, st.halfL);
  let best = 0;
  for (let i = 1; i < st.facings.length; i++) if (st.facings[i] > st.facings[best]) best = i;
  return best;
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
  out.zone = -1;
  out.subsystem = null;
  out.subsystemDestroyed = false;

  // ── shield layer ─────────────────────────────────────────────────
  let raw = hit.amount; // undamped damage that reaches the hull
  if (st.capital) {
    const f = facingOf(st, hit.local);
    out.facing = f;
    const pool = st.facings[f];
    if (pool > 0) {
      out.shielded = true;
      const eff = raw * mul.shield;
      if (eff < pool) {
        st.facings[f] = pool - eff;
        out.shieldDamage = eff;
        raw = 0;
      } else {
        out.shieldDamage = pool;
        raw *= 1 - pool / eff;
        st.facings[f] = 0;
        out.facingCollapsed = true;
        st.collapsed |= 1 << f;
        st.down |= 1 << f;
        st.version++;
      }
    }
    syncShield(st, pools);
  } else if (pools.shield > 0) {
    out.shielded = true;
    const eff = raw * mul.shield;
    if (eff < pools.shield) {
      pools.shield -= eff;
      out.shieldDamage = eff;
      raw = 0;
    } else {
      out.shieldDamage = pools.shield;
      raw *= 1 - pools.shield / eff;
      pools.shield = 0;
      out.facingCollapsed = true;
      st.collapsed |= 1;
      st.down |= 1;
    }
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
 * applied here (a dead shield generator drops every facing); the rest follow
 * from `destroyed` (Capitals / ShipTurrets stop the mount, capitalEffects).
 */
export function hitSubsystem(st: DamageState, pools: Pools, sub: Subsystem, amount: number): boolean {
  if (sub.destroyed || amount <= 0) return false;
  sub.hp -= amount;
  st.version++;
  if (sub.hp > 0) return false;
  sub.hp = 0;
  sub.destroyed = true;
  if (sub.kind === 'shieldGen' && st.capital) {
    for (let i = 0; i < st.facings.length; i++) {
      if (st.facings[i] > 0) st.collapsed |= 1 << i;
      st.facings[i] = 0;
    }
    st.down = 0b1111;
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
 * Shield regeneration after `shieldDelay` s without hits. Capitals regenerate
 * each facing; a destroyed shield generator stops all of it. Sets
 * `regenStarted` bits when a collapsed pool starts coming back.
 */
export function regenShields(st: DamageState, pools: Pools, sinceHit: number, dt: number): void {
  if (sinceHit < st.shieldDelay) return;
  if (st.capital) {
    if (!isOnline(st, 'shieldGen')) return;
    const rate = st.facingMax * st.shieldRegen * dt;
    for (let i = 0; i < st.facings.length; i++) {
      if (st.facings[i] >= st.facingMax) continue;
      if (st.down & (1 << i)) {
        st.down &= ~(1 << i);
        st.regenStarted |= 1 << i;
      }
      st.facings[i] = Math.min(st.facingMax, st.facings[i] + rate);
    }
    syncShield(st, pools);
  } else if (pools.shield < pools.shieldMax) {
    if (st.down & 1) {
      st.down &= ~1;
      st.regenStarted |= 1;
    }
    pools.shield = Math.min(pools.shieldMax, pools.shield + pools.shieldMax * st.shieldRegen * dt);
  }
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
