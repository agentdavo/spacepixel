import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('scratchpad/combat-audio-review', { recursive: true });
const server = await createServer({ root: process.cwd(), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { Vector3, Quaternion } = await server.ssrLoadModule('three');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { buildShip } = await server.ssrLoadModule('/src/assets/ShipBuilder.ts');
  const { createCombat, raycastShip, createRayHit } = await server.ssrLoadModule('/src/sim/Combat.ts');
  const { resetDamage, applyHit, syncShield, facingOf } = await server.ssrLoadModule('/src/sim/Damage.ts');
  const { GUNS, MISSILES, CAPITAL_LANCE } = await server.ssrLoadModule('/src/sim/Loadouts.ts');
  const { GameAudio } = await server.ssrLoadModule('/src/audio/index.ts');
  const report = { hulls: [], damageCases: 0, damageFailures: [], audio: {} };
  const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const weapons = [...Object.values(GUNS).map(g => ({id:g.id,type:g.type,amount:g.beam ? g.beam.dps/60 : g.damage})), ...Object.values(MISSILES).map(g => ({id:g.id,type:g.type,amount:g.damage})),{id:'capital-lance', type:CAPITAL_LANCE.type, amount:CAPITAL_LANCE.dpsCapital/60}];
  for (const bp of Object.values(BLUEPRINTS)) {
    const model = buildShip(bp);
    const c = createCombat(bp.id, model, bp.faction);
    const st = c.dmg;
    const s = {model, combat:c, radius:model.radius*(model.radius>200?0.35:0.6), shield:c.stats.shield, shieldMax:c.stats.shield, hull:c.stats.hull, hullMax:c.stats.hull, alive:true, flight:{position:new Vector3(),orientation:new Quaternion()}};
    const center = new Vector3(st.cx, st.cy, st.cz);
    const row = {id:bp.id,name:bp.name,capital:st.capital,facings:st.facings.length,requestedFacings:c.stats.facings,radius:model.radius,collisionRadius:s.radius,shell:c.shell.toArray(),missedShellAxes:[]};
    if (st.capital) {
      for (const axis of axes) {
        const edge = new Vector3(...axis).multiply(c.shell);
        const a = center.clone().addScaledVector(edge,1.01);
        const d = edge.clone().multiplyScalar(-0.02);
        const hit = createRayHit();
        if (!raycastShip(s,a,d,0,hit) || !hit.onShield) row.missedShellAxes.push({axis,a:a.toArray(),d:d.toArray()});
      }
    }
    for (const w of weapons) for (const charge of ['full','weak','empty']) for (let f=0;f<st.facings.length;f++) {
      resetDamage(st,s);
      if (charge==='weak') st.facings.fill(st.facingMax*0.05);
      if (charge==='empty') st.facings.fill(0);
      syncShield(st,s);
      const axis = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]][f];
      const local = center.clone().add(new Vector3(...axis).multiply(new Vector3(st.halfW,st.halfH,st.halfL)));
      const result = applyHit(st,s,{amount:w.amount,type:w.type,local});
      report.damageCases++;
      if (facingOf(st,local)!==f || result.facing!==f || result.shielded!==(charge!=='empty') || !Number.isFinite(s.hull) || !Number.isFinite(s.shield) || result.shieldDamage+result.hullDamage<=0 || (charge==='empty' && result.hullDamage<=0)) report.damageFailures.push({hull:bp.id,weapon:w.id,charge,f,result:{...result}});
    }
    report.hulls.push(row);
  }
  const eye={x:0,y:0,z:0}, near={x:5,y:0,z:-5}, far={x:0,y:0,z:-1e7};
  const player={isPlayer:true,faction:'concord',radius:9}, npc={isPlayer:false,faction:'choir',radius:700};
  const makeAudio=()=>{
    const audio=new GameAudio({unlockTarget:null}); const calls=[];
    audio.sfx.playAtRaw=(...args)=>calls.push(args);
    audio.sfx.playRaw=(...args)=>calls.push(args);
    audio.sfx.swarmPulse=()=>{};
    return {audio,calls};
  };
  for (const [name,events] of Object.entries({intercepted:[{kind:'detonate',position:near,target:player,shooter:npc,intercepted:true,shielded:false}],shieldAbsorbed:[{kind:'detonate',position:near,target:player,shooter:npc,intercepted:false,shielded:true}],threeDetonations:[1,2,3].map(x=>({kind:'detonate',position:{x,y:0,z:-5},target:npc,shooter:player,intercepted:false,shielded:false}))})) {
    const {audio,calls}=makeAudio();audio.missileEvents(events,eye,1);report.audio[name]=calls;audio.dispose();
  }
  const {audio,calls}=makeAudio();
  audio.weaponEvents([{kind:'beam-hit',position:far,ship:npc,shooter:npc},{kind:'beam-hit',position:near,ship:player,shooter:npc}],eye,1);
  report.audio.beamDistantBeforePlayer=calls; audio.dispose();
  report.summary={hulls:report.hulls.length,capitals:report.hulls.filter(h=>h.capital).length,capitalHullsWithMissedShieldProbes:report.hulls.filter(h=>h.missedShellAxes.length).length,weaponProfiles:weapons.length,damageCases:report.damageCases,damageFailures:report.damageFailures.length};
  writeFileSync('scratchpad/combat-audio-review/audit.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({summary:report.summary,audio:report.audio,missedExamples:report.hulls.filter(h=>h.missedShellAxes.length).slice(0,4)},null,2));
} finally { await server.close(); }
