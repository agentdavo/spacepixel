// Sheets 05 (weapons + shields) and 06 (skeleton + animation).
import { WEAPON_INFO } from './data.js';

const D = Math.PI / 180;

export function sheet05(c, header, footer) {
  header(c, 5, 'Arms & Shields', 'WEAPONS', '型');
  const THREE = c.THREE, K = c.K;
  const grid = c.h(`<div class="grid over" style="grid-template-columns:repeat(4,1fr);gap:18px"></div>`);
  for (const w of WEAPON_INFO) {
    const card = c.h(`<div class="card"><div class="view" style="height:170px"></div>
      <div class="body"><h3 style="font-size:26px">${w.name}</h3>
      <div><span class="chip ${w.type}">${w.type}</span><span class="chip util">${w.on}</span></div>
      <p class="small" style="margin-top:4px">${w.text}</p><div class="stats">${w.num}</div></div></div>`);
    grid.append(card);
    c.view(card.querySelector('.view'), (scene, aspect) => {
      c.lights(scene);
      const g = K.lone(w.kind);
      const mount = ['cinders', 'mortar', 'lidEmitter'].includes(w.kind);
      if (w.kind === 'longScribe') g.rotation.y = Math.PI / 2;
      else if (!mount) g.rotation.z = Math.PI / 2;
      const holder = new THREE.Group(); holder.add(g); scene.add(holder);
      return c.fitOrtho(holder, aspect, { dir: mount ? [0.7, 0.35, 1] : [0.12, 0.3, 1], pad: 1.18 });
    });
  }
  grid.append(c.h(`<div class="card" style="grid-column:span 2;padding:16px 18px;background:var(--night);color:#e8e6e0">
    <h3>Naming</h3><p class="small">Kessen guns are named after the work they replaced. You <b>scribe</b> steel before you cut it. A <b>knocker</b> taps the rock face and listens.
    <b>Spikes</b> pinned the Timetable's rails. A <b>tamper</b> packs ballast. The Choir names weapons after prayers; the Kessen name them after jobs.</p>
    <p class="small" style="color:#9aa2ae">Damage types are the game's existing four (<span class="mono">laser · kinetic · explosive · harmonic</span>), so the Kessen fit
    <span class="mono">DAMAGE_MUL</span> in <span class="mono">src/sim/Damage.ts</span> without new rules. The Knell is the only harmonic weapon outside the Choir.</p></div>`));
  c.host.append(grid);

  // Two kinds of shield.
  const sh = c.h(`<div class="grid over" style="grid-template-columns:1fr 1fr 0.9fr;margin-top:22px"></div>`);
  const a = c.h(`<div class="panel" style="padding:0"><div class="lbl">Buffer · held physics shield</div><div class="view" style="height:560px"></div></div>`);
  const b = c.h(`<div class="panel dark" style="padding:0"><div class="lbl r">Lid · projected energy shield</div><div class="view" style="height:560px"></div></div>`);
  sh.append(a, b);
  sh.append(c.h(`<div class="panel"><div class="lbl">How they work</div>
    <h3 style="margin-top:18px">Buffer</h3>
    <p class="small">An inertial plate that <b>eats momentum</b>. Nearly total against kinetic and explosive fire; lasers burn through at 60 %. Comes as a board (Fettlers), a kite (Linesmen)
    and a wall (Derricks, Gantries). It runs on the frame's own reactor, so a Buffer frame is slow.</p>
    <h3>Lid</h3>
    <p class="small">A projected dome, named after the sky at home. It <b>bleeds beams and harmonics</b>. Bellows throw a 40 m dome; Anvils throw a wall 120 m across. It is
    <b>momentum-gated</b>: fast things bounce, slow things walk through, which is how the Train's own frames move in and out.</p>
    <div class="quote" style="font-size:22px">Reach capital shields are momentum-gated too. They stop what hits fast. A frame that walks in at walking pace passes straight through.</div>
    <p class="small">That one fact is why mecha beat ships at close quarters. A ship can't slow down enough to do the same, and a frame can stand still.</p></div>`));
  c.host.append(sh);
  c.view(a.querySelector('.view'), (scene, aspect) => {
    c.lights(scene); K.setInk(null);
    const f = c.frame('maul', 'guard'); scene.add(f); c.shadow(scene, 0, 0, 3);
    const labels = [{ p: [0, 0, 0], html: '<b>MAUL · Buffer wall</b><br>kinetic and explosive: ×0.1 · laser: ×0.6', center: true, dy: 10 }];
    const box = new THREE.Box3().setFromObject(f); box.min.y -= 1.5;
    return { camera: c.fitOrtho(f, aspect, { dir: [0.9, 0.2, 1], pad: 1.08, box }), labels };
  });
  c.view(b.querySelector('.view'), (scene, aspect) => {
    c.lights(scene, { amb: 0.9 }); K.setInk(null);
    const g = new THREE.Group();
    const bel = c.frame('bellows', 'cast'); g.add(bel);
    const g1 = c.frame('gimlet', 'dual'); g1.position.set(-8, 0, 5); g1.rotation.y = 0.6; g.add(g1);
    const g2 = c.frame('plumb', 'aim'); g2.position.set(8, 0, 4); g2.rotation.y = -0.3; g.add(g2);
    const walker = c.frame('rivet', K.walkPose(0.2)); walker.position.set(-13.6, 0, -4); walker.rotation.y = Math.PI / 2; g.add(walker);
    scene.add(g);
    const R = 16;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#74f6e2', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(dome);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R, 2)), new THREE.LineBasicMaterial({ color: '#74f6e2', transparent: true, opacity: 0.55 }));
    wire.material.clippingPlanes = []; scene.add(wire);
    // clip the wire to the upper hemisphere by hiding the lower half under a ground disc
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: '#12151c' })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.02; scene.add(gnd);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 30, 32), new THREE.MeshBasicMaterial({ color: '#12151c' })); under.position.y = -15.05; scene.add(under);
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 0.9 + 0.3;
      const p = new THREE.Vector3(Math.cos(t) * R, Math.sin(t) * R * 0.8 + 3, 6).setLength(R);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 12), K.glowMat(i % 2 ? '#ff4fd8' : '#56c8ff'));
      beam.position.copy(p).add(new THREE.Vector3(p.x * 0.4, p.y * 0.4, 7)); beam.lookAt(p); scene.add(beam);
      const hit = new THREE.Mesh(new THREE.CircleGeometry(1.2, 6), K.glowMat('#e6fffb', 0.8)); hit.position.copy(p); hit.lookAt(0, 0, 0); scene.add(hit);
    }
    const labels = [
      { p: [0, R + 1.5, 0], html: '<b style="color:#74f6e2">LID · 40 m dome</b>', center: true },
      { p: [-13.6, 0, -4], html: '<b style="color:#e8e6e0">walking pace: passes</b>', center: true, dy: 8 },
    ];
    const box = new THREE.Box3(new THREE.Vector3(-R - 1, 0, -R), new THREE.Vector3(R + 1, R + 2, R));
    return { camera: c.fitOrtho(g, aspect, { dir: [0.35, 0.35, 1], pad: 1.1, box }), labels };
  });
  footer(c, 'Weapons are drawn at frame scale on a bare socket; every gun lies along the forearm, grip at the hand bone.');
}

export function sheet06(c, header, footer) {
  header(c, 6, 'The Skeleton', 'RIG AND ANIMATION', '人型');
  const THREE = c.THREE, K = c.K;
  const top = c.h(`<div class="grid over" style="grid-template-columns:1fr 1fr 1fr 500px;gap:18px"></div>`);
  const mk = (lbl, cls = '') => c.h(`<div class="panel ${cls}" style="padding:0"><div class="lbl">${lbl}</div><div class="view" style="height:720px"></div></div>`);
  const v1 = mk('Armoured'), v2 = mk('X-ray', 'dark'), v3 = mk('42 bones', 'dark');
  top.append(v1, v2, v3);
  const tree = `root
└ hips
  ├ skirt_F · skirt_B · skirt_L · skirt_R   <span class="dim">spring</span>
  ├ thigh_L → shin_L → foot_L → toe_L       <span class="dim">foot IK</span>
  ├ thigh_R → shin_R → foot_R → toe_R
  └ spine → chest
      ├ neck → head → crest              <span class="dim">look-at</span>
      ├ hatch                            <span class="dim">heartcase</span>
      ├ shoulder_L ┬ pauldron_L
      │            └ upperarm_L → forearm_L
      │                 ├ shield_L       <span class="dim">socket</span>
      │                 └ hand_L ┬ fingers_L
      │                          ├ thumb_L
      │                          └ weapon_L
      ├ shoulder_R … (mirror, weapon_R)
      ├ backpack → jet_L · jet_R         <span class="dim">vectoring</span>
      └ mount_L · mount_R                <span class="dim">shoulder guns</span>

<span class="dim">solved after pose:</span>
  pistons  thigh↔shin · upperarm↔forearm`;
  top.append(c.h(`<div class="panel"><div class="lbl">Hierarchy</div>
    <pre class="mono" style="margin-top:18px;font-size:13px;line-height:1.45;white-space:pre">${tree}</pre>
    <p class="small" style="margin-top:12px"><b>One rig, every frame.</b> Proportions change per Stature; bone names don't, so every clip retargets to all fourteen frames.</p>
    <p class="small"><b>Rigid-part skinning.</b> Each plate is 100 % bound to one bone: correct for armour and cheap. A 200-frame Train is 8,400 bone matrices in one texture.</p></div>`));
  c.host.append(top);
  const aPose = { shoulder_L: [0, 0, 16 * D], shoulder_R: [0, 0, -16 * D], forearm_L: [-10 * D, 0, 0], forearm_R: [-10 * D, 0, 0], thigh_L: [0, 0, 5 * D], thigh_R: [0, 0, -5 * D], foot_L: [0, 0, -5 * D], foot_R: [0, 0, 5 * D] };
  const plumbBare = { weapons: [{ kind: 'bufferKite', bone: 'shield_L' }] };
  c.view(v1.querySelector('.view'), (scene, aspect) => {
    c.lights(scene); K.setInk(null);
    const f = c.frame('plumb', aPose, plumbBare); scene.add(f); c.shadow(scene, 0, 0, 2.4);
    return c.fitOrtho(f, aspect, { dir: [0.45, 0.12, 1], pad: 1.08 });
  });
  c.view(v2.querySelector('.view'), (scene, aspect) => {
    const f = c.frame('plumb', aPose, plumbBare);
    K.ghost(f, 0.2); scene.add(f);
    scene.add(K.skeletonOverlay(f, '#ff4f7a'));
    return c.fitOrtho(f, aspect, { dir: [0.45, 0.12, 1], pad: 1.08 });
  });
  c.view(v3.querySelector('.view'), (scene, aspect) => {
    const f = c.frame('plumb', aPose, plumbBare);
    K.ghost(f, 0.05); scene.add(f);
    scene.add(K.skeletonOverlay(f, '#74f6e2'));
    const B = f.userData.bones;
    const labels = [];
    const show = [['head', 18, -8], ['chest', 36, -6], ['hatch', -40, 4], ['spine', 34, 0], ['hips', -36, -4], ['shoulder_L', 40, -14], ['forearm_L', 44, 0], ['hand_L', 40, 6], ['shoulder_R', -44, -14], ['forearm_R', -46, 0], ['hand_R', -40, 6], ['thigh_L', 38, -4], ['shin_L', 36, 0], ['foot_L', 36, 0], ['thigh_R', -40, -4], ['shin_R', -38, 0], ['toe_R', -34, 10], ['crest', 30, -12], ['backpack', 44, -18]];
    f.updateMatrixWorld(true);
    for (const [n, dx, dy] of show) {
      const p = new THREE.Vector3().setFromMatrixPosition(B[n].matrixWorld);
      labels.push({ p: p.toArray(), html: `<span class="mono" style="color:#74f6e2;font-size:13px;text-shadow:0 0 3px #12151c,0 0 5px #12151c">${n}</span>`, dx: dx - 30, dy: dy - 8, cls: '' });
    }
    return { camera: c.fitOrtho(f, aspect, { dir: [0.45, 0.12, 1], pad: 1.08 }), labels };
  });

  // Walk cycle.
  const walk = c.h(`<div class="panel over" style="margin-top:22px;padding:0;height:360px"><div class="lbl">Walk cycle · Gimlet · 8 keys · heavy gait (long contact, short flight)</div><div class="view" style="position:absolute;inset:0"></div></div>`);
  c.host.append(walk);
  c.view(walk.querySelector('.view'), (scene, aspect) => {
    c.lights(scene, { dir: [-2, 6, 6] }); K.setInk(0.04);
    const g = new THREE.Group(); const labels = [];
    for (let i = 0; i < 8; i++) {
      const f = c.frame('gimlet', K.walkPose(i / 8), { weapons: [] });
      f.position.z = i * 5.4; g.add(f);
      labels.push({ p: [0, 0, i * 5.4], html: `<span class="mono">${i}/8</span>`, center: true, dy: 6 });
    }
    scene.add(g);
    const ink = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 50), new THREE.MeshBasicMaterial({ color: 0x17181d })); ink.position.set(0, 0, 19); scene.add(ink);
    const box = new THREE.Box3().setFromObject(g); box.min.y -= 0.8; box.max.y += 0.3;
    return { camera: c.fitOrtho(g, aspect, { dir: [-1, 0.08, 0.001], pad: 1.04, box }), labels };
  });

  // Pose library.
  const poses = [['aim', 'plumb', 'aim'], ['heavy', 'chisel', 'heavy'], ['guard', 'maul', 'guard'], ['drive', 'piledriver', 'drive'], ['Lid cast', 'bellows', 'cast'], ['space boost', 'gimlet', 'space'], ['kneel · "knelt"', 'plumb', 'kneel'], ['stand down', 'plumb', 'standDown']];
  const lib = c.h(`<div class="grid over" style="grid-template-columns:repeat(8,1fr);gap:14px;margin-top:22px"></div>`);
  for (const [name, id, pose] of poses) {
    const card = c.h(`<div class="card"><div class="view" style="height:300px"></div><div class="body" style="padding:8px 10px"><h3 style="font-size:20px">${name}</h3><div class="role" style="margin:0">${id}</div></div></div>`);
    lib.append(card);
    c.view(card.querySelector('.view'), (scene, aspect) => {
      c.lights(scene); K.setInk(null);
      const f = c.frame(id, pose);
      if (pose === 'space') { f.position.y += 1.5; f.rotation.x = 0.35; }
      scene.add(f); if (pose !== 'space') c.shadow(scene, 0, 0, K.byId[id].height * 0.28);
      return c.fitOrtho(f, aspect, { dir: pose === 'drive' ? [1, 0.2, 0.5] : [0.6, 0.18, 1], pad: 1.12 });
    });
  }
  c.host.append(lib);

  const bottom = c.h(`<div class="grid over" style="grid-template-columns:1.2fr 1fr;margin-top:22px"></div>`);
  const clips = [
    ['idle', 'loop', 'hydraulic sway; skirts settle; visor scan'],
    ['walk / run', 'loop', 'heel-strike camera shake scaled by Stature (I: none, V: heavy)'],
    ['skate-dash', 'loop', 'Shunters: rollers down, low crouch, sparks'],
    ['jump · land', 'one-shot', 'knee compress, skirt bounce, dust ring'],
    ['space boost', 'loop', 'legs trail, jets vector; additive steering lean'],
    ['aim', 'additive', 'spine + arm IK to target; head leads by 0.1 s'],
    ['fire', 'per weapon', 'recoil through forearm → chest; Knocker coils glow in sequence'],
    ['melee', 'one-shot', 'maul swing, chisel slash, piledriver thrust + recoil'],
    ['shield raise · Lid cast', 'one-shot', 'Buffer up; Bellows arms spread, dishes lift'],
    ['couple', 'loop', 'magnet-walk on a hull; foot IK on the hull grid'],
    ['hit-react · stagger', 'additive', 'directional; pauldrons and skirts take the spring'],
    ['kneel', 'one-shot', 'disabled, pilot alive: one knee down, weapon grounded'],
    ['stand down', 'one-shot', 'pilot dead: frame straightens, head bows, visor goes dark. No ragdoll.'],
  ];
  bottom.append(c.h(`<div class="panel"><div class="lbl">Clip list</div>
    <table class="t" style="margin-top:14px"><tr><th>Clip</th><th>Kind</th><th>Notes</th></tr>
    ${clips.map(([a, b2, n]) => `<tr><td><b>${a}</b></td><td class="mono">${b2}</td><td class="small">${n}</td></tr>`).join('')}</table></div>`));
  bottom.append(c.h(`<div class="panel dark"><div class="lbl r">Signature</div>
    <h2 style="margin-top:16px">Kessen frames never fall over</h2>
    <p>When a pilot dies, the heartcase locks every joint. The frame straightens, grounds its weapon, bows its head, and the visor goes dark. In space it drifts upright.</p>
    <p>That is the <b>stand-down</b> pose, the same pose as the 190,000 frames on the Standing Field. Other factions explode or tumble; a Kessen kill leaves a statue.</p>
    <p class="dim small">A disabled frame with a living pilot <b>kneels</b> instead. Gangs walk knelt frames home over the Loom. Nobody is carried.</p>
    <h3 style="margin-top:18px">In the engine</h3>
    <p class="small dim">A <span class="mono">FrameKit</span> beside <span class="mono">HullKit</span>/<span class="mono">ShipBuilder</span> builds rigid parts per bone. Bone palettes go in a texture;
    parts are instanced per Stature under WebGPU; pistons and foot IK are solved in a compute pass. There is no <span class="mono">SkinnedMesh</span> anywhere in
    <span class="mono">src/</span> yet, so this is a new path.</p></div>`));
  c.host.append(bottom);
  footer(c, 'Every figure on this sheet is the prototype rig posed live (scripts/concepts/kessen/mechkit.js), not a drawing.');
}
