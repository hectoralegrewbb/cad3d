import assert from 'node:assert/strict';
import { createTouchGestures } from '../src/ui/touchGestures.js';

const target = new EventTarget();
const log = [];
const gestures = createTouchGestures(target, {
  onTap: (e) => log.push(['tap', e.clientX, e.clientY]),
  onDoubleTap: () => log.push(['double']),
  canDrag: (e) => e.clientX < 50,
  onDragStart: () => log.push(['dragStart']),
  onDragMove: (e) => log.push(['dragMove', e.clientX]),
  onDragEnd: () => log.push(['dragEnd']),
  onDragCancel: () => log.push(['dragCancel']),
  onPan: (dx, dy) => log.push(['pan', dx, dy]),
  onPinch: (g) => log.push(['pinch', g.scale, g.dx, g.dy]),
  onGestureStart: () => log.push(['gStart']),
  onGestureEnd: () => log.push(['gEnd']),
});
let reachedLaterListener = 0;
target.addEventListener('pointerdown', () => reachedLaterListener++);
const fire = (type, id, x, y, pointerType = 'touch') => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: id, pointerType, clientX: x, clientY: y }));
const take = () => log.splice(0);

// Mouse/lápiz no pasan por los gestos y los demás oyentes los reciben.
fire('pointerdown', 1, 10, 10, 'mouse'); fire('pointerup', 1, 10, 10, 'mouse');
assert.deepEqual(take(), []); assert.equal(reachedLaterListener, 1);

// Tocar = clic, y el toque no llega crudo a los oyentes del editor.
fire('pointerdown', 1, 200, 80); fire('pointerup', 1, 203, 82);
assert.deepEqual(take(), [['tap', 203, 82]]); assert.equal(reachedLaterListener, 1);

// Doble toque (cerrar polilínea): tap, tap + double.
await new Promise((r) => setTimeout(r, 340));
fire('pointerdown', 1, 200, 80); fire('pointerup', 1, 200, 80); take();
fire('pointerdown', 1, 201, 81); fire('pointerup', 1, 201, 81);
assert.deepEqual(take(), [['tap', 201, 81], ['double']]);
await new Promise((r) => setTimeout(r, 340));

// Un dedo arrastrando fuera de lo seleccionado = mover la vista, sin ningún clic.
fire('pointerdown', 1, 200, 80); fire('pointermove', 1, 230, 80); fire('pointermove', 1, 240, 90); fire('pointerup', 1, 240, 90);
assert.deepEqual(take(), [['pan', 30, 0], ['pan', 10, 10]]);

// Un dedo sobre lo arrastrable (canDrag) mueve el objeto.
fire('pointerdown', 1, 20, 20); fire('pointermove', 1, 40, 20); fire('pointermove', 1, 45, 20); fire('pointerup', 1, 45, 20);
assert.deepEqual(take(), [['dragStart'], ['dragMove', 40], ['dragMove', 45], ['dragEnd']]);

// Segundo dedo durante un arrastre: se cancela la edición y pasa a zoom/desplazamiento.
fire('pointerdown', 1, 20, 20); fire('pointermove', 1, 40, 20); take();
fire('pointerdown', 2, 120, 20);
assert.deepEqual(take(), [['dragCancel'], ['gStart']]);
fire('pointermove', 2, 220, 20); // separación 100 → 200 (x2); centroide se desplaza 50 en x
const pinch = take()[0];
assert.equal(pinch[0], 'pinch'); assert.ok(Math.abs(pinch[1] - 100 / 80) < 1e-9 || pinch[1] > 1);
fire('pointerup', 2, 220, 20);
// El dedo que queda no genera clic ni arrastre.
fire('pointermove', 1, 60, 20); fire('pointerup', 1, 60, 20);
assert.deepEqual(take(), [['gEnd']]);

// Dos dedos sin soltar a la vez: ningún toque residual.
fire('pointerdown', 1, 100, 100); fire('pointerdown', 2, 160, 100); take();
fire('pointerup', 1, 100, 100); fire('pointerup', 2, 160, 100);
assert.deepEqual(take(), [['gEnd']]);

// pointercancel no produce clic.
fire('pointerdown', 1, 200, 80); fire('pointercancel', 1, 200, 80);
assert.deepEqual(take(), []);

gestures.dispose();
console.log('touchGestures: toque, doble toque, mover vista, arrastre, zoom de dos dedos y cancelación OK (sin layout real)');
