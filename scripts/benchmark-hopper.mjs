import {readFileSync} from 'node:fs';
import {loadKernel} from '../src/kernel/occNode.js';
import {buildAssembly} from '../src/kernel/assemblyBuilder.js';
import {hopperCavity} from '../src/core/hopperFill.js';
import {ParticleSim,materialPresets} from '../src/particles/sim.js';
import {buildSdf} from '../src/particles/sdf.js';
const project=JSON.parse(readFileSync('examples/Tolva_llena.proj3d','utf8'));
const rep=await loadKernel(),built=buildAssembly(rep,project,{checkInterference:false});
const bodies=built.instances.map(i=>({mesh:i.mesh,sdf:buildSdf(i.mesh.vertices,i.mesh.triangles,{cell:2.1,band:7.5}),movable:false}));
const plan=hopperCavity(built.instances.find(i=>i.id==='i1').mesh);
const sim=new ParticleSim(bodies,{...materialPresets.arena,radius:3,cap:600000,maxCap:600000,rate:0,airCells:0,airModel:'rapido',initialFill:{...project.simulation.initialFill,settleSeconds:2},floorZ:-25});
let t=performance.now();sim.initializeFill(plan);console.log('seed',sim.count,'ms',Math.round(performance.now()-t),'MiB',Math.round(process.memoryUsage().rss/1048576));
for(let i=0;i<3;i++){t=performance.now();sim.step(1/60);if(true)console.log('step',i,Math.round(performance.now()-t),'ms','pairs',sim.pairCount/2,'MiB',Math.round(process.memoryUsage().rss/1048576));}
console.log(JSON.stringify(sim.fillInfo()));
let outside=0;for(let i=0;i<sim.count;i++)if(Math.abs(sim.x[i*3])>350||Math.abs(sim.x[i*3+1])>350)outside++;console.log('fuera envolvente',outside);
