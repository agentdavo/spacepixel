import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesOverlap, type Box } from '../src/ui/labelPlacement.ts';
import { angleToPerimeter, circDelta, edgeAngle, perimeterLength, perimeterPoint, placeEdges, type EdgeOptions, type EdgeRequest } from '../src/ui/edgePlacement.ts';

/**
 * Off-screen edge arrows (target, nav, contracts, distress): the packer
 * behind HudLabels.edge() (src/ui/edgePlacement.ts).
 */
const W = 1280;
const H = 720;
const OPT: EdgeOptions = { width: W, height: H, inset: 36, arrow: 28 };
const P = perimeterLength(OPT);

function req(id: string, angle: number, priority: number, extra: Partial<EdgeRequest> = {}): EdgeRequest {
  return { id, kind: id, angle, priority, ...extra };
}

test('the angle helper: camera-space direction, behind the camera included', () => {
  // Right, up, left (camera space: +y up; screen: +y down).
  assert.ok(Math.abs(edgeAngle(1, 0)) < 1e-9);
  assert.ok(Math.abs(edgeAngle(0, 1) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(edgeAngle(-1, 0)) - Math.PI) < 1e-9);
  // A point behind the camera and to the right (camera space z > 0) still maps to the right edge:
  // the arrow says "turn right". Its projected NDC x is negative — the old bug drew it on the left.
  const behindRight = { x: 400, y: -30, z: 900 };
  const s = angleToPerimeter(edgeAngle(behindRight.x, behindRight.y), OPT);
  assert.equal(perimeterPoint(s, OPT).side, 'right');
  const ndcX = behindRight.x / -behindRight.z; // perspective divide by w = −z
  assert.ok(ndcX < 0, 'projection flips it');
  // Dead astern: the bottom edge.
  assert.equal(perimeterPoint(angleToPerimeter(edgeAngle(0, 0), OPT), OPT).side, 'bottom');
});

test('the perimeter mapping: sides, corners and the ray from the centre', () => {
  const up = perimeterPoint(angleToPerimeter(-Math.PI / 2, OPT), OPT);
  assert.equal(up.side, 'top');
  assert.ok(Math.abs(up.x - W / 2) < 1e-6 && Math.abs(up.y - 36) < 1e-6);
  const right = perimeterPoint(angleToPerimeter(0, OPT), OPT);
  assert.equal(right.side, 'right');
  assert.ok(Math.abs(right.y - H / 2) < 1e-6 && Math.abs(right.x - (W - 36)) < 1e-6);
  // The corner diagonal lands on the corner.
  const corner = perimeterPoint(angleToPerimeter(Math.atan2(H - 72, W - 72), OPT), OPT);
  assert.ok(Math.abs(corner.x - (W - 36)) < 1e-3 && Math.abs(corner.y - (H - 36)) < 1e-3);
});

test('a crowd of arrows: no two visible ones overlap, the top priority keeps its true spot', () => {
  const reqs: EdgeRequest[] = [];
  for (let i = 0; i < 8; i++) reqs.push(req(`a${i}`, -0.4 + i * 0.03, 10 + i, { kind: `k${i}`, tw: i % 2 ? 90 : 0, th: i % 2 ? 16 : 0 }));
  const placed = placeEdges(reqs, OPT);
  const shown = placed.filter((p) => p.visible);
  assert.ok(shown.length >= 4, `${shown.length} shown`);
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) assert.ok(!boxesOverlap(shown[i].box, shown[j].box), `${shown[i].id} and ${shown[j].id} overlap`);
  const top = placed.find((p) => p.id === 'a7')!;
  assert.ok(top.visible);
  assert.equal(top.offset, 0);
  assert.ok(Math.abs(circDelta(top.s, angleToPerimeter(reqs[7].angle, OPT), P)) < 1e-6);
  // The rest slid (bounded) or gave way.
  for (const p of shown) assert.ok(Math.abs(p.offset) <= 120 + 1e-6, `${p.id} slid ${p.offset}`);
  const hidden = placed.filter((p) => !p.visible).map((p) => Number(p.id.slice(1)));
  if (hidden.length) assert.ok(Math.max(...hidden) < 7);
});

test('pinned arrows (target, nav) are always shown', () => {
  const reqs = [req('target', 0, 100, { pinned: true }), req('nav', 0, 80, { pinned: true, tw: 200, th: 16 })];
  for (let i = 0; i < 10; i++) reqs.push(req(`c${i}`, 0.01 * i, 90, { kind: 'x' + i }));
  const placed = placeEdges(reqs, OPT);
  assert.ok(placed[0].visible && placed[1].visible);
  assert.ok(!boxesOverlap(placed[0].box, placed[1].box));
});

test('an arrow slides out of a HUD panel that covers the edge', () => {
  // A panel over the right edge, from y = 250 to 470: the arrow straight right is pushed to a free end.
  const panel: Box = { x: W - 300, y: 250, w: 300, h: 220 };
  const [p] = placeEdges([req('a', 0, 50)], { ...OPT, panels: [panel] });
  assert.ok(p.visible);
  assert.equal(p.side, 'right');
  assert.ok(!boxesOverlap(p.box, panel), `arrow at y ${p.y} is under the panel`);
  assert.ok(p.y < 250 || p.y > 470);
  // It went to the nearer end (the panel's middle is 360; true spot 360 → either end; bounded all the same).
  assert.ok(Math.abs(p.offset) <= 110 + 28, `slid ${p.offset}`);
  // Off-centre: nearer the top end → above it.
  const [q] = placeEdges([req('a', Math.atan2(-60, W / 2 - 36), 50)], { ...OPT, panels: [panel] });
  assert.ok(q.visible && q.y < 250, `y ${q.y}`);
});

test('same-kind arrows that would collide fold into one with a count', () => {
  const reqs = [req('c1', 0.5, 90, { kind: 'contract' }), req('c2', 0.505, 60, { kind: 'contract' }), req('c3', 0.51, 60, { kind: 'contract' }), req('d', 0.5, 70, { kind: 'distress' })];
  const placed = placeEdges(reqs, OPT);
  const lead = placed[0];
  assert.ok(lead.visible);
  assert.equal(lead.count, 3);
  assert.equal(lead.offset, 0, 'the leader keeps its spot');
  assert.equal(placed[1].visible, false);
  assert.equal(placed[1].groupedInto, 'c1');
  assert.equal(placed[2].groupedInto, 'c1');
  // A different kind does not fold: it slides.
  assert.ok(placed[3].visible && placed[3].count === 1);
  assert.ok(!boxesOverlap(placed[3].box, lead.box));
});

test('hysteresis: an arrow keeps the side it slid to', () => {
  // A sits at the true spot; B, just clockwise of it, slides clockwise.
  const a = req('a', 0, 90);
  const b0 = req('b', 0.02, 60);
  const [, pb] = placeEdges([a, b0], OPT);
  assert.ok(pb.visible && pb.offset > 0, `offset ${pb.offset}`);
  // Next frame B's true spot drifts just counter-clockwise of A: fresh, it would slide the other way…
  const b1 = req('b', -0.02, 60);
  const [, fresh] = placeEdges([a, b1], OPT);
  assert.ok(fresh.offset < 0);
  // …but with last frame's offset it holds its side (a spot close to where it was).
  const [, held] = placeEdges([a, { ...b1, prev: pb.s }], OPT);
  assert.ok(held.visible);
  assert.ok(circDelta(angleToPerimeter(a.angle, OPT), held.s, P) > 0, 'still clockwise of A');
  assert.ok(Math.abs(circDelta(held.s, pb.s, P)) < 40, 'close to where it stood');
});

test('hysteresis never parks an arrow far from its true spot once the way is clear', () => {
  const [p] = placeEdges([req('a', 0, 50, { prev: angleToPerimeter(0, OPT) + 110 })], OPT);
  assert.equal(p.offset, 0);
});
