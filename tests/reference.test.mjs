import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { sketchReference, simplify } from '../src/core/sketchReference.js';
import { collectGeometry, computeSnap } from '../src/ui/sketchSnap.js';
import { planeFrame } from '../src/kernel/planes.js';

const rep = await loadKernel();
const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

// Marcos de plano puros = los de replicad
for (const plane of ['XY', 'XZ', 'YZ']) {
  const base = rep.makePlane(plane, 7);
  const frame = planeFrame(null, { plane, offset: 7 }, {});
  const clean = (v) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
  assert.deepEqual(clean(frame.origin), clean(base.origin.toTuple()), plane);
  assert.deepEqual(clean(frame.xDir), clean(base.xDir.toTuple()), plane);
  assert.deepEqual(clean(frame.normal), clean(base.zDir.toTuple()), plane);
}
assert.equal(simplify([[0, 0], [1, 0], [2, 0], [3, 0]]).length, 2);

// Cubo Ø20 x 22 (boceto XY) y un boceto nuevo sobre Alzado (XZ)
let part = createPart('ref');
part = commands.addFeature(part, 'sketch', { plane: 'XY' });
const base = part.features[0].id;
part = commands.addEntity(part, base, { t: 'circle', x: 0, y: 0, d: 20 });
part = commands.addFeature(part, 'extrude', { sketch: base, depth: 22 });
part = commands.addFeature(part, 'sketch', { plane: 'XZ', offset: 0 });
const second = part.features.filter((f) => f.type === 'sketch')[1].id;
const built = buildPart(rep, part);
const raw = built.shape.mesh({ tolerance: 0.03, angularTolerance: 0.1 });
const mesh = { vertices: raw.vertices, triangles: raw.triangles };

{
  const ref = sketchReference({ part, params: built.params, sketchId: second, mesh });
  const solid = ref.polylines.filter((line) => line.kind === 'solid');
  assert.equal(solid.length, 1, 'un contorno de la pieza');
  const xs = solid[0].points.map((p) => p[0]);
  const ys = solid[0].points.map((p) => p[1]);
  // sección por y=0 del cilindro: rectángulo x ∈ [-10, 10], z (v) ∈ [0, 22]
  assert.ok(near(Math.min(...xs), -10) && near(Math.max(...xs), 10) && near(Math.min(...ys), 0) && near(Math.max(...ys), 22), JSON.stringify([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]));
  assert.equal(solid[0].points.length, 4, 'rectángulo simplificado a 4 vértices');
  // el boceto circular (en XY) se ve de canto en XZ: una línea de −10 a 10 a v = 0
  const sketchLine = ref.polylines.find((line) => line.kind === 'sketch');
  assert.ok(sketchLine && sketchLine.points.length === 2 && near(Math.abs(sketchLine.points[0][0] - sketchLine.points[1][0]), 20) && near(sketchLine.points[0][1], 0));
  // los imanes toman los vértices de la referencia
  const geometry = collectGeometry([], ref);
  const snap = computeSnap([9.8, 21.7], geometry, 5, {});
  assert.ok(snap.kind === 'vertex' && near(snap.x, 10) && near(snap.y, 22), JSON.stringify(snap));
  assert.match(snap.label, /referencia/);
  // y se puede apagar
  assert.equal(sketchReference({ part, params: built.params, sketchId: second, mesh, showSolid: false }).polylines.filter((l) => l.kind === 'solid').length, 0);
  assert.equal(sketchReference({ part, params: built.params, sketchId: second, mesh, showSketches: false }).polylines.filter((l) => l.kind === 'sketch').length, 0);
}

// Plano rotado: el corte por un plano XZ girado 90° sobre Z (= YZ) muestra el mismo ancho
{
  let rotated = commands.updateFeature(part, second, { rot: { axis: 'z', angle: 90, px: 0, py: 0, pz: 0 } });
  const ref = sketchReference({ part: rotated, params: built.params, sketchId: second, mesh });
  const solid = ref.polylines.find((line) => line.kind === 'solid');
  const xs = solid.points.map((p) => p[0]);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 20), 'ancho 20 en el plano girado');
}

// Mismo plano: las entidades del otro boceto se usan exactas (centro y cuadrantes)
{
  let same = createPart('same');
  same = commands.addFeature(same, 'sketch', { plane: 'XY' });
  const a = same.features[0].id;
  same = commands.addEntity(same, a, { t: 'circle', x: 5, y: 5, d: 8 });
  same = commands.addFeature(same, 'sketch', { plane: 'XY' });
  const b = same.features.filter((f) => f.type === 'sketch')[1].id;
  const ref = sketchReference({ part: same, params: {}, sketchId: b });
  assert.equal(ref.entities.length, 1);
  const geometry = collectGeometry([], ref);
  const snap = computeSnap([5.1, 4.9], geometry, 5, {});
  assert.ok(snap.kind === 'center' && near(snap.x, 5) && near(snap.y, 5) && /referencia/.test(snap.label));
}
console.log('OK papel cebolla: referencia de bocetos y corte de la pieza');
