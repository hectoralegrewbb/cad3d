import { projectView, sectionBase, toViewPoint, viewDirection } from './projection.js';
import { cutShape, sectionLoops } from './section.js';

const rotate = ([u, v], quarterTurns) => {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1: return [-v, u];
    case 2: return [-u, -v];
    case 3: return [v, -u];
    default: return [u, v];
  }
};

const bboxOfPolylines = (polylines) => {
  const points = polylines.flat();
  if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY };
};

// Ajusta la caja de las polilíneas a la caja exacta de la pieza si difieren apenas (discretización de arcos).
function snapBox(box, exact) {
  if (!exact) return box;
  const tol = 0.3;
  const pick = (value, ref) => (Math.abs(value - ref) <= tol ? Math.round(ref * 1e4) / 1e4 : value);
  const next = { minX: pick(box.minX, exact.minX), maxX: pick(box.maxX, exact.maxX), minY: pick(box.minY, exact.minY), maxY: pick(box.maxY, exact.maxY) };
  return { ...next, width: next.maxX - next.minX, height: next.maxY - next.minY };
}

// Vértices (esquinas) de las polilíneas visibles: puntos de cota candidatos.
function cornerPoints(polylines) {
  const out = [];
  polylines.forEach((line) => {
    line.forEach((point, index) => {
      if (index === 0 || index === line.length - 1) return out.push(point);
      const prev = line[index - 1];
      const next = line[index + 1];
      const cross = (point[0] - prev[0]) * (next[1] - point[1]) - (point[1] - prev[1]) * (next[0] - point[0]);
      const scale = Math.hypot(point[0] - prev[0], point[1] - prev[1]) * Math.hypot(next[0] - point[0], next[1] - point[1]) || 1;
      if (Math.abs(cross / scale) > 0.2) out.push(point);
    });
  });
  const unique = [];
  out.forEach((p) => {
    if (!unique.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3)) unique.push(p);
  });
  return unique;
}

// Una vista lista para dibujar y acotar: geometría en coordenadas de papel (v arriba), con rotación en cuartos de vuelta.
export function buildViewModel(rep, shape, info, config) {
  const { revolve, holes = [] } = info;
  // Agujeros sin arista circular (radiales en un cilindro, a cualquier ángulo): se agregan como círculos sintéticos con su tramo axial.
  const coincides = (circle, hole) => {
    const dotN = circle.normal[0] * hole.axis[0] + circle.normal[1] * hole.axis[1] + circle.normal[2] * hole.axis[2];
    if (Math.abs(Math.abs(dotN) - 1) > 1e-6 || Math.abs(circle.radius - hole.radius) > 1e-4) return false;
    const d = [circle.center[0] - hole.center[0], circle.center[1] - hole.center[1], circle.center[2] - hole.center[2]];
    const along = d[0] * hole.axis[0] + d[1] * hole.axis[1] + d[2] * hole.axis[2];
    return Math.hypot(d[0] - hole.axis[0] * along, d[1] - hole.axis[1] * along, d[2] - hole.axis[2] * along) < 1e-4;
  };
  const circles = [
    ...info.circles,
    ...holes.filter((hole) => !info.circles.some((circle) => coincides(circle, hole))).map((hole) => ({ center: hole.center, radius: hole.radius, normal: hole.axis, closed: true, synthetic: true, p0: hole.p0, p1: hole.p1 })),
  ];
  const rotation = config.rotation ?? 0;
  const isSection = config.kind === 'section';
  const kind = isSection ? sectionBase[config.plane ?? 'x'] : config.kind; // vista ortogonal que se proyecta
  let projectedShape = shape;
  let loops3d = [];
  if (isSection) {
    projectedShape = cutShape(rep, shape, config.plane ?? 'x', config.offset ?? 0);
    loops3d = sectionLoops(projectedShape, config.plane ?? 'x', config.offset ?? 0);
  }
  const projected = projectView(rep, projectedShape, kind);
  // Caja exacta de la pieza proyectada: las polilíneas de los arcos no incluyen los puntos extremos (65,99 en vez de 66).
  const exact = config.kind === 'iso' ? null : (() => {
    try {
      const [lo, hi] = projectedShape.boundingBox.bounds;
      const pts = [];
      [lo[0], hi[0]].forEach((x) => [lo[1], hi[1]].forEach((y) => [lo[2], hi[2]].forEach((z) => pts.push(rotate(toViewPoint(kind, [x, y, z]), rotation)))));
      return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
    } catch {
      return null;
    }
  })();
  if (isSection) projectedShape.delete?.();
  const rot = (polylines) => polylines.map((line) => line.map((p) => rotate(p, rotation)));
  const visible = rot(projected.visible);
  const hidden = rot(projected.hidden);
  const map = (point3) => rotate(toViewPoint(kind, point3), rotation);
  const direction = viewDirection[kind];
  const projectedCircles = circles.map((circle) => {
    const facing = Math.abs(circle.normal[0] * direction[0] + circle.normal[1] * direction[1] + circle.normal[2] * direction[2]);
    const center = map(circle.center);
    const axisLine = circle.synthetic ? [map(circle.p0), map(circle.p1)] : null;
    if (facing > 0.999) return { ...circle, mode: 'face', center, radius: circle.radius };
    if (facing < 0.001) {
      // Se ve de canto: segmento de longitud 2r centrado en el centro.
      const axisEnd = map([circle.center[0] + circle.normal[0], circle.center[1] + circle.normal[1], circle.center[2] + circle.normal[2]]);
      const axis = [axisEnd[0] - center[0], axisEnd[1] - center[1]];
      const l = Math.hypot(...axis) || 1;
      const perp = [-axis[1] / l, axis[0] / l];
      return { ...circle, mode: 'edge', center, radius: circle.radius, axis: [axis[0] / l, axis[1] / l], perp, axisLine };
    }
    return { ...circle, mode: 'oblique', center, radius: circle.radius, axisLine };
  });
  // Roscas con rango (cosméticas): de canto se ve el ¾ de vuelta; de costado, dos líneas finas entre A y B.
  const threadMarks = [];
  (info.threads3d ?? []).forEach((thread) => {
    const facing = Math.abs(thread.vector[0] * direction[0] + thread.vector[1] * direction[1] + thread.vector[2] * direction[2]);
    const radius = (thread.internal ? thread.major : thread.minor) / 2;
    if (facing > 0.999) return threadMarks.push({ mode: 'end', center: map(thread.p0), radius, internal: thread.internal, label: thread.label });
    if (facing >= 0.001) return;
    const a = map(thread.p0);
    const b = map(thread.p1);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    threadMarks.push({ mode: 'side', a, b, perp: [-(b[1] - a[1]) / l, (b[0] - a[0]) / l], radius, internal: thread.internal, label: thread.label });
  });
  // Círculo primitivo de los engranajes vistos de frente (línea de ejes).
  (info.gears3d ?? []).forEach((gear) => {
    const facing = Math.abs(gear.vector[0] * direction[0] + gear.vector[1] * direction[1] + gear.vector[2] * direction[2]);
    if (facing > 0.999) threadMarks.push({ mode: 'pitch', center: map(gear.center), radius: gear.rp });
  });
  // Eje de revolución en la vista: de canto (se ve la sección circular) o de costado (se ve el perfil).
  let revolveView = null;
  if (revolve) {
    const dir = viewDirection[kind];
    const facing = Math.abs(revolve.vector[0] * dir[0] + revolve.vector[1] * dir[1] + revolve.vector[2] * dir[2]);
    const origin = map(revolve.point);
    if (facing > 0.999) revolveView = { mode: 'end', origin, cylinders: revolve.cylinders };
    else if (facing < 0.001) {
      const tip = map([revolve.point[0] + revolve.vector[0], revolve.point[1] + revolve.vector[1], revolve.point[2] + revolve.vector[2]]);
      const axis = [tip[0] - origin[0], tip[1] - origin[1]];
      const l = Math.hypot(...axis) || 1;
      const unit = [axis[0] / l, axis[1] / l];
      const at = (t) => map([revolve.point[0] + revolve.vector[0] * (t - revolve.point[['x', 'y', 'z'].indexOf(revolve.axis)]), revolve.point[1] + revolve.vector[1] * (t - revolve.point[['x', 'y', 'z'].indexOf(revolve.axis)]), revolve.point[2] + revolve.vector[2] * (t - revolve.point[['x', 'y', 'z'].indexOf(revolve.axis)])]);
      revolveView = { mode: 'side', origin, axis: unit, horizontal: Math.abs(unit[0]) > 0.5, at, planes: revolve.planes, cylinders: revolve.cylinders, lo: revolve.lo, hi: revolve.hi };
    }
  }
  return {
    id: config.id ?? config.kind,
    section: isSection ? { plane: config.plane ?? 'x', offset: config.offset ?? 0, label: config.label ?? 'A', loops: loops3d.map((loop) => loop.map(map)) } : null,
    revolve: revolveView,
    kind: config.kind,
    rotation,
    config,
    visible,
    hidden,
    bbox: snapBox(bboxOfPolylines(visible.length ? visible : hidden), exact),
    corners: cornerPoints(visible),
    circles: projectedCircles,
    threadMarks,
    map,
  };
}
