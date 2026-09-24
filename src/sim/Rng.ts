/**
 * Seeded, splittable PRNG for the simulation (MP-0 determinism).
 *
 * The rule: nothing that feeds sim state may call `Math.random` (enforced by
 * tests/no-math-random.test.ts over src/sim). Every world owns one root
 * `Rng` (the Fleet's, seeded from the world seed); each system and each
 * entity draws from its own stream, forked by a stable tag:
 *
 *   fleet.rng                      the world root (seed)
 *   fleet.rng.fork('weapons')      gun spread, pellet speed
 *   fleet.rng.fork('missiles')     eject kicks, weave phase, AI holds
 *   ship.rng  = root.fork(ship.id) per-entity stream (capital fire control)
 *   ship.rng.fork('brain').seed    the AI brain's own mulberry32 state
 *
 * `fork` is pure — it hashes the parent's *seed* with the tag and never
 * advances the parent — so streams don't depend on the order systems were
 * built or how much another stream has been consumed. That keeps a stream
 * stable when an unrelated entity spawns (the MP shard property: one
 * ship's dice never shift another's).
 *
 * Generator: mulberry32 (32-bit state, one multiply-xorshift per draw).
 * Plenty for game dice, and the whole state is one number, so it hashes
 * and snapshots trivially. Visual-only randomness (particles, camera shake,
 * HUD noise) stays outside this and must never feed back into the sim.
 */
export class Rng {
  /** The seed this stream was created with (forks key off it). */
  readonly seed: number;
  /** Current generator state (uint32). */
  state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform in [-0.5, 0.5) — the classic `Math.random() - 0.5` jitter. */
  centered(): number {
    return this.next() - 0.5;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** An independent child stream keyed by `tag` (pure: the parent is not advanced). */
  fork(tag: string | number): Rng {
    return new Rng(mix32(this.seed, hashTag(tag)));
  }

  /** Restart the stream (a fresh world with the same seed). */
  reset(): void {
    this.state = this.seed;
  }
}

/** Stable 32-bit hash of a tag (FNV-1a over the string form; numbers hashed as their decimal text). */
export function hashTag(tag: string | number): number {
  const s = typeof tag === 'number' ? `#${tag}` : tag;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix two 32-bit values into a well-scrambled seed (murmur3 finaliser over a golden-ratio combine). */
export function mix32(a: number, b: number): number {
  let h = (a ^ Math.imul(b ^ (b >>> 16), 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0 || 0x9e3779b9;
}

/** Default world seed (the Reach's generation seed; headless harnesses pass their own). */
export const DEFAULT_WORLD_SEED = 1994;
