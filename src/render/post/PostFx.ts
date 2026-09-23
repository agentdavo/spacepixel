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
};
