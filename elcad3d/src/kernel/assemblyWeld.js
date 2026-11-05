import { isValidShape } from './partBuilder.js';

// Unión booleana de instancias ya colocadas. No mueve piezas ni rellena separaciones.
export function weldAssembly(rep, built, ids) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 256 || new Set(ids).size !== ids.length) {
    throw new Error('Seleccioná entre 2 y 256 segmentos distintos para unir.');
  }
  const selected = ids.map(id => built.instances.find(instance => instance.id === id));
  if (selected.some(instance => !instance?.shape || instance.meshOnly)) {
    throw new Error('La unión necesita sólidos B-Rep. Convertí las mallas a sólidos antes de unirlas.');
  }
  if (selected.some(instance => Object.values(built.partById[instance.partId].results).some(result => result.status === 'error'))) {
    throw new Error('Corregí las operaciones con error antes de unir.');
  }
  let shape = selected[0].shape.clone();
  const remaining = selected.slice(1);
  const distance = new rep.DistanceTool();
  try {
    // Resolver por conectividad, no por orden de selección: A-C-B también debe funcionar.
    while (remaining.length) {
      const nextIndex = remaining.findIndex(instance => distance.distanceBetween(shape, instance.shape) <= 1e-6);
      if (nextIndex < 0) throw new Error('Hay segmentos separados: alineá sus extremos hasta que las paredes se toquen o solapen. No se rellenaron huecos.');
      const instance = remaining.splice(nextIndex, 1)[0];
      const next = shape.fuse(instance.shape);
      shape.delete();
      shape = next;
    }
    if (!isValidShape(rep, shape)) throw new Error('La unión no produjo un sólido válido. Revisá contactos sólo por arista y paredes cruzadas.');
    const solids = [...rep.iterTopo(shape.wrapped, 'solid')];
    const count = solids.length;
    solids.forEach(solid => solid.delete?.());
    if (count !== 1) throw new Error('Los segmentos no forman un único sólido conectado. Las paredes deben compartir superficie, no sólo una arista.');
    return { brep: shape.serialize(), volume: rep.measureVolume(shape), sources: [...ids] };
  } finally {
    shape.delete();
    distance.delete();
  }
}
