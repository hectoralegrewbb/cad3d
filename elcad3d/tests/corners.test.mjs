import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { meshVolume } from '../src/drawing/features3d.js';
import { applyCorners, entityPolygon, resolveEntity } from '../src/kernel/geometry2d.js';

const rep = await loadKernel();
const volume = (shape) => meshVolume(shape.mesh({ tolerance: 0.01, angularTolerance: 0.05 }));
const make = (entityPatch) => {
  let part = createPart('c');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const id = part.features[0].id;
  part = commands.addEntity(part, id, { t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: true, ...entityPatch });
  part = commands.addFeature(part, 'extrude', { sketch: id, depth: 10 });
  return buildPart(rep, part);
};

const plain = make({});
assert.ok(Math.abs(volume(plain.shape) - 8000) < 1, 'caja 40×20×10');
// una sola esquina redondeada R5: quita (1 − π/4)·25 mm² × 10
const one = make({ corners: [{ r: 0, c: 0 }, { r: 5, c: 0 }, { r: 0, c: 0 }, { r: 0, c: 0 }] });
assert.equal(one.results.extrude1.status, 'ok');
assert.ok(Math.abs(8000 - volume(one.shape) - (1 - Math.PI / 4) * 25 * 10) < 0.5, `R5 en una esquina (${volume(one.shape)})`);
// chaflán C4 en dos esquinas: quita 2 × 8 × 10
const chamfered = make({ corners: [{ r: 0, c: 4 }, { r: 0, c: 0 }, { r: 0, c: 4 }, { r: 0, c: 0 }] });
assert.ok(Math.abs(8000 - volume(chamfered.shape) - 2 * 8 * 10) < 0.5, 'C4 en dos esquinas opuestas');
// la esquina correcta: ↗ (x=+20, y=+10) redondeada no toca ↙
const entity = resolveEntity({ t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: true, corners: [{}, {}, { r: 5 }, {}] }, {});
const polygon = entityPolygon(entity);
assert.ok(!polygon.some((p) => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.y - 10) < 1e-6), 'esquina ↗ redondeada');
assert.ok(polygon.some((p) => Math.abs(p.x + 20) < 1e-6 && Math.abs(p.y + 10) < 1e-6), 'esquina ↙ intacta');
// no cabe → error claro
const bad = make({ corners: [{ r: 30, c: 0 }, {}, {}, {}] });
assert.equal(bad.results.extrude1.status, 'error');
assert.ok(/no cabe/.test(bad.results.extrude1.error));
// polilínea: vértice puntual (triángulo recto, chaflán en el vértice 2)
const tri = applyCorners([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }], [{}, { c: 3 }, {}]);
assert.equal(tri.length, 4);
console.log('corners OK');
