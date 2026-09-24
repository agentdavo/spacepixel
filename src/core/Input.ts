import { copyControls, quantizeControls } from '@/sim/Replay';

/**
 * Input state, sampled once at the start of each frame.
 *
 * Everything is level-based ("what is held right now") so the flight model
 * reads it directly on the frame it arrives — no event queues, no
 * callbacks into game code. The only thing we keep from events is the
 * timestamp of the oldest input not yet consumed, for latency measurement.
 *
 * Mouse: virtual joystick — cursor offset from screen centre is a rate
 * command (with deadzone). Keyboard: W/S throttle, A/D yaw, arrows pitch/yaw,
 * Q/E roll, Shift afterburner, X kill throttle, Z flight-assist toggle,
 * Space/LMB guns, F/RMB missile salvo, T next target, J cruise drive,
 * R next gun, Y next missile type, B next target subsystem (exposed ones
 * first), Shift+B previous subsystem, I / middle mouse the subsystem nearest
 * the crosshair. (Shield trim — . forward, , aft, / AUTO — goes through
 * FlightScene's recorded sim keys.)
 * Gamepad: left stick pitch/yaw, right stick X roll, triggers throttle,
 * A/south = afterburner.
 *
 * Fixed-step sim (MP-0): `sample()` builds `latest` at the top of the frame,
 * snapped to the replay grid (Replay.quantizeControls — so a recording is
 * exactly what was flown). Before each 60 Hz sim tick the Engine calls
 * `beginTick()`, which copies `latest` into `state` (the ControlState the
 * player's ship holds). Edge-triggered buttons (missile, next target, FA,
 * cruise, gun / missile / subsystem cycle) are latched until a tick has
 * consumed them: they fire on the frame's first tick only, and a frame with
 * no tick (a >60 Hz display between ticks) carries them to the next one.
 */
export interface ControlState {
  pitch: number; // -1..1 (+ = nose up)
  yaw: number; // -1..1 (+ = nose right)
  roll: number; // -1..1 (+ = roll right)
  throttleDelta: number; // -1..1 per second
  throttleSet: number | null; // absolute throttle request this frame
  afterburner: boolean;
  flightAssistToggle: boolean; // edge-triggered
  fire: boolean;
  /** Missile salvo request (edge-triggered). Optional so AI code can ignore it. */
  missile?: boolean;
  /** Cycle target (edge-triggered). */
  nextTarget?: boolean;
  /** Toggle cruise drive (edge-triggered). */
  cruise?: boolean;
  /** Next gun / missile type / target subsystem (edge-triggered: R · Y · B). */
  cycleGun?: boolean;
  cycleMissile?: boolean;
  cycleSub?: boolean;
  /** Previous target subsystem (Shift+B) · the one nearest the crosshair (I / middle mouse). Edge-triggered. */
  cycleSubBack?: boolean;
  pickSub?: boolean;
}

const DEADZONE = 0.06;

export class Input {
  /** What the sim reads this tick (the player's ship holds this object). */
  readonly state: ControlState = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    throttleSet: null,
    afterburner: false,
    flightAssistToggle: false,
    fire: false,
  };
  /** This frame's fresh sample (quantised); `state` is loaded from it per tick. */
  readonly latest: ControlState = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttleDelta: 0,
    throttleSet: null,
    afterburner: false,
    flightAssistToggle: false,
    fire: false,
  };

  /** performance.now() timestamp of the oldest input event not yet consumed, or -1. */
  pendingInputTime = -1;
  /** Set by sample(): timestamp of the input consumed this frame, or -1. */
  consumedInputTime = -1;

  /** When set, replaces live input (scripted demos / screenshot autopilot). */
  override: ((s: ControlState, time: number) => void) | null = null;

  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private mouseDown = false;
  private faEdge = false;
  private missileEdge = false;
  private targetEdge = false;
  private cruiseEdge = false;
  private gunEdge = false;
  private missileTypeEdge = false;
  private subEdge = false;
  private subBackEdge = false;
  private pickSubEdge = false;

  constructor(private target: HTMLElement | Window = window) {
    const t = this.target as Window;
    t.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyZ') this.faEdge = true;
      if (e.code === 'KeyF') this.missileEdge = true;
      if (e.code === 'KeyT') this.targetEdge = true;
      if (e.code === 'KeyJ') this.cruiseEdge = true;
      if (e.code === 'KeyR') this.gunEdge = true;
      if (e.code === 'KeyY') this.missileTypeEdge = true;
      if (e.code === 'KeyB') {
        if (e.shiftKey) this.subBackEdge = true;
        else this.subEdge = true;
      }
      if (e.code === 'KeyI') this.pickSubEdge = true;
      if (e.code === 'Tab') e.preventDefault();
      this.mark(e.timeStamp);
    });
    t.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.mark(e.timeStamp);
    });
    t.addEventListener('pointermove', (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
      this.mouseActive = true;
      this.mark(e.timeStamp);
    });
    t.addEventListener('contextmenu', (e) => e.preventDefault());
    t.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.missileEdge = true;
        this.mark(e.timeStamp);
        return;
      }
      if (e.button === 1) {
        e.preventDefault(); // no autoscroll
        this.pickSubEdge = true;
        this.mark(e.timeStamp);
        return;
      }
      this.mouseDown = true;
      this.mark(e.timeStamp);
    });
    t.addEventListener('pointerup', () => (this.mouseDown = false));
    t.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('mouseleave', () => (this.mouseActive = false));
  }

  private mark(ts: number): void {
    if (this.pendingInputTime < 0) this.pendingInputTime = ts;
  }

  /** Build this frame's control state (`latest`). Call first thing in the frame. */
  sample(time: number): ControlState {
    const s = this.latest;
    const k = this.keys;
    const axis = (neg: string[], pos: string[]) =>
      (pos.some((c) => k.has(c)) ? 1 : 0) - (neg.some((c) => k.has(c)) ? 1 : 0);

    s.pitch = axis(['ArrowUp'], ['ArrowDown']); // pull back = nose up (flight-sim convention)
    s.yaw = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    s.roll = axis(['KeyQ'], ['KeyE']);
    s.throttleDelta = axis(['KeyS'], ['KeyW']);
    s.throttleSet = k.has('KeyX') ? 0 : null;
    s.afterburner = k.has('ShiftLeft') || k.has('ShiftRight');
    s.fire = this.mouseDown || k.has('Space');
    // Edges stay latched until a sim tick consumes them (endTicks).
    s.flightAssistToggle = this.faEdge;
    s.missile = this.missileEdge;
    s.nextTarget = this.targetEdge;
    s.cruise = this.cruiseEdge;
    s.cycleGun = this.gunEdge;
    s.cycleMissile = this.missileTypeEdge;
    s.cycleSub = this.subEdge;
    s.cycleSubBack = this.subBackEdge;
    s.pickSub = this.pickSubEdge;

    // Mouse virtual joystick (adds to keyboard, clamped).
    if (this.mouseActive) {
      s.yaw = clamp(s.yaw + shape(this.mouseX), -1, 1);
      s.pitch = clamp(s.pitch - shape(this.mouseY), -1, 1);
    }

    // Gamepad (first connected pad, standard mapping).
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes;
      s.yaw = clamp(s.yaw + shape(ax[0] ?? 0), -1, 1);
      s.pitch = clamp(s.pitch - shape(ax[1] ?? 0), -1, 1);
      s.roll = clamp(s.roll + shape(ax[2] ?? 0), -1, 1);
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) s.throttleDelta = clamp(s.throttleDelta + rt - lt, -1, 1);
      if (p.buttons[0]?.pressed) s.afterburner = true;
      if (p.buttons[5]?.pressed) s.fire = true;
      if (Math.abs(ax[0] ?? 0) > DEADZONE || Math.abs(ax[1] ?? 0) > DEADZONE || rt > 0.05 || lt > 0.05) {
        if (this.pendingInputTime < 0) this.pendingInputTime = performance.now();
      }
      break;
    }

    if (this.override) this.override(s, time);
    quantizeControls(s);

    this.consumedInputTime = this.pendingInputTime;
    this.pendingInputTime = -1;
    return s;
  }

  /**
   * Load this frame's sample into `state` for one sim tick. Edges only on the
   * frame's first tick (a second tick in the same frame must not fire the
   * salvo twice).
   */
  beginTick(first: boolean): ControlState {
    const s = copyControls(this.latest, this.state);
    if (!first) s.flightAssistToggle = s.missile = s.nextTarget = s.cruise = s.cycleGun = s.cycleMissile = s.cycleSub = s.cycleSubBack = s.pickSub = false;
    return s;
  }

  /**
   * After the frame's ticks: `ticks` > 0 consumed the latched edges; with no
   * tick they carry to the next frame, unless the sim is paused (`drop`:
   * berthed, kill-cam) — a missile key pressed on the dock screen must not
   * fire on launch.
   */
  endTicks(ticks: number, drop: boolean): void {
    if (ticks === 0 && !drop) return;
    this.faEdge = this.missileEdge = this.targetEdge = this.cruiseEdge = false;
    this.gunEdge = this.missileTypeEdge = this.subEdge = this.subBackEdge = this.pickSubEdge = false;
    const s = this.latest;
    s.flightAssistToggle = s.missile = s.nextTarget = s.cruise = s.cycleGun = s.cycleMissile = s.cycleSub = s.cycleSubBack = s.pickSub = false;
  }
}

function shape(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = (a - DEADZONE) / (1 - DEADZONE);
  // Mild expo curve: precise near centre, full rate at the edge.
  return Math.sign(v) * (0.35 * t + 0.65 * t * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The one input device. Sampled by the Engine at the top of every frame. */
export const input = new Input();
