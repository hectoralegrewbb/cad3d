import assert from 'node:assert/strict';
import { createRotor, defaultRotorParams, stepRotor, frictionTorque } from '../src/particles/rotor.js';

const run = (params, target, load, seconds, dt = 0.002) => {
  const r = createRotor();
  for (let t = 0; t < seconds; t += dt) stepRotor(r, params, target, typeof load === 'function' ? load(t, r) : load, dt);
  return r;
};
const p = { ...defaultRotorParams(), inertia: 0.05, torqueMax: 4 };
const target = (60 * 2 * Math.PI) / 60; // 60 rpm

// 1) arranca y llega a la velocidad pedida (sin carga, la fricción deja un pequeño error)
let r = run(p, target, 0, 4);
assert.ok(Math.abs(r.omega - target) / target < 0.05, `régimen ${r.omega}`);

// 2) carga mayor al par máximo: el eje se frena (no llega al objetivo) y el motor satura
r = run(p, target, 6, 3);
assert.ok(r.omega < 0.5 * target, `debería frenarse: ${r.omega}`);

// 3) carga moderada: velocidad algo menor (deslizamiento) y par motor ≈ carga + fricción
r = run(p, target, 2, 4);
assert.ok(r.omega < target && r.omega > 0.7 * target, `deslizamiento ${r.omega}`);
assert.ok(Math.abs(r.motorTorque - (2 + r.frictionTorque)) < 0.15, `balance de pares ${r.motorTorque} vs ${2 + r.frictionTorque}`);

// 4) adherencia: motor apagado y carga menor al par estático → no se mueve
r = run(p, 0, 0.1, 1);
assert.equal(r.omega, 0);
assert.ok(r.stuck);

// 5) motor apagado y girando: frena por fricción y se detiene sin oscilar
const spin = createRotor();
spin.omega = 5;
let sign = 0;
for (let t = 0; t < 20; t += 0.002) {
  stepRotor(spin, p, 0, 0, 0.002);
  assert.ok(spin.omega >= -1e-9, `no debe invertir el giro: ${spin.omega}`);
}
assert.equal(spin.omega, 0);

// 6) estable con inercia muy chica y paso grande
r = run({ ...p, inertia: 1e-5 }, target, 1, 1, 0.005);
assert.ok(Number.isFinite(r.omega) && Math.abs(r.omega) < 3 * target, `estabilidad ${r.omega}`);

// 7) Stribeck: el par de fricción baja del estático al de Coulomb al aumentar la velocidad
assert.ok(frictionTorque({ ...p, viscous: 0 }, 0.01) > frictionTorque({ ...p, viscous: 0 }, 5));
console.log('rotor ok');
