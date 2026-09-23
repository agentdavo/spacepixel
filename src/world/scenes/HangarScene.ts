import { Group, MathUtils, PerspectiveCamera, Quaternion, Scene, Vector3, type Object3D } from 'three';
import type { FrameContext } from '@/core/Engine';
import { flags } from '@/core/Flags';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { buildShip, type ShipModel } from '@/assets/ShipBuilder';
import { BLUEPRINTS } from '@/assets/blueprints';

type Lineup = 'fighters' | 'strike' | 'capital' | 'sweep' | 'sheet';

interface Shot {
  name: string;
  lineup: Lineup;
  fov: number;
  /** Camera position + look target at time t. */
  frame(t: number): [Vector3, Vector3];
}

interface Placed {
  ship: ShipModel;
  lineup: Lineup;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const deg = MathUtils.degToRad;

/** Kestrel variable-geometry cycle: spread → swept → folded → back. */
function sweepCycle(phase: number): [sweep: number, fold: number] {
  const p = ((phase % 1) + 1) % 1;
  const ss = (a: number, b: number) => MathUtils.smoothstep(p, a, b);
  const sweep = ss(0.05, 0.3) - ss(0.8, 0.97);
  const fold = ss(0.36, 0.5) - ss(0.64, 0.76);
  return [sweep, fold];
}

/**
 * Milestones 7–9: the ship-class roster as a model-sheet hangar. Every
 * design in the blueprint registry lined up by class for comparison, a
 * variable-geometry sequence for the Kestrel, a carrier deck close-up and a
 * four-view "model sheet" for any single design (`?ship=<blueprint id>`).
 *
 * Plain scene coordinates (no floating origin): each lineup sits around the
 * origin and only the active shot's lineup is visible.
 */
export class HangarScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(34, 16 / 9, 0.5, 1_200_000);
  private readonly backdrop = new Backdrop(BACKDROPS.meridian);
  private readonly groups = new Map<Lineup, Group>();
  private readonly placed: Placed[] = [];
  private readonly sweepers: ShipModel[] = [];
  private readonly launcher?: ShipModel;
  private readonly radars: ShipModel[] = [];
  private readonly sheetIds: string[];
  private readonly sheetFixed: string | null;
  private sheetShip = '';
  private sheetRadius = 10;
  shot = 0;

  readonly shots: Shot[];

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);
    for (const l of ['fighters', 'strike', 'capital', 'sweep', 'sheet'] as Lineup[]) {
      const g = new Group();
      g.name = `lineup:${l}`;
      this.groups.set(l, g);
      this.scene.add(g);
    }

    // ── 0 · fighters ───────────────────────────────────────────────────
    const fighters: [string, number, number, number][] = [
      ['vf27-kestrel', -26.5, -2.7, -4.3],
      ['vf31-harrier', -7.3, -1.4, -3],
      ['rw-scrapjack', 11.6, -1.2, 1],
      ['choir-cantor', 28.8, -0.3, 4.2],
    ];
    for (const [id, x, y, z] of fighters) {
      const s = this.add(id, 'fighters', V(x, y, z));
      if (s) s.root.rotation.set(0, deg(35), 0);
    }

    // ── 1 · bombers + corvettes ───────────────────────────────────────
    const wh = this.add('sb9-warhorse', 'strike', V(-61, 25, 16));
    wh?.setChannel('bay', 1);
    this.add('choir-psalter', 'strike', V(-7, 19, 29));
    const lg = this.add('ffc-lantern-guard', 'strike', V(-56, 4, -260));
    if (lg) this.radars.push(lg);
    this.add('choir-vesper', 'strike', V(189, 0, -283));
    for (const p of this.placed) if (p.lineup === 'strike') p.ship.root.rotation.y = deg(35);

    // ── 2 · capital ships (+ corvette and Kestrels for scale) ───────────
    const cv = this.add('cvs07-hesperus-dawn', 'capital', V(-1605, -139, 382));
    if (cv) this.radars.push(cv);
    const bb = this.add('bb-indomitable', 'capital', V(90, -83, 30));
    if (bb) this.radars.push(bb);
    this.add('choir-cathedral', 'capital', V(2227, 262, -175));
    const scaleLg = this.add('ffc-lantern-guard', 'capital', V(-902, 162, 1178));
    if (scaleLg) this.radars.push(scaleLg);
    for (const p of this.placed) if (p.lineup === 'capital') p.ship.root.rotation.y = deg(32);

    // Carrier deck dressing: folded Kestrels parked by the island, one on the catapult.
    if (cv) {
      const deckY = 103 + 1.3;
      for (let i = 0; i < 4; i++) {
        const k = this.add('vf27-kestrel', 'capital', V(88, deckY, 250 - i * 34), cv.root);
        if (k) {
          k.root.rotation.y = deg(-90);
          k.setWingSweep(1);
          k.setWingFold(1);
          k.setThrottle(0);
        }
      }
      const launch = this.add('vf27-kestrel', 'capital', V(55, deckY, 400), cv.root);
      if (launch) {
        launch.setWingSweep(0.1);
        launch.setThrottle(1.4);
        this.launcher = launch;
      }
    }

    // ── 3 · Kestrel sweep sequence ─────────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const k = this.add('vf27-kestrel', 'sweep', V(-27 + i * 18, 0, 0));
      if (k) this.sweepers.push(k);
    }

    // ── 5 · model sheet ────────────────────────────────────────────────
    const q = new URLSearchParams(window.location.search);
    this.sheetIds = Object.keys(BLUEPRINTS);
    const want = q.get('ship');
    this.sheetFixed = want && BLUEPRINTS[want] ? want : null;

    /** Orbit-ish framing: camera at `dist` from `target` along `dir` (normalised). */
    const aim = (target: Vector3, dir: Vector3, dist: number): [Vector3, Vector3] => [
      target.clone().add(dir.clone().normalize().multiplyScalar(dist)),
      target,
    ];
    const carrier = cv?.root;
    const onCarrier = (x: number, y: number, z: number) => {
      if (!carrier) return V(x, y, z);
      carrier.updateMatrixWorld();
      return carrier.localToWorld(V(x, y, z));
    };
    this.shots = [
      {
        name: 'FIGHTERS',
        lineup: 'fighters',
        fov: 30,
        frame: (t) => aim(V(0, -1, 0), V(-0.25 + Math.sin(t * 0.12) * 0.04, 0.42, 0.9), 94),
      },
      {
        name: 'BOMBERS · CORVETTES',
        lineup: 'strike',
        fov: 34,
        frame: (t) => aim(V(0, 0, -100), V(-0.28 + Math.sin(t * 0.1) * 0.03, 0.3, 0.92), 250),
      },
      {
        name: 'CAPITAL SHIPS',
        lineup: 'capital',
        fov: 32,
        frame: (t) => aim(V(100 + t * 3, 0, 0), V(-0.3, 0.36, 0.88), 5600),
      },
      {
        name: 'KESTREL VARIABLE GEOMETRY',
        lineup: 'sweep',
        fov: 30,
        frame: (t) => aim(V(0, -1, -2), V(Math.sin(t * 0.1) * 0.05, 0.78, 0.62), 74),
      },
      {
        name: 'HESPERUS DAWN · DECK',
        lineup: 'capital',
        fov: 40,
        frame: (t) => [onCarrier(-250 + t * 2, 230, 1250), onCarrier(40, 90, 120)],
      },
      {
        name: 'MODEL SHEET',
        lineup: 'sheet',
        fov: 10,
        frame: () => {
          const r = this.sheetRadius;
          const d = (r * 3.4) / (2 * Math.tan(deg(5)));
          return [V(0, 0, d), V(0, 0, 0)];
        },
      },
    ];
    this.setShot(this.sheetFixed ? this.shots.length - 1 : flags.cam);
  }

  private add(id: string, lineup: Lineup, pos: Vector3, parent?: Object3D): ShipModel | undefined {
    const bp = BLUEPRINTS[id];
    if (!bp) return undefined;
    const ship = buildShip(bp);
    ship.root.position.copy(pos);
    (parent ?? this.groups.get(lineup)!).add(ship.root);
    this.placed.push({ ship, lineup });
    return ship;
  }

  /** Four-view model sheet (side / front / top / three-quarter) of one design. */
  private showSheet(id: string): void {
    if (id === this.sheetShip) return;
    this.sheetShip = id;
    const g = this.groups.get('sheet')!;
    g.clear();
    const ship = buildShip(BLUEPRINTS[id]);
    ship.setThrottle(0.6);
    // Normalise every design to the same on-screen size (and fighter-scale
    // depth, so kilometre hulls don't vanish into the aerial haze).
    const R = 20;
    const k = R / ship.radius;
    this.sheetRadius = R;
    // Centre the design on its bounding box.
    const centre = new Vector3();
    ship.hull.geometry.boundingBox?.getCenter(centre);
    const views: [Quaternion, Vector3, number][] = [
      // side: nose → screen right
      [new Quaternion().setFromAxisAngle(V(0, 1, 0), deg(90)), V(-1.45 * R, 0.85 * R, 0), 1],
      // top: back up to camera, nose → screen right
      [
        new Quaternion().setFromAxisAngle(V(0, 0, 1), deg(90)).multiply(new Quaternion().setFromAxisAngle(V(1, 0, 0), deg(90))),
        V(-1.45 * R, -0.72 * R, 0),
        1,
      ],
      // front
      [new Quaternion(), V(1.55 * R, 0.95 * R, 0), 0.75],
      // three-quarter
      [
        new Quaternion().setFromAxisAngle(V(1, 0, 0), deg(24)).multiply(new Quaternion().setFromAxisAngle(V(0, 1, 0), deg(38))),
        V(1.5 * R, -0.55 * R, 0),
        1,
      ],
    ];
    for (const [q, p, size] of views) {
      const holder = new Group();
      holder.quaternion.copy(q);
      holder.position.copy(p);
      holder.scale.setScalar(size);
      const inst = ship.root.clone(true);
      inst.scale.setScalar(k);
      inst.position.copy(centre).multiplyScalar(-k);
      holder.add(inst);
      g.add(holder);
    }
  }

  cycleCamera(): void {
    this.setShot(this.shot + 1);
  }

  cameraLabel(): string {
    const s = this.shots[this.shot];
    const extra = s.lineup === 'sheet' && this.sheetShip ? ` · ${BLUEPRINTS[this.sheetShip].designation} ${BLUEPRINTS[this.sheetShip].name.toUpperCase()}` : '';
    return `CAM ${this.shot + 1} · ${s.name}${extra}`;
  }

  setShot(i: number): void {
    this.shot = ((i % this.shots.length) + this.shots.length) % this.shots.length;
    const active = this.shots[this.shot].lineup;
    for (const [l, g] of this.groups) g.visible = l === active;
  }

  update({ time }: FrameContext): void {
    const shot = this.shots[this.shot];

    if (shot.lineup === 'sheet') {
      const id = this.sheetFixed ?? this.sheetIds[Math.floor(time / 6) % this.sheetIds.length];
      this.showSheet(id);
    }

    // Variable-geometry sequence: each Kestrel a quarter-cycle behind the next.
    this.sweepers.forEach((k, i) => {
      const [sw, fo] = sweepCycle(time / 12 + i * 0.22);
      k.setWingSweep(sw);
      k.setWingFold(fo);
      k.setThrottle(0.5 + 0.5 * (1 - fo));
    });

    for (const r of this.radars) {
      if (r.articulations.has('radar')) r.setArticulation('radar', time * 1.4);
    }
    for (const p of this.placed) {
      if (p.lineup === 'fighters' || p.lineup === 'strike') {
        p.ship.setThrottle(0.8 + Math.sin(time * 6.3 + p.ship.root.position.x) * 0.06);
      }
    }
    if (this.launcher) {
      // Catapult run down the deck, then off the bow and climbing out past the camera.
      const u = ((time + 6) * 0.1) % 1;
      const z = 380 + 900 * u;
      const off = Math.max(0, z - 700);
      const k = this.launcher.root;
      k.position.set(55 - off * 0.5, 104.3 + off * 0.2, z);
      k.rotation.set(off > 0 ? -0.18 : 0, off > 0 ? -0.46 : 0, off > 0 ? 0.3 : 0, 'YXZ');
      this.launcher.setWingSweep(off > 0 ? 0.35 : 0.05);
    }

    const [pos, target] = shot.frame(time);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    if (this.camera.fov !== shot.fov) {
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
    }
    this.backdrop.follow(this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
