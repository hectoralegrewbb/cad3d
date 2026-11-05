import { evaluate } from './expression.js';

// Restricciones dirigidas: A es referencia, B se ajusta. Sin alterar expresiones originales.
export function solveSketchConstraints(entities, constraints = [], params = {}) {
  if (!Array.isArray(constraints) || constraints.length > 500) throw new Error('Máximo 500 restricciones por boceto');
  if(!constraints.length)return entities;
  const result=structuredClone(entities), byId=new Map(result.map(e=>[e.id,e]));
  const center=e=>e.t==='poly'?[e.pts[0].x,e.pts[0].y]:[e.x,e.y];
  const move=(e,dx,dy)=>{if(e.t==='poly')e.pts.forEach(p=>{p.x+=dx;p.y+=dy;});else{e.x+=dx;e.y+=dy;}};
  const heading=e=>e.t==='poly'?Math.atan2(e.pts[1].y-e.pts[0].y,e.pts[1].x-e.pts[0].x)*180/Math.PI:e.angle??0;
  const orient=(e,angle)=>{
    if(e.t==='poly'){
      if(e.pts.length<2)throw new Error('La polilínea necesita dos puntos');
      const origin=center(e),r=(angle-heading(e))*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
      e.pts.forEach(p=>{const x=p.x-origin[0],y=p.y-origin[1];p.x=origin[0]+x*c-y*s;p.y=origin[1]+x*s+y*c;});
    }else if(['guide','slot','ellipse','polygon'].includes(e.t))e.angle=angle;
    else throw new Error('La orientación requiere guía, polilínea o forma orientable');
  };
  for(let iteration=0;iteration<80;iteration++){
    let delta=0;
    for(const c of constraints){
      const a=byId.get(c.a),b=byId.get(c.b);
      if(!a || (['coincident','distance','parallel','perpendicular','tangent','equal'].includes(c.type)&&!b))throw new Error(`Referencia inválida en restricción ${c.id??''}`);
      const touched=[...new Set([a,b].filter(Boolean))];
      const before=touched.map(e=>structuredClone(e));
      const value=evaluate(c.value??0,params);
      if(c.type==='diameter'){if(a.t!=='circle'||!(value>0))throw new Error('Diámetro: elegí un círculo y valor positivo');a.d=value;}
      else if(c.type==='horizontal'||c.type==='vertical')orient(a,c.type==='horizontal'?0:90);
      else if(c.type==='parallel'||c.type==='perpendicular')orient(b,heading(a)+(c.type==='perpendicular'?90:0));
      else if(c.type==='equal'){if(a.t!=='circle'||b.t!=='circle')throw new Error('Igualdad: elegí dos círculos');b.d=a.d;}
      else if(c.type==='coincident'||c.type==='distance'||c.type==='tangent'){
        const p=center(a),q=center(b);let distance=value;
        if(c.type==='coincident')distance=0;
        if(c.type==='tangent'){if(a.t!=='circle'||b.t!=='circle')throw new Error('Tangencia externa: elegí dos círculos');distance=(a.d+b.d)/2;}
        if(distance<0)throw new Error('La distancia debe ser positiva');
        const dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);
        const target=[p[0]+(length?dx/length:1)*distance,p[1]+(length?dy/length:0)*distance];
        move(b,target[0]-q[0],target[1]-q[1]);
      }else throw new Error(`Restricción desconocida: ${c.type}`);
      for(let i=0;i<touched.length;i++){
        const p=center(touched[i]),q=center(before[i]);delta=Math.max(delta,Math.hypot(p[0]-q[0],p[1]-q[1]),Math.abs((touched[i].d??0)-(before[i].d??0)),Math.abs(heading(touched[i])-heading(before[i])));
      }
    }
    if(delta<1e-7)return result;
  }
  throw new Error('Restricciones incompatibles o sin convergencia. Quitá o corregí la última restricción.');
}
