import { particleConfig } from './particleConfig.js';
import { solveAssemblyMates } from './assemblyMates.js';
// Frontera de archivos: validar antes de sustituir el documento abierto.
export const FILE_LIMIT = 100 * 1024 * 1024;
const fail = (message) => { throw new Error(`Archivo inválido: ${message}`); };
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const id = (v) => typeof v === 'string' && /^[\w:.-]{1,128}$/.test(v);
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
export function parseJson(text) {
  if (typeof text !== 'string' || text.length > FILE_LIMIT) fail('el archivo supera 100 MiB');
  return JSON.parse(text, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('clave reservada');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('número no finito');
    return value;
  });
}
export function validatePart(part) {
  if (!object(part) || !object(part.meta) || !Array.isArray(part.features) || !Array.isArray(part.params)) fail('estructura de pieza');
  if (typeof part.meta.name !== 'string' || part.meta.name.length > 500) fail('nombre de pieza');
  if (part.meta.units && part.meta.units !== 'mm') fail('la unidad interna debe ser mm');
  if (part.features.length > 5000 || part.params.length > 1000) fail('demasiadas operaciones o parámetros');
  const names = new Set();
  part.params.forEach((p) => {
    if (!object(p) || typeof p.name !== 'string' || !/^[A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*$/.test(p.name) || names.has(p.name)) fail('parámetro duplicado o inválido');
    if (!['string', 'number'].includes(typeof p.value)) fail('valor de parámetro');
    names.add(p.name);
  });
  const ids = new Set();
  part.features.forEach((f) => {
    if (!object(f) || !id(f.id) || ids.has(f.id)) fail('ID de operación duplicado o inválido');
    ids.add(f.id);
  });
  part.features.forEach((f) => {
    if (!['sketch','extrude','revolve','hole','thread','gear','screw','pipe','frame','pattern','mesh','fillet','chamfer','step','loft','sweep','shell'].includes(f.type)) fail('tipo de operación no compatible');
    for (const key of ['sketch', 'source', 'endSketch', 'pathSketch', ...(f.type==='pipe'?['from']:[])]) if (f[key] && !ids.has(f[key])) fail(`referencia inexistente en ${f.id}`);
    if (f.type === 'sketch') {
      if(!Array.isArray(f.entities)||f.entities.length>100000)fail('entidades de boceto');
      const entityIds=new Set();
      f.entities.forEach(e=>{if(!object(e)||!id(e.id)||entityIds.has(e.id)||!['rect','circle','ellipse','slot','poly','polygon','guide'].includes(e.t))fail('entidad o ID de boceto');entityIds.add(e.id);});
    }
    if(f.constraints){
      if(!Array.isArray(f.constraints)||f.constraints.length>500)fail('restricciones de boceto');
      const entities=new Set((f.entities??[]).map(e=>e.id));
      f.constraints.forEach(c=>{if(!object(c)||!id(c.id)||!entities.has(c.a)||(c.b&&!entities.has(c.b)))fail('referencia de restricción');});
    }
    if (f.drawing?.views) f.drawing.views.forEach(v=>{if(!id(v.id))fail('ID de vista');});
    if (f.type==='step' && (typeof f.brep!=='string'||f.brep.length>FILE_LIMIT))fail('sólido STEP guardado');
    if (f.mesh) {
      const m = f.mesh;
      if (!Number.isSafeInteger(m.nv) || !Number.isSafeInteger(m.nt) || m.nv < 3 || m.nt < 1 || m.nt > 2000000 || m.nv > 6000000 || typeof m.v !== 'string' || typeof m.t !== 'string') fail('malla inválida o demasiado grande');
    }
  });
  if(part.simulation!==undefined)particleConfig(part.simulation);
  if(part.drawing?.views)part.drawing.views.forEach(v=>{if(!id(v.id))fail('ID de vista');});
  const counters={...(part.counters??{})};
  for(const f of part.features){const match=f.id.match(/^([a-z]+)(\d+)$/);if(match)counters[match[1]]=Math.max(Number(counters[match[1]])||0,Number(match[2]));for(const e of f.entities??[]){const m=e.id.match(/^e(\d+)$/);if(m)counters.ent=Math.max(Number(counters.ent)||0,Number(m[1]));}}
  return {...part,counters};
}
export function validateProject(data) {
  if (!object(data) || data.format !== 'elcad3d-project' || data.version !== 1) fail('formato o versión no compatible');
  if (!Array.isArray(data.parts) || !data.parts.length || data.parts.length > 8 || !Array.isArray(data.instances) || data.instances.length > 10000) fail('piezas o instancias');
  const ids = new Set();
  const parts = data.parts.map((p) => {
    if (!object(p) || !id(p.id) || ids.has(p.id)) fail('ID de pieza');
    ids.add(p.id);
    return { ...p, part: validatePart(p.part) };
  });
  const instances = new Set();
  data.instances.forEach((i) => {
    if (!object(i) || !id(i.id) || instances.has(i.id) || !ids.has(i.partId) || !vector(i.pos) || !vector(i.rot)) fail('instancia o transformación');
    instances.add(i.id);
  });
  if (!ids.has(data.activePartId)) fail('pieza activa inexistente');
  if(data.assembly?.drawing?.views)data.assembly.drawing.views.forEach(v=>{if(!id(v.id))fail('ID de vista de conjunto');});
  if(data.simulation!==undefined)particleConfig(data.simulation);
  if(data.mates&&!Array.isArray(data.mates))fail('relaciones de conjunto');
  const result={ ...data, parts, counters: { ...(data.counters ?? {}) } };
  for(const p of parts){const m=p.id.match(/^p(\d+)$/);if(m)result.counters.part=Math.max(Number(result.counters.part)||0,Number(m[1]));}
  for(const i of data.instances){const m=i.id.match(/^i(\d+)$/);if(m)result.counters.instance=Math.max(Number(result.counters.instance)||0,Number(m[1]));}
  return solveAssemblyMates(result);
}
