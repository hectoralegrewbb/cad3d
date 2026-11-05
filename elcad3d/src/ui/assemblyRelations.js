import { el, button, field, selectInput, textInput } from './dom.js';
export function assemblyRelations(project, onChange) {
  const box=el('details',{},el('summary',{text:`Relaciones por origen y ejes (${project.mates?.length??0})`}));
  const options=project.instances.map(i=>[i.id,i.id]);
  let a=options[0]?.[0]??'',b=options[1]?.[0]??'',type='distance',axis=2,value=0;
  box.append(el('p',{class:'muted',text:'A es referencia; B sigue la relación. Coincidencia une orígenes, no caras. Concéntrica alinea ejes de instancia con igual orientación.'}),
    field('A',selectInput(options,a,v=>a=v)),field('B',selectInput(options,b,v=>b=v)),
    field('Relación',selectInput([['distance','Distancia por eje'],['coincident','Orígenes coincidentes'],['concentric','Ejes concéntricos'],['angle','Ángulo relativo']],type,v=>type=v)),
    field('Eje',selectInput([['0','X'],['1','Y'],['2','Z']],'2',v=>axis=Number(v))),field('Valor mm / grados',textInput('0',v=>value=Number(v.replace(',','.')))),
    button('Agregar relación',()=>{if(a&&b&&a!==b&&Number.isFinite(value))onChange([...(project.mates??[]),{id:`mate${Date.now()}`,a,b,type,axis,value}]);}),
    ...(project.mates??[]).map(m=>el('div',{class:'row-wrap'},el('span',{text:`${m.a} → ${m.b}: ${m.type} ${m.value}`}),button('Quitar',()=>onChange(project.mates.filter(x=>x.id!==m.id)),{danger:true}))));
  return box;
}
