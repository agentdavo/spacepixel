# PROJECT VANGUARD — Campaign Outline

Twenty episodes in four chapters, one per narrative milestone. Playable data:
`src/game/campaign/missions.ts` (see its header for runtime conventions).
Setting and cast: [`docs/LORE.md`](LORE.md).

| Ch. | Title | Episodes | Shape |
|---|---|---|---|
| I | **The Myth and the Machine** | 1–5 | Before Vanguard. A ferry and picket pilot and a 600-year-old flight computer tour the world's history: the Shattering, fossil tech, the two heavens, Ebon, the Signal. |
| II | **The Spark and the Frying Pan** | 6–10 | Vanguard. A routine escort goes wrong; a cruiser's black box; the Rot; the ghost ship; the Bastion falls. |
| III | **Into the Deep Void** | 11–15 | Nomads. The Dead Zone, the Monolith, the Oracle, the schism, the siege of the Nexus. |
| IV | **The Epic Resolution** | 16–20 | The pilgrimage, the Zenith, the key, the Symphony of Gates, the open horizon. |

**The Signal clock.** Every debrief from Episode 5 ends with the Null count.
One burst every 25 h 51 min; each burst is the next prime down.

| Ep | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Count | 1,009 | 983 | 971 | 947 | 911 | 887 | 409 | 293 | 241 | 157 | 97 | 97→5 | 5 | 3 | **2** | 2, 3… |

Chapter III's flotilla log counts days from the Fall (Day 80, 99, 109, 126,
139). The pilgrimage costs twenty-four days outside and four minutes inside.

**Running devices.** The Seven Keepings (Eps 1, 2, 18, 20). The FCS's
Timetable phrases (*SERVICE RESUMES SHORTLY* → *SERVICE RESUMED*). Kade's line
about the rim (Eps 6, 15, 20). Ada's crayon chart (Eps 10, 19, 20). Psalm's
"Be witnessed." Mugs on the hook. "Keep the light."

---

## CHAPTER I — THE MYTH AND THE MACHINE

The player is **Four-One-Three**, ferry and picket pilot of Kestrel airframe
0413, whose sealed golden-age core has had sixty-seven pilots and remembers all
of them. Chapter I is a walk through the world's history in five short, varied
missions; each one hands over a piece of the myth, and at the end of each the
machine knows a little more than the people flying it.

### Episode 1 — THE LONG DARK *(milestone 1: the Shattering)*
`anchorage` · *"Service will resume shortly."*

- **Logline:** A warden-escorted ferry flight carries a reborn Kestrel through
  the wrecks of the day the stars went out.
- **Gameplay:** Follow three survey buoys into the Timetable Graveyard
  (tutorial pacing, flight among huge golden-age wrecks). Scavenger cutters are
  stripping a school tender: first combat, three Scrapjacks. Approach the dead
  Great Lantern's beacon; deliver the airframe to the yards.
- **Set pieces:** `wreckage` Graveyard (liners, freighters, a school tender
  caught halfway through the ring); dead ring; the `timetable` beacon.
- **Chatter:** Candle reads the Seven Keepings in full before launch. The FCS
  wakes: *GOOD MORNING, PILOT. TIMETABLE NOMINAL.* ("It hasn't said good morning
  to anyone in forty years.") *PASSENGER MANIFESTS AVAILABLE. DISPLAY?* "No. No,
  thank you." The beacon's announcement, four lines of static.
- **Twist:** The core answers the beacon: *SERVICE WILL RESUME SHORTLY.*
- **Environmental storytelling:** The Shattering is never explained. It is
  shown: the wrecks, the promise on a loop, the wardens who will not switch it
  off because "somebody ought to keep the promise, even if it's only a machine."

### Episode 2 — FOSSIL FIRE *(milestone 2: fossil technology)*
`meridian` · *"We do not ask the engine why."*

- **Logline:** A sealed six-hundred-year-old jump heart crosses the Castellan
  yards to the last dreadnought, and its barge stalls in the middle of a raid.
- **Gameplay:** Escort the warden barge *Saint Hollis* (Lantern Guard); first
  raider wave (4 Scrapjacks). The barge's drive fails (`halt:barge`); defend it
  from a second wave from astern while the wardens relight by ritual; resume
  and deliver to *Indomitable*. Optional: keep the barge above 60 %.
- **Set pieces:** Castellan ring-yard scaffolding; BB-01 *Indomitable* at
  anchor, 2 km of "borrowed miracle".
- **Chatter:** The stall defence is timed by the litany: Candle speaks one
  Keeping every fourteen seconds, and the barge relights on "Seventh keeping.
  We thank it. And we go." — "Lit." Captain Rook: "What does it do, precisely?"
  "It works, Captain. We don't ask the rest."
- **Twist:** The raiders' route came from a Directorate supply office. The
  inquiry "has been allocated".
- **Environmental storytelling:** Fossil tech as liturgy: the barge is as old
  as its cargo, the dreadnought has had nineteen refits, and the only way
  anyone knows to fix an engine is to pray at it correctly.

### Episode 3 — TWO HEAVENS *(milestone 3: the two ideologies)*
`tessaly` · *"Be witnessed."*

- **Logline:** The weekly Observance at the Treaty Line — a ritual flight
  beside the enemy, guns cold — until a young Cantor fires.
- **Gameplay:** Fly the Measure through three markers alongside Psalm's
  Cantors. Damaging her Measure before the breach fails the mission; an
  optional objective asks for zero kills before it. At the third marker the
  novice fires; Psalm disarms him herself. Four zealot Cantors take the breach
  as licence: destroy only them. Return to the *Hesperus Dawn*.
- **Set pieces:** The Cathedral *Magnificat* on the far side of the Line;
  Tessaly-campaign debris; the Line as a chain of markers.
- **Chatter:** The Intonation. Psalm introduces herself: "You are witnessed."
  She sings the Hymn — *"What is lifted must be worthy. What is worthy climbs
  alone."* *SHE SHOT HER OWN WINGMAN.* "The Hegemony does not break the
  Observance. He will be corrected." Afterwards the Directorate's contrast:
  "Allocation's already pinged us. 'Unscheduled expenditure, 1.4 grams.'" —
  "Unscheduled. As if the rest of it were on a timetable."
- **Twist:** Oyelaran's throwaway irony is literally true (pays off Ep 8).
- **Environmental storytelling:** Two faiths side by side: one sings, one fills
  in forms. Psalm's apology across the Line is the first in its history.

### Episode 4 — BLACK LIGHT *(milestone 4: the Ebon-gas monopoly)*
`rustwake` · *"Every gram accounted."*

- **Logline:** Escort three tankers of Ebon across the Belt with a smuggler
  and an auditor, and learn where the gas really goes.
- **Gameplay:** Form on the *Magpie's Due*; escort three tankers and an audit
  corvette; break a Choir raid (Cantors plus Psalter torpedo bombers), then a
  second torpedo run on tanker three; see the convoy to the Lantern buoy.
  Fail if fewer than two tankers survive; optional: lose none.
- **Set pieces:** The Rustwake Belt; tanker holds that glow black under gun
  camera.
- **Chatter:** Magpie on black light ("See how the edges of things go violet?
  That's money."); her off-key haul-song and Ledger's "I can hear you,
  Captain." — "That's the idea, love."
- **Twist:** Ledger audits the manifest mid-flight: half the cargo is pre-sold,
  three shell accounts deep, to the Zenith Treasury. "Everybody buys from
  everybody, sweetheart. The war's just how the price gets set."
- **Environmental storytelling:** Ebon's visual signature (black light) makes
  the stakes physical; the debrief logs 0.4 kg of "evaporation".

### Episode 5 — WHISPERS IN THE STATIC *(milestone 5: the Signal)*
`null` · *"One thousand and nine."*

- **Logline:** One rotation on the loneliest picket in the Reach, listening at
  a gate that leads nowhere.
- **Gameplay:** Relieve the station; recover two buoy recorders; hold 20 s in
  the throat of the dead Null Lantern (`throat` dwell beacon). The burst comes.
  Psalm's Measure attacks because the machine answered; survive until she
  withdraws; return to the station.
- **Set pieces:** The dead ring; the Hegemony picket Vesper across it.
- **Chatter:** *DESTINATION FIELD EMPTY. THIS IS NOT AN ERROR.* The burst
  counts aloud to 1,009. "Yesterday was one thousand and thirteen. They're all
  prime." *RESPONSE TRANSMITTED. ONE PULSE. PROTOCOL: TIMETABLE. "ACKNOWLEDGE
  RECEIPT."* — "Your flight computer just said hello to it." Psalm: "Your
  machine answered the Voice. That is not permitted." Then transfer orders:
  "The 13th needs a Point. Their last one's mug is still on the hook."
- **Twist:** The oldest machine in the Reach recognises the Signal's protocol.
- **Environmental storytelling:** The picket log fragments (*"somebody out
  there is counting down the primes"*), both governments' silence, and a count
  that will end every debrief from now on.

---

## CHAPTER II — THE SPARK AND THE FRYING PAN

### Episode 6 — BORDER SKIRMISH *(milestone 6)*
`zephacis` · *"Same as here, only less of it."*

- **Logline:** Open in the cockpit. A routine escort, a squadron that bickers
  like family, and a Zenith cruiser that should not be there.
- **Gameplay:** Form on survey corvette *Plumb Line*; a long, quiet escort
  (character time); ambush at Survey Mark Z-7: four Cantors, then the
  Vesper-class cruiser *Canticle of Ascent*. Kade: cripple it, don't kill it.
  At 35 % hull it ejects an armoured data core into the Zephacis II ring and
  flees. Mark the core's position.
- **Set pieces:** Zephacis II's ring; the drifting core (deferred beacon).
- **Chatter:** *GOOD MORNING, POINT.* The roll call — Jackpot's pool ("There's
  no sweetheart deal."), Sparrow's nervous hello, Salt's "Don't read about
  anything, kid," Candle ("the engine and I are glad you're aboard, in that
  order"), Kade's "Don't get attached. I say that to everyone. It never
  works." Then, at 45 s, the line: **"Boss. You ever wonder what's past the
  rim?" "Same as here, Jackpot. Only less of it."** Under fire: "Why is there a
  cruiser? Nobody said cruiser!" — "It's not raiding. It's hiding something."
- **Twist:** The cruiser would rather lose its data in a ring than to us.
- **Environmental storytelling:** The seat, the sixty-seven pilots, a sixth mug
  taken down from the hook and washed.

### Episode 7 — THE STOLEN COORDINATES *(milestone 7)*
`zephacis` · *"Forty-one waypoints."*

- **Logline:** A race through ring ice for a singing black box — and what's on
  it.
- **Gameplay:** Follow the core's transponder into the ring (dense debris);
  Magpie's salvagers arrive (hired by the Zenith Treasury) and switch sides at
  "friends' rate"; recover the `blackbox`. The decrypt streams over the uplink
  *during* the fight with Psalm's Measure. Deliver the core to the Dawn.
- **Set pieces:** Planetary ring; the Choir core that "hums when lost, like a
  lamb".
- **Chatter:** Magpie: "Four hundred grams. What are you offering?" "Nothing."
  "…Friends' rate! Clan Marsh, change of employer!" Ledger reads the decrypt in
  pieces: the Stair, 41 waypoints, "a Lantern. Intact. Two hundred kilometres
  across." Psalm withdraws: "You do not know what you are carrying. …Neither, I
  think, do I."
- **Twist:** The Zenith has known about an intact mega-gate for six years —
  and the core has a second, stranger cache.
- **Environmental storytelling:** The Canticle's log (codex) — a crew weeping
  at the Anchor, and Treasury demanding a copy "before the next quarterly
  Schedule".

### Episode 8 — THE INTERNAL ROT *(milestone 8)*
`lysowick` · *"Engagement 114."*

- **Logline:** The squadron is ordered into a battle whose casualties were
  agreed in advance by both sides' treasurers — so they break the script.
- **Gameplay:** Take station at 1355. At exactly 1400 (the FCS counts it) the
  Choir wave arrives. A Vesper "conductor" coordinates; destroy it to make the
  engagement decisive. At 1402 the Directorate's own Lantern Guards withdraw on
  Allocation orders. Clear the wave. Optional: keep three picket Kestrels alive
  (beat the forecast).
- **Set pieces:** Three layers of debris from Engagements 71, 88 and 102 in the
  same place, "like pressed flowers".
- **Chatter:** "13th Squadron requested by name. The note says 'costly and
  visible.'" — "…That's worse." Salt: "The raids always hit the day after a
  price dip." Sparrow: "There are forms. There are audits." When the conductor
  dies, the FCS cracks an unlisted band: Quillon and Pryce, live. *"A correction
  will be scheduled." "And the 13th?" "Costly and visible. I'll see to it
  personally."* — "…Everyone get that?" "Every word, Boss."
- **Twist:** The war is a thermostat, and both sides' leaders share a channel.
- **Environmental storytelling:** The layered debris field; the withdrawal order
  deleted from the fleet record.

### Episode 9 — THE GHOST SHIP *(milestone 9)*
`corouhold` · *"Status: delayed."*

- **Logline:** An unlogged flight into a radiation belt finds a golden-age ship
  whose archive has been waiting four hundred years to be asked.
- **Gameplay:** Ten-minute dose limit (`timeLimit`). Enter the belt; hold 5 s
  within 300 m to scan the derelict; recover the archive core from its spine;
  Choir hunters (who followed their own map) arrive; drive them off; clear the
  belt. Candle stays behind aboard.
- **Set pieces:** `derelict` *The Long Patience* (Clavis-class, 1.1 km, dark);
  green-tinted radiation belt.
- **Chatter:** *HULL NAME: THE LONG PATIENCE. CLASS: CLAVIS. STATUS: DELAYED.*
  "You poor, patient beauty." *THE ARCHIVE REPORTS THAT IT HAS BEEN WAITING TO
  BE ASKED.* Ledger: "A Clavis can open any Lantern regardless of lock state."
  Salt: "That's a skeleton key to every door in the Reach." Candle: "Nobody's
  kept her in four hundred years." — "Keep her, then. We'll come back for you."
- **Twist:** The blueprints are for the ship itself; the Board has already
  renamed her the GLADIUS PROGRAM.
- **Environmental storytelling:** Her galley clock stopped eleven hours before
  the Shattering; lamps Candle relights one by one.

### Episode 10 — THE FALL OF THE BASTION *(milestone 10)*
`anchorage` · *"Deck is green."*

- **Logline:** The Allocator-General visits the home fleet, leaves early, and
  the Choir comes through the Lantern with the fleet's own codes.
- **Gameplay:** Routine CAP over the Bastion. Pryce's launch departs at 55 s
  (seen, if you look). At 72 s the Lantern opens: Cathedrals, Cantors, Psalter
  bombers (`bastion-attack`). Kill the bombers; the carriers die anyway
  (`bastion-destroyed`, scripted). Cover two lifeboat corvettes to the
  Graveyard lane; jump out to the *Patience*.
- **Set pieces:** `bastion` (Hesperus Dawn, Lodestar, Constant, eleven
  escorts), destroyed in a scripted sequence; the Graveyard again.
- **Chatter:** "I said I'm an old man, and forgetful." — "Captain, I love you."
  "His launch is leaving early. Why is his launch leaving early?" "They have the
  gate codes!" Control: "Deck is green. Deck is green, Vanguard, go, go." Then,
  in static: *"Kade. The chart is in your seat pocket. Take it back to her.
  Tell her the lines go somewhere. All Vanguard: you are released. Go where the
  light is. Keep the light."* Count-off: "Three." "…Five." "Six." "That's
  everyone we have."
- **Twist:** The Fall is Engagement 131 on the Schedule: the Rot silencing its
  witnesses.
- **Environmental storytelling:** The signed release order and Ada's chart in
  Kade's seat pocket; Candle has made soup.

---

## CHAPTER III — INTO THE DEEP VOID

### Episode 11 — CROSSING THE DEAD ZONE *(milestone 11)*
`deadzone` · *"Fly by eye."*

- **Logline:** Eighty days hunted by both empires; the only way left is through
  the fog where instruments die.
- **Gameplay:** `navDegraded` for the whole mission. Find the Canticle's pink
  flare-buoys by eye inside the `nebula` (visibility ~600 m); a blind ambush at
  waypoint 2 (Psalm's Measure, all static and shapes); waypoint 3; break out
  (`caul-exited`).
- **Set pieces:** The Caul (grey-violet, slow lightning); a Rustwake wreck with
  a beacon on a loop.
- **Chatter:** *SENSORS DEGRADING. SERVICE SUSPENDED.* "It's like flying inside
  a bruise." "Trust your eyes. Your eyes are older." Clan Tey's loop: *"Day
  forty. Can't see. Tell Mother we found the—"* Magpie: "Found the what, you
  silly buggers?" Psalm: "We are both blind. Let us see who sings better."
  Sparrow: "Splash one, I think! Did I get it?" — "Fire's the one thing you can
  see in here." Exit: *OBJECT AHEAD. DIAMETER: 3,470 KILOMETRES.*
- **Twist:** The cliffhanger is scale.
- **Environmental storytelling:** Clan Tey's unfinished sentence — answered two
  episodes later.

### Episode 12 — ENCOUNTER WITH THE MONOLITH *(milestone 12)*
`monolith` · *"Eleven million years."*

- **Logline:** No enemies. A formation flight toward a sphere the size of a
  moon.
- **Gameplay:** Long approach to `anchor-contact` (20 km from the surface);
  recover two Choir survey buoys; hold 30 s above the equator. Weapons safe.
- **Set pieces:** `monolith` (3,470 km, colder than space, matte-mirror
  surface); the Caul as a wall behind.
- **Chatter:** Kade: "Nobody talk for a minute." Fourteen seconds later:
  "…Boss, I can't." *CAUL LIGHTNING TERMINATES. BOUNDARY: TWENTY KILOMETRES.*
  *CHRONOMETER DRIFT: MINUS 0.8 SECONDS PER HOUR.* The Choir buoy's only message:
  *WE HAVE BEEN WITNESSED.* *SURFACE DATING: ELEVEN MILLION YEARS.* Jackpot names
  it after a film he never saw ("You're the ape in this scenario, Salt"). "My
  reflection is moving a second after I do." — "Then wave at it. Politely."
- **Twist:** At the equator: *PULSES: 293.* The Signal comes from here. *IT IS
  PREPARING TO SPEAK.*
- **Environmental storytelling:** Scale, silence, slow clocks, a reflection
  that lags.

### Episode 13 — THE ORACLE BROADCAST *(milestone 13)*
`monolith` · *"We are not gone. We are ahead."*

- **Logline:** The Builders' archive, received in three segments while the
  Choir tries to shout over it.
- **Gameplay:** Three dwell points (20 s, 25 s, 60 s) around the equator. After
  the first, a jamming Vesper and screen; after the second, Psalm's Measure with
  Psalters. The last hold plays the full archive.
- **Set pieces:** The Monolith beneath; listening points in white light; the
  *Patience* standing off.
- **Chatter:** The Oracle, translation confidence climbing from 31 % to 99 %:
  *WE ARE WHO BUILT THE ROAD. YOU ARE WHO FOUND IT.* → "A road in tune carries
  the breath. A road out of tune breaks." (Candle: "That's what the Shattering
  was.") → "We are not gone. We are ahead." → the clock → "Do not leave it
  half-tuned. That is how roads break." → "We hoped they would bring more than
  one kind of song." Psalm, anguished: "Six years we sang to it. Why you?"
- **Twist:** The Signal is a countdown to the next Breath: fifty-six days.
- **Environmental storytelling:** The archive uses the Kestrel's core as its
  dictionary: the machine is the bridge.

### Episode 14 — THE SCHISM *(milestone 14)*
`rustwake` · *"Go where the light is."*

- **Logline:** Forty kilos of Ebon can open one door. The squadron cannot agree
  which, and the Rot sends a joint hit squad.
- **Gameplay:** Escort Magpie's tankers from the moot-hold to the *Patience*.
  A joint hunter group — Allocation Harriers and a renegade Lantern Guard
  flying in formation with Treasury Cantors — attacks (renegade `concord`
  hostiles). Destroy it; return to the ship.
- **Set pieces:** The clan moot-hold; the Belt.
- **Chatter:** The argument, in three timed beats: Salt ("The Oracle said
  follow. The Reach left us, at Anchorage, on schedule."), Kade ("I'm going to
  the Counting House"), Sparrow ("It said tune the road"), Salt ("It said
  either is permitted. First honest thing anyone's said to me in nine years").
  "Together? In formation? That's obscene." — "That's the Schedule. They've
  stopped pretending." Sparrow's first Directorate kill: "He had our stripes."
  Salt leaves: "If you get the road open, I'll be first through it." — "You owe
  the pool forty grams." — "Put it on my tab." — "Go where the light is,
  Soren."
- **Twist:** Candle: the *Patience*'s spine has been humming in the Choir's
  intervals since the Monolith. "I think we've all misunderstood her."
- **Environmental storytelling:** Salt's empty slot in the formation; his mug
  on the hook.

### Episode 15 — THE SIEGE OF THE NEXUS *(milestone 15)*
`nexus` · *"Hold the Ring."*

- **Logline:** A ghost ship, four Kestrels and a handful of clans against the
  Zenith's armada at the only whole gate in the galaxy.
- **Gameplay:** Reach the Nexus (21 km run toward a 40 km ring); break the
  Psalter wave; kill the three Vesper spire-tenders (without them the Cathedrals
  cannot sing the seal). At nine kills Salt returns with the free clans; at
  eleven, Jackpot dies (`destroy:jackpot`). Cathedrals turn back; return to the
  throat.
- **Set pieces:** `megagate` Nexus (unlit, its rim archive glinting); two
  Cathedrals at range; the *Patience*.
- **Chatter:** *STATUS: WHOLE.* "It's the only whole thing I've ever seen."
  Jackpot: "What you said about the rim. I think you might've been wrong. Don't
  tell anyone." Salt: "Heard there was a party. Brought some friends. And the
  forty grams." Jackpot: "Tell the pool it all goes to Sparrow. She's the only
  one who never cheated." *VANGUARD 3. SIGNAL LOST.* "Keep flying. He'd want the
  pool paid out." Psalm: "I heard your wingman, before he fell. He was
  laughing. You are witnessed. Him most of all."
- **Twist:** *THE ROAD IS HALF-TUNED. A KEY IS PRESENT. ONE MAY ENTER.*
- **Environmental storytelling:** The rim's map of the whole galaxy, visible
  when you are not looking at it directly.

---

## CHAPTER IV — THE EPIC RESOLUTION

### Episode 16 — THE SOLO PILGRIMAGE *(milestone 16)*
`nexus` · *"Ninety-seven. Eighty-nine. Eighty-three."*

- **Logline:** Alone into the corridor of light. Four minutes inside; twenty-
  four days outside.
- **Gameplay:** `noWingmen`, no weapons needed. Enter the `pilgrimage` corridor
  and follow the light to its end (~280 s sequence).
- **Set pieces:** The corridor (white, teal, magenta), the Nexus opening behind,
  and a vision of the road lit.
- **Chatter:** Kade: "Come back. That's the whole order." The count racing:
  89, 83, 79, 73, 71. *CHRONOMETER DISAGREES WITH ITSELF. BOTH ARE CORRECT.* The
  core replays its dead: *"Tell my mother the Lantern lit."* *"Kestrel, if I
  don't make it, you look after the next one."* Then, for the first time, the
  machine says "I": ***I REMEMBER ALL OF THEM, POINT. SIXTY-SEVEN. I KEPT
  THEM.*** The Oracle: "This is what you lost. This is what you may have again.
  It will be heavy. We carried it too."
- **Twist:** The corridor exits from the Hesper Lantern, sealed since the
  Shattering, beside the Zenith's throne-ship. Count: 5.
- **Environmental storytelling:** Pure image and voice; the Kestrel's logged
  four minutes eleven seconds.

### Episode 17 — THE REVELATION OF THE ZENITH *(milestone 17)*
`hesper` · *"A cradle is a safe place to be a child forever."*

- **Logline:** Alone at the heart of the Hegemony, the Point is granted an
  audience with the man who means to close the sky.
- **Gameplay:** Survive Psalm's Measure; the Zenith calls "Isaura. Enough."
  Approach the *Altitude*; hold 70 s before it while he speaks; Treasury
  Cantors attack; escape through the Hesper Lantern.
- **Set pieces:** The humming Hesper Lantern; the Cathedral *Altitude*;
  crystal foundry-gardens.
- **Chatter:** The Zenith's speech, quiet: "It is a door. And humanity is not
  ready to walk through it. … We scheduled it. We laid up the keys to save
  money. … So I will seal them. Every world an Earth. Every Earth a cradle. And a
  cradle is a safe place to be a child forever." Psalm: "Even us, Grandfather?"
  "Especially us." "…Then what have we been ascending toward?" Channel closed.
  Psalm: "Tell your Abbess the Choir has a question it cannot answer. Tell her I
  am asking it."
- **Twist:** The villain is a grandfather who loves everyone too much to let
  them leave home.
- **Environmental storytelling:** The rattle on his desk (codex); the Lantern
  that "would open only once, at the end of all things".

### Episode 18 — THE KEY, NOT THE SWORD *(milestone 18)*
`meridian` · *"Do not open it. Play it."*

- **Logline:** Ledger reads the Schedule to eleven million people while Pryce
  tries to seize the *Patience* as a weapon — and Candle learns what she is.
- **Gameplay:** Escort Ledger's launch to the Allocation Hour relay; hold 55 s
  while she reads; Allocation Guard Harriers and Treasury Cantors (together, at
  the capital) attack; Rook relieves Pryce; defeat the loyalists; return to the
  *Patience* and hold at the spine gallery.
- **Set pieces:** The Castellan relay and yards; *Indomitable*; the *Patience*.
- **Chatter:** Pryce: "Expenditures are regrettable. Outcomes are what matter."
  Ledger, on air: "Engagement 131, Anchorage. The Bastion. Expected expenditure:
  four thousand, one hundred and twelve. … Audited and approved: Yevgenia Aubrac.
  I knew. I am so sorry." Rook: "Put it on my ration card, Allocator." Pryce:
  "You think it's a key. It's a lever." Candle's confession: "I broke the Sixth
  Keeping. I asked her why. … 'The ship is the key. Do not open it; play it.'
  She's an instrument." Sparrow: "More than one kind of song. The machines and
  the music." — "Then we need a Cantor." *INTONATION. ONE SHIP. WEAPONS COLD.*
- **Twist:** The weapon is an instrument, its score is the enemy's hymn, and
  the enemy's best pilot arrives to sing it.
- **Environmental storytelling:** The Patience's last log (codex): a master's
  voice across 431 years.

### Episode 19 — THE SYMPHONY OF GATES *(milestone 19)*
`meridian` → two further jumps · *"Two."*

- **Logline:** Nine minutes to the crest. The Point carries the phase through
  three Lanterns while the whole Reach plays one piece of music.
- **Gameplay:** Multi-system. Hold at the Meridian tuning point (20 s, under
  Treasury holdouts), jump; hold at the second (Clan Marsh fighting Spire
  loyalists), jump; hold at the third (Psalm's defecting Cantors as wingmen
  against a Spire Vesper); then hold 50 s as the Breath arrives.
- **Set pieces:** Deferred tuning beacons in each new system; the sky lighting.
- **Chatter:** Kade: "Last fl— no. We don't say that." Magpie: "It's singing!
  I'm not crying. Nobody said anything." Candle to Psalm: "Not that verse. The
  old one. The one from before the words." Salt: "The Null's lighting. It
  doesn't go anywhere. …It goes somewhere now." Kade to the Zenith: "I'm a
  warden's orphan. I don't know hymns. I know engines. An engine in tune doesn't
  need a cradle." The Zenith: "Isaura. Is that you singing? You have it in the
  right key. We never had it in the right key." Then: *NULL COUNT: 2. THE CLOCK
  HAS STOPPED.* *SIX OF SIX. SIXTY OF SIXTY. FOUR HUNDRED OF— COUNT UNAVAILABLE.
  THEY ARE ALL LIGHTING.* "…It is in tune." Sparrow: "It's Ada's chart. All the
  lines." — "…They go somewhere."
- **Twist:** The Zenith does not fire.
- **Environmental storytelling:** The crayon lines drawn across the real sky.

### Episode 20 — THE OPEN HORIZON *(milestone 20)*
`null` · *"Only more of it."*

- **Logline:** A patrol with no enemies to a gate that used to lead nowhere.
- **Gameplay:** Form up; fly to the lit Null Lantern; hold 45 s at the
  threshold. That's all.
- **Set pieces:** The Null Lantern, lit; a queue of Rustwake haulers waiting to
  go through; the empty picket station.
- **Chatter:** *GOOD MORNING, POINT.* *NULL COUNT: 2. NULL COUNT: 3.* "It's
  counting up." "…Is it." Candle's litany, with the Eighth Keeping: "we ask it
  why. And we listen." "There isn't an eighth keeping." "There is now." Magpie:
  "Clan Marsh is first in line." Psalm: the Zenith took the *Altitude* outward,
  alone — "Tell the pilot I was wrong about the children." Ledger: "For once in
  my life I don't have a forecast." *DESTINATION NOT YET SCHEDULED. THIS IS NOT
  AN ERROR.* Sparrow reads the edge of Ada's chart; "Tell her we're going to
  find out." Then Kade: **"Jackpot asked me once what was past the rim. … Same
  as here, Jackpot. … Only more of it."** *SERVICE RESUMED. THANK YOU FOR YOUR
  PATIENCE.*
- **Twist:** None. That is the point.
- **Environmental storytelling:** A horizon of dark stars, the gates humming,
  and a debrief of seven words: *The Lanterns are humming. Keep the light.*

---

## Runtime conventions (summary)

Full notes are in the header of `src/game/campaign/missions.ts`. In brief:
hidden optional objectives are script cues; flags `destroy:<tag>`,
`depart:<tag>`, `halt:<tag>`, `resume:<tag>` are commands; escorts set
`${tag}-arrived`; beacons with `params.hold` set `${tag}-held`; set pieces with
`params.whenFlag` are deferred; spawn `delay` + `whenFlag` counts from the
flag; Episode 19 spans jumps; `role` overrides faction allegiance; `kills()`
counts all destroyed ships of a faction; `PLOT_ARMOUR` tags never die from
damage; monolith distances are measured from the surface.
