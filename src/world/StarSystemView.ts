import { Group, Quaternion, Scene, Vector3 } from 'three';
import type { StarSystem, GateLink } from '@/universe/Universe';
import { Backdrop } from './Backdrop';
import { Planet } from './Planet';
import { LanternGate } from './LanternGate';
import { LightRig } from '@/render/LightRig';

/**
 * Builds a StarSystem's data into renderable objects: sky + light rig
 * (scene-level, camera-locked), planets and one Lantern per gate lane
 * (universe-positioned, under WorldSpace.root). Disposed wholesale on jump.
 *
 * `offset` shifts the whole system in universe space — we keep systems
 * thousands of km from the origin so float precision is always exercised.
 */
export const SYSTEM_OFFSET = new Vector3(2_400_000, 150_000, -1_100_000);

export interface GateInstance {
  link: GateLink;
  gate: LanternGate;
  /** Universe-space centre (offset applied). */
  center: Vector3;
}

const _z = new Vector3(0, 0, 1);

export class StarSystemView {
  readonly group = new Group();
  readonly backdrop: Backdrop;
  readonly gates: GateInstance[] = [];

  constructor(
    readonly system: StarSystem,
    private scene: Scene,
    worldRoot: Group,
  ) {
    this.group.name = `system:${system.id}`;
    LightRig.apply(system.light);
    this.backdrop = new Backdrop(system.backdrop);
    scene.add(this.backdrop.group);

    for (const p of system.planets) {
      const planet = new Planet(p.preset);
      planet.group.position.copy(p.position).add(SYSTEM_OFFSET);
      planet.group.rotation.set(...p.tilt);
      this.group.add(planet.group);
    }

    for (const link of system.gates) {
      const gate = new LanternGate(420);
      const center = link.position.clone().add(SYSTEM_OFFSET);
      gate.group.position.copy(center);
      gate.group.quaternion.copy(new Quaternion().setFromUnitVectors(_z, link.normal));
      this.group.add(gate.group);
      this.gates.push({ link, gate, center });
    }
    worldRoot.add(this.group);
  }

  gateTo(id: string): GateInstance | undefined {
    return this.gates.find((g) => g.link.to === id);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.scene.remove(this.backdrop.group);
    this.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void } };
      m.geometry?.dispose();
    });
  }
}
