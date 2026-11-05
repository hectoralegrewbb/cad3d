import { decodeMesh } from '../core/meshCodec.js';
import { turnPoint } from './turn.js';

// Modo «solo malla»: el STL se muestra y se usa en la simulación tal cual, sin convertirlo en sólido B-Rep (no hay límite de triángulos).
// Devuelve el mismo formato que `extractMesh`: { vertices, normals, triangles, edges, bounds }. Puro: no usa el kernel.
// Las normales se suavizan salvo en los pliegues (ángulo > creaseDeg) y las aristas del visor son esos pliegues y los bordes abiertos.
export function buildMeshOnlyData(encodedMesh, { scale = 1, turn = null, move = [0, 0, 0] } = {}, { creaseDeg = 35, maxEdges = 60000 } = {}) {
  const { vertices, triangles } = decodeMesh(encodedMesh);
  const n = vertices.length / 3;
  const T = triangles.length / 3;
  const pos = new Float64Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    let p = [vertices[i * 3] * scale, vertices[i * 3 + 1] * scale, vertices[i * 3 + 2] * scale];
    if (turn) p = turnPoint(turn, p);
    pos[i * 3] = p[0] + move[0]; pos[i * 3 + 1] = p[1] + move[1]; pos[i * 3 + 2] = p[2] + move[2];
  }
  // normal de cada cara (sin normalizar = 2 × área) y versión unitaria
  const faceN = new Float64Array(T * 3);
  const faceU = new Float64Array(T * 3);
  for (let f = 0; f < T; f += 1) {
    const a = triangles[f * 3] * 3; const b = triangles[f * 3 + 1] * 3; const c = triangles[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a]; const uy = pos[b + 1] - pos[a + 1]; const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a]; const vy = pos[c + 1] - pos[a + 1]; const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceN[f * 3] = nx; faceN[f * 3 + 1] = ny; faceN[f * 3 + 2] = nz;
    faceU[f * 3] = nx / len; faceU[f * 3 + 1] = ny / len; faceU[f * 3 + 2] = nz / len;
  }
  // esquinas por vértice (lista enlazada en arreglos)
  const head = new Int32Array(n).fill(-1);
  const next = new Int32Array(T * 3).fill(-1);
  for (let c = 0; c < T * 3; c += 1) { const v = triangles[c]; next[c] = head[v]; head[v] = c; }
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const outPos = [];
  const outNormal = [];
  const outTri = new Uint32Array(T * 3);
  for (let v = 0; v < n; v += 1) {
    const clusters = []; // { sum: [x,y,z], id }
    for (let c = head[v]; c >= 0; c = next[c]) {
      const f = Math.floor(c / 3);
      const ux = faceU[f * 3]; const uy = faceU[f * 3 + 1]; const uz = faceU[f * 3 + 2];
      let found = null;
      for (const cluster of clusters) {
        const l = Math.hypot(...cluster.sum) || 1;
        if ((cluster.sum[0] * ux + cluster.sum[1] * uy + cluster.sum[2] * uz) / l > cosCrease) { found = cluster; break; }
      }
      if (!found) { found = { sum: [0, 0, 0], id: outPos.length / 3 }; clusters.push(found); outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); outNormal.push(0, 0, 0); }
      found.sum[0] += faceN[f * 3]; found.sum[1] += faceN[f * 3 + 1]; found.sum[2] += faceN[f * 3 + 2];
      outTri[c] = found.id;
    }
    clusters.forEach((cluster) => {
      const l = Math.hypot(...cluster.sum) || 1;
      outNormal[cluster.id * 3] = cluster.sum[0] / l; outNormal[cluster.id * 3 + 1] = cluster.sum[1] / l; outNormal[cluster.id * 3 + 2] = cluster.sum[2] / l;
    });
  }
  // aristas del visor: pliegues y bordes abiertos
  const firstFace = new Map();
  const sharp = [];
  const key = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let f = 0; f < T; f += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = triangles[f * 3 + k]; const b = triangles[f * 3 + (k + 1) % 3];
      const kk = key(a, b);
      const other = firstFace.get(kk);
      if (other === undefined) { firstFace.set(kk, f); continue; }
      if (other < 0) continue;
      const dot = faceU[f * 3] * faceU[other * 3] + faceU[f * 3 + 1] * faceU[other * 3 + 1] + faceU[f * 3 + 2] * faceU[other * 3 + 2];
      if (dot < cosCrease) sharp.push([dot, a, b]);
      firstFace.set(kk, -1);
    }
  }
  firstFace.forEach((value, kk) => { if (value >= 0) sharp.push([-2, Math.floor(kk / n), kk % n]); }); // borde abierto: el primero en conservarse
  sharp.sort((p, q) => p[0] - q[0]);
  const edges = sharp.slice(0, maxEdges).map(([, a, b], index) => {
    const p = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    return { index, type: 'LINE', points: p, mid: [(p[0] + p[3]) / 2, (p[1] + p[4]) / 2, (p[2] + p[5]) / 2], smooth: false };
  });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], pos[i * 3 + k]); max[k] = Math.max(max[k], pos[i * 3 + k]); }
  return {
    vertices: Float32Array.from(outPos), normals: Float32Array.from(outNormal), triangles: outTri, edges,
    bounds: { min, max, size: max.map((value, i) => value - min[i]) },
  };
}
