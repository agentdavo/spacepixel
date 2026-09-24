import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS_PER_RING, boxesOverlap, placeLabels, type Box, type LabelRequest } from '../src/ui/labelPlacement.ts';

/**
 * World-space label declutter: the greedy packer behind the flight HUD's
 * label layer (src/ui/HudLabels.ts).
 */
const W = 1280;
const H = 720;
const RETICLE: Box = { x: W / 2 - 36, y: H / 2 - 36, w: 72, h: 72 };

function req(id: string, ax: number, ay: number, priority: number, extra: Partial<LabelRequest> = {}): LabelRequest {
  return { id, ax, ay, ar: 10, w: 150, h: 28, priority, ...extra };
}

function visibleBoxes(p: ReturnType<typeof placeLabels>): Box[] {
  return p.filter((x) => x.visible).map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h }));
}

test('a lone label hugs its marker on the right, no leader', () => {
  const [p] = placeLabels([req('a', 300, 300, 10)], { width: W, height: H });
  assert.ok(p.visible);
  assert.equal(p.slot, 0);
  assert.equal(p.leader, false);
  assert.equal(p.x, 300 + 10 + 6);
});

test('a cluster of markers: no two visible labels overlap, none covers a marker', () => {
  const reqs: LabelRequest[] = [];
  for (let i = 0; i < 12; i++) reqs.push(req(`m${i}`, 400 + (i % 4) * 30, 250 + Math.floor(i / 4) * 25, i));
  const placed = placeLabels(reqs, { width: W, height: H });
  const boxes = visibleBoxes(placed);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesOverlap(boxes[i], boxes[j]), `labels ${i} and ${j} overlap`);
  for (const b of boxes) for (const r of reqs) assert.ok(!boxesOverlap(b, { x: r.ax - r.ar, y: r.ay - r.ar, w: r.ar * 2, h: r.ar * 2 }), 'a label covers a marker');
  // Some went out on a leader line; the lowest priorities gave way.
  assert.ok(placed.some((p) => p.leader), 'at least one label on a leader line');
  const hidden = placed.filter((p) => !p.visible).map((p) => Number(p.id.slice(1)));
  const shown = placed.filter((p) => p.visible).map((p) => Number(p.id.slice(1)));
  if (hidden.length) assert.ok(Math.max(...hidden) < Math.max(...shown), 'the top priority label is shown');
});

test('priority decides who gets the good slot', () => {
  // Two markers side by side: whoever places first takes "right of the marker".
  const placed = placeLabels([req('low', 300, 300, 1), req('high', 300, 330, 9)], { width: W, height: H });
  const high = placed.find((p) => p.id === 'high')!;
  assert.equal(high.slot, 0);
  assert.ok(placed.find((p) => p.id === 'low')!.visible, 'there is room for both');
});

test('nothing covers the reticle, pinned labels included', () => {
  const reqs = [req('target', W / 2 + 4, H / 2 - 4, 100, { pinned: true, ar: 16 }), req('nav', W / 2 - 20, H / 2 + 10, 80), req('moon', W / 2 + 30, H / 2 + 30, 25)];
  const placed = placeLabels(reqs, { width: W, height: H, keepOut: [RETICLE] });
  for (const b of visibleBoxes(placed)) assert.ok(!boxesOverlap(b, RETICLE), 'a label sits on the reticle');
  assert.ok(placed[0].visible, 'the pinned target label is shown');
});

test('HUD panels are obstacles', () => {
  const panel: Box = { x: 316 - 2, y: 280, w: 400, h: 60 };
  const [p] = placeLabels([req('a', 300, 300, 10)], { width: W, height: H, obstacles: [panel] });
  assert.ok(p.visible);
  assert.ok(!boxesOverlap(p, panel));
  assert.notEqual(p.slot, 0);
});

test('no room: low priority hides, pinned stays on screen', () => {
  // The whole screen is a panel except a sliver round the markers.
  const wall: Box[] = [
    { x: 0, y: 0, w: W, h: 280 },
    { x: 0, y: 320, w: W, h: H - 320 },
    { x: 0, y: 280, w: 280, h: 40 },
    { x: 330, y: 280, w: W - 330, h: 40 },
  ];
  const placed = placeLabels([req('low', 300, 300, 1), req('pin', 305, 300, 100, { pinned: true })], { width: W, height: H, obstacles: wall });
  assert.equal(placed[0].visible, false);
  assert.equal(placed[1].visible, true);
  const b = placed[1];
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H, 'pinned label on screen');
});

test('hysteresis: the slot held last frame wins while it is still free', () => {
  const [p] = placeLabels([req('a', 300, 300, 10, { prefer: 3 })], { width: W, height: H });
  assert.equal(p.slot, 3);
  // …but not when it is blocked.
  const [q] = placeLabels([req('a', 300, 300, 10, { prefer: 3 })], { width: W, height: H, obstacles: [{ x: 100, y: 270, w: 190, h: 60 }] });
  assert.notEqual(q.slot, 3);
});

test('labels stay on screen at the edges (they flip to the free side)', () => {
  const placed = placeLabels([req('right', W - 20, 300, 5), req('bottom', 400, H - 12, 5)], { width: W, height: H, margin: 6 });
  for (const p of placed) {
    assert.ok(p.visible, p.id);
    assert.ok(p.x >= 6 && p.x + p.w <= W - 6 && p.y >= 6 && p.y + p.h <= H - 6, `${p.id} off screen`);
  }
  assert.ok(placed[0].x < W - 20, 'right-edge label flipped left');
});

test('leader lines run from the marker edge to the label box', () => {
  // Block ring 0 all round so the label must go out a ring.
  const r = req('a', 500, 400, 10);
  const block: Box = { x: 500 - 60, y: 400 - 50, w: 120, h: 100 };
  const [p] = placeLabels([r], { width: W, height: H, obstacles: [block] });
  assert.ok(p.visible);
  assert.ok(p.slot >= SLOTS_PER_RING);
  assert.equal(p.leader, true);
  assert.ok(Math.abs(Math.hypot(p.lx0 - 500, p.ly0 - 400) - r.ar) < 1e-6, 'leader starts on the marker edge');
  assert.ok(p.lx1 >= p.x && p.lx1 <= p.x + p.w && p.ly1 >= p.y && p.ly1 <= p.y + p.h, 'leader ends on the label box');
});
