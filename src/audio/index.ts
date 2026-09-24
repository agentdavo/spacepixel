import { AudioEngine, type AudioEngineOptions, type BusName } from './AudioEngine';
import { Sfx, type CruiseState, type Faction, type JumpPhase, type PlayOpts, type QuatLike, type RadioKind, type SfxKind, type UiKind, type Vec3Like } from './Sfx';
import { Music, MOODS, type Mood, type StingerKind } from './Music';

export { AudioEngine, Sfx, Music, MOODS };
export type { BusName, CruiseState, Faction, JumpPhase, Mood, PlayOpts, QuatLike, RadioKind, SfxKind, StingerKind, UiKind, Vec3Like };

/**
 * The one audio entry point for scenes.
 *
 *   const audio = getAudio();            // shared, survives scene switches
 *   audio.music.setMood('cruise');
 *   // every frame, after weapons.step() / missiles.step():
 *   audio.update(frame);
 *
 * Structural event types: `WeaponEvent` / `MissileEvent` / `ShipEntity` from
 * src/sim satisfy these directly, so the scene passes its arrays as-is.
 */
export interface AudioShip {
  readonly isPlayer: boolean;
  readonly faction: string;
  /** Collision radius (m) — > 60 counts as a capital-size kill. */
  readonly radius: number;
}

export interface AudioWeaponEvent {
  readonly kind: 'hit' | 'shield' | 'kill' | 'fire' | 'beam-hit' | 'subsystem' | 'shield-down' | 'shield-up';
  readonly position: Vec3Like;
  readonly ship: AudioShip | null;
  readonly shooter: AudioShip | null;
  /** Weapon family voice (src/sim/Loadouts.ts GunSpec): 'laser' | 'cannon', with a faction timbre. */
  readonly gun?: { readonly sfx: 'laser' | 'cannon'; readonly timbre: string } | null;
}

export interface AudioMissileEvent {
  readonly kind: 'launch' | 'detonate' | 'expire';
  readonly position: Vec3Like;
  readonly target: AudioShip | null;
  readonly shooter: AudioShip | null;
}

export interface AudioPlayerState {
  position: Vec3Like;
  velocity: Vec3Like;
  /** 0..1 */
  throttle: number;
  boosting: boolean;
  cruise: CruiseState;
  /** 0..1 lock accumulation on the current target. */
  lockProgress: number;
  locked: boolean;
  /** A hostile missile is homing on the player. */
  incomingMissile: boolean;
  /** Default true; false fades the engine loops. */
  alive?: boolean;
}

export interface AudioFrame {
  dt: number;
  /** world.eye — the camera's universe position. */
  eye: Vec3Like;
  /** camera.quaternion, for stereo panning (optional; without it events are centred). */
  camera?: QuatLike | null;
  player: AudioPlayerState;
  weaponEvents: readonly AudioWeaponEvent[];
  missileEvents: readonly AudioMissileEvent[];
  jumpPhase: JumpPhase;
  /** 0..1 — how hot the fight is (drives music layers + auto cruise↔combat). */
  combatIntensity: number;
}

// Per-frame budgets (the pool caps total voices; these keep one frame from hogging it).
const MAX_REMOTE_FIRE = 3;
const MAX_HITS = 3;
const MAX_KILLS = 4;
const MAX_DETONATIONS = 3;
const CAPITAL_RADIUS = 60;

/** Keeps the indices of the N highest-scoring items seen since reset(). */
class TopK {
  readonly idx: Int32Array;
  private score: Float32Array;
  constructor(n: number) {
    this.idx = new Int32Array(n).fill(-1);
    this.score = new Float32Array(n);
  }
  reset(): void {
    this.idx.fill(-1);
    this.score.fill(0);
  }
  consider(i: number, s: number): void {
    if (s < 0.015) return;
    let worst = 0;
    for (let k = 1; k < this.idx.length; k++) if (this.score[k] < this.score[worst]) worst = k;
    if (s > this.score[worst]) {
      this.score[worst] = s;
      this.idx[worst] = i;
    }
  }
}

function factionOf(s: AudioShip | null): Faction {
  const f = s?.faction;
  return f === 'choir' || f === 'rustwake' ? f : 'concord';
}

/** Gun timbre, else the shooter's faction. */
function timbreOf(ev: AudioWeaponEvent): Faction {
  const t = ev.gun?.timbre;
  return t === 'choir' || t === 'rustwake' || t === 'concord' ? t : factionOf(ev.shooter);
}

export class GameAudio {
  readonly engine: AudioEngine;
  readonly sfx: Sfx;
  readonly music: Music;
  /**
   * When the current mood is 'cruise' or 'combat', switch between them from
   * `combatIntensity` (hot > 0.3 for 0.4 s → combat; calm < 0.08 for 10 s → cruise).
   * Never overrides title/briefing/sublime/dread/victory/defeat.
   */
  autoMood = true;

  private lastPlayerFire = -1;
  private lastRemoteFire = -1;
  private lastPlayerHit = -1;
  private lastBeam = -1;
  private lastPlayerLaunch = -1;
  private lastRemoteLaunch = -1;
  private lastDetonate = -1;
  private fireSide = 1;
  private launchSide = 1;
  private hotT = 0;
  private calmT = 0;
  // Per-frame "loudest N" pickers (allocation-free).
  private topFire = new TopK(MAX_REMOTE_FIRE);
  private topHit = new TopK(MAX_HITS);
  private topKill = new TopK(MAX_KILLS);

  constructor(opts: AudioEngineOptions = {}) {
    this.engine = new AudioEngine(opts);
    this.sfx = new Sfx(this.engine);
    this.music = new Music(this.engine);
  }

  /** Context created and running (false before the first gesture, or if Web Audio is blocked). */
  get running(): boolean {
    return this.engine.running;
  }

  /** Call from a click/key handler to start audio explicitly (the engine also listens itself). */
  unlock(): void {
    this.engine.unlock();
  }

  setMuted(m: boolean): void {
    this.engine.setMuted(m);
  }

  toggleMute(): boolean {
    this.engine.setMuted(!this.engine.muted);
    return this.engine.muted;
  }

  get muted(): boolean {
    return this.engine.muted;
  }

  setVolume(bus: BusName, v: number): void {
    this.engine.setVolume(bus, v);
  }

  ui(kind: UiKind): void {
    this.sfx.ui(kind);
  }

  radio(kind: RadioKind): void {
    this.sfx.radio(kind);
  }

  stinger(kind: StingerKind): void {
    this.music.stinger(kind);
  }

  /** Spatial one-shot (for set pieces / scripted events). */
  playAt(kind: SfxKind, pos: Vec3Like, eye: Vec3Like, opts?: PlayOpts): void {
    this.sfx.playAt(kind, pos, eye, opts);
  }

  /** Per-frame: loops, alerts, jump, weapon/missile events, music. Allocation-free. */
  update(f: AudioFrame): void {
    const e = this.engine;
    if (!e.running) return;
    const sfx = this.sfx;
    const p = f.player;
    const dt = f.dt;
    sfx.setListener(f.camera);
    const v = p.velocity;
    sfx.updateShip(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z), p.throttle, p.boosting, p.cruise, p.alive ?? true, dt);
    sfx.updateAlerts(p.lockProgress, p.locked, p.incomingMissile, dt);
    sfx.setJumpPhase(f.jumpPhase);
    this.weaponEvents(f.weaponEvents, f.eye, e.now);
    this.missileEvents(f.missileEvents, f.eye, e.now);

    const ci = f.combatIntensity;
    this.music.setIntensity(ci);
    const mood = this.music.mood;
    if (this.autoMood && (mood === 'cruise' || mood === 'combat')) {
      if (ci > 0.3) {
        this.calmT = 0;
        this.hotT += dt;
        if (mood === 'cruise' && this.hotT > 0.4) this.music.setMood('combat', 1.5);
      } else if (ci < 0.08) {
        this.hotT = 0;
        this.calmT += dt;
        if (mood === 'combat' && this.calmT > 10) this.music.setMood('cruise', 5);
      } else {
        this.hotT = 0;
        this.calmT = 0;
      }
    }
    this.music.pump();
  }

  private weaponEvents(events: readonly AudioWeaponEvent[], eye: Vec3Like, now: number): void {
    const sfx = this.sfx;
    const fire = this.topFire;
    const hit = this.topHit;
    const kill = this.topKill;
    fire.reset();
    hit.reset();
    kill.reset();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.kind) {
        case 'fire':
          if (ev.shooter?.isPlayer) {
            if (now - this.lastPlayerFire < 0.03) break;
            this.lastPlayerFire = now;
            this.fireSide = -this.fireSide;
            sfx.playRaw(ev.gun?.sfx ?? 'laser', 0.75, 0.12 * this.fireSide, timbreOf(ev), 5);
          } else fire.consider(i, sfx.audibility('laser', ev.position, eye));
          break;
        case 'hit':
        case 'shield':
          if (ev.ship?.isPlayer) {
            if (now - this.lastPlayerHit < 0.065) break;
            this.lastPlayerHit = now;
            if (ev.kind === 'hit') sfx.playAtRaw('playerHit', ev.position, eye, 1);
            else sfx.playAtRaw('shieldHit', ev.position, eye, 1, 'concord', 6);
          } else hit.consider(i, sfx.audibility('hullHit', ev.position, eye));
          break;
        case 'beam-hit':
          if (now - this.lastBeam < 0.09) break;
          this.lastBeam = now;
          sfx.playAtRaw('beamHit', ev.position, eye, 0.8);
          break;
        case 'subsystem':
          sfx.playAtRaw('explosionLarge', ev.position, eye, 0.7);
          break;
        case 'shield-down':
          sfx.playAtRaw('shieldDown', ev.position, eye, ev.ship?.isPlayer ? 1 : 0.8);
          break;
        case 'kill':
          if (ev.ship?.isPlayer) sfx.playAtRaw('explosionSmall', ev.position, eye, 1.2, 'concord', 8);
          else kill.consider(i, sfx.audibility(ev.ship && ev.ship.radius > CAPITAL_RADIUS ? 'explosionLarge' : 'explosionSmall', ev.position, eye));
          break;
      }
    }
    // Only the most audible few of each class per frame.
    for (let k = 0; k < kill.idx.length; k++) {
      const i = kill.idx[k];
      if (i < 0) continue;
      const ev = events[i];
      if (ev.ship && ev.ship.radius > CAPITAL_RADIUS) sfx.playAtRaw('explosionLarge', ev.position, eye, 1);
      else sfx.playAtRaw('explosionSmall', ev.position, eye, 0.9);
    }
    for (let k = 0; k < hit.idx.length; k++) {
      const i = hit.idx[k];
      if (i < 0) continue;
      const ev = events[i];
      if (ev.kind === 'shield') sfx.playAtRaw('shieldHit', ev.position, eye, 0.75);
      else sfx.playAtRaw('hullHit', ev.position, eye, 0.8);
    }
    if (now - this.lastRemoteFire < 0.02) return;
    for (let k = 0; k < fire.idx.length; k++) {
      const i = fire.idx[k];
      if (i < 0) continue;
      this.lastRemoteFire = now;
      sfx.playAtRaw(events[i].gun?.sfx ?? 'laser', events[i].position, eye, 0.6, timbreOf(events[i]));
    }
  }

  private missileEvents(events: readonly AudioMissileEvent[], eye: Vec3Like, now: number): void {
    const sfx = this.sfx;
    let det = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind === 'launch') {
        if (ev.shooter?.isPlayer) {
          sfx.swarmPulse(0.45);
          if (now - this.lastPlayerLaunch < 0.07) continue;
          this.lastPlayerLaunch = now;
          this.launchSide = -this.launchSide;
          sfx.playRaw('missileLaunch', 0.7, 0.3 * this.launchSide, 'concord', 4);
        } else {
          const g = sfx.audibility('missileLaunch', ev.position, eye);
          sfx.swarmPulse(g * 0.35);
          if (g < 0.05 || now - this.lastRemoteLaunch < 0.09) continue;
          this.lastRemoteLaunch = now;
          sfx.playAtRaw('missileLaunch', ev.position, eye, 0.55);
        }
      } else if (ev.kind === 'detonate') {
        if (ev.target?.isPlayer) sfx.playAtRaw('playerHit', ev.position, eye, 1);
        if (det >= MAX_DETONATIONS || now - this.lastDetonate < 0.025) continue;
        det++;
        this.lastDetonate = now;
        sfx.playAtRaw('missileHit', ev.position, eye, 0.8);
      }
    }
  }

  dispose(): void {
    this.music.dispose();
    this.engine.dispose();
  }
}

/**
 * Heuristic `combatIntensity` (0..1) from what a scene already knows:
 * distance to the nearest living hostile (m), hostiles within ~3 km, and
 * seconds since the player last took damage (ShipEntity.sinceHit).
 */
export function combatIntensity(nearestHostile: number, hostilesNear: number, sinceHit: number): number {
  const prox = nearestHostile <= 400 ? 1 : nearestHostile >= 4000 ? 0 : 1 - (nearestHostile - 400) / 3600;
  const crowd = hostilesNear >= 4 ? 1 : hostilesNear / 4;
  const hurt = sinceHit < 4 ? 1 - sinceHit / 4 : 0;
  const v = prox * 0.6 + crowd * 0.25 + hurt * 0.3;
  return v > 1 ? 1 : v;
}

let shared: GameAudio | null = null;

/** The app-wide audio instance (lazy; the AudioContext itself waits for the first gesture). */
export function getAudio(): GameAudio {
  if (!shared) shared = new GameAudio();
  return shared;
}
