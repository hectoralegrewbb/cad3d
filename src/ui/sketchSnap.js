import { cornerOutline } from '../kernel/geometry2d.js';
// Sistema de imanes del boceto: puntos notables (vértice, centro, punto medio, cuadrante, intersección, origen),
// guías de ángulo (cada 45°) desde el punto de anclaje y alineaciones con puntos existentes. Puro y sin DOM.

export const snapLabels = {
  origin: 'Origen',
  vertex: 'Vértice',
  center: 'Centro',
  midpoint: 'Punto medio',
  quadrant: 'Cuadrante',
  intersection: 'Intersección',
  edge: 'Sobre línea',
  angle: 'Guía de ángulo',
  align: 'Alineado',
  grid: 'Cuadrícula',
};
// Prioridad cuando varios puntos caen dentro del radio (menor = gana).
const priority = { intersection: 0, vertex: 1, center: 2, midpoint: 3, quadrant: 4, origin: 5 };

const rotate = (x, y, deg) => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

function segmentIntersection(a, b) {
  const rx = a.b[0] - a.a[0];
  const ry = a.b[1] - a.a[1];
  const sx = b.b[0] - b.a[0];
  const sy = b.b[1] - b.a[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b.a[0] - a.a[0]) * sy - (b.a[1] - a.a[1]) * sx) / denom;
  const u = ((b.a[0] - a.a[0]) * ry - (b.a[1] - a.a[1]) * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a.a[0] + t * rx, a.a[1] + t * ry];
}

function circleSegment(circle, seg) {
  const dx = seg.b[0] - seg.a[0];
  const dy = seg.b[1] - seg.a[1];
  const fx = seg.a[0] - circle.x;
  const fy = seg.a[1] - circle.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - circle.r * circle.r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].filter((t) => t >= -1e-9 && t <= 1 + 1e-9).map((t) => [seg.a[0] + t * dx, seg.a[1] + t * dy]);
}

function circleCircle(c1, c2) {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (d < 1e-9 || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const mx = c1.x + (a * (c2.x - c1.x)) / d;
  const my = c1.y + (a * (c2.y - c1.y)) / d;
  const ox = (-(c2.y - c1.y) * h) / d;
  const oy = ((c2.x - c1.x) * h) / d;
  return h < 1e-9 ? [[mx, my]] : [[mx + ox, my + oy], [mx - ox, my - oy]];
}

// Recolecta puntos notables, segmentos rectos y círculos de las entidades ya resueltas (números).
// `reference` (opcional): geometría "papel cebolla" { entities, polylines } de otros bocetos y de la pieza; atrae igual que lo propio.
export function collectGeometry(entities, reference = null) {
  const points = [{ x: 0, y: 0, kind: 'origin' }];
  const segments = [];
  const circles = [];
  let isRef = false;
  const push = (x, y, kind) => points.push({ x, y, kind, ref: isRef });
  const edge = (p, q, mid = true) => {
    segments.push({ a: p, b: q, ref: isRef });
    if (mid) push((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 'midpoint');
  };
  const addEntity = (source) => {
    const outline = cornerOutline(source);
    const entity = outline ? { t: 'poly', pts: outline } : source;
    if (entity.t === 'rect') {
      const x0 = entity.centered ? entity.x - entity.w / 2 : entity.x;
      const y0 = entity.centered ? entity.y - entity.h / 2 : entity.y;
      const corners = [[x0, y0], [x0 + entity.w, y0], [x0 + entity.w, y0 + entity.h], [x0, y0 + entity.h]];
      corners.forEach((corner, i) => {
        push(corner[0], corner[1], 'vertex');
        edge(corner, corners[(i + 1) % 4]);
      });
      push(x0 + entity.w / 2, y0 + entity.h / 2, 'center');
    } else if (entity.t === 'circle') {
      const r = entity.d / 2;
      circles.push({ x: entity.x, y: entity.y, r, ref: isRef });
      push(entity.x, entity.y, 'center');
      [[r, 0], [-r, 0], [0, r], [0, -r]].forEach(([dx, dy]) => push(entity.x + dx, entity.y + dy, 'quadrant'));
    } else if (entity.t === 'ellipse') {
      push(entity.x, entity.y, 'center');
      [[entity.w / 2, 0], [-entity.w / 2, 0], [0, entity.h / 2], [0, -entity.h / 2]].forEach(([dx, dy]) => {
        const [rx, ry] = rotate(dx, dy, entity.angle ?? 0);
        push(entity.x + rx, entity.y + ry, 'quadrant');
      });
    } else if (entity.t === 'slot') {
      const half = entity.length / 2 - entity.width / 2;
      const r = entity.width / 2;
      const at = (dx, dy) => {
        const [rx, ry] = rotate(dx, dy, entity.angle ?? 0);
        return [entity.x + rx, entity.y + ry];
      };
      push(entity.x, entity.y, 'center');
      [-half, half].forEach((dx) => push(...at(dx, 0), 'center'));
      [[-half - r, 0], [half + r, 0]].forEach(([dx, dy]) => push(...at(dx, dy), 'quadrant'));
      const corners = [at(-half, -r), at(half, -r), at(half, r), at(-half, r)];
      corners.forEach((corner) => push(corner[0], corner[1], 'vertex'));
      edge(corners[0], corners[1]);
      edge(corners[2], corners[3]);
    } else if (entity.t === 'polygon') {
      const radius = entity.across === 'corners' ? entity.d / 2 : entity.d / 2 / Math.cos(Math.PI / entity.n);
      const vertices = Array.from({ length: entity.n }, (_, i) => {
        const a = ((entity.angle ?? 0) * Math.PI) / 180 + (i * 2 * Math.PI) / entity.n;
        return [entity.x + radius * Math.cos(a), entity.y + radius * Math.sin(a)];
      });
      push(entity.x, entity.y, 'center');
      vertices.forEach((vertex, i) => {
        push(vertex[0], vertex[1], 'vertex');
        edge(vertex, vertices[(i + 1) % vertices.length]);
      });
    } else if (entity.t === 'guide') {
      // Línea infinita (tramo muy largo): permite intersecciones y "sobre línea"; su origen es un punto notable.
      const rad = ((entity.angle ?? 0) * Math.PI) / 180;
      const far = 5e4;
      push(entity.x, entity.y, 'vertex');
      edge([entity.x - Math.cos(rad) * far, entity.y - Math.sin(rad) * far], [entity.x + Math.cos(rad) * far, entity.y + Math.sin(rad) * far], false);
    } else if (entity.t === 'poly') {
      entity.pts.forEach((point, i) => {
        const next = entity.pts[(i + 1) % entity.pts.length];
        push(point.x, point.y, 'vertex');
        if (!point.bulge) edge([point.x, point.y], [next.x, next.y]);
      });
    }
  };
  entities.forEach(addEntity);
  if (reference) {
    isRef = true;
    (reference.entities ?? []).forEach(addEntity);
    (reference.polylines ?? []).forEach((line) => {
      line.points.forEach((point, i) => {
        if (line.vertices) push(point[0], point[1], 'vertex');
        if (i > 0) edge(line.points[i - 1], point, false);
      });
      if (line.closed && line.points.length > 2) edge(line.points[line.points.length - 1], line.points[0], false);
    });
  }
  // Intersecciones exactas entre tramos rectos y círculos (nunca entre dos referencias: serían cruces de teselado).
  const intersections = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (segments[i].ref && segments[j].ref) continue;
      const hit = segmentIntersection(segments[i], segments[j]);
      if (hit) intersections.push(hit);
    }
    circles.forEach((circle) => {
      if (circle.ref && segments[i].ref) return;
      intersections.push(...circleSegment(circle, segments[i]));
    });
  }
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      if (circles[i].ref && circles[j].ref) continue;
      intersections.push(...circleCircle(circles[i], circles[j]));
    }
  }
  intersections.forEach(([x, y]) => {
    // Las esquinas ya son vértices: solo cuentan los cruces que no coinciden con un punto existente.
    if (!points.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-6)) push(x, y, 'intersection');
  });
  return { points, segments, circles };
}

export const guideAngles = [0, 45, 90, 135, 180, 225, 270, 315];

// Calcula el imán para el cursor `cursor` (coordenadas del mundo). `pxPerUnit` convierte unidades del mundo a píxeles.
// options: { anchor, snapPoints, guides, grid (paso o 0), tolerancePx }
export function computeSnap(cursor, geometry, pxPerUnit, { anchor = null, snapPoints = true, guides = true, grid = 0, tolerancePx = 10 } = {}) {
  const tol = tolerancePx / pxPerUnit;
  const [cx, cy] = cursor;
  const result = { x: cx, y: cy, kind: null, label: null, lines: [], marker: null, near: [] };

  if (snapPoints) {
    result.near = geometry.points.filter((p) => Math.hypot(p.x - cx, p.y - cy) < 90 / pxPerUnit);
    let best = null;
    geometry.points.forEach((p) => {
      const dist = Math.hypot(p.x - cx, p.y - cy);
      if (dist > tol) return;
      const score = dist * pxPerUnit + priority[p.kind] * 2.5 + (p.ref ? 1.5 : 0);
      if (!best || score < best.score) best = { p, score };
    });
    if (best) {
      return { ...result, x: best.p.x, y: best.p.y, kind: best.p.kind, label: snapLabels[best.p.kind] + (best.p.ref ? ' · referencia' : ''), marker: { x: best.p.x, y: best.p.y, kind: best.p.kind } };
    }
  }

  // Sobre un lado, una guía o una circunferencia (cuando no hay un punto notable más cerca).
  if (snapPoints) {
    let onEdge = null;
    geometry.segments.forEach(({ a, b, ref }) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cy - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const px = a[0] + t * dx;
      const py = a[1] + t * dy;
      const dist = Math.hypot(cx - px, cy - py);
      if (dist < tol && (!onEdge || dist < onEdge.dist)) onEdge = { x: px, y: py, dist, ref };
    });
    geometry.circles.forEach((circle) => {
      const d = Math.hypot(cx - circle.x, cy - circle.y);
      const dist = Math.abs(d - circle.r);
      if (d > 1e-9 && dist < tol && (!onEdge || dist < onEdge.dist)) onEdge = { x: circle.x + ((cx - circle.x) / d) * circle.r, y: circle.y + ((cy - circle.y) / d) * circle.r, dist, ref: circle.ref };
    });
    if (onEdge) return { ...result, x: onEdge.x, y: onEdge.y, kind: 'edge', label: snapLabels.edge + (onEdge.ref ? ' · referencia' : ''), marker: { x: onEdge.x, y: onEdge.y, kind: 'edge' } };
  }

  // Alineaciones con puntos existentes (líneas de inferencia horizontales y verticales).
  let alignX = null;
  let alignY = null;
  if (snapPoints) {
    geometry.points.forEach((p) => {
      const dx = Math.abs(p.x - cx);
      const dy = Math.abs(p.y - cy);
      if (dx < tol && (!alignX || dx < alignX.d)) alignX = { p, d: dx };
      if (dy < tol && (!alignY || dy < alignY.d)) alignY = { p, d: dy };
    });
  }

  // Guía de ángulo desde el anclaje (cada 45°).
  let guide = null;
  if (guides && anchor) {
    const dx = cx - anchor[0];
    const dy = cy - anchor[1];
    const dist = Math.hypot(dx, dy);
    if (dist > 4 / pxPerUnit) {
      guideAngles.forEach((deg) => {
        const rad = (deg * Math.PI) / 180;
        const ux = Math.cos(rad);
        const uy = Math.sin(rad);
        const along = dx * ux + dy * uy;
        const perp = Math.abs(-dx * uy + dy * ux);
        if (along > 0 && perp < tol && (!guide || perp < guide.perp)) guide = { deg, ux, uy, along, perp };
      });
    }
  }

  const lineThrough = (p, horizontal) => (horizontal ? { from: [p.x - 1e6, p.y], to: [p.x + 1e6, p.y], kind: 'align' } : { from: [p.x, p.y - 1e6], to: [p.x, p.y + 1e6], kind: 'align' });
  const guideLine = (g) => ({ from: [anchor[0], anchor[1]], to: [anchor[0] + g.ux * 1e6, anchor[1] + g.uy * 1e6], kind: 'angle' });

  if (guide && alignX && Math.abs(guide.ux) > 1e-9) {
    const t = (alignX.p.x - anchor[0]) / guide.ux;
    if (t > 0) return { ...result, x: alignX.p.x, y: anchor[1] + t * guide.uy, kind: 'angle', label: `${guide.deg}° + alineado`, lines: [guideLine(guide), lineThrough(alignX.p, false)], marker: { x: alignX.p.x, y: anchor[1] + t * guide.uy, kind: 'intersection' }, alignedWith: [alignX.p] };
  }
  if (guide && alignY && Math.abs(guide.uy) > 1e-9) {
    const t = (alignY.p.y - anchor[1]) / guide.uy;
    if (t > 0) return { ...result, x: anchor[0] + t * guide.ux, y: alignY.p.y, kind: 'angle', label: `${guide.deg}° + alineado`, lines: [guideLine(guide), lineThrough(alignY.p, true)], marker: { x: anchor[0] + t * guide.ux, y: alignY.p.y, kind: 'intersection' }, alignedWith: [alignY.p] };
  }
  if (alignX && alignY) return { ...result, x: alignX.p.x, y: alignY.p.y, kind: 'align', label: 'Alineado X e Y', lines: [lineThrough(alignX.p, false), lineThrough(alignY.p, true)], marker: { x: alignX.p.x, y: alignY.p.y, kind: 'intersection' }, alignedWith: [alignX.p, alignY.p] };
  if (guide) return { ...result, x: anchor[0] + guide.ux * guide.along, y: anchor[1] + guide.uy * guide.along, kind: 'angle', label: `${guide.deg}°`, lines: [guideLine(guide)], marker: null };
  if (alignX) return { ...result, x: alignX.p.x, kind: 'align', label: 'Alineado X', lines: [lineThrough(alignX.p, false)], alignedWith: [alignX.p] };
  if (alignY) return { ...result, y: alignY.p.y, kind: 'align', label: 'Alineado Y', lines: [lineThrough(alignY.p, true)], alignedWith: [alignY.p] };

  if (grid > 0) {
    result.x = Math.round(cx / grid) * grid;
    result.y = Math.round(cy / grid) * grid;
    result.kind = 'grid';
    result.label = null;
  }
  return result;
}
