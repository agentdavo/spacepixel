import { Group, Mesh, PlaneGeometry, SphereGeometry, Vector3, type Color } from 'three';
import { uniform } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import type { SurfacePortSite } from '@/universe/Universe';
import type { PlanetPreset } from '../Planet';
import { buildPalette } from '@/render/materials/PaletteRamp';
import { CloudCards } from '../setpieces/CloudCards';
import { City } from './City';
import { buildGround, type GroundSpec } from './terrain';
import { deckMaterial, groundMaterial, skyMaterial, skyTones } from './materials';

/**
 * The local surface scene under a surface port's cloud deck (planetary
 * ports). Built once per port visit, swapped in under the whiteout of the
 * cloud punch-through; kilometre-scale, in its own frame (+Y up, the tether
 * foot at the origin), placed at a universe anchor far below the system
 * plane so nothing in space overlaps it. The sky dome is camera-locked
 * (scene-level); everything else rides the world root like any universe
 * object, so the floating origin applies unchanged.
 *
 *   sky dome        stepped bands from the planet's atmosphere colour, cel sun
 *   cloud deck      at DECK_ALT, seen from below (gaps show the sky)
 *   low puffs       a few cel cumulus cards under the deck (parallax on the glide)
 *   ground          terrain / ocean / desert / ice / lava / cloud sea, painted
 *                   with the planet's own palette
 *   city            apron, pads, tether foot, towers, lights, traffic
 */
export const DECK_ALT = 3200;
/** Universe anchor of the surface frame, relative to the system offset (far below the ecliptic). */
export const SURFACE_ANCHOR_OFFSET = new Vector3(0, -4_000_000, 0);

export class SurfaceScene {
  readonly group = new Group();
  readonly sky: Mesh;
  readonly city: City;
  readonly tones: ReturnType<typeof skyTones>;
  readonly ground: GroundSpec;
  private clock: Node = uniform(0);
  private puffs: CloudCards;
  private meshes: Mesh[] = [];

  constructor(
    readonly port: SurfacePortSite,
    preset: PlanetPreset,
  ) {
    this.group.name = `surface:${port.id}`;
    this.tones = skyTones(preset.atmosphere || '#9fdcff');
    const floating = port.terrain === 'cloud';
    this.ground = { terrain: port.terrain, seed: port.seed % 100_000, seaLevel: preset.seaLevel, apron: floating ? 0 : port.terrain === 'ocean' ? 24 : 110 };

    // Sky: camera-locked (added to the scene by SurfaceWorld).
    this.sky = new Mesh(new SphereGeometry(90_000, 32, 16), skyMaterial(this.tones.zenith, this.tones.horizon));
    this.sky.name = 'surface-sky';
    this.sky.renderOrder = -50;
    this.sky.frustumCulled = false;

    // Ground (terrain / sea / cloud sea).
    const palette = buildPalette(preset.bands, 512);
    const ground = new Mesh(buildGround(this.ground), groundMaterial(palette, { glow: preset.glow, inkId: 8600, clock: this.clock, cloudSea: floating }));
    ground.name = 'surface-ground';
    this.add(ground);

    // Cloud deck overhead.
    const deck = new Mesh(new PlaneGeometry(90_000, 90_000, 1, 1), deckMaterial(this.tones.cloud, this.tones.cloudShade, 0.28 + ((port.seed >>> 3) % 20) / 100, port.seed % 97));
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = DECK_ALT;
    deck.name = 'cloud-deck';
    this.add(deck);

    // A scatter of low cumulus under the deck.
    const n = 46;
    const pf = new Float32Array(n * 4);
    let s = (port.seed * 16807 + 3) | 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 2500 + rnd() * 16000;
      pf.set([Math.cos(a) * r, 1300 + rnd() * 1300, Math.sin(a) * r, 260 + rnd() * 520], i * 4);
    }
    this.puffs = new CloudCards({ seed: port.seed % 1000, puffs: pf, colors: [`#${this.tones.cloud.getHexString()}`, '#ffffff'], shade: `#${this.tones.cloudShade.getHexString()}`, near: [0.5, 1.4], lining: '#ffffff' });
    this.group.add(this.puffs.mesh);

    this.city = new City({ ground: this.ground, terrain: port.terrain, seed: port.seed, faction: port.faction });
    this.group.add(this.city.group);
  }

  private add(m: Mesh): void {
    this.meshes.push(m);
    this.group.add(m);
  }

  /** Horizon colour for the depth fog. */
  get horizon(): Color {
    return this.tones.haze;
  }

  update(time: number): void {
    this.clock.value = time;
    this.city.update(time);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sky.removeFromParent();
    this.city.dispose();
    this.puffs.dispose();
    for (const m of [...this.meshes, this.sky]) {
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
  }
}
