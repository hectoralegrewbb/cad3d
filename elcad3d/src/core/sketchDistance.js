// Distancias entre objetos de un boceto 2D. Puro, sin DOM.
// Una «forma» es { pts: [[x, y]…], closed } (contorno) o { line: { x, y, angle } } (guía infinita).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], [dx, dy]) / len2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

export function closestOnLine(p, line) {
  const rad = (line.angle * Math.PI) / 180;
  const d = [Math.cos(rad), Math.sin(rad)];
  const t = dot([p[0] - line.x, p[1] - line.y], d);
  return [line.x + d[0] * t, line.y + d[1] * t];
}

const segmentsOf = (shape) => {
  const out = [];
  const n = shape.pts.length;
  const last = shape.closed === false ? n - 1 : n;
  for (let i = 0; i < last; i += 1) out.push([shape.pts[i], shape.pts[(i + 1) % n]]);
  return out;
};

const hypot = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function crossProduct(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsCross(a, b, c, d) {
  const d1 = crossProduct(c, d, a);
  const d2 = crossProduct(c, d, b);
  const d3 = crossProduct(a, b, c);
  const d4 = crossProduct(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function pointInShape(p, shape) {
  if (!shape.pts || shape.closed === false || shape.pts.length < 3) return false;
  let inside = false;
  const pts = shape.pts;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Punto más cercano del contorno (o la guía) a p: { d, q }
export function nearestOnShape(p, shape) {
  if (shape.line) {
    const q = closestOnLine(p, shape.line);
    return { d: hypot(p, q), q };
  }
  let best = null;
  segmentsOf(shape).forEach(([a, b]) => {
    const q = closestOnSegment(p, a, b);
    const d = hypot(p, q);
    if (!best || d < best.d) best = { d, q };
  });
  return best;
}

// Distancia mínima entre dos segmentos con sus puntos más cercanos.
function segmentPair(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) {
    // intersección: distancia 0 en el punto de cruce
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const p = [a[0] + t * r[0], a[1] + t * r[1]];
    return { d: 0, p, q: p };
  }
  const options = [
    [a, closestOnSegment(a, c, d)],
    [b, closestOnSegment(b, c, d)],
    [closestOnSegment(c, a, b), c],
    [closestOnSegment(d, a, b), d],
  ];
  let best = null;
  options.forEach(([p, q]) => {
    const dist = hypot(p, q);
    if (!best || dist < best.d) best = { d: dist, p, q };
  });
  return best;
}

// Distancia mínima entre dos formas: { d, p, q, overlap }. p está en A y q en B. Si se cruzan o una contiene a la otra, d = 0.
export function distanceBetween(A, B) {
  if (A.line && B.line) {
    const ra = (A.line.angle * Math.PI) / 180;
    const rb = (B.line.angle * Math.PI) / 180;
    const cross = Math.cos(ra) * Math.sin(rb) - Math.sin(ra) * Math.cos(rb);
    if (Math.abs(cross) > 1e-9) return { d: 0, p: [A.line.x, A.line.y], q: [A.line.x, A.line.y], overlap: true };
    const q = closestOnLine([A.line.x, A.line.y], B.line);
    return { d: hypot([A.line.x, A.line.y], q), p: [A.line.x, A.line.y], q, overlap: false };
  }
  if (A.line || B.line) {
    const [line, shape, swap] = A.line ? [A, B, false] : [B, A, true];
    // el punto del contorno más lejano a cada lado de la guía decide si la cruza
    const rad = (line.line.angle * Math.PI) / 180;
    const normal = [-Math.sin(rad), Math.cos(rad)];
    const sides = shape.pts.map((pt) => dot([pt[0] - line.line.x, pt[1] - line.line.y], normal));
    const crosses = Math.min(...sides) < 0 && Math.max(...sides) > 0;
    let best = null;
    shape.pts.forEach((pt) => {
      const q = closestOnLine(pt, line.line);
      const d = hypot(pt, q);
      if (!best || d < best.d) best = { d, p: pt, q };
    });
    if (crosses) best = { d: 0, p: best.p, q: best.p, overlap: true };
    return swap ? { d: best.d, p: best.p, q: best.q, overlap: best.d === 0 } : { d: best.d, p: best.q, q: best.p, overlap: best.d === 0 };
  }
  let best = null;
  const sa = segmentsOf(A);
  const sb = segmentsOf(B);
  sa.forEach(([a, b]) => sb.forEach(([c, d]) => {
    const r = segmentPair(a, b, c, d);
    if (!best || r.d < best.d) best = r;
  }));
  if (!best) return null;
  if (best.d > 0 && (pointInShape(A.pts[0], B) || pointInShape(B.pts[0], A))) return { ...best, d: 0, overlap: true };
  return { ...best, overlap: best.d === 0 };
}

// Forma más cercana a un punto entre varias (con id), ignorando `skip`.
export function nearestShape(p, shapes, skip = null) {
  let best = null;
  shapes.forEach((shape) => {
    if (skip && shape.id === skip) return;
    const hit = nearestOnShape(p, shape);
    if (hit && (!best || hit.d < best.d)) best = { ...hit, shape };
  });
  return best;
}

// Vértice (extremo) más cercano a p entre todas las formas.
export function nearestVertex(p, shapes, skip = null) {
  let best = null;
  shapes.forEach((shape) => {
    if (!shape.pts || (skip && shape.id === skip)) return;
    shape.pts.forEach((pt) => {
      const d = hypot(p, pt);
      if (d > 1e-9 && (!best || d < best.d)) best = { d, q: pt, shape };
    });
  });
  return best;
}

// Distancias que importan al trazar un tramo de línea de `from` a `to`: contra el resto de la geometría.
// Devuelve { toEdge, toVertex } con la menor distancia perpendicular a un borde y al vértice más cercano.
export function drawingDistances(to, shapes, skip = null) {
  return { toEdge: nearestShape(to, shapes, skip), toVertex: nearestVertex(to, shapes, skip) };
}
