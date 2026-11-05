import assert from 'node:assert/strict';
import { boxCenter, closestOnAxis, dragDelta, neighbourGaps, rayPlane, snapMove, translateBox } from '../src/core/moveSnap.js';

const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} vs ${b}`);
const box = (min, max, name) => ({ min, max, name });
const mover = box([0, 0, 0], [10, 10, 10], 'a');
const wall = box([50, -5, -5], [60, 20, 20], 'pared');

// imán: la cara del cuerpo se apoya en la pared cuando queda a menos de tol (máx del cuerpo ↔ mín de la pared)
{
  const r = snapMove({ box: mover, delta: [39.4, 0, 0], axes: [true, false, false], others: [wall], tol: 1 });
  near(r.delta[0], 40, 1e-9, 'apoyado: 10 + 40 = 50');
  assert.equal(r.snaps.length, 1);
  assert.equal(r.snaps[0].mine, 'max'); assert.equal(r.snaps[0].theirs, 'min'); assert.equal(r.snaps[0].target, 'pared');
  // lejos: no engancha
  const far = snapMove({ box: mover, delta: [30, 0, 0], axes: [true, false, false], others: [wall], tol: 1 });
  near(far.delta[0], 30); assert.equal(far.snaps.length, 0);
  // un eje no activo no se toca
  const locked = snapMove({ box: mover, delta: [39.4, 0.3, 0], axes: [true, false, false], others: [wall], tol: 1 });
  near(locked.delta[1], 0.3);
}
// alineación centro con centro y mismo tipo
{
  const other = box([0, 100, 0], [30, 120, 30], 'otro'); // centro X = 15
  const r = snapMove({ box: mover, delta: [9.6, 0, 0], axes: [true, false, false], others: [other], tol: 1, origin: false }); // centro mover = 5 + 9.6 = 14.6
  near(r.delta[0], 10, 1e-9, 'centro con centro'); assert.equal(r.snaps[0].mine, 'center'); assert.equal(r.snaps[0].theirs, 'center');
}
// prefiere par fuerte aunque otro débil esté un poco más cerca
{
  const a = box([100, 0, 0], [110, 10, 10], 'a');
  const r = snapMove({ box: mover, delta: [89.7, 0, 0], axes: [true, false, false], others: [a], tol: 1, origin: false });
  assert.equal(r.snaps[0].theirs, 'min'); assert.equal(r.snaps[0].mine, 'max');
}
// imán al origen
{
  const r = snapMove({ box: box([20, 20, 20], [30, 30, 30]), delta: [-20.4, 0, 0], axes: [true, false, false], others: [], tol: 1 });
  near(r.delta[0], -20, 1e-9, 'cara mín en x = 0'); assert.equal(r.snaps[0].target, 'el origen');
}
// distancias libres: solo vecinos enfrentados
{
  const moved = translateBox(mover, [20, 0, 0]); // x 20..30
  const gaps = neighbourGaps({ box: moved, others: [wall, box([0, 100, 0], [10, 110, 10], 'lejos')] });
  const right = gaps.find((g) => g.axis === 0 && g.dir > 0);
  near(right.gap, 20, 1e-9, 'a la derecha hay 20 mm hasta la pared'); assert.equal(right.target, 'pared');
  assert.equal(gaps.find((g) => g.axis === 0 && g.dir < 0), undefined, 'a la izquierda no hay nada enfrentado');
  assert.equal(gaps.some((g) => g.target === 'lejos'), false, 'el que no se superpone en los otros ejes no cuenta');
  near(right.from[0], 30); near(right.to[0], 50);
  // superpuestos en el eje: sin cota
  const inside = neighbourGaps({ box: box([45, 0, 0], [55, 10, 10]), others: [wall], axes: [true, false, false] });
  assert.equal(inside.length, 0);
  // apoyados: gap 0
  const touching = neighbourGaps({ box: translateBox(mover, [40, 0, 0]), others: [wall], axes: [true, false, false] });
  near(touching[0].gap, 0);
}
// geometría de rayos: arrastre sobre un eje y sobre un plano
{
  // cámara en (0,-100,0) mirando +Y; el rayo pasa por x = 5 al inicio y x = 25 al final: el eje X avanza 20
  const start = { origin: [0, -100, 0], dir: [0.05, 1, 0] }; // en y=0 → x = 5
  const startNorm = start.dir.map((v) => v / Math.hypot(...start.dir));
  const cur = { origin: [0, -100, 0], dir: [0.25, 1, 0] };
  const curNorm = cur.dir.map((v) => v / Math.hypot(...cur.dir));
  const d = dragDelta('x', { origin: start.origin, dir: startNorm }, { origin: cur.origin, dir: curNorm }, [0, 0, 0]);
  assert.ok(d[0] > 15 && d[0] < 25 && d[1] === 0 && d[2] === 0, `delta sobre X ≈ 20: ${d}`);
  // plano XY a z = 10: rayo vertical desde arriba en (3,4) y en (13,-6) → (10, −10)
  const p = dragDelta('xy', { origin: [3, 4, 100], dir: [0, 0, -1] }, { origin: [13, -6, 100], dir: [0, 0, -1] }, [0, 0, 10]);
  near(p[0], 10); near(p[1], -10); near(p[2], 0);
  assert.equal(rayPlane([0, 0, 0], [1, 0, 0], [0, 0, 5], [0, 0, 1]), null, 'rayo paralelo al plano');
  assert.equal(closestOnAxis([0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0]), null, 'rayo paralelo al eje');
  near(closestOnAxis([7, 0, 50], [0, 0, -1], [0, 0, 0], [1, 0, 0]), 7, 1e-9, 'rayo vertical sobre x = 7');
}
near(boxCenter(box([0, 2, 4], [10, 4, 8]))[2], 6);
console.log('moveSnap ok');
