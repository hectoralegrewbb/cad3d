// Lector de DXF ASCII (solo geometría 2D): LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE/VERTEX, ELLIPSE (completa).
// Puro y sin DOM. Devuelve entidades en unidades del archivo; `unitScale` las lleva a mm. SPLINE, HATCH, TEXT, cotas e INSERT se
// cuentan en `skipped` para informarlo (no se inventa geometría).
const unitTable = { 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100, 15: 10000 };

const toPairs = (text) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  return pairs;
};

// Agrupa los pares en entidades: cada código 0 abre una nueva.
function groupEntities(pairs) {
  let start = -1;
  let end = pairs.length;
  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION') start = i + 1;
    else if (start >= 0 && pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC') {
      end = i;
      break;
    }
  }
  if (start < 0) return [];
  const groups = [];
  let current = null;
  for (let i = start; i < end; i += 1) {
    const [code, value] = pairs[i];
    if (code === 0) {
      current = { type: value, data: [] };
      groups.push(current);
    } else current?.data.push([code, value]);
  }
  return groups;
}

const first = (data, code, fallback = undefined) => {
  const found = data.find(([c]) => c === code);
  return found ? found[1] : fallback;
};
const number = (data, code, fallback = 0) => {
  const value = Number(first(data, code));
  return Number.isFinite(value) ? value : fallback;
};

// Espejado por dirección de extrusión (210/220/230): con Z = −1 el dibujo está visto "de atrás" y X cambia de signo.
const mirrored = (data) => number(data, 230, 1) < 0;

const deg = (value) => (value * Math.PI) / 180;

export const unitScaleOf = (units) => unitTable[units] ?? 1;

export function parseDxf(text) {
  const pairs = toPairs(text);
  let units = 0;
  for (let i = 0; i < pairs.length; i += 1) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') units = Number(pairs[i + 1]?.[1]) || 0;
  const entities = [];
  const skipped = {};
  const skip = (type) => (skipped[type] = (skipped[type] ?? 0) + 1);
  const groups = groupEntities(pairs);
  for (let g = 0; g < groups.length; g += 1) {
    const { type, data } = groups[g];
    const layer = first(data, 8, '0');
    const flip = mirrored(data);
    const mx = (x) => (flip ? -x : x);
    switch (type) {
      case 'LINE':
        entities.push({ type: 'line', layer, a: [mx(number(data, 10)), number(data, 20)], b: [mx(number(data, 11)), number(data, 21)] });
        break;
      case 'CIRCLE':
        entities.push({ type: 'circle', layer, c: [mx(number(data, 10)), number(data, 20)], r: number(data, 40) });
        break;
      case 'ARC': {
        let a0 = deg(number(data, 50));
        let a1 = deg(number(data, 51));
        if (flip) [a0, a1] = [Math.PI - a1, Math.PI - a0]; // espejo en X invierte el recorrido
        entities.push({ type: 'arc', layer, c: [mx(number(data, 10)), number(data, 20)], r: number(data, 40), a0, a1 });
        break;
      }
      case 'LWPOLYLINE': {
        const closed = (number(data, 70) & 1) === 1;
        const pts = [];
        data.forEach(([code, value]) => {
          if (code === 10) pts.push({ x: mx(Number(value)), y: 0, bulge: 0 });
          else if (code === 20 && pts.length) pts[pts.length - 1].y = Number(value);
          else if (code === 42 && pts.length) pts[pts.length - 1].bulge = flip ? -Number(value) : Number(value);
        });
        if (pts.length >= 2) entities.push({ type: 'polyline', layer, closed, pts });
        break;
      }
      case 'POLYLINE': {
        const closed = (number(data, 70) & 1) === 1;
        const pts = [];
        let k = g + 1;
        while (k < groups.length && groups[k].type === 'VERTEX') {
          pts.push({ x: number(groups[k].data, 10), y: number(groups[k].data, 20), bulge: number(groups[k].data, 42) });
          k += 1;
        }
        if (groups[k]?.type === 'SEQEND') k += 1;
        g = k - 1;
        if (pts.length >= 2 && (number(data, 70) & 8) === 0) entities.push({ type: 'polyline', layer, closed, pts }); // 8 = malla/3D: se ignora
        else skip('POLYLINE 3D');
        break;
      }
      case 'ELLIPSE': {
        const ux = number(data, 11);
        const uy = number(data, 21);
        const ratio = number(data, 40, 1);
        const t0 = number(data, 41, 0);
        const t1 = number(data, 42, Math.PI * 2);
        const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6 || Math.abs(t1 - t0) < 1e-9;
        if (full) entities.push({ type: 'ellipse', layer, c: [mx(number(data, 10)), number(data, 20)], major: Math.hypot(ux, uy), ratio, angle: flip ? Math.PI - Math.atan2(uy, ux) : Math.atan2(uy, ux) });
        else skip('ELLIPSE (arco)');
        break;
      }
      case 'VERTEX':
      case 'SEQEND':
        break;
      default:
        skip(type);
    }
  }
  const layers = [...new Set(entities.map((entity) => entity.layer))].sort();
  return { units, unitScale: unitTable[units] ?? 1, entities, layers, skipped };
}
