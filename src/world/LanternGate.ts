import { Group, Mesh, TorusGeometry, BoxGeometry, Color, CylinderGeometry, MathUtils } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { GlowMaterial } from '@/render/materials/GlowMaterial';

/**
 * A Lantern — one of the Cartographer jump gates. A huge faceted black ring
 * with pylons and a faint inner glow. For now it's a spatial landmark (you
 * can fly through it); Milestone 16 gives it the jump sequence.
 */
export class LanternGate {
  readonly group = new Group();
  readonly radius: number;
  private inner: Mesh;

  constructor(radius = 420) {
    this.radius = radius;
    this.group.name = 'lantern-gate';

    const hull = new CelMaterial({ color: new Color('#2b2838'), ramp: 'dramatic', rimWidth: 0.55, gloss: 0.4, inkId: 7000 });
    const trim = new CelMaterial({ color: new Color('#8d86a8'), ramp: 'classic', rimWidth: 0.6, gloss: 0.7, inkId: 7001 });
    const lamps = new CelMaterial({ color: new Color('#6fe6ff'), emissive: new Color('#6fe6ff'), emissiveStrength: 2.2, inkId: 7002 });

    const ring = new Mesh(toCreasedNormals(new TorusGeometry(radius, radius * 0.075, 6, 48), 0.5), hull);
    this.group.add(ring);
    const lip = new Mesh(toCreasedNormals(new TorusGeometry(radius * 0.92, radius * 0.018, 4, 64), 0.5), trim);
    this.group.add(lip);

    // Pylons + lamp blocks around the ring.
    const pylonGeo = toCreasedNormals(new BoxGeometry(radius * 0.09, radius * 0.24, radius * 0.2), 0.5);
    const lampGeo = new BoxGeometry(radius * 0.03, radius * 0.05, radius * 0.215);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = new Mesh(pylonGeo, trim);
      p.position.set(Math.cos(a) * radius * 1.06, Math.sin(a) * radius * 1.06, 0);
      p.rotation.z = a - Math.PI / 2;
      const l = new Mesh(lampGeo, lamps);
      l.position.copy(p.position).multiplyScalar(1.07);
      l.rotation.z = p.rotation.z;
      this.group.add(p, l);
    }

    // Inner event-surface shimmer (additive, unlined).
    this.inner = new Mesh(
      new CylinderGeometry(radius * 0.9, radius * 0.9, 1, 64, 1, true),
      new GlowMaterial({ color: '#3a6cff', core: '#9fe8ff', intensity: 0.35, flicker: 0.2 }),
    );
    this.inner.rotation.x = MathUtils.degToRad(90);
    this.inner.scale.y = radius * 0.02;
    this.group.add(this.inner);
  }
}
