import { Quaternion, Vector3 } from 'three';
import type { ControlState } from '@/core/Input';

/**
 * A first-time player who only follows what the flight HUD shows: the
 * mission marker (FlightNavigation), the selected target box, its gun lead
 * pip and the missile lock ring. It never reads flags, objective predicates,
 * AI state or anything off-screen, and never writes game state: its only
 * output is the ordinary device input the live Input path would produce
 * (mouse virtual joystick, W/S throttle, Shift boost, Space guns, F missile,
 * T next target).
 *
 * Shared by the headless EP01 route (src/sim/episodeRoute.ts) and the native
 * capture harness, so the later recorded run flies the same policy through
 * real mouse/keyboard events. The policy decides at 30 Hz (every second
 * 60 Hz tick), like the probe-mode capture loop.
 */

/** What the HUD shows this frame (universe metres; read-only copies are fine). */
export interface HudView {
  /** The player's ship. */
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  throttle: number;
  boostGauge: number;
  /** Shield and hull bars, 0..1. */
  shield: number;
  hull: number;
  /** Mission destination marker, if the HUD draws one. */
  marker: Vector3 | null;
  /** The marker is a zone to stop in (dwell ring / escort), radius m. */
  markerHold?: number;
  /** Selected target (box + lead pip) if it is alive and hostile. */
  target: { position: Vector3; velocity: Vector3 } | null;
  /** The target box is drawn around something that is not hostile (T cycles away). */
  targetFriendly: boolean;
  /** Any hostile contact exists on the radar/HUD. */
  hostilesPresent: boolean;
  locked: boolean;
  /** Muzzle speed the HUD uses for the lead pip (leadSpeedOf). */
  leadSpeed: number;
  /** Selected gun's reach (gunRange). */
  gunRange: number;
}

/** The devices a player holds this frame. `mouse` is the cursor offset from centre (−1..1, +x right, +y down). */
export type PilotKey = 'KeyW' | 'KeyS' | 'ShiftLeft' | 'Space' | 'KeyF' | 'KeyT' | WingKey;
/** FlightScene's wing-order keys: 1 form on me · 2 attack my target · 3 engage at will · 4 cover me. */
export type WingKey = 'Digit1' | 'Digit2' | 'Digit3' | 'Digit4';
export interface DeviceInput {
  mouse: { x: number; y: number };
  keys: Set<PilotKey>;
}

export interface HudPilotOptions {
  /** Hold fire until the lead pip is within this angle (rad) of the nose. */
  fireCone: number;
  /** Seconds between missile presses while locked. */
  missileEvery: number;
  /** Seconds between T presses while looking for a hostile target. */
  targetEvery: number;
  /** Break away and boost when the shield bar falls below this fraction (unset: never retreat). */
  breakBelow?: number;
  /** Turn back in once the shield bar is back above this fraction (default 0.9). */
  rejoinAbove?: number;
  /** Wing key pressed once, the first HUD frame a hostile shows on the radar (unset: never gives an order). */
  wingOrder?: WingKey;
}

export const DEFAULT_HUD_PILOT: HudPilotOptions = { fireCone: 0.06, missileEvery: 3, targetEvery: 0.5 };

const _d = new Vector3();
const _vt = new Vector3();
const _q = new Quaternion();

/** Same deadzone/expo curve as Input.sample's mouse virtual joystick. */
export function shapeAxis(v: number): number {
  const a = Math.abs(v);
  if (a < 0.06) return 0;
  const t = (a - 0.06) / (1 - 0.06);
  return Math.sign(v) * (0.35 * t + 0.65 * t * t);
}

/** Cursor offset giving a stick command of min(0.95, 2.5·|angle|) (the existing route pilot's mapping). */
export function joystick(angle: number): number {
  const control = Math.min(0.95, Math.abs(angle) * 2.5);
  if (control === 0) return 0;
  return Math.sign(angle) * (0.06 + (0.94 * (-0.35 + Math.sqrt(0.1225 + 2.6 * control))) / 1.3);
}

/** Smallest positive t with |r + v·t| = s·t (FlightHud's lead pip), or −1. */
function intercept(r: Vector3, v: Vector3, s: number): number {
  const a = v.dot(v) - s * s;
  const b = 2 * r.dot(v);
  const cc = r.dot(r);
  if (Math.abs(a) < 1e-6) return b < 0 ? -cc / b : -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : -1;
}

export class HudPilot {
  mode: 'marker' | 'combat' | 'evade' | 'search' = 'search';
  private retreating = false;
  private lastMissile = -1e9;
  private lastTarget = -1e9;
  private ordered = false;

  constructor(readonly options: HudPilotOptions = DEFAULT_HUD_PILOT) {}

  /** Retreat hysteresis on the HUD shield bar (off unless `breakBelow` is set). */
  private evading(v: HudView): boolean {
    const { breakBelow, rejoinAbove } = this.options;
    if (breakBelow === undefined) return false;
    if (!this.retreating && v.shield < breakBelow) this.retreating = true;
    else if (this.retreating && v.shield >= (rejoinAbove ?? 0.9)) this.retreating = false;
    return this.retreating;
  }

  /** Bearing of a universe point in the ship's frame: yaw (+ = left of the nose), pitch (+ = above), range. */
  private bearing(v: HudView, point: Vector3): { yaw: number; pitch: number; range: number } {
    _d.subVectors(point, v.position);
    const range = _d.length();
    _d.applyQuaternion(_q.copy(v.orientation).invert());
    return { yaw: Math.atan2(_d.x, _d.z), pitch: Math.atan2(_d.y, Math.hypot(_d.x, _d.z)), range };
  }

  /** One HUD frame → the devices held. `time` is seconds since the episode began. */
  decide(v: HudView, time: number): DeviceInput {
    const keys = new Set<PilotKey>();
    let mouse = { x: 0, y: 0 };
    const throttleTo = (want: number) => {
      if (v.throttle < want - 0.025) keys.add('KeyW');
      else if (v.throttle > want + 0.025) keys.add('KeyS');
    };
    const aim = (b: { yaw: number; pitch: number }) => {
      // Cursor toward the point: left of the nose = cursor left, above = cursor up.
      mouse = { x: -joystick(b.yaw), y: -joystick(b.pitch) };
    };

    if (v.marker) {
      // Follow the mission marker: turn onto it, then open up; boost on long straight legs.
      this.mode = 'marker';
      const b = this.bearing(v, v.marker);
      aim(b);
      const off = Math.hypot(b.yaw, b.pitch);
      const hold = v.markerHold;
      if (hold !== undefined && b.range < hold * 0.6) throttleTo(0);
      else if (hold !== undefined && b.range < hold * 3) throttleTo(off > 0.6 ? 0.1 : 0.3);
      else throttleTo(off > 0.6 ? 0.35 : 1);
      if (b.range > Math.max(3000, (hold ?? 0) * 4) && off < 0.08 && v.boostGauge > 0.35) keys.add('ShiftLeft');
    } else if (v.target && this.evading(v)) {
      // Shield bar low: turn away from the target box and boost until the shields refill.
      this.mode = 'evade';
      const b = this.bearing(v, v.target.position);
      aim({ yaw: b.yaw > 0 ? b.yaw - Math.PI : b.yaw + Math.PI, pitch: -b.pitch });
      throttleTo(1);
      if (Math.abs(b.yaw) > 2 && v.boostGauge > 0.1) keys.add('ShiftLeft');
    } else if (v.target) {
      // Guns on the lead pip; missiles when the lock ring closes.
      this.mode = 'combat';
      _d.subVectors(v.target.position, v.position);
      _vt.subVectors(v.target.velocity, v.velocity);
      const t = intercept(_d, _vt, v.leadSpeed);
      const pip = t > 0 ? _d.addScaledVector(_vt, t).add(v.position) : v.target.position;
      const b = this.bearing(v, pip);
      aim(b);
      const range = v.target.position.distanceTo(v.position);
      const off = Math.hypot(b.yaw, b.pitch);
      if (off < this.options.fireCone && range < v.gunRange * 0.9) keys.add('Space');
      // Keep moving: close in fast, stay at fighting speed near the target.
      throttleTo(range > 1500 ? 1 : 0.7);
      if (range > 2500 && off < 0.1 && v.boostGauge > 0.35) keys.add('ShiftLeft');
      if (v.locked && time - this.lastMissile >= this.options.missileEvery) {
        keys.add('KeyF');
        this.lastMissile = time;
      }
    } else {
      // Nothing to follow: cruise on and press T for the next contact.
      this.mode = 'search';
      throttleTo(0.5);
      if ((v.hostilesPresent || v.targetFriendly) && time - this.lastTarget >= this.options.targetEvery) {
        keys.add('KeyT');
        this.lastTarget = time;
      }
    }
    // A hostile on the radar with a friendly (or no) box selected: T to the next contact.
    if (v.marker === null && !v.target && v.hostilesPresent && !keys.has('KeyT') && time - this.lastTarget >= this.options.targetEvery) {
      keys.add('KeyT');
      this.lastTarget = time;
    }
    if (this.options.wingOrder && !this.ordered && v.hostilesPresent) {
      keys.add(this.options.wingOrder);
      this.ordered = true;
    }
    return { mouse, keys };
  }
}

/**
 * The ControlState Input.sample would build from these devices on the
 * frame's first tick (`edges`) or a later tick of the same frame (edges
 * already consumed). The caller quantises (quantizeControls).
 */
export function controlsFromDevices(d: DeviceInput, edges: boolean, out: ControlState): ControlState {
  const k = d.keys;
  out.pitch = Math.max(-1, Math.min(1, -shapeAxis(d.mouse.y)));
  out.yaw = Math.max(-1, Math.min(1, shapeAxis(d.mouse.x)));
  out.roll = 0;
  out.throttleDelta = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  out.throttleSet = null;
  out.afterburner = k.has('ShiftLeft');
  out.fire = k.has('Space');
  out.flightAssistToggle = false;
  out.missile = edges && k.has('KeyF');
  out.nextTarget = edges && k.has('KeyT');
  out.cruise = false;
  out.cycleGun = false;
  out.cycleMissile = false;
  out.cycleSub = false;
  out.cycleSubBack = false;
  out.pickSub = false;
  return out;
}
