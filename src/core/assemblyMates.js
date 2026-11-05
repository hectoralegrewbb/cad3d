// Relaciones dirigidas por orígenes y ejes de instancia (sin referencias topológicas frágiles).
export function solveAssemblyMates(project) {
  const mates=project.mates??[];
  if(!mates.length)return project;
  if(mates.length>1000)throw new Error('Máximo 1000 relaciones de conjunto');
  const instances=project.instances.map(i=>({...i,pos:[...i.pos],rot:[...i.rot]}));
  const byId=new Map(instances.map(i=>[i.id,i]));
  const incoming=new Map(),visiting=new Set(),done=new Set();
  for(const mate of mates){
    if(!byId.has(mate.a)||!byId.has(mate.b)||mate.a===mate.b)throw new Error('Relación con instancia inexistente o consigo misma');
    if(!incoming.has(mate.b))incoming.set(mate.b,[]);incoming.get(mate.b).push(mate);
  }
  const solve=id=>{
    if(done.has(id))return;
    if(visiting.has(id))throw new Error('Las relaciones forman un ciclo. Usá una instancia de referencia.');
    visiting.add(id);const b=byId.get(id);
    for(const mate of incoming.get(id)??[]){
      solve(mate.a);const a=byId.get(mate.a),axis=Number(mate.axis??2),value=Number(mate.value??0);
      if(![0,1,2].includes(axis)||!Number.isFinite(value))throw new Error('Eje o valor inválido en relación');
      if(b.fixed)throw new Error('No se puede mover una instancia fija mediante una relación');
      if(mate.type==='coincident')b.pos=[...a.pos];
      else if(mate.type==='distance')b.pos[axis]=a.pos[axis]+value;
      else if(mate.type==='concentric'){
        let direction=[0,0,0];direction[axis]=1;
        for(let k=0;k<3;k++){const [i,j]=[[1,2],[2,0],[0,1]][k],angle=a.rot[k]*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);[direction[i],direction[j]]=[c*direction[i]-s*direction[j],s*direction[i]+c*direction[j]];}
        const distance=b.pos.reduce((sum,v,k)=>sum+(v-a.pos[k])*direction[k],0);
        b.pos=a.pos.map((v,k)=>v+direction[k]*distance);b.rot=[...a.rot];
      }
      else if(mate.type==='angle')b.rot[axis]=a.rot[axis]+value;
      else throw new Error('Tipo de relación desconocido');
    }
    visiting.delete(id);done.add(id);
  };
  for(const i of instances)solve(i.id);
  // Verificación final: ninguna relación puede sobrescribir otra silenciosamente.
  for(const mate of mates){
    const a=byId.get(mate.a),b=byId.get(mate.b),axis=Number(mate.axis??2),value=Number(mate.value??0);
    let error=0;
    if(mate.type==='coincident')error=Math.hypot(...b.pos.map((v,k)=>v-a.pos[k]));
    if(mate.type==='distance')error=Math.abs(b.pos[axis]-a.pos[axis]-value);
    if(mate.type==='angle')error=Math.abs(b.rot[axis]-a.rot[axis]-value);
    if(error>1e-6)throw new Error('Relaciones incompatibles: corregí la última distancia, coincidencia o ángulo');
  }
  return {...project,instances};
}
