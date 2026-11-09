import { evaluate } from '../core/expression.js';

// Geometría 2D pura (sin OpenCascade): resolución de expresiones y anidación de perfiles.

const num = (value, params, label) => {
  try {
    return evaluate(value, params);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
};
const positive = (value, label) => {
  if (!(value > 0)) throw new Error(`${label} debe ser mayor que 0`);
  return value;
};

// Entidad con todos los valores numéricos ya evaluados.
export function resolveEntity(entity, params) {
  switch (entity.t) {
    case 'rect':
    {
      const resolved = { ...entity, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), w: positive(num(entity.w, params, 'Ancho'), 'Ancho'), h: positive(num(entity.h, params, 'Alto'), 'Alto') };
      if (Array.isArray(entity.corners)) resolved.corners = [0, 1, 2, 3].map((i) => ({ r: num(entity.corners[i]?.r ?? 0, params, `Esquina ${i + 1} radio`), c: num(entity.corners[i]?.c ?? 0, params, `Esquina ${i + 1} chaflán`) }));
      return resolved;
    }
    case 'circle':
      return { ...entity, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), d: positive(num(entity.d, params, 'Diámetro'), 'Diámetro') };
    case 'slot': {
      const length = positive(num(entity.length, params, 'Largo'), 'Largo');
      const width = positive(num(entity.width, params, 'Ancho'), 'Ancho');
      if (length <= width) throw new Error('El largo de la ranura debe superar su ancho');
      return { ...entity, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), length, width, angle: num(entity.angle ?? 0, params, 'Ángulo') };
    }
    case 'ellipse':
      return { ...entity, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), w: positive(num(entity.w, params, 'Eje X'), 'Eje X'), h: positive(num(entity.h, params, 'Eje Y'), 'Eje Y'), angle: num(entity.angle ?? 0, params, 'Ángulo') };
    case 'polygon': {
      const n = Math.round(num(entity.n, params, 'Lados'));
      if (!(n >= 3 && n <= 64)) throw new Error('El polígono necesita entre 3 y 64 lados');
      return { ...entity, n, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), d: positive(num(entity.d, params, 'Medida'), 'Medida'), angle: num(entity.angle ?? 0, params, 'Giro'), across: entity.across === 'corners' ? 'corners' : 'flats' };
    }
    case 'guide':
      return { ...entity, x: num(entity.x, params, 'X'), y: num(entity.y, params, 'Y'), angle: num(entity.angle ?? 0, params, 'Ángulo') };
    case 'poly': {
      if (!Array.isArray(entity.pts) || entity.pts.length < 3) throw new Error('La polilínea necesita al menos 3 vértices');
      return {
        ...entity,
        pts: entity.pts.map((point, index) => ({
          x: num(point.x, params, `Vértice ${index + 1} X`),
          y: num(point.y, params, `Vértice ${index + 1} Y`),
          bulge: num(point.bulge ?? 0, params, `Vértice ${index + 1} arco`),
          r: num(point.r ?? 0, params, `Vértice ${index + 1} radio`),
          c: num(point.c ?? 0, params, `Vértice ${index + 1} chaflán`),
        })),
      };
    }
    default:
      throw new Error(`Entidad desconocida: ${entity.t}`);
  }
}

// Redondea (r) o chaflana (c) vértices de un contorno de tramos rectos. Devuelve vértices con "bulge" (arcos).
// Un vértice se deja intacto si alguno de sus dos tramos ya es un arco. Lanza error si el valor no cabe en los tramos vecinos.
export function applyCorners(pts, ops = []) {
  const n = pts.length;
  const out = [];
  pts.forEach((v, i) => {
    const { r = 0, c = 0 } = ops[i] ?? {};
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    if (!(r > 0 || c > 0) || prev.bulge || v.bulge) return out.push({ ...v, r: 0, c: 0 }); // r/c en 0: el contorno resultante no se vuelve a redondear
    const u = [prev.x - v.x, prev.y - v.y];
    const w = [next.x - v.x, next.y - v.y];
    const lu = Math.hypot(...u);
    const lw = Math.hypot(...w);
    const cos = Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (lu * lw)));
    const theta = Math.acos(cos);
    if (theta < 1e-3 || Math.abs(theta - Math.PI) < 1e-3) return out.push({ ...v, r: 0, c: 0 });
    const t = r > 0 ? r / Math.tan(theta / 2) : c;
    if (t > Math.min(lu, lw) / 2 + 1e-9) throw new Error(`${r > 0 ? 'El radio' : 'El chaflán'} del vértice ${i + 1} no cabe en los tramos vecinos`);
    const a = { x: v.x + (u[0] / lu) * t, y: v.y + (u[1] / lu) * t };
    const b = { x: v.x + (w[0] / lw) * t, y: v.y + (w[1] / lw) * t };
    const turn = -u[0] * w[1] + u[1] * w[0]; // (−u) × w: >0 giro antihorario
    const bulge = r > 0 ? Math.sign(turn) * Math.tan((Math.PI - theta) / 4) : 0;
    out.push({ ...v, x: a.x, y: a.y, bulge, r: 0, c: 0 }, { ...v, x: b.x, y: b.y, bulge: 0, r: 0, c: 0 });
  });
  return out;
}

// Vértices del contorno de un rectángulo resuelto (x0,y0 abajo-izq.; orden antihorario: ↙ ↘ ↗ ↖).
export function rectPoints(entity) {
  const x0 = entity.centered ? entity.x - entity.w / 2 : entity.x;
  const y0 = entity.centered ? entity.y - entity.h / 2 : entity.y;
  const base = [{ x: x0, y: y0, bulge: 0 }, { x: x0 + entity.w, y: y0, bulge: 0 }, { x: x0 + entity.w, y: y0 + entity.h, bulge: 0 }, { x: x0, y: y0 + entity.h, bulge: 0 }];
  return entity.corners?.some((corner) => corner.r > 0 || corner.c > 0) ? applyCorners(base, entity.corners) : base;
}

// Contorno de tramos/arcos de una entidad con esquinas modificadas (rect con `corners`, polilínea con r/c por vértice); null si no aplica.
export function cornerOutline(entity) {
  if (entity.t === 'rect' && entity.corners?.some((corner) => corner.r > 0 || corner.c > 0)) return rectPoints(entity);
  if (entity.t === 'poly' && entity.pts.some((point) => point.r > 0 || point.c > 0)) return applyCorners(entity.pts, entity.pts);
  return null;
}

// Punto medio del arco entre p0 y p1 con "bulge" = tan(θ/4) (positivo = antihorario).
export function arcMidpoint(p0, p1, bulge) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  const sagitta = (bulge * chord) / 2;
  return { x: (p0.x + p1.x) / 2 + (dy / chord) * sagitta, y: (p0.y + p1.y) / 2 - (dx / chord) * sagitta };
}

// Contorno aproximado (polilínea) de una entidad resuelta, para pruebas de contención.
// Vértices de un polígono regular resuelto: el primero está a `angle` grados; "entre caras" o "entre vértices".
export function polygonVertices(entity) {
  const radius = entity.across === 'corners' ? entity.d / 2 : entity.d / 2 / Math.cos(Math.PI / entity.n);
  return Array.from({ length: entity.n }, (_, i) => {
    const a = ((entity.angle ?? 0) * Math.PI) / 180 + (i * 2 * Math.PI) / entity.n;
    return [entity.x + radius * Math.cos(a), entity.y + radius * Math.sin(a)];
  });
}

export function entityPolygon(entity, arcSteps = 24) {
  const outline = cornerOutline(entity);
  if (outline) return entityPolygon({ t: 'poly', pts: outline }, arcSteps);
  switch (entity.t) {
    case 'rect': {
      const x0 = entity.centered ? entity.x - entity.w / 2 : entity.x;
      const y0 = entity.centered ? entity.y - entity.h / 2 : entity.y;
      return [{ x: x0, y: y0 }, { x: x0 + entity.w, y: y0 }, { x: x0 + entity.w, y: y0 + entity.h }, { x: x0, y: y0 + entity.h }];
    }
    case 'polygon':
      return polygonVertices(entity).map(([x, y]) => ({ x, y }));
    case 'guide':
      return []; // línea auxiliar infinita: no es parte del perfil
    case 'circle':
      return Array.from({ length: 36 }, (_, i) => ({ x: entity.x + (entity.d / 2) * Math.cos((i / 36) * 2 * Math.PI), y: entity.y + (entity.d / 2) * Math.sin((i / 36) * 2 * Math.PI) }));
    case 'ellipse': {
      const a = ((entity.angle ?? 0) * Math.PI) / 180;
      return Array.from({ length: 72 }, (_, i) => {
        const t = (i / 72) * 2 * Math.PI;
        const px = (entity.w / 2) * Math.cos(t);
        const py = (entity.h / 2) * Math.sin(t);
        return { x: entity.x + px * Math.cos(a) - py * Math.sin(a), y: entity.y + px * Math.sin(a) + py * Math.cos(a) };
      });
    }
    case 'slot': {
      const r = entity.width / 2;
      const half = entity.length / 2 - r;
      const a = (entity.angle * Math.PI) / 180;
      const points = [];
      for (let i = 0; i <= 12; i += 1) points.push({ x: half + r * Math.cos(-Math.PI / 2 + (i / 12) * Math.PI), y: r * Math.sin(-Math.PI / 2 + (i / 12) * Math.PI) });
      for (let i = 0; i <= 12; i += 1) points.push({ x: -half + r * Math.cos(Math.PI / 2 + (i / 12) * Math.PI), y: r * Math.sin(Math.PI / 2 + (i / 12) * Math.PI) });
      return points.map((p) => ({ x: entity.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: entity.y + p.x * Math.sin(a) + p.y * Math.cos(a) }));
    }
    case 'poly': {
      const out = [];
      entity.pts.forEach((point, i) => {
        const next = entity.pts[(i + 1) % entity.pts.length];
        out.push({ x: point.x, y: point.y });
        if (point.bulge) {
          const theta = 4 * Math.atan(point.bulge);
          const dx = next.x - point.x;
          const dy = next.y - point.y;
          const chord = Math.hypot(dx, dy);
          const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
          const offset = ((chord / 2) * (1 - point.bulge ** 2)) / (2 * point.bulge);
          const cx = (point.x + next.x) / 2 + (-dy / chord) * offset;
          const cy = (point.y + next.y) / 2 + (dx / chord) * offset;
          const a0 = Math.atan2(point.y - cy, point.x - cx);
          for (let s = 1; s < arcSteps; s += 1) {
            const angle = a0 + (theta * s) / arcSteps;
            out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
          }
        }
      });
      return out;
    }
    default:
      return [];
  }
}
export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Profundidad de anidación de cada entidad: cuántas otras la contienen. Par = material, impar = vacío.
export function nestingDepths(entities) {
  const polygons = entities.map((entity) => entityPolygon(entity));
  return polygons.map((polygon, index) =>
    polygons.reduce((depth, other, otherIndex) => (otherIndex !== index && polygon.every((point) => pointInPolygon(point, other)) ? depth + 1 : depth), 0),
  );
}
