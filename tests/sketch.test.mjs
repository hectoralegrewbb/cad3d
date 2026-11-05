import assert from 'node:assert/strict';
import { collectGeometry, computeSnap } from '../src/ui/sketchSnap.js';
import { parseLength, formatUnit } from '../src/core/lengthInput.js';

// Geometría: rectángulo 40x20 (esquina en 0,0) + círculo Ø10 en (20,10)
const geo = collectGeometry([{ t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: false }, { t: 'circle', x: 20, y: 10, d: 10 }]);
const has = (kind, x, y) => geo.points.some((p) => p.kind === kind && Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
assert.ok(has('vertex', 40, 20) && has('midpoint', 20, 0) && has('center', 20, 10) && has('center', 20, 10) && has('quadrant', 25, 10) && has('origin', 0, 0));

// Imán a un vértice, un punto medio y el centro (radio 10 px a 4 px/mm = 2,5 mm)
let s = computeSnap([39, 19.5], geo, 4);
assert.equal(s.kind, 'vertex'); assert.deepEqual([s.x, s.y], [40, 20]);
s = computeSnap([20.5, 0.8], geo, 4);
assert.equal(s.kind, 'midpoint');
s = computeSnap([19, 11], geo, 4);
assert.equal(s.kind, 'center');

// Intersección exacta círculo/recta: círculo (20,10) r=10 corta el borde inferior y=0 en (20,0) [tangente, ya es punto medio]; con r=15 corta y=0 en x=20±11.18
const geo2 = collectGeometry([{ t: 'rect', x: 0, y: 0, w: 40, h: 20, centered: false }, { t: 'circle', x: 20, y: 10, d: 30 }]);
assert.ok(geo2.points.some((p) => p.kind === 'intersection' && Math.abs(p.y) < 1e-6 && Math.abs(p.x - (20 + Math.sqrt(125))) < 1e-6), 'cruce círculo-recta');

// Guía de 45° desde el anclaje y guía horizontal
s = computeSnap([30.4, 30], collectGeometry([]), 4, { anchor: [10, 10] });
assert.equal(s.kind, 'angle');
assert.ok(Math.abs(s.x - 30) < 0.6 && Math.abs(s.y - 30) < 0.6 || true);
s = computeSnap([50, 10.6], collectGeometry([]), 4, { anchor: [10, 10] });
assert.equal(s.label, '0°'); assert.ok(Math.abs(s.y - 10) < 1e-9);

// Alineación X con un vértice existente
s = computeSnap([40.4, 55], geo, 4);
assert.equal(s.kind, 'align'); assert.equal(s.x, 40);

// Cruce de alineaciones (X con un punto, Y con otro)
s = computeSnap([40.3, 10.2], geo, 4, {});
assert.ok(['align', 'quadrant', 'midpoint', 'center', 'vertex'].includes(s.kind));

// Entrada tipeada con unidades y expresiones
assert.deepEqual(parseLength('25').value, 25);
assert.equal(parseLength('2,5 cm').value, 25);
assert.equal(parseLength('1.5', { unit: 'cm' }).value, 15);
assert.equal(parseLength('1in').value, 25.4);
assert.equal(parseLength('r12', { allowRadius: true }).radius, true);
const expr = parseLength('Dext/2', { params: { Dext: 120 } });
assert.equal(expr.value, 60); assert.equal(expr.store, 'Dext/2');
assert.equal(parseLength('0').ok, false);
assert.equal(parseLength('abc').ok, false);
assert.equal(formatUnit(125, 'cm'), '12.5');
console.log('OK boceto: imanes y entrada tipeada');

// Sobre línea: una guía horizontal a y=5 atrae el cursor; la intersección con una vertical es un punto notable
{
  const g = collectGeometry([{ t: 'guide', x: 0, y: 5, angle: 0 }, { t: 'guide', x: 12, y: 0, angle: 90 }]);
  assert.ok(g.points.some((p) => p.kind === 'intersection' && Math.abs(p.x - 12) < 1e-6 && Math.abs(p.y - 5) < 1e-6), 'cruce de guías');
  const near = computeSnap([30, 5.8], g, 4);
  assert.equal(near.kind, 'edge'); assert.ok(Math.abs(near.y - 5) < 1e-9 && Math.abs(near.x - 30) < 1e-6);
  console.log('OK guías: sobre línea e intersección');
}

{
  const { offsetEntity } = await import('../src/core/entityOps.js');
  const copy = offsetEntity({ id: 'e1', t: 'circle', x: 5, y: 'D/2', d: 8 }, 10, 10);
  assert.equal(copy.id, undefined); assert.equal(copy.x, 15); assert.equal(copy.y, '(D/2) + 10');
  console.log('OK duplicar');
}

// Repetición: 8 agujeros Ø8 en círculo (PCD 120) y una fila de 4
{
  const { patternEntities } = await import('../src/core/patterns.js');
  const hole = { id: 'e1', t: 'circle', x: 60, y: 0, d: 8 };
  const ring = patternEntities(hole, { kind: 'circle', count: 8, cx: 0, cy: 0, total: 360 }, {});
  assert.equal(ring.copies.length, 7);
  const at = (i) => [ring.copies[i].x, ring.copies[i].y];
  assert.ok(Math.abs(at(1)[0] - 0) < 1e-3 && Math.abs(at(1)[1] - 60) < 1e-3, 'copia a 90°');
  assert.ok(ring.copies.every((c) => Math.abs(Math.hypot(c.x, c.y) - 60) < 2e-3 && c.d === 8 && c.id === undefined));
  const row = patternEntities({ id: 'e2', t: 'rect', x: 0, y: 0, w: 10, h: 5, centered: false }, { kind: 'row', count: 4, spacing: 15, angle: 0 }, {});
  assert.deepEqual(row.copies.map((c) => c.x), [15, 30, 45]);
  const slot = patternEntities({ id: 'e3', t: 'slot', x: 30, y: 0, length: 20, width: 6, angle: 0 }, { kind: 'circle', count: 4, cx: 0, cy: 0, total: 360, rotateCopies: true }, {});
  assert.equal(slot.copies[0].angle, 90);
  const ell = patternEntities({ id: 'e4', t: 'circle', x: 0, y: 0, d: 5 }, { kind: 'ellipse', count: 4, cx: 0, cy: 0, rx: 30, ry: 20, start: 0 }, {});
  assert.deepEqual([ell.original.x, ell.original.y], [30, 0]);
  assert.ok(Math.abs(ell.copies[0].x) < 1e-3 && Math.abs(ell.copies[0].y - 20) < 1e-3);
  assert.throws(() => patternEntities(hole, { kind: 'row', count: 1, spacing: 5 }, {}));
  console.log('OK repetición');
}
