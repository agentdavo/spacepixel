import { Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { flags } from '@/core/Flags';
import { WorldSpace } from '@/core/WorldSpace';
import { assets } from '@/assets/AssetLibrary';
import type { ShipModel } from '@/assets/ShipBuilder';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { Planet, PLANETS } from '../Planet';
import { SpaceDust } from '../SpaceDust';
import { AsteroidField } from '../AsteroidField';
import { HazeClouds } from '../HazeClouds';

interface Shot {
  name: string;
  fov: number;
  /** Flight speed along the path, m/s. */
  speed: number;
  /** Camera offset from the lead ship in flight-frame metres (x right, y up, z forward) at time t. */
  eye(t: number, out: Vector3): Vector3;
  /** Look target in flight-frame metres relative to the lead ship. */
  look(t: number, out: Vector3): Vector3;
  /** Time (s) at which the lead passes the clump boulder. */
  pass: number;
}

const SHOTS: Shot[] = [
  {
    name: 'CHASE · 320 m/s',
    fov: 46,
    speed: 320,
    eye: (t, o) => o.set(-3, 4.8 + Math.sin(t * 0.7) * 0.4, -26),
    look: (_t, o) => o.set(6, 6, 260),
    pass: 4,
  },
  {
    name: 'FLYBY · 320 m/s',
    fov: 38,
    speed: 320,
    eye: (t, o) => o.set(36, 2.5 + Math.sin(t * 0.5), 4),
    look: (_t, o) => o.set(-12, 7, 10),
    pass: 2.5,
  },
  {
    name: 'DRIFT · 14 m/s',
    fov: 40,
    speed: 14,
    eye: (t, o) => o.set(-16 + Math.sin(t * 0.2) * 2, 5, -30),
    look: (_t, o) => o.set(30, 0, 140),
    pass: 12,
  },
  {
    name: 'BOOST · 1400 m/s',
    fov: 58,
    speed: 1400,
    eye: (_t, o) => o.set(-1.5, 3.2, -19),
    look: (_t, o) => o.set(0, 4, 300),
    pass: 3.6,
  },
];

/** Formation, flight-frame metres relative to the lead (right, up, forward). */
const FORMATION: [number, number, number][] = [
  [0, 0, 0],
  [24, -5, 34],
];

/**
 * Spatial-cue test bed: a Kestrel pair screaming through an asteroid clump
 * 2 000 km from the universe origin (camera-relative rendering keeps it
 * jitter-free). Space dust streaks at speed, the rocks give parallax and scale,
 * the gas giant and painted sky sit at "infinity".
 *
 *   ?cam=0..3   CHASE · FLYBY · DRIFT · BOOST   (key C cycles)
 *   ?speed=n    override the flight speed (m/s)
 *   ?dust=0 · ?haze=0 · ?rocks=0   A/B the individual depth cues
 */
export class SpatialTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(42, 16 / 9, 0.5, 1_200_000);
  readonly world: WorldSpace;
  readonly backdrop: Backdrop;
  readonly dust: SpaceDust;
  readonly field: AsteroidField;
  readonly haze: HazeClouds;
  readonly planet: Planet;
  readonly ships: ShipModel[] = [];

  private shot = 0;
  private readonly speedOverride: number;

  // Flight frame (universe axes).
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private readonly right = new Vector3();
  private readonly shipQuat = new Quaternion();
  /** Universe point the lead passes at t = shot.pass. */
  private readonly passPoint = new Vector3();

  // Scratch (no per-frame allocation).
  private readonly lead = new Vector3();
  private readonly velocity = new Vector3();
  private readonly tmp = new Vector3();
  private readonly target = new Vector3();

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    const q = new URLSearchParams(window.location.search);
    this.speedOverride = Number(q.get('speed') ?? 0) || 0;

    this.world = new WorldSpace(this.scene);

    this.backdrop = new Backdrop(BACKDROPS.meridian);
    this.scene.add(this.backdrop.group);

    this.dust = new SpaceDust();
    this.scene.add(this.dust.object);

    // Field centre ~2 000 km from the universe origin: proves floating-origin precision.
    const fieldCentre = new Vector3(1_730_000, 42_000, -1_000_000);
    this.field = new AsteroidField();
    this.field.group.position.copy(fieldCentre);
    this.field.group.rotation.set(0.12, 0, 0.05);
    this.field.group.updateMatrix();
    this.world.root.add(this.field.group);

    // Fly tangentially past a mid-sized clump, just outside its core boulder.
    const clump = this.field.clumps.reduce((best, c) =>
      Math.abs(c.boulder - 180) < Math.abs(best.boulder - 180) ? c : best,
    );
    const toCentre = clump.centre.clone().setY(0).normalize();
    this.fwd.set(-toCentre.z, 0, toCentre.x).applyEuler(this.field.group.rotation).normalize();
    this.up.set(0, 1, 0).applyEuler(this.field.group.rotation).normalize();
    this.right.crossVectors(this.fwd, this.up).normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
    this.passPoint
      .copy(clump.centre)
      .applyEuler(this.field.group.rotation)
      .add(fieldCentre)
      .addScaledVector(this.right, -(clump.boulder * 1.3 + 150))
      .addScaledVector(this.up, clump.boulder * 0.3);
    // Ship nose is +Z: basis (x = up × fwd, y = up, z = fwd).
    const xAxis = new Vector3().crossVectors(this.up, this.fwd);
    this.shipQuat.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, this.up, this.fwd));

    // Dust lanes: a haze puff around every clump plus a scatter through the disc.
    const puffs: Vector3[] = [];
    let k = 1;
    const jitter = () => ((k = (k * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (const c of this.field.clumps) {
      puffs.push(c.centre.clone().add(new Vector3(jitter() * 400, jitter() * 150, jitter() * 400)));
    }
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + jitter() * 0.1;
      const r = 2500 + (jitter() * 0.5 + 0.5) * 6000;
      puffs.push(new Vector3(Math.cos(a) * r, jitter() * 300, Math.sin(a) * r));
    }
    this.haze = new HazeClouds({
      seed: 3,
      centres: puffs,
      size: [500, 1600],
      opacity: 0.3,
      colors: ['#6a4f9a', '#2f7f9a'],
    });
    this.field.group.add(this.haze.group);

    this.dust.object.visible = q.get('dust') !== '0';
    this.haze.group.visible = q.get('haze') !== '0';
    if (q.get('hazeop')) this.haze.opacity.value = Number(q.get('hazeop'));
    for (const m of this.field.meshes) m.visible = q.get('rocks') !== '0';

    this.planet = new Planet(PLANETS.castellan);
    this.planet.group.position
      .copy(this.passPoint)
      .addScaledVector(this.fwd, 310_000)
      .addScaledVector(this.right, 150_000)
      .addScaledVector(this.up, -60_000);
    this.planet.group.rotation.set(0.1, 0.4, 0.28);
    this.world.root.add(this.planet.group);

    for (let i = 0; i < FORMATION.length; i++) {
      const s = assets.ship('vf27-kestrel');
      this.ships.push(s);
      this.world.root.add(s.root);
    }

    this.setShot(flags.cam);
  }

  cycleCamera(): void {
    this.setShot(this.shot + 1);
  }

  cameraLabel(): string {
    return `CAM ${this.shot + 1} · ${SHOTS[this.shot].name}`;
  }

  setShot(i: number): void {
    this.shot = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length;
    const s = SHOTS[this.shot];
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Flight-frame (x right, y up, z forward) → universe offset, in place. */
  private frame(v: Vector3): Vector3 {
    const { x, y, z } = v;
    return v.set(0, 0, 0).addScaledVector(this.right, x).addScaledVector(this.up, y).addScaledVector(this.fwd, z);
  }

  update({ time, dt }: FrameContext): void {
    const shot = SHOTS[this.shot];
    const speed = this.speedOverride || shot.speed;

    // Lead ship: straight line (float64) with a lazy weave.
    this.lead.copy(this.passPoint).addScaledVector(this.fwd, speed * (time - shot.pass));
    this.velocity.copy(this.fwd).multiplyScalar(speed);

    this.ships.forEach((s, i) => {
      const f = FORMATION[i];
      this.tmp.set(f[0] + Math.sin(time * 0.6 + i) * 1.2, f[1] + Math.sin(time * 0.9 + i * 2) * 0.6, f[2]);
      this.frame(this.tmp);
      s.root.position.copy(this.lead).add(this.tmp);
      s.root.quaternion.copy(this.shipQuat);
      s.root.rotateZ(Math.sin(time * 0.5 + i * 1.3) * 0.25 + (i ? -0.1 : 0.12));
      s.root.rotateX(Math.sin(time * 0.37 + i) * 0.04);
      s.setThrottle((speed > 500 ? 1.3 : 0.9) + Math.sin(time * 7.3 + i) * 0.05);
    });

    // Eye follows the lead in the flight frame.
    this.world.eye.copy(this.lead).add(this.frame(shot.eye(time, this.tmp)));
    this.frame(shot.look(time, this.target)).add(this.lead);

    this.world.sync(this.camera);
    this.world.toRender(this.target, this.target);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();

    this.field.update(time);
    this.dust.update(this.world.eye, this.velocity, dt);
    this.backdrop.follow(this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
