import { fmtCount, signalState, BURST_PERIOD, type SignalState } from '@/game/world/signal';
import type { WorldState } from '@/game/world/WorldState';

/**
 * The Signal count in a HUD corner (batch 5 · item 6): a small violet
 * readout under the debug line, top-left — `NULL COUNT 947` with a hairline
 * filling toward the next burst. It flares when a burst lands. Hidden before
 * Episode 5 (nobody has heard it), in story episodes (the debriefs own the
 * number) and in cutaways.
 */
export class SignalCounter {
  private el = document.createElement('div');
  private text = document.createElement('span');
  private bar = document.createElement('i');
  private key = '';
  private flareUntil = 0;

  constructor(root: HTMLElement) {
    this.el.className = 'signal-counter';
    this.el.style.cssText =
      'position:absolute;left:24px;top:40px;z-index:6;pointer-events:none;font:12px "Share Tech Mono",monospace;color:#b77bff;letter-spacing:0.06em;text-shadow:0 0 6px rgba(183,123,255,0.55);display:none;transition:color .4s,text-shadow .4s';
    this.bar.style.cssText = 'display:block;height:1px;margin-top:3px;background:#b77bff;opacity:0.7;width:0';
    this.el.append(this.text, this.bar);
    root.append(this.el);
  }

  /** Call when a burst event lands. */
  flare(now: number): void {
    this.flareUntil = now + 3;
  }

  update(w: WorldState, visible: boolean, now: number): void {
    const s: SignalState = signalState(w);
    const show = visible && s.count !== null;
    this.el.style.display = show ? 'block' : 'none';
    if (!show) return;
    const label = labelOf(s);
    const flare = now < this.flareUntil;
    const key = `${label}|${flare}`;
    if (key !== this.key) {
      this.key = key;
      this.text.textContent = label;
      this.el.style.color = flare ? '#ffffff' : '#b77bff';
      this.el.style.textShadow = flare ? '0 0 12px #b77bff, 0 0 3px #fff' : '0 0 6px rgba(183,123,255,0.55)';
    }
    const k = s.nextIn === null ? (s.mode === 'stopped' ? 0 : 1) : 1 - s.nextIn / BURST_PERIOD;
    this.bar.style.width = `${Math.round(k * 120)}px`;
  }
}

export function labelOf(s: SignalState): string {
  if (s.count === null) return '';
  if (s.mode === 'stopped') return 'NULL COUNT 2 · STOPPED';
  if (s.mode === 'up') return `NULL COUNT ${fmtCount(s.count)} ↑`;
  return `NULL COUNT ${fmtCount(s.count)}${s.breathDays !== null ? ` · BREATH ${s.breathDays}d` : ''}`;
}
