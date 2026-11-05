
// DWG → entidades 2D (mismo modelo que el lector de DXF). Usa LibreDWG compilado a WASM (vendor/libredwg), que se carga recién
// al importar un .dwg. Cada lectura crea un módulo nuevo: si el decodificador se cae con un archivo, no contamina al siguiente.
const flipOf = (entity) => (entity.extrusionDirection?.z ?? 0) < 0;

// Convierte la base de datos de LibreDWG (db.entities) al modelo interno. Puro: se puede probar sin WASM.
export function dwgToEntities(db) {
  const entities = [];
  const skipped = {};
  const skip = (type) => (skipped[type] = (skipped[type] ?? 0) + 1);
  (db.entities ?? []).forEach((entity) => {
    const layer = entity.layer ?? '0';
    const flip = flipOf(entity);
    const mx = (x) => (flip ? -x : x);
    switch (entity.type) {
      case 'LINE':
        entities.push({ type: 'line', layer, a: [mx(entity.startPoint.x), entity.startPoint.y], b: [mx(entity.endPoint.x), entity.endPoint.y] });
        break;
      case 'CIRCLE':
        entities.push({ type: 'circle', layer, c: [mx(entity.center.x), entity.center.y], r: entity.radius });
        break;
      case 'ARC': {
        let [a0, a1] = [entity.startAngle, entity.endAngle]; // LibreDWG entrega radianes
        if (flip) [a0, a1] = [Math.PI - a1, Math.PI - a0];
        entities.push({ type: 'arc', layer, c: [mx(entity.center.x), entity.center.y], r: entity.radius, a0, a1 });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE2D': {
        const pts = (entity.vertices ?? []).map((v) => ({ x: mx(v.x), y: v.y, bulge: flip ? -(v.bulge ?? 0) : (v.bulge ?? 0) }));
        // Bit de cerrado: 1 (DXF) o 512 (DWG). Si la lista repite el primer vértice al final, el encadenado la cierra igual.
        const closed = ((entity.flag ?? 0) & 1) === 1 || ((entity.flag ?? 0) & 512) === 512;
        if (pts.length >= 2) entities.push({ type: 'polyline', layer, closed, pts });
        break;
      }
      case 'ELLIPSE': {
        const m = entity.majorAxisEndPoint;
        const full = Math.abs((entity.endAngle ?? 2 * Math.PI) - (entity.startAngle ?? 0) - 2 * Math.PI) < 1e-6;
        if (!full) {
          skip('ELLIPSE (arco)');
          break;
        }
        entities.push({ type: 'ellipse', layer, c: [mx(entity.center.x), entity.center.y], major: Math.hypot(m.x, m.y), ratio: entity.axisRatio ?? 1, angle: flip ? Math.PI - Math.atan2(m.y, m.x) : Math.atan2(m.y, m.x) });
        break;
      }
      default:
        skip(entity.type === 'INSERT' ? 'INSERT (bloques)' : entity.type);
    }
  });
  const layers = [...new Set(entities.map((entity) => entity.layer))].sort();
  return { entities, layers, skipped };
}

