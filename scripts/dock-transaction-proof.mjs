#!/usr/bin/env node
/** Native dock UI fixture, not a flown mission. Disposable contexts only.
 * Requires an accepted committed source and an explicitly assigned GPU slot.
 * node scripts/dock-transaction-proof.mjs --run --accepted-source SHA --out DIR
 * Preparation: node --check scripts/dock-transaction-proof.mjs (no browser).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d;
if (!args.includes('--run')) throw new Error('Preparation only. Use --run after accepted source and GPU handoff.');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim();
const accepted = opt('accepted-source', '');
if (source !== accepted) throw new Error(`Pass the exact accepted capture HEAD: ${source}`);
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding:'utf8' }).trim()) throw new Error('Commit source changes before recording proof');
const out = resolve(opt('out', 'scratchpad/dock-transaction-proof'));
if (existsSync(out)) throw new Error('Use a new evidence directory; prior proof is immutable');
const port = Number(opt('port', '5428'));
const storeKey = opt('store-key', 'vanguard.career.v1');
const operations = opt('operations', 'buy,rearm,repair,shipyard,refit').split(',');
assert.ok(operations.every(x => ['buy','rearm','repair','shipyard','refit'].includes(x)));
mkdirSync(out, { recursive:true });
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const files = execFileSync('git', ['ls-files', 'src/game', 'src/ui', 'src/world/scenes/FlightScene.ts'], { encoding:'utf8' }).trim().split(/\r?\n/).filter(p => p.endsWith('.ts'));
const report = { source, fixture:'Documented dock=docked setup; seeded disposable career for affordability. No flown mission or user profile.', storeKey, sourceFiles:Object.fromEntries(files.map(p => [p,hash(p)])), harnessSHA256:hash('scripts/dock-transaction-proof.mjs'), cases:[], errors:[] };
writeFileSync(join(out,'harness.mjs'), readFileSync('scripts/dock-transaction-proof.mjs'));
const save = () => writeFileSync(join(out,'evidence.json'),JSON.stringify(report,null,2));
save();
const server = await createServer({ cacheDir:`node_modules/.vite-dock-proof-${port}`, logLevel:'warn', server:{ port, host:'127.0.0.1', strictPort:true, hmr:false, watch:{ignored:['**/*']} }, plugins:[{name:'dock-proof-seed',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__dock-proof.html')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable dock proof setup</title>');});}}] });
let browser;
const base = `http://127.0.0.1:${port}`;
const flight = `${base}/?scene=flight&record=30&demo=0&planes=0&traffic=0&voice=off`;

async function boot(page, url) {
  await page.goto(url,{waitUntil:'commit'});
  await page.waitForFunction(()=>window.__VANGUARD__?.error || window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.scene,null,{timeout:300000});
  const r=await page.evaluate(()=>{const v=window.__VANGUARD__;return {error:v.error,backend:v.backend,device:v.hooks.renderer().backend.device?.constructor.name};});
  assert.ok(!r.error,JSON.stringify(r));assert.equal(r.backend,'WebGPU');assert.equal(r.device,'GPUDevice');
  await page.evaluate(()=>window.__VANGUARD__.hooks.step(1));
  return r;
}
async function installObserver(page) {
  await page.evaluate(async key=>{
    const {getAudio}=await import('/src/audio/index.ts');
    const audio=getAudio(), ui=audio.ui;
    const nativeGet=Storage.prototype.getItem, nativeSet=Storage.prototype.setItem;
    const p=window.__dockProof={key,nativeGet,nativeSet,mode:null,faults:[],sounds:[]};
    audio.ui=function(...a){p.sounds.push(a[0]);return ui.apply(this,a);};
    const relevant=k=>k===key || k==='vanguard.trade.v1' || k==='vanguard.hangar.v1';
    Storage.prototype.getItem=function(k){if(this===localStorage&&p.mode==='read'&&relevant(k)){p.faults.push({operation:'getItem',key:k});throw new DOMException('Injected dock read failure','SecurityError');}return nativeGet.call(this,k);};
    Storage.prototype.setItem=function(k,v){if(this===localStorage&&p.mode==='write'&&relevant(k)){p.faults.push({operation:'setItem',key:k});throw new DOMException('Injected dock write failure','QuotaExceededError');}return nativeSet.call(this,k,v);};
  },storeKey);
}
async function snapshot(page) {
  return page.evaluate(()=>{
    const S=window.__VANGUARD__.hooks.scene,p=window.__dockProof;
    const keys=[p.key,'vanguard.trade.v1','vanguard.hangar.v1'];
    return {ledger:structuredClone(S.ledger),hangar:structuredClone(S.outfit.hangar),player:{hull:S.player.hull,hullMax:S.player.hullMax,blueprint:S.player.model.blueprint.id,loadout:structuredClone(S.player.combat.loadout)},stored:Object.fromEntries(keys.map(k=>[k,p.nativeGet.call(localStorage,k)]))};
  });
}
async function planOperation(page, operation) {
  // Read-only pure calculations identify one affordable transaction and its
  // exact expected result; the transaction itself is performed by DOM clicks.
  return page.evaluate(async operation=>{
    const S=window.__VANGUARD__.hooks.scene,l=S.ledger,h=S.outfit.hangar,st=S.docking.target;
    const E=await import('/src/game/economy.ts'),H=await import('/src/game/outfitting/hangar.ts'),F=await import('/src/game/outfitting/fit.ts');
    if(operation==='buy'){
      for(const c of E.COMMODITIES){const r=E.buy(l,st,c.id,1);if(r.units===1)return {selector:`[data-buy="${c.id}"]`,ledger:r.ledger,hangar:h,cost:r.total};}
    }
    if(operation==='rearm'){const r=E.rearm(l,st);if(r.cost>0)return {selector:'[data-act="rearm"]',ledger:r.ledger,hangar:h,cost:r.cost};}
    if(operation==='repair'){
      const r=E.repair(l,st,S.player.hull/S.player.hullMax,Math.sqrt(Math.max(1,S.player.hullMax/110)),1);
      if(r.cost>0){const next=structuredClone(h);H.activeShip(next).condition=r.hull;return {selector:'[data-act="repair"]',ledger:r.ledger,hangar:next,cost:r.cost,condition:r.hull};}
    }
    if(operation==='shipyard'){
      const list=H.hullsAt(st);
      for(const [i,e] of list.entries()){
        if(e.id===S.player.model.blueprint.id)continue;
        const r=H.buyHull(h,l,e.id,st,{tradeIn:false,condition:S.outfit.condition()});
        if(!r.error)return {tab:'shipyard',row:h.ships.length+i,selector:'.sy [data-act="keep"]',ledger:r.ledger,hangar:r.hangar,cost:l.credits-r.ledger.credits};
      }
    }
    if(operation==='refit'){
      const ship=H.activeShip(h),slots=F.slotsFor(H.entryOf(ship));
      for(const [si,s] of slots.entries())for(const [pi,offer] of H.itemsAt(st,s,l).entries()){
        if(offer.lock||offer.item.id===ship.fit[s.id])continue;
        const r=H.buyItem(h,l,ship.uid,s.id,offer.item.id,st);
        if(!r.error)return {tab:'outfitting',slot:si,pick:pi,selector:'.of [data-act="buy"]',ledger:r.ledger,hangar:r.hangar,cost:l.credits-r.ledger.credits,item:offer.item.id,slotId:s.id};
      }
    }
    throw new Error('Fixture offers no valid '+operation);
  },operation);
}
async function selectOperation(page, p) {
  if(p.tab)await page.locator('.dock-tabs button').filter({hasText:p.tab.toUpperCase()}).click();
  if(p.row!==undefined)await page.locator(`.sy [data-row="${p.row}"]`).click();
  if(p.slot!==undefined){await page.locator(`.of [data-slot="${p.slot}"]`).click();await page.locator(`.of [data-pick="${p.pick}"]`).click();}
  assert.ok(await page.locator(p.selector).isEnabled());
}

try {
  await server.listen();
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
  for(const operation of operations)for(const fault of ['write','read']){
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const evidence={operation,fault,status:'running'};report.cases.push(evidence);save();
    try{
      await page.goto(`${base}/__dock-proof.html`);
      const station=await page.evaluate(async()=>{
        const E=await import('/src/game/economy.ts'),H=await import('/src/game/outfitting/hangar.ts');
        const {generateUniverse}=await import('/src/universe/generate.ts');
        const st=[...generateUniverse(1994).systems.values()].flatMap(s=>s.stations).find(s=>s.faction==='concord'&&s.kind==='bastion');
        if(!st)throw new Error('No documented fixture station');
        const l=E.newLedger();l.credits=2000000;l.missiles=3;l.rep={...l.rep,concord:80,choir:80,rustwake:80};l.lastDock=st.id;
        const h=H.newHangar();H.activeShip(h).condition=.62;
        localStorage.setItem('vanguard.trade.v1',JSON.stringify(l));localStorage.setItem('vanguard.hangar.v1',JSON.stringify(h));
        return st.id;
      });
      evidence.renderer=await boot(page,`${flight}&dock=docked&station=${encodeURIComponent(station)}`);
      await page.locator('.dock-screen').waitFor();
      await installObserver(page);
      const p=await planOperation(page,operation);evidence.plan=p;
      await selectOperation(page,p);
      const before=await snapshot(page);evidence.before=before;
      const previousSuccessText=await page.locator('.dock-log .ok,.sy-note.ok,.of-note.ok').allTextContents();
      await page.evaluate(mode=>{const p=window.__dockProof;p.mode=mode;p.faults=[];p.sounds=[];},fault);
      await page.locator(p.selector).click();
      const failed=await snapshot(page);evidence.failed=failed;
      const failureUi=await page.locator('.dock-log .err,.sy-note.err,.of-note.err,[role="alert"]').allTextContents();
      evidence.failureUi=failureUi;evidence.faults=await page.evaluate(()=>window.__dockProof.faults);evidence.failureSounds=await page.evaluate(()=>window.__dockProof.sounds);
      assert.ok(evidence.faults.length,'Fault must actually intercept storage');
      assert.deepEqual(failed,before,'Failed transaction changed runtime or durable state');
      assert.match(failureUi.join(' '),/not saved|save failed|storage|unavailable|could not/i);
      assert.ok(!evidence.failureSounds.includes('confirm'),'Failure played a success cue');
      assert.equal(await page.locator('.sy-note.ok,.of-note.ok').count(),0);
      const failedSuccessText=await page.locator('.dock-log .ok,.sy-note.ok,.of-note.ok').allTextContents();
      assert.ok(failedSuccessText.every(t=>previousSuccessText.includes(t)),'Failure added success text');
      await page.screenshot({path:join(out,`${operation}-${fault}-failed.png`)});
      await page.evaluate(()=>{window.__dockProof.mode=null;window.__dockProof.sounds=[];});
      await page.locator(p.selector).click(); // exactly one successful retry
      const success=await snapshot(page);evidence.success=success;
      assert.deepEqual(success.ledger,p.ledger,'Retry must apply exactly one transaction');
      assert.deepEqual(success.hangar,p.hangar,'Retry must retain exact hangar/fit/condition');
      assert.equal(before.ledger.credits-success.ledger.credits,p.cost);
      assert.ok(success.stored[storeKey],'Durable career envelope missing');
      await page.screenshot({path:join(out,`${operation}-${fault}-retry.png`)});
      // Remove fixture flags on reload: dock=docked resets hull to62%, while
      // cargo=demo replaces money/cargo. Either would invalidate this proof.
      await boot(page,flight);
      await installObserver(page);
      const reloaded=await snapshot(page);evidence.reloaded=reloaded;
      assert.deepEqual(reloaded.ledger,success.ledger,'Reload changed ledger after one retry');
      assert.deepEqual(reloaded.hangar,success.hangar,'Reload lost ship or fitted item');
      assert.equal(reloaded.player.blueprint,success.player.blueprint);
      assert.ok(Math.abs(reloaded.player.hull/reloaded.player.hullMax-success.player.hull/success.player.hullMax)<1e-8,'Reload lost hull condition');
      assert.deepEqual(reloaded.player.loadout,success.player.loadout);
      assert.deepEqual(errors,[],'Unexpected browser errors');
      evidence.status='passed';console.log('PASS',operation,fault);save();
    }catch(e){evidence.status='failed';evidence.error=String(e.stack??e);evidence.pageErrors=errors;await page.screenshot({path:join(out,`${operation}-${fault}-unexpected.png`)}).catch(()=>{});save();throw e;}
    finally{await context.close();}
  }
  report.status='passed';save();
}catch(e){report.status='failed';report.errors.push(String(e.stack??e));save();throw e;}
finally{await browser?.close();await server.close();}
