import { makeCompound } from '../../vendor/replicad/replicad.js';

// Mallado por tandas. Mallar de una vez un sólido con miles de caras (un STL cosido, por ejemplo) hace que el mallador de OpenCascade
// pida >100 KB por cara de memoria transitoria: 10 000 caras → +1,3 GB que la memoria WASM no devuelve nunca. En tandas de 200 caras la
// misma malla sale idéntica con un pico de ~40 MB (y algo más rápido). Por debajo de `threshold` caras se mallla directo.
const BATCH = 200;
const THRESHOLD = 500;

const deleteAll = (list) => list.forEach((item) => item?.delete?.());

// Igual que shape.mesh(options) → { vertices, normals, triangles, faceGroups }.
export function meshShape(shape, options = {}, { batch = BATCH, threshold = THRESHOLD } = {}) {
  const faces = shape.faces;
  if (faces.length <= threshold) {
    deleteAll(faces);
    return shape.mesh(options);
  }
  const out = { vertices: [], normals: [], triangles: [], faceGroups: [] };
  try {
    for (let i = 0; i < faces.length; i += batch) {
      const compound = makeCompound(faces.slice(i, i + batch));
      try {
        const part = compound.mesh(options);
        const vertexOffset = out.vertices.length / 3;
        const indexOffset = out.triangles.length;
        for (let k = 0; k < part.vertices.length; k += 1) out.vertices.push(part.vertices[k]);
        for (let k = 0; k < part.normals.length; k += 1) out.normals.push(part.normals[k]);
        for (let k = 0; k < part.triangles.length; k += 1) out.triangles.push(part.triangles[k] + vertexOffset);
        part.faceGroups.forEach((group) => out.faceGroups.push({ start: group.start + indexOffset, count: group.count, faceId: group.faceId }));
      } finally {
        compound.delete?.();
      }
    }
  } finally {
    deleteAll(faces);
  }
  return out;
}

// Igual que shape.meshEdges(options) → { lines, edgeGroups } (los grupos se numeran por arista, así que se pueden tandear por aristas).
export function meshEdgesShape(shape, options = {}, { batch = 1000, threshold = 2500 } = {}) {
  const edges = shape.edges;
  if (edges.length <= threshold) {
    deleteAll(edges);
    return shape.meshEdges(options);
  }
  const out = { lines: [], edgeGroups: [] };
  try {
    for (let i = 0; i < edges.length; i += batch) {
      const compound = makeCompound(edges.slice(i, i + batch));
      try {
        const part = compound.meshEdges(options);
        const pointOffset = out.lines.length / 3;
        for (let k = 0; k < part.lines.length; k += 1) out.lines.push(part.lines[k]);
        part.edgeGroups.forEach((group) => out.edgeGroups.push({ start: group.start + pointOffset, count: group.count, edgeId: group.edgeId }));
      } finally {
        compound.delete?.();
      }
    }
  } finally {
    deleteAll(edges);
  }
  return out;
}
