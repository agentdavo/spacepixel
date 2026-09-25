import type { GameAudio } from '@/audio';
import { DEFAULT_AUDIO, onSettings, setSettings, settings, type AudioSettings } from '@/game/Settings';

let installed = false;
/** Available on the title and in flight; independent of disposable scene DOM. */
export function installAudioSettings(audio: GameAudio): void {
  if (installed || typeof document === 'undefined') return;
  if (new URLSearchParams(location.search).get('shot') === '1') return;
  installed = true;
  const host = document.createElement('div');
  host.className = 'audio-settings';
  host.innerHTML = `<style>
    .audio-settings{position:fixed;right:12px;top:12px;z-index:90;color:#d8efff;font:13px ui-monospace,monospace;pointer-events:auto}
    .audio-settings button,.audio-settings select{font:inherit;color:inherit;background:#101b32;border:1px solid #79cee0;padding:7px;cursor:pointer}
    .audio-settings [role=dialog]{margin-top:6px;width:min(330px,calc(100vw - 48px));padding:16px;background:#071323;border:1px solid #79cee0;box-shadow:0 8px 28px #0009;max-height:calc(100vh - 95px);overflow:auto}
    .audio-settings [hidden]{display:none}.audio-settings h2{font-size:16px;margin:0 0 14px}
    .audio-settings label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0}
    .audio-settings input{width:145px}.audio-settings p{line-height:1.5;color:#a8c9d8;margin:12px 0}
    .audio-settings button:focus-visible,.audio-settings select:focus-visible,.audio-settings input:focus-visible{outline:2px solid #ffd78c;outline-offset:2px}
  </style><button type="button" aria-expanded="false" aria-controls="audio-options">Audio</button>
  <div role="dialog" aria-label="Audio settings" id="audio-options" hidden><h2>Audio</h2></div>`;
  const toggle = host.querySelector('button')!;
  const panel = host.querySelector<HTMLElement>('[role=dialog]')!;
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const update = (patch: Partial<AudioSettings>) => setSettings({ audio: { ...settings.audio, ...patch } });
  for (const [key, title] of [['master','Master'],['music','Music'],['effects','Effects'],['dialogue','Dialogue']] as const) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'; input.setAttribute('aria-label', title);
    input.addEventListener('input', () => update({ [key]: Number(input.value) }));
    label.append(input); panel.append(label); controls.set(key,input);
  }
  for (const [key,title,values] of [
    ['output','Output',[['stereo','Stereo speakers'],['headphones','Headphones (3D)'],['surround','5.1 speakers']]],
    ['range','Dynamic range',[['full','Full'],['reduced','Reduced (quiet listening)']]],
  ] as const) {
    const label = document.createElement('label');label.textContent = title;
    const select = document.createElement('select'); select.setAttribute('aria-label',title);
    for (const [value,text] of values) { const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option); }
    select.addEventListener('change',()=>update({[key]:select.value}));label.append(select);panel.append(label);controls.set(key,select);
  }
  const status = document.createElement('p'); status.setAttribute('aria-live','polite');panel.append(status);
  const refresh=()=>{
    controls.forEach((control,key)=>{control.value=String(settings.audio[key as keyof AudioSettings]);});
    status.textContent=audio.engine.outputReason || `Active output: ${audio.engine.outputMode === 'surround' ? '5.1' : audio.engine.outputMode}.`;
  };
  const test = document.createElement('button');test.textContent='Test speakers';panel.append(test);
  let timers: number[]=[];
  test.addEventListener('click',()=>{
    audio.unlock(); timers.forEach(window.clearTimeout);timers=[];
    const labels=audio.engine.testChannels();
    labels.forEach((name,i)=>timers.push(window.setTimeout(()=>{status.textContent=`Speaker test: ${name}`;},100+i*700)));
    timers.push(window.setTimeout(refresh,labels.length*700+150));
  });
  const reset=document.createElement('button');reset.textContent='Reset mix';reset.style.marginLeft='8px';reset.addEventListener('click',()=>update(DEFAULT_AUDIO));panel.append(reset);
  const note=document.createElement('p');note.textContent='5.1 requires a compatible output device. Headphones use two-channel spatial audio. Speaker tones play in the order shown.';panel.append(note);
  onSettings(()=>{refresh(); window.setTimeout(refresh,500);});
  const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();};
  toggle.addEventListener('click',()=>{audio.unlock();panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));refresh();if(!panel.hidden)controls.values().next().value?.focus();});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();e.stopPropagation();});
  host.addEventListener('pointerdown',e=>e.stopPropagation());
  document.body.append(host);refresh();
}
