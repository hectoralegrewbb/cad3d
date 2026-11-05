import { validateInitialFill } from '../core/hopperFill.js';

// Reservorio de carga + zona DEM local. No calcula arcos ni presión mecánica del lecho superior.
export class HopperLoad {
  constructor(plan, options, density) {
    this.options=validateInitialFill(options);
    if(!plan?.positions?.length||!Number.isFinite(plan.h)||plan.h<=0||plan.positions.length%3||plan.positions.length>4500000||!plan.positions.every(Number.isFinite))throw new Error('Plan de llenado inválido');
    const cells=plan.dims?.reduce((a,b)=>a*b,1);
    if(!Array.isArray(plan.dims)||plan.dims.length!==3||!plan.dims.every(v=>Number.isInteger(v)&&v>0)||cells>1500000||plan.rank?.length!==cells||!Array.isArray(plan.origin)||plan.origin.length!==3||!plan.origin.every(Number.isFinite)||!Number.isFinite(plan.capacity)||plan.capacity<=0||Math.abs(plan.capacity-plan.positions.length/3*plan.h**3)>plan.capacity*1e-6||!Number.isFinite(density)||density<=0)throw new Error('Grilla de llenado inválida');
    this.plan=plan;
    this.cellBulk=plan.h**3;
    this.density=density;
    this.totalBulk=plan.capacity*this.options.percent/100;
    this.totalSolid=this.totalBulk*this.options.packing;
    this.remainingSolid=this.totalSolid;
    this.parcelVolume=4/3*Math.PI*this.options.radius**3;
    this.minZ=plan.positions[2];
    this.phase='settling';
    const selected=Math.min(plan.positions.length/3,Math.floor(this.totalBulk/this.cellBulk));
    this.candidates=[];
    const top=this.minZ+Math.max(25,this.options.radius*8);
    for(let i=0;i<selected;i++)if(plan.positions[i*3+2]<=top)this.candidates.push(i);
    if(this.totalBulk>0&&!this.candidates.length)throw new Error('El llenado es menor que una celda. Aumentá el porcentaje.');
  }
  take() {
    if(this.remainingSolid+1e-7<this.parcelVolume)return false;
    this.remainingSolid=Math.max(0,this.remainingSolid-this.parcelVolume);return true;
  }
  point(index) {return Array.from(this.plan.positions.subarray(index*3,index*3+3));}
  countVisible() {return Math.min(this.plan.positions.length/3,Math.floor(this.remainingSolid/this.options.packing/this.cellBulk));}
  info(time,count,exited) {
    const visible=this.countVisible(),remaining=this.remainingSolid/1e9*this.density,parcelKg=this.parcelVolume/1e9*this.density;
    const level=visible?this.plan.positions[(visible-1)*3+2]:this.minZ;
    return {mode:'reservorio + DEM local',phase:time<this.options.settleSeconds?'settling':'running',progress:Math.min(1,time/Math.max(.001,this.options.settleSeconds)),
      initialKg:this.totalSolid/1e9*this.density,reservoirKg:remaining,activeKg:count*parcelKg,exitedKg:exited*parcelKg,
      remainingLiters:this.remainingSolid/this.options.packing/1e6,level,visible,capacityLiters:this.plan.capacity/1e6,cellMm:this.plan.h};
  }
  // Lecho inmóvil: deposita su volumen y resistencia en las celdas del aire calculado.
  deposit(air, relaxation, grainM) {
    const volume=air.h**3;
    const [nx,ny,nz]=air.dims;
    const fill=this.countVisible();
    // Muestreo de la máscara en la grilla de aire: costo acotado por el número de celdas del solver.
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const x=air.origin[0]+(i+.5)*air.hmm,y=air.origin[1]+(j+.5)*air.hmm,z=air.origin[2]+(k+.5)*air.hmm;
      const p=this.plan,ix=Math.floor((x-p.origin[0])/p.h),iy=Math.floor((y-p.origin[1])/p.h),iz=Math.floor((z-p.origin[2])/p.h);
      if(ix<0||iy<0||iz<0||ix>=p.dims[0]||iy>=p.dims[1]||iz>=p.dims[2])continue;
      const index=ix+p.dims[0]*(iy+p.dims[1]*iz),rank=p.rank[index];
      if(rank<0||rank>=fill)continue;
      const solid=volume*this.options.packing,mass=solid*this.density;
      const c=i+nx*(j+ny*k),speed=Math.hypot(air.uc[c],air.vc[c],air.wc[c]);
      air.depositParticle(x,y,z,0,0,0,solid,mass*relaxation(grainM,this.density,speed,1-this.options.packing));
    }
  }
}
