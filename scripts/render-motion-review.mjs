#!/usr/bin/env node
/** Moving comparisons, real simulation at 24 fps; not performance measurements. Requires ffmpeg. */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const out=resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)??'docs/reviews/render-reconciliation'),port=5220;
mkdirSync(out,{recursive:true});
const cases=[
 {id:'capital-1080-dark',query:'stage=capital',width:1920,height:1080,scale:1},
 {id:'shield-720-dark',query:'stage=impacts&side=shield',width:1280,height:720,scale:.8},
 {id:'hull-720-bright',query:'stage=impacts&side=hull',width:1280,height:720,scale:.6,bright:true},
 {id:'reactor-1080-bright',query:'stage=kill&path=reactor&kt=0',width:1920,height:1080,scale:.8,bright:true},
 {id:'structural-720-dark',query:'stage=kill&path=structural&kt=0',width:1280,height:720,scale:.6},
 {id:'capital-1080-reduced',query:'stage=capital&calm=1',width:1920,height:1080,scale:1},
];
const server=await createServer({cacheDir:resolve('node_modules/.vite-motion'),server:{port,host:'127.0.0.1',strictPort:true,hmr:false},logLevel:'warn'});await server.listen();
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7);
const evidence=only?JSON.parse(readFileSync(out+'/motion-evidence.json','utf8')).filter(x=>x.requestedBackend+'-'+x.id!==only):[];
try {
 for(const backend of ['webgpu','webgl'])for(const c of cases){
  if(only&&only!==backend+'-'+c.id)continue;
  const row={...c,requestedBackend:backend,errors:[],fps:24,frames:48,brightDescription:c.bright?'Synthetic light grey background for contrast stress':'Authored Meridian backdrop'};
  const page=await browser.newPage({viewport:{width:c.width,height:c.height},deviceScaleFactor:1});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  page.on('pageerror',e=>row.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')row.errors.push(m.text()+' '+m.location().url);});
  await page.addInitScript(()=>{let seed=0x56414e47;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);});
  await page.goto('http://127.0.0.1:'+port+'/?scene=combat&record=24&shot=1&hud=0&voice=off&rendercheck=1&backend='+backend+'&'+c.query,{waitUntil:'commit'});
  await page.waitForFunction(()=>window.__VANGUARD__?.ready||window.__VANGUARD__?.error,null,{timeout:120000});
  const error=await page.evaluate(()=>window.__VANGUARD__.error);if(error)throw Error(error);
  await page.evaluate(async c=>{
   window.__VANGUARD__.hooks.renderScale(c.scale);
   if(c.bright){const {LIGHT_PRESETS}=await import('/src/render/LightRig.ts');const s=window.__VANGUARD__.hooks.scene;s.backdrop.group.visible=false;s.scene.background=LIGHT_PRESETS.meridian.keyColor.clone().set('#adbecf');}
  },c);
  const temp=mkdtempSync(join(tmpdir(),'vanguard-motion-'));
  for(let i=0;i<48;i++){
   await page.evaluate(()=>window.__VANGUARD__.hooks.step(1));
   await page.screenshot({path:join(temp,'f_'+String(i).padStart(3,'0')+'.jpg'),type:'jpeg',quality:85});
   if(i===32)await page.screenshot({path:out+'/'+backend+'-'+c.id+'.png'});
  }
  row.perf=await page.evaluate(()=>window.__VANGUARD__.hooks.perf());
  const file=backend+'-'+c.id+'.mp4';
  const encoded=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate','24','-i',join(temp,'f_%03d.jpg'),'-c:v','libx264','-crf','22','-pix_fmt','yuv420p',out+'/'+file],{encoding:'utf8'});
  if(encoded.status!==0)throw Error(encoded.stderr);
  row.file=file;evidence.push(row);await page.close();console.log('Captured '+file+'; errors '+row.errors.length);
 }
 const rows=evidence.map(e=>'<article><h2>'+e.requestedBackend+' / '+e.id+'</h2><p>'+e.width+'×'+e.height+' · scale '+e.scale+' · '+e.brightDescription+'</p><video controls loop preload="metadata" width="800" poster="'+e.requestedBackend+'-'+e.id+'.png" src="'+e.file+'"></video></article>').join('');
 writeFileSync(out+'/motion.html','<!doctype html><meta charset="utf-8"><title>Vanguard motion review</title><style>body{margin:40px;background:#0b1420;color:#d5e2ee;font:16px system-ui}video{max-width:100%;height:auto}article{margin:40px 0}a{color:#7bdff5}</style><h1>Combat readability / motion review</h1><p>Two-second deterministic clips at 24 fps. Review shield contact, hull impacts, damaged mounts, reactor flash and structural breakup. These are capture-rate comparisons, not real-time performance tests. Bright cases use a synthetic background to expose contrast problems.</p><a href="index.html">Six-hull atlas</a>'+rows);
 if(evidence.some(e=>e.errors.length))process.exitCode=1;
}finally{writeFileSync(out+'/motion-evidence.json',JSON.stringify(evidence,null,2));await browser.close();await server.close();}
