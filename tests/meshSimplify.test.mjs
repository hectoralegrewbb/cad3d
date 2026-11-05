import assert from 'node:assert/strict';
import { meshVolume, simplifyMesh } from '../src/core/meshSimplify.js';

function sphere(n, r = 100) { // con un solo vértice en cada polo (malla cerrada de verdad)
  const rows = n; const cols = 2 * n; const v = [0, 0, r]; const t = [];
  for (let i = 1; i < rows; i++) for (let j = 0; j < cols; j++) { const th = Math.PI * i / rows; const ph = 2 * Math.PI * j / cols; v.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)); }
  v.push(0, 0, -r);
  const south = v.length / 3 - 1; const ring = (i, j) => 1 + (i - 1) * cols + (j % cols);
  for (let j = 0; j < cols; j++) t.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rows - 1; i++) for (let j = 0; j < cols; j++) { const a = ring(i, j); const b = ring(i, j + 1); const c = ring(i + 1, j); const d = ring(i + 1, j + 1); t.push(a, c, b, b, c, d); }
  for (let j = 0; j < cols; j++) t.push(south, ring(rows - 1, j + 1), ring(rows - 1, j));
  return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) };
}
// caja subdividida: cada cara en k×k celdas (muchos triángulos coplanares)
function box(k, s = 100) {
  const v = []; const t = []; const map = new Map();
  const id = (x, y, z) => { const key = `${x},${y},${z}`; if (!map.has(key)) { map.set(key, v.length / 3); v.push(x * s / k, y * s / k, z * s / k); } return map.get(key); };
  const face = (fx) => { for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const [a, b, c, d] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([u, w]) => fx(u, w)); t.push(a, b, c, a, c, d); } };
  face((u, w) => id(u, w, 0)); face((u, w) => id(u, w, k)); face((u, w) => id(u, 0, w)); face((u, w) => id(u, k, w)); face((u, w) => id(0, u, w)); face((u, w) => id(k, u, w));
  // todas las normales hacia afuera
  for (let i = 0; i < t.length; i += 3) {
    const P = [0, 1, 2].map((q) => [v[t[i + q] * 3], v[t[i + q] * 3 + 1], v[t[i + q] * 3 + 2]]);
    const u = P[1].map((x, q) => x - P[0][q]); const w = P[2].map((x, q) => x - P[0][q]);
    const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const c = P[0].map((x, q) => (x + P[1][q] + P[2][q]) / 3 - s / 2);
    if (nrm[0] * c[0] + nrm[1] * c[1] + nrm[2] * c[2] < 0) { const x = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = x; }
  }
  return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) };
}
const edgeOpen = (tri, n) => { const c = new Map(); for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) { const a = tri[t + k]; const b = tri[t + (k + 1) % 3]; const key = a < b ? a * n + b : b * n + a; c.set(key, (c.get(key) ?? 0) + 1); } let open = 0; let multi = 0; c.forEach((v) => { if (v === 1) open++; else if (v > 2) multi++; }); return { open, multi }; };

// 1) esfera de ~20k triángulos → 5k: cerrada, volumen y radio conservados
{
  const m = sphere(70);
  const T = m.triangles.length / 3;
  assert.ok(T > 9000);
  const progress = [];
  const t0 = performance.now();
  const r = await simplifyMesh(m, 3000, { onProgress: (p) => progress.push(p) });
  const ms = performance.now() - t0;
  assert.ok(r.reached && r.after <= 3000, `llegó al objetivo: ${r.after}`);
  assert.equal(r.triangles.length / 3, r.after);
  const nv = r.vertices.length / 3;
  const e = edgeOpen(r.triangles, nv);
  assert.equal(e.open, 0, 'sigue cerrada'); assert.equal(e.multi, 0, 'sigue siendo variedad');
  const dv = Math.abs(meshVolume(r.vertices, r.triangles) - meshVolume(m.vertices, m.triangles)) / meshVolume(m.vertices, m.triangles);
  assert.ok(dv < 0.01, `volumen cambia ${(dv * 100).toFixed(2)} %`);
  let worst = 0; for (let i = 0; i < nv; i++) worst = Math.max(worst, Math.abs(Math.hypot(r.vertices[i * 3], r.vertices[i * 3 + 1], r.vertices[i * 3 + 2]) - 100));
  assert.ok(worst < 1, `los vértices siguen sobre la esfera (desvío ${worst.toFixed(3)} mm)`);
  assert.ok(r.maxError < 1.5, `error informado ${r.maxError}`);
  assert.ok(progress.length > 1 && progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress.at(-1) === 1, 'progreso creciente hasta 1');
  console.log(`  ${T} → ${r.after} tri en ${ms.toFixed(0)} ms, Δvolumen ${(dv * 100).toFixed(3)} %, error ${r.maxError.toFixed(3)} mm`);
}
// 2) caja con caras muy subdivididas: colapsa a pocos triángulos sin cambiar la forma (cuádrica nula en planos)
{
  const m = box(12);
  const T = m.triangles.length / 3;
  const r = await simplifyMesh(m, 60);
  assert.ok(r.after <= 60, `${T} → ${r.after}`);
  const nv = r.vertices.length / 3;
  assert.equal(edgeOpen(r.triangles, nv).open, 0);
  const vol = meshVolume(r.vertices, r.triangles);
  assert.ok(Math.abs(vol - 1e6) / 1e6 < 1e-3, `volumen de la caja ${vol}`);
  let min = [1e9, 1e9, 1e9]; let max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], r.vertices[i * 3 + k]); max[k] = Math.max(max[k], r.vertices[i * 3 + k]); }
  assert.deepEqual(min.map((v) => Math.round(v) || 0), [0, 0, 0]); assert.deepEqual(max.map((v) => Math.round(v) || 0), [100, 100, 100]);
  assert.ok(r.maxError < 1e-3, 'colapsar planos no cuesta error');
}
// 3) ya está por debajo del objetivo → devuelve igual; cancelación
{
  const m = sphere(10);
  const same = await simplifyMesh(m, 99999);
  assert.equal(same.after, m.triangles.length / 3);
  const signal = { cancelled: false };
  const p = simplifyMesh(sphere(60), 500, { signal, onProgress: () => { signal.cancelled = true; } });
  await assert.rejects(p, /Cancelado/);
}
// 4) malla abierta (casquete): el borde se conserva
{
  const m = sphere(30);
  const keep = []; for (let t = 0; t < m.triangles.length; t += 3) { const z = (m.vertices[m.triangles[t] * 3 + 2] + m.vertices[m.triangles[t + 1] * 3 + 2] + m.vertices[m.triangles[t + 2] * 3 + 2]) / 3; if (z > 0) keep.push(m.triangles[t], m.triangles[t + 1], m.triangles[t + 2]); }
  const cap = { vertices: m.vertices, triangles: Uint32Array.from(keep) };
  const r = await simplifyMesh(cap, 400);
  let onRim = 0; for (let i = 0; i < r.vertices.length / 3; i++) if (Math.abs(r.vertices[i * 3 + 2]) < 1e-3) onRim++;
  assert.ok(onRim >= 6, `el borde (z = 0) sigue con vértices (${onRim})`);
  for (let i = 0; i < r.vertices.length / 3; i++) assert.ok(r.vertices[i * 3 + 2] > -0.5, 'el casquete no se hunde');
}
console.log('meshSimplify ok');
