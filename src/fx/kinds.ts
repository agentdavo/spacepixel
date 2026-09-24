/**
 * Particle kinds. Stored in the low nibble of each particle's `kindPacked`
 * float; the palette index lives above it (`kind + palette * 16`).
 *
 * Kinds 1–4 are drawn by the OPAQUE cel pass (alpha-tested billboards that
 * write depth, a fake-sphere normal and ink channels, so the ink pass outlines
 * them like cel paint). Kinds 5+ are drawn by the ADDITIVE glow pass.
 */
export const PK = {
  DEAD: 0,
  /** Posterised fireball blob: white → yellow → orange → red → maroon, stepped. */
  FIRE: 1,
  /** Dark cel-shaded smoke ball, ink-outlined; breaks up into chunks as it dies. */
  SMOKE: 2,
  /** White missile-smoke puff (Itano circus); hot core while young; ink-outlined. */
  PUFF: 3,
  /** Tumbling angular hull chunk, two faceted cel tones + hot edge; ink-outlined. */
  DEBRIS: 4,
  /** Hard-edged velocity streak. */
  SPARK: 5,
  /** Star-shaped flash with a white-hot core. */
  FLASH: 6,
  /** Expanding shock ring (camera-facing, or oriented when a normal is given). */
  RING: 7,
  /** Hexagon ripple on an oriented plane. */
  SHIELD: 8,
  /** Small 4-point glint (missile heads, muzzle pings). */
  GLINT: 9,
  /** Molten ember: a soft cel blob that cools white → orange → red → dark over its life (laser burns, droplets). */
  EMBER: 10,
  /** Crackling electric arc: a jagged bolt re-drawn on twos; lies in the plane of `dir` (harmonic hits crawling over plating / shields). */
  ARC: 11,
  /** Flat hexagon tile of a shattered shield, tumbling about its plane (`dir` = initial plane normal). */
  SHARD: 12,
} as const;

export type ParticleKind = (typeof PK)[keyof typeof PK];

/** Colour palettes (encoded above the kind nibble). */
export const PAL = {
  /** Chemical fire / yellow sparks / warm smoke. */
  WARM: 0,
  /** Plasma: cyan-white fire, blue sparks (Choir reactors, shield hits). */
  PLASMA: 1,
  /** Magenta (Choir shields). */
  MAGENTA: 2,
} as const;

export type ParticlePalette = (typeof PAL)[keyof typeof PAL];

/** Highest kind drawn by the opaque pass. */
export const LAST_OPAQUE_KIND = PK.DEBRIS;
