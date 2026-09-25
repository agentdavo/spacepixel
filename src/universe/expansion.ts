import { POLITIES, type PolityId } from '../content/civilizations.ts';
import { REGIONS, type RegionManifest } from '../content/regions.ts';
export interface SectorSystem { id: string; region: string; name: string; owner: PolityId | 'mixed'; x: number; y: number; links: string[]; anchor: boolean; description: string; }
export interface SectorAtlas { version: 1; seed: number; systems: SectorSystem[]; }
/** Stable UTF-16 FNV-1a: adding or reordering manifests never changes system identity. */
export function contentSeed(seed: number, id: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}
export function buildRegion(seed: number, r: RegionManifest): SectorSystem[] {
  if (r.id === 'reach') throw new Error('Reach must be supplied by the unchanged legacy generator');
  if (!Number.isInteger(r.count) || r.count < r.anchors.length || r.count < 1 || r.count > 256) throw new Error(`Invalid region size: ${r.id}`);
  const systems = Array.from({ length: r.count }, (_, i): SectorSystem => {
    const a = r.anchors[i];
    const id = `${r.id}:${a?.id ?? `survey-${String(i + 1).padStart(3, '0')}`}`;
    const h = contentSeed(seed, id);
    const owner = r.owner === 'mixed' ? (i === 1 || i % 4 === 0 ? 'pelagic' : 'mantle') : r.owner;
    return { id, region: r.id, name: a?.name ?? `${r.name} ${i + 1}`, owner,
      x: r.x + 8 + (i % 6) * 16 + (h % 500) / 100,
      y: r.y + 8 + Math.floor(i / 6) * 12 + ((h >>> 12) % 300) / 100,
      links: [], anchor: !!a, description: a?.purpose ?? `${POLITIES[owner].name} survey district. Local encounters and missions await production.` };
  });
  const join = (a: SectorSystem, b: SectorSystem) => { a.links.push(b.id); b.links.push(a.id); };
  for (let i = 1; i < systems.length; i++) join(systems[i - 1], systems[i]);
  if (systems.length > 2) join(systems[0], systems[systems.length - 1]);
  return systems;
}
export function buildAtlas(seed: number, reach: SectorSystem[], manifests: RegionManifest[] = REGIONS): SectorAtlas {
  const ids = new Set<string>();
  for (const r of manifests) { if (ids.has(r.id)) throw new Error(`Duplicate region ${r.id}`); ids.add(r.id); }
  const systems = reach.map(s => ({ ...s, links: [...s.links] }));
  for (const r of manifests) if (r.id !== 'reach') systems.push(...buildRegion(seed, r));
  // Explicit regional border corridors; do not add these to the legacy flight graph.
  const borders = [['rustwake', 'marches:threshold'], ['marches:threshold', 'pelagic:basin'], ['marches:foundry', 'mantle:council'], ['pelagic:basin', 'migrant:meeting'], ['mantle:council', 'linked:consent'], ['linked:consent', 'seedward:nursery'], ['seedward:nursery', 'archive:witness']];
  const byId = new Map(systems.map(s => [s.id, s]));
  for (const [a, b] of borders) if (byId.has(a) && byId.has(b)) { byId.get(a)!.links.push(b); byId.get(b)!.links.push(a); }
  const atlas: SectorAtlas = { version: 1, seed, systems };
  const errors = validateAtlas(atlas);
  if (errors.length) throw new Error(errors.join('\n'));
  return atlas;
}
export function validateAtlas(atlas: SectorAtlas): string[] {
  const errors: string[] = [];
  const byId = new Map(atlas.systems.map(s => [s.id, s]));
  if (byId.size !== atlas.systems.length) errors.push('Duplicate system identity');
  for (const s of atlas.systems) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) errors.push(`Invalid position ${s.id}`);
    if (new Set(s.links).size !== s.links.length) errors.push(`Duplicate route ${s.id}`);
    for (const to of s.links) if (to === s.id || !byId.get(to)?.links.includes(s.id)) errors.push(`Broken route ${s.id} -> ${to}`);
  }
  return errors;
}
export function sectorRoute(atlas: SectorAtlas, from: string, to: string, closed: ReadonlySet<string> = new Set()): string[] {
  const byId = new Map(atlas.systems.map(s => [s.id, s]));
  if (!byId.has(from) || !byId.has(to)) return [];
  const queue = [from], prev = new Map<string, string>([[from, from]]);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === to) { const path = [id]; while (path[0] !== from) path.unshift(prev.get(path[0])!); return path; }
    for (const next of byId.get(id)!.links) {
      if (prev.has(next) || closed.has([id, next].sort().join('|'))) continue;
      prev.set(next, id); queue.push(next);
    }
  }
  return [];
}

/** Background state has no meshes, flight models or wall-clock dependence. */
export function regionalEconomy(seed: number, region: string, tick: number): { supply: number; demand: number } {
  const slot = Math.max(0, Math.floor(tick / 3600));
  const h = contentSeed(seed, `${region}:economy:${slot}`);
  return { supply: 80 + h % 41, demand: 80 + (h >>> 16) % 41 };
}
