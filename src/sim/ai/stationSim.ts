import { Group, Quaternion, Vector3 } from 'three';
import { buildShip } from '@/assets/ShipBuilder';
import { stationBlueprint, BAY_Z, BAY_W, BAY_H, BAY_BACK } from '@/assets/blueprints/stations';
import type { Dockable } from '@/world/Docking';
import { WingDocking } from '@/world/WingDocking';
import { Fleet } from '../Fleet';
import { collideBody, makeHost, placeHost, sphereContact, type Body, type Contact, type HitEvent } from '../Collision';
import { proxiesFromModel } from '../CollisionProxies';
import { proxyObstacles } from './Avoid';
import { issueOrder, setFormation, slotWorld } from './Squadron';
import { brainOf } from './state';
import { updateAI } from './index';

/**
 * Headless station scenarios for `npm run ai-sim` (docking & trade):
 *
 *  - station avoidance: fighters chase bait straight through a station; the
 *    AI must steer round the same collision proxies the hulls are built
 *    from, and the collision world must keep everyone out of the hull.
 *  - wing docking: the lead flies the corridor into the bay; wingmen break
 *    off to hold points outside the corridor, never enter the bay, and
 *    re-form when the lead is launched.
 */
const DT = 1 / 60;
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);
const v = (x: number, y: number, z: number) => new Vector3(x, y, z).add(ORIGIN);
const FWD = new Vector3(0, 0, 1);

interface Check {
  name: string;
  value: number;
  pass: boolean;
  rule: string;
}
const check = (name: string, value: number, rule: string, pass: boolean): Check => ({ name, value: Math.round(value * 100) / 100, rule, pass });

function station(pos: Vector3) {
  const model = buildShip(stationBlueprint('refinery', 'concord', 4242));
  const q = new Quaternion(); // bay faces +Z
  const host = makeHost(null, proxiesFromModel(model), pos, q, new Vector3());
  return { model, host, q };
}

export function stationAvoidScenario(seconds = 40) {
  const fleet = new Fleet(new Group());
  const st = station(v(0, 0, 3000));
  // Bait beyond the station; hunters pointed straight at it (through the hub).
  const bait = fleet.spawn('choir-cantor', 'choir', v(0, 0, 7500), FWD);
  bait.flight.throttle = 0.5;
  const hunters = [v(0, 0, 0), v(150, 250, 300), v(-250, -80, 450), v(60, -300, 150)].map((p) => fleet.spawn('vf27-kestrel', 'concord', p, FWD));
  const obstacles = proxyObstacles(st.host.proxies);
  const out: Contact = { point: new Vector3(), normal: new Vector3(), depth: 0 };
  const ev: HitEvent = { body: { position: new Vector3(), velocity: new Vector3(), radius: 1 }, host: st.host, point: new Vector3(), normal: new Vector3(), impact: 0, slide: 0 };
  let intrusions = 0;
  let bounces = 0;
  let worstImpact = 0;
  const inside = new Set<number>();
  const bodies = new Map<number, Body>();
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const t = i * DT;
    st.model.setChannel('spin', (t / 80) % 1);
    placeHost(st.host);
    proxyObstacles(st.host.proxies, obstacles);
    updateAI(fleet, DT, t, obstacles);
    bait.controls.pitch = bait.controls.yaw = bait.controls.roll = 0;
    bait.controls.fire = false;
    fleet.step(DT);
    for (const s of hunters) {
      let b = bodies.get(s.id);
      if (!b) bodies.set(s.id, (b = { position: s.flight.position, velocity: s.flight.velocity, radius: s.radius }));
      // Would the hull have been entered (before the collision world pushes back)?
      if (sphereContact(s.flight.position, s.radius, st.host.proxies, out)) {
        if (!inside.has(s.id)) intrusions++;
        inside.add(s.id);
      } else inside.delete(s.id);
      const hit = collideBody(b, [st.host], DT, ev);
      if (hit) {
        bounces++;
        worstImpact = Math.max(worstImpact, hit.impact);
      }
      if (sphereContact(s.flight.position, s.radius - 0.5, st.host.proxies, out)) intrusions += 100; // left inside a hull: collision failed
    }
  }
  return {
    name: 'station avoidance (AI steers round collision proxies)',
    metrics: { proxies: st.host.proxies.length, obstacles: obstacles.length, bounces, worstImpact: worstImpact.toFixed(1) },
    checks: [check('station hull contacts', intrusions, '<= 1 (a graze at most)', intrusions <= 1), check('worst impact speed (m/s)', worstImpact, '< 40', worstImpact < 40)],
  };
}

export function wingDockScenario(seconds = 70) {
  const fleet = new Fleet(new Group());
  const st = station(v(0, 0, 0));
  const bay = v(0, 0, BAY_Z * 100);
  // Lead 2 km out on the corridor, flying in at 110 m/s (scripted, like the player).
  const lead = fleet.spawn('vf27-kestrel', 'concord', bay.clone().add(new Vector3(0, 0, 2000)), FWD.clone().negate(), { isPlayer: true });
  const wing = [new Vector3(-46, -7, -34), new Vector3(52, 6, -50)].map((o) => fleet.spawn('vf27-kestrel', 'concord', lead.flight.position.clone().add(o.clone().negate()), FWD.clone().negate()));
  setFormation(wing, 'fingerFour', 40);
  issueOrder(wing, 'formUp', lead);
  const target = {
    bay,
    axis: FWD.clone(),
    up: new Vector3(0, 1, 0),
    velocity: new Vector3(),
    interior: { hw: (BAY_W / 2) * 100, hh: (BAY_H / 2) * 100, depth: (BAY_Z - BAY_BACK) * 100 },
  } as unknown as Dockable;
  const dk = {
    phase: 'cleared' as Dockable['kind'] | string,
    target: target as Dockable | null,
    toWorld(d: Dockable, local: Vector3, o: Vector3) {
      const r = new Vector3().crossVectors(d.up, d.axis);
      return o.copy(d.bay).addScaledVector(r, local.x).addScaledVector(d.up, local.y).addScaledVector(d.axis, local.z);
    },
  };
  const hold = new WingDocking();
  const obstacles = proxyObstacles(st.host.proxies);
  const out: Contact = { point: new Vector3(), normal: new Vector3(), depth: 0 };
  let inCorridor = 0;
  let inBay = 0;
  let hull = 0;
  let holdErr = 0;
  let reformErr = Infinity;
  const slot = new Vector3();
  const rel = new Vector3();
  const tLaunch = seconds * 0.6;
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const t = i * DT;
    // Lead: scripted down the corridor, parks inside the bay; launched back out at tLaunch.
    const lf = lead.flight;
    if (t < tLaunch) {
      const z = Math.max(-70, 2000 - 110 * t);
      lf.position.copy(bay).add(new Vector3(0, 0, z));
      lf.velocity.set(0, 0, z > -70 ? -110 : 0);
    } else {
      if (dk.phase !== 'free') {
        dk.phase = 'free';
        lf.velocity.copy(FWD).multiplyScalar(150);
        lf.orientation.setFromUnitVectors(new Vector3(0, 0, 1), FWD);
        lead.controls.throttleSet = 0.6;
      }
    }
    updateAI(fleet, DT, t, obstacles);
    hold.update(DT, dk as never, lead, fleet, obstacles, 'formUp');
    fleet.step(DT);
    for (const [k, w] of wing.entries()) {
      rel.subVectors(w.flight.position, bay);
      const lateral = Math.hypot(rel.x, rel.y);
      if (sphereContact(w.flight.position, w.radius, st.host.proxies, out)) hull++;
      if (rel.z < 0 && Math.abs(rel.x) < 75 && Math.abs(rel.y) < 50) inBay++;
      // After the break-off (10 s), nobody loiters in the corridor while the lead is on it.
      if (t > 10 && t < tLaunch && rel.z > 0 && rel.z < 1600 && lateral < 150) inCorridor++;
      if (t > tLaunch - 1 && t < tLaunch) holdErr = Math.max(holdErr, w.flight.position.distanceTo(dk.toWorld(target, WingDocking.slot(k, 75, slot), new Vector3())));
    }
    if (t > seconds - 1) {
      let worst = 0;
      for (const w of wing) worst = Math.max(worst, slotWorld(brainOf(w), lead, slot).distanceTo(w.flight.position));
      reformErr = Math.min(reformErr, worst);
    }
  }
  return {
    name: 'wing docking (hold off the corridor, re-form on launch)',
    metrics: { holdErr: holdErr.toFixed(1), reformErr: reformErr.toFixed(1) },
    checks: [
      check('wingman frames inside the bay', inBay, '== 0', inBay === 0),
      check('wingman hull contacts', hull, '== 0', hull === 0),
      check('wingman frames on the corridor (after 10 s)', inCorridor, '== 0', inCorridor === 0),
      check('hold-point error before launch (m)', holdErr, '< 80', holdErr < 80),
      check('re-formed on the lead after launch (m)', reformErr, '< 60', reformErr < 60),
    ],
  };
}
