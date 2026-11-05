import assert from 'node:assert/strict';
import { distanceBetween, nearestOnShape, nearestShape, nearestVertex, pointInShape } from '../src/core/sketchDistance.js';

const rect = (x0, y0, x1, y1, id = 'r') => ({ id, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// rectángulos separados: distancia entre caras paralelas y puntos más cercanos
{
  const r = distanceBetween(rect(0, 0, 10, 10), rect(25, 2, 40, 8));
  close(r.d, 15, 'caras paralelas');
  assert.equal(r.overlap, false);
  close(r.p[0], 10, 'p.x'); close(r.q[0], 25, 'q.x');
}
// en diagonal: esquina contra esquina
close(distanceBetween(rect(0, 0, 10, 10), rect(13, 14, 20, 20)).d, 5, 'esquinas (3,4,5)');
// superpuestos y contenidos: 0
assert.equal(distanceBetween(rect(0, 0, 10, 10), rect(5, 5, 20, 20)).d, 0);
{
  const r = distanceBetween(rect(0, 0, 100, 100), rect(40, 40, 60, 60));
  assert.equal(r.d, 0); assert.equal(r.overlap, true);
}
// punto a línea y a forma
close(nearestOnShape([5, 30], rect(0, 0, 10, 10)).d, 20, 'punto a rectángulo');
// guía horizontal y=50 contra rectángulo abajo / cruzando
const guide = { id: 'g', line: { x: 0, y: 50, angle: 0 } };
close(distanceBetween(guide, rect(0, 0, 10, 20)).d, 30, 'guía a rectángulo');
assert.equal(distanceBetween(rect(0, 40, 10, 60), guide).d, 0);
// dos guías paralelas
close(distanceBetween(guide, { line: { x: 3, y: 80, angle: 180 } }).d, 30, 'guías paralelas');
// dos líneas (polígonos degenerados de 2 puntos abiertos) paralelas: distancia perpendicular
{
  const a = { pts: [[0, 0], [100, 0]], closed: false };
  const b = { pts: [[20, 7], [60, 7]], closed: false };
  close(distanceBetween(a, b).d, 7, 'líneas paralelas');
  const c = { pts: [[50, -10], [50, 10]], closed: false };
  assert.equal(distanceBetween(a, c).d, 0);
}
// más cercana + vértice
{
  const shapes = [rect(0, 0, 10, 10, 'a'), rect(100, 0, 110, 10, 'b')];
  const n = nearestShape([20, 5], shapes);
  assert.equal(n.shape.id, 'a'); close(n.d, 10, 'más cercana');
  assert.equal(nearestShape([20, 5], shapes, 'a').shape.id, 'b');
  const v = nearestVertex([12, 13], shapes);
  close(v.d, Math.hypot(2, 3), 'vértice');
}
assert.equal(pointInShape([5, 5], rect(0, 0, 10, 10)), true);
assert.equal(pointInShape([15, 5], rect(0, 0, 10, 10)), false);
console.log('sketchDistance ok');
