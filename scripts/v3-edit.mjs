#!/usr/bin/env node
/** Assemble a reviewable shot ledger without altering captured sources. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2);
const ledger=JSON.parse(readFileSync(args[0],'utf8'));
const out=resolve(args[1]??'scratchpad/delivery/v3/final');
const cueFile=args[2];
const audio=args[3] && !args[3].startsWith('--') ? resolve(args[3]) : null;
mkdirSync(join(out,'frames'),{recursive:true});
const fps=30;
let count=0;
for(const shot of ledger.shots){
  if(Math.abs(shot.at-count/fps)>1e-6)throw new Error(`Gap/overlap before ${shot.id}`);
  const first=Math.round(shot.from*fps), n=Math.round(shot.duration*fps);
  for(let k=0;k<n;k++){
    const src=resolve(shot.frames,`f_${String(first+k).padStart(5,'0')}.jpg`);
    const dst=join(out,'frames',`f_${String(count++).padStart(5,'0')}.jpg`);
    if(!existsSync(src))throw new Error(`Missing capture ${src}`);
    if(existsSync(dst))unlinkSync(dst);
    linkSync(src,dst);
  }
}
if(Math.abs(count/fps-ledger.duration)>1e-6)throw new Error('Ledger duration mismatch');
writeFileSync(join(out,'shot-ledger.json'),JSON.stringify(ledger,null,2));
const stamp=t=>`${Math.floor(t/3600)}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;
const wrap=text=>{const lines=[];let line='';for(const word of text.split(/\s+/)){if((line+' '+word).length>52){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines.join('\\N');};
let ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Narration,Arial,25,&H00F2F5F6,&H000000FF,&H00101018,&H90000000,-1,0,0,0,100,100,0,0,1,2.2,1,2,270,270,45,1\nStyle: Label,Arial,17,&H00E4D9C2,&H000000FF,&H00101018,&H90000000,-1,0,0,0,100,100,1.2,0,1,1.5,1,8,220,220,65,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
if(cueFile){const doc=JSON.parse(readFileSync(cueFile,'utf8'));for(const c of doc.cues??doc.lines)ass+=`Dialogue: 1,${stamp(c.captionStart??c.start)},${stamp(c.captionEnd??c.end+1)},Narration,,0,0,0,,${wrap(c.text)}\n`;}
for(const l of ledger.labels??[])ass+=`Dialogue: 0,${stamp(l.at)},${stamp(l.at+l.duration)},Label,,0,0,0,,${l.text}\n`;
writeFileSync(join(out,'captions.ass'),ass);
if(args.includes('--prepare-only'))process.exit(0);
const command=['-hide_banner','-loglevel','error','-y','-framerate','30','-i','frames/f_%05d.jpg',...(audio?['-i',audio]:[]),'-vf','scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,ass=captions.ass,fade=t=in:st=0:d=1.2','-c:v','libx264','-preset','slow','-crf','20','-tune','animation','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',...(audio?['-c:a','aac','-b:a','192k','-ar','48000','-ac','2']:[]),'-t',String(ledger.duration),'-movflags','+faststart',audio?'vanguard-v3-720p.mp4':'picture-preview.mp4'];
const result=spawnSync('ffmpeg',command,{cwd:out,stdio:'inherit'});
if(result.status!==0)throw new Error(`FFmpeg failed: ${result.status}`);
console.log(JSON.stringify({out,frames:count,duration:count/30}));
