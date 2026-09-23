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
 * Q/E roll, Shift afterburner, X kill throttle, Z flight-assist toggle.
 * Gamepad: left stick pitch/yaw, right stick X roll, triggers throttle,
 * A/south = afterburner.
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
}

const DEADZONE = 0.06;

export class Input {
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

  constructor(private target: HTMLElement | Window = window) {
    const t = this.target as Window;
    t.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyZ') this.faEdge = true;
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
    t.addEventListener('pointerdown', (e) => {
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

  /** Build this frame's control state. Call first thing in the frame. */
  sample(time: number): ControlState {
    const s = this.state;
    const k = this.keys;
    const axis = (neg: string[], pos: string[]) =>
      (pos.some((c) => k.has(c)) ? 1 : 0) - (neg.some((c) => k.has(c)) ? 1 : 0);

    s.pitch = axis(['ArrowUp'], ['ArrowDown']); // pull back = nose up (flight-sim convention)
    s.yaw = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    s.roll = axis(['KeyQ'], ['KeyE']);
    s.throttleDelta = axis(['KeyS'], ['KeyW']);
    s.throttleSet = k.has('KeyX') ? 0 : null;
    s.afterburner = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Tab');
    s.fire = this.mouseDown || k.has('Space');
    s.flightAssistToggle = this.faEdge;
    this.faEdge = false;

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

    this.consumedInputTime = this.pendingInputTime;
    this.pendingInputTime = -1;
    return s;
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
