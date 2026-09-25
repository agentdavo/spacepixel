import { AudioEngine, type AudioEngineOptions, type BusName } from './AudioEngine';
import { Sfx, type BeamSound, type CruiseState, type Faction, type JumpPhase, type PlayOpts, type QuatLike, type RadioKind, type SfxKind, type UiKind, type Vec3Like } from './Sfx';
import { Music, MOODS, type Mood, type StingerKind } from './Music';
import { SCORE_IDS, SCORE_INFO, scoreFor, type ScoreId, type ScorePick } from './score/catalog';
import { installSettingsKeys, onSettings, setSettings, setSoundtrackProbe, settings } from '@/game/Settings';
import { installAudioSettings } from '@/ui/AudioSettings';

export { AudioEngine, Sfx, Music, MOODS, SCORE_IDS, SCORE_INFO, scoreFor };
export type { BusName, CruiseState, Faction, JumpPhase, Mood, PlayOpts, QuatLike, RadioKind, ScoreId, ScorePick, SfxKind, StingerKind, UiKind, Vec3Like };

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
  readonly kind: 'hit' | 'shield' | 'kill' | 'fire' | 'beam-hit' | 'subsystem' | 'shield-down' | 'shield-up' | 'shield-bleed' | 'reactor-critical' | 'reactor-vented';
  readonly position: Vec3Like;
  readonly ship: AudioShip | null;
  readonly shooter: AudioShip | null;
  /** Weapon family voice (src/sim/Loadouts.ts GunSpec): 'laser' | 'cannon', with a faction timbre. */
  readonly gun?: { readonly id?: string; readonly sound?: string; readonly sfx: 'laser' | 'cannon'; readonly timbre: string } | null;
  readonly amount?: number;
  readonly hullDamage?: number;
  readonly shieldDamage?: number;
  /** Damage type of an impact (hit, shield, beam-hit): picks the hull sound. */
  readonly type?: 'kinetic' | 'laser' | 'harmonic' | 'explosive';
  /** beam-hit on a shield rather than plating. */
  readonly shielded?: boolean;
  /** Facing charge after the event, 0..1 (−1 n/a): a failing facing rings thinner. */
  readonly strength?: number;
  /** Destroyed subsystem ('subsystem'). */
  readonly sub?: { readonly kind: string } | null;
  /** fire: a turret mount's shot, not the pilot's guns. */
  readonly turret?: boolean;
  /** kill: how a big hull died — 'hull' · 'structural' (break-up) · 'reactor' (detonation) · 'bridge' (she struck). */
  readonly cause?: 'hull' | 'structural' | 'reactor' | 'bridge' | null;
}

/** The hull sound for a hit of damage type `type`. */
function hullSound(type: AudioWeaponEvent['type']): SfxKind {
  return type === 'laser' || type === 'harmonic' ? 'hullScorch' : type === 'explosive' ? 'hullCrunch' : 'hullHit';
}

export interface AudioMissileEvent {
  readonly kind: 'launch' | 'detonate' | 'expire';
  readonly position: Vec3Like;
  readonly target: AudioShip | null;
  readonly shooter: AudioShip | null;
  readonly intercepted?: boolean;
  readonly shielded?: boolean;
  readonly hullDamage?: number;
  readonly shieldDamage?: number;
  readonly spec?: { readonly id: string; readonly damage?: number };
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
  beams?: readonly BeamSound[];
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
  private lastBleed = -1;
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
  private topBeam = new TopK(3);
  private topBleed = new TopK(2);
  private topDetonate = new TopK(MAX_DETONATIONS);
  private topLaunch = new TopK(3);
  // Where the player is, for the soundtrack (see setPlace).
  private placeSystem: string | null = null;
  private placeFaction: string | null = null;
  private placeEpisode = 0;
  private placeSetting = '';
  private offSettings: (() => void) | null = null;
  /** The last soundtrack decision (for HUD / audio test readouts). */
  pick: ScorePick = { id: 'classic', variant: 0, reason: 'default' };

  constructor(opts: AudioEngineOptions = {}) {
    this.engine = new AudioEngine(opts);
    this.sfx = new Sfx(this.engine);
    this.music = new Music(this.engine);
    // Live renders follow the player's soundtrack setting; offline renders pick scores explicitly.
    if (this.engine.live) {
      this.offSettings = onSettings(() => {
        this.applyAudioSettings();
        if (settings.soundtrack !== this.placeSetting) this.applyPlace(3);
      });
      this.applyAudioSettings();
      installAudioSettings(this);
      setSoundtrackProbe(() => SCORE_INFO[this.pick.id].title);
      // Shift+F7 must work wherever there is music, not only once a subtitle/comms UI exists.
      installSettingsKeys();
    }
  }

  private applyAudioSettings(): void {
    const a = settings.audio;
    this.engine.setVolume('master', a.master); this.engine.setVolume('music', a.music);
    this.engine.setVolume('sfx', a.effects); this.engine.setVolume('voice', a.dialogue);
    this.engine.setDynamicRange(a.range);
    if (this.engine.requestedOutput !== a.output) void this.engine.setOutputMode(a.output);
  }

  /**
   * Tell the soundtrack where the player is. Cheap to call every frame: it
   * only re-orchestrates when the system, faction, episode or the player's
   * soundtrack setting changes. Resolution: pinned soundtrack → episode →
   * special system → faction (src/audio/score/catalog.ts).
   */
  setPlace(system: string | null, faction?: string | null, episode?: number | null, fade = 4): void {
    const ep = episode ?? 0;
    if (system === this.placeSystem && (faction ?? null) === this.placeFaction && ep === this.placeEpisode && settings.soundtrack === this.placeSetting) return;
    this.placeSystem = system;
    this.placeFaction = faction ?? null;
    this.placeEpisode = ep;
    this.applyPlace(fade);
  }

  /** Pin a score directly (audio test scene, captures). `null` returns to setPlace's choice. */
  setScore(id: ScoreId | null, variant = 0, fade = 2): void {
    if (id === null) return this.applyPlace(fade);
    this.pick = { id, variant, reason: 'user' };
    this.music.setScore(id, variant, fade);
  }

  private applyPlace(fade: number): void {
    this.placeSetting = settings.soundtrack;
    this.pick = scoreFor({ system: this.placeSystem, faction: this.placeFaction, episode: this.placeEpisode || null }, settings.soundtrack);
    this.music.setScore(this.pick.id, this.pick.variant, fade);
  }

  /** "Castellan Fleet March · 艦隊行進曲" for the current score. */
  get scoreLabel(): string {
    const i = SCORE_INFO[this.music.score];
    return `${i.title} · ${i.jp}`;
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
    if (this.engine.live) setSettings({ audio: { ...settings.audio, [bus === 'sfx' ? 'effects' : bus === 'voice' ? 'dialogue' : bus]: v } });
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
    sfx.updateBeams(f.beams ?? [], f.eye);

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
    this.topBeam.reset();
    this.topBleed.reset();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.kind) {
        case 'fire':
          if (ev.shooter?.isPlayer && !ev.turret) {
            if (now - this.lastPlayerFire < 0.03) break;
            this.lastPlayerFire = now;
            this.fireSide = -this.fireSide;
            if (ev.gun?.id) sfx.weapon(ev.gun.sound ?? ev.gun.id, ev.position, eye, 0.8, true, 0.12 * this.fireSide);
            else sfx.playRaw(ev.gun?.sfx ?? 'laser', 0.75, 0.12 * this.fireSide, timbreOf(ev), 5);
          } else fire.consider(i, sfx.audibility(ev.gun?.sound === 'capital-lance' ? 'explosionLarge' : 'laser', ev.position, eye));
          break;
        case 'hit':
        case 'shield':
          if (ev.ship?.isPlayer) {
            if (now - this.lastPlayerHit < 0.065) break;
            this.lastPlayerHit = now;
            this.impactEvent(ev, eye);
          } else hit.consider(i, sfx.audibility('hullHit', ev.position, eye));
          break;
        case 'beam-hit':
          this.topBeam.consider(i, ev.ship?.isPlayer ? 10 : sfx.audibility('beamHit', ev.position, eye));
          break;
        case 'subsystem': {
          // Mounts shear off; generators take their facing's shell with them; hangars, engines and bridges go up.
          const k = ev.sub?.kind;
          if (k === 'shieldGen' || k === 'shieldEmitter') sfx.playAtRaw('shieldDown', ev.position, eye, 0.7);
          if (k === 'hangar' || k === 'engine' || k === 'bridge' || k === 'reactor') sfx.playAtRaw('explosionLarge', ev.position, eye, 0.8);
          sfx.playAtRaw('mountBlast', ev.position, eye, ev.ship?.isPlayer ? 1 : 0.85);
          break;
        }
        case 'shield-down':
          if (ev.ship?.isPlayer) sfx.playRaw('shieldDown', 0.85, 0, 'concord', 8);
          else sfx.playAtRaw('shieldDown', ev.position, eye, 0.8);
          break;
        case 'shield-up':
          if (ev.ship?.isPlayer) sfx.playRaw('shieldUp', 0.65, 0, 'concord', 7);
          else sfx.playAtRaw('shieldUp', ev.position, eye, 0.6);
          break;
        case 'shield-bleed':
          // A normal hit with explicit hull damage already supplies this layer.
          if (!events.some(other => other !== ev && other.ship === ev.ship && (other.kind === 'shield' || other.kind === 'beam-hit') && (other.hullDamage ?? 0) > 0))
            this.topBleed.consider(i, ev.ship?.isPlayer ? 10 : sfx.audibility(hullSound(ev.type), ev.position, eye));
          break;
        case 'reactor-critical':
          // The core breached: containment failing (a falling whine) under a hard crack.
          sfx.playAtRaw('shieldDown', ev.position, eye, 1);
          sfx.playAtRaw('mountBlast', ev.position, eye, 0.9);
          break;
        case 'reactor-vented':
          // The crew dumps the core: a long hiss of plasma let out, then quiet.
          sfx.playAtRaw('shieldUp', ev.position, eye, 0.6);
          break;
        case 'kill':
          if (ev.ship?.isPlayer) sfx.playAtRaw('explosionSmall', ev.position, eye, 1.2, 'concord', 8);
          else if (ev.cause === 'reactor') {
            // Detonation: the big one, twice over, and the shock front's crack.
            sfx.playAtRaw('explosionLarge', ev.position, eye, 1.3);
            sfx.playAtRaw('explosionLarge', ev.position, eye, 1);
            sfx.playAtRaw('shieldDown', ev.position, eye, 0.9);
          } else if (ev.cause === 'structural') {
            // Break-up: the spine tears, then the fire takes the break.
            sfx.playAtRaw('hullCrunch', ev.position, eye, 1.2);
            sfx.playAtRaw('explosionLarge', ev.position, eye, 0.9);
          } else if (ev.cause === 'bridge') {
            // Struck: one last pop on the command deck, then the hull goes dark and silent.
            sfx.playAtRaw('mountBlast', ev.position, eye, 0.9);
          } else kill.consider(i, sfx.audibility(ev.ship && ev.ship.radius > CAPITAL_RADIUS ? 'explosionLarge' : 'explosionSmall', ev.position, eye));
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
      // A failing facing (low charge) rings thinner; plating answers by damage type.
      this.impactEvent(ev, eye);
    }
    if (now - this.lastBeam >= 0.09) {
      for (const i of this.topBeam.idx) if (i >= 0) { this.impactEvent(events[i], eye, 0.6); this.lastBeam = now; }
    }
    if (now - this.lastBleed >= 0.12) {
      for (const i of this.topBleed.idx) if (i >= 0) {
        const ev = events[i];
        sfx.impact(false, ev.position, eye, { type: ev.type, radius: ev.ship?.radius }, !!ev.ship?.isPlayer, 0.45);
        this.lastBleed = now;
      }
    }
    if (now - this.lastRemoteFire < 0.02) return;
    for (let k = 0; k < fire.idx.length; k++) {
      const i = fire.idx[k];
      if (i < 0) continue;
      this.lastRemoteFire = now;
      const ev = events[i];
      if (ev.gun?.id) sfx.weapon(ev.gun.sound ?? ev.gun.id, ev.position, eye, 0.65);
      else sfx.playAtRaw(ev.gun?.sfx ?? 'laser', ev.position, eye, 0.6, timbreOf(ev));
    }
  }

  private impactEvent(ev: AudioWeaponEvent, eye: Vec3Like, gain = 0.8): void {
    const shield = ev.kind === 'shield' || !!ev.shielded;
    const voice = { type: ev.type, amount: ev.amount, strength: ev.strength, radius: ev.ship?.radius, faction: ev.ship?.faction };
    this.sfx.impact(shield, ev.position, eye, voice, !!ev.ship?.isPlayer, gain);
    if (shield && (ev.hullDamage ?? 0) > 0) this.sfx.impact(false, ev.position, eye, voice, !!ev.ship?.isPlayer, gain * 0.65);
  }

  private missileEvents(events: readonly AudioMissileEvent[], eye: Vec3Like, now: number): void {
    const sfx = this.sfx;
    this.topDetonate.reset();
    this.topLaunch.reset();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind === 'launch') {
        if (ev.shooter?.isPlayer) {
          sfx.swarmPulse(0.45);
          if (now - this.lastPlayerLaunch < 0.07) continue;
          this.lastPlayerLaunch = now;
          this.launchSide = -this.launchSide;
          sfx.warhead(ev.spec?.id, true, false, ev.position, eye, true, 0.3 * this.launchSide);
        } else {
          const g = sfx.audibility('missileLaunch', ev.position, eye);
          sfx.swarmPulse(g * 0.35);
          this.topLaunch.consider(i, g);
        }
      } else if (ev.kind === 'detonate') {
        if (ev.target?.isPlayer && !ev.intercepted && now - this.lastPlayerHit >= 0.065) {
          const voice = { type: 'explosive' as const, amount: ev.spec?.damage, radius: ev.target.radius };
          if (ev.shielded) sfx.impact(true, ev.position, eye, voice, true);
          if ((ev.hullDamage ?? (ev.shielded ? 0 : 1)) > 0) sfx.impact(false, ev.position, eye, voice, true);
          this.lastPlayerHit = now;
        }
        this.topDetonate.consider(i, sfx.audibility(ev.spec?.id === 'torpedo' ? 'explosionLarge' : 'missileHit', ev.position, eye));
      }
    }
    if (now - this.lastRemoteLaunch >= 0.09) for (const i of this.topLaunch.idx) if (i >= 0) {
      const ev = events[i];
      sfx.warhead(ev.spec?.id, true, false, ev.position, eye);
      this.lastRemoteLaunch = now;
    }
    if (now - this.lastDetonate >= 0.025) for (const i of this.topDetonate.idx) if (i >= 0) {
      const ev = events[i];
      sfx.warhead(ev.spec?.id, false, !!ev.intercepted, ev.position, eye);
      if (ev.shielded && !ev.intercepted && !ev.target?.isPlayer) sfx.impact(true, ev.position, eye, { type: 'explosive', amount: ev.spec?.damage, radius: ev.target?.radius }, false, 0.55);
      this.lastDetonate = now;
    }
  }

  dispose(): void {
    this.offSettings?.();
    this.offSettings = null;
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
