import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { ShipModel } from '@/assets/ShipBuilder';
import { approachEase, type ApproachProfile } from './classes';
import { look, orient, smooth, type BerthFrame, type BerthHost, type BerthSequence, type SeqPhase } from './sequence';

/**
 * Berthing for hulls too big for a hangar bay (docking for every hull size).
 *
 *   clamp      gunships & corvettes at a station gantry: guidance slides the
 *              hull in alongside (it swings round on the way, nose out), all
 *              stop, the arm swings out square and clamps the flank, the
 *              umbilicals reach across. Launch: lines drop, the arm swings
 *              home, the drive lights and she runs out up the corridor.
 *   mooring    frigates off a station's pylon: the same slow approach to a
 *              hold point 160 m off the bollard, a lit tether shot across,
 *              and a lighter ferrying the crew while she rides at anchor.
 *   alongside  corvettes beside a friendly carrier: the mooring beat against
 *              the carrier's flank, riding its velocity.
 *
 * The frame is the berth's: origin at the berthed hull's centre, +z out
 * along the corridor (and the hull's nose when berthed), +y the hull's up.
 * `anchor` is the pad / bollard / carrier-hull point in that frame, `root`
 * the tower foot or mast root (umbilicals, lighter).
 */
export type HullBerthMode = 'clamp' | 'mooring' | 'alongside';

export interface HullBerthSpec {
  mode: HullBerthMode;
  profile: ApproachProfile;
  /** Hull length and half-beam (m). */
  length: number;
  halfBeam: number;
  /** Berth-local anchor (pad, bollard, carrier flank) and root (tower foot, mast root). */
  anchor: Vector3;
  root: Vector3;
  towerHalf: number;
  /** Station model + arm channel (clamp only). */
  station?: ShipModel;
  channel?: string;
  name: string;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _l = new Vector3();
const _q = new Quaternion();
const _f = new Vector3();
const _u = new Vector3();
const _r = new Vector3();
const _tw: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
const _hl: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
const LIGHTER_CYCLE = 18;

export class HullBerth implements BerthSequence {
  readonly showsShip = true;
  readonly tAuto: number;
  readonly tLaunch: number;
  private s0 = new Vector3();
  private q0 = new Quaternion();
  /** +1 / −1: which local x is outboard (away from the anchor). */
  private readonly out: number;
  private orbit = 0;

  constructor(readonly spec: HullBerthSpec) {
    const p = spec.profile;
    this.tAuto = p.tAuto + p.tAttach;
    this.tLaunch = p.tRelease + p.tLaunch;
    this.out = spec.anchor.x > 0 ? -1 : 1;
  }

  private get L(): number {
    return Math.max(60, this.spec.length);
  }

  begin(_h: BerthHost, _d: BerthFrame, s0: Vector3, q0: Quaternion): void {
    this.s0.copy(s0);
    this.q0.copy(q0);
  }

  /** Approach path, berth-local: from where guidance caught her → alongside, all stop. */
  private path(e: number, out: Vector3): Vector3 {
    const s = this.s0;
    const L = this.L;
    // Stand off outboard on the way in, then close on the berth.
    const c1 = _a.set(s.x * 0.5 + this.out * L * 0.25, s.y * 0.5, s.z * 0.55);
    const c2 = _b.set(this.out * L * 0.35, 0, Math.max(L * 0.9, s.z * 0.2));
    const v = 1 - e;
    const b0 = v * v * v;
    const b1 = 3 * v * v * e;
    const b2 = 3 * v * e * e;
    return out.set(b0 * s.x + b1 * c1.x + b2 * c2.x, b0 * s.y + b1 * c1.y + b2 * c2.y, b0 * s.z + b1 * c1.z + b2 * c2.z);
  }

  /** Nose direction, berth-local: in along −z, swinging outboard round to nose-out (+z). */
  private heading(u: number, out: Vector3): Vector3 {
    const phi = Math.PI * smooth((u - 0.28) / 0.47);
    return out.set(this.out * Math.sin(phi), 0, -Math.cos(phi));
  }

  auto(h: BerthHost, d: BerthFrame, t: number, dt: number): void {
    const p = this.spec.profile;
    const pf = h.ship.flight;
    const u = Math.min(1, t / p.tAuto);
    const { e, dedu } = approachEase(p.cls, u);
    this.path(e, _l);
    h.toWorld(d, _l, pf.position);
    // Velocity from the path (finite difference, berth frame → world) + host drift.
    const e2 = approachEase(p.cls, Math.min(1, u + 0.01)).e;
    this.path(e2, _c).sub(_l);
    const du = 0.01 * p.tAuto;
    this.localDir(d, _c, pf.velocity).multiplyScalar(dedu > 0 && e2 > e ? 1 / du : 0).add(d.velocity);
    // Attitude: blend from the pilot's to the swing-round heading.
    this.heading(u, _f);
    this.localDir(d, _f, _a).normalize();
    orient(_q, _a, d.up);
    pf.orientation.copy(this.q0).slerp(_q, smooth(t / 2.2));
    pf.bodyRates.set(0, 0, 0);
    pf.throttle = 0;
    pf.boosting = false;
    h.syncModel(0);
    // Attach beat after all stop.
    const ta = Math.max(0, t - p.tAuto);
    this.attach(h, d, ta / Math.max(0.01, p.tAttach), h.clock);
    void dt;
  }

  /** k = 0..1 through the attach beat (0 = nothing, 1 = fully made fast). */
  private attach(h: BerthHost, d: BerthFrame, k: number, clock: number): void {
    const s = this.spec;
    if (s.mode === 'clamp') {
      s.station?.setChannel(s.channel ?? '', smooth(k / 0.6));
      h.fx?.umbilicals(this.towerPoints(h, d), this.hullPoints(h, d), smooth((k - 0.55) / 0.45));
      h.fx?.tether(null, null, 0, clock);
    } else {
      h.toWorld(d, s.anchor, _a);
      h.toWorld(d, this.flank(_l, 0.15), _b);
      h.fx?.tether(_a, _b, smooth(k / 0.7), clock);
      h.fx?.umbilicals([], [], 0);
    }
  }

  private flank(out: Vector3, zk: number): Vector3 {
    return out.set(-this.out * this.spec.halfBeam * 0.92, 0, this.L * zk);
  }

  private towerPoints(h: BerthHost, d: BerthFrame): Vector3[] {
    const s = this.spec;
    h.toWorld(d, _l.copy(s.root).setY(s.root.y + s.towerHalf * 0.8), _tw[0]);
    h.toWorld(d, _l.copy(s.root).setY(s.root.y + s.towerHalf * 0.1), _tw[1]);
    h.toWorld(d, _l.copy(s.root).setY(s.root.y - s.towerHalf * 0.7), _tw[2]);
    return _tw;
  }

  private hullPoints(h: BerthHost, d: BerthFrame): Vector3[] {
    h.toWorld(d, this.flank(_l, 0.18).setY(this.spec.halfBeam * 0.2), _hl[0]);
    h.toWorld(d, this.flank(_l, -0.05), _hl[1]);
    h.toWorld(d, this.flank(_l, -0.22).setY(-this.spec.halfBeam * 0.15), _hl[2]);
    return _hl;
  }

  /** Berth-local direction → world. */
  private localDir(d: BerthFrame, v: Vector3, out: Vector3): Vector3 {
    _r.crossVectors(d.up, d.axis);
    return out.set(0, 0, 0).addScaledVector(_r, v.x).addScaledVector(d.up, v.y).addScaledVector(d.axis, v.z);
  }

  hold(h: BerthHost, d: BerthFrame, t: number): void {
    const pf = h.ship.flight;
    h.toWorld(d, _l.set(0, 0, 0), pf.position);
    pf.velocity.copy(d.velocity);
    orient(pf.orientation, d.axis, d.up);
    h.syncModel(0);
    this.attach(h, d, 1, h.clock);
    // The lighter: hull → station and back while she rides at the berth.
    if (this.spec.mode !== 'clamp') {
      const c = (h.clock % LIGHTER_CYCLE) / LIGHTER_CYCLE;
      const leg = c < 0.5 ? smooth((c - 0.04) / 0.4) : 1 - smooth((c - 0.54) / 0.4);
      const from = this.flank(_a, -0.1).setY(this.spec.halfBeam * 0.6 + 12);
      const to = _b.copy(this.spec.root).setY(this.spec.root.y + 60);
      _l.copy(from).lerp(to, leg);
      _l.y += Math.sin(leg * Math.PI) * 50;
      h.toWorld(d, _l, _c);
      _u.subVectors(to, from).multiplyScalar(c < 0.5 ? 1 : -1);
      this.localDir(d, _u, _f).normalize();
      h.fx?.lighter(_c, _f, d.up);
    }
    void t;
  }

  launch(h: BerthHost, d: BerthFrame, t: number, dt: number): void {
    const p = this.spec.profile;
    const pf = h.ship.flight;
    h.fx?.lighter(null);
    if (t < p.tRelease) {
      const k = t / p.tRelease;
      const s = this.spec;
      if (s.mode === 'clamp') {
        h.fx?.umbilicals(this.towerPoints(h, d), this.hullPoints(h, d), 1 - smooth(k / 0.45));
        s.station?.setChannel(s.channel ?? '', 1 - smooth((k - 0.3) / 0.7));
      } else {
        h.toWorld(d, s.anchor, _a);
        h.toWorld(d, this.flank(_l, 0.15), _b);
        h.fx?.tether(_a, _b, 1 - smooth(k / 0.8), h.clock);
      }
      h.toWorld(d, _l.set(0, 0, 0), pf.position);
      pf.velocity.copy(d.velocity);
      orient(pf.orientation, d.axis, d.up);
      pf.boosting = false;
      h.syncModel(0.1 + 0.3 * k);
      return;
    }
    h.fx?.umbilicals([], [], 0);
    h.fx?.tether(null, null, 0, h.clock);
    this.spec.station?.setChannel(this.spec.channel ?? '', 0);
    const v = Math.min(1, (t - p.tRelease) / p.tLaunch);
    const run = p.launchRun;
    _l.set(this.out * 60 * smooth(v * 2), 0, run * v * v);
    h.toWorld(d, _l, pf.position);
    const speed = (2 * run * v) / p.tLaunch;
    pf.velocity.copy(d.axis).multiplyScalar(speed).add(d.velocity);
    orient(pf.orientation, d.axis, d.up);
    pf.bodyRates.set(0, 0, 0);
    pf.boosting = v > 0.4;
    h.syncModel();
    void dt;
  }

  camera(h: BerthHost, d: BerthFrame, phase: SeqPhase, t: number, eye: Vector3, cam: PerspectiveCamera, dt: number): number {
    const ship = h.ship.flight.position;
    const L = this.L;
    const p = this.spec.profile;
    const s = this.spec;
    let fov = 42;
    if (phase === 'auto') {
      if (t < p.tAuto * 0.45) {
        // A: tracking off her outboard quarter, the station stacked up behind the berth.
        h.toLocal(d, ship, _l);
        _l.x += this.out * 0.9 * L;
        _l.y += 0.4 * L;
        _l.z += 1.5 * L;
        h.toWorld(d, _l, eye);
        h.toWorld(d, s.anchor, _c);
        _c.lerp(ship, 0.7);
        fov = 44;
      } else if (t < p.tAuto) {
        // B: planted outboard, ahead of the berth, looking back in: she slides
        // alongside with the gantry / pylon and the station behind her.
        h.toWorld(d, _l.set(this.out * 1.4 * L + this.out * 60, 0.35 * L + 30, 1.1 * L + 80), eye);
        h.toWorld(d, s.anchor, _c);
        _c.lerp(ship, 0.55);
        fov = 48;
      } else {
        // C: high over the gap, the arm swinging out / the tether shooting across.
        h.toWorld(d, _l.set(s.anchor.x * 0.45 + this.out * 0.25 * L, 1.15 * L + 40, 0.95 * L), eye);
        h.toWorld(d, _l.set(s.anchor.x * 0.5, 0, 0), _c);
        fov = 44;
      }
    } else if (phase === 'docked') {
      // Orbit the berth wide enough for the whole hull and the station behind her.
      this.orbit += dt * 0.05;
      const dist = Math.max(3.2 * L, 650);
      const a = this.orbit + 0.9;
      h.toWorld(d, _l.set(this.out * Math.cos(a) * dist, dist * 0.34, Math.sin(a) * dist * 0.8 + L * 0.3), eye);
      h.toWorld(d, _l.set(s.anchor.x * 0.35, 0, 0), _c);
      fov = 42;
    } else if (t < p.tRelease + p.tLaunch * 0.35) {
      // Launch A: over the berth, lines dropping away, she pulls out.
      h.toWorld(d, _l.set(s.anchor.x * 0.8, 0.55 * L + 30, -0.7 * L), eye);
      _c.copy(ship);
      fov = 46;
    } else {
      // Launch B: planted up the corridor, she drives out toward and past us.
      h.toWorld(d, _l.set(this.out * 0.55 * L, -0.18 * L, p.launchRun * 0.85 + L), eye);
      _c.copy(ship);
      fov = 42;
    }
    look(cam.quaternion, eye, _c, d.up);
    return fov;
  }

  caption(phase: SeqPhase, t: number): { title: string; sub: string } {
    const s = this.spec;
    const what = s.mode === 'clamp' ? 'CLAMP BERTH' : s.mode === 'mooring' ? 'MOORING PYLON' : 'ALONGSIDE';
    if (phase === 'auto') {
      if (t > s.profile.tAuto) return { title: s.mode === 'clamp' ? 'DOCKING SEQUENCE // CLAMPS' : 'DOCKING SEQUENCE // MOORING LINE', sub: s.mode === 'clamp' ? 'ARM SWINGING OUT · UMBILICALS STANDING BY' : 'TETHER AWAY · LIGHTER STANDING BY' };
      return { title: 'DOCKING SEQUENCE // AUTO-GUIDANCE', sub: `${what} · ${Math.round(s.length)} m HULL · DEAD SLOW` };
    }
    if (phase === 'launch') return t < s.profile.tRelease ? { title: 'UNDOCKING // RELEASE', sub: s.mode === 'clamp' ? 'LINES CLEAR · ARM SWINGING HOME' : 'TETHER IN · LIGHTER ABOARD' } : { title: 'UNDOCKING // DRIVE LIT', sub: 'GOOD HUNTING, VANGUARD' };
    return { title: '', sub: '' };
  }

  iris(phase: SeqPhase, t: number): number {
    // Big berths keep the clamp / tether beat on screen: the iris only snaps shut at the very end.
    if (phase === 'auto') return t > this.tAuto - 0.45 ? Math.max(0, (this.tAuto - t) / 0.45) : 1;
    if (phase === 'launch') return Math.min(1, t / 0.6);
    return 1;
  }

  end(h: BerthHost, _d: BerthFrame): void {
    h.fx?.hide();
    this.spec.station?.setChannel(this.spec.channel ?? '', 0);
  }
}
