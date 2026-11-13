import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { meshVolume } from '../src/drawing/features3d.js';
import { hasRealThread, threadSpec } from '../src/kernel/threadGeometry.js';
import { withDraftThreads } from '../src/kernel/partBuilder.js';

const rep = await loadKernel();
const volume = (shape) => meshVolume(shape.mesh({ tolerance: 0.02, angularTolerance: 0.1 }));

// Cilindro M8 de 20 de largo sobre Z; rosca de z=4 a z=16
let part = createPart('rosca');
part = commands.addFeature(part, 'sketch', { plane: 'XY' });
const sk = part.features[0].id;
part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 8 });
part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 20 });
part = commands.addFeature(part, 'thread', { d: 8, from: 4, to: 16 });
const tid = part.features[part.features.length - 1].id;

const spec = threadSpec(part.features.find((f) => f.id === tid), {});
assert.equal(spec.row.name, 'M8');
assert.ok(Math.abs(spec.minor - (8 - 1.2269 * 1.25)) < 1e-6);
assert.deepEqual(spec.p0, [0, 0, 4]);
assert.deepEqual(spec.p1, [0, 0, 16]);
assert.ok(/M8×1,25 L=12/.test(spec.label), spec.label);

// cosmética: no cambia el sólido
const plain = buildPart(rep, part);
assert.equal(plain.results[tid].status, 'ok');
const v0 = volume(plain.shape);

// real: quita material solo dentro del tramo
const t0 = Date.now();
const real = buildPart(rep, commands.updateFeature(part, tid, { real: true }));
assert.equal(real.results[tid].status, 'ok', real.results[tid].error);
assert.equal(real.solids, 1);
const v1 = volume(real.shape);
console.log('rosca real ms', Date.now() - t0, 'volumen', Math.round(v0), '→', Math.round(v1));
assert.ok(v1 < v0 - 5 && v1 > v0 * 0.7, 'quita material');
const [lo, hi] = real.shape.boundingBox.bounds;
assert.ok(Math.abs(hi[2] - 20) < 0.01 && Math.abs(lo[2]) < 0.01, 'no se sale del cuerpo');

// borrador: con el filete real activo, el modo borrador deja la rosca cosmética (rápido) y el modo completo corta el filete
{
  const realPart = commands.updateFeature(part, tid, { real: true });
  assert.equal(hasRealThread(realPart), true);
  assert.equal(hasRealThread(part), false);
  assert.equal(hasRealThread(commands.updateFeature(realPart, tid, { suppressed: true })), false);
  const t1 = Date.now();
  const draft = withDraftThreads(true, () => buildPart(rep, realPart));
  const draftMs = Date.now() - t1;
  assert.equal(draft.results[tid].status, 'ok');
  assert.ok(Math.abs(volume(draft.shape) - v0) < 1e-6 * v0 + 1e-3, 'el borrador no corta el filete');
  assert.ok(draftMs < 800, `el borrador debe ser rápido (${draftMs} ms)`);
  const full = withDraftThreads(false, () => buildPart(rep, realPart));
  assert.ok(volume(full.shape) < v0 - 5, 'el modo completo sí corta el filete');
  assert.equal(globalThis.__elcadDraftThreads, undefined, 'el interruptor se restaura');
}

// plano: cota del tramo roscado y líneas finas
{
  const { buildDrawing } = await import('../src/drawing/buildDrawing.js');
  const d = buildDrawing(rep, plain.shape, part);
  const callouts = d.dims.filter((dim) => /M8×1,25 L=12/.test(dim.text ?? ''));
  assert.ok(callouts.length >= 1, `cota de rosca: ${d.dims.map((x) => x.text).join(' | ')}`);
  assert.ok(d.viewModels.some((v) => v.threadMarks.some((m) => m.mode === 'side')) && d.viewModels.some((v) => v.threadMarks.some((m) => m.mode === 'end')), 'marcas de rosca de costado y de frente');
  assert.ok(d.svg().includes('M8×1,25 L=12'));
}

// rosca especial Ø13×1,5
{
  const sp = threadSpec({ axis: 'z', cx: 0, cy: 0, from: 0, to: 15, internal: false, d: 13, thread: { on: true, type: 'X', size: 'auto', depth: '', pitch: '1,5' } }, {});
  assert.equal(sp.major, 13);
  assert.equal(sp.pitch, 1.5);
  assert.ok(/Ø13×1,5 L=15/.test(sp.label), sp.label);
}

// plano con filete real: no debe colgarse (usa la rosca cosmética)
{
  const { buildDrawing } = await import('../src/drawing/buildDrawing.js');
  const realPart = commands.updateFeature(part, tid, { real: true });
  const t = Date.now();
  const d = buildDrawing(rep, buildPart(rep, realPart).shape, realPart);
  assert.ok(Date.now() - t < 20000 && d.dims.some((dim) => /M8×1,25/.test(dim.text ?? '')), 'plano con filete real');
}

// Ø que no es rosca → error claro
const bad = buildPart(rep, commands.updateFeature(part, tid, { d: 8.3 }));
assert.equal(bad.results[tid].status, 'error');

// eje X: cilindro por revolución... usamos un agujero M6 en un bloque y rosca interna real sobre su eje (X, y=3, z=5)
let block = createPart('tuerca');
block = commands.addFeature(block, 'sketch', { plane: 'YZ' });
const bs = block.features[0].id;
block = commands.addEntity(block, bs, { t: 'rect', x: 0, y: 0, w: 30, h: 30, centered: true });
block = commands.addFeature(block, 'extrude', { sketch: bs, depth: 20 });
block = commands.addFeature(block, 'hole', { plane: 'YZ', x: 3, y: 5, d: 5, through: true });
block = commands.addFeature(block, 'thread', { axis: 'x', cx: 3, cy: 5, from: 4, to: 14, d: 6, internal: true, real: true });
const nid = block.features[block.features.length - 1].id;
const solidHole = buildPart(rep, { ...block, features: block.features.map((f) => (f.id === nid ? { ...f, real: false } : f)) });
const threaded = buildPart(rep, block);
assert.equal(threaded.results[nid].status, 'ok', threaded.results[nid].error);
const dv = volume(solidHole.shape) - volume(threaded.shape);
console.log('interna X: material quitado', Math.round(dv * 10) / 10);
assert.ok(dv > 3 && dv < 60, `quita material cerca del agujero (${dv})`);
// eje Y: cilindro M8 a lo largo de Y en (x=3, z=5)
{
  const { cutThread } = await import('../src/kernel/threadGeometry.js');
  const cyl = rep.makeCylinder(4, 20, [3, 0, 5], [0, 1, 0]);
  const sp = threadSpec({ axis: 'y', cx: 3, cy: 5, from: 4, to: 16, internal: false, d: 8, thread: { on: true, type: 'M', size: 'auto', depth: '' } }, {});
  const removed = volume(cyl) - volume(cutThread(rep, cyl, sp));
  assert.ok(removed > 100 && removed < 160, `eje Y (${removed})`);
}
console.log('thread OK');

// rosca real a lo largo de TODO el cuerpo (antes se daba por fallida) y tope de vueltas
{
  const whole = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 20, real: true }));
  assert.equal(whole.results[tid].status, 'ok', whole.results[tid].error);
  const long = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 100, real: true }));
  assert.equal(long.results[tid].status, 'error');
  assert.ok(/limitado a 40 vueltas/.test(long.results[tid].error), long.results[tid].error);
}

// chaflán en los extremos de la rosca (externa e interna)
{
  const vol = (shape) => meshVolume(shape.mesh({ tolerance: 0.01, angularTolerance: 0.05 }));
  // Ø8, de z=0 a z=20 (todo el cuerpo): chaflán c=1 en ambos extremos
  const body = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 20 }));
  const cham = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 20, chamferStart: 1, chamferEnd: 1 }));
  assert.equal(cham.results[tid].status, 'ok', cham.results[tid].error);
  // cada chaflán 45° con cateto 1 en el Ø nominal quita ≈ π·(r² − (r−1)²)·1/2... ≈ 2π·3.5·0.5
  const removed = vol(body.shape) - vol(cham.shape);
  assert.ok(removed > 15 && removed < 30, `chaflán externo quita ${removed}`);
  assert.equal(cham.solids, 1);
  // interna: avellanado en la boca de un agujero M6 en un bloque
  let blockPart = createPart('b');
  blockPart = commands.addFeature(blockPart, 'sketch', { plane: 'XY' });
  const id = blockPart.features[0].id;
  blockPart = commands.addEntity(blockPart, id, { t: 'rect', x: 0, y: 0, w: 30, h: 30, centered: true });
  blockPart = commands.addFeature(blockPart, 'extrude', { sketch: id, depth: 20 });
  blockPart = commands.addFeature(blockPart, 'hole', { plane: 'XY', x: 0, y: 0, d: 5, through: true });
  blockPart = commands.addFeature(blockPart, 'thread', { axis: 'z', d: 6, internal: true, from: 20, to: 8 });
  const tid2 = blockPart.features.at(-1).id;
  const plainBlock = buildPart(rep, blockPart);
  const mouth = buildPart(rep, commands.updateFeature(blockPart, tid2, { chamferStart: 0.8 }));
  assert.equal(mouth.results[tid2].status, 'ok', mouth.results[tid2].error);
  const taken = vol(plainBlock.shape) - vol(mouth.shape);
  assert.ok(taken > 3 && taken < 40, `avellanado quita ${taken}`);
  // cosmética en el plano: el chaflán es geometría real y también está con forDrawing
  const forDrawing = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 20, chamferStart: 1, real: true }), { forDrawing: true });
  assert.ok(Math.abs(vol(forDrawing.shape) - vol(cham.shape) - 7) < 15, 'forDrawing conserva el chaflán');
  // demasiado grande → error claro
  const huge = buildPart(rep, commands.updateFeature(part, tid, { from: 0, to: 20, chamferStart: 9 }));
  assert.equal(huge.results[tid].status, 'error');
  console.log('chaflán de rosca OK');
}
