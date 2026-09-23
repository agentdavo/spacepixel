import { Color } from 'three';

/**
 * Per-frame camera FX inputs written by the active scene and read by the
 * InkPipeline. A plain mutable object: one writer, one reader, no events.
 */
export const postFx = {
  /** 0..1 afterburner punch (speed lines, chromatic focal distortion). */
  boost: 0,
  /** 0..1 speed relative to the ship's boost speed. */
  speed: 0,
  /** 0..1 hyperspace distortion (radial zoom blur + heavy chromatic split). */
  jump: 0,
  /** 0..1 white-out flash (jump entry/exit, big explosions). */
  flash: 0,

  // ── set-piece grade (src/world/setpieces). All default to "no effect". ──
  /** 0..1 depth fog strength (dense nebula). Surfaces fade toward `fogColor` with distance. */
  fog: 0,
  /** Fog colour (linear). */
  fogColor: new Color('#6b4f8f'),
  /** Distance in km at which fog reaches ~63% (at fog = 1). */
  fogRange: 1.6,
  /** 0..1 navigation interference. Not drawn by the pipeline — the HUD reads it to glitch nav/radar. */
  navNoise: 0,
  /** 0..1 colour inversion (display space). */
  invert: 0,
  /** Hue rotation in radians (display space). */
  hue: 0,
  /** 0..1 solarisation (highlights fold back into darks). */
  solarize: 0,
  /** 0..1 fade to black. */
  fade: 0,
  /** 0..1 radiation warning: green-gold edge tint + sensor-hit speckle. */
  radiation: 0,
};
