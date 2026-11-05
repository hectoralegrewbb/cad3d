import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim } from '../src/particles/sim.js';
import { defaultAction } from '../src/core/actions.js';
import { defaultFeeder, defaultSensor, sceneOps, emptyScene, simFeeders, simSensors } from '../src/core/scene.js';

const rep = await loadKernel();
const sdfOf = (a, b) => { const m = extractMesh(rep.makeBox(a, b)); return buildSdf(m.vertices, m.triangles, { cell: 2, band: 8 }); };

// Línea chica: cinta de 800 mm, tope al final, alimentador de cajas y sensor (fotocelda) antes del tope
const scene = (() => {
  let sc = emptyScene();
  sc = sceneOps.addFeeder(sc, { size: [120, 100, 80], mass: 1.2, pos: [60, 0, 70], every: 1.2, max: 6 }).scene;
  sc = sceneOps.addSensor(sc, { center: [600, 0, 60], size: [200, 200, 120], counts: 'productos' }).scene;
  return sc;
})();
const bodies = [
  { sdf: sdfOf([-20, -150, -6], [820, 150, 0]), movable: true, key: 'belt', radiusMax: 5 },
  { sdf: sdfOf([740, -150, 0], [760, 150, 200]) },
  { sdf: sdfOf([-20, -90, 0], [820, -64, 150]) }, // guías laterales
  { sdf: sdfOf([-20, 64, 0], [820, 90, 150]) },
];
const sim = new ParticleSim(bodies, { radius: 1.5, cap: 100, maxCap: 100, rate: 0, floorZ: -300, seed: 1 });
sim.setScene({
  actions: [
    defaultAction('slide', { id: 'b', targets: ['belt'], axis: 'x', mode: 'belt', speed: 250 }),
    defaultAction('slide', { id: 'g', targets: ['belt'], axis: 'x', mode: 'sweep', from: 0, to: 0, duration: 0.1, start: { type: 'zone', sensor: 's1', n: 2 } }),
  ],
  sensors: simSensors(scene),
  feeders: simFeeders(scene),
});
const seen = [];
for (let n = 0; n < 60 * 9; n += 1) {
  sim.step(1 / 60);
  if (n % 60 === 59) seen.push({ t: Math.round(sim.time), boxes: sim.rigid.count, xs: sim.rigid.bodies.map((b) => `${Math.round(b.x[0])},${Math.round(b.x[2])}`), zone: sim.sensorCounts.s1 });
}
console.log(JSON.stringify(seen.slice(-3)));
assert.ok(sim.rigid.count >= 4, `aparecen cajas: ${sim.rigid.count}`);
const first = sim.rigid.bodies[0];
assert.ok(first.x[0] > 550 && first.x[0] < 700, `la primera caja llegó cerca del tope y se detuvo en 690 como máximo: ${first.x[0]}`);
assert.ok(first.x[0] + first.half[0] < 745, 'no atraviesa el tope');
assert.ok(sim.rigid.bodies.every((b) => b.x[2] > 34 && b.x[2] < 46), 'todas apoyadas sobre la cinta (ni hundidas ni montadas)');
const sorted = sim.rigid.bodies.map((b) => b.x[0]).sort((a, b) => b - a);
assert.ok(sorted.slice(0, 4).every((x, i) => i === 0 || sorted[i - 1] - x > 95), `la fila sale ordenada, sin atravesarse: ${sorted.map(Math.round)}`);
assert.ok(Math.max(...seen.map((s) => s.zone)) >= 1, 'el sensor cuenta productos');
assert.ok(sim.zoneReached.get('s1:2') !== undefined, 'el disparo «N productos en el sensor» se cumplió');
const snap = sim.productSnapshot();
assert.equal(snap.length, sim.rigid.count * 10);
assert.ok(snap.every(Number.isFinite));
// sin cinta andando las cajas se quedan donde caen
const still = new ParticleSim(bodies, { radius: 1.5, cap: 10, maxCap: 10, rate: 0, floorZ: -300 });
still.setScene({ actions: [], sensors: [], feeders: simFeeders(scene) });
for (let n = 0; n < 60 * 3; n += 1) still.step(1 / 60);
assert.ok(still.rigid.count >= 1 && still.rigid.bodies[0].x[0] < 100, `cinta parada: la caja queda en ${still.rigid.bodies[0].x[0]}`);
// reinicio vacía
still.resetDynamics();
assert.equal(still.rigid.count, 0);
console.log('products ok', sim.stepMs.toFixed(1), 'ms/paso');
// costo en régimen: 9 s de línea con 6 cajas
{
  const t = performance.now();
  for (let n = 0; n < 120; n += 1) sim.step(1 / 60);
  const per = (performance.now() - t) / 120;
  console.log('costo por paso con', sim.rigid.count, 'cajas:', per.toFixed(2), 'ms');
  assert.ok(per < 12, `el paso con cajas debe ser barato: ${per} ms`);
}
