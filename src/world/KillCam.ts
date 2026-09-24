import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import '@/ui/dock.css';
import '@/ui/replay.css';
import type { WorldSpace } from '@/core/WorldSpace';
import type { Fleet, ShipEntity } from '@/sim/Fleet';
import { BOLT_CAPACITY, type Beam, type WeaponEvent, type Weapons } from '@/sim/Weapons';
import { MICRO_MISSILE, MISSILE_CAPACITY, type MissileEvent, type Missiles } from '@/sim/Missiles';
import type { MissileSpec } from '@/sim/Loadouts';
import { EventTap } from './EventTap';
import type { BoltSource, MissileSource, WeaponVisuals } from './WeaponVisuals';
import type { CombatFx } from './CombatFx';

/**
 * Kill-cam: when the player goes down (or brings down something notable —
 * a capital, a contract bounty) the last few seconds play again from the
 * killer's side, in the OVA cutaway grammar: letterbox, ink frame, a
 * running timecode and a REPLAY stamp. Skippable; the world holds still
 * behind it (FlightScene.timeScale → 0) and resumes where it was.
 *
 * How: a short *visual* history, not a re-simulation. Every sim tick the
 * scene records, around the player, every ship's pose, the live bolts,
 * missiles and beams, and that tick's weapon/missile events (8 s ring,
 * ≈ 5–15 KB per tick, preallocated). Playback poses the real ship models
 * from it and feeds the real bolt / missile / beam renderer and particle
 * system from recorded frames (WeaponVisuals / CombatFx take swappable
 * sources), so the replay looks exactly like the fight.
 *
 * Why not rewind + resim with the replay machinery: the flight scene's
 * state is more than the combat core (traffic, contracts, campaign
 * scripts, docking, hull contacts) and a snapshot/restore of all of it —
 * or a resim that skips some of it and might not reproduce the kill —
 * costs far more than it buys for six seconds of camera work. The history
 * can't diverge, costs a fixed ~0.05 ms/tick, and needs nothing from the
 * systems it shows. Full replays (?replay=) do re-simulate, from the boot.
 */
const HZ = 60;
/** Ticks of history kept. */
const KEEP = 8 * HZ;
/** Seconds replayed before the kill, and after it (if the history has them). */
const BEFORE = 5;
const AFTER = 1.4;
/** How long the offer stays up (s, real time). */
const OFFER = 4;
const RADIUS = 9000;
const SHIP_CAP = 160;
const BOLT_CAP = 1536;
const MISSILE_CAP = 96;
const BEAM_CAP = 16;
const TF = 8; // x y z qx qy qz qw plume

class Frame {
  tick = -1;
  anchor = new Vector3();
  ships: ShipEntity[] = [];
  nShips = 0;
  tf = new Float64Array(SHIP_CAP * TF);
  /** Bolts: x y z relative to anchor, vx vy vz, life. */
  bolts = new Float32Array(BOLT_CAP * 7);
  gun = new Uint8Array(BOLT_CAP);
  nBolts = 0;
  /** Missiles: x y z vx vy vz (universe). */
  mis = new Float64Array(MISSILE_CAP * 6);
  misSpec: MissileSpec[] = [];
  nMis = 0;
  beams: Beam[] = [];
  nBeams = 0;
  events = new EventTap(96);
}

export type KillCamKind = 'death' | 'kill';

interface Take {
  kind: KillCamKind;
  killer: ShipEntity | null;
  victim: ShipEntity;
  tick: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _qb = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _up = new Vector3();
const _zero = new Vector3();
const Y = new Vector3(0, 1, 0);

function blankBeam(owner: ShipEntity): Beam {
  return { active: true, owner, socket: null, origin: new Vector3(), dir: new Vector3(0, 0, 1), length: 0, width: 1, life: 0, maxLife: 1, dps: 0, type: 'harmonic', faction: owner.faction, team: owner.team, end: new Vector3(), aimTarget: null, gun: null };
}

export class KillCam {
  private ring: Frame[] = [];
  /** The offer on screen (death / notable kill), until `offerLeft` runs out. */
  private offer: Take | null = null;
  private offerLeft = 0;
  private take: Take | null = null;
  private seq: Frame[] = [];
  private t = 0;
  private killAt = 0;
  private lastIdx = -1;
  private vis = new Map<ShipEntity, boolean>();
  private live: { w: BoltSource; m: MissileSource } | null = null;
  private ghostW: BoltSource & { events: WeaponEvent[] };
  private ghostM: MissileSource & { events: MissileEvent[]; age: Float32Array };
  private prevBolts = 0;
  private eye = new Vector3();
  private look = new Vector3();
  private shot = -1;
  private el = document.createElement('div');
  private stamp = document.createElement('div');
  private skip = document.createElement('div');
  private prompt = document.createElement('div');
  private tc: HTMLDivElement;
  /** Set true to never offer (captures, tests). */
  disabled = new URLSearchParams(location.search).get('killcam') === '0';
  /** Called when a playback ends (the scene restores its camera). */
  onEnd: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private fleet: Fleet,
    private visuals: WeaponVisuals,
    private fx: CombatFx | null,
  ) {
    for (let i = 0; i < KEEP; i++) this.ring.push(new Frame());
    this.ghostW = {
      px: new Float64Array(BOLT_CAPACITY),
      py: new Float64Array(BOLT_CAPACITY),
      pz: new Float64Array(BOLT_CAPACITY),
      vx: new Float32Array(BOLT_CAPACITY),
      vy: new Float32Array(BOLT_CAPACITY),
      vz: new Float32Array(BOLT_CAPACITY),
      life: new Float32Array(BOLT_CAPACITY),
      gun: new Uint8Array(BOLT_CAPACITY),
      beams: [],
      events: [],
    };
    this.ghostM = {
      alive: new Uint8Array(MISSILE_CAPACITY),
      pos: Array.from({ length: MISSILE_CAPACITY }, () => new Vector3()),
      vel: Array.from({ length: MISSILE_CAPACITY }, () => new Vector3()),
      spec: new Array(MISSILE_CAPACITY).fill(MICRO_MISSILE),
      age: new Float32Array(MISSILE_CAPACITY),
      events: [],
    };
    this.el.className = 'dock-cinema killcam';
    this.el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="frame"></div><div class="tc"></div><div class="plate"><small></small><b></b><span></span></div>`;
    this.tc = this.el.querySelector('.tc')!;
    this.stamp.className = 'replay-stamp';
    this.stamp.innerHTML = '<b>REPLAY</b><small>再生 · KILL-CAM</small>';
    this.skip.className = 'replay-skip';
    this.skip.textContent = '[ENTER] SKIP';
    this.prompt.className = 'replay-offer';
    root.append(this.el, this.stamp, this.skip, this.prompt);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Escape') return;
      if (this.take) {
        e.preventDefault();
        this.end();
      } else if (this.offer && e.code !== 'Escape') {
        e.preventDefault();
        this.start();
      }
    });
  }

  get active(): boolean {
    return this.take !== null;
  }

  get offered(): boolean {
    return this.offer !== null;
  }

  // ── recording (every sim tick) ──────────────────────────────────────

  record(tick: number, weapons: Weapons, missiles: Missiles, around: Vector3): void {
    const f = this.ring[tick % KEEP];
    f.tick = tick;
    f.anchor.copy(around);
    const r2 = RADIUS * RADIUS;
    let n = 0;
    for (const s of this.fleet.ships) {
      if (!s.alive || n >= SHIP_CAP) continue;
      const d2 = s.flight.position.distanceToSquared(around);
      if (d2 > r2 && !(s.radius > 60 && d2 < 9 * r2)) continue;
      const fl = s.flight;
      const o = n * TF;
      f.ships[n] = s;
      f.tf[o] = fl.position.x;
      f.tf[o + 1] = fl.position.y;
      f.tf[o + 2] = fl.position.z;
      f.tf[o + 3] = fl.orientation.x;
      f.tf[o + 4] = fl.orientation.y;
      f.tf[o + 5] = fl.orientation.z;
      f.tf[o + 6] = fl.orientation.w;
      f.tf[o + 7] = fl.boosting ? 1.55 : 0.25 + fl.throttle * 0.9;
      n++;
    }
    f.nShips = n;
    let nb = 0;
    const w = weapons;
    for (let i = 0; i < BOLT_CAPACITY && nb < BOLT_CAP; i++) {
      if (w.life[i] <= 0) continue;
      const x = w.px[i] - around.x;
      const y = w.py[i] - around.y;
      const z = w.pz[i] - around.z;
      if (x * x + y * y + z * z > r2) continue;
      const o = nb * 7;
      f.bolts[o] = x;
      f.bolts[o + 1] = y;
      f.bolts[o + 2] = z;
      f.bolts[o + 3] = w.vx[i];
      f.bolts[o + 4] = w.vy[i];
      f.bolts[o + 5] = w.vz[i];
      f.bolts[o + 6] = w.life[i];
      f.gun[nb] = w.gun[i];
      nb++;
    }
    f.nBolts = nb;
    let nm = 0;
    for (let i = 0; i < MISSILE_CAPACITY && nm < MISSILE_CAP; i++) {
      if (!missiles.alive[i]) continue;
      const p = missiles.pos[i];
      if (p.distanceToSquared(around) > r2) continue;
      const v = missiles.vel[i];
      const o = nm * 6;
      f.mis[o] = p.x;
      f.mis[o + 1] = p.y;
      f.mis[o + 2] = p.z;
      f.mis[o + 3] = v.x;
      f.mis[o + 4] = v.y;
      f.mis[o + 5] = v.z;
      f.misSpec[nm] = missiles.spec[i];
      nm++;
    }
    f.nMis = nm;
    let nbm = 0;
    for (const b of w.beams) {
      if (!b.active || nbm >= BEAM_CAP) continue;
      const g = (f.beams[nbm] ??= blankBeam(b.owner));
      g.owner = b.owner;
      g.origin.copy(b.origin);
      g.end.copy(b.end);
      g.dir.copy(b.dir);
      g.width = b.width;
      g.life = b.life;
      g.maxLife = b.maxLife;
      g.gun = b.gun;
      g.faction = b.faction;
      nbm++;
    }
    f.nBeams = nbm;
    f.events.clear();
    f.events.capture(w.events, missiles.events);
  }

  // ── offer ───────────────────────────────────────────────────────────

  /** A death or a notable kill just happened at `tick`: put the offer up. */
  propose(kind: KillCamKind, killer: ShipEntity | null, victim: ShipEntity, tick: number): void {
    if (this.disabled || this.take) return;
    this.offer = { kind, killer, victim, tick };
    this.offerLeft = OFFER;
    const who = kind === 'death' ? (killer ? killer.name.toUpperCase() : 'THE WRECKAGE') : victim.name.toUpperCase();
    this.prompt.innerHTML = `<b>▶ KILL-CAM</b> &nbsp;${kind === 'death' ? `SHOT DOWN BY ${who}` : `${who} DESTROYED`} &nbsp;<i>[ENTER]</i>`;
    this.prompt.classList.add('show');
  }

  withdraw(): void {
    this.offer = null;
    this.prompt.classList.remove('show');
  }

  // ── playback ────────────────────────────────────────────────────────

  /** Take the offer now (captures; the player's ENTER does the same). */
  accept(): void {
    if (this.offer) this.start();
  }

  /** Captures: jump `seconds` into the playback. */
  skipTo(seconds: number): void {
    if (!this.take) return;
    this.t = Math.max(0, Math.min(seconds, (this.seq.length - 2) / HZ));
    this.lastIdx = Math.floor(this.t * HZ) - 30; // replay the last half-second of events so the frame has its flashes
  }

  private start(): void {
    const o = this.offer;
    this.withdraw();
    if (!o) return;
    // Frames from BEFORE s ahead of the kill to AFTER s past it, oldest first.
    const seq: Frame[] = [];
    for (let k = o.tick - BEFORE * HZ; k <= o.tick + AFTER * HZ; k++) {
      const f = this.ring[((k % KEEP) + KEEP) % KEEP];
      if (f.tick === k) seq.push(f);
    }
    if (seq.length < HZ) return;
    this.seq = seq;
    this.take = o;
    this.t = 0;
    this.killAt = (o.tick - seq[0].tick) / HZ;
    this.lastIdx = -1;
    this.shot = -1;
    this.vis.clear();
    for (const s of this.fleet.ships) this.vis.set(s, s.model.root.visible);
    const v = this.visuals;
    this.live = { w: v.weapons, m: v.missiles };
    v.weapons = this.ghostW;
    v.missiles = this.ghostM;
    document.body.classList.add('killcam-on');
    const plate = this.el.querySelector('.plate')!;
    const k = o.killer;
    plate.querySelector('small')!.textContent = o.kind === 'death' ? 'KILL-CAM // LAST SECONDS OF AIRFRAME 0413' : 'KILL-CAM // CONFIRMED';
    plate.querySelector('b')!.textContent = o.kind === 'death' ? (k ? k.name.toUpperCase() : 'COLLISION') : o.victim.name.toUpperCase();
    plate.querySelector('span')!.textContent = o.kind === 'death' ? `${o.victim.name.toUpperCase()} DOWN` : `DESTROYED BY ${k ? k.name.toUpperCase() : 'VANGUARD 1'}`;
    this.el.classList.add('show');
    this.stamp.classList.add('show');
    this.skip.classList.add('show');
  }

  /** Stop playback and hand the frame back to the live scene. */
  end(): void {
    if (!this.take) return;
    this.take = null;
    // Ships the history posed that have since left the fleet (hull swaps) go back to hidden.
    for (const f of this.seq) for (let i = 0; i < f.nShips; i++) if (!this.vis.has(f.ships[i])) f.ships[i].model.root.visible = false;
    for (const [s, v] of this.vis) s.model.root.visible = v;
    this.vis.clear();
    if (this.live) {
      this.visuals.weapons = this.live.w;
      this.visuals.missiles = this.live.m;
      this.live = null;
    }
    this.ghostW.life.fill(0);
    this.prevBolts = 0;
    this.ghostW.beams.length = 0;
    this.ghostM.alive.fill(0);
    this.el.classList.remove('show');
    this.stamp.classList.remove('show');
    this.skip.classList.remove('show');
    document.body.classList.remove('killcam-on');
    this.onEnd?.();
  }

  /** Per frame, real time: counts the offer down (no playback). */
  tickOffer(realDt: number): void {
    if (!this.offer) return;
    this.offerLeft -= realDt;
    if (this.offerLeft <= 0) this.withdraw();
  }

  /**
   * Per frame while active: pose the ships, feed the renderers and fly the
   * camera. Writes `world.eye` and the camera's orientation; the scene syncs.
   */
  present(realDt: number, camera: PerspectiveCamera, world: WorldSpace): void {
    const take = this.take;
    if (!take) return;
    // The OVA beat: normal speed into the kill, a held slow-motion beat on it.
    const near = Math.abs(this.t - this.killAt);
    this.t += realDt * (near < 0.6 ? 0.35 : 1);
    const seq = this.seq;
    const fpos = Math.min(this.t * HZ, seq.length - 1);
    const i0 = Math.floor(fpos);
    const a = fpos - i0;
    const A = seq[i0];
    const B = seq[Math.min(i0 + 1, seq.length - 1)];

    // Ships: every one in frame A posed between A and B; the rest hidden.
    for (const s of this.fleet.ships) s.model.root.visible = false;
    for (let i = 0; i < A.nShips; i++) {
      const s = A.ships[i];
      const o = i * TF;
      let j = -1;
      for (let k = 0; k < B.nShips; k++)
        if (B.ships[k] === s) {
          j = k * TF;
          break;
        }
      const r = s.model.root;
      const T = A.tf;
      const U = j >= 0 ? B.tf : A.tf;
      const jj = j >= 0 ? j : o;
      r.position.set(T[o] + (U[jj] - T[o]) * a, T[o + 1] + (U[jj + 1] - T[o + 1]) * a, T[o + 2] + (U[jj + 2] - T[o + 2]) * a);
      _q.set(T[o + 3], T[o + 4], T[o + 5], T[o + 6]);
      _qb.set(U[jj + 3], U[jj + 4], U[jj + 5], U[jj + 6]);
      r.quaternion.copy(_q).slerp(_qb, a);
      r.visible = true;
      s.model.setThrottle(T[o + 7]);
    }

    // Events of every history tick crossed since the last frame → flashes + particles.
    for (let k = this.lastIdx + 1; k <= i0; k++) {
      const ev = seq[k].events;
      this.ghostW.events = ev.weapons;
      this.ghostM.events = ev.missiles;
      this.visuals.consume();
      this.fx?.replayEvents(ev.weapons, ev.missiles);
    }
    this.lastIdx = Math.max(this.lastIdx, i0);

    // Bolts, missiles, beams from frame A, advanced by the fraction.
    const g = this.ghostW;
    const lead = a / HZ;
    for (let i = 0; i < A.nBolts; i++) {
      const o = i * 7;
      g.px[i] = A.anchor.x + A.bolts[o] + A.bolts[o + 3] * lead;
      g.py[i] = A.anchor.y + A.bolts[o + 1] + A.bolts[o + 4] * lead;
      g.pz[i] = A.anchor.z + A.bolts[o + 2] + A.bolts[o + 5] * lead;
      g.vx[i] = A.bolts[o + 3];
      g.vy[i] = A.bolts[o + 4];
      g.vz[i] = A.bolts[o + 5];
      g.life[i] = A.bolts[o + 6];
      g.gun[i] = A.gun[i];
    }
    for (let i = A.nBolts; i < this.prevBolts; i++) g.life[i] = 0;
    this.prevBolts = A.nBolts;
    const m = this.ghostM;
    m.alive.fill(0);
    for (let i = 0; i < A.nMis; i++) {
      const o = i * 6;
      m.alive[i] = 1;
      m.vel[i].set(A.mis[o + 3], A.mis[o + 4], A.mis[o + 5]);
      m.pos[i].set(A.mis[o], A.mis[o + 1], A.mis[o + 2]).addScaledVector(m.vel[i], lead);
      m.spec[i] = A.misSpec[i];
    }
    g.beams.length = 0;
    for (let i = 0; i < A.nBeams; i++) g.beams.push(A.beams[i]);

    this.fly(take, realDt, camera, world);

    const rel = this.t - this.killAt;
    const s = Math.abs(rel);
    const ff = Math.floor((s % 1) * 24);
    this.tc.textContent = `REPLAY  ${rel < 0 ? '−' : '+'}00:00:${String(Math.floor(s)).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    if (this.t * HZ >= seq.length - 1) this.end();
  }

  /** Where ship `s` is in the current playback frame (false if not in frame). */
  private poseOf(s: ShipEntity | null, pos: Vector3, q: Quaternion): boolean {
    if (!s || !s.model.root.visible) return false;
    pos.copy(s.model.root.position);
    q.copy(s.model.root.quaternion);
    return true;
  }

  /**
   * Two shots. Before the kill: over the killer's shoulder onto the victim
   * (a capital killer: from beside the victim, looking up at the guns — the
   * victim's view). The last beat: a slow orbit on the victim as it goes.
   */
  private fly(take: Take, dt: number, camera: PerspectiveCamera, world: WorldSpace): void {
    const kq = _q;
    const kp = _a;
    const vp = _b;
    const hasK = this.poseOf(take.killer, kp, kq);
    let hasV = this.poseOf(take.victim, vp, _qb);
    if (!hasV) {
      // The victim is already debris: hold on where it died.
      const last = this.lastPose(take.victim, vp);
      hasV = last;
    }
    const shot = this.t < this.killAt - 0.9 && hasK && hasV ? 0 : 1;
    const wantEye = _c;
    const r = take.killer ? Math.min(60, Math.max(8, take.killer.radius)) : 10;
    if (shot === 0 && take.killer && take.killer.radius <= 60) {
      _up.set(0, 1, 0).applyQuaternion(kq);
      wantEye.set(0, 0.9 * r + 4, -(3.2 * r + 20)).applyQuaternion(kq).add(kp);
      this.lookAt(vp, dt, wantEye, shot);
    } else if (shot === 0 && take.killer) {
      // Capital killer: from just off the victim, looking back up at her guns.
      _up.copy(Y);
      wantEye.subVectors(vp, kp).normalize().multiplyScalar(70 + take.victim.radius * 3).add(vp).addScaledVector(Y, 18 + take.victim.radius);
      this.lookAt(kp, dt, wantEye, shot);
    } else {
      _up.copy(Y);
      const vr = take.victim.radius > 60 ? take.victim.model.radius * 1.4 : Math.max(45, take.victim.radius * 6);
      const ang = this.t * 0.45 + 0.6;
      wantEye.set(Math.cos(ang) * vr, vr * 0.35, Math.sin(ang) * vr).add(vp);
      this.lookAt(vp, dt, wantEye, shot);
    }
    world.eye.copy(this.eye);
    _m.lookAt(_zero, _c.subVectors(this.look, this.eye), _up);
    camera.quaternion.setFromRotationMatrix(_m);
  }

  private lookAt(target: Vector3, dt: number, eye: Vector3, shot: number): void {
    if (shot !== this.shot) {
      // Hard cut between shots.
      this.shot = shot;
      this.eye.copy(eye);
      this.look.copy(target);
      return;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.eye.lerp(eye, k);
    this.look.lerp(target, 1 - Math.exp(-10 * dt));
  }

  /** Last recorded position of a ship in the take (it may be gone from later frames). */
  private lastPose(s: ShipEntity, out: Vector3): boolean {
    const i0 = Math.min(this.lastIdx, this.seq.length - 1);
    for (let k = i0; k >= 0; k--) {
      const f = this.seq[k];
      for (let i = 0; i < f.nShips; i++)
        if (f.ships[i] === s) {
          out.set(f.tf[i * TF], f.tf[i * TF + 1], f.tf[i * TF + 2]);
          return true;
        }
    }
    out.copy(this.look);
    return false;
  }
}
