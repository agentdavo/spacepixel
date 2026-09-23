import type { CodexEntry } from './types';

/**
 * In-world texts unlocked through the campaign. Voices vary on purpose:
 * schoolbook, liturgy, field manual, intercepted memo, black-box transcript,
 * pilot diary. Plain text; blank lines separate paragraphs.
 */
const p = (...paras: string[]): string => paras.join('\n\n');

export const CODEX: CodexEntry[] = [
  // ════════════════════════════════════════════════════════════════════
  // HISTORY
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'hist-shattering',
    title: 'The Shattering',
    category: 'history',
    body: p(
      `From "A Primer of the Reach for Directorate Schools", Grade Four, Allocation-approved edition.`,
      `Long ago, before your great-great-great-grandparents were born, people could go anywhere. The stars were joined by the Lanterns, and the Lanterns were joined to each other, and a ship could leave Meridian after breakfast and be under a different sun by supper. This time is called the Timetable, because every gate kept a schedule and every schedule was kept.`,
      `Then, in one day, the Lanterns went dark. We call this day the Shattering. Nobody knows why it happened. Some say the Lanterns wore out. Some say the golden-age people used them too much. The Zenith Hegemony says it was a punishment, but the Zenith Hegemony says many things.`,
      `Ships that were inside a Lantern when it went dark were never seen again. There were a great many of them. When you see the Graveyard at Anchorage on a clear night, you are seeing some of the ones that were only halfway in.`,
      `The Shattering was 431 years ago. Since then we have learned to light six Lanterns again, which is why we have a Reach, and a Directorate, and you. Every gram of Ebon-gas that lights a Lantern is precious. That is why we count them.`,
      `QUESTIONS: 1. What was the Timetable? 2. Why do we count grams? 3. Draw a Lantern.`,
    ),
  },
  {
    id: 'hist-timetable',
    title: 'The Timetable Era',
    category: 'history',
    body: p(
      `The golden age did not call itself golden. It called itself the Meridian Concord, and it was, by the evidence of its own paperwork, mostly concerned with delays.`,
      `For roughly twenty-two centuries humanity lived inside a network it had not built. The Lanterns were found intact, already humming, already linked in a lattice that ran from the Cradle — the world the old records call Earth — out across a spiral arm and beyond. Humanity did what humanity does with a gift it does not understand: it wrote a schedule for it. The Timetable Authority published departures. Ships ran to the minute. Children took the gate to school.`,
      `What survives of the era is lopsided. We have their ships, because ships are hard to destroy; their engines, because engines were built to outlast their makers; their weapons, because of course. We have almost none of their knowledge, because knowledge was kept in the network itself, and the network is what broke. Every Directorate archivist knows the feeling of opening a golden-age data core and finding it perfectly preserved and entirely addressed to somewhere that no longer exists.`,
      `The most common surviving document from the Timetable era is an apology for a late departure. Scholars of the Keeping consider this significant. Scholars of the Board consider it a warning about customer service.`,
    ),
  },
  {
    id: 'hist-long-dark',
    title: 'The Long Dark',
    category: 'history',
    body: p(
      `Two hundred and twelve years passed between the Shattering and the Relighting. In the Reach we call them the Long Dark, and we teach them as a single dim corridor because the alternative is to teach them year by year.`,
      `Six inhabited systems, each suddenly alone. Anchorage had shipyards and no ore. Meridian had ore and a population of nine million who had been fed by gate-freight. Hesper had its humming Lantern and a nobility who, within a generation, had decided the humming was a voice. Tessaly had a dying red star and nothing else anyone wanted, yet.`,
      `The Candle Years at Anchorage are remembered in the Keeping's calendar as a single night that lasted thirty-one winters: the reactors failing one by one, the cloister wardens moving from engine to engine with hand-lamps and the one manual nobody could read, keeping the last four alive by ritual because ritual was all they had that worked. The first line of the Seven Keepings was written then, on a bulkhead, in grease.`,
      `No one who lived through the Long Dark believed the Lanterns would light again. That is the thing to remember about the people who relit them.`,
    ),
  },
  {
    id: 'hist-relighting',
    title: 'The Relighting',
    category: 'history',
    body: p(
      `In the year 212 After Shattering a Rustwake prospector named Absalom Tey skimmed the corona of Tessaly's red giant looking for heavy metals and came home with a hold full of something that ate the light in the cargo bay. He sold a flask of it to the Cloister at Anchorage for the price of a winter's air.`,
      `The wardens did not know what it was. They knew what it did. Poured into the feed of the dead Anchorage–Meridian Lantern — a thing no warden had dared touch in two centuries — it made the ring breathe. On the ninth attempt the Lantern opened for eleven seconds, long enough for one shuttle to cross, and the pilot's first transmission from Meridian space was a single word the Keeping still uses as its highest feast-day greeting: "Lit."`,
      `Within fifty years six Lanterns burned, each a narrow bridge of Ebon-gas over a dark that went on forever on every side. The Accord of Six Lights bound the Reach's worlds into one trading space. It lasted, by the Directorate's reckoning, ninety-one years. By the Rustwake's reckoning it never really ended; it just changed who got paid.`,
      `Absalom Tey died poor. The Board of Allocation named a refinery after him. It is the largest building in the Reach, and there is no public entrance.`,
    ),
  },
  {
    id: 'hist-attrition',
    title: 'The Long Attrition',
    category: 'history',
    body: p(
      `Official Directorate chronology, abridged for service personnel.`,
      `394 AS — The Zenith Hegemony annexes the Tessaly Ebon-fields in violation of the Accord of Six Lights. The Directorate mobilises the Meridian Concord Defense Force.`,
      `395–402 AS — The Tessaly Campaigns. Heavy losses on both sides. The Treaty Line is established at the Tessaly approaches; the Observance protocol governs contact there.`,
      `403–430 AS — The Long Attrition. A war of pickets, raids and convoy actions. Neither side can afford a decisive fleet engagement; neither side can afford peace while the other holds half the Ebon supply chain. Directorate doctrine: hold the Lanterns, preserve the fleet, expend fighters before hulls.`,
      `431 AS — Present day. Directorate fighter strength is at sixty-one percent of establishment. Ebon-gas allocation to front-line units has fallen for nine consecutive years. Morale is described in Office of Continuity reports as "adequate to the purpose".`,
      `[Handwritten in the margin of Vanguard's ready-room copy, in several hands:] adequate to WHAT purpose — ask the Board — the Board says ask Allocation — Allocation IS the Board — Jackpot owes the pool 12 grams — no I do not`,
    ),
  },

  // ════════════════════════════════════════════════════════════════════
  // FACTIONS
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'fac-directorate',
    title: 'The Terran Directorate',
    category: 'factions',
    body: p(
      `The Directorate governs Meridian, Anchorage and their dependent habitats — some eleven million people — from a building on Castellan's inner ring that everyone calls the Counting House. Its founding charter runs to four pages and uses the word "survival" nineteen times. It does not use the word "freedom" at all, an omission its founders described as honest.`,
      `The Directorate calls itself Terran after a world none of its citizens have seen: the Cradle, Earth, the far end of the old Timetable. The claim is sentimental and political at once. If we are Earth's heirs, then the golden age was ours, and so is everything it left behind.`,
      `Its virtues are real. Nobody in the Directorate starves. Every child is schooled, every reactor is kept, every gram is accounted for. Its vices are the same virtues seen from the other end: a state that measures everything eventually believes that what it cannot measure does not exist. Directorate citizens carry ration cards, vote for a Board they did not nominate, and say "Keep the light" as both greeting and farewell. They mean it. That is the Directorate's strength and its tragedy.`,
      `The fleet still calls itself the Meridian Concord Defense Force, after the golden-age government that died in the Shattering. Nobody has had the allocation to repaint the name.`,
    ),
  },
  {
    id: 'fac-allocation',
    title: 'The Board of Allocation',
    category: 'factions',
    body: p(
      `[Text printed on the reverse of every Directorate ration card, 431 AS issue.]`,
      `THIS CARD ENTITLES THE BEARER TO THEIR SHARE. A share is what the Reach can spare so that the Reach can endure. The Board of Allocation calculates every share with care and without favour. Shares are not wages. Shares are not rewards. Shares are the light, divided fairly among those who keep it.`,
      `Ebon-gas is the root of all allocation. One gram of Ebon lights a fighter's passage through a Lantern. Forty kilograms carries a carrier. Every gram burned in war is a gram not burned in trade; every gram not burned in trade is bread that does not cross a Lantern. Report hoarding, smuggling and waste to your Allocation Warden.`,
      `DO NOT FOLD. DO NOT DRAW ON THIS CARD.`,
      `[The card this text was transcribed from has been drawn on. See: A Chart, in Crayon.]`,
    ),
  },
  {
    id: 'fac-keeping',
    title: 'The Order of the Keeping',
    category: 'factions',
    body: p(
      `The engine-wardens are older than the Directorate, older than the Relighting, and — if you ask them — older than the engines, which is not true, but they have kept the engines so long that the distinction has worn thin.`,
      `The Order was founded in the Candle Years by Hollis Marrow, a Timetable controller who survived the Shattering at Anchorage and spent the rest of her life keeping four reactors alive with a manual she could not read. Her rule is simple: what works is kept; what is kept is not opened; what is not opened is not questioned. A sealed heart is a holy heart. Wardens will rebuild a golden-age drive around its core eleven times over, replacing every bolt and pipe, and never once unseal the core itself.`,
      `The Directorate tolerates the Order because nothing flies without it. Wardens wear brown, shave their heads to keep hair out of the intakes, carry a torque-key on a cord where a priest might carry a cross, and serve in the fleet as mechanics, and — rarely, by special dispensation — as pilots. A warden-pilot is said to be "riding their vows".`,
      `The Order's great text is the Seven Keepings. Its great heresy, never formally named, is curiosity.`,
    ),
  },
  {
    id: 'fac-zenith',
    title: 'The Zenith Hegemony',
    category: 'factions',
    body: p(
      `The Hegemony believes the golden age was not a paradise but a fall. Humanity, they teach, was handed the stars before it was grown enough to hold them, and the Shattering was the consequence: a child dropping a lamp. The proper response is not to relight the lamp. It is to grow up.`,
      `This is Ascension, and it is pursued with the discipline of a religious order and the pedigree-keeping of a stud farm. The Ascendant Houses of Hesper — nineteen of them, now eleven — trace their lines to the first families who heard the Hesper Lantern hum and understood it as a voice. Purity is genetic, liturgical and moral at once. The unascended are not hated. They are pitied, managed, and kept from sharp things.`,
      `The Hegemony is ruled by the Zenith, an elected monarch chosen by the Houses for life. The title is also a direction: the highest point, the point directly overhead, the place from which one looks down. The present Zenith, the nineteenth, has reigned for forty-one years and is regarded even by the Directorate as a scholar of rare depth. He has not left the Spire of Hesper in eleven years.`,
      `Beneath the liturgy the Hegemony runs on the same thing everyone runs on. The Hierarch-Treasurer controls the Tessaly Ebon-fields. The Houses squabble over allocations in language borrowed from hymnals. Purity, it turns out, is expensive.`,
    ),
  },
  {
    id: 'fac-choir',
    title: 'The Choir',
    category: 'factions',
    body: p(
      `The armed service of the Zenith Hegemony is not called a navy. It is called the Choir, and its pilots are Cantors, and their squadrons are Measures, and the dreadnoughts that anchor their fleets are Cathedrals. Directorate pilots find this affected until the first time they hear it on an open channel.`,
      `Every Choir transmission begins with the Intonation: four tones, rising, sung by the transmitting ship's crystal drive through the comm carrier. It is a handshake protocol. It is also — the Choir insists — a prayer. Choir pilots sing the Hymn of Ascent over open bands during combat, not as psychological warfare, though it works as that, but because the Hymn is how their ships are kept in tune. A Cantor that stops singing flies worse. Nobody in the Choir can say why.`,
      `The Choir's code is severe. A Cantor who breaks the Observance or fires unwitnessed is struck from the Measure. The standard Choir greeting is "Be witnessed"; the farewell is "Ascend". Choir pilots do not surrender. Directorate intelligence believes this is doctrine. It is actually shame.`,
    ),
  },
  {
    id: 'fac-rustwake',
    title: 'The Rustwake Clans',
    category: 'factions',
    body: p(
      `"Nothing in the black is ever truly lost." — clan saying, usually said while taking something.`,
      `The Rustwake Belt circles a star that is taking a very long time to die, and the clans who live there skim its last breath for Ebon-gas the way their ancestors skimmed the Graveyard for parts. They are officially neutral, which means everyone buys from them and nobody protects them. Their ships are built from both sides' wrecks and keep both sides' paint.`,
      `There are thirty-odd clans, each a hauler or two, a few Scrapjack fighters, a hold-station and a matriarch or patriarch with a voice that carries. They vote by shouting. They settle debts in grams. Their haul-songs are the only music in the Reach that nobody taxes.`,
      `The Directorate calls them smugglers. The Hegemony calls them the unwashed. The clans call themselves the only honest people in the Reach, on the grounds that they are the only ones who admit they are in it for the gas.`,
    ),
  },
  {
    id: 'fac-vanguard',
    title: '13th Independent Squadron "Vanguard"',
    category: 'factions',
    body: p(
      `Squadron traditions, as recorded on the ready-room chalkboard aboard CVS-07 Hesperus Dawn (never erased; written over).`,
      `1. Vanguard goes through first. Always.`,
      `2. The Point flies One. The skipper flies Two, behind the Point, where she can see everyone's mistakes. The skipper is not the Point. The Point is whoever the skipper trusts to die first.`,
      `3. The kill pool is run by Jackpot. Jackpot is not to be trusted with the kill pool.`,
      `4. No one says "last flight". No one says "easy one". No one says "what could go wrong". Candle blesses the engines, not the pilots. Do not ask him to bless the pilots.`,
      `5. When someone does not come back, their mug stays on the hook.`,
      `[Below, in a newer hand:] 6. Sparrow is not allowed to read poetry on open channels. [And below that:] 6a. Unless it's a good one.`,
      `[The hooks, as of the start of the campaign: fourteen mugs. Six in use.]`,
    ),
  },

  // ════════════════════════════════════════════════════════════════════
  // TECHNOLOGY
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'tech-fossil',
    title: 'Fossil Technology',
    category: 'technology',
    body: p(
      `Nothing that flies in the Reach was designed in the Reach. Every hull pattern, drive core, beam emitter and flight computer is a golden-age original or a copy of one — copies made by people who could reproduce the shape of a thing perfectly and the reason for it not at all. The Directorate's Technical Service calls this "heritage engineering". Pilots call it fossil tech. Wardens call it the Keeping.`,
      `The results are strange. Directorate fighters carry sensor suites that can resolve a coin at a light-second, displayed on screens that can show only green. Choir crystal is grown in foundry-gardens that work only when sung to. A Kestrel's flight computer will correct a stall with inhuman grace and then, asked for its version number, reply in a dialect four centuries dead: SERVICE RESUMES SHORTLY.`,
      `The deeper strangeness is cultural. A civilisation that cannot make anything new learns to love maintenance. Reverence replaces curiosity; repair replaces design; a thing kept running for three hundred years becomes, in the most literal sense, holy. The Reach is not primitive. It is careful, which is worse, because careful people do not ask what else the machine could do.`,
    ),
  },
  {
    id: 'tech-keepings',
    title: 'The Seven Keepings',
    category: 'technology',
    body: p(
      `The litany of the Order of the Keeping, recited before any engine is lit. Traditionally counted on the fingers of the left hand and then the thumb and forefinger of the right.`,
      `First keeping: the seal holds.\nSecond keeping: the feed runs clean.\nThird keeping: the fire is fed and not starved.\nFourth keeping: the cold is let out.\nFifth keeping: the old words are said.\nSixth keeping: we do not ask the engine why.\nSeventh keeping: we thank it, and we go.`,
      `Commentary (from the Anchorage Cloister novice's primer): The Sixth Keeping is the hardest. The novice will want to know how the engine works. This is natural and must be outgrown. The engine was made by people wiser than us, for reasons we cannot see, and it has worked for longer than we have lived. To ask it why is to presume we could understand the answer. To open it is to risk that it will not close again. We keep. We do not ask.`,
      `A note on the fingers: the Seventh Keeping is counted on the right forefinger, pointing forward. The novice is told this is because the engine goes forward. The truth is that Hollis Marrow was missing the thumb of her right hand, and the count simply followed what she had.`,
    ),
  },
  {
    id: 'tech-ebon',
    title: 'Ebon-Gas',
    category: 'technology',
    body: p(
      `Technical summary (Directorate Technical Service): Ebon is a metastable exotic phase condensed from the outer envelopes of stars in their final shedding. It is harvested by skimming, stored under magnetic confinement, and measured in grams. Introduced into a Lantern's feed, it restores the ring's aperture for a duration proportional to mass. Its mechanism of action is unknown. Its occurrence in the Reach is restricted to three stars: the Tessaly giant, the Rustwake Ember, and a third, unconfirmed, whose location the Board declines to publish.`,
      `Pilot description (anonymous, convoy escort, Rustwake run): You don't see it. You see what it does to everything else. Crack a flask in a dark hold and the dark gets darker and the edges of things start to glow, violet, like they're lit from somewhere that isn't in the room. Black light, the haulers call it. The deck plating looks like it's standing a half-inch in front of itself. Your hands look like somebody else's hands. It tastes like pennies from across the room. You stop talking. Everybody stops talking.`,
      `Economic note (Office of Continuity): Every political conflict in the Reach since the Relighting can be modelled as a dispute over Ebon flow. This is not an analysis. It is an observation of the obvious that we are nonetheless required to minute.`,
    ),
  },
  {
    id: 'tech-lanterns',
    title: 'The Lanterns',
    category: 'technology',
    body: p(
      `A Lantern is a ring of black, seamless material between four and nineteen kilometres across, orbiting a star, holding open a fold to another Lantern. Every one of them was here before us. Golden-age engineers assumed the network was natural until they found the maintenance hatches.`,
      `Unlit, a Lantern is invisible except by the stars it does not show. Lit, it holds a sheet of light across its throat that pilots describe as looking like a still lake seen from underneath. Transit takes between four and nine seconds of subjective time. Most pilots do not like to talk about those seconds. Some hear a tone. Choir pilots hear a hymn. Wardens hear nothing, and are proud of it.`,
      `Six Lanterns burn in the Reach. Scores more hang dark in the systems, dead rings around living stars, gates that lead nowhere. The Null Lantern at the Reach's outer edge is the last of these before the dark, and it is the only one the Directorate keeps a picket on — by treaty with the Hegemony, who keep one too. Nobody remembers why that treaty was signed. The pickets remember the Signal.`,
    ),
  },
  {
    id: 'tech-kestrel',
    title: 'VF-27 Kestrel, Airframe 0413',
    category: 'technology',
    body: p(
      `Service record, Cloister of the Keeping, Anchorage. Condensed.`,
      `PATTERN: VF-27 variable-geometry interceptor. Golden-age design, Meridian Concord Timetable Guard. Reproduced at Anchorage yards under Keeping supervision since 224 AS.`,
      `AIRFRAME 0413: Flight computer core is original (golden-age, sealed, estimated age 600+ years). All other components replaced at least once. Fuselage replaced 11 times. Canopy replaced 23 times. Starboard canard replaced 41 times (the airframe has a known tendency to lead with its right shoulder). Seat is original to 388 AS and should be replaced but pilots will not allow it.`,
      `Previous pilots: 67. Of these, 31 retired, 22 transferred, 14 did not come home. The core was recovered on each of the fourteen occasions and reinstalled. The wardens consider airframe 0413 to be the same aircraft throughout. The Board's asset register lists it as nine separate aircraft for depreciation purposes.`,
      `Known quirks: The core occasionally speaks in the Timetable dialect. It hums, very faintly, when near a Lantern. It will not accept the pilot name field; it displays POINT. The cockpit smells of ozone and the previous pilot's coffee regardless of cleaning. Warden's note: this is normal. Warden's second note: none of this is normal. Warden's third note: keep it anyway.`,
    ),
  },
  {
    id: 'tech-cantus',
    title: 'The Cantus Protocol',
    category: 'technology',
    body: p(
      `Office of Continuity, signals desk. Analyst's working notes, not for circulation.`,
      `We've always treated the Choir's singing as theatre. It isn't. The Intonation (four rising tones, every transmission) is a carrier-lock handshake, and it's frequency-exact to seven decimal places across every Cantor we've ever recorded. That is not something you get from pilots humming. It's coming from the drive crystals.`,
      `The Hymn of Ascent — the long chant they run in combat — has a structure. Intervals repeat in a pattern I can only describe as a tuning procedure: a sequence of tones that, if played into a resonant ring, would sweep it through its harmonics and settle it. Like a warden tapping a bell to find the crack.`,
      `The intervals are prime ratios. 2:3. 3:5. 5:7. 7:11.`,
      `I don't know what that means. I know the Signal from the Null Lantern is also primes. I've been told to stop looking at this. I'm writing it down so that somebody doesn't.`,
    ),
  },
  {
    id: 'tech-clavis',
    title: 'Clavis-Class Gate Tender',
    category: 'technology',
    body: p(
      `Reconstructed from the self-documentation archive of the derelict The Long Patience.`,
      `CLAVIS (golden-age designation, "key"): gate tender, 1.1 km, crew 40. Carries a ring-aligned resonator spine able to open any Lantern regardless of lock state, and to adjust a Lantern's phase against the network standard. Eleven built. Ten laid up.`,
      `Directorate reclassification (Board of Allocation, Special Projects): GLADIUS PROGRAM. "A vessel capable of bypassing Lantern locks would permit the Directorate to project force through any Hegemony-held gate without warning. Strategic value: decisive." The Board's analysts translated "Clavis" as "the one who carries the keys", i.e. a gaoler. They did not consult the Keeping. The Keeping would have told them a key is also what you tune an instrument with.`,
      `Warden's note, appended in pencil: Twelve nodes along the spine, each sealed. Sixth Keeping forbids. I have not opened them. I have put my ear to them. They hum in the Choir's intervals. God help me, I think this ship is an instrument.`,
    ),
  },

  // ════════════════════════════════════════════════════════════════════
  // PEOPLE
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'ppl-kade',
    title: 'Lt. Cmdr. Saoirse Kade — "Abbess"',
    category: 'people',
    body: p(
      `Personnel summary, Office of Continuity.`,
      `Age 41. Born Anchorage, 390 AS, parents lost in the Tessaly Campaigns; raised in the Cloister of the Keeping orphanage, which accounts for the callsign, the vocabulary and her ability to field-strip a Kestrel drive in the dark. Nineteen years' front-line service. Eleven confirmed kills of Choir aces. Declined promotion to staff rank four times. Commanding officer, 13th Independent Squadron, since 426 AS.`,
      `Assessment: Loyal to the Directorate in the manner of someone who has never been offered an alternative. Contemptuous of the Board, which she describes as "the people who count the candles". Protective of her pilots to a degree that would be a liability in a less competent officer. Keeps a squadron mug for every pilot she has lost and washes them herself.`,
      `Flight note: flies Vanguard 2, never 1, by squadron tradition. Asked why she does not take the Point herself, she answered: "Somebody has to be able to see all of it."`,
    ),
  },
  {
    id: 'ppl-oyelaran',
    title: 'Captain Augustin Oyelaran',
    category: 'people',
    body: p(
      `Captain of CVS-07 Hesperus Dawn for twelve years; forty-four years in the fleet. Born on Meridian's Castellan ring, the son of a refinery hand. Widowed. One daughter, one granddaughter, Ada, age seven, who lives on Meridian and writes to him every allocation week in large and confident capitals.`,
      `Oyelaran commanded the Dawn through nine years of the Long Attrition without losing the ship, a record he attributed to "never once doing anything interesting". His crew called him Grandfather, and not only behind his back. He signed every order, including ones sending pilots to their deaths, with the Directorate's old farewell: Keep the light.`,
      `On the CAG board in the Dawn's ready room, among the launch schedules and casualty lists, he kept his granddaughter's star-chart, drawn in crayon on the back of a ration card. When pilots asked about it he would say it was the most accurate map of the Reach he had ever seen, and that it had been drawn by the only person in the Directorate who did not know what things cost.`,
    ),
  },
  {
    id: 'ppl-psalm',
    title: 'Dame-Cantor Isaura Sarre-Aurelian — "Psalm"',
    category: 'people',
    body: p(
      `Office of Continuity threat file, Choir ace.`,
      `First Cantor of the Hesper Measure. Twenty-six. Granddaughter of the reigning Zenith, which Continuity regards as the single most important fact about her and which she regards, as far as we can tell, as an inconvenience. Thirty-four confirmed Directorate kills. Flies an SC-4 Cantor with the crystal eye enamelled white — a mark of the Measure's first voice. Sings the Hymn of Ascent in a clear soprano that Directorate pilots describe, with unusual consistency, as "the last thing you want to hear and the thing you remember".`,
      `Behaviour: Strictly observant. Has never fired across the Treaty Line during Observance. Has twice been recorded disciplining her own pilots for breaches. Accepts no surrender and offers none; will, however, cease fire on a disabled pilot and say, on open channel, "You are witnessed." Several such pilots are alive. None of them talk about it.`,
      `Assessment: A true believer. Continuity recommends against any attempt to turn her. The recommendation notes that true believers are the only people worth turning.`,
    ),
  },
  {
    id: 'ppl-zenith',
    title: 'Ottavian Sarre-Aurelian, the Nineteenth Zenith',
    category: 'people',
    body: p(
      `His Serene Altitude has reigned for forty-one years. Before his election he was a scholar of the Spire archives, where the Houses keep what little of the golden age came to Hesper intact: a fragment of Builder text found in the Hesper Lantern's maintenance vaults, written in no human language, and studied for two centuries by people who could read none of it.`,
      `He read it. That is the rumour, and he has never denied it. He was thirty-three. He came out of the archive after nine years, was elected Zenith within the year, and has spent every year since preparing for something he has not named. The Choir's great building programme — the Cathedrals, the resonance spires — dates from his reign.`,
      `Directorate profiles describe him as cold. Those who have met him describe the opposite: a man of great tenderness who speaks to everyone as if they were a grandchild who had just asked a difficult question. He is said to weep at the Hymn. He is said never to sleep. He is said to keep, on the desk in his study, a single golden-age object: a child's rattle, found in a ship that was halfway through the Hesper Lantern when it went dark.`,
    ),
  },
  {
    id: 'ppl-pryce',
    title: 'Allocator-General Corwin Pryce',
    category: 'people',
    body: p(
      `Chair of the Board of Allocation for sixteen years. Before that, a refinery accountant at the Tey works; before that, a ration-card clerk. The Directorate's only self-made titan, and the man who, more than anyone, decides who in the Reach eats.`,
      `Pryce is not cruel. His admirers say this with pride and his enemies with despair. He regards the war as a regrettable constant, like weather, and has managed it the way one manages weather: with forecasts, contingencies and a quiet horror of surprise. His public addresses — the weekly Allocation Hour — are masterpieces of reassurance. He has never been heard to raise his voice. He has never been heard to say the word "death"; he says "expenditure".`,
      `He keeps a ledger in his own hand, in a code of his own devising, and takes it everywhere. Continuity has never been permitted to see it. One Continuity auditor did.`,
    ),
  },
  {
    id: 'ppl-magpie',
    title: 'Temperance Marsh — "Magpie"',
    category: 'people',
    body: p(
      `Master of the hauler Magpie's Due, head of Clan Marsh (eleven souls, two Scrapjacks and a cat of disputed ownership). Smuggler, salvager, Ebon-skimmer, informant to three intelligence services, all of whom believe they are her only one.`,
      `Magpie lost her eye to an Ebon flask that cracked in her hands when she was nine; she says the black light "got in and made itself at home", and that she can see things in the dark with the empty socket that nobody else can. She is almost certainly joking. The clans treat her as if she is not.`,
      `She sings haul-songs on open bands, off-key, at volume. She charges the Directorate triple, the Hegemony double, and her friends nothing at all, which is how you find out whether you are one.`,
    ),
  },

  // ════════════════════════════════════════════════════════════════════
  // ANOMALIES
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'anom-signal',
    title: 'The Signal',
    category: 'anomalies',
    body: p(
      `Office of Continuity. Classification: CANDLE-BLACK. Distribution: Board only.`,
      `SUMMARY: Since 430 AS, Directorate and Hegemony pickets at the Null Lantern have recorded a narrow-band transmission originating beyond the Lantern, in the region charted as void. It is not natural. It consists of bursts of identical pulses separated by silence. The number of pulses in every burst is prime. Each burst contains the next-lowest prime to the burst before it. Bursts arrive at intervals of 25 hours 51 minutes, to within a millisecond.`,
      `It is counting down.`,
      `At current rate the count will reach 2 in approximately 180 days. We do not know what happens at 1, which is not prime, or at 0, which is not anything.`,
      `RECOMMENDATION: The Board declines to publish. The Board notes that the Hegemony picket has certainly logged the same transmission and that the Hegemony has also declined to publish. The Board regards this as the first thing the two governments have agreed on in thirty-seven years, and considers it prudent not to spoil it.`,
    ),
  },
  {
    id: 'anom-caul',
    title: 'The Dead Zone',
    category: 'anomalies',
    body: p(
      `Beyond the Null Lantern, where the old charts show nothing, there is not nothing. There is the Caul: a nebula so dense and so old that it has stopped being a cloud and become a kind of weather, light-years deep, grey-violet, full of slow lightning.`,
      `Instruments fail inside it. Not gradually. The compass spins, the rangefinder returns the same distance for every object, the star-tracker reports that it is looking at a star it cannot identify in every direction at once. Golden-age flight computers — which have seen everything — display SERVICE SUSPENDED and refuse to be argued with.`,
      `Rustwake prospectors say you can fly the Caul by eye if you are patient and do not believe your instruments, the way you would cross a marsh in fog by watching the ground. They say this from the edge of it. No prospector who has gone further has come back to say anything else.`,
    ),
  },
  {
    id: 'anom-anchor',
    title: 'The Monolith',
    category: 'anomalies',
    body: p(
      `A sphere, 3,470 kilometres across: the size of Earth's moon, if the old records can be trusted about Earth's moon. Perfectly smooth to the limit of any instrument brought against it. Colder than the space around it. It does not orbit anything. The space near it does not quite obey the space around it; clocks run a hair slow, starlight bends a hair wrong, and the Caul's grey lightning stops, as if at a wall, twenty kilometres from its surface.`,
      `Surface dating by radiation exposure gives an age of eleven million years. Humanity is not eleven million years old.`,
      `The squadron called it the Monolith because Jackpot did, and Jackpot did because of an old film he had never seen, only heard about. The Builders' own archive calls it an anchor. Both names turn out to be right. It holds the local fabric of space steady, the way a keel holds a ship steady: not by fighting the sea, but by going deeper than the sea does.`,
    ),
  },
  {
    id: 'anom-compression',
    title: 'The Compression Wave',
    category: 'anomalies',
    body: p(
      `What the Builders' archive calls the Breath, and what Directorate physicists — once they are allowed to see the archive — will call the Compression: a periodic wave of spacetime density sweeping outward through the galaxy's disc like a ripple crossing a pond. At the Reach's distance from the galactic core, its crest passes once every 431 years.`,
      `Planets do not notice it. Stars barely do. Anything built to fold space notices it enormously. A Lantern in true phase with the network drinks the crest the way a sail drinks wind — the Breath is what powered the Builders' network, not Ebon, which is a crude substitute. A Lantern out of phase is a bell struck at the wrong note. It rings. Then it cracks. Then everything in its throat is somewhere that is not anywhere.`,
      `The golden age tuned its gates every cycle. Then, in the budget year 2,197 of the Timetable, it stopped. The next crest was the Shattering.`,
      `The next crest after that is now.`,
    ),
  },
  {
    id: 'anom-nexus',
    title: 'The Nexus',
    category: 'anomalies',
    body: p(
      `A Lantern two hundred kilometres across. Intact. Unlit. Holding its shape against nothing, in the empty space beyond the Monolith, at the point the Zenith cruiser Canticle of Ascent had spent six years mapping a path to.`,
      `Every Lantern in the Reach is a spoke. This is a hub. Its archive-geometry — faintly visible in the rim as lines of dim light that move when you are not looking directly at them — maps the entire network: every Lantern in the galaxy, lit and dark, and the lines between them. The squadron's first sight of it produced, on the Vanguard channel, eleven seconds of complete silence, which Kade later described as the longest the squadron had ever gone without somebody making a joke.`,
      `Whoever holds the Nexus holds the network. Whoever holds the network can open every gate at once, or close every gate forever. The Zenith has known this for forty years.`,
    ),
  },
  {
    id: 'anom-builders',
    title: 'The Builders',
    category: 'anomalies',
    body: p(
      `The golden age called them the Cartographers, because the only thing they seemed to have left was the map. The Directorate calls them the Builders, because it prefers words that describe work. The Hegemony calls them the Ascended, and believes they became something better than matter and left the galaxy to the children.`,
      `The Hegemony is half right. The Builders did leave. They did not ascend. They moved.`,
      `Their archive, spoken by the Monolith to anyone who comes close enough to listen, describes a species that watched the Breath deepen over millions of years — each crest a little stronger, each cycle a little less of the inner galaxy habitable — and decided, as one, to go outward, beyond the disc, into the dark between galaxies where the wave does not reach. They built the Lanterns as the road. They built the anchors to keep the road steady. They tuned it and they walked it and they left it lit behind them, for whoever came next.`,
      `They left instructions. We lost them. They left a clock. We found it.`,
    ),
  },

  // ════════════════════════════════════════════════════════════════════
  // LOGS
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'log-timetable-beacon',
    title: 'Beacon Recording, Anchorage Great Lantern',
    category: 'logs',
    body: p(
      `Automated transmission, golden-age timetable beacon, Anchorage Graveyard. Recorded by Kestrel 0413, 431 AS. The beacon has been broadcasting on a loop for 431 years. Its power source is unknown. The wardens forbid anyone to switch it off.`,
      `[chime] Meridian Concord Timetable Authority. This is a service announcement for passengers at Anchorage Great Lantern.`,
      `Service to Meridian, Hesper, Tessaly and all points coreward is delayed. We apologise for the inconvenience.`,
      `Vessels in transit: please hold your position. Do not attempt to leave the aperture. A tender is on its way.`,
      `Service will resume shortly. Thank you for travelling with the Timetable.`,
      `[chime]`,
      `[Warden's note appended to the recording: The tender did not come. We have kept the recording because somebody should keep the promise, even if it is only a machine.]`,
    ),
  },
  {
    id: 'log-null-picket',
    title: 'Null Lantern Picket — Patrol Logs',
    category: 'logs',
    body: p(
      `Directorate Null Picket Station 2. Duty officers' log. Extracts.`,
      `Day 1. Signal on the long band, heading void-ward, bearing through the Null Lantern's throat. Pulsed. Counted 1,999 pulses before it stopped. Nav says it's echo off the ring. Nav is an idiot.`,
      `Day 2. Again. 1,997. Nav wants to know why I'm counting. I tell him because I'm bored. Truth is I can't stop.`,
      `Day 5. 1,987. 1,979. The gaps between the numbers aren't regular but the numbers are all — I had to look this up — prime. Every one. Somebody out there is counting down the primes, one a day.`,
      `Day 31. The Hegemony picket across the ring flashed us at shift change. They don't do that. I think they heard it too. I think they're as scared as we are.`,
      `Day 77. Continuity came aboard. Took the recorder. Told us it's a pulsar. A pulsar that knows arithmetic. We signed the forms.`,
      `Day 134. 1,013. Relief pilot arriving tomorrow — some kid in an ancient Kestrel with a flight computer that hums. When the burst came through tonight the kid's computer answered it. Just once. One pulse. I am not putting that in the official log.`,
    ),
  },
  {
    id: 'log-canticle',
    title: 'Black Box of the Canticle of Ascent',
    category: 'logs',
    body: p(
      `Recovered from the Choir Vesper-class cruiser Canticle of Ascent, Zephacis. Decrypted by Commander Y. Aubrac, Office of Continuity. Liturgical formulae abridged.`,
      `[Intonation.] Be witnessed. Log of the Canticle, sixth year of the Stair. Survey of the void beyond the Null resumes. The Caul admits us one kilometre further by the grace of the Altitude. Instruments fail as foretold. We fly by the Hymn.`,
      `Sixth year, day 203. The Anchor is where His Altitude said it would be. It is the size of a moon. The crew are weeping. I have allowed it.`,
      `Sixth year, day 240. Beyond the Anchor, the Great Ring. Intact. Unlit. His Altitude's text did not exaggerate. The Stair is complete: 41 waypoints, Null to Ring. Transmitting the path to the Spire under seal.`,
      `Sixth year, day 241. Treasury requests a copy of the path for "allocation planning". His Altitude has not authorised this. Treasury insists. Treasury says the Directorate's Allocation must not learn of the Ring before the next quarterly Schedule. I do not know what a quarterly Schedule is. I have asked Treasury. Treasury has told me to sing.`,
      `Sixth year, day 244. Directorate pickets at Zephacis. Engaging. [End of intelligible record.]`,
    ),
  },
  {
    id: 'log-schedule',
    title: 'The Schedule',
    category: 'logs',
    body: p(
      `Document recovered from the Canticle's secondary cache, cross-referenced against the Board of Allocation's sealed accounts by Cmdr. Y. Aubrac. Two signatures: C. Pryce, Allocator-General; V. Quillon, Hierarch-Treasurer. Format: a joint forecast.`,
      `SCHEDULE OF ENGAGEMENTS, Q3 431 AS.`,
      `Eng. 112 — Tessaly approaches. Convoy action. Expected expenditure: Directorate 6 fighters, 1 corvette; Hegemony 8 fighters. Ebon released to market: 1,140 kg.`,
      `Eng. 113 — Rustwake margin. Raid. Expected expenditure: Rustwake clans (unaligned) 4 haulers. Ebon released: 310 kg.`,
      `Eng. 114 — Lysowick. Fleet sortie. Expected expenditure: Directorate 11 fighters (13th Independent Sqn requested by name as "costly and visible"); Hegemony 9 fighters. Ebon released: 2,020 kg.`,
      `NOTES: Both parties affirm the price floor at 88 shares/gram. Both parties affirm that the purpose of the Schedule is the preservation of order and the prevention of general war. Both parties affirm that no engagement shall be decisive.`,
      `[Handwritten, Aubrac:] Thirty-seven years. The war is a thermostat. We are the fuel it burns to hold the temperature. I have audited this Board for nine years and I signed off on every one of these numbers without knowing what they were. I knew what they were.`,
    ),
  },
  {
    id: 'log-patience',
    title: 'Last Log of The Long Patience',
    category: 'logs',
    body: p(
      `Golden-age Clavis-class gate tender The Long Patience. Final bridge recording. Timetable dialect, rendered into modern Reach by the ship's own archive, which had been waiting 431 years for someone to ask.`,
      `Master's log, Timetable year 2,198, fourth month. We are the last tender in service. The Authority laid up the other ten in the savings of '97. They said the gates hold their own phase now. They said tuning was a ceremony. They said the Breath was a story engineers tell to protect their budgets.`,
      `The crest is eleven hours out. We have tuned Corouhold. We will not reach Anchorage. Four hundred gates in this arm alone and one ship.`,
      `I have ordered the crew to record the Clavis procedure into every archive we pass. Somebody will find it. Someone will need it. It will be a long time. We are called the Long Patience; I suppose we will find out if we earned the name.`,
      `Across the lane I can hear the Anchorage ring beginning to ring. It comes through the hull. It sounds like a hymn.`,
      `If you are hearing this: the key is not in the ship. The ship is the key. Do not open it; play it.`,
    ),
  },
  {
    id: 'log-dawn',
    title: 'Hesperus Dawn — Final Deck Log',
    category: 'logs',
    body: p(
      `Flight deck log, CVS-07 Hesperus Dawn, Anchorage. Recovered from Vanguard 1's flight recorder. Transcribed by Cmdr. Y. Aubrac.`,
      `1402:10 CONTROL: Cathedrals through the Anchorage Lantern. Three. Four. They had our codes. They had the gate codes.`,
      `1402:44 ACTUAL: All squadrons launch. All of them. Everything with a seat.`,
      `1403:30 CONTROL: Deck is green. Deck is green, Vanguard, go, go.`,
      `1405:02 ACTUAL: Lodestar is gone. Constant is gone. We're holding the hangar doors open, Control, keep them open.`,
      `1406:51 CONTROL: Deck is green. Deck is... [inaudible]`,
      `1407:15 ACTUAL: Kade. The chart is in your seat pocket. Take it back to her. Tell her the lines go somewhere. All Vanguard: you are released. Go where the light is. Keep the light.`,
      `1407:19 [End of record.]`,
    ),
  },
  {
    id: 'log-oracle',
    title: 'The Oracle Broadcast',
    category: 'logs',
    body: p(
      `Transcript of the Anchor Archive's automated transmission, as received by Vanguard at the Monolith. The archive translated itself, progressively, using the flight computer of Kestrel 0413 as a dictionary. Early passages are rough. Later passages are not.`,
      `WE ARE WHO BUILT THE ROAD. YOU ARE WHO FOUND IT. THIS IS THE THING THAT KEEPS THE ROAD. LISTEN.`,
      `The galaxy breathes. Each breath is a wave of pressure in the fabric, crossing the disc outward from the heart. Worlds do not feel it. Roads do. A road in tune carries the breath and is fed by it. A road out of tune breaks.`,
      `Each breath is deeper than the last. We measured it for a very long time. Then we decided. We went outward, past the edge of the disc, where the breath does not reach. We are not gone. We are ahead.`,
      `We left the road lit. We left anchors to hold it. We left keys to tune it. We left a clock so that whoever came after would know when to tune. We counted in the numbers that cannot be divided, because any mind that counts will know them.`,
      `The clock is counting now. When it reaches the smallest of the numbers, the breath arrives. Tune the road, and follow. Or do not tune it, and stay. Either is permitted. Only do not leave it half-tuned. That is how roads break.`,
      `We hoped someone would come. We hoped they would bring a key. We hoped they would bring more than one kind of song.`,
    ),
  },
  {
    id: 'log-sparrow',
    title: 'Sparrow\'s Notebook',
    category: 'logs',
    body: p(
      `Pages from Ensign Wren Talbot's personal notebook. Pencil. Recovered with her permission.`,
      `Day 1 aboard. The Hesperus Dawn is enormous and it smells like hot pennies and old soup. Jackpot named me Sparrow within four minutes and said it was because I'm small and loud. Abbess said it was because sparrows are the ones that stay all winter. I think she was being nice. I don't think she knew she was being nice.`,
      `After the Rot. I used to think the Directorate was the good one. Not good. Good-er. I used to think the numbers meant somebody was being careful with us. They were. That's the worst part. Somebody was being very, very careful with us.`,
      `After the Bastion. Candle says the Keepings are for engines, not people. I asked him what the people are for. He said, "Flying the engines." I think that was a joke. I laughed so hard I cried and then I just cried.`,
      `After the Monolith. It spoke to us. It said "we hoped someone would come." All my life I thought we were the ones left behind. What if we're the ones who were waited for?`,
      `Copied out, for luck, from a golden-age poem I found in the Patience's archive, author unknown: "We shall not cease from exploration..." The rest is corrupted. I like it better that way. It means you have to finish it yourself.`,
    ),
  },
  {
    id: 'log-chart',
    title: 'A Chart, in Crayon',
    category: 'logs',
    body: p(
      `Catalogued by the Office of Continuity as personal effect 0431-A, formerly of Capt. A. Oyelaran. Currently carried in the seat pocket of Kestrel airframe 0413 / Vanguard 2.`,
      `The reverse of a standard Directorate ration card (see: The Board of Allocation). Drawn in wax crayon — blue, orange, and a green that has been used almost to the end. Six stars, correctly placed, labelled in capitals: MERIDEN (sic), ANKRIDGE (sic), TESSALY, HESPER, RUSTWAKE, NULL. Between every star and every other star, a line — fifteen in all, most of which correspond to no Lantern route that has ever existed.`,
      `From every star, additional lines run off every edge of the card. Along the right-hand edge, in the green crayon: THEY GO SOMEWHERE.`,
      `Below that, in the orange, smaller, the tail of the last letter running off the card: GRANDPA WHERE DO THEY G`,
    ),
  },
];
