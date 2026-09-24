import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { LightRig, type LightPreset } from '@/render/LightRig';
import { CelMaterial } from '@/render/materials/CelMaterial';
import { skyMaterial } from '../surface/materials';
import type { GameScene } from '../GameScene';
import { KessenFrame } from '@/kessen/FrameKit';
import { CLIPS, type ClipId } from '@/kessen/clips';
import { KESSEN, VARIANTS, VARIANT_BY_ID, statureOf } from '@/kessen/data';

/**
 * The Kessen viewer: every frame variant, rigged and animated in the game
 * renderer, standing on Kessendra's iron plain under the copper storm sky,
 * with a 1.8 m person and a three-storey block for scale.
 *
 *   ?scene=kessen                  the parade (all 14 variants)
 *   ?clip=walk                     start every frame on a clip
 *                                  (idle walk run fire melee kneel standDown boost)
 *   ?v=plumb&cam=1                 close shot on one variant
 *   keys: C camera · K next clip · V next variant
 */

const KESSENDRA: LightPreset = {
  name: 'Kessendra',
  keyDirection: new Vector3(0.45, 0.5, 0.74).normalize(),
  keyColor: new Color('#ffd9b0'),
  keyIntensity: 1.0,
  shadowTint: new Color('#3a2a3e'),
  rimDirection: new Vector3(-0.5, 0.25, -0.83).normalize(),
  rimColor: new Color('#74f6e2'),
  rimIntensity: 0.8,
  specColor: new Color('#fff1dc'),
};

interface Shot {
  name: string;
  fov: number;
  eye(t: number, focus: Vector3, h: number, out: Vector3): Vector3;
  look(t: number, focus: Vector3, h: number, out: Vector3): Vector3;
}

const SHOTS: Shot[] = [
  {
    name: 'PARADE',
    fov: 34,
    // `h` is the parade's width here.
    eye: (t, _f, h, o) => o.set(Math.sin(t * 0.05) * 4, h * 0.12, h * 1.2),
    look: (_t, _f, _h, o) => o.set(0, 4.6, 0),
  },
  {
    name: 'CLOSE',
    fov: 30,
    eye: (t, f, h, o) => o.set(f.x + Math.sin(t * 0.25) * h * 1.1, h * 0.7, f.z + Math.cos(t * 0.25) * h * 1.6 + h * 0.8),
    look: (_t, f, h, o) => o.set(f.x, h * 0.55, f.z),
  },
  {
    name: 'LOW · HERO',
    fov: 40,
    eye: (t, f, h, o) => o.set(f.x + h * 0.6 + Math.sin(t * 0.1) * 0.5, 0.8, f.z + h * 1.8),
    look: (_t, f, h, o) => o.set(f.x, h * 0.72, f.z),
  },
];

const SPACING = 1.4; // metres between frames, on top of their width

export class KessenTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(34, 16 / 9, 0.2, 20_000);
  readonly frames: KessenFrame[] = [];
  private readonly sky: Mesh;
  private shot = 0;
  private paradeWidth = 60;
  private focus = 0;
  private clip: ClipId;
  private t = 0;
  private readonly eye = new Vector3();
  private readonly target = new Vector3();
  private readonly focusPos = new Vector3();
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'k' || e.key === 'K') this.setClip(CLIPS[(CLIPS.indexOf(this.clip) + 1) % CLIPS.length]);
    else if (e.key === 'v' || e.key === 'V') {
      this.focus = (this.focus + 1) % this.frames.length;
      if (this.shot === 0) this.shot = 1;
    }
  };

  constructor() {
    LightRig.apply(KESSENDRA);
    const q = new URLSearchParams(window.location.search);
    this.clip = (CLIPS as readonly string[]).includes(q.get('clip') ?? '') ? (q.get('clip') as ClipId) : 'idle';

    // Copper storm sky and the iron plain.
    this.sky = new Mesh(new SphereGeometry(10_000, 32, 16), skyMaterial(new Color('#6b2f1f'), new Color('#d9844a')));
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    const ground = new Mesh(new PlaneGeometry(4000, 4000), new CelMaterial({ color: '#4f2d20', inkId: 3900, gloss: 0, rimWidth: 2, haze: 0 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // Rail lines across the plain: the Kessen lay track wherever they walk.
    for (const z of [-6, -4.6]) {
      const rail = new Mesh(new BoxGeometry(400, 0.18, 0.14), new CelMaterial({ color: '#8d959f', inkId: 3901, gloss: 0.8 }));
      rail.position.set(0, 0.09, z);
      this.scene.add(rail);
    }

    // The parade, smallest to largest, centred on x = 0.
    const widths = VARIANTS.map((v) => statureOf(v).height * 0.55);
    const total = widths.reduce((a, w) => a + w + SPACING, -SPACING);
    this.paradeWidth = total;
    let x = -total / 2;
    VARIANTS.forEach((v, i) => {
      const f = new KessenFrame(v);
      x += widths[i] / 2;
      f.root.position.set(x, 0, 0);
      x += widths[i] / 2 + SPACING;
      f.play(this.clip, 0);
      // De-sync the loops so the line doesn't move in lockstep.
      f.update(i * 0.37);
      this.frames.push(f);
      this.scene.add(f.root);
    });

    // Scale: a person and a three-storey block (3.3 m a storey).
    const person = human();
    person.position.set(-total / 2 - 2.2, 0, 1.5);
    this.scene.add(person);
    const block = building(3);
    block.position.set(total / 2 + 7, 0, -3);
    this.scene.add(block);

    const want = q.get('v');
    if (want && VARIANT_BY_ID[want]) this.focus = VARIANTS.indexOf(VARIANT_BY_ID[want]);
    this.shot = Math.min(SHOTS.length - 1, Math.max(0, Number(q.get('cam') ?? (want ? 1 : 0)) || 0));
    window.addEventListener('keydown', this.onKey);
    this.placeCamera();
  }

  setClip(clip: ClipId): void {
    this.clip = clip;
    for (const f of this.frames) f.play(clip);
  }

  cycleCamera(): void {
    this.shot = (this.shot + 1) % SHOTS.length;
  }

  cameraLabel(): string {
    const f = this.frames[this.focus];
    const who = this.shot === 0 ? `${KESSEN.name} · ${VARIANTS.length} frames` : `${f.variant.name} ${f.variant.code} · ${f.height} m`;
    return `CAM ${this.shot + 1} · ${SHOTS[this.shot].name} · ${who} · ${this.clip.toUpperCase()}`;
  }

  update(ctx: FrameContext): void {
    const dt = Math.min(ctx.dt, 0.1);
    this.t += dt;
    for (const f of this.frames) f.update(dt);
    this.placeCamera();
  }

  private placeCamera(): void {
    const s = SHOTS[this.shot];
    const f = this.frames[this.focus];
    f.root.getWorldPosition(this.focusPos);
    const h = this.shot === 0 ? this.paradeWidth : f.height;
    s.eye(this.t, this.focusPos, h, this.eye);
    s.look(this.t, this.focusPos, h, this.target);
    this.camera.fov = s.fov;
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
  }
}

function human(): Group {
  const g = new Group();
  const m = new CelMaterial({ color: '#2a2f37', inkId: 3902 });
  const add = (mesh: Mesh, x: number, y: number) => {
    mesh.position.set(x, y, 0);
    g.add(mesh);
  };
  add(new Mesh(new SphereGeometry(0.12, 10, 8), m), 0, 1.66);
  add(new Mesh(new BoxGeometry(0.42, 0.62, 0.24), m), 0, 1.25);
  for (const x of [-0.11, 0.11]) add(new Mesh(new BoxGeometry(0.14, 0.86, 0.16), m), x, 0.47);
  for (const x of [-0.27, 0.27]) add(new Mesh(new CylinderGeometry(0.05, 0.05, 0.66, 6), m), x, 1.2);
  return g;
}

function building(storeys: number): Group {
  const g = new Group();
  const H = storeys * 3.3;
  const w = 9;
  const d = 7;
  const wall = new Mesh(new BoxGeometry(w, H, d), new CelMaterial({ color: '#cfc6b2', inkId: 3903, gloss: 0 }));
  wall.position.y = H / 2;
  g.add(wall);
  const trim = new CelMaterial({ color: '#a79f8c', inkId: 3904, gloss: 0 });
  const glass = new CelMaterial({ color: '#39424f', inkId: 3905, gloss: 0.9 });
  for (let s = 0; s < storeys; s++) {
    const band = new Mesh(new BoxGeometry(w + 0.1, 0.18, d + 0.1), trim);
    band.position.y = s * 3.3 + 0.1;
    g.add(band);
    for (let i = 0; i < 4; i++) {
      const win = new Mesh(new BoxGeometry(1.2, 1.5, 0.1), glass);
      win.position.set(-w / 2 + 1.3 + i * ((w - 2.6) / 3), s * 3.3 + 1.8, d / 2 + 0.02);
      g.add(win);
    }
  }
  const roof = new Mesh(new BoxGeometry(w + 0.3, 0.3, d + 0.3), trim);
  roof.position.y = H + 0.15;
  g.add(roof);
  return g;
}
