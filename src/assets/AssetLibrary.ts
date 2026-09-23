import { Color, Mesh, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CelMaterial, type CelOptions } from '@/render/materials/CelMaterial';
import type { Blueprint, Livery } from './Blueprint';
import { buildShip, type ShipModel } from './ShipBuilder';
import { BLUEPRINTS } from './blueprints';

/**
 * Central asset registry. Two sources feed the same cel pipeline:
 *  - Blueprints (procedural, data-driven — the default for all ships), and
 *  - glTF files (hand-modelled hero assets), whose PBR materials are
 *    converted into CelMaterials on import so everything shares one look.
 */
export class AssetLibrary {
  private gltf = new GLTFLoader();
  private gltfCache = new Map<string, Promise<Object3D>>();

  blueprint(id: string): Blueprint {
    const bp = BLUEPRINTS[id];
    if (!bp) throw new Error(`Unknown blueprint "${id}"`);
    return bp;
  }

  ship(id: string, livery?: Partial<Livery>): ShipModel {
    return buildShip(this.blueprint(id), livery);
  }

  /** Load a glTF and convert every mesh to the cel look. Returns a fresh clone per call. */
  async loadModel(url: string, opts: CelOptions = {}): Promise<Object3D> {
    let p = this.gltfCache.get(url);
    if (!p) {
      p = this.gltf.loadAsync(url).then((g) => {
        convertToCel(g.scene, opts);
        return g.scene;
      });
      this.gltfCache.set(url, p);
    }
    return (await p).clone(true);
  }
}

export function convertToCel(root: Object3D, opts: CelOptions = {}): void {
  const cache = new Map<Material, CelMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as Material & { color?: Color; emissive?: Color };
    let cel = cache.get(src);
    if (!cel) {
      cel = new CelMaterial({
        ...opts,
        color: src.color ? src.color.clone() : opts.color,
        emissive: src.emissive && src.emissive.getHex() !== 0 ? src.emissive.clone() : undefined,
        inkId: (opts.inkId ?? 5000) + cache.size,
      });
      cache.set(src, cel);
    }
    mesh.material = cel;
  });
}

export const assets = new AssetLibrary();
