import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { placeShape } from '../src/kernel/assemblyBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { gearFeatureSpecs } from '../src/kernel/gearGeometry.js';
import { findLinks, solveTrain, worldGears, placePoint, turnedPose, eulerFromMatrix, engageMoves } from '../src/core/kinematics.js';

const rep = await loadKernel();
const gearPart = (z, m = 2, width = 10) => commands.addFeature(createPart(`g${z}`), 'gear', { z, m, width, bore: 8 });
const parts = { a: gearPart(20), b: gearPart(30), c: gearPart(24), d: gearPart(20, 3) };
const specsOf = (part) => gearFeatureSpecs(part, {});
const gearsOf = (instances) => instances.flatMap((inst) => worldGears(inst, specsOf(parts[inst.part])));
const shapeOf = (inst) => placeShape(buildPart(rep, parts[inst.part]).shape, inst);
const common = (a, b) => { const c = a.intersect(b); const v = rep.measureVolume(c); c.delete?.(); return v; };

// placePoint coincide con placeShape: giro 90° sobre Z y traslación
assert.deepEqual(placePoint([1, 0, 0], { rot: [0, 0, 90], pos: [0, 0, 5] }).map((v) => Math.round(v * 1e9) / 1e9), [0, 1, 5]);

// 1) dos engranajes z20/z30 a distancia de centros 50: engranan, relación −20/30
const i1 = { id: 'i1', part: 'a', pos: [0, 0, 0], rot: [0, 0, 0] };
const i2 = { id: 'i2', part: 'b', pos: [50, 0, 0], rot: [0, 0, 0] };
const links = findLinks(gearsOf([i1, i2]));
assert.equal(links.length, 1);
assert.equal(links[0].status, 'mesh');
const train = solveTrain(gearsOf([i1, i2]), 'i1');
assert.equal(train.conflicts.length, 0);
assert.ok(Math.abs(train.bodies.i2.ratio + 20 / 30) < 1e-12, `ratio ${train.bodies.i2.ratio}`);
assert.deepEqual(train.bodies.i2.axis.map((v) => Math.round(v)), [0, 0, 1]);

// 2) la fase calculada intercala los dientes (casi sin volumen común); media vuelta de paso, no
const withPhase = (inst, phaseRad, extra = 0) => {
  const shape = shapeOf(inst);
  const body = solveTrain(gearsOf([i1, inst]), 'i1').bodies[inst.id];
  const turned = shape.rotate(((body.phase + extra) * 180) / Math.PI, body.pivot, body.axis);
  return turned;
};
const s1 = shapeOf(i1);
const good = withPhase(i2);
const bad = withPhase(i2, 0, Math.PI / 30); // medio paso angular de b
const vGood = common(s1, good);
const vBad = common(s1, bad);
assert.ok(vGood < 8, `fase correcta: interferencia ${vGood.toFixed(2)} mm³`);
assert.ok(vBad > 60 && vBad > vGood * 10, `fase errada debe chocar: ${vBad.toFixed(1)} vs ${vGood.toFixed(1)}`);

// 3) engranaje invertido (eje −Z): relación con signo y fase siguen valiendo
const i2f = { id: 'i2', part: 'b', pos: [50, 0, 10], rot: [180, 0, 0] };
const flipped = solveTrain(gearsOf([i1, i2f]), 'i1');
assert.equal(findLinks(gearsOf([i1, i2f]))[0].status, 'mesh');
assert.ok(Math.abs(flipped.bodies.i2.ratio - 20 / 30) < 1e-12 && flipped.bodies.i2.axis[2] < -0.99, 'ejes opuestos: mismo sentido sobre su propio eje');
const flipShape = shapeOf(i2f).rotate((flipped.bodies.i2.phase * 180) / Math.PI, flipped.bodies.i2.pivot, flipped.bodies.i2.axis);
assert.ok(common(s1, flipShape) < 8, 'fase correcta con eje invertido');

// 4) tren con intermedio: a(20) → c(24) → b(30): relaciones y signos
const mid = { id: 'i3', part: 'c', pos: [44, 0, 0], rot: [0, 0, 0] }; // 20+24 = 44
const far = { id: 'i2', part: 'b', pos: [44 + 27, 0, 0], rot: [0, 0, 0] }; // 24+30 = 54/… rp: 24 + 30 = 54 → 44+54 = 98
far.pos = [98, 0, 0];
const chain = solveTrain(gearsOf([i1, mid, far]), 'i1');
assert.equal(chain.conflicts.length, 0);
assert.ok(Math.abs(chain.bodies.i3.ratio + 20 / 24) < 1e-12);
assert.ok(Math.abs(chain.bodies.i2.ratio - 20 / 30) < 1e-12, 'dos inversiones = mismo sentido');

// 5) anillo de tres engranajes iguales: trabado (conflicto)
const ring = ['i1', 'i2', 'i3'].map((id, k) => ({ id, part: 'a', pos: [[0, 0, 0], [40, 0, 0], [20, 20 * Math.sqrt(3), 0]][k], rot: [0, 0, 0] }));
const jam = solveTrain(gearsOf(ring), 'i1');
assert.ok(jam.conflicts.length >= 1 && /Trabado/.test(jam.conflicts[0].reason), JSON.stringify(jam.conflicts));

// 6) estados: separados, interfieren, módulos distintos, ejes no paralelos, sin superposición axial
const status = (pos, other = 'b', rot = [0, 0, 0]) => findLinks(gearsOf([i1, { id: 'x', part: other, pos, rot }]))[0]?.status;
assert.equal(status([53, 0, 0]), 'apart');
assert.equal(status([45, 0, 0]), 'overlap');
assert.equal(status([50.2, 0, 0]), 'mesh', 'tolerancia de juego');
assert.equal(status([50, 0, 0], 'd'), 'module');
assert.equal(status([50, 0, 0], 'b', [0, 90, 0]), undefined, 'ejes perpendiculares');
assert.equal(status([50, 0, 20]), undefined, 'sin superposición axial');
assert.equal(status([200, 0, 0]), undefined, 'lejos');

// 7) aplicar la fase a la pose: el engranaje queda engranado sin giro extra (con eje Z, invertido y rotado en general)
for (const base of [i2, i2f, { id: 'i2', part: 'b', pos: [50, 0, 0], rot: [0, 0, 0] }]) {
  const body = solveTrain(gearsOf([i1, base]), 'i1').bodies.i2;
  const pose = turnedPose(base, body);
  const posed = { ...base, ...pose };
  const shape = shapeOf(posed);
  assert.ok(common(s1, shape) < 8, `pose sincronizada ${JSON.stringify(pose)}`);
  const again = solveTrain(gearsOf([i1, posed]), 'i1').bodies.i2;
  assert.ok(Math.abs(again.phase) < 1e-6 || Math.abs(Math.abs(again.phase) - (2 * Math.PI) / 30) < 1e-6, `fase residual ${again.phase}`);
  shape.delete?.();
}
// ida y vuelta de ángulos de Euler en poses arbitrarias
for (const rot of [[10, 20, 30], [-170, 45, 90], [0, 0, 0], [33, -60, 120], [90, 89, 10]]) {
  const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => placePoint(e, { rot }));
  const matrix = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[c][r]));
  const back = eulerFromMatrix(matrix);
  const same = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].every((e) => placePoint(e, { rot: back }).every((v, i) => Math.abs(v - placePoint(e, { rot })[i]) < 1e-6));
  assert.ok(same, `euler ${rot} → ${back}`);
}

// 7b) engranar: a(20)→b(30) separados 53 y c(24) pisando a 40 → distancias de engrane exactas
const far2 = { id: 'x', part: 'b', pos: [53, 4, 0], rot: [0, 0, 0] };
const g2 = gearsOf([i1, far2]);
const [fix] = engageMoves(g2, findLinks(g2), 'i1');
assert.equal(fix.instance, 'x', 'se mueve el que no es el motor');
const moved2 = { ...far2, pos: far2.pos.map((v, i) => v + fix.delta[i]) };
const after = findLinks(gearsOf([i1, moved2]))[0];
assert.equal(after.status, 'mesh');
assert.ok(Math.abs(after.distance - 50) < 1e-6, `distancia ${after.distance}`);
const g3 = gearsOf([i1, { id: 'y', part: 'c', pos: [40, 0, 0], rot: [0, 0, 0] }]);
const [fix3] = engageMoves(g3, findLinks(g3), 'y'); // el motor está en y: se mueve i1 hacia atrás
assert.equal(fix3.instance, 'i1');
assert.ok(fix3.delta[0] < 0, 'i1 se aleja de y');

// 8) conductor sin engranajes
assert.match(solveTrain(gearsOf([i1]), 'nadie').error, /no tiene engranajes/);
// 9) dos engranajes dentro de UNA pieza: fase (giro del dentado) y sincronización por parámetro
let one = commands.addFeature(createPart('uno'), 'gear', { z: 20, m: 2, width: 10, bore: 8 });
one = commands.addFeature(one, 'gear', { z: 30, m: 2, width: 10, bore: 8, x: 50, y: 0 });
const partGears = (q) => gearFeatureSpecs(q, {}).map((g) => ({ ...g, instance: g.id }));
const [ga, gb] = one.features.map((f) => f.id);
const tr = solveTrain(partGears(one), ga);
assert.equal(tr.conflicts.length, 0);
assert.ok(Math.abs(tr.bodies[gb].ratio + 20 / 30) < 1e-12);
const synced = commands.updateFeature(one, gb, { phase: (tr.bodies[gb].phase * 180) / Math.PI });
const single = (q, id) => buildPart(rep, { ...q, features: q.features.filter((f) => f.id === id) }).shape;
const volGood = common(single(synced, ga), single(synced, gb));
const volBad = common(single(commands.updateFeature(one, gb, { phase: (tr.bodies[gb].phase * 180) / Math.PI + 6 }), ga), single(commands.updateFeature(one, gb, { phase: (tr.bodies[gb].phase * 180) / Math.PI + 6 }), gb));
assert.ok(volGood < 8 && volBad > 40, `fase en pieza: bien ${volGood.toFixed(1)} · mal ${volBad.toFixed(1)}`);
// con la fase ya aplicada no queda fase residual
assert.ok(Math.abs(solveTrain(partGears(synced), ga).bodies[gb].phase) < 1e-6 || Math.abs(Math.abs(solveTrain(partGears(synced), ga).bodies[gb].phase) - (2 * Math.PI) / 30) < 1e-6);

[s1, good, bad, flipShape].forEach((shape) => shape.delete?.());
console.log('kinematics OK');
