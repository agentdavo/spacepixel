#!/usr/bin/env node
/** Build the sign-off atlas from render-review.mjs captures and live stock-fit measurements. */
import { readFileSync, writeFileSync } from 'node:fs';
const dir=process.argv.find(x=>x.startsWith('--out='))?.slice(6)??'docs/reviews/render-reconciliation';
const evidence=JSON.parse(readFileSync(dir+'/evidence.json','utf8'));
const identity={
 'vf27-kestrel':['Interceptor','Space superiority / player baseline','Readable swept wings, paired drives and a forward nose. Preserve this recognisable baseline.','Keep the main wing triangle readable at 32 px; reserve accent paint for cockpit, weapons and squadron marks.'],
 'sb9-warhorse':['Bomber','Heavy strike / torpedo delivery','Wide, heavy platform with obvious ordnance weight. It must read as less agile than the Kestrel.','Emphasise launch hardware and engine mass; retain a clean separation between wings and ordnance.'],
 'cr5-resolute':['Corvette','Player command ship / escort','Compact capital systems on a 200 m hull; four shield facings and three structural sections are now active.','Give bridge, paired drives and shield hardware distinct silhouettes before authoring removable modules.'],
 'ffl3-valiant':['Frigate','Player line combat / mixed battery','A longer warship whose role must remain distinct from the Resolute at equal screen size.','Prioritise a recognisable bow, gun-deck rhythm and bridge position; avoid merely scaling the corvette.'],
 'choir-cathedral':['Dreadnought','Choir fleet anchor / siege','Spired architecture, ceremonial symmetry and luminous spine. Keep its negative spaces and immense scale.','Reduce decorative glow competition around damage; make reactor and generator vocabulary physically readable.'],
 'civ-longhaul':['Freighter','Civilian cargo / convoy objective','Cargo volume should dominate, with visibly subordinate bridge, propulsion and defensive weapons.','Make cargo boundaries and drive attachments legible; cargo detachment is a later scoped destruction feature.'],
};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round=n=>Math.round(n*10)/10;
function diagram(s){
 const [a,b]=[s.bounds.min,s.bounds.max], span=Math.max(b[0]-a[0],b[2]-a[2])*1.25;
 const cx=(a[0]+b[0])/2,cz=(a[2]+b[2])/2;
 const p=v=>[240+(v[0]-cx)/span*400,240-(v[2]-cz)/span*400];
 let shapes='';
 for(const t of s.turrets){
  const points=[p(t.base)];
  for(let i=0;i<=40;i++){
   const angle=t.traverse[0]+(t.traverse[1]-t.traverse[0])*i/40;
   const u=t.up,f=t.forward,co=Math.cos(angle),si=Math.sin(angle),dot=u.reduce((v,x,j)=>v+x*f[j],0);
   const cross=[u[1]*f[2]-u[2]*f[1],u[2]*f[0]-u[0]*f[2],u[0]*f[1]-u[1]*f[0]];
   points.push(p(f.map((x,j)=>t.base[j]+(x*co+cross[j]*si+u[j]*dot*(1-co))*span*.16)));
  }
  shapes+='<polygon points="'+points.map(x=>x.join(',')).join(' ')+'" fill="#45d5ed" fill-opacity=".07" stroke="#45d5ed" stroke-opacity=".6" stroke-width="1"/>';
 }
 for(const [i,sys]of s.systems.entries()){
  const [x,y]=p(sys.position);
  shapes+='<circle cx="'+x+'" cy="'+y+'" r="'+Math.max(3,sys.radius/span*400)+'" fill="#ffb94c" fill-opacity=".13" stroke="#ffb94c"/><text x="'+(x+4)+'" y="'+(y-4)+'">'+(i+1)+'</text>';
 }
 return '<svg viewBox="0 0 480 480" role="img" aria-label="Top projection of current subsystem volumes and authored mount arcs"><path d="M240 15v450M15 240h450" stroke="#243747"/><text x="245" y="28">BOW +Z</text>'+shapes+'</svg>';
}
const ships=evidence.ships;
let cards='';
for(const s of ships){
 const [cls,role,read,change]=identity[s.id];
 const degrees=a=>a.map(x=>Math.round(x*180/Math.PI)).join(' to ')+'°';
 const systemRows=s.systems.map((x,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(x.id)+'</td><td>'+esc(x.kind)+'</td><td>'+round(x.hp)+'</td></tr>').join('');
 const arcRows=s.turrets.map(t=>'<tr><td>'+esc(t.socket)+'</td><td>'+degrees(t.traverse)+'</td><td>'+degrees(t.elevation)+'</td></tr>').join('');
 cards+='<article id="'+s.id+'"><header><div class="eyebrow">'+esc(s.faction)+' / '+cls+'</div><h2>'+esc(s.name)+'</h2><p>'+role+'</p></header>'+
 '<div class="stats"><span>'+round(s.length)+' m</span><span>'+s.hull+' hull</span><span>'+s.shield+' shield</span><span>'+s.facings+' facings</span><span>'+s.systems.length+' systems</span></div>'+
 '<p>'+read+'</p><div class="views">'+['quarter','front','side','top'].map(v=>'<figure><img src="'+s.id+'-'+v+'.png" alt="'+esc(s.name)+' '+v+' view"><figcaption>'+v.toUpperCase()+'</figcaption></figure>').join('')+'</div>'+
 '<div class="silhouettes">'+[32,64,128].map(n=>'<figure><img width="'+n+'" height="'+n+'" src="'+s.id+'-silhouette.png" alt="'+n+' pixel silhouette"><figcaption>'+n+' px</figcaption></figure>').join('')+'</div>'+
 '<div class="split"><div><h3>Current systems and rig arcs</h3>'+diagram(s)+'<p class="note">Top projection in metres, using live subsystem centres/radii and authored turret traverse. Circles are targeting volumes, not detachable geometry. Cyan arcs project each mount plane; obstruction and live traverse state are not shown.</p></div>'+
 '<div><h3>Proposed geometry direction</h3><p>'+change+'</p><p><b>Current gun families:</b> '+s.guns.join(', ')+'<br><b>Missiles:</b> '+(s.missiles.join(', ')||'none')+'</p>'+
 '<p><b>Damage contract:</b> '+(s.capital?'Four or more directional shields, bridge/propulsion/core/generator/emitter systems and three structural sections.':'Directional shield pools and fighter zone damage; no general detachable wing collision.')+' Authored removable components require M05/M07.</p>'+
 '<details><summary>Subsystem inventory ('+s.systems.length+')</summary><table><tr><th>#</th><th>ID</th><th>Kind</th><th>HP</th></tr>'+systemRows+'</table></details>'+
 '<details><summary>Rig limits ('+s.turrets.length+')</summary><table><tr><th>Mount</th><th>Traverse</th><th>Elevation</th></tr>'+arcRows+'</table><p>Fixed guns use their socket direction. Empty tables mean there is no authored turret rig, not necessarily that the hull has no weapons.</p></details></div></div>'+
 '<div class="decision"><b>Sign-off:</b> approve silhouette / approve role / request changes. Geometry proposals remain pending David’s review.</div></article>';
}
const span=s=>Math.max(...s.bounds.max.map((x,i)=>x-s.bounds.min[i]));
const maxLength=Math.max(...ships.map(span));
const comparison='<section id="comparison"><h2>Fleet comparison</h2><p>Top silhouettes occupy the same 128 px frame above. Below, each frame is scaled by its measured framing span relative to Cathedral. Tiny fighters are intentionally tiny; the label gives their actual length.</p>'+ships.map(s=>'<div class="scale"><label>'+esc(s.name)+' · '+round(s.length)+' m</label><img src="'+s.id+'-silhouette.png" width="'+Math.max(.1,span(s)/maxLength*560)+'" height="'+Math.max(.1,span(s)/maxLength*560)+'"></div>').join('')+'</section>';
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vanguard — six-hull sign-off atlas</title><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#080e17;color:#dbe5ef;font:16px/1.6 system-ui}main{max-width:1180px;margin:auto;padding:40px 26px}h1{font-size:44px;line-height:1.1}h2{font-size:32px;margin:6px 0}h3{color:#74d8e8}a{color:#74d8e8}nav{display:flex;flex-wrap:wrap;gap:18px;padding:20px 0;border-bottom:1px solid #273749}article,section{margin:44px 0;padding-top:24px;border-top:1px solid #273749}.eyebrow{color:#ffbf66;letter-spacing:.18em;text-transform:uppercase}.stats{display:flex;gap:12px;flex-wrap:wrap}.stats span{background:#1c2b3a;padding:5px 12px}.overview{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}.overview img{width:100%;display:block}.overview a{background:#152130;text-decoration:none}.overview b{display:block;padding:8px 14px}.views{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{object-fit:contain}.views img{display:block;width:100%;height:auto}.views figcaption{background:#12202e;padding:6px 12px;font-size:12px;letter-spacing:.2em}.silhouettes{display:flex;align-items:end;gap:40px;margin:24px 0;padding:18px;background:#000}.silhouettes figure{text-align:center}.split{display:grid;grid-template-columns:1fr 1fr;gap:30px}svg{width:100%;background:#0b1420}svg text{font:10px system-ui;fill:#ffc477}.note{font-size:13px;color:#8fa8bc}table{font-size:12px;width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px;border-bottom:1px solid #26374a}details{margin:14px 0}summary{cursor:pointer;color:#74d8e8}.decision{margin-top:22px;border-left:3px solid #ffbf66;padding:12px 20px;background:#19222b}.scale{display:flex;align-items:center;min-height:40px;border-bottom:1px solid #1b2935}.scale label{min-width:230px}.scale img{flex:none;background:#000}@media(max-width:740px){.split,.views{grid-template-columns:1fr}main{padding:20px}.scale label{min-width:160px}.scale{overflow:auto}}@media print{article{break-before:page}details{display:block}}</style><main>'+
 '<div class="eyebrow">Vanguard / Package A / design review</div><h1>Six hulls.<br>One readable combat language.</h1><p>Real stock-fitted models, native WebGPU captures, fixed Meridian lighting. These plates document the current geometry and proposed direction. Camera FOV 8° gives near-orthographic views; silhouette images exclude exhaust plumes. Systems are measured from the simulation.</p>'+
 '<nav>'+ships.map(s=>'<a href="#'+s.id+'">'+esc(s.name)+'</a>').join('')+'<a href="#comparison">Scale comparison</a></nav>'+
 '<div class="overview">'+ships.map(s=>'<a href="#'+s.id+'"><img src="'+s.id+'-quarter.png" alt="'+esc(s.name)+'"><b>'+esc(s.name)+'</b></a>').join('')+'</div>'+
 '<p><b>Vocabulary:</b> class describes hull architecture, role describes its job, and capability describes simulation behavior. A corvette can have capital damage systems without becoming a dreadnought. The catalogue’s “strike” is the Harrier’s tactical role; its blueprint’s “strike-fighter” remains its architecture.</p>'+
 cards+comparison+'<footer><a href="evidence.json">Raw measurements and resource/recovery evidence</a> · <a href="../../RENDER-SHIP-REVIEW-2026-09-25.md">Full review and milestone plan</a></footer></main></html>';
writeFileSync(dir+'/index.html',html);
console.log('Wrote '+dir+'/index.html');

