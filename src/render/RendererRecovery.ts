import type { WebGPURenderer } from 'three/webgpu';

/** Device resources cannot be reused after loss. Offer a clean restart from the existing saved profile. */
export function installRendererRecovery(renderer: WebGPURenderer, root: HTMLElement, stop: () => void): void {
  const previous = renderer.onDeviceLost.bind(renderer);
  let shown = false;
  renderer.onDeviceLost = (info) => {
    previous(info);
    if (shown) return;
    shown = true;
    renderer.setAnimationLoop(null);
    stop();
    const panel = document.createElement('section');
    panel.className = 'hud-error renderer-recovery';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'renderer-recovery-title');
    const title = document.createElement('h2');
    title.id = 'renderer-recovery-title';
    title.textContent = 'Graphics connection interrupted';
    const text = document.createElement('p');
    text.textContent = 'Restart Vanguard to restore graphics. Your last saved profile is kept; progress since that save may be lost.';
    const restart = document.createElement('button');
    restart.textContent = 'Restart Vanguard';
    restart.onclick = () => location.reload();
    const fallback = document.createElement('button');
    fallback.textContent = 'Restart with compatibility graphics';
    fallback.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set('backend', 'webgl');
      location.assign(url);
    };
    panel.append(title, text, restart, fallback);
    root.append(panel);
    restart.focus();
  };
}
