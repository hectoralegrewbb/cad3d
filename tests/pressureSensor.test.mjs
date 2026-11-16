import assert from 'node:assert/strict';
import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim, materialPresets } from '../src/particles/sim.js';

// Tubo horizontal (eje X) de pared gruesa como malla cerrada: aire calculado + granos + acople en ambos sentidos.
const tubeMesh = ({ inner = 15, outer = 20, length = 200, segments = 28 } = {}) => {
  const vertices = [];
  const triangles = [];
  const ring = (x, radius) => {
    const base = vertices.length / 3;
    for (let k = 0; k < segments; k += 1) {
      const a = (k / segments) * 2 * Math.PI;
      vertices.push(x, radius * Math.cos(a), radius * Math.sin(a));
    }
    return base;
  };
  const oa = ring(0, outer);
  const ob = ring(length, outer);
  const ia = ring(0, inner);
  const ib = ring(length, inner);
  const quad = (a, b) => {
    for (let k = 0; k < segments; k += 1) {
      const n = (k + 1) % segments;
      triangles.push(a + k, b + k, b + n, a + k, b + n, a + n);
    }
  };
  quad(oa, ob);
  quad(ib, ia);
  quad(oa, ia);
  quad(ib, ob);
  return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles) };
};

import { resolveStarts, validateActions } from '../src/core/actions.js';
import { sceneOps, simSensors, emptyScene } from '../src/core/scene.js';
import { defaultPressureSensor, formatPressure, fromUnit, lagFactor, measurePressure, pressureCrossed, toUnit } from '../src/core/pressureSensor.js';
import { RunRecorder } from '../src/particles/recorder.js';

// ---------- lógica pura ----------
assert.equal(formatPressure(1234.4, 'Pa'), '1234 Pa');
assert.equal(formatPressure(250, 'mbar'), '2,50 mbar');
assert.equal(formatPressure(98.0665, 'mmca'), '10,0 mmca');
assert.equal(formatPressure(NaN, 'Pa'), '—');
assert.ok(Math.abs(fromUnit(toUnit(777, 'mmca'), 'mmca') - 777) < 1e-9);
{
  const tap = { pressure: 300, speed: 20 };
  const ref = { pressure: 120, speed: 5 };
  assert.equal(measurePressure('estatica', tap, null).value, 300);
  assert.equal(measurePressure('total', tap, null, 1.2).value, 300 + 0.5 * 1.2 * 400);
  assert.equal(measurePressure('diferencial', tap, ref).value, 180);
  assert.equal(measurePressure('diferencial', tap, null).valid, false, 'diferencial sin la toma (−) no mide');
  assert.equal(measurePressure('estatica', null, null).valid, false);
  assert.equal(lagFactor(1, 0), 1, 'sin tiempo de respuesta la lectura es instantánea');
  assert.ok(Math.abs(lagFactor(0.2, 0.2) - (1 - Math.exp(-1))) < 1e-12, 'en un τ recorre el 63 % del salto');
  assert.ok(pressureCrossed(500, '>=', 400) && !pressureCrossed(300, '>=', 400) && pressureCrossed(300, '<=', 400) && !pressureCrossed(null, '<=', 400));
}
// escena: se agrega como sensor con kind 'presion', el simulador recibe tomas y los disparos lo validan
{
  let scene = emptyScene();
  const zone = sceneOps.addSensor(scene, {});
  scene = zone.scene;
  const gauge = sceneOps.addSensor(scene, { kind: 'presion', center: [1, 2, 3] });
  scene = gauge.scene;
  assert.equal(scene.sensors[1].kind, 'presion');
  assert.equal(scene.sensors[1].name, 'Presión 2');
  const [simZone, simGauge] = simSensors(scene);
  assert.ok(simZone.min && simZone.max && !simZone.kind, 'el sensor de zona no cambia');
  assert.deepEqual({ kind: simGauge.kind, pos: simGauge.pos, mode: simGauge.mode, tau: simGauge.tau }, { kind: 'presion', pos: [1, 2, 3], mode: 'estatica', tau: 0.2 });
  const action = { id: 'a1', name: 'Corte', kind: 'move', targets: ['f1'], start: { type: 'pressure', sensor: gauge.id, op: '>=', value: 400 } };
  assert.equal(validateActions([action], { targetIds: [], nozzleIds: [], sensorIds: [gauge.id] }).some((w) => w.includes('sensor')), false);
  assert.ok(validateActions([{ ...action, start: { ...action.start, sensor: null } }], { targetIds: [], nozzleIds: [], sensorIds: [gauge.id] }).some((w) => w.includes('sensor')));
  assert.equal(sceneOps.removeSensor({ ...scene, actions: [action] }, gauge.id).actions[0].start.sensor, null, 'borrar el sensor desarma el disparo');
  assert.equal(resolveStarts([action], { pressureTime: () => 2.5 }).get('a1'), 2.5);
  assert.equal(resolveStarts([{ ...action, start: { ...action.start, delay: 1 } }], { pressureTime: () => 2.5 }).get('a1'), 3.5);
  assert.equal(resolveStarts([action], { pressureTime: () => null }).get('a1'), null, 'sin cruzar el umbral no arranca');
}

// ---------- en la simulación: caño Ø30 × 200 con soplador de 20 m³/h (≈ 7,9 m/s) ----------
const mesh = tubeMesh();
const sdf = buildSdf(mesh.vertices, mesh.triangles, { cell: 1.2, band: 6 });
const gauges = [
  defaultPressureSensor({ id: 's1', center: [60, 0, 0], mode: 'estatica', tau: 0 }),
  defaultPressureSensor({ id: 's2', center: [160, 0, 0], mode: 'estatica', tau: 0 }),
  defaultPressureSensor({ id: 's3', center: [60, 0, 0], ref: [160, 0, 0], mode: 'diferencial', tau: 0 }),
  defaultPressureSensor({ id: 's4', center: [60, 0, 0], mode: 'total', tau: 0 }),
  defaultPressureSensor({ id: 's5', center: [60, 0, 0], mode: 'estatica', tau: 0.5 }),
  defaultPressureSensor({ id: 's6', center: [5000, 0, 0], mode: 'estatica' }), // fuera del aire calculado
];
const zoneBox = { id: 'z1', name: 'zona', center: [100, 0, 0], size: [10, 34, 34], counts: 'granos' };
const actions = [
  { id: 'a1', name: 'presostato alto', kind: 'air', targets: [], start: { type: 'pressure', sensor: 's4', op: '>=', value: 5 } },
  { id: 'a2', name: 'presostato imposible', kind: 'air', targets: [], start: { type: 'pressure', sensor: 's4', op: '>=', value: 1e7 } },
];
const sim = new ParticleSim([{ sdf, mesh, movable: false }], { ...materialPresets.arena, radius: 0.6, gravity: 0, rate: 0, cap: 100, airModel: 'calculado', airSolverCells: 12000, emitter: { center: [25, 0, 0], size: [2, 8, 8] }, floorZ: -500 });
sim.setScene({
  actions,
  nozzles: [{ id: 'n1', pos: [8, 0, 0], dir: [1, 0, 0], speed: 0, range: 100, radius: 15, tan: 0, controlled: false, bc: 'caudal', flow: 20, pressure: 0 }],
  sensors: simSensors({ sensors: [...gauges, zoneBox] }),
});
for (let n = 0; n < 300 && sim.airPending(); n += 1) sim.solveAirSlice(50);
assert.equal(sim.airPending(), false);
assert.deepEqual(sim.airInfo().readings, {}, 'antes del primer paso no hay lecturas');
sim.step(1 / 60);
const first = sim.airInfo().readings;
for (let n = 0; n < 60; n += 1) sim.step(1 / 60);
const r = sim.airInfo().readings;
// las seis tomas reportan, y el sensor de zona conserva su lectura de caja (p, v, Q)
['s1', 's2', 's3', 's4', 's5'].forEach((id) => assert.ok(r[id]?.valid && Number.isFinite(r[id].pressure), `lectura de ${id}`));
assert.equal(r.s6.valid, false, 'toma fuera del aire: sin lectura');
assert.ok(Number.isFinite(r.z1.flow) && Math.abs(r.z1.flow) > 10, 'el sensor de zona sigue midiendo caudal');
assert.equal(sim.sensorCounts.s1, undefined, 'una toma de presión no cuenta partículas');
assert.equal(sim.sensorCounts.z1, 0);
// física: la presión cae hacia la salida (0 = atmósfera en el extremo abierto) y el aire va a ≈ 7,9 m/s
assert.ok(r.s1.pressure > r.s2.pressure, `aguas arriba ${r.s1.pressure.toFixed(1)} Pa debe superar aguas abajo ${r.s2.pressure.toFixed(1)} Pa`);
assert.ok(Math.abs(r.s2.pressure) < 0.5 * 1.2 * 7.9 * 7.9, 'cerca de la salida la presión manométrica es chica frente a la dinámica');
assert.ok(r.s1.speed > 5 && r.s1.speed < 12, `velocidad en el eje ${r.s1.speed.toFixed(1)} m/s`);
// modos: diferencial = resta de las dos tomas; total = estática + ½ρv² (Pitot)
assert.ok(Math.abs(r.s3.pressure - (r.s1.pressure - r.s2.pressure)) < 1e-6);
assert.ok(Math.abs(r.s4.pressure - (r.s1.staticPa + 0.5 * 1.2 * r.s1.speed ** 2)) < 1e-6);
assert.ok(r.s4.pressure > r.s1.pressure + 10, 'la total supera a la estática por la presión dinámica');
// tiempo de respuesta: arranca en la primera lectura y la sigue con retraso (misma toma que s1)
assert.equal(first.s5.pressure, first.s1.pressure);
assert.equal(r.s5.raw, r.s1.pressure);
// presostato: el alcanzable dispara una sola vez y queda registrado; el imposible no
const starts = resolveStarts(actions, { pressureTime: (sensor, op, value, rearm) => (rearm ? sim.pressureLast : sim.pressureReached).get(`${sensor}:${op}:${value}`) ?? null });
assert.ok(starts.get('a1') !== null && starts.get('a1') <= sim.time, 'presostato ≥ 5 Pa disparado');
assert.equal(starts.get('a2'), null, 'presostato a 10 MPa sin disparar');
// escalón: al duplicar el caudal el transmisor lento queda entre el valor viejo y el nuevo durante el transitorio
sim.setScene({ nozzles: [{ id: 'n1', pos: [8, 0, 0], dir: [1, 0, 0], speed: 0, range: 100, radius: 15, tan: 0, controlled: false, bc: 'caudal', flow: 40, pressure: 0 }] });
let lagged = false;
for (let n = 0; n < 120; n += 1) {
  sim.step(1 / 60);
  const now = sim.airInfo().readings;
  if (Math.abs(now.s5.pressure - now.s1.pressure) > 1e-3) lagged = true;
}
assert.ok(lagged, 'con τ = 0,5 s la lectura no copia al instante a la toma sin filtro');
assert.ok(sim.airInfo().readings.s4.pressure > r.s4.pressure * 1.5, 'más caudal, más presión total');
// registro: canal p:<id> para graficar/CSV, sin canal de caudal para las tomas
const recorder = new RunRecorder();
recorder.push({ time: 1, perSecond: 0, count: 0, exited: 0, air: sim.airInfo(), sensorCounts: sim.sensorCounts });
assert.ok(recorder.keys().includes('p:s3') && recorder.keys().includes('v:s1') && recorder.keys().includes('q:z1'));
assert.equal(recorder.keys().includes('q:s1'), false);
assert.doesNotThrow(() => structuredClone(sim.airInfo()), 'las lecturas cruzan el worker');
// Reinicio: el presostato debe esperar un umbral nuevo y el visor no debe recibir lecturas de la corrida anterior.
assert.ok(sim.pressureReached.size > 0);
sim.resetDynamics();
assert.equal(sim.pressureReached.size, 0, 'reiniciar borra también el primer disparo');
assert.equal(sim.pressureLast.size, 0);
assert.equal(sim.pressureAbove.size, 0);
assert.equal(sim.probeState.size, 0);
assert.deepEqual(sim.probeReadings, {});
assert.deepEqual(sim.airInfo().readings, {});
assert.equal(resolveStarts(actions, { pressureTime: (sensor, op, value) => sim.pressureReached.get(`${sensor}:${op}:${value}`) ?? null }).get('a1'), null);
console.log(`pressureSensor.test OK · p1 ${r.s1.pressure.toFixed(1)} Pa · p2 ${r.s2.pressure.toFixed(1)} Pa · Δp ${r.s3.pressure.toFixed(1)} Pa · total ${r.s4.pressure.toFixed(1)} Pa · v ${r.s1.speed.toFixed(1)} m/s`);
