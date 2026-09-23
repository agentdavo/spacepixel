import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import {
  collideBody,
  impactDamage,
  makeHost,
  makeProxy,
  placeHost,
  resolveContact,
  signedDistance,
  sphereContact,
  type Contact,
  type HitEvent,
  type ProxyShape,
} from '../src/sim/Collision.ts';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const Q = () => new Quaternion();
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function sd(s: ProxyShape, p: Vector3) {
  const n = new Vector3();
  const pt = new Vector3();
  const d = signedDistance(s, p, n, pt);
  return { d, n, pt };
}

test('signed distance: sphere, capsule, box (outside, edge, inside)', () => {
  let r = sd({ kind: 'sphere', c: V(0, 0, 0), r: 10 }, V(0, 25, 0));
  near(r.d, 15);
  assert.ok(r.n.equals(V(0, 1, 0)));
  near(r.pt.y, 10);

  r = sd({ kind: 'capsule', a: V(0, 0, -50), b: V(0, 0, 50), r: 5 }, V(8, 0, 20));
  near(r.d, 3);
  near(r.pt.x, 5);
  near(r.pt.z, 20);

  const box: ProxyShape = { kind: 'box', c: V(100, 0, 0), q: Q(), half: V(10, 20, 30) };
  r = sd(box, V(100, 0, 50)); // off the +Z face
  near(r.d, 20);
  assert.ok(r.n.equals(V(0, 0, 1)));
  r = sd(box, V(113, 24, 0)); // off an edge: √(3² + 4²)
  near(r.d, 5);
  r = sd(box, V(108, 0, 0)); // inside: out through +X, 2 m deep
  near(r.d, -2);
  assert.ok(r.n.equals(V(1, 0, 0)));
  near(r.pt.x, 110);
});

test('signed distance: rotated box, Z-cylinder and ring', () => {
  // Box rotated 90° about Y: its long local Z now runs along world X.
  const q = new Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2);
  const r0 = sd({ kind: 'box', c: V(0, 0, 0), q, half: V(1, 1, 50) }, V(60, 0, 0));
  near(r0.d, 10, 1e-9);
  near(r0.n.x, 1, 1e-9);

  const cyl: ProxyShape = { kind: 'cyl', c: V(0, 0, 0), q: Q(), r: 20, halfLen: 40 };
  near(sd(cyl, V(30, 0, 0)).d, 10);
  near(sd(cyl, V(0, 0, 55)).d, 15);
  near(sd(cyl, V(23, 0, 44)).d, 5); // past the rim edge: √(3² + 4²)
  const inside = sd(cyl, V(0, 17, 0));
  near(inside.d, -3);
  near(inside.n.y, 1);

  const ring: ProxyShape = { kind: 'ring', c: V(0, 0, 0), q: Q(), R: 500, r: 40 };
  near(sd(ring, V(0, 560, 0)).d, 20);
  near(sd(ring, V(0, 500, 30)).d, -10);
  near(sd(ring, V(0, 0, 0)).d, 460); // the hole in the middle is open
});

test('sphere contact picks the deepest proxy and ignores far ones', () => {
  const ps = [makeProxy({ kind: 'sphere', c: V(0, 0, 0), r: 10 }), makeProxy({ kind: 'box', c: V(0, 0, 0), q: Q(), half: V(30, 2, 30) }), makeProxy({ kind: 'sphere', c: V(1e5, 0, 0), r: 10 })];
  const h = makeHost(null, ps, V(0, 0, 0), Q(), V(0, 0, 0));
  placeHost(h);
  const out: Contact = { point: V(0, 0, 0), normal: V(0, 0, 0), depth: 0 };
  const c = sphereContact(V(20, 5, 0), 6, h.proxies, out);
  assert.ok(c);
  near(c!.depth, 3); // slab top at y=2, sphere bottom at y=-1
  assert.ok(c!.normal.equals(V(0, 1, 0)));
  assert.equal(sphereContact(V(20, 50, 0), 6, h.proxies, out), null);
});

test('response: push out, bounce with restitution, scrape keeps most slide', () => {
  const pos = V(0, 1, 0);
  const vel = V(30, -100, 0);
  const c: Contact = { point: V(0, 0, 0), normal: V(0, 1, 0), depth: 5 };
  const b = resolveContact(pos, vel, V(0, 0, 0), c, 0.35, 0.25);
  near(b.impact, 100);
  assert.ok(pos.y > 5.9, 'pushed out of the hull');
  near(vel.y, 35, 1e-9); // 0.35 × 100 back out
  assert.ok(vel.x > 0 && vel.x < 30, 'friction bled the slide');
  // Moving host (a carrier): only the RELATIVE closing speed counts.
  const v2 = V(0, 16, 0);
  const b2 = resolveContact(V(0, 0, 0), v2, V(0, 16, 0), { point: V(0, 0, 0), normal: V(0, 1, 0), depth: 0.5 });
  near(b2.impact, 0);
  near(v2.y, 16);
});

test('impact damage: nudges are free, then proportional to speed', () => {
  assert.equal(impactDamage(5), 0);
  assert.ok(impactDamage(20) > 0);
  near(impactDamage(208) / impactDamage(108), 2, 1e-9);
  assert.ok(impactDamage(460) > 160, 'a burner ram through shields and hull is fatal');
  assert.ok(impactDamage(60) < 60, 'a scrape at approach speed is survivable');
});

test('fast movers are swept: no tunnelling through a thin bulkhead', () => {
  const wall = makeHost(null, [makeProxy({ kind: 'box', c: V(0, 0, 0), q: Q(), half: V(200, 200, 2) })], V(0, 0, 1000), Q(), V(0, 0, 0));
  // 3 km/s cruise, one 60 Hz step: 50 m a frame, straight through a 4 m plate.
  const body = { position: V(0, 0, 1000 + 25), velocity: V(0, 0, 3000), radius: 6 };
  const ev: HitEvent = { body, host: wall, point: V(0, 0, 0), normal: V(0, 0, 0), impact: 0, slide: 0 };
  const hit = collideBody(body, [wall], 1 / 60, ev);
  assert.ok(hit, 'the sweep catches the plate');
  assert.ok(body.position.z < 1000 - 2, `stopped on the near side (z ${body.position.z.toFixed(1)})`);
  assert.ok(body.velocity.z < 0, 'bounced back');
  near(hit!.impact, 3000);
});

test('hosts move and spin their proxies (station ring spokes, a steaming carrier)', () => {
  const jointQ = new Quaternion();
  const spoke = makeProxy({ kind: 'box', c: V(0, 300, 0), q: Q(), half: V(15, 250, 20) }, { pivot: V(0, 0, 0), q: jointQ });
  const pos = V(5000, 0, 0);
  const hq = new Quaternion();
  const host = makeHost(null, [spoke], pos, hq, V(0, 0, 0));
  const out: Contact = { point: V(0, 0, 0), normal: V(0, 0, 0), depth: 0 };
  assert.ok(sphereContact(V(5000, 300, 0), 5, host.proxies, out), 'spoke up');
  jointQ.setFromAxisAngle(V(0, 0, 1), Math.PI / 2); // ring turns a quarter
  placeHost(host);
  assert.equal(sphereContact(V(5000, 300, 0), 5, host.proxies, out), null, 'spoke has swung away');
  assert.ok(sphereContact(V(5000 - 300, 0, 0), 5, host.proxies, out), 'spoke now points −X');
  pos.set(0, 0, 0); // the host itself moves
  placeHost(host);
  assert.ok(sphereContact(V(-300, 0, 0), 5, host.proxies, out));
  assert.ok(host.radius >= 550, `bounding radius covers the swept spoke (${host.radius})`);
});
