// Kessen frame kit — concept prototype.
//
// Every frame is a real bone hierarchy (Object3D per bone) with rigid,
// chamfered armour parts bound 100% to one bone each, the way the in-game
// version would skin them (rigid-part skinning: cheap, and correct for plate
// armour). Pistons are solved after posing. Everything is built at a
// canonical ~8 m scale and the root is scaled to the stature's height.
import * as THREE from 'three';

export const LIVERY = {
  primary: '#5d6875', // gunmetal slate
  secondary: '#ddd3bd', // bone plate
  dark: '#2a2f37', // iron frame
  accent: '#d63a2c', // railway-signal red
  metal: '#8d959f',
  glow: '#74f6e2', // Loom teal
  hazard: '#e8b42a',
  ink: '#15161b',
};

const CANON = 8; // canonical build height in metres

// ── materials ──────────────────────────────────────────────────────────
let gradient;
function toonGradient() {
  if (gradient) return gradient;
  const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}
const matCache = new Map();
export function toon(color) {
  const k = 't' + color;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }));
  return matCache.get(k);
}
export function glowMat(color = LIVERY.glow, opacity = 1) {
  const k = 'g' + color + opacity;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
  return matCache.get(k);
}
const inkMat = new THREE.MeshBasicMaterial({ color: LIVERY.ink, side: THREE.BackSide });

// ── geometry ───────────────────────────────────────────────────────────
function chamferShape(w, h, c) {
  const s = new THREE.Shape();
  const x = w / 2, y = h / 2;
  c = Math.min(c, x * 0.45, y * 0.45);
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c);
  s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  return s;
}
function trapShape(wt, wb, h, c) {
  const s = new THREE.Shape();
  const y = h / 2;
  c = Math.min(c, Math.min(wt, wb) * 0.2, y * 0.4);
  s.moveTo(-wb / 2 + c, -y); s.lineTo(wb / 2 - c, -y); s.lineTo(wb / 2, -y + c); s.lineTo(wt / 2, y - c);
  s.lineTo(wt / 2 - c, y); s.lineTo(-wt / 2 + c, y); s.lineTo(-wt / 2, y - c); s.lineTo(-wb / 2, -y + c); s.closePath();
  return s;
}
function extrude(shape, d, c) {
  const bev = Math.min(c * 0.6, d * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(d - 2 * bev, 0.001), bevelEnabled: bev > 0.001, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 1 });
  g.center();
  return g;
}
const G = {
  box: (w, h, d, c = 0.08) => extrude(chamferShape(w, h, c), d, c),
  trap: (wt, wb, h, d, c = 0.08) => extrude(trapShape(wt, wb, h, c), d, c),
  cyl: (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg),
  sphere: (r) => new THREE.IcosahedronGeometry(r, 1),
  plane: (w, h) => new THREE.PlaneGeometry(w, h),
};

let OUTLINE = 0.05; // canonical metres (set per frame from INK_WORLD)
let INK_WORLD = null; // world-space ink thickness in metres; null = 0.7 % of frame height
export function setInk(metresWorld) { INK_WORLD = metresWorld; }

/** Add a part to a bone. opts: pos, rot, paint (livery key or hex), glow, noInk. */
function part(parent, geo, opts = {}) {
  const color = opts.color ?? LIVERY[opts.paint ?? 'primary'];
  const mesh = new THREE.Mesh(geo, opts.glow ? glowMat(opts.glowColor ?? LIVERY.glow, opts.opacity ?? 1) : toon(color));
  if (opts.pos) mesh.position.set(...opts.pos);
  if (opts.rot) mesh.rotation.set(...opts.rot);
  if (opts.scale) mesh.scale.set(...opts.scale);
  parent.add(mesh);
  if (!opts.glow && !opts.noInk) {
    geo.computeBoundingBox();
    const b = geo.boundingBox, sz = new THREE.Vector3(); b.getSize(sz);
    const t = opts.ink ?? OUTLINE;
    const ink = new THREE.Mesh(geo, inkMat);
    ink.scale.set(1 + (2 * t) / Math.max(sz.x, 0.01), 1 + (2 * t) / Math.max(sz.y, 0.01), 1 + (2 * t) / Math.max(sz.z, 0.01));
    mesh.add(ink);
  }
  return mesh;
}

// Stencil / hazard decals (canvas textures on thin planes).
const texCache = new Map();
function stencilTex(text, color = LIVERY.accent, bg = null) {
  const k = text + color + bg;
  if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 256, 128); }
  x.fillStyle = color; x.font = '700 78px "Oswald", "DejaVu Sans Condensed", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(k, t); return t;
}
function hazardTex() {
  if (texCache.has('hz')) return texCache.get('hz');
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const x = c.getContext('2d'); x.fillStyle = LIVERY.hazard; x.fillRect(0, 0, 128, 32);
  x.fillStyle = LIVERY.ink;
  for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, 32); x.lineTo(i * 16 + 8, 32); x.lineTo(i * 16 + 24, 0); x.lineTo(i * 16 + 16, 0); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set('hz', t); return t;
}
function decal(parent, tex, w, h, pos, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(G.plane(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(...pos); m.rotation.set(...rot); parent.add(m); return m;
}

// ── body plans ─────────────────────────────────────────────────────────
// Canonical proportions per stature (built ~8 m tall, then scaled).
export const PLANS = {
  fettler: { legK: 0.92, armK: 1.0, bulk: 1.3, chestK: 1.15, shW: 1.2, headK: 1.35, hipW: 0.62, head: 'fettler', pauldron: 'round', feet: 'block', pack: 'small' },
  shunter: { legK: 1.12, armK: 1.02, bulk: 0.92, chestK: 0.95, shW: 1.18, headK: 1.0, hipW: 0.58, head: 'mono', pauldron: 'round', feet: 'skate', pack: 'jets' },
  linesman: { legK: 1.02, armK: 1.02, bulk: 1.0, chestK: 1.1, shW: 1.35, headK: 0.95, hipW: 0.62, head: 'visor', pauldron: 'block', feet: 'block', pack: 'jets' },
  derrick: { legK: 0.86, armK: 1.05, bulk: 1.38, chestK: 1.38, shW: 1.62, headK: 0.85, hipW: 0.78, head: 'hood', pauldron: 'block', feet: 'wide', pack: 'bigjets' },
  gantry: { legK: 1.02, armK: 1.08, bulk: 1.25, chestK: 1.42, shW: 1.78, headK: 0.9, hipW: 0.76, head: 'crest', pauldron: 'tall', feet: 'wide', pack: 'crane' },
};

// ── the rig ────────────────────────────────────────────────────────────
export const BONE_TREE = [
  ['root', null], ['hips', 'root'], ['skirt_F', 'hips'], ['skirt_B', 'hips'], ['skirt_L', 'hips'], ['skirt_R', 'hips'],
  ['thigh_L', 'hips'], ['shin_L', 'thigh_L'], ['foot_L', 'shin_L'], ['toe_L', 'foot_L'],
  ['thigh_R', 'hips'], ['shin_R', 'thigh_R'], ['foot_R', 'shin_R'], ['toe_R', 'foot_R'],
  ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'], ['crest', 'head'], ['hatch', 'chest'],
  ['shoulder_L', 'chest'], ['pauldron_L', 'shoulder_L'], ['upperarm_L', 'shoulder_L'], ['forearm_L', 'upperarm_L'], ['hand_L', 'forearm_L'], ['fingers_L', 'hand_L'], ['thumb_L', 'hand_L'],
  ['shoulder_R', 'chest'], ['pauldron_R', 'shoulder_R'], ['upperarm_R', 'shoulder_R'], ['forearm_R', 'upperarm_R'], ['hand_R', 'forearm_R'], ['fingers_R', 'hand_R'], ['thumb_R', 'hand_R'],
  ['backpack', 'chest'], ['jet_L', 'backpack'], ['jet_R', 'backpack'], ['mount_L', 'chest'], ['mount_R', 'chest'],
  ['weapon_R', 'hand_R'], ['weapon_L', 'hand_L'], ['shield_L', 'forearm_L'],
];

export function buildFrame(v) {
  const P = { ...PLANS[v.plan], ...(v.planOverride ?? {}) };
  const b = P.bulk, lk = P.legK, ak = P.armK, ck = P.chestK;
  OUTLINE = (v.ink ?? INK_WORLD ?? 0.007 * v.height) / (v.height / CANON);
  const bones = {};
  for (const [name, parent] of BONE_TREE) {
    const o = new THREE.Group(); o.name = name; bones[name] = o;
    if (parent) bones[parent].add(o);
  }
  // Joint layout (canonical metres).
  const ankle = 0.55, shin = 2.0 * lk, thigh = 1.8 * lk;
  const hipY = ankle + shin + thigh;
  const uArm = 1.45 * ak, fArm = 1.5 * ak;
  bones.hips.position.set(0, hipY, 0);
  bones.thigh_L.position.set(P.hipW, -0.15, 0); bones.thigh_R.position.set(-P.hipW, -0.15, 0);
  for (const s of ['L', 'R']) {
    bones['shin_' + s].position.set(0, -thigh, 0);
    bones['foot_' + s].position.set(0, -shin, 0);
    bones['toe_' + s].position.set(0, -ankle + 0.15, 0.75);
  }
  bones.skirt_F.position.set(0, -0.05, 0.5 * b); bones.skirt_B.position.set(0, 0, -0.5 * b);
  bones.skirt_L.position.set(0.75 * b, 0, 0); bones.skirt_R.position.set(-0.75 * b, 0, 0);
  bones.spine.position.set(0, 0.35, 0);
  bones.chest.position.set(0, 0.55, 0);
  bones.neck.position.set(0, 1.55, 0.05);
  bones.head.position.set(0, 0.28, 0);
  bones.crest.position.set(0, 0.55 * P.headK, 0);
  bones.hatch.position.set(0, 0.75, 0.62 * b);
  bones.shoulder_L.position.set(P.shW, 1.2, 0); bones.shoulder_R.position.set(-P.shW, 1.2, 0);
  for (const s of ['L', 'R']) {
    bones['upperarm_' + s].position.set(0, -0.05, 0);
    bones['forearm_' + s].position.set(0, -uArm, 0);
    bones['hand_' + s].position.set(0, -fArm, 0);
    bones['fingers_' + s].position.set(0, -0.48, 0.05);
    bones['thumb_' + s].position.set(s === 'L' ? -0.2 : 0.2, -0.2, 0.22);
    bones['weapon_' + s].position.set(0, -0.3, 0.05);
    bones['pauldron_' + s].position.set(s === 'L' ? 0.12 : -0.12, 0.12, 0);
  }
  bones.shield_L.position.set(0.5 * b, -fArm * 0.5, 0);
  bones.backpack.position.set(0, 0.85, -0.72 * b);
  bones.jet_L.position.set(0.45, -0.55, -0.15); bones.jet_R.position.set(-0.45, -0.55, -0.15);
  bones.mount_L.position.set(P.shW * 0.72, 1.62, -0.35); bones.mount_R.position.set(-P.shW * 0.72, 1.62, -0.35);

  const L = v.livery ?? {};
  const pp = L.primary ? { color: L.primary } : { paint: 'primary' };
  const ps = L.secondary ? { color: L.secondary } : { paint: 'secondary' };

  // Pelvis + skirts.
  part(bones.hips, G.box(1.35 * b, 0.75, 0.95 * b, 0.12), { paint: 'dark' });
  part(bones.hips, G.trap(0.55 * b, 0.3 * b, 0.5, 0.7 * b), { ...pp, pos: [0, -0.45, 0.08] });
  part(bones.skirt_F, G.trap(0.95 * b, 0.75 * b, 0.85, 0.14, 0.1), { ...pp, pos: [0, -0.35, 0.05] });
  part(bones.skirt_B, G.trap(1.1 * b, 0.9 * b, 0.8, 0.14, 0.1), { ...pp, pos: [0, -0.3, -0.05] });
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    part(bones['skirt_' + s], G.trap(0.8 * b, 0.95 * b, 0.95, 0.14, 0.1), { ...ps, pos: [0.08 * sx, -0.4, 0], rot: [0, Math.PI / 2, 0] });
  }
  if (v.stature <= 2) decal(bones.skirt_F, hazardTex(), 0.8 * b, 0.18, [0, -0.66, 0.13]);

  // Legs.
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const T = bones['thigh_' + s], S = bones['shin_' + s], F = bones['foot_' + s], O = bones['toe_' + s];
    part(T, G.sphere(0.38 * b), { paint: 'dark' });
    part(T, G.box(0.72 * b, thigh * 0.85, 0.82 * b, 0.1), { ...pp, pos: [0, -thigh * 0.5, 0] });
    part(T, G.box(0.5 * b, thigh * 0.4, 0.3, 0.06), { paint: 'dark', pos: [0.2 * sx * b, -thigh * 0.55, 0.3 * b] });
    part(S, G.cyl(0.32 * b, 0.32 * b, 0.7 * b, 10), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    part(S, G.box(0.95 * b, shin * 0.92, 1.05 * b, 0.14), { ...ps, pos: [0, -shin * 0.52, 0.02] });
    part(S, G.trap(0.62 * b, 0.45 * b, 0.62, 0.3, 0.08), { paint: 'accent', pos: [0, 0.02, 0.48 * b], rot: [-0.25, 0, 0] });
    part(S, G.box(0.55 * b, shin * 0.45, 0.35, 0.08), { paint: 'dark', pos: [0, -shin * 0.45, -0.55 * b] }); // calf vent
    part(S, G.box(0.38 * b, 0.1, 0.1, 0.02), { glow: true, pos: [0, -shin * 0.62, -0.74 * b] });
    decal(S, stencilTex(v.stencilLeg ?? `${roman(v.stature)}`, LIVERY.accent), 0.62 * b, 0.31 * b, [0, -shin * 0.62, 0.55 * b + 0.01]);
    part(F, G.cyl(0.26 * b, 0.26 * b, 0.6 * b, 8), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    const fw = P.feet === 'wide' ? 1.15 : 0.95;
    part(F, G.trap(0.8 * b * fw, 1.0 * b * fw, ankle * 1.05, 1.35, 0.1), { ...pp, pos: [0, -ankle * 0.55, 0.05], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] });
    part(O, G.trap(0.8 * b * fw, 0.95 * b * fw, 0.5, 0.35, 0.08), { paint: 'dark', pos: [0, -0.08, 0.2], rot: [-Math.PI / 2, 0, 0] });
    part(F, G.box(0.7 * b * fw, 0.35, 0.4, 0.06), { paint: 'dark', pos: [0, -ankle * 0.7, -0.75] });
    if (P.feet === 'skate') {
      for (const z of [-0.45, 0.35]) part(F, G.cyl(0.2, 0.2, 0.5 * b, 10), { paint: 'metal', pos: [0, -ankle - 0.05, z], rot: [0, 0, Math.PI / 2] });
    }
  }

  // Waist + torso.
  part(bones.spine, G.cyl(0.5 * b, 0.62 * b, 0.62, 10), { paint: 'dark', pos: [0, 0.2, 0] });
  const chestW = 2.0 * ck, chestD = 1.3 * b;
  part(bones.chest, G.trap(chestW, chestW * 0.72, 1.45, chestD, 0.18), { ...pp, pos: [0, 0.78, 0] });
  part(bones.chest, G.box(chestW * 0.62, 0.45, chestD * 0.9, 0.1), { paint: 'dark', pos: [0, 0.05, 0] });
  part(bones.chest, G.box(chestW * 0.9, 0.35, chestD * 0.85, 0.1), { paint: 'dark', pos: [0, 1.52, -0.05] }); // collar
  // Heartcase hatch (cockpit): bone plates, red frame.
  part(bones.hatch, G.trap(chestW * 0.52, chestW * 0.38, 0.95, 0.22, 0.1), { ...ps, pos: [0, 0.02, 0.05] });
  part(bones.hatch, G.box(chestW * 0.2, 0.12, 0.1, 0.02), { glow: true, pos: [0, 0.3, 0.18] });
  for (const sx of [1, -1]) part(bones.chest, G.trap(0.45 * ck, 0.3 * ck, 0.9, 0.3, 0.06), { paint: 'accent', pos: [sx * chestW * 0.38, 1.0, chestD * 0.5], rot: [0.12, 0, 0] });
  decal(bones.chest, stencilTex(v.stencilChest ?? v.code, LIVERY.ink), 0.55 * ck, 0.27 * ck, [chestW * 0.3, 0.45, chestD * 0.5 + 0.01]);

  // Head.
  buildHead(bones, P, v, pp, ps);

  // Arms.
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const Sh = bones['shoulder_' + s], U = bones['upperarm_' + s], Fa = bones['forearm_' + s], H = bones['hand_' + s];
    part(Sh, G.sphere(0.42 * b), { paint: 'dark' });
    buildPauldron(bones['pauldron_' + s], P, v, sx, ps, pp);
    part(U, G.box(0.58 * b, uArm * 0.8, 0.62 * b, 0.08), { paint: 'dark', pos: [0, -uArm * 0.5, 0] });
    part(U, G.box(0.66 * b, uArm * 0.45, 0.7 * b, 0.1), { ...pp, pos: [0, -uArm * 0.38, 0] });
    part(Fa, G.cyl(0.3 * b, 0.3 * b, 0.62 * b, 10), { paint: 'dark', rot: [0, 0, Math.PI / 2] });
    part(Fa, G.box(0.78 * b, fArm * 0.88, 0.82 * b, 0.12), { ...ps, pos: [0, -fArm * 0.52, 0] });
    part(Fa, G.box(0.25, fArm * 0.5, 0.6 * b, 0.05), { paint: 'accent', pos: [0.42 * b * sx, -fArm * 0.45, 0] });
    part(H, G.box(0.46 * b, 0.5, 0.55 * b, 0.06), { paint: 'dark', pos: [0, -0.22, 0] });
    part(bones['fingers_' + s], G.box(0.44 * b, 0.4, 0.48 * b, 0.06), { paint: 'dark', pos: [0, -0.18, -0.02] });
    part(bones['thumb_' + s], G.box(0.16, 0.34, 0.16, 0.03), { paint: 'dark', pos: [0, -0.14, 0] });
  }

  // Backpack.
  buildPack(bones, P, v, pp);

  // Pistons (solved after posing): thigh→shin and upperarm→forearm.
  const pistons = [];
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    pistons.push(piston(bones, 'thigh_' + s, [0.46 * b * sx, -thigh * 0.25, -0.2], 'shin_' + s, [0.5 * b * sx, -shin * 0.35, -0.2], 0.09 * b));
    pistons.push(piston(bones, 'upperarm_' + s, [0, -uArm * 0.2, -0.38 * b], 'forearm_' + s, [0, -fArm * 0.35, -0.45 * b], 0.07 * b));
  }

  // Weapons + mounts.
  for (const w of v.weapons ?? []) WEAPONS[w.kind](bones[w.bone], w, b);

  const root = bones.root;
  const scale = v.height / CANON;
  root.scale.setScalar(scale);
  root.userData = { bones, pistons, variant: v, scale, hipY };
  return root;
}

function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V'][n]; }

function buildHead(bones, P, v, pp, ps) {
  const h = bones.head, k = P.headK;
  part(bones.neck, G.cyl(0.26, 0.32, 0.4, 8), { paint: 'dark', pos: [0, 0.15, 0] });
  const style = v.head ?? P.head;
  if (style === 'fettler') {
    // Power-armour helm: the pilot's own head is in here.
    part(h, G.box(0.72 * k, 0.7 * k, 0.8 * k, 0.2), { ...pp, pos: [0, 0.32 * k, 0] });
    part(h, G.box(0.66 * k, 0.16 * k, 0.1, 0.03), { glow: true, pos: [0, 0.38 * k, 0.4 * k] });
    part(h, G.box(0.5 * k, 0.22 * k, 0.28, 0.05), { ...ps, pos: [0, 0.14 * k, 0.36 * k] });
    part(h, G.box(0.08, 0.5 * k, 0.08, 0.02), { paint: 'accent', pos: [0.32 * k, 0.72 * k, -0.2] });
  } else if (style === 'mono') {
    // Turret head, three-lens cluster (a Votoms nod).
    part(h, G.box(0.85 * k, 0.6 * k, 0.8 * k, 0.12), { ...pp, pos: [0, 0.3 * k, 0] });
    part(h, G.cyl(0.24 * k, 0.24 * k, 0.3, 10), { paint: 'dark', pos: [0, 0.32 * k, 0.45 * k], rot: [Math.PI / 2, 0, 0] });
    for (const [x, y, r] of [[0, 0.36, 0.13], [-0.14, 0.24, 0.07], [0.15, 0.24, 0.06]]) part(h, G.cyl(r * k, r * k, 0.08, 10), { glow: true, pos: [x * k, y * k, 0.61 * k], rot: [Math.PI / 2, 0, 0] });
    part(h, G.box(0.06, 0.55 * k, 0.06, 0.01), { paint: 'metal', pos: [-0.35 * k, 0.75 * k, -0.2] });
  } else if (style === 'visor' || style === 'crest') {
    part(h, G.trap(0.7 * k, 0.85 * k, 0.62 * k, 0.85 * k, 0.12), { ...pp, pos: [0, 0.3 * k, 0] });
    part(h, G.trap(0.62 * k, 0.5 * k, 0.12 * k, 0.1, 0.02), { glow: true, pos: [0, 0.38 * k, 0.43 * k] });
    part(h, G.trap(0.42 * k, 0.28 * k, 0.26 * k, 0.28, 0.05), { ...ps, pos: [0, 0.1 * k, 0.4 * k] }); // chin
    for (const sx of [1, -1]) part(h, G.box(0.14, 0.4 * k, 0.5 * k, 0.03), { paint: 'dark', pos: [sx * 0.45 * k, 0.28 * k, 0] }); // ear blocks
    if (style === 'crest') {
      // Semaphore-arm crest: a railway signal arm that the commander raises.
      part(bones.crest, G.box(0.1, 0.5, 0.1, 0.02), { paint: 'dark', pos: [0.12, 0.1, -0.15] });
      part(bones.crest, G.box(1.3 * k, 0.18, 0.08, 0.04), { paint: 'accent', pos: [0.62 * k, 0.32, -0.15] });
      part(bones.crest, G.box(0.1, 0.19, 0.09, 0.02), { paint: 'secondary', pos: [1.0 * k, 0.32, -0.15] });
      part(bones.crest, G.cyl(0.08, 0.08, 0.06, 10), { glow: true, glowColor: '#ff5a3d', pos: [0.12, 0.32, -0.08], rot: [Math.PI / 2, 0, 0] });
    } else {
      part(bones.crest, G.box(0.06, 0.45, 0.06, 0.01), { paint: 'metal', pos: [0.3 * k, 0.05, -0.25] });
    }
  } else if (style === 'hood') {
    // Derrick: head sunk between the shoulders under a hood.
    bones.neck.position.y -= 0.25;
    part(h, G.trap(1.0 * k, 1.1 * k, 0.55 * k, 0.9 * k, 0.15), { ...pp, pos: [0, 0.28 * k, 0] });
    part(h, G.box(0.8 * k, 0.1 * k, 0.1, 0.02), { glow: true, pos: [0, 0.22 * k, 0.46 * k] });
    part(h, G.trap(1.2 * k, 1.1 * k, 0.2, 1.1 * k, 0.05), { ...ps, pos: [0, 0.6 * k, -0.05] });
  } else if (style === 'sensor') {
    // Gauge: long sensor head with a raised rangefinder crest.
    part(h, G.box(0.62 * k, 0.5 * k, 1.1 * k, 0.12), { ...pp, pos: [0, 0.3 * k, 0.05] });
    part(h, G.box(0.5 * k, 0.1 * k, 0.1, 0.02), { glow: true, pos: [0, 0.34 * k, 0.61 * k] });
    part(bones.crest, G.box(0.9 * k, 0.22, 0.3, 0.05), { paint: 'dark', pos: [0, -0.05, -0.1] });
    for (const sx of [1, -1]) part(bones.crest, G.cyl(0.1, 0.1, 0.12, 10), { glow: true, pos: [sx * 0.42 * k, -0.05, 0.08], rot: [Math.PI / 2, 0, 0] });
  }
}

function buildPauldron(pb, P, v, sx, ps, pp) {
  const b = P.bulk, style = v.pauldron ?? P.pauldron;
  if (style === 'none') return;
  if (style === 'round') {
    part(pb, G.cyl(0.62 * b, 0.7 * b, 0.9 * b, 10), { ...ps, pos: [0.15 * sx, 0.05, 0], rot: [0, 0, 0] });
    part(pb, G.box(0.2, 0.2, 0.9 * b, 0.03), { paint: 'accent', pos: [0.62 * b * sx, 0.05, 0] });
  } else if (style === 'block') {
    part(pb, G.trap(1.15 * b, 1.4 * b, 1.05, 1.3 * b, 0.14), { ...ps, pos: [0.3 * sx, 0.1, 0], rot: [0, 0, -0.18 * sx] });
    part(pb, G.box(0.3, 0.9, 1.1 * b, 0.05), { paint: 'accent', pos: [0.95 * b * sx, -0.05, 0], rot: [0, 0, -0.18 * sx] });
    decal(pb, stencilTex(v.stencil ?? v.code, LIVERY.accent), 0.8 * b, 0.4 * b, [0.3 * sx, 0.1, 0.66 * b], [0, 0, 0]);
  } else if (style === 'tall') {
    part(pb, G.trap(1.3 * b, 1.6 * b, 1.6, 1.5 * b, 0.18), { ...ps, pos: [0.4 * sx, 0.3, 0], rot: [0, 0, -0.12 * sx] });
    part(pb, G.box(0.9 * b, 0.35, 1.2 * b, 0.06), { paint: 'dark', pos: [0.4 * sx, 1.15, 0] });
    for (const z of [-0.35, 0, 0.35]) part(pb, G.box(0.7 * b, 0.07, 0.12, 0.01), { glow: true, pos: [0.4 * sx, 1.33, z * b] });
    part(pb, G.box(0.32, 1.3, 1.25 * b, 0.05), { paint: 'accent', pos: [1.08 * b * sx, 0.2, 0], rot: [0, 0, -0.12 * sx] });
    decal(pb, stencilTex(v.stencil ?? v.code, LIVERY.accent), 0.95 * b, 0.48 * b, [0.4 * sx, 0.3, 0.76 * b]);
  }
}

function buildPack(bones, P, v, pp) {
  const bp = bones.backpack, style = v.pack ?? P.pack, b = P.bulk;
  if (style === 'small') {
    part(bp, G.box(1.3, 1.1, 0.55, 0.1), { ...pp });
    part(bp, G.box(0.9, 0.12, 0.1, 0.02), { glow: true, pos: [0, -0.35, -0.3] });
  } else {
    const big = style === 'bigjets' || style === 'crane';
    part(bp, G.box(big ? 1.9 : 1.5, big ? 1.5 : 1.3, 0.75, 0.14), { ...pp });
    for (const s of ['L', 'R']) {
      const j = bones['jet_' + s];
      part(j, G.cyl(0.26 * (big ? 1.3 : 1), 0.36 * (big ? 1.3 : 1), 0.7, 10), { paint: 'dark', pos: [0, -0.1, -0.2] });
      part(j, G.cyl(0.24 * (big ? 1.3 : 1), 0.24 * (big ? 1.3 : 1), 0.05, 10), { glow: true, pos: [0, -0.46, -0.2] });
    }
    if (style === 'crane') {
      // A folded works-crane boom on the back: the Gantry's namesake.
      part(bp, G.box(0.35, 3.2, 0.35, 0.05), { paint: 'hazard', color: LIVERY.hazard, pos: [0.55, 1.4, -0.3], rot: [0, 0, -0.08] });
      part(bp, G.box(0.35, 3.2, 0.35, 0.05), { paint: 'hazard', color: LIVERY.hazard, pos: [-0.55, 1.4, -0.3], rot: [0, 0, 0.08] });
      part(bp, G.box(1.5, 0.3, 0.4, 0.05), { paint: 'dark', pos: [0, 2.95, -0.3] });
      part(bp, G.cyl(0.12, 0.12, 0.4, 8), { glow: true, glowColor: '#ff5a3d', pos: [0, 3.2, -0.3] });
    }
  }
}

function piston(bones, a, la, bName, lb, r) {
  const g = new THREE.Group();
  const sleeve = part(g, G.cyl(r, r, 1, 8), { paint: 'metal', ink: OUTLINE * 0.6 });
  const rod = part(g, G.cyl(r * 0.55, r * 0.55, 1, 8), { color: '#c9ced4', ink: OUTLINE * 0.6 });
  bones.root.add(g);
  return { g, sleeve, rod, a: bones[a], la: new THREE.Vector3(...la), b: bones[bName], lb: new THREE.Vector3(...lb) };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** Re-solve pistons after posing (they live in root space). */
export function solve(root) {
  root.updateMatrixWorld(true);
  for (const p of root.userData.pistons) {
    _a.copy(p.la).applyMatrix4(p.a.matrixWorld); _b.copy(p.lb).applyMatrix4(p.b.matrixWorld);
    root.worldToLocal(_a); root.worldToLocal(_b);
    _d.subVectors(_b, _a); const len = _d.length(); _d.normalize();
    p.g.position.copy(_a); p.g.quaternion.setFromUnitVectors(_up, _d);
    p.sleeve.scale.set(1, len * 0.6, 1); p.sleeve.position.set(0, len * 0.3, 0);
    p.rod.scale.set(1, len * 0.6, 1); p.rod.position.set(0, len * 0.7, 0);
  }
  root.updateMatrixWorld(true);
}

// ── weapons ────────────────────────────────────────────────────────────
// Each attaches to a socket bone. Long guns lie along the hand's -Y (the
// forearm direction), grip at the socket.
export const WEAPONS = {
  scribeRifle(bone) { // laser rifle
    const g = bone;
    part(g, G.box(0.36, 2.2, 0.55, 0.06), { paint: 'dark', pos: [0, -0.7, 0.25] });
    part(g, G.box(0.22, 1.6, 0.26, 0.04), { paint: 'metal', pos: [0, -2.4, 0.3] });
    part(g, G.cyl(0.16, 0.16, 0.2, 10), { glow: true, pos: [0, -3.25, 0.3] });
    part(g, G.box(0.3, 0.5, 0.25, 0.04), { paint: 'secondary', pos: [0, -0.5, 0.62] }); // optic
    part(g, G.box(0.3, 0.9, 0.35, 0.05), { paint: 'dark', pos: [0, 0.6, 0.2] }); // stock
    part(g, G.box(0.1, 0.8, 0.1, 0.02), { glow: true, pos: [0.19, -1.2, 0.25] });
  },
  knockerCarbine(bone) { // pulse carbine
    part(bone, G.box(0.34, 1.5, 0.5, 0.06), { paint: 'dark', pos: [0, -0.5, 0.25] });
    for (let i = 0; i < 3; i++) part(bone, G.cyl(0.24, 0.24, 0.14, 10), { paint: 'accent', pos: [0, -1.35 - i * 0.28, 0.3] });
    part(bone, G.cyl(0.13, 0.13, 1.0, 8), { paint: 'metal', pos: [0, -1.65, 0.3] });
    part(bone, G.cyl(0.15, 0.15, 0.08, 10), { glow: true, pos: [0, -2.2, 0.3] });
    part(bone, G.box(0.28, 0.5, 0.4, 0.05), { paint: 'dark', pos: [0, -0.35, 0.75] }); // mag
  },
  knockerPistol(bone) {
    part(bone, G.box(0.28, 0.9, 0.42, 0.05), { paint: 'dark', pos: [0, -0.45, 0.25] });
    part(bone, G.cyl(0.18, 0.18, 0.12, 10), { paint: 'accent', pos: [0, -0.95, 0.3] });
    part(bone, G.cyl(0.11, 0.11, 0.06, 10), { glow: true, pos: [0, -1.02, 0.3] });
  },
  knockerCannon(bone) { // heavy pulse cannon, two-handed
    part(bone, G.box(0.55, 2.4, 0.8, 0.1), { paint: 'dark', pos: [0, -0.8, 0.35] });
    for (let i = 0; i < 4; i++) part(bone, G.cyl(0.42, 0.42, 0.2, 12), { paint: 'accent', pos: [0, -2.1 - i * 0.4, 0.4] });
    part(bone, G.cyl(0.26, 0.3, 1.8, 10), { paint: 'metal', pos: [0, -2.7, 0.4] });
    part(bone, G.cyl(0.24, 0.24, 0.1, 12), { glow: true, pos: [0, -3.62, 0.4] });
    part(bone, G.box(0.5, 0.8, 0.5, 0.06), { paint: 'secondary', pos: [0, -0.6, 0.95] });
  },
  spikeDriver(bone) { // coilgun that fires iron track-spikes
    part(bone, G.box(0.42, 2.0, 0.6, 0.06), { paint: 'dark', pos: [0, -0.5, 0.25] });
    for (const x of [-0.16, 0.16]) part(bone, G.box(0.1, 3.4, 0.3, 0.02), { paint: 'metal', pos: [x, -2.8, 0.3] });
    for (let i = 0; i < 6; i++) part(bone, G.box(0.46, 0.08, 0.42, 0.02), { glow: true, pos: [0, -1.6 - i * 0.48, 0.3] });
    part(bone, G.trap(0.14, 0.02, 0.5, 0.14, 0.02), { paint: 'secondary', pos: [0, -1.4, 0.3], rot: [0, 0, Math.PI] });
    part(bone, G.box(0.3, 1.0, 0.35, 0.05), { paint: 'dark', pos: [0, 0.7, 0.2] });
    part(bone, G.box(0.3, 0.7, 0.3, 0.05), { paint: 'secondary', pos: [0, -0.6, 0.7] });
  },
  rivetGun(bone) { // stubby shaped-charge launcher with a drum
    part(bone, G.box(0.36, 1.0, 0.5, 0.06), { paint: 'dark', pos: [0, -0.45, 0.25] });
    part(bone, G.cyl(0.36, 0.36, 0.35, 10), { paint: 'hazard', color: LIVERY.hazard, pos: [0, -0.4, 0.75], rot: [0, 0, Math.PI / 2] });
    part(bone, G.cyl(0.2, 0.26, 0.6, 8), { paint: 'metal', pos: [0, -1.2, 0.3] });
  },
  scribeKnife(bone) {
    part(bone, G.box(0.18, 0.4, 0.22, 0.03), { paint: 'dark', pos: [0, -0.2, 0.2] });
    part(bone, G.trap(0.03, 0.16, 1.1, 0.05, 0.01), { glow: true, pos: [0, -0.9, 0.2], rot: [0, 0, Math.PI] });
  },
  heatChisel(bone) { // plasma-edged chisel blade
    part(bone, G.box(0.26, 0.9, 0.3, 0.04), { paint: 'dark', pos: [0, -0.3, 0.2] });
    part(bone, G.box(0.5, 0.18, 0.4, 0.04), { paint: 'accent', pos: [0, -0.8, 0.2] });
    part(bone, G.trap(0.9, 0.55, 2.4, 0.14, 0.06), { paint: 'metal', pos: [0, -2.1, 0.2], rot: [0, 0, Math.PI] });
    part(bone, G.box(0.9, 0.12, 0.16, 0.02), { glow: true, glowColor: '#ffb04a', pos: [0, -3.3, 0.2] });
  },
  maul(bone) { // kinetic hammer, pulse-charged head
    part(bone, G.cyl(0.14, 0.14, 4.2, 8), { paint: 'dark', pos: [0, -0.9, 0.2] });
    part(bone, G.box(1.8, 1.0, 1.0, 0.14), { paint: 'secondary', pos: [0, -3.1, 0.2], rot: [0, 0, Math.PI / 2] });
    for (const y of [-2.35, -3.85]) part(bone, G.box(1.1, 0.12, 1.1, 0.02), { glow: true, pos: [0, y, 0.2] });
    part(bone, G.box(1.1, 0.5, 1.05, 0.08), { paint: 'accent', pos: [0, -3.1, 0.2] });
  },
  piledriver(bone) { // forearm-mounted pile bunker (mount on forearm)
    part(bone, G.box(1.1, 3.0, 1.1, 0.15), { paint: 'dark', pos: [0, -1.0, 0.1] });
    part(bone, G.box(1.2, 1.4, 1.2, 0.12), { paint: 'hazard', color: LIVERY.hazard, pos: [0, -0.4, 0.1] });
    decal(bone, hazardTex(), 1.2, 0.3, [0, -1.25, 0.72]);
    for (let i = 0; i < 3; i++) part(bone, G.cyl(0.6, 0.6, 0.18, 12), { paint: 'accent', pos: [0, -1.6 - i * 0.35, 0.1] });
    part(bone, G.cyl(0.18, 0.18, 2.6, 8), { paint: 'metal', pos: [0, -3.1, 0.1] });
    part(bone, G.cyl(0.01, 0.2, 0.9, 8), { color: '#c9ced4', pos: [0, -4.8, 0.1], rot: [Math.PI, 0, 0] });
  },
  knellLance(bone) { // resonance lance: a tuning fork with a standing wave between the tines
    part(bone, G.cyl(0.16, 0.16, 3.4, 8), { paint: 'dark', pos: [0, -1.0, 0.2] });
    part(bone, G.box(1.1, 0.35, 0.45, 0.06), { paint: 'accent', pos: [0, -2.7, 0.2] });
    for (const x of [-0.42, 0.42]) part(bone, G.box(0.18, 3.0, 0.3, 0.04), { paint: 'secondary', pos: [x, -4.3, 0.2] });
    part(bone, G.plane(0.62, 2.8), { glow: true, glowColor: '#b9fff4', opacity: 0.55, pos: [0, -4.35, 0.2] });
    for (let i = 0; i < 5; i++) part(bone, G.box(0.66, 0.05, 0.05, 0.01), { glow: true, pos: [0, -3.2 - i * 0.55, 0.2] });
  },
  longScribe(bone) { // shoulder beam cannon (mount)
    part(bone, G.box(0.7, 0.8, 1.8, 0.1), { paint: 'dark', pos: [0, 0.2, 0] });
    part(bone, G.box(0.35, 0.35, 3.8, 0.05), { paint: 'metal', pos: [0, 0.3, 2.3] });
    part(bone, G.box(0.5, 0.5, 0.6, 0.06), { paint: 'accent', pos: [0, 0.3, 1.1] });
    part(bone, G.cyl(0.2, 0.2, 0.1, 10), { glow: true, pos: [0, 0.3, 4.25], rot: [Math.PI / 2, 0, 0] });
  },
  cinders(bone) { // micro-missile box
    part(bone, G.box(1.2, 0.9, 1.1, 0.1), { paint: 'secondary', pos: [0, 0.35, 0] });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) part(bone, G.cyl(0.09, 0.09, 0.05, 8), { paint: 'accent', noInk: true, pos: [-0.39 + i * 0.26, 0.1 + j * 0.25, 0.56], rot: [Math.PI / 2, 0, 0] });
  },
  mortar(bone) { // Tamper ballast mortar
    part(bone, G.box(1.0, 0.8, 1.2, 0.1), { paint: 'dark', pos: [0, 0.2, 0] });
    part(bone, G.cyl(0.42, 0.46, 2.6, 12), { paint: 'secondary', pos: [0, 1.5, 0.35], rot: [0.45, 0, 0] });
    part(bone, G.cyl(0.47, 0.47, 0.25, 12), { paint: 'accent', pos: [0, 2.55, 0.85], rot: [0.45, 0, 0] });
  },
  lidEmitter(bone) { // shield projector dish
    part(bone, G.box(0.8, 0.9, 0.8, 0.1), { paint: 'dark', pos: [0, 0.3, 0] });
    part(bone, G.cyl(0.8, 0.45, 0.3, 12), { paint: 'secondary', pos: [0, 1.0, 0.1] });
    part(bone, G.cyl(0.55, 0.55, 0.05, 12), { glow: true, pos: [0, 1.17, 0.1] });
  },
  bufferKite(bone, w, b) { // held physics shield (momentum-eating plate) on the forearm
    part(bone, G.trap(1.7, 0.9, 3.2, 0.25, 0.2), { paint: 'secondary', pos: [0.05, -0.2, 0.2], rot: [0, Math.PI / 2, 0] });
    part(bone, G.trap(1.1, 0.55, 2.3, 0.1, 0.1), { paint: 'accent', pos: [0.18, -0.25, 0.2], rot: [0, Math.PI / 2, 0] });
    part(bone, G.box(0.06, 1.6, 0.9, 0.01), { glow: true, pos: [0.25, -0.2, 0.2] });
  },
  bufferBoard(bone) { // Fettler-sized slab
    part(bone, G.box(0.22, 2.2, 1.5, 0.1), { paint: 'secondary', pos: [0.1, -0.2, 0.25] });
    decal(bone, hazardTex(), 1.4, 0.3, [0.22, -1.1, 0.25], [0, Math.PI / 2, 0]);
  },
  bufferWall(bone) { // tower shield
    part(bone, G.box(0.3, 4.6, 2.3, 0.18), { paint: 'secondary', pos: [0.1, -0.5, 0.3] });
    part(bone, G.box(0.1, 3.6, 0.5, 0.05), { paint: 'accent', pos: [0.26, -0.5, 0.3] });
    for (const y of [0.9, -1.9]) part(bone, G.box(0.08, 0.1, 1.9, 0.01), { glow: true, pos: [0.27, y, 0.3] });
  },
  tongsArm(bone) { // fitter tool arm over the shoulder
    part(bone, G.box(0.3, 1.8, 0.3, 0.04), { color: LIVERY.hazard, pos: [0, 0.9, 0.3], rot: [0.5, 0, 0] });
    part(bone, G.box(0.25, 1.2, 0.25, 0.04), { paint: 'dark', pos: [0, 1.9, 1.3], rot: [1.6, 0, 0] });
    part(bone, G.box(0.08, 0.3, 0.08, 0.02), { glow: true, glowColor: '#ffd07a', pos: [0, 1.9, 2.0] });
  },
  cloak(bone) { // Awl heat-haze vanes
    for (const x of [-0.55, 0.55]) part(bone, G.box(0.1, 1.4, 0.6, 0.03), { paint: 'dark', pos: [x, 0.3, -0.1], rot: [0, 0, x * 0.5] });
    for (const x of [-0.55, 0.55]) part(bone, G.box(0.04, 1.1, 0.4, 0.01), { glow: true, glowColor: '#9ffff0', opacity: 0.8, pos: [x * 1.05, 0.3, -0.1], rot: [0, 0, x * 0.5] });
  },
};

// ── variants ───────────────────────────────────────────────────────────
// Stature I–V. Heights in metres. `weapons` place kit on socket bones.
export const VARIANTS = [
  { id: 'awl', pose: 'ready', name: 'AWL', stature: 1, plan: 'fettler', height: 2.6, code: 'I·AW', role: 'Infiltrator',
    weapons: [{ kind: 'scribeKnife', bone: 'weapon_R' }, { kind: 'knockerPistol', bone: 'weapon_L' }, { kind: 'cloak', bone: 'backpack' }] },
  { id: 'rivet', pose: 'ready', name: 'RIVET', stature: 1, plan: 'fettler', height: 2.6, code: 'I·RV', role: 'Breacher / boarder',
    weapons: [{ kind: 'rivetGun', bone: 'weapon_R' }, { kind: 'bufferBoard', bone: 'shield_L' }] },
  { id: 'tongs', pose: 'ready', name: 'TONGS', stature: 1, plan: 'fettler', height: 2.6, code: 'I·TG', role: 'Field fitter',
    weapons: [{ kind: 'knockerPistol', bone: 'weapon_R' }, { kind: 'tongsArm', bone: 'backpack' }, { kind: 'bufferBoard', bone: 'shield_L' }] },
  { id: 'gimlet', pose: 'dual', name: 'GIMLET', stature: 2, plan: 'shunter', height: 4.8, code: 'II·GM', role: 'Skirmisher',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'knockerCarbine', bone: 'weapon_L' }] },
  { id: 'spanner', pose: 'ready', name: 'SPANNER', stature: 2, plan: 'shunter', height: 4.8, code: 'II·SP', role: 'Missile skirmisher',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'cinders', bone: 'mount_L' }, { kind: 'cinders', bone: 'mount_R' }] },
  { id: 'plumb', pose: 'aim', name: 'PLUMB', stature: 3, plan: 'linesman', height: 7.2, code: 'III·PL', role: 'Line frame',
    weapons: [{ kind: 'scribeRifle', bone: 'weapon_R' }, { kind: 'bufferKite', bone: 'shield_L' }, { kind: 'cinders', bone: 'mount_L' }] },
  { id: 'chisel', pose: 'heavy', name: 'CHISEL', stature: 3, plan: 'linesman', height: 7.2, code: 'III·CH', role: 'Assault',
    weapons: [{ kind: 'knockerCannon', bone: 'weapon_R' }, { kind: 'heatChisel', bone: 'weapon_L' }] },
  { id: 'gauge', pose: 'aim', name: 'GAUGE', stature: 3, plan: 'linesman', height: 7.2, code: 'III·GA', role: 'Marksman / spotter', head: 'sensor',
    weapons: [{ kind: 'spikeDriver', bone: 'weapon_R' }] },
  { id: 'maul', pose: 'guard', name: 'MAUL', stature: 4, plan: 'derrick', height: 9.0, code: 'IV·ML', role: 'Breaker',
    weapons: [{ kind: 'maul', bone: 'weapon_R' }, { kind: 'bufferWall', bone: 'shield_L' }] },
  { id: 'bellows', pose: 'cast', name: 'BELLOWS', stature: 4, plan: 'derrick', height: 9.0, code: 'IV·BL', role: 'Shield projector',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'lidEmitter', bone: 'mount_L' }, { kind: 'lidEmitter', bone: 'mount_R' }] },
  { id: 'tamper', pose: 'ready', name: 'TAMPER', stature: 4, plan: 'derrick', height: 9.0, code: 'IV·TP', role: 'Artillery',
    weapons: [{ kind: 'knockerCarbine', bone: 'weapon_R' }, { kind: 'mortar', bone: 'mount_L' }, { kind: 'longScribe', bone: 'mount_R' }] },
  { id: 'anvil', pose: 'heavy', name: 'ANVIL', stature: 5, plan: 'gantry', height: 11.5, code: 'V·AN', role: 'Command / shield wall',
    weapons: [{ kind: 'knockerCannon', bone: 'weapon_R' }, { kind: 'bufferWall', bone: 'shield_L' }] },
  { id: 'piledriver', pose: 'drive', name: 'PILEDRIVER', stature: 5, plan: 'gantry', height: 11.5, code: 'V·PD', role: 'Capital killer',
    weapons: [{ kind: 'piledriver', bone: 'shield_L' }, { kind: 'knockerCannon', bone: 'weapon_R' }] },
  { id: 'knell', pose: 'lance', name: 'KNELL', stature: 5, plan: 'gantry', height: 11.5, code: 'V·KN', role: 'Resonance lance',
    weapons: [{ kind: 'knellLance', bone: 'weapon_R' }, { kind: 'lidEmitter', bone: 'mount_L' }] },
];
export const byId = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

// ── poses ──────────────────────────────────────────────────────────────
// Euler XYZ per bone (radians). L = +X side. Negative X swings a limb forward.
const D = Math.PI / 180;
export const POSES = {
  stand: {},
  ready: { // weapon at low ready, angled down across the body
    spine: [0, -8 * D, 0], chest: [4 * D, -6 * D, 0], head: [0, 12 * D, 0],
    shoulder_R: [-12 * D, 0, 6 * D], forearm_R: [-42 * D, 0, 0], hand_R: [-10 * D, 0, 0],
    shoulder_L: [-10 * D, 0, 8 * D], forearm_L: [-50 * D, 0, 0], hand_L: [0, 0, 0],
    thigh_L: [-6 * D, 0, 5 * D], shin_L: [10 * D, 0, 0], foot_L: [-4 * D, 0, -5 * D],
    thigh_R: [6 * D, 0, -6 * D], shin_R: [8 * D, 0, 0], foot_R: [-14 * D, 0, 6 * D], hipsDrop: 0.2,
  },
  aim: { // rifle shouldered, shield forward
    spine: [0, -18 * D, 0], chest: [0, -10 * D, 0], head: [0, 26 * D, 0],
    shoulder_R: [-80 * D, -10 * D, -10 * D], forearm_R: [-20 * D, 0, 0], hand_R: [8 * D, 0, 0],
    shoulder_L: [-50 * D, 30 * D, 25 * D], forearm_L: [-70 * D, 0, 0], hand_L: [0, 0, 0],
    thigh_L: [-18 * D, 0, 8 * D], shin_L: [22 * D, 0, 0], foot_L: [-4 * D, 0, -8 * D],
    thigh_R: [14 * D, 0, -10 * D], shin_R: [16 * D, 0, 0], foot_R: [-30 * D, 0, 10 * D], hipsDrop: 0.35,
  },
  dual: { // twin carbines: right forward, left across
    spine: [0, -14 * D, 0], chest: [2 * D, -8 * D, 0], head: [0, 20 * D, 0],
    shoulder_R: [-78 * D, 0, -6 * D], forearm_R: [-12 * D, 0, 0],
    shoulder_L: [-18 * D, 0, 16 * D], forearm_L: [-62 * D, 0, 0], hand_L: [-10 * D, 0, 0],
    thigh_L: [-30 * D, 0, 10 * D], shin_L: [36 * D, 0, 0], foot_L: [-6 * D, 0, -10 * D],
    thigh_R: [18 * D, 0, -12 * D], shin_R: [30 * D, 0, 0], foot_R: [-40 * D, 0, 12 * D], hipsDrop: 0.6,
  },
  lance: { // staff at rest, butt grounded
    spine: [0, -6 * D, 0], chest: [0, -4 * D, 0], head: [-4 * D, 10 * D, 0],
    shoulder_R: [-8 * D, 0, -10 * D], forearm_R: [-84 * D, 0, 0], hand_R: [96 * D, 0, 0],
    shoulder_L: [-6 * D, 0, 10 * D], forearm_L: [-30 * D, 0, 0],
    thigh_L: [-6 * D, 0, 6 * D], shin_L: [8 * D, 0, 0], foot_L: [-2 * D, 0, -6 * D],
    thigh_R: [4 * D, 0, -6 * D], shin_R: [4 * D, 0, 0], foot_R: [-8 * D, 0, 6 * D], hipsDrop: 0.1,
  },
  heavy: { // two-handed heavy weapon
    spine: [0, -10 * D, 0], chest: [4 * D, -8 * D, 0], head: [0, 14 * D, 0],
    shoulder_R: [-40 * D, 0, -12 * D], forearm_R: [-75 * D, 10 * D, 0],
    shoulder_L: [-35 * D, -10 * D, 8 * D], forearm_L: [-60 * D, -20 * D, 0],
    thigh_L: [-10 * D, 0, 8 * D], shin_L: [14 * D, 0, 0], foot_L: [-4 * D, 0, -8 * D],
    thigh_R: [10 * D, 0, -8 * D], shin_R: [10 * D, 0, 0], foot_R: [-20 * D, 0, 8 * D], hipsDrop: 0.25,
  },
  guard: { // tower shield planted, hammer high
    spine: [4 * D, 14 * D, 0], chest: [6 * D, 8 * D, 0], head: [0, -12 * D, 0],
    shoulder_L: [-55 * D, 55 * D, 15 * D], forearm_L: [-50 * D, 0, 0],
    shoulder_R: [-150 * D, 0, -20 * D], forearm_R: [-40 * D, 0, 0], hand_R: [-30 * D, 0, 0],
    thigh_L: [-22 * D, 0, 10 * D], shin_L: [30 * D, 0, 0], foot_L: [-8 * D, 0, -10 * D],
    thigh_R: [18 * D, 0, -12 * D], shin_R: [20 * D, 0, 0], foot_R: [-38 * D, 0, 12 * D], hipsDrop: 0.55,
  },
  cast: { // Lid cast: arms spread, head up
    chest: [-8 * D, 0, 0], head: [-14 * D, 0, 0],
    shoulder_L: [0, 0, 70 * D], forearm_L: [-40 * D, 0, 0], shoulder_R: [0, 0, -70 * D], forearm_R: [-40 * D, 0, 0],
    thigh_L: [0, 0, 10 * D], thigh_R: [0, 0, -10 * D], foot_L: [0, 0, -10 * D], foot_R: [0, 0, 10 * D], hipsDrop: 0.15,
  },
  drive: { // Piledriver thrust
    spine: [10 * D, -24 * D, 0], chest: [8 * D, -14 * D, 0], head: [-6 * D, 30 * D, 0],
    shoulder_L: [-88 * D, 12 * D, 0], forearm_L: [-10 * D, 0, 0],
    shoulder_R: [30 * D, 0, -20 * D], forearm_R: [-60 * D, 0, 0],
    thigh_L: [-40 * D, 0, 6 * D], shin_L: [42 * D, 0, 0], foot_L: [-2 * D, 0, 0],
    thigh_R: [26 * D, 0, -6 * D], shin_R: [24 * D, 0, 0], foot_R: [-40 * D, 0, 0], hipsDrop: 0.8,
  },
  kneel: { // "knelt": disabled, pilot alive. Right knee down, rifle across the thigh.
    spine: [16 * D, 0, 0], chest: [10 * D, 0, 0], head: [18 * D, 0, 0],
    shoulder_L: [-30 * D, 0, 10 * D], forearm_L: [-40 * D, 0, 0],
    shoulder_R: [-35 * D, 0, 10 * D], forearm_R: [-70 * D, 0, 0], hand_R: [20 * D, 0, 0],
    thigh_L: [-88 * D, 0, 6 * D], shin_L: [46 * D, 0, 0], foot_L: [42 * D, 0, 0],
    thigh_R: [4 * D, 0, -4 * D], shin_R: [88 * D, 0, 0], foot_R: [30 * D, 0, 0],
  },
  standDown: { // pilot dead: the frame locks upright, head bowed, weapon grounded
    spine: [0, 0, 0], chest: [-2 * D, 0, 0], head: [34 * D, 0, 0],
    shoulder_L: [0, 0, 4 * D], forearm_L: [-6 * D, 0, 0], shoulder_R: [-6 * D, 0, -4 * D], forearm_R: [-24 * D, 0, 0],
    thigh_L: [0, 0, 3 * D], thigh_R: [0, 0, -3 * D], foot_L: [0, 0, -3 * D], foot_R: [0, 0, 3 * D],
  },
  space: { // zero-g boost: legs trailing, jets vectored
    spine: [18 * D, 0, 0], chest: [14 * D, 0, 0], head: [-26 * D, 0, 0],
    shoulder_R: [-70 * D, 0, -18 * D], forearm_R: [-30 * D, 0, 0],
    shoulder_L: [-20 * D, 0, 30 * D], forearm_L: [-60 * D, 0, 0],
    thigh_L: [30 * D, 0, 8 * D], shin_L: [40 * D, 0, 0], foot_L: [30 * D, 0, 0],
    thigh_R: [10 * D, 0, -8 * D], shin_R: [60 * D, 0, 0], foot_R: [30 * D, 0, 0],
    skirt_F: [-20 * D, 0, 0], skirt_B: [30 * D, 0, 0], jet_L: [50 * D, 0, 0], jet_R: [50 * D, 0, 0],
  },
};

/** Walk cycle, phase 0..1 → pose. Heavy gait: long contact, short flight. */
export function walkPose(ph) {
  const t = ph * Math.PI * 2, s = Math.sin(t), c = Math.cos(t);
  const lift = (x) => Math.max(0, Math.sin(x));
  return {
    thigh_L: [-26 * D * s, 0, 3 * D], shin_L: [(6 + 38 * lift(t + Math.PI * 0.1)) * D, 0, 0], foot_L: [(10 * s) * D, 0, 0],
    thigh_R: [26 * D * s, 0, -3 * D], shin_R: [(6 + 38 * lift(t + Math.PI * 1.1)) * D, 0, 0], foot_R: [(-10 * s) * D, 0, 0],
    shoulder_L: [22 * D * s, 0, 6 * D], forearm_L: [-20 * D, 0, 0], shoulder_R: [-22 * D * s, 0, -6 * D], forearm_R: [-20 * D, 0, 0],
    spine: [10 * D, 8 * D * s, 0], chest: [6 * D, -4 * D * s, 3 * D * c], hips: [4 * D, -6 * D * s, -2 * D * c], head: [-12 * D, 0, 0],
    skirt_F: [Math.min(0, -26 * D * Math.abs(s)), 0, 0], hipsDrop: 0.15 + 0.12 * Math.abs(c),
  };
}

export function applyPose(root, pose) {
  const { bones, hipY } = root.userData;
  for (const [name, o] of Object.entries(bones)) if (name !== 'root') o.rotation.set(0, 0, 0);
  const pb = BONE_TREE_BASE.get(root) ?? snapshotBase(root);
  bones.hips.position.y = pb.hipsY - (pose.hipsDrop ?? 0);
  if (root.userData.variant.plan === 'derrick') bones.neck.position.y = pb.neckY;
  for (const [name, r] of Object.entries(pose)) if (bones[name] && Array.isArray(r)) bones[name].rotation.set(...r);
  solve(root);
  return root;
}
const BONE_TREE_BASE = new Map();
function snapshotBase(root) {
  const b = root.userData.bones;
  const s = { hipsY: b.hips.position.y, neckY: b.neck.position.y };
  BONE_TREE_BASE.set(root, s); return s;
}

/** Ground the frame: shift root so the lowest foot sits on y=0. */
export function ground(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root.userData.bones.foot_L).union(new THREE.Box3().setFromObject(root.userData.bones.foot_R));
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return root;
}

/** Skeleton overlay: bone joints + links drawn in the given colour. */
export function skeletonOverlay(root, color = '#ff3b6b') {
  const g = new THREE.Group();
  const pts = [];
  root.updateMatrixWorld(true);
  const skip = new Set(['root', 'weapon_R', 'weapon_L', 'shield_L', 'mount_L', 'mount_R']);
  for (const [name, parent] of BONE_TREE) {
    if (!parent || skip.has(name) || parent === 'root') continue;
    const a = new THREE.Vector3().setFromMatrixPosition(root.userData.bones[parent].matrixWorld);
    const b = new THREE.Vector3().setFromMatrixPosition(root.userData.bones[name].matrixWorld);
    pts.push(a, b);
  }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  lines.renderOrder = 10; g.add(lines);
  for (const [name] of BONE_TREE) {
    if (name === 'root' || skip.has(name)) continue;
    const p = new THREE.Vector3().setFromMatrixPosition(root.userData.bones[name].matrixWorld);
    const r = 0.09 * (root.userData.variant.height / 7.2);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(r), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(p); m.renderOrder = 11; g.add(m);
  }
  return g;
}

// ── scale props ────────────────────────────────────────────────────────
/** A 1.8 m person, ink silhouette with a little shading. */
export function human(color = '#2a2f37') {
  const g = new THREE.Group();
  const prev = OUTLINE; OUTLINE = 0.018;
  part(g, G.sphere(0.12), { color, pos: [0, 1.66, 0] });
  part(g, G.box(0.42, 0.62, 0.24, 0.06), { color, pos: [0, 1.25, 0] });
  for (const x of [-0.11, 0.11]) part(g, G.box(0.14, 0.86, 0.16, 0.03), { color, pos: [x, 0.47, 0] });
  for (const x of [-0.27, 0.27]) part(g, G.box(0.11, 0.66, 0.12, 0.03), { color, pos: [x, 1.2, 0], rot: [0, 0, x * 0.25] });
  OUTLINE = prev;
  return g;
}
/** An n-storey building block for scale (3.3 m per storey). */
export function building(storeys = 3, w = 9, d = 7) {
  const g = new THREE.Group();
  const H = storeys * 3.3;
  const prev = OUTLINE; OUTLINE = 0.05;
  part(g, G.box(w, H, d, 0.02), { color: '#cfc6b2', pos: [0, H / 2, 0] });
  for (let s = 0; s < storeys; s++) {
    part(g, G.box(w + 0.1, 0.18, d + 0.1, 0.01), { color: '#a79f8c', pos: [0, s * 3.3 + 0.1, 0] });
    for (let i = 0; i < 4; i++) part(g, G.box(1.2, 1.5, 0.1, 0.01), { color: '#39424f', noInk: true, pos: [-w / 2 + 1.3 + i * ((w - 2.6) / 3), s * 3.3 + 1.8, d / 2 + 0.02] });
  }
  part(g, G.box(w + 0.3, 0.3, d + 0.3, 0.02), { color: '#a79f8c', pos: [0, H + 0.15, 0] });
  OUTLINE = prev;
  return g;
}
/** Swap every material for a translucent ghost (x-ray views). */
export function ghost(root, opacity = 0.16) {
  const m = new THREE.MeshBasicMaterial({ color: '#5d6875', transparent: true, opacity, depthWrite: false });
  root.traverse((o) => { if (o.isMesh) { if (o.material === inkMat) o.visible = false; else o.material = m; } });
  return root;
}
/** A lone weapon, built on a bare socket for the weapons sheet. */
export function lone(kind, scaleM = 1) {
  const g = new THREE.Group();
  OUTLINE = 0.04;
  WEAPONS[kind](g, {}, 1);
  g.scale.setScalar(scaleM);
  return g;
}
