/**
 * Contract → CampaignMission. The in-space part of a contract is an ordinary
 * mission run by the existing CampaignRunner: the same objective predicates,
 * hidden script cues, flag-gated spawns, escort routes and beacon dwell zones
 * the story episodes use. Placements are absolute universe points
 * (`{ at: 'point' }`), because a contract knows the system's geometry.
 *
 * Pure and type-only imports (runs under node --test).
 *
 * Tags each op uses (the runtime draws nav markers for them):
 *   escort   freighter · raiders-w1.. · dest
 *   bounty   lair · mark · wing
 *   patrol   wp1..wpN · raiders
 *   salvage  wreck · survey (dwell) · core (blackbox) · scav
 *   recon    obs (dwell) · patrol
 *   sortie   rally · flight · measure-w1..
 *   courier / haul (tier ≥ 2)  hunters
 */
import type { CampaignContext, CampaignMission, CampaignObjective, ChatterBeat, ChatterLine, ChatterTrigger, Placement, SetPieceSpec, SpawnSpec } from '../campaign/types';
import type { Contract, V3 } from './contracts';

export interface OpBuild {
  mission: CampaignMission;
  /** Objective id → tag to put the nav marker on. */
  nav: Record<string, string>;
  /** Tag → marker label. */
  labels: Record<string, string>;
  /** Runner success moves the contract to `ready` (return for the fee). Courier / haul interceptors don't. */
  completes: boolean;
}

export interface OpOptions {
  /** Screenshot staging: compress spawn delays to a couple of seconds. */
  stage?: boolean;
}

type Pred = (c: CampaignContext) => boolean;

const obj = (id: string, text: string, done: Pred, extra: Partial<CampaignObjective> = {}): CampaignObjective => ({ id, text, done, ...extra });
const cue = (id: string, flag: string, when: Pred): CampaignObjective => ({ id, text: `[cue] ${flag}`, hidden: true, optional: true, done: when, setsFlag: flag });
const say = (who: string, text: string, delay?: number): ChatterLine => (delay === undefined ? { who, text } : { who, text, delay });
const hiss = (who: string, text: string): ChatterLine => ({ who, text, static: true });
const beat = (id: string, trigger: ChatterTrigger, lines: ChatterLine[], priority = 1): ChatterBeat => ({ id, trigger, lines, priority });
const onFlag = (flag: string): ChatterTrigger => ({ on: 'flag', flag });

const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function unit(a: V3, b: V3): V3 {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/**
 * Build the mission for `k`'s in-space operation, or null if it has none.
 * `offset` turns system-local metres into universe metres (SYSTEM_OFFSET).
 */
export function buildOp(k: Contract, offset: V3, opts: OpOptions = {}): OpBuild | null {
  const op = k.op;
  if (!op) return null;
  const at = (v: V3, o: V3 = [0, 0, 0]): Placement => ({ at: 'point', point: addV(v, offset), offset: o });
  const d = (normal: number, staged = 2) => (opts.stage ? staged : normal);
  const who = k.client;
  const spawns: SpawnSpec[] = [];
  const setpieces: SetPieceSpec[] = [];
  const objectives: CampaignObjective[] = [];
  const chatter: ChatterBeat[] = [];
  const nav: Record<string, string> = {};
  const labels: Record<string, string> = {};
  let completes = true;
  const en = op.enemy;

  switch (k.kind) {
    case 'escort': {
      const start = op.start ?? op.center;
      const end = op.end ?? op.center;
      const fr = op.freighter ?? { name: 'Freighter', blueprint: 'ffc-lantern-guard' };
      const dir = unit(start, end);
      const side: V3 = [-dir[2], 0, dir[0]];
      spawns.push({ blueprint: fr.blueprint, faction: k.faction, count: 1, place: at(start), tag: 'freighter', name: fr.name, role: 'escort', routeTo: 'dest' });
      for (let w = 1; w <= op.waves; w++) {
        const s = w % 2 ? 1 : -1;
        spawns.push({
          blueprint: en.blueprint,
          faction: en.faction,
          count: op.hostiles,
          place: { at: 'tag', tag: 'freighter', offset: [dir[0] * 3200 + side[0] * 1600 * s, 350, dir[2] * 3200 + side[2] * 1600 * s] },
          tag: `raiders-w${w}`,
          name: en.name,
          role: 'hostile',
          whenFlag: 'resume:freighter',
          delay: d(18 + (w - 1) * 40, 2 + (w - 1) * 5),
        });
      }
      setpieces.push({ kind: 'beacon', tag: 'dest', place: at(end), params: { label: op.endName ?? 'Destination', color: '#6fe6ff' } });
      objectives.push(
        cue('hold', 'halt:freighter', () => true),
        cue('go', 'resume:freighter', (c) => c.distanceTo('freighter') < 2500),
        cue('raid', 'raid-seen', (c) => c.alive('raiders')),
        obj('meet', `Rendezvous with the ${fr.name}`, (c) => c.flag('resume:freighter'), { failed: (c) => c.aliveCount('freighter') === 0 }),
        obj('escort', `Escort the ${fr.name} to ${op.endKind === 'gate' ? 'the ' : ''}${op.endName}`, (c) => c.flag('freighter-arrived'), { failed: (c) => c.aliveCount('freighter') === 0 }),
        obj('raiders', 'Drive off the raiders', (c) => c.flag('raid-seen') && c.aliveCount('raiders') === 0, { optional: true }),
      );
      if (op.endKind === 'gate') objectives.push(cue('depart', 'depart:freighter', (c) => c.flag('freighter-arrived')));
      nav.meet = 'freighter';
      nav.escort = 'freighter';
      nav.raiders = 'raiders';
      labels.freighter = fr.name.toUpperCase();
      labels.dest = (op.endName ?? 'DESTINATION').toUpperCase();
      chatter.push(
        beat('c-start', { on: 'start' }, [say(who, `The ${fr.name} is yours, Vanguard. She is holding off the ${k.op?.endKind === 'gate' ? 'station' : 'Lantern'}. Close to two kilometres and she lights up.`)]),
        beat('c-go', onFlag('resume:freighter'), [say(who, `${fr.name}, you have an escort. Light your drive. Slow and steady.`), say('system', 'ESCORT ROUTE LOGGED. FREIGHTER UNDER WAY.')]),
        beat('c-raid', onFlag('raid-seen'), [say('system', 'DRIVE SIGNATURES CLOSING ON THE FREIGHTER. WEAPONS FREE.')], 2),
        beat('c-win', { on: 'success' }, [say(who, op.endKind === 'gate' ? `She's through. Clean run. Come see me for the fee.` : `She's berthed. Clean run. Come see me for the fee.`)]),
        beat('c-lost', { on: 'failure' }, [say(who, `We've lost her. …Don't bother coming back for the fee.`)], 3),
      );
      break;
    }
    case 'bounty': {
      const mark = op.mark!;
      setpieces.push({ kind: 'wreckage', tag: 'lair', place: at(op.center), params: { radius: 900, count: 160, label: `${mark.name} — last seen` } });
      spawns.push(
        { blueprint: mark.blueprint, faction: mark.faction, count: 1, place: at(op.center, [0, 200, 700]), tag: 'mark', name: mark.name, role: 'hostile', whenFlag: 'lair-found' },
        { blueprint: en.blueprint, faction: en.faction, count: op.hostiles, place: at(op.center, [350, 150, 950]), tag: 'wing', name: `${mark.name.split(' ').pop()}'s wing`, role: 'hostile', whenFlag: 'lair-found' },
      );
      objectives.push(
        cue('found', 'lair-found', (c) => c.distanceTo('lair') < d(6000, 1e9)),
        cue('seen', 'mark-seen', (c) => c.alive('mark')),
        obj('find', `Find ${mark.name}`, (c) => c.flag('lair-found')),
        obj('kill', `Kill ${mark.name}`, (c) => c.flag('mark-seen') && !c.alive('mark')),
        obj('wing', 'Break the wing', (c) => c.flag('mark-seen') && c.aliveCount('wing') === 0, { optional: true }),
      );
      nav.find = 'lair';
      nav.kill = 'mark';
      nav.wing = 'wing';
      labels.lair = 'LAST KNOWN POSITION';
      labels.mark = mark.name.toUpperCase();
      chatter.push(
        beat('b-start', { on: 'start' }, [say(who, `That's the place. ${mark.name} likes to sit in the wrecks and wait.`)]),
        beat('b-found', onFlag('mark-seen'), [hiss(mark.id, taunt(mark.name, op.seed)), say('system', 'BOUNTY TARGET IDENTIFIED. TRANSPONDER MATCH.')], 2),
        beat('b-win', { on: 'success' }, [say(who, `Confirmed. ${mark.name} is off the board. Come and collect.`)]),
      );
      break;
    }
    case 'patrol': {
      const wps = op.waypoints ?? [op.center];
      const n = wps.length;
      wps.forEach((w, i) => {
        setpieces.push({ kind: 'beacon', tag: `wp${i + 1}`, place: at(w), params: { label: `Nav point ${i + 1}`, color: '#ffd23a' } });
        objectives.push(obj(`wp${i + 1}`, `Nav point ${i + 1}/${n}`, (c) => c.distanceTo(`wp${i + 1}`) < 600, { setsFlag: `wp${i + 1}` }));
        nav[`wp${i + 1}`] = `wp${i + 1}`;
        labels[`wp${i + 1}`] = `NAV POINT ${i + 1}`;
      });
      const hide = wps[Math.min(2, n - 1)];
      spawns.push({ blueprint: en.blueprint, faction: en.faction, count: op.hostiles, place: at(hide, [0, 250, 800]), tag: 'raiders', name: en.name, role: 'hostile', whenFlag: 'wp1', delay: d(4, 1) });
      objectives.push(cue('seen', 'raid-seen', (c) => c.alive('raiders')), obj('clear', 'Clear the sector', (c) => c.flag('raid-seen') && c.aliveCount('raiders') === 0));
      nav.clear = 'raiders';
      chatter.push(
        beat('p-start', { on: 'start' }, [say(who, `Sweep is logged. ${n} points, in order. Look at everything twice.`)]),
        beat('p-raid', onFlag('raid-seen'), [say('system', 'CONTACTS IN THE ROCKS. NOT ON ANY SCHEDULE.'), say(who, 'There they are. Clear them.')], 2),
        beat('p-win', { on: 'success' }, [say(who, 'Sector clean. Good sweep. Your fee is waiting here.')]),
      );
      break;
    }
    case 'salvage': {
      const derelict = op.wreck === 'derelict';
      setpieces.push(
        derelict
          ? { kind: 'derelict', tag: 'wreck', place: at(op.center), params: { length: 900, belt: 1400, label: 'Golden-age hulk' } }
          : { kind: 'wreckage', tag: 'wreck', place: at(op.center), params: { radius: 1100, count: 220, label: 'Lane ambush debris' } },
        { kind: 'beacon', tag: 'survey', place: at(op.center, [derelict ? 1000 : 0, 250, 0]), params: { hold: op.hold ?? 8, radius: 700, label: 'Survey mark', color: '#6fe6ff' } },
        { kind: 'blackbox', tag: 'core', place: at(op.center, [derelict ? -200 : 300, derelict ? 520 : 120, 400]), params: { whenFlag: 'survey-held' } },
      );
      objectives.push(
        obj('survey', 'Survey the wreck — hold inside the ring', (c) => c.flag('survey-held')),
        obj('core', 'Recover the flight core', (c) => c.flag('core-recovered')),
      );
      nav.survey = 'survey';
      nav.core = 'core';
      labels.survey = 'SURVEY MARK';
      labels.core = 'FLIGHT CORE';
      labels.wreck = derelict ? 'HULK' : 'DEBRIS';
      if (op.waves > 0) {
        spawns.push({ blueprint: 'rw-scrapjack', faction: 'rustwake', count: op.hostiles, place: at(op.center, [2600, 450, 2600]), tag: 'scav', name: 'Scav Cutter', role: 'hostile', whenFlag: 'survey-held', delay: d(10, 1) });
        objectives.push(
          cue('scav', 'scav-seen', (c) => c.alive('scav')),
          obj('clear', 'Get clear with the core — 9 km, or drive off the scavengers', (c) => (c.flag('scav-seen') && c.aliveCount('scav') === 0) || c.distanceTo('survey') > 9000),
        );
        nav.clear = 'scav';
        chatter.push(beat('s-scav', onFlag('scav-seen'), [hiss('system', '…core beacon… we hear it too, Directorate. Finders keepers.'), say(who, 'Scavengers. The core is ours. Keep it.')], 2));
      }
      chatter.push(
        beat('s-start', { on: 'start' }, [say(who, derelict ? 'There she is. Six hundred years in the dark. Survey first; touch nothing you do not need.' : 'The debris is fresh. Survey it and find the core.')]),
        beat('s-core', onFlag('survey-held'), [say('system', 'SURVEY COMPLETE. FLIGHT CORE BEACON ACQUIRED — MARKED.')]),
        beat('s-win', { on: 'success' }, [say(who, 'Core secured. The dead keep their own; we keep what they remember. Bring it home.')]),
      );
      break;
    }
    case 'recon': {
      setpieces.push({ kind: 'beacon', tag: 'obs', place: at(op.center), params: { hold: op.hold ?? 20, radius: 1200, label: 'Observation point', color: '#ff5fb4' } });
      spawns.push({ blueprint: en.blueprint, faction: en.faction, count: op.hostiles, place: at(op.center, [3200, 500, -3200]), tag: 'patrol', name: en.name, role: 'hostile', whenFlag: 'obs-entered', delay: d(9, 1) });
      objectives.push(
        cue('in', 'obs-entered', (c) => c.distanceTo('obs') <= 0),
        cue('seen', 'patrol-seen', (c) => c.alive('patrol')),
        obj('obs', `Hold at the observation point (${op.hold ?? 20} s of tape)`, (c) => c.flag('obs-held')),
        obj('break', 'Break contact — 12 km clear, or destroy the patrol', (c) => c.distanceTo('obs') > 12000 || (c.flag('patrol-seen') && c.aliveCount('patrol') === 0)),
      );
      nav.obs = 'obs';
      nav.break = 'patrol';
      labels.obs = 'OBSERVATION POINT';
      chatter.push(
        beat('r-start', { on: 'start' }, [say(who, 'Observation point is marked. Sit in the ring and let the tape run. Do not start anything.')]),
        beat('r-seen', onFlag('patrol-seen'), [say('system', 'ACTIVE SCAN DETECTED. YOU HAVE BEEN NOTICED.'), say(who, 'Hold if you can. Every second is worth something.')], 2),
        beat('r-held', onFlag('obs-held'), [say('system', 'RECORDING COMPLETE. BREAK CONTACT.')], 2),
        beat('r-win', { on: 'success' }, [say(who, 'Clean tape. Bring it home.')]),
      );
      break;
    }
    case 'sortie': {
      setpieces.push({ kind: 'beacon', tag: 'rally', place: at(op.center), params: { label: 'Rally point', color: '#7dffb2' } });
      spawns.push(
        { blueprint: 'vf27-kestrel', faction: 'concord', count: 2, place: at(op.center, [-150, 40, -200]), tag: 'flight', name: 'Picket', role: 'wing' },
        { blueprint: 'vf31-harrier', faction: 'concord', count: 1, place: at(op.center, [180, -30, -260]), tag: 'flight-lead', name: 'Picket Lead', role: 'wing' },
      );
      for (let w = 1; w <= op.waves; w++) {
        spawns.push({
          blueprint: w === op.waves && op.waves > 1 ? 'choir-psalter' : en.blueprint,
          faction: 'choir',
          count: op.hostiles,
          place: at(op.center, [(w % 2 ? 1 : -1) * 900, 600, 5200 + w * 700]),
          tag: `measure-w${w}`,
          name: w === op.waves && op.waves > 1 ? 'Psalter' : 'Measure Cantor',
          role: 'hostile',
          whenFlag: 'rallied',
          delay: d(4 + (w - 1) * 32, 1 + (w - 1) * 4),
        });
      }
      const total = op.hostiles * op.waves;
      objectives.push(
        obj('rally', 'Rendezvous with the picket flight', (c) => c.distanceTo('rally') < 1500, { setsFlag: 'rallied' }),
        cue('seen', 'measure-seen', (c) => c.alive('measure')),
        obj('break', `Break the Measure — ${total} fighters`, (c) => c.kills('choir') >= total),
      );
      nav.rally = 'rally';
      nav.break = 'measure';
      labels.rally = 'RALLY POINT';
      chatter.push(
        beat('o-start', { on: 'start' }, [say(who, 'Picket flight is holding at the rally point. Form on them. This one is off the Schedule, pilot.')]),
        beat('o-seen', onFlag('measure-seen'), [hiss('system', '(sung) Be witnessed, be witnessed, the Measure ascends —'), say('system', 'CHOIR MEASURE INBOUND. HYMN ON OPEN BANDS.')], 2),
        beat('o-win', { on: 'success' }, [say(who, 'Measure broken. Nobody budgeted for that. Come in and sign for it.')]),
      );
      break;
    }
    case 'courier':
    case 'haul': {
      completes = false;
      spawns.push({ blueprint: en.blueprint, faction: en.faction, count: op.hostiles, place: { at: 'player', offset: [1800, 300, 2600] }, tag: 'hunters', name: 'Interceptor', role: 'hostile', delay: d(10, 1) });
      objectives.push(
        cue('seen', 'hunt-seen', (c) => c.alive('hunters')),
        obj('shake', 'Interceptors — shake them or shoot them', (c) => c.flag('hunt-seen') && (c.aliveCount('hunters') === 0 || c.distanceTo('hunters') > 9000)),
      );
      nav.shake = 'hunters';
      chatter.push(
        beat('h-seen', onFlag('hunt-seen'), [say('system', `DRIVE SIGNATURES CLOSING. THEY KNOW WHAT YOU ARE CARRYING.`)], 2),
        beat('h-win', { on: 'success' }, [say('system', `CONTACTS CLEAR. RESUME DELIVERY TO ${k.payAtName.toUpperCase()}.`)]),
      );
      break;
    }
    default:
      return null;
  }

  const mission: CampaignMission = {
    id: `contract:${k.id}`,
    chapter: 1,
    episode: 0,
    title: k.title,
    milestones: [],
    system: op.system,
    briefing: k.brief,
    tagline: '',
    objectives,
    spawns,
    setpieces,
    chatter,
    codex: [],
    debrief: '',
  };
  return { mission, nav, labels, completes };
}

function taunt(name: string, seed: number): string {
  const lines = [
    `Directorate paint on a hired gun. ${name} is flattered. Come closer.`,
    'Who posted me this time? Tell them the price just went up.',
    'Nothing in the black is ever truly lost. You will be, though.',
    'Another bounty hunter. I have your cousin’s wings on my hull.',
  ];
  return lines[seed % lines.length];
}
