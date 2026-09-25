import { Color, Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { inkMRT } from '@/render/materials/InkChannels';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { Fleet } from '@/sim/Fleet';
import { CATALOG_BY_ID } from '@/game/shipyard/catalog';
import { BLUEPRINTS } from '@/assets/blueprints';
import { stockFit } from '@/game/outfitting/fit';
import { applyFit } from '@/game/outfitting/apply';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';

/** Inspection stage: real stock-fitted hulls, fixed lighting and repeatable camera angles. */
export class ShipReviewScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(8, 16 / 9, 0.1, 1_000_000);
  readonly group = new Group();
  readonly fleet = new Fleet(this.group);
  readonly ship;
  private readonly center = new Vector3();
  private direction = new Vector3(-0.75, 0.55, 1);
  private span = 1;
  private orbit = false;
  private readonly white = new MeshBasicNodeMaterial({ color: 0xffffff });
  private readonly originals = new Map<Mesh, Mesh['material']>();

  constructor() {
    const q = new URLSearchParams(location.search);
    const id = q.get('ship') ?? 'vf27-kestrel';
    const bp = BLUEPRINTS[id];
    if (!bp) throw new Error('Unknown review hull: ' + id);
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.group);
    this.scene.background = new Color('#101b2b');
    this.ship = this.fleet.spawn(id, bp.faction, new Vector3(), new Vector3(0, 0, 1));
    const entry = CATALOG_BY_ID[id];
    if (entry) applyFit(this.ship, entry, stockFit(entry));
    this.ship.model.bounds.getCenter(this.center);
    const size = this.ship.model.bounds.getSize(new Vector3());
    this.span = Math.max(size.x, size.y, size.z) * 1.2;
    this.white.mrtNode = inkMRT(0, 0, 0);
    this.ship.model.root.traverse(o => {
      if (o instanceof Mesh) this.originals.set(o, o.material);
    });
    for (const e of this.ship.model.engines) e.plume.visible = false;
    window.__VANGUARD__ = {
      ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '',
      hooks: { ...window.__VANGUARD__?.hooks, review: this },
    };
    this.setView(q.get('angle') ?? 'quarter');
  }

  setView(view: string, silhouette = false, span?: number): void {
    const dirs: Record<string, number[]> = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0], quarter: [-0.75, 0.55, 1] };
    this.direction.fromArray(dirs[view] ?? dirs.quarter).normalize();
    this.camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
    this.scene.background = new Color(silhouette ? '#000000' : '#101b2b');
    for (const [mesh, material] of this.originals) mesh.material = silhouette ? this.white : material;
    if (span !== undefined) this.span = span;
    this.pose(0);
  }

  setOrbit(enabled: boolean): void { this.orbit = enabled; }
  private pose(time: number): void {
    const d = this.direction.clone();
    if (this.orbit) d.applyAxisAngle(new Vector3(0, 1, 0), time * 0.2);
    const distance = this.span / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.camera.position.copy(this.center).addScaledVector(d, distance);
    this.camera.lookAt(this.center);
  }
  update({ time }: FrameContext): void { this.pose(time); }
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  dispose(): void {
    for (const [mesh, material] of this.originals) mesh.material = material;
    this.white.dispose();
  }
}
