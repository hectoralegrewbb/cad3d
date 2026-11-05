import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { gearSpec, gearOutline, centerDistance } from '../src/kernel/gearGeometry.js';
import { meshVolume } from '../src/drawing/features3d.js';

const rep = await loadKernel();
const make = (patch) => commands.addFeature(createPart('g'), 'gear', patch);

// datos: m=2, z=20, α=20°
const spec = gearSpec({ m: 2, z: 20, alpha: 20, shift: 0, width: 10, bore: 8 }, {});
assert.equal(spec.pitchDiameter, 40);
assert.equal(spec.outsideDiameter, 44);
assert.ok(Math.abs(spec.rootDiameter - 35) < 1e-9);
assert.ok(Math.abs(spec.baseDiameter - 40 * Math.cos(Math.PI / 9)) < 1e-9);
assert.equal(centerDistance(2, 20, 30), 50);
const radii = gearOutline(spec).map(([x, y]) => Math.hypot(x, y));
assert.ok(Math.abs(Math.max(...radii) - 22) < 1e-6 && Math.abs(Math.min(...radii) - 17.5) < 1e-6, 'radios del contorno');

// sólido: volumen entre el círculo de pie y el exterior, con el agujero
let t = Date.now();
const part = make({ m: 2, z: 20, width: 10, bore: 8 });
const built = buildPart(rep, part);
assert.equal(built.results.gear1.status, 'ok', built.results.gear1.error);
assert.equal(built.solids, 1);
const vol = meshVolume(built.shape.mesh({ tolerance: 0.01, angularTolerance: 0.05 }));
const lo = Math.PI * 17.5 ** 2 * 10 - Math.PI * 16 * 10;
const hi = Math.PI * 22 ** 2 * 10 - Math.PI * 16 * 10;
assert.ok(vol > lo && vol < hi, `volumen ${vol} entre ${lo} y ${hi}`);
const [bmin, bmax] = built.shape.boundingBox.bounds;
assert.ok(Math.abs(bmax[0] - bmin[0] - 44) < 0.1 && Math.abs(bmax[2] - 10) < 1e-6, 'caja 44×44×10');
console.log('gear z=20 build ms', Date.now() - t);

// plano: no se cuelga y marca el engranaje
t = Date.now();
const drawing = buildDrawing(rep, built.shape, part);
console.log('gear z=20 plano ms', Date.now() - t);
assert.ok(Date.now() - t < 20000, 'plano a tiempo');
assert.ok(drawing.svg().includes('m=2 z=20'), 'rótulo del engranaje en el plano');

// engranaje grande y helicoidal: el plano usa dientes rectos y avisa la hélice
const helical = make({ m: 3, z: 60, width: 20, bore: 20, helix: 15 });
const big = buildPart(rep, helical);
assert.equal(big.results.gear1.status, 'ok', big.results.gear1.error);
t = Date.now();
const sheet = buildDrawing(rep, big.shape, helical);
console.log('gear z=60 helicoidal plano ms', Date.now() - t);
assert.ok(sheet.svg().includes('hélice 15°'));

// estrés: mallas de engranajes enormes (antes se colgaban minutos)
for (const patch of [{ z: 100, helix: 30 }, { z: 200, m: 1, bore: 10 }]) {
  const stress = buildPart(rep, make(patch));
  assert.equal(stress.results.gear1.status, 'ok', stress.results.gear1.error);
  const t0 = Date.now();
  const data = extractMesh(stress.shape);
  const took = Date.now() - t0;
  console.log('malla', JSON.stringify(patch), took, 'ms,', data.edges.length, 'aristas');
  assert.ok(took < 15000, `malla a tiempo (${took} ms)`);
}

// errores claros
for (const [patch, re] of [[{ z: 3 }, /dientes/], [{ m: 0 }, /módulo/], [{ bore: 80 }, /agujero/], [{ shift: 3 }, /puntiagudos/]]) {
  const r = buildPart(rep, make(patch));
  assert.equal(r.results.gear1.status, 'error', JSON.stringify(patch));
  assert.ok(re.test(r.results.gear1.error), r.results.gear1.error);
}
// engranaje sobre otro plano y con cubo
assert.equal(buildPart(rep, make({ plane: 'YZ', m: 2, z: 20, width: 10, bore: 0, x: 5, y: 0 })).results.gear1.status, 'ok');
const hubbed = buildPart(rep, make({ m: 2, z: 20, width: 10, bore: 8, hub: 20, hubWidth: 6 }));
assert.equal(hubbed.results.gear1.status, 'ok', hubbed.results.gear1.error);
assert.ok(Math.abs(hubbed.shape.boundingBox.bounds[1][2] - 16) < 1e-6, 'alto con cubo');
console.log('gear OK');
