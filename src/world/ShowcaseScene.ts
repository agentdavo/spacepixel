import { MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext, Updatable, ResizeAware } from '@/core/Engine';
import type { ShipModel } from '@/assets/ShipBuilder';
import { assets } from '@/assets/AssetLibrary';
import { Backdrop, BACKDROPS } from './Backdrop';
import { Planet, PLANETS } from './Planet';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';

interface CameraShot {
  name: string;
  /** Returns [camera position, look target] at time t. */
  frame(t: number, s: ShowcaseScene): [Vector3, Vector3];
  fov: number;
}

/**
 * Milestones 1–3 render test: a posed engagement in the Meridian system used
 * to lock down the look — Vanguard Kestrels in formation, inbound Choir
 * Cantors, a Cathedral dreadnought on the horizon and the gas giant Castellan.
 */
export class ShowcaseScene implements Updatable, ResizeAware {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(36, 16 / 9, 0.5, 1_200_000);
  readonly backdrop: Backdrop;
  readonly planet: Planet;
  readonly hero: ShipModel;
  readonly wingmen: ShipModel[] = [];
  readonly cantors: ShipModel[] = [];
  readonly cathedral: ShipModel;
  shot = 0;

  readonly shots: CameraShot[] = [
    {
      name: 'HERO 3/4',
      fov: 34,
      frame: (t, s) => {
        const a = -0.62 + Math.sin(t * 0.12) * 0.1;
        const p = s.hero.root.position;
        return [
          new Vector3(Math.sin(a) * 23, 4.2 + Math.sin(t * 0.3) * 0.4, Math.cos(a) * 23).add(p),
          p.clone().add(new Vector3(1.5, 0.3, -2)),
        ];
      },
    },
    {
      name: 'ESTABLISHING',
      fov: 40,
      frame: (t) => [new Vector3(-70 + t * 0.4, 22, 95), new Vector3(120, 160, -1800)],
    },
    {
      name: 'PROFILE',
      fov: 30,
      frame: (t, s) => {
        const p = s.hero.root.position;
        return [p.clone().add(new Vector3(21, 1.2 + Math.sin(t * 0.4) * 0.3, 3.5)), p.clone().add(new Vector3(0, 0.2, 0.5))];
      },
    },
    {
      name: 'CATHEDRAL',
      fov: 32,
      frame: (t, s) => {
        const c = s.cathedral.root.position;
        return [c.clone().add(new Vector3(-1500 + t * 3, 520, 2100)), c.clone().add(new Vector3(0, 0, 200))];
      },
    },
    {
      name: 'CHASE',
      fov: 42,
      frame: (t, s) => {
        const p = s.hero.root.position;
        return [p.clone().add(new Vector3(-2.5, 4.5 + Math.sin(t * 0.5) * 0.3, -24)), p.clone().add(new Vector3(40, 10, 300))];
      },
    },
  ];

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);

    this.backdrop = new Backdrop(BACKDROPS.meridian);
    this.scene.add(this.backdrop.group);

    this.planet = new Planet(PLANETS.castellan);
    this.planet.group.position.set(150_000, -70_000, -290_000);
    this.planet.group.rotation.set(0.1, 0.4, 0.28);
    this.scene.add(this.planet.group);

    // Vanguard flight: lead + two wingmen in a loose finger-four.
    this.hero = assets.ship('vf27-kestrel');
    this.scene.add(this.hero.root);
    const wingPos: [number, number, number][] = [
      [-17, -3, -26],
      [21, 2.5, -38],
    ];
    for (const p of wingPos) {
      const w = assets.ship('vf27-kestrel');
      w.root.position.set(...p);
      this.wingmen.push(w);
      this.scene.add(w.root);
    }

    // Inbound Choir interceptors.
    const cantorPos: [number, number, number][] = [
      [95, 18, -210],
      [120, 8, -250],
      [70, 30, -290],
    ];
    for (const p of cantorPos) {
      const c = assets.ship('choir-cantor');
      c.root.position.set(...p);
      c.root.lookAt(new Vector3(-10, 0, 40));
      this.cantors.push(c);
      this.scene.add(c.root);
    }

    this.cathedral = assets.ship('choir-cathedral');
    this.cathedral.root.position.set(-900, 950, -6200);
    this.cathedral.root.rotation.set(0.04, -2.3, 0.1);
    this.scene.add(this.cathedral.root);
  }

  setShot(i: number): void {
    this.shot = ((i % this.shots.length) + this.shots.length) % this.shots.length;
  }

  update({ time }: FrameContext): void {
    // Hero: lazy barrel-banking with a little lift so the rim lights sweep across the hull.
    const h = this.hero.root;
    h.rotation.set(Math.sin(time * 0.37) * 0.06 - 0.05, Math.sin(time * 0.21) * 0.08, Math.sin(time * 0.5) * 0.32 + 0.12);
    h.position.y = Math.sin(time * 0.6) * 0.35;
    this.hero.setThrottle(0.85 + Math.sin(time * 7.3) * 0.05);

    this.wingmen.forEach((w, i) => {
      w.root.rotation.set(0, 0, Math.sin(time * 0.5 + 0.7 + i) * 0.22 + 0.1);
      w.root.position.y += Math.sin(time * 0.8 + i * 2) * 0.004;
      w.setThrottle(0.8 + Math.sin(time * 6.1 + i) * 0.05);
    });

    this.cantors.forEach((c, i) => {
      c.root.rotateZ(0.004 * (i % 2 ? 1 : -1));
      c.setThrottle(1.1);
    });

    this.cathedral.root.position.z += 0.05;
    this.cathedral.setThrottle(0.6);

    const shot = this.shots[this.shot];
    const [pos, target] = shot.frame(time, this);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    if (this.camera.fov !== shot.fov) {
      this.camera.fov = MathUtils.lerp(this.camera.fov, shot.fov, 1);
      this.camera.updateProjectionMatrix();
    }
    this.backdrop.follow(this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
