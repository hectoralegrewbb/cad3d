import assert from 'node:assert/strict';
import { defaultAction, evaluateActions, resolveStarts, validateActions } from '../src/core/actions.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const slide = defaultAction('slide', { id: 'a1', targets: ['extrude2'], axis: 'z', from: 0, to: 20, duration: 2, start: { type: 'time', t: 1 } });
const flap = defaultAction('rotate', { id: 'a2', targets: ['extrude3'], axis: 'y', pivot: [5, 0, 0], from: 0, to: 90, duration: 1, start: { type: 'after', action: 'a1', delay: 0.5 } });
const fan = defaultAction('rotate', { id: 'a3', targets: ['screw1'], mode: 'continuous', rpm: 60, start: { type: 'time', t: 0 } });
const air = defaultAction('air', { id: 'a4', nozzle: 'n1', level: 0.8, duration: 1, start: { type: 'exited', n: 10, delay: 0 } });
const actions = [slide, flap, fan, air];

// arranque encadenado
const starts = resolveStarts(actions, { exitTime: (n) => (n === 10 ? 4 : null) });
assert.equal(starts.get('a1'), 1);
close(starts.get('a2'), 3.5);
assert.equal(starts.get('a4'), 4);
assert.equal(resolveStarts(actions, { exitTime: () => null }).get('a4'), null);

// deslizamiento: antes, a mitad (suavizado simétrico) y al final
const at = (t, ctx) => evaluateActions(actions, t, ctx);
const pose = (t, key, ctx) => at(t, ctx).bodies.find((body) => body.key === key);
assert.equal(pose(0.5, 'extrude2').offset[2], 0);
close(pose(2, 'extrude2').offset[2], 10);
close(pose(9, 'extrude2').offset[2], 20);
assert.ok(pose(2, 'extrude2').vel[2] > 0 && pose(9, 'extrude2').vel[2] === 0);

// clapeta: barrido 0→90° tras el deslizamiento
close(pose(3.4, 'extrude3').angle, 0);
close(pose(9, 'extrude3').angle, Math.PI / 2);
assert.deepEqual(pose(9, 'extrude3').pivot, [5, 0, 0]);

// giro continuo
close(pose(2.5, 'screw1').angle, 2.5 * 2 * Math.PI);
close(pose(2.5, 'screw1').omega, 2 * Math.PI);

// aire: sin disparar no aparece; luego rampa hasta el nivel
assert.equal(at(5, { exitTime: () => null }).nozzles.n1, undefined);
close(at(10, { exitTime: () => 4 }).nozzles.n1, 0.8);

// ida y vuelta
const ping = defaultAction('slide', { id: 'p', targets: ['x'], from: 0, to: 10, duration: 1, loop: 'pingpong' });
close(evaluateActions([ping], 1).bodies[0].offset[2], 10);
close(evaluateActions([ping], 2).bodies[0].offset[2], 0);
close(evaluateActions([ping], 1.5).bodies[0].offset[2], 5);

// ciclo de disparos: no arranca (sin colgarse)
const loopA = defaultAction('slide', { id: 'c1', targets: ['x'], start: { type: 'after', action: 'c2' } });
const loopB = defaultAction('slide', { id: 'c2', targets: ['x'], start: { type: 'after', action: 'c1' } });
assert.equal(resolveStarts([loopA, loopB]).get('c1'), null);

// avisos
assert.equal(validateActions([defaultAction('slide', { id: 'v', targets: [] })]).length, 1);
assert.equal(validateActions([slide, { ...slide, id: 'z', targets: ['extrude2', 'otro'] }]).length, 1);
{
  const vib = defaultAction('vibrate', { id: 'v', targets: ['c'], axis: [1, 0, 0], amp: 2, freq: 10, start: { type: 'time', t: 0 } });
  const at = (t) => evaluateActions([vib], t).bodies[0];
  assert.equal(at(0).offset[0], 0);
  const peak = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(at(1 + i * 0.001).offset[0])));
  assert.ok(Math.abs(peak - 2) < 0.02, `amplitud ${peak}`);
  assert.ok(at(0.025 + 1).vel[0] !== 0);
}

// ---- válvula temporizada: abre → queda abierta → cierra (→ cerrada → repite) ----
{
  const near = (a, b, tol = 1e-6, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} vs ${b}`);
  const valve = defaultAction('slide', { id: 'v', targets: ['x'], mode: 'valve', from: 0, to: 40, openTime: 2, holdOpen: 3, closeTime: 1, closedHold: 4, start: { type: 'time', t: 1 } });
  const at = (t, a = valve) => evaluateActions([a], t).bodies[0];
  near(at(0.5).offset[2], 0, 1e-9, 'antes de arrancar: cerrada');
  near(at(1).offset[2], 0, 1e-9, 'justo al arrancar');
  near(at(2).offset[2], 20, 1e-6, 'a mitad de la apertura (suavizada) = mitad del recorrido');
  near(at(3).offset[2], 40, 1e-9, 'abierta');
  near(at(5.9).offset[2], 40, 1e-9, 'sigue abierta durante el tiempo abierta');
  near(at(6.5).offset[2], 20, 1e-6, 'cerrando: mitad');
  near(at(7).offset[2], 0, 1e-9, 'cerrada otra vez');
  near(at(30).offset[2], 0, 1e-9, 'una sola vez: queda cerrada');
  assert.ok(at(1.5).vel[2] > 0 && at(6.4).vel[2] < 0, 'la velocidad cambia de signo al cerrar');
  // repetida: ciclo = 2 + 3 + 1 + 4 = 10 s
  const rep = { ...valve, loop: 'loop' };
  near(at(3, rep).offset[2], 40); near(at(13, rep).offset[2], 40, 1e-9, 'segundo ciclo abierto'); near(at(9.5, rep).offset[2], 0, 1e-9, 'cerrada entre ciclos');
  near(at(16.5, rep).offset[2], 20, 1e-6, 'segundo ciclo cerrando');
  // holdOpen = 0: abre y se queda abierta
  const stay = { ...valve, holdOpen: 0 };
  near(at(3, stay).offset[2], 40); near(at(99, stay).offset[2], 40, 1e-9, 'queda abierta'); near(at(99, stay).vel[2], 0, 1e-9);
  // válvula giratoria (clapeta): grados
  const flap = defaultAction('rotate', { id: 'f', targets: ['y'], mode: 'valve', from: 0, to: 90, openTime: 1, holdOpen: 1, closeTime: 1, start: { type: 'time', t: 0 } });
  near(evaluateActions([flap], 1.5).bodies[0].angle, Math.PI / 2, 1e-9, 'abierta 90°');
  near(evaluateActions([flap], 3.5).bodies[0].angle, 0, 1e-9, 'cerrada');
  // encadenar: «al terminar» espera abre + abierta + cierra
  const next = defaultAction('slide', { id: 'n', targets: ['z'], start: { type: 'after', action: 'v', delay: 0.5 } });
  near(resolveStarts([valve, next]).get('n'), 1 + 6 + 0.5, 1e-9, 'arranca cuando la válvula terminó de cerrar');
  const nextStay = { ...next, start: { type: 'after', action: 'v', delay: 0 } };
  near(resolveStarts([stay, nextStay]).get('n'), 1 + 2, 1e-9, 'si queda abierta, la siguiente arranca al terminar de abrir');
  near(resolveStarts([rep, nextStay]).get('n'), 1, 1e-9, 'una válvula repetida nunca termina: la siguiente arranca con ella');
}
console.log('actions.test OK');
// disparo por sensor
{
  const zone = defaultAction('slide', { id: 'z', targets: ['x'], start: { type: 'zone', sensor: 's1', n: 50, delay: 1 } });
  assert.equal(resolveStarts([zone], { zoneTime: () => null }).get('z'), null);
  assert.equal(resolveStarts([zone], { zoneTime: (s, n) => (s === 's1' && n === 50 ? 3 : null) }).get('z'), 4);
  assert.equal(validateActions([defaultAction('slide', { id: 'q', targets: ['x'], start: { type: 'zone', sensor: null } })]).length, 1);
}
console.log('actions.zone OK');
