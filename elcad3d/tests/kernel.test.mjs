import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { evaluate } from '../src/core/expression.js';
import { nestingDepths, resolveEntity } from '../src/kernel/geometry2d.js';

const rep = await loadKernel();
const sizeOf = (shape) => {
  const [min, max] = shape.boundingBox.bounds;
  return max.map((v, i) => Math.round((v - min[i]) * 1000) / 1000);
};
const volumeOf = (shape) => Math.round(shape.mesh({ tolerance: 0.05, angularTolerance: 0.1 }).triangles.length);

// 1) expresiones
assert.equal(evaluate('D/2 + 1,5', { D: 20 }), 11.5);
assert.equal(evaluate('-(2+3)*2^2'), -20);
assert.throws(() => evaluate('X+1', {}), /desconocido/);
assert.throws(() => evaluate('1/0'), /cero/);
assert.throws(() => evaluate('process.exit()'), /Símbolo|desconocido/);

// 2) anidación par/impar
{
  const ents = [{ t: 'rect', x: 0, y: 0, w: 100, h: 100, centered: true }, { t: 'circle', x: 0, y: 0, d: 40 }, { t: 'circle', x: 0, y: 0, d: 10 }].map((e) => resolveEntity(e, {}));
  assert.deepEqual(nestingDepths(ents), [0, 1, 2]);
}

// 3) eje escalonado por revolución + chaflán + filete
let part = createPart('Eje');
part = commands.setParam(part, 'D1', 30);
part = commands.setParam(part, 'D2', 'D1 - 10');
part = commands.addFeature(part, 'sketch', { plane: 'XZ' });
const sk = part.features[0].id;
const pts = [[0, 0], ['D1/2', 0], ['D1/2', 40], ['D2/2', 40], ['D2/2', 70], [0, 70]];
pts.forEach(([x, y]) => (part = commands.addEntity(part, sk, { t: 'poly', pts: [] })));
part = { ...part, features: part.features.map((f) => (f.id === sk ? { ...f, entities: [{ id: 'p', t: 'poly', pts: pts.map(([x, y]) => ({ x, y, bulge: 0 })) }] } : f)) };
part = commands.addFeature(part, 'revolve', { sketch: sk, axis: 'y' });
let built = buildPart(rep, part);
assert.equal(built.results.revolve1.status, 'ok', built.results.revolve1.error);
assert.deepEqual(sizeOf(built.shape), [30, 30, 70], 'eje Ø30 x 70');
part = commands.addFeature(part, 'chamfer', { size: 1, selector: { kind: 'circles' } });
built = buildPart(rep, part);
assert.equal(built.results.chamfer1.status, 'ok', built.results.chamfer1.error);
// cambiar parámetro → se reconstruye
const changed = buildPart(rep, commands.setParam(part, 'D1', 40));
assert.deepEqual(sizeOf(changed.shape), [40, 40, 70]);
// error de expresión no tumba la app
const bad = buildPart(rep, commands.setParam(part, 'D2', 'D1 * Q'));
assert.ok(bad.paramErrors.D2 || bad.results.revolve1.status === 'error');

// 4) brida: extrusión de círculo con agujero central + 6 agujeros en PCD + filete
let flange = createPart('Brida');
flange = commands.addFeature(flange, 'sketch', { plane: 'XY' });
const fs = flange.features[0].id;
flange = commands.addEntity(flange, fs, { t: 'circle', x: 0, y: 0, d: 100 });
flange = commands.addEntity(flange, fs, { t: 'circle', x: 0, y: 0, d: 40 });
flange = commands.addFeature(flange, 'extrude', { sketch: fs, depth: 12 });
flange = commands.addFeature(flange, 'hole', { plane: 'XY', offset: 12, d: 9, count: 6, pcd: 75, through: true });
built = buildPart(rep, flange);
assert.equal(built.results.extrude1.status, 'ok', built.results.extrude1.error);
assert.equal(built.results.hole1.status, 'ok', built.results.hole1.error);
assert.deepEqual(sizeOf(built.shape), [100, 100, 12]);
const trisWithHoles = volumeOf(built.shape);
const noHoles = buildPart(rep, { ...flange, features: flange.features.filter((f) => f.type !== 'hole') });
assert.ok(trisWithHoles > volumeOf(noHoles.shape), 'los agujeros agregan caras');
const boreFaces = built.shape.faces.filter((face) => {
  const [min, max] = face.boundingBox.bounds;
  return face.geomType.startsWith('CYL') && Math.abs(max[0] - min[0] - 9) < 0.2 && Math.abs(max[1] - min[1] - 9) < 0.2 || face.geomType.startsWith('CYL') && Math.abs(max[0] - min[0] - 9) < 0.2 || face.geomType.startsWith('CYL') && Math.abs(max[1] - min[1] - 9) < 0.2;
});
assert.equal(boreFaces.length, 6, '6 agujeros Ø9 en la circunferencia');

// 5) selector "near" sobrevive a un cambio de parámetro
flange = commands.setParam(flange, 'T', 12);
flange = commands.updateFeature(flange, 'extrude1', { depth: 'T' });
const edgesBefore = buildPart(rep, flange).shape.edges;
const topCircle = edgesBefore.find((e) => e.geomType === 'CIRCLE' && Math.abs(e.pointAt(0.5).z - 12) < 1e-6 && Math.abs(Math.hypot(e.pointAt(0.5).x, e.pointAt(0.5).y) - 50) < 1e-3);
assert.ok(topCircle, 'arista exterior superior encontrada');
const mid = topCircle.pointAt(0.5);
flange = commands.addFeature(flange, 'fillet', { radius: 2, selector: { kind: 'near', points: [[mid.x, mid.y, mid.z]] } });
assert.equal(buildPart(rep, flange).results.fillet1.status, 'ok');
const thicker = buildPart(rep, commands.setParam(flange, 'T', 20));
assert.equal(thicker.results.fillet1.status, 'ok', thicker.results.fillet1.error);
assert.deepEqual(sizeOf(thicker.shape), [100, 100, 20]);

// 6) errores controlados
{
  const empty = commands.addFeature(commands.addFeature(createPart('x'), 'sketch'), 'extrude');
  const r = buildPart(rep, { ...empty, features: empty.features.map((f) => (f.type === 'extrude' ? { ...f, sketch: 'sketch1' } : f)) });
  assert.equal(r.results.extrude1.status, 'error');
  const huge = buildPart(rep, commands.addFeature(flange, 'fillet', { radius: 500, selector: { kind: 'all' } }));
  assert.equal(huge.results.fillet2.status, 'error', 'filete imposible informa error');
  assert.equal(buildPart(rep, commands.addFeature(createPart('y'), 'hole')).results.hole1.status, 'error');
  const sup = buildPart(rep, commands.toggleSuppressed(flange, 'hole1'));
  assert.equal(sup.results.hole1.status, 'suppressed');
}

// 7) corte con extrusión y ranura
{
  let p = createPart('Placa');
  p = commands.addFeature(p, 'sketch');
  p = commands.addEntity(p, 'sketch1', { t: 'rect', x: 0, y: 0, w: 80, h: 50, centered: true });
  p = commands.addFeature(p, 'extrude', { sketch: 'sketch1', depth: 10 });
  p = commands.addFeature(p, 'sketch');
  p = commands.addEntity(p, 'sketch2', { t: 'slot', x: 0, y: 0, length: 40, width: 10, angle: 0 });
  p = commands.updateFeature(p, 'sketch2', { offset: 10 });
  p = commands.addFeature(p, 'extrude', { sketch: 'sketch2', depth: 10, mode: 'cut', reverse: true });
  const r = buildPart(rep, p);
  assert.equal(r.results.extrude2.status, 'ok', r.results.extrude2.error);
  assert.ok(r.shape.faces.length >= 10, 'la ranura pasante agrega caras');
  assert.deepEqual(sizeOf(r.shape), [80, 50, 10]);
}
console.log('OK kernel: expresiones, anidación, revolución, brida con PCD, near, errores, ranura');

// 8) malla y exportaciones
{
  const { extractMesh } = await import('../src/kernel/meshExtractor.js');
  const { exportStl, exportStep } = await import('../src/kernel/exporters.js');
  const flangeBuilt = buildPart(rep, flange);
  const data = extractMesh(flangeBuilt.shape);
  assert.ok(data.triangles.length > 100 && data.vertices.length === data.normals.length);
  assert.ok(data.edges.length >= 10 && data.edges.every((e) => e.points.length >= 6));
  assert.deepEqual(data.bounds.size.map((v) => Math.round(v)), [100, 100, 12]);
  const stl = exportStl(flangeBuilt.shape);
  assert.ok(stl.size > 1000 && stl.size < 3_000_000, `STL de tamaño razonable (${stl.size})`);
  const step = await exportStep(flangeBuilt.shape).text();
  assert.ok(step.includes('ISO-10303-21'), 'archivo STEP válido');
}
console.log('OK mallas y exportaciones');

// 9) elipse en boceto: volumen ~ π·a·b·h
{
  let part = commands.setParam(createPart('Elipse'), 'h', 5);
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const sk = part.features[0].id;
  part = commands.addEntity(part, sk, { t: 'ellipse', x: 10, y: 0, w: 40, h: 20, angle: 90 });
  part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 'h' });
  const { shape, results } = buildPart(rep, part);
  assert.ok(Object.values(results).every((r) => r.status === 'ok'), JSON.stringify(results));
  const vol = rep.measureVolume(shape);
  assert.ok(Math.abs(vol - Math.PI * 20 * 10 * 5) < 5, `volumen elipse ${vol}`);
  const [min, max] = shape.boundingBox.bounds; // girada 90°: eje largo en Y, centro en x=10
  assert.ok(Math.abs(max[1] - min[1] - 40) < 0.1 && Math.abs(max[0] - min[0] - 20) < 0.1, 'elipse girada');
  console.log('OK elipse');
}

// 10) extrusión hacia abajo, simétrica y guías auxiliares fuera del perfil
{
  const make = (patch) => {
    let part = createPart('Dir');
    part = commands.addFeature(part, 'sketch', { plane: 'XY' });
    const sk = part.features[0].id;
    part = commands.addEntity(part, sk, { t: 'rect', x: 0, y: 0, w: 20, h: 10, centered: true });
    part = commands.addEntity(part, sk, { t: 'guide', x: 5, y: 5, angle: 45 });
    part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 8, ...patch });
    return buildPart(rep, part);
  };
  const zRange = (built) => {
    const [min, max] = built.shape.boundingBox.bounds;
    return [Math.round(min[2] * 100) / 100, Math.round(max[2] * 100) / 100];
  };
  assert.deepEqual(zRange(make({})), [0, 8], 'hacia arriba');
  assert.deepEqual(zRange(make({ reverse: true })), [-8, 0], 'hacia abajo');
  assert.deepEqual(zRange(make({ symmetric: true })), [-4, 4], 'simétrica');
  assert.ok(Math.abs(rep.measureVolume(make({}).shape) - 1600) < 0.5, 'la guía no suma material');
  console.log('OK dirección y guías');
}

// 11) polígono regular: tuerca hexagonal M10 (19 entre caras, agujero Ø8,5), área exacta
{
  let part = createPart('Tuerca');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const sk = part.features[0].id;
  part = commands.addEntity(part, sk, { t: 'polygon', x: 0, y: 0, n: 6, d: 19, across: 'flats', angle: 0 });
  part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 8.5 });
  part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 8 });
  const { shape, results } = buildPart(rep, part);
  assert.ok(Object.values(results).every((r) => r.status === 'ok'), JSON.stringify(results));
  const hexArea = 2 * Math.sqrt(3) * (19 / 2) ** 2; // 2√3·a² con a = apotema
  const expected = (hexArea - Math.PI * 4.25 ** 2) * 8;
  assert.ok(Math.abs(rep.measureVolume(shape) - expected) < 2, `volumen tuerca ${rep.measureVolume(shape)} vs ${expected}`);
  const [min, max] = shape.boundingBox.bounds;
  assert.ok(Math.abs(max[1] - min[1] - 19) < 0.01, 'entre caras 19 en Y');
  assert.ok(Math.abs(max[0] - min[0] - 19 / Math.cos(Math.PI / 6)) < 0.01, 'entre vértices en X');
  console.log('OK polígono');
}
