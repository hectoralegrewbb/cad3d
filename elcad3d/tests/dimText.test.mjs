import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { dimensionText } from '../src/drawing/dimensions.js';
import { materials, massKg } from '../src/drawing/features3d.js';

const rep = await loadKernel();
let part = createPart('txt');
part = commands.addFeature(part, 'sketch', { plane: 'XY' });
const base = part.features[0].id;
part = commands.addEntity(part, base, { t: 'rect', x: 0, y: 0, w: 40, h: 20 });
part = commands.addFeature(part, 'extrude', { sketch: base, depth: 10 });
const build = (p) => buildDrawing(rep, buildPart(rep, p).shape, p);

assert.equal(dimensionText({ type: 'linear', orientation: 'h', a: [0, 0], b: [40, 0], prefix: '2× ', suffix: ' H7' }), '2× 40 H7');
assert.equal(dimensionText({ type: 'linear', orientation: 'h', a: [0, 0], b: [40, 0], text: 'X' }), 'X');

const first = build(part);
const dim = first.dims.find((d) => d.auto && d.type === 'linear');
assert.ok(dim, 'hay cota automática');
let next = commands.setDimField({ ...part }, dim, { prefix: '2× ', suffix: ' H7' });
part = { ...part, drawing: next.drawing };
let again = build(part).dims.find((d) => d.key === dim.key);
assert.ok(dimensionText(again).startsWith('2× ') && dimensionText(again).endsWith(' H7'), dimensionText(again));
// el texto sobrevive a "reordenar cotas"
part = { ...part, drawing: commands.resetDimPositions(part).drawing };
again = build(part).dims.find((d) => d.key === dim.key);
assert.ok(dimensionText(again).includes('H7'), 'texto conservado al reordenar');
// vaciar los campos borra el override
part = { ...part, drawing: commands.setDimField(part, dim, { prefix: '', suffix: '' }).drawing };
assert.equal(Object.keys(part.drawing.dimOverrides ?? {}).length, 0);
assert.equal(dimensionText(build(part).dims.find((d) => d.key === dim.key)), dimensionText(dim));

// Materiales nuevos
['viton', 'pvc', 'plastico', 'ptfe', 'pe100', 'pp', 'pom', 'abs', 'acrilico', 'nbr'].forEach((id) => assert.ok(materials[id]?.density > 0 && materials[id].color, id));
assert.ok(massKg(1e6, 'viton') > 1.8);
console.log('dimText OK');
