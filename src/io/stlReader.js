// Lector de STL (binario y ASCII) → malla indexada con vértices unificados. Puro: sin DOM ni kernel.
export const maxStlTriangles = 20000; // por encima, coser caras en el kernel tarda demasiado: conviene simplificar la malla en el CAD

const headerOf = (bytes) => new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));

function readBinary(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const coords = new Float32Array(count * 9);
  let offset = 84;
  for (let i = 0; i < count; i += 1) {
    offset += 12; // normal: se recalcula con los vértices
    for (let k = 0; k < 9; k += 1) {
      coords[i * 9 + k] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // atributos
  }
  return coords;
}

function readAscii(buffer) {
  const text = new TextDecoder().decode(buffer);
  const values = [];
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  if (values.length === 0 || values.length % 9 !== 0 || values.some((value) => !Number.isFinite(value))) throw new Error('El STL de texto no tiene triángulos válidos');
  return Float32Array.from(values);
}

// Une vértices coincidentes (tolerancia proporcional al tamaño) y descarta triángulos degenerados.
function weld(coords) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < coords.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], coords[i + k]);
      max[k] = Math.max(max[k], coords[i + k]);
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!(diagonal > 0) || !Number.isFinite(diagonal)) throw new Error('El STL no tiene volumen (todos los puntos coinciden o hay valores inválidos)');
  const grid = diagonal * 1e-7;
  const index = new Map();
  const vertices = [];
  const triangles = [];
  let degenerate = 0;
  const idOf = (x, y, z) => {
    const key = `${Math.round(x / grid)},${Math.round(y / grid)},${Math.round(z / grid)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      index.set(key, id);
      vertices.push(x, y, z);
    }
    return id;
  };
  for (let t = 0; t < coords.length; t += 9) {
    const a = idOf(coords[t], coords[t + 1], coords[t + 2]);
    const b = idOf(coords[t + 3], coords[t + 4], coords[t + 5]);
    const c = idOf(coords[t + 6], coords[t + 7], coords[t + 8]);
    if (a === b || b === c || a === c) degenerate += 1;
    else triangles.push(a, b, c);
  }
  return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles), degenerate, min, max };
}

// Aristas que pertenecen a un solo triángulo (la malla no está cerrada) y aristas compartidas por más de dos.
function edgeStats(triangles, vertexCount) {
  const counts = new Map();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = triangles[t + k];
      const b = triangles[t + ((k + 1) % 3)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  let shared = 0;
  counts.forEach((count) => {
    if (count === 1) open += 1;
    else if (count > 2) shared += 1;
  });
  return { openEdges: open, multiEdges: shared };
}

// buffer: ArrayBuffer del archivo. Devuelve { vertices, triangles, triangleCount, vertexCount, degenerate, openEdges, multiEdges, bounds }.
export function parseStl(buffer) {
  if (!buffer || buffer.byteLength < 15) throw new Error('El archivo es demasiado chico para ser un STL');
  const bytes = new Uint8Array(buffer);
  let binary = false;
  if (buffer.byteLength >= 84) binary = 84 + new DataView(buffer).getUint32(80, true) * 50 === buffer.byteLength;
  if (!binary && !/^\s*solid/i.test(headerOf(bytes))) throw new Error('No parece un STL: ni binario válido ni de texto');
  const coords = binary ? readBinary(buffer) : readAscii(buffer);
  const welded = weld(coords);
  if (welded.triangles.length === 0) throw new Error('El STL no tiene triángulos válidos');
  const vertexCount = welded.vertices.length / 3;
  const size = welded.max.map((value, k) => value - welded.min[k]);
  return {
    vertices: welded.vertices,
    triangles: welded.triangles,
    triangleCount: welded.triangles.length / 3,
    vertexCount,
    degenerate: welded.degenerate,
    ...edgeStats(welded.triangles, vertexCount),
    bounds: { min: welded.min, max: welded.max, size },
  };
}
