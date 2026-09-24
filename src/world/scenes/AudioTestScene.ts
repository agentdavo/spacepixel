import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { FrameContext } from '@/core/Engine';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import {
  getAudio,
  MOODS,
  SCORE_IDS,
  SCORE_INFO,
  type AudioFrame,
  type AudioMissileEvent,
  type AudioShip,
  type AudioWeaponEvent,
  type BusName,
  type JumpPhase,
  type RadioKind,
  type StingerKind,
  type UiKind,
} from '@/audio';

/**
 * `?scene=audio` — test bench for the procedural audio system.
 *
 * A painted sky and a DOM panel: every SFX (routed through the same
 * GameAudio.update() event path the flight scene uses), every music mood in
 * every score (with a place variant), stingers, intensity, bus volumes, and
 * scripted demos (lock-on, Lantern jump,
 * cruise, missile salvo, orbiting gunfire for panning). The listener sits at
 * the universe origin looking down −Z; "left/right" presets pan accordingly.
 */
interface Ev {
  kind: AudioWeaponEvent['kind'];
  position: Vector3;
  ship: AudioShip | null;
  shooter: AudioShip | null;
}
interface MEv {
  kind: AudioMissileEvent['kind'];
  position: Vector3;
  target: AudioShip | null;
  shooter: AudioShip | null;
}

const PLAYER: AudioShip = { isPlayer: true, faction: 'concord', radius: 9 };
const SHIPS: Record<string, AudioShip> = {
  concord: { isPlayer: false, faction: 'concord', radius: 9 },
  choir: { isPlayer: false, faction: 'choir', radius: 8 },
  rustwake: { isPlayer: false, faction: 'rustwake', radius: 8 },
};
const CAPITAL: AudioShip = { isPlayer: false, faction: 'choir', radius: 700 };

const PLACES: Record<string, Vector3> = {
  'near left': new Vector3(-50, 0, -30),
  'near right': new Vector3(50, 0, -30),
  'ahead 300 m': new Vector3(0, 20, -300),
  'behind 80 m': new Vector3(0, 0, 80),
  'far 2 km': new Vector3(800, 200, -1900),
};

const CSS = `
.aud-panel{position:fixed;top:12px;right:12px;bottom:12px;width:min(380px,calc(100vw - 32px));overflow-y:auto;
  background:rgba(8,10,28,.86);border:1px solid #3fd0ff66;color:#cfe3ff;font:12px/1.35 ui-monospace,monospace;
  padding:10px 12px;z-index:50;box-sizing:border-box;pointer-events:auto}
.aud-panel h3{margin:10px 0 4px;font-size:11px;letter-spacing:.12em;color:#ff7a1c;text-transform:uppercase}
.aud-panel button{background:#12183a;color:#cfe3ff;border:1px solid #3fd0ff55;margin:2px;padding:4px 7px;
  font:inherit;cursor:pointer;border-radius:2px}
.aud-panel button:hover{background:#1d2a60}.aud-panel button.on{background:#ff7a1c;color:#10121f}
.aud-panel label{display:flex;gap:6px;align-items:center;margin:2px 0}.aud-panel input[type=range]{flex:1}
.aud-panel select{background:#12183a;color:#cfe3ff;border:1px solid #3fd0ff55;font:inherit}
.aud-status{color:#8fb;white-space:pre;font-size:11px}
.aud-gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:60;
  background:rgba(3,2,26,.72);color:#fff;font:bold 22px ui-monospace,monospace;letter-spacing:.2em;cursor:pointer;pointer-events:auto}
`;

export class AudioTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.5, 1_000_000);
  private backdrop = new Backdrop(BACKDROPS.meridian);
  private audio = getAudio();
  private w: Ev[] = [];
  private m: MEv[] = [];
  private eye = new Vector3();
  private player = {
    position: new Vector3(),
    velocity: new Vector3(0, 0, -150),
    throttle: 0.6,
    boosting: false,
    cruise: 'off' as 'off' | 'spool' | 'on',
    lockProgress: 0,
    locked: false,
    incomingMissile: false,
    alive: true,
  };
  private frame: AudioFrame;
  private time = 0;
  private place = 'near right';
  private faction = 'choir';
  private intensity = 0;
  private jump: JumpPhase = 'none';
  // Scripted demos: start times (NaN = idle).
  private jumpT = NaN;
  private lockT = NaN;
  private cruiseT = NaN;
  private gunsT = NaN;
  private orbitT = NaN;
  private beamT = NaN;
  private salvoT = NaN;
  private status: HTMLDivElement;
  private statusT = 0;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor() {
    this.scene.add(this.backdrop.group);
    this.camera.position.set(0, 0, 0);
    this.frame = {
      dt: 0,
      eye: this.eye,
      camera: this.camera.quaternion,
      player: this.player,
      weaponEvents: this.w,
      missileEvents: this.m,
      jumpPhase: 'none',
      combatIntensity: 0,
    };
    this.audio.autoMood = false;

    const root = document.getElementById('ui-root') ?? document.body;
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
    const panel = document.createElement('div');
    panel.className = 'aud-panel';
    root.append(panel);
    this.status = document.createElement('div');
    this.status.className = 'aud-status';
    panel.append(this.status);
    this.buildPanel(panel);

    const gate = document.createElement('div');
    gate.className = 'aud-gate';
    gate.textContent = '▶ CLICK TO START AUDIO';
    gate.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.music.setMood('title', 1);
      gate.remove();
    });
    root.append(gate);
    window.__VANGUARD__ = { ...window.__VANGUARD__, ready: false, frame: () => 0, backend: '', hooks: { ...window.__VANGUARD__?.hooks, audio: this.audio, audioScene: this } };
  }

  // ── panel ─────────────────────────────────────────────────────────────
  private buildPanel(p: HTMLElement): void {
    const a = this.audio;
    const section = (title: string) => {
      const h = document.createElement('h3');
      h.textContent = title;
      p.append(h);
      const d = document.createElement('div');
      p.append(d);
      return d;
    };
    const btn = (parent: HTMLElement, label: string, fn: () => void, id = label) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        a.unlock();
        fn();
      });
      parent.append(b);
      this.buttons.set(id, b);
      return b;
    };
    const slider = (parent: HTMLElement, label: string, v: number, fn: (v: number) => void) => {
      const l = document.createElement('label');
      l.textContent = label;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = '0';
      r.max = '1';
      r.step = '0.01';
      r.value = String(v);
      r.addEventListener('input', () => fn(Number(r.value)));
      l.append(r);
      parent.append(l);
    };
    const select = (parent: HTMLElement, label: string, opts: string[], v: string, fn: (v: string) => void) => {
      const l = document.createElement('label');
      l.textContent = label;
      const s = document.createElement('select');
      for (const o of opts) {
        const e = document.createElement('option');
        e.value = e.textContent = o;
        s.append(e);
      }
      s.value = v;
      s.addEventListener('change', () => fn(s.value));
      l.append(s);
      parent.append(l);
    };

    const mix = section('Mix');
    btn(mix, 'Mute', () => this.buttons.get('Mute')!.classList.toggle('on', a.toggleMute()));
    for (const bus of ['master', 'music', 'sfx', 'voice'] as BusName[]) slider(mix, bus, a.engine.getVolume(bus), (v) => a.setVolume(bus, v));

    const mus = section('Music');
    for (const mood of MOODS) btn(mus, mood, () => a.music.setMood(mood, 2), `mood:${mood}`);
    btn(mus, 'silence', () => a.music.setMood(null, 2));
    const sco = section('Score');
    for (const id of SCORE_IDS) btn(sco, SCORE_INFO[id].title, () => a.setScore(id, a.music.variant, 2), `score:${id}`).title = SCORE_INFO[id].blurb;
    btn(sco, 'next variant', () => a.setScore(a.music.score, a.music.variant + 1, 2));
    btn(sco, 'home variant', () => a.setScore(a.music.score, 0, 2));
    const st = section('Stingers');
    for (const k of ['victory', 'defeat', 'lock', 'jump'] as StingerKind[]) btn(st, k, () => a.stinger(k), `sting:${k}`);
    slider(st, 'intensity', 0, (v) => (this.intensity = v));
    const auto = btn(st, 'auto cruise↔combat', () => {
      a.autoMood = !a.autoMood;
      auto.classList.toggle('on', a.autoMood);
    });

    const wpn = section('Weapons (spatial)');
    select(wpn, 'where', Object.keys(PLACES), this.place, (v) => (this.place = v));
    select(wpn, 'faction', ['concord', 'choir', 'rustwake'], this.faction, (v) => (this.faction = v));
    btn(wpn, 'laser', () => this.ev('fire', null, SHIPS[this.faction]));
    btn(wpn, 'shield hit', () => this.ev('shield', SHIPS[this.faction], PLAYER));
    btn(wpn, 'hull hit', () => this.ev('hit', SHIPS[this.faction], PLAYER));
    btn(wpn, 'kill (fighter)', () => this.ev('kill', SHIPS[this.faction], PLAYER));
    btn(wpn, 'kill (capital)', () => this.ev('kill', CAPITAL, PLAYER));
    btn(wpn, 'missile hit', () => this.m.push({ kind: 'detonate', position: PLACES[this.place].clone(), target: SHIPS[this.faction], shooter: PLAYER }));
    btn(wpn, 'beam sizzle 1s', () => (this.beamT = this.time));
    btn(wpn, 'orbiting gunfire 4s', () => (this.orbitT = this.time));
    const own = section('Player ship');
    btn(own, 'guns 1s', () => (this.gunsT = this.time));
    btn(own, 'missile salvo', () => (this.salvoT = this.time));
    btn(own, 'shield hit on me', () => this.ev('shield', PLAYER, SHIPS.choir, new Vector3(0, 0, -8)));
    btn(own, 'hull hit on me', () => this.ev('hit', PLAYER, SHIPS.choir, new Vector3(3, 0, -8)));
    const ab = btn(own, 'afterburner', () => {
      this.player.boosting = !this.player.boosting;
      ab.classList.toggle('on', this.player.boosting);
    });
    btn(own, 'cruise drive', () => (this.cruiseT = this.time));
    btn(own, 'lock-on', () => (this.lockT = this.time));
    const inc = btn(own, 'incoming missile', () => {
      this.player.incomingMissile = !this.player.incomingMissile;
      inc.classList.toggle('on', this.player.incomingMissile);
    });
    btn(own, 'Lantern jump', () => (this.jumpT = this.time));
    const eng = btn(own, 'engine on', () => {
      this.player.alive = !this.player.alive;
      eng.classList.toggle('on', this.player.alive);
    });
    eng.classList.add('on');
    slider(own, 'throttle', this.player.throttle, (v) => (this.player.throttle = v));

    const ui = section('UI');
    for (const k of ['move', 'confirm', 'back', 'error', 'tick', 'open'] as UiKind[]) btn(ui, k, () => a.ui(k), `ui:${k}`);
    const rad = section('Radio');
    for (const k of ['open', 'static', 'close', 'click'] as RadioKind[]) btn(rad, k, () => a.radio(k), `radio:${k}`);
  }

  private ev(kind: Ev['kind'], ship: AudioShip | null, shooter: AudioShip | null, at?: Vector3): void {
    this.w.push({ kind, position: (at ?? PLACES[this.place]).clone(), ship, shooter });
  }

  // ── frame ─────────────────────────────────────────────────────────────
  update({ dt }: FrameContext): void {
    this.time += dt;
    const t = this.time;
    const p = this.player;

    // Player guns: 12/s.
    if (t - this.gunsT < 1 && Math.floor((t - this.gunsT) * 12) !== Math.floor((t - dt - this.gunsT) * 12)) {
      this.w.push({ kind: 'fire', position: new Vector3(0, -1, -4), ship: null, shooter: PLAYER });
    }
    // Remote gunfire circling the listener (panning check).
    if (t - this.orbitT < 4 && Math.floor((t - this.orbitT) * 9) !== Math.floor((t - dt - this.orbitT) * 9)) {
      const ang = (t - this.orbitT) * 1.6;
      this.w.push({ kind: 'fire', position: new Vector3(Math.sin(ang) * 90, 0, -Math.cos(ang) * 90), ship: null, shooter: SHIPS[this.faction] });
    }
    if (t - this.beamT < 1) this.w.push({ kind: 'beam-hit', position: PLACES[this.place].clone(), ship: SHIPS.concord, shooter: CAPITAL });
    // Salvo: 12 launches 45 ms apart, detonations ~1.8 s later.
    const st = t - this.salvoT;
    for (let k = 0; k < 12; k++) {
      if (st >= k * 0.045 && st - dt < k * 0.045) this.m.push({ kind: 'launch', position: new Vector3(k % 2 ? 2 : -2, -1, 0), target: SHIPS.choir, shooter: PLAYER });
      const td = 1.8 + k * 0.03;
      if (st >= td && st - dt < td) this.m.push({ kind: 'detonate', position: new Vector3(40 + k * 3, 10, -600), target: SHIPS.choir, shooter: PLAYER });
    }
    // Lock-on: 1.1 s to lock, hold 2 s, lose it.
    const lt = t - this.lockT;
    p.lockProgress = lt >= 0 && lt < 3.1 ? Math.min(1, lt / 1.1) : 0;
    p.locked = lt >= 1.1 && lt < 3.1;
    // Cruise: spool 1.4 s → on 4 s → off.
    const ct = t - this.cruiseT;
    p.cruise = ct >= 0 && ct < 1.4 ? 'spool' : ct >= 1.4 && ct < 5.4 ? 'on' : 'off';
    const speed = p.cruise === 'on' ? Math.min(3000, 220 + (ct - 1.4) * 700) : p.boosting ? 460 : 60 + p.throttle * 160;
    p.velocity.set(0, 0, -speed);
    // Lantern jump: spool 0.9 → tunnel 2.6 → exit 0.9.
    const jt = t - this.jumpT;
    this.jump = !(jt >= 0) ? 'none' : jt < 0.9 ? 'spool' : jt < 3.5 ? 'tunnel' : jt < 4.4 ? 'exit' : 'none';

    const f = this.frame;
    f.dt = dt;
    f.jumpPhase = this.jump;
    f.combatIntensity = this.intensity;
    this.audio.update(f);
    this.w.length = 0;
    this.m.length = 0;

    this.camera.rotation.y = Math.sin(t * 0.05) * 0.2;
    this.camera.updateMatrixWorld();
    this.backdrop.follow(this.camera);

    this.statusT -= dt;
    if (this.statusT <= 0) {
      this.statusT = 0.25;
      const e = this.audio.engine;
      const state = e.unavailable ? 'unavailable' : e.ctx ? e.ctx.state : 'waiting for gesture';
      this.status.textContent =
        `AUDIO ${state}${e.muted ? ' · MUTED' : ''}\n` +
        `mood ${this.audio.music.mood ?? '—'} · intensity ${this.audio.music.level.toFixed(2)}\n` +
        `score ${this.audio.scoreLabel} · variant ${this.audio.music.variant}\n` +
        `voices ${e.activeVoices()} · jump ${this.jump} · cruise ${p.cruise}${p.locked ? ' · LOCKED' : ''}`;
      for (const m of MOODS) this.buttons.get(`mood:${m}`)?.classList.toggle('on', this.audio.music.mood === m);
      for (const id of SCORE_IDS) this.buttons.get(`score:${id}`)?.classList.toggle('on', this.audio.music.score === id);
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    return 'AUDIO TEST';
  }
}
