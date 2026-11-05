import { parseJson, validatePart, validateProject } from './validation.js';
import { createPart } from './partModel.js';

// Proyecto = varias piezas (máx. 8; se piensa para 5–6) + instancias colocadas en el ensamble.
export const MAX_PARTS = 8;
export const partColors = ['#9fb4cc', '#d6a35c', '#7fb88a', '#c47f9b', '#8f8fd1', '#c9c36a', '#d98a6a', '#6fb7c4'];

export const createProject = (part = createPart('Pieza 1')) => ({
  format: 'elcad3d-project',
  version: 1,
  name: 'Proyecto',
  parts: [{ id: 'p1', part }],
  instances: [],
  activePartId: 'p1',
  counters: { part: 1, instance: 0 },
});

const nextId = (project, kind, prefix) => {
  const n = (project.counters?.[kind] ?? 0) + 1;
  return [`${prefix}${n}`, { ...project.counters, [kind]: n }];
};

export function addPart(project, part) {
  if (project.parts.length >= MAX_PARTS) throw new Error(`Máximo ${MAX_PARTS} piezas por proyecto`);
  const [id, counters] = nextId(project, 'part', 'p');
  return { ...project, parts: [...project.parts, { id, part }], counters, activePartId: id };
}

export const duplicatePart = (project, id) => {
  const source = project.parts.find((item) => item.id === id);
  if (!source) return project;
  const copy = JSON.parse(JSON.stringify(source.part));
  copy.meta = { ...copy.meta, name: `${copy.meta.name} (copia)` };
  return addPart(project, copy);
};

export function removePart(project, id) {
  if (project.parts.length <= 1) throw new Error('El proyecto necesita al menos una pieza');
  const parts = project.parts.filter((item) => item.id !== id);
  return { ...project, parts, instances: project.instances.filter((inst) => inst.partId !== id), mates: (project.mates??[]).filter(m=>!project.instances.some(i=>i.partId===id&&(i.id===m.a||i.id===m.b))), activePartId: project.activePartId === id ? parts[0].id : project.activePartId };
}

export const updatePart = (project, id, part) => ({ ...project, parts: project.parts.map((item) => (item.id === id ? { ...item, part } : item)) });
export const setActivePart = (project, id) => (project.parts.some((item) => item.id === id) ? { ...project, activePartId: id } : project);

export function addInstance(project, partId, position = [0, 0, 0]) {
  const [id, counters] = nextId(project, 'instance', 'i');
  return { ...project, counters, instances: [...project.instances, { id, partId, pos: position, rot: [0, 0, 0] }] };
}
export const updateInstance = (project, id, patch) => {
  const instance=project.instances.find(i=>i.id===id);
  if(!instance||(instance.fixed&&(patch.pos||patch.rot)))return project;
  return {...project,instances:project.instances.map(i=>i.id===id?{...i,...patch}:i)};
};
export const removeInstance = (project, id) => ({ ...project, instances: project.instances.filter((inst) => inst.id !== id), mates:(project.mates??[]).filter(m=>m.a!==id&&m.b!==id) });

export function parseProject(text) {
  const data = parseJson(text);
  if (data?.format === 'elcad3d-project') return validateProject(data);
  // Un .part3d suelto se abre como proyecto de una pieza.
  if (data && Array.isArray(data.features) && Array.isArray(data.params) && data.meta) return createProject(validatePart(data));
  throw new Error('Archivo de proyecto inválido');
}
