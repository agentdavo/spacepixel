import { Color } from 'three';
import { postFx } from '@/render/post/PostFx';

/**
 * Several set pieces may want the same camera effect at once (a derelict's
 * radiation belt inside a nebula…). Each owner registers its own
 * contribution; the shared postFx field is rewritten as the clamped sum, so
 * contributions compose, fade independently and are withdrawn exactly on
 * dispose — nothing is ever left stuck on.
 *
 * `flash` and `jump` are also written by the host scene every frame, so for
 * those we only raise the value (max) for the current frame.
 */
export type MixField = 'fog' | 'navNoise' | 'invert' | 'hue' | 'solarize' | 'fade' | 'radiation';

const FIELDS: MixField[] = ['fog', 'navNoise', 'invert', 'hue', 'solarize', 'fade', 'radiation'];
const owners = new Map<object, Partial<Record<MixField, number>>>();
const fogCols = new Map<object, Color>();
const tmp = new Color();

function rewrite(field: MixField): void {
  let s = 0;
  for (const c of owners.values()) s += c[field] ?? 0;
  // hue is an angle (radians); everything else is a 0..1 amount.
  postFx[field] = field === 'hue' ? s : Math.min(1, Math.max(0, s));
}

function rewriteFogColor(): void {
  let w = 0;
  tmp.setRGB(0, 0, 0);
  for (const [o, c] of owners) {
    const f = c.fog ?? 0;
    const col = fogCols.get(o);
    if (f > 0 && col) {
      tmp.r += col.r * f;
      tmp.g += col.g * f;
      tmp.b += col.b * f;
      w += f;
    }
  }
  if (w > 0) postFx.fogColor.setRGB(tmp.r / w, tmp.g / w, tmp.b / w);
}

export const fxMix = {
  set(owner: object, field: MixField, value: number): void {
    let c = owners.get(owner);
    if (!c) owners.set(owner, (c = {}));
    if (c[field] === value) return;
    c[field] = value;
    rewrite(field);
    if (field === 'fog') rewriteFogColor();
  },
  fogColor(owner: object, color: Color): void {
    let c = fogCols.get(owner);
    if (!c) fogCols.set(owner, (c = new Color()));
    c.copy(color);
    rewriteFogColor();
  },
  /** Raise flash/jump for this frame (the host decays/resets them). */
  raise(field: 'flash' | 'jump', value: number): void {
    if (value > postFx[field]) postFx[field] = Math.min(1, value);
  },
  /** Withdraw everything this owner contributed. */
  release(owner: object): void {
    const c = owners.get(owner);
    owners.delete(owner);
    fogCols.delete(owner);
    if (!c) return;
    for (const f of FIELDS) if (c[f] !== undefined) rewrite(f);
    rewriteFogColor();
  },
};
