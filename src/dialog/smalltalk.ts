import type { Archetype, Mood, Person } from './people';
import type { Conversation, DialogChoice, DialogNode, DFaction } from './types';

/**
 * Small talk for generated locals: a short tree per archetype — a line in
 * their mood, then the thing their job knows about (a rumour, a trade tip, a
 * request, a bit of politics). Pure and deterministic per person.
 *
 * The concourse fills {tip} (the station's live best trade) and {rumour}.
 */

function h(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}
const pick = <T>(seed: number, list: readonly T[], k = 0): T => list[((seed >>> (k * 5)) + k * 7) % list.length];

const OPEN: Record<Mood, string[]> = {
  weary: ['Double shift. Third this week. The Board says the quota is the quota.', 'I have been awake since the last Allocation Hour. Talk slowly.'],
  cheerful: ['Good day for it, whatever it is! Seals green, coffee real, nobody shot at me yet.', 'You\'ve got the look of someone with news. Go on.'],
  suspicious: ['You\'re asking a lot of questions for someone who hasn\'t bought anything.', 'I know that airframe. Everyone knows that airframe. What do you want?'],
  grieving: ['Sorry. I\'m not good company this week.', 'My sister flew a Harrier. Engagement one-oh-two. You\'d not have known her.'],
  devout: ['Be witnessed. The Measure sings at dawn, and I have not missed a morning.', 'The Altitude sees all of us. Even you, I suppose.'],
  mercenary: ['Everything has a price. Conversation, for instance. First one\'s free.', 'Buying, selling, or wasting my time? Two of those pay.'],
  nervous: ['Is that — is that ship yours? Right. Sorry. Long week.', 'Did you hear something on the band just now? No? Good. Good.'],
  bored: ['Nothing happens here. Nothing has ever happened here. Ask me anything.', 'Another pilot. Hello, pilot.'],
  hopeful: ['They say the Lanterns will all be lit one day. Do you think so?', 'I heard a ship came in from further out than anyone\'s been. Was that you?'],
  proud: ['This station has never missed a quota. Not once in forty years.', 'You\'re standing in the best-kept dock in the Reach. Wipe your boots.'],
  wry: ['Welcome to {station}. It\'s like everywhere else, only more so.', 'Sit down before the gravity notices you.'],
};

const POLITICS: Record<DFaction, string[]> = {
  concord: [
    'The Board counts every gram so nobody starves. Nobody does starve. I just wish they\'d count something else, once.',
    'My ration card was re-weighted again. Up four percent for munitions, down two for me. Survival, they call it.',
    'Keep the light, they say. I keep the light. Somebody else keeps the switch.',
  ],
  choir: [
    'The Hegemony teaches that we dropped the lamp. We are growing up so we can hold it. Some days I believe it.',
    'Every transmission opens with the Intonation. Four notes. If you ever hear them on your band, you have been witnessed.',
    'The Treasury prays beautifully. And counts while it prays. Everyone knows. Nobody says.',
  ],
  rustwake: [
    'We\'re the only honest people in the Reach. We admit it\'s about the gas.',
    'Moot voted by shouting last night. Motion carried. Nobody remembers the motion.',
    'Directorate triple, Hegemony double, friends nothing. You\'re not a friend yet.',
  ],
};

const ASK_RUMOUR = ['What\'s the word on the deck?', 'Heard anything worth hearing?', 'What are people saying?'];
const ASK_TIP = ['Anything worth hauling?', 'Where\'s the money this week?', 'Any cargo tips?'];

/** A generated person's conversation. */
export function smallTalk(p: Person): Conversation {
  const seed = h(p.id);
  const fac: DFaction = p.faction === 'none' ? 'rustwake' : p.faction;
  const opening = pick(seed, OPEN[p.mood]);
  const nodes: Record<string, DialogNode> = {};
  const choices: DialogChoice[] = [];

  nodes.rumour = { who: p.id, line: 'Word is: {rumour}', effects: [{ rumour: '{rumour}' }], next: 'menu' };
  choices.push({ text: pick(seed, ASK_RUMOUR, 1), next: 'rumour' });

  const arch: Archetype = p.archetype;
  if (arch === 'trader' || arch === 'broker' || arch === 'dock') {
    nodes.tip = { who: p.id, line: arch === 'dock' ? 'I load what the manifests say. Here\'s what they say: {tip}' : 'Free advice, which is worth what you pay for it. {tip}', effects: [{ tip: '{tip}' }], next: 'menu' };
    choices.push({ text: pick(seed, ASK_TIP, 2), next: 'tip' });
  }
  if (arch === 'broker') {
    nodes.sell = { who: p.id, line: 'For twenty-five shares: a Choir Psalter was seen running dark near Zephacis, and it wasn\'t running from us.', next: 'menu', effects: [{ rumour: 'A Choir Psalter was seen running dark near Zephacis — away from its own lines.' }] };
    choices.push({ text: 'Sell me something better. (25 sh)', next: 'sell', if: { credits: 25 }, effects: [{ credits: -25 }], locked: '(not enough shares)' });
  }
  if (arch === 'refugee') {
    nodes.give = { who: p.id, line: 'That\'s — thank you. I\'ll tell them at the ration line a pilot did it. They won\'t believe me. I\'ll tell them anyway.', next: 'menu', effects: [{ setFlag: `helped:${p.id}` }] };
    choices.push({ text: 'Take a pallet of rations.', next: 'give', if: { cargo: 'rations' }, effects: [{ cargo: 'rations', delta: -1 }, { standing: fac, delta: 2 }], locked: '(no rations in the hold)' });
    nodes.story = { who: p.id, line: pick(seed, ['We left when the fourth layer came down. Debris, I mean. You learn to read the sky for it.', 'I had a shop. Spares. Fossil parts nobody could make. Now I have a ticket and a number.'], 3), next: 'menu' };
    choices.push({ text: 'Where are you from?', next: 'story' });
  }
  if (arch === 'officer' || arch === 'pilot' || arch === 'cantor') {
    nodes.politics = { who: p.id, line: pick(seed, POLITICS[fac], 4), next: 'menu' };
    choices.push({ text: arch === 'cantor' ? 'What does the Choir believe?' : 'How\'s the war?', next: 'politics' });
  }
  if (arch === 'pilot') {
    nodes.pool = { who: p.id, line: 'Kill pool on our deck is closed. Last pilot who ran it left the pot to someone who never cheated. That\'s tradition now.', next: 'menu' };
    choices.push({ text: 'Who runs your kill pool?', next: 'pool' });
  }
  choices.push({ text: fac === 'choir' ? 'Be witnessed.' : fac === 'rustwake' ? 'Nothing in the black is lost.' : 'Keep the light.', next: null });

  nodes.hello = { who: p.id, line: opening, choices };
  nodes.menu = { who: p.id, line: pick(seed, ['Anything else?', 'What else?', 'Go on, then.', 'Still here?'], 5), choices };
  return { id: `talk:${p.id}`, title: p.name, with: p.id, entry: [{ node: 'hello' }], nodes, repeatable: true };
}
