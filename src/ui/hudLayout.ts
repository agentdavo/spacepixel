/**
 * One layout for every flight HUD layer (FlightHud, CombatHud, ContractHud,
 * ReachHud, the comms panels, subtitles, docking prompts, DebugHud). Each
 * layer used to pick its own corner; at 1280×720 several landed on each
 * other (the dock prompt under the radio panel, the hail card over the
 * weapons block, two radio panels in one spot, toasts over the objectives).
 *
 *   ┌ debug line ──────────── status · ring/nav ─────────── objectives ┐
 *   │ target panel             toasts ↓ · distress ↓        (contracts, │
 *   │ (subsystems, rows         banners                      campaign,  │
 *   │  capped above comms)                                   mission)   │
 *   │                         corridor readout                          │
 *   │ comms stack ↑            dock prompt / message         hail card  │
 *   │ (radio panels)           subtitles                     weapons    │
 *   └ flight block + loadout   survey line             camera label ───┘
 *
 * Canvas layers draw at the slots below. DOM panels that move (the comms
 * stack) `claim` their screen rect each frame so centred canvas text can
 * slide clear of them (`clearCenter`). CSS px throughout.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HUD = {
  margin: 24,
  /** Top-right objectives column (contract panel, campaign / mission objectives). */
  objectivesW: 348,
  objectivesY: 60,
  /** Top-left target panel (CombatHud). */
  targetY: 100,
  /** Bottom-right weapons block (CombatHud): width, height, inset from the bottom (clear of the camera label). */
  weaponsW: 240,
  weaponsH: 126,
  weaponsBottom: 44,
  /** Bottom-left comms stack base (px above the bottom edge: clears the flight block). */
  commsBottom: 150,
  commsGap: 10,
  /** Contract toasts: first row. */
  toastY: 78,
  toastRow: 30,
  /** Rows of the top-centre stack under the status line. */
  statusY: 28,
  statusSubY: 48,
};

export function objectivesX(w: number): number {
  return w - HUD.margin - HUD.objectivesW;
}

/** Weapons block rect (bottom-right). */
export function weaponsRect(w: number, h: number): Rect {
  return { x: w - HUD.margin - HUD.weaponsW, y: h - HUD.weaponsBottom - HUD.weaponsH, w: HUD.weaponsW, h: HUD.weaponsH };
}

/**
 * Centre band (x0..x1) clear of the side columns: top-left target panel and
 * top-right objectives above, flight block and weapons below. Never narrower
 * than 320 px (small windows overlap rather than vanish).
 */
export function centerBand(w: number): { x0: number; x1: number; width: number } {
  const half = Math.max(160, w / 2 - (HUD.objectivesW + HUD.margin + 16));
  return { x0: w / 2 - half, x1: w / 2 + half, width: half * 2 };
}

/** Subtitle band top (subtitles sit at bottom: 13vh; two lines + kicker ≈ 84 px). */
export function subtitleTop(h: number): number {
  return h * 0.87 - 84;
}

/** Docking prompt / controller message row (centre of a 26 px plate), above the subtitle band. */
export function promptY(h: number): number {
  return Math.round(Math.min(h * 0.72, subtitleTop(h) - 26));
}

/** Approach readout (the ILS box) centre, above the prompt row. */
export function corridorY(h: number): number {
  return promptY(h) - 118;
}

/** Hail card: bottom edge sits above the weapons block. */
export function hailBottom(h: number): number {
  return h - HUD.weaponsBottom - HUD.weaponsH - 12;
}

/** Lowest y the top-left target panel may use (the comms stack starts below it). */
export function targetBottom(h: number): number {
  return h - HUD.commsBottom - 150 - 12;
}

// ── claims: DOM panels publish where they are ─────────────────────────

const claims = new Map<string, Rect>();

/** Publish (or with null, withdraw) a panel's screen rect. */
export function claim(id: string, r: Rect | null): void {
  if (r) claims.set(id, r);
  else claims.delete(id);
}

export function claimRect(id: string): Rect | undefined {
  return claims.get(id);
}

export function claimed(): IterableIterator<Rect> {
  return claims.values();
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Centre x for a centred box `tw` × `th` whose middle sits at row `y`:
 * the screen centre, slid right (then left) just enough to clear every
 * claimed panel on that row. `rects` defaults to the live claims.
 */
export function clearCenter(w: number, y: number, tw: number, th: number, rects: Iterable<Rect> = claims.values()): number {
  let cx = w / 2;
  const list = [...rects];
  const box = (x: number): Rect => ({ x: x - tw / 2, y: y - th / 2, w: tw, h: th });
  for (let pass = 0; pass < 3; pass++) {
    const hit = list.find((r) => overlaps(box(cx), r));
    if (!hit) break;
    const right = hit.x + hit.w + 12 + tw / 2;
    cx = right + tw / 2 <= w - 8 ? right : hit.x - 12 - tw / 2;
  }
  return Math.max(tw / 2 + 8, Math.min(w - tw / 2 - 8, cx));
}

/**
 * The free horizontal span on a row (`y` ± th/2) between claimed panels,
 * within the screen: the gap containing the screen centre, else the widest.
 * Centred HUD text fits itself to it (`fitText`) and centres in it (`placeIn`).
 */
export function freeSpan(w: number, y: number, th: number, rects: Iterable<Rect> = claims.values()): { x0: number; x1: number } {
  const blocked: [number, number][] = [];
  for (const r of rects) if (r.y < y + th / 2 && y - th / 2 < r.y + r.h) blocked.push([r.x - 12, r.x + r.w + 12]);
  blocked.sort((a, b) => a[0] - b[0]);
  const gaps: { x0: number; x1: number }[] = [];
  let x = 8;
  for (const [a, b] of blocked) {
    if (a > x) gaps.push({ x0: x, x1: a });
    x = Math.max(x, b);
  }
  if (x < w - 8) gaps.push({ x0: x, x1: w - 8 });
  if (!gaps.length) return { x0: 8, x1: w - 8 };
  return gaps.find((g) => g.x0 <= w / 2 && w / 2 <= g.x1 && g.x1 - g.x0 >= 240) ?? gaps.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
}

/** Centre x for a box of width `tw` in a span: the screen centre if it fits there, else as near as it can get. */
export function placeIn(w: number, span: { x0: number; x1: number }, tw: number): number {
  return Math.max(span.x0 + tw / 2, Math.min(span.x1 - tw / 2, w / 2));
}

/**
 * Largest font size (≤ `size`, ≥ `min`) at which `text` fits `maxW`; sets
 * the font on the context and returns the text, clipped with an ellipsis
 * if even `min` doesn't fit. `family` is the CSS family list, `weight` an
 * optional prefix ('700 ').
 */
export function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, size: number, min: number, family: string, weight = ''): string {
  let s = size;
  c.font = `${weight}${s}px ${family}`;
  while (s > min && c.measureText(text).width > maxW) {
    s -= 1;
    c.font = `${weight}${s}px ${family}`;
  }
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 4 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
