import { Color, Vector3, type Group, type Scene } from 'three';
import type { SurfacePortSite } from '@/universe/Universe';
import { LightRig, type LightPreset } from '@/render/LightRig';
import { postFx } from '@/render/post/PostFx';
import type { PlanetPreset } from '../Planet';
import { SYSTEM_OFFSET } from '../StarSystemView';
import { EntryFx } from './EntryFx';
import { SURFACE_ANCHOR_OFFSET, SurfaceScene } from './SurfaceScene';

/**
 * The flight scene's surface layer (planetary ports): owns the local surface
 * scene for the port being visited and swaps it with space — a world-root
 * swap under cover of the cloud-deck whiteout, no load screen.
 *
 * Entering: space (system view, sky, strata, dust, other ships) is hidden
 * through the host hook, the surface group and its camera-locked sky come
 * in, the key light is re-aimed for the surface frame (same sun colours,
 * a readable elevation) and the post pass's depth fog takes the horizon
 * colour. Leaving restores all of it. The entry effects (plasma sheath,
 * veil, cloud punch) are driven per frame by the descent sequence.
 */
export interface SurfaceHooks {
  /** Show / hide everything that belongs to space. */
  setSpaceVisible(v: boolean): void;
  /** The current system's light preset (restored on leaving). */
  systemLight(): LightPreset;
}

export class SurfaceWorld {
  active = false;
  scene: SurfaceScene | null = null;
  /** Universe position of the surface frame's origin (the tether foot). */
  readonly anchor = new Vector3().copy(SYSTEM_OFFSET).add(SURFACE_ANCHOR_OFFSET);
  readonly fx = new EntryFx();
  private light: LightPreset | null = null;
  /** The planet's air, saturated: the entry fog / veil tint (linear). */
  readonly entryTint = new Color('#5a9ad8');

  constructor(
    private scene3: Scene,
    private root: Group,
    private hooks: SurfaceHooks,
  ) {
    scene3.add(this.fx.veil, this.fx.punch.mesh);
  }

  /** Build (or reuse) the surface scene for `port` on a planet of `preset`. */
  prepare(port: SurfacePortSite, preset: PlanetPreset): SurfaceScene {
    if (this.scene?.port.id === port.id) return this.scene;
    const was = this.active;
    if (was) this.setActive(false);
    this.scene?.dispose();
    this.scene = new SurfaceScene(port, preset);
    this.scene.group.position.copy(this.anchor);
    this.scene.group.visible = false;
    this.scene.sky.visible = false;
    this.root.add(this.scene.group);
    this.scene3.add(this.scene.sky);
    const t = this.scene.tones;
    const air = new Color(preset.atmosphere || '#9fdcff');
    const hsl = { h: 0, s: 0, l: 0 };
    air.getHSL(hsl);
    this.entryTint.setHSL(hsl.h, Math.min(1, hsl.s * 1.15 + 0.1), 0.42);
    this.fx.setAtmosphere(this.entryTint, t.cloud, t.cloudShade);
    if (was) this.setActive(true);
    return this.scene;
  }

  /** Surface frame → universe. */
  toUniverse(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).add(this.anchor);
  }

  /** Swap space ↔ surface (idempotent; seekable sequences call it every frame). */
  setActive(on: boolean): void {
    if (on === this.active || (on && !this.scene)) return;
    this.active = on;
    const s = this.scene!;
    s.group.visible = on;
    s.sky.visible = on;
    this.hooks.setSpaceVisible(!on);
    if (on) {
      const sys = this.hooks.systemLight();
      this.light = sys;
      LightRig.apply(surfaceLight(sys, s.port.seed));
      postFx.fog = 0.8;
      postFx.fogColor.copy(s.horizon);
      postFx.fogRange = 17;
    } else {
      LightRig.apply(this.light ?? this.hooks.systemLight());
      this.light = null;
      postFx.fog = 0;
    }
  }

  update(time: number): void {
    if (this.active) this.scene?.update(time);
  }

  /** Done with the port (launched to orbit, jumped, episode start): drop the scene. */
  release(): void {
    this.setActive(false);
    this.fx.off();
    this.fx.detach();
    this.scene?.dispose();
    this.scene = null;
  }
}

/** The system's sun, re-aimed for a surface frame: 30–45° up, azimuth from the port seed. */
export function surfaceLight(sys: LightPreset, seed: number): LightPreset {
  const az = ((seed % 360) * Math.PI) / 180;
  const el = ((30 + (seed % 15)) * Math.PI) / 180;
  return {
    ...sys,
    name: `${sys.name} (surface)`,
    keyDirection: new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize(),
    rimDirection: new Vector3(-Math.cos(az), 0.25, -Math.sin(az)).normalize(),
    shadowTint: sys.shadowTint.clone().lerp(new Color('#6a78a8'), 0.35),
    rimIntensity: sys.rimIntensity * 0.5,
  };
}
