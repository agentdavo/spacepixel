import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, abs, exp, float, fract, max, min, smoothstep, uniform, uv, vec2, vec3, length, sin } from 'three/tsl';
import type { ShaderNode as Node } from '@/render/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import { useBlendedMRT } from './BlendedMRT';

/**
 * The atmosphere curtain across a hangar mouth: a faint, additive sheet of
 * scanlines with brighter edges and a slow wiping band. When a ship is
 * within a few tens of metres of the plane, a ring ripples out from where
 * it crosses — the pilot visibly passes THROUGH something into the bay.
 *
 * HDR stays low (≈0.003–0.06 across the sheet, ~0.9 at the ripple crest) so
 * bloom doesn't wash out the recess; never inked (noInkMRT, blended MRT).
 * The plane is authored in the bay's local frame: centred on the mouth,
 * facing +Z (out of the bay). Call `setShip` with the ship's position in
 * that same local frame (or null) every frame.
 */
export class BayCurtain {
  readonly mesh: Mesh;
  private readonly time: Node = uniform(0);
  /** Ship crossing point in plane UV (xy) and closeness 0..1 (z). */
  private readonly ship: Node = uniform(new Vector3(0.5, 0.5, 0));
  private readonly color: Node = uniform(new Color('#6fe6ff'));
  private crossT = 9;
  private lastSide = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    color: Color | string = '#6fe6ff',
  ) {
    this.color.value.set(color);
    const mat = new MeshBasicNodeMaterial();
    mat.name = 'BayCurtain';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = DoubleSide;
    const aspect = width / height;
    mat.colorNode = Fn(() => {
      const q: Node = uv();
      // Edge glow: brighter toward the frame, a thin sheet in the middle.
      const ex: Node = min(q.x, float(1).sub(q.x)).mul(aspect);
      const ey: Node = min(q.y, float(1).sub(q.y));
      // A thin line on the frame, not a band: a wide edge glow over the collar
      // and the deck lip read as the mouth itself being lit.
      const edge: Node = exp(min(ex, ey).mul(-40.0));
      // Scanlines drifting down, and a soft band wiping up every ~3 s.
      // The sheet itself stays nearly invisible: over a dark bay any additive
      // wash reads as a teal fog on the liners (it used to: ~0.04 linear).
      const scan: Node = smoothstep(0.55, 1.0, abs(sin(q.y.mul(height * 0.9).add(this.time.mul(3.0))))).mul(0.006);
      const band: Node = exp(abs(fract(this.time.mul(0.33)).sub(q.y)).mul(-22.0)).mul(0.03);
      // Ripple from the crossing point.
      const d: Node = length(vec2(q.x.sub(this.ship.x).mul(aspect), q.y.sub(this.ship.y)));
      const ring: Node = exp(abs(d.sub(this.ship.z.mul(0.9))).mul(-26.0)).mul(float(1).sub(this.ship.z).mul(0.9));
      const hot: Node = exp(d.mul(-9.0)).mul(max(float(0), float(1).sub(this.ship.z.mul(2.2)))).mul(0.3);
      const k: Node = float(0.003).add(edge.mul(0.06)).add(scan).add(band).add(ring).add(hot);
      return vec3(this.color).mul(k);
    })();
    mat.mrtNode = noInkMRT();
    this.mesh = new Mesh(new PlaneGeometry(width, height), mat);
    this.mesh.name = 'bay-curtain';
    this.mesh.renderOrder = 19;
    useBlendedMRT(this.mesh);
  }

  /**
   * Ship position in the curtain's local frame (x right, y up, z out of the
   * bay), or null. Drives the crossing ripple: `z` is the expanding ring
   * radius (0 → 1 over ~1.2 s after the crossing).
   */
  setShip(local: Vector3 | null, dt: number): void {
    const u = this.ship.value as Vector3;
    if (!local) {
      this.lastSide = 0;
      this.crossT = Math.min(9, this.crossT + dt);
    } else {
      const side = Math.sign(local.z) || 1;
      const inside = Math.abs(local.x) < this.width / 2 + 20 && Math.abs(local.y) < this.height / 2 + 20;
      if (this.lastSide !== 0 && side !== this.lastSide && inside) this.crossT = 0;
      else if (inside && Math.abs(local.z) < 25 && this.crossT > 1.4) this.crossT = 0.02; // brushing the sheet
      else this.crossT += dt;
      this.lastSide = side;
      u.x = local.x / this.width + 0.5;
      u.y = local.y / this.height + 0.5;
    }
    u.z = Math.min(1, this.crossT / 1.2);
  }

  update(time: number): void {
    this.time.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
