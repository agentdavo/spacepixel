import { Sprite, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';

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
  const hooks: (() => void)[] = [];
  root.traverse((o) => {
    // Owners with GPU state outside the scene graph (compute passes) leave a hook.
    if (typeof o.userData.dispose === 'function') hooks.push(o.userData.dispose as () => void);
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
  for (const h of hooks) h();
  if (parts.geometries !== false) {
    for (const g of geos) g.dispose();
    for (const i of inst) i.dispose();
  }
  if (parts.materials !== false) for (const m of mats) m.dispose();
  if (parts.textures !== false) for (const t of texs) t.dispose();
}

/** Render targets owned by nodes in a graph (RTT / convertToTexture, passes): dispose them. */
export function disposeNodeTargets(root: object): void {
  const seen = new Set<object>();
  const stack: object[] = [root];
  while (stack.length && seen.size < 20_000) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const rt = (n as { renderTarget?: { dispose?(): void } }).renderTarget;
    if (rt?.dispose) rt.dispose();
    for (const v of Object.values(n)) {
      if (!v || typeof v !== 'object') continue;
      if ((v as { isNode?: boolean }).isNode) stack.push(v);
      else if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && (x as { isNode?: boolean }).isNode) stack.push(x);
    }
  }
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

/**
 * Every texture and vertex / storage buffer the renderer uploads while a scene
 * is live, so the swap can free what no scene-graph walk reaches: ramps
 * sampled inside TSL `Fn` closures, RTT render targets, and the instance
 * buffers three's InstanceNode builds for an InstancedMesh (node attributes,
 * which neither geometry.dispose() nor mesh.dispose() release — three has no
 * BufferAttribute.dispose() yet, so this uses the renderer's attribute store).
 * Shared / cached resources are safe to free: whatever draws them next
 * re-uploads them — except three's one Sprite quad, which is skipped.
 */
type Info = Record<string, (x: never) => void>;

export class GpuEpoch {
  private textures = new Set<Texture>();
  private attributes = new Set<object>();
  private readonly keep = new Set<object>(Object.values(new Sprite().geometry.attributes));

  constructor(private readonly renderer: { info: unknown; _attributes?: { delete(a: object): unknown } }) {
    const info = renderer.info as Info;
    const wrap = (name: string, set: Set<object>, add: boolean) => {
      const f = info[name].bind(info) as (x: object) => void;
      info[name] = ((x: object) => {
        if (add) set.add(x);
        else set.delete(x);
        f(x);
      }) as (x: never) => void;
    };
    wrap('createTexture', this.textures, true);
    wrap('destroyTexture', this.textures, false);
    for (const k of ['createAttribute', 'createIndexAttribute', 'createStorageAttribute', 'createIndirectStorageAttribute']) wrap(k, this.attributes, true);
    wrap('destroyAttribute', this.attributes, false);
  }

  /** Free everything uploaded since the last flush. */
  flush(): void {
    const tex = [...this.textures];
    this.textures.clear();
    for (const t of tex) t.dispose();
    const attrs = [...this.attributes];
    this.attributes.clear();
    const store = this.renderer._attributes;
    if (store) for (const a of attrs) if (!this.keep.has(a)) store.delete(a);
  }
}

/**
 * Drop the renderer's per-scene caches that outlive a scene swap: render lists
 * (their pooled items keep every object of the last frame reachable) and the
 * render contexts keyed by MRT id (a new ink pipeline, a new key). Both are
 * rebuilt on the next render. Reaches into three.js internals, guarded.
 */
export function releaseRendererCaches(renderer: unknown): void {
  const r = renderer as { _renderLists?: { lists?: object }; _renderContexts?: { dispose?(): void } };
  const lists = r._renderLists;
  if (lists?.lists) lists.lists = new (lists.lists.constructor as new () => object)();
  r._renderContexts?.dispose?.();
}
