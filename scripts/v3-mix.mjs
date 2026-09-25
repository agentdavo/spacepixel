#!/usr/bin/env node
/** Two narration candidates share picture, score and captured gameplay effects. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const [ledgerPath,rootArg,outArg]=process.argv.slice(2);
const ledger=JSON.parse(readFileSync(ledgerPath,'utf8')),root=resolve(rootArg),out=resolve(outArg);
mkdirSync(out,{recursive:true});
const run=args=>{const r=spawnSync('ffmpeg',['-hide_banner','-y',...args],{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(r.stderr);return r.stderr;};
const measure=(file,target=-17)=>{const log=run(['-i',file,'-af',`loudnorm=I=${target}:TP=-1.5:LRA=16:print_format=json`,'-f','null','-']);return JSON.parse(log.slice(log.lastIndexOf('{'),log.lastIndexOf('}')+1));};
const normalize=(src,dst,target)=>{const m=measure(src,target);run(['-i',src,'-af',`loudnorm=I=${target}:TP=-1.5:LRA=16:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`,'-ar','48000','-ac','2','-c:a','pcm_s24le',dst]);return m;};
const captions=JSON.parse(readFileSync(join(root,'female-complete-candidates/shared-caption-envelope-152.97s.json'),'utf8')).lines;
// Shared timed duck: 0.25s attack, sustained through the longer take, 0.7s recovery.
const envelope=captions.map(c=>`max(0,min(1,min((t-${c.start-0.25})/0.25,(${c.latestSpokenEnd+0.7}-t)/0.7)))`).join('+');
const duck=`min(1,${envelope})`;
const audit=[];
for(const [id,folder] of [['A-Amy','a-amy'],['B-HFC','b-hfc-female']]){
  const raw=join(root,`female-complete-candidates/${folder}/narration-candidate-provisional-150s.wav`);
  const voice=join(out,`${id}-voice.wav`),premix=join(out,`${id}-premix.wav`),master=join(out,`${id}-master.wav`);
  const voiceMeasurement=normalize(raw,voice,-20);
  const filter=`[0:a]apad,atrim=duration=${ledger.duration}[vo];[1:a]apad,atrim=duration=${ledger.duration},volume='1.5*(1-0.72*(${duck}))':eval=frame[m];[2:a]volume='0.60*(1-0.75*(${duck}))':eval=frame,afade=t=out:st=130:d=2[s];[vo][m][s]amix=inputs=3:normalize=0:duration=longest,atrim=duration=${ledger.duration}[mix]`;
  run(['-i',voice,'-i',join(root,'music-provisional-150s/v3-symphony-of-gates-provisional-150s.wav'),'-i',join(root,'stems/v3-sfx.wav'),'-filter_complex',filter,'-map','[mix]','-ar','48000','-ac','2','-c:a','pcm_f32le',premix]);
  const masterMeasurement=normalize(premix,master,-17);
  audit.push({id,voice:raw,voiceMeasurement,masterMeasurement,finalMeasurement:measure(master),playbackRate:1,duckAttack:0.25,duckRelease:0.7,master});
  console.log(id,'complete');
}
writeFileSync(join(out,'mix-audit.json'),JSON.stringify({duration:ledger.duration,status:'Two unselected narrator candidates; identical picture and SFX/score timing',method:'Native generated score and event-derived gameplay SFX; common timed voice duck; two-pass EBU loudness master; no narration speed change',audits:audit},null,2));
