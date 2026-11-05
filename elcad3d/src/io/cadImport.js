import { parseDxf } from './dxfReader.js';
import { readDwg } from './dwgReader.js';
import { buildProfiles } from './profileBuilder.js';

// Lee un .dxf o .dwg (File o { name, arrayBuffer() }) → { entities, layers, units, unitScale, skipped, format }.
export async function readCadFile(file) {
  const name = (file.name ?? '').toLowerCase();
  if (name.endsWith('.dwg')) return { ...(await readDwg(await file.arrayBuffer())), format: 'DWG' };
  if (name.endsWith('.dxf')) {
    const text = await file.text();
    if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Es un DXF binario: guardalo como DXF ASCII (texto) e importalo de nuevo.');
    return { ...parseDxf(text), format: 'DXF' };
  }
  throw new Error('Formato no soportado: usá .dxf o .dwg');
}

// Contornos listos para el boceto, con las capas elegidas y la escala (a mm).
export function profilesFrom(cad, { layers = null, scale = cad.unitScale, tolerance = 0.01 } = {}) {
  const wanted = layers ? new Set(layers) : null;
  const entities = cad.entities.filter((entity) => !wanted || wanted.has(entity.layer));
  return { ...buildProfiles(entities, { scale, tolerance }), considered: entities.length };
}
