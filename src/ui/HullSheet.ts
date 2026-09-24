import { Vector3, type BufferAttribute } from 'three';
import { assets } from '@/assets/AssetLibrary';
import type { Livery } from '@/assets/Blueprint';

/**
 * A small software turntable for the shipyard: the blueprint's real hull
 * triangles (vertex livery colours) projected orthographically onto a 2D
 * canvas, back-faces culled, painter-sorted, three-tone cel lighting and a
 * heavy ink silhouette — a model-sheet cel on a CRT, without a second GPU
 * context. ~2–6k triangles per hull; redrawn at ~20 fps while visible.
 */
interface Mesh2 {
  /** Root-space triangle corners, 9 floats per triangle. */
  pos: Float32Array;
  /** sRGB colour per triangle, 3 floats. */
  col: Float32Array;
  /** Root-space normal per triangle. */
  nrm: Float32Array;
  count: number;
  centre: Vector3;
  radius: number;
  length: number;
}

const cache = new Map<string, Mesh2>();
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function extract(id: string, livery?: Partial<Livery>): Mesh2 {
  const key = `${id}:${livery ? JSON.stringify(livery) : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const model = assets.ship(id, livery);
  model.root.updateMatrixWorld(true);
  const tris: number[] = [];
  const cols: number[] = [];
  const v = new Vector3();
  for (const mesh of model.meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position') as BufferAttribute | undefined;
    const c = g.getAttribute('color') as BufferAttribute | undefined;
    if (!p) continue;
    const idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      let r = 0;
      let gg = 0;
      let b = 0;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(p, vi).applyMatrix4(mesh.matrixWorld);
        tris.push(v.x, v.y, v.z);
        if (c) {
          r += c.getX(vi);
          gg += c.getY(vi);
          b += c.getZ(vi);
        }
      }
      cols.push(c ? toSrgb(r / 3) : 0.8, c ? toSrgb(gg / 3) : 0.8, c ? toSrgb(b / 3) : 0.8);
    }
  }
  const count = tris.length / 9;
  const pos = new Float32Array(tris);
  const nrm = new Float32Array(count * 3);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = pos[o + 3] - pos[o];
    const ay = pos[o + 4] - pos[o + 1];
    const az = pos[o + 5] - pos[o + 2];
    const bx = pos[o + 6] - pos[o];
    const by = pos[o + 7] - pos[o + 1];
    const bz = pos[o + 8] - pos[o + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    nrm[t * 3] = nx;
    nrm[t * 3 + 1] = ny;
    nrm[t * 3 + 2] = nz;
    for (let k = 0; k < 9; k += 3) {
      min.min(v.set(pos[o + k], pos[o + k + 1], pos[o + k + 2]));
      max.max(v);
    }
  }
  const centre = min.clone().add(max).multiplyScalar(0.5);
  const m: Mesh2 = { pos, col: new Float32Array(cols), nrm, count, centre, radius: max.clone().sub(min).length() * 0.5, length: max.z - min.z };
  cache.set(key, m);
  return m;
}

export class HullSheet {
  private ctx: CanvasRenderingContext2D;
  private mesh: Mesh2 | null = null;
  private order = new Uint32Array(0);
  private depth = new Float32Array(0);
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private raf = 0;
  private last = 0;
  private yaw0 = 0;
  /** Pitch of the view (radians, looking down on the hull). */
  pitch = 0.42;
  /** Caption drawn in the frame corner. */
  caption = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** `t0`: the clock `draw(time)` will be driven with (default wall time) — the turntable starts there. */
  setHull(blueprint: string, livery?: Partial<Livery>, t0?: number): void {
    this.mesh = extract(blueprint, livery);
    const n = this.mesh.count;
    this.order = new Uint32Array(n);
    this.depth = new Float32Array(n);
    this.sx = new Float32Array(n * 3);
    this.sy = new Float32Array(n * 3);
    this.yaw0 = t0 ?? performance.now() / 1000;
  }

  start(): void {
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (t - this.last < 50) return; // ~20 fps is plenty for a turntable
      this.last = t;
      this.draw(t / 1000);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  draw(time: number): void {
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    const H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    // Reference grid: a drafting-table floor.
    c.strokeStyle = 'rgba(125,255,178,0.08)';
    c.lineWidth = 1;
    for (let x = (W % 24) / 2; x < W; x += 24) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = (H % 24) / 2; y < H; y += 24) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    const m = this.mesh;
    if (!m) return;
    const yaw = 0.9 + (time - this.yaw0) * 0.45;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const scale = (Math.min(W * 0.92, H * 1.5) / (m.radius * 2)) * 0.98;
    const ox = W / 2;
    const oy = H / 2;
    const { pos, nrm, col } = m;
    const ctr = m.centre;
    // Light in view space (upper left, toward the viewer).
    const lx = -0.45;
    const ly = 0.65;
    const lz = 0.62;
    let vis = 0;
    const rot = (x: number, y: number, z: number, out: number[]) => {
      // yaw about Y, then pitch about X; view looks down −Z.
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      out[0] = x1;
      out[1] = y * cp - z1 * sp;
      out[2] = y * sp + z1 * cp;
    };
    const r3 = [0, 0, 0];
    const light = new Float32Array(m.count);
    for (let t = 0; t < m.count; t++) {
      rot(nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2], r3);
      if (r3[2] <= 0.02) continue; // back face (view looks down −Z: facing us = +Z)
      light[t] = r3[0] * lx + r3[1] * ly + r3[2] * lz;
      let dz = 0;
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        rot(pos[o + k * 3] - ctr.x, pos[o + k * 3 + 1] - ctr.y, pos[o + k * 3 + 2] - ctr.z, r3);
        this.sx[t * 3 + k] = ox + r3[0] * scale;
        this.sy[t * 3 + k] = oy - r3[1] * scale;
        dz += r3[2];
      }
      this.depth[t] = dz;
      this.order[vis++] = t;
    }
    const ord = this.order.subarray(0, vis);
    const depth = this.depth;
    ord.sort((a, b) => depth[a] - depth[b]);
    const path = (t: number) => {
      c.beginPath();
      c.moveTo(this.sx[t * 3], this.sy[t * 3]);
      c.lineTo(this.sx[t * 3 + 1], this.sy[t * 3 + 1]);
      c.lineTo(this.sx[t * 3 + 2], this.sy[t * 3 + 2]);
      c.closePath();
    };
    // Ink: every visible face stroked fat in black first → a silhouette line.
    c.lineJoin = 'round';
    c.fillStyle = c.strokeStyle = '#050409';
    c.lineWidth = 3.2 * dpr;
    for (const t of ord) {
      path(t);
      c.fill();
      c.stroke();
    }
    // Cel paint: three tones.
    c.lineWidth = 0.7;
    for (const t of ord) {
      const L = light[t];
      const k = L > 0.55 ? 1.02 : L > 0.12 ? 0.74 : 0.5;
      const r = Math.min(255, col[t * 3] * 255 * k) | 0;
      const g = Math.min(255, col[t * 3 + 1] * 255 * k) | 0;
      const b = Math.min(255, col[t * 3 + 2] * 255 * k) | 0;
      const s = `rgb(${r},${g},${b})`;
      c.fillStyle = s;
      c.strokeStyle = s;
      path(t);
      c.fill();
      c.stroke();
    }
    // Frame marks + caption.
    c.strokeStyle = 'rgba(125,255,178,0.6)';
    c.lineWidth = 1.5 * dpr;
    const q = 14 * dpr;
    for (const [x, y, dx, dy] of [
      [4, 4, 1, 1],
      [W - 4, 4, -1, 1],
      [4, H - 4, 1, -1],
      [W - 4, H - 4, -1, -1],
    ]) {
      c.beginPath();
      c.moveTo(x + dx * q, y);
      c.lineTo(x, y);
      c.lineTo(x, y + dy * q);
      c.stroke();
    }
    if (this.caption) {
      c.font = `${11 * dpr}px "Share Tech Mono", monospace`;
      c.fillStyle = 'rgba(125,255,178,0.75)';
      c.fillText(this.caption, 12 * dpr, H - 12 * dpr);
    }
  }
}
