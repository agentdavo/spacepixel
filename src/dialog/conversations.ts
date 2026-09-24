import type { Cond, Conversation, DialogChoice, DialogNode, Effect } from './types';

/**
 * Station conversations — the people of the Reach, in the series' voice
 * (docs/LORE.md: the cockpit, the machine, the sublime; grams, not credits;
 * nobody says "easy one"). Fourteen recurring people, each with a branching
 * conversation; several change with campaign progress (profile.episode).
 *
 * Vars: {station} {system} {callsign} {tip} {rumour}.
 */

// ── tiny authoring helpers ─────────────────────────────────────────────
const say = (who: string, line: string, next?: string, effects?: Effect[], jp?: string): DialogNode => ({ who, line, ...(next ? { next } : {}), ...(effects ? { effects } : {}), ...(jp ? { jp } : {}) });
const ask = (who: string, line: string, choices: DialogChoice[], effects?: Effect[], jp?: string): DialogNode => ({ who, line, choices, ...(effects ? { effects } : {}), ...(jp ? { jp } : {}) });
const ch = (text: string, next: string | null, extra: Partial<DialogChoice> = {}): DialogChoice => ({ text, next, ...extra });
const ep = (min?: number, max?: number): Cond => ({ episode: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } });
const LEAVE = (text = 'Keep the light.'): DialogChoice => ch(text, null);

export const CONVERSATIONS: Conversation[] = [
  // ── 1 · Odile Fenn, the Last Timetable ──────────────────────────────
  {
    id: 'odile-last-timetable',
    title: 'The Last Timetable',
    with: 'odile',
    entry: [{ if: ep(11), node: 'after' }, { if: { seen: 'odile-last-timetable' }, node: 'again' }, { node: 'hello' }],
    nodes: {
      hello: ask('odile', 'Welcome to the Last Timetable. Every station in the Reach has one, and every one of them has me. Don\'t ask how.', [
        ch('Why call it the Last Timetable?', 'name'),
        ch('Pour me something. (12 sh)', 'drink', { if: { credits: 12 }, effects: [{ credits: -12 }], locked: '(not enough shares)' }),
        ch('What\'s the talk tonight?', 'talk'),
        LEAVE('Just passing through.'),
      ]),
      again: say('odile', 'Back again. The board still says DELAYED, if you were wondering. It is the one thing in the Reach you can rely on.', 'menu'),
      name: say('odile', 'My great-great-grandmother kept the bar at the Anchorage Great Lantern. The board over the till said DELAYED the day it all went dark. She never took it down.', 'name2'),
      name2: ask('odile', 'Four hundred and thirty-one years. Service will resume shortly. I keep the board polished for when it does.', [ch('And if it never does?', 'never'), ch('Fair enough.', 'menu')], undefined, '運行はまもなく再開します。'),
      never: say('odile', 'Then I\'ll have kept a clean bar for nothing, and there are worse ways to spend a life. Ask any warden.', 'menu'),
      drink: say('odile', 'Cradle-pattern gin, or what the Board calls gin. Mugs go on the hook over there — pilots\' tradition. Yours isn\'t up yet. Keep it that way.', 'menu', [{ setFlag: 'odile-drink' }]),
      talk: say('odile', 'What I hear across the bar: {rumour}', 'menu', [{ rumour: '{rumour}' }]),
      after: say('odile', 'The Dawn\'s crews drank at my bars. I\'ve taken their mugs down off the hooks and I\'m keeping them behind the till. Somebody should.', 'after2'),
      after2: say('odile', 'Captain Oyelaran tipped in ration chits. Said the grams were better spent on people than on him. He was wrong about that. Only that.', 'menu', [{ setFlag: 'odile-mugs' }]),
      menu: ask('odile', 'Anything else, pilot?', [
        ch('Tell me about the name again.', 'name'),
        ch('Another. (12 sh)', 'drink', { if: { credits: 12 }, effects: [{ credits: -12 }], locked: '(not enough shares)' }),
        ch('What\'s the talk?', 'talk'),
        LEAVE('Goodnight, Odile.'),
      ]),
    },
  },

  // ── 2 · Old Cass, the Graveyard breaker ─────────────────────────────
  {
    id: 'cass-plaques',
    title: 'The Graveyard Breaker',
    with: 'cass',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('cass', 'Forty ships died halfway through the Great Lantern, and I\'ve been taking them apart for sixty years. Mind the plaques.', [
        ch('What happened to them?', 'shatter'),
        ch('What plaques?', 'plaques'),
        ch('I have relics to sell.', 'sell', { if: { cargo: 'relics' }, locked: '(no relics in the hold)' }),
        LEAVE('I\'ll let you work.'),
      ]),
      shatter: say('cass', 'Same thing that happened to everyone. The Lanterns went dark, and whatever was in the throat went somewhere that isn\'t anywhere.', 'shatter2'),
      shatter2: ask('cass', 'Half of each ship came back. The front half, mostly. You find cups still on the tables. You stop finding it strange after the first decade.', [ch('Where did the other halves go?', 'where'), ch('Back to business.', 'menu')]),
      where: say('cass', 'Directorate says nowhere. Hegemony says to judgment. I say if you ever find out, you owe me a drink at Odile\'s.', 'menu', [{ codex: 'hist-shattering' }]),
      plaques: say('cass', 'Every berth had one: the route, the minutes, a word. ON TIME. BOARDING. DELAYED. The DELAYED ones fetch double. People like a joke that took four hundred years.', 'menu', [{ codex: 'log-timetable-beacon' }]),
      sell: ask('cass', 'Let\'s see. Sealed module, pre-Shattering, seal intact. Double what the yard bids, because you didn\'t open it.', [
        ch('Sold. (+740 sh)', 'sold', { effects: [{ cargo: 'relics', delta: -1 }, { credits: 740 }, { standing: 'concord', delta: 1 }] }),
        ch('I\'ll keep it.', 'menu'),
      ]),
      sold: say('cass', 'Good. Wardens say a sealed heart is a holy heart. I say a sealed heart is worth more. We\'re both right.', 'menu'),
      menu: ask('cass', 'Anything else? I\'ve a liner to take apart and she\'s taking her time about it.', [
        ch('The plaques again?', 'plaques'),
        ch('I have relics.', 'sell', { if: { cargo: 'relics' }, locked: '(no relics in the hold)' }),
        LEAVE('Mind your fingers, Cass.'),
      ]),
    },
  },

  // ── 3 · Warden-Sister Maud, the Keepings ────────────────────────────
  {
    id: 'maud-keepings',
    title: 'The Seven Keepings',
    with: 'maud',
    entry: [{ if: ep(19), node: 'broken' }, { node: 'hello' }],
    nodes: {
      hello: ask('maud', 'You fly 0413. Don\'t look surprised — every warden in the Reach knows that core. It hums near Lanterns, they say.', [
        ch('It does hum. Should I worry?', 'hum'),
        ch('Teach me the Keepings.', 'keep1'),
        ch('Would you bless the engine?', 'bless', { if: { notFlag: 'maud-blessed' } }),
        LEAVE('Keep the light, Sister.'),
      ]),
      hum: say('maud', 'Worry? No. A sealed heart is a holy heart. We do not ask the engine why. That\'s the Sixth Keeping, and the one that keeps us alive.', 'hum2'),
      hum2: say('maud', 'Though, between us — I once heard that core hum a tune. Four notes, rising, like a Cantor\'s Intonation. I told no one. Now I\'ve told you.', 'menu', [
        { rumour: 'A warden swears airframe 0413\'s sealed core hums four rising notes near Lanterns — like the Choir\'s Intonation.' },
      ]),
      keep1: say('maud', 'Count them on your fingers. First: the seal holds. Second: the feed runs clean. Third: the fire is fed and not starved.', 'keep2', undefined, '第一の守り——封は保たれる。'),
      keep2: say('maud', 'Fourth: the cold is let out. Fifth: the old words are said. Sixth: we do not ask the engine why. Seventh: we thank it, and we go.', 'keep3', [{ codex: 'tech-keepings' }]),
      keep3: say('maud', 'Hollis Marrow kept four reactors alive for thirty-one winters with those words. People call it superstition. People are warm because of it.', 'menu'),
      bless: say('self', '(She lays her torque-key against the intake cowl and counts the Keepings under her breath, one finger at a time.)', 'bless2', [{ setFlag: 'maud-blessed' }, { standing: 'concord', delta: 2 }]),
      bless2: say('maud', 'There. It won\'t fly any better. You will.', 'menu'),
      broken: say('maud', 'They say one of ours opened the Patience\'s archive. Broke the Sixth Keeping with his own hands. Oduya. Candle, you call him.', 'broken2'),
      broken2: ask('maud', 'Half the Cloister wants his key taken. The other half has gone very quiet. I keep thinking: what if the engine answers when we ask?', [
        ch('It did answer.', 'answered', { if: ep(21) }),
        ch('What do you think?', 'think'),
        LEAVE(),
      ]),
      answered: say('maud', 'Then there\'s an Eighth Keeping, and nobody has written it down yet. Somebody had better. Somebody with steady hands.', 'menu', [{ setFlag: 'maud-eighth' }]),
      think: say('maud', 'I think I have spent my life saying words I didn\'t understand, and they kept people warm. Both of those things are true. I\'m learning to hold both.', 'menu'),
      menu: ask('maud', 'The Keepings go with you, pilot.', [
        ch('About the hum —', 'hum'),
        ch('The Keepings, once more.', 'keep1'),
        ch('A blessing?', 'bless', { if: { notFlag: 'maud-blessed' } }),
        LEAVE('And with you, Sister.'),
      ]),
    },
  },

  // ── 4 · Jory Tey, gas and the story ─────────────────────────────────
  {
    id: 'jory-ebon',
    title: 'Gas, or the Story',
    with: 'jory',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('jory', 'Tey. Yes, that Tey. Absalom was my grandmother\'s grandmother\'s uncle, and I get a discount on the story. You want gas, or you want the story?', [
        ch('The story.', 'story'),
        ch('What\'s Ebon actually like?', 'ebon'),
        ch('Gas. Under the floor.', 'deal', { if: { standing: 'rustwake', min: 10 }, locked: '(the clans don\'t know you well enough)' }),
        ch('Where does it all come from?', 'source'),
        LEAVE('Neither, thanks.'),
      ]),
      story: say('jory', 'Year two-twelve. Absalom skims Tessaly\'s corona and comes home with a hold of something that eats the light. Pours it in the dead Lantern\'s feed. Eleven seconds.', 'story2'),
      story2: say('jory', 'The pilot\'s first word from Meridian space was "Lit." The Keeping says it as a greeting now. The clans say it when the gram price drops.', 'menu', [{ codex: 'hist-relighting' }], '点灯。'),
      ebon: say('jory', 'Crack a flask in a dark hold and the dark gets darker. The edges of things glow violet, like somebody lit the room from outside. Your hands look like somebody else\'s.', 'ebon2'),
      ebon2: say('jory', 'Tastes of pennies from across the room. Everyone stops talking. You\'ll see.', 'menu', [{ codex: 'tech-ebon' }]),
      deal: ask('jory', 'The floor\'s eighty-eight a gram because two treasuries say so. For a friend of the clans: one flask, nine hundred. Don\'t tell Continuity.', [
        ch('Deal. (900 sh)', 'deal2', { if: { all: [{ credits: 900 }, { cargoSpace: 1 }] }, effects: [{ credits: -900 }, { cargo: 'ebon', delta: 1 }, { standing: 'rustwake', delta: 1 }], locked: '(900 sh and a free cargo slot)' }),
        ch('Too rich for me.', 'menu'),
      ]),
      deal2: say('jory', 'Pleasure. If anyone asks, you found it. Nothing in the black is ever truly lost.', 'menu'),
      source: say('jory', 'Tessaly\'s red giant. The Rustwake Ember, which has five winters left and has had five winters left since I was born. And a third place.', 'source2'),
      source2: say('jory', 'The Board won\'t name it. Neither will the Treasury. Funny, two governments who agree on nothing, agreeing on a silence.', 'menu', [{ rumour: 'There is a third source of Ebon-gas. Neither the Board nor the Treasury will name it.' }]),
      menu: ask('jory', 'What else? Clock\'s running and the gas isn\'t getting any younger.', [
        ch('The story again.', 'story'),
        ch('About that deal —', 'deal', { if: { standing: 'rustwake', min: 10 }, locked: '(the clans don\'t know you well enough)' }),
        ch('The third source?', 'source'),
        LEAVE('Lit, Jory.'),
      ]),
    },
  },

  // ── 5 · Cantor-Novice Lucan Vey, the Hymn ───────────────────────────
  {
    id: 'lucan-hymn',
    title: 'A Cantor Who Stopped Singing',
    with: 'lucan',
    entry: [{ if: { flag: 'lucan-sang' }, node: 'after' }, { node: 'hello' }],
    nodes: {
      hello: ask('lucan', 'Be witnessed, Directorate. Forgive me, I am not flying. They grounded me after the Observance. I stopped singing, and a Cantor who stops singing flies worse.', [
        ch('Why did you stop?', 'why'),
        ch('Why does singing help you fly?', 'fly'),
        ch('Sing it now. I\'ll listen.', 'sing'),
        LEAVE('Ascend, Cantor.'),
      ], undefined, '見届けよ。'),
      why: say('lucan', 'My Measure broke the Observance. Dame-Cantor Psalm shot our weapons off, one by one, and then apologised across the Line — to you. I was ashamed to sing after that.', 'why2'),
      why2: say('lucan', 'She was right. That is the worst part. It is very hard to sing when you know you were wrong in front of the whole Line.', 'menu'),
      fly: say('lucan', 'Nobody knows. The drive crystals run warm when we sing. The Hymn\'s intervals are strange — the Treasury clerks say they are all primes.', 'menu', [
        { rumour: 'A grounded Cantor says the Hymn of Ascent\'s intervals are prime ratios, and the drive crystals run warm when it is sung.' },
        { codex: 'fac-choir' },
      ]),
      sing: say('lucan', '(sung) Out of the dust we were lifted. Out of the dark we were shown.', 'sing2', [{ setFlag: 'lucan-sang' }, { standing: 'choir', delta: 3 }]),
      sing2: say('lucan', '...Thank you. It is easier with someone listening. Even an unascended someone. Perhaps especially.', 'menu'),
      after: say('lucan', 'They gave me my Measure back. I sing at every launch now, even the dull ones. Be witnessed, pilot — truly.', 'menu'),
      menu: ask('lucan', 'Is there something else you would witness?', [
        ch('The Observance —', 'why'),
        ch('The Hymn\'s intervals?', 'fly'),
        LEAVE('Ascend, Lucan.'),
      ]),
    },
  },

  // ── 6 · Inspector Pell Varga, Office of Continuity ──────────────────
  {
    id: 'pell-audit',
    title: 'Purely Routine',
    with: 'pell',
    entry: [{ if: ep(9), node: 'rot' }, { if: { all: [{ cargo: 'ebon' }, { notFlag: 'pell-declared' }] }, node: 'audit' }, { node: 'hello' }],
    nodes: {
      hello: ask('pell', 'Inspector Varga, Office of Continuity. Purely routine. Everything is purely routine. It\'s the Directorate\'s great achievement.', [
        ch('What does Continuity audit?', 'what'),
        ch('Is there work for a pilot?', 'work'),
        LEAVE('Good day, Inspector.'),
      ]),
      what: say('pell', 'Grams. Food is grams of protein, war is grams of Ebon, a pilot is grams of airframe and training. I only count. Others decide.', 'what2'),
      what2: say('pell', 'You would be surprised how restful that is.', 'menu'),
      work: say('pell', 'Continuity needs sealed dispatches carried between Castellan and Anchorage. No questions asked, fair shares paid. I\'ll put your name forward.', 'menu', [{ contract: 'continuity-courier' }, { setFlag: 'pell-courier' }]),
      audit: ask('pell', 'Your manifest shows Ebon-gas, pilot. Undeclared Ebon is theft from eleven million people. Shall we declare it?', [
        ch('Declare it. (tariff 120 sh)', 'declared', { if: { credits: 120 }, effects: [{ credits: -120 }, { standing: 'concord', delta: 3 }, { setFlag: 'pell-declared' }], locked: '(not enough shares)' }),
        ch('Something for your trouble? (200 sh)', 'bribe', { if: { credits: 200 }, effects: [{ credits: -200 }, { standing: 'concord', delta: -2 }, { setFlag: 'pell-bribed' }, { setFlag: 'pell-declared' }] }),
        ch('It\'s already declared.', 'lie', { effects: [{ standing: 'concord', delta: -4 }] }),
      ]),
      declared: say('pell', 'Thank you. Stamped, filed, forgotten. You have no idea how rare it is for someone simply to say yes.', 'menu'),
      bribe: say('pell', 'I\'ll pretend I misheard, because the alternative is paperwork for both of us. Don\'t do it twice.', 'menu'),
      lie: say('pell', 'Of course. I\'ll make a note that you said so. I make a note of everything.', 'menu'),
      rot: say('pell', 'You\'ve heard, then. About the Schedule. Engagements agreed in advance, expenditures pencilled in. I audited three of those quarters.', 'rot2'),
      rot2: ask('pell', 'The numbers balanced beautifully. That should have told me. Real wars don\'t balance.', [
        ch('Why didn\'t you say anything?', 'whynot'),
        ch('Who else knew?', 'who'),
        LEAVE('Good day, Inspector.'),
      ]),
      whynot: say('pell', 'Because I only count. That\'s what I told myself for nine years. Commander Aubrac told herself the same, I imagine. Ask her how well it worked.', 'menu'),
      who: say('pell', 'Pryce. Quillon across the Line. Clerks like me who didn\'t want to know. The pilots on the list didn\'t know. That\'s the point of a list.', 'menu', [{ codex: 'log-schedule' }]),
      menu: ask('pell', 'Anything further? I\'m on the clock. Everyone is.', [
        ch('What do you count?', 'what'),
        ch('Any work going?', 'work', { if: { notFlag: 'pell-courier' } }),
        LEAVE('Good day.'),
      ]),
    },
  },

  // ── 7 · Nadia Sorel, a letter from Lysowick ─────────────────────────
  {
    id: 'nadia-letter',
    title: 'A Letter for the Dawn',
    with: 'nadia',
    entry: [{ if: { all: [{ flag: 'nadia-letter' }, ep(11)] }, node: 'grief' }, { if: { flag: 'nadia-letter' }, node: 'waiting' }, { node: 'hello' }],
    nodes: {
      hello: ask('nadia', 'Sorry — you\'re a pilot? Directorate? I\'m from Lysowick. You\'ll have seen it from above. The wrecks. Engagements seventy-one, eighty-eight, one-oh-two.', [
        ch('I\'ve flown through it.', 'lys'),
        ch('Are you all right?', 'ok'),
        ch('Here — take some rations.', 'give', { if: { cargo: 'rations' }, effects: [{ cargo: 'rations', delta: -1 }, { setFlag: 'nadia-fed' }, { standing: 'concord', delta: 1 }], locked: '(no rations in the hold)' }),
        ch('(Leave her be.)', null),
      ]),
      lys: say('nadia', 'Layered like pressed flowers, my mother said. Every few years another battle, another layer. We lived under it. Then one year the layer was us.', 'ok'),
      ok: ask('nadia', 'My brother Tomas crews the Hesperus Dawn. Deck rigger. I have a letter for him and no way to send it that isn\'t read by three offices first.', [
        ch('I\'ll carry it.', 'carry', { effects: [{ setFlag: 'nadia-letter' }] }),
        ch('I can\'t promise anything.', 'nop'),
      ]),
      carry: say('nadia', 'Thank you. It\'s only a letter. It says I\'m alive and he owes me a pair of boots. That\'s all a letter needs to say, really.'),
      nop: say('nadia', 'No. Nobody can. It\'s all right. Fly safe — that\'s what you say, isn\'t it?'),
      give: say('nadia', 'Oh. Thank you. That\'s four days, that is. I\'ll remember your ship. Everyone here remembers ships.', 'ok'),
      waiting: say('nadia', 'Did Tomas get the letter? No — don\'t tell me if you haven\'t been out to the Dawn. I like not knowing yet. It keeps him alive.'),
      grief: say('nadia', 'They say the Dawn is gone. The whole Bastion. I read the lists twice. His name isn\'t on the survivors\' list, or the other one.', 'grief2'),
      grief2: ask('nadia', 'So I\'m keeping the letter. When he turns up, he still owes me boots.', [ch('Keep the light, Nadia.', null), ch('I\'m sorry.', 'sorry')]),
      sorry: say('nadia', 'Don\'t be sorry. Be careful. Everyone I\'ve met who was sorry ended up on a list.'),
    },
  },

  // ── 8 · Ensign Toma Kerrigan, the Null picket ───────────────────────
  {
    id: 'toma-signal',
    title: 'Nothing Out There',
    with: 'toma',
    entry: [{ if: ep(6), node: 'heard' }, { node: 'hello' }],
    nodes: {
      hello: ask('toma', 'Null picket, three months on the line. Nothing out there but a dead ring pointing at nothing. You don\'t want to hear about it.', [ch('I do.', 'burst'), ch('Fair enough.', null)]),
      burst: say('toma', 'There\'s a burst. Every twenty-five hours and fifty-one minutes, from beyond the Null Lantern. A count of pulses. The count gets smaller.', 'burst2'),
      burst2: say('toma', 'We logged it, and a man from Continuity came and took the logs. Said it was solar. Solar doesn\'t count.', undefined, [
        { rumour: 'Null pickets log a burst from beyond the Null Lantern every 25 h 51 min. The pulse count falls each time.' },
        { codex: 'log-null-picket' },
      ]),
      heard: say('toma', 'You heard it too, didn\'t you? Your core answered. The whole picket saw the reply — one pulse. They\'re calling you the pilot who said hello.', 'heard2'),
      heard2: ask('toma', 'The counts are primes. Always the next prime down. Whatever\'s out there is counting to something, and both Boards agreed to bury it.', [
        ch('What happens when it runs out?', 'zero'),
        ch('Keep your head down, Ensign.', null),
      ], [{ codex: 'anom-signal' }], '何かが、素数を数えている。'),
      zero: say('toma', 'Two isn\'t zero. Two\'s the last prime. After that, I suppose it has to do something else.'),
    },
  },

  // ── 9 · Magpie, the moot-hold ───────────────────────────────────────
  {
    id: 'magpie-moot',
    title: 'Triple, Double, Nothing',
    with: 'magpie',
    entry: [{ if: { standing: 'rustwake', min: 30 }, node: 'friend' }, { node: 'hello' }],
    nodes: {
      hello: ask('magpie', 'Well, look what the Lantern dragged through. Directorate pays triple, Hegemony pays double. What are you, sweetheart? Let\'s find out.', [
        ch('What does a friend pay?', 'price'),
        ch('Sing me a haul-song.', 'song'),
        ch('Need a hand with anything?', 'job'),
        LEAVE('Just looking.'),
      ]),
      price: say('magpie', 'Nothing. Friends pay nothing. That\'s how you find out if you are one — you ask, and I tell you the price.', 'menu', [{ standing: 'rustwake', delta: 1 }]),
      song: say('magpie', '(sung) Oh, the Ember\'s low and the gram is high, and the Board\'s got its hand in your pocket...', 'song2'),
      song2: say('magpie', 'Only untaxed music in the Reach. Board sent an assessor once. We sang him out the airlock. Gently. He came back for the chorus.', 'menu', [{ codex: 'fac-rustwake' }]),
      job: say('magpie', 'Always. There\'s a clan convoy needs an escort through Scrapjack space, and Scrapjacks shoot anything wearing only one kind of paint.', 'menu', [{ contract: 'magpie-escort' }]),
      friend: say('magpie', 'There\'s my favourite fossil-jockey. Price for you is nothing, as ever. Which means you\'re buying the next round at Odile\'s.', 'menu'),
      wing: say('magpie', 'Ha! Maybe. The Due\'s not built for dogfights, but she\'s built for leaving in a hurry. In this Reach that counts double.', 'menu', [{ recruit: 'magpie-due' }]),
      menu: ask('magpie', 'What else, love?', [
        ch('Another verse.', 'song'),
        ch('Any work?', 'job'),
        ch('Fly with us sometime?', 'wing', { if: { standing: 'rustwake', min: 40 }, locked: '(the clans need to trust you more)' }),
        LEAVE('See you at Odile\'s.'),
      ]),
    },
  },

  // ── 10 · Schoolmistress Dalca and Class Four ────────────────────────
  {
    id: 'imre-class',
    title: 'The Heritage Tour',
    with: 'imre',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('imre', 'Class, this is a real Vanguard pilot. Say good afternoon. — Forgive us. We\'re on the heritage tour. Today is the Shattering.', [
        ch('What do you teach them?', 'teach'),
        ch('Can I say something to them?', 'kids'),
        LEAVE('Good afternoon, Class Four.'),
      ]),
      teach: say('imre', 'The curriculum. An accident of engineering, four hundred and thirty-one years ago. No one to blame. Survival through allocation. It\'s a very tidy lesson.', 'teach2'),
      teach2: say('imre', 'Over the Line they teach it as a judgment: their children are told humanity dropped the lamp. I think ours sleep better. I\'m not sure they should.', 'menu', [{ codex: 'hist-long-dark' }]),
      kids: say('imre', 'Go on, then — Pieter has a question. Pieter always has a question.', 'pieter'),
      pieter: ask('imre-pupil', 'Where did the ships go? The ones in the big ring. Miss says nowhere, but nowhere isn\'t a place.', [
        ch('Nobody knows. Maybe you\'ll find out.', 'hope', { effects: [{ setFlag: 'told-pieter' }] }),
        ch('Nowhere, like your teacher says.', 'nowhere'),
        ch('Somewhere that isn\'t anywhere. Yet.', 'yet', { effects: [{ setFlag: 'told-pieter' }] }),
      ]),
      hope: say('imre', 'Don\'t encourage him. — No. You\'re right. Encourage him. Somebody should.', 'menu'),
      nowhere: say('imre-pupil', 'That\'s what grown-ups say when they don\'t know.', 'menu'),
      yet: say('imre-pupil', 'Yet! I\'m writing that down. Miss, I\'m writing that down.', 'menu'),
      menu: ask('imre', 'Thank you, pilot. We\'ll let you get on.', [ch('What else do you teach?', 'teach'), LEAVE('Keep the light, Class Four.')]),
    },
  },

  // ── 11 · Gardener-Cantor Sabine Aurel ───────────────────────────────
  {
    id: 'sabine-foundry',
    title: 'The Foundry-Gardens',
    with: 'sabine',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('sabine', 'You smell of ozone and old coffee, which means Directorate. Be witnessed anyway. I grow choir crystal in the foundry-gardens of Hesper.', [
        ch('How do you grow crystal?', 'grow'),
        ch('What\'s it for?', 'for'),
        ch('Any choir-glass for sale?', 'buy', { if: { standing: 'choir', min: -10 }, locked: '(the Choir will not trade with you)' }),
        LEAVE('Ascend, Gardener.'),
      ]),
      grow: say('sabine', 'By singing to it. Four hours at dawn, four at dusk, the old intervals exactly. Sing flat and the lattice clouds. Nobody alive knows why.', 'grow2'),
      grow2: say('sabine', 'We don\'t ask. It\'s the one thing your wardens and our gardeners agree on — though we\'d both be offended to hear it said.', 'menu', [{ codex: 'tech-fossil' }]),
      for: say('sabine', 'Drive crystals for the Measures. Resonance spires for the Cathedrals. And windows: the choir-glass in the Spire rings when the Hesper Lantern hums.', 'menu'),
      buy: ask('sabine', 'One case of garden glass. A Directorate collector will pay double, and your Board disapproves, which is half the price.', [
        ch('Buy a case. (360 sh)', 'bought', { if: { all: [{ credits: 360 }, { cargoSpace: 1 }] }, effects: [{ credits: -360 }, { cargo: 'luxury', delta: 1 }, { standing: 'choir', delta: 1 }], locked: '(360 sh and a free cargo slot)' }),
        ch('Not today.', 'menu'),
      ]),
      bought: say('sabine', 'Carry it upright. It remembers being sung to, and it does not like being dropped.', 'menu', [{ tip: 'Choir-glass (luxuries) bought at Hesper sells high in Directorate space.' }]),
      menu: ask('sabine', 'Something else, Directorate?', [ch('The singing —', 'grow'), ch('Glass?', 'buy', { if: { standing: 'choir', min: -10 }, locked: '(the Choir will not trade with you)' }), LEAVE('Be witnessed.')]),
    },
  },

  // ── 12 · "Two-Coats" Brennick, Scrapjack ────────────────────────────
  {
    id: 'brennick-paint',
    title: 'Both Sides\' Paint',
    with: 'brennick',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('brennick', 'They call me Two-Coats because I never strip the old paint. Directorate orange under Hegemony violet under orange again. A hull remembers every owner.', [
        ch('Why not strip it?', 'strip'),
        ch('Oddest thing you\'ve pulled from a wreck?', 'odd'),
        ch('Looking for work?', 'hire'),
        LEAVE('Mind the cutter.'),
      ]),
      strip: say('brennick', 'Paint\'s armour. Paint\'s history. And paint\'s confusing: a Cantor sees orange, a picket sees violet, and both of them hesitate half a second. Half a second\'s a lot.', 'menu'),
      odd: say('brennick', 'A child\'s rattle. Golden-age, in a Cathedral\'s escape pod. Sold it to a Treasury man for more than the pod. Funny, what the Choir collects.', 'menu', [
        { rumour: 'A Scrapjack sold a golden-age child\'s rattle, found in a Cathedral escape pod, to a Hegemony Treasury agent.' },
      ]),
      hire: say('brennick', 'Me? Give me a berth on whatever carrier you fly off and I\'ll keep your Kestrel together with spit and litany. Wardens hate me. Engines don\'t.', 'menu', [{ recruit: 'brennick-mechanic' }]),
      menu: ask('brennick', 'Anything else? This Cantor won\'t cut itself up.', [ch('The paint again?', 'strip'), LEAVE('Lit, Two-Coats.')]),
    },
  },

  // ── 13 · CPO Rosa Lindqvist, Hesperus Dawn deck crew ────────────────
  {
    id: 'rosa-dawn',
    title: 'Deck Is Green',
    with: 'rosa',
    entry: [{ if: ep(11), node: 'after' }, { node: 'hello' }],
    nodes: {
      hello: ask('rosa', 'Lindqvist, Dawn deck crew, on leave. You\'re the one who flies 0413? Deck talks about that airframe like a relative who won\'t die.', [
        ch('What\'s the Dawn like?', 'dawn'),
        ch('The mugs on the hook?', 'mugs'),
        ch('I carry a letter for Tomas Sorel.', 'letter', { if: { flag: 'nadia-letter' } }),
        LEAVE('Green deck, Chief.'),
      ]),
      dawn: say('rosa', 'Old. Loud. Home. The Captain has a crayon star-chart taped to the CAG board. His granddaughter Ada drew lines between all the gates.', 'dawn2'),
      dawn2: say('rosa', 'Across the top it says THEY GO SOMEWHERE. He won\'t let anyone take it down. Nobody wants to.', 'menu', [{ codex: 'ppl-oyelaran' }]),
      mugs: say('rosa', 'Every pilot hangs a mug in the ready room. Somebody doesn\'t come back, their mug stays on the hook. We\'ve got a lot of hooks.', 'menu'),
      letter: say('rosa', 'Sorel? Tomas? Rigger, laughs like a door? I\'ll see he gets it. Tell his sister he\'s fine, and he says the boots were her fault.', 'menu', [{ setFlag: 'letter-delivered' }, { standing: 'concord', delta: 2 }]),
      after: say('rosa', 'I was on leave when the Bastion went. Leave. I\'ve been trying to feel lucky about it for weeks.', 'after2'),
      after2: ask('rosa', 'The Captain held the hangar doors open to the end, they say. Okafor called the deck green right to the last. Green deck.', [
        ch('What now?', 'now'),
        ch('Keep the light, Chief.', null),
      ], undefined, 'デッキ、グリーン。'),
      now: say('rosa', 'Now I find another deck. Somebody\'s got to keep the mugs.'),
      menu: ask('rosa', 'Anything else? I\'ve got four hours of leave and I mean to waste all of them.', [ch('The Dawn —', 'dawn'), LEAVE('Green deck, Chief.')]),
    },
  },

  // ── 14 · Measure-Captain Idris Solenne, Treaty Line Watch ───────────
  {
    id: 'idris-observance',
    title: 'The Observance',
    with: 'idris',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: ask('idris', 'Measure-Captain Solenne, Treaty Line Watch. Forgive the formality: we fly the Observance tomorrow, and I am practising being polite to Directorate pilots.', [
        ch('What is the Observance like?', 'obs'),
        ch('Do you believe in Ascension?', 'asc'),
        ch('Who\'s winning the war?', 'win'),
        ch('Can the Choir use a pilot?', 'work', { if: { standing: 'choir', min: 20 }, locked: '(the Choir does not trust you yet)' }),
        LEAVE('Be witnessed, Captain.'),
      ]),
      obs: say('idris', 'Both fleets fly the Line together, weapons cold, once a week. We count them. They count us. Then we go home and resume the war as scheduled.', 'obs2'),
      obs2: say('idris', '"As scheduled." A figure of speech. I think.', 'menu', [{ rumour: 'A Choir captain let slip that the war runs "as scheduled". She insists it was a figure of speech.' }]),
      asc: say('idris', 'I believe the golden age was a gift we were too young to hold, and we dropped it. Ascension is growing up. Your Directorate thinks it is counting its way to survival.', 'asc2'),
      asc2: say('idris', 'Perhaps both of us are children, arguing over whose fault the lamp was.', 'menu', [{ codex: 'fac-zenith' }]),
      win: say('idris', 'Nobody. Seven years of real war and thirty of this. If anyone meant to win, they would have by now.', 'menu'),
      work: say('idris', 'Unscheduled pilots are useful to people who dislike schedules. There is an escort on the Line. Unofficial. Be witnessed doing it well.', 'menu', [{ contract: 'choir-line-escort' }, { standing: 'choir', delta: 1 }]),
      menu: ask('idris', 'Is there more, pilot? The Line waits for no one. Except, weekly, for itself.', [ch('The Observance —', 'obs'), ch('Ascension —', 'asc'), LEAVE('Ascend, Captain.')]),
    },
  },

  // ── The Reach remembers (world facts: src/game/world) ───────────────
  {
    id: 'pell-decisive',
    title: 'A Correction Will Be Scheduled',
    with: 'pell',
    when: { worldFact: 'continuity.hostile' },
    priority: 5,
    entry: [{ node: 'hello' }],
    nodes: {
      hello: say('pell', 'Pilot. You made an engagement decisive. Do you know how many forms that generates? Neither do I. Nobody has ever had to fill them in.', 'two'),
      two: ask('pell', 'I am instructed to note your name. I have noted it. I am also instructed to feel something about it, and I find I do. I\'m not sure it\'s what they meant.', [
        ch('What happens now?', 'now'),
        ch('It wasn\'t a war. It was a thermostat.', 'thermo', { if: { worldFact: 'schedule.known' } }),
        LEAVE('Good day, Inspector.'),
      ]),
      now: say('pell', 'A correction. Next quarter\'s Schedule will carry your squadron by name — "costly and visible". The berths with Continuity desks will remember you. Ebon went up eleven percent in an hour.', 'now2'),
      now2: say('pell', 'The exchange floor priced the war in advance. You have just shown it the price of one nobody scheduled.', undefined, [{ rumour: 'Continuity has a pilot\'s name on a desk at every bastion. Engagements made decisive draw a correction the next quarter.' }]),
      thermo: say('pell', 'Yes. And you have put your hand on it. I can\'t decide whether that makes you a vandal or the only honest pilot in the Reach.', 'now'),
    },
  },
  {
    id: 'toma-breath',
    title: 'The Arithmetic',
    with: 'toma',
    when: { all: [{ worldFact: 'oracle.heard' }, { notWorldFact: 'gates.aligned' }] },
    priority: 4,
    entry: [{ node: 'hello' }],
    nodes: {
      hello: say('toma', 'Everyone\'s doing the sums now. One burst every twenty-five hours fifty-one. Count the primes left. Divide by twenty-four. They\'ve printed it on ration cards in Pelestead.', 'two'),
      two: ask('toma', 'Fifty-six days, it was, when you came back from the rim. I still stand watch on it. Somebody should be listening when it gets to two.', [
        ch('What did the pickets hear last?', 'last'),
        LEAVE('Somebody will be, Ensign.'),
      ]),
      last: say('toma', 'The last burst was clean. No drift. Whatever it is, it keeps better time than the Board.', undefined, [{ rumour: 'Null pickets say the Signal keeps better time than the Board of Allocation. Nobody has disputed it.' }]),
    },
  },
  {
    id: 'toma-counting-up',
    title: 'Two, Three',
    with: 'toma',
    when: { worldFact: 'gates.aligned' },
    priority: 4,
    entry: [{ if: { worldFact: 'horizon.open' }, node: 'up' }, { node: 'stopped' }],
    nodes: {
      stopped: say('toma', 'It stopped at two. I sat with the headset on for a whole shift afterwards, in case. Then the Null Lantern lit. It doesn\'t go anywhere. It goes somewhere now.'),
      up: say('toma', 'It\'s counting up. Two, three, five. I asked the picket commander what we do now and he said "listen". First order I\'ve ever been glad of.', undefined, [{ rumour: 'The Null count is climbing: two, three, five. The pickets have stopped logging it as a threat.' }]),
    },
  },
];

/** Conversations belonging to a person. */
export function conversationsWith(personId: string): Conversation[] {
  return CONVERSATIONS.filter((c) => c.with === personId);
}
