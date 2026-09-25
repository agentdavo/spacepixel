import { Color, Vector3 } from 'three';
import type { PlanetKind, PlanetPreset } from '../world/Planet';
import type { ColorStop } from '../render/materials/PaletteRamp';
import type { MoonSite, PlanetSite, StarSystem } from './Universe';

/**
 * The survey pass: planets, moons and landmarks for every system.
 *
 * Pure and deterministic, on its own PRNG stream per system (seed, id), run
 * AFTER the main generator and station placement — so the Reach's lanes,
 * gates, planet positions and stations (and every campaign position built on
 * them) are exactly what they were. It only:
 *
 *  - gives each original planet a kind, a look and a line of flavour
 *    (name, position, radius and ring are untouched),
 *  - hangs moons on planets (orbits outside rings and station altitudes),
 *  - appends new planets and landmark bodies (shattered moons, Lantern-lit
 *    worlds, burning worlds) well clear of everything else.
 *
 * Units: metres, system-local (StarSystemView adds SYSTEM_OFFSET).
 */

export const KIND_LABEL: Record<PlanetKind, string> = {
  gas: 'gas giant',
  'ice-giant': 'ice giant',
  rocky: 'rocky world',
  desert: 'desert world',
  ocean: 'ocean world',
  ice: 'ice world',
  volcanic: 'volcanic world',
  burning: 'burning world',
  lantern: 'Lantern-lit world',
  shattered: 'shattered moon',
};

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

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Rnd = () => number;
const pick = <T>(rnd: Rnd, a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
function weighted<T>(rnd: Rnd, items: readonly [T, number][]): T {
  let r = rnd() * items.reduce((s, x) => s + x[1], 0);
  for (const [it, w] of items) if ((r -= w) <= 0) return it;
  return items[items.length - 1][0];
}
const hsl = (h: number, s: number, l: number) => '#' + new Color().setHSL(((h % 1) + 1) % 1, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l))).getHexString();
/** Shift a hex colour's hue / lightness a little (palette variety per world). */
function nudge(hex: string, dh: number, dl: number): string {
  const c = new Color(hex);
  const o = { h: 0, s: 0, l: 0 };
  c.getHSL(o);
  return hsl(o.h + dh, o.s, o.l + dl);
}

// ── palettes (height ramps; hard stops = painted contour bands) ─────────

const TERRAIN: Record<Exclude<PlanetKind, 'gas' | 'ice-giant'>, ColorStop[]> = {
  rocky: [
    { at: 0.0, color: '#2f2a28' },
    { at: 0.3, color: '#4f4640' },
    { at: 0.48, color: '#6f6152' },
    { at: 0.62, color: '#93806a' },
    { at: 0.78, color: '#bba98e' },
  ],
  desert: [
    { at: 0.0, color: '#6a3a22' },
    { at: 0.28, color: '#9a5a32' },
    { at: 0.45, color: '#c7874d' },
    { at: 0.6, color: '#e2b173' },
    { at: 0.78, color: '#f3d9a6' },
  ],
  ocean: [
    { at: 0.0, color: '#0c2458' },
    { at: 0.36, color: '#16408a' },
    { at: 0.47, color: '#2d6db8' },
    { at: 0.515, color: '#d9c890' },
    { at: 0.535, color: '#4a8a48' },
    { at: 0.64, color: '#356a36' },
    { at: 0.76, color: '#86785a' },
    { at: 0.86, color: '#eef2f6' },
  ],
  ice: [
    { at: 0.0, color: '#5d7ea6' },
    { at: 0.32, color: '#8fb3d6' },
    { at: 0.52, color: '#c3dcef' },
    { at: 0.72, color: '#eaf6ff' },
  ],
  volcanic: [
    { at: 0.0, color: '#171213' },
    { at: 0.36, color: '#2a211f' },
    { at: 0.58, color: '#433530' },
    { at: 0.8, color: '#665247' },
  ],
  burning: [
    { at: 0.0, color: '#3a1208' },
    { at: 0.4, color: '#5c1c0c' },
    { at: 0.46, color: '#2c2320' },
    { at: 0.66, color: '#443630' },
    { at: 0.84, color: '#5e4a3c' },
  ],
  lantern: [
    { at: 0.0, color: '#120e22' },
    { at: 0.38, color: '#221b3a' },
    { at: 0.6, color: '#3a3060' },
    { at: 0.82, color: '#6d62a0' },
  ],
  shattered: [
    { at: 0.0, color: '#3a3634' },
    { at: 0.45, color: '#5a524c' },
    { at: 0.75, color: '#8a7e70' },
  ],
};

const ATMO: Record<PlanetKind, string> = {
  gas: '#9fdcff',
  'ice-giant': '#bff4ff',
  rocky: '#c6d2ea',
  desert: '#ffc890',
  ocean: '#8fd4ff',
  ice: '#d4f2ff',
  volcanic: '#ff9a60',
  burning: '#ffb070',
  lantern: '#c99bff',
  shattered: '#000000',
};

const GLOW: Partial<Record<PlanetKind, string>> = {
  volcanic: '#ff6a1f',
  burning: '#ffb03a',
  lantern: '#b77bff',
};

const LIGHT_COLOR: Record<string, string> = {
  concord: '#ffd08a',
  choir: '#ff9fe2',
  rustwake: '#ffb45e',
};

function gasBands(rnd: Rnd, h: number, sat: number): ColorStop[] {
  const stops: ColorStop[] = [];
  const n = 6 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) stops.push({ at: k / n, color: hsl(h + (rnd() - 0.5) * 0.16, sat * (0.6 + rnd() * 0.6), 0.38 + rnd() * 0.42) });
  return stops;
}

function ringBands(rnd: Rnd, h: number): NonNullable<PlanetPreset['ring']> {
  return {
    inner: 1.4 + rnd() * 0.2,
    outer: 2.0 + rnd() * 0.4,
    tilt: rnd() * 0.5,
    bands: [
      { at: 0.0, color: '#000000', alpha: 0 },
      { at: 0.06, color: hsl(h, 0.2, 0.62) },
      { at: 0.28, color: hsl(h, 0.14, 0.46) },
      { at: 0.46, color: '#000000', alpha: 0 },
      { at: 0.52, color: hsl(h + 0.04, 0.22, 0.68) },
      { at: 0.84, color: hsl(h, 0.16, 0.54) },
      { at: 0.93, color: '#000000', alpha: 0 },
    ],
  };
}

/** A fresh look for `kind` (radius is the caller's). */
function makeLook(rnd: Rnd, kind: PlanetKind, name: string, radius: number): PlanetPreset {
  const seed = Math.floor(rnd() * 997);
  const dh = (rnd() - 0.5) * 0.06;
  const base: PlanetPreset = { name, radius, kind, seed, bandScale: 2.4, turbulence: 0.12, bands: [], atmosphere: ATMO[kind] };
  switch (kind) {
    case 'gas': {
      const h = rnd();
      base.bands = gasBands(rnd, h, 0.5);
      base.bandScale = 1.8 + rnd() * 2.4;
      base.turbulence = 0.08 + rnd() * 0.12;
      base.atmosphere = hsl(h + 0.5, 0.6, 0.75);
      if (rnd() < 0.55) base.storm = { lat: (rnd() - 0.5) * 0.9, lon: rnd() * 6.28, size: 0.16 + rnd() * 0.14, color: hsl(h + 0.05 + rnd() * 0.08, 0.6, 0.62) };
      break;
    }
    case 'ice-giant': {
      const h = 0.48 + rnd() * 0.12;
      base.bands = gasBands(rnd, h, 0.45);
      base.bandScale = 1.2 + rnd() * 1.2;
      base.turbulence = 0.04 + rnd() * 0.05;
      if (rnd() < 0.4) base.storm = { lat: (rnd() - 0.5) * 0.8, lon: rnd() * 6.28, size: 0.12 + rnd() * 0.1, color: hsl(h - 0.05, 0.4, 0.82) };
      break;
    }
    default: {
      base.bands = TERRAIN[kind].map((s) => ({ ...s, color: nudge(s.color, dh, (rnd() - 0.5) * 0.04) }));
      base.bandScale = 1.6 + rnd() * 1.6; // terrain feature frequency
      base.turbulence = 0.9 + rnd() * 0.3; // height contrast
      base.glow = GLOW[kind];
      if (kind === 'ocean') {
        base.seaLevel = 0.515;
        base.clouds = 0.45 + rnd() * 0.25;
        base.caps = 0.82;
        if (rnd() < 0.5) base.storm = { lat: (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.3), lon: rnd() * 6.28, size: 0.14 + rnd() * 0.08, color: '#f4f8ff' };
      }
      if (kind === 'desert') {
        base.clouds = rnd() * 0.12;
        base.caps = 0.9;
      }
      if (kind === 'ice') base.caps = 0.55;
      if (kind === 'rocky') {
        base.airless = rnd() < 0.5;
        base.clouds = base.airless ? 0 : rnd() * 0.2;
      }
      if (kind === 'shattered') base.airless = true;
      if (kind === 'burning') base.clouds = 0.2; // smoke
    }
  }
  return base;
}

// ── flavour ─────────────────────────────────────────────────────────────

const FLAVOUR: Record<PlanetKind, string[]> = {
  gas: [
    'Banded hydrogen giant; the skimmers name its storms after creditors.',
    'Slow-banded giant with Ebon traces in the upper decks, too thin to pay.',
    'Its shepherd moons were catalogued in the Timetable era and never since.',
    'A pale giant that sings on the long bands; pilots mute it and fly on.',
    'Hydrogen giant ringed in weather older than the Shattering.',
  ],
  'ice-giant': [
    'Cold blue giant; methane rain and a sky nobody has surveyed since the Dark.',
    'Ice giant with a diamond-hail core, according to a Timetable plaque.',
    'Teal and quiet. Couriers use it to hide from their own schedules.',
  ],
  rocky: [
    'Cratered rock with a Timetable-era survey claim nobody can afford to work.',
    'Airless grey world; the old maps call it a waypoint, and it was.',
    'Bare stone and old strip-mines, the tailings arranged in counted rows.',
  ],
  desert: [
    'Dust world under an amber sky; the dunes move faster than the settlers.',
    'Ochre desert with glassed plains where something landed badly, long ago.',
    'Dry world of canyons and salt pans. Water is priced by the gram here too.',
  ],
  ocean: [
    'Blue ocean world; the domed shelves feed half the lane.',
    'Storm-wracked water world, its archipelagos lit like a ledger at night.',
    'Deep ocean under white weather; kelp-farms and tether towns on the shelves.',
  ],
  ice: [
    'Frozen world with a shallow sea under the ice. Nobody has drilled for it.',
    'Glacier world; its cap is scored with the tracks of Timetable crawlers.',
    'White and silent. The ice keeps everything, including the dead.',
  ],
  volcanic: [
    'Black basalt and fire-lines; the crust never cools long enough to claim.',
    'Volcanic world bleeding sulphur into a hot orange sky.',
    'Lava-veined rock that lights its own night side.',
  ],
  burning: ['A world on fire from pole to pole.'],
  lantern: ['A dark world threaded with black light.'],
  shattered: ['A moon broken into drifting pieces.'],
};

const MOON_NAMES: Record<string, string[]> = {
  concord: ['Tally', 'Ledger', 'Gram', 'Tithe', 'Quota', 'Ration', 'Warrant', 'Docket', 'Sextant', 'Vigil', 'Plumb', 'Candle'],
  choir: ['Psalm', 'Antiphon', 'Vespers', 'Matins', 'Canticle', 'Cantus', 'Descant', 'Litany', 'Tierce', 'Nones', 'Compline', 'Chime'],
  rustwake: ['Scrap', 'Tinder', 'Hook', 'Clinker', 'Dross', 'Rivet', 'Bilge', 'Jetsam', 'Flotsam', 'Ballast', 'Tally-Stick', 'Wick'],
  unknown: ['Silence', 'Zero', 'Absence', 'Echo'],
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function factionKey(sys: StarSystem): 'concord' | 'choir' | 'rustwake' | 'unknown' {
  return sys.faction === 'contested' ? 'rustwake' : sys.faction === 'concord' || sys.faction === 'choir' || sys.faction === 'rustwake' ? sys.faction : 'unknown';
}

// ── hand-authored anchors (the series bible's systems) ──────────────────

interface BodySpec {
  name?: string;
  kind?: PlanetKind;
  description?: string;
  landmark?: string;
  lights?: number;
  radius?: number;
  storm?: PlanetPreset['storm'];
}

interface KeyBodies {
  /** Per original planet index: kind / flavour overrides. */
  planets?: Record<number, BodySpec>;
  /** Per original planet index: authored moons. */
  moons?: Record<number, BodySpec[]>;
  /** Extra bodies appended to the system. */
  extra?: BodySpec[];
}

const KEY_BODIES: Record<string, KeyBodies> = {
  meridian: {
    planets: {
      0: {
        description: 'Directorate capital giant. The Counting House turns on the inner ring; the ring yards never sleep.',
        storm: { lat: -0.34, lon: 2.2, size: 0.2, color: '#f6d6a8' },
      },
    },
    moons: {
      0: [
        { name: 'Vigil', kind: 'ice', lights: 0.55, description: 'Ice moon. The Allocation Hour relay counts the Directorate down from its north pole.' },
        { name: "Tey's Quarry", kind: 'rocky', description: 'Strip-mined to the mantle for the first Tey works. The pits still steam.' },
      ],
    },
    extra: [{ name: 'Meridian III', kind: 'desert', description: 'Dust world under a survey claim nobody has had the allocation to exercise.' }],
  },
  anchorage: {
    planets: { 0: { kind: 'ocean', description: 'Anchorage I: grey seas and fleet housing; every Kestrel pilot was schooled on its shelves.' } },
    extra: [
      {
        name: 'The Graveyard Moon',
        kind: 'shattered',
        landmark: 'shattered moon',
        description: 'Broken when the Great Lantern cracked. Its pieces still drift outward at the speed they left.',
      },
    ],
  },
  tessaly: {
    planets: { 0: { description: 'Ringed skim-giant under the red giant. The Ebon-fields ride its upper bands.' } },
    extra: [{ name: 'Cinder', kind: 'burning', landmark: 'burning world', description: "Inside the red giant's last shell. Its crust boils every ninety hours." }],
  },
  hesper: {
    planets: { 0: { kind: 'ocean', lights: 1, description: 'Hesper Deep I: the Spire stands on its shelf-sea, singing up the tether.' } },
    extra: [
      {
        name: "Hesper's Lamp",
        kind: 'lantern',
        landmark: 'Lantern-lit world',
        description: 'Veined with black light since the Relighting. The Hegemony calls it the Lantern’s reflection.',
      },
    ],
  },
  rustwake: {
    planets: { 0: { description: 'The skim-giant the Ember is slowly eating. The clans hold their moot in its shadow.' } },
    extra: [{ name: 'Slagheart', kind: 'burning', landmark: 'burning world', description: 'Swallowed by the Ember’s breath. The clans skim its boil-off and sing about it.' }],
  },
  null: {
    planets: { 0: { kind: 'ice', description: 'Dead ice world at the last lit Lantern. Picket crews count its craters on long watches.' } },
    extra: [{ name: 'The Counted Moon', kind: 'shattered', landmark: 'shattered moon', description: 'Split along fault lines at prime-numbered intervals. Nobody likes that.' }],
  },
  corouhold: {
    planets: { 0: { kind: 'gas', description: 'Rustwake-held giant with lethal radiation belts. The Long Patience is somewhere in its dark.', storm: { lat: 0.22, lon: 4.1, size: 0.24, color: '#e0a060' } } },
  },
  zephacis: {
    planets: { 1: { description: 'The ringed giant of the border. Both navies claim its shadow.' } },
  },
  lysowick: {
    planets: { 0: { kind: 'rocky', description: 'Debris of Engagements 71, 88, 102 and 114 hangs in its orbit, layered like pressed flowers.' } },
  },
};

// ── moons ───────────────────────────────────────────────────────────────

/** Universe-space moon position at time `t` (seconds) around `parent`. */
export function moonPosition(parent: Vector3, m: MoonSite, t: number, out = new Vector3()): Vector3 {
  const th = m.phase + (t / m.period) * Math.PI * 2;
  const x = Math.cos(th) * m.orbit;
  const z = Math.sin(th) * m.orbit;
  // Incline about X, then rotate the node about Y.
  const y = -z * Math.sin(m.incline);
  const zi = z * Math.cos(m.incline);
  const cn = Math.cos(m.node);
  const sn = Math.sin(m.node);
  return out.set(parent.x + x * cn + zi * sn, parent.y + y, parent.z - x * sn + zi * cn);
}

function makeMoons(rnd: Rnd, sys: StarSystem, pl: PlanetSite, specs: BodySpec[] | undefined, used: Set<string>): MoonSite[] {
  const R = pl.preset.radius;
  const kind = pl.preset.kind ?? 'gas';
  const giant = kind === 'gas' || kind === 'ice-giant';
  const minOrbit = R * (pl.preset.ring ? pl.preset.ring.outer + 0.5 : 2.6);
  const maxOrbit = Math.min(R * 5.2, pl.position.length() * 0.45);
  if (maxOrbit < minOrbit + R * 0.4) return [];
  const count = specs ? specs.length : giant ? 1 + Math.floor(rnd() * 3) : rnd() < 0.5 ? 1 : 0;
  const names = MOON_NAMES[factionKey(sys)];
  const out: MoonSite[] = [];
  for (let i = 0; i < count; i++) {
    const spec = specs?.[i];
    const mk: PlanetKind = spec?.kind ?? weighted<PlanetKind>(rnd, [['rocky', 4], ['ice', 3], ['volcanic', 1], ['desert', 1]]);
    let name = spec?.name ?? '';
    for (let tries = 0; !name || used.has(name); tries++) name = pick(rnd, names) + (tries > 6 ? ` ${ROMAN[tries % 10]}` : '');
    used.add(name);
    const mr = spec?.radius ?? Math.max(2600, R * (0.07 + rnd() * 0.13));
    const preset = makeLook(rnd, mk, name, mr);
    preset.bandScale *= 1.4;
    if (spec?.lights) {
      preset.lights = spec.lights;
      preset.lightColor = LIGHT_COLOR[factionKey(sys)] ?? LIGHT_COLOR.concord;
    }
    const frac = count === 1 ? 0.35 + rnd() * 0.4 : i / Math.max(1, count - 1);
    out.push({
      preset,
      description: spec?.description ?? `Moon of ${pl.preset.name}. ${pick(rnd, FLAVOUR[mk])}`,
      landmark: spec?.landmark,
      orbit: minOrbit + (maxOrbit - minOrbit) * Math.min(1, frac * 0.85 + rnd() * 0.15),
      period: 900 + rnd() * 2400,
      phase: rnd() * Math.PI * 2,
      incline: (rnd() - 0.5) * 0.3 + (pl.preset.ring?.tilt ?? 0) * 0.5,
      node: rnd() * Math.PI * 2,
    });
  }
  return out;
}

// ── the pass ────────────────────────────────────────────────────────────

/** Describe and furnish one system in place (idempotent per system: call once). */
export function surveySystem(seed: number, sys: StarSystem): void {
  const rnd = mulberry32(hashStr(`${seed}:bodies:${sys.id}`));
  const key = KEY_BODIES[sys.id] ?? {};
  const fk = factionKey(sys);
  const lightColor = LIGHT_COLOR[fk] ?? LIGHT_COLOR.concord;

  // 1. Original planets: kind, look, flavour. Position/radius/ring/name stay.
  sys.planets.forEach((pl, i) => {
    const over = key.planets?.[i];
    const docks = sys.stations.filter((st) => st.planet === i);
    const inhabited = docks.some((st) => st.kind === 'orbital');
    const skimmed = docks.some((st) => st.kind === 'refinery');
    let kind: PlanetKind;
    if (over?.kind) kind = over.kind;
    else if (pl.preset.ring || skimmed || sys.id === 'meridian') kind = 'gas';
    else if (inhabited) kind = weighted<PlanetKind>(rnd, [['ocean', 4], ['desert', 2.5], ['rocky', 2], ['ice', 1.5]]);
    else kind = weighted<PlanetKind>(rnd, [['gas', 4.5], ['ice-giant', 1], ['rocky', 1.5], ['desert', 1], ['ice', 1], ['volcanic', 1]]);
    const look = makeLook(rnd, kind, pl.preset.name, pl.preset.radius);
    if (kind === 'gas' && !over?.kind) {
      // Keep the original banded paint (its identity); only add weather.
      pl.preset = { ...pl.preset, kind, seed: look.seed, storm: over?.storm ?? look.storm };
    } else {
      pl.preset = { ...look, ring: pl.preset.ring, storm: over?.storm ?? look.storm };
    }
    if (inhabited || over?.lights) {
      const k = pl.preset.kind ?? 'gas';
      if (k !== 'gas' && k !== 'ice-giant') {
        pl.preset.lights = over?.lights ?? 1;
        pl.preset.lightColor = lightColor;
      }
    }
    const who = docks.map((d) => d.name);
    pl.description =
      over?.description ??
      `${pick(rnd, FLAVOUR[kind])}${who.length ? ` ${who[0]} ${inhabited ? 'keeps the tether down to the surface' : 'skims its upper bands'}.` : ''}`;
  });

  // 2. New bodies: a planet or two, plus an occasional landmark.
  const extra: BodySpec[] = [...(key.extra ?? [])];
  if (!key.extra && sys.faction !== 'unknown') {
    const n = 1 + (rnd() < 0.45 ? 1 : 0);
    for (let k = 0; k < n; k++) extra.push({ kind: weighted<PlanetKind>(rnd, [['gas', 3], ['ice-giant', 1.2], ['rocky', 2], ['desert', 1.4], ['ice', 1.4], ['volcanic', 1.2], ['ocean', 0.6]]) });
    const lm = rnd();
    const chance = sys.faction === 'contested' ? 0.5 : 0.3;
    if (lm < chance) {
      const kind = weighted<PlanetKind>(rnd, [
        ['shattered', sys.faction === 'contested' ? 3 : 1.5],
        ['lantern', sys.faction === 'choir' ? 3 : 0.8],
        ['burning', sys.starClass === 'M' || sys.starClass === 'K' ? 2.5 : 1],
      ]);
      extra.push({ kind, landmark: KIND_LABEL[kind] });
    }
  }
  const taken = new Set(sys.planets.map((p) => p.preset.name));
  let numeral = 1;
  for (const spec of extra) {
    const kind = spec.kind ?? 'rocky';
    let name = spec.name ?? '';
    while (!name || taken.has(name)) name = spec.landmark && !spec.name ? landmarkName(rnd, kind, sys) : `${sys.name} ${ROMAN[numeral++] ?? numeral}`;
    taken.add(name);
    const radius =
      spec.radius ??
      (kind === 'gas' ? 36_000 + rnd() * 24_000 : kind === 'ice-giant' ? 28_000 + rnd() * 16_000 : kind === 'shattered' ? 7000 + rnd() * 4000 : kind === 'burning' || kind === 'lantern' ? 16_000 + rnd() * 10_000 : 12_000 + rnd() * 16_000);
    const position = placeBody(rnd, sys, radius);
    if (!position) continue;
    const preset = makeLook(rnd, kind, name, radius);
    if (kind === 'gas' && rnd() < 0.45) preset.ring = ringBands(rnd, rnd());
    if (kind === 'lantern') preset.lights = 0; // the veins are the lights
    const site: PlanetSite = {
      preset,
      position,
      tilt: [rnd() * 0.4, rnd() * 6.28, rnd() * 0.5],
      added: true,
      landmark: spec.landmark,
      description: spec.description ?? landmarkFlavour(rnd, kind, sys) ?? pick(rnd, FLAVOUR[kind]),
    };
    sys.planets.push(site);
  }

  // 3. Moons, last, on every planet (authored ones on key planets).
  const moonNames = new Set<string>(taken);
  sys.planets.forEach((pl, i) => {
    if ((pl.preset.kind ?? 'gas') === 'shattered') return;
    const specs = pl.added ? undefined : key.moons?.[i];
    pl.moons = makeMoons(rnd, sys, pl, specs, moonNames);
    for (const m of pl.moons) m.preset.seed = (m.preset.seed ?? 0) + i * 101;
  });
}

function landmarkName(rnd: Rnd, kind: PlanetKind, sys: StarSystem): string {
  const pools: Partial<Record<PlanetKind, string[]>> = {
    shattered: ['The Broken Moon', 'Sundered', 'The Split Tithe', 'Pieces', 'The Quarrel', 'Halfmoon', 'The Reckoning', 'Shardfall', 'Old Tally'],
    lantern: ['The Lamp', 'Black Lamp', 'The Reflection', 'Low Light', 'Hymnal', 'Violet', 'The Vigil Light', 'Pilgrim'],
    burning: ['Cinder', 'Pyre', 'The Forge', 'Kiln', 'Ashfall', 'Bellows', 'Furnace', 'Clinkerheart', 'Slagfall', 'The Brand'],
  };
  return `${pick(rnd, pools[kind] ?? ['Waypoint'])}${rnd() < 0.3 ? ` of ${sys.name}` : ''}`;
}

function landmarkFlavour(rnd: Rnd, kind: PlanetKind, sys: StarSystem): string | undefined {
  switch (kind) {
    case 'shattered':
      return pick(rnd, [
        'A moon broken in the Shattering; the pieces keep their old orbit, loosely.',
        `Cracked by an Engagement nobody at ${sys.name} will name. Salvagers work the fragments.`,
        'Four hundred years of drifting apart, a metre an hour.',
      ]);
    case 'lantern':
      return pick(rnd, [
        'Black-light veins under the crust, bright since the Relighting. Instruments disagree about why.',
        'Its night side glows violet along lines no survey can explain. Pilgrims come anyway.',
      ]);
    case 'burning':
      return pick(rnd, [
        'Its star is eating it. The night side glows like a forge left open.',
        'Molten from pole to pole; the smoke plumes are visible from the Lanterns.',
      ]);
    default:
      return undefined;
  }
}

/** A spot 170–540 km out, clear of planets (with moon room), gates and stations. */
function placeBody(rnd: Rnd, sys: StarSystem, radius: number): Vector3 | null {
  for (let tries = 0; tries < 40; tries++) {
    const dist = 170_000 + rnd() * 370_000;
    const ang = rnd() * Math.PI * 2;
    const p = new Vector3(Math.cos(ang) * dist, (rnd() - 0.5) * dist * 0.3, Math.sin(ang) * dist);
    let ok = true;
    for (const o of sys.planets) {
      const room = (o.preset.radius + radius) * 5.5 + 40_000;
      if (o.position.distanceTo(p) < room) ok = false;
    }
    for (const st of sys.stations) if (st.position.distanceTo(p) < radius * 6 + 40_000) ok = false;
    for (const g of sys.gates) if (g.position.distanceTo(p) < radius * 6 + 60_000) ok = false;
    if (ok) return p;
  }
  return null;
}
