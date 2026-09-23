import { PerspectiveCamera, Scene } from 'three';
import type { FrameContext } from '@/core/Engine';
import { flags } from '@/core/Flags';
import type { GameScene } from '../GameScene';
import { Backdrop, BACKDROPS } from '../Backdrop';
import { LightRig, LIGHT_PRESETS } from '@/render/LightRig';
import type { Character, ChatterBeat, CodexEntry } from '@/game/campaign/types';
import { Comms } from '@/ui/Comms';
import { Codex } from '@/ui/Codex';
import { showDebrief, showEyecatch } from '@/ui/Eyecatch';
import { drawPortrait, portraitKind } from '@/ui/Portrait';

/**
 * Storytelling-UI test bed over the painted sky (no ships).
 *
 *   ?scene=comms&t=4          radio chatter plays on a schedule (t fast-forwards)
 *   ?scene=comms&ui=codex     archive browser with sample entries
 *   ?scene=comms&ui=eyecatch  episode title card (held in ?shot=1 mode)
 *   ?scene=comms&ui=debrief   mission debrief
 *   ?scene=comms&ui=cast      portrait model sheet
 *
 * Keys: 1/2/3 play beats (2 interrupts) · L codex · Y eyecatch · U debrief.
 * The cast/codex below are local samples; the real data lives in
 * src/game/campaign.
 */

const CAST: Character[] = [
  {
    id: 'kite',
    callsign: 'Kite',
    name: 'Lt. Aya Brandt',
    role: 'Flight lead · 13th Ind. Sqn',
    faction: 'concord',
    voice: 'Clipped, dry, never raises her voice.',
    portrait: { skin: '#ffdcc4', hair: '#27305e', eyes: '#3d8bff', suit: '#e9edf5', hairStyle: 'spiky', accessory: 'none', seed: 11 },
    commsColor: '#7dffb2',
  },
  {
    id: 'hawser',
    callsign: 'Hawser',
    name: 'Cmdr. Isolde Rane',
    role: 'CIC · DNS Hesperus Dawn',
    faction: 'concord',
    voice: 'Warm authority.',
    portrait: { skin: '#ffe2cf', hair: '#ff8a3a', eyes: '#2fbf6a', suit: '#2b4ea8', hairStyle: 'long', accessory: 'headset', seed: 22 },
    commsColor: '#6fe6ff',
  },
  {
    id: 'grin',
    callsign: 'Grin',
    name: 'Ens. Tobias Okafor',
    role: 'Wing · Kestrel 3',
    faction: 'concord',
    voice: 'Jokes when scared.',
    portrait: { skin: '#b9825e', hair: '#1b1b22', eyes: '#8a4b2a', suit: '#e9edf5', hairStyle: 'short', accessory: 'scar', seed: 33 },
    commsColor: '#ffc46b',
  },
  {
    id: 'cantor',
    callsign: 'Cantor-9',
    name: 'Zenith choir pilot',
    role: 'Hegemony · intercept',
    faction: 'choir',
    voice: 'Liturgical.',
    portrait: { skin: '#f4e2ff', hair: '#e8e2ff', eyes: '#ff4fa0', suit: '#3a2150', hairStyle: 'bob', accessory: 'visor', seed: 44 },
    commsColor: '#ff5fb4',
  },
  {
    id: 'mags',
    callsign: 'Mags',
    name: 'Chief Magda Kov',
    role: 'Deck chief · Hesperus Dawn',
    faction: 'concord',
    voice: 'Gravel.',
    portrait: { skin: '#e4b08c', hair: '#6b4a3a', eyes: '#5a6aff', suit: '#8a3a22', hairStyle: 'shaved', accessory: 'eyepatch', seed: 55 },
    commsColor: '#ffc46b',
  },
  {
    id: 'wren',
    callsign: 'Wren',
    name: 'Lt. (jg) Suri Aldane',
    role: 'EWO · Kestrel 2',
    faction: 'concord',
    voice: 'Fast talker.',
    portrait: { skin: '#fff0e4', hair: '#f0e4b8', eyes: '#1fb8cc', suit: '#e9edf5', hairStyle: 'ponytail', accessory: 'none', seed: 66 },
    commsColor: '#7dffb2',
  },
  {
    id: 'rook',
    callsign: 'Rook',
    name: 'Capt. Dario Vance',
    role: 'Rustwake salvager',
    faction: 'rustwake',
    voice: 'Charming liar.',
    portrait: { skin: '#ffd8bc', hair: '#c21e3a', eyes: '#ffb020', suit: '#5b6b3a', hairStyle: 'swept', accessory: 'glasses', seed: 77 },
    commsColor: '#ffc46b',
  },
  {
    id: 'oracle',
    callsign: '???',
    name: 'The Lantern',
    role: 'Source unknown',
    faction: 'unknown',
    voice: 'Vast, patient.',
    portrait: { skin: '#000', hair: '#000', eyes: '#000', suit: '#000', hairStyle: 'short', seed: 99 },
    commsColor: '#b98cff',
  },
];

const BEAT_CHECKIN: ChatterBeat = {
  id: 'checkin',
  trigger: { on: 'start' },
  priority: 1,
  lines: [
    { who: 'kite', text: 'Vanguard flight, check in. Lantern Gate is lit and singing. Tighten up — eyes on the far side.' },
    { who: 'grin', text: 'Three, in. Nice night for it, Lead. Stars look painted on.' },
    { who: 'hawser', text: 'Hesperus to Vanguard. Picket reports two Zenith contacts behind the gate. Weapons free on my mark.' },
    { who: 'wren', text: 'Two, in. Spooling ECM. Something is riding the gate band, Lead… it sounds like a hymn.' },
  ],
};

const BEAT_INTERCEPT: ChatterBeat = {
  id: 'intercept',
  trigger: { on: 'time', at: 20 },
  priority: 3,
  lines: [
    { who: 'cantor', text: 'Choir to all voices: the lantern is ours. Turn back, little birds, or be sung under.', static: true },
    { who: 'system', text: 'WARNING — unidentified carrier wave on gate band. Source bearing 047, range unresolved.' },
  ],
};

const BEAT_ORACLE: ChatterBeat = {
  id: 'oracle',
  trigger: { on: 'flag', flag: 'oracle' },
  priority: 2,
  lines: [
    { who: 'oracle', text: 'YOU HAVE COME FAR ENOUGH TO BE HEARD.', delay: 0.6 },
    { who: 'kite', text: 'All Vanguard, hold fire. Hold fire. Did everyone just hear that?', delay: 1.5 },
    { who: 'rook', text: 'Heard it, sweetheart. Whole Wake heard it. Price of salvage just went up.' },
  ],
};

const CODEX: CodexEntry[] = [
  {
    id: 'shattering',
    title: 'The Shattering',
    category: 'history',
    body: 'Nobody alive remembers the gates going dark. The histories agree only on the silence that followed: four hundred inhabited systems, each suddenly alone, each certain for a generation that it was the last.\n\nThe Directorate was born in that silence — first as a convoy compact, then as a navy, and finally as the only government most of the Reach has ever known.\n\nWhat broke the gates is still argued in lecture halls and bar fights alike. The Zenith say a hymn was interrupted. The Directorate says nothing at all, which the Zenith find very telling.',
  },
  {
    id: 'lantern-gates',
    title: 'Lantern Gates',
    category: 'technology',
    body: 'A lantern gate is a ring of pre-Shattering lattice some eleven kilometres across, restored to partial function by the Directorate Corps of Engineers. When a gate is "lit" it emits a narrow-band carrier that pilots describe, without exception, as singing.\n\nThe Corps maintains that the tone is an artefact of field harmonics and can be safely ignored. Pilots of the 13th Independent Squadron have been observed humming along to it.\n\nTransit is instantaneous. Arrival is not always where the charts say.',
  },
  { id: 'directorate', title: 'The Terran Directorate', category: 'factions', body: 'Ivory hulls, cobalt panels, signal-orange ID bands.\n\nThe Directorate is a navy that happens to have a government attached.' },
  { id: 'zenith', title: 'The Zenith Hegemony', category: 'factions', body: 'The Hegemony believes the gates are instruments and that the universe is a choir that has forgotten its part.' },
  { id: 'rustwake', title: 'Rustwake Clans', category: 'factions', body: 'Scavengers of the Ebon-gas belts.' },
  { id: 'kite-file', title: 'Lt. Aya Brandt — "Kite"', category: 'people', body: 'Flight lead, 13th Independent Squadron. Four confirmed kills, two reprimands, one commendation she has never collected.' },
  { id: 'monolith', title: 'The Monolith', category: 'anomalies', body: 'A sphere the size of a moon. It was not there on the last survey.' },
  { id: 'log-047', title: 'Picket log 047', category: 'logs', body: '0412: Carrier wave on gate band.\n0413: It is singing back.' },
];

export class CommsTestScene implements GameScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.5, 1_200_000);
  private readonly backdrop = new Backdrop(BACKDROPS.meridian);
  private readonly root: HTMLElement;
  private readonly comms: Comms;
  private codex: Codex | null = null;
  private readonly schedule: { at: number; beat: ChatterBeat; fired: boolean }[];
  private readonly mode: string;
  private sheet: { ctx: CanvasRenderingContext2D; w: number; h: number } | null = null;
  private first = true;
  private busyUi = false;

  constructor() {
    LightRig.apply(LIGHT_PRESETS.meridian);
    this.scene.add(this.backdrop.group);
    this.root = document.getElementById('ui-root') ?? document.body;
    this.comms = new Comms(this.root, CAST);
    this.mode = new URLSearchParams(location.search).get('ui') ?? 'comms';
    this.schedule = [
      { at: 0.4, beat: BEAT_CHECKIN, fired: false },
      { at: 20, beat: BEAT_INTERCEPT, fired: false },
      { at: 30, beat: BEAT_ORACLE, fired: false },
    ];
    this.mockHud();

    if (this.mode === 'codex') this.openCodex();
    else if (this.mode === 'eyecatch') void this.eyecatch();
    else if (this.mode === 'debrief') void this.debrief();
    else if (this.mode === 'cast') this.castSheet();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Digit1') this.comms.play(BEAT_CHECKIN);
      else if (e.code === 'Digit2') this.comms.play(BEAT_INTERCEPT);
      else if (e.code === 'Digit3') this.comms.play(BEAT_ORACLE);
      else if (e.code === 'KeyL') (this.codex ?? this.makeCodex()).toggle();
      else if (e.code === 'KeyY') void this.eyecatch();
      else if (e.code === 'KeyU') void this.debrief();
    });
  }

  update(ctx: FrameContext): void {
    const t = ctx.time;
    if (this.first) {
      // Fast-forward so `?t=` lands mid-conversation deterministically.
      this.first = false;
      for (let s = 0; s < t; s += 0.05) this.step(s, 0.05);
    }
    this.step(t, ctx.dt);
    if (this.sheet) this.drawSheet(t);

    const a = t * 0.02;
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(Math.sin(a) * 10, 2 + Math.sin(t * 0.05), -Math.cos(a) * 10);
    this.backdrop.follow(this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cameraLabel(): string {
    return `COMMS TEST · ${this.mode.toUpperCase()}`;
  }

  private step(t: number, dt: number): void {
    if (this.mode === 'comms' && !this.busyUi) {
      for (const s of this.schedule) {
        if (!s.fired && t >= s.at) {
          s.fired = true;
          this.comms.play(s.beat);
        }
      }
      // Loop the demo every 45 s.
      if (t > 45 && !this.comms.busy && this.schedule.every((s) => s.fired)) {
        for (const s of this.schedule) {
          s.fired = false;
          s.at += 45;
        }
      }
    }
    this.comms.update(dt);
  }

  private makeCodex(): Codex {
    this.codex = new Codex(this.root, CODEX, { persist: false });
    for (const id of ['shattering', 'lantern-gates', 'directorate', 'zenith', 'kite-file', 'log-047']) this.codex.unlock(id);
    return this.codex;
  }

  private openCodex(): void {
    const c = this.makeCodex();
    c.show('lantern-gates');
  }

  private async eyecatch(): Promise<void> {
    this.busyUi = true;
    this.comms.clear();
    await showEyecatch(
      this.root,
      { chapter: 2, episode: 7, title: 'The Lantern Sings', tagline: 'Some doors open from the other side.' },
      { duration: flags.shot ? Infinity : 3.6 },
    );
    this.busyUi = false;
  }

  private async debrief(): Promise<void> {
    this.busyUi = true;
    this.comms.clear();
    const r = await showDebrief(this.root, {
      title: 'The Lantern Sings',
      episode: 7,
      outcome: 'success',
      debrief:
        'Gate Lantern-3 secured at 0431 ship time. Two Zenith Cantor-class fighters destroyed; one withdrew through the gate before it could be pursued.\n\nThe carrier wave persisted for eleven minutes after the engagement. Its source has not been identified. Pilots are reminded that humming on an open channel is a breach of comms discipline.',
      codexUnlocked: ['Lantern Gates', 'Picket log 047', 'Lt. Aya Brandt — "Kite"'],
    });
    console.info(`[comms-test] debrief → ${r}`);
    this.busyUi = false;
  }

  /** Model sheet of every sample portrait, animated (talking on alternate rows). */
  private castSheet(): void {
    this.busyUi = true;
    const cv = document.createElement('canvas');
    const n = CAST.length + 1;
    const size = 150;
    const gap = 12;
    const cols = Math.min(n, Math.max(2, Math.floor((window.innerWidth - 40) / (size + gap))));
    const rows = Math.ceil(n / cols);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cols * (size + gap) + gap;
    const h = rows * (size + gap + 18) + gap;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${w}px;height:${h}px;max-width:100vw;background:rgba(4,4,12,0.85);z-index:20`;
    this.root.append(cv);
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    this.sheet = { ctx, w: cols, h: size };
  }

  private drawSheet(t: number): void {
    const s = this.sheet!;
    const size = s.h;
    const gap = 12;
    const c = s.ctx;
    const who = [...CAST.map((x) => x.id), 'system'];
    c.clearRect(0, 0, 4000, 4000);
    who.forEach((id, i) => {
      const ch = CAST.find((x) => x.id === id);
      const x = gap + (i % s.w) * (size + gap);
      const y = gap + Math.floor(i / s.w) * (size + gap + 18);
      c.save();
      c.translate(x, y);
      drawPortrait(c, ch?.portrait ?? CAST[0].portrait, size, size, {
        talking: i % 2 === 0,
        time: t + i * 0.37,
        static: id === 'cantor' ? 0.5 : 0,
        kind: portraitKind(id, ch),
        tint: ch?.commsColor ?? '#7dffb2',
      });
      c.restore();
      c.fillStyle = ch?.commsColor ?? '#7dffb2';
      c.font = '700 12px Oxanium, sans-serif';
      c.fillText(`${(ch?.callsign ?? 'SYSTEM').toUpperCase()} · ${ch?.portrait.hairStyle ?? ''} ${ch?.portrait.accessory ?? ''}`, x, y + size + 14);
    });
  }

  /** Stand-in for the flight HUD's bottom-left readouts, to judge layout. */
  private mockHud(): void {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:24px;bottom:30px;font:13px "Share Tech Mono",monospace;color:#7dffb2;line-height:20px;text-shadow:0 0 6px rgba(125,255,178,.6);pointer-events:none;white-space:pre';
    el.textContent = 'SPD  412 m/s\nTHR  ▮▮▮▮▮▮▮▯▯▯\nAB   ▮▮▮▮▮▮▮▮▮▯\nFA  ON';
    this.root.append(el);
  }
}
