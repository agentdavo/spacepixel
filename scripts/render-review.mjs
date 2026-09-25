#!/usr/bin/env node
/** Reproducible M02 resource/recovery probes and M04 stock-hull plates. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv.find(x => x.startsWith('--out='))?.slice(6) ?? 'docs/reviews/render-reconciliation'), port = 5219;
mkdirSync(out, {recursive:true});
const server = await createServer({cacheDir:resolve('node_modules/.vite-review'),server:{port,host:'127.0.0.1',strictPort:true,hmr:false},logLevel:'warn'});
await server.listen();
const browser = await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
const results = {browser:browser.version(),errors:[],ships:[],refits:[],cycles:[]};
const ids = ['vf27-kestrel','sb9-warhorse','cr5-resolute','ffl3-valiant','choir-cathedral','civ-longhaul'];
const base = 'http://127.0.0.1:'+port+'/?scene=shipreview&record=24&shot=1&hud=0&voice=off&score=classic&calm=1&rendercheck=1&ship=';
try {
 const page=await browser.newPage({viewport:{width:600,height:400},deviceScaleFactor:1});
 await page.route('https://fonts.googleapis.com/**', route => route.fulfill({status:200,body:'',contentType:'text/css'}));
 await page.route('**/favicon.ico', route => route.fulfill({status:204}));
 page.on('pageerror',e=>results.errors.push(e.message));
 const ready=async()=>{await page.waitForFunction(()=>window.__VANGUARD__?.ready||window.__VANGUARD__?.error,null,{timeout:120000});const err=await page.evaluate(()=>window.__VANGUARD__.error);if(err)throw Error(err);};
 const step=()=>page.evaluate(()=>window.__VANGUARD__.hooks.step(1));
 for(const id of ids){
  await page.setViewportSize({width:600,height:400});
  await page.goto(base+id,{waitUntil:'commit'});await ready();
  for(const view of ['quarter','front','side','top']){
   await page.evaluate(v=>window.__VANGUARD__.hooks.review.setView(v),view);await step();await step();
   await page.screenshot({path:out+'/'+id+'-'+view+'.png'});
  }
  const data=await page.evaluate(()=>{
   const s=window.__VANGUARD__.hooks.review.ship,m=s.model,d=s.combat.dmg;
   return {id:m.blueprint.id,name:m.blueprint.name,blueprintClass:m.blueprint.shipClass,faction:m.blueprint.faction,
    length:m.length,bounds:{min:m.bounds.min.toArray(),max:m.bounds.max.toArray()},triangles:m.triangles,
    hull:s.hullMax,shield:s.shieldMax,facings:d.facings.length,capital:d.capital,shell:s.combat.shell.toArray(),
    systems:d.subsystems.map(x=>({id:x.id,kind:x.kind,position:[x.x,x.y,x.z],radius:x.radius,hp:x.hpMax})),
    turrets:[...m.turrets.values()].map(t=>({socket:t.socket,base:t.base.toArray(),up:t.up.toArray(),forward:t.fwd.toArray(),traverse:t.traverse,elevation:t.elevation})),
    guns:s.combat.loadout.guns,missiles:s.combat.loadout.missiles,sections:d.structure.sections.map(x=>({...x})),
    perf:window.__VANGUARD__.hooks.perf()};
  });results.ships.push(data);
  await page.setViewportSize({width:128,height:128});
  await page.evaluate(()=>window.__VANGUARD__.hooks.review.setView('top',true));
  await step();await page.screenshot({path:out+'/'+id+'-silhouette.png'});
  console.log('Captured '+data.name);
 }
 await page.setViewportSize({width:640,height:480});
 await page.goto(base+ids[0],{waitUntil:'commit'});await ready();
 await page.evaluate(async()=>{
  const {CATALOG_BY_ID}=await import('/src/game/shipyard/catalog.ts');
  const {stockFit,slotsFor}=await import('/src/game/outfitting/fit.ts');
  const {ITEMS}=await import('/src/game/outfitting/items.ts');
  const {applyFit}=await import('/src/game/outfitting/apply.ts');
  const e=CATALOG_BY_ID['vf27-kestrel'],fit=stockFit(e);
  const slot=slotsFor(e).find(x=>x.kind==='gun');
  const alt=ITEMS.find(x=>x.kind==='gun'&&x.size===slot.size&&x.id!==fit[slot.id]);
  if(!alt)throw Error('No alternate pod');
  window.refitProbe=()=>applyFit(window.__VANGUARD__.hooks.review.ship,e,{...fit,[slot.id]:alt.id});
 });
 for(let i=0;i<25;i++){
  await page.evaluate(()=>window.refitProbe());await step();await step();
  if(i>=5)results.refits.push(await page.evaluate(()=>window.__VANGUARD__.hooks.memory()));
 }
 for(let i=0;i<13;i++){
  await page.evaluate(()=>window.__VANGUARD__.hooks.loadScene('showcase'));await step();await step();
  await page.evaluate(()=>window.__VANGUARD__.hooks.loadScene('shipreview'));await step();await step();
  if(i>=3)results.cycles.push(await page.evaluate(()=>window.__VANGUARD__.hooks.memory()));
 }
 const stable = rows => ['geometries','textures','renderTargets','attributes','uniformBuffers','pipelines','programs'].every(k=>rows.at(-1)[k]<=rows[0][k]);
 results.refitStable=stable(results.refits);results.cycleStable=stable(results.cycles);
 const lose = () => page.evaluate(async()=>{
  // Three suppresses intentional device.destroy losses. Release the real GPU resources,
  // then inject its normal loss callback to exercise the application's recovery boundary.
  const r=window.__VANGUARD__.hooks.renderer(),device=r.backend.device;
  device.destroy();await device.lost;
  r.onDeviceLost({api:'WebGPU',reason:'unknown',message:'Injected recovery acceptance check'});
 });
 await page.evaluate(()=>localStorage.setItem('vanguard.review.recovery','preserved'));
 await lose();
 await page.getByRole('alertdialog').waitFor();
 await page.screenshot({path:out+'/device-loss.png'});
 await page.getByRole('button',{name:'Restart Vanguard',exact:true}).click();await page.waitForLoadState('domcontentloaded');await ready();await step();
 results.recovery=await page.evaluate(()=>({backend:window.__VANGUARD__.backend,saved:localStorage.getItem('vanguard.review.recovery')==='preserved'}));
 await lose();
 await page.getByRole('button',{name:'Restart with compatibility graphics'}).click();await page.waitForLoadState('domcontentloaded');await ready();await step();
 results.fallback=await page.evaluate(()=>window.__VANGUARD__.hooks.perf());
 await page.screenshot({path:out+'/webgl-fallback.png'});
 await page.evaluate(()=>localStorage.removeItem('vanguard.review.recovery'));
 // Exercise the actual hex shader on a live shield for both backends.
 results.shieldBackends=[];
 for(const backend of ['webgpu','webgl']) {
  const errors=[];const onConsole=m=>{if(m.type()==='error')errors.push(m.text());};
  page.on('console',onConsole);
  await page.goto('http://127.0.0.1:'+port+'/?scene=combat&stage=impacts&side=shield&backend='+backend+'&record=24&shot=1&hud=0&voice=off',{waitUntil:'commit'});await ready();
  for(let n=0;n<12;n++)await step();
  const perf=await page.evaluate(()=>window.__VANGUARD__.hooks.perf());
  await page.screenshot({path:out+'/shield-'+backend+'.png'});
  results.shieldBackends.push({requested:backend,backend:perf.backend,adapter:perf.adapter,errors});
  page.off('console',onConsole);
 }
 writeFileSync(out+'/evidence.json',JSON.stringify(results,null,2));
 if(results.errors.length||!results.refitStable||!results.cycleStable||!results.recovery.saved||results.fallback.backend!=='WebGL2'||results.shieldBackends.some(r=>r.errors.length||r.backend!==(r.requested==='webgpu'?'WebGPU':'WebGL2')))process.exitCode=1;
 console.log(JSON.stringify({errors:results.errors,refitStable:results.refitStable,cycleStable:results.cycleStable,recovery:results.recovery,fallback:results.fallback.backend}));
} finally {writeFileSync(out+'/evidence.json',JSON.stringify(results,null,2));await browser.close();await server.close();}
