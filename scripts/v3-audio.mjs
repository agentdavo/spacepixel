#!/usr/bin/env node
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [ledgerPath, out = 'scratchpad/delivery/v3/stems'] = process.argv.slice(2);
const prefix=process.argv.includes('--prefix')?process.argv[process.argv.indexOf('--prefix')+1]:'v3';
if (!ledgerPath) throw new Error('Usage: node scripts/v3-audio.mjs edit-ledger.json output-directory');
const ledger = JSON.parse(readFileSync(ledgerPath,'utf8'));
const frames = [];
for (const shot of ledger.shots) {
  if (!shot.events) continue;
  for (const line of readFileSync(shot.events,'utf8').trim().split(/\r?\n/)) {
    const f = JSON.parse(line);
    const time = f.frame/30;
    if (time < shot.from || time >= shot.from + shot.duration) continue;
    for (const a of f.audio) frames.push({ ...a, at: shot.at + time-shot.from, frame: frames.length, timeline: shot.at+time-shot.from, shot: shot.id });
  }
}
frames.sort((a,b) => a.at-b.at);
mkdirSync(out,{recursive:true});
writeFileSync(`${out}/edited-events.json`,JSON.stringify(frames));
const server=await createServer({cacheDir:'node_modules/.vite-v3-audio',server:{port:5418,host:'127.0.0.1',strictPort:true,hmr:false,watch:null},logLevel:'warn',plugins:[{name:'blank-audio',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__audio.html')return next();res.end('<html><title>Audio render</title></html>');});}}]});
await server.listen();
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
try {
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5418/__audio.html');
  const audit=[];
  for(const stem of (process.argv.includes('--sfx-only') ? ['sfx'] : ['music','sfx'])) {
    const result=await page.evaluate(async ({frames,ledger,stem})=>{
      const {renderCapturedStem}=await import('/src/audio/offline.ts');
      return renderCapturedStem(frames,ledger.duration,stem,ledger.music??[]);
    },{frames,ledger,stem});
    result.name=`${prefix}-${stem}`;
    writeFileSync(`${out}/${prefix}-${stem}.wav`,Buffer.from(result.wav,'base64'));
    delete result.wav; audit.push(result); console.log(result);
  }
  writeFileSync(`${out}/audio-audit.json`,JSON.stringify(audit,null,2));
} finally {await browser.close();await server.close();}
