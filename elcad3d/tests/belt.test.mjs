import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim } from '../src/particles/sim.js';
import { defaultAction } from '../src/core/actions.js';

const rep = await loadKernel();
const sdfOf = (a, b) => { const m = extractMesh(rep.makeBox(a, b)); return buildSdf(m.vertices, m.triangles, { cell: 1, band: 4 }); };

// Cinta de 600 mm con guías laterales: el granulado que cae encima viaja a la velocidad de la superficie
const run = (speed, rollerRpm = null) => {
  const bodies = [
    { sdf: sdfOf([-10, -30, -4], [590, 30, 0]), movable: true, key: 'belt', radiusMax: 5 },
    { sdf: sdfOf([-10, -34, 0], [590, -30, 25]) },
    { sdf: sdfOf([-10, 30, 0], [590, 34, 25]) },
    ...(rollerRpm === null ? [] : [{ sdf: sdfOf([700, 0, 0], [710, 10, 10]), movable: true, key: 'roller', radiusMax: 5 }]),
  ];
  const sim = new ParticleSim(bodies, { radius: 1.5, friction: 0.55, wallFriction: 0.5, grain: 1, density: 1600, cap: 600, maxCap: 600, rate: 150, emitter: { center: [20, 0, 20], size: [10, 20, 4] }, floorZ: -40, seed: 11 });
  const actions = rollerRpm === null
    ? [defaultAction('slide', { id: 'b', targets: ['belt'], axis: 'x', mode: 'belt', speed, start: { type: 'time', t: 0 } })]
    : [
      defaultAction('rotate', { id: 'r', targets: ['roller'], axis: 'y', mode: 'continuous', rpm: rollerRpm }),
      defaultAction('slide', { id: 'b', targets: ['belt'], axis: 'x', mode: 'belt', link: { master: 'r', pitch: 150 } }), // 150 mm por vuelta del rodillo
    ];
  sim.setScene({ actions });
  for (let n = 0; n < 60 * 5; n += 1) sim.step(1 / 60);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sim.count; i += 1) if (sim.x[i * 3 + 2] < 8 && sim.x[i * 3] > 40) { sum += sim.v[i * 3]; n += 1; }
  return { vx: n ? sum / n : 0, n, sim };
};

const stopped = run(0);
const moving = run(300);
const driven = run(0, 120); // 120 rpm × 150 mm/vuelta = 300 mm/s
console.log('cinta', { stopped: [stopped.vx, stopped.n], moving: [moving.vx, moving.n], driven: [driven.vx, driven.n] });
assert.ok(Math.abs(stopped.vx) < 30, `cinta parada: ${stopped.vx}`);
assert.ok(moving.n > 20, 'hay granos sobre la cinta');
assert.ok(moving.vx > 200 && moving.vx < 360, `los granos van a ~300 mm/s: ${moving.vx}`);
assert.ok(driven.vx > 200 && driven.vx < 360, `cinta movida por el rodillo (rpm × paso): ${driven.vx}`);
for (const r of [stopped, moving, driven]) for (let i = 0; i < r.sim.count * 3; i += 1) assert.ok(Number.isFinite(r.sim.x[i]));
console.log('belt ok');
