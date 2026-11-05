import { defaultGearFeature } from '../kernel/gearGeometry.js';
import { defaultThreadFeature } from '../kernel/threadGeometry.js';
import { defaultScrewFeature } from '../kernel/screwGeometry.js';
import { defaultPipeFeature } from '../kernel/pipeGeometry.js';
import { defaultFrameFeature } from '../kernel/frameGeometry.js';
// Modelo de la pieza: lista ordenada de operaciones (features) + parámetros nombrados.
// Todos los valores numéricos pueden ser número o expresión ("D/2"). Unidades: mm.

export const planeNames = ['XY', 'XZ', 'YZ'];
export const planeLabels = { XY: 'Planta (XY)', XZ: 'Alzado (XZ)', YZ: 'Perfil (YZ)' };

export const createPart = (name = 'Pieza') => ({
  meta: { name, units: 'mm', version: 1, material: '', sheet: 'A4' },
  params: [],
  features: [],
  counters: { sketch: 0, extrude: 0, revolve: 0, hole: 0, thread: 0, gear: 0, screw: 0, fillet: 0, chamfer: 0, ent: 0 },
});

export const featureLabels = {
  sketch: 'Boceto',
  step: 'Sólido STEP',
  shell: 'Vaciado',
  loft: 'Loft entre perfiles',
  sweep: 'Barrido por trayectoria',
  extrude: 'Extrusión',
  revolve: 'Revolución',
  hole: 'Agujero',
  thread: 'Rosca',
  gear: 'Engranaje',
  screw: 'Tornillo sin fin',
  pipe: 'Cañería / curva',
  frame: 'Estructura (perfiles)',
  pattern: 'Repetir',
  mesh: 'Malla STL',
  fillet: 'Filete',
  chamfer: 'Chaflán',
};

export const nextId = (part, kind) => {
  const n = (part.counters[kind] ?? 0) + 1;
  return { id: `${kind}${n}`, counters: { ...part.counters, [kind]: n } };
};

export const makeEntity = (part, entity) => {
  const n = (part.counters.ent ?? 0) + 1;
  return { entity: { id: `e${n}`, ...entity }, counters: { ...part.counters, ent: n } };
};

// Valores por defecto de cada tipo de operación.
export const featureDefaults = {
  sketch: () => ({ plane: 'XY', offset: 0, entities: [] }),
  step: () => ({ brep: '', mode: 'add' }),
  shell: () => ({ thickness: 2, axis: 'z', side: 'max' }),
  loft: () => ({ sketch: null, endSketch: null, mode: 'add', ruled: false }),
  sweep: () => ({ sketch: null, pathSketch: null, mode: 'add' }),
  extrude: () => ({ sketch: null, depth: 10, symmetric: false, reverse: false, mode: 'add', through: false }),
  revolve: () => ({ sketch: null, angle: 360, axis: 'y', mode: 'add' }),
  hole: () => ({ plane: 'XY', offset: 0, x: 0, y: 0, d: 8, depth: 10, through: true, reverse: false, count: 1, pcd: 0, angle0: 0, cboreD: 0, cboreDepth: 0 }),
  thread: () => defaultThreadFeature(),
  gear: () => defaultGearFeature(),
  screw: () => defaultScrewFeature(),
  pipe: () => defaultPipeFeature(),
  frame: () => defaultFrameFeature(),
  mesh: () => ({ file: '', mesh: null, scale: 1, mode: 'add', meshOnly: false }),
  pattern: () => ({ source: null, kind: 'circular', count: 4, axis: 'z', cx: 0, cy: 0, cz: 0, total: 360, dx: 20, dy: 0, dz: 0 }),
  fillet: () => ({ radius: 1, selector: { kind: 'all' } }),
  chamfer: () => ({ size: 1, selector: { kind: 'all' } }),
};

export const selectorKinds = {
  all: 'Todas las aristas',
  circles: 'Aristas circulares',
  top: 'Cara superior (Z máx.)',
  bottom: 'Cara inferior (Z mín.)',
  vertical: 'Aristas verticales (∥ Z)',
  near: 'Aristas elegidas en el visor',
};

// Tipos de entidad de un boceto (todas cerradas; el boceto se rellena por anidación par/impar).
export const entityDefaults = {
  rect: () => ({ t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: true }),
  circle: () => ({ t: 'circle', x: 0, y: 0, d: 20 }),
  slot: () => ({ t: 'slot', x: 0, y: 0, length: 30, width: 10, angle: 0 }),
  polygon: () => ({ t: 'polygon', x: 0, y: 0, n: 6, d: 20, across: 'flats', angle: 0 }),
  guide: () => ({ t: 'guide', x: 0, y: 0, angle: 0 }),
  ellipse: () => ({ t: 'ellipse', x: 0, y: 0, w: 40, h: 20, angle: 0 }),
  poly: () => ({ t: 'poly', pts: [{ x: 0, y: 0, bulge: 0 }, { x: 20, y: 0, bulge: 0 }, { x: 20, y: 10, bulge: 0 }] }),
};

export const entityLabels = { rect: 'Rectángulo', circle: 'Círculo', slot: 'Ranura', ellipse: 'Elipse', poly: 'Polilínea', polygon: 'Polígono regular', guide: 'Guía (auxiliar)' };
