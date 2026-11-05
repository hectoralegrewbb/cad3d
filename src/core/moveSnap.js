// Mover cuerpos con el ratón: imanes entre cajas envolventes (caras, centros, origen), distancias libres a los vecinos y geometría
// de rayos para arrastrar sobre un eje o un plano. Puro: sin DOM ni three.js (vectores como arreglos [x, y, z]).

export const axisNames = ['X', 'Y', 'Z'];
const KINDS = ['min', 'center', 'max'];

export const boxCenter = (box) => box.min.map((v, i) => (v + box.max[i]) / 2);
export const translateBox = (box, delta) => ({ ...box, min: box.min.map((v, i) => v + delta[i]), max: box.max.map((v, i) => v + delta[i]) });
const valueOf = (box, axis, kind) => (kind === 'min' ? box.min[axis] : kind === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2);

// Pares que valen más: caras que se tocan (máx↔mín) y caras o centros del mismo tipo (mín↔mín, centro↔centro, máx↔máx).
const isStrong = (mine, theirs) => theirs === 'origen' || mine === theirs || (mine === 'max' && theirs === 'min') || (mine === 'min' && theirs === 'max');

// Ajusta `delta` para que la caja `box` (en su lugar de partida) quede alineada o apoyada con otras cajas o con el origen.
// axes = [x, y, z] booleanos: solo se ajustan los ejes en los que se está moviendo. tol en mm.
// Devuelve { delta, snaps: [{ axis, value, mine, theirs, target, box }] } (un imán como máximo por eje).
export function snapMove({ box, delta, axes = [true, true, true], others = [], tol = 1, origin = true }) {
  const out = [...delta];
  const snaps = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (!axes[axis]) continue;
    let best = null;
    const consider = (mine, theirs, value, target, targetBox) => {
      const diff = value - (valueOf(box, axis, mine) + delta[axis]);
      const score = Math.abs(diff) + (isStrong(mine, theirs) ? 0 : tol * 0.5);
      if (Math.abs(diff) <= tol && (!best || score < best.score)) best = { score, diff, mine, theirs, value, target, box: targetBox };
    };
    others.forEach((other) => KINDS.forEach((theirs) => KINDS.forEach((mine) => consider(mine, theirs, valueOf(other, axis, theirs), other.name ?? other.id, other))));
    if (origin) KINDS.forEach((mine) => consider(mine, 'origen', 0, 'el origen', null));
    if (best) {
      out[axis] = delta[axis] + best.diff;
      snaps.push({ axis, value: best.value, mine: best.mine, theirs: best.theirs, target: best.target, box: best.box });
    }
  }
  return { delta: out, snaps };
}

// Distancia libre entre `box` y el vecino más cercano en cada sentido de cada eje (solo vecinos que se enfrentan: se superponen
// en los otros dos ejes). Devuelve [{ axis, dir (+1/−1), gap, target, from, to }] con los puntos de la cota en 3D.
export function neighbourGaps({ box, others = [], axes = [true, true, true], minOverlap = 1e-6 }) {
  const result = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (!axes[axis]) continue;
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    [1, -1].forEach((dir) => {
      let best = null;
      others.forEach((other) => {
        const ou = Math.min(box.max[u], other.max[u]) - Math.max(box.min[u], other.min[u]);
        const ov = Math.min(box.max[v], other.max[v]) - Math.max(box.min[v], other.min[v]);
        if (ou <= minOverlap || ov <= minOverlap) return;
        const gap = dir > 0 ? other.min[axis] - box.max[axis] : box.min[axis] - other.max[axis];
        if (gap < -1e-6) return; // se superponen en este eje: no hay distancia libre
        if (!best || gap < best.gap) best = { gap: Math.max(0, gap), other, ou: [Math.max(box.min[u], other.min[u]), Math.min(box.max[u], other.max[u])], ov: [Math.max(box.min[v], other.min[v]), Math.min(box.max[v], other.max[v])] };
      });
      if (!best) return;
      const from = [0, 0, 0];
      const to = [0, 0, 0];
      from[axis] = dir > 0 ? box.max[axis] : box.min[axis];
      to[axis] = dir > 0 ? best.other.min[axis] : best.other.max[axis];
      from[u] = to[u] = (best.ou[0] + best.ou[1]) / 2;
      from[v] = to[v] = (best.ov[0] + best.ov[1]) / 2;
      result.push({ axis, dir, gap: best.gap, target: best.other.name ?? best.other.id, from, to });
    });
  }
  return result;
}

// Parámetro t (mm a lo largo de `dir`, unitario) del punto del eje p0 + t·dir más cercano a la recta del rayo.
export function closestOnAxis(rayOrigin, rayDir, p0, dir) {
  const w = rayOrigin.map((v, i) => v - p0[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const b = dot(rayDir, dir);
  const d = dot(rayDir, w);
  const e = dot(dir, w);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-9) return null; // el rayo es paralelo al eje: no se puede arrastrar
  return (e - b * d) / denom;
}

// Punto donde el rayo corta el plano (o null si es paralelo o el plano queda detrás).
export function rayPlane(rayOrigin, rayDir, planePoint, normal) {
  const denom = rayDir[0] * normal[0] + rayDir[1] * normal[1] + rayDir[2] * normal[2];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((planePoint[0] - rayOrigin[0]) * normal[0] + (planePoint[1] - rayOrigin[1]) * normal[1] + (planePoint[2] - rayOrigin[2]) * normal[2]) / denom;
  if (t < 0) return null;
  return rayOrigin.map((v, i) => v + rayDir[i] * t);
}

// Modo de arrastre → ejes activos y, si es un plano, su normal.
export const dragModes = {
  x: { axes: [true, false, false], label: 'Solo eje X' },
  y: { axes: [false, true, false], label: 'Solo eje Y' },
  z: { axes: [false, false, true], label: 'Solo eje Z' },
  xy: { axes: [true, true, false], normal: [0, 0, 1], label: 'Plano XY (horizontal)' },
  xz: { axes: [true, false, true], normal: [0, 1, 0], label: 'Plano XZ (frontal)' },
  yz: { axes: [false, true, true], normal: [1, 0, 0], label: 'Plano YZ (lateral)' },
};

// Desplazamiento (mm) pedido por el puntero entre el rayo de inicio y el actual, ya limitado al eje/plano del modo.
export function dragDelta(mode, startRay, currentRay, center) {
  const spec = dragModes[mode] ?? dragModes.z;
  if (spec.normal) {
    const a = rayPlane(startRay.origin, startRay.dir, center, spec.normal);
    const b = rayPlane(currentRay.origin, currentRay.dir, center, spec.normal);
    if (!a || !b) return null;
    return b.map((v, i) => (spec.axes[i] ? v - a[i] : 0));
  }
  const axis = spec.axes.findIndex(Boolean);
  const dir = [0, 0, 0];
  dir[axis] = 1;
  const t0 = closestOnAxis(startRay.origin, startRay.dir, center, dir);
  const t1 = closestOnAxis(currentRay.origin, currentRay.dir, center, dir);
  if (t0 === null || t1 === null) return null;
  const delta = [0, 0, 0];
  delta[axis] = t1 - t0;
  return delta;
}
