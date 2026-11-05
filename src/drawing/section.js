// Vistas en corte: se elimina el semiespacio del lado del observador y se extraen los contornos de la cara cortada (para el rayado).
const axisIndex = { x: 0, y: 1, z: 2 };
const MARGIN = 10;

// Corta la pieza con el plano `plane` en `offset`. 'x' y 'y' conservan el lado mayor; 'z' conserva el lado menor (observador arriba).
export function cutShape(rep, shape, plane, offset) {
  const [min, max] = shape.boundingBox.bounds;
  const lo = min.map((v) => v - MARGIN);
  const hi = max.map((v) => v + MARGIN);
  const i = axisIndex[plane];
  const a = [...lo];
  const b = [...hi];
  if (plane === 'z') a[i] = offset;
  else b[i] = offset;
  const tool = rep.makeBox(a, b);
  const result = shape.cut(tool);
  tool.delete?.();
  return result;
}

const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-3;

// Encadena segmentos/polilíneas sueltas en lazos cerrados.
function stitch(pieces) {
  const remaining = pieces.map((piece) => [...piece]);
  const loops = [];
  while (remaining.length) {
    const loop = remaining.shift();
    let grew = true;
    while (grew && !same(loop[0], loop[loop.length - 1])) {
      grew = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const piece = remaining[i];
        const end = loop[loop.length - 1];
        if (same(end, piece[0])) loop.push(...piece.slice(1));
        else if (same(end, piece[piece.length - 1])) loop.push(...[...piece].reverse().slice(1));
        else continue;
        remaining.splice(i, 1);
        grew = true;
        break;
      }
    }
    loops.push(loop);
  }
  return loops;
}

const sampleEdge = (edge) => {
  const steps = edge.geomType === 'LINE' ? 1 : 48;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = edge.pointAt(i / steps);
    points.push([p.x, p.y, p.z]);
    p.delete?.();
  }
  return points;
};

// Contornos 3D de las caras planas que quedaron sobre el plano de corte.
export function sectionLoops(shape, plane, offset) {
  const i = axisIndex[plane];
  const pieces = [];
  shape.faces.forEach((face) => {
    if (face.geomType !== 'PLANE') return;
    const center = face.center;
    const normal = face.normalAt();
    const onPlane = Math.abs(center.toTuple ? center.toTuple()[i] - offset : center[['x', 'y', 'z'][i]] - offset) < 1e-3;
    const n = normal.toTuple ? normal.toTuple() : [normal.x, normal.y, normal.z];
    if (onPlane && Math.abs(n[i]) > 0.999) {
      face.wires.forEach((wire) => wire.edges.forEach((edge) => pieces.push(sampleEdge(edge))));
    }
  });
  return stitch(pieces);
}
