import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Dockable } from '../Docking';
import type { StationView } from '../Station';
import { berthClassFor } from '../berths/classes';
import { hullHalfExtents } from '../berths/sites';
import { look, orient, shake, smooth, type BerthFrame, type BerthHost, type BerthSequence, type SeqPhase } from '../berths/sequence';
import { postFx } from '@/render/post/PostFx';
import type { SurfacePortSite } from '@/universe/Universe';
import type { SurfaceWorld } from './SurfaceWorld';
import { DECK_ALT } from './SurfaceScene';
import type { PadInfo } from './City';

/**
 * Planetary descent (planetary ports): the orbital port's landing tether is a
 * corridor down to the surface port at its foot, flown without a load screen.
 *
 *   corridor   (pilot)  request with G below the station, fly down beside the
 *                       tether; guidance takes the ship at the entry gate
 *   entry      0.0–5.6  nose down the tether, plasma sheath builds, shake,
 *                       the planet's air fills the frame (veil + depth fog)
 *   clouds     5.6–7.2  cel cloud cards stream past, whiteout
 *   ── swap ── 7.2      under the whiteout: space out, surface scene in
 *   below      7.2–18.2 out of the deck base, a long descending glide at the
 *                       city (clouds overhead, towers and pads ahead)
 *   landing    18.2–23.4 hover over the pad, straight down, settle
 *   docked              the surface port's dock screen (market, concourse)
 *   launch     0–3 lift-off · 3–9.2 climb-out into the deck (whiteout, swap
 *                       back) · 9.2–13.2 up the tether out of the air, then
 *                       the pilot has her above the entry gate
 *
 * Space-side poses are in the corridor frame (origin: the entry gate beside
 * the tether, +z up out of the gravity well); surface-side poses in the
 * surface frame (+Y up, the tether foot at the origin). Everything is a pure
 * function of t, so captures seek straight to any beat (`?descent=`).
 */
export const DT = { align: 1.6, clouds: 5.6, swap: 7.2, glideEnd: 18.2, land: 23.4, lift: 3.0, upSwap: 9.2, out: 13.2 };
/** Entry gate altitude above the sphere (m), and the swap altitude. */
export const H_ENTRY = 2000;
const H_SWAP = 350;
/** The corridor runs beside the tether, not down it (the tether is solid). */
const TETHER_OFFSET = 220;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _l = new Vector3();
const _f = new Vector3();
const _u = new Vector3();
const _r = new Vector3();
const _q = new Quaternion();
const _p0 = new Vector3();
const _p1 = new Vector3();
const _step = new Vector3();
const _probe = new Vector3();
const _probeQ = new Quaternion();
const Y = new Vector3(0, 1, 0);

function bez(a: Vector3, b: Vector3, c: Vector3, d: Vector3, e: number, out: Vector3): Vector3 {
  const v = 1 - e;
  return out
    .copy(a)
    .multiplyScalar(v * v * v)
    .addScaledVector(b, 3 * v * v * e)
    .addScaledVector(c, 3 * v * e * e)
    .addScaledVector(d, e * e * e);
}

export class DescentSequence implements BerthSequence {
  readonly showsShip = true;
  readonly tAuto = DT.land;
  readonly tLaunch = DT.out;
  private s0 = new Vector3();
  private q0 = new Quaternion();
  private pad: PadInfo | null = null;
  /** The hull the pad was picked for (a shipyard swap on the pad re-picks). */
  private model: unknown = null;
  private L = 17;
  private hy = 3;
  private readonly dirIn: Vector3;
  private readonly side: Vector3;
  private orbit = 0;
  private lastPos = new Vector3();
  private hasLast = false;
  /** Corridor-frame z of the swap point (below the entry gate). */
  private readonly zSwap = -(H_ENTRY - H_SWAP);

  constructor(
    readonly port: SurfacePortSite,
    private station: StationView,
    private world: SurfaceWorld,
  ) {
    this.dirIn = new Vector3(Math.cos(port.heading), 0, Math.sin(port.heading));
    this.side = new Vector3().crossVectors(Y, this.dirIn).normalize();
  }

  /** Build the surface scene, pick the pad for this hull, attach the sheath. */
  private ready(h: BerthHost): PadInfo {
    const s = this.station.surface!;
    const scene = this.world.prepare(this.port, s.preset);
    const model = h.ship.model;
    this.model = model;
    this.L = Math.max(17, model.length);
    this.hy = hullHalfExtents(model).y;
    this.pad = scene.city.padFor(berthClassFor(model.length));
    this.world.fx.attach(model);
    return this.pad;
  }

  begin(h: BerthHost, _d: BerthFrame, s0: Vector3, q0: Quaternion): void {
    this.s0.copy(s0);
    this.q0.copy(q0);
    this.ready(h);
    this.hasLast = false;
  }

  // ── poses ───────────────────────────────────────────────────────────

  private surf(local: Vector3, out: Vector3): Vector3 {
    return this.world.toUniverse(local, out);
  }

  private rest(out: Vector3): Vector3 {
    return out.copy(this.pad!.pos).setY(this.pad!.pos.y + this.hy * 0.92);
  }

  private hover(out: Vector3): Vector3 {
    return this.rest(out).setY(out.y + 50 + 0.45 * this.L);
  }

  /** Descent pose at t: universe position + attitude. Returns true on the surface side. */
  private descentPose(h: BerthHost, d: BerthFrame, t: number, pos: Vector3, q: Quaternion): boolean {
    if (t < DT.swap) {
      const u = t / DT.swap;
      const e = 0.3 * u + 0.7 * u * u;
      const s = this.s0;
      bez(s, _a.set(s.x * 0.4, s.y * 0.4, s.z * 0.55), _b.set(0, 0, -400), _c.set(0, 0, this.zSwap), e, _l);
      h.toWorld(d, _l, pos);
      _f.copy(d.axis).negate();
      // A little attitude chatter in the thick of it.
      const chatter = 0.05 * smooth((t - 2) / 2) * Math.sin(t * 9.3);
      _u.copy(d.up).applyAxisAngle(_f, chatter);
      orient(_q, _f, _u);
      q.copy(this.q0).slerp(_q, smooth(t / DT.align));
      return false;
    }
    const H = this.hover(_b);
    if (t < DT.glideEnd) {
      const u = (t - DT.swap) / (DT.glideEnd - DT.swap);
      const e = 1 - Math.pow(1 - u, 1.6);
      const P0 = _p0.copy(this.pad!.pos).addScaledVector(this.dirIn, -5500).addScaledVector(this.side, 500).setY(DECK_ALT - 550);
      const c1 = _a.copy(P0).addScaledVector(this.dirIn, 2600).setY(P0.y - 200);
      const c2 = _c.copy(H).addScaledVector(this.dirIn, -(1200 + 2 * this.L)).setY(H.y + 260);
      bez(P0, c1, c2, H, e, _l);
      this.surf(_l, pos);
      // Nose along the path (pitch held shallow), settling onto the pad heading.
      const e2 = 1 - Math.pow(1 - Math.min(1, u + 0.02), 1.6);
      bez(P0, c1, c2, H, e2, _p1).sub(_l);
      if (_p1.lengthSq() < 1e-6) _p1.copy(this.dirIn);
      _p1.normalize();
      _p1.y = Math.max(-0.35, Math.min(0.2, _p1.y));
      _f.copy(_p1).normalize().lerp(this.dirIn, smooth((u - 0.7) / 0.3)).normalize();
      const bank = -0.25 * Math.sin(u * Math.PI) * Math.sign(_p1.x * this.dirIn.z - _p1.z * this.dirIn.x || 1);
      _u.copy(Y).applyAxisAngle(_f, bank);
      orient(q, _f, _u);
      return true;
    }
    const k = smooth((t - DT.glideEnd) / (DT.land - DT.glideEnd));
    const R = this.rest(_a);
    _l.copy(H).lerp(R, k);
    this.surf(_l, pos);
    orient(q, this.dirIn, Y);
    return true;
  }

  /** Launch pose at t. Returns true on the surface side. */
  private launchPose(h: BerthHost, d: BerthFrame, t: number, pos: Vector3, q: Quaternion): boolean {
    const R = this.rest(_a);
    const L1 = _b.copy(R).setY(R.y + 90 + 0.3 * this.L);
    if (t < DT.lift) {
      _l.copy(R).lerp(L1, smooth(t / DT.lift));
      this.surf(_l, pos);
      orient(q, this.dirIn, Y);
      return true;
    }
    if (t < DT.upSwap) {
      const u = (t - DT.lift) / (DT.upSwap - DT.lift);
      const e = u * u;
      const c1 = _p0.copy(L1).addScaledVector(this.dirIn, 700).setY(L1.y + 600);
      const c2 = _p1.copy(L1).addScaledVector(this.dirIn, 3800).setY(L1.y + 2300);
      const C = _c.copy(this.pad!.pos).addScaledVector(this.dirIn, 6500).setY(DECK_ALT + 300);
      bez(L1, c1, c2, C, e, _l);
      this.surf(_l, pos);
      const e2 = Math.min(1, u + 0.02);
      bez(L1, c1, c2, C, e2 * e2, _r).sub(_l);
      if (_r.lengthSq() < 1e-6) _r.copy(Y);
      _f.copy(_r).normalize().lerp(this.dirIn, 1 - smooth(u / 0.25)).normalize();
      orient(q, _f, Math.abs(_f.y) > 0.95 ? this.side : Y);
      return true;
    }
    const u = Math.min(1, (t - DT.upSwap) / (DT.out - DT.upSwap));
    // Decelerating out of the air, still climbing ~130 m/s when the pilot takes her.
    const e = 0.85 * (1 - (1 - u) * (1 - u)) + 0.15 * u;
    h.toWorld(d, _l.set(0, 0, this.zSwap + (1800 - this.zSwap) * e), pos);
    orient(q, d.axis, d.up);
    return false;
  }

  /** Set pose, velocity (finite difference, same side of the swap), surface state and entry FX. */
  private apply(h: BerthHost, d: BerthFrame, t: number, launch: boolean): void {
    const pf = h.ship.flight;
    const pose = (tt: number, p: Vector3, q: Quaternion) => (launch ? this.launchPose(h, d, tt, p, q) : this.descentPose(h, d, tt, p, q));
    const surface = pose(t, pf.position, pf.orientation);
    const hdt = 0.03;
    const t2 = launch ? Math.min(DT.out, t + hdt) : Math.min(DT.land, t + hdt);
    const same = pose(t2, _probe, _probeQ) === surface && t2 > t;
    if (same) pf.velocity.subVectors(_probe, pf.position).divideScalar(t2 - t);
    else if (!launch && t >= DT.land) pf.velocity.set(0, 0, 0);
    pf.bodyRates.set(0, 0, 0);
    pf.throttle = 0;
    this.world.setActive(surface);
    // Entry effects.
    const fx = this.world.fx;
    let sheath = 0;
    let veil = 0;
    let punch = 0;
    let flash = 0;
    let fog = 0;
    let boost = 0;
    if (!launch) {
      if (t < DT.swap) {
        sheath = smooth((t - 1.2) / 1.8);
        veil = smooth((t - 2.0) / 4.0) * 0.6;
        fog = smooth((t - 1.8) / 4.2) * 0.5;
        punch = smooth((t - DT.clouds) / 1.3);
        flash = smooth((t - 6.4) / 0.8);
        boost = 0.55 * sheath;
      } else {
        punch = 1 - smooth((t - DT.swap) / 1.4);
        flash = 1 - smooth((t - DT.swap) / 0.9);
      }
    } else if (t < DT.upSwap) {
      punch = smooth((t - 7.8) / 1.3);
      flash = smooth((t - 8.5) / 0.7);
      boost = 0.4 * smooth((t - DT.lift) / 3);
    } else {
      const k = (t - DT.upSwap) / 3;
      sheath = 0.6 * (1 - smooth(k));
      veil = 0.85 * (1 - smooth((t - DT.upSwap) / 2.6));
      fog = 0.8 * (1 - smooth((t - DT.upSwap) / 2.6));
      punch = 1 - smooth((t - DT.upSwap) / 1.2);
      flash = 1 - smooth((t - DT.upSwap) / 0.9);
      boost = 0.45 * (1 - smooth(k));
    }
    if (!surface) {
      postFx.fog = fog;
      postFx.fogColor.copy(this.world.entryTint);
      postFx.fogRange = 4;
    }
    postFx.flash = Math.max(postFx.flash, flash);
    postFx.boost = Math.max(postFx.boost, boost);
    _step.subVectors(pf.position, this.hasLast ? this.lastPos : pf.position);
    if (_step.lengthSq() > 4e6) _step.set(0, 0, 0); // the swap jump
    this.lastPos.copy(pf.position);
    this.hasLast = true;
    fx.set(h.clock, { sheath, veil, punch }, surface ? Y : d.axis, _step);
    pf.boosting = !surface && launch && t > DT.upSwap;
    h.syncModel(launch ? (t < DT.lift ? 0.5 : 1.3) : t < DT.swap ? 0.15 : t < DT.glideEnd ? 0.35 : 0.2);
  }

  auto(h: BerthHost, d: BerthFrame, t: number, _dt: number): void {
    if (!this.pad) this.ready(h);
    this.apply(h, d, t, false);
  }

  hold(h: BerthHost, d: BerthFrame, _t: number): void {
    if (!this.pad || this.model !== h.ship.model) this.ready(h);
    const pf = h.ship.flight;
    this.world.setActive(true);
    this.world.fx.set(h.clock, { sheath: 0, veil: 0, punch: 0 }, Y, _step.set(0, 0, 0));
    this.surf(this.rest(_a), pf.position);
    pf.velocity.set(0, 0, 0);
    orient(pf.orientation, this.dirIn, Y);
    h.syncModel(0);
    void d;
  }

  launch(h: BerthHost, d: BerthFrame, t: number, _dt: number): void {
    if (!this.pad || this.model !== h.ship.model) this.ready(h);
    if (t === 0 || !this.hasLast) this.world.fx.attach(h.ship.model);
    this.apply(h, d, t, true);
  }

  camera(h: BerthHost, d: BerthFrame, phase: SeqPhase, t: number, eye: Vector3, cam: PerspectiveCamera, dt: number): number {
    const ship = h.ship.flight.position;
    const L = Math.max(40, this.L);
    const pad = this.pad!;
    _r.crossVectors(d.up, d.axis);
    let fov = 44;
    let up: Vector3 = Y;
    let sh = 0;
    const target = _c;
    if (phase === 'auto' && t < DT.swap) {
      up = d.up;
      if (t < 3.2) {
        // Side-on, tracking: the planet's limb and its air band across the lower frame.
        eye.copy(ship).addScaledVector(_r, 2.4 * L + 60).addScaledVector(d.axis, 0.6 * L + 10).addScaledVector(d.up, 0.2 * L);
        target.copy(ship).addScaledVector(d.axis, -0.6 * L);
        fov = 46;
      } else {
        // Over her shoulder, looking down the well: the air fills the frame, the sheath glows round her.
        eye.copy(ship).addScaledVector(d.axis, 1.6 * L + 45).addScaledVector(_r, 0.7 * L + 20).addScaledVector(d.up, 0.5 * L + 12);
        target.copy(ship).addScaledVector(d.axis, -(1.2 * L + 120));
        fov = 46;
        sh = 0.4 + 1.6 * smooth((t - 3) / 2);
      }
    } else if (phase === 'auto') {
      if (t < DT.swap + 4.2) {
        // Off her quarter as she drops out of the deck: the city and the tether far ahead and below.
        h.ship.flight.forward(_f);
        eye.copy(ship).addScaledVector(_f, -(2.1 * L + 30)).addScaledVector(this.side, 1.3 * L + 20).addScaledVector(Y, 0.2 * L + 4);
        this.surf(pad.pos, _u);
        target.copy(ship).lerp(_u, 0.06);
        fov = 50;
        sh = 0.35;
      } else if (t < DT.glideEnd) {
        h.ship.flight.forward(_f);
        eye.copy(ship).addScaledVector(_f, -(2.6 * L + 50)).addScaledVector(Y, 0.7 * L + 18).addScaledVector(this.side, 0.5 * L);
        target.copy(ship).addScaledVector(_f, 600);
        fov = 48;
        sh = 0.25;
      } else {
        this.surf(this.padSide(_l), eye);
        target.copy(ship);
        fov = 44;
      }
    } else if (phase === 'docked') {
      this.orbit += dt * 0.05;
      const D = Math.max(150, 2.6 * L + 1.6 * pad.radius);
      this.surf(_l.set(Math.cos(this.orbit + 2) * D, 0.42 * D, Math.sin(this.orbit + 2) * D).add(pad.pos), eye);
      this.surf(_l.copy(pad.pos).setY(pad.pos.y + this.hy), target);
      fov = 44;
    } else if (t < DT.lift + 1.0) {
      this.surf(this.padSide(_l), eye);
      target.copy(ship);
      fov = 44;
      sh = 0.3;
    } else if (t < DT.upSwap) {
      this.surf(_l.copy(pad.pos).addScaledVector(this.side, 700).addScaledVector(this.dirIn, -400).setY(pad.pos.y + 120), eye);
      target.copy(ship);
      fov = 40;
    } else {
      up = d.up;
      eye.copy(ship).addScaledVector(d.axis, 1.8 * L + 60).addScaledVector(_r, 1.1 * L + 40);
      target.copy(ship).addScaledVector(d.axis, -200);
      fov = 46;
      sh = 1.2 * (1 - smooth((t - DT.upSwap) / 3));
    }
    if (sh > 0) eye.add(shake(h.clock, sh, _a));
    look(cam.quaternion, eye, target, up);
    return fov;
  }

  /**
   * Low beside the pad, where you watch her set down / lift off: on the
   * tether side of the pad (the apron inside the city blocks is clear), a
   * little off the radial line, looking out over the pad at the city.
   */
  private padSide(out: Vector3): Vector3 {
    const pad = this.pad!;
    const inward = _u.set(-pad.pos.x, 0, -pad.pos.z).normalize();
    const across = _r.set(-inward.z, 0, inward.x);
    const dist = pad.radius * 1.4 + 0.8 * this.L;
    return out
      .copy(pad.pos)
      .addScaledVector(inward, Math.cos(0.55) * dist)
      .addScaledVector(across, Math.sin(0.55) * dist)
      .setY(pad.pos.y + 12 + 0.15 * this.L);
  }

  caption(phase: SeqPhase, t: number): { title: string; sub: string } {
    const pad = `PAD ${String(this.pad?.number ?? 1).padStart(2, '0')}`;
    if (phase === 'launch') {
      if (t < DT.lift) return { title: `LIFT-OFF // ${pad}`, sub: `${this.port.name.toUpperCase()} TOWER · CLEAR TO LIFT` };
      if (t < DT.upSwap) return { title: 'CLIMB-OUT // CLOUD DECK', sub: 'FULL THRUST · NOSE UP' };
      return { title: 'ORBIT // TETHER CORRIDOR', sub: 'OUT OF THE AIR · GUIDANCE RELEASING' };
    }
    if (t < DT.align) return { title: 'DESCENT // AUTO-GUIDANCE', sub: 'LANDING CORRIDOR · TETHER LIGHTS IN SIGHT' };
    if (t < DT.clouds) return { title: 'ENTRY INTERFACE', sub: 'PLASMA SHEATH · HULL TEMPERATURE CLIMBING' };
    if (t < DT.swap) return { title: 'CLOUD DECK', sub: 'PUNCHING THROUGH' };
    if (t < DT.glideEnd) return { title: 'BELOW THE DECK', sub: `VISUAL ON ${this.port.name.toUpperCase()} · ${pad}` };
    return { title: `FINAL // ${pad}`, sub: 'HOVER · GEAR DOWN · DEAD SLOW' };
  }

  iris(phase: SeqPhase, t: number): number {
    if (phase === 'auto') return t > DT.land - 0.9 ? Math.max(0, (DT.land - t) / 0.9) : 1;
    return Math.min(1, t / 0.6);
  }

  end(_h: BerthHost, _d: BerthFrame): void {
    this.world.release();
    postFx.fog = 0;
    this.pad = null;
    this.hasLast = false;
  }
}

/**
 * The landing corridor at an orbital port with a surface port under it:
 * a dockable whose "bay" is the entry gate beside the tether ~2 km above the
 * air, corridor axis straight up the well. Requestable within 5 km of the
 * tether, below the station.
 */
export function descentDockable(st: StationView, world: SurfaceWorld): Dockable | null {
  const s = st.surface;
  if (!s) return null;
  const axis = st.axis;
  const entry = s.planetCenter.clone().addScaledVector(axis, s.planetRadius + H_ENTRY).addScaledVector(st.up, TETHER_OFFSET);
  const top = st.center.clone().addScaledVector(axis, st.tetherTop).addScaledVector(st.up, TETHER_OFFSET);
  const seg = top.clone().sub(entry);
  const len = seg.length();
  seg.normalize();
  const port = s.port;
  return {
    id: port.id,
    kind: 'surface',
    faction: port.faction,
    risk: port.risk,
    name: port.name,
    bay: entry,
    axis,
    up: st.up,
    velocity: new Vector3(),
    center: s.planetCenter,
    radius: s.planetRadius,
    inside: 0,
    interior: { hw: 90, hh: 60, depth: 0 },
    cls: 'descent',
    label: 'LANDING CORRIDOR',
    profile: { cls: 'descent', autoRange: 2800, lapseRange: 9000, lateralTol: 1500, minOut: -600, maxClosing: 1600, tAuto: DT.land, tAttach: 0, tRelease: 0, tLaunch: DT.out, launchRun: 3500, corridorScale: 3.2 },
    rangeTo(p: Vector3): number {
      if (_a.subVectors(p, st.center).dot(axis) > -300) return Infinity; // above the anchor: that's the station's berth
      const k = Math.min(len, Math.max(0, _b.subVectors(p, entry).dot(seg)));
      return _c.copy(entry).addScaledVector(seg, k).distanceTo(p);
    },
    seq: new DescentSequence(port, st, world),
  };
}
