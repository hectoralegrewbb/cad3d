import {el,button,field,selectInput,textInput,checkInput} from './dom.js';
import {loopsToLaserEntities} from '../core/laserOutline.js';
import {laserEntitiesToDxf,bulgeArc} from '../io/laserDxf.js';

const fileStem=value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'pieza';
const svgElement=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
function previewSvg(data){
  const pad=Math.max(data.width,data.height)*.04||1,svg=svgElement('svg',{viewBox:`${-pad} ${-pad} ${data.width+2*pad} ${data.height+2*pad}`,role:'img','aria-label':'Perfil 2D de corte en milímetros',class:'laser-preview'}),group=svgElement('g',{transform:`translate(0 ${data.height}) scale(1 -1)`,fill:'none',stroke:'#66dcce','stroke-width':Math.max(data.width,data.height)/400||.1});svg.append(group);
  for(const c of data.circles)group.append(svgElement('circle',{cx:c.x,cy:c.y,r:c.r}));
  for(const poly of data.polylines){const points=poly.vertices;let path=`M ${points[0].x} ${points[0].y}`;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(a.bulge){const arc=bulgeArc(a,b,a.bulge);path+=` A ${arc.radius} ${arc.radius} 0 ${Math.abs(4*Math.atan(a.bulge))>Math.PI?1:0} ${a.bulge>0?1:0} ${b.x} ${b.y}`;}else path+=` L ${b.x} ${b.y}`;}group.append(svgElement('path',{d:path+' Z'}));}
  return svg;
}
export async function openLaserPanel(hooks,{format='r2000'}={}){
  const overlay=el('div',{class:'modal-overlay laser-overlay'}),card=el('div',{class:'modal fabrication-modal'}),status=el('p',{role:'status','aria-live':'polite'}),preview=el('div'),controls=el('div',{class:'fabrication-controls'});overlay.append(card);document.body.append(overlay);
  let closed=false,busy=false,profile=null,sequence=0,accepted=false;
  const close=()=>{closed=true;sequence++;hooks.highlight?.(null,null,null);hooks.cancelPick?.();document.removeEventListener('keydown',key);overlay.remove();};
  const key=e=>{if(e.key==='Escape'){if(overlay.hidden){overlay.classList.add('modal-overlay');overlay.hidden=false;hooks.cancelPick?.();}else close();}};document.addEventListener('keydown',key);
  const say=(text,error=false)=>{status.className=error?'err-block':'hint-block';status.textContent=text;};
  const choices=hooks.parts(),partSelect=selectInput(choices.map(p=>[p.id,`${p.name} · ${p.quantity} u.`]),hooks.activeId,()=>load()),faceSelect=selectInput([],'',()=>load(Number(faceSelect.value))),formatSelect=selectInput([['r2000','DXF R2000 (contornos y arcos)'],['r12','DXF R12 (segmentos compatibles)']],format,()=>{}),material=textInput('',()=>{}),thickness=textInput('',()=>{});
  const confirm=checkInput(false,v=>{accepted=v;download.disabled=!profile||busy||(!profile.assessment.prismatic&&!accepted);},'Confirmo que exporto sólo el perfil seleccionado; rebajes, curvas y pliegues requieren revisar fabricación.');
  const run=async fn=>{if(busy||closed)return;busy=true;card.setAttribute('aria-busy','true');const token=++sequence;download.disabled=true;batch.disabled=true;for(const control of controls.querySelectorAll('select,input,button'))control.disabled=true;try{await fn(()=>!closed&&token===sequence);}catch(e){if(!closed)say(`${e.message} Corregí la pieza o elegí otra cara y reintentá.`,true);}finally{busy=false;card.setAttribute('aria-busy','false');if(!closed){for(const control of controls.querySelectorAll('select,input,button'))control.disabled=false;download.disabled=!profile||(!profile.assessment.prismatic&&!accepted);batch.disabled=false;}}};
  async function load(faceIndex){profile=null;preview.replaceChildren();faceSelect.replaceChildren();hooks.highlight?.(null,null,null);accepted=false;confirm.querySelector('input').checked=false;await run(async valid=>{
    say('Construyendo la pieza real y preparando contornos…');const result=await hooks.document(partSelect.value,faceIndex);if(!valid())return;
    const selectedIndex=faceIndex??result.faces[0].index;faceSelect.replaceChildren(...result.faces.map(f=>el('option',{value:f.index,selected:f.index===selectedIndex,text:`Cara ${f.index+1} · ${f.area.toFixed(2)} mm² · normal ${f.normal.map(v=>v.toFixed(2)).join('/')}`})));
    const geometry=loopsToLaserEntities(result.outline);laserEntitiesToDxf(geometry);profile={...result,geometry,assessment:result.outline.assessment};preview.replaceChildren(previewSvg(geometry));hooks.highlight?.(partSelect.value,result.outline,geometry);
    const a=profile.assessment;say(`${geometry.width} × ${geometry.height} mm · ${geometry.holes} huecos · espesor geométrico estimado ${a.thickness.toFixed(3)} mm. ${a.reason}${a.approximate?' Hay curvas aproximadas adaptativamente (objetivo 0,02 mm): revisar tolerancia.':''}`);
  });}
  const download=button('Descargar DXF de esta pieza',()=>{if(!profile)return;try{hooks.saveFile(`${fileStem(partSelect.value)}-laser.dxf`,laserEntitiesToDxf(profile.geometry,{format:formatSelect.value}));say('DXF descargado: escala 1:1, milímetros, sin compensar kerf.');}catch(e){say(e.message,true);}});download.disabled=true;
  const batch=button('Descargar lote del proyecto (ZIP)',()=>run(async valid=>{
    const files=[],rows=[['pieza','nombre','cantidad','material','espesor_declarado_mm','ancho_mm','alto_mm','estado','archivo']],errors=[];
    const declared=thickness.value.trim()?Number(thickness.value.replace(',','.')):null;if(declared!==null&&(!Number.isFinite(declared)||declared<=0))throw new Error('El espesor declarado debe ser positivo.');
    for(const part of choices){say(`Preparando ${part.name}…`);try{
      // La cara elegida se conserva para la pieza actual; las restantes usan su cara plana mayor.
      const result=part.id===partSelect.value&&profile?profile:await hooks.document(part.id),geometry=result.geometry??loopsToLaserEntities(result.outline),assessment=result.assessment??result.outline.assessment;
      if(!valid())return;
      if(!assessment.prismatic)throw new Error('Requiere seleccionar/revisar perfil: no se incorpora automáticamente al lote.');
      const filename=`${String(choices.indexOf(part)+1).padStart(2,'0')}-${fileStem(part.id)}-laser.dxf`;files.push({name:filename,text:laserEntitiesToDxf(geometry,{format:formatSelect.value})});rows.push([part.id,part.name,part.quantity,material.value,declared??'',geometry.width,geometry.height,assessment.approximate?'CURVAS_APROXIMADAS':'PERFIL',filename]);
    }catch(e){errors.push(`${part.name}: ${e.message}`);rows.push([part.id,part.name,part.quantity,material.value,declared??'','','',`NO_EXPORTADA: ${e.message}`,'']);}}
    if(!files.length)throw new Error('Ninguna pieza tiene un perfil apto para el lote. Exportá las caras revisadas individualmente.');
    const cell=v=>`"${String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')}"`;
    files.push({name:'listado.csv',text:'\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')},{name:'LEEME.txt',text:'DXF 1:1 en mm. Un archivo por pieza; cantidad en listado.csv. Perfil de cara, no desarrollo de chapa. Sin compensación de kerf; aplicarla en CAM según material y máquina. Espesor declarado no sustituye medición. Revisar todas las dimensiones antes de fabricar.\n'+errors.join('\n')});
    hooks.saveBundle(files);say(`${files.length-2} piezas exportadas. ${errors.length} excluidas: ${errors.join(' · ')||'ninguna'}. Revisá listado.csv.`);
  }));
  const pick=button('Elegir cara de la pieza activa en el modelo',()=>{if(partSelect.value!==hooks.activeId)return say('Primero elegí la pieza activa de la lista.',true);overlay.hidden=true;overlay.classList.remove('modal-overlay');hooks.pickFace(async hit=>{overlay.classList.add('modal-overlay');overlay.hidden=false;try{const index=await hooks.faceIndex(hit);if(!closed)await load(index);}catch(e){say(e.message,true);}});});
  controls.append(field('Pieza',partSelect),field('Cara',faceSelect),pick,field('Formato',formatSelect),field('Material para listado (opcional)',material),field('Espesor declarado para listado (mm, opcional)',thickness),confirm);
  card.append(el('h3',{text:'Preparar corte láser'}),el('p',{class:'muted',text:'Perfil plano 1:1 con huecos. El lote usa cantidad de instancias; para piezas sin instanciar declara 1 unidad. No desarrolla automáticamente tolvas, conos ni superficies curvas. Kerf: compensar en el software de la máquina.'}),controls,preview,status,el('div',{class:'row-wrap'},download,batch,button('Cerrar',close)));
  await load();return {close};
}
