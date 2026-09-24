import { Color, CylinderGeometry, Group, Matrix4, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, dot, float, fract, max, mix, normalWorld, normalize, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { box } from '@/assets/HullKit';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { inkMRT } from '@/render/materials/InkChannels';
import { LightRig } from '@/render/LightRig';

/**
 * Visuals for the big-hull berths, universe-positioned under the world root
 * and re-placed every frame from the berth frame (works for a station and
 * for a carrier steaming along):
 *
 *  - umbilicals: three service lines that reach from the gantry tower to the
 *    clamped hull (grow in as the arm locks, drop away on release);
 *  - the mooring tether: a thick cable shot from the pylon's bollard to the
 *    frigate, pulses of light running along it;
 *  - the lighter: a small crew boat shuttling between the moored frigate
 *    and the station while berthed.
 *
 * Every placement is an explicit basis or setFromUnitVectors — never
 * Object3D.lookAt on universe positions (floating origin).
 */
const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();

function line(radius: number, mat: MeshBasicNodeMaterial): Mesh {
  const g = new CylinderGeometry(radius, radius, 1, 8, 1, true);
  g.translate(0, 0.5, 0);
  const m = new Mesh(g, mat);
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/** Stretch a unit +Y line mesh from `a` toward `b`, `k` of the way. */
function span(m: Mesh, a: Vector3, b: Vector3, k: number): void {
  _d.subVectors(b, a);
  const len = _d.length() * k;
  m.visible = len > 0.5;
  if (!m.visible) return;
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, _d.normalize());
  m.scale.set(1, len, 1);
}

export class BerthFx {
  readonly group = new Group();
  private umbs: Mesh[] = [];
  private tetherMesh: Mesh;
  private tetherLen: Node = uniform(100);
  private time: Node = uniform(0);
  private glow: Node = uniform(new Color('#ffd24f'));
  readonly lighterGroup = new Group();

  constructor() {
    this.group.name = 'berth-fx';
    const umbMat = new CelMaterial({ color: '#d98a3a', ramp: 'classic', gloss: 0.2, inkWeight: 0.6, inkId: 7700, emissive: '#ff9b3f', emissiveStrength: 0.25 });
    const umbMat2 = new CelMaterial({ color: '#8d94a8', ramp: 'classic', gloss: 0.4, inkWeight: 0.6, inkId: 7701 });
    for (let i = 0; i < 3; i++) {
      const m = line(i === 1 ? 2.2 : 1.4, i === 1 ? umbMat2 : umbMat);
      this.umbs.push(m);
      this.group.add(m);
    }
    // Tether: cel-lit steel with pulses of light running out along it.
    const tm = new MeshBasicNodeMaterial();
    tm.name = 'MooringTether';
    tm.colorNode = Fn(() => {
      const N: Node = normalize(normalWorld);
      const lit: Node = smoothstep(-0.05, 0.05, dot(N, LightRig.keyDirection));
      const base: Node = mix(vec3(LightRig.shadowTint).mul(0.5), vec3(LightRig.keyColor), lit).mul(vec3(0.55, 0.58, 0.64));
      const s: Node = fract(uv().y.mul(this.tetherLen).div(70).sub(this.time.mul(1.4)));
      const pulse: Node = smoothstep(0.82, 0.9, s).mul(float(1).sub(smoothstep(0.9, 0.98, s)));
      return base.add(vec3(this.glow).mul(max(pulse.mul(3.2), 0.35)));
    })();
    tm.mrtNode = inkMRT(0.5, 7702, 0.4);
    this.tetherMesh = line(3.2, tm);
    this.group.add(this.tetherMesh);
    this.buildLighter();
  }

  private buildLighter(): void {
    const g = this.lighterGroup;
    g.name = 'lighter';
    const hull = new CelMaterial({ color: '#d7d2c4', ramp: 'classic', gloss: 0.5, inkId: 7710 });
    const trim = new CelMaterial({ color: '#d0612d', ramp: 'classic', gloss: 0.3, inkId: 7711 });
    const glass = new CelMaterial({ color: '#1b2a44', ramp: 'classic', gloss: 1, inkId: 7712, emissive: '#6fe6ff', emissiveStrength: 0.35 });
    const lamp = new CelMaterial({ color: '#000000', ramp: 'classic', inkWeight: 0, inkId: 7713, emissive: '#ffffff', emissiveStrength: 4 });
    const add = (geo: ReturnType<typeof box>, m: CelMaterial, x: number, y: number, z: number) => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
    };
    add(box(7, 4.2, 16, 0.9), hull, 0, 0, 0);
    add(box(7.2, 1.1, 5, 0.2), trim, 0, 0.6, -3);
    add(box(4.2, 1.6, 4, 0.6), glass, 0, 1.6, 5.2);
    add(box(2.2, 2.2, 7, 0.5), trim, 4.4, -0.4, -3.5);
    add(box(2.2, 2.2, 7, 0.5), trim, -4.4, -0.4, -3.5);
    add(box(0.8, 0.8, 0.8), lamp, 5.6, -0.4, 0);
    add(box(0.8, 0.8, 0.8), lamp, -5.6, -0.4, 0);
    add(box(1.4, 1.4, 0.6), lamp, 0, 0, -8.4);
    g.visible = false;
    this.group.add(g);
  }

  setGlow(c: Color | string): void {
    (this.glow.value as Color).set(c);
  }

  /** Service lines from tower points `a[i]` to hull points `b[i]`, extended `k` (0..1). */
  umbilicals(a: readonly Vector3[], b: readonly Vector3[], k: number): void {
    for (let i = 0; i < this.umbs.length; i++) {
      const m = this.umbs[i];
      if (k <= 0 || !a[i] || !b[i]) {
        m.visible = false;
        continue;
      }
      span(m, a[i], b[i], Math.min(1, k * (1.15 - i * 0.07)));
    }
  }

  /** Tether from the bollard `a` toward the hull point `b`, `k` of the way out. */
  tether(a: Vector3 | null, b: Vector3 | null, k: number, time: number): void {
    this.time.value = time;
    if (!a || !b || k <= 0) {
      this.tetherMesh.visible = false;
      return;
    }
    span(this.tetherMesh, a, b, Math.min(1, k));
    this.tetherLen.value = a.distanceTo(b) * Math.min(1, k);
  }

  /** The crew lighter at `pos`, nose along `fwd`, roof toward `up` (or hidden). */
  lighter(pos: Vector3 | null, fwd?: Vector3, up?: Vector3): void {
    const g = this.lighterGroup;
    g.visible = !!pos;
    if (!pos || !fwd || !up) return;
    g.position.copy(pos);
    _x.crossVectors(up, fwd).normalize();
    _y.crossVectors(fwd, _x);
    g.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, fwd));
  }

  hide(): void {
    for (const m of this.umbs) m.visible = false;
    this.tetherMesh.visible = false;
    this.lighterGroup.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
