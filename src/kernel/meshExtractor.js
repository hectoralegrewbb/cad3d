import { edgeMidpoint } from './partBuilder.js';
import { meshEdgesShape, meshShape } from './batchMesh.js';

// Datos listos para el visor: triángulos de las caras + polilíneas de las aristas (para dibujar y elegir).
// Aristas "suaves": costuras de cilindros y empalmes tangentes entre caras. No son bordes reales de la pieza: el visor no las dibuja
// (si no, una pieza de un solo cuerpo parece armada con partes sueltas).
const MAX_PROJECTIONS = 1500; // cada proyección punto→superficie cuesta ms: tope para que una pieza compleja no se cuelgue

function smoothEdgeFlags(shape, edges) {
  const flags = new Map();
  try {
    const faces = shape.faces;
    // Índice arista → caras por hash (antes era edges × caras × aristas de cara: minutos con 400+ caras).
    const bucket = new Map();
    faces.forEach((face, faceIndex) =>
      face.edges.forEach((edge) => {
        const key = edge.hashCode;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push({ faceIndex, edge });
      }));
    // Normal en un punto: proyectar el punto sobre la superficie es lo más caro (ms por llamada); en una cara plana la normal es constante.
    const planeNormals = new Map();
    let projections = 0;
    const normalOf = (faceIndex, mid) => {
      const face = faces[faceIndex];
      if (face.geomType !== 'PLANE') {
        // Superficies libres (hélices) o demasiadas proyecciones: se dibuja la arista (no se intenta clasificar como suave).
        if (face.geomType.startsWith('BSPLINE') || projections >= MAX_PROJECTIONS) return null;
        projections += 1;
        return face.normalAt(mid);
      }
      if (!planeNormals.has(faceIndex)) planeNormals.set(faceIndex, face.normalAt());
      return planeNormals.get(faceIndex);
    };
    edges.forEach((edge, index) => {
      const matches = (bucket.get(edge.hashCode) ?? []).filter((item) => item.edge.isSame(edge));
      const ownerIndexes = [...new Set(matches.map((item) => item.faceIndex))];
      if (ownerIndexes.length === 1) return flags.set(index, true); // la misma cara en ambos lados = costura
      if (ownerIndexes.length !== 2) return;
      const mid = edgeMidpoint(edge);
      const [a, b] = ownerIndexes.map((faceIndex) => normalOf(faceIndex, mid));
      if (!a || !b) return;
      const dot = a.x * b.x + a.y * b.y + a.z * b.z;
      if (Math.abs(dot) > 0.9995 && dot > 0) flags.set(index, true);
    });
  } catch {
    /* sin clasificación: se dibujan todas */
  }
  return flags;
}

// Polilínea de cada arista a partir de meshEdges (un solo llamado al kernel en vez de 33 `pointAt` por arista).
function edgePolylines(shape, tolerance, angularTolerance) {
  const { lines, edgeGroups } = meshEdgesShape(shape, { tolerance, angularTolerance });
  const byId = new Map();
  edgeGroups.forEach((group) => {
    const points = [];
    // `lines` guarda segmentos sueltos (pares de puntos): se unen en una polilínea.
    for (let i = 0; i < group.count; i += 2) {
      const at = (group.start + i) * 3;
      if (i === 0) points.push(lines[at], lines[at + 1], lines[at + 2]);
      points.push(lines[at + 3], lines[at + 4], lines[at + 5]);
    }
    if (!byId.has(group.edgeId)) byId.set(group.edgeId, []);
    byId.get(group.edgeId).push(points);
  });
  return byId;
}

// Calidad de malla según la forma: piezas con superficies libres (hélices, barridos) y grandes se mallan más grueso; las normales
// suavizadas del visor disimulan la diferencia, y el costo del kernel baja ~10×.
export function meshQuality(shape) {
  const [min, max] = shape.boundingBox.bounds;
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  let freeform = 0;
  try {
    freeform = shape.faces.reduce((count, face) => (['PLANE', 'CYLINDRE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS'].includes(face.geomType) ? count : count + 1), 0);
  } catch {
    freeform = 0;
  }
  if (freeform > 0 && diagonal > 120) return { tolerance: Math.min(0.25, Math.max(0.08, diagonal * 0.0005)), angularTolerance: 0.2 };
  return { tolerance: 0.05, angularTolerance: 0.1 };
}

export function extractMesh(shape, options = null) {
  const { tolerance, angularTolerance } = options ?? meshQuality(shape);
  const mesh = meshShape(shape, { tolerance, angularTolerance });
  const solidEdges = shape.edges;
  const smooth = smoothEdgeFlags(shape, solidEdges);
  const polylines = edgePolylines(shape, tolerance, angularTolerance);
  const edges = solidEdges.map((edge, index) => {
    const queue = polylines.get(edge.hashCode);
    let points = queue?.length ? queue.shift() : null;
    if (!points || points.length < 6) {
      points = [];
      const steps = edge.geomType === 'LINE' ? 1 : 32;
      for (let i = 0; i <= steps; i += 1) {
        const p = edge.pointAt(i / steps);
        points.push(p.x, p.y, p.z);
        p.delete?.();
      }
    }
    return { index, type: edge.geomType, points, mid: edgeMidpoint(edge), smooth: smooth.get(index) === true };
  });
  const [min, max] = shape.boundingBox.bounds;
  return {
    vertices: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    triangles: Uint32Array.from(mesh.triangles),
    edges,
    faceGroups:mesh.faceGroups,
    bounds: { min, max, size: max.map((value, i) => value - min[i]) },
  };
}
