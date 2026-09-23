import { AdditiveBlending, BackSide, CylinderGeometry, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uniform, uv, vec3, float, fract, abs, sin, cos, pow, smoothstep, max, mix, floor } from 'three/tsl';
import { noInkMRT } from '@/render/materials/InkChannels';
import type { ShaderNode } from '@/render/tsl';

/**
 * Milestone 16 — the Lattice. Inside a Lantern jump you fly down a tunnel
 * of the Cartographers' geometry: a camera-locked tube whose walls carry
 * scrolling lattice lines in posterised, hue-cycling bands, converging on a
 * white vanishing point. Additive and unlined; the post pipeline stacks
 * radial blur, chromatic split and the white-out on top (postFx.jump).
 */
export class Hyperspace {
  readonly mesh: Mesh;
  private phase: ShaderNode = uniform(0);
  private intensity: ShaderNode = uniform(0);
  private hue: ShaderNode = uniform(0);

  constructor() {
    const geo = new CylinderGeometry(70, 70, 6000, 48, 1, true);
    geo.rotateX(Math.PI / 2); // along Z
    const mat = new MeshBasicNodeMaterial();
    mat.side = BackSide;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.colorNode = Fn(() => {
      const u = uv().x; // around
      const v = uv().y; // along (0 = far behind, 1 = far ahead)
      const along = v.mul(90.0).add(this.phase);
      // Lattice: longitudinal ribs + sweeping rings + diagonal struts.
      const ribs = smoothstep(0.44, 0.5, abs(fract(u.mul(24.0)).sub(0.5)));
      const rings = smoothstep(0.4, 0.5, abs(fract(along).sub(0.5)));
      const diag = smoothstep(0.46, 0.5, abs(fract(u.mul(12.0).add(along.mul(0.5))).sub(0.5)));
      const lines = max(ribs, max(rings.mul(0.8), diag.mul(0.6)));
      // Posterised hue bands drifting with depth.
      const band = floor(fract(along.mul(0.05).add(this.hue)).mul(4.0)).div(4.0);
      const ang = band.mul(6.2832);
      const col = vec3(cos(ang).mul(0.5).add(0.5), cos(ang.sub(2.1)).mul(0.5).add(0.5), cos(ang.sub(4.2)).mul(0.5).add(0.5));
      const tint = mix(vec3(0.35, 0.6, 1.0), col, 0.55);
      // Fade the far ends; white-hot convergence ahead.
      const ends = smoothstep(0.0, 0.25, v).mul(float(1).sub(smoothstep(0.8, 1.0, v)));
      const glow = pow(smoothstep(0.55, 1.0, v), float(4.0)).mul(3.0);
      const shimmer = sin(along.mul(0.7).add(u.mul(40.0))).mul(0.15).add(0.85);
      return tint.mul(lines.mul(ends).mul(shimmer).mul(1.8)).add(vec3(glow)).mul(this.intensity);
    })();
    mat.mrtNode = noInkMRT();
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -500;
    this.mesh.visible = false;
  }

  /** k: 0..1 visibility; speed scrolls the lattice. Mesh is camera-locked (eye-relative). */
  update(dt: number, k: number, speed: number, cameraQuat: { x: number; y: number; z: number; w: number }): void {
    this.mesh.visible = k > 0.001;
    this.intensity.value = k;
    this.phase.value -= dt * speed;
    this.hue.value += dt * 0.07;
    this.mesh.position.set(0, 0, 0);
    this.mesh.quaternion.set(cameraQuat.x, cameraQuat.y, cameraQuat.z, cameraQuat.w);
    this.mesh.rotateX(Math.PI); // tube +Z → camera forward (-Z)
  }
}
