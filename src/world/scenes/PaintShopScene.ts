import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import { BLUEPRINTS } from '@/assets/blueprints';
import { FACTIONS } from '@/assets/Factions';
import type { Livery, Paint } from '@/assets/Blueprint';
import { LIVERY_PRESETS, loadProfile, saveProfile } from '@/game/Profile';

/**
 * Paint shop (?scene=paint): the player's Kestrel on a turntable with a
 * livery editor — six 90s-anime presets plus per-slot colour pickers.
 * Saved to the pilot profile; FlightScene paints the player ship with it.
 */
const SLOTS: { key: Paint | 'plumeCore'; label: string }[] = [
  { key: 'primary', label: 'PRIMARY' },
  { key: 'secondary', label: 'SECONDARY' },
  { key: 'accent', label: 'ACCENT' },
  { key: 'dark', label: 'DARK' },
  { key: 'glass', label: 'CANOPY' },
  { key: 'glow', label: 'ENGINE' },
];

export class PaintShopScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 16 / 9, 0.5, 1_200_000);
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private ship: ShipModel | null = null;
  private profile = loadProfile();
  private panel = document.createElement('div');
  private dirty = true;

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);
    this.camera.position.set(-26, 9, 30);
    this.camera.lookAt(new Vector3(0, 0, 0));
    this.buildPanel();
  }

  private livery(): Livery {
    return { ...FACTIONS.concord.livery, ...this.profile.livery };
  }

  private rebuild(): void {
    const angle = this.ship?.root.rotation.y ?? 0.6;
    if (this.ship) this.scene.remove(this.ship.root);
    this.ship = buildShip(BLUEPRINTS['vf27-kestrel'], this.profile.livery);
    this.ship.root.rotation.y = angle;
    this.ship.setThrottle(0.6);
    this.scene.add(this.ship.root);
    this.dirty = false;
  }

  private buildPanel(): void {
    const p = this.panel;
    p.className = 'paint-shop';
    p.style.cssText =
      'position:absolute;right:16px;top:16px;bottom:16px;width:min(320px,calc(100vw - 32px));z-index:20;pointer-events:auto;overflow:auto;' +
      'padding:18px 20px;background:rgba(3,10,8,0.86);border:1px solid rgba(125,255,178,0.4);font:13px "Share Tech Mono",monospace;color:#7dffb2';
    document.getElementById('ui-root')!.append(p);
    this.renderPanel();
  }

  private renderPanel(): void {
    const lv = this.livery();
    const p = this.panel;
    p.innerHTML = `
      <div style="font:800 18px Oxanium,sans-serif;letter-spacing:.25em;color:#fff">PAINT SHOP</div>
      <div style="margin:4px 0 16px;color:#ffc46b;letter-spacing:.15em">VF-27 KESTREL · ${this.profile.callsign}</div>
      <div style="margin-bottom:8px;letter-spacing:.2em">PRESETS</div>
      ${LIVERY_PRESETS.map(
        (x, i) =>
          `<button data-preset="${i}" style="display:block;width:100%;margin:0 0 6px;padding:7px 10px;text-align:left;cursor:pointer;background:${x.name === this.profile.liveryName ? 'rgba(125,255,178,.18)' : 'transparent'};border:1px solid rgba(125,255,178,.35);color:#e8fff2;font:inherit;letter-spacing:.1em">${x.name}</button>`,
      ).join('')}
      <div style="margin:16px 0 8px;letter-spacing:.2em">CUSTOM</div>
      ${SLOTS.map(
        (s) =>
          `<label style="display:flex;align-items:center;justify-content:space-between;margin:0 0 6px">${s.label}<input type="color" data-slot="${s.key}" value="${lv[s.key as keyof Livery]}" style="width:64px;height:24px;border:0;background:none;cursor:pointer"></label>`,
      ).join('')}
      <button data-save style="margin-top:14px;width:100%;padding:10px;cursor:pointer;background:#ff7a1c;border:0;color:#111;font:800 14px Oxanium,sans-serif;letter-spacing:.3em">SAVE LIVERY</button>
      <div data-status style="margin-top:8px;color:#6fe6ff"></div>`;
    p.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const preset = LIVERY_PRESETS[Number(b.dataset.preset)];
        this.profile.livery = { ...preset.livery };
        this.profile.liveryName = preset.name;
        this.dirty = true;
        this.renderPanel();
      }),
    );
    p.querySelectorAll<HTMLInputElement>('[data-slot]').forEach((inp) =>
      inp.addEventListener('input', () => {
        (this.profile.livery as Record<string, string>)[inp.dataset.slot!] = inp.value;
        this.profile.liveryName = 'CUSTOM';
        this.dirty = true;
      }),
    );
    p.querySelector('[data-save]')!.addEventListener('click', () => {
      saveProfile(this.profile);
      (p.querySelector('[data-status]') as HTMLElement).textContent = 'SAVED — YOUR KESTREL WILL FLY IN THESE COLOURS.';
    });
  }

  update({ dt }: FrameContext): void {
    if (this.dirty) this.rebuild();
    if (this.ship) {
      this.ship.root.rotation.y += dt * 0.25;
      this.ship.setWingSweep(0.5 + Math.sin(this.ship.root.rotation.y * 0.7) * 0.5);
    }
    this.backdrop.follow(this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    return `PAINT SHOP · ${this.profile.liveryName}`;
  }
}
