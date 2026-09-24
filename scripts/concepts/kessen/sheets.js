// Kessen concept sheets: HTML/CSS layout with three.js views rendered into
// one full-page canvas (one scissored viewport per .view element).
import * as THREE from 'three';
import * as K from './mechkit.js';
import { SHEETS } from './content.js';

const sheetId = new URLSearchParams(location.search).get('sheet') ?? '03-statures';
const host = document.getElementById('sheet');
const views = [];

export const ctx = {
  THREE, K, host,
  /** Register a 3D view: el is a DOM element; build(scene, aspect) returns a camera. */
  view(el, build) { views.push({ el, build }); return el; },
  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
  lights(scene, opts = {}) {
    const d = new THREE.DirectionalLight(0xffffff, opts.key ?? 2.9);
    d.position.set(...(opts.dir ?? [-4, 8, 7])); scene.add(d);
    scene.add(new THREE.AmbientLight(opts.ambient ?? 0xffffff, opts.amb ?? 0.78));
    const rim = new THREE.DirectionalLight(opts.rim ?? 0xbfe8ff, opts.rimI ?? 0.6);
    rim.position.set(6, 3, -6); scene.add(rim);
  },
  /** Orthographic camera fitted to an object from a view direction. */
  fitOrtho(obj, aspect, { dir = [0.55, 0.22, 1], pad = 1.1, lift = 0, box } = {}) {
    const bb = box ?? new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    cam.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(300));
    cam.lookAt(c); cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    let w = (x1 - x0) * pad, h = (y1 - y0) * pad;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + lift * h;
    cam.left = cx - w / 2; cam.right = cx + w / 2; cam.top = cy + h / 2; cam.bottom = cy - h / 2;
    cam.updateProjectionMatrix();
    return cam;
  },
  shadow(scene, x, z, r, opacity = 0.28) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x17181d, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); m.scale.set(1, 0.7, 1); scene.add(m); return m;
  },
  /** Build, pose and ground a variant. */
  frame(id, pose, extra = {}) {
    const v = { ...K.byId[id], ...extra };
    pose ??= v.pose ?? 'ready';
    const f = K.buildFrame(v);
    K.applyPose(f, typeof pose === 'string' ? K.POSES[pose] : pose);
    K.ground(f);
    return f;
  },
};

async function main() {
  await document.fonts.ready;
  const def = SHEETS[sheetId];
  if (!def) throw new Error('no sheet ' + sheetId);
  await def(ctx);
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight;
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.setScissorTest(false); renderer.clear();
  renderer.setScissorTest(true);
  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    const x = r.left + scrollX, y = r.top + scrollY, w = r.width, h = r.height;
    if (w < 2 || h < 2) continue;
    const scene = new THREE.Scene();
    let cam = await v.build(scene, w / h, { w, h });
    let labels = [];
    if (cam && !cam.isCamera) { labels = cam.labels ?? []; cam = cam.camera; }
    scene.updateMatrixWorld(true); cam.updateMatrixWorld();
    for (const l of labels) {
      const p = new THREE.Vector3(...l.p).project(cam);
      const d = document.createElement('div');
      d.className = 'callout ' + (l.cls ?? '');
      d.innerHTML = l.html;
      d.style.left = (x + (p.x + 1) / 2 * w + (l.dx ?? 0)) + 'px';
      d.style.top = (y + (1 - p.y) / 2 * h + (l.dy ?? 0)) + 'px';
      if (l.center) d.style.transform = 'translateX(-50%)';
      document.body.append(d);
    }
    const by = H - (y + h);
    renderer.setViewport(x, by, w, h); renderer.setScissor(x, by, w, h);
    renderer.render(scene, cam);
  }
  window.__done = true;
}
main().catch((e) => { console.error(e.stack ?? e); document.body.insertAdjacentHTML('afterbegin', `<pre style="color:red;font-size:24px">${e.stack ?? e}</pre>`); window.__done = true; });
