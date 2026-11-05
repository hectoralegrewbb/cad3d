import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { libraryItems } from '../src/data/library/index.js';
import { meshVolume } from '../src/drawing/features3d.js';

// Cada pieza de la biblioteca debe construirse sin errores con sus valores por defecto, dar un sólido con volumen y, si declara
// `expect.bbox`, medir lo que dice (±tol). LIB_FILTER = texto del id o de la categoría para probar un subconjunto.
const rep = await loadKernel();
const filter = process.env.LIB_FILTER;
const items = libraryItems.filter((entry) => !filter || entry.id.includes(filter) || entry.category.includes(filter));
assert.ok(items.length > 0, 'no hay piezas que probar');
const ids = new Set();
let failures = 0;
const t0 = Date.now();
for (const entry of items) {
  assert.ok(!ids.has(entry.id), `id repetido: ${entry.id}`);
  ids.add(entry.id);
  const args = {};
  (entry.ask ?? []).forEach((question) => { args[question.name] = question.value; });
  const started = Date.now();
  try {
    const part = entry.build(args);
    const result = buildPart(rep, part);
    const errors = Object.entries(result.results ?? {}).filter(([, r]) => r.status === 'error').map(([id, r]) => `${id}: ${r.error}`);
    assert.equal(errors.length, 0, errors.join(' | '));
    assert.ok(result.shape, 'sin sólido');
    const box = result.shape.boundingBox.bounds;
    const size = [0, 1, 2].map((k) => box[1][k] - box[0][k]);
    assert.ok(size.every((v) => Number.isFinite(v) && v > 0), `caja inválida ${size}`);
    const volume = Math.abs(meshVolume(result.shape.mesh({ tolerance: 0.05, angularTolerance: 0.1 })));
    assert.ok(volume > 0, 'volumen nulo');
    if (entry.expect?.bbox) {
      const tol = entry.expect.tol ?? 0.5;
      entry.expect.bbox.forEach((want, k) => {
        if (want != null) assert.ok(Math.abs(size[k] - want) <= tol, `${'XYZ'[k]} mide ${size[k].toFixed(2)} y debía ser ${want}`);
      });
    }
    if (process.env.LIB_VERBOSE) console.log(`${entry.category} · ${entry.id}: ${size.map((v) => v.toFixed(1)).join('×')} · ${(volume / 1000).toFixed(1)} cm³ · ${Date.now() - started} ms`);
  } catch (error) {
    failures += 1;
    console.log(`✗ ${entry.category} · ${entry.id}: ${error.message}`);
  }
}
console.log(`biblioteca: ${items.length - failures}/${items.length} piezas ok · ${Date.now() - t0} ms`);
assert.equal(failures, 0, `${failures} piezas fallan`);
console.log('library ok');
