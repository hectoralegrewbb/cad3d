// Códec de mallas para guardarlas dentro de una operación (JSON): vértices Float32 + índices Uint32 en base64.
// Puro: sin DOM ni kernel. Lo usan el diálogo de importación (codificar) y el motor (decodificar).
const chunkSize = 0x8000;

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += chunkSize) text += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(text);
};

const fromBase64 = (text) => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

export function encodeMesh({ vertices, triangles }) {
  return { nv: vertices.length / 3, nt: triangles.length / 3, v: toBase64(bytesOf(vertices)), t: toBase64(bytesOf(triangles)) };
}

export function decodeMesh(data) {
  if (!data?.v || !data?.t) throw new Error('La malla guardada está incompleta');
  const vertexBytes = fromBase64(data.v);
  const triangleBytes = fromBase64(data.t);
  if (vertexBytes.length !== data.nv * 12 || triangleBytes.length !== data.nt * 12) throw new Error('La malla guardada está dañada (tamaños que no coinciden)');
  const vertices = new Float32Array(vertexBytes.buffer);
  const triangles = new Uint32Array(triangleBytes.buffer);
  if (!vertices.every(Number.isFinite) || !triangles.every((i) => i < data.nv)) throw new Error('Malla con coordenadas o índices inválidos');
  return { vertices, triangles };
}
