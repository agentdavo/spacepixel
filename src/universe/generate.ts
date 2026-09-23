import { Color, Vector3 } from 'three';
import { BACKDROPS, type BackdropPreset } from '@/world/Backdrop';
import { LIGHT_PRESETS, type LightPreset } from '@/render/LightRig';
import { PLANETS, type PlanetPreset } from '@/world/Planet';
import type { ColorStop } from '@/render/materials/PaletteRamp';
import type { StarSystem, Universe } from './Universe';
import { placeStations, systemRisk } from './stations';

/**
 * Seeded Meridian Reach generator. Six hand-placed key systems anchor the
 * factions (from the series bible); procedural systems fill the gaps. Lanes
 * are an MST (guaranteed connected) plus nearest-neighbour extras, so there
 * are loops to flank through but no spaghetti. The Null Lantern hangs off a
 * single lane at the edge of the map.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface KeySystem {
  id: string;
  name: string;
  faction: StarSystem['faction'];
  x: number;
  y: number;
  blurb: string;
}

const KEYS: KeySystem[] = [
  { id: 'meridian', name: 'Meridian Prime', faction: 'concord', x: 18, y: 32, blurb: 'Concord capital. Castellan and its ring yards.' },
  { id: 'anchorage', name: 'Anchorage', faction: 'concord', x: 10, y: 14, blurb: 'Fleet yards. Every Kestrel starts here.' },
  { id: 'tessaly', name: 'Tessaly', faction: 'choir', x: 72, y: 26, blurb: 'Where the Cathedrals first came through.' },
  { id: 'hesper', name: 'Hesper Deep', faction: 'choir', x: 88, y: 40, blurb: 'The Lantern here hums on open comms.' },
  { id: 'rustwake', name: 'Rustwake Belt', faction: 'rustwake', x: 44, y: 54, blurb: 'Salvage stations and unlisted routes.' },
  { id: 'null', name: 'Null Lantern', faction: 'unknown', x: 96, y: 6, blurb: 'A gate that leads nowhere. Yet.' },
];

const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hal', 'Ise', 'Kor', 'Lys', 'Mar', 'Nov', 'Or', 'Pel', 'Quil', 'Rho', 'Sel', 'Tor', 'Ul', 'Vey', 'Wren', 'Xan', 'Yor', 'Zeph'];
const SYL_B = ['a', 'e', 'i', 'o', 'ae', 'ia', 'ou', 'y'];
const SYL_C = ['ban', 'cis', 'don', 'gard', 'hold', 'lin', 'mere', 'nor', 'phos', 'rin', 'stead', 'thos', 'vale', 'wick', 'x', 'zar'];

const STAR_CLASSES: { cls: string; color: string; w: number }[] = [
  { cls: 'M', color: '#ff9a6b', w: 0.3 },
  { cls: 'K', color: '#ffc38a', w: 0.25 },
  { cls: 'G', color: '#fff1d6', w: 0.2 },
  { cls: 'F', color: '#f5f6ff', w: 0.12 },
  { cls: 'A', color: '#d6e4ff', w: 0.09 },
  { cls: 'B', color: '#a9c6ff', w: 0.04 },
];

/** Nebula hue anchors (0..1) per faction. */
const FACTION_HUE: Record<string, number> = {
  concord: 0.72, // indigo / violet
  choir: 0.93, // crimson / magenta
  rustwake: 0.08, // amber / rust
  contested: 0.8,
  unknown: 0.5, // cold teal
};

export function generateUniverse(seed = 1994, count = 22): Universe {
  const rnd = mulberry32(seed);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

  // ── positions: keys + rejection-sampled filler ─────────────────────
  const pts: { id: string; name: string; x: number; y: number; key?: KeySystem }[] = KEYS.map((k) => ({ id: k.id, name: k.name, x: k.x, y: k.y, key: k }));
  const names = new Set(KEYS.map((k) => k.name));
  let guard = 0;
  while (pts.length < count && guard++ < 5000) {
    const x = 4 + rnd() * 88;
    const y = 4 + rnd() * 56;
    if (pts.some((p) => Math.hypot(p.x - x, p.y - y) < 11)) continue;
    let name = '';
    do name = pick(SYL_A) + pick(SYL_B) + pick(SYL_C);
    while (names.has(name));
    names.add(name);
    pts.push({ id: name.toLowerCase(), name, x, y });
  }

  // ── lanes: MST (Prim) + nearest-neighbour extras ──────────────────
  const n = pts.length;
  const d = (i: number, j: number) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  const nullIdx = pts.findIndex((p) => p.id === 'null');
  const edges = new Set<string>();
  const key = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const inTree = new Set<number>([0]);
  while (inTree.size < n - 1) {
    let best: [number, number, number] = [-1, -1, Infinity];
    for (const i of inTree)
      for (let j = 0; j < n; j++)
        if (!inTree.has(j) && j !== nullIdx && d(i, j) < best[2]) best = [i, j, d(i, j)];
    edges.add(key(best[0], best[1]));
    inTree.add(best[1]);
  }
  for (let i = 0; i < n; i++) {
    if (i === nullIdx) continue;
    const near = [...Array(n).keys()].filter((j) => j !== i && j !== nullIdx).sort((a, b) => d(i, a) - d(i, b));
    if (rnd() < 0.55 && d(i, near[1]) < 26) edges.add(key(i, near[1]));
  }
  // The Null Lantern: one lane from its nearest Choir neighbour.
  const nullNear = [...Array(n).keys()].filter((j) => j !== nullIdx).sort((a, b) => d(nullIdx, a) - d(nullIdx, b))[0];
  edges.add(key(nullIdx, nullNear));

  // ── factions by influence of key systems ─────────────────────────
  const factionOf = (i: number): StarSystem['faction'] => {
    const p = pts[i];
    if (p.key) return p.key.faction;
    const scored = KEYS.filter((k) => k.faction !== 'unknown')
      .map((k) => ({ f: k.faction, s: Math.hypot(k.x - p.x, k.y - p.y) }))
      .sort((a, b) => a.s - b.s);
    return scored[1].s - scored[0].s < 6 ? 'contested' : scored[0].f;
  };

  // ── build systems ────────────────────────────────────────────────
  const systems = new Map<string, StarSystem>();
  pts.forEach((p, i) => {
    const faction = factionOf(i);
    const star = weighted(rnd, STAR_CLASSES);
    const starColor = new Color(star.color);
    const hue = (FACTION_HUE[faction] + (rnd() - 0.5) * 0.12 + 1) % 1;
    const sys: StarSystem = {
      id: p.id,
      name: p.name,
      faction,
      map: { x: p.x, y: p.y },
      starColor,
      starClass: star.cls,
      light: p.id === 'meridian' ? LIGHT_PRESETS.meridian : makeLight(rnd, starColor, hue, p.name),
      backdrop: p.id === 'meridian' ? BACKDROPS.meridian : makeBackdrop(rnd, hue, p.name),
      planets: [],
      gates: [],
      stations: [],
      threat: faction === 'choir' ? 0.7 + rnd() * 0.3 : faction === 'contested' ? 0.4 + rnd() * 0.3 : faction === 'unknown' ? 1 : rnd() * 0.3,
      blurb: p.key?.blurb,
    };
    const planetCount = p.id === 'meridian' ? 1 : 1 + (rnd() < 0.35 ? 1 : 0);
    for (let k = 0; k < planetCount; k++) {
      const dist = 180_000 + rnd() * 260_000;
      const ang = rnd() * Math.PI * 2;
      sys.planets.push({
        preset: p.id === 'meridian' ? PLANETS.castellan : makePlanet(rnd, `${p.name} ${'IVX'[k] ?? k}`),
        position: new Vector3(Math.cos(ang) * dist, (rnd() - 0.5) * dist * 0.4, Math.sin(ang) * dist),
        tilt: [rnd() * 0.4, rnd() * 6.28, rnd() * 0.5],
      });
    }
    systems.set(p.id, sys);
  });

  // Gates face their destination on the sector map.
  for (const e of edges) {
    const [i, j] = e.split('-').map(Number);
    for (const [a, b] of [
      [i, j],
      [j, i],
    ]) {
      const dir = new Vector3(pts[b].x - pts[a].x, 0, pts[b].y - pts[a].y).normalize();
      const dist = 18_000 + rnd() * 16_000;
      systems.get(pts[a].id)!.gates.push({
        to: pts[b].id,
        position: dir.clone().multiplyScalar(dist).add(new Vector3(0, (rnd() - 0.5) * 3000, 0)),
        normal: dir,
      });
    }
  }

  // Stations last: they sit near planets and Lanterns, on their own PRNG stream.
  for (const sys of systems.values()) {
    sys.stations = placeStations(seed, {
      id: sys.id,
      name: sys.name,
      faction: sys.faction,
      planets: sys.planets.map((pl) => ({ name: pl.preset.name, position: pl.position, radius: pl.preset.radius })),
      gates: sys.gates,
    });
  }
  // Trade risk: system threat, plus the Null Lantern's shadow on its neighbours.
  const nearNull = new Set(systems.get('null')?.gates.map((g) => g.to) ?? []);
  for (const sys of systems.values()) {
    const risk = systemRisk(sys.threat, sys.faction, nearNull.has(sys.id));
    for (const st of sys.stations) st.risk = risk;
  }

  return { seed, systems, start: 'meridian' };
}

function weighted<T extends { w: number }>(rnd: () => number, items: T[]): T {
  let r = rnd() * items.reduce((s, x) => s + x.w, 0);
  for (const it of items) if ((r -= it.w) <= 0) return it;
  return items[items.length - 1];
}

const hsl = (h: number, s: number, l: number) => '#' + new Color().setHSL(((h % 1) + 1) % 1, s, l).getHexString();

function makeBackdrop(rnd: () => number, hue: number, name: string): BackdropPreset {
  const h2 = hue + 0.08 + rnd() * 0.08; // warm drift toward the core
  const nebula: ColorStop[] = [
    { at: 0.0, color: hsl(hue, 0.7, 0.012) },
    { at: 0.42, color: hsl(hue, 0.6, 0.05) },
    { at: 0.56, color: hsl(hue, 0.55, 0.1) },
    { at: 0.67, color: hsl(hue + 0.03, 0.55, 0.17) },
    { at: 0.77, color: hsl(h2, 0.6, 0.27) },
    { at: 0.86, color: hsl(h2 + 0.03, 0.65, 0.42) },
    { at: 0.94, color: hsl(h2 + 0.07, 0.8, 0.72) },
  ];
  return {
    name,
    nebula,
    wisp: hsl(hue + 0.45 + rnd() * 0.1, 0.6, 0.35),
    bandNormal: new Vector3(rnd() - 0.5, 1, rnd() - 0.5).normalize(),
    seed: rnd() * 50,
    starTint: hsl(hue + 0.5, 0.35, 0.88),
  };
}

function makeLight(rnd: () => number, star: Color, hue: number, name: string): LightPreset {
  return {
    name,
    keyDirection: new Vector3(rnd() - 0.5, 0.35 + rnd() * 0.5, rnd() - 0.5).normalize(),
    keyColor: star.clone().lerp(new Color('#ffffff'), 0.35),
    keyIntensity: 0.9 + rnd() * 0.15,
    shadowTint: new Color().setHSL(hue, 0.35, 0.32),
    rimDirection: new Vector3(rnd() - 0.5, rnd() * 0.3, rnd() - 0.5).normalize(),
    rimColor: new Color().setHSL((hue + 0.5) % 1, 0.8, 0.7),
    rimIntensity: 0.85,
    specColor: new Color('#ffffff'),
  };
}

function makePlanet(rnd: () => number, name: string): PlanetPreset {
  const h = rnd();
  const stops: ColorStop[] = [];
  const bands = 6 + Math.floor(rnd() * 4);
  for (let k = 0; k < bands; k++) {
    stops.push({ at: k / bands, color: hsl(h + (rnd() - 0.5) * 0.18, 0.35 + rnd() * 0.35, 0.35 + rnd() * 0.45) });
  }
  const ringed = rnd() < 0.4;
  return {
    name,
    radius: 25_000 + rnd() * 35_000,
    bandScale: 1.8 + rnd() * 2.4,
    turbulence: 0.08 + rnd() * 0.12,
    bands: stops,
    atmosphere: hsl(h + 0.5, 0.6, 0.75),
    ring: ringed
      ? {
          inner: 1.35 + rnd() * 0.2,
          outer: 2.0 + rnd() * 0.5,
          tilt: rnd() * 0.6,
          bands: [
            { at: 0.0, color: '#000000', alpha: 0 },
            { at: 0.06, color: hsl(h, 0.2, 0.6) },
            { at: 0.3, color: hsl(h, 0.15, 0.45) },
            { at: 0.5, color: '#000000', alpha: 0 },
            { at: 0.56, color: hsl(h, 0.2, 0.65) },
            { at: 0.93, color: '#000000', alpha: 0 },
          ],
        }
      : undefined,
  };
}

/**
 * Off-map locations the campaign visits (no lanes on the sector map):
 * the Dead Zone nebula, the Monolith's dark, and the Nexus. Each gets a
 * hand-tuned sky and light, no planets, and one Lantern home so gate
 * placements still resolve.
 */
export function specialSystem(id: string): StarSystem | null {
  const skies: Record<string, { name: string; hue: number; light: number; star: string; blurb: string }> = {
    deadzone: { name: 'The Dead Zone', hue: 0.48, light: 0.35, star: '#b8c4c0', blurb: 'Uncharted. Instruments are guesses here.' },
    monolith: { name: 'The Anchor', hue: 0.7, light: 0.08, star: '#e8ecff', blurb: 'Silence the size of a moon.' },
    nexus: { name: 'The Nexus', hue: 0.78, light: 0.25, star: '#e6d8ff', blurb: 'The road, still lit.' },
  };
  const k = skies[id];
  if (!k) return null;
  const rnd = mulberry32([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0);
  const backdrop = makeBackdrop(rnd, k.hue, k.name);
  if (id === 'monolith') {
    // Nearly empty sky: the thing itself is the only event.
    backdrop.nebula = backdrop.nebula.map((s) => ({ ...s, color: s.at < 0.9 ? '#020208' : s.color }));
  }
  const starColor = new Color(k.star);
  const light = makeLight(rnd, starColor, k.hue, k.name);
  light.keyIntensity = 0.6 + k.light;
  const dir = new Vector3(0, 0, 1);
  return {
    id,
    name: k.name,
    faction: 'unknown',
    map: { x: -1, y: -1 },
    starColor,
    starClass: '—',
    light,
    backdrop,
    planets: [],
    gates: [{ to: 'meridian', position: dir.clone().multiplyScalar(22_000), normal: dir }],
    stations: [],
    threat: id === 'deadzone' ? 0.6 : 0.3,
    blurb: k.blurb,
  };
}
