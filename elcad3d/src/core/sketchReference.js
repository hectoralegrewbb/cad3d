import { entityPolygon, resolveEntity } from '../kernel/geometry2d.js';
import { planeFrame } from '../kernel/planes.js';

// "Papel cebolla" del editor de bocetos: geometría de referencia expresada en las coordenadas (u, v) del boceto activo.
//  - Otros bocetos: si están en el mismo plano se usan tal cual (imanes completos: centros, cuadrantes…); si están en otro plano
//    se proyectan sobre el actual (un boceto perpendicular queda de canto, como una línea).
//  - La pieza: corte de la malla por el plano del boceto (contorno de lo ya construido).
// Puro y sin DOM: lo usan el editor y las pruebas.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const near = (a, b, tolerance = 1e-6) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

// Douglas-Peucker: quita puntos intermedios alineados (un círculo visto de canto queda en 2 puntos).
export function simplify(points, tolerance = 0.01) {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i];
      const distance = length < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / length;
      if (distance > worst) {
        worst = distance;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = true;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Une segmentos sueltos [[u,v],[u,v]] en cadenas continuas.
export function stitchSegments(segments, tolerance = 1e-4) {
  const key = (p) => `${Math.round(p[0] / tolerance)},${Math.round(p[1] / tolerance)}`;
  const ends = new Map();
  segments.forEach((segment, index) => segment.forEach((p) => ends.set(key(p), [...(ends.get(key(p)) ?? []), index])));
  const used = new Array(segments.length).fill(false);
  const chains = [];
  segments.forEach((segment, start) => {
    if (used[start]) return;
    used[start] = true;
    const chain = [segment[0], segment[1]];
    const extend = (atEnd) => {
      for (;;) {
        const tip = atEnd ? chain[chain.length - 1] : chain[0];
        const next = (ends.get(key(tip)) ?? []).find((i) => !used[i]);
        if (next === undefined) return;
        used[next] = true;
        const [p, q] = segments[next];
        const other = key(p) === key(tip) ? q : p;
        if (atEnd) chain.push(other);
        else chain.unshift(other);
      }
    };
    extend(true);
    extend(false);
    chains.push(chain);
  });
  return chains;
}

// Corte de una malla de triángulos (vertices planos xyz + índices) por el plano del marco → polilíneas en (u, v).
export function sectionPolylines(mesh, frame, { tolerance = 0.01 } = {}) {
  const { vertices, triangles } = mesh;
  const distance = (index) => dot(sub([vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]], frame.origin), frame.normal);
  const toUV = (point) => {
    const d = sub(point, frame.origin);
    return [dot(d, frame.xDir), dot(d, frame.yDir)];
  };
  const segments = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const ds = ids.map(distance);
    const sides = ds.map((d) => d >= 0);
    if (sides[0] === sides[1] && sides[1] === sides[2]) continue;
    const hits = [];
    for (let i = 0; i < 3; i += 1) {
      const j = (i + 1) % 3;
      if (sides[i] === sides[j]) continue;
      const k = ds[i] / (ds[i] - ds[j]);
      const a = ids[i] * 3;
      const b = ids[j] * 3;
      hits.push(toUV([vertices[a] + k * (vertices[b] - vertices[a]), vertices[a + 1] + k * (vertices[b + 1] - vertices[a + 1]), vertices[a + 2] + k * (vertices[b + 2] - vertices[a + 2])]));
    }
    if (hits.length === 2 && Math.hypot(hits[0][0] - hits[1][0], hits[0][1] - hits[1][1]) > 1e-9) segments.push(hits);
  }
  return stitchSegments(segments).map((chain) => {
    const closed = Math.hypot(chain[0][0] - chain[chain.length - 1][0], chain[0][1] - chain[chain.length - 1][1]) < 1e-3 && chain.length > 3;
    const points = simplify(closed ? chain.slice(0, -1).concat([chain[0]]) : chain, tolerance);
    return { points: closed ? points.slice(0, -1) : points, closed, vertices: points.length <= 16, kind: 'solid' };
  }).filter((line) => line.points.length >= 2);
}

// Referencia completa para el boceto `sketchId`.
export function sketchReference({ part, params, sketchId, mesh = null, showSketches = true, showSolid = true }) {
  const active = part.features.find((feature) => feature.id === sketchId && feature.type === 'sketch');
  const result = { entities: [], polylines: [], boxes: [] };
  if (!active) return result;
  let frame;
  try {
    frame = planeFrame(null, active, params);
  } catch {
    return result;
  }
  if (showSketches) {
    part.features.filter((feature) => feature.type === 'sketch' && feature.id !== sketchId && !feature.suppressed).forEach((other) => {
      let otherFrame;
      try {
        otherFrame = planeFrame(null, other, params);
      } catch {
        return;
      }
      const same = near(otherFrame.origin, frame.origin) && near(otherFrame.xDir, frame.xDir) && near(otherFrame.normal, frame.normal);
      other.entities.forEach((entity) => {
        let resolved;
        try {
          resolved = resolveEntity(entity, params);
        } catch {
          return;
        }
        if (same) return result.entities.push(resolved);
        if (resolved.t === 'guide') return;
        const polygon = entityPolygon(resolved);
        if (polygon.length < 2) return;
        const points = polygon.map(({ x, y }) => {
          const world = [otherFrame.origin[0] + x * otherFrame.xDir[0] + y * otherFrame.yDir[0], otherFrame.origin[1] + x * otherFrame.xDir[1] + y * otherFrame.yDir[1], otherFrame.origin[2] + x * otherFrame.xDir[2] + y * otherFrame.yDir[2]];
          const d = sub(world, frame.origin);
          return [dot(d, frame.xDir), dot(d, frame.yDir)];
        });
        const closed = [...points, points[0]];
        const line = simplify(closed, 0.005);
        result.polylines.push({ points: line.length > 2 ? line.slice(0, -1) : line, closed: line.length > 2, vertices: line.length <= 13, kind: 'sketch' });
      });
    });
  }
  if (showSolid && mesh) result.polylines.push(...sectionPolylines(mesh, frame));
  const boxOf = (points) => ({ x0: Math.min(...points.map((p) => p[0])), x1: Math.max(...points.map((p) => p[0])), y0: Math.min(...points.map((p) => p[1])), y1: Math.max(...points.map((p) => p[1])) });
  result.polylines.forEach((line) => result.boxes.push(boxOf(line.points)));
  return result;
}
