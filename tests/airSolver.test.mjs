import assert from 'node:assert/strict';
import { AirSolver, fractionInside } from '../src/particles/airSolver.js';

// Validación del aire contra soluciones analíticas. Las tolerancias son las del método (grilla de 30 000 celdas): primer orden
// de ingeniería, no CFD de detalle. Con más celdas el error baja (ver docs/DESARROLLO.md).

// 1) fracción de cuadrado dentro del sólido: casos exactos
{
  assert.equal(fractionInside(-1, -1, -1, -1), 1);
  assert.equal(fractionInside(1, 1, 1, 1), 0);
  assert.ok(Math.abs(fractionInside(-1, 1, 1, -1) - 0.5) < 1e-12, 'mitad');
  assert.ok(Math.abs(fractionInside(-1, 1, 1, 1) - 0.125) < 1e-12, 'esquina: triángulo de lados 1/2');
  assert.ok(Math.abs(fractionInside(1, -1, -1, -1) - 0.875) < 1e-12, 'esquina opuesta');
  // área de un disco muestreada con la fracción por celda ≈ π r²
  const r = 3.3;
  const n = 14;
  const h = 1;
  const phi = (x, y) => Math.hypot(x - n / 2, y - n / 2) - r;
  let area = 0;
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) area += fractionInside(phi(i * h, j * h), phi((i + 1) * h, j * h), phi((i + 1) * h, (j + 1) * h), phi(i * h, (j + 1) * h));
  assert.ok(Math.abs(area / (Math.PI * r * r) - 1) < 0.02, `disco ${area / (Math.PI * r * r)}`);
}

// Tubo axisimétrico a lo largo de X rodeado de una losa maciza (SDF con signo real).
const L = 300;
const pipeBody = (radiusOf) => ({ distance: (x, y, z) => Math.max(Math.max(-x, x - L), radiusOf(Math.min(L, Math.max(0, x))) - Math.hypot(y, z)) });
const makeSolver = (radiusOf, rMax, options = {}) => new AirSolver({ lo: [-30, -rMax - 15, -rMax - 15], hi: [L + 30, rMax + 15, rMax + 15], bodies: [pipeBody(radiusOf)], cells: 30000, ...options });
const settle = (solver, maxSteps = 700) => solver.solveSteady({ maxSteps, tolerance: 6e-3 });
const section = (solver, x, R) => solver.readBox([x, 0, 0], [6, 2 * R, 2 * R]);

// 2) Venturi 60 → 30 mm de diámetro: Δp entre la sección de entrada y la garganta contra Bernoulli
{
  const R1 = 30;
  const R2 = 15;
  const radiusOf = (x) => (x < 60 ? R1 : x < 120 ? R1 + ((R2 - R1) * (x - 60)) / 60 : x < 150 ? R2 : R2 + ((R1 - R2) * (x - 150)) / 150);
  const solver = makeSolver(radiusOf, R1);
  const inletSpeed = 8;
  const flow = inletSpeed * Math.PI * (R1 / 1000) ** 2;
  solver.setInlets([{ pos: [15, 0, 0], dir: [1, 0, 0], radius: R1, flow }]);
  assert.deepEqual(solver.warnings, []);
  const result = settle(solver);
  assert.ok(solver.delta < 0.02, `el campo debe estacionarse (delta ${solver.delta})`);
  assert.ok(solver.maxSpeed() < 4.5 * inletSpeed * (R1 / R2) ** 2 / 4, `sin explosión: vmax ${solver.maxSpeed()}`);
  const inlet = section(solver, 45, R1);
  const throat = section(solver, 135, R2);
  const outlet = section(solver, 255, R1);
  // conservación de masa en cada sección completa (±4 %)
  [inlet, throat, outlet].forEach((reading, index) => assert.ok(Math.abs(reading.flow / flow - 1) < 0.04, `caudal en la sección ${index}: ${reading.flow / flow}`));
  // la velocidad media de la garganta es la de continuidad (±4 %)
  const throatMean = throat.flow / (Math.PI * (R2 / 1000) ** 2);
  assert.ok(Math.abs(throatMean / (inletSpeed * (R1 / R2) ** 2) - 1) < 0.04);
  const ideal = 0.5 * 1.2 * ((inletSpeed * (R1 / R2) ** 2) ** 2 - inletSpeed ** 2);
  const measured = inlet.pressure - throat.pressure;
  assert.ok(measured > ideal * 0.95 && measured < ideal * 1.4, `Δp ${measured.toFixed(0)} Pa contra Bernoulli ${ideal.toFixed(0)} Pa`);
  // el difusor recupera presión pero MENOS que el ideal (≈40 %): sin capa límite resuelta el flujo se desprende en el cono
  // (límite conocido, ver docs/DESARROLLO.md). Se fija una cota inferior para detectar regresiones.
  assert.ok(outlet.pressure > throat.pressure + 0.25 * ideal, `recuperación de presión en el difusor: ${(outlet.pressure - throat.pressure).toFixed(0)} Pa`);
  assert.ok(result.steps < 800);
}

// 3) tubo recto con fricción de pared: Δp = f·(L/D)·½ρv² con f = 4·Cf
{
  const R = 25;
  const cf = 0.02;
  const solver = makeSolver(() => R, R, { wallFriction: cf, smagorinsky: 0.12 });
  const speed = 15;
  solver.setInlets([{ pos: [15, 0, 0], dir: [1, 0, 0], radius: R, flow: speed * Math.PI * (R / 1000) ** 2 }]);
  settle(solver);
  const upstream = section(solver, 70, R);
  const downstream = section(solver, 250, R);
  const expected = 4 * cf * (180 / (2 * R)) * 0.5 * 1.2 * speed ** 2;
  const measured = upstream.pressure - downstream.pressure;
  assert.ok(measured > expected * 0.6 && measured < expected * 1.6, `pérdida por fricción ${measured.toFixed(1)} Pa contra ${expected.toFixed(1)} Pa`);
}

// 4) soplador por presión: plenum a P Pa que descarga por un tubo a la atmósfera → v ≈ √(2P/ρ) (menos pérdidas de entrada)
{
  const R = 20;
  const P = 500;
  const solver = makeSolver(() => R, R);
  solver.setInlets([{ pos: [10, 0, 0], dir: [1, 0, 0], radius: R, pressure: P }]);
  assert.deepEqual(solver.warnings, []);
  settle(solver);
  const mid = section(solver, 150, R);
  const ideal = Math.sqrt((2 * P) / 1.2);
  const mean = mid.flow / (Math.PI * (R / 1000) ** 2);
  assert.ok(mean > ideal * 0.7 && mean < ideal * 1.1, `velocidad ${mean.toFixed(1)} m/s contra ${ideal.toFixed(1)} m/s`);
}

// 5) una boca que no toca el aire avisa y no rompe nada
{
  const solver = makeSolver(() => 20, 20);
  solver.setInlets([{ pos: [150, 200, 0], dir: [1, 0, 0], radius: 5, flow: 0.001 }]);
  assert.ok(solver.warnings.length >= 1);
  settle(solver, 20);
  assert.ok(solver.maxSpeed() === 0 || Number.isFinite(solver.maxSpeed()));
}

console.log('airSolver.test OK');
