import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { meshEdgesShape, meshShape } from '../src/kernel/batchMesh.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { encodeMesh } from '../src/core/meshCodec.js';

const rep = await loadKernel();
const oc = rep.getOC();
const mb = () => oc.wasmMemory.buffer.byteLength / 1048576;
function sphere(n, r = 100) {
  const rows = n; const cols = 2 * n; const v = [0, 0, r]; const t = [];
  for (let i = 1; i < rows; i++) for (let j = 0; j < cols; j++) { const th = Math.PI * i / rows; const ph = 2 * Math.PI * j / cols; v.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)); }
  v.push(0, 0, -r); const south = v.length / 3 - 1; const ring = (i, j) => 1 + (i - 1) * cols + (j % cols);
  for (let j = 0; j < cols; j++) t.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rows - 1; i++) for (let j = 0; j < cols; j++) { const a = ring(i, j); const b = ring(i, j + 1); const c = ring(i + 1, j); const d = ring(i + 1, j + 1); t.push(a, c, b, b, c, d); }
  for (let j = 0; j < cols; j++) t.push(south, ring(rows - 1, j + 1), ring(rows - 1, j));
  return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) };
}

// sólido de ~2 000 caras (cosido desde una malla)
const part = commands.addFeature(createPart('esfera'), 'mesh', { file: 'e.stl', mesh: encodeMesh(sphere(25)) });
const built = buildPart(rep, part);
const shape = built.shape;
const opts = { tolerance: 0.05, angularTolerance: 0.1 };
const faces = shape.faces.length;
assert.ok(faces > 1500, `${faces} caras`);

// 1) por tandas == de una vez (mismos vértices, normales e índices)
const direct = shape.mesh(opts);
const batched = meshShape(shape, opts, { batch: 150, threshold: 100 });
assert.equal(batched.triangles.length, direct.triangles.length);
assert.deepEqual(batched.vertices, direct.vertices);
assert.deepEqual(batched.normals, direct.normals);
assert.deepEqual(batched.triangles, direct.triangles);
assert.equal(batched.faceGroups.length, direct.faceGroups.length);
assert.deepEqual(batched.faceGroups.map((g) => g.faceId), direct.faceGroups.map((g) => g.faceId));
assert.deepEqual(batched.faceGroups.map((g) => g.start), direct.faceGroups.map((g) => g.start));

// 2) aristas por tandas == de una vez (misma polilínea por arista)
const edgesDirect = shape.meshEdges(opts);
const edgesBatched = meshEdgesShape(shape, opts, { batch: 300, threshold: 100 });
assert.equal(edgesBatched.lines.length, edgesDirect.lines.length);
const polyById = (e) => { const map = new Map(); e.edgeGroups.forEach((g) => { const pts = []; for (let i = 0; i < g.count; i++) pts.push(...e.lines.slice((g.start + i) * 3, (g.start + i) * 3 + 3).map((x) => Math.round(x * 1e4))); map.set(g.edgeId, pts.join(',')); }); return map; };
const a = polyById(edgesDirect); const b = polyById(edgesBatched);
assert.equal(a.size, b.size);
for (const [id, pts] of a) assert.equal(b.get(id), pts, `arista ${id}`);

// 3) extractMesh (con el umbral por defecto) sigue entregando el mismo resultado y no revienta la memoria
const data = extractMesh(shape);
assert.equal(data.triangles.length / 3, direct.triangles.length / 3);
assert.ok(data.edges.length > 1000);

// 4) la memoria WASM: mallar un sólido grande por tandas no dispara el pico (antes ~130 KB por cara de memoria transitoria)
const before = mb();
const big = commands.addFeature(createPart('esfera grande'), 'mesh', { file: 'g.stl', mesh: encodeMesh(sphere(40)) });
const builtBig = buildPart(rep, big);
const afterBuild = mb();
extractMesh(builtBig.shape);
const growth = mb() - afterBuild;
assert.ok(growth < 150, `mallar ${builtBig.shape.faces.length} caras hizo crecer la memoria WASM ${growth.toFixed(0)} MB (antes ≈ 130 KB por cara)`);
console.log(`batchMesh ok · ${faces} caras idénticas · mallar ${builtBig.shape.faces.length} caras: +${growth.toFixed(0)} MB (base ${before.toFixed(0)} → ${afterBuild.toFixed(0)} tras construir)`);
