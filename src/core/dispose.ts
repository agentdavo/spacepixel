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
  const inst: (Object3D & { dispose(): void })[] = [];
  root.traverse((o) => {
    const m = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; isSprite?: boolean };
    // Sprites share one interleaved quad across every instance (three.js): freeing it
    // leaves live bind groups on a destroyed buffer, so sprites keep theirs.
    const g = m.geometry;
    if (g?.dispose && !m.isSprite) geos.add(g);
    // Instanced meshes own their instance matrix / colour buffers.
    if ((o as { isInstancedMesh?: boolean }).isInstancedMesh) inst.push(o as Object3D & { dispose(): void });
    const mat = m.material;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) mats.add(x);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) {
      if (!v || typeof v !== 'object') continue;
      if ((v as Texture).isTexture) texs.add(v as Texture);
      else if ((v as { isNode?: boolean }).isNode) nodeTextures(v, texs);
    }
  }
  if (parts.geometries !== false) {
    for (const g of geos) g.dispose();
    for (const i of inst) i.dispose();
  }
  if (parts.materials !== false) for (const m of mats) m.dispose();
  if (parts.textures !== false) for (const t of texs) t.dispose();
}

/** Textures a node graph samples (TSL `texture(t)` nodes), found by walking the graph. */
function nodeTextures(root: object, out: Set<Texture>, seen = new Set<object>()): void {
  const stack: object[] = [root];
  while (stack.length && seen.size < 20_000) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const v of Object.values(n)) {
      if (!v || typeof v !== 'object') continue;
      if ((v as Texture).isTexture) out.add(v as Texture);
      else if ((v as { isNode?: boolean }).isNode) stack.push(v);
      else if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && (x as { isNode?: boolean }).isNode) stack.push(x);
    }
  }
}
