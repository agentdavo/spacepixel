# Vanguard — universe, civilizations, fleets and languages expansion plan

25 September 2026 · **implementation authorized for U00–U08**
Scope clarification: **both fictional languages and real-world player localization**.

David subsequently instructed: “start implement U00 through U08”. Work is underway on the isolated `codex/universe-expansion` branch. See the [implementation ledger](EXPANSION-IMPLEMENTATION.md) for delivered code, validation and outstanding production gates. Authorization to implement does not mark those gates as passed.

## Recommendation

Build an **Open Horizon expansion programme** around eight major peoples/lineages, ten principal civilizations, eight regions, approximately 192 sector-map systems and 80–100 distinct flying ship designs. Establish the architecture and prove **two new civilizations in one six-system frontier sector** before expanding the entire map.

The figures below are proposed content targets, not current implementation or delivery estimates. The six new peoples and their names are working concepts for approval. Existing Directorate, Hegemony, Rustwake, Kessen and Builder canon has priority until a specific revision is signed off.

The isolated rendering branch records its groundwork in `docs/PACKAGE-A-ACCEPTANCE.md` and `docs/reviews/package-a/index.html` at commit `02b2817`. That package is not included wholesale in the expansion integration. The existing hangar supplies model inspection in the integrated prototype.

## 1. What the code supports now

| Area | Verified baseline | Expansion consequence |
|---|---|---|
| Political/economic factions | Three IDs: `concord`, `choir`, `rustwake`. Display identities are Terran Directorate, Zenith Hegemony and Rustwake Ebon-Gas Clans. | Replace scattered three-way assumptions with validated registries and compatibility adapters. |
| Peoples | The main powers are human cultural/political divisions. Kessen are an approved human-descended people with their own history, culture and frames. The Builders are ancient, absent and central to the mystery. | A biological lineage, a culture and a state must be distinct entities. Do not count every government as a new species. |
| Reach | Running `generateUniverse(1994)` gives **22 systems, 51 stations and 12 surface ports**. Six named key systems anchor the generator. Dead Zone, Monolith and Nexus are separate campaign locations. | Keep the existing Reach stable; add regions with independent seeds, content manifests and discovery gates. |
| Flying ships | **28 registered designs**, across seven blueprint class labels and a broader catalogue role vocabulary. | Preserve existing IDs; expand shipbuilding traditions and role/capability definitions. |
| Kessen | Separate frame system, five size classes, fourteen variants; current campaign participation is bounded environmental cameos. | Frame stature is not a ship class. Broader Kessen gameplay remains an explicit future scope decision. |
| Fictional speech | Character voice profiles and procedural accents, cultural sayings, ancient Timetable dialect and scripted Oracle translation. | These are useful foundations, but not a general constructed-language/translation system. |
| Player language | Dialogue uses `text` plus optional `jp`; UI and much content embed English strings. | Extract stable message IDs and locale bundles before multiplying translated content. Japanese flavour lines are not a completed Japanese localization. |
| Voice assets | Recorded clips are selected from voice/text keys, with speech/synth fallbacks. | Add spoken language, pronunciation revision, stable dialogue ID and per-language timing to asset identity. |
| Persistence | Profile, trade and other career stores have separate localStorage keys; world facts/modifiers persist independently of a capped recent event log. | Migrate all affected stores together. New territories must not regenerate old station IDs, inventories or campaign facts. |

Evidence: [faction definitions](../src/assets/Factions.ts), [FactionId](../src/assets/Blueprint.ts), [economy](../src/game/economy.ts), [generator](../src/universe/generate.ts), [universe types](../src/universe/Universe.ts), [dialogue types](../src/game/campaign/types.ts), [voice planner](../src/audio/voice/plan.ts), [recorded clips](../src/audio/voice/Recorded.ts), [world state](../src/game/world/WorldState.ts), [Kessen data](../src/kessen/data.ts), [lore](LORE.md).

These expansion-sensitive files have no changes between the reviewed integration baseline `4ef419b` and the later local integration revision `b48f62e`. The rendering implementation remains isolated on `codex/render-ships-m01-m04`; it has not been merged into that later integration checkout.

## 2. Proposed scale

| Content | First playable frontier | Long-term target |
|---|---:|---:|
| New peoples | 2 | 6, joining humanity and Kessen: **8 major peoples/lineages** |
| Principal civilizations | 2 new | **10**: three existing human powers, the Standing, six new principal civilizations |
| Internal/minor organizations | 4–6 | **20–30** houses, guilds, republics, orders, diasporas and commercial powers |
| New sector-map systems | 6 | Eight regions, **160–240 systems**; example layout totals **192**, including the existing 22 |
| Authored regional anchors | 2 | **24–32**, with unique landmarks, social hubs and recurring characters |
| New flying hulls | 8: four per pilot civilization | **80–100 total**, including the existing 28; nominal production plan **84** |
| Kessen frames | Existing five statures remain distinct | Existing fourteen variants tracked separately; additional frames require their own brief |
| Living fictional speech profiles | 2 new, plus a common contact protocol | **10** principal language/register profiles, with regional dialects where justified |
| Ancient language/code profiles | Existing story-controlled fragments | Timetable archive language and Builder code, with controlled reveal rules |
| Player locales | en-GB source, pseudolocale, one fully checked translated pilot | Proposed **7 text/subtitle locales**; dubbing has a separate budget |

A “new hull” means a distinct geometry and tactical design. Paint schemes, equipment marks and mirrored versions do not increase that count. A system is counted separately from a station, planet or hidden story location.

The nominal 84-hull plan is **28 existing + 48 new (six new traditions × eight hulls) + eight existing-fleet gaps**. At least one third of the overall fleet should serve civilian, logistics, exploration or industrial roles. The Kessen retain their frame/consist identity rather than acquiring a conventional navy to fill this arithmetic.

## 3. Entity model: the structure that allows diversity

| Entity | Owns | Example |
|---|---|---|
| People / lineage | Origin, anatomy, environmental needs, senses and communication channels | Humanity, Kessen, proposed Nacreans |
| Culture | Customs, naming, language practices, material traditions and disagreements | Directorate naval culture, Rustwake clan cultures |
| Polity / faction | Government, territory, laws, diplomacy, reputation and allegiance | Terran Directorate, the Standing |
| Organization | A local or cross-border institution | Shipyard, trade guild, dissident house, mercenary company |
| Fleet tradition | Hull grammar, manufacturing, markings, equipment and doctrine | Anchorage-pattern naval designs |
| Language / register | Grammar, lexicon, writing, pronunciation and translation conventions | Reach Common, Kessendra Works Tongue |
| Region / system | Geography, routes, resources, population and control | Meridian Reach, a newly connected frontier |
| Individual | Personal affiliations, competence, beliefs, languages and voice | A multilingual pilot serving outside their home culture |

Ownership and design must be separate. A captured Directorate-built freighter keeps its architecture while its owner, transponder, legal status and crew change. The same people can belong to rival states; a state can contain several peoples. Individuals can dissent from their government's doctrine.

The current `concord`, `choir` and `rustwake` IDs remain valid throughout migration. New registries need build-time validation and typed references, not unvalidated string lookups scattered through combat code.

## 4. Civilization roster for concept sign-off

Humanity, with the Directorate, Hegemony and Rustwake, remains the emotional and historical anchor. The Standing retains Kessen agency, five frame statures, the Seam and its industrial language. The Builders remain an absent civilization; they are not an additional selectable faction.

The following **six new concepts are proposals**, including their names and biology. Each needs a political opposition, civilian life, individual characters and a reason to cooperate as well as fight.

| Proposed people / principal civilization | Life and culture premise | Fleet silhouette and doctrine | Speech identity | Limitation that creates choices |
|---|---|---|---|---|
| **Nacreans / Pelagic Assemblies** | Aquatic peoples living in pressure habitats; competing basin assemblies and merchant leagues | Paired pressure bodies, enclosed service channels and broad steering surfaces; manoeuvre, screening and rescue craft | **Nacric**: harmonic pulses and clicks; pressure/habitat vocabulary; readable phonetic transcription | Maintaining habitable pressure consumes space and logistics. Large habitat modules are recognisable system targets. |
| **Oruni / Mantle Compact** | Dense-world, subterranean societies; civic foundries and independent excavation cities | Layered, compact armour masses, recessed mounts and slow industrial carriers; positional fire and protected logistics | **Orunic**: percussion and vibration converted to radio sound; formal cadence, concise emergency register | Heavy hulls surrender acceleration and wide deployment flexibility. |
| **Veyri / Migrant Houses** | Low-gravity peoples whose communities travel between distributed habitats; rival houses and settled minorities | Open trusses, articulated radiators and long sensor vanes; reconnaissance, carrier coordination and withdrawal | **Veyric**: whistled contours and timed pauses; separate flight and domestic registers | Exposed service structures and dependence on tenders make prolonged attrition costly. |
| **Serev / Linked Republics** | Citizens communicate in temporary linked groups while retaining individual identity; competing views of connection and privacy | Braided hulls around visible command/relay nodes; coordinated formations and distributed sensors | **Serevic**: parallel light/sign patterns plus a serial radio form; explicit speaker and group attribution | Coordination depends on identifiable relays. Disruption creates openings without making every citizen a drone. |
| **Aruun / Seedwardens** | Symbiotic peoples maintaining inherited living habitats; competing custodial, commercial and expansionist movements | Ribbed ceramic/biofabricated shells and protected nursery ships; endurance, area control and recovery | **Aruunic**: breath and overtone phrases with a developed symbolic script | Specialized maintenance, slow replacement and vulnerable support infrastructure. No unlimited regeneration. |
| **Vorr / Archive Commonwealth** | A computational people with distinct citizens and political institutions; disputes over memory, continuity and copied identity | Tessellated vaults, discrete modules and sparse external lights; precision sensing and economical fire | **Vorr notation**: structured radio packets with an audible rendering and checksum-like ritual forms | Sensor certainty and preserved infrastructure matter; misinformation and isolation create tactical costs. They do not possess the campaign's missing Builder answers. |

Recommended pilots: **Nacreans and Oruni**. Their silhouettes, habitats, communication and combat rhythms offer a clear comparison and test whether the content architecture supports real variation.

The visual rules still serve Vanguard: limited palettes, strong values, bold outer contours, readable damage and purposeful articulation. Every civilization needs a recognizable distant silhouette, a sound signature and a civilian environment before it receives a large war fleet.

## 5. Universe structure and discovery

A proposed 192-system layout:

| Region | Systems | Primary purpose |
|---|---:|---|
| Meridian Reach | 22 existing | Campaign anchor; existing routes and history retained |
| Fractured Marches | 28 | Mixed frontier, disputed routes, first contact and independent stations |
| Pelagic Expanse | 26 | Nacrean habitats, ocean worlds, rescue and pressure logistics |
| Migrant Roads | 22 | Veyri mobile hubs, seasonal convoys and route intelligence |
| Mantle Provinces | 24 | Oruni industrial chains, dense worlds and fortified approaches |
| Linked Territories | 24 | Serev republics, relay infrastructure and political borders |
| Seedward Reaches | 22 | Aruun habitats, migration and contested stewardship |
| Archive Shoals | 24 | Vorr archives, isolated infrastructure and incomplete charts |
| **Total** | **192** | Planning example, subject to content/performance gates |

Kessendra is an exceptional shoal/Seam location, not an ordinary Lantern stop. Existing off-map campaign spaces retain their authored rules.

Each region needs three levels of content: authored anchors; authored encounter/location kits assembled deterministically; low-detail background geography. A region's seed must derive independently from the universe seed and stable region ID. Adding a region must not consume random values from the existing Reach generator and alter its saved topology.

A system dossier contains ownership and population separately, route access, language distribution, imports/exports, habitat conditions, landmarks, local history, recurring NPCs and encounter weights. Navigation should reveal information progressively: signal, surveyed route, visited system, local knowledge.

**Story placement:** recommend the substantial first-contact arcs after the campaign's Open Horizon. Early rumours, unfamiliar cargo and distant signals can foreshadow them without announcing late revelations. A separate frontier career can offer earlier player access through its own explicit chronology. Changing the core twenty episodes or making Kessen broadly playable needs a separate story decision.

## 6. Ships, classes, weapons and destructible systems

Adopt a shared comparison vocabulary while retaining local class names:

- Small craft: scout, interceptor, superiority fighter, strike craft/bomber.
- Escorts and line ships: gunship, corvette, frigate, destroyer/cruiser.
- Fleet platforms: carrier, command ship, siege/battleship.
- Civil/industrial: courier, freighter, tanker, miner, tug, tender, survey and habitat ship.
- Exceptional units: Kessen frame statures and consists, gate tenders and other special platforms.

Every tradition can fill roles differently; it need not field one of every class. Class names describe architecture, roles describe encounter jobs, and capabilities determine shields, sections, weapons, hangars and component damage.

Every production hull gets an acceptance sheet containing:

1. Four views, dimensions, 32/64/128 px silhouettes, faction/value palette and true-scale comparison.
2. Crew/habitat and maintenance logic; propulsion placement and a readable bow/forward direction.
3. Fixed muzzle directions, articulated traverse/elevation, firing obstruction and point-defence coverage.
4. Shield shape, facing policy, emitters, generator and collapse feedback.
5. Engine, command, power, weapon and support-system locations with explicit gameplay consequences.
6. Intact, damaged, disabled, detached and repaired states where those states are supported.
7. Collision and targeting proxies that agree with the visible components.
8. LOD, draw/material/particle budgets and seeded encounter validation.

Implement the subsystem atlas and modular-damage work from M05/M07 before relying on removable radiator, pressure-body, relay or nursery geometry. The first frontier slice uses existing verified weapon and damage capabilities with distinct tuning/doctrine. New armour, heat, bio-repair, power distribution or electronic-warfare mechanics get individual design and balance gates.

## 7. Fictional language programme

Start with ten living speech profiles: **Reach Common, High Hesper, Rustwake Trade Cant, Kessendra Works Tongue**, and the six proposed new languages. “Profile” accommodates a full language, a cant or a register without falsely claiming they are all unrelated language families. Directorate service speech is a register of Reach Common. Timetable and Builder material are separate historical/story profiles.

For each profile deliver:

| Layer | Pilot requirement | Mature requirement |
|---|---|---|
| Sound and naming | Phoneme/sign inventory, syllable rules, stress/timing, 50 vetted names | Regional naming traditions, consistent pronunciation dictionary |
| Grammar | Word order, questions, negation, commands, numbers, person/group reference | Formal/informal speech, aspect, politeness and culture-specific distinctions |
| Lexicon | Approximately 250 roots; sufficient authored compounds for the pilot | Approximately 1,000 curated roots plus a controlled phrase corpus |
| Writing | Script concept, transcription and font/glyph fallback | Legible UI and environmental writing, short/long forms, accessibility equivalents |
| Radio corpus | 60 reviewed barks covering hail, docking, warning, damage, retreat and rescue | Expanded combat, civil, diplomatic and mission corpus, with speaker variation |
| Cultural use | Greetings, taboo, humour, oath, mourning and work language | Regional/register variation and code-switching |
| Voice | Pronunciation guide and a short approved performance reel | Versioned clips and timings; consistent characters and native-language direction |

These are game-language coverage targets, not a claim to have produced fully fluent general-purpose languages. Existing English-shaped procedural speech does not count as Nacric or Orunic until its phonology and authored meaning match that language's specification.

Each utterance has a stable semantic/dialogue ID, source meaning, spoken language, native wording/transcription, localized display text, speaker and audio reference. Speech must not be generated from arbitrary random syllables when the scene claims a specific meaning.

Translation can add discovery: unrecognized signal → identified language → limited contact vocabulary → competent interpretation → cultural nuance. It is deterministic, authored and saved. The ship computer must still communicate essential mission actions, hazards and controls clearly in the player's chosen locale. Richer translation should reveal intention and history, rather than make basic navigation depend on deciphering audio.

The Oracle's existing translation sequence remains story-owned; a generic translator must not bypass its campaign reveals.

## 8. Player localization programme

Confirmed scope: both lore languages and player localization. Keep independent settings for **UI language, subtitle language, heard speech and optional native-language secondary line**.

Recommended text/subtitle target set for sign-off:

| Tier | Locales | Commitment |
|---|---|---|
| Foundation | en-GB source + artificial expanded-text locale | Extract strings, placeholders, pluralization, numbers/units, fonts, layout and stable keys |
| First complete pilot | ja-JP | Fully review the frontier slice, settings, docking, combat guidance and mission text; replace scattered flavour lines with the new pipeline |
| Expansion releases | fr-FR, de-DE, es-ES, pt-BR, zh-Hans | Sequence by staffing and audience priorities; each locale ships only when its release scope is fully checked |
| Later candidates | Other locales selected separately | No unsupported promise of complete subtitles or dubbing |

This is **seven proposed real-world locales including English**. Japanese is recommended as the first implementation test because of Vanguard's presentation and existing fragments; it is still a production decision for sign-off.

Text localization and recorded dubbing have separate coverage matrices. Start with complete text/subtitles for the selected release and the approved English/native-fictional voice presentation. Add localized dubbing selectively after script and cast approval; do not multiply every incidental bark by every locale during the prototype.

Replace `text/jp` as the long-term content interface with message IDs and locale bundles, while retaining a migration adapter for existing scenes. Audio identity should include dialogue ID, line revision, spoken language, voice and pronunciation revision; timing belongs to the actual clip, not the source-language sentence.

Acceptance includes pseudolocalization, long labels, CJK font coverage and wrapping, Unicode normalization, bidirectional-layout readiness, missing-key reports, subtitle reading time, per-language audio synchronization and save persistence. Locale selection must not change simulation outcomes.

## 9. Architecture work

| Workstream | Code pressure points | Required result |
|---|---|---|
| Registries | Blueprint/FactionId, Factions, economy, stations, cast, loadouts, NPC voice selection | Add a civilization from a content pack with validated references; no new three-way switches |
| Diplomacy and identity | Ship owner/team, station faction, reputation, patrol/traffic and mission exceptions | Owner, crew origin and hull tradition are independent; ally/neutral/hostile rules are consistent |
| Regional universe | generateUniverse, StarSystem, route, StarMap, station/surface generation | Region manifests, stable IDs/seeds, discovery, lazy asset loading and route validation |
| Localization/fictional language | ChatterLine, UI strings, Subtitles, voice planner/Recorded/neural | One authored meaning can be spoken and displayed in independently chosen languages |
| Saves | Profile, ledger, contracts, world facts and other career stores | Versioned migration with backup/round-trip checks; preserve money, fit, location, progress and reputation |
| Fleets | Catalogue/blueprints, ShipBuilder, Combat, outfitting, AI and damage presentation | Shared role/capability contracts plus civilization-specific design and doctrine |
| Content validation | Build tooling and tests | Invalid faction, missing ship, unresolved language, broken route or missing critical text fails validation |

Suggested pack boundaries are `peoples`, `cultures`, `polities`, `fleet-traditions`, `languages`, `regions` and `locales`, each with stable IDs and manifest versions. Avoid a monolithic “race” object that owns every other system.

Background expansion uses coarse deterministic economic/diplomatic updates. Only the current encounter receives full flight/combat simulation and detailed rendering. Background populations and trade flows are not thousands of continuously instantiated ship meshes.

## 10. Milestones and sign-off gates

| ID | Milestone | Deliverable | Exit gate / dependency |
|---|---|---|---|
| **U00** | Universe charter | Approved count range, eight-region map, civilization briefs, language/locale targets and canon boundaries | David chooses the first two peoples and approves their role in the setting |
| **U01** | Extensible content and saves | Registries, owner/design separation, language IDs, manifest validation and save adapters | All current content works unchanged; old saves round-trip; adding a test civilization requires no faction-specific engine branch |
| **U02** | Two civilization prototypes | Nacrean and Oruni anatomy/culture sheets, four hull silhouettes each, station kit, doctrine and language/voice reel | Approve both visual and audible identities at real gameplay scale; depends on U00 |
| **U03** | Language/localization foundation | Stable dialogue IDs, two pilot conlangs, locale bundles, independent settings, recorded asset keys and timings | English and Japanese pilot text checked; language selection preserves gameplay; depends on U01 |
| **U04** | Playable first-contact sector | Six systems, eight flying hulls, two station kits, two three-mission contact arcs, trade/docking, 4–6 internal groups and repeat encounters | A recorded complete session: enter, communicate, choose, fight/trade, save, reload and observe consequences; depends on U01–U03 and combat/render gates |
| **U05** | Regional simulation | Region streaming, discovery, cross-border trade/diplomacy, coarse background progression | Add a region without moving existing content; border/neutral encounters and route closures remain playable; scale/save/performance tests pass |
| **U06** | Fleet and component production | Remaining traditions, authored subsystem atlas, damage states and civilian/industrial fleets | Each civilization meets the hull-sheet and encounter matrix, including counters; use M05/M07 instead of inventing disconnected damage systems |
| **U07** | Regional content waves | Add two regions/civilizations at a time with their language, markets, characters and authored arcs | Each wave is independently playable and localized to the committed release scope |
| **U08** | Full expansion acceptance | 160–240 mapped systems, 24–32 authored anchors, 80–100 ships, ten living speech profiles and approved locale coverage | Performance on agreed hardware, migration/replay soak, language/voice QA and successful human playthroughs; counts alone do not pass |

U01 and the U02 concept work can proceed together after charter approval. U04 is the production-cost and quality checkpoint: measure the actual effort of two complete civilizations before committing dates or expanding to six new peoples.

## 11. Quality and production controls

- Maintain one dashboard per civilization: canon, visual identity, ship roles, civilian life, language, voice, stations, mission content, economy, damage and test status.
- Record estimated versus actual effort by hull, mission, 100 localized strings and finished voice minute during the pilot. Set subsequent schedules from that evidence; do not present an unsupported calendar promise now.
- Content QA checks internal political diversity, useful non-combat encounters, distinctive silhouettes, comprehensible radio and meaningful trade/route choices.
- Balance through representative encounters and role matchups. Avoid an exhaustive hull × weapon × faction Cartesian product; combine targeted interaction tests with seeded encounter suites.
- Preserve the existing Reach and campaign regression fixtures. Region/content version changes require migration tests and stable-ID checks.
- Maintain an explicit reduced-effects fallback. The current Intel native measurements still exceed the proposed 1080p/60 gate, so fleet expansion must include LOD, batching, post-pass cost and asset-streaming work before raising simultaneous visible unit counts.
- Establish named integrated/discrete reference machines before performance sign-off. No galaxy-size claim implies that all systems or fleets run at full fidelity at once.

## 12. Authorized implementation sequence

**U00–U08 are authorized for implementation.** Build U00–U04 first to establish production quality and cost, then continue through the regional, fleet and acceptance milestones. Quality reviews remain exit criteria rather than a claim that the full expansion is already complete.

The working implementation choices are:

1. Eight peoples/lineages and ten principal civilizations as the planning target; six new concepts remain editable.
2. Nacreans and Oruni as the first two fully playable civilization prototypes.
3. An additive Open Horizon/frontier structure, with the core twenty-episode campaign and current Kessen cameo scope preserved during foundation work.
4. Approximately 192 sector-map systems and a nominal 84 flying hulls as planning examples, with 160–240 / 80–100 acceptable ranges.
5. Ten living fictional speech profiles, separate ancient story languages, and seven proposed player text/subtitle locales.
6. Separate approval of anatomy, hull grammar, language/voice reels and actual first-contact gameplay before mass production.

A broader Kessen role, universal full dubbing, new planet-surface gameplay and additional power/heat/armour systems are separate decisions with their own implementation costs. The architecture supports their future addition without silently treating them as already approved.
