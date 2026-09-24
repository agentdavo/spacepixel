import { Vector3 } from 'three';
import { faceAlong, type ShipEntity } from '@/sim/Fleet';
import { LightRig } from '@/render/LightRig';
import type { BodyInstance, StarSystemView } from './StarSystemView';

/**
 * Capture staging for the living Reach (`?reach=…`), so headless shots can
 * frame a planet, fly a ring, or sit beside a traffic lane:
 *
 *   ?reach=body  [&sys=<id>] [&body=<name | index>] [&dist=<km above surface>] [&side=lit|term|night]
 *   ?reach=ring  [&sys=<id>] [&body=<name | index>]   — inside a ring plane, mid-annulus
 *   ?reach=lane | ambush                               — handled by Traffic (see world/Traffic.ts)
 *
 * Pure placement: moves the player (and wingmen) and points the nose; the
 * scene snaps the chase camera afterwards.
 */
export interface StageTarget {
  view: StarSystemView;
  player: ShipEntity;
  wingmen: ShipEntity[];
}

const _v = new Vector3();
const _t = new Vector3();

export function pickBody(view: StarSystemView, sel: string | null, pred: (b: BodyInstance) => boolean = () => true): BodyInstance | undefined {
  const list = view.bodies.filter(pred);
  if (!sel) return list[0];
  if (/^\d+$/.test(sel)) return list[Number(sel)] ?? list[0];
  const s = sel.toLowerCase();
  return list.find((b) => b.name.toLowerCase() === s) ?? list.find((b) => b.name.toLowerCase().includes(s)) ?? list[0];
}

export function stageReach(mode: string, q: URLSearchParams, t: StageTarget): boolean {
  const pf = t.player.flight;
  if (mode === 'body') {
    const b = pickBody(t.view, q.get('body'));
    if (!b) return false;
    const dist = (Number(q.get('dist') ?? 0) || b.radius / 1000 * 1.6) * 1000;
    const side = q.get('side') ?? 'term';
    // View direction from the planet: toward the key light (lit), across the terminator, or behind.
    const L = LightRig.keyDirection.value as Vector3;
    const perp = _t.set(-L.z, 0, L.x).normalize();
    const out = side === 'lit' ? _v.copy(L).multiplyScalar(0.8).addScaledVector(perp, 0.6) : side === 'night' ? _v.copy(L).multiplyScalar(-0.75).addScaledVector(perp, 0.66) : _v.copy(L).multiplyScalar(0.3).addScaledVector(perp, 0.95);
    out.normalize();
    pf.position.copy(b.position).addScaledVector(out, b.radius + dist);
    // Nose at the planet, a little off-centre so the limb sits in the frame.
    const look = new Vector3().subVectors(b.position, pf.position).normalize();
    look.addScaledVector(perp, side === 'lit' ? 0.12 : 0.18).normalize();
    place(t, look, 60);
    return true;
  }
  if (mode === 'ring') {
    const b = pickBody(t.view, q.get('body'), (x) => 'ring' in x.site.preset && !!x.site.preset.ring);
    const rp = b?.site.preset.ring;
    if (!b || !rp) return false;
    const r = t.view.ringFrame(b);
    if (!r) return false;
    // Mid-annulus on the lit side of the planet, a whisker above the plane, flying tangentially.
    const L = LightRig.keyDirection.value as Vector3;
    const radial = _v.copy(L).addScaledVector(r.normal, -L.dot(r.normal)).normalize();
    const u = Number(q.get('u') ?? 0.14);
    const rr = b.radius * (rp.inner + (rp.outer - rp.inner) * u);
    pf.position.copy(b.position).addScaledVector(radial, rr).addScaledVector(r.normal, Number(q.get('h') ?? 120));
    const tangent = new Vector3().crossVectors(r.normal, radial).normalize();
    tangent.addScaledVector(radial, -0.35).addScaledVector(r.normal, -0.06).normalize();
    place(t, tangent, 160);
    return true;
  }
  return false;
}

function place(t: StageTarget, fwd: Vector3, speed: number): void {
  const pf = t.player.flight;
  faceAlong(pf.orientation, fwd);
  pf.velocity.copy(fwd).multiplyScalar(speed);
  pf.throttle = speed / pf.spec.maxSpeed;
  t.wingmen.forEach((w, i) => {
    w.flight.position.copy(pf.position).add(_t.set(i ? 70 : -70, i ? 12 : -8, -60 - i * 30).applyQuaternion(pf.orientation));
    w.flight.orientation.copy(pf.orientation);
    w.flight.velocity.copy(pf.velocity);
  });
}
