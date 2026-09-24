import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { postFx } from '@/render/post/PostFx';

/**
 * Photo mode (any scene): F10 freezes the frame — the scene stops updating,
 * the HUD hides — and hands the camera to a free orbit around the point the
 * lens was looking at. Drag / arrow keys orbit, wheel or [ ] dolly, Q / E
 * roll, P or F12 saves a PNG of the frame, Esc or F10 resumes.
 *
 * The orbit stays within a few hundred metres of the render origin, so the
 * floating-origin precision holds; resuming snaps the camera back to the
 * scene, which re-places it on its next update.
 */
const _q = new Quaternion();
const _v = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);

export class PhotoMode {
  active = false;
  /** Set by a keypress; the host saves the canvas right after the next render. */
  capture = false;
  private camera: PerspectiveCamera | null = null;
  private readonly pivot = new Vector3();
  private dist = 30;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private readonly base = new Quaternion();
  private readonly saved = { pos: new Vector3(), quat: new Quaternion(), fov: 50 };
  private drag: { x: number; y: number } | null = null;
  private badge: HTMLDivElement | null = null;
  private held = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('keyup', (e) => this.held.delete(e.code), true);
    canvas.addEventListener('pointerdown', (e) => this.active && (this.drag = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (this.drag = null));
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.005;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (e.clientY - this.drag.y) * 0.005));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('wheel', (e) => this.active && (this.dist = Math.max(2, Math.min(4000, this.dist * Math.exp(e.deltaY * 0.001)))), { passive: true });
  }

  /** Enter on the scene's current camera. */
  enter(camera: PerspectiveCamera): void {
    if (this.active) return;
    this.active = true;
    this.camera = camera;
    this.saved.pos.copy(camera.position);
    this.saved.quat.copy(camera.quaternion);
    this.saved.fov = camera.fov;
    // Orbit the point ~30 m (or 1/10 of the far view) in front of the lens.
    this.dist = 30;
    this.pivot.copy(camera.position).add(_v.set(0, 0, -this.dist).applyQuaternion(camera.quaternion));
    this.base.copy(camera.quaternion);
    this.yaw = this.pitch = this.roll = 0;
    this.uiRoot.style.visibility = 'hidden';
    this.badge = document.createElement('div');
    this.badge.style.cssText = 'position:fixed;left:16px;top:12px;z-index:99;font:12px "Share Tech Mono",monospace;letter-spacing:.2em;color:#ffc46b;text-shadow:0 0 6px #000;pointer-events:none';
    this.badge.textContent = 'PHOTO MODE · DRAG ORBIT · WHEEL DOLLY · Q/E ROLL · P SAVE PNG · ESC RESUME';
    document.body.append(this.badge);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    const c = this.camera;
    if (c) {
      c.position.copy(this.saved.pos);
      c.quaternion.copy(this.saved.quat);
      c.fov = this.saved.fov;
      c.updateProjectionMatrix();
    }
    this.camera = null;
    this.uiRoot.style.visibility = '';
    this.badge?.remove();
    this.badge = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'F10') {
      e.preventDefault();
      if (this.active) this.exit();
      else this.request = true;
      return;
    }
    if (!this.active) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return this.exit();
    if (e.code === 'KeyP' || e.code === 'F12') {
      e.preventDefault();
      this.capture = true;
      return;
    }
    this.held.add(e.code);
  }

  /** The host checks this each frame (it knows the live camera) and calls enter(). */
  request = false;

  /** Per frame while active: keys orbit / dolly / roll, the camera is re-placed. */
  update(dt: number): void {
    const c = this.camera;
    if (!c) return;
    const k = (code: string) => (this.held.has(code) ? 1 : 0);
    this.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 1.2;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (k('ArrowUp') - k('ArrowDown')) * dt * 1.0));
    this.roll += (k('KeyE') - k('KeyQ')) * dt * 0.8;
    this.dist = Math.max(2, Math.min(4000, this.dist * Math.exp((k('BracketRight') - k('BracketLeft')) * dt * 1.5)));
    _q.copy(this.base).multiply(new Quaternion().setFromAxisAngle(_y, this.yaw)).multiply(new Quaternion().setFromAxisAngle(_x, this.pitch));
    c.position.copy(this.pivot).add(_v.set(0, 0, this.dist).applyQuaternion(_q));
    c.quaternion.copy(_q).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.roll));
    c.updateMatrixWorld();
    // A clean plate: no speed lines, flashes or boost distortion frozen in the shot.
    postFx.speed = postFx.boost = postFx.flash = 0;
  }

  /** Save the frame just rendered (call right after the render, same task). */
  save(): void {
    this.capture = false;
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `vanguard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
}
