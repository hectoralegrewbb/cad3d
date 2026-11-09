import {el,button,selectInput,field,textInput} from './dom.js';
import {sectionDxf} from '../core/inspection.js';
import {downloadBlob} from '../io/persistence.js';

// Herramientas de sesión; geometría y aplicación del documento se resuelven sólo mediante hooks públicos.
export function createCadTools(viewer,hooks) {
  const root=el('details',{class:'cad-tools'},el('summary',{text:'Inspección y montaje CAD'}));
  const body=el('div',{class:'cad-tools-body'}),output=el('div',{class:'cad-results',role:'status','aria-live':'polite'});root.append(body,output);
  let selected='',mode='',first=null,preview=null,section=null,busy=false,sequence=0,down=null;
  const target=selectInput([['','Elegir pieza…']],'',v=>{cancel();selected=v;centerSection();});
  const axis=selectInput([[0,'X'],[1,'Y'],[2,'Z']],2,()=>{invalidateSection();centerSection();}),position=textInput('0',()=>invalidateSection());
  function centerSection(){const bounds=viewer.items?.find(i=>i.id===selected)?.bounds;if(bounds)position.value=String((bounds.min[Number(axis.value)]+bounds.max[Number(axis.value)])/2);}
  const gap=textInput('0',()=>cancelPreview()),spin=textInput('0',()=>cancelPreview());
  const number=input=>{const v=Number(input.value.replace(',','.'));if(!input.value.trim()||!Number.isFinite(v))throw new Error('Ingresá una medida válida.');return v;};
  const message=(text,error=false)=>{output.replaceChildren(el('p',{class:error?'err-block':'hint-block',text}));};
  const cancelPreview=()=>{preview=null;viewer.clearPlacementPreview();apply.disabled=true;};
  function invalidateSection(){section=null;exportButton.disabled=true;viewer.clearGuides();}
  function cancel(){sequence++;mode='';first=null;cancelPreview();invalidateSection();}
  async function run(label,fn){if(busy)return;hooks.stopTools();cancelPreview();busy=true;const ticket=++sequence;mode='';first=null;for(const b of body.querySelectorAll('button'))b.disabled=true;message(label);
    try{await fn(()=>ticket===sequence);}catch(e){if(ticket===sequence)message(`${e.message} Corregí la selección y reintentá.`,true);}finally{busy=false;for(const b of body.querySelectorAll('button'))b.disabled=false;apply.disabled=!preview;exportButton.disabled=!section||section.area===null||section.open>0;}}
  const choose=()=>{if(!selected)throw new Error('Elegí una pieza de la lista.');return selected;};
  const reset=()=>{cancel();const ids=new Set((viewer.items??[]).map(i=>i.id));if(!ids.has(selected))selected='';target.replaceChildren(el('option',{value:'',text:'Elegir pieza…'}),...(viewer.items??[]).map(item=>el('option',{value:item.id,text:`${item.name} · ${item.id}`})));target.value=selected;};
  body.append(field('Pieza para inspección / visibilidad',target),el('div',{class:'row-wrap'},
    button('Ocultar',()=>{try{cancel();viewer.setItemHidden(choose());message('Pieza oculta. Restaurar todas recupera la vista.');}catch(e){message(e.message,true);}}),
    button('Aislar',()=>{try{cancel();const id=choose();viewer.restoreItems();for(const item of viewer.items??[])if(item.id!==id)viewer.setItemHidden(item.id);message('Pieza aislada.');}catch(e){message(e.message,true);}}),
    button('Restaurar todas',()=>{cancel();viewer.restoreItems();message('Visibilidad restaurada.');})));
  body.append(button('Inspeccionar geometría',()=>run('Analizando bordes y cuerpos…',async valid=>{
    const id=choose(),report=await hooks.audit(id);if(!valid())return;
    message(`${report.triangles} triángulos · ${report.bodies} componentes conectados · ${report.boundary} bordes abiertos · ${report.nonManifold} bordes no manifold · ${report.degenerate} degenerados. Inspección de malla con tolerancia ${report.tolerance.toExponential(1)} mm; no certifica un sólido.`);
    if(report.lines.length)output.append(button('Localizar bordes problemáticos',()=>viewer.showGuides({lines:report.lines.map(points=>({points})),labels:[]})));
    if(report.bodies>1)for(const [index,component] of (report.components??[]).entries())output.append(button(`Localizar componente ${index+1} (${component.triangles} triángulos)`,()=>{
      const corners=Array.from({length:8},(_,i)=>[0,1,2].map(k=>(i&(1<<k))?component.max[k]:component.min[k]));
      const lines=[];for(let i=0;i<8;i++)for(let k=0;k<3;k++)if(!(i&(1<<k)))lines.push({points:[corners[i],corners[i|(1<<k)]]});viewer.showGuides({lines,labels:[]});
    }));
    const errors=hooks.errors?.()??[];for(const error of errors)output.append(button(`${error.partId??''} / ${error.id}: ${error.error??'operación fallida'}`,()=>hooks.selectError(error)));
  })));
  body.append(el('b',{text:'Sección geométrica'}),field('Eje normal',axis),field('Posición absoluta (mm)',position));
  const sectionRun=approximate=>run('Calculando contornos de sección…',async valid=>{
    section=null;const result=await hooks.section(choose(),Number(axis.value),number(position),approximate);if(!valid())return;
    section=result;viewer.showGuides({lines:result.loops.map(loop=>({points:loop.closed?[...loop.points,loop.points[0]]:loop.points})),labels:[]});
    message(`${result.source??'Malla aproximada'} · ${result.loops.length} contornos · ${result.open} abiertos · área ${result.area===null?'no calculable':result.area.toFixed(3)+' mm²'} · perímetro ${result.perimeter.toFixed(3)} mm. Área y DXF muestreados; curvas B-Rep con tolerancia 0,02 mm.`);
  });
  const exportButton=button('Exportar sección DXF',()=>{try{downloadBlob(new Blob([sectionDxf(section)],{type:'application/dxf'}),'seccion.dxf');}catch(e){message(e.message,true);}});exportButton.disabled=true;
  body.append(el('div',{class:'row-wrap'},button('Sección B-Rep',()=>sectionRun(false)),button('Sección de malla',()=>sectionRun(true)),exportButton));
  const start=m=>{cancel();hooks.stopTools();mode=m;message(m==='align'?'Tocá una cara plana o cilíndrica de la pieza móvil; luego la referencia fija.':m==='angle'?'Tocá dos caras planas o cilíndricas para medir el ángulo entre sus normales/ejes.':'Tocá una cara o una arista. Escape cancela.');};
  body.append(el('b',{text:'Medición de entidades'}),el('div',{class:'row-wrap'},button('Medir cara',()=>start('face')),button('Medir arista',()=>start('edge')),button('Ángulo entre caras/ejes',()=>start('angle'))),
    el('b',{text:'Alinear / encastrar instancias'}),field('Separación axial (mm)',gap),field('Giro adicional sobre eje (°)',spin),button('Seleccionar referencias',()=>start('align')));
  const apply=button('Aplicar colocación',()=>{const pending=preview;return run('Aplicando colocación…',async()=>{if(!pending)throw new Error('Prepará una colocación primero.');await hooks.applyAlignment(pending);preview=null;message('Colocación aplicada. Podés deshacer.');});});apply.disabled=true;
  body.append(el('div',{class:'row-wrap'},apply,button('Cancelar herramienta',()=>{cancel();message('Herramienta cancelada.');})));
  viewer.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  viewer.canvas.addEventListener('pointerup',e=>{
    if(!mode||busy||!down||e.button>0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;down=null;
    const active=mode,hit=active==='edge'?viewer.edgeAt(e):viewer.surfaceAt(e);if(!hit)return;
    if((active==='align'||active==='angle')&&!first){first=hit;message('Referencia móvil seleccionada. Tocá la referencia fija.');return;}
    const source=first;const ticket=++sequence;busy=true;message('Consultando geometría B-Rep…');
    (async()=>{try{
      if(active==='angle'){
        const a=await hooks.entity(source),b=await hooks.entity(hit);if(ticket!==sequence)return;
        if(!a.normal||!b.normal)throw new Error('Elegí caras planas o cilíndricas con una normal/eje definido.');
        const cosine=a.normal.reduce((sum,v,k)=>sum+v*b.normal[k],0)/Math.hypot(...a.normal)/Math.hypot(...b.normal);
        message(`Ángulo orientado ${Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI}° · menor ángulo entre planos/ejes ${(Math.acos(Math.max(0,Math.min(1,Math.abs(cosine))))*180/Math.PI).toFixed(4)}° (B-Rep)`);mode='';first=null;
      }else if(active==='align'){
        const result=await hooks.prepareAlignment(source,hit,{gap:number(gap),spin:number(spin)});if(ticket!==sequence)return;
        preview=result;viewer.previewPlacement(result.id,result.transform);apply.disabled=false;mode='';first=null;
        message(`Vista previa ${result.id}: posición ${result.transform.pos.map(v=>v.toFixed(3)).join(' / ')} mm. Aplicar confirma; Cancelar restaura. Esta colocación no crea una relación persistente.`);
      }else{
        const entity=await hooks.entity(active==='edge'?{itemId:hit.itemId,edgeIndex:hit.index}:hit);if(ticket!==sequence)return;
        message(`${entity.type} · ${entity.length!==undefined?'longitud '+entity.length.toFixed(4)+' mm':'área '+entity.area.toFixed(4)+' mm²'}${entity.radius!==undefined?' · radio '+entity.radius.toFixed(4)+' mm · diámetro '+(entity.radius*2).toFixed(4)+' mm':''}`);
        if(entity.normal&&entity.origin)viewer.showGuides({lines:[{points:[entity.origin,entity.origin.map((v,k)=>v+entity.normal[k]*30)]}],labels:[]});
      }
    }catch(error){if(ticket===sequence)message(error.message+' Volvé a seleccionar las referencias.',true);mode='';first=null;}finally{busy=false;}})();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancel();message('Herramienta cancelada.');}});
  return {root,reset};
}
