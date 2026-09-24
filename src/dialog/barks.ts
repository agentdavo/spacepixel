/**
 * Combat barks and traffic hails — short voiced radio lines, rate-limited so
 * a dogfight never turns into a wall of chatter. Pure: tables + a limiter
 * that takes the clock as input (tests/dialog.test.ts).
 */
export type BarkKind =
  | 'engage' // hostiles close in
  | 'splash-player' // the Point got a kill: a wingman calls it
  | 'splash-wing' // a wingman got a kill
  | 'player-hit' // the Point is taking hits
  | 'wing-hit' // a wingman is taking hits
  | 'missile' // missile on the Point
  | 'wing-down' // a wingman is lost
  | 'enemy-taunt' // an enemy on the open band
  | 'enemy-down' // an enemy's last words
  | 'mount-player' // the Point shot a turret / lance / hangar off a hull: a wingman calls it
  | 'mount-wing' // a wingman knocked out a subsystem
  | 'order-form' // the Point ordered "form on me": the lead wingman answers
  | 'order-attack' // "attack my target"
  | 'order-free' // "engage at will"
  | 'order-cover' // "cover me"
  | 'order-no-target'; // "attack my target" with nothing locked

/** Lines by kind and voice group. {name} = the other party's callsign. */
export const BARK_LINES: Record<BarkKind, Partial<Record<string, string[]>> & { any: string[] }> = {
  engage: {
    kade: ['Bandits. Vanguard, weapons free. Pick your targets and don\'t get clever.', 'Contacts, closing fast. Break by pairs on my mark — mark.'],
    jackpot: ['Pool is open, people! Two shares on the first splash!', 'Here they come. Oh, I hate it when they sing.'],
    candle: ['Hostiles. First keeping: the seal holds. Engaging.'],
    sparrow: ['Contacts! That\'s — that\'s a lot of contacts.'],
    salt: ['Company. They\'re not here for the scenery.'],
    any: ['Contacts inbound. Weapons free.'],
  },
  'splash-player': {
    kade: ['Good kill, Point.', 'Splash one. Tidy.', 'That\'s one. Don\'t admire it.'],
    jackpot: ['Splash! That one\'s yours, Point, I\'ll mark the board.', 'Oh, nice shot! Hands off my pool, though.'],
    candle: ['Splash. The Keepings go with them.'],
    sparrow: ['You got him! Point got him!'],
    salt: ['Splash one. Somebody\'s grams, gone.'],
    any: ['Splash one.'],
  },
  'splash-wing': {
    kade: ['Splash. Next.', 'Scratch one.'],
    jackpot: ['Splash! Write it down, write it down!', 'That\'s mine! Everybody saw that!'],
    candle: ['Splash. We thank it, and we go.'],
    sparrow: ['I got one! I actually — I got one!'],
    salt: ['Splash. Moving on.'],
    any: ['Splash one.'],
  },
  'player-hit': {
    kade: ['You\'re taking fire, Point. Move.', 'Point, you\'re hit. Break, break!'],
    jackpot: ['Point, you\'re smoking! Shake him!'],
    candle: ['You are hit, Point. Keep the seal.'],
    sparrow: ['Point! You\'re hit!'],
    salt: ['Point\'s taking hits. Somebody get that Cantor off him.'],
    any: ['You\'re taking fire!'],
  },
  'wing-hit': {
    kade: ['I\'m hit. Still flying.', 'Took one. Nothing the wardens can\'t fix.'],
    jackpot: ['Ow! No, okay, I\'m okay! Mostly!', 'He scratched my paint! That\'s personal!'],
    candle: ['Hit. The feed runs clean. I hold.'],
    sparrow: ['I\'m hit, I\'m hit — still flying!'],
    salt: ['Taking fire. Not for long.'],
    any: ['I\'m hit!'],
  },
  missile: {
    kade: ['Missile, missile! Point, break!', 'Launch on you, Point. Flares and burn.'],
    jackpot: ['Missile on your tail, Point! Go go go!'],
    candle: ['Missile on the Point. Move.'],
    sparrow: ['Missile! Point, missile!'],
    salt: ['Missile inbound on you. Don\'t be a statistic.'],
    any: ['Missile inbound!'],
  },
  'wing-down': {
    kade: ['{name} is down. Keep flying. Grieve later.', 'Lost {name}. Close it up, Vanguard.'],
    jackpot: ['{name}\'s gone! No — no, no!'],
    candle: ['{name} is down. We keep the light for them.'],
    sparrow: ['{name}\'s down! Did anyone see a chute? Anyone?'],
    salt: ['{name}\'s down. Mug stays on the hook.'],
    any: ['{name} is down!'],
  },
  'enemy-taunt': {
    choir: ['(sung) What is lifted must be worthy.', 'Be witnessed, Directorate.', 'The Altitude sees you. So do I.', 'Your fossils cannot sing.'],
    rustwake: ['Nothing personal, pilot. It\'s the gas.', 'Nice paint. I\'ll wear it.', 'Everything in the black is salvage eventually.'],
    concord: ['Renegade, you are expenditure now.', 'This is Continuity. Stand down.'],
    any: ['Break off, pilot.'],
  },
  'mount-player': {
    kade: ['{name}\'s down. Good. Next mount on that side.', 'That\'s their {name} gone. Keep stripping that flank.'],
    jackpot: ['Ha! {name}, gone! Do the next one, I\'ll count!', 'Oh, you took the {name} off! Clean!'],
    candle: ['{name} is silent. The flank is opening.'],
    sparrow: ['You got the {name}! It stopped shooting!'],
    salt: ['{name}\'s scrap. One less gun on us.'],
    any: ['{name} destroyed.'],
  },
  'mount-wing': {
    kade: ['{name} is down. Moving to the next.', 'Scratch their {name}.'],
    jackpot: ['{name}, splashed! That\'s a mount, that counts!'],
    candle: ['Their {name} is quiet now.'],
    sparrow: ['I — I got the {name}! It worked!'],
    salt: ['{name}\'s off the hull.'],
    any: ['{name} destroyed.'],
  },
  'enemy-down': {
    choir: ['I am unwitnessed—', 'Measure, I cannot—', '(sung) Out of the dust—'],
    rustwake: ['Ah, scrap—', 'Tell the moot I—'],
    concord: ['Keep the—'],
    any: ['—'],
  },
  'order-form': {
    kade: ['Forming on you, Point. Tighten it up, Vanguard.', 'Copy. On your wing.'],
    jackpot: ['Coming home to mother! Save me a seat.', 'Copy, forming up. Nobody touch my slot.'],
    candle: ['On your wing. As kept.'],
    sparrow: ['Copy, forming up! On your — yes, on your left.'],
    salt: ['Rejoining. Try not to lose me.'],
    any: ['Copy, forming up.'],
  },
  'order-attack': {
    kade: ['Copy your target. Vanguard, on the Point\'s lock.', 'Your target. Going in.'],
    jackpot: ['Ooh, that one? Copy, he\'s mine. Well, ours.', 'Copy, piling on your target!'],
    candle: ['Your target. It will not keep long.'],
    sparrow: ['Copy, attacking your target!'],
    salt: ['Copy. Your mark, my guns.'],
    any: ['Copy, attacking your target.'],
  },
  'order-free': {
    kade: ['Weapons free. Vanguard, pick your own. Stay in pairs.', 'Copy, engaging at will.'],
    jackpot: ['Free hunt! Pool\'s open, people!', 'Engaging at will. Finally.'],
    candle: ['Free to engage. The seal holds.'],
    sparrow: ['Copy, weapons free! Okay. Okay. Going.'],
    salt: ['Free hunt. Copy.'],
    any: ['Copy, engaging at will.'],
  },
  'order-cover': {
    kade: ['Copy, covering you. Nobody touches the Point.', 'On your six. Fly your fight.'],
    jackpot: ['Got your back, Point. Your tail\'s my business now.'],
    candle: ['I keep your six, Point. Go.'],
    sparrow: ['Covering you! I\'ve got your six!'],
    salt: ['On your six. Anything follows you, it meets me.'],
    any: ['Copy, covering you.'],
  },
  'order-no-target': {
    kade: ['Point, you have no lock. Give me a target.', 'Attack what, Point? Lock something first.'],
    jackpot: ['Love the enthusiasm, Point. Which one?'],
    candle: ['No lock, Point. Name the target.'],
    sparrow: ['Um, which target, Point?'],
    salt: ['You\'re not locked on anything, Point.'],
    any: ['Say again, Point? No target.'],
  },
};

function hash(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

/** A bark line for `kind` spoken by voice group `group` (cast id or faction). `n` varies the pick. */
export function barkLine(kind: BarkKind, group: string, n: number, vars: Record<string, string> = {}): string {
  const table = BARK_LINES[kind];
  const list = table[group] ?? table.any;
  const line = list[hash(`${kind}:${group}:${n}`) % list.length];
  return line.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Priority: urgent calls cut in; chatter waits or is dropped. */
export const BARK_PRIORITY: Record<BarkKind, number> = {
  engage: 0,
  'splash-player': 0,
  'splash-wing': 0,
  'player-hit': 0,
  'wing-hit': 0,
  missile: 1,
  'wing-down': 2,
  'enemy-taunt': 0,
  'enemy-down': 0,
  'mount-player': 0,
  'mount-wing': 0,
  // Answers to the Point's own orders cut in: the player just asked.
  'order-form': 1,
  'order-attack': 1,
  'order-free': 1,
  'order-cover': 1,
  'order-no-target': 1,
};

/** Minimum seconds between two barks of the same kind. */
export const BARK_COOLDOWN: Record<BarkKind, number> = {
  engage: 45,
  'splash-player': 9,
  'splash-wing': 12,
  'player-hit': 14,
  'wing-hit': 18,
  missile: 10,
  'wing-down': 3,
  'enemy-taunt': 30,
  'enemy-down': 16,
  'mount-player': 12,
  'mount-wing': 15,
  'order-form': 2,
  'order-attack': 2,
  'order-free': 2,
  'order-cover': 2,
  'order-no-target': 3,
};

/** The wing's answer to the Point's order (keys 1–4); `hasTarget` for "attack my target". */
export function orderKind(order: 'formUp' | 'attackMyTarget' | 'engageAtWill' | 'coverMe', hasTarget: boolean): BarkKind {
  if (order === 'attackMyTarget') return hasTarget ? 'order-attack' : 'order-no-target';
  return order === 'formUp' ? 'order-form' : order === 'engageAtWill' ? 'order-free' : 'order-cover';
}

// ── cruise banter ──────────────────────────────────────────────────────

/**
 * Two- or three-line exchanges between wingmen on a quiet leg. Each line is
 * [speaker, text]; an exchange plays only if every speaker is flying.
 */
export const BANTER: readonly (readonly [string, string])[][] = [
  [['jackpot', 'Pool\'s at forty shares. Candle, you in?'], ['candle', 'The Order forbids wagering, Jackpot.'], ['jackpot', 'That\'s a no, then. More for me.']],
  [['sparrow', 'Does anyone else hear the hull ticking? Is that normal?'], ['salt', 'It\'s cooling. Means you\'re alive, Sparrow.']],
  [['kade', 'Vanguard, check fuel and feeds. Nobody runs dry on my watch.'], ['jackpot', 'Fuel\'s fine. Morale\'s low. Is there a feed for that?']],
  [['salt', 'Quiet out here. On the convoys, quiet meant somebody was waiting.'], ['kade', 'Then keep your eyes open and your mouth shut, Salt.']],
  [['candle', 'The drive sings a half-tone flat today.'], ['sparrow', 'Is that bad?'], ['candle', 'It is honest. I will retune it at berth.']],
  [['jackpot', 'Sparrow, first splash buys the drinks. House rule.'], ['sparrow', 'I don\'t even — okay. Fine. Deal.']],
  [['kade', 'Good flying today, Sparrow.'], ['sparrow', 'Really? I mean — thank you, Abbess.']],
  [['salt', 'Candle. What does the Order say about the dead ones out here?'], ['candle', 'That they were kept once. And that we remember.']],
  [['jackpot', 'Anyone else think the Point flies like they\'re late for dinner?'], ['kade', 'The Point flies fine. Watch your own spacing.']],
  [['sparrow', 'Pretty stars tonight.'], ['salt', 'They\'re always there, kid. Tonight you looked.']],
];

/** A banter exchange whose speakers are all in `flying`, skipping those in `used` while any other fits. */
export function pickBanter(flying: readonly string[], used: ReadonlySet<number>, n: number): number {
  const fits: number[] = [];
  for (let i = 0; i < BANTER.length; i++) if (BANTER[i].every(([who]) => flying.includes(who))) fits.push(i);
  if (!fits.length) return -1;
  const fresh = fits.filter((i) => !used.has(i));
  const pool = fresh.length ? fresh : fits;
  return pool[hash(`banter:${n}`) % pool.length];
}

/**
 * Rate limiter: a per-kind cooldown, a global gap between any two barks, and
 * a rolling cap (at most `max` barks per `window` s). Urgent kinds (priority
 * ≥ 1) skip the global gap but still respect their own cooldown.
 */
export class BarkLimiter {
  private last: Partial<Record<BarkKind, number>> = {};
  private recent: number[] = [];
  private lastAny = -Infinity;
  constructor(
    readonly gap = 4.5,
    readonly max = 5,
    readonly window = 30,
  ) {}

  allow(kind: BarkKind, now: number): boolean {
    const urgent = BARK_PRIORITY[kind] >= 1;
    const l = this.last[kind];
    if (l !== undefined && now - l < BARK_COOLDOWN[kind]) return false;
    if (!urgent && now - this.lastAny < this.gap) return false;
    this.recent = this.recent.filter((t) => now - t < this.window);
    if (!urgent && this.recent.length >= this.max) return false;
    this.last[kind] = now;
    this.lastAny = now;
    this.recent.push(now);
    return true;
  }
}

// ── traffic hails ──────────────────────────────────────────────────────

const HAIL: Record<string, string[]> = {
  concord: [
    '{name}, cargo: {cargo}. Transit filed with Allocation. Keep the light, Vanguard.',
    'This is {name}, {cargo} for {dest}. Guns cold, please — we\'re on the timetable.',
    '{name} to escort flight: {cargo} aboard, eleven souls. Appreciate the company.',
  ],
  choir: [
    'Be witnessed. {name}, manifest {cargo}, bound for {dest}. We pass in peace.',
    '{name} of the Hesper registry. {cargo}. The Altitude sees our course. Ascend.',
  ],
  rustwake: [
    '{name}, gas and favours — well, {cargo}. Don\'t mind the paint.',
    'Hauler {name}. {cargo}, and none of your business past that. Lit, pilot.',
    '{name} here. Carrying {cargo}. Clan price for you, if you ever need it.',
  ],
  any: ['{name}, cargo: {cargo}. Passing through.'],
};

export function trafficHail(name: string, faction: string, cargo: string, dest: string, n = 0): string {
  const list = HAIL[faction] ?? HAIL.any;
  return list[hash(`${name}:${n}`) % list.length].replace('{name}', name).replace('{cargo}', cargo).replace('{dest}', dest);
}

/** A plausible cargo for a traffic ship (by name hash). */
export function trafficCargo(name: string, faction: string): string {
  const c: Record<string, string[]> = {
    concord: ['rations', 'medical stores', 'machine spares', 'sealed reactor cores', 'munitions'],
    choir: ['choir-glass', 'drive crystal', 'pilgrims', 'Treasury Ebon'],
    rustwake: ['scrap', 'Ebon dregs', 'salvage', 'nothing you need to know about'],
  };
  const l = c[faction] ?? c.concord;
  return l[hash(name) % l.length];
}

// ── station control ────────────────────────────────────────────────

/** Docking control lines by faction (and the carrier); {name} = station, {berth}. */
export const DOCK_LINES: Record<string, { cleared: string; auto: string; launch: string }> = {
  concord: {
    cleared: '{name} Control. Vanguard, you are cleared to berth {berth}. Corridor is lit. Keep the light.',
    auto: 'Guidance has you, Vanguard. Hands off the stick. Seals standing by.',
    launch: 'Catapult hot. Good hunting, Vanguard.',
  },
  choir: {
    cleared: 'Be witnessed, Directorate. {name} grants you berth {berth}. Fly the corridor exactly.',
    auto: 'Our guidance holds you now. Be still, and be welcome.',
    launch: 'Ascend, pilot. The Line is watching.',
  },
  rustwake: {
    cleared: '{name}. Berth {berth}\'s yours. Don\'t scratch anything you can\'t pay for.',
    auto: 'Tractor\'s got you, love. Don\'t touch anything shiny.',
    launch: 'Off you go. Bring us back something worth breaking.',
  },
  carrier: {
    cleared: 'Dawn Control, Vanguard One: you are cleared to the bow hangar. Deck is green.',
    auto: 'Guidance has you. Deck is green. Welcome home, Point.',
    launch: 'Catapult hot. Deck is green. Good hunting, Vanguard.',
  },
};
