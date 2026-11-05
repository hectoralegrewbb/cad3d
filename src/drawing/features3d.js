// Información geométrica 3D útil para acotar: círculos (agujeros, diámetros) y masa.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(...a);
const normalize = (a) => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const toArray = (p) => [p.x, p.y, p.z];

// Círculo que pasa por 3 puntos 3D: centro, radio y normal.
export function circleFrom3(p1, p2, p3) {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const n = cross(a, b);
  const nn = dot(n, n);
  if (nn < 1e-12) return null;
  const alpha = (dot(b, b) * dot(a, sub(a, b))) / (2 * nn);
  const beta = (dot(a, a) * dot(b, sub(b, a))) / (2 * nn);
  const center = [p1[0] + alpha * a[0] + beta * b[0], p1[1] + alpha * a[1] + beta * b[1], p1[2] + alpha * a[2] + beta * b[2]];
  return { center, radius: length(sub(p1, center)), normal: normalize(n) };
}

// Círculos y arcos de la pieza. `closed` = circunferencia completa (los filetes son arcos abiertos).
export function extractCircles(shape) {
  const circles = [];
  shape.edges.forEach((edge) => {
    if (edge.geomType !== 'CIRCLE') return;
    const points = [0, 1 / 3, 2 / 3].map((t) => {
      const p = edge.pointAt(t);
      const array = toArray(p);
      p.delete?.();
      return array;
    });
    const circle = circleFrom3(...points);
    if (!circle) return;
    const start = edge.startPoint;
    const end = edge.endPoint;
    const closed = length(sub(toArray(start), toArray(end))) < 1e-6;
    start.delete?.();
    end.delete?.();
    circles.push({ ...circle, closed, arcLength: edge.length });
  });
  // Una circunferencia partida en arcos por la costura (p. ej. un agujero dentro de un polígono) vuelve a ser un círculo completo.
  const merged = [];
  const used = new Set();
  circles.forEach((circle, i) => {
    if (used.has(i) || circle.closed) return;
    const parts = [i];
    circles.forEach((other, j) => {
      if (j === i || used.has(j) || other.closed) return;
      const sameCenter = length(sub(other.center, circle.center)) < 1e-4;
      const parallel = Math.abs(Math.abs(dot(other.normal, circle.normal)) - 1) < 1e-6;
      if (sameCenter && parallel && Math.abs(other.radius - circle.radius) < 1e-4) parts.push(j);
    });
    const total = parts.reduce((sum, index) => sum + circles[index].arcLength, 0);
    if (parts.length > 1 && Math.abs(total - 2 * Math.PI * circle.radius) < 2e-3 * circle.radius + 1e-3) {
      parts.forEach((index) => used.add(index));
      merged.push({ ...circle, closed: true });
    }
  });
  return [...circles.filter((_, i) => !used.has(i)), ...merged];
}

// Agujeros cilíndricos (caras cilíndricas internas) con eje en cualquier dirección. Un agujero radial en un cilindro no deja
// aristas circulares (la intersección es una curva alabeada), por eso se leen las caras: eje, radio y tramo axial.
// Devuelve [{ center, radius, axis, p0, p1 }] con las caras coaxiales del mismo radio fusionadas (p. ej. las dos paredes de un cubo).
export function extractHoles(shape, rep) {
  const oc = rep?.getOC?.();
  if (!oc?.BRepAdaptor_Surface) return [];
  const raw = [];
  shape.faces.forEach((face) => {
    if (!face.geomType.startsWith('CYL')) return;
    let adaptor;
    try {
      adaptor = new oc.BRepAdaptor_Surface(face.wrapped, true);
      const cylinder = adaptor.Cylinder();
      const axis = cylinder.Axis();
      const location = axis.Location();
      const direction = axis.Direction();
      const origin = [location.X(), location.Y(), location.Z()];
      const dir = normalize([direction.X(), direction.Y(), direction.Z()]);
      const radius = cylinder.Radius();
      const sweep = adaptor.LastUParameter() - adaptor.FirstUParameter();
      const v0 = adaptor.FirstVParameter();
      const v1 = adaptor.LastVParameter();
      [location, direction, axis, cylinder].forEach((item) => item.delete?.());
      if (sweep < (170 * Math.PI) / 180) return; // un filete cóncavo o un arco parcial no es un agujero
      // Orientación: en un agujero la normal saliente del material apunta hacia el eje.
      const helper = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const radial = normalize(cross(dir, helper));
      const vm = (v0 + v1) / 2;
      const probe = [origin[0] + dir[0] * vm + radial[0] * radius, origin[1] + dir[1] * vm + radial[1] * radius, origin[2] + dir[2] * vm + radial[2] * radius];
      const n = face.normalAt(probe);
      const outward = n.x * radial[0] + n.y * radial[1] + n.z * radial[2];
      if (!(outward < -0.5)) return;
      raw.push({ origin, dir, radius, v0, v1 });
    } catch {
      /* cara sin superficie cilíndrica analizable: se ignora */
    } finally {
      adaptor?.delete?.();
    }
  });
  const holes = [];
  raw.forEach((item) => {
    const hole = holes.find((other) => {
      if (Math.abs(Math.abs(dot(other.dir, item.dir)) - 1) > 1e-6 || Math.abs(other.radius - item.radius) > 1e-4) return false;
      const d = sub(item.origin, other.origin);
      const along = dot(d, other.dir);
      return length([d[0] - other.dir[0] * along, d[1] - other.dir[1] * along, d[2] - other.dir[2] * along]) < 1e-4;
    });
    const at = (base, v) => [base.origin[0] + base.dir[0] * v, base.origin[1] + base.dir[1] * v, base.origin[2] + base.dir[2] * v];
    if (!hole) return holes.push({ ...item });
    // Tramo del nuevo ítem expresado sobre el eje del agujero existente.
    const sign = dot(hole.dir, item.dir) >= 0 ? 1 : -1;
    const shift = dot(sub(item.origin, hole.origin), hole.dir);
    const a = shift + sign * item.v0;
    const b = shift + sign * item.v1;
    hole.v0 = Math.min(hole.v0, a, b);
    hole.v1 = Math.max(hole.v1, a, b);
    hole.at = at;
  });
  const pointAt = (hole, v) => [hole.origin[0] + hole.dir[0] * v, hole.origin[1] + hole.dir[1] * v, hole.origin[2] + hole.dir[2] * v];
  return holes.map((hole) => ({ center: pointAt(hole, (hole.v0 + hole.v1) / 2), radius: hole.radius, axis: hole.dir, p0: pointAt(hole, hole.v0), p1: pointAt(hole, hole.v1) }));
}

// Volumen por tetraedros firmados sobre la malla (mm³).
export function meshVolume(mesh) {
  const { vertices, triangles } = mesh;
  let volume = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3;
    const b = triangles[i + 1] * 3;
    const c = triangles[i + 2] * 3;
    const p1 = [vertices[a], vertices[a + 1], vertices[a + 2]];
    const p2 = [vertices[b], vertices[b + 1], vertices[b + 2]];
    const p3 = [vertices[c], vertices[c + 1], vertices[c + 2]];
    volume += dot(p1, cross(p2, p3)) / 6;
  }
  return Math.abs(volume);
}

export const materials = {
  '': { label: '— sin definir —', density: 0 },
  'sae1045': { label: 'Acero SAE 1045', density: 7.85, color: '#8d949c' },
  'sae1020': { label: 'Acero SAE 1020', density: 7.85, color: '#9aa1a8' },
  'sae4140': { label: 'Acero SAE 4140', density: 7.85, color: '#7f868e' },
  'inox304': { label: 'Acero inoxidable AISI 304', density: 8.0, color: '#c3c9d0' },
  'inox316': { label: 'Acero inoxidable AISI 316', density: 8.0, color: '#c3c9d0' },
  'al6061': { label: 'Aluminio 6061-T6', density: 2.7, color: '#cfd4da' },
  'bronce': { label: 'Bronce SAE 660', density: 8.8, color: '#b0773a' },
  'laton': { label: 'Latón', density: 8.5, color: '#cfa93c' },
  'nylon': { label: 'Nylon PA6', density: 1.14, color: '#e9e5d6' },
  'fundicion': { label: 'Fundición gris', density: 7.2, color: '#6a6e73' },
  'al7075': { label: 'Aluminio 7075-T6', density: 2.81, color: '#c4c9cf' },
  'cobre': { label: 'Cobre electrolítico', density: 8.96, color: '#c0724a' },
  'titanio': { label: 'Titanio Gr5 (Ti-6Al-4V)', density: 4.43, color: '#a9adb3' },
  'sae1010': { label: 'Acero SAE 1010', density: 7.85, color: '#9aa1a8' },
  'inox420': { label: 'Acero inoxidable AISI 420', density: 7.74, color: '#b9bfc6' },
  'pvc': { label: 'PVC rígido', density: 1.4, color: '#d9dde0' },
  'pvcFlex': { label: 'PVC flexible', density: 1.3, color: '#c9ced1' },
  'viton': { label: 'Viton (FKM)', density: 1.85, color: '#2f3a2e' },
  'nbr': { label: 'Goma nitrílica (NBR)', density: 1.25, color: '#26282b' },
  'epdm': { label: 'EPDM', density: 1.15, color: '#2b2d30' },
  'silicona': { label: 'Silicona (VMQ)', density: 1.15, color: '#d8c9b8' },
  'poliuretano': { label: 'Poliuretano (PU 90 Sh A)', density: 1.2, color: '#d9a441' },
  'ptfe': { label: 'PTFE (Teflón)', density: 2.2, color: '#f2f2ee' },
  'pe100': { label: 'Polietileno PE-100', density: 0.95, color: '#e8e6dc' },
  'pehd': { label: 'Polietileno HDPE', density: 0.95, color: '#e8e6dc' },
  'pp': { label: 'Polipropileno (PP)', density: 0.91, color: '#e6e2d3' },
  'pom': { label: 'Acetal / POM (Delrin)', density: 1.41, color: '#ece9df' },
  'pa66': { label: 'Nylon PA66', density: 1.14, color: '#e4dfcf' },
  'nylonMoS2': { label: 'Nylon con MoS₂', density: 1.17, color: '#7d7f84' },
  'peek': { label: 'PEEK', density: 1.3, color: '#b9a98a' },
  'pet': { label: 'PET', density: 1.38, color: '#dfe3e6' },
  'abs': { label: 'ABS', density: 1.05, color: '#d6d3c7' },
  'pc': { label: 'Policarbonato (PC)', density: 1.2, color: '#d7e3ea' },
  'acrilico': { label: 'Acrílico (PMMA)', density: 1.19, color: '#d3e6ee' },
  'fenolico': { label: 'Fenólico / Ertalyte-tela (Micarta)', density: 1.35, color: '#a8794b' },
  'madera': { label: 'Madera dura', density: 0.75, color: '#b58a5a' },
  'plastico': { label: 'Plástico (genérico)', density: 1.2, color: '#d8d8d2' },
};

// Masa en kg a partir del volumen en mm³ y la densidad en g/cm³.
export const massKg = (volumeMm3, materialId) => ((materials[materialId]?.density ?? 0) * volumeMm3) / 1e6;

// --- Piezas de revolución: ejes, escalones y diámetros a partir de las caras (más robusto que las aristas) ---
const axisVectors = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const axisIndex = { x: 0, y: 1, z: 2 };
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

export function analyzeRevolve(shape) {
  const cylinders = [];
  const planes = [];
  shape.faces.forEach((face) => {
    const [min, max] = face.boundingBox.bounds;
    const ext = max.map((value, i) => value - min[i]);
    const center = face.center;
    const c = [center.x, center.y, center.z];
    const n = face.normalAt();
    const normal = normalize([n.x, n.y, n.z]);
    if (face.geomType === 'PLANE') {
      ['x', 'y', 'z'].forEach((axis) => {
        if (Math.abs(normal[axisIndex[axis]]) > 0.999) planes.push({ axis, t: c[axisIndex[axis]] });
      });
    } else if (face.geomType.startsWith('CYL')) {
      ['x', 'y', 'z'].forEach((axis) => {
        const k = axisIndex[axis];
        const others = [0, 1, 2].filter((i) => i !== k);
        const radial = Math.abs(normal[k]) < 0.01; // la "normal" del kernel es radial: perpendicular al eje
        const full = near(ext[others[0]], ext[others[1]], 1e-3 * ext[others[0]] + 1e-6) && ext[k] > 1e-6;
        const centered = near((min[others[0]] + max[others[0]]) / 2, c[others[0]], 1e-3 + 1e-3 * ext[others[0]]) && near((min[others[1]] + max[others[1]]) / 2, c[others[1]], 1e-3 + 1e-3 * ext[others[1]]);
        if (radial && full && centered) cylinders.push({ axis, face, t0: min[k], t1: max[k], r: ext[others[0]] / 2, point: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] });
      });
    }
  });
  if (cylinders.length === 0) return null;
  // Eje dominante: el que más cilindros coaxiales tiene.
  const groups = [];
  cylinders.forEach((cylinder) => {
    const others = [0, 1, 2].filter((i) => i !== axisIndex[cylinder.axis]);
    const group = groups.find((g) => g.axis === cylinder.axis && near(g.point[others[0]], cylinder.point[others[0]], 0.01) && near(g.point[others[1]], cylinder.point[others[1]], 0.01));
    if (group) group.items.push(cylinder);
    else groups.push({ axis: cylinder.axis, point: cylinder.point, items: [cylinder] });
  });
  const best = groups.sort((a, b) => b.items.length - a.items.length)[0];
  const k = axisIndex[best.axis];
  const items = best.items.map((item) => ({ ...item }));
  // Interno (agujero / alojamiento) = hay otro cilindro mayor que lo envuelve en todo su recorrido axial.
  // Primero por orientación real: la normal de la cara (hacia afuera del material) apunta al eje en un agujero.
  // Si el kernel no la entrega, queda el criterio geométrico de más abajo.
  items.forEach((item) => {
    const radialIndex = [0, 1, 2].find((i) => i !== k);
    try {
      const probe = [item.point[0], item.point[1], item.point[2]];
      probe[radialIndex] += item.r;
      const n = item.face.normalAt(probe);
      const outward = n.x * (radialIndex === 0 ? 1 : 0) + n.y * (radialIndex === 1 ? 1 : 0) + n.z * (radialIndex === 2 ? 1 : 0);
      item.internal = Math.abs(outward) > 0.5 ? outward < 0 : undefined;
    } catch {
      item.internal = undefined;
    }
    if (item.internal === undefined) item.internal = items.some((other) => other !== item && other.r > item.r + 1e-6 && other.t0 <= item.t0 + 1e-6 && other.t1 >= item.t1 - 1e-6);
    delete item.face;
  });
  const external = items.filter((item) => !item.internal);
  if (external.length === 0) return null;
  const [min, max] = shape.boundingBox.bounds;
  const others = [0, 1, 2].filter((i) => i !== k);
  const silhouette = Math.max(max[others[0]] - min[others[0]], max[others[1]] - min[others[1]]);
  const maxR = Math.max(...external.map((item) => item.r));
  if (!near(maxR * 2, silhouette, silhouette * 0.01 + 0.02)) return null; // no es una pieza de revolución completa
  const ts = [...new Set(planes.filter((plane) => plane.axis === best.axis).map((plane) => Math.round(plane.t * 1000) / 1000))].sort((a, b) => a - b);
  return { axis: best.axis, vector: axisVectors[best.axis], point: best.point, planes: ts, cylinders: items, lo: Math.min(...items.map((item) => item.t0), ...ts), hi: Math.max(...items.map((item) => item.t1), ...ts) };
}
