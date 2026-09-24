import type { Cond, DialogChoice, DialogNode, Effect } from '../../dialog/types';
import type { Arc, ArcTalk, Trigger } from './arcs';

/**
 * The arcs themselves — seven recurring people whose lives go on without you
 * (docs/LORE.md voice: grams, not credits; the cockpit, the machine, the
 * sublime; nobody says "easy one"). The engine is arcs.ts; the named jobs
 * they offer are arcContracts.ts; `{memory}` in a line is a recalled event
 * from the world log (memory.ts).
 *
 *   odile   The Bar Moves            — the Last Timetable after the Bastion
 *   magpie  Forty Grams              — a clan debt, and the man who bought it
 *   pell    The Witness              — an auditor who finally stops counting
 *   nadia   The Lists                — a sister reading refugee rolls
 *   toma    The Count                — a picket ensign and the Signal
 *   imre    Class Four Goes Out      — Dalca, Pieter and a school tender
 *   maud    The Sixth Keeping        — a warden who wants to ask why
 */

const M = 60;

// ── authoring helpers ──────────────────────────────────────────────────
const say = (who: string, line: string, next?: string, effects?: Effect[], jp?: string): DialogNode => ({ who, line, ...(next ? { next } : {}), ...(effects ? { effects } : {}), ...(jp ? { jp } : {}) });
const ask = (who: string, line: string, choices: DialogChoice[], effects?: Effect[]): DialogNode => ({ who, line, choices, ...(effects ? { effects } : {}) });
const ch = (text: string, next: string | null, extra: Partial<DialogChoice> = {}): DialogChoice => ({ text, next, ...extra });
const talk = (title: string, nodes: Record<string, DialogNode>, entry: { if?: Cond; node: string }[] = [{ node: 'hello' }], repeatable = true): ArcTalk => ({ title, nodes, entry, repeatable });
const set = (k: string, v: string | boolean = true): Effect => ({ fact: k, value: v });

const after = (min: number): Trigger => ({ after: min * M });
const is = (k: string, v: string | boolean = true): Trigger => ({ fact: k, is: v });
/** A named contract's in-space work is done (ready to be paid) or paid. */
export const won = (key: string): Trigger => ({ any: [is(`contract.${key}`, 'ready'), is(`contract.${key}`, 'done')] });
/** A named contract failed, lapsed or was abandoned. */
export const lost = (key: string): Trigger => ({ any: [is(`contract.${key}`, 'failed'), is(`contract.${key}`, 'lapsed'), is(`contract.${key}`, 'abandoned')] });
const holding = (key: string): Cond => ({ any: [{ fact: `contract.${key}`, is: 'active' }, { fact: `contract.${key}`, is: 'ready' }] });

/** The Bastion has fallen (story fact from the world simulation, or the campaign has passed Episode 10). */
export const BASTION_FALLEN: Trigger = { any: [{ episode: 11 }, is('bastion.fallen'), is('story.bastion.fallen')] };
const bastionFallen: Cond = { any: [{ episode: { min: 11 } }, { fact: 'bastion.fallen' }, { fact: 'story.bastion.fallen' }] };

export const ARCS: Arc[] = [
  // ── Odile Fenn: the Last Timetable moves ─────────────────────────────
  {
    id: 'odile',
    person: 'odile',
    title: 'The Bar Moves',
    blurb: 'The Last Timetable at Anchorage shuts; Odile needs a stake and her DELAYED board to open again at the Moot-Hold.',
    start: { any: [BASTION_FALLEN, { clock: 150 * M }] },
    first: 'shut',
    steps: {
      shut: {
        at: ['rustwake-freeport', 'corouhold-freeport'],
        status: 'The Anchorage bar is shut. Odile is sleeping behind a stack of mugs at the Moot-Hold, looking for a stake.',
        contract: 'odile-board',
        talk: talk(
          'Last Orders',
          {
            fall: say('odile', 'The Dawn\'s crews drank at my Anchorage bar. After the Bastion, the Board reallocated the berth. To grief counselling. There\'s a form.', 'hello'),
            lease: say('odile', 'The Board of Allocation pulled the Anchorage lease. "Discretionary expenditure." I am, apparently, discretionary.', 'hello'),
            hello: ask('odile', 'The clans will rent me a corner here, under their protection, for two thousand shares. And my board is still hanging in the Graveyard. DELAYED, for once accurate.', [
              ch('Here\'s your stake. (2,000 sh)', 'staked', { if: { all: [{ credits: 2000 }, { not: { fact: 'npc.odile.stake' } }] }, effects: [{ credits: -2000 }, set('npc.odile.stake')], locked: '(2,000 sh)' }),
              ch('I\'ll fetch the board.', 'board', { if: { not: holding('odile-board') }, effects: [{ contract: 'odile-board' }] }),
              ch('Where is the board, exactly?', 'where'),
              ch('Keep the light, Odile.', null),
            ]),
            where: say('odile', 'Old Cass has it crated at the Graveyard Breakers. He won\'t let a stranger take it. Carry my claim ticket to him and he\'ll ship it on your say.', 'hello'),
            staked: say('odile', 'Well. I\'ll write your name on the first mug on the hook — the right way up. Don\'t make me turn it.', 'hello'),
            board: say('odile', 'Here\'s the ticket. Tell Cass the board says DELAYED and I say it\'s time. He\'ll understand. He hates it when I\'m poetic.', 'hello'),
          },
          [{ if: bastionFallen, node: 'fall' }, { node: 'lease' }],
        ),
        next: [
          { to: 'fitting', when: is('npc.odile.stake') },
          { to: 'gone', when: after(180) },
        ],
      },
      fitting: {
        at: ['rustwake-freeport', 'corouhold-freeport'],
        status: 'The new Last Timetable is being fitted out at the Moot-Hold. The DELAYED board is still at the Graveyard.',
        contract: 'odile-board',
        talk: talk('Fitting Out', {
          hello: ask('odile', 'Clan welders are putting in a bar that used to be a Scrapjack\'s wing. It still has the kill marks. I\'m keeping them. Customers like a story.', [
            ch('The board?', 'board', { if: { not: holding('odile-board') }, effects: [{ contract: 'odile-board' }] }),
            ch('Looks good.', 'good'),
            ch('Keep the light.', null),
          ]),
          board: say('odile', 'Cass has it crated. Take him my claim ticket. Mind the plaques — his, not mine.', 'hello'),
          good: say('odile', 'It looks like a bar. Without the board it\'s just a room where people drink. There\'s a difference. The difference is waiting.', 'hello'),
        }),
        next: [
          { to: 'open', when: won('odile-board') },
          { to: 'bare', when: { any: [lost('odile-board'), after(120)] } },
        ],
      },
      open: {
        at: ['rustwake-freeport', 'corouhold-freeport'],
        status: 'The Last Timetable is open again at the Moot-Hold, board over the till: DELAYED. Your mug is on the hook.',
        end: 'good',
        sets: { 'npc.odile.bar': 'rustwake-freeport' },
        talk: talk('The Board Over the Till', {
          hello: say('odile', 'Service will resume shortly. It says so right there. Your mug\'s on the hook, pilot — the right way up. Keep it that way.', 'hello2', undefined, '運行はまもなく再開します。'),
          hello2: ask('odile', 'People talk across this bar the way they did at Anchorage. {memory} I don\'t repeat it. I keep it.', [ch('Pour me one. (12 sh)', 'pour', { if: { credits: 12 }, effects: [{ credits: -12 }], locked: '(12 sh)' }), ch('Goodnight, Odile.', null)]),
          pour: say('odile', 'On the house, but I\'ve taken the twelve anyway. The clans say a free drink is a debt with a smile on. Drink up.'),
        }),
      },
      bare: {
        at: ['rustwake-freeport', 'corouhold-freeport'],
        status: 'Odile opened at the Moot-Hold without her board. It isn\'t the same, and she says so every night.',
        end: 'bad',
        talk: talk('No Board', {
          hello: say('odile', 'Opened without it. There\'s a blank square on the wall where DELAYED should be. The regulars keep looking at it, like a clock that\'s stopped.', 'hello2'),
          hello2: say('odile', 'Cass sold it to a Treasury collector in the end. Somewhere in Hesper, my great-great-grandmother\'s board says DELAYED to people who don\'t get the joke.'),
        }),
      },
      gone: {
        at: [],
        status: 'Odile took a berth on a liner out of the Belt. Nobody knows where. Somewhere, a board says DELAYED.',
        end: 'missed',
      },
    },
  },

  // ── Magpie: forty grams, and the man who bought the paper ─────────────
  {
    id: 'magpie',
    person: 'magpie',
    title: 'Forty Grams',
    blurb: 'Magpie owes the Harrow clan forty grams for the Due\'s refit. Ninefingers Crane buys the paper and comes to collect.',
    start: { clock: 25 * M },
    first: 'debt',
    steps: {
      debt: {
        at: ['rustwake-freeport', 'rustwake-refinery'],
        status: 'The Moot has called in Magpie\'s debt: forty grams for the Due\'s refit. She is pretending not to mind.',
        talk: talk('Forty Grams', {
          hello: ask('magpie', 'Forty grams, sweetheart. The Due\'s new drive, on Harrow clan paper, and the Moot says it\'s due. Funny word. Due. Named her after it.', [
            ch('I\'ll cover it. (3,000 sh)', 'paid', { if: { credits: 3000 }, effects: [{ credits: -3000 }, set('npc.magpie.paid')], locked: '(3,000 sh)' }),
            ch('And if you can\'t pay?', 'cant'),
            ch('Who holds the paper?', 'who'),
            ch('Good luck, Magpie.', null),
          ]),
          cant: say('magpie', 'Then Harrow sells the paper. Somebody always buys it. Paper\'s cheaper than ships, and it comes with a ship attached.', 'hello'),
          who: say('magpie', 'Harrow, for now. There\'s a rumour Ninefingers Crane wants it. The Moot outlawed him for selling our routes. He\'d love to own mine.', 'hello'),
          paid: say('magpie', 'You — right. Friends pay nothing. I didn\'t say friends pay for you. I\'ll remember it, love. The clans remember everything but birthdays.'),
        }),
        next: [
          { to: 'square', when: is('npc.magpie.paid') },
          { to: 'hunted', when: after(45) },
        ],
      },
      hunted: {
        at: ['quilegard-freeport', 'yoriamere-freeport'],
        status: 'Ninefingers Crane bought Magpie\'s paper. His cutters are hunting the Due; she has gone to ground at Quilegard.',
        contract: 'magpie-crane',
        sets: { 'npc.ninefingers.hunting': 'magpie' },
        talk: talk('Gone to Ground', {
          hello: ask('magpie', 'Crane bought the paper. Forty grams and a clause: the Due, her routes, and me to fly her for him. His cutters have been at every moot asking for my paint.', [
            ch('I\'ll put Crane in the dark.', 'job', { if: { not: holding('magpie-crane') }, effects: [{ contract: 'magpie-crane' }] }),
            ch('Buy the paper back. (3,500 sh)', 'bought', { if: { credits: 3500 }, effects: [{ credits: -3500 }, set('npc.magpie.paid')], locked: '(3,500 sh)' }),
            ch('Where is he?', 'where'),
            ch('Stay hidden.', null),
          ]),
          job: say('magpie', 'He sits in wrecks and waits. Nine fingers, one grudge per finger. Bring me his transponder and the paper burns with it.', 'hello'),
          bought: say('magpie', 'He\'ll take it. He hates it, but he\'ll take it; grams are grams. You\'ve just bought a hauler, love. Don\'t tell her. She\'s proud.'),
          where: say('magpie', 'Wherever I\'m not. He\'ll hear you asked. {memory} He listens to that sort of thing.', 'hello'),
        }),
        next: [
          { to: 'free', when: { any: [won('magpie-crane'), is('npc.ninefingers.status', 'dead')] } },
          { to: 'square', when: is('npc.magpie.paid') },
          { to: 'taken', when: lost('magpie-crane') },
          { to: 'lost', when: after(150) },
        ],
      },
      free: {
        at: ['rustwake-freeport', 'rustwake-refinery'],
        status: 'Crane is in the dark and his paper burned with him. Magpie charges you nothing, and means it.',
        end: 'good',
        sets: { 'npc.magpie.friend': true, 'npc.ninefingers.hunting': false },
        talk: talk('Paper Burns', {
          hello: say('magpie', 'There\'s my fossil-jockey. I burned the paper in the moot fire. Whole hall sang. Tuneless, but loud.', 'hello2'),
          hello2: ask('magpie', 'You asked me once what a friend pays. Now you know. Nothing, forever. It\'s a terrible deal. I\'m thrilled.', [ch('Sing the verse about Crane.', 'song'), ch('See you at Odile\'s.', null)]),
          song: say('magpie', '(sung) Oh, nine fingers had Hollis, and nine grudges too, and he counted them all till the tenth one was you—', 'hello2'),
        }),
      },
      square: {
        at: ['rustwake-freeport', 'rustwake-refinery'],
        status: 'You paid Magpie\'s debt. The Due is hers again; Crane is still out there, sulking.',
        end: 'good',
        sets: { 'npc.magpie.friend': true, 'npc.ninefingers.hunting': false },
        talk: talk('Square', {
          hello: say('magpie', 'All square with Harrow, and Crane can chew his own nine fingers. You bought me a hauler, love. I\'m going to be unbearable about it.'),
        }),
      },
      taken: {
        at: ['quilegard-salvage', 'yoriamere-salvage'],
        status: 'Crane took the Due. Magpie is crewing a breaker at Quilegard to work off the paper.',
        end: 'bad',
        talk: talk('Working It Off', {
          hello: say('magpie', 'Don\'t look at me like that. It\'s honest work, breaking. I take ships apart all day and think about which bit of Crane each one is.'),
        }),
      },
      lost: {
        at: [],
        status: 'The Due was found stripped at Quilegard. Magpie is alive, they say, flying for Crane. Nobody has heard her sing since.',
        end: 'missed',
      },
    },
  },

  // ── Inspector Pell Varga: the witness ─────────────────────────────────
  {
    id: 'pell',
    person: 'pell',
    title: 'The Witness',
    blurb: 'Pell re-audits the quarters he signed and finds the Schedule. He needs a courier for a copy, and then a witness.',
    start: { any: [{ episode: 8 }, is('schedule.known'), is('story.schedule'), { clock: 90 * M }] },
    first: 'ledgers',
    steps: {
      ledgers: {
        at: ['meridian-orbital', 'meridian-refinery'],
        status: 'Pell Varga is re-auditing the quarters he signed. The numbers still balance. That is the problem.',
        contract: 'pell-witness',
        talk: talk('Balanced Books', {
          hello: say('pell', 'Purely routine. I have re-audited nine years of my own signatures. Engagement expenditures agreed in advance. Pencilled in. Balanced to the gram.', 'hello2'),
          hello2: ask('pell', 'There is a sealed copy. The Cloister at Anchorage keeps records the Board cannot reallocate. Someone must carry it, and Continuity will send a knife after them.', [
            ch('I\'ll carry it.', 'carry', { if: { not: holding('pell-witness') }, effects: [{ contract: 'pell-witness' }] }),
            ch('Burn it, Inspector. Live.', 'burn', { effects: [set('npc.pell.choice', 'burn')] }),
            ch('Why me?', 'why'),
            ch('Good day, Inspector.', null),
          ]),
          why: say('pell', 'Because you are on the list. "Costly and visible." I would rather the costly and visible carried it than the careful and invisible. That was me.', 'hello2'),
          carry: say('pell', 'Thank you. Do not open it. Do not scan it. The knife is called Vosk, and he does not do paperwork either.', 'hello2'),
          burn: say('pell', 'Yes. Of course. Stamped, filed, forgotten. I\'m very good at forgetting. I\'ve had nine years of practice.'),
        }),
        next: [
          { to: 'testimony', when: won('pell-witness') },
          { to: 'counting', when: is('npc.pell.choice', 'burn') },
          { to: 'reassigned', when: { any: [lost('pell-witness'), after(150)] } },
        ],
      },
      testimony: {
        at: ['anchorage-bastion', 'anchorage-salvage'],
        status: 'The copy reached the Cloister. Pell waits at Anchorage to be called — or quietly reassigned. He needs a second witness.',
        talk: talk('A Second Witness', {
          hello: say('pell', 'The Cloister has the copy. The wardens read it the way they read a failing reactor: very slowly, saying the words.', 'hello2'),
          hello2: ask('pell', 'A ledger is only numbers. They want someone who flew the numbers. {memory} Would you say what you saw, under your own name?', [
            ch('I\'ll testify.', 'yes', { effects: [set('npc.pell.witness'), { standing: 'concord', delta: -3 }] }),
            ch('I can\'t. Not yet.', 'no'),
            ch('Good day, Inspector.', null),
          ]),
          yes: say('pell', 'Then it\'s two of us. Continuity will note it. I have always wanted to be the thing that gets noted.'),
          no: say('pell', 'No. Not yet. I said that for nine years. I understand it better than anyone.', 'hello2'),
        }),
        next: [
          { to: 'witnessed', when: is('npc.pell.witness') },
          { to: 'reassigned', when: after(90) },
        ],
      },
      witnessed: {
        at: ['anchorage-bastion', 'anchorage-salvage'],
        status: 'Pell testified before the Cloister, with your name beside his. Continuity has noted it. So has the Knife.',
        end: 'good',
        sets: { 'schedule.witnessed': true },
        talk: talk('Noted', {
          hello: say('pell', 'I read my own signatures aloud. Nine years of them. A warden kept count on her fingers and ran out, and kept going.', 'hello2'),
          hello2: say('pell', 'I don\'t only count any more. I\'m told it shows. I\'m told it\'s very unprofessional. Good day, pilot. Truly.'),
        }),
      },
      counting: {
        at: ['meridian-orbital', 'meridian-refinery'],
        status: 'Pell burned the copy and went back to counting. He counts very carefully now, and never looks up.',
        end: 'bad',
        talk: talk('Purely Routine', {
          hello: say('pell', 'Everything is purely routine. I have checked. Twice. Please don\'t ask me about anything that isn\'t.'),
        }),
      },
      reassigned: {
        at: ['null-bastion'],
        status: 'Inspector Varga has been reassigned to audit the Null Picket. Its coffee, mainly.',
        end: 'missed',
        talk: talk('Reassigned', {
          hello: say('pell', 'Continuity felt my talents were wasted on the core. Out here I audit coffee. The pickets steal it faster than I can count it.', 'hello2'),
          hello2: say('pell', 'At night there\'s a burst from past the Lantern. It counts too. We are, I think, the only two auditors in the Reach who can\'t be bribed.'),
        }),
      },
    },
  },

  // ── Nadia Sorel: the lists ────────────────────────────────────────────
  {
    id: 'nadia',
    person: 'nadia',
    title: 'The Lists',
    blurb: 'Nadia reads refugee rolls station by station looking for her brother Tomas. A ration registry core could tell her where he went.',
    start: { clock: 12 * M },
    first: 'lists',
    steps: {
      lists: {
        at: ['lysowick-salvage', 'lysowick-bastion'],
        status: 'Nadia is reading refugee lists at the Lysowick Boneyard, station by station, looking for Tomas.',
        contract: 'nadia-registry',
        talk: talk('The Lists', {
          hello: say('nadia', 'Every station keeps its own list, and none of them agree. Tomas is on three as "transferred", one as "expended", and one as "boots owed". That one\'s mine.', 'hello2'),
          hello2: ask('nadia', 'The old ration registry went down with a tender in the Engagement 114 debris. Its core would say where every card was moved. Could you find it?', [
            ch('I\'ll find the core.', 'job', { if: { not: holding('nadia-registry') }, effects: [{ contract: 'nadia-registry' }] }),
            ch('Take these rations.', 'fed', { if: { cargo: 'rations' }, effects: [{ cargo: 'rations', delta: -1 }, set('npc.nadia.fed')], locked: '(no rations in the hold)' }),
            ch('Fly safe, Nadia.', null),
          ]),
          job: say('nadia', 'It\'s in the pressed-flower layer. Eleven fighters and a tender. Somebody\'s flight core is down there remembering all of it. Thank you.', 'hello2'),
          fed: say('nadia', 'That\'s four more days of reading. You\'d be surprised how hungry reading makes you.', 'hello2'),
        }),
        next: [
          { to: 'found', when: won('nadia-registry') },
          { to: 'moving', when: after(80) },
        ],
      },
      moving: {
        at: ['fenazar-orbital', 'pelestead-orbital'],
        status: 'Nadia followed a rumour to Fenazar. The lists there are longer. She still has the letter.',
        contract: 'nadia-registry',
        talk: talk('Longer Lists', {
          hello: ask('nadia', 'Someone at Lysowick said a Sorel was moved to Fenazar. It was a different Sorel. She was very kind about it. She\'s looking for someone too.', [
            ch('The registry core — I\'ll get it.', 'job', { if: { not: holding('nadia-registry') }, effects: [{ contract: 'nadia-registry' }] }),
            ch('Don\'t stop looking.', null),
          ]),
          job: say('nadia', 'It\'s still down there at Lysowick, in the debris. I\'ll wait. I\'m very good at waiting. The whole Reach is.'),
        }),
        next: [
          { to: 'found', when: won('nadia-registry') },
          { to: 'trail', when: { any: [lost('nadia-registry'), after(100)] } },
        ],
      },
      found: {
        at: ['pelestead-salvage', 'fenazar-salvage'],
        status: 'The registry put Tomas at Pelestead, rigging salvage. Nadia found him there. He owes her boots.',
        end: 'good',
        sets: { 'npc.nadia.tomas': 'found' },
        talk: talk('Boots', {
          hello: say('nadia', 'He was transferred off the Dawn two weeks before — before everything. A rigger shortage at Pelestead. The Board moved him like a crate. It saved his life.', 'hello2'),
          hello2: say('tomas-sorel', 'You\'re the pilot? She says you went down into the Lysowick layers for a ration card. For me. I laughed. Sorry. I laugh like a door.', 'hello3'),
          hello3: say('nadia', 'He still owes me boots. I\'m keeping the letter. It says I\'m alive. It turns out that\'s all a letter ever needs to say.'),
        }),
      },
      trail: {
        at: ['lysowick-salvage', 'lysowick-bastion'],
        status: 'Nadia stopped reading the lists. She keeps the letter, and a berth at the Lysowick Boneyard.',
        end: 'missed',
        talk: talk('The Letter', {
          hello: say('nadia', 'I stopped reading the lists. You start seeing your own name on them. I\'m keeping the letter. When he turns up he still owes me boots.'),
        }),
      },
    },
  },

  // ── Ensign Toma Kerrigan: the count ───────────────────────────────────
  {
    id: 'toma',
    person: 'toma',
    title: 'The Count',
    blurb: 'Back on the Null picket, Kerrigan logs every Signal burst by hand and stops sleeping. Then he takes a Kestrel out to answer it.',
    start: { any: [{ episode: 5 }, is('signal.heard'), { clock: 45 * M }] },
    first: 'insomnia',
    steps: {
      insomnia: {
        at: ['null-bastion', 'meridian-bastion'],
        status: 'Ens. Kerrigan is back on the Null picket, logging every burst by hand. He isn\'t sleeping.',
        talk: talk('Every Twenty-Five Hours', {
          hello: say('toma', 'Twenty-five hours, fifty-one minutes. I set an alarm. I don\'t need the alarm. I wake up a minute before it, counting.', 'hello2'),
          hello2: ask('toma', 'Corporal Skerry walked off this picket last quarter. Took a Kestrel and the coffee. Said he couldn\'t listen to it count any more. I understand him. That\'s the bad part.', [
            ch('Get some sleep, Ensign. That\'s an order from a friend.', 'rest', { effects: [set('npc.toma.rest')] }),
            ch('Report yourself unfit. Before it gets worse.', 'report', { effects: [set('npc.toma.report')] }),
            ch('What happens at the end of the count?', 'end'),
            ch('Keep your head down.', null),
          ]),
          end: say('toma', 'Two\'s the last prime. After that, I suppose it has to do something else. I\'d like to be awake for it. I\'d like to be asleep for it. Both.', 'hello2'),
          rest: say('toma', 'A friend. Right. Nobody\'s given me an order I wanted to follow in three months. I\'ll try. Eleven hours. I\'ll count them.'),
          report: say('toma', 'You\'re right. You\'re probably right. They\'ll take my wings and give me a desk facing a wall. At least walls don\'t count.'),
        }),
        next: [
          { to: 'steady', when: { all: [is('npc.toma.rest'), after(20)] } },
          { to: 'grounded', when: is('npc.toma.report') },
          { to: 'cracked', when: after(40) },
        ],
      },
      cracked: {
        at: ['null-bastion', 'meridian-bastion'],
        host: 'picket-okafor',
        status: 'Kerrigan took a picket Kestrel out to the Null Lantern to answer the count. He isn\'t answering the picket.',
        contract: 'toma-null',
        talk: talk('Transponder Off', {
          hello: say('picket-okafor', 'Captain Okafor, Lantern Watch. My ensign is sitting in front of the Null Lantern with his transponder off and his radio on, counting back at it.', 'hello2'),
          hello2: ask('picket-okafor', 'He trusts you. Don\'t ask me why; I\'ve read your file. Go out there and talk him home before a Choir picket decides he\'s a threat.', [
            ch('I\'ll bring him in.', 'job', { if: { not: holding('toma-null') }, effects: [{ contract: 'toma-null' }] }),
            ch('What\'s he saying?', 'saying'),
            ch('Keep the light, Captain.', null),
          ]),
          saying: say('picket-okafor', 'Primes. Descending. And then, in between, "hello". Same word your core sent. The whole picket heard that too, pilot.', 'hello2'),
          job: say('picket-okafor', 'Sit beside him and let him talk. Then fly him home. I\'ve buried pilots. I\'m not burying one who was just listening.', 'hello2'),
        }),
        next: [
          { to: 'home', when: won('toma-null') },
          { to: 'gone', when: { any: [lost('toma-null'), after(120)] } },
        ],
      },
      home: {
        at: ['anchorage-bastion', 'anchorage-orbital'],
        status: 'Kerrigan came home. He teaches the count to cadets at Anchorage now — as arithmetic, not scripture.',
        end: 'good',
        sets: { 'npc.toma.home': true },
        talk: talk('Arithmetic', {
          hello: say('toma', 'I teach it as arithmetic. Here\'s a sequence; what comes next? The cadets get it in a minute. Then one of them always asks: then what? Good question, I say.', 'hello2'),
          hello2: say('toma', 'Thanks for sitting with me out there. You didn\'t say much. That was the right amount.'),
        }),
      },
      steady: {
        at: ['null-bastion', 'meridian-bastion'],
        status: 'Kerrigan slept eleven hours and kept his wings. He still logs the bursts. He sleeps through the alarm now.',
        end: 'good',
        sets: { 'npc.toma.home': true },
        talk: talk('Eleven Hours', {
          hello: say('toma', 'Slept eleven hours. The count went down by one prime without me. It turns out the universe doesn\'t need me awake to do arithmetic. Very restful.'),
        }),
      },
      grounded: {
        at: ['meridian-bastion', 'anchorage-bastion'],
        status: 'Kerrigan reported himself unfit. They took his wings and gave him a desk facing a wall.',
        end: 'bad',
        talk: talk('A Desk', {
          hello: say('toma', 'Desk. Wall. Forms about coffee. It\'s fine. I still wake up a minute before the burst. I just don\'t have a window to look out of now.'),
        }),
      },
      gone: {
        at: [],
        status: 'The picket found Kerrigan\'s Kestrel drifting at the Null Lantern, canopy open, log full of primes.',
        end: 'missed',
      },
    },
  },

  // ── Schoolmistress Dalca and Pieter: Class Four goes out ─────────────
  {
    id: 'imre',
    person: 'imre',
    title: 'Class Four Goes Out',
    blurb: 'The heritage tour\'s escort is reallocated; the school tender Slate and Chalk means to reach Lysowick anyway.',
    start: { clock: 15 * M },
    first: 'tour',
    steps: {
      tour: {
        at: ['anchorage-salvage', 'anchorage-bastion'],
        status: 'Class Four\'s school tender, the Slate and Chalk, waits at Anchorage for an escort the Board has reallocated.',
        contract: 'dalca-tender',
        talk: talk('Reallocated', {
          hello: say('imre', 'The Board reallocated our escort to "priority expenditure". Class Four has been reallocated to disappointment. Pieter has written a complaint.', 'pieter'),
          pieter: say('imre-pupil', 'It\'s three pages. The last page is just the word WHY. Miss says that\'s not a complaint, it\'s philosophy.', 'hello2'),
          hello2: ask('imre', 'The Slate and Chalk is a school tender, not a warship. Lysowick is two Lanterns and a great many raiders. Would you fly with us?', [
            ch('I\'ll escort the Slate and Chalk.', 'job', { if: { not: holding('dalca-tender') }, effects: [{ contract: 'dalca-tender' }] }),
            ch('Take them home, Miss Dalca. It isn\'t safe.', 'home', { effects: [set('npc.imre.home')] }),
            ch('Good afternoon, Class Four.', null),
          ]),
          job: say('imre-pupil', 'A real escort! Miss, it\'s a real one! Can we have the radio on? We\'ll be quiet. We won\'t be quiet.', 'hello2'),
          home: say('imre', 'You\'re right. Of course you\'re right. Pieter, put the complaint away. — No, keep it. Somebody should keep it.'),
        }),
        next: [
          { to: 'lysowick', when: won('dalca-tender') },
          { to: 'home', when: is('npc.imre.home') },
          { to: 'stranded', when: { any: [lost('dalca-tender'), after(120)] } },
        ],
      },
      lysowick: {
        at: ['lysowick-bastion', 'lysowick-salvage'],
        status: 'Class Four made it. They are sketching the pressed-flower wrecks from the Lysowick Watch.',
        talk: talk('Layers', {
          hello: say('imre-pupil', 'Every layer is a battle! Miss says don\'t count them. I counted them. Four. The top one is still warm on the instruments.', 'hello2'),
          hello2: ask('imre', 'Thank you for bringing us. They\'ll remember this longer than any lesson. So will I. {memory}', [ch('What will you tell them about it?', 'tell'), ch('Keep the light, Class Four.', null)]),
          tell: say('imre', 'The truth, for once. That people fought here on a schedule, and some didn\'t come home, and that "nowhere" is not a place. Pieter\'s rule.'),
        }),
        next: [{ to: 'essay', when: after(30) }],
      },
      essay: {
        at: ['meridian-orbital', 'anchorage-orbital'],
        status: 'Pieter\'s essay, "Somewhere That Isn\'t Anywhere, Yet", won the Castellan schools prize. Dalca pretends not to be proud.',
        end: 'good',
        talk: talk('Yet', {
          hello: say('imre-pupil', 'I won! It\'s about the ships in the big ring. I put you in it. I said you flew us through the Lanterns and didn\'t say anything, like a real pilot.', 'hello2'),
          hello2: say('imre', 'The examiners called it "unusually hopeful for the curriculum." I\'m having it framed. Don\'t tell the Board.'),
        }),
      },
      home: {
        at: ['anchorage-orbital', 'anchorage-bastion'],
        status: 'Class Four went home safely. Pieter\'s three-page complaint is on file with the Board, unread.',
        end: 'good',
        talk: talk('Home', {
          hello: say('imre-pupil', 'We went home. It was safe. Safe is boring. Miss says boring is a privilege. I wrote that down too. Under WHY.'),
        }),
      },
      stranded: {
        at: ['lysowick-salvage', 'lysowick-bastion'],
        status: 'The Slate and Chalk went without an escort and was holed by raiders. Nobody died. Dalca teaches refugee children at the Boneyard now.',
        end: 'bad',
        talk: talk('The Boneyard School', {
          hello: say('imre', 'Nobody was hurt. The tender won\'t fly again. The Board says the tour is "concluded". I say the school has moved.', 'hello2'),
          hello2: say('imre-pupil', 'I teach the little ones the Lanterns. I tell them nowhere isn\'t a place. They believe me. Grown-ups don\'t.'),
        }),
      },
    },
  },

  // ── Warden-Sister Maud: the Sixth Keeping ─────────────────────────────
  {
    id: 'maud',
    person: 'maud',
    title: 'The Sixth Keeping',
    blurb: 'The Graveyard breaker reactor is failing and the Keepings are not working. Maud wants to ask the engine why.',
    start: { any: [{ episode: 7 }, { clock: 35 * M }] },
    first: 'failing',
    steps: {
      failing: {
        at: ['anchorage-salvage', 'anchorage-bastion'],
        status: 'The Graveyard\'s breaker reactor is failing. Maud has said the Keepings over it for nine days. It is still failing.',
        contract: 'maud-core',
        talk: talk('We Do Not Ask', {
          hello: say('maud', 'Four hundred breakers sleep warm because of that reactor. Nine days I\'ve counted the Keepings over it. The seal holds. The feed runs clean. It fails anyway.', 'hello2'),
          hello2: ask('maud', 'Sixth: we do not ask the engine why. But a golden-age core can read another\'s fault log, like a dictionary. I could ask. I would be breaking my vow.', [
            ch('I\'ll find you a core. Ask it.', 'job', { if: { not: holding('maud-core') }, effects: [{ contract: 'maud-core' }] }),
            ch('Keep the Keeping, Sister.', 'keep', { effects: [set('npc.maud.choice', 'keep')] }),
            ch('What happens if you ask?', 'if'),
            ch('Keep the light.', null),
          ]),
          if: say('maud', 'Candle says the Keepings are what we kept when we forgot the why. If the engine answers, we have to remember. Remembering is heavier.', 'hello2'),
          job: say('maud', 'There\'s a golden-age hulk turning in the Anchorage belt. Its core is sealed and holy and very probably furious. Bring it here. I\'ll ask.', 'hello2'),
          keep: say('maud', 'Yes. Seventh: we thank it, and we go. I\'ll thank it every hour it holds. Hollis Marrow kept four reactors alive thirty-one winters on words.'),
        }),
        next: [
          { to: 'asked', when: won('maud-core') },
          { to: 'kept', when: is('npc.maud.choice', 'keep') },
          { to: 'cold', when: { any: [lost('maud-core'), after(130)] } },
        ],
      },
      asked: {
        at: ['anchorage-salvage', 'anchorage-bastion'],
        status: 'Maud asked. The engine answered in a Timetable-Era maintenance code. The reactor runs; the Cloister has summoned her.',
        end: 'good',
        sets: { 'npc.maud.asked': true },
        talk: talk('It Answered', {
          hello: say('maud', 'I asked. The core read the fault and printed a line in the old timetable dialect: COOLANT LOOP 3 REVERSED AT LAST SERVICE. SERVICE WILL RESUME.', 'hello2', undefined, '運行はまもなく再開します。'),
          hello2: ask('maud', 'Someone reversed a pipe six hundred years ago and we prayed over it for four centuries. We fixed it in an hour. The Cloister wants a word. Several.', [ch('Will you tell them?', 'tell'), ch('Keep the light, Sister.', null)]),
          tell: say('maud', 'I\'ll tell them the engine answered when we asked. Then I\'ll say the Keepings anyway. There might be an eighth. Somebody should write it down.'),
        }),
      },
      kept: {
        at: ['anchorage-bastion', 'anchorage-salvage'],
        status: 'Maud kept the Sixth Keeping. The reactor held thirty-one more days, the way Hollis Marrow\'s did. Then it didn\'t.',
        end: 'bad',
        talk: talk('Thirty-One Days', {
          hello: say('maud', 'It held thirty-one days. I thanked it every hour. Then it went cold, and four hundred breakers moved to the Fleet Yards. Nobody died.', 'hello2'),
          hello2: say('maud', 'I kept my vow. I\'m not sure, now, who I kept it for.'),
        }),
      },
      cold: {
        at: ['anchorage-bastion'],
        status: 'The Graveyard reactor went cold. Maud has gone back on circuit, and no longer says the Sixth Keeping aloud.',
        end: 'missed',
        talk: talk('Cold', {
          hello: say('maud', 'First keeping: the seal holds. Second... I skip the sixth now. Nobody has noticed. The engines don\'t seem to mind either.'),
        }),
      },
    },
  },
];
