import { validateInitialFill } from '../core/hopperFill.js';

// Carga DEM completa. La red FCC evita superposiciones sin búsquedas O(N²).
export class HopperLoad {
  constructor(plan, options, density) {
    this.options=validateInitialFill(options);
    const cells=Array.isArray(plan?.dims)?plan.dims.reduce((a,b)=>a*b,1):0;
    if(!plan?.positions?.length||plan.positions.length%3||plan.positions.length>4500000||!plan.positions.every(Number.isFinite)||!Number.isFinite(plan.h)||plan.h<=0||!Array.isArray(plan.dims)||plan.dims.length!==3||!plan.dims.every(v=>Number.isInteger(v)&&v>0)||cells>1500000||plan.rank?.length!==cells||!Array.isArray(plan.origin)||plan.origin.length!==3||!plan.origin.every(Number.isFinite)||!Number.isFinite(plan.capacity)||plan.capacity<=0||!Number.isFinite(density)||density<=0)throw new Error('Grilla de llenado inválida');
    this.plan=plan;this.density=density;
    this.parcelVolume=4/3*Math.PI*this.options.radius**3;
    this.minZ=plan.positions[2]-plan.h/2;
    this.initialCount=0;this.open=false;this.airEnabled=false;this.crossed=0;this.crossings=[];this.lastFlow=0;
    this.initialVolume=0;
  }
  seed(isFree, add, limit) {
    const p=this.plan,r=this.options.radius;
    const selected=Math.floor(p.positions.length/3*this.options.percent/100);
    if(!selected)return;
    const spacing=Math.cbrt(4*this.parcelVolume/this.options.packing)/2;
    const [nx,ny,nz]=p.dims;
    const dims=p.bounds.size.map(v=>Math.ceil(v/spacing)+1);
    if(dims.reduce((a,b)=>a*b,1)>12000000)throw new Error('La carga exige demasiadas posiciones candidatas. Aumentá el radio explícitamente o reducí el volumen de prueba.');
    for(let k=0;k<dims[2];k++)for(let j=0;j<dims[1];j++)for(let i=0;i<dims[0];i++){
      if((i+j+k)%2)continue;
      const point=[p.bounds.min[0]+i*spacing,p.bounds.min[1]+j*spacing,p.bounds.min[2]+k*spacing];
      const ix=Math.floor((point[0]-p.origin[0])/p.h),iy=Math.floor((point[1]-p.origin[1])/p.h),iz=Math.floor((point[2]-p.origin[2])/p.h);
      if(ix<0||iy<0||iz<0||ix>=nx||iy>=ny||iz>=nz||point[2]<this.minZ+r)continue;
      const rank=p.rank[ix+nx*(iy+ny*iz)];
      if(rank<0||rank>=selected||!isFree(point))continue;
      if(this.initialCount>=limit)throw new Error(`La carga supera ${limit.toLocaleString('es-AR')} partículas. Elegí un presupuesto mayor en cálculo lento o reducí el porcentaje; no se cargó una tolva parcial.`);
      add(point);this.initialCount++;
    }
    if(!this.initialCount)throw new Error('No cabe ninguna partícula. Revisá el radio y la cavidad.');
    this.initialVolume=this.initialCount*this.parcelVolume;
  }
  track(before,after,count,dt,time,flags) {
    const axis=this.options.outletAxis,position=this.options.outletPosition,sign=this.options.outletSign;
    for(let i=0;i<count;i++){
      if(flags[i])continue;
      const a=(before[i*3+axis]-position)*sign,b=(after[i*3+axis]-position)*sign;
      if(a<0&&b>=0){
        const t=-a/(b-a),u=(axis+1)%3,v=(axis+2)%3;
        const pu=before[i*3+u]+t*(after[i*3+u]-before[i*3+u]),pv=before[i*3+v]+t*(after[i*3+v]-before[i*3+v]);
        if(Math.hypot(pu-this.options.outletU,pv-this.options.outletV)>this.options.outletRadius)continue;
        flags[i]=1;this.crossed++;this.crossings.push(time);}
    }
    while(this.crossings.length&&this.crossings[0]<time-1)this.crossings.shift();
    this.lastFlow=this.crossings.length*this.parcelVolume/1e9*this.density;
  }
  info(time,count,exited,positions) {
    const kg=this.parcelVolume/1e9*this.density;
    let level=this.minZ;for(let i=0;i<count;i++)level=Math.max(level,positions[i*3+2]+this.options.radius);
    return {mode:'Carga dinámica completa (PBD)',phase:time<this.options.settleSeconds?'settling':this.open?'running':'ready',progress:Math.min(1,time/Math.max(.001,this.options.settleSeconds)),
      initialKg:this.initialCount*kg,reservoirKg:0,activeKg:count*kg,exitedKg:exited*kg,remainingLiters:count*this.parcelVolume/this.options.packing/1e6,
      level,visible:0,capacityLiters:this.plan.capacity/1e6,cellMm:this.plan.h,crossedKg:this.crossed*kg,flowKgS:this.lastFlow,open:this.open,airEnabled:this.airEnabled,initialCount:this.initialCount,
      actualFillPercent:100*this.initialVolume/this.options.packing/this.plan.capacity};
  }
}
