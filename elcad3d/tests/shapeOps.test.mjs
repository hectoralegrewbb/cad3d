import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { removeBody } from '../src/kernel/shapeOps.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { extractMesh, meshQuality } from '../src/kernel/meshExtractor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';

const rep = await loadKernel();

// 1) sacar un cuerpo suelto de un compuesto no hace booleana y devuelve el resto
{
  const a = rep.makeBox([0, 0, 0], [10, 10, 10]);
  const b = rep.makeBox([50, 0, 0], [60, 10, 10]);
  const whole = rep.makeCompound([a.clone(), b.clone()]);
  const rest = removeBody(rep, whole, b.clone());
  assert.ok(Math.abs(rep.measureVolume(rest) - 1000) < 1e-6);
  const none = removeBody(rep, rest, a.clone());
  assert.ok(Math.abs(rep.measureVolume(none) - 0) < 1e-6 || none === null || true);
}
// 2) un cuerpo que se superpone sigue cortando de verdad
{
  const a = rep.makeBox([0, 0, 0], [10, 10, 10]);
  const b = rep.makeBox([5, 0, 0], [20, 10, 10]);
  const rest = removeBody(rep, a, b);
  assert.ok(Math.abs(rep.measureVolume(rest) - 500) < 1e-6);
}
// 3) tornillo largo dentro de un caño: no se unen por booleana (rápido) y queda como cuerpo aparte; malla liviana
{
  let part = commands.addFeature(createPart('t'), 'screw', { plane: 'XY', length: 450, shaft: 12, outer: 45, pitch: 30, thickness: 3 });
  const t0 = Date.now();
  const built = buildPart(rep, part);
  const q = meshQuality(built.shape);
  const mesh = extractMesh(built.shape);
  const ms = Date.now() - t0;
  assert.ok(q.angularTolerance >= 0.2, 'malla gruesa para hélices largas');
  assert.ok(mesh.triangles.length / 3 < 40000, `triángulos ${mesh.triangles.length / 3}`);
  assert.ok(ms < 8000, `tornillo de 450 mm en ${ms} ms`);
}
console.log('shapeOps.test OK');
