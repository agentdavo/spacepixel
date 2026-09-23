/**
 * Runtime flags parsed from the URL query string.
 *
 *   ?backend=webgl   force the WebGL2 fallback backend
 *   ?ink=0           disable the ink-line pass
 *   ?view=normal|depth|ink|id|edges|color   debug G-buffer views
 *   ?shot=1          deterministic "screenshot mode" (fixed time, no UI chrome)
 *   ?t=12.5          start time in seconds (useful with shot mode)
 *   ?scene=flight    which scene to boot (flight | showcase | spatial | hangar)
 *   ?cam=0..n        showcase camera preset
 */
export type DebugView = 'final' | 'color' | 'normal' | 'depth' | 'id' | 'edges';

export interface Flags {
  forceWebGL: boolean;
  ink: boolean;
  view: DebugView;
  shot: boolean;
  startTime: number;
  scene: string;
  cam: number;
  hud: boolean;
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
  scene: q.get('scene') ?? '',
  cam: Number(q.get('cam') ?? 0) || 0,
  hud: q.get('hud') !== '0',
};
