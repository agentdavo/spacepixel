import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  floor,
  fract,
  dot,
  abs,
  max,
  min,
  mix,
  clamp,
  select,
  step,
  smoothstep,
  normalize,
  textureSize,
  int,
} from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import type { ShaderNode as Node } from '@/render/tsl';

/**
 * TSL twin of inkEdge.wgsl.ts for the WebGL2 fallback backend, where raw WGSL
 * cannot run. Same algorithm, same parameters, same output layout — keep the
 * two in sync.
 */
export function makeInkEdgeTSL(gbuf: TextureNode, ink: TextureNode) {
  const hash21 = (p: Node) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
  };

  const valueNoise = (p: Node) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0)));
    const a = hash21(i);
    const b = hash21(i.add(vec2(1, 0)));
    const c = hash21(i.add(vec2(0, 1)));
    const d = hash21(i.add(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };

  const texel = (px: Node, dims: Node) => {
    const q = clamp(floor(px), vec2(0), dims.sub(1));
    return q.add(0.5).div(dims);
  };

  const loadG = (px: Node, dims: Node) => {
    const g = gbuf.sample(texel(px, dims));
    const invZ = select(g.a.greaterThan(0.0), float(1).div(g.a), float(0));
    return vec4(normalize(g.rgb.mul(2).sub(1)), invZ);
  };

  const loadI = (px: Node, dims: Node) => ink.sample(texel(px, dims)).rg;

  return Fn(([uv, params, params2]: [Node, Node, Node]) => {
    const dims = vec2(textureSize(gbuf, int(0)) as Node);
    const px = uv.mul(dims);

    const seed = params2.z;
    const wob = valueNoise(px.div(params2.w).add(vec2(seed.mul(17.13), seed.mul(5.71)))).sub(0.5);
    const r = max(params.x.mul(float(1).add(wob.mul(params2.y))), 0.75);
    const rSil = r.mul(params2.x);

    const C = loadG(px, dims).toVar();
    const CI = loadI(px, dims).toVar();

    const axis = (dir: Node) => {
      const pa = px.add(dir.mul(rSil));
      const pb = px.sub(dir.mul(rSil));
      const A = loadG(pa, dims);
      const B = loadG(pb, dims);
      const IA = loadI(pa, dims);
      const IB = loadI(pb, dims);
      const lap = abs(A.w.add(B.w).sub(C.w.mul(2))).div(max(max(C.w, max(A.w, B.w)), 1e-7));
      const nearSide = step(max(A.w, B.w).mul(0.98), C.w);
      const wSil = max(CI.x, max(IA.x, IB.x)).mul(nearSide);
      const sil = smoothstep(params.y, params.y.mul(2.5), lap).mul(wSil);

      const qa = px.add(dir.mul(r));
      const qb = px.sub(dir.mul(r));
      const A2 = loadG(qa, dims);
      const B2 = loadG(qb, dims);
      const IA2 = loadI(qa, dims);
      const IB2 = loadI(qb, dims);
      const wIn = min(CI.x, min(IA2.x, IB2.x));
      const bend = max(float(1).sub(dot(C.xyz, A2.xyz)), float(1).sub(dot(C.xyz, B2.xyz)));
      const crease = smoothstep(params.z, params.z.mul(1.8), bend).mul(wIn);
      const idDelta = max(abs(CI.y.sub(IA2.y)), abs(CI.y.sub(IB2.y)));
      const region = step(params.w, idDelta).mul(wIn);
      return vec3(sil, crease, region);
    };

    const e = max(
      max(axis(vec2(1, 0)), axis(vec2(0, 1))),
      max(axis(vec2(0.7071, 0.7071)), axis(vec2(0.7071, -0.7071))),
    );
    const edge = clamp(max(e.x, max(e.y, e.z)), 0, 1);
    return vec4(edge, e.x, e.y, e.z);
  });
}
