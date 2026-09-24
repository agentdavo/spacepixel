import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUD, centerBand, clearCenter, corridorY, freeSpan, hailBottom, objectivesX, overlaps, placeIn, promptY, targetBottom, weaponsRect, type Rect } from '../src/ui/hudLayout.ts';

/**
 * The flight HUD's fixed blocks at the two reference sizes, worst case
 * (every panel up at once, the tallest content each can show), must not
 * overlap. Rects mirror the drawing code (FlightHud, CombatHud,
 * ContractHud, ReachHud, Comms CSS). (Flight subtitles only play in the
 * docking / rescue cutaways, where the HUD is cleared.)
 */
function blocks(w: number, h: number): Record<string, Rect> {
  const commsW = Math.min(490, Math.max(360, w * 0.35), w - 40);
  const comms: Rect = { x: 20, y: h - HUD.commsBottom - 150, w: commsW, h: 150 };
  const band = centerBand(w);
  const top = HUD.targetY;
  const rows = Math.max(0, Math.min(14, Math.floor((targetBottom(h) - top - 112) / 15)));
  const hb = hailBottom(h);
  const hail: Rect = { x: w - HUD.margin - 324, y: hb - 174, w: 324, h: 174 };
  // The prompt: the longest line docking shows, fitted into the free span between the comms stack and the hail card.
  const py = promptY(h);
  const ps = freeSpan(w, py - 5, 26, [comms, hail]);
  const pw = Math.min(band.width, ps.x1 - ps.x0, 560);
  const px = placeIn(w, ps, pw);
  const cy = corridorY(h);
  const cs = freeSpan(w, cy, 150, [comms, hail]);
  const cw = Math.min(560, cs.x1 - cs.x0);
  const cx = placeIn(w, cs, cw);
  return {
    debugLine: { x: 16, y: 16, w: 320, h: 36 },
    status: { x: w / 2 - 160, y: 12, w: 320, h: 42 },
    target: { x: 12, y: top, w: 262, h: 112 + rows * 15 },
    objectives: { x: objectivesX(w), y: HUD.objectivesY - 20, w: HUD.objectivesW, h: 30 + 5 * 38 + 16 },
    toasts: { x: w / 2 - band.width / 2, y: HUD.toastY - 17, w: band.width, h: 3 * HUD.toastRow },
    comms,
    flightBlock: { x: 12, y: h - 132, w: 364, h: 124 },
    surveyLine: { x: w / 2 - band.width / 2, y: h - 70, w: band.width, h: 16 },
    weapons: weaponsRect(w, h),
    cameraLabel: { x: w - 22 - 260, y: h - 18 - 18, w: 260, h: 18 },
    hail,
    prompt: { x: px - pw / 2, y: py - 18, w: pw, h: 26 },
    corridor: { x: cx - cw / 2, y: cy - 64, w: cw, h: 150 },
  };
}

// Blocks that never show together (the corridor readout replaces the prompt; the hail card is a transient over-the-shoulder card).
const EXCLUSIVE = new Set(['prompt|corridor', 'corridor|prompt']);

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
  [1600, 900],
]) {
  test(`HUD layout ${w}×${h}: no two blocks overlap`, () => {
    const b = blocks(w, h);
    const names = Object.keys(b);
    const bad: string[] = [];
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const [a, c] = [names[i], names[j]];
        if (EXCLUSIVE.has(`${a}|${c}`)) continue;
        if (overlaps(b[a], b[c])) bad.push(`${a} × ${c}`);
      }
    assert.deepEqual(bad, []);
    for (const [n, r] of Object.entries(b)) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${n} on screen`);
  });
}

test('clearCenter slides a centred box off a claimed panel, and stays centred when clear', () => {
  const panel = { x: 20, y: 400, w: 470, h: 150 };
  const cx = clearCenter(1280, 480, 500, 26, [panel]);
  assert.ok(cx - 250 >= panel.x + panel.w, 'clear of the panel');
  assert.equal(clearCenter(1920, 480, 500, 26, [panel]), 960);
  assert.equal(clearCenter(1280, 100, 500, 26, [panel]), 640, 'other rows unaffected');
});
