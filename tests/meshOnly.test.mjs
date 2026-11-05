import assert from 'node:assert/strict';
import { buildMeshOnlyData } from '../src/kernel/meshOnlyData.js';
import { encodeMesh } from '../src/core/meshCodec.js';
import { loadKernel } from '../src/kernel/occNode.js';
import { createKernelService } from '../src/kernel/kernelService.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { simplifyMesh } from '../src/core/meshSimplify.js';

const rep = await loadKernel();

// cubo de 10 mm (12 triángulos)
const cube = (() => {
  const v = []; for (const z of [0, 1]) for (const y of [0, 1]) for (const x of [0, 1]) v.push(x * 10, y * 10, z * 10);
  const q = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const t = []; q.forEach(([a, b, c, d]) => t.push(a, b, c, a, c, d));
  return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) };
})();

// 1) datos del visor: cubo → pliegues de 90° (12 aristas con ≥ 2 caras: 12), normales unitarias, escala/movimiento aplicados
{
  const data = buildMeshOnlyData(encodeMesh(cube), { scale: 2, move: [5, 0, 0] });
  assert.equal(data.triangles.length / 3, 12);
  assert.equal(data.edges.length, 12, 'las 12 aristas del cubo son pliegues');
  assert.deepEqual(data.bounds.size.map((v) => Math.round(v)), [20, 20, 20]);
  assert.equal(Math.round(data.bounds.min[0]), 5);
  for (let i = 0; i < data.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2]) - 1) < 1e-4);
  // cubo → 24 vértices (cada esquina se parte por pliegue: 3 normales) → shading plano correcto
  assert.equal(data.vertices.length / 3, 24);
}
// 2) esfera fina: normales suavizadas (sin partir vértices) y sin aristas de pliegue
function sphere(n, r = 50) {
  const rows = n; const cols = 2 * n; const v = [0, 0, r]; const t = [];
  for (let i = 1; i < rows; i++) for (let j = 0; j < cols; j++) { const th = Math.PI * i / rows; const ph = 2 * Math.PI * j / cols; v.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)); }
  v.push(0, 0, -r); const south = v.length / 3 - 1; const ring = (i, j) => 1 + (i - 1) * cols + (j % cols);
  for (let j = 0; j < cols; j++) t.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rows - 1; i++) for (let j = 0; j < cols; j++) { const a = ring(i, j); const b = ring(i, j + 1); const c = ring(i + 1, j); const d = ring(i + 1, j + 1); t.push(a, c, b, b, c, d); }
  for (let j = 0; j < cols; j++) t.push(south, ring(rows - 1, j + 1), ring(rows - 1, j));
  return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) };
}
{
  const s = sphere(40);
  const data = buildMeshOnlyData(encodeMesh(s), {});
  assert.equal(data.vertices.length, s.vertices.length, 'sin vértices duplicados en una superficie suave');
  assert.equal(data.edges.length, 0);
}
// 3) por el servicio del kernel: una malla de ~47 000 triángulos entra en modo «solo malla» sin pasar por el B-Rep
{
  const service = createKernelService(rep);
  const big = sphere(108); // ~46 000 triángulos
  const T = big.triangles.length / 3;
  assert.ok(T > 40000, `${T} triángulos`);
  let part = commands.addFeature(createPart('embudo'), 'mesh', { file: 'prueba.stl', mesh: encodeMesh(big), meshOnly: true });
  const progress = [];
  globalThis.__elcadProgress = (phase, fraction) => progress.push([phase, fraction]);
  const t0 = performance.now();
  const result = service.handle('build', { part });
  const ms = performance.now() - t0;
  globalThis.__elcadProgress = null;
  assert.equal(result.hasShape, true);
  assert.equal(result.meshOnly, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'meshonly');
  assert.equal(result.items[0].data.triangles.length / 3, T);
  assert.ok(ms < 5000, `modo solo malla: ${ms.toFixed(0)} ms para ${T} triángulos`);
  assert.equal(progress.length, 0, 'no pasa por el cosido');
  assert.ok(Math.abs(result.size[0] - 100) < 1);
  // resplit y las demás consultas no se rompen
  assert.equal(service.handle('resplit', { split: null }).items.length, 1);
  assert.throws(() => service.handle('drawing', { part }), /geometr/i);
  console.log(`  ${T} triángulos en modo solo malla: ${ms.toFixed(0)} ms`);
}
// 4) reducir y luego convertir en sólido (B-Rep) con progreso por fases
{
  const service = createKernelService(rep);
  const s = sphere(70);
  const reduced = await simplifyMesh(s, 2500);
  assert.ok(reduced.after <= 2500);
  const part = commands.addFeature(createPart('reducida'), 'mesh', { file: 'x.stl', mesh: encodeMesh(reduced) });
  const phases = [];
  globalThis.__elcadProgress = (phase, fraction, estimateMs, until) => phases.push({ phase, fraction, estimateMs, until });
  const t0 = performance.now();
  const result = service.handle('build', { part });
  const ms = performance.now() - t0;
  globalThis.__elcadProgress = null;
  assert.equal(result.hasShape, true);
  assert.equal(result.meshOnly, false);
  assert.equal(result.results[part.features[0].id].status, 'ok', JSON.stringify(result.results));
  const names = [...new Set(phases.map((p) => p.phase.replace(/ \(.*/, '')))];
  assert.deepEqual(names, ['Preparando la malla', 'Creando caras', 'Cosiendo caras', 'Uniendo caras planas']);
  const fr = phases.map((p) => p.fraction);
  assert.ok(fr.every((f, i) => i === 0 || f >= fr[i - 1] - 1e-9), 'el progreso nunca retrocede');
  assert.ok(fr.at(-1) < 1 && phases.at(-1).until > 0.9);
  console.log(`  ${reduced.after} triángulos → sólido en ${ms.toFixed(0)} ms (${phases.length} avisos de progreso)`);
}
console.log('meshOnly ok');
