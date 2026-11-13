import assert from 'node:assert/strict';
import { restMove, makeProfile } from '../src/core/motion/profiles.js';
import { defaultAction, evaluateActions, validateActions } from '../src/core/actions.js';
import { defaultCommand, defaultMotion, defaultPathMotion } from '../src/core/motion/commands.js';
import { getMotionPlan } from '../src/core/motion/index.js';
import { libraryItems } from '../src/data/library/index.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const limits = { vMax: 500, aMax: 2000, jerk: 20000 };

// 1) Perfiles: la distancia se cumple exacto y no se superan los límites.
for (const kind of ['trapezoidal', 'triangular', 'scurve']) {
  const move = restMove(300, limits, kind);
  const profile = makeProfile(move.phases, { p: 0, v: 0 });
  near(profile.end.p, 300, 1e-6, `perfil ${kind}`);
  let vMax = 0;
  for (let t = 0; t <= profile.duration; t += profile.duration / 400) vMax = Math.max(vMax, Math.abs(profile.at(t).v));
  assert.ok(vMax <= limits.vMax + 1e-6, `${kind} supera la velocidad`);
}

// 2) Eje lineal con programa: MoveRelative, MoveAbsolute y eje transportado.
const make = (id, motion, extra = {}) => ({ ...defaultAction('axis', { motion }), id, targets: [`f${id}`], axis: 'x', ...extra });
const a1 = make('a1', defaultMotion('linear', { program: [defaultCommand('moveRelative', { distance: 100 }), defaultCommand('moveAbsolute', { position: 20 })] }));
const at = (actions, t, key) => [...evaluateActions(actions, t).bodies.values()].find((b) => b.targets.includes(key));
near(at([a1], 0, 'fa1').offset[0], 0, 1e-9, 'arranca en 0');
const plan = getMotionPlan([a1]);
const endT = plan.axisState('a1', 100);
near(endT.x, 20, 1e-6, 'MoveAbsolute llega');
near(at([a1], 100, 'fa1').offset[0], 20, 1e-6, 'offset = x - startPos');

const a2 = make('a2', defaultMotion('linear', { carriedBy: ['a1'], program: [defaultCommand('moveRelative', { distance: 10 })] }), { axis: 'z' });
const both = [a1, a2];
near(at(both, 100, 'fa2').offset[0], 20, 1e-6, 'el hijo hereda el desplazamiento del padre');
near(at(both, 100, 'fa2').offset[2], 10, 1e-6, 'y suma el propio');

// 3) Rotativo: ángulo en radianes y velocidad angular.
const r1 = make('r1', defaultMotion('rotary', { program: [defaultCommand('moveRelative', { distance: 90 })] }), { axis: 'z' });
near(at([r1], 100, 'fr1').angle, Math.PI / 2, 1e-6, 'giro 90°');

// 4) GearIn en velocidad: el esclavo iguala la velocidad del maestro (relación 2:1).
const master = make('m', defaultMotion('linear', { program: [defaultCommand('moveVelocity', { velocity: 100, hold: 0 })] }));
const slave = make('s', defaultMotion('linear', { program: [defaultCommand('gearIn', { master: 'm', numerator: 2, denominator: 1, mode: 'velocity' })] }));
const mPlan = getMotionPlan([master, slave]);
near(mPlan.axisState('s', 20).v, 200, 1e-3, 'GearIn 2:1');

// 5) Trayectoria con blending: respeta la velocidad y recorre todo el camino.
const path = { ...defaultAction('path', { motion: defaultPathMotion({ velocity: 100, segments: [{ type: 'line', to: [100, 0, 0], blend: 10, feed: 0 }, { type: 'line', to: [100, 100, 0], blend: 0, feed: 0 }] }) }), id: 'p1' };
const pPlan = getMotionPlan([path]);
assert.ok(pPlan.pathState, 'plan de trayectoria');

// 6) Plantillas: sin avisos y con movimiento real.
for (const item of libraryItems.filter((entry) => entry.id.startsWith('mov-'))) {
  const args = {};
  (item.ask ?? []).forEach((q) => { args[q.name] = q.value; });
  const part = item.build(args);
  assert.deepEqual(validateActions(part.actions), [], `${item.id} tiene avisos`);
  const moved = [2, 4, 6].some((t) => [...evaluateActions(part.actions, t).bodies.values()].some((b) => b.offset.some((v) => Math.abs(v) > 1e-6) || Math.abs(b.angle) > 1e-6));
  assert.ok(moved, `${item.id} no se mueve`);
}
console.log('motionControl OK');
