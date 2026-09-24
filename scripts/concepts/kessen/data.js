// Kessen design data shared by the sheets. Stats are proposals in the game's
// units (src/sim/Loadouts.ts: Kestrel hull 110 / shield 70, laser 6 dmg × 12/s).

export const STATURES = [
  {
    n: 1, roman: 'I', name: 'Fettler', height: '2.6 m', tag: 'the second skin',
    blurb: 'Power armour. Every Kessen over seven owns one; most of them work in it. The combat versions are boarders: small enough to walk down a warship\'s corridors.',
    variants: 'Awl, Rivet, Tongs', train: '80 of 200 (ten per consist)',
    stats: 'hull 35 · buffer 30<br>~12 dps · boards hulls',
    cards: {
      awl: { text: 'Infiltrator. Heat-haze vanes bend light around the frame; with its reactor banked it reads as a rock. Cuts cable runs and sensor masts.', kit: [['Scribe knife', 'laser'], ['Knocker pistol', 'laser'], ['Heat-haze vanes', 'util']], stats: 'hull 30 · cloak 20 s · 10 dps · subsystem ×2' },
      rivet: { text: 'Breacher. Fires shaped-charge rivets that punch a hole and weld the edge behind them, so the ship does not vent and does not notice.', kit: [['Rivet gun', 'explosive'], ['Buffer board', 'shield'], ['Couplings', 'util']], stats: 'hull 40 · buffer 30 · 14 dps · ignores shields once aboard' },
      tongs: { text: 'Field fitter. Welds armour back onto a wounded frame mid-fight and walks the dead home. Children crew Tongs in peacetime.', kit: [['Tool arm', 'util'], ['Knocker pistol', 'laser'], ['Buffer board', 'shield']], stats: 'hull 40 · repairs 8 hull/s · 6 dps' },
    },
  },
  {
    n: 2, roman: 'II', name: 'Shunter', height: '4.8 m', tag: 'skirmisher',
    blurb: 'Fast, light and lanky, on roller skates. In space they fly in pairs and do what Kestrels do, without a fold-core for sensors to find.',
    variants: 'Gimlet, Spanner', train: '56 of 200 (seven per consist)',
    stats: 'hull 80 · shield 40<br>~35 dps · agility 1.2',
    cards: {
      gimlet: { text: 'Duellist. Twin pulse carbines and a roller-dash that turns inside anything with a keel. The Train\'s anti-fighter screen.', kit: [['Knocker carbine ×2', 'laser'], ['Wrist spikes', 'kinetic']], stats: 'hull 80 · shield 40 · 38 dps · agility 1.25' },
      spanner: { text: 'Missile skirmisher. Two shoulder racks of Cinders: 24 micro-missiles each, fired in fans. OVA missile circus in 5 metres.', kit: [['Cinder racks ×2', 'explosive'], ['Knocker carbine', 'laser']], stats: 'hull 80 · shield 40 · 48 Cinders · 24 dps' },
    },
  },
  {
    n: 3, roman: 'III', name: 'Linesman', height: '7.2 m', tag: 'the line',
    blurb: 'The line frame, and most of the Train\'s firepower. Every Linesman carries a Buffer: a held physics shield that soaks momentum.',
    variants: 'Plumb, Chisel, Gauge', train: '40 of 200 (five per consist)',
    stats: 'hull 150 · shield 70 · buffer 120<br>~55 dps',
    cards: {
      plumb: { text: 'Line frame. Laser rifle, kite Buffer, hip Cinders. A Plumb is what "Kessen" means to a Directorate gun crew.', kit: [['Scribe rifle', 'laser'], ['Buffer kite', 'shield'], ['Cinder rack', 'explosive']], stats: 'hull 150 · shield 70 · buffer 120 · 55 dps' },
      chisel: { text: 'Assault. A four-coil pulse cannon and a plasma-edged chisel for turrets and bulkheads it has walked up to.', kit: [['Knocker cannon', 'laser'], ['Heat-chisel', 'explosive']], stats: 'hull 170 · shield 70 · 62 dps · melee 90' },
      gauge: { text: 'Marksman and spotter. Fires iron track-spikes from a coilgun and paints weak points onto the Loom so the whole Train sees them.', kit: [['Spike-driver', 'kinetic'], ['Rangefinder crest', 'util']], stats: 'hull 130 · shield 60 · 60 dmg/shot · marks targets' },
    },
  },
  {
    n: 4, roman: 'IV', name: 'Derrick', height: '9.0 m', tag: 'heavy / support',
    blurb: 'Squat and wide, head sunk between the shoulders. Derricks make the Train survivable: shields, artillery and turret-breaking.',
    variants: 'Maul, Bellows, Tamper', train: '16 of 200 (two per consist)',
    stats: 'hull 380 · shield 120<br>Lid 600 (shared) · ~70 dps',
    cards: {
      maul: { text: 'Breaker. Walks up a capital\'s flank behind a tower Buffer and smashes turrets with a pulse-charged hammer.', kit: [['Maul', 'kinetic'], ['Buffer wall', 'shield']], stats: 'hull 420 · buffer 400 · 160/swing vs turrets' },
      bellows: { text: 'Shield projector. Throws a Lid, a 40 m energy dome, over its consist. Bleeds beams and harmonics; slow things walk through.', kit: [['Lid emitters ×2', 'shield'], ['Knocker carbine', 'laser']], stats: 'hull 360 · Lid 600 · 40 m radius · 30 dps' },
      tamper: { text: 'Artillery. A ballast mortar and a shoulder beam cannon. Lobs shells over the Lid while the line holds.', kit: [['Tamper mortar', 'explosive'], ['Long Scribe', 'laser']], stats: 'hull 360 · shield 120 · 90 dmg shells · 45 dps beam' },
    },
  },
  {
    n: 5, roman: 'V', name: 'Gantry', height: '11.5 m', tag: 'three storeys',
    blurb: 'Command frames, one per consist. Only Foremen pilot them. The semaphore crest and the crane boom are works-train heritage; the crest really signals.',
    variants: 'Anvil, Piledriver, Knell', train: '8 of 200 (one per consist)',
    stats: 'hull 900 · shield 300<br>Lid wall 1500 · Loom crown',
    cards: {
      anvil: { text: 'Command. Throws a Lid wall 120 m across and runs the Loom for 25 frames. When the Anvil raises its crest, the consist fires as one.', kit: [['Knocker cannon', 'laser'], ['Buffer wall', 'shield'], ['Lid wall', 'shield'], ['Loom crown', 'util']], stats: 'hull 900 · Lid wall 1500 · gang-fire ×25' },
      piledriver: { text: 'Capital-killer. Couples to a hull and drives a 6 m tungsten-iron spike through the armour, then detonates it. Six drives per magazine.', kit: [['Piledriver', 'explosive'], ['Knocker cannon', 'laser'], ['Couplings', 'util']], stats: 'hull 950 · 1,800 per drive (×1.5 hull) · 6 drives' },
      knell: { text: 'Resonance lance. A tuning fork with a standing wave between its tines. Choir crystal rings at its note and cracks. The Choir calls it the Wrong Note.', kit: [['Knell lance', 'harmonic'], ['Lid emitter', 'shield']], stats: 'hull 850 · 40 dps harmonic (×1.7 shield) · crystal hulls ×2' },
    },
  },
];

// Weapons glossary. type = the game's DamageType (src/sim/Damage.ts).
export const WEAPON_INFO = [
  { kind: 'scribeRifle', name: 'Scribe rifle', type: 'laser', on: 'Plumb', text: 'Cutting laser. "Scribing" is marking steel before you cut it; the Kessen named the gun after the job.', num: '14 dmg × 5/s' },
  { kind: 'longScribe', name: 'Long Scribe', type: 'laser', on: 'Tamper', text: 'Shoulder beam cannon. A continuous beam, like the capital lances, at frame scale.', num: '45 dps beam · 1.4 s' },
  { kind: 'scribeKnife', name: 'Scribe knife', type: 'laser', on: 'Awl', text: 'Laser-edged knife for cable runs and sensor masts.', num: '30 per cut · subsystem ×2' },
  { kind: 'knockerPistol', name: 'Knocker pistol', type: 'laser', on: 'Fettlers', text: 'Pulse sidearm. Named for the miners\' knock. Three knocks means get out.', num: '6 dmg × 4/s' },
  { kind: 'knockerCarbine', name: 'Knocker carbine', type: 'laser', on: 'Gimlet, Spanner, Derricks', text: 'Three coil rings wind up a plasma pulse. The Train\'s standard gun.', num: '8 dmg × 9/s' },
  { kind: 'knockerCannon', name: 'Knocker cannon', type: 'laser', on: 'Chisel, Anvil, Piledriver', text: 'Four coils, two hands. Heavy pulses that knock fighters out of formation.', num: '24 dmg × 3/s' },
  { kind: 'spikeDriver', name: 'Spike-driver', type: 'kinetic', on: 'Gauge', text: 'Coilgun that fires iron track-spikes: the same spikes that pinned the Timetable\'s rails.', num: '60 dmg · 1.1/s · 3,200 m/s' },
  { kind: 'rivetGun', name: 'Rivet gun', type: 'explosive', on: 'Rivet', text: 'Shaped-charge rivets that punch, then weld the hole shut behind the boarders.', num: '40 dmg · breach 1 per 6 s' },
  { kind: 'cinders', name: 'Cinder rack', type: 'explosive', on: 'Spanner, Plumb', text: 'Micro-missiles fired in fans. 12 or 24 to a rack.', num: '16 dmg each · salvo 12' },
  { kind: 'mortar', name: 'Tamper mortar', type: 'explosive', on: 'Tamper', text: 'Ballast shells lobbed over the Lid. In space: slow proximity rounds that bloom into flak.', num: '90 dmg · 0.5/s' },
  { kind: 'heatChisel', name: 'Heat-chisel', type: 'explosive', on: 'Chisel', text: 'Plasma-edged blade for bulkheads and turret rings.', num: '90 per strike' },
  { kind: 'maul', name: 'Maul', type: 'kinetic', on: 'Maul', text: 'Pulse-charged hammer. The head fires a pulse as it lands, so it hits twice.', num: '160 per swing vs turrets' },
  { kind: 'piledriver', name: 'Piledriver', type: 'explosive', on: 'Piledriver', text: 'Pile bunker. Couple, drive the spike, detonate. The reason 200 frames can kill a ship.', num: '1,800 per drive · 6 drives' },
  { kind: 'knellLance', name: 'Knell lance', type: 'harmonic', on: 'Knell', text: 'A resonance weapon tuned to Choir crystal. It rings the hull at a wrong note until it cracks.', num: '40 dps · crystal hulls ×2' },
];
export const SHIELD_INFO = [
  { kind: 'bufferBoard', name: 'Buffer board', on: 'Fettlers' },
  { kind: 'bufferKite', name: 'Buffer kite', on: 'Plumb' },
  { kind: 'bufferWall', name: 'Buffer wall', on: 'Maul, Anvil' },
  { kind: 'lidEmitter', name: 'Lid emitter', on: 'Bellows, Knell' },
];
