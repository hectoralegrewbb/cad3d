import { el, button, field, selectInput, textInput } from './dom.js';
export function constraintPanel(sketch, onUpdate) {
  const box=el('details',{},el('summary',{text:`Restricciones (${sketch.constraints?.length??0})`}));
  const options=sketch.entities.map(e=>[e.id,`${e.id} · ${e.t}`]);
  let type='coincident',a=options[0]?.[0]??'',b=options[1]?.[0]??a,value='10';
  box.append(el('p',{class:'muted',text:'A es referencia; B se ajusta. Las orientaciones usan el primer tramo de una polilínea. Tangencia externa entre círculos.'}),
    field('Tipo',selectInput([['coincident','Coincidencia de centros'],['distance','Distancia entre centros'],['horizontal','Horizontal'],['vertical','Vertical'],['parallel','Paralelismo'],['perpendicular','Perpendicularidad'],['tangent','Tangencia de círculos'],['equal','Diámetros iguales'],['diameter','Diámetro conductor']],type,v=>type=v)),
    field('Referencia A',selectInput(options,a,v=>a=v)),field('Entidad B',selectInput(options,b,v=>b=v)),field('Valor / expresión',textInput(value,v=>value=v)),
    button('Agregar restricción',()=>{if(!a)return;onUpdate(sketch.id,{constraints:[...(sketch.constraints??[]),{id:`c${Date.now()}`,type,a,b,value}]});}),
    ...(sketch.constraints??[]).map(c=>el('div',{class:'row-wrap'},el('span',{text:`${c.type}: ${c.a} → ${c.b??''} (${c.value??''})`}),button('Quitar',()=>onUpdate(sketch.id,{constraints:sketch.constraints.filter(x=>x.id!==c.id)}),{danger:true}))));
  return box;
}
