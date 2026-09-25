#!/usr/bin/env node
/** V3 deterministic staged gameplay: stock healthy ships, normal simulation after setup. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d;
const out = resolve(opt('out', 'scratchpad/delivery/v3/proof'));
const port = Number(opt('port', '5410'));
const seconds = Number(opt('seconds', '180'));
const probe = args.includes('--probe');
const scenario = opt('scenario', 'capital');
const from = Number(opt('from', '0'));
const replayPath = opt('replay', '');
const replay = replayPath ? JSON.parse(readFileSync(replayPath, 'utf8')) : null;
const camera = opt('camera', '');
const cameraScale = Number(opt('camera-scale', '1'));
const cameraTag = opt('camera-tag','');
const pilot = args.includes('--pilot');
const episode = opt('episode', replay?.commands?.find(c=>c.c==='episode')?.a??'');
const route = opt('route','') ? JSON.parse(readFileSync(opt('route',''),'utf8')) : [];
const routeUntil = Number(opt('route-until','1e9'));
const plan = opt('inputs', '') ? JSON.parse(readFileSync(opt('inputs', ''), 'utf8')) : [];
if (existsSync(`${out}/events.jsonl`)) throw new Error('Choose a new output directory; capture logs cannot be appended to old takes');
mkdirSync(out, { recursive: true });
const sourceFiles = Object.fromEntries(['scripts/v3-gameplay.mjs','src/cinema/gameplaySetup.ts','src/cinema/loreFlightSetup.ts','src/world/scenes/FlightScene.ts','src/world/EventTap.ts','src/game/CampaignSession.ts','src/game/CampaignRunner.ts','src/game/campaign/missions.ts','src/ui/Comms.ts','src/sim/CameraDirector.ts'].map(p => [p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
writeFileSync(`${out}/capture-harness.mjs`, readFileSync('scripts/v3-gameplay.mjs'));
const server = await createServer({ cacheDir: `node_modules/.vite-v3-${port}`, server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: { ignored:['**/*'] } }, logLevel: 'warn', plugins: [{ name: 'v3-replay', configureServer(s) { s.middlewares.use((req,res,next) => { if (req.url !== '/__v3-tape.json') return next(); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(replay)); }); } }] });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const held = new Set();
  const keyState = async (key,down) => { if(held.has(key)===down)return; if(down)held.add(key);else held.delete(key);await page.keyboard[down?'down':'up'](key); };
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.error('PAGEERROR', e.message); });
  const q = new URLSearchParams(replay?.header.boot ?? 'scene=flight&record=30&demo=0&hud=1&quality=high&dynres=0&traffic=0&planes=0&seed=1994&score=nexus&voice=off');
  if (!replay && scenario === 'capital') { q.set('own','ffl3-valiant'); q.set('bridge','1'); q.set('captureSetup','v3-capital'); }
  if (!replay) for (const [k,v] of new URLSearchParams(opt('query',''))) q.set(k,v);
  if (replay) { q.set('replay','/__v3-tape.json'); q.set('rseek',String(plan.length || args.includes('--replay-from-start') ? 0 : Math.max(0,from-10))); }
  const query = q.toString();
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__VANGUARD__?.error || (window.__VANGUARD__?.ready && window.__VANGUARD__?.hooks?.step), null, { timeout: 300000 });
  const status = await page.evaluate(() => { const v=window.__VANGUARD__, device=v.hooks.renderer().backend.device; return { error:v.error, backend:v.backend, device:device?.constructor.name, queue:!!device?.queue }; });
  if (status.error || status.backend !== 'WebGPU' || !status.queue) throw new Error(JSON.stringify(status));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `.hud-debug,.hud-graph,.replay-deck,.replay-toast {display:none!important}${args.includes('--clean') ? '#ui-root {visibility:hidden!important}' : ''}` });
  if (episode && !replay) await page.evaluate(async id => { const {MISSIONS}=await import('/src/game/campaign/missions.ts'); const m=MISSIONS.find(m=>m.id===id); if(!m)throw new Error('Unknown episode'); void window.__VANGUARD__.hooks.scene.startCampaign(m); },episode);
  if (replay) {
    while (await page.evaluate(() => window.__VANGUARD__.hooks.replay.state().seeking)) await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
  }
  const initial = await page.evaluate(async () => {
    const S = window.__VANGUARD__.hooks.scene;
    const { snapshotAudioFrame } = await import('/src/cinema/recording.ts');
    const target = S.lock.target;
    const subjects = S.fleet.ships.filter(s => s.alive);
    window.__v3 = { S, target, subjects, audio: [], ticks: [], inputs: [], deadAt: null };
    const originalTick = S.simStep.bind(S);
    S.simStep = () => {
      originalTick();
      const v = window.__v3;
      v.inputs.push({ tick: S.simTick, ...S.player.controls });
      for (const e of S.weapons.events) v.ticks.push({ tick: S.simTick, kind: e.kind, ship: e.ship?.id, shooter: e.shooter?.id, sub: e.sub?.id, amount: e.amount, cause: e.cause, turret: e.turret });
      if (!S.campaign && target && !target.alive && v.deadAt === null) v.deadAt = S.simTick / 60;
    };
    const audioUpdate = S.audio.update.bind(S.audio);
    S.audio.update = f => { window.__v3.audio.push({ tick: S.simTick, ...snapshotAudioFrame(f), player: { ...f.player, position: { ...f.player.position }, velocity: { ...f.player.velocity } }, jumpPhase: f.jumpPhase, combatIntensity: f.combatIntensity }); audioUpdate(f); };
    return subjects.map(s => ({ id: s.id, name: s.name, blueprint: s.model.blueprint.id, pos: s.flight.position.toArray(), orientation: s.flight.orientation.toArray(), hull: s.hull, hullMax: s.hullMax, shield: s.shield, shieldMax: s.shieldMax, loadout: s.combat.loadout }));
  });
  const scenery = await page.evaluate(() => window.__v3.S.loreFlight?.provenance ?? null);
  writeFileSync(`${out}/provenance.json`, JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceFiles, renderer:status, query, seed: 1994, fps: 30, probe, from, seconds, replayPath, camera, cameraScale, cameraTag, pilot, episode, route, routeUntil, fastPreroll:args.includes("--fast-preroll"), replayFromStart:args.includes("--replay-from-start"), initial, scenery, kind: episode?'native campaign gameplay':'deterministic staged gameplay', policy: 'No health/shield/damage/death/pose writes after initial setup. Normal FlightScene simulation and stock fits. Pilot/route options read positions and send ordinary mouse/keyboard controls. Episode starts through the normal recorded campaign API before the first tick; mission flags are never forced.', inputs: plan }, null, 2));
  let ended = false;
  let cameraApplied = false;
  let f = -1;
  let outputFrames = 0;
  let routeIndex = 0;
  const joystick=e=>{const control=Math.min(0.95,Math.abs(e)*2.5);return Math.sign(e)*(0.06+0.94*(-0.35+Math.sqrt(0.1225+2.6*control))/1.3);};
  for (let attempt = 0; attempt < (seconds+15) * 30 && !ended; attempt++) {
    const tick = await page.evaluate(() => window.__v3.S.simTick);
    if (tick / 60 >= seconds) break;
    if (!cameraApplied && camera && tick / 60 >= from - 1) {
      await page.evaluate(({camera,cameraScale,cameraTag}) => { const { S, target } = window.__v3,t=cameraTag?S.campaign?.runner.shipsTagged(cameraTag)[0]:target; if(cameraTag&&!t)throw new Error('Missing camera subject '+cameraTag); if(camera==='tactical')S.director.tacticalHeight=1800*cameraScale; S.director.cut(camera,t?{position:t.flight.position,velocity:t.flight.velocity,radius:t.radius*cameraScale}:null,Infinity,S.player.flight); }, {camera,cameraScale,cameraTag});
      cameraApplied = true;
    }
    for (const cue of plan) {
      if (tick === Math.round(cue.at*60)) await page.keyboard.down(cue.key);
      if (tick === Math.round((cue.at+(cue.dur ?? 1/30))*60)) await page.keyboard.up(cue.key);
    }
    if (route.length && !replay && tick/60<routeUntil) {
      const waypoint=route[routeIndex];
      const nav=await page.evaluate(w=>{const S=window.__v3.S,r=S.campaign.runner,p=S.player.flight,t=r.resolve({at:'tag',tag:w.tag,offset:[0,0,0]});if(!t)throw new Error('Missing route tag '+w.tag);const d=t.clone().sub(p.position),range=d.length();d.applyQuaternion(p.orientation.clone().invert());return{range,yaw:Math.atan2(d.x,d.z),pitch:Math.atan2(d.y,Math.hypot(d.x,d.z)),throttle:p.throttle,maxSpeed:p.spec.maxSpeed,targetSpeed:r.shipsTagged(w.tag)[0]?.flight.speed??0};},waypoint);
      if(nav.range<waypoint.within && routeIndex<route.length-1)routeIndex++;
      await page.mouse.move(640*(1-joystick(nav.yaw)),360*(1-joystick(nav.pitch)));
      const angle=Math.hypot(nav.yaw,nav.pitch),desired=angle>0.6?0.1:Math.max(0,Math.min(1,(nav.targetSpeed+(nav.range-waypoint.within*0.45)*0.7)/nav.maxSpeed));
      for(const [key,down] of [['KeyW',nav.throttle<desired-0.025],['KeyS',nav.throttle>desired+0.025],['ShiftLeft',nav.range>3000&&angle<0.08],['Space',false],['KeyF',false]])await keyState(key,down);
    } else if (pilot && !replay) {
      await page.keyboard.up('ShiftLeft');
      const aim = await page.evaluate(() => {
        const S=window.__v3.S, t=S.lock.target, p=S.player.flight;
        if (!t?.alive) return null;
        if(S.campaign){const tag=S.campaign.runner.tagOf(t);const spec=S.campaign.mission.spawns.find(s=>tag===s.tag||tag?.startsWith(s.tag+'-'));if(spec?.role!=='hostile')return null;}
        const range=t.flight.position.distanceTo(p.position);
        const v=t.flight.position.clone().addScaledVector(t.flight.velocity,range/2000).sub(p.position).applyQuaternion(p.orientation.clone().invert());
        return { yaw:Math.atan2(v.x,v.z),pitch:Math.atan2(v.y,Math.hypot(v.x,v.z)),range,locked:S.lock.locked };
      });
      if (aim) {
        await page.keyboard.up('KeyT');
        await page.mouse.move(640*(1-joystick(aim.yaw)),360*(1-joystick(aim.pitch)));
        if (Math.abs(aim.yaw)<0.14 && Math.abs(aim.pitch)<0.14 && aim.range<1500) await page.keyboard.down('Space'); else await page.keyboard.up('Space');
        if (aim.range>1000) await page.keyboard.down('KeyW'); else await page.keyboard.up('KeyW');
        if (aim.range<350) await page.keyboard.down('KeyS'); else await page.keyboard.up('KeyS');
        if (aim.locked && tick%180===0) await page.keyboard.down('KeyF'); else await page.keyboard.up('KeyF');
      } else {
        await page.keyboard.up('Space'); await page.keyboard.up('KeyF');
        if (tick%30===0) await page.keyboard.down('KeyT'); else await page.keyboard.up('KeyT');
      }
    }
    f++;
    if ((probe || (args.includes('--fast-preroll') && tick/60<from-5)) && f % 30 !== 0) {
      await page.evaluate(async () => { const S = window.__v3.S, {input}=await import('/src/core/Input.ts'); input.sample(S.simTick/60); input.beginTick(true); S.simStep(); input.beginTick(false); S.simStep(); input.endTicks(2,false); S.update({ dt: 1/30, time: S.simTick/60, alpha: 0, frame: S.simTick/2, ticks: 2 }); });
    } else await page.evaluate(() => window.__VANGUARD__.hooks.step(1));
    const sample = await page.evaluate(() => {
      const v = window.__v3, S = v.S, t = S.campaign ? S.lock.target : v.target;
      const frame = { tick: S.simTick, at: S.simTick/60, audio: v.audio.splice(0), events: v.ticks.splice(0), camera: S.cameraLabel(), controls: v.inputs.splice(0) };
      if (S.simTick % 60 === 0) frame.state = { player: { hull: S.player.hull, shield: S.player.shield }, target: t && { alive: t.alive, hull: t.hull, shield: t.shield, facings: t.combat.dmg.facings, subsystems: t.combat.dmg.subsystems.map(s => ({ id: s.id, hp: s.hp, destroyed: s.destroyed })), structure: t.combat.dmg.structure }, wrecks: S.fleet.destruction.wrecks.map(w => ({ ship: w.ship.id, cause: w.cause, position: w.position.toArray(), age: w.age })), deadAt: v.deadAt };
      if (frame.state && S.campaign) frame.state.campaign={mission:S.campaign.mission.id,time:S.campaign.runner.time,state:[...S.campaign.runner.state],flags:[...S.campaign.runner.flags],outcome:S.campaign.runner.outcome,comms:S.campaign.comms.typedEl.textContent,position:S.player.flight.position.toArray(),ships:S.campaign.runner.snapshot().ships};
      return frame;
    });
    const frame = Math.round(sample.at*30)-1;
    if (sample.at > from) {
      outputFrames++;
      appendFileSync(`${out}/events.jsonl`, JSON.stringify({ frame, ...sample })+'\n');
      if (!probe || f % 300 === 0) await page.screenshot({ path: `${out}/f_${String(frame).padStart(5,'0')}.jpg`, type: 'jpeg', quality: 94 });
    }
    if (sample.state && sample.tick % 600 === 0) console.log(JSON.stringify({ at: sample.at, player: sample.state.player, target: sample.state.target && { hull: sample.state.target.hull, shield: sample.state.target.shield, alive: sample.state.target.alive }, wrecks: sample.state.wrecks.length, deadAt: sample.state.deadAt, campaign: sample.state.campaign && {state:sample.state.campaign.state,flags:sample.state.campaign.flags,comms:sample.state.campaign.comms} }));
    if(!replay && sample.tick%600===0)writeFileSync(`${out}/take-checkpoint.vgr`,JSON.stringify(await page.evaluate(()=>window.__VANGUARD__.hooks.replay.clip(1e9))));
  }
  const replayStatus = await page.evaluate(() => window.__VANGUARD__.hooks.replay.state());
  if (pageErrors.length || outputFrames !== Math.round((seconds-from)*30) || replayStatus.desyncAt >= 0 || replayStatus.tick < Math.round(seconds*60)) throw new Error(`Capture validation failed: ${JSON.stringify({replayStatus,pageErrors,outputFrames})}`);
  const tape = replay ?? await page.evaluate(() => window.__VANGUARD__.hooks.replay.clip(1e9));
  writeFileSync(`${out}/take.vgr`, JSON.stringify(tape));
  writeFileSync(`${out}/replay-status.json`, JSON.stringify(replayStatus, null, 2));
  console.log('DONE', out);
} finally { await browser.close(); await server.close(); }
