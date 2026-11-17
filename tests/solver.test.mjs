import { solve } from '../src/solver.js';
import { section, SPECIES } from '../src/materials.js';
const model={nodes:[],members:[]};
const segs=8, L=2;
for(let i=0;i<=segs;i++) model.nodes.push({id:i+1,x:L*i/segs,y:0,z:0,support:i===0?'plinth':null});
for(let i=0;i<segs;i++) model.members.push({id:100+i,a:i+1,b:i+2,species:'borak',bundle:1});
const P=1000;
const r=solve(model,{forces:new Map([[segs+1,[0,-P,0,0,0,0]]]),species:SPECIES});
const s=section(model.members[0],SPECIES);
console.log('fe',r.disp.get(segs+1)[1],'theory',-P*L**3/(3*s.E*s.I), r.ok, 'M0', r.forces.get(100).M, 'expect', P*L);
// same along z and vertical
const m2={nodes:[{id:1,x:0,y:0,z:0,support:'plinth'},{id:2,x:0,y:3,z:0}],members:[{id:5,a:1,b:2,species:'borak'}]};
const r2=solve(m2,{forces:new Map([[2,[500,-2000,0,0,0,0]]]),species:SPECIES});
console.log(r2.disp.get(2).slice(0,3), 'theory x', 500*27/(3*s.E*s.I),'N',r2.forces.get(5).N);
// mechanism: pinned two-bar collinear w/o support
const m3={nodes:[{id:1,x:0,y:0,z:0},{id:2,x:1,y:0,z:0}],members:[{id:5,a:1,b:2,species:'borak'}]};
console.log('mech', solve(m3,{forces:new Map([[2,[0,-10,0,0,0,0]]]),species:SPECIES}).mechanism);
