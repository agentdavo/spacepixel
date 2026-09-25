#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const ledger=JSON.parse(readFileSync(process.argv[2],'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={duration:ledger.duration,takes:[],shots:[]};
for(const dir of new Set(ledger.shots.filter(s=>s.events).map(s=>s.frames))){
 const root=resolve(dir),p=JSON.parse(readFileSync(join(root,'provenance.json'),'utf8'));
 const rows=readFileSync(join(root,'events.jsonl'),'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x));
 const status=JSON.parse(readFileSync(join(root,'replay-status.json'),'utf8'));
 const expected=Math.round((p.seconds-p.from)*30),first=Math.round(p.from*30);
 if(rows.length!==expected||rows.some((r,i)=>r.frame!==first+i||r.tick!==(r.frame+1)*2||r.controls.length!==2))throw new Error(`Frame/input discontinuity ${dir}`);
 if(status.desyncAt>=0||status.tick<Math.round(p.seconds*60))throw new Error(`Replay failure ${dir}`);
 if(p.renderer && (p.renderer.backend!=='WebGPU'||!p.renderer.queue))throw new Error(`Native backend validation failed ${dir}`);
 const aggregate=createHash('sha256');
 for(const row of rows){const file=join(root,`f_${String(row.frame).padStart(5,'0')}.jpg`);if(!existsSync(file))throw new Error(`Missing ${file}`);aggregate.update(readFileSync(file));}
 const tape=p.replayPath?resolve(p.replayPath):join(root,'take.vgr');
 const audioWeapons=rows.reduce((n,r)=>n+r.audio.reduce((s,a)=>s+a.weaponEvents.length,0),0),tickWeapons=rows.reduce((n,r)=>n+r.events.length,0);
 if(audioWeapons!==tickWeapons)throw new Error(`Dropped weapon snapshot ${dir}: ${audioWeapons}/${tickWeapons}`);
 const missiles={};for(const r of rows)for(const a of r.audio)for(const m of a.missileEvents)missiles[m.kind]=(missiles[m.kind]??0)+1;
 report.takes.push({dir,frames:rows.length,firstFrame:first,lastFrame:rows.at(-1).frame,frameAggregateSHA256:aggregate.digest('hex'),eventsSHA256:hash(join(root,'events.jsonl')),provenance:p,replayStatus:status,sourceTape:tape,sourceTapeSHA256:hash(tape),audioWeapons,tickWeapons,missiles,deathTimes:[...new Set(rows.map(r=>r.state?.deadAt).filter(x=>x!=null))],maxWrecks:Math.max(...rows.map(r=>r.state?.wrecks.length??0))});
}
for(const s of ledger.shots){const n=Math.round(s.duration*30),first=Math.round(s.from*30);for(let i=0;i<n;i++)if(!existsSync(join(s.frames,`f_${String(first+i).padStart(5,'0')}.jpg`)))throw new Error(`Missing edited frame ${s.id}`);report.shots.push({...s,framesCount:n});}
writeFileSync(process.argv[3],JSON.stringify(report,null,2));console.log('Verified',report.takes.length,'takes and',report.shots.length,'shots');
