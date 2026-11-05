import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim } from '../src/particles/sim.js';
import { defaultAction } from '../src/core/actions.js';

const rep = await loadKernel();
const sdfOf = (a, b) => { const m = extractMesh(rep.makeBox(a, b)); return buildSdf(m.vertices, m.triangles, { cell: 1, band: 4 }); };
const cup = [[-30, -30, -3, 30, 30, 0], [-32, -32, 0, -30, 32, 40], [30, -32, 0, 32, 32, 40], [-30, -32, 0, 30, -30, 40], [-30, 30, 0, 30, 32, 40]].map((b) => ({ sdf: sdfOf(b.slice(0, 3), b.slice(3)) }));
const paddle = { sdf: sdfOf([-25, -2, 1], [25, 2, 30]), movable: true, key: 'pad', radiusMax: 26 };

const run = (withGrains, torqueMax, seconds = 6) => {
  const sim = new ParticleSim([...cup, paddle], { radius: 1.5, cap: 700, maxCap: 700, rate: withGrains ? 350 : 0, massFlow: withGrains ? 3.5 : 0, density: 1600, grain: 1, emitter: { center: [0, 0, 28], size: [40, 40, 4] }, floorZ: -20, seed: 5 });
  sim.setScene({ actions: [defaultAction('rotate', { id: 'r', targets: ['pad'], axis: 'z', mode: 'continuous', rpm: 60, dynamics: true, inertia: 0.02, torqueMax, staticTorque: 0.05, coulombTorque: 0.03, viscous: 0.001 })] });
  const trace = [];
  for (let n = 0; n < 60 * seconds; n += 1) { sim.step(1 / 60); if (n % 30 === 0) trace.push(sim.rotorInfo()[0]); }
  return { sim, info: sim.rotorInfo()[0], trace };
};
const empty = run(false, 0.6);
const loaded = run(true, 0.6);
console.log('vacío', empty.info, 'cargado', loaded.info, 'n', loaded.sim.count);
assert.ok(Math.abs(empty.info.rpm - 60) < 6, `sin carga llega a régimen: ${empty.info.rpm}`);
assert.ok(Math.abs(empty.info.loadTorque) < 0.02, 'sin granos no hay par de carga');
assert.ok(loaded.sim.count > 300, 'hay material');
assert.ok(loaded.info.loadTorque > 0.05, `los granos frenan el eje: ${loaded.info.loadTorque}`);
assert.ok(loaded.info.rpm < empty.info.rpm - 2, `con carga gira más lento: ${loaded.info.rpm} vs ${empty.info.rpm}`);
assert.ok(Math.abs(loaded.info.motorTorque) <= 0.6 + 1e-9, 'el motor no pasa de su par máximo');
for (const r of [empty, loaded]) for (let i = 0; i < r.sim.count * 3; i += 1) assert.ok(Number.isFinite(r.sim.x[i]));

// Reductor 10:1 entre el motor y las paletas: las paletas giran a 1/10 de las rpm del motor y el motor siente la carga dividida por la relación
{
  const motorBody = { sdf: sdfOf([200, 200, 200], [210, 210, 210]), movable: true, key: 'mot', radiusMax: 5 };
  const sim = new ParticleSim([...cup, motorBody, paddle], { radius: 1.5, cap: 700, maxCap: 700, rate: 350, massFlow: 3.5, density: 1600, grain: 1, emitter: { center: [0, 0, 28], size: [40, 40, 4] }, floorZ: -20, seed: 5 });
  sim.setScene({ actions: [
    defaultAction('rotate', { id: 'm', targets: ['mot'], axis: 'z', mode: 'continuous', rpm: 600, dynamics: true, inertia: 0.001, torqueMax: 0.2, staticTorque: 0.002, coulombTorque: 0.001, viscous: 0.00005 }),
    defaultAction('rotate', { id: 'p', targets: ['pad'], axis: 'z', mode: 'follow', link: { master: 'm', type: 'reductor', a: 10, eff: 0.95, inertia: 0.02 } }),
  ] });
  for (let n = 0; n < 60 * 6; n += 1) sim.step(1 / 60);
  const info = sim.rotorInfo();
  const motor = info.find((r) => !r.follower);
  const slow = info.find((r) => r.follower);
  console.log('reductor', { motor, slow });
  assert.ok(motor && slow, 'el motor y el eje conducido informan');
  assert.ok(Math.abs(slow.rpm - motor.rpm / 10) < 0.5 + Math.abs(motor.rpm) * 0.01, `salida a 1/10: ${slow.rpm} vs ${motor.rpm / 10}`);
  assert.ok(motor.loadTorque > 0.003, `el motor siente la carga de los granos: ${motor.loadTorque}`);
  assert.ok(motor.loadTorque < loaded.info.loadTorque * 0.3, `par reflejado ≈ 1/10 del directo: ${motor.loadTorque} vs ${loaded.info.loadTorque}`);
  assert.ok(motor.rpm > 300, `el motor chico sigue girando: ${motor.rpm}`);
  for (let i = 0; i < sim.count * 3; i += 1) assert.ok(Number.isFinite(sim.x[i]));
}
console.log('rotorDynamics ok');
