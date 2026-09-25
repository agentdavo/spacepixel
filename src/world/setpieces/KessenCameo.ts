import { Group, Mesh, Vector3, type BufferGeometry } from 'three';
import { box } from '@/assets/HullKit';
import type { SetPieceKind } from '@/game/campaign/types';
import { KessenFrame } from '@/kessen/FrameKit';
import { VARIANT_BY_ID } from '@/kessen/data';
import { createPoseBuffer, sampleClip } from '@/kessen/clips';
import { CelMaterial } from '@/render/materials/CelMaterial';
import type { SetPiece, SetPieceFrame, SetPieceParams } from './types';
import { str } from './types';

/**
 * A small environmental tableau, never a Fleet actor or a mission objective.
 * The presentation toggle is passed by the registry, so tests can build
 * the piece without a browser. Frames retain their real metre-scale Statures.
 */
export function kessenCameosEnabled(search: string): boolean {
  return new URLSearchParams(search).get('kessenCameos') !== '0';
}

export class KessenCameo implements SetPiece {
  readonly kind: SetPieceKind = 'kessen-cameo';
  readonly group = new Group();
  readonly position = new Vector3();
  readonly radius = 0;
  readonly frames: KessenFrame[] = [];
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials: CelMaterial[] = [];
  private readonly pose = createPoseBuffer();
  private readonly hideWhen: string;
  private disposed = false;

  constructor(readonly tag: string, anchor: Vector3, params?: SetPieceParams, enabled = true) {
    this.position.copy(anchor);
    this.group.position.copy(anchor);
    this.group.name = `setpiece:kessen-cameo:${tag}`;
    this.hideWhen = str(params, 'hideWhenFlag', '');
    if (!enabled) return;

    const witness = str(params, 'tableau', 'evacuation') === 'witness';
    // Guard the open passage from its two shoulders; do not obstruct its centre.
    const variants = witness ? ['plumb', 'anvil'] : ['plumb', 'bellows'];
    variants.forEach((id, i) => {
      const frame = new KessenFrame(VARIANT_BY_ID[id]);
      frame.root.position.set(i === 0 ? -9 : 9, 0, witness ? 0 : -2);
      frame.root.rotation.y = (witness ? Math.PI : 0) + (i === 0 ? -1 : 1) * 0.35;
      this.frames.push(frame);
      this.group.add(frame.root);
      // FrameKit owns a shared material. Dispose only this instance's geometry.
      for (const mesh of frame.meshes) {
        this.geometries.add(mesh.geometry);
        // Baked bounce from the module's work lamps, only on owned geometry.
        // Preserve livery and the shared material; do not change world lighting.
        const surface = mesh.geometry.getAttribute('surface');
        for (let v = 0; v < surface.count; v++) {
          if (surface.getY(v) === 0) surface.setY(v, 0.13);
        }
        surface.needsUpdate = true;
      }
    });

    const steel = this.material('#70968f', 3900);
    const dark = this.material('#2a2f37', 3901);
    const hazard = this.material('#e8b42a', 3902);
    const light = this.material('#d3fff1', 3903, true);
    const cream = this.material('#e6dfb8', 3904);
    // A station-keeping service module: two working shoulders around an open
    // docking throat, with a keel, diagonal load paths, jaws and drive pods.
    // It stays clear of the mission lane; it is not a collision/boarding actor.
    this.part(19, 5, 23, 0, -6, -3, steel);
    this.part(12, 3, 17, 0, -10, -4, dark);
    this.part(30, 1.5, 4, 0, -0.75, -9, steel);
    this.part(12, 4, 5, 0, 2, -10, cream);
    this.part(8, 2, 0.2, 0, 2.4, -7.4, dark);
    this.part(4, 0.4, 0.3, 0, 2.4, -7.2, light);
    for (const side of [-1, 1]) {
      this.part(10, 1, 16, side * 9, -0.5, 0, cream);
      this.part(2, 4, 20, side * 13, -2.5, -1, steel);
      for (const z of [-6, 5]) {
        this.part(1.4, 8, 1.4, side * 10, -4, z, dark).rotation.z = side * -0.65;
        this.part(5, 4, 5, side * 15, -5, z, steel);
        this.part(3, 1, 3, side * 15, -7.5, z, dark);
        this.part(1.6, 0.25, 1.6, side * 15, -8.1, z, light);
      }
      // Docking jaws curl round the open front instead of a showroom railing.
      this.part(2, 2, 8, side * 5, -2, 10, dark);
      this.part(3, 3, 2, side * 4.5, -1.5, 14, hazard);
      this.part(1, 0.12, 14, side * 13, 0.07, 0, hazard);
      for (let z = -6; z <= 6; z += 3) this.part(7, 0.12, 0.25, side * 9, 0.08, z, dark);
      this.part(0.4, 0.15, 13, side * 5.5, 0.1, 0, light);
      // Work lamps and rescue/maintenance markings on both flanks.
      this.part(0.8, 9, 0.8, side * 13, 4, -7, dark);
      this.part(4, 0.8, 1.5, side * 12, 8.5, -7, dark);
      this.part(3.6, 0.3, 1.2, side * 12, 8.05, -7, light);
      this.part(0.2, 3, 7, side * 9.6, -5.5, -3, cream);
      this.part(0.25, 2.2, 0.65, side * 9.75, -5.5, -3, hazard);
      this.part(0.25, 0.65, 2.2, side * 9.75, -5.5, -3, hazard);
      this.part(3, 2.5, 3, side * 9, 1.25, -6, steel);
    }
    // The rescue module carries a visibly damaged recovery spar. The tuning
    // module carries a compact service mast; neither touches beacon logic.
    if (!witness) {
      this.part(16, 1.3, 1.3, -3, 4.5, -12, steel).rotation.z = -0.22;
      this.part(7, 0.6, 0.6, -12, 6, -12, hazard).rotation.z = 0.3;
    } else {
      this.part(1, 9, 1, 0, 8, -11, steel);
      this.part(6, 1, 2, 0, 12, -11, cream);
      this.part(0.5, 1.5, 0.5, 0, 13, -11, light);
    }
    this.poseAt(0);
  }

  private material(color: string, inkId: number, emissive = false): CelMaterial {
    const material = new CelMaterial({ color, inkId, gloss: 0.4, ...(emissive ? { emissive: color, emissiveStrength: 0.7 } : {}) });
    this.materials.push(material);
    return material;
  }

  private part(w: number, h: number, d: number, x: number, y: number, z: number, material: CelMaterial): Mesh {
    const geometry = box(w, h, d, Math.min(0.2, h / 4));
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.geometries.add(geometry);
    this.group.add(mesh);
    return mesh;
  }

  private poseAt(time: number): void {
    this.frames.forEach((frame, i) => {
      sampleClip('idle', time + i * 0.7, { stance: frame.variant.stance, stature: frame.variant.stature }, this.pose);
      frame.apply(this.pose, true);
    });
  }

  update(ctx: SetPieceFrame): void {
    if (this.disposed) return;
    // Episode 19 leaves these witnesses at Meridian when the Point jumps.
    if (this.hideWhen && ctx.flags.has(this.hideWhen)) {
      this.dispose();
      return;
    }
    this.poseAt(ctx.time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.length = 0;
    this.frames.length = 0;
    this.group.clear();
  }
}
