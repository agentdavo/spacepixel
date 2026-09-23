import { BufferAttribute, BufferGeometry, Material, Mesh, Object3D, Plane, Vector3 } from 'three';

/** Seeded PRNG (mulberry32). */
export function mulberry(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric seed from a tag. */
export function seedOf(tag: string): number {
  let h = 2166136261;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export interface GeometryPiece {
  geometry: BufferGeometry;
  /** Piece centroid in the source geometry's frame (the geometry is re-centred on it). */
  centre: Vector3;
}

/**
 * Break a mesh geometry into chunks by the sign pattern of its triangle
 * centroids against `planes` (up to 2^n pieces). Each chunk is re-centred on
 * its own centroid so it can tumble about itself. Keeps every attribute, so
 * vertex-painted cel hulls stay painted and panel-lined.
 */
export function splitGeometry(src: BufferGeometry, planes: Plane[], minTriangles = 12): GeometryPiece[] {
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute('position');
  const triCount = Math.floor(pos.count / 3);
  const bucketOf = new Uint8Array(triCount);
  const counts = new Map<number, number>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    a.add(b).add(c).multiplyScalar(1 / 3);
    let key = 0;
    planes.forEach((p, i) => {
      if (p.distanceToPoint(a) > 0) key |= 1 << i;
    });
    bucketOf[t] = key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const names = Object.keys(g.attributes);
  const out: GeometryPiece[] = [];
  for (const [key, n] of counts) {
    if (n < minTriangles) continue;
    const geo = new BufferGeometry();
    const arrays = names.map((name) => {
      const attr = g.getAttribute(name) as BufferAttribute;
      return { name, size: attr.itemSize, src: attr.array as ArrayLike<number>, dst: new Float32Array(n * 3 * attr.itemSize) };
    });
    let w = 0;
    for (let t = 0; t < triCount; t++) {
      if (bucketOf[t] !== key) continue;
      for (const arr of arrays) {
        const s = arr.size * 3;
        for (let k = 0; k < s; k++) arr.dst[w * s + k] = arr.src[t * s + k];
      }
      w++;
    }
    for (const arr of arrays) geo.setAttribute(arr.name, new BufferAttribute(arr.dst, arr.size));
    geo.computeBoundingBox();
    const centre = geo.boundingBox!.getCenter(new Vector3());
    geo.translate(-centre.x, -centre.y, -centre.z);
    geo.computeBoundingSphere();
    out.push({ geometry: geo, centre });
  }
  return out;
}

/** Dispose every geometry under `root`, plus the materials listed in `owned`. */
export function disposeTree(root: Object3D, owned: Material[] = []): void {
  root.removeFromParent();
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  for (const m of owned) m.dispose();
}
