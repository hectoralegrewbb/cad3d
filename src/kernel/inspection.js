import { meshEdgesShape } from './batchMesh.js';
import { sectionContours } from '../core/inspection.js';

const tuple=p=>[p.X(),p.Y(),p.Z()];
export function describeEntity(rep, shape, {faceId,edgeIndex}) {
  if(!shape)throw new Error('La herramienta precisa requiere un sólido B-Rep.');
  if(edgeIndex!==undefined){
    const edges=shape.edges;
    try{
      if(!Number.isInteger(edgeIndex)||!edges[edgeIndex])throw new Error('Arista fuera de rango. Volvé a seleccionarla.');
      const edge=edges[edgeIndex],result={kind:'edge',type:edge.geomType,length:edge.length};
      if(edge.geomType==='CIRCLE'){
        const a=new (rep.getOC().BRepAdaptor_Curve)(edge.wrapped);
        try{const circle=a.Circle();try{result.radius=circle.Radius();const point=circle.Location();result.origin=tuple(point);point.delete();const axis=circle.Axis(),d=axis.Direction();result.normal=tuple(d);d.delete();axis.delete();}finally{circle.delete();}}finally{a.delete();}
      }
      return result;
    }finally{edges.forEach(e=>e.delete());}
  }
  const faces=shape.faces;
  try{
    const face=faces.find(f=>f.hashCode===faceId);if(!face)throw new Error('La cara cambió. Volvé a seleccionarla.');
    const center=face.center,result={kind:'face',type:face.geomType,origin:[center.x,center.y,center.z],area:rep.measureArea(face)};center.delete();
    if(face.geomType==='PLANE'){const n=face.normalAt();result.normal=[n.x,n.y,n.z];n.delete();}
    if(['CYLINDRE','CYLINDER'].includes(face.geomType)){
      const a=new (rep.getOC().BRepAdaptor_Surface)(face.wrapped,true);
      try{const c=a.Cylinder();try{result.radius=c.Radius();const axis=c.Axis(),p=axis.Location(),d=axis.Direction();result.origin=tuple(p);result.normal=tuple(d);p.delete();d.delete();axis.delete();}finally{c.delete();}}finally{a.delete();}
    }
    return result;
  }finally{faces.forEach(f=>f.delete());}
}
export function exactSection(rep,shape,axis,position) {
  if(!shape)throw new Error('La sección precisa requiere un sólido B-Rep.');
  if(![0,1,2].includes(axis)||!Number.isFinite(position))throw new Error('Plano de sección inválido');
  const [min,max]=shape.boundingBox.bounds;
  if(position<=min[axis]+1e-7||position>=max[axis]-1e-7)throw new Error('Ubicá el plano dentro de la pieza, fuera de sus caras extremas.');
  const u=(axis+1)%3,v=(axis+2)%3,pad=Math.max(1,Math.hypot(...max.map((x,k)=>x-min[k])));
  const point=(a,b)=>{const p=[0,0,0];p[axis]=position;p[u]=a;p[v]=b;return p;};
  const face=rep.makePolygon([point(min[u]-pad,min[v]-pad),point(max[u]+pad,min[v]-pad),point(max[u]+pad,max[v]+pad),point(min[u]-pad,max[v]+pad)]);
  const oc=rep.getOC(),operation=new oc.BRepAlgoAPI_Section(),progress=new oc.Message_ProgressRange();let section;
  try{
    operation.Init1(shape.wrapped);operation.Init2(face.wrapped);operation.Build(progress);
    if(!operation.IsDone())throw new Error('El kernel no pudo calcular la sección.');
    section=rep.cast(operation.Shape());const {lines}=meshEdgesShape(section,{tolerance:.02,angularTolerance:.05}),segments=[];
    for(let i=0;i<lines.length;i+=6)segments.push([Array.from(lines.slice(i,i+3)),Array.from(lines.slice(i+3,i+6))]);
    const result=sectionContours(segments,axis,position,1e-5);result.source='B-Rep';result.samplingTolerance=.02;return result;
  }finally{section?.delete();progress.delete();operation.delete();face.delete();}
}
