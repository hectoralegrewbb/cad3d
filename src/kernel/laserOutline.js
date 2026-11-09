// Contornos de una cara plana del sólido B-Rep para corte láser: lazo exterior + lazos interiores (agujeros, chaflanes de boceto, etc.)
// tal como están en la pieza. Devuelve datos planos (clonables, sin objetos del kernel): el marco 3D de la cara y, por lazo, sus tramos.
// Tramo: { type: 'line', p0, p1 } | { type: 'arc', p0, pm, p1 } (pm = punto medio) | { type: 'circle', pts: [a, b, c] } | { type: 'poly', points, closed }.
const POLY_SAMPLES = 32;

const tuple = (vector) => {
  const out = [vector.x, vector.y, vector.z];
  vector.delete?.();
  return out;
};

function edgeItem(edge) {
  const type = edge.geomType;
  if (type === 'LINE') return { type: 'line', p0: tuple(edge.startPoint), p1: tuple(edge.endPoint) };
  if (type === 'CIRCLE') {
    if (edge.isClosed) return { type: 'circle', pts: [0, 1 / 3, 2 / 3].map((t) => tuple(edge.pointAt(t))) };
    return { type: 'arc', p0: tuple(edge.startPoint), pm: tuple(edge.pointAt(0.5)), p1: tuple(edge.endPoint) };
  }
  // Elipse, spline u otra curva: se muestrea (no hay entidad DXF equivalente sin perder exactitud en R12).
  return { type: 'poly', points: Array.from({ length: POLY_SAMPLES + 1 }, (_, i) => tuple(edge.pointAt(i / POLY_SAMPLES))), closed: edge.isClosed };
}

function wireLoop(wire, outer) {
  const edges = wire.edges;
  try {
    return { outer, items: edges.map(edgeItem) };
  } finally {
    edges.forEach((edge) => edge.delete());
    wire.delete();
  }
}

// Marco de la cara visto desde afuera: u hacia la derecha, v hacia arriba, normal hacia el observador (sin espejar).
function faceFrame(normal, origin) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const n = unit(normal);
  const u = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : unit(cross([0, 0, 1], n));
  return { origin, normal: n, u, v: cross(n, u), dot };
}

// Elige la cara plana más grande (o la de `faceId`, el hashCode que devuelve el visor) y extrae sus lazos.
export function planarFaceLoops(rep, shape, { faceId } = {}) {
  if (!shape) throw new Error('El DXF para láser requiere un sólido B-Rep.');
  const faces = shape.faces;
  try {
    let best = null;
    faces.forEach((face) => {
      if (faceId !== undefined && face.hashCode !== faceId) return;
      if (face.geomType !== 'PLANE') return;
      const area = rep.measureArea(face);
      if (!best || area > best.area) best = { face, area };
    });
    if (!best) throw new Error(faceId !== undefined ? 'La cara elegida no es plana: el láser corta contornos planos.' : 'La pieza no tiene caras planas para cortar con láser.');
    const normalVector = best.face.normalAt();
    const normal = [normalVector.x, normalVector.y, normalVector.z];
    normalVector.delete();
    const center = best.face.center;
    const origin = [center.x, center.y, center.z];
    center.delete();
    const { u, v, normal: n } = faceFrame(normal, origin);
    const loops = [wireLoop(best.face.clone().outerWire(), true), ...best.face.clone().innerWires().map((wire) => wireLoop(wire, false))];
    return { frame: { origin, normal: n, u, v }, loops, area: best.area };
  } finally {
    faces.forEach((face) => face.delete());
  }
}
