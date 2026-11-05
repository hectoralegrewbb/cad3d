import { el, button, selectInput, field } from './dom.js';
import { downloadBlob, listRevisions, clearRevisions } from '../io/persistence.js';
import { parseProject } from '../core/projectModel.js';

// Herramientas de sesión. Recibe únicamente APIs de la raíz de composición.
export function createWorkbench(viewer, hooks) {
  const host=document.querySelector('.viewport');
  const saved=el('span',{class:'save-state',role:'status','aria-live':'polite',text:'Guardado local pendiente'});
  const retry=button('Reintentar guardado',()=>hooks.save()); retry.hidden=true;
  const state=el('div',{class:'document-state'},saved,retry);
  document.querySelector('.topbar').append(state);
  const details=el('details',{class:'workbench-tools'},el('summary',{text:'Herramientas de vista y proyecto'}));
  const tools=el('div',{class:'workbench-body'}); details.append(tools);host.append(details);
  const run=async(fn)=>{try{await fn();}catch(error){hooks.status(error.message,true);}};
  const projection=button('Ortográfica',()=>{viewer.setProjection(!viewer.camera.isOrthographicCamera);projection.textContent=viewer.camera.isOrthographicCamera?'Perspectiva':'Ortográfica';});
  tools.append(projection,selectInput([['medium','Calidad media'],['low','Calidad baja'],['high','Calidad alta']],'medium',v=>viewer.setQuality(v)));
  viewer.setQuality('medium');
  const axis=selectInput([['','Sin corte'],['0','Corte X'],['1','Corte Y'],['2','Corte Z']],'',updateSection);
  const amount=el('input',{type:'range',min:0,max:100,value:50,'aria-label':'Posición del plano de corte',onInput:updateSection});
  function updateSection(){viewer.setSection(axis.value===''?null:Number(axis.value),Number(amount.value)/100);}
  tools.append(field('Corte visual (sin tapa)',axis),amount);
  let measuring=false,first=null,measureBodies=false;
  const measure=button('Medir 2 puntos',()=>{
    measuring=!measuring;first=null;measureBodies=false;measure.classList.toggle('active',measuring);
    viewer.cancelPlacement();
    if(measuring){hooks.stopTools();hooks.status('Medición: tocá dos puntos sobre las superficies. Escape cancela.');}
    else viewer.clearGuides();
  });
  const clearance=button('Separación mínima',()=>{measureBodies=true;measuring=true;first=null;hooks.stopTools();hooks.status('Conjunto: elegí dos cuerpos para medir su separación mínima B-Rep.');});
  tools.append(measure,clearance);
  viewer.canvas.addEventListener('pointerup',async event=>{
    if(!measuring||event.button>0)return;
    const found=viewer.surfaceAt(event);if(!found)return;
    if(measureBodies){
      const id=viewer.pickItem(event);if(!id)return;
      if(!first){first=id;hooks.status('Primer cuerpo elegido. Seleccioná el segundo.');return;}
      try {const result=await hooks.clearance(first,id);hooks.status(`Separación mínima: ${result.distance.toFixed(4)} mm (B-Rep)`);}
      catch(error){hooks.status(error.message,true);}finally{first=null;}
      return;
    }
    if(!first){first=found;hooks.status('Primer punto elegido. Seleccioná el segundo.');return;}
    const result=viewer.measureBetween(first,found);
    viewer.showGuides({lines:[{points:[first.point,found.point]}],labels:[{p:found.point,text:`${result.distance.toFixed(3)} mm`}]});
    hooks.status(`Distancia ${result.distance.toFixed(3)} mm · ΔXYZ ${result.delta.map(v=>v.toFixed(3)).join(' / ')} mm · normales ${result.angle.toFixed(2)}° (malla)`);
    first=null;
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){measuring=false;first=null;measure.classList.remove('active');viewer.clearGuides();document.body.dataset.drawer='';}});
  tools.append(button('Recuperar motor',()=>run(hooks.recover)),button('Revisiones locales',()=>run(recovery)),button('Exportar BOM CSV',()=>run(hooks.bom)),button('Lista de corte CSV',()=>run(hooks.cutList)));
  const views=el('div',{class:'row-wrap'},...['iso','front','back','left','right','top','bottom'].map((v,i)=>button(['Iso','Frente','Atrás','Izquierda','Derecha','Planta','Inferior'][i],()=>viewer.setView(v))));tools.append(views);
  const nav=el('nav',{class:'mobile-nav','aria-label':'Paneles'},...['project','properties','tools'].map((name,i)=>button(['Proyecto','Propiedades','Herramientas'][i],()=>{
    if(name==='tools'){document.body.dataset.drawer='';details.open=!details.open;return;}
    document.body.dataset.drawer=document.body.dataset.drawer===name?'':name;
  })));
  document.body.append(nav);
  const closeDrawer=button('Cerrar panel',()=>{document.body.dataset.drawer='';});closeDrawer.classList.add('drawer-close');document.querySelector('.left').prepend(closeDrawer);
  const closeRight=button('Cerrar panel',()=>{document.body.dataset.drawer='';});closeRight.classList.add('drawer-close');document.querySelector('.right').prepend(closeRight);
  async function recovery(){
    const revisions=await listRevisions();
    const overlay=el('div',{class:'modal-overlay'}),card=el('div',{class:'modal'});
    overlay.append(card);const close=()=>overlay.remove();
    card.append(el('h3',{text:'Revisiones locales'}),el('p',{class:'muted',text:'Hasta 10 revisiones, separadas 30 segundos. Permanecen en este navegador hasta eliminarlas o borrar sus datos.'}));
    if(!revisions.length)card.append(el('p',{text:'No hay revisiones todavía.'}),button('Guardar ahora',()=>run(async()=>{await hooks.save();close();await recovery();})));
    revisions.forEach(revision=>card.append(button(new Date(revision.at).toLocaleString('es-AR'),()=>run(async()=>{
      const project=parseProject(revision.text);
      if(!confirm('¿Restaurar esta revisión? Descargá el proyecto actual si necesitás conservarlo.'))return;
      hooks.restore(project);await hooks.save();close();
    }))));
    card.append(button('Eliminar revisiones',()=>run(async()=>{if(confirm('¿Eliminar todas las revisiones locales? El proyecto actual se conserva.')){await clearRevisions();close();}}),{danger:true}),button('Cerrar',close));
    document.body.append(overlay);
  }
  // Accesibilidad compartida para diálogos existentes y nuevos.
  const modalStates=new Map();
  new MutationObserver(()=>{
    for(const node of document.querySelectorAll('.modal-overlay,.help-modal:not([hidden])')) if(!modalStates.has(node)){
      const previous=document.activeElement,card=node.querySelector('.modal,.help-card')??node;
      card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.tabIndex=-1;
      const title=card.querySelector('h3');if(title){title.id ||= `dialog-${modalStates.size}-${Date.now()}`;card.setAttribute('aria-labelledby',title.id);}
      modalStates.set(node,previous);queueMicrotask(()=>{if(node.isConnected)(card.querySelector('button,input,select')??card).focus();});
    }
    for(const [node,previous] of modalStates)if(!node.isConnected||node.hidden){modalStates.delete(node);if(previous?.isConnected)previous.focus();}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('keydown',event=>{
    const modal=[...modalStates.keys()].filter(n=>n.isConnected&&!n.hidden).at(-1);if(!modal)return;
    if(event.key==='Escape'){
      const cancel=[...modal.querySelectorAll('button')].find(n=>!n.disabled&&/^(Cerrar|Cancelar)/i.test(n.textContent.trim()));
      if(cancel){event.preventDefault();event.stopImmediatePropagation();cancel.click();return;}
    }
    if(event.key==='Tab'){
      const nodes=[...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);
      if(!nodes.length){event.preventDefault();return;}
      if(!modal.contains(document.activeElement)){event.preventDefault();nodes[0].focus();return;}
      if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
    }
  },true);
  viewer.onContextError=(message)=>hooks.status(message,true);
  return { setSaving(kind){saved.textContent={saving:'Guardando…',saved:'Guardado local',error:'Error al guardar. Descargá el proyecto o reintentá.'}[kind]??kind; saved.dataset.state=kind;retry.hidden=kind!=='error';}, sync(){first=null;updateSection();} };
}
export function downloadCsv(filename, rows) {
  const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)&&typeof value!=='number')text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};
  downloadBlob(new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),filename);
}
