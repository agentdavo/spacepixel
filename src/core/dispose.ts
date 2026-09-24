import type { BufferGeometry, Material, Object3D, Texture } from 'three';

/**
 * Free the GPU side of everything under `root`: geometries, materials and the
 * textures they hold directly. Safe on shared (cached) resources — three.js
 * re-uploads anything that is drawn again — so scene swaps (the attract loop:
 * title → prologue → title → trailer …) don't pile up buffers and pipelines.
 */
export function disposeTree(root: Object3D): void {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  const texs = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (m.geometry?.dispose) geos.add(m.geometry);
    const mat = m.material;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) mats.add(x);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && typeof v === 'object' && (v as Texture).isTexture) texs.add(v as Texture);
  }
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  for (const t of texs) t.dispose();
}
