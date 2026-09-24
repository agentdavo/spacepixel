// Sheets 01 (origin) and 02 (Kessendra).

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function stars(w, h, n, seed = 7) {
  const r = rng(seed); let o = '';
  for (let i = 0; i < n; i++) o += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(r() * r() * 1.8 + 0.3).toFixed(2)}" fill="#fff" opacity="${(0.3 + r() * 0.7).toFixed(2)}"/>`;
  return o;
}
function hullShape(x, y, len, h, rot, cutFront = false, fill = '#2b2f38') {
  // A golden-age hull silhouette, optionally sheared off at the bow.
  const p = cutFront
    ? `M0,${-h * .5} L${len * .78},${-h * .55} L${len * .86},${-h * .2} L${len * .8},${h * .1} L${len * .88},${h * .45} L0,${h * .5} L${-len * .08},${h * .2} L${-len * .08},${-h * .25} Z`
    : `M0,${-h * .5} L${len * .75},${-h * .45} L${len},0 L${len * .75},${h * .45} L0,${h * .5} L${-len * .06},0 Z`;
  return `<g transform="translate(${x},${y}) rotate(${rot})"><path d="${p}" fill="${fill}" stroke="#0b0c10" stroke-width="3"/>
    <path d="M${len * .1},${-h * .15} H${len * .6}" stroke="#4a5160" stroke-width="3"/></g>`;
}

export function sheet01(c, header, footer) {
  header(c, 1, 'Two Halves of One Ship', 'ORIGIN', '立歩');
  const W = 1824, H = 700;
  const seam = 'M512,318 L560,300 L600,332 L660,296 L720,338 L790,300 L860,330 L930,298 L1000,336 L1080,302 L1150,334 L1220,306 L1290,330';
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">
    <defs>
      <radialGradient id="pl" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#e59a5a"/><stop offset=".45" stop-color="#b8612f"/><stop offset=".8" stop-color="#5a2a17"/><stop offset="1" stop-color="#1f0f0a"/></radialGradient>
      <radialGradient id="lan" cx="50%" cy="50%" r="50%"><stop offset=".7" stop-color="#0d0f14"/><stop offset=".86" stop-color="#1c2230"/><stop offset="1" stop-color="#0d0f14"/></radialGradient>
      <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
      <clipPath id="pc"><circle cx="1560" cy="330" r="250"/></clipPath>
    </defs>
    <rect width="${W}" height="${H}" fill="#0b0d13"/>
    ${stars(W, H, 420)}
    <rect x="${W / 2 + 8}" y="0" width="${W / 2}" height="${H}" fill="#3a1d10" opacity=".25"/>
    <line x1="${W / 2 + 8}" y1="40" x2="${W / 2 + 8}" y2="600" stroke="#9aa2ae" stroke-width="2" stroke-dasharray="10 10"/>
    <text x="${W / 2 - 14}" y="70" fill="#9aa2ae" text-anchor="end" font-family="Oswald" font-size="30" letter-spacing="4">THE REACH</text>
    <text x="${W / 2 - 14}" y="98" fill="#6e7684" text-anchor="end" font-family="IBM Plex Mono" font-size="16">Lantern network · 1 year = 1 year</text>
    <text x="${W / 2 + 30}" y="70" fill="#e59a5a" font-family="Oswald" font-size="30" letter-spacing="4">THE SHOAL</text>
    <text x="${W / 2 + 30}" y="98" fill="#b8744a" font-family="IBM Plex Mono" font-size="16">outside every road · 1 Reach year = 9 here</text>

    <!-- Anchorage Great Lantern + Graveyard -->
    <ellipse cx="330" cy="320" rx="175" ry="235" fill="none" stroke="#050608" stroke-width="54"/>
    <ellipse cx="330" cy="320" rx="175" ry="235" fill="none" stroke="#2a3040" stroke-width="44"/>
    <ellipse cx="330" cy="320" rx="175" ry="235" fill="none" stroke="#3c4458" stroke-width="3" stroke-dasharray="4 18"/>
    ${hullShape(120, 170, 90, 22, 24)}${hullShape(470, 120, 70, 18, -30)}${hullShape(150, 520, 110, 26, -12)}${hullShape(520, 540, 80, 20, 40)}${hullShape(90, 360, 60, 16, 70)}${hullShape(560, 420, 60, 14, 12)}
    ${hullShape(330, 318, 210, 60, 0, true, '#3a404d')}
    <text x="344" y="323" fill="#e59a5a" font-family="IBM Plex Mono" font-size="13" font-weight="600">TAW-9 · STERN</text>
    <path d="${seam}" stroke="#74f6e2" stroke-width="18" fill="none" filter="url(#glow)" opacity=".9"/>
    <path d="${seam}" stroke="#74f6e2" stroke-width="5" fill="none"/>
    <path d="${seam}" stroke="#ffffff" stroke-width="1.6" fill="none"/>

    <!-- Kessendra -->
    <circle cx="1560" cy="330" r="250" fill="url(#pl)"/>
    <g clip-path="url(#pc)" opacity=".5">
      <ellipse cx="1520" cy="230" rx="300" ry="26" fill="#f1b37a" opacity=".45"/><ellipse cx="1600" cy="300" rx="320" ry="18" fill="#8a3f1c" opacity=".6"/>
      <ellipse cx="1500" cy="380" rx="330" ry="30" fill="#e8a067" opacity=".35"/><ellipse cx="1580" cy="470" rx="300" ry="22" fill="#6e3218" opacity=".6"/>
      <polyline points="1380,260 1420,268 1440,258 1500,266 1520,252" stroke="#fff4c8" stroke-width="2.5" fill="none"/>
      <polyline points="1600,420 1650,412 1672,424 1720,416" stroke="#fff4c8" stroke-width="2" fill="none"/>
    </g>
    <circle cx="1560" cy="330" r="250" fill="none" stroke="#0b0c10" stroke-width="4"/>
    <g transform="translate(1302,332) rotate(-8)"><path d="M0,-10 L-40,-14 L-70,-4 L-64,10 L-20,12 Z" fill="#1d1f26" stroke="#0b0c10" stroke-width="2"/></g>
    <circle cx="1298" cy="330" r="7" fill="#74f6e2"/>

    <!-- labels -->
    <g font-family="Barlow Condensed" font-size="21" fill="#e8e6e0">
      <text x="120" y="620" font-family="Oswald" font-size="24" fill="#fff">ANCHORAGE GREAT LANTERN (dead)</text>
      <text x="120" y="646" fill="#9aa2ae">The Timetable Graveyard: forty ships caught in the throat at Year 0.</text>
      <text x="120" y="670" fill="#9aa2ae">One of them is the stern of <tspan font-style="italic" fill="#fff">The Appointed Hour</tspan>. The Breakers want it for scrap.</text>
      <text x="640" y="410" font-family="Oswald" font-size="28" fill="#74f6e2" letter-spacing="2">THE SEAM</text>
      <text x="640" y="436" fill="#bff7ee">a crack in space 14 m wide, the ship's broken spine.</text>
      <text x="640" y="460" fill="#bff7ee" opacity=".85">Nine minutes' walk in the dark. Fold-cores shear in it. Walkers don't.</text>
      <text x="1330" y="628" font-family="Oswald" font-size="24" fill="#fff">KESSENDRA · 1.31 g · the Lid</text>
      <text x="1330" y="654" fill="#d9a27c">The bow came down here: the frame holds, the habitat, 840 people.</text>
      <text x="1330" y="678" fill="#d9a27c">No fold-core has ever run in this system.</text>
      <line x1="1298" y1="330" x2="1240" y2="230" stroke="#74f6e2" stroke-width="2"/>
      <text x="1080" y="222" fill="#74f6e2" font-family="IBM Plex Mono" font-size="15">THE BOW · SPINE GATE</text>
    </g>
  </svg>`;
  c.host.append(c.h(`<div class="panel dark over" style="padding:0;overflow:hidden"><div class="lbl">Year 0 · the Shattering</div><div class="lbl r">TAW-9 The Appointed Hour</div>${svg}</div>`));

  // Clock bars.
  c.host.append(c.h(`<div class="panel over" style="margin-top:22px;padding:22px 24px 16px"><div class="lbl">Two clocks</div>
    <div style="display:grid;grid-template-columns:260px 1fr;gap:10px 18px;align-items:center;margin-top:12px">
      <b class="mono">REACH · 431 YEARS</b><div style="height:28px;width:${(1450 / 9).toFixed(0)}px;background:var(--td);border:3px solid var(--ink)"></div>
      <b class="mono">KESSENDRA · ~3,880 YEARS</b><div style="height:28px;width:1450px;background:linear-gradient(90deg,#b8612f,#e59a5a);border:3px solid var(--ink);position:relative">
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<i style="position:absolute;left:${i * 11.1}%;top:-3px;bottom:-3px;border-left:2px solid var(--ink)"></i>`).join('')}</div>
    </div>
    <p class="small" style="margin-top:12px">Kessendra sits in a <b>shoal</b> of the Breath, where time runs nine times fast. That is how 840 stranded works crew became a distinct people with
    four thousand years of history while the Reach counted four centuries. It is also the price of contact: a Kessen who spends a year in the Reach comes home to find nine years gone.</p></div>`));

  const row = c.h(`<div class="grid over" style="grid-template-columns:1.05fr 1fr;margin-top:22px"></div>`);
  row.append(c.h(`<div class="panel"><div class="lbl">Why walkers, not ships</div>
    <ol class="reasons" style="margin-top:18px">
      <li><b>Nothing else survived</b>The bow held frames, not engines. The first shelter was a cockpit; the first plough was a thirty-tonne hand.</li>
      <li><b>Ships cannot exist at home</b>In the shoal the Breath shears any fold-core the moment it lights. No ship has ever lifted from Kessendra. A body doesn't fold space.</li>
      <li><b>The only door is a street wide</b>The Seam admits nothing wider than 14 m and nothing with a fold-core. Three storeys and a crane boom is the limit.</li>
      <li><b>Carried means lost</b>The ship carried them into nowhere. <em>"I will not be carried."</em> Their worst insult is "passenger". Even the dead walk home.</li>
      <li><b>The Breath is coming back</b>They feel it in their teeth. When the crest comes, every fold-core in the Reach will ring. <em>"We will still be standing."</em></li>
      <li><b>Understanding, not maintenance</b>The Reach keeps fossil machines it cannot open. The Kessen opened the VARN frames in Year 3 and never stopped. They are the only people who design new machines.</li>
    </ol></div>`));
  const right = c.h(`<div class="panel" style="padding:0;display:flex;flex-direction:column"><div class="lbl">From tool to body</div><div class="lbl r">Year 0 → Year 3,880</div>
    <div class="view" style="height:560px"></div>
    <div style="padding:12px 18px 16px;border-top:3px solid var(--ink)">
      <div class="quote" style="margin:0">"Standing."<cite>FOREMAN IOLANTHE VEY, WORKS CONSIST 9, FROM INSIDE THE FIRST FRAME</cite></div></div></div>`);
  row.append(right);
  c.host.append(row);
  c.view(right.querySelector('.view'), (scene, aspect) => {
    const THREE = c.THREE, K = c.K;
    c.lights(scene);
    K.setInk(0.03);
    const g = new THREE.Group();
    const varn = c.frame('tongs', 'standDown', { livery: { primary: '#c99a2e', secondary: '#8f8a7e' }, stencilChest: 'TAW-9', stencilLeg: 'VARN', code: 'VARN', height: 3.4, weapons: [{ kind: 'tongsArm', bone: 'backpack' }] });
    varn.position.set(-3.6, 0, 0); g.add(varn);
    const pilot = K.human(); pilot.position.set(3.5, 0, 1.2); g.add(pilot);
    const rivet = c.frame('rivet', 'ready'); rivet.position.set(1.4, 0, 0.6); g.add(rivet);
    const plumb = c.frame('plumb', 'ready'); plumb.position.set(6.2, 0, -1); g.add(plumb);
    for (const [x, r] of [[-3.6, 1.2], [1.4, 1], [6.2, 2.2]]) c.shadow(scene, x, 0, r);
    scene.add(g);
    const labels = [
      { p: [-3.6, 0, 0], html: '<b>VARN-9 LABOUR FRAME</b><br>Year 0 · works stock', dy: 12 },
      { p: [3.5, 0, 1.2], html: '<b>PILOT</b>', dy: 12 },
      { p: [1.4, 0, 0.6], html: '<b>RIVET</b><br>Stature I', dy: 12 },
      { p: [6.2, 0, -1], html: '<b>PLUMB</b><br>Stature III', dy: 12 },
    ].map((l) => ({ ...l, center: true }));
    const box = new THREE.Box3().setFromObject(g); box.min.y -= 1.6;
    return { camera: c.fitOrtho(g, aspect, { dir: [0.4, 0.14, 1], pad: 1.08, box }), labels };
  });
  footer(c, 'Diagram, not to scale. The Seam\'s mouths are inside the two halves of one ship.');
}

export function sheet02(c, header, footer) {
  header(c, 2, 'Kessendra', 'HOMEWORLD', '鉄');
  const r = rng(11);
  let bolts = '';
  for (let i = 0; i < 7; i++) {
    let x = r() * 1824, y = 40 + r() * 220, d = `M${x.toFixed(0)},${y.toFixed(0)}`;
    for (let k = 0; k < 8; k++) { x += 30 + r() * 60; y += (r() - 0.5) * 30; d += ` L${x.toFixed(0)},${y.toFixed(0)}`; }
    bolts += `<path d="${d}" stroke="#fff3c4" stroke-width="${(1.5 + r() * 2).toFixed(1)}" fill="none" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
  }
  const hero = c.h(`<div class="panel over" style="height:820px;padding:0;overflow:hidden;background:linear-gradient(180deg,#3b1a10 0%,#7a3a1c 30%,#c06a34 58%,#e0995c 66%,#7a4a33 66.2%)">
    <svg viewBox="0 0 1824 820" style="position:absolute;inset:0" width="100%" height="100%">
      <defs><linearGradient id="lid" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1e0c07" stop-opacity=".9"/><stop offset="1" stop-color="#1e0c07" stop-opacity="0"/></linearGradient></defs>
      <rect width="1824" height="260" fill="url(#lid)"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="${200 + i * 300}" cy="${60 + (i % 3) * 40}" rx="${260 + (i % 2) * 120}" ry="30" fill="#e8a067" opacity=".12"/>`).join('')}
      ${bolts}
    </svg>
    <div class="lbl">The Standing Field · the Bow · Mount Vey</div><div class="lbl r">under the Lid</div>
    <div class="view" style="position:absolute;inset:0"></div></div>`);
  c.host.append(hero);
  c.view(hero.querySelector('.view'), (scene, aspect) => {
    const THREE = c.THREE, K = c.K;
    scene.fog = new THREE.Fog(0xb8683a, 60, 4200);
    c.lights(scene, { dir: [-3, 5, -6], key: 2.2, amb: 0.9, ambient: 0xffc8a0, rim: 0xffb070, rimI: 1.2 });
    K.setInk(null);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), K.toon('#4a3128'));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    // The Bow: the forward half of The Appointed Hour, half-buried, 4 km long.
    const bow = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1500, 320, 360), K.toon('#3a3634')); hull.position.set(0, 60, 0); bow.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1300, 90, 300), K.toon('#4a4642')); deck.position.set(-80, 260, 0); bow.add(deck);
    const prow = new THREE.Mesh(new THREE.CylinderGeometry(10, 200, 520, 4), K.toon('#3a3634')); prow.rotation.z = Math.PI / 2; prow.position.set(-990, 60, 0); bow.add(prow);
    for (let i = 0; i < 9; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(24, 380 + (i % 3) * 60, 30), K.toon('#2c2826')); rib.position.set(770 + (i % 3) * 30, 140, -160 + i * 40); rib.rotation.z = -0.2 + (i % 4) * 0.12; bow.add(rib); }
    const gate = new THREE.Mesh(new THREE.CircleGeometry(110, 24), new THREE.MeshBasicMaterial({ color: '#9ffcec', fog: false })); gate.rotation.y = Math.PI / 2; gate.position.set(752, 90, 0); bow.add(gate);
    for (let i = 0; i < 40; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 2), K.glowMat('#ffd27a')); w.position.set(-600 + (i % 20) * 60, 120 + Math.floor(i / 20) * 50, 181); bow.add(w); }
    bow.position.set(-420, -40, -2200); bow.rotation.set(0.04, -1.07, 0.05); scene.add(bow);
    // Mount Vey and the Stair.
    const mt = new THREE.Mesh(new THREE.ConeGeometry(1700, 2000, 7), K.toon('#4f2d20')); mt.position.set(2600, 900, -7000); scene.add(mt);
    const a = new THREE.Vector3(1100, 0, -5900), b2 = new THREE.Vector3(2600, 1900, -6950);
    const stair = new THREE.Mesh(new THREE.BoxGeometry(60, 60, a.distanceTo(b2)), new THREE.MeshBasicMaterial({ color: '#ffe0b0', fog: false }));
    stair.position.copy(a).lerp(b2, 0.5); stair.lookAt(b2); scene.add(stair);
    // The Standing Field.
    const ids = ['plumb', 'plumb', 'gimlet', 'maul', 'rivet', 'anvil', 'chisel', 'gauge', 'bellows', 'spanner', 'tamper', 'tongs'];
    const protos = new Map();
    const proto = (id, rust) => {
      const k = id + rust; if (protos.has(k)) return protos.get(k).clone();
      const lv = rust ? { primary: '#6d4a3a', secondary: '#9a7a62' } : undefined;
      const f = c.frame(id, 'standDown', lv ? { livery: lv } : {});
      f.userData = {}; protos.set(k, f); return f.clone();
    };
    const rr = rng(5);
    for (let row = 0; row < 15; row++) {
      for (let col = -4; col <= 4; col++) {
        if (col === 0 || rr() < 0.15) continue;
        const z = -14 - row * 26 - row * row * 3 - rr() * 6, x = col * 16 + (row % 2) * 8 + (rr() - 0.5) * 4;
        const f = proto(ids[Math.floor(rr() * ids.length)], row > 3 || rr() < 0.3);
        f.position.set(x, 0, z); f.rotation.y = Math.PI + (rr() - 0.5) * 0.1;
        f.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(f); f.position.y -= bb.min.y;
        scene.add(f);
      }
    }
    const cam = new THREE.PerspectiveCamera(34, aspect, 1, 12000);
    cam.position.set(0, 6.5, 26); cam.lookAt(-30, 90, -1600);
    return cam;
  });

  const grid = c.h(`<div class="grid over" style="grid-template-columns:1fr 1fr 1fr;margin-top:22px"></div>`);
  grid.append(c.h(`<div class="panel"><div class="lbl">Planet</div>
    <table class="t" style="margin-top:14px">
      <tr><td>Type</td><td>Iron super-terran</td></tr>
      <tr><td>Gravity</td><td class="num">1.31 g</td></tr>
      <tr><td>Day</td><td class="num">26 h</td></tr>
      <tr><td>Sky</td><td><b>the Lid</b>: a permanent copper storm canopy, ionised by shoal shear. The sun has not been seen in 3,000 years.</td></tr>
      <tr><td>Clock</td><td><b>×9</b> against the Reach</td></tr>
      <tr><td>People</td><td class="num">~2.1 million, all on the Roster</td></tr>
      <tr><td>Fold-cores</td><td>shear on ignition, everywhere in the system</td></tr>
    </table></div>`));
  grid.append(c.h(`<div class="panel"><div class="lbl">Places</div>
    <p style="margin-top:16px"><b>The Bow.</b> The forward half of <em>The Appointed Hour</em>, 4 km long and half-buried in basalt. The first city and the capital, with frame foundries in the old holds.
    The Seam opens in its broken spine: the <b>Spine Gate</b>.</p>
    <p><b>The Standing Field.</b> Every frame whose pilot has died stands here upright, facing the Gate: about 190,000 of them. Children learn their letters from the stencils.</p>
    <p><b>The Stair.</b> A 40 km launch track up Mount Vey, the only way to orbit. You don't ride the Stair, you <em>run</em> it.</p>
    <p><b>The Roster Hall.</b> Every living Kessen is a name and a job.</p></div>`));
  grid.append(c.h(`<div class="panel dark"><div class="lbl r">People</div>
    <p style="margin-top:16px">Four thousand years under 1.3 g and a copper sky: shorter, denser, broad in the hand, grey-pale. Every Kessen has a socket at the nape, fitted at seven.</p>
    <div class="quote" style="border-color:var(--tealglow)">"The Reach calls us the Unborne. We were born. We just weren't carried."<cite>LINESMAN CORIN ASKE, "NINE"</cite></div>
    <p class="dim small">They kept the Timetable Authority's clock. Every heartcase is stencilled <span class="mono" style="color:#74f6e2">WORKS CONSIST 9 — RUNNING LATE</span>.</p></div>`));
  c.host.append(grid);
  footer(c, 'Frames on the Standing Field are in the stand-down pose: pilot dead, frame locked upright, head bowed. Kessen frames never fall over.');
}
