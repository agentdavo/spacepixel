import { Color, CylinderGeometry, IcosahedronGeometry, Mesh, PerspectiveCamera, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { flags } from '@/core/Flags';
import { buildShip } from '@/assets/ShipBuilder';
import { CATHEDRAL } from '@/assets/blueprints';
import { KessenFrame } from '@/kessen/FrameKit';
import { VARIANT_BY_ID } from '@/kessen/data';
import { createPoseBuffer, sampleClip } from '@/kessen/clips';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { Backdrop, BACKDROPS } from '../Backdrop';
import type { GameScene } from '../GameScene';

/** Authored film set, not a campaign actor, combat sim or boarding implementation.
 * ?scene=kessen-assault&cut=cinematic|close&t=0&hud=0
 * Pure absolute-time poses let the recorder seek without changing the action.
 */
const IDS = ['plumb', 'gauge', 'chisel', 'plumb', 'anvil', 'spanner', 'gimlet', 'plumb'];
const Y = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const muzzleLength = (id: string) => id === 'gauge' ? 4.5 : id === 'anvil' || id === 'chisel' ? 3.7 : id === 'gimlet' || id === 'spanner' ? 2.25 : 3.3;

interface Actor {
  frame: KessenFrame;
  base: Vector3;
  target: Vector3;
  muzzle: Vector3;
  bolt: Mesh;
  flash: Mesh;
  jets: Mesh[];
}

export class KessenAssaultScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 16 / 9, 0.2, 900_000);
  private readonly capital = buildShip(CATHEDRAL);
  private readonly sky = new Backdrop({ ...BACKDROPS.meridian, nebula: [
    { at: 0, color: '#020817' }, { at: 0.5, color: '#071226' }, { at: 0.7, color: '#153c50' },
    { at: 0.87, color: '#4c426e' }, { at: 1, color: '#a57391' },
  ] });
  private readonly actors: Actor[] = [];
  private readonly impacts: { core: Mesh; shards: Mesh[]; smoke: Mesh; at: number; point: Vector3 }[] = [];
  private readonly scars: Mesh[] = [];
  private readonly rupture: Mesh;
  private readonly plume: Mesh;
  private readonly pose = createPoseBuffer();
  private readonly overlay = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly subtitle = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly aim = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly direction = new Vector3();
  private readonly q = new Quaternion();
  private readonly parentQ = new Quaternion();
  private time = flags.startTime;
  private readonly close = new URLSearchParams(location.search).get('cut') === 'close';
  private readonly materials: CelMaterial[] = [];
  private readonly tube = new CylinderGeometry(1, 1, 1, 6);
  private readonly shard = new IcosahedronGeometry(1, 0);
  private readonly flare = new IcosahedronGeometry(1, 1);
  private readonly hot: CelMaterial;
  private readonly cyan: CelMaterial;

  constructor() {
    LightRig.apply({ ...LIGHT_PRESETS.meridian, name: 'Kessen assault film set',
      keyDirection: new Vector3(0.6, 0.6, 0.8).normalize(), shadowTint: new Color('#4a5864'),
      rimDirection: new Vector3(-0.5, 0.4, -0.2).normalize(), rimColor: new Color('#74f6e2'), rimIntensity: 0.65 });
    this.hot = this.material('#ffcf65', 3970, 2.3);
    this.cyan = this.material('#69fbe9', 3971, 1.5);
    const smokeMat = this.material('#273241', 3972);
    const debrisMat = this.material('#ac7864', 3973);
    const scarMat = this.material('#171d25', 3974);
    this.rupture = new Mesh(this.flare, this.hot);
    this.plume = new Mesh(this.flare, smokeMat);
    this.scene.add(this.rupture, this.plume);
    const capitalPaint = new CelMaterial({ vertexPaint: true, ramp: 'dramatic', inkId: 2000, emissiveStrength: 0.3, gloss: 0.3 });
    this.materials.push(capitalPaint);
    for (const mesh of this.capital.meshes) mesh.material = capitalPaint;
    this.scene.add(this.sky.group, this.capital.root);
    this.capital.setThrottle(0.4);
    this.capital.root.updateMatrixWorld(true);
    const ray = new Raycaster();

    IDS.forEach((id, i) => {
      // Existing art at real Stature; an aimed gun pose for this film's salvo.
      const frame = new KessenFrame({ ...VARIANT_BY_ID[id], stance: 'aim' });
      const x = (i % 4 - 1.5) * 14;
      const y = 36 + Math.floor(i / 4) * 17;
      ray.set(new Vector3(x * 1.7, y + 4, 1800), FORWARD);
      const hit = ray.intersectObjects(this.capital.meshes, false)[0];
      if (!hit) throw new Error(`No capital hull at Kessen attack lane ${i}`);
      const target = hit.point.clone();
      const base = new Vector3(x, y, target.z + 65 + Math.floor(i / 4) * 13);
      const bolt = new Mesh(this.tube, this.cyan);
      const flash = new Mesh(this.flare, this.hot);
      const jets = [new Mesh(this.tube, this.cyan), new Mesh(this.tube, this.cyan)];
      this.scene.add(frame.root, bolt, flash, ...jets);
      this.actors.push({ frame, base, target, muzzle: new Vector3(), bolt, flash, jets });
      const scar = new Mesh(this.flare, scarMat);
      scar.position.copy(target).add(new Vector3(0, 0, 0.35));
      this.scars.push(scar); this.scene.add(scar);
      // Bake a little bounce into owned geometry; shared frame material is intact.
      for (const mesh of frame.meshes) {
        const s = mesh.geometry.getAttribute('surface');
        for (let v = 0; v < s.count; v++) if (s.getY(v) === 0) s.setY(v, 0.08);
        s.needsUpdate = true;
      }
      for (let shot = 0; shot < 18; shot++) {
        const at = 5 + i * 0.07 + shot * 0.6 + 0.3;
        const core = new Mesh(this.flare, this.hot);
        const smoke = new Mesh(this.flare, smokeMat);
        const shards = Array.from({ length: 5 }, () => new Mesh(this.shard, debrisMat));
        this.scene.add(core, smoke, ...shards);
        this.impacts.push({ core, shards, smoke, at, point: target.clone() });
      }
    });
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;color:#e7f3ec;font-family:Arial,sans-serif;';
    this.title.style.cssText = 'position:absolute;left:5%;top:8%;font-size:46px;font-weight:800;letter-spacing:8px;text-shadow:0 2px 10px #000;';
    this.subtitle.style.cssText = 'position:absolute;left:5%;top:17%;font-size:14px;letter-spacing:4px;color:#83e7da;text-shadow:0 2px 7px #000;';
    this.label.style.cssText = 'position:absolute;left:5%;bottom:6%;font-size:13px;letter-spacing:3px;border-left:3px solid #78eddb;padding:8px 13px;background:#07131aaa;';
    const mark = document.createElement('div');
    mark.style.cssText = 'position:absolute;right:5%;bottom:7%;font-size:10px;letter-spacing:3px;color:#b6c9cf;';
    mark.textContent = 'VANGUARD / CINEMATIC DEMO';
    this.overlay.append(this.title, this.subtitle, this.label, mark);
    document.getElementById('ui-root')!.append(this.overlay);
    window.__VANGUARD__ = { ...(window.__VANGUARD__ ?? { ready: false, frame: () => 0, backend: '' }), hooks: { ...window.__VANGUARD__?.hooks, assault: this } };
    this.poseAt(this.time);
  }

  private material(color: string, inkId: number, glow = 0): CelMaterial {
    const m = new CelMaterial({ color, inkId, gloss: 0.3, ...(glow ? { emissive: color, emissiveStrength: glow } : {}) });
    this.materials.push(m);
    return m;
  }

  private line(mesh: Mesh, a: Vector3, b: Vector3, width: number): void {
    this.direction.subVectors(b, a);
    const length = this.direction.length();
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, this.direction.normalize());
    mesh.scale.set(width, Math.max(0.001, length), width);
  }

  /** Public seek for deterministic native capture and visual QA. */
  poseAt(t: number): void {
    this.time = Math.max(0, Math.min(18, t));
    const time = this.time;
    this.actors.forEach((a, i) => {
      const approach = 1 - smooth(0, 5, time);
      const retreat = smooth(16, 18, time);
      a.frame.root.position.copy(a.base);
      a.frame.root.position.z += approach * 160 + retreat * 32;
      a.frame.root.position.x += Math.sin(time * 0.75 + i) * 0.8;
      a.frame.root.position.x += (i % 4 < 2 ? -1 : 1) * smooth(10, 16, time) * 6;
      a.frame.root.position.y += Math.sin(time * 1.1 + i) * 0.65;
      a.frame.root.rotation.set(0, Math.PI, Math.sin(time * 0.9 + i) * 0.025);
      const firing = time >= 5 + i * 0.07 && time < 16;
      sampleClip(time < 4.7 || time > 16 ? 'boost' : firing ? 'fire' : 'idle', time - 5 - i * 0.07,
        { stance: 'aim', stature: a.frame.variant.stature }, this.pose);
      a.frame.apply(this.pose, false);
      // Aim the visible gun's actual -Y barrel axis at the hull contact point.
      const hand = a.frame.bones.hand_R;
      const weapon = a.frame.bones.weapon_R;
      weapon.getWorldPosition(this.from);
      this.to.subVectors(a.target, this.from).normalize();
      weapon.getWorldQuaternion(this.q);
      this.direction.set(0, -1, 0).applyQuaternion(this.q);
      this.q.setFromUnitVectors(this.direction, this.to);
      hand.getWorldQuaternion(this.parentQ);
      this.q.multiply(this.parentQ);
      hand.parent!.getWorldQuaternion(this.parentQ).invert();
      hand.quaternion.copy(this.parentQ.multiply(this.q));
      a.frame.root.updateMatrixWorld(true);
      a.muzzle.set(0, -muzzleLength(IDS[i]), 0.3);
      weapon.localToWorld(a.muzzle);
      const phase = ((time - 5 - i * 0.07) % 0.6 + 0.6) % 0.6;
      a.flash.visible = firing && phase < 0.085;
      a.flash.position.copy(a.muzzle);
      a.flash.scale.setScalar(0.3 + 0.8 * Math.max(0, 1 - phase / 0.085));
      a.bolt.visible = firing && phase < 0.3;
      const u = Math.min(1, phase / 0.3);
      this.from.lerpVectors(a.muzzle, a.target, Math.max(0, u - 0.16));
      this.to.lerpVectors(a.muzzle, a.target, u);
      this.line(a.bolt, this.from, this.to, IDS[i] === 'anvil' ? 0.19 : 0.1);
      a.jets.forEach((jet, j) => {
        a.frame.bones[j ? 'jet_R' : 'jet_L'].getWorldPosition(this.from);
        this.to.copy(this.from).add(new Vector3(0, -0.4, (time < 5 || time > 16 ? 6 : 1.8) * (1 + 0.2 * Math.sin(time * 34 + i))));
        this.line(jet, this.from, this.to, time < 5 ? 0.23 : 0.14);
      });
    });
    this.scars.forEach((scar, i) => {
      scar.visible = time > 5.3 + i * 0.07;
      const r = 1.5 + smooth(5.3, 15, time) * 4;
      scar.scale.set(r, r * 0.7, 0.3);
    });
    const ruptureAge = time - 12;
    const center = this.actors[1].target;
    this.rupture.visible = ruptureAge >= 0 && ruptureAge < 0.6;
    this.rupture.position.copy(center).add(new Vector3(0, 0, 3));
    this.rupture.scale.setScalar(Math.max(0.01, 10 * Math.sin(Math.max(0, ruptureAge) / 0.6 * Math.PI)));
    this.plume.visible = ruptureAge > 0 && ruptureAge < 5;
    this.plume.position.copy(center).add(new Vector3(ruptureAge * 0.8, ruptureAge * 3, ruptureAge * 5));
    this.plume.scale.set(Math.max(0.01, 2 + ruptureAge * 2), Math.max(0.01, 2 + ruptureAge * 1.4), Math.max(0.01, 2 + ruptureAge * 2.5));
    this.impacts.forEach((fx, i) => {
      const age = time - fx.at;
      const active = age >= 0 && age < 1.8;
      fx.core.visible = active && age < 0.35;
      fx.core.position.copy(fx.point).addScaledVector(FORWARD, -0.6);
      fx.core.scale.setScalar(Math.max(0.05, 2.8 * (1 - age / 0.35)));
      fx.smoke.visible = active;
      fx.smoke.position.copy(fx.point).add(new Vector3(Math.sin(i) * age, age * 2, age * 4));
      fx.smoke.scale.setScalar(Math.max(0.05, (0.5 + age * 2) * Math.min(1, (1.8 - age) * 2)));
      fx.shards.forEach((shard, j) => {
        shard.visible = active && age < 1.2;
        const theta = i * 2.4 + j * 1.256;
        shard.position.copy(fx.point).add(new Vector3(Math.cos(theta) * age * 9, Math.sin(theta) * age * 9, age * (5 + j)));
        shard.rotation.set(age * 3 + j, age * 2 + i, age);
        shard.scale.set(0.25, 0.5, 0.35);
      });
    });
    const focus = this.actors[2].frame.root.position;
    if (this.close) {
      this.camera.position.set(focus.x + 47 - time * 0.5, focus.y + 16, focus.z + 22);
      this.aim.set(0, 48, focus.z - 22);
      this.camera.fov = 45;
    } else if (time < 3) {
      this.camera.position.set(-1900 + time * 90, 1150 - time * 30, 2850);
      this.aim.set(0, 170, 220);
      this.camera.fov = 47;
    } else if (time < 7) {
      this.camera.position.set(focus.x + 55, 72, focus.z + 62);
      this.aim.set(0, 47, focus.z - 16);
      this.camera.fov = 47;
    } else if (time < 11) {
      this.camera.position.set(-63 + (time - 7) * 2, 62, focus.z + 25);
      this.aim.set(0, 45, focus.z - 20);
      this.camera.fov = 46;
    } else if (time < 15) {
      this.camera.position.set(105, 110, 1300);
      this.aim.set(0, 42, 1180);
      this.camera.fov = 49;
    } else {
      this.camera.position.set(-92 - (time - 15) * 12, 110 + (time - 15) * 10, 1330 + (time - 15) * 12);
      this.aim.set(0, 45, 1170);
      this.camera.fov = 46;
    }
    this.camera.lookAt(this.aim);
    this.camera.updateProjectionMatrix();
    this.sky.follow(this.camera);
    this.title.textContent = 'KESSEN';
    this.subtitle.textContent = 'EIGHT FRAMES / ONE CAPITAL SHIP';
    this.title.style.opacity = this.subtitle.style.opacity = time < 3 ? String(Math.min(1, time * 2, (3 - time) * 2)) : '0';
    this.label.textContent = time < 5 ? '01 / CLOSE THE DISTANCE' : time < 11 ? '02 / COORDINATED VOLLEY' : time < 16 ? '03 / STRIP THE FORWARD BATTERY' : '04 / BREAK AWAY';
  }

  update(ctx: FrameContext): void { this.poseAt(this.time + ctx.dt); }
  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose(): void {
    this.overlay.remove();
    if (window.__VANGUARD__?.hooks?.assault === this) delete window.__VANGUARD__.hooks.assault;
    // main's disposeTree owns scene GPU teardown, as for the other film scenes.
  }
}
