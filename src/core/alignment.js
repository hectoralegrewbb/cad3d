// Colocación rígida Rz·Ry·Rx, igual al modelo de instancias. No crea una relación persistente.
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||Math.hypot(...v)<1e-10)throw new Error('Referencia de alineación inválida');const l=Math.hypot(...v);return v.map(x=>x/l);};
const identity=()=>[1,0,0,0,1,0,0,0,1];
const mul=(a,b)=>Array.from({length:9},(_,i)=>[0,1,2].reduce((s,k)=>s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
const apply=(m,p)=>[0,1,2].map(i=>dot(m.slice(i*3,i*3+3),p));
function rotation(axis,angle){const [x,y,z]=unit(axis),c=Math.cos(angle),s=Math.sin(angle),t=1-c;return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c];}
export function alignedPlacement(instance,moving,target,{gap=0,spin=0}={}) {
  if(!instance||!Array.isArray(instance.pos)||!Array.isArray(instance.rot)||instance.pos.length!==3||instance.rot.length!==3||![...instance.pos,...instance.rot,gap,spin].every(Number.isFinite)||Math.abs(gap)>1e7)throw new Error('Colocación inválida');
  if(!moving.origin?.every(Number.isFinite)||moving.origin.length!==3||!target.origin?.every(Number.isFinite)||target.origin.length!==3)throw new Error('Origen de referencia inválido');
  const a=unit(moving.normal),n=unit(target.normal),planes=moving.type==='PLANE'&&target.type==='PLANE';
  const cylinder=t=>['CYLINDER','CYLINDRE','CIRCLE'].includes(t);
  if(!planes&&!(cylinder(moving.type)&&cylinder(target.type)))throw new Error('Elegí dos caras planas o dos referencias cilíndricas/circulares.');
  const b=planes?n.map(x=>-x):n,c=Math.max(-1,Math.min(1,dot(a,b))),axis=cross(a,b);
  let q=identity();
  if(c<-.999999){const perpendicular=cross(a,Math.abs(a[0])<.8?[1,0,0]:[0,1,0]);q=rotation(perpendicular,Math.PI);}
  else if(c<.999999)q=rotation(axis,Math.acos(c));
  q=mul(rotation(n,spin*Math.PI/180),q);
  const old=instance.rot.map(x=>x*Math.PI/180),matrix=mul(rotation([0,0,1],old[2]),mul(rotation([0,1,0],old[1]),rotation([1,0,0],old[0]))),m=mul(q,matrix);
  const y=Math.asin(Math.max(-1,Math.min(1,-m[6]))),cy=Math.cos(y);
  const x=Math.abs(cy)>1e-8?Math.atan2(m[7],m[8]):0,z=Math.abs(cy)>1e-8?Math.atan2(m[3],m[0]):Math.atan2(-m[1],m[4]);
  const offset=apply(q,moving.origin.map((v,k)=>v-instance.pos[k]));
  return {pos:target.origin.map((v,k)=>v+n[k]*gap-offset[k]),rot:[x,y,z].map(v=>v*180/Math.PI)};
}
