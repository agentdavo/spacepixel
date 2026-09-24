import type { BufferGeometry, Material, Object3D, Texture } from 'three';

/**
 * Free the GPU side of everything under `root`: geometries, materials and the
 * textures they hold directly. Safe on shared (cached) resources — three.js
 * re-uploads anything that is drawn again — so scene swaps (the attract loop:
 * title → prologue → title → trailer …) don't pile up buffers and pipelines.
 */
export interface DisposeParts {
  geometries?: boolean;
  materials?: boolean;
  textures?: boolean;
}

/** `?dispose=geo,mat,tex,ink` picks what scene swaps free (A/B for GPU validation); default: all. */
export const DISPOSE_PARTS: DisposeParts & { ink: boolean } = (() => {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('dispose') : null;
  const has = (k: string) => v === null || v.split(',').includes(k);
  return { geometries: has('geo'), materials: has('mat'), textures: has('tex'), ink: has('ink') };
})();

export function disposeTree(root: Object3D, parts: DisposeParts = DISPOSE_PARTS): void {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  const texs = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; isSprite?: boolean };
    // Sprites share one interleaved quad across every instance (three.js): freeing it
    // leaves live bind groups on a destroyed buffer. Interleaved geometry stays.
    const g = m.geometry;
    if (g?.dispose && !m.isSprite && !Object.values(g.attributes).some((a) => (a as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute)) geos.add(g);
    const mat = m.material;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) mats.add(x);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && typeof v === 'object' && (v as Texture).isTexture) texs.add(v as Texture);
  }
  if (parts.geometries !== false) for (const g of geos) g.dispose();
  if (parts.materials !== false) for (const m of mats) m.dispose();
  if (parts.textures !== false) for (const t of texs) t.dispose();
}
