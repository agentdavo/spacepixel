import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import { WorldSpace } from '@/core/WorldSpace';
import { flags as appFlags } from '@/core/Flags';
import { assets } from '@/assets/AssetLibrary';
import type { ShipModel } from '@/assets/ShipBuilder';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import { postFx } from '@/render/post/PostFx';
import type { SetPieceKind, SetPieceSpec } from '@/game/campaign/types';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { createSetPiece, type SetPiece, type SetPieceFrame } from '../setpieces';

/**
 * Set-piece test bed: `?scene=setpieces&piece=<kind>&cam=<n>&t=<s>`.
 *
 *   piece   derelict | blackbox | monolith | megagate | nebula | bastion |
 *           wreckage | beacon | pilgrimage
 *   cam     camera shot index (key C cycles)
 *   t       start time; pieces with a scripted timeline (pilgrimage, bastion
 *           attack, gate awakening) are seeked to it
 *   flag    comma-separated story flags set at start (e.g. nexus-awake,
 *           bastion-attack, oracle-broadcast)
 *   p.<k>   any set-piece param, e.g. p.radius=900000&p.state=awake
 *   ref=0   hide the Kestrel scale reference
 *
 * Everything sits ~2 700 km from the universe origin so float precision is
 * exercised exactly as in flight.
 */
const ORIGIN = new Vector3(2_400_000, 150_000, -1_100_000);

interface Shot {
  name: string;
  fov: number;
  /** Eye and look target relative to the anchor (metres), may animate with t. */
  eye: (t: number, o: Vector3) => Vector3;
  look: (t: number, o: Vector3) => Vector3;
  /** Where the "player" is (relative to anchor). Defaults to the eye. */
  player?: (t: number, o: Vector3) => Vector3;
  /** Kestrel scale reference, relative to the anchor. */
  ref?: (t: number, o: Vector3) => Vector3;
}

const key = LIGHT_PRESETS.meridian.keyDirection.clone().normalize();
const side = new Vector3(0, 1, 0).cross(key).normalize();
const upk = new Vector3().crossVectors(key, side).normalize();
/** Direction from the centre with a given cosine to the key light, rotated `az` around it. */
function aroundKey(cosK: number, az: number, out: Vector3): Vector3 {
  const s = Math.sqrt(1 - cosK * cosK);
  return out
    .copy(key)
    .multiplyScalar(cosK)
    .addScaledVector(side, Math.cos(az) * s)
    .addScaledVector(upk, Math.sin(az) * s)
    .normalize();
}

const tmpA = new Vector3();
const MONO_R = 1_400_000;

const SHOTS: Record<SetPieceKind, Shot[]> = {
  monolith: [
    {
      name: 'SKY · 9 000 km',
      fov: 55,
      eye: (_t, o) => aroundKey(-0.15, 0.9, o).multiplyScalar(9_000_000),
      look: (_t, o) => o.set(0, 0, 0).addScaledVector(side, 1.4e6),
      ref: (_t, o) => aroundKey(-0.15, 0.9, o).multiplyScalar(9_000_000 - 70).addScaledVector(side, 26).addScaledVector(upk, -9),
    },
    {
      name: 'ECLIPSE · 40 000 km',
      fov: 40,
      eye: (_t, o) => aroundKey(-0.72, 2.2, o).multiplyScalar(40_000_000),
      look: (_t, o) => o.set(0, 0, 0),
    },
    {
      name: 'SKIM · 60 km',
      fov: 60,
      eye: (t, o) => aroundKey(0.45, 0.4, o).multiplyScalar(MONO_R + 60_000).addScaledVector(side, t * 900),
      look: (_t, o) => aroundKey(0.45, 0.4, tmpA).multiplyScalar(MONO_R - 40_000).add(aroundKey(0.1, 2.0, o).multiplyScalar(900_000)),
      ref: (t, o) => aroundKey(0.45, 0.4, o).multiplyScalar(MONO_R + 60_000 - 14).addScaledVector(side, t * 900 + 60),
    },
    {
      name: 'CONTACT · 8 km',
      fov: 58,
      eye: (_t, o) => aroundKey(0.6, 1.2, o).multiplyScalar(MONO_R + 8_000),
      look: (_t, o) => aroundKey(0.6, 1.2, tmpA).multiplyScalar(MONO_R).add(aroundKey(0.0, 1.2, o).multiplyScalar(60_000)),
      ref: (_t, o) => aroundKey(0.6, 1.2, o).multiplyScalar(MONO_R + 8_000 - 20).add(aroundKey(0.0, 1.2, tmpA).multiplyScalar(80)),
    },
  ],
  derelict: [
    { name: 'DERELICT · WIDE', fov: 45, eye: (t, o) => o.set(2600 + t * 4, 700, 2300), look: (_t, o) => o.set(0, 0, 0) },
    { name: 'DERELICT · BREACH', fov: 50, eye: (_t, o) => o.set(620, 180, 260), look: (_t, o) => o.set(0, 0, 60), ref: (_t, o) => o.set(560, 150, 230) },
    { name: 'DERELICT · IN THE BELT', fov: 60, eye: (_t, o) => o.set(-900, 260, -1200), look: (_t, o) => o.set(0, 0, -200) },
  ],
  blackbox: [
    { name: 'BLACKBOX · CLOSE', fov: 40, eye: (_t, o) => o.set(9, 3, 12), look: (_t, o) => o.set(0, 0, 0), player: (_t, o) => o.set(0, 400, 0) },
    { name: 'BLACKBOX · 2 km', fov: 50, eye: (_t, o) => o.set(900, 300, 1800), look: (_t, o) => o.set(0, 0, 0) },
  ],
  megagate: [
    { name: 'NEXUS · APPROACH', fov: 50, eye: (t, o) => o.set(-38_000 + t * 30, 9_000, 52_000), look: (_t, o) => o.set(2_000, 0, 0) },
    { name: 'NEXUS · FACE', fov: 55, eye: (_t, o) => o.set(4_000, -3_000, 38_000), look: (_t, o) => o.set(0, 0, 0) },
    {
      name: 'NEXUS · RING',
      fov: 60,
      eye: (_t, o) => o.set(15_200, 2_600, 6_500),
      look: (_t, o) => o.set(0, 0, 0),
      ref: (_t, o) => o.set(15_140, 2_585, 6_450),
    },
    { name: 'NEXUS · THRESHOLD', fov: 65, eye: (_t, o) => o.set(900, 400, 4_500), look: (_t, o) => o.set(0, 0, -20_000) },
  ],
  nebula: [
    { name: 'NEBULA · OUTSIDE', fov: 55, eye: (_t, o) => o.set(20_000, 12_000, 105_000), look: (_t, o) => o.set(0, 0, 0) },
    { name: 'NEBULA · INSIDE', fov: 60, eye: (t, o) => o.set(4_000, 1_000, 9_000 - t * 120), look: (t, o) => o.set(3_000, 800, -9_000 - t * 120), ref: (t, o) => o.set(3_985, 994, 8_950 - t * 120) },
    { name: 'NEBULA · EDGE', fov: 55, eye: (_t, o) => o.set(0, 3_000, 43_000), look: (_t, o) => o.set(0, 0, 0) },
  ],
  bastion: [
    { name: 'BASTION · FLEET', fov: 45, eye: (t, o) => o.set(-3_400 + t * 6, 900, 3_600), look: (_t, o) => o.set(0, 0, 200) },
    { name: 'BASTION · BROADSIDE', fov: 50, eye: (_t, o) => o.set(2_600, 300, -600), look: (_t, o) => o.set(0, 0, 0) },
  ],
  wreckage: [
    { name: 'WRECKAGE · FIELD', fov: 55, eye: (t, o) => o.set(1_600 + t * 5, 250, 2_200), look: (_t, o) => o.set(0, 0, 0) },
    { name: 'WRECKAGE · INSIDE', fov: 60, eye: (_t, o) => o.set(300, 40, 500), look: (_t, o) => o.set(-500, -60, -400) },
  ],
  beacon: [
    { name: 'BEACON · CLOSE', fov: 45, eye: (_t, o) => o.set(34, 10, 46), look: (_t, o) => o.set(0, 2, 0) },
    { name: 'BEACON · 3 km', fov: 45, eye: (_t, o) => o.set(1_600, 400, 2_600), look: (_t, o) => o.set(0, 0, 0) },
  ],
  pilgrimage: [
    { name: 'PILGRIMAGE', fov: 62, eye: (_t, o) => o.set(0, 0, 0), look: (_t, o) => o.set(0, 0, -1000) },
  ],
};

export class SetPieceScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 16 / 9, 0.5, 1_500_000);
  readonly world = new WorldSpace(this.scene);
  readonly piece: SetPiece;
  readonly storyFlags = new Set<string>();
  private readonly backdrop: Backdrop;
  private readonly kind: SetPieceKind;
  private readonly ref: ShipModel | null;
  private shot = 0;
  private seeked = false;
  private readonly frame: SetPieceFrame;
  private readonly eyeRel = new Vector3();
  private readonly lookRel = new Vector3();
  private readonly look = new Vector3();
  private readonly player = new Vector3();
  private readonly playerPrev = new Vector3();
  private readonly playerVel = new Vector3();

  constructor() {
    const q = new URLSearchParams(window.location.search);
    const kind = (q.get('piece') ?? 'monolith') as SetPieceKind;
    this.kind = SHOTS[kind] ? kind : 'monolith';
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.backdrop = new Backdrop(q.get('sky') === 'hesper' ? BACKDROPS.hesper : BACKDROPS.meridian);
    this.scene.add(this.backdrop.group);

    const params: Record<string, string | number | boolean> = {};
    for (const [k, v] of q) {
      if (!k.startsWith('p.')) continue;
      const n = Number(v);
      params[k.slice(2)] = v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(n) ? n : v;
    }
    for (const f of (q.get('flag') ?? '').split(',')) if (f) this.storyFlags.add(f);

    const spec: SetPieceSpec = { kind: this.kind, tag: q.get('tag') ?? this.kind, place: { at: 'player', offset: [0, 0, 0] }, params };
    this.piece = createSetPiece(spec, ORIGIN.clone());
    this.world.root.add(this.piece.group);

    this.shot = Math.min(appFlags.cam, SHOTS[this.kind].length - 1);
    this.ref = q.get('ref') === '0' ? null : assets.ship('vf27-kestrel');
    if (this.ref) {
      this.ref.setThrottle(0.8);
      this.world.root.add(this.ref.root);
    }
    this.applyFov();

    const self = this;
    this.frame = {
      dt: 0,
      time: 0,
      eye: this.world.eye,
      playerPos: this.player,
      playerVel: this.playerVel,
      flags: this.storyFlags,
      setFlag(f: string) {
        if (self.storyFlags.has(f)) return;
        self.storyFlags.add(f);
        console.info(`[setpieces] flag ${f}`);
      },
      postFx,
      camera: this.camera,
      scene: this.scene,
    };
    window.__VANGUARD__ = {
      ...(window.__VANGUARD__ ?? { ready: false, frame: () => 0, backend: '' }),
      hooks: { ...window.__VANGUARD__?.hooks, setpiece: this.piece, storyFlags: this.storyFlags },
    };
  }

  private applyFov(): void {
    this.camera.fov = SHOTS[this.kind][this.shot].fov;
    this.camera.updateProjectionMatrix();
  }

  update(ctx: FrameContext): void {
    const t = ctx.time;
    const shot = SHOTS[this.kind][this.shot];
    shot.eye(t, this.eyeRel);
    shot.look(t, this.lookRel);
    this.world.eye.copy(this.eyeRel).add(ORIGIN);
    this.look.copy(this.lookRel).add(ORIGIN);
    if (shot.player) shot.player(t, this.player).add(ORIGIN);
    else this.player.copy(this.world.eye);
    if (ctx.dt > 0) this.playerVel.subVectors(this.player, this.playerPrev).divideScalar(ctx.dt);
    this.playerPrev.copy(this.player);

    if (this.ref) {
      if (shot.ref) {
        this.ref.root.visible = true;
        shot.ref(t, this.ref.root.position).add(ORIGIN);
        this.ref.root.lookAt(this.look);
      } else this.ref.root.visible = false;
    }

    // Host-owned postFx (as FlightScene does): flash decays, jump resets.
    postFx.flash = Math.max(0, postFx.flash - ctx.dt * 2);
    postFx.jump = 0;
    postFx.boost = 0;
    postFx.speed = 0;

    this.world.sync(this.camera);
    this.world.toRender(this.look, this.look);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
    this.backdrop.follow(this.camera);

    const f = this.frame;
    f.dt = ctx.dt;
    f.time = t;
    if (!this.seeked) {
      this.seeked = true;
      this.piece.update(f);
      if (this.piece.debugSeek && t > 0) this.piece.debugSeek(t);
    }
    this.piece.update(f);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cycleCamera(): void {
    this.shot = (this.shot + 1) % SHOTS[this.kind].length;
    this.applyFov();
  }

  cameraLabel(): string {
    const p = this.piece as SetPiece & { scanProgress?: number; progress?: number };
    const extra = p.scanProgress !== undefined ? ` · scan ${(p.scanProgress * 100).toFixed(0)}%` : p.progress !== undefined ? ` · ${(p.progress * 100).toFixed(0)}%` : '';
    return `SET PIECE · ${SHOTS[this.kind][this.shot].name}${extra} · ${[...this.storyFlags].join(' ')}`;
  }
}
