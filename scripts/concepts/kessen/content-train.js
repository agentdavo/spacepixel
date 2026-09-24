// Sheets 07 (one Train, one ship) and 08 (culture).
const D = Math.PI / 180;
const ST_COL = ['#e8b42a', '#74c6b8', '#5d6875', '#ddd3bd', '#d63a2c'];
const ST_NAME = ['I Fettler', 'II Shunter', 'III Linesman', 'IV Derrick', 'V Gantry'];

function starsCss() {
  let s = ''; let seed = 3;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 160; i++) s += `radial-gradient(${(r() * 1.6 + 0.6).toFixed(1)}px ${(r() * 1.6 + 0.6).toFixed(1)}px at ${(r() * 100).toFixed(1)}% ${(r() * 100).toFixed(1)}%, rgba(255,255,255,${(0.4 + r() * 0.6).toFixed(2)}) 50%, transparent 51%),`;
  return s + '#0b0d13';
}

function phaseSvg(k) {
  const ship = `<path d="M40,70 L200,62 L250,78 L200,94 L40,90 L28,80 Z" fill="#eceae4" stroke="#17181d" stroke-width="2.5"/><path d="M70,80 H190" stroke="#2b4ea8" stroke-width="4"/><rect x="110" y="55" width="26" height="9" fill="#2a2d3a"/>`;
  const dots = (pts, col = '#74f6e2', r = 3) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#17181d" stroke-width="1"/>`).join('');
  const cloud = (cx, cy, n, sp, seed) => { let s = seed; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); return Array.from({ length: n }, () => [cx + (r() - 0.5) * sp, cy + (r() - 0.5) * sp * 0.7]); };
  const bg = `<rect width="290" height="150" fill="#12151c"/>`;
  let body = '';
  if (k === 0) body = `${ship}<path d="M250,78 A120,120 0 0 0 250,-40" stroke="#ff7a1c" stroke-dasharray="4 5" fill="none"/>${cloud(40, 30, 14, 60, 3).map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="4" fill="#4a4642"/>`).join('')}${dots(cloud(45, 32, 16, 55, 9), '#8a929c', 2.2)}`;
  if (k === 1) body = `${ship}<path d="M78,18 Q60,40 80,58" stroke="#74f6e2" stroke-width="4" fill="none"/>${dots(cloud(55, 32, 20, 40, 5), '#74f6e2', 2.4)}${[0, 1, 2, 3, 4].map((i) => `<line x1="${120 + i * 14}" y1="62" x2="${86 + i * 2}" y2="${26 + i * 7}" stroke="#ffb05a" stroke-width="1.5"/>`).join('')}`;
  if (k === 2) body = `${ship}<path d="M40,70 L120,66" stroke="#d63a2c" stroke-width="6"/>${cloud(70, 24, 16, 50, 7).map(([x, y]) => `<line x1="${x}" y1="${y}" x2="80" y2="67" stroke="#74f6e2" stroke-width="1"/>`).join('')}${dots(cloud(70, 24, 16, 50, 7), '#74f6e2', 2.4)}`;
  if (k === 3) body = `${ship}${dots([[60, 66], [74, 65], [90, 64], [104, 64], [150, 62], [168, 63], [182, 63], [60, 93], [90, 92], [140, 93]], '#74f6e2', 3)}<text x="118" y="52" fill="#ff7a1c" font-size="14" font-family="IBM Plex Mono">✕ ✕</text>`;
  if (k === 4) body = `${ship}${dots([[80, 92], [130, 93], [175, 92]], '#d63a2c', 5)}${[80, 130, 175].map((x) => `<path d="M${x},92 L${x + 4},78 L${x - 3},70" stroke="#fff2c0" stroke-width="2" fill="none"/>`).join('')}<path d="M125,60 L130,72 L122,80 L131,94" stroke="#17181d" stroke-width="3" fill="none"/>`;
  if (k === 5) body = `<g transform="rotate(-6 90 80)"><path d="M40,70 L125,64 L118,80 L126,92 L40,90 L28,80 Z" fill="#eceae4" stroke="#17181d" stroke-width="2.5"/></g><g transform="translate(18,10) rotate(8 190 80)"><path d="M135,64 L200,62 L250,78 L200,94 L132,93 L140,80 Z" fill="#eceae4" stroke="#17181d" stroke-width="2.5"/></g>${dots(cloud(250, 40, 12, 40, 4), '#74f6e2', 2.4)}${dots([[232, 60], [244, 30]], '#8a929c', 2.4)}<path d="M232,60 L262,52 M244,30 L270,24" stroke="#74f6e2" stroke-dasharray="2 3"/>`;
  return `<svg viewBox="0 0 290 150" width="100%" style="display:block;border-bottom:3px solid var(--ink)">${bg}${body}</svg>`;
}

export function sheet07(c, header, footer) {
  header(c, 7, 'One Train, One Ship', 'WHY 200 CAN KILL A CAPITAL SHIP', '決戦');
  const THREE = c.THREE, K = c.K;
  const counts = [80, 56, 40, 16, 8];
  let cells = '';
  // Fill column-major by consist: each of 8 consists is a 25-cell block.
  const per = [10, 7, 5, 2, 1];
  for (let cs = 0; cs < 8; cs++) {
    let blk = '';
    per.forEach((n, s) => { for (let i = 0; i < n; i++) blk += `<i style="background:${ST_COL[s]}"></i>`; });
    cells += `<div class="consist"><div class="cells">${blk}</div><div class="mono small" style="text-align:center;margin-top:4px">consist ${cs + 1}</div></div>`;
  }
  const top = c.h(`<div class="grid over" style="grid-template-columns:1.25fr 1fr"></div>`);
  top.append(c.h(`<div class="panel"><div class="lbl">A Train · 200 frames · 8 consists of 25</div>
    <style>.consist .cells{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}.consist i{display:block;aspect-ratio:1;border:2px solid var(--ink)}</style>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:14px;margin-top:22px">${cells}</div>
    <div style="margin-top:16px">${counts.map((n, s) => `<span class="chip" style="color:var(--ink);background:${ST_COL[s]}">${ST_NAME[s]} ×${n}</span>`).join('')}</div>
    <p class="small" style="margin-top:8px">Works-train words: a <b>gang</b> of 8, a <b>consist</b> of 25 (1 Gantry, 2 Derricks, 5 Linesmen, 7 Shunters, 10 Fettlers), and a <b>Train</b> of eight consists.
    The Train's 8 Gantries are typically 4 Anvils, 3 Piledrivers and a Knell. Proverb: <em>"A ship is killed by a Train."</em></p></div>`));
  top.append(c.h(`<div class="panel dark"><div class="lbl r">Target · BB-01 Indomitable</div>
    <table class="t" style="margin-top:16px;color:#e8e6e0">
      <tr><td>Hull</td><td class="num">48,000</td></tr>
      <tr><td>Shield</td><td class="num">9,000 · four facings of 2,250</td></tr>
      <tr><td>Regen</td><td class="num">3 %/s after 8 s untouched</td></tr>
      <tr><td>Piledriver drives</td><td class="num">3 × 6 = 18</td></tr>
      <tr><td>Per drive vs hull</td><td class="num">1,800 × 1.5 (explosive) = 2,700</td></tr>
      <tr><td><b>Keel damage</b></td><td class="num"><b style="color:#74f6e2">18 × 2,700 = 48,600 ≥ 48,000</b></td></tr>
      <tr><td>Hammer volley</td><td class="num">~100 guns × ~12 = ~1,200 per volley</td></tr>
      <tr><td>Facing down in</td><td class="num">2 volleys; re-hit every &lt; 8 s</td></tr>
      <tr><td><b>Expected losses</b></td><td class="num"><b style="color:#ff7a5c">60–90 frames (30–45 %)</b></td></tr>
    </table>
    <p class="small dim" style="margin-top:10px">Numbers come from <span class="mono">src/sim/Loadouts.ts</span>. The frame side is a proposal; run it through <span class="mono">npm run balance</span>.</p></div>`));
  c.host.append(top);

  // Hero: drive the spike.
  const hero = c.h(`<div class="panel dark over" style="margin-top:22px;height:720px;padding:0;overflow:hidden;background:${starsCss()}">
    <div class="lbl">Phase 4 · drive the spike</div><div class="lbl r">coupled to the hull · inside the shield</div><div class="view" style="position:absolute;inset:0"></div></div>`);
  c.host.append(hero);
  c.view(hero.querySelector('.view'), (scene, aspect) => {
    c.lights(scene, { dir: [-6, 8, 3], key: 2.4, amb: 0.5, rim: 0x9fd8ff, rimI: 1.0 });
    K.setInk(null);
    // A patch of Directorate hull as the ground the frames stand on.
    const hull = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(140, 4, 70), K.toon('#cfcabd')); plate.position.y = -2; hull.add(plate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(140, 0.2, 7), K.toon('#2b4ea8')); band.position.set(0, 0.05, 10); hull.add(band);
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(140, 0.2, 2), K.toon('#ff7a1c')); band2.position.set(0, 0.06, 15); hull.add(band2);
    const seamMat = new THREE.MeshBasicMaterial({ color: '#8d919a' });
    for (let x = -70; x <= 70; x += 7) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 70), seamMat); l.position.set(x, 0.06, 0); hull.add(l); }
    for (let z = -35; z <= 35; z += 7) { const l = new THREE.Mesh(new THREE.BoxGeometry(140, 0.1, 0.08), seamMat); l.position.set(0, 0.06, z); hull.add(l); }
    // Turret.
    const tur = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 2.4, 10), K.toon('#8d94a8')); base.position.y = 1.2; tur.add(base);
    const hous = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 7), K.toon('#eceae4')); hous.position.y = 3.6; tur.add(hous);
    for (const x of [-1.3, 1.3]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 8), K.toon('#2a2d3a')); b.rotation.x = Math.PI / 2; b.position.set(x, 3.8, 7.5); tur.add(b); }
    tur.position.set(18, 0, -14); tur.rotation.y = -0.6; hull.add(tur);
    scene.add(hull);
    const add = (id, pose, x, z, ry, extra) => { const f = c.frame(id, pose, extra); f.position.x = x; f.position.z = z; f.rotation.y = ry; scene.add(f); return f; };
    const drivePose = {
      spine: [25 * D, 0, 0], chest: [20 * D, -10 * D, 0], head: [-35 * D, 10 * D, 0],
      shoulder_L: [-82 * D, 0, 6 * D], forearm_L: [-6 * D, 0, 0],
      shoulder_R: [20 * D, 0, -25 * D], forearm_R: [-50 * D, 0, 0],
      thigh_L: [-50 * D, 0, 10 * D], shin_L: [70 * D, 0, 0], foot_L: [-18 * D, 0, 0],
      thigh_R: [-10 * D, 0, -14 * D], shin_R: [60 * D, 0, 0], foot_R: [-40 * D, 0, 0], hipsDrop: 2.2,
      skirt_F: [-30 * D, 0, 0], crest: [0, 0, 50 * D],
    };
    const pd = add('piledriver', drivePose, 0, 0, 0.5);
    pd.updateMatrixWorld(true);
    const tip = pd.userData.bones.shield_L.localToWorld(new THREE.Vector3(0, -5.2, 0.1));
    const burst = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, len = 4 + (i % 3) * 2.5;
      const dir = new THREE.Vector3(Math.cos(a), 0.45 + (i % 2) * 0.5, Math.sin(a)).normalize();
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.35, len, 4), K.glowMat(i % 2 ? '#fff2c0' : '#ffb04a'));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
      s.position.copy(tip).addScaledVector(dir, len / 2 + 0.8); burst.add(s);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), K.glowMat('#ffffff')); core.position.copy(tip); burst.add(core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.2, 24), K.glowMat('#ffd27a', 0.8)); ring.rotation.x = -Math.PI / 2; ring.position.set(tip.x, 0.15, tip.z); burst.add(ring);
    scene.add(burst);
    add('maul', 'guard', 12, -6, -0.9);
    add('rivet', 'ready', -8, 6, 0.9);
    add('rivet', 'ready', -11, 3, 0.7);
    add('anvil', { ...K.POSES.heavy, crest: [0, 0, 60 * D] }, -16, -18, 0.6);
    add('plumb', 'aim', 24, 8, -0.5);
    const g1 = c.frame('gimlet', 'space'); g1.position.set(-4, 14, -6); g1.rotation.set(0.2, 0.8, 0); scene.add(g1);
    const g2 = c.frame('gimlet', 'space'); g2.position.set(6, 18, -16); g2.rotation.set(0.1, -0.5, 0); scene.add(g2);
    const cam = new THREE.PerspectiveCamera(30, aspect, 1, 2000);
    cam.position.set(14, 11, 46); cam.lookAt(-1, 6, -2);
    return cam;
  });

  const phases = [
    ['0', 'Cold walk', 'T−10 min', 'Reactors banked, drifting in a convoy\'s wake or a debris field. No fold signature, so they read as rocks until knife range.'],
    ['1', 'Lid up', 'T+0', 'Anvils and Bellows throw Lid walls. The battery and flak spend their first forty seconds on them. About 10 % lost.'],
    ['2', 'The Hammer', 'T+30 s', 'The Anvil raises its crest and the Loom lands ~100 guns within 40 ms on one facing. Two volleys take 2,250 down, and it never gets 8 s to regen.'],
    ['3', 'Couple', 'T+60 s', 'Shunters and Fettlers magnet-walk onto the hull through the dead facing. Mauls break turrets; Rivets go inside for the shield generator and bridge.'],
    ['4', 'Drive the spike', 'T+100 s', 'Three Piledrivers, six drives each, along the keel. 18 × 2,700 = 48,600. The keel breaks.'],
    ['5', 'Walk home', 'T+180 s', 'The Loom walks the dead frames home. Nobody is carried. <em>"A ship costs a Train a third of itself."</em>'],
  ];
  const strip = c.h(`<div class="grid over" style="grid-template-columns:repeat(6,1fr);gap:16px;margin-top:22px"></div>`);
  phases.forEach(([n, t, time, txt], i) => strip.append(c.h(`<div class="card">${phaseSvg(i)}<div class="body">
    <h3><span class="red">${n}</span> · ${t}</h3><div class="role">${time}</div><p class="small">${txt}</p></div></div>`)));
  c.host.append(strip);
  footer(c, 'Subsystem kills (turrets, shield generator, bridge) use the batch-6 kill paths the lead session is building.');
}

export function sheet08(c, header, footer) {
  header(c, 8, 'The Standing', 'CULTURE, PEOPLE, HOOKS', '立');
  const THREE = c.THREE, K = c.K;
  const r1 = c.h(`<div class="grid over" style="grid-template-columns:1fr 1.15fr"></div>`);
  r1.append(c.h(`<div class="panel"><div class="lbl">How they talk</div>
    <table class="t" style="margin-top:14px">
      <tr><th>Say</th><th>Means</th></tr>
      <tr><td><b>"Standing."</b> / <b>"Stand."</b></td><td>Hello / reply. Iolanthe Vey's first word, a frame's status call. Their <em>"Lit."</em></td></tr>
      <tr><td><b>"Walk on."</b></td><td>Goodbye.</td></tr>
      <tr><td><b>knelt</b></td><td>disabled, pilot alive</td></tr>
      <tr><td><b>stood down</b></td><td>dead</td></tr>
      <tr><td><b>"She walked home."</b></td><td>the highest honour</td></tr>
      <tr><td><b>passenger</b></td><td>the worst insult there is</td></tr>
      <tr><td><b>"Lid up!" · "Hammer!" · "Drive the spike!"</b></td><td>battle calls on the Loom</td></tr>
      <tr><td><b>running late</b></td><td>the Kessen themselves. Every heartcase reads <span class="mono">WORKS CONSIST 9 — RUNNING LATE</span>.</td></tr>
      <tr><td><b>the Unborne</b></td><td>what the Reach calls them. They find it funny.</td></tr>
    </table>
    <p class="small" style="margin-top:12px"><b>The Hammer-song.</b> The Choir sings the Hymn and the Rustwake sing haul-songs. The Kessen <b>hammer</b>: a call-and-response
    work song timed to footfalls and gang-fire, sung on open bands.</p></div>`));
  const rite = c.h(`<div class="panel dark" style="padding:0"><div class="lbl">The Standing Field rite</div><div class="view" style="height:520px"></div>
    <p style="padding:12px 18px 16px;border-top:3px solid var(--ink);margin:0">A dead pilot's gang walks the frame home over the Loom and stands it on the Field, facing the Spine Gate.
    <b>Nobody is carried, not even the dead.</b></p></div>`);
  r1.append(rite);
  c.host.append(r1);
  c.view(rite.querySelector('.view'), (scene, aspect) => {
    c.lights(scene, { dir: [-5, 6, 3], amb: 0.7, ambient: 0xffd2b0, rim: 0xffa060, rimI: 1.2 }); K.setInk(null);
    const g = new THREE.Group();
    const dead = c.frame('plumb', 'standDown', { weapons: [] }); dead.position.set(0, 0, 0); g.add(dead);
    const bearers = [['tongs', -5, 3], ['tongs', 5, 3], ['chisel', -9, -3], ['gauge', 9, -3]];
    for (const [id, x, z] of bearers) {
      const f = c.frame(id, K.walkPose(x > 0 ? 0.1 : 0.6)); f.position.set(x, 0, z); g.add(f);
      f.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(f); f.position.y -= bb.min.y;
    }
    for (let i = 0; i < 5; i++) { const s = c.frame(['maul', 'plumb', 'anvil', 'rivet', 'spanner'][i], 'standDown', { livery: { primary: '#6d4a3a', secondary: '#9a7a62' } }); s.position.set(-22 + i * 11, 0, -34 - (i % 2) * 4); s.rotation.y = Math.PI; g.add(s); }
    // Loom threads from the gang to the dead frame's heartcase.
    const hc = dead.userData.bones.hatch.localToWorld(new THREE.Vector3());
    for (const [, x, z] of bearers) {
      const pts = [new THREE.Vector3(x, 4.5, z), hc];
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#74f6e2', dashSize: 0.5, gapSize: 0.35 }));
      l.computeLineDistances(); g.add(l);
    }
    scene.add(g);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(60, 40), K.toon('#4a3128')); gnd.rotation.x = -Math.PI / 2; scene.add(gnd);
    const cam = new THREE.PerspectiveCamera(30, aspect, 1, 500); cam.position.set(9, 7, 30); cam.lookAt(-1, 5, -8);
    return { camera: cam, labels: [{ p: [0, 0, 0], html: '<b style="color:#e8e6e0;text-shadow:0 0 4px #000">stood down · walked home on the Loom</b>', center: true, dy: 10 }] };
  });

  // People.
  const people = [
    ['Iolanthe Vey', 'Foreman, Works Consist 9 · Year 0', 'She stood up the first frame in the flooded hold and said "Standing." Her VARN is the first frame on the Standing Field.', 'tongs', 'standDown', { livery: { primary: '#9c7a3a', secondary: '#7d6a58' }, stencilChest: 'TAW-9', stencilLeg: 'VARN', code: 'VEY', weapons: [{ kind: 'tongsArm', bone: 'backpack' }] }],
    ['Chief Ganger Ruth Aske', 'Keeper of the Roster', 'Old even by Kessen reckoning. She sent her own grandson through the Seam and has counted his absence in years ever since.', 'anvil', { ...K.POSES.lance, crest: [0, 0, 70 * D] }, { stencil: 'ROSTER', weapons: [{ kind: 'knellLance', bone: 'weapon_R' }] }],
    ['Corin Aske, "Nine"', 'Linesman · envoy in the Reach', 'Eleven months in the Reach. His daughter was two when he left; she is ten now. A possible wingman for Vanguard.', 'plumb', 'aim', { stencil: 'NINE' }],
    ['Hesketh Dray, "Anvil"', 'Foreman · 4th Train', 'A hawk. Wants to hit the Graveyard Breakers before their cutters reach the stern of The Appointed Hour.', 'anvil', { ...K.POSES.heavy, crest: [0, 0, 55 * D] }, { stencil: '4TH' }],
    ['Fettler Wynn', 'Tongs · age eleven', 'A child fitter who mends a Kestrel in the dark and leaves a stencil on it. The Rustwake legend of the tin ghosts is true.', 'tongs', 'ready', { stencilChest: 'WYNN' }],
  ];
  const pr = c.h(`<div class="grid over" style="grid-template-columns:repeat(5,1fr);gap:16px;margin-top:22px"></div>`);
  for (const [name, role, txt, id, pose, extra] of people) {
    const card = c.h(`<div class="card"><div class="view" style="height:330px"></div><div class="body"><h3 style="font-size:24px">${name}</h3><div class="role">${role}</div><p class="small">${txt}</p></div></div>`);
    pr.append(card);
    c.view(card.querySelector('.view'), (scene, aspect) => {
      c.lights(scene); K.setInk(null);
      const f = c.frame(id, pose, extra); scene.add(f); c.shadow(scene, 0, 0, K.byId[id].height * 0.28);
      return c.fitOrtho(f, aspect, { dir: [0.55, 0.16, 1], pad: 1.1 });
    });
  }
  c.host.append(pr);

  const rel = c.h(`<div class="grid over" style="grid-template-columns:repeat(4,1fr);gap:16px;margin-top:22px"></div>`);
  const rels = [
    ['Terran Directorate', 'var(--td)', 'Since 398 the Office of Continuity has logged eleven unexplained losses in the Graveyard, all filed as "structural accidents". The file is called <b>UNSCHEDULED</b>. Pryce would want them as a lever.'],
    ['Zenith Hegemony', 'var(--zh)', 'Choir crystal rings at the Knell. The Choir calls the Kessen <b>the Tuneless</b> and fears them the way a bell fears a hammer.'],
    ['Rustwake Clans', 'var(--rw)', 'The only people who have traded with them. Kessen fix haulers in the dark for seeds and archives, never grams. <em>"Nothing in the black is ever truly lost."</em>'],
    ['The Builders', '#8a929c', 'The Kessen don\'t know the Builders\' names, but they know the Breath by feel. They are a witness to the secret history, not a key to it.'],
  ];
  for (const [n, col, t] of rels) rel.append(c.h(`<div class="panel" style="border-top:12px solid ${col}"><h3>${n}</h3><p class="small">${t}</p></div>`));
  c.host.append(rel);

  const last = c.h(`<div class="grid over" style="grid-template-columns:0.9fr 1.2fr 1fr;margin-top:22px"></div>`);
  const sw = [['#5d6875', 'primary', 'gunmetal slate'], ['#ddd3bd', 'secondary', 'bone plate'], ['#d63a2c', 'accent', 'signal red'], ['#2a2f37', 'dark', 'iron'], ['#74f6e2', 'glow', 'Loom teal'], ['#e8b42a', 'trim', 'works hazard']];
  last.append(c.h(`<div class="panel"><div class="lbl">Livery · faction id kessen</div><div style="margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
    ${sw.map(([hex, k, n]) => `<div class="swatch" style="width:auto"><i style="background:${hex}"></i><b>${k}</b><br>${hex}<br><span class="dim">${n}</span></div>`).join('')}</div>
    <p class="small" style="margin-top:10px">Three body colours and one hot accent, like the other factions in <span class="mono">Factions.ts</span>. Red is railway-signal red: they paint "stop" on themselves.</p></div>`));
  last.append(c.h(`<div class="panel"><div class="lbl">Campaign hooks</div><ol class="reasons" style="margin-top:18px">
    <li><b>Graveyard Shift</b>A Breakers contract at Anchorage. Ure's cutters reach a stern stencilled <span class="mono">WORKS CONSIST 9</span>, and something walks out.</li>
    <li><b>Running Late</b>0413's FCS reads a heartcase ID and answers in Timetable dialect: <span class="mono">YOU ARE RUNNING LATE. SERVICE WILL RESUME SHORTLY.</span></li>
    <li><b>The Seam question</b>Protect the stern and keep their door open, or let Continuity seize it. A guild choice with teeth.</li>
    <li><b>At the crest</b>Episode 19: every fold-core rings. A Train stands between the Nexus and what comes through. <em>"We told you we'd still be standing."</em></li>
  </ol></div>`));
  last.append(c.h(`<div class="panel dark"><div class="lbl r">For the other sessions</div>
    <p class="small" style="margin-top:18px"><b>Voices / score:</b> a Kessen score (steel percussion, anvil, a call-and-response work song) and barks: "Standing.", "Lid up!", "Hammer!",
    "Drive the spike!", "She walked home."</p>
    <p class="small"><b>Lead / engine:</b> <span class="mono">FactionId</span> gains <span class="mono">kessen</span>; a FrameKit with rigid-part bone skinning; walker and zero-g locomotion;
    Couplings (magnet-walk on hulls); boarding as a subsystem damage path.</p>
    <p class="small dim">All of this is a proposal. Nothing ships until it is signed off.</p></div>`));
  c.host.append(last);
  footer(c, 'See docs/KESSEN.md for the full write-up.');
}
