import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { screwFeatureSpecs } from '../src/kernel/screwGeometry.js';

const rep = await loadKernel();
const make = (patch) => {
  const part = commands.addFeature(createPart('Tornillo'), 'screw', patch);
  return part;
};
const bounds = (shape) => {
  const [min, max] = shape.boundingBox.bounds;
  return max.map((v, i) => Math.round((v - min[i]) * 10) / 10);
};
const base = { length: 120, shaft: 12, outer: 40, pitch: 30, thickness: 2, starts: 1 };
// espesor del filete medido en el eje (axial): sección ≈ (espesor/paso)·π(R²−r²) por entrada
const expected = (p) => Math.PI * (p.shaft / 2) ** 2 * p.length + (p.starts ?? 1) * (p.thickness / p.pitch) * Math.PI * ((p.outer / 2) ** 2 - (p.shaft / 2) ** 2) * (p.length - p.thickness);

// 1) una entrada, 4 vueltas: volumen ≈ eje + filete
{
  const result = buildPart(rep, make(base));
  assert.equal(result.results.screw1.status, 'ok', result.results.screw1.error);
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - expected(base)) / expected(base) < 0.03, `volumen ${volume} vs ${expected(base)}`);
  assert.deepEqual(bounds(result.shape), [40, 40, 120]);
  assert.equal(result.solids, 1);
}
// 2) dos entradas, mano izquierda, eje X
{
  const patch = { ...base, starts: 2, left: true, plane: 'YZ' };
  const result = buildPart(rep, make(patch));
  assert.equal(result.results.screw1.status, 'ok', result.results.screw1.error);
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - expected(patch)) / expected(patch) < 0.04, `volumen ${volume} vs ${expected(patch)}`);
  assert.deepEqual(bounds(result.shape), [120, 40, 40]);
}
// 3) para el plano: envolvente cilíndrica
{
  const result = buildPart(rep, make(base), { forDrawing: true });
  assert.equal(result.results.screw1.status, 'ok');
  assert.deepEqual(bounds(result.shape), [40, 40, 120]);
}
// 4) validación
{
  const result = buildPart(rep, make({ ...base, outer: 10 }));
  assert.equal(result.results.screw1.status, 'error');
  assert.match(result.results.screw1.error, /exterior/);
}
// 5) especificación para el motor/partículas
{
  const [spec] = screwFeatureSpecs(make({ ...base, plane: 'XZ', x: 5 }), {});
  assert.equal(spec.length, 120);
  assert.equal(spec.pivot[0], 5);
  assert.equal(Math.abs(spec.axis[1]), 1);
}
console.log('screw.test OK');
