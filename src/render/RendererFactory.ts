import { WebGPURenderer, ACESFilmicToneMapping, SRGBColorSpace } from 'three/webgpu';
import { flags } from '@/core/Flags';

export interface RendererInfo {
  renderer: WebGPURenderer;
  /** True when running on the native WebGPU backend (custom WGSL available). */
  isWebGPU: boolean;
  backendName: 'WebGPU' | 'WebGL2';
  adapterDescription: string;
}

/**
 * Creates the WebGPU renderer. Three.js transparently falls back to its WebGL2
 * backend when `navigator.gpu` is unavailable; systems that rely on raw WGSL
 * (ink edges, compute particles) query `isWebGPU` and select their TSL twins.
 *
 * The universe spans ~7 orders of magnitude (cockpit bolts to gas giants), so we
 * run a reversed-Z float depth buffer for stable precision at range.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererInfo> {
  installWebGPUCompatShims();
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false, // AA is handled in the post stack (FXAA after ink lines)
    forceWebGL: flags.forceWebGL,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    trackTimestamp: true, // GPU timings when the adapter exposes timestamp-query
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, flags.quality === 'high' ? 2 : flags.quality === 'med' ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;

  await renderer.init();

  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    adapter?: GPUAdapter;
  };
  const isWebGPU = backend.isWebGPUBackend === true;

  let adapterDescription = 'n/a';
  if (isWebGPU) {
    const adapter = backend.adapter ?? (await navigator.gpu?.requestAdapter());
    const info = adapter?.info;
    if (info) adapterDescription = [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ');
  }

  return {
    renderer,
    isWebGPU,
    backendName: isWebGPU ? 'WebGPU' : 'WebGL2',
    adapterDescription,
  };
}

/**
 * three r186 always passes `swizzle: 'rgba'` in texture-view descriptors (the
 * final spec form). Browsers that shipped the earlier dictionary-typed draft
 * (e.g. Chromium 141) throw a TypeError on it. The identity swizzle is the
 * default anyway, so stripping it is a no-op everywhere else.
 */
function installWebGPUCompatShims(): void {
  if (typeof GPUTexture === 'undefined') return;
  const proto = GPUTexture.prototype as GPUTexture & { __vanguardShim?: boolean };
  if (proto.__vanguardShim) return;
  const createView = proto.createView;
  proto.createView = function (this: GPUTexture, desc?: GPUTextureViewDescriptor & { swizzle?: unknown }) {
    if (desc && desc.swizzle === 'rgba') {
      const { swizzle: _identity, ...rest } = desc;
      return createView.call(this, rest);
    }
    return createView.call(this, desc);
  };
  proto.__vanguardShim = true;
}
