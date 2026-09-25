#!/usr/bin/env node
/** Real Web Audio regression, no GPU or physical speaker claims. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='scratchpad/combat-audio-validation';mkdirSync(out,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5212,strictPort:true,hmr:false,watch:null},logLevel:'error',plugins:[{name:'audio-check',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__audio-check')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Audio verification</title><body></body>');});}}]});
await server.listen();const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--disable-gpu']});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>console.log(m.text()));await page.goto('http://127.0.0.1:5212/__audio-check');
  const report=await page.evaluate(async()=>{
    const {AudioEngine}=await import('/src/audio/AudioEngine.ts');
    const {Sfx}=await import('/src/audio/Sfx.ts');
    const {WEAPON_VOICES,MISSILE_VOICES}=await import('/src/audio/combatSounds.ts');
    const sampleRate=24000;
    const energy=(b,c,start=0,end=b.duration)=>{const a=b.getChannelData(c);let sum=0;for(let i=Math.floor(start*sampleRate);i<Math.min(a.length,end*sampleRate);i++)sum+=a[i]*a[i];return sum;};
    const stats=b=>{let peak=0,hash=2166136261;for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c)){peak=Math.max(peak,Math.abs(x));hash=Math.imul(hash^Math.round(x*32767),16777619);}return {peak,hash:hash>>>0,energy:Array.from({length:b.numberOfChannels},(_,c)=>energy(b,c))};};
    const result={weapons:{},missiles:{},positions:[],channels:[],center:[],headphones:{},beam:{},fallback:{},surroundPeak:0,surroundPcm:[],auditionPcm:[[],[]],auditionOrder:[]};
    const audition=(id,b)=>{result.auditionOrder.push(id);for(let c=0;c<2;c++)for(const x of b.getChannelData(c))result.auditionPcm[c].push(Math.round(Math.max(-1,Math.min(1,x))*32767));};
    for(const id of Object.keys(WEAPON_VOICES)){
      console.log('Rendering weapon',id);
      const ctx=new OfflineAudioContext(2,sampleRate,sampleRate);const e=new AudioEngine({context:ctx});const s=new Sfx(e);
      s.weapon(id,{x:0,y:0,z:-10},{x:0,y:0,z:0},0.8,true);
      const b=await ctx.startRendering();result.weapons[id]=stats(b);audition(id,b);
    }
    for(const id of Object.keys(MISSILE_VOICES)){
      const ctx=new OfflineAudioContext(2,sampleRate,sampleRate);const e=new AudioEngine({context:ctx});const s=new Sfx(e);
      s.warhead(id,false,false,{x:0,y:0,z:-10},{x:0,y:0,z:0},true);
      const b=await ctx.startRendering();result.missiles[id]=stats(b);audition(id,b);
    }
    // Verify a real weapon traverses the complete source-to-speaker graph.
    for(const degrees of [-30,30,0,-110,110]){
      const ctx=new OfflineAudioContext(6,sampleRate,sampleRate);const e=new AudioEngine({context:ctx});await e.setOutputMode('surround');const s=new Sfx(e);s.setListener({x:0,y:0,z:0,w:1});
      const a=degrees*Math.PI/180;s.weapon('laser',{x:Math.sin(a)*20,y:0,z:-Math.cos(a)*20},{x:0,y:0,z:0},1);
      result.positions.push(stats(await ctx.startRendering()).energy);
    }
    {
      const ctx=new OfflineAudioContext(6,sampleRate*5,sampleRate);const e=new AudioEngine({context:ctx});
      console.log('Loading surround processor');
      const mode=await e.setOutputMode('surround');if(mode!=='surround')throw Error(e.outputReason);
      console.log('Rendering six channels');e.testChannels();const b=await ctx.startRendering();
      for(let i=0;i<6;i++)result.channels.push(Array.from({length:6},(_,c)=>energy(b,c,0.1+i*0.7,0.55+i*0.7)));
      result.surroundPeak=stats(b).peak;
      // Small, actual six-channel PCM artifact for speaker identification.
      result.surroundPcm=Array.from({length:6},(_,c)=>Array.from(b.getChannelData(c),x=>Math.round(Math.max(-1,Math.min(1,x))*32767)));
    }
    {
      const ctx=new OfflineAudioContext(6,sampleRate,sampleRate);const e=new AudioEngine({context:ctx});await e.setOutputMode('surround');
      const osc=ctx.createOscillator(),g=ctx.createGain();g.gain.value=0.1;osc.connect(g).connect(e.voice);osc.start();osc.stop(0.5);result.center=stats(await ctx.startRendering()).energy;
    }
    for(const side of [-1,1]){
      console.log('Rendering HRTF',side);
      const ctx=new OfflineAudioContext(2,sampleRate,sampleRate);const e=new AudioEngine({context:ctx});await e.setOutputMode('headphones');const s=new Sfx(e);s.setListener({x:0,y:0,z:0,w:1});s.weapon('laser',{x:side*20,y:0,z:-5},{x:0,y:0,z:0},1);result.headphones[side]=stats(await ctx.startRendering());
    }
    {
      const ctx=new OfflineAudioContext(2,sampleRate*2,sampleRate);const e=new AudioEngine({context:ctx});const s=new Sfx(e);const beam={id:1,active:true,origin:{x:0,y:0,z:-5},owner:{isPlayer:false,faction:'choir',radius:300},gun:{sound:'capital-lance'}};
      console.log('Rendering sustained beam');
      const step=()=>s.updateBeams(ctx.currentTime<0.8?[beam]:[],{x:0,y:0,z:0});step();
      for(let k=1;k*1024<sampleRate*2;k++)ctx.suspend(k*1024/sampleRate).then(()=>{step();ctx.resume();});
      const b=await ctx.startRendering();result.beam={sustain:energy(b,0,0.4,0.7),tail:energy(b,0,1.3,1.8),...stats(b)};
    }
    {
      const e=new AudioEngine({context:new OfflineAudioContext(2,sampleRate,sampleRate)});result.fallback={mode:await e.setOutputMode('surround'),reason:e.outputReason};
    }
    return result;
  });
  for(const [id,s] of Object.entries(report.weapons)){assert.ok(s.energy[0]>0,`${id} silent`);assert.ok(s.peak<0.99,`${id} clips`);}
  assert.equal(new Set(Object.values(report.weapons).map(s=>s.hash)).size,Object.keys(report.weapons).length,'every weapon has a distinct waveform');
  assert.equal(new Set(Object.values(report.missiles).map(s=>s.hash)).size,3);
  for(const [id,s] of Object.entries(report.missiles)){assert.ok(s.energy[0]>0,`${id} silent`);assert.ok(s.peak<0.99,`${id} clips`);}
  report.positions.forEach((row,i)=>{const speaker=[0,1,2,4,5][i];assert.ok(row[speaker]>0.01);row.forEach((v,c)=>{if(c!==speaker)assert.ok(v<1e-7,`weapon position ${i} leaks into ${c}`);});});
  report.channels.forEach((row,i)=>{assert.ok(row[i]>1,`speaker ${i} silent`);row.forEach((v,c)=>{if(c!==i)assert.ok(v<1e-8,`speaker ${i} leaks into ${c}`);});});
  assert.ok(report.center[2]>1);report.center.forEach((v,c)=>{if(c!==2)assert.ok(v<1e-8,'dialogue leaks');});
  assert.ok(report.headphones[-1].energy[0]>report.headphones[-1].energy[1]);assert.ok(report.headphones[1].energy[1]>report.headphones[1].energy[0]);
  assert.ok(report.beam.sustain>1,'beam loses sustain');assert.ok(report.beam.tail<1e-8,'beam fails to stop');assert.equal(report.fallback.mode,'stereo');
  // WAVE_FORMAT_EXTENSIBLE, PCM16, explicit 5.1 speaker mask 0x3f.
  const pcm=report.surroundPcm;delete report.surroundPcm;const frames=pcm[0].length,bytes=frames*12;const wav=Buffer.alloc(68+bytes);
  wav.write('RIFF',0);wav.writeUInt32LE(60+bytes,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(40,16);wav.writeUInt16LE(0xfffe,20);wav.writeUInt16LE(6,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(24000*12,28);wav.writeUInt16LE(12,32);wav.writeUInt16LE(16,34);wav.writeUInt16LE(22,36);wav.writeUInt16LE(16,38);wav.writeUInt32LE(0x3f,40);Buffer.from('0100000000001000800000aa00389b71','hex').copy(wav,44);wav.write('data',60);wav.writeUInt32LE(bytes,64);
  for(let i=0;i<frames;i++)for(let c=0;c<6;c++)wav.writeInt16LE(pcm[c][i],68+(i*6+c)*2);
  writeFileSync(`${out}/speaker-test-5.1.wav`,wav);
  const stereo=report.auditionPcm;delete report.auditionPcm;const size=stereo[0].length*4,preview=Buffer.alloc(44+size);
  preview.write('RIFF',0);preview.writeUInt32LE(size+36,4);preview.write('WAVEfmt ',8);preview.writeUInt32LE(16,16);preview.writeUInt16LE(1,20);preview.writeUInt16LE(2,22);preview.writeUInt32LE(24000,24);preview.writeUInt32LE(96000,28);preview.writeUInt16LE(4,32);preview.writeUInt16LE(16,34);preview.write('data',36);preview.writeUInt32LE(size,40);
  for(let i=0;i<stereo[0].length;i++)for(let c=0;c<2;c++)preview.writeInt16LE(stereo[c][i],44+(i*2+c)*2);
  writeFileSync(`${out}/weapon-audition-stereo.wav`,preview);
  // Verify ordinary controls persist without touching real game/profile data.
  await page.evaluate(async()=>{const {getAudio}=await import('/src/audio/index.ts');window.audioCheck=getAudio();});
  await page.getByRole('button',{name:'Audio',exact:true}).click();
  await page.getByLabel('Output',{exact:true}).selectOption('surround');
  await page.getByLabel('Dynamic range',{exact:true}).selectOption('reduced');
  await page.getByLabel('Music',{exact:true}).evaluate(el=>{el.value='0.17';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('vanguard.settings.v1')).audio);
  assert.equal(saved.music,0.17);assert.equal(saved.output,'surround');assert.equal(saved.range,'reduced');
  await page.reload();await page.evaluate(async()=>{const {getAudio}=await import('/src/audio/index.ts');window.audioCheck=getAudio();});await page.getByRole('button',{name:'Audio',exact:true}).click();
  assert.equal(await page.getByLabel('Music',{exact:true}).inputValue(),'0.17');
  report.liveOutput=await page.evaluate(()=>({maxChannels:window.audioCheck.engine.ctx.destination.maxChannelCount,mode:window.audioCheck.engine.outputMode,reason:window.audioCheck.engine.outputReason}));
  assert.deepEqual(errors,[]);report.browserErrors=errors;
  writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));console.log(`PASS: ${Object.keys(report.weapons).length} gun/lance + 3 missile waveforms, five positioned weapons, six isolated channels, centered dialogue, HRTF left/right, sustained/released beam, stereo fallback, saved controls. Evidence: ${out}`);
} finally {await browser.close();await server.close();}
