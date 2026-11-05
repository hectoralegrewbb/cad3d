import { buildDrawing } from './buildDrawing.js';
import { materials } from './features3d.js';

const formatMass = (kg) => (kg > 0 ? `${kg.toFixed(kg < 1 ? 3 : 2).replace('.', ',')} kg` : '—');

// Plano de conjunto: vistas del ensamble completo + lista de materiales + globos numerados por pieza.
export function buildAssemblyDrawing(rep, built, doc) {
  if (!built.compound) throw new Error('El ensamble no tiene instancias: agregá piezas desde el panel');
  const bom = built.bom.map((row) => ({ item: row.item, qty: row.qty, name: row.name, material: materials[row.material]?.label ?? '—', mass: formatMass(row.unitMass) }));
  const balloons = built.instances.map((inst) => ({ n: built.itemOfInstance[inst.id], point: inst.bounds[0].map((v, i) => (v + inst.bounds[1][i]) / 2) }));
  return buildDrawing(rep, built.compound, doc, { mass: built.totalMass, extras: { bom, balloons } });
}

// Documento "seudo-pieza" del conjunto: reutiliza los mismos comandos de plano (hoja, vistas, cotas, cajetín).
export const assemblyViews = [
  { id: 'front', kind: 'front', rotation: 0, showHidden: false, showAxes: true },
  { id: 'top', kind: 'top', rotation: 0, showHidden: false, showAxes: true },
];
