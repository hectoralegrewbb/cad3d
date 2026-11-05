import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { buildSdf } from '../src/particles/sdf.js';
import { AirGrid } from '../src/particles/airflow.js';

const rep = await loadKernel();
const body = (a, b, extra = {}) => {
  const mesh = extractMesh(rep.makeBox(a, b));
  return { sdf: buildSdf(mesh.vertices, mesh.triangles, { cell: 1.2, band: 4 }), movable: false, axis: [0, 0, 1], pivot: [0, 0, 0], offset: [0, 0, 0], angle: 0, ...extra };
};
const nozzle = { level: 1, pos: [0, 0, 0], dir: [1, 0, 0], speed: 8000, range: 200, radius: 6, tan: Math.tan(0.2) };
const lo = [-20, -60, -60];
const hi = [160, 60, 60];
const speedAt = (grid, x, y, z) => {
  const out = [0, 0, 0];
  grid.velocityAt(x, y, z, out);
  return Math.hypot(...out);
};
const run = (grid, steps, sources = [nozzle]) => {
  for (let n = 0; n < steps; n += 1) grid.step(0.05, sources, [0, 0, 0]);
};

// 1) chorro libre: llega lejos y cae con la distancia
{
  const grid = new AirGrid({ lo, hi, bodies: [], cells: 20000 });
  run(grid, 16);
  assert.ok(speedAt(grid, 30, 0, 0) > 3000, 'cerca de la boca el aire es fuerte');
  assert.ok(speedAt(grid, 30, 0, 0) > speedAt(grid, 120, 0, 0), 'cae con la distancia');
  assert.ok(speedAt(grid, 120, 0, 0) > 100, 'el chorro llega lejos');
}

// 2) pared: sombra detrás, aire desviado a los costados, sólido sin aire
{
  const wall = body([50, -20, -20], [56, 20, 20]);
  const grid = new AirGrid({ lo, hi, bodies: [wall], cells: 20000 });
  run(grid, 16);
  assert.equal(speedAt(grid, 53, 0, 0), 0, 'dentro de la pared no hay aire');
  assert.ok(speedAt(grid, 44, 24, 0) > 300, 'el aire se abre hacia los costados contra la pared');
  const free = new AirGrid({ lo, hi, bodies: [], cells: 20000 });
  run(free, 16);
  assert.ok(speedAt(grid, 62, 0, 0) < speedAt(free, 62, 0, 0) * 0.6, 'la pared hace sombra');
}

// 3) al cortar la fuente el aire se aquieta
{
  const grid = new AirGrid({ lo, hi, bodies: [], cells: 20000 });
  run(grid, 12);
  const before = speedAt(grid, 30, 0, 0);
  run(grid, 60, [{ ...nozzle, level: 0 }]);
  assert.ok(speedAt(grid, 30, 0, 0) < before * 0.3, 'se aquieta');
}

// 4) cuerpo móvil: si la pared se aparta, el chorro pasa
{
  const wall = body([50, -30, -30], [56, 30, 30], { movable: true, key: 'g' });
  const grid = new AirGrid({ lo, hi, bodies: [wall], cells: 20000 });
  run(grid, 14);
  const closed = speedAt(grid, 80, 0, 0);
  wall.offset = [0, 90, 0];
  run(grid, 14);
  assert.ok(speedAt(grid, 80, 0, 0) > closed * 2 + 100, `abierta pasa el aire (${closed} → ${speedAt(grid, 80, 0, 0)})`);
}

// 5) viento uniforme: entra por barlovento y rodea el obstáculo
{
  const wall = body([50, -20, -20], [56, 20, 20]);
  const grid = new AirGrid({ lo, hi, bodies: [wall], cells: 20000 });
  for (let n = 0; n < 24; n += 1) grid.step(0.05, [], [3000, 0, 0]);
  assert.ok(speedAt(grid, 20, 0, 0) > 1500, 'aguas arriba sopla el viento');
  assert.ok(speedAt(grid, 70, 0, 0) < speedAt(grid, 20, 0, 0) * 0.7, 'aguas abajo del obstáculo hay estela');
}

// 6) costo por paso razonable (grilla media)
{
  const grid = new AirGrid({ lo, hi, bodies: [body([50, -20, -20], [56, 20, 20])], cells: 20000 });
  run(grid, 8);
  console.log('airflow ms/paso (20k celdas):', grid.stepCost.toFixed(1), 'celdas', grid.n);
  assert.ok(grid.stepCost < 60, 'paso de aire acotado');
}
console.log('airflow.test OK');
