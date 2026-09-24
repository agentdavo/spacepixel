// Kessen concept sheets: content. Each sheet builds DOM into ctx.host and
// registers 3D views with ctx.view(el, build).
import { STATURES, WEAPON_INFO } from './data.js';

const TOTAL = 8;
function header(c, n, title, sub, kanji = '決戦') {
  c.host.append(c.h(`<header class="hdr over">
    <div class="kanji">${kanji}</div>
    <h1><small>THE KESSEN · ${sub}</small>${title}</h1>
    <div class="tag"><b>SHEET ${String(n).padStart(2, '0')}/${String(TOTAL).padStart(2, '0')}</b><br>PROJECT VANGUARD · NEW RACE PROPOSAL<br>faction id <span class="red">kessen</span> · concept, not canon yet</div>
  </header>`));
}
function footer(c, left) {
  c.host.append(c.h(`<div class="foot over"><span>${left}</span><span>STANDING. — WHAT WALKS, RETURNS.</span></div>`));
}

import { sheet01, sheet02 } from './content-world.js';
import { sheet05, sheet06 } from './content-tech.js';
import { sheet07, sheet08 } from './content-train.js';

export const SHEETS = {
  '01-origin': (c) => sheet01(c, header, footer),
  '02-kessendra': (c) => sheet02(c, header, footer),
  '03-statures': (c) => sheet03(c),
  '04-variants': (c) => sheet04(c),
  '05-weapons': (c) => sheet05(c, header, footer),
  '06-skeleton': (c) => sheet06(c, header, footer),
  '07-train': (c) => sheet07(c, header, footer),
  '08-culture': (c) => sheet08(c, header, footer),
  // Scratch view for checking a pose: ?sheet=pose&id=plumb&pose=kneel
  pose: (c) => {
    const q = new URLSearchParams(location.search);
    const el = c.h('<div class="view" style="width:900px;height:700px"></div>'); c.host.append(el);
    c.view(el, (scene, aspect) => { c.lights(scene); const f = c.frame(q.get('id') ?? 'plumb', q.get('pose') === 'walk' ? c.K.walkPose(0.25) : q.get('pose') ?? 'kneel'); scene.add(f); c.shadow(scene, 0, 0, 2); return c.fitOrtho(f, aspect, { dir: [1, 0.1, 0.4] }); });
  },
};

// ── 03 · the five statures, to scale ───────────────────────────────────
function sheet03(c) {
  header(c, 3, 'Five Statures', 'FRAMES TO SCALE', '五段');
  const THREE = c.THREE, K = c.K;
  const lineup = c.h(`<div class="panel over" style="height:720px;padding:0">
    <div class="lbl">Lineup · to scale · metres</div><div class="lbl r">1 frame · 1 pilot · for life</div>
    <div class="view" style="position:absolute;inset:0"></div></div>`);
  c.host.append(lineup);
  c.view(lineup.querySelector('.view'), (scene, aspect) => {
    c.lights(scene);
    K.setInk(0.045);
    const g = new THREE.Group();
    const labels = [];
    const person = K.human(); person.position.set(-3.2, 0, 1); g.add(person);
    labels.push({ p: [-3.2, 0, 1], html: '<b>PILOT</b><br><span class="mono">1.8 m</span>', center: true, dy: 14 });
    const picks = [['rivet', 'ready', 1.3], ['gimlet', 'ready', 2.3], ['plumb', 'ready', 3.4], ['maul', 'guard', 5.6], ['anvil', 'ready', 6.2]];
    let x = -0.6;
    for (const [id, pose, w] of picks) {
      x += w;
      const f = c.frame(id, pose); f.position.x = x; g.add(f);
      c.shadow(scene, x, 0, K.byId[id].height * 0.28);
      const st = STATURES[K.byId[id].stature - 1];
      labels.push({ p: [x, 0, 0], html: `<b style="font-size:${16 + st.n * 2.4}px">${st.roman} · ${st.name}</b><br><span class="mono">${st.height}</span>`, center: true, dy: 14 });
      x += w;
    }
    const bld = K.building(3); bld.position.set(x + 5.2, 0, -2); g.add(bld);
    const fitBox = new THREE.Box3().setFromObject(g); fitBox.min.y -= 2.2; fitBox.min.x -= 2.4;
    labels.push({ p: [x + 5.2, 0, -2], html: '<b>3 STOREYS</b><br><span class="mono">9.9 m</span>', center: true, dy: 14 });
    // Ruler.
    const rx = -5.6;
    const ink = new THREE.MeshBasicMaterial({ color: 0x17181d });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 12, 0.08), ink); bar.position.set(rx, 6, 0); g.add(bar);
    for (let m = 0; m <= 12; m++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(m % 2 ? 0.3 : 0.6, 0.05, 0.05), ink); t.position.set(rx + (m % 2 ? 0.15 : 0.3), m, 0); g.add(t);
      if (m % 2 === 0) labels.push({ p: [rx - 0.2, m, 0], html: `<span class="mono">${m} m</span>`, dx: -46, dy: -10 });
    }
    // Ground line.
    const gl = new THREE.Mesh(new THREE.BoxGeometry(60, 0.04, 0.04), ink); gl.position.set(20, 0, 1.5); scene.add(gl);
    scene.add(g);
    return { camera: c.fitOrtho(g, aspect, { dir: [0.22, 0.06, 1], pad: 1.04, box: fitBox }), labels };
  });

  const cols = c.h(`<div class="grid over" style="grid-template-columns:repeat(5,1fr);margin-top:26px"></div>`);
  for (const s of STATURES) {
    cols.append(c.h(`<div class="panel"><div class="lbl">${s.roman}</div>
      <h2 style="margin-top:14px">${s.name}</h2>
      <div class="role mono red" style="margin-bottom:8px">${s.height} · ${s.tag}</div>
      <p class="small">${s.blurb}</p>
      <p class="small"><b>Variants:</b> ${s.variants}</p>
      <p class="small"><b>In a Train:</b> ${s.train}</p>
      <div class="stats">${s.stats}</div></div>`));
  }
  c.host.append(cols);
  c.host.append(c.h(`<div class="panel over" style="margin-top:22px"><div class="lbl">Why "stature"</div>
    <p style="margin-top:16px">A Kessen child is <b>Threaded</b> at seven: a socket at the nape, and a first frame (Stature I) cut to their size. The <b>heartcase</b>
    (cockpit core) is fitted to one nervous system and is never re-piloted. As the pilot earns rank, the frame is rebuilt bigger around the same heartcase: the
    body grows with the oath. <em>"The size of your body is the size of your promise."</em> A Gantry pilot has been rebuilt four times and has never changed seats.
    Compare airframe 0413, which has had sixty-seven pilots; the Kessen find that obscene.</p></div>`));
  footer(c, 'Heights are to the crown. Gantry crane booms reach 14 m, the width of the Seam, which is why nothing bigger exists.');
}

// ── 04 · all fourteen variants ─────────────────────────────────────────
function sheet04(c) {
  header(c, 4, 'Fourteen Frames', 'VARIANTS AND LOADOUTS', '鉄人');
  const K = c.K;
  for (const st of STATURES) {
    const vs = K.VARIANTS.filter((v) => v.stature === st.n);
    const row = c.h(`<div class="over" style="display:grid;grid-template-columns:150px repeat(3,1fr);gap:20px;margin-bottom:22px"></div>`);
    row.append(c.h(`<div style="border-right:6px solid var(--ink);padding-right:12px">
      <div style="font:700 88px/0.9 Oswald;color:var(--red)">${st.roman}</div>
      <div style="font:700 28px/1 Oswald;text-transform:uppercase">${st.name}</div>
      <div class="mono dim" style="margin-top:6px">${st.height}</div></div>`));
    for (const v of vs) {
      const info = st.cards[v.id];
      const card = c.h(`<div class="card" style="display:grid;grid-template-columns:250px 1fr;height:330px">
        <div class="view" style="border-bottom:0;border-right:3px solid var(--ink)"></div>
        <div class="body"><h3>${v.name}</h3><div class="role">${v.role}</div>
          <p class="small">${info.text}</p>
          <div>${info.kit.map(([k, t]) => `<span class="chip ${t}">${k}</span>`).join('')}</div>
          <div class="stats">${info.stats}</div></div></div>`);
      row.append(card);
      c.view(card.querySelector('.view'), (scene, aspect) => {
        c.lights(scene);
        K.setInk(null);
        const f = c.frame(v.id);
        scene.add(f);
        c.shadow(scene, 0, 0, v.height * 0.3);
        return c.fitOrtho(f, aspect, { dir: [0.62, 0.2, 1], pad: 1.08 });
      });
    }
    if (vs.length < 3) row.append(c.h(`<div class="panel" style="display:flex;flex-direction:column;justify-content:center">
      <h3>Shunters come in pairs</h3><p class="small">Two variants only. A Gimlet and a Spanner are Threaded as a pair and fly as one;
      if one stands down the other goes back to the Standing Field and rebuilds as a Linesman, alone. It is the only way a Kessen skips a wait.</p></div>`));
    c.host.append(row);
  }
  footer(c, 'Stats are proposals in the game\'s own units (Kestrel: hull 110 / shield 70). Tune with npm run balance before they are canon.');
}
