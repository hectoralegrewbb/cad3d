import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { matingGearFeature, matingPhase, rackOutline, rackToothOrigin } from '../src/core/gearPair.js';

const rep = await loadKernel();
const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} vs ${b}`);

// álgebra de fases: sumas de fracciones = ½ en el punto primitivo
near(matingPhase({ z1: 20, phase1: 0, z2: 30, thetaDeg: 0 }), 180 - 360 / 30 * 0.5, 1e-9, 'diente del piñón sobre la línea → hueco del otro');
near(matingPhase({ z1: 20, phase1: 9, z2: 30, thetaDeg: 0 }), 180, 1e-3, 'medio paso de piñón: f1 = 0.5 → f2 = 0');
near(rackToothOrigin({ z1: 20, phase1: 0, thetaDeg: 0, m: 2 }), Math.PI, 1e-4, 'cremallera: hueco bajo el diente del piñón');

const gearPart = (patch = {}) => {
  let part = createPart('par');
  part = commands.addFeature(part, 'gear', { m: 2, z: 20, width: 10, bore: 8, ...patch });
  return part;
};
const volume = (shape) => rep.measureVolume(shape);
const solid = (part) => buildPart(rep, part).shape;
const overlap = (a, b) => { const c = a.intersect(b); const v = c ? volume(c) : 0; c?.delete?.(); return Math.abs(v); };

// 1) par de engranajes: la fase calculada no interfiere; la fase equivocada (medio paso corrida) sí
for (const thetaDeg of [0, 90, 180, 270, 37]) {
  const gear1 = commands.addFeature(createPart('a'), 'gear', { m: 2, z: 20, width: 10, bore: 8, phase: thetaDeg === 37 ? 5 : 0 }).features[0];
  const patch = matingGearFeature(gear1, {}, { teeth: 31, thetaDeg });
  const A = solid({ ...createPart('a'), features: [gear1] });
  const goodB = solid({ ...createPart('b'), features: [{ ...gear1, ...patch }] });
  const badB = solid({ ...createPart('c'), features: [{ ...gear1, ...patch, phase: patch.phase + 180 / 31 }] });
  const good = overlap(A, goodB);
  const bad = overlap(A, badB);
  assert.ok(good < 1.5, `θ=${thetaDeg}°: engranan sin interferencia (${good.toFixed(3)} mm³)`);
  assert.ok(bad > 20 * Math.max(good, 0.05), `θ=${thetaDeg}°: con medio diente corrido sí interfiere (${bad.toFixed(1)} vs ${good.toFixed(3)} mm³)`);
  console.log(`  θ=${thetaDeg}°: ok ${good.toFixed(3)} mm³ · mal ${bad.toFixed(1)} mm³`);
}
// 2) la distancia de centros y los campos copiados
{
  const g = commands.addFeature(createPart('a'), 'gear', { m: 3, z: 18, width: 12, bore: 10, x: 5, y: -4, plane: 'XZ', offset: 7, helix: 15 }).features[0];
  const p = matingGearFeature(g, {}, { teeth: 42, thetaDeg: 180 });
  near(p.x, 5 - 3 * (18 + 42) / 2, 1e-6); near(p.y, -4, 1e-6);
  assert.equal(p.plane, 'XZ'); assert.equal(p.offset, 7); assert.equal(p.width, 12); assert.equal(p.m, 3); assert.equal(p.z, 42); assert.equal(p.helix, -15, 'hélice opuesta');
}
// 3) cremallera: encaja con el piñón en las 4 direcciones (sin interferencia) y se separa si se corre medio paso
for (const thetaDeg of [0, 90, 180, 270]) {
  const pinion = commands.addFeature(createPart('a'), 'gear', { m: 2, z: 20, width: 10, bore: 8, phase: 3 }).features[0];
  const rack = rackOutline(pinion, {}, { teeth: 12, baseHeight: 10, thetaDeg });
  const rackPart = (shiftMm = 0) => {
    let part = createPart('r');
    part = commands.addFeature(part, 'sketch', { plane: 'XY', offset: 0 });
    const sketchId = part.features[0].id;
    const t = [-Math.sin((thetaDeg * Math.PI) / 180), Math.cos((thetaDeg * Math.PI) / 180)];
    part = commands.addEntity(part, sketchId, { t: 'poly', pts: rack.points.map(([x, y]) => ({ x: x + t[0] * shiftMm, y: y + t[1] * shiftMm, bulge: 0 })) });
    return commands.addFeature(part, 'extrude', { sketch: sketchId, depth: 10, mode: 'add' });
  };
  const A = solid({ ...createPart('a'), features: [pinion] });
  const R = solid(rackPart(0));
  const Rbad = solid(rackPart(Math.PI)); // medio paso: diente contra diente
  const good = overlap(A, R);
  const bad = overlap(A, Rbad);
  assert.ok(good < 2, `θ=${thetaDeg}°: piñón + cremallera sin interferencia (${good.toFixed(3)} mm³)`);
  assert.ok(bad > 20 * Math.max(good, 0.05), `θ=${thetaDeg}°: corrida medio paso interfiere (${bad.toFixed(1)} vs ${good.toFixed(3)})`);
  near(rack.length, 12 * Math.PI * 2, 1e-9);
  console.log(`  cremallera θ=${thetaDeg}°: ok ${good.toFixed(3)} mm³ · mal ${bad.toFixed(1)} mm³`);
}
console.log('gearPair ok');

// 4) reductor completo: geometría + acciones enlazadas (solo estado, sin kernel)
{
  const { addGearMate } = await import('../src/core/gearPair.js');
  const { solveBodies } = await import('../src/core/actions.js').catch(() => ({}));
  let part = commands.addFeature(createPart('t'), 'gear', { m: 2, z: 20, width: 10, bore: 8 });
  const id = part.features[0].id;
  const g = addGearMate(part, id, {}, { kind: 'gear', teeth: 40, thetaDeg: 0 });
  assert.equal(g.state.features.length, 2);
  const acts = g.state.actions;
  assert.equal(acts.length, 2);
  assert.equal(acts[1].mode, 'follow'); assert.equal(acts[1].link.master, g.pinionAction); assert.equal(acts[1].link.type, 'engranaje');
  assert.deepEqual(acts[1].pivot, [60, 0, 0]);
  const r = addGearMate(part, id, {}, { kind: 'rack', teeth: 10, thetaDeg: 90 });
  assert.deepEqual(r.state.features.map((f) => f.type), ['gear', 'sketch', 'extrude']);
  assert.equal(r.state.actions[1].kind, 'slide');
  near(r.state.actions[1].link.pitch, Math.PI * 2 * 20, 1e-3);
  assert.deepEqual(r.state.actions[1].axis.map((v) => Math.round(v)), [-1, 0, 0]);
  // reutiliza el giro existente
  const again = addGearMate(g.state, id, {}, { kind: 'gear', teeth: 15, thetaDeg: 180 });
  assert.equal(again.state.actions.length, 3);
  assert.equal(again.state.actions[2].link.master, g.pinionAction);
  assert.throws(() => addGearMate(part, id, {}, { kind: 'gear', teeth: 3 }));
  console.log('  addGearMate ok');
}
