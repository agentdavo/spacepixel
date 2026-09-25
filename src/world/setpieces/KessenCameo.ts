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
 * The default-off preview gate is passed by the registry, so tests can build
 * the piece without a browser. Frames retain their real metre-scale Statures.
 */
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

  constructor(readonly tag: string, anchor: Vector3, params?: SetPieceParams, enabled = false) {
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
      frame.root.rotation.y = (i === 0 ? -1 : 1) * (witness ? 0.12 : 0.35);
      this.frames.push(frame);
      this.group.add(frame.root);
      // FrameKit owns a shared material. Dispose only this instance's geometry.
      for (const mesh of frame.meshes) this.geometries.add(mesh.geometry);
    });

    const steel = this.material('#5d6875', 3900);
    const dark = this.material('#2a2f37', 3901);
    const hazard = this.material('#e8b42a', 3902);
    const light = this.material('#74f6e2', 3903, true);
    this.part(34, 1.2, 18, 0, -0.6, 0, steel);
    this.part(32, 1.4, 1, 0, -2, -6, dark);
    this.part(32, 1.4, 1, 0, -2, 6, dark);
    for (const side of [-1, 1]) {
      this.part(1.2, 12, 1.2, side * 16, 5, -5, steel);
      this.part(2, 0.35, 2, side * 16, 11.1, -5, light);
      this.part(1, 0.12, 16, side * 14, 0.06, 0, hazard);
      for (let z = -6; z <= 6; z += 4) this.part(3, 0.13, 0.5, side * 9, 0.07, z, hazard);
    }
    // A broken overhead brace reads as a salvaged evacuation span; the tuning
    // witnesses instead stand on an intact, quiet maintenance platform.
    if (!witness) {
      this.part(11, 0.8, 1.2, -10.5, 9.6, -5, steel);
      this.part(11, 0.8, 1.2, 10.5, 9.6, -5, steel);
    }
    this.poseAt(0);
  }

  private material(color: string, inkId: number, emissive = false): CelMaterial {
    const material = new CelMaterial({ color, inkId, gloss: 0.4, ...(emissive ? { emissive: color, emissiveStrength: 0.7 } : {}) });
    this.materials.push(material);
    return material;
  }

  private part(w: number, h: number, d: number, x: number, y: number, z: number, material: CelMaterial): void {
    const geometry = box(w, h, d, Math.min(0.2, h / 4));
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.geometries.add(geometry);
    this.group.add(mesh);
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
