import { Matrix4, Quaternion, Vector3, type Group, type PerspectiveCamera } from 'three';
import { hostile, type Fleet, type ShipEntity } from '@/sim/Fleet';
import type { EconFaction, MarketSpec } from '@/game/economy';
import type { StarSystemView } from './StarSystemView';
import { BAY_INSIDE, BAY_INTERIOR, type StationView } from './Station';
import { CV_BAY, HESPERUS_DAWN } from '@/assets/blueprints/concord-fleet';
import { BayCurtain } from './BayCurtain';
import { approachProfile, berthClassFor, carrierBerth, BERTH_LABEL, type ApproachProfile, type BerthClass } from './berths/classes';
import { hullHalfExtents, type StationBerth } from './berths/sites';
import { HullBerth } from './berths/HullBerth';
import { BerthFx } from './berths/BerthFx';
import type { BerthHost, BerthSequence } from './berths/sequence';

/**
 * Docking (stations, friendly carriers, orbital ports).
 *
 *   free ──G──▶ cleared ──(< 1 km, on the corridor)──▶ auto ──▶ docked ──Launch──▶ launch ──▶ free
 *
 * - Request with G within 5 km of a bay. Hostiles within 10 km, or standing
 *   too low with the owner, deny it.
 * - Cleared: the HUD draws the approach corridor (ILS gates) out along the
 *   bay axis; the pilot flies it. Drifting beyond 7.5 km lapses clearance;
 *   hostiles closing inside 10 km wave you off.
 * - Auto-dock under 1 km: the station's guidance takes the ship. The ship
 *   pose is scripted in the BAY frame (a Bézier from where you were onto the
 *   centreline and through the mouth, easing to a stop), so it works for a
 *   carrier steaming along at 16 m/s exactly as for a station. Two hard
 *   camera cuts, OVA style: a long-lens three-quarter, then the view from the
 *   bay mouth as the ship slides past the lit frame.
 * - Docked: the sim freezes (the scene runs dt = 0), the camera orbits the
 *   station behind the dock screen.
 * - Launch: the ship is fired back out along the corridor at ~330 m/s and
 *   handed back to the pilot.
 *
 * Physics stays in metres; everything here is laid out in 1 km steps.
 *
 * Every hull size docks (world/berths): fighters (≤ 40 m) fly into the bay
 * as above; gunships and corvettes are clamped alongside a gantry; frigates
 * moor off a pylon on a tether; carriers take corvettes alongside. Those
 * berths — and the planetary descent to a surface port (world/surface) —
 * hand the ship to a `BerthSequence` for the scripted phases; the request /
 * corridor / clearance logic is shared, with approach numbers from the hull
 * length (`approachProfile`).
 */
export interface Dockable extends MarketSpec {
  name: string;
  /** Universe-space bay mouth, unit corridor axis (out of the bay), unit up. */
  bay: Vector3;
  axis: Vector3;
  up: Vector3;
  velocity: Vector3;
  /** Framing: centre and rough radius of the host structure. */
  center: Vector3;
  radius: number;
  /** Parking depth inside the bay (m). */
  inside: number;
  /** Bay interior: half width / half height of the mouth, depth to the back wall (m). */
  interior: { hw: number; hh: number; depth: number };
  /** Atmosphere curtain across the mouth (ripples as the ship crosses). */
  curtain?: BayCurtain;
  station?: StationView;
  ship?: ShipEntity;
  /** Hull size class this berth serves ('descent': the landing corridor to a surface port). Default 'bay'. */
  cls?: BerthClass | 'descent';
  /** Approach numbers (capture window, closing-speed cap, corridor scale); default: the bay's. */
  profile?: ApproachProfile;
  /** Scripted berthing for non-bay berths (clamp, mooring, alongside, descent). */
  seq?: BerthSequence;
  /** Request range from `p` (default: distance to the bay point). */
  rangeTo?(p: Vector3): number;
  /** Berth refused outright (a frigate at a carrier), with the reason. */
  deny?: string;
  /** HUD / radio label for the berth ("CLAMP BERTH 2"). */
  label?: string;
}

export type DockPhase = 'free' | 'cleared' | 'auto' | 'docked' | 'launch';

export const DOCK_RANGE = 5000;
export const HOSTILE_RANGE = 10_000;
export const AUTO_RANGE = 1000;
const LAPSE_RANGE = 7500;
const T_AUTO = 7.0;
const T_LAUNCH = 3.4;
const LAUNCH_RUN = 560;
const CUT_B = 2.6;
const CUT_C = 5.1;
const LAUNCH_CUT = 1.25;

const ECON = new Set<string>(['concord', 'choir', 'rustwake']);
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _r = new Vector3();
const _l = new Vector3();
const _q = new Quaternion();
const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();
const ZERO = new Vector3();

const BAY_PROFILE = approachProfile('bay', 17);

export class DockingController implements BerthHost {
  phase: DockPhase = 'free';
  /** Dockable we're cleared for / berthed at. */
  target: Dockable | null = null;
  /** Nearest dockable within 5 km (free / cleared). */
  nearest: Dockable | null = null;
  /** Seconds into the current phase. */
  t = 0;
  message = '';
  messageColor = '#7dffb2';
  private messageT = 0;
  onDocked: ((d: Dockable) => void) | null = null;
  onLaunched: ((d: Dockable) => void) | null = null;
  /** Auto-dock start pose, bay-local. */
  private s0 = new Vector3();
  private q0 = new Quaternion();
  private list: Dockable[] = [];
  private stationDocks = new Map<StationView, Dockable>();
  private carrierDocks = new Map<ShipEntity, Dockable & { local: Vector3; localFwd: Vector3 }>();
  private sinceLaunch = 99;
  /** Captures: start the auto-dock this many seconds in. */
  skipTo = 0;
  /**
   * Set (with a reason) when docking isn't available right now — campaign
   * episodes that don't allow it. Blocks requests and hides the prompt.
   */
  lockout: string | null = null;
  private orbitA = 0;
  /** Berth visuals (umbilicals, tether, lighter), under the world root once attached. */
  fx: BerthFx | null = null;
  /** Real seconds (berth lights keep pulsing while the world is frozen). */
  clock = 0;
  private hullDocks = new Map<string, Dockable>();
  private alongside = new WeakMap<Dockable, number>();
  private slowT = 0;
  /** Planetary descents: the flight scene supplies a landing-corridor dockable per orbital port. */
  descent: ((st: StationView) => Dockable | null) | null = null;

  constructor(
    private view: () => StarSystemView,
    private fleet: Fleet,
    private player: ShipEntity,
  ) {}

  /** The player changed hulls at the shipyard: guidance flies the new one. */
  setPlayer(p: ShipEntity): void {
    this.player = p;
    this.hullDocks.clear();
  }

  /** Berth visuals live under the world root (universe-positioned). */
  attach(root: Group): void {
    this.fx ??= new BerthFx();
    root.add(this.fx.group);
  }

  /** BerthHost: the ship guidance flies. */
  get ship(): ShipEntity {
    return this.player;
  }

  /** Size class of the hull we're flying. */
  get berthClass(): BerthClass {
    return berthClassFor(this.player.model.length);
  }

  /** Letterbox caption + iris for the current sequence (null: the bay's own). */
  caption(): { title: string; sub: string; iris: number } | null {
    const d = this.target;
    if (!d?.seq || !this.busy || this.phase === 'docked') return null;
    const ph = this.phase as 'auto' | 'launch';
    return { ...d.seq.caption(ph, this.t), iris: d.seq.iris(ph, this.t) };
  }

  /** The docking sequence owns the ship (inputs ignored, HUD hidden). */
  get busy(): boolean {
    return this.phase === 'auto' || this.phase === 'docked' || this.phase === 'launch';
  }
  /** Berthed: the scene runs at dt = 0. */
  get frozen(): boolean {
    return this.phase === 'docked';
  }

  say(text: string, color = '#7dffb2', seconds = 4): void {
    this.message = text;
    this.messageColor = color;
    this.messageT = seconds;
  }

  /** Every dockable in the system right now: stations + friendly carriers with a hangar. */
  dockables(): Dockable[] {
    const out = this.list;
    out.length = 0;
    const cls = this.berthClass;
    for (const st of this.view().stations) {
      const desc = this.descent?.(st);
      if (desc) out.push(desc);
      if (cls !== 'bay') {
        const hd = this.hullDock(st, cls);
        if (hd) out.push(hd);
        continue;
      }
      let d = this.stationDocks.get(st);
      if (!d) {
        d = {
          id: st.site.id,
          kind: st.site.kind,
          faction: st.site.faction,
          name: st.site.name,
          bay: st.bay,
          axis: st.axis,
          up: st.up,
          velocity: ZERO,
          center: st.center,
          radius: st.radius,
          inside: BAY_INSIDE,
          interior: BAY_INTERIOR,
          curtain: st.curtain,
          station: st,
          risk: st.site.risk,
        };
        this.stationDocks.set(st, d);
      }
      out.push(d);
    }
    for (const s of this.fleet.ships) {
      if (!s.alive || s.isPlayer || s.team !== this.player.team || s.model.radius < 200 || !ECON.has(s.faction)) continue;
      const offer = carrierBerth(cls);
      const d = offer === 'hangar' ? this.carrierDock(s) : this.carrierAlongside(s, offer !== null);
      if (d) out.push(d);
    }
    return out;
  }

  /**
   * A station's clamp gantry (gunships, corvettes) or mooring pylon (frigates)
   * for the hull we fly: the site nearest the ship, locked once cleared.
   */
  private hullDock(st: StationView, cls: BerthClass): Dockable | null {
    if (this.target?.station === st && this.target.cls === cls && this.phase !== 'free') return this.target;
    const sites = st.berths.filter((b) => b.cls === cls);
    if (!sites.length) return null;
    const p = this.player.flight.position;
    let best: Dockable | null = null;
    let bd = Infinity;
    for (const b of sites) {
      const d = this.hullSite(st, b, cls);
      const r = d.bay.distanceTo(p);
      if (r < bd) {
        bd = r;
        best = d;
      }
    }
    return best;
  }

  private hullSite(st: StationView, b: StationBerth, cls: BerthClass): Dockable {
    const key = `${st.site.id}:${b.cls}:${b.index}`;
    let d = this.hullDocks.get(key);
    if (d) return d;
    const model = this.player.model;
    const half = hullHalfExtents(model);
    const L = model.length;
    // Station frame: hull centre alongside the pad / off the bollard, nose out (+Z).
    const centre = b.tip.clone().addScaledVector(b.side, b.gap + half.x);
    const right = new Vector3().crossVectors(b.up, new Vector3(0, 0, 1));
    const toBerth = (v: Vector3) => {
      const o = v.clone().sub(centre);
      return new Vector3(o.dot(right), o.dot(b.up), o.z);
    };
    const profile = approachProfile(cls, L);
    const label = `${BERTH_LABEL[cls]}${cls === 'clamp' ? ` ${b.index + 1}` : ''}`;
    d = {
      id: st.site.id,
      kind: st.site.kind,
      faction: st.site.faction,
      name: st.site.name,
      bay: centre.clone().applyQuaternion(st.quaternion).add(st.center),
      axis: st.axis,
      up: b.up.clone().applyQuaternion(st.quaternion),
      velocity: ZERO,
      center: st.center,
      radius: st.radius,
      inside: 0,
      interior: { hw: half.x * 2, hh: half.y * 2, depth: 0 },
      station: st,
      risk: st.site.risk,
      cls,
      profile,
      label,
      seq: new HullBerth({
        mode: cls === 'clamp' ? 'clamp' : 'mooring',
        profile,
        length: L,
        halfBeam: half.x,
        anchor: toBerth(b.tip),
        root: toBerth(b.root),
        towerHalf: b.towerHalf,
        station: st.model,
        channel: b.channel,
        name: st.site.name,
      }),
    };
    this.hullDocks.set(key, d);
    return d;
  }

  /** Corvettes ride alongside a friendly carrier on a tether; frigates are turned away. */
  private carrierAlongside(s: ShipEntity, ok: boolean): Dockable | null {
    const key = `carrier:${s.name}:alongside:${ok ? 1 : 0}`;
    let d = this.hullDocks.get(key);
    if (!d) {
      const ch = hullHalfExtents(s.model);
      const half = hullHalfExtents(this.player.model);
      const L = this.player.model.length;
      const profile = approachProfile('clamp', L);
      d = {
        id: `carrier:${s.name}`,
        kind: 'carrier',
        faction: s.faction as EconFaction,
        name: s.name,
        bay: new Vector3(),
        axis: new Vector3(),
        up: new Vector3(),
        velocity: s.flight.velocity,
        center: s.flight.position,
        radius: s.model.radius * 0.6,
        inside: 0,
        interior: { hw: half.x * 2, hh: half.y * 2, depth: 0 },
        ship: s,
        cls: 'clamp',
        profile,
        label: 'ALONGSIDE',
        deny: ok ? undefined : 'THE DECK TAKES FIGHTERS AND CORVETTES — MOOR A FRIGATE AT A STATION',
        seq: ok ? new HullBerth({ mode: 'alongside', profile, length: L, halfBeam: half.x, anchor: new Vector3(-(70 + half.x), 0, 0), root: new Vector3(-(70 + half.x + 40), 30, -L * 0.2), towerHalf: 0, name: s.name }) : undefined,
      };
      this.alongside.set(d, ch.x + 70 + half.x); // lateral offset from the carrier centreline
      this.hullDocks.set(key, d);
    }
    const f = s.flight;
    d.bay.set(this.alongside.get(d) ?? 0, 0, 0).applyQuaternion(f.orientation).add(f.position);
    d.axis.set(0, 0, 1).applyQuaternion(f.orientation).normalize();
    d.up.set(0, 1, 0).applyQuaternion(f.orientation);
    return d;
  }

  private carrierDock(s: ShipEntity): Dockable | null {
    let d = this.carrierDocks.get(s);
    if (d === undefined) {
      const sock = s.model.sockets.get('bow-bay') ?? [...s.model.sockets.values()].find((o) => o.userData.kind === 'hangar' && o.parent === s.model.root);
      if (!sock) return null;
      // The Hesperus Dawn's bow hangar is a real hollow bay (bays.ts); other
      // hulls fall back to a generic recess size and no curtain.
      const hollow = s.model.blueprint.id === HESPERUS_DAWN.id && s.model.sockets.get('bow-bay') === sock;
      const k = HESPERUS_DAWN.scale ?? 100;
      const interior = hollow ? { hw: (CV_BAY.w / 2) * k, hh: (CV_BAY.h / 2) * k, depth: (CV_BAY.mouth - CV_BAY.back) * k } : { hw: 45, hh: 25, depth: 60 };
      let curtain: BayCurtain | undefined;
      if (hollow) {
        curtain = new BayCurtain(interior.hw * 2, interior.hh * 2, '#6fe6ff');
        curtain.mesh.position.copy(sock.position).addScaledVector(new Vector3(0, 0, 1).applyQuaternion(sock.quaternion), -3);
        curtain.mesh.quaternion.copy(sock.quaternion);
        s.model.root.add(curtain.mesh);
      }
      d = {
        id: `carrier:${s.name}`,
        kind: 'carrier',
        faction: s.faction as EconFaction,
        name: s.name,
        bay: new Vector3(),
        axis: new Vector3(),
        up: new Vector3(),
        velocity: s.flight.velocity,
        center: s.flight.position,
        radius: s.model.radius * 0.6,
        inside: hollow ? 32 : 40,
        interior,
        curtain,
        ship: s,
        local: sock.position.clone(),
        localFwd: new Vector3(0, 0, 1).applyQuaternion(sock.quaternion),
      };
      this.carrierDocks.set(s, d);
    }
    const f = s.flight;
    d.bay.copy(d.local).applyQuaternion(f.orientation).add(f.position);
    d.axis.copy(d.localFwd).applyQuaternion(f.orientation).normalize();
    d.up.set(0, 1, 0).applyQuaternion(f.orientation);
    d.up.addScaledVector(d.axis, -d.up.dot(d.axis)).normalize();
    return d;
  }

  /** Nearest hostile within 10 km of the player, if any. */
  hostileNear(): ShipEntity | null {
    const p = this.player.flight.position;
    for (const s of this.fleet.ships) {
      if (s.alive && hostile(s, this.player) && s.flight.position.distanceTo(p) < HOSTILE_RANGE) return s;
    }
    return null;
  }

  /** G: request docking (or cancel a standing clearance). */
  request(clearance: (d: Dockable) => { ok: boolean; reason?: string }): void {
    if (this.busy) return;
    if (this.phase === 'cleared') {
      this.phase = 'free';
      this.target = null;
      this.say('DOCKING REQUEST CANCELLED', '#ffc46b');
      return;
    }
    if (this.lockout) {
      this.say(this.lockout, '#ffc46b');
      return;
    }
    const d = this.nearest;
    if (!d) {
      this.say('NO BERTH IN RANGE — CLOSE TO 5 km OF A STATION OR CARRIER', '#ffc46b');
      return;
    }
    if (!this.player.alive) return;
    if (d.deny) {
      this.say(`${d.name.toUpperCase()}: ${d.deny}`, '#ffc46b', 5);
      return;
    }
    const h = this.hostileNear();
    if (h) {
      this.say(`${d.name.toUpperCase()}: DOCKING DENIED — HOSTILES WITHIN 10 km`, '#ff5f7a', 5);
      return;
    }
    const c = clearance(d);
    if (!c.ok) {
      this.say(`${d.name.toUpperCase()}: ${c.reason ?? 'DOCKING DENIED'}`, '#ff5f7a', 5);
      return;
    }
    this.phase = 'cleared';
    this.target = d;
    this.t = 0;
    this.player.flight.cruise = 'off'; // drop out of cruise for the approach
    const prof = d.profile ?? BAY_PROFILE;
    const at = `${(prof.autoRange / 1000).toFixed(1)} km`;
    if (d.cls === 'descent') this.say(`${d.name.toUpperCase()}: CLEARED FOR DESCENT. FOLLOW THE TETHER DOWN — GUIDANCE TAKES YOU AT THE ENTRY GATE.`, '#6fe6ff', 6);
    else if (d.cls && d.cls !== 'bay') this.say(`${d.name.toUpperCase()}: CLEARED, ${d.label ?? 'BERTH'}. FLY THE CORRIDOR UNDER ${Math.round(prof.maxClosing)} m/s — GUIDANCE TAKES YOU AT ${at}.`, '#6fe6ff', 6);
    else this.say(`${d.name.toUpperCase()}: CLEARED TO DOCK, BERTH ${berth(d)}. FLY THE CORRIDOR — GUIDANCE TAKES YOU AT 1 km.`, '#6fe6ff', 6);
  }

  /** Bay-local → universe. */
  toWorld(d: Dockable, local: Vector3, out: Vector3): Vector3 {
    _r.crossVectors(d.up, d.axis);
    return out.copy(d.bay).addScaledVector(_r, local.x).addScaledVector(d.up, local.y).addScaledVector(d.axis, local.z);
  }

  /** Universe → bay-local. */
  toLocal(d: Dockable, world: Vector3, out: Vector3): Vector3 {
    _r.crossVectors(d.up, d.axis);
    _a.subVectors(world, d.bay);
    return out.set(_a.dot(_r), _a.dot(d.up), _a.dot(d.axis));
  }

  /** Step after the fleet has flown. */
  update(dt: number): void {
    const pf = this.player.flight;
    this.messageT -= dt;
    if (this.messageT <= 0) this.message = '';
    this.sinceLaunch += dt;
    this.clock += dt;
    this.slowT -= dt;
    const all = this.dockables();
    // Stale target (jumped away, carrier died).
    if (this.target && !all.includes(this.target)) {
      if (this.phase === 'cleared') this.say('CLEARANCE LAPSED — BERTH LOST', '#ffc46b');
      if (this.phase !== 'free') this.reset();
    }

    if (this.phase === 'free' || this.phase === 'cleared') {
      let best: Dockable | null = null;
      let bd = DOCK_RANGE;
      for (const d of all) {
        const dist = d.rangeTo ? d.rangeTo(pf.position) : d.bay.distanceTo(pf.position);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
      this.nearest = this.sinceLaunch > 4 && !this.lockout ? best : null;
    }
    // Curtains: the berth we're flying into ripples where the ship crosses.
    const inBay = this.phase === 'auto' || this.phase === 'launch' || this.phase === 'docked';
    for (const d of all) d.curtain?.setShip(inBay && d === this.target ? this.toLocal(d, pf.position, _b) : null, dt);

    switch (this.phase) {
      case 'cleared': {
        const d = this.target!;
        const range = d.bay.distanceTo(pf.position);
        const prof = d.profile ?? BAY_PROFILE;
        if (!this.player.alive) {
          this.reset();
          break;
        }
        if ((d.rangeTo ? d.rangeTo(pf.position) : range) > (d.profile ? prof.lapseRange : LAPSE_RANGE)) {
          this.say('CLEARANCE LAPSED — OUT OF RANGE', '#ffc46b');
          this.reset();
          break;
        }
        if (this.hostileNear()) {
          this.say(`${d.name.toUpperCase()}: WAVE-OFF, WAVE-OFF — HOSTILES INSIDE 10 km`, '#ff5f7a', 5);
          this.reset();
          break;
        }
        const l = this.toLocal(d, pf.position, _b);
        if (range < (d.profile ? prof.autoRange : AUTO_RANGE) && l.z > prof.minOut && Math.hypot(l.x, l.y) < prof.lateralTol) {
          const closing = _c.subVectors(pf.velocity, d.velocity).length();
          if (closing <= prof.maxClosing) this.beginAuto();
          else if (this.slowT <= 0) {
            this.slowT = 3;
            this.say(`${d.name.toUpperCase()}: TOO FAST FOR GUIDANCE — SLOW BELOW ${Math.round(prof.maxClosing)} m/s`, '#ffc46b', 3);
          }
        }
        break;
      }
      case 'auto':
        this.stepAuto(dt);
        break;
      case 'docked': {
        const d = this.target!;
        if (d.seq) {
          this.t += dt;
          d.seq.hold(this, d, this.t);
          break;
        }
        this.toWorld(d, _a.set(0, 0, -d.inside), pf.position);
        pf.velocity.copy(d.velocity);
        this.syncModel();
        break;
      }
      case 'launch':
        this.stepLaunch(dt);
        break;
    }
  }

  private beginAuto(): void {
    const d = this.target!;
    const pf = this.player.flight;
    this.phase = 'auto';
    this.t = this.skipTo;
    this.skipTo = 0;
    this.toLocal(d, pf.position, this.s0);
    this.q0.copy(pf.orientation);
    pf.cruise = 'off';
    d.seq?.begin(this, d, this.s0, this.q0);
    this.say(`${d.name.toUpperCase()}: GUIDANCE HAS YOUR SHIP. HANDS OFF THE STICK, VANGUARD.`, '#6fe6ff', 5);
  }

  /** Cubic Bézier in bay-local space: where you were → onto the centreline → through the mouth. */
  private autoPoint(u: number, out: Vector3, tangent?: Vector3): Vector3 {
    const d = this.target!;
    const s = this.s0;
    const c1x = s.x * 0.55;
    const c1y = s.y * 0.55;
    const c1z = s.z * 0.62;
    const c2z = Math.max(90, s.z * 0.22);
    const ez = -d.inside;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;
    out.set(b0 * s.x + b1 * c1x, b0 * s.y + b1 * c1y, b0 * s.z + b1 * c1z + b2 * c2z + b3 * ez);
    if (tangent) {
      const d0 = 3 * v * v;
      const d1 = 6 * v * u;
      const d2 = 3 * u * u;
      tangent.set(d0 * (c1x - s.x) + d1 * (0 - c1x), d0 * (c1y - s.y) + d1 * (0 - c1y), d0 * (c1z - s.z) + d1 * (c2z - c1z) + d2 * (ez - c2z));
    }
    return out;
  }

  private stepAuto(dt: number): void {
    const d = this.target!;
    const pf = this.player.flight;
    this.t += dt;
    if (d.seq) {
      d.seq.auto(this, d, Math.min(this.t, d.seq.tAuto), dt);
      if (this.t >= d.seq.tAuto) {
        this.phase = 'docked';
        this.t = 0;
        this.player.model.root.visible = d.seq.showsShip;
        this.onDocked?.(d);
      }
      return;
    }
    const u = Math.min(1, this.t / T_AUTO);
    const e = 1 - (1 - u) * (1 - u); // ease out: arrive, slow, stop
    const dedt = (2 * (1 - u)) / T_AUTO;
    const tan = _c;
    this.autoPoint(e, _b, tan);
    this.toWorld(d, _b, pf.position);
    // Velocity (for dust, audio, camera) = path speed along the tangent + host drift.
    _r.crossVectors(d.up, d.axis);
    _a.set(0, 0, 0).addScaledVector(_r, tan.x).addScaledVector(d.up, tan.y).addScaledVector(d.axis, tan.z);
    pf.velocity.copy(_a).multiplyScalar(dedt).add(d.velocity);
    // Nose down the path, wings level with the station; blend in from the pilot's attitude.
    if (_a.lengthSq() < 1e-6) _a.copy(d.axis).negate();
    orient(_q, _a.normalize(), d.up);
    const k = smooth(Math.min(1, this.t / 1.6));
    pf.orientation.copy(this.q0).slerp(_q, k);
    pf.bodyRates.set(0, 0, 0);
    pf.throttle = 0;
    pf.boosting = false;
    this.syncModel(0); // drive cold: guidance slides her in on thrusters
    if (u >= 1) {
      this.phase = 'docked';
      this.t = 0;
      this.player.model.root.visible = false;
      this.onDocked?.(d);
    }
  }

  /** Force-berth (screenshots / scripted): skip straight to docked at `d`. */
  berth(d: Dockable): void {
    this.target = d;
    this.phase = 'docked';
    this.t = 0;
    this.player.model.root.visible = d.seq ? d.seq.showsShip : false;
    if (d.seq) {
      this.toLocal(d, this.player.flight.position, this.s0);
      d.seq.begin(this, d, this.s0, this.player.flight.orientation);
    }
    this.update(0);
    this.onDocked?.(d);
  }

  /** Force-clear for an approach (screenshots). */
  clear(d: Dockable): void {
    this.target = d;
    this.phase = 'cleared';
    this.t = 0;
  }

  /** Launch from the berth: fired back out along the corridor. */
  launch(): void {
    if (this.phase !== 'docked' || !this.target) return;
    this.phase = 'launch';
    this.t = 0;
    this.player.model.root.visible = true;
    const d = this.target;
    const line = d.cls === 'descent' ? 'CLEAR TO LIFT. SEE YOU ABOVE THE WEATHER, VANGUARD.' : d.seq ? 'LINES CLEAR. GOOD HUNTING, VANGUARD.' : 'LAUNCH, LAUNCH, LAUNCH. GOOD HUNTING, VANGUARD.';
    this.say(`${d.name.toUpperCase()}: ${line}`, '#7dffb2', 5);
  }

  private stepLaunch(dt: number): void {
    const d = this.target!;
    const pf = this.player.flight;
    this.t += dt;
    if (d.seq) {
      d.seq.launch(this, d, Math.min(this.t, d.seq.tLaunch), dt);
      if (this.t >= d.seq.tLaunch) {
        d.seq.end(this, d);
        pf.throttle = 0.8;
        pf.boosting = false;
        this.phase = 'free';
        this.sinceLaunch = 0;
        this.target = null;
        this.onLaunched?.(d);
      }
      return;
    }
    const u = Math.min(1, this.t / T_LAUNCH);
    const run = LAUNCH_RUN + d.inside;
    this.toWorld(d, _b.set(0, 0, -d.inside + run * u * u), pf.position);
    const speed = (2 * run * u) / T_LAUNCH;
    pf.velocity.copy(d.axis).multiplyScalar(speed).add(d.velocity);
    orient(pf.orientation, d.axis, d.up);
    pf.bodyRates.set(0, 0, 0);
    pf.boosting = u > 0.35;
    this.syncModel();
    if (u >= 1) {
      pf.throttle = 0.8;
      pf.boosting = false;
      this.phase = 'free';
      this.sinceLaunch = 0;
      const was = d;
      this.target = null;
      this.onLaunched?.(was);
    }
  }

  syncModel(plume?: number): void {
    const s = this.player;
    s.model.root.position.copy(s.flight.position);
    s.model.root.quaternion.copy(s.flight.orientation);
    s.model.setThrottle(plume ?? (s.flight.boosting ? 1.55 : 0.25 + s.flight.throttle * 0.9));
  }

  /** Abort everything (jumps, campaign starts). */
  reset(): void {
    if (this.target?.seq && this.phase !== 'free') this.target.seq.end(this, this.target);
    if (this.phase === 'docked' || this.phase === 'launch' || this.phase === 'auto') this.player.model.root.visible = this.player.alive;
    this.phase = 'free';
    this.target = null;
    this.t = 0;
  }

  /**
   * Cinematic camera while the sequence owns the ship. Writes the universe
   * eye and the camera's rotation/FOV; returns false when flight cameras rule.
   *
   * Auto-dock, three hard cuts (OVA style):
   *   A  tracking off her port quarter, the lit bay stacked up ahead;
   *   B  planted beside the mouth: she crosses the curtain into the lit recess;
   *   C  inside, from the back corner: she glides in toward us and stops,
   *      the curtain rippling and open space behind her.
   * Launch: from inside behind her as she blasts out, then planted up the corridor.
   */
  camera(eye: Vector3, cam: PerspectiveCamera, dt: number): boolean {
    const d = this.target;
    if (!d || !this.busy) return false;
    if (d.seq) {
      const fov = d.seq.camera(this, d, this.phase as 'auto' | 'docked' | 'launch', this.t, eye, cam, dt);
      if (Math.abs(cam.fov - fov) > 1e-3) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      return true;
    }
    const ship = this.player.flight.position;
    const I = d.interior;
    let fov = 40;
    if (this.phase === 'auto') {
      const local = this.toLocal(d, ship, _b);
      if (this.t < CUT_B) {
        local.x -= 34;
        local.y += 11;
        local.z += 62;
        this.toWorld(d, local, eye);
        _c.copy(ship).lerp(d.bay, 0.12);
        fov = 44;
      } else if (this.t < CUT_C) {
        // Beside the mouth, a little out: looking past her into the bay.
        this.toWorld(d, _a.set(I.hw * 1.05 + 14, I.hh * 0.75, Math.max(70, I.hh * 1.6)), eye);
        this.toWorld(d, _l.set(0, 0, -I.depth * 0.35), _c);
        _c.lerp(ship, 0.65);
        fov = 42;
      } else {
        // Inside, back corner: she comes through the curtain toward us.
        this.toWorld(d, _a.set(-I.hw * 0.62, I.hh * 0.5, -(I.depth - Math.min(14, I.depth * 0.2))), eye);
        this.toWorld(d, _l.set(0, 0, 0), _c);
        _c.lerp(ship, 0.7);
        fov = 52;
      }
    } else if (this.phase === 'docked') {
      this.orbitA += dt * 0.06;
      const dist = Math.max(1600, d.radius * 2.6);
      _r.crossVectors(d.up, d.axis);
      eye.copy(d.center)
        .addScaledVector(_r, Math.cos(this.orbitA + 2.2) * dist)
        .addScaledVector(d.axis, Math.sin(this.orbitA + 2.2) * dist)
        .addScaledVector(d.up, dist * 0.32);
      _c.copy(d.center);
      fov = 42;
    } else if (this.t < LAUNCH_CUT) {
      // Launch, inside: behind and above her, the mouth and open space ahead.
      this.toWorld(d, _a.set(I.hw * 0.45, I.hh * 0.45, -(I.depth - Math.min(10, I.depth * 0.15))), eye);
      this.toWorld(d, _l.set(0, -I.hh * 0.1, 0), _c);
      _c.lerp(ship, 0.35);
      fov = 50;
    } else {
      // Launch: planted 400 m up the corridor, she blasts out toward and past us.
      this.toWorld(d, _b.set(55, -22, 420), eye);
      _c.copy(ship);
      fov = 40;
    }
    look(cam.quaternion, eye, _c, d.up);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    return true;
  }
}

/** Two-digit berth number, stable per dockable. */
export function berth(d: { id: string }): string {
  let h = 7;
  for (const ch of d.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(1 + (h % 24)).padStart(2, '0');
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Ship orientation: +Z along `fwd`, +Y toward `up` (explicit basis, no lookAt). */
function orient(q: Quaternion, fwd: Vector3, up: Vector3): Quaternion {
  _bx.crossVectors(up, fwd);
  if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0);
  _bx.normalize();
  _by.crossVectors(fwd, _bx);
  return q.setFromRotationMatrix(_m.makeBasis(_bx, _by, fwd));
}

/** Camera rotation looking from `eye` at `target` (camera looks down −Z). */
function look(q: Quaternion, eye: Vector3, target: Vector3, up: Vector3): void {
  _bz.subVectors(eye, target).normalize();
  _bx.crossVectors(up, _bz);
  if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0);
  _bx.normalize();
  _by.crossVectors(_bz, _bx);
  q.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
}
