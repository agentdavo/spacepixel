import type { Character, PortraitSpec } from '@/game/campaign/types';

/**
 * Procedural 90s-anime comms portraits (no image assets).
 *
 * Every human portrait is drawn in a 100×100 "model sheet" unit space:
 * head centred at x = 50, shoulders filling the bottom edge. Flat cel
 * colours with one shadow tone (light from the upper left), ink outlines,
 * big glossy eyes and a three-position mouth flap animated on twos.
 *
 * Performance: the character itself only has 3 blink × 3 mouth states, so
 * each state is rendered once into a small offscreen canvas (with the CRT
 * scanlines + tint baked in) and blitted afterwards. Per frame we only do
 * the cheap signal effects — slice jitter, snow, rolling bar — with a
 * hash-based RNG that allocates nothing.
 */

export type PortraitKind = 'human' | 'system' | 'oracle';

export interface PortraitOpts {
  /** Mouth flap on (character is speaking). */
  talking?: boolean;
  /** Seconds; drives blink, mouth flap, CRT roll and static. */
  time?: number;
  /** 0..1 signal noise / rolling bars for intercepted transmissions. */
  static?: number;
  /** Which renderer: human face, ship-computer glyph or non-human oracle. */
  kind?: PortraitKind;
  /** Comms tint (panel colour); defaults to Directorate green. */
  tint?: string;
}

/** Pick the portrait renderer for a speaker id / cast entry. */
export function portraitKind(who: string, c?: Character): PortraitKind {
  if (who === 'system' || who.startsWith('system')) return 'system';
  if (c?.faction === 'unknown' || who === 'oracle') return 'oracle';
  return 'human';
}

// ── colour helpers (only used on cache misses) ───────────────────────

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
/** Cel shadow: darker and pushed toward violet (anime shadow colour). */
function shadow(hex: string, k = 0.72): string {
  const [r, g, b] = rgb(hex);
  return css([clamp8(r * k * 0.93), clamp8(g * k * 0.84), clamp8(b * k * 1.02 + 10)]);
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return css([clamp8(x[0] + (y[0] - x[0]) * t), clamp8(x[1] + (y[1] - x[1]) * t), clamp8(x[2] + (y[2] - x[2]) * t)]);
}
function alpha(hex: string, a: number): string {
  return css(rgb(hex), a);
}

// ── deterministic randomness ─────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stateless integer hash → [0,1). Allocation-free, for per-frame effects. */
function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const INK = '#1a0f24';
const ACCENTS = ['#ff7a1c', '#ffd23f', '#f2f4ff', '#ff3f6c', '#4fd1ff', '#9dff6a'];

/** Per-character proportions, derived from the seed. */
interface Face {
  fw: number; // jaw width multiplier
  chinY: number;
  eyeW: number;
  eyeH: number;
  sharp: number; // outer-corner lift
  lashes: boolean;
  brow: number; // + = stern (inner end low)
  mouthW: number;
  smile: number;
  locks: number;
  tipJ: number[];
  part: number; // parting offset
  accent: string;
  harness: boolean;
}

function faceFor(spec: PortraitSpec): Face {
  const r = mulberry32(spec.seed * 7919 + 17);
  const lashes = r() < 0.5;
  const f: Face = {
    fw: 0.94 + r() * 0.1,
    chinY: 73 + r() * 2.5,
    eyeW: 10.4 + r() * 1.6,
    eyeH: lashes ? 11.4 + r() * 2 : 9.8 + r() * 1.8,
    sharp: r(),
    lashes,
    brow: -0.3 + r() * 1.1,
    mouthW: 4.8 + r() * 2,
    smile: -0.5 + r() * 1.2,
    locks: 5 + Math.floor(r() * 3),
    tipJ: [],
    part: (r() - 0.5) * 8,
    accent: ACCENTS[Math.floor(r() * ACCENTS.length)],
    harness: r() < 0.6,
  };
  for (let i = 0; i < 10; i++) f.tipJ.push(r());
  return f;
}

// ── geometry ─────────────────────────────────────────────────────────

const CX = 50;
const CY = 41; // cranium centre
const R = 20.5; // cranium radius
const EYE_Y = 51;

function facePath(c: CanvasRenderingContext2D, f: Face, dx = 0, dy = 0): void {
  const jw = R * f.fw;
  c.beginPath();
  c.moveTo(CX - R + dx, CY + dy);
  c.arc(CX + dx, CY + dy, R, Math.PI, 0);
  // right cheek → chin → left cheek
  c.bezierCurveTo(CX + R + 0.4 + dx, 50 + dy, CX + jw - 0.4 + dx, 55 + dy, CX + jw - 2.2 + dx, 60 + dy);
  c.bezierCurveTo(CX + 13 * f.fw + dx, f.chinY - 5 + dy, CX + 5 + dx, f.chinY - 0.4 + dy, CX + dx, f.chinY + dy);
  c.bezierCurveTo(CX - 5 + dx, f.chinY - 0.4 + dy, CX - 13 * f.fw + dx, f.chinY - 5 + dy, CX - jw + 2.2 + dx, 60 + dy);
  c.bezierCurveTo(CX - jw + 0.4 + dx, 55 + dy, CX - R - 0.4 + dx, 50 + dy, CX - R + dx, CY + dy);
  c.closePath();
}

interface Pt {
  x: number;
  y: number;
}

/** Bangs: the jagged lower edge of the fringe, right → left. */
function bangTips(spec: PortraitSpec, f: Face): { tips: Pt[]; roots: Pt[] } {
  const style = spec.hairStyle;
  const n = style === 'bob' ? 7 : style === 'swept' ? 5 : f.locks;
  const x0 = CX + R - 3.2;
  const x1 = CX - R + 3.2;
  const tips: Pt[] = [];
  const roots: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    let x = x0 + (x1 - x0) * t + (f.tipJ[i] - 0.5) * 2.2;
    let y: number;
    const dxc = Math.abs(x - CX);
    // Keep the eyes readable: long tips only between or outside the eyes.
    const overEye = dxc > 3.5 && dxc < 16;
    if (style === 'bob') y = 43.2 + (f.tipJ[i] - 0.5) * 1.2;
    else if (style === 'spiky') y = overEye ? 43 + f.tipJ[i] * 1.8 : 47 + f.tipJ[i] * 5;
    else if (style === 'swept') {
      // One heavy lock sweeps across the forehead to the (image) left.
      x = x0 + (x1 - x0) * Math.pow(t, 0.8);
      y = 36 + t * 10 + (i === n - 1 ? 4 : 0);
      if (overEye && y > 44.5) y = 44.5;
    } else if (style === 'long' || style === 'ponytail') y = overEye ? 42.5 + f.tipJ[i] * 2 : 46 + f.tipJ[i] * 5;
    else y = overEye ? 41.5 + f.tipJ[i] * 2.5 : 45 + f.tipJ[i] * 4; // short
    tips.push({ x, y });
    if (i < n - 1) {
      const tn = (i + 1) / n;
      roots.push({ x: x0 + (x1 - x0) * (style === 'swept' ? Math.pow(tn, 0.8) : tn), y: style === 'bob' ? 40.5 : 31 + f.tipJ[i + 1] * 4 });
    }
  }
  return { tips, roots };
}

interface HairGeo {
  vol: number;
  sideY: number;
  spikes: number;
  spikeLen: number;
  bangs: boolean;
}

function hairGeo(spec: PortraitSpec): HairGeo {
  switch (spec.hairStyle) {
    case 'spiky':
      return { vol: 3.2, sideY: 58, spikes: 7, spikeLen: 9, bangs: true };
    case 'long':
      return { vol: 3, sideY: 74, spikes: 0, spikeLen: 0, bangs: true };
    case 'bob':
      return { vol: 4, sideY: 67, spikes: 0, spikeLen: 0, bangs: true };
    case 'shaved':
      return { vol: 0.9, sideY: 47, spikes: 0, spikeLen: 0, bangs: false };
    case 'ponytail':
      return { vol: 2.2, sideY: 60, spikes: 0, spikeLen: 0, bangs: true };
    case 'swept':
      return { vol: 3.4, sideY: 57, spikes: 3, spikeLen: 4, bangs: true };
    default:
      return { vol: 2.4, sideY: 54, spikes: 3, spikeLen: 3, bangs: true };
  }
}

/** Front hair silhouette: crown + side locks + bangs. */
function frontHairPath(c: CanvasRenderingContext2D, spec: PortraitSpec, f: Face, g: HairGeo, bangs: { tips: Pt[]; roots: Pt[] }): void {
  const RO = R + g.vol;
  c.beginPath();
  // Left side lock tip.
  const lTip = { x: CX - R + (spec.hairStyle === 'long' ? 1.5 : 0.8), y: g.sideY };
  c.moveTo(lTip.x, lTip.y);
  c.quadraticCurveTo(CX - RO - 0.6, (g.sideY + CY) / 2 + 2, CX - RO, CY);
  // Crown.
  if (g.spikes > 0) {
    const a0 = Math.PI * 1.02;
    const a1 = Math.PI * 1.98;
    const n = g.spikes;
    for (let i = 0; i <= n * 2; i++) {
      const a = a0 + ((a1 - a0) * i) / (n * 2);
      const spike = i % 2 === 1;
      const len = spike ? g.spikeLen * (0.7 + f.tipJ[i % 10] * 0.6) : 0;
      const rr = RO + len;
      // Spikes lean back (toward the viewer's right) like wind-swept hair.
      const lean = spike ? 0.22 : 0;
      c.lineTo(CX + Math.cos(a + lean) * rr, CY + Math.sin(a + lean) * rr * 0.95);
    }
  } else {
    c.arc(CX, CY, RO, Math.PI, 0);
  }
  // Right side lock.
  const rTip = { x: CX + R - (spec.hairStyle === 'long' ? 1.5 : 0.8), y: g.sideY };
  c.quadraticCurveTo(CX + RO + 0.6, (g.sideY + CY) / 2 + 2, rTip.x, rTip.y);
  if (spec.hairStyle === 'bob') {
    c.lineTo(CX + R - 4.5, g.sideY - 0.5);
    c.lineTo(CX + R - 3.6, 45);
  } else {
    c.quadraticCurveTo(CX + R - 3.8, (g.sideY + 44) / 2, CX + R - 3.4, 43);
  }
  // Bangs, right → left.
  const { tips, roots } = bangs;
  let px = CX + R - 3.4;
  let py = 43;
  const sweep = spec.hairStyle === 'swept' ? -3 : f.part * 0.25;
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    // root → tip: belly toward the sweep direction.
    c.quadraticCurveTo(px + (t.x - px) * 0.2 + sweep, py + (t.y - py) * 0.75, t.x, t.y);
    const r = roots[i] ?? { x: CX - R + 3.4, y: 43 };
    c.quadraticCurveTo(t.x + (r.x - t.x) * 0.55 + sweep * 0.4, t.y + (r.y - t.y) * 0.25, r.x, r.y);
    px = r.x;
    py = r.y;
  }
  if (spec.hairStyle === 'bob') {
    c.lineTo(CX - R + 3.6, 45);
    c.lineTo(CX - R + 4.5, g.sideY - 0.5);
  } else {
    c.quadraticCurveTo(CX - R + 3.8, (g.sideY + 44) / 2, lTip.x, lTip.y);
  }
  c.closePath();
}

/** Hair that sits behind the head / shoulders. */
function backHair(c: CanvasRenderingContext2D, spec: PortraitSpec, f: Face, hair: string, hairSh: string): void {
  c.fillStyle = hair;
  c.strokeStyle = INK;
  c.lineWidth = 1.3;
  const style = spec.hairStyle;
  if (style === 'long') {
    c.beginPath();
    c.moveTo(CX - R - 3, CY);
    c.bezierCurveTo(CX - R - 7, 60, CX - R - 10, 80, CX - R - 13, 100);
    for (let i = 0; i <= 8; i++) {
      const x = CX - R - 13 + ((2 * R + 26) * i) / 8;
      c.lineTo(x + 2, i % 2 ? 101 : 94 + f.tipJ[i] * 3);
    }
    c.bezierCurveTo(CX + R + 10, 80, CX + R + 7, 60, CX + R + 3, CY);
    c.arc(CX, CY, R + 3, 0, Math.PI, true);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = hairSh;
    c.beginPath();
    c.moveTo(CX - 18, 60);
    c.lineTo(CX + 18, 60);
    c.lineTo(CX + 26, 101);
    c.lineTo(CX - 26, 101);
    c.fill();
  } else if (style === 'bob') {
    c.beginPath();
    c.moveTo(CX - R - 4, CY);
    c.bezierCurveTo(CX - R - 5.5, 56, CX - R - 4, 66, CX - R - 1, 70);
    c.lineTo(CX + R + 1, 70);
    c.bezierCurveTo(CX + R + 4, 66, CX + R + 5.5, 56, CX + R + 4, CY);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = hairSh;
    c.fillRect(CX - R + 2, 58, 2 * R - 4, 11.5);
  } else if (style === 'ponytail') {
    // Tail sweeps out behind the head to the image right, ending in locks.
    c.beginPath();
    c.moveTo(CX + 6, CY - R + 1);
    c.bezierCurveTo(CX + 30, CY - R - 6, CX + 40, CY + 2, CX + 37, 66);
    c.lineTo(CX + 38.5, 80);
    c.lineTo(CX + 34, 72);
    c.lineTo(CX + 32.5, 84);
    c.lineTo(CX + 29, 71);
    c.lineTo(CX + 25.5, 76);
    c.bezierCurveTo(CX + 27, 60, CX + 25, 44, CX + 16, CY - 4);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = hairSh;
    c.beginPath();
    c.moveTo(CX + 33, 40);
    c.bezierCurveTo(CX + 38, 52, CX + 37, 62, CX + 36, 72);
    c.lineTo(CX + 30, 58);
    c.closePath();
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(CX + 26, CY - 8);
    c.quadraticCurveTo(CX + 33, 52, CX + 31.5, 72);
    c.stroke();
  } else if (style !== 'shaved') {
    // Nape.
    c.beginPath();
    c.moveTo(CX - R - 1.5, CY + 2);
    c.quadraticCurveTo(CX - R, 62, CX - 10, 68);
    c.lineTo(CX + 10, 68);
    c.quadraticCurveTo(CX + R, 62, CX + R + 1.5, CY + 2);
    c.closePath();
    c.fill();
    c.stroke();
  }
}

function drawEye(c: CanvasRenderingContext2D, s: number, f: Face, eyes: string, lid: number, sk: SkinTones): void {
  const ex = CX + s * 10.3;
  let ey = EYE_Y;
  const ew = f.eyeW / 2;
  let eh = f.eyeH;
  const ix = ex - s * ew * 0.9;
  const ox = ex + s * ew;
  const oy = ey - 0.8 - f.sharp * 1.4;
  const iy = ey + 0.6;
  if (lid === 2) {
    // Closed: a soft downward curve + lash.
    c.strokeStyle = INK;
    c.lineWidth = 1.7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(ix, ey + 1);
    c.quadraticCurveTo(ex, ey + 3.4, ox, oy + 1.4);
    c.stroke();
    if (f.lashes) {
      c.beginPath();
      c.moveTo(ox, oy + 1.4);
      c.lineTo(ox + s * 1.8, oy + 0.2);
      c.stroke();
    }
    return;
  }
  if (lid === 1) {
    ey += eh * 0.24;
    eh *= 0.5;
  }
  const topY = ey - eh * 0.58;
  const botY = ey + eh * 0.44;

  const sclera = () => {
    c.beginPath();
    c.moveTo(ix, lid ? ey + 0.2 : iy);
    c.bezierCurveTo(ix + s * 0.8, topY, ox - s * 2.8, topY - 0.3, ox, lid ? ey - 0.4 : oy);
    c.bezierCurveTo(ox - s * 0.2, ey + eh * 0.28, ex + s * 2.4, botY, ex - s * 0.4, botY);
    c.quadraticCurveTo(ix + s * 0.4, botY - 0.4, ix, lid ? ey + 0.2 : iy);
    c.closePath();
  };

  c.save();
  sclera();
  c.fillStyle = '#fbfbff';
  c.fill();
  c.clip();
  // Upper-lid shadow on the white.
  c.fillStyle = '#c9c4e0';
  c.fillRect(ex - 8, topY - 2, 16, 2.4);
  // Iris.
  const irx = ew * 0.6;
  const iry = f.eyeH * 0.46;
  const icx = ex + s * 0.3;
  const icy = EYE_Y + (lid ? eh * 0.3 : 0.3);
  c.beginPath();
  c.ellipse(icx, icy, irx, iry, 0, 0, Math.PI * 2);
  c.fillStyle = eyes;
  c.fill();
  c.save();
  c.clip();
  // Dark upper half, light crescent below (reflected light).
  c.fillStyle = shadow(eyes, 0.5);
  c.fillRect(icx - irx, icy - iry, irx * 2, iry * 0.95);
  c.fillStyle = mix(eyes, '#ffffff', 0.45);
  c.beginPath();
  c.ellipse(icx, icy + iry * 0.95, irx * 0.85, iry * 0.55, 0, Math.PI, 0, true);
  c.fill();
  c.restore();
  // Pupil.
  c.fillStyle = shadow(eyes, 0.22);
  c.beginPath();
  c.ellipse(icx, icy - iry * 0.05, irx * 0.46, iry * 0.52, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 0.6;
  c.beginPath();
  c.ellipse(icx, icy, irx, iry, 0, 0, Math.PI * 2);
  c.stroke();
  // Highlights: big glint top-left, small dot bottom-right (same side both eyes).
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.ellipse(icx - irx * 0.38, icy - iry * 0.4, irx * 0.36, iry * 0.3, -0.5, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(icx + irx * 0.42, icy + iry * 0.38, irx * 0.17, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // Upper lash line (thick) + outer flick.
  c.strokeStyle = INK;
  c.fillStyle = INK;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 1.9;
  c.beginPath();
  c.moveTo(ix, lid ? ey + 0.2 : iy);
  c.bezierCurveTo(ix + s * 0.8, topY, ox - s * 2.8, topY - 0.3, ox, lid ? ey - 0.4 : oy);
  c.stroke();
  const fy = lid ? ey - 0.4 : oy;
  c.beginPath();
  c.moveTo(ox - s * 1.4, fy - 0.9);
  c.lineTo(ox + s * (f.lashes ? 2.4 : 1.2), fy - (f.lashes ? 1.6 : 0.2));
  c.lineTo(ox - s * 0.2, fy + 1.3);
  c.closePath();
  c.fill();
  if (f.lashes) {
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(ox - s * 1.8, topY + 1.2);
    c.lineTo(ox - s * 0.3, topY - 1.4);
    c.stroke();
  }
  // Lower lid: short thin stroke on the outer side.
  c.lineWidth = 0.7;
  c.beginPath();
  c.moveTo(ox - s * 0.4, ey + eh * 0.2);
  c.quadraticCurveTo(ex + s * 2.2, botY + 0.2, ex - s * 1, botY + 0.2);
  c.stroke();
  // Double-lid crease.
  if (!lid) {
    c.strokeStyle = sk.sh;
    c.lineWidth = 0.7;
    c.beginPath();
    c.moveTo(ex - s * 1.5, topY - 1.6);
    c.quadraticCurveTo(ex + s * 2.5, topY - 2.4, ox - s * 0.6, oy - 2.4);
    c.stroke();
  }
}

function drawBrow(c: CanvasRenderingContext2D, s: number, f: Face, col: string): void {
  const ex = CX + s * 10.3;
  const by = EYE_Y - f.eyeH * 0.95 - 1.2;
  const ix = ex - s * (f.eyeW / 2) * 0.95;
  const ox = ex + s * (f.eyeW / 2) * 1.15;
  const iy = by + f.brow * 1.8;
  const oy = by - f.brow * 0.3 + 0.6;
  c.fillStyle = col;
  c.strokeStyle = INK;
  c.lineWidth = 0.35;
  c.beginPath();
  c.moveTo(ix, iy + 0.6);
  c.quadraticCurveTo(ex, by - 1.8, ox, oy);
  c.quadraticCurveTo(ex, by - 0.2, ix, iy - 0.7);
  c.closePath();
  c.fill();
  c.stroke();
}

function drawMouth(c: CanvasRenderingContext2D, f: Face, open: number, sk: SkinTones): void {
  const my = f.chinY - 8.6;
  const hw = f.mouthW / 2;
  c.lineCap = 'round';
  if (open === 0) {
    c.strokeStyle = INK;
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(CX - hw, my - f.smile * 0.5);
    c.quadraticCurveTo(CX, my + f.smile * 1.1, CX + hw * 0.9, my - f.smile * 0.3);
    c.stroke();
    c.strokeStyle = sk.sh;
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(CX - 1.2, my + 2.4);
    c.lineTo(CX + 1.4, my + 2.4);
    c.stroke();
    return;
  }
  const h = open === 1 ? 1.8 : 3.6;
  const w = open === 1 ? hw * 0.8 : hw * 0.9;
  c.beginPath();
  c.moveTo(CX - w, my - 0.3);
  c.quadraticCurveTo(CX, my - 0.8, CX + w, my - 0.3);
  c.bezierCurveTo(CX + w * 0.8, my + h, CX - w * 0.8, my + h, CX - w, my - 0.3);
  c.closePath();
  c.fillStyle = '#4a0f1e';
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = '#d8606e';
  c.beginPath();
  c.ellipse(CX + 0.4, my + h * 0.95, w * 0.62, h * 0.45, 0, 0, Math.PI * 2);
  c.fill();
  if (open === 2) {
    c.fillStyle = '#ffffff';
    c.fillRect(CX - w, my - 1, w * 2, 1.25);
  }
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = 0.8;
  c.stroke();
}

interface SkinTones {
  base: string;
  sh: string;
}

/** Draw one full human frame in unit space (100 × 100). */
function drawHuman(c: CanvasRenderingContext2D, spec: PortraitSpec, lid: number, mouth: number, tint: string): void {
  const f = faceFor(spec);
  const g = hairGeo(spec);
  const acc = spec.accessory ?? 'none';
  const sk: SkinTones = { base: spec.skin, sh: shadow(spec.skin, 0.8) };
  const hair = spec.hair;
  const hairSh = shadow(spec.hair, 0.62);
  const hairHi = mix(spec.hair, '#ffffff', 0.38);
  const suit = spec.suit;
  const suitSh = shadow(spec.suit, 0.66);
  const suitHi = mix(spec.suit, '#ffffff', 0.3);
  c.lineJoin = 'round';
  c.lineCap = 'round';

  // Background: tinted comms screen with a halo behind the head.
  const bg = c.createLinearGradient(0, 20, 0, 100);
  bg.addColorStop(0, mix(tint, '#05040c', 0.62));
  bg.addColorStop(1, mix(tint, '#05040c', 0.9));
  c.fillStyle = bg;
  c.fillRect(-100, -100, 300, 300);
  c.strokeStyle = alpha(tint, 0.13);
  c.lineWidth = 0.5;
  c.beginPath();
  for (let i = 0; i <= 100; i += 10) {
    c.moveTo(i, 0);
    c.lineTo(i, 100);
    c.moveTo(0, i);
    c.lineTo(100, i);
  }
  c.stroke();
  c.fillStyle = alpha(tint, 0.16);
  c.beginPath();
  c.arc(CX, CY + 4, 36, 0, Math.PI * 2);
  c.fill();

  if (acc !== 'visor') backHair(c, spec, f, hair, hairSh);

  // ── body: flight suit ──
  c.strokeStyle = INK;
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(43, 78);
  c.quadraticCurveTo(34, 82, 20, 84.5);
  c.quadraticCurveTo(6, 87, 2, 100);
  c.lineTo(-2, 104);
  c.lineTo(102, 104);
  c.lineTo(98, 100);
  c.quadraticCurveTo(94, 87, 80, 84.5);
  c.quadraticCurveTo(66, 82, 57, 78);
  c.closePath();
  c.fillStyle = suit;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = suitSh;
  c.beginPath();
  c.moveTo(60, 80);
  c.quadraticCurveTo(70, 90, 66, 104);
  c.lineTo(104, 104);
  c.lineTo(104, 80);
  c.fill();
  // Shoulder piping.
  c.strokeStyle = f.accent;
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(4, 95);
  c.quadraticCurveTo(9, 87, 24, 85.2);
  c.moveTo(96, 95);
  c.quadraticCurveTo(91, 87, 76, 85.2);
  c.stroke();
  if (f.harness) {
    for (const s of [-1, 1]) {
      c.fillStyle = '#2b2e3c';
      c.beginPath();
      c.moveTo(CX + s * 20, 84);
      c.lineTo(CX + s * 25, 84);
      c.lineTo(CX + s * 21, 104);
      c.lineTo(CX + s * 16, 104);
      c.closePath();
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 0.7;
      c.stroke();
      c.fillStyle = '#c9cede';
      c.fillRect(CX + s * 18.6 - 2.6, 94, 5.2, 3.2);
      c.strokeRect(CX + s * 18.6 - 2.6, 94, 5.2, 3.2);
    }
  } else {
    // Chest patch.
    c.fillStyle = f.accent;
    c.fillRect(66, 91, 9, 5);
    c.strokeStyle = INK;
    c.lineWidth = 0.6;
    c.strokeRect(66, 91, 9, 5);
  }
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = 1.4;
  c.stroke();

  // ── neck ──
  c.beginPath();
  c.moveTo(44.6, 60);
  c.lineTo(44, 82);
  c.lineTo(56, 82);
  c.lineTo(55.4, 60);
  c.closePath();
  c.fillStyle = sk.base;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = sk.sh;
  facePath(c, f, 1.2, 5);
  c.fill();
  c.fillRect(53, 60, 4, 24);
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = 1.1;
  c.beginPath();
  c.moveTo(44.6, 62);
  c.lineTo(44, 80);
  c.moveTo(55.4, 62);
  c.lineTo(56, 80);
  c.stroke();

  // ── collar ──
  c.beginPath();
  c.moveTo(40.2, 72.5);
  c.lineTo(44.2, 75);
  c.lineTo(50, 83.5);
  c.lineTo(55.8, 75);
  c.lineTo(59.8, 72.5);
  c.lineTo(61.8, 81.5);
  c.quadraticCurveTo(56, 86.8, 50, 87.6);
  c.quadraticCurveTo(44, 86.8, 38.2, 81.5);
  c.closePath();
  c.fillStyle = suitHi;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = suitSh;
  c.fillRect(50, 70, 14, 20);
  c.fillStyle = f.accent;
  c.fillRect(36, 84.6, 28, 1.1);
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = 1.1;
  c.stroke();
  c.fillStyle = '#1d2230';
  c.beginPath();
  c.moveTo(46.8, 79);
  c.lineTo(50, 83.5);
  c.lineTo(53.2, 79);
  c.closePath();
  c.fill();

  // ── ears ──
  for (const s of [-1, 1]) {
    c.beginPath();
    c.ellipse(CX + s * (R + 0.2), 51.5, 2.5, 4.4, s * 0.15, 0, Math.PI * 2);
    c.fillStyle = s > 0 ? sk.sh : sk.base;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 0.9;
    c.stroke();
    c.lineWidth = 0.6;
    c.beginPath();
    c.arc(CX + s * (R + 0.4), 51.5, 1.4, s > 0 ? -1.2 : Math.PI - 1.9, s > 0 ? 1.9 : Math.PI + 1.2);
    c.stroke();
  }

  // ── face ──
  const bangs = bangTips(spec, f);
  facePath(c, f);
  c.fillStyle = sk.base;
  c.fill();
  c.save();
  c.clip();
  // Crescent shadow on the right side + under the chin.
  c.fillStyle = sk.sh;
  c.beginPath();
  c.rect(0, 0, 100, 100);
  c.ellipse(CX - 3.6, 45, R + 1.2, f.chinY - 45 - 1.6, 0, 0, Math.PI * 2);
  c.fill('evenodd');
  // Shadow cast by the fringe onto the forehead.
  if (g.bangs && acc !== 'visor') {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(100, 0);
    c.lineTo(100, 40);
    for (const t of bangs.tips) c.lineTo(t.x + 1.2, t.y + 2.4);
    c.lineTo(0, 40);
    c.closePath();
    c.fill();
  }
  // Cheek blush for the soft-eyed.
  if (f.lashes) {
    c.fillStyle = 'rgba(255,110,130,0.22)';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(CX + s * 12.5, 60.5, 3.4, 1.4, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
  facePath(c, f);
  c.strokeStyle = INK;
  c.lineWidth = 1.35;
  c.stroke();

  // ── features ──
  if (acc === 'eyepatch') drawEye(c, 1, f, spec.eyes, lid, sk);
  else {
    drawEye(c, -1, f, spec.eyes, lid, sk);
    drawEye(c, 1, f, spec.eyes, lid, sk);
  }
  // Nose: a shadow wedge and one ink tick.
  c.fillStyle = sk.sh;
  c.beginPath();
  c.moveTo(51, 56.5);
  c.lineTo(52.8, 61.6);
  c.lineTo(50.2, 61.8);
  c.closePath();
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 0.75;
  c.beginPath();
  c.moveTo(52.2, 61.3);
  c.lineTo(50.3, 61.9);
  c.stroke();
  drawMouth(c, f, mouth, sk);

  if (acc === 'scar') {
    c.strokeStyle = mix(spec.skin, '#b0405a', 0.45);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(63.5, 55.5);
    c.lineTo(57.5, 65);
    c.stroke();
    c.strokeStyle = INK;
    c.lineWidth = 0.5;
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3;
      const x = 63.5 + (57.5 - 63.5) * t;
      const y = 55.5 + (65 - 55.5) * t;
      c.moveTo(x - 1.3, y - 0.7);
      c.lineTo(x + 1.3, y + 0.7);
    }
    c.stroke();
  }
  if (acc === 'eyepatch') {
    c.strokeStyle = '#15131c';
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(CX - R - 0.5, 45);
    c.lineTo(CX - 5, 50);
    c.moveTo(CX - 15, 45);
    c.lineTo(CX + R + 0.5, 35);
    c.stroke();
    c.fillStyle = '#1b1a24';
    c.beginPath();
    c.ellipse(CX - 10.3, EYE_Y - 0.2, 6.4, 5.6, -0.12, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 0.9;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 0.7;
    c.beginPath();
    c.arc(CX - 10.3, EYE_Y - 0.2, 4.4, Math.PI * 1.1, Math.PI * 1.45);
    c.stroke();
  }

  // ── front hair ──
  if (acc === 'visor') {
    drawHelmet(c, f, suit, suitSh, suitHi, hair, hairSh);
    return;
  }
  frontHairPath(c, spec, f, g, bangs);
  c.fillStyle = spec.hairStyle === 'shaved' ? mix(hair, spec.skin, 0.25) : hair;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = hairSh;
  // Away-from-light side.
  const shx = spec.hairStyle === 'shaved' ? 11 : 0;
  c.beginPath();
  c.moveTo(CX + 7 + f.part + shx, 0);
  c.lineTo(CX + 4 + f.part + shx, 28);
  c.lineTo(CX + 12 + shx, 36);
  c.lineTo(CX + 10 + shx, 100);
  c.lineTo(110, 100);
  c.lineTo(110, 0);
  c.closePath();
  c.fill();
  // Undersides of the locks.
  if (g.bangs) {
    c.beginPath();
    c.moveTo(0, 100);
    c.lineTo(0, 44);
    for (let i = bangs.tips.length - 1; i >= 0; i--) {
      const t = bangs.tips[i];
      c.lineTo(t.x - 1.4, t.y - 4.2);
      const r = bangs.roots[i - 1];
      if (r) c.lineTo(r.x, r.y + 3.5);
    }
    c.lineTo(100, 44);
    c.lineTo(100, 100);
    c.closePath();
    c.fill();
  }
  // Highlight "angel ring" — a glossy band with a toothed lower edge on the lit side.
  if (spec.hairStyle !== 'shaved') {
    c.fillStyle = hairHi;
    const hr = R * 0.6;
    const a0 = Math.PI * 1.06;
    const a1 = Math.PI * 1.5;
    const n = 10;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const rr = hr + 2.4 + Math.sin((i / n) * Math.PI) * 0.8;
      c.lineTo(CX + Math.cos(a) * rr, CY - 1 + Math.sin(a) * rr);
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n;
      const rr = hr - (i % 2 ? 2.2 : 0) * Math.sin((i / n) * Math.PI);
      c.lineTo(CX + Math.cos(a) * rr, CY - 1 + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath();
    c.ellipse(CX - hr * 0.62, CY - 1 - hr * 0.55, 1.6, 0.9, -0.7, 0, Math.PI * 2);
    c.fill();
  } else {
    // Buzz-cut stipple.
    c.fillStyle = hairSh;
    const r = mulberry32(spec.seed);
    for (let i = 0; i < 40; i++) c.fillRect(CX - R + r() * 2 * R, CY - R + r() * 14, 0.6, 0.6);
  }
  c.restore();
  frontHairPath(c, spec, f, g, bangs);
  c.strokeStyle = INK;
  c.lineWidth = 1.35;
  c.stroke();
  // Lock separation strokes.
  if (g.bangs && spec.hairStyle !== 'bob') {
    c.lineWidth = 0.6;
    c.beginPath();
    for (let i = 0; i < bangs.roots.length; i++) {
      const r = bangs.roots[i];
      c.moveTo(r.x, r.y);
      c.quadraticCurveTo(r.x + 1.5, r.y - 5, r.x + 4 + f.part * 0.3, r.y - 9);
    }
    c.stroke();
  }
  if (spec.hairStyle === 'ponytail') {
    c.fillStyle = f.accent;
    c.strokeStyle = INK;
    c.lineWidth = 0.7;
    c.beginPath();
    c.ellipse(CX + 15, CY - R + 1.5, 2.2, 3.2, 0.9, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  // Brows sit on top of the fringe — the anime convention.
  if (acc !== 'eyepatch') drawBrow(c, -1, f, shadow(hair, 0.45));
  else drawBrow(c, -1, f, shadow(hair, 0.45));
  drawBrow(c, 1, f, shadow(hair, 0.45));

  if (acc === 'glasses') {
    for (const s of [-1, 1]) {
      const ex = CX + s * 10.3;
      c.fillStyle = 'rgba(200,230,255,0.16)';
      c.strokeStyle = INK;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(ex - 7, EYE_Y - 5.2, 14, 10.4, 2.2);
      c.fill();
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(ex - 4.4, EYE_Y + 3.6);
      c.lineTo(ex - 1, EYE_Y - 3.8);
      c.stroke();
    }
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(CX - 3.3, EYE_Y - 1.5);
    c.quadraticCurveTo(CX, EYE_Y - 3.2, CX + 3.3, EYE_Y - 1.5);
    c.moveTo(CX - 17.3, EYE_Y - 2);
    c.lineTo(CX - R, EYE_Y - 2.8);
    c.moveTo(CX + 17.3, EYE_Y - 2);
    c.lineTo(CX + R, EYE_Y - 2.8);
    c.stroke();
  }
  if (acc === 'headset') {
    c.strokeStyle = INK;
    c.lineWidth = 2.6;
    c.beginPath();
    c.arc(CX, CY + 1, R + g.vol + 0.6, Math.PI * 1.02, Math.PI * 1.98);
    c.stroke();
    c.strokeStyle = '#3a3f52';
    c.lineWidth = 1.4;
    c.stroke();
    // Ear cup + boom mic.
    c.fillStyle = '#2d3142';
    c.strokeStyle = INK;
    c.lineWidth = 0.9;
    c.beginPath();
    c.roundRect(CX - R - 4.6, 44.5, 6.4, 11.5, 2.4);
    c.fill();
    c.stroke();
    c.fillStyle = f.accent;
    c.fillRect(CX - R - 3.2, 47, 1.4, 3.2);
    c.strokeStyle = INK;
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(CX - R - 1, 55);
    c.quadraticCurveTo(CX - R + 1, 66.5, CX - 6.5, f.chinY - 8);
    c.stroke();
    c.strokeStyle = '#4a5068';
    c.lineWidth = 0.7;
    c.stroke();
    c.fillStyle = '#2d3142';
    c.strokeStyle = INK;
    c.lineWidth = 0.8;
    c.beginPath();
    c.ellipse(CX - 6, f.chinY - 8.2, 2.1, 1.4, 0.2, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
}

/** Visor down: flight helmet over the hair, tinted visor over the eyes. */
function drawHelmet(c: CanvasRenderingContext2D, f: Face, suit: string, suitSh: string, suitHi: string, hair: string, hairSh: string): void {
  // A few locks escaping at the cheeks.
  c.fillStyle = hair;
  c.strokeStyle = INK;
  c.lineWidth = 0.9;
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(CX + s * (R - 1), 46);
    c.lineTo(CX + s * (R - 4.2), 58);
    c.lineTo(CX + s * (R - 3.4), 47);
    c.closePath();
    c.fill();
    c.stroke();
  }
  const HR = R + 4.4;
  const shell = () => {
    c.beginPath();
    c.moveTo(CX - HR, 60);
    c.lineTo(CX - HR, CY);
    c.arc(CX, CY, HR, Math.PI, 0);
    c.lineTo(CX + HR, 60);
    c.lineTo(CX + R - 1.5, 62);
    c.lineTo(CX + R - 1.5, 40);
    c.quadraticCurveTo(CX, 30, CX - R + 1.5, 40);
    c.lineTo(CX - R + 1.5, 62);
    c.closePath();
  };
  shell();
  c.fillStyle = suitHi;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = suitSh;
  c.fillRect(CX + 6, 0, 40, 100);
  c.fillStyle = f.accent;
  c.fillRect(CX - 2.2, CY - HR - 1, 4.4, 14);
  c.restore();
  shell();
  c.strokeStyle = INK;
  c.lineWidth = 1.4;
  c.stroke();
  void hairSh;
  void suit;
  // Visor band.
  c.beginPath();
  c.moveTo(CX - R - 1.5, 41);
  c.quadraticCurveTo(CX, 33, CX + R + 1.5, 41);
  c.lineTo(CX + R - 0.5, 57);
  c.quadraticCurveTo(CX, 62, CX - R + 0.5, 57);
  c.closePath();
  const vg = c.createLinearGradient(0, 36, 0, 60);
  vg.addColorStop(0, 'rgba(255,140,40,0.92)');
  vg.addColorStop(0.55, 'rgba(120,30,90,0.72)');
  vg.addColorStop(1, 'rgba(30,20,70,0.88)');
  c.fillStyle = vg;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 1.3;
  c.stroke();
  c.save();
  c.clip();
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath();
  c.moveTo(CX - 14, 36);
  c.lineTo(CX - 9, 36);
  c.lineTo(CX - 18, 60);
  c.lineTo(CX - 23, 60);
  c.closePath();
  c.moveTo(CX - 6.5, 36);
  c.lineTo(CX - 5, 36);
  c.lineTo(CX - 14, 60);
  c.lineTo(CX - 15.5, 60);
  c.closePath();
  c.fill();
  // HUD glyphs projected on the visor.
  c.strokeStyle = 'rgba(160,255,210,0.8)';
  c.lineWidth = 0.6;
  c.beginPath();
  c.arc(CX + 10, 48, 3, 0, Math.PI * 2);
  c.moveTo(CX + 4, 48);
  c.lineTo(CX + 6.5, 48);
  c.moveTo(CX + 13.5, 48);
  c.lineTo(CX + 16, 48);
  c.stroke();
  c.restore();
  // Chin mic.
  c.fillStyle = '#2d3142';
  c.strokeStyle = INK;
  c.lineWidth = 0.9;
  c.beginPath();
  c.roundRect(CX + R - 3.5, 57, 5, 7, 1.5);
  c.fill();
  c.stroke();
}

/** Bake CRT treatment into a cached frame (device-pixel space). */
function bakeCrt(c: CanvasRenderingContext2D, pw: number, ph: number, tint: string): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = alpha(tint, 0.07);
  c.fillRect(0, 0, pw, ph);
  c.fillStyle = 'rgba(0,0,0,0.2)';
  const step = Math.max(2, Math.round(ph / 60));
  for (let y = 0; y < ph; y += step) c.fillRect(0, y, pw, Math.max(1, step >> 1));
  const vg = c.createRadialGradient(pw / 2, ph / 2, Math.min(pw, ph) * 0.35, pw / 2, ph / 2, Math.max(pw, ph) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = vg;
  c.fillRect(0, 0, pw, ph);
}

// ── frame cache ──────────────────────────────────────────────────────

const cache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE = 72;

function cachedFrame(spec: PortraitSpec, pw: number, ph: number, lid: number, mouth: number, tint: string): HTMLCanvasElement {
  const key = `${spec.seed}|${spec.hairStyle}|${spec.skin}|${spec.hair}|${spec.eyes}|${spec.suit}|${spec.accessory ?? ''}|${tint}|${pw}x${ph}|${lid}${mouth}`;
  let cv = cache.get(key);
  if (cv) return cv;
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cv = document.createElement('canvas');
  cv.width = pw;
  cv.height = ph;
  const c = cv.getContext('2d')!;
  // Unit space: the 100-unit sheet cropped to its central 80 units (tight
  // head-and-shoulders), shoulders on the bottom edge.
  const s = Math.min(pw, ph) / 80;
  c.setTransform(s, 0, 0, s, pw / 2 - 50 * s, ph - 100 * s);
  drawHuman(c, spec, lid, mouth, tint);
  bakeCrt(c, pw, ph, tint);
  cache.set(key, cv);
  return cv;
}

/** Blink state: 0 open, 1 half, 2 closed. */
function blinkState(seed: number, t: number): number {
  const period = 3.1 + (seed % 7) * 0.37;
  const p = (t + (seed % 13) * 0.61) % period;
  if (p < 0.05 || (p >= 0.15 && p < 0.21)) return 1;
  if (p < 0.15) return 2;
  return 0;
}

/** Three-position anime lip flap, on twos (12 fps). */
function mouthState(seed: number, t: number, talking: boolean): number {
  if (!talking) return 0;
  const k = Math.floor(t * 12);
  const v = hash01(k, seed);
  return v < 0.22 ? 0 : v < 0.6 ? 1 : 2;
}

/** Per-frame signal degradation (allocation-free). */
function signalFx(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, amount: number): void {
  const k = Math.floor(t * 24);
  // Rolling bar (always a little; strong with static).
  const barY = (((t * 0.35) % 1.3) - 0.15) * h;
  ctx.fillStyle = `rgba(255,255,255,${(0.035 + amount * 0.14).toFixed(3)})`;
  ctx.fillRect(0, barY, w, h * 0.1);
  if (amount <= 0.02) return;
  // Snow.
  const n = Math.floor(amount * 260);
  for (let i = 0; i < n; i++) {
    const v = hash01(k * 977 + i, 3);
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
    ctx.fillRect(hash01(k, i * 2 + 1) * w, hash01(i, k * 3 + 7) * h, 1 + v * 2.5, 1);
  }
  // Dark interference bands.
  for (let b = 0; b < 2; b++) {
    const y = ((hash01(Math.floor(t * 3) + b * 31, 11) + t * 0.2 * (b + 1)) % 1) * h;
    ctx.fillStyle = `rgba(0,0,0,${(amount * 0.35).toFixed(3)})`;
    ctx.fillRect(0, y, w, h * 0.04 * (1 + b));
  }
  // Signal dropout flash.
  if (hash01(k, 99) < amount * 0.06) {
    ctx.fillStyle = 'rgba(180,200,210,0.55)';
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Draw a comms portrait into `ctx` at (0,0,w,h) in the context's current
 * coordinate space. Deterministic from `spec.seed` and `opts.time`.
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, spec: PortraitSpec, w: number, h: number, opts: PortraitOpts = {}): void {
  const t = opts.time ?? 0;
  const st = Math.max(0, Math.min(1, opts.static ?? 0));
  const tint = opts.tint ?? '#7dffb2';
  const kind = opts.kind ?? 'human';
  if (kind === 'system') {
    drawSystem(ctx, w, h, t, !!opts.talking, tint);
    signalFx(ctx, w, h, t, st);
    return;
  }
  if (kind === 'oracle') {
    drawOracle(ctx, w, h, t, !!opts.talking, tint, spec.seed);
    signalFx(ctx, w, h, t, st);
    return;
  }
  const m = ctx.getTransform();
  const sx = Math.hypot(m.a, m.b) || 1;
  const sy = Math.hypot(m.c, m.d) || 1;
  const pw = Math.max(8, Math.round(w * sx));
  const ph = Math.max(8, Math.round(h * sy));
  const frame = cachedFrame(spec, pw, ph, blinkState(spec.seed, t), mouthState(spec.seed, t, !!opts.talking), tint);
  if (st > 0.02) {
    // Horizontal tearing: blit in slices with jittered offsets.
    const slices = 12;
    const k = Math.floor(t * 20);
    for (let i = 0; i < slices; i++) {
      const y0 = (i / slices) * ph;
      const sh = ph / slices;
      const r = hash01(k * 13 + i, 5);
      const off = r < st * 0.6 ? (hash01(i, k) - 0.5) * st * 0.22 * w : 0;
      ctx.drawImage(frame, 0, y0, pw, sh, off, (i / slices) * h, w, h / slices + 0.5);
    }
  } else {
    ctx.drawImage(frame, 0, 0, w, h);
  }
  signalFx(ctx, w, h, t, st);
}

// ── ship computer ─────────────────────────────────────────────────────

function drawSystem(c: CanvasRenderingContext2D, w: number, h: number, t: number, talking: boolean, tint: string): void {
  c.save();
  c.fillStyle = '#030a07';
  c.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 100;
  c.translate(w / 2, h / 2);
  c.scale(s, s);
  c.strokeStyle = tint;
  c.fillStyle = tint;
  c.lineWidth = 0.8;
  c.globalAlpha = 0.18;
  c.beginPath();
  for (let i = -50; i <= 50; i += 10) {
    c.moveTo(i, -50);
    c.lineTo(i, 50);
    c.moveTo(-50, i);
    c.lineTo(50, i);
  }
  c.stroke();
  c.globalAlpha = 0.9;
  // Rotating tick ring.
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, 0, 38, 0, Math.PI * 2);
  c.stroke();
  const rot = t * 0.4;
  c.beginPath();
  for (let i = 0; i < 48; i++) {
    const a = rot + (i / 48) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 31 : 34;
    c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    c.lineTo(Math.cos(a) * 36.5, Math.sin(a) * 36.5);
  }
  c.stroke();
  // Counter-rotating arcs.
  c.lineWidth = 2.4;
  for (let i = 0; i < 3; i++) {
    const a = -t * 0.9 + (i * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(0, 0, 27, a, a + 1.2);
    c.stroke();
  }
  // Waveform: amplitude follows the voice.
  const amp = talking ? 5 + 9 * (0.5 + 0.5 * Math.sin(t * 17.3)) * (0.6 + 0.4 * Math.sin(t * 5.1)) : 1.2;
  c.lineWidth = 1.6;
  c.shadowColor = tint;
  c.shadowBlur = 6;
  c.beginPath();
  for (let i = 0; i <= 44; i++) {
    const x = -22 + i;
    const env = Math.sin((i / 44) * Math.PI);
    const y = env * amp * Math.sin(i * 0.9 + t * 21) * Math.cos(i * 0.31 - t * 7);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.shadowBlur = 0;
  c.font = '6px "Share Tech Mono", monospace';
  c.textAlign = 'center';
  c.fillText('SYS // CORE', 0, 44);
  c.fillText(((t * 7.3) % 1 < 0.5 ? '▮ ' : '  ') + 'LINK', 0, -41);
  c.restore();
  // Scanlines.
  c.fillStyle = 'rgba(0,0,0,0.25)';
  const step = Math.max(2, Math.round(h / 60));
  for (let y = 0; y < h; y += step) c.fillRect(0, y, w, step / 2);
}

// ── oracle (non-human) ────────────────────────────────────────────────

function drawOracle(c: CanvasRenderingContext2D, w: number, h: number, t: number, talking: boolean, tint: string, seed: number): void {
  c.save();
  c.fillStyle = '#05030c';
  c.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 100;
  c.translate(w / 2, h / 2);
  c.scale(s, s);
  const pulse = talking ? 0.5 + 0.5 * Math.sin(t * 9) : 0.3 + 0.2 * Math.sin(t * 1.3);
  const gold = '#ffe6a8';
  // Halo.
  c.globalAlpha = 0.25 + pulse * 0.2;
  c.fillStyle = tint;
  c.beginPath();
  c.arc(0, 0, 40, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = '#05030c';
  c.beginPath();
  c.arc(0, 0, 33, 0, Math.PI * 2);
  c.fill();
  // Wireframe sphere: latitude ellipses + rotating meridians.
  const RR = 30;
  const tilt = 0.35 + 0.1 * Math.sin(seed);
  c.strokeStyle = gold;
  c.lineWidth = 0.6;
  c.globalAlpha = 0.75;
  c.beginPath();
  for (let i = -3; i <= 3; i++) {
    const lat = (i / 4) * (Math.PI / 2);
    const y = Math.sin(lat) * RR;
    const r = Math.cos(lat) * RR;
    c.moveTo(r, y);
    c.ellipse(0, y, r, r * tilt, 0, 0, Math.PI * 2);
  }
  c.stroke();
  const rot = t * 0.25;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI;
    const rx = Math.abs(Math.cos(a)) * RR;
    c.moveTo(0, -RR);
    c.ellipse(0, 0, Math.max(0.01, rx), RR, 0, -Math.PI / 2, Math.PI * 1.5);
  }
  c.stroke();
  // Lattice points (Fibonacci sphere), front-facing only.
  c.fillStyle = gold;
  const N = 48;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + rot * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z < 0) continue;
    c.globalAlpha = 0.35 + z * 0.65;
    c.fillRect(x * RR - 0.7, y * RR - 0.7, 1.4 + z, 1.4 + z);
  }
  // Central iris: concentric rings that ripple outward while speaking.
  c.globalAlpha = 1;
  c.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const ph = (t * (talking ? 0.9 : 0.25) + k / 3) % 1;
    c.globalAlpha = (1 - ph) * 0.9;
    c.strokeStyle = k === 1 ? tint : gold;
    c.beginPath();
    c.arc(0, 0, 4 + ph * 22, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
  c.fillStyle = '#ffffff';
  c.shadowColor = gold;
  c.shadowBlur = 10;
  c.beginPath();
  c.ellipse(0, 0, 2.6 + pulse * 2, 6 + pulse * 3, 0, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.restore();
  c.fillStyle = 'rgba(0,0,0,0.25)';
  const step = Math.max(2, Math.round(h / 60));
  for (let y = 0; y < h; y += step) c.fillRect(0, y, w, step / 2);
}
