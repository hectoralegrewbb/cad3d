import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';

const rep = await loadKernel();
const add = (part, type, patch) => commands.addFeature(part, type, patch);
const sketchOf = (part, entities, plane = 'XY', offset = 0) => {
  const withSketch = add(part, 'sketch', { plane, offset });
  const id = withSketch.features[withSketch.features.length - 1].id;
  return { part: entities.reduce((acc, entity) => commands.addEntity(acc, id, entity), withSketch), id };
};
const box = (part) => { const [min, max] = part.boundingBox.bounds; return { min, max }; };

// 1) caño a 20° acoplado: tramo 1 vertical (Z 0..100, Ø40), tramo 2 igual girado 20° sobre Y con pivote en la boca (0,0,100)
{
  let { part, id } = sketchOf(createPart('Caño'), [{ t: 'circle', x: 0, y: 0, d: 40 }]);
  part = add(part, 'extrude', { sketch: id, depth: 100 });
  ({ part, id } = sketchOf(part, [{ t: 'circle', x: 0, y: 0, d: 40 }], 'XY', 100));
  part = add(part, 'extrude', { sketch: id, depth: 100, turn: { axis: 'y', angle: 20, px: 0, py: 0, pz: 100 } });
  const result = buildPart(rep, part);
  assert.equal(result.results.extrude2.status, 'ok', result.results.extrude2.error);
  assert.equal(result.solids, 1, 'el tramo girado queda unido al primero');
  const { max } = box(result.shape);
  // la punta del tramo 2 se desplaza ≈ 100·sin20 = 34.2 (+ radio·cos20 ≈ 18.8)
  assert.ok(max[0] > 34 + 15 && max[0] < 34.2 + 20.5, `x máx ${max[0]}`);
  assert.ok(Math.abs(max[2] - (100 + 100 * Math.cos(Math.PI / 9) + 20 * Math.sin(Math.PI / 9))) < 1, `z máx ${max[2]}`);
  const volume = rep.measureVolume(result.shape);
  assert.ok(volume > Math.PI * 400 * 195 && volume < Math.PI * 400 * 200, `volumen ${volume}`);
  // sin giro el tramo sigue vertical
  const straight = buildPart(rep, commands.updateFeature(part, 'extrude2', { turn: undefined }));
  assert.ok(box(straight.shape).max[0] < 20.1);
}

// 2) eje propio y giro nulo
{
  let { part, id } = sketchOf(createPart('Eje propio'), [{ t: 'rect', x: 0, y: 0, w: 10, h: 10, centered: true }]);
  part = add(part, 'extrude', { sketch: id, depth: 50, turn: { axis: 'custom', vx: 1, vy: 1, vz: 0, angle: 90, px: 0, py: 0, pz: 0 } });
  const result = buildPart(rep, part);
  assert.equal(result.results.extrude1.status, 'ok', result.results.extrude1.error);
  const { min, max } = box(result.shape);
  assert.ok(Math.abs(max[0] - min[0]) > 45 || Math.abs(max[1] - min[1]) > 45, 'el prisma quedó acostado');
  const bad = buildPart(rep, commands.updateFeature(part, 'extrude1', { turn: { axis: 'custom', vx: 0, vy: 0, vz: 0, angle: 30 } }));
  assert.equal(bad.results.extrude1.status, 'error');
}

// 3) repetir: buje + aspa inclinada repetida 4 veces alrededor de Z
{
  let { part, id } = sketchOf(createPart('Hélice'), [{ t: 'circle', x: 0, y: 0, d: 20 }]);
  part = add(part, 'extrude', { sketch: id, depth: 20 });
  ({ part, id } = sketchOf(part, [{ t: 'rect', x: 8, y: -6, w: 40, h: 12, centered: false }], 'XY', 4));
  part = add(part, 'extrude', { sketch: id, depth: 2, turn: { axis: 'x', angle: 25, px: 0, py: 0, pz: 5 } });
  part = add(part, 'pattern', { source: 'extrude2', count: 4, axis: 'z' });
  const single = buildPart(rep, { ...part, features: part.features.filter((f) => f.type !== 'pattern') });
  const result = buildPart(rep, part);
  assert.equal(result.results.pattern1.status, 'ok', result.results.pattern1.error);
  assert.equal(result.solids, 1);
  const hub = Math.PI * 100 * 20;
  const blade = rep.measureVolume(single.shape) - hub;
  const total = rep.measureVolume(result.shape);
  assert.ok(Math.abs(total - (hub + 4 * blade)) / total < 0.05, `volumen ${total} vs ${hub + 4 * blade}`);
  // simetría: cajas ±
  const { min, max } = box(result.shape);
  assert.ok(Math.abs(max[0] + min[0]) < 1.5 && Math.abs(max[1] + min[1]) < 1.5, 'reparto parejo');
  // errores
  const none = buildPart(rep, commands.updateFeature(part, 'pattern1', { source: null }));
  assert.equal(none.results.pattern1.status, 'error');
  const few = buildPart(rep, commands.updateFeature(part, 'pattern1', { count: 1 }));
  assert.equal(few.results.pattern1.status, 'error');
}

// 4) repetir un corte en línea
{
  let { part, id } = sketchOf(createPart('Placa'), [{ t: 'rect', x: 0, y: 0, w: 100, h: 30, centered: false }]);
  part = add(part, 'extrude', { sketch: id, depth: 10 });
  ({ part, id } = sketchOf(part, [{ t: 'circle', x: 10, y: 15, d: 6 }], 'XY', 0));
  part = add(part, 'extrude', { sketch: id, depth: 10, mode: 'cut' });
  part = add(part, 'pattern', { source: 'extrude2', kind: 'linear', count: 4, dx: 25, dy: 0, dz: 0 });
  const result = buildPart(rep, part);
  assert.equal(result.results.pattern1.status, 'ok', result.results.pattern1.error);
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - (100 * 30 * 10 - 4 * Math.PI * 9 * 10)) < 20, `volumen ${volume}`);
}

// 5) tubos: T de dos caños; el ramal abre el hueco en la pared y no tapa el hueco del tronco
{
  const build = (mode) => {
    let { part, id } = sketchOf(createPart('T'), [{ t: 'circle', x: 0, y: 0, d: 50 }, { t: 'circle', x: 0, y: 0, d: 44 }]);
    part = add(part, 'extrude', { sketch: id, depth: 200, mode });
    ({ part, id } = sketchOf(part, [{ t: 'circle', x: 0, y: 100, d: 30 }, { t: 'circle', x: 0, y: 100, d: 24 }], 'YZ', 0));
    part = add(part, 'extrude', { sketch: id, depth: 100, mode });
    return buildPart(rep, part);
  };
  const tube = build('tube');
  assert.equal(tube.results.extrude2.status, 'ok', tube.results.extrude2.error);
  assert.equal(tube.solids, 1);
  const plain = build('add');
  const vt = rep.measureVolume(tube.shape);
  const vp = rep.measureVolume(plain.shape);
  const expectedTube = Math.PI * 141 * 200 - Math.PI * 144 * 3 + Math.PI * 81 * 75;
  assert.ok(Math.abs(vt - expectedTube) / expectedTube < 0.04, `tubo ${vt} vs ${expectedTube}`);
  assert.ok(vp - vt > 3000, `el modo normal deja pared dentro del hueco: ${vp} vs ${vt}`);
}
// 6) repetir un tubo: dos ramales con hueco
{
  let { part, id } = sketchOf(createPart('Peine'), [{ t: 'rect', x: 0, y: 0, w: 120, h: 30, centered: false }]);
  part = add(part, 'extrude', { sketch: id, depth: 30 });
  ({ part, id } = sketchOf(part, [{ t: 'circle', x: 15, y: 15, d: 20 }, { t: 'circle', x: 15, y: 15, d: 12 }], 'XY', 30));
  part = add(part, 'extrude', { sketch: id, depth: 40, mode: 'tube' });
  part = add(part, 'pattern', { source: 'extrude2', kind: 'linear', count: 3, dx: 40, dy: 0, dz: 0 });
  const result = buildPart(rep, part);
  assert.equal(result.results.pattern1.status, 'ok', result.results.pattern1.error);
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - (120 * 30 * 30 + 3 * Math.PI * (100 - 36) * 40)) < 600, `volumen ${volume}`);
}

// 7) cañería con curvas: Z 100 → codo 90° (R 60) hacia +X → X 100; volumen ≈ pared × largo de eje
{
  const od = 40; const wall = 4; const radius = 60;
  let part = add(createPart('Cañería'), 'pipe', { start: [0, 0, 0], dir: [0, 0, 1], od, wall, radius, segments: [{ len: 100, turn: 90, toward: '+x', radius: '' }, { len: 100, turn: 0, toward: '+x', radius: '' }] });
  const result = buildPart(rep, part);
  assert.equal(result.results.pipe1.status, 'ok', result.results.pipe1.error);
  assert.equal(result.solids, 1);
  const area = Math.PI * ((od / 2) ** 2 - (od / 2 - wall) ** 2);
  const centerline = 100 + (Math.PI / 2) * radius + 100;
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - area * centerline) / (area * centerline) < 0.01, `volumen ${volume} vs ${area * centerline}`);
  const { min, max } = box(result.shape);
  // el eje termina en x = R + 100 = 160, z = 100 + R = 160 (la boca: ±20 en z)
  assert.ok(Math.abs(max[0] - 160) < 0.5, `x máx ${max[0]}`);
  assert.ok(Math.abs(max[2] - 180) < 0.5 && Math.abs(min[2]) < 0.5 || Math.abs(max[2] - 160 - 0) < 21, `z ${min[2]}..${max[2]}`);
  // continuar desde esa cañería
  part = add(part, 'pipe', { from: 'pipe1', od, wall, radius, segments: [{ len: 80, turn: 90, toward: '-z', radius: '' }, { len: 50, turn: 0, toward: '+x', radius: '' }] });
  const next = buildPart(rep, part);
  assert.equal(next.results.pipe2.status, 'ok', next.results.pipe2.error);
  assert.equal(next.solids, 1, 'las dos cañerías quedan unidas');
  // un codo hacia una dirección paralela da error claro
  const bad = buildPart(rep, commands.updateFeature(part, 'pipe1', { segments: [{ len: 100, turn: 90, toward: '+z' }] }));
  assert.equal(bad.results.pipe1.status, 'error');
}
// 8) perfil de boceto curvado (canal en U): rectángulo hueco 40×20 pared 3 recorrido recto + curva 45°
{
  let { part, id } = sketchOf(createPart('Canal'), [{ t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: true }, { t: 'rect', x: 0, y: 0, w: 34, h: 14, centered: true }], 'XY', 0);
  part = add(part, 'pipe', { profile: 'sketch', sketch: id, radius: 80, segments: [{ len: 60, turn: 45, toward: '+y', radius: '' }, { len: 60, turn: 0, toward: '+y', radius: '' }] });
  const result = buildPart(rep, part);
  assert.equal(result.results.pipe1.status, 'ok', result.results.pipe1.error);
  const area = 40 * 20 - 34 * 14;
  const centerline = 60 + (Math.PI / 4) * 80 + 60;
  const volume = rep.measureVolume(result.shape);
  assert.ok(Math.abs(volume - area * centerline) / (area * centerline) < 0.02, `volumen ${volume} vs ${area * centerline}`);
}
console.log('turn.test OK');
