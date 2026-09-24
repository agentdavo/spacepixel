/**
 * Runtime flags parsed from the URL query string.
 *
 *   ?backend=webgl   force the WebGL2 fallback backend
 *   ?ink=0           disable the ink-line pass
 *   ?view=normal|depth|ink|id|edges|color   debug G-buffer views
 *   ?shot=1          deterministic "screenshot mode" (fixed time, no UI chrome)
 *   ?record=24       frame-stepped capture at N fps (with shot=1): no rAF loop,
 *                    the harness calls __VANGUARD__.hooks.step(n)
 *   ?t=12.5          start time in seconds (useful with shot mode)
 *   ?scene=flight    which scene to boot (flight | showcase | spatial | hangar)
 *   ?cam=0..n        camera preset
 *   ?bridge=0|1|bow  bridge hulls' chase framing (read by `cameraOverride` in
 *                    src/game/shipyard/flight.ts, which stays window-free)
 *   ?budget=8.3      frame budget (ms) for the perf graph / pass-fail
 *   ?demo=1          scripted autopilot (implied by shot mode)
 */
export type DebugView = 'final' | 'color' | 'normal' | 'depth' | 'id' | 'edges';

export interface Flags {
  forceWebGL: boolean;
  ink: boolean;
  view: DebugView;
  shot: boolean;
  startTime: number;
  /** Capture fps for frame-stepped recording (0 = off). */
  record: number;
  scene: string;
  cam: number;
  hud: boolean;
  /** Frame budget in ms (pass/fail line on the perf graph). */
  budget: number;
  /** Scripted autopilot for demos / captures. */
  demo: boolean;
  /** low | med | high — starting render scale / pixel ratio cap; `auto` resolution follows GPU time. */
  quality: 'low' | 'med' | 'high';
  dynres: boolean;
}

const q = new URLSearchParams(window.location.search);

const VIEWS: DebugView[] = ['final', 'color', 'normal', 'depth', 'id', 'edges'];
const rawView = (q.get('view') ?? 'final') as DebugView;

export const flags: Flags = {
  forceWebGL: q.get('backend') === 'webgl',
  ink: q.get('ink') !== '0',
  view: VIEWS.includes(rawView) ? rawView : 'final',
  shot: q.get('shot') === '1',
  startTime: Number(q.get('t') ?? 0) || 0,
  record: Number(q.get('record') ?? 0) || 0,
  scene: q.get('scene') ?? '',
  cam: Number(q.get('cam') ?? 0) || 0,
  hud: q.get('hud') !== '0',
  budget: Number(q.get('budget') ?? 0) || 1000 / 60,
  demo: q.get('demo') === '1' || (q.get('shot') === '1' && q.get('demo') !== '0'),
  quality: (['low', 'med', 'high'] as const).find((x) => x === q.get('quality')) ?? 'med',
  dynres: q.get('dynres') !== '0' && q.get('shot') !== '1',
};
