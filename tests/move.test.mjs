import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { buildAssembly, safeTravel } from '../src/kernel/assemblyBuilder.js';
import * as projects from '../src/core/projectModel.js';

const rep = await loadKernel();
let part = createPart('m');
part = commands.addFeature(part, 'sketch', { plane: 'XY' });
const s1 = part.features.at(-1).id;
part = commands.addEntity(part, s1, { t: 'rect', x: 0, y: 0, w: 40, h: 40, centered: true });
part = commands.addFeature(part, 'extrude', { sketch: s1, depth: 10 });
const e1 = part.features.at(-1).id;
part = commands.addFeature(part, 'sketch', { plane: 'XY', offset: 10 });
const s2 = part.features.at(-1).id;
part = commands.addEntity(part, s2, { t: 'circle', x: 0, y: 0, d: 10 });
part = commands.addFeature(part, 'extrude', { sketch: s2, depth: 20 });
const e2 = part.features.at(-1).id;
part = commands.addFeature(part, 'gear', { z: 20, m: 2, width: 6, bore: 0 });
const g1 = part.features.at(-1).id;
const box = (p) => buildPart(rep, p).shape.boundingBox.bounds;
const base = box(part);
// mover solo el eje 15 mm en X y la corona 5 en Z
const moved = commands.translateFeatures(commands.translateFeatures(part, [e2], [15, 0, 0]), [g1], [0, 0, 5]);
const b = box(moved);
assert.ok(Math.abs(b[1][0] - (base[1][0] + 0)) < 1e-6 || b[1][0] >= base[1][0], 'bbox X');
assert.ok(Math.abs(b[1][2] - Math.max(base[1][2], 5 + 6 /* z del engranaje: 0..6 movido a 5..11 */)) < 1e-6, `z ${b[1][2]}`);
// varias a la vez con un solo comando, y acumulativo
const both = commands.translateFeatures(commands.translateFeatures(part, [e1, e2], [0, 7, 0]), [e1, e2], [0, 3, 0]);
assert.deepEqual(both.features.find((f) => f.id === e1).move, [0, 10, 0]);
const bb = box(both);
assert.ok(Math.abs(bb[1][1] - 30) < 1e-6, `y ${bb[1][1]}`);
// absoluto y reinicio
const reset = commands.translateFeatures(both, [e1, e2], [0, 0, 0], true);
assert.deepEqual(reset.features.find((f) => f.id === e2).move, [0, 0, 0]);
assert.deepEqual(box(reset), base);
// el eje movido 15 en X sale de la placa (bbox X crece a 15+5=20 = placa 20) y 30 lo saca
const out = box(commands.translateFeatures(part, [e2], [30, 0, 0]));
assert.ok(Math.abs(out[1][0] - 35) < 1e-6, `x ${out[1][0]}`);
// ids ajenos/sketch no cambian el estado
assert.equal(commands.translateFeatures(part, [s1], [1, 1, 1]), part);
// una operación bloqueada por un error no crashea
const bad = commands.translateFeatures(part, [e2], [Number.NaN, 0, 0]);
assert.ok(box(bad));

// plano: mover una vista desplaza sus primitivas y sus cotas; reubicar la devuelve
const shape = buildPart(rep, part).shape;
const plain = buildDrawing(rep, shape, part);
const movedPart = commands.moveView(commands.moveView(part, 'front', [10, 5]), 'front', [2, 0]);
assert.deepEqual(movedPart.drawing.viewOffsets.front, [12, 5]);
const shiftedDrawing = buildDrawing(rep, shape, movedPart);
const pa = plain.layout.placements.find((x) => x.id === 'front');
const pb = shiftedDrawing.layout.placements.find((x) => x.id === 'front');
assert.ok(Math.abs(pb.ox - pa.ox - 12) < 1e-9 && Math.abs(pb.oy - pa.oy - 5) < 1e-9);
assert.equal(shiftedDrawing.layout.placements.find((x) => x.id === 'top').ox, plain.layout.placements.find((x) => x.id === 'top').ox, 'la otra vista no se mueve');
const firstPoly = (d) => d.primitives.find((q) => q.k === 'poly' && q.view === 'front').points[0];
assert.ok(Math.abs(firstPoly(shiftedDrawing)[0] - firstPoly(plain)[0] - 12) < 1e-6);
const dimOf = (d) => d.primitives.find((q) => q.dim && q.view === 'front' && q.k === 'line');
assert.ok(dimOf(plain) && Math.abs(dimOf(shiftedDrawing).x1 - dimOf(plain).x1 - 12) < 1e-6 || Math.abs(dimOf(shiftedDrawing).y1 - dimOf(plain).y1 - 5) < 1e-6, 'las cotas acompañan');
assert.equal(commands.moveView(movedPart, 'front', [-12, -5]).drawing.viewOffsets.front, undefined, 'volver a 0 limpia');
assert.deepEqual(commands.resetViewPositions(movedPart).drawing.viewOffsets, {});

// conjunto: empujar con colisión (bloque 20×20×10 que avanza hacia otro que está a 30 mm)
const block = (name) => {
  let q = createPart(name);
  q = commands.addFeature(q, 'sketch', { plane: 'XY' });
  const sk = q.features.at(-1).id;
  q = commands.addEntity(q, sk, { t: 'rect', x: 0, y: 0, w: 20, h: 20, centered: true });
  return commands.addFeature(q, 'extrude', { sketch: sk, depth: 10 });
};
let project = projects.createProject(block('A'));
project = projects.addPart(project, block('B'));
project = projects.addInstance(project, 'p1', [0, 0, 0]);
project = projects.addInstance(project, 'p2', [50, 0, 0]); // cara a cara: hueco de 30 mm
const asm = buildAssembly(rep, project);
assert.equal(asm.interferences.length, 0);
const run = (ids, delta) => safeTravel(rep, asm, ids, delta);
const free = run(['i1'], [30, 0, 0]);
assert.ok(free.t > 0.99 && !free.blockedBy, `30 mm justos no chocan (t=${free.t})`);
const hit = run(['i1'], [50, 0, 0]);
assert.equal(hit.blockedBy, 'i2');
assert.ok(Math.abs(hit.t * 50 - 30) < 0.5, `frena al tocar: ${hit.t * 50} mm`);
assert.equal(run(['i1'], [0, 50, 0]).blockedBy, null, 'lateral libre');
assert.equal(run(['i1'], [-50, 0, 0]).blockedBy, null, 'alejándose es libre');
assert.equal(run(['i1', 'i2'], [50, 0, 0]).blockedBy, null, 'el grupo se mueve junto');
asm.instances.forEach((inst) => inst.shape.delete?.());
console.log('move OK');
