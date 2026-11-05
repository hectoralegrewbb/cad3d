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

const makeSim = (overrides = {}) => {
  const mesh = tubeMesh();
  const sdf = buildSdf(mesh.vertices, mesh.triangles, { cell: 1.2, band: 6 });
  const preset = materialPresets.arena;
  const sim = new ParticleSim([{ sdf, mesh, movable: false }], {
    ...preset,
    gravity: 0,
    rate: 200,
    cap: 600,
    airModel: 'calculado',
    airSolverCells: 12000,
    emitter: { center: [25, 0, 0], size: [2, 8, 8] },
    floorZ: -500,
    ...overrides,
  });
  // entrada de caudal dentro del tubo: 20 m³/h → ≈ 7,9 m/s en un caño de Ø30
  sim.setScene({
    nozzles: [{ id: 'n1', pos: [8, 0, 0], dir: [1, 0, 0], speed: 0, range: 100, radius: 15, tan: 0, controlled: false, bc: 'caudal', flow: 20, pressure: 0 }],
    sensors: [{ id: 's1', min: [95, -17, -17], max: [105, 17, 17] }],
  });
  return sim;
};
const settleAir = (sim) => {
  for (let n = 0; n < 200 && sim.airPending(); n += 1) sim.solveAirSlice(50);
  assert.equal(sim.airPending(), false, 'el aire inicial debe converger');
};
// velocidad media en X de los granos que están dentro del tubo (los que ya salieron del dominio no cuentan)
const meanSpeedX = (sim, from = 110, to = 190) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sim.count; i += 1) {
    const x = sim.x[i * 3];
    if (x < from || x > to) continue;
    sum += sim.v[i * 3];
    n += 1;
  }
  return n ? sum / n : NaN;
};

// 1) arranque: el aire se resuelve antes de emitir granos y reproduce el caudal pedido
{
  const sim = makeSim();
  assert.ok(sim.solverMode, 'con boquillas y sin viento usa el aire calculado');
  assert.equal(sim.airPending(), true);
  sim.step(1 / 60);
  assert.equal(sim.count, 0, 'sin aire resuelto no se emiten granos');
  settleAir(sim);
  sim.readSensorsAir();
  const reading = sim.airReadings.s1;
  assert.ok(Math.abs(reading.flow / 20 - 1) < 0.06, `caudal en el sensor ${reading.flow.toFixed(1)} m³/h (pedido 20)`);
  // velocidad en una caja inscrita en el caño (las esquinas de la caja del sensor caen fuera del tubo); la sección discreta
  // de una grilla gruesa difiere de π r² (ver docs): se acepta ±25 % sobre los 7,9 m/s analíticos
  const core = sim.air.readBox([100, 0, 0], [6, 18, 18]);
  assert.ok(core.speed > 5.9 && core.speed < 9.9, `velocidad ${core.speed.toFixed(1)} m/s (≈ 7,9)`);
  assert.equal(sim.air.warnings.length, 0);
}

// 2) los granos son arrastrados por el aire con el arrastre físico (grano real de 0,4 mm)
{
  const sim = makeSim();
  settleAir(sim);
  const seen = [];
  for (let n = 0; n < 30; n += 1) {
    sim.step(1 / 60);
    const vx = meanSpeedX(sim);
    if (Number.isFinite(vx)) seen.push(vx / 1000);
  }
  assert.ok(seen.length >= 5, `granos dentro del tubo: ${seen.length} cuadros con granos`);
  const vx = Math.max(...seen);
  // solución analítica de v' = k(u − v) con k ≈ 5 1/s y u ≈ 7 m/s: tras recorrer 125 mm (≈ 0,09 s) el grano va a ≈ 2,5 m/s
  assert.ok(vx > 1.8 && vx < 10, `los granos viajan con el aire: ${vx.toFixed(1)} m/s`);
  assert.ok(sim.solverMode, 'el aire sigue siendo el calculado (no cayó al modo rápido)');
}

// 3) acople bidireccional: con mucha carga de producto el aire pierde caudal útil y sube la presión aguas arriba
{
  // promedio de la presión aguas arriba mientras el producto está atravesando el tubo (los granos que salen se retiran)
  const loadedPressure = (massFlow) => {
    const sim = makeSim({ massFlow, rate: 600, cap: 2500, emitter: { center: [25, 0, 0], size: [2, 10, 10] } });
    settleAir(sim);
    const samples = [];
    let inside = 0;
    let peakPlug = 0;
    for (let n = 0; n < 150; n += 1) {
      sim.step(1 / 60);
      peakPlug = Math.max(peakPlug, sim.plugInfo()[0]?.ratio ?? 0);
      for (let i = 0; i < sim.count; i += 1) if (sim.x[i * 3] > 205) sim.x[i * 3 + 2] = -1e4; // salió del tubo: se descarta en el próximo paso
      if (n >= 60) {
        samples.push(sim.air.readBox([40, 0, 0], [6, 34, 34]).pressure);
        inside += sim.count;
      }
    }
    return { p: samples.reduce((a, b) => a + b, 0) / samples.length, inside: inside / samples.length, solver: sim.solverMode, plug: sim.plugInfo()[0], peakPlug };
  };
  const light = loadedPressure(0.002);
  const heavy = loadedPressure(1.2);
  assert.ok(heavy.solver && light.solver, 'el aire calculado no debe caer al modo rápido');
  assert.ok(heavy.inside > 10, `granos dentro del tubo: ${heavy.inside.toFixed(0)}`);
  console.log('taponamiento (pico)', { light: light.peakPlug, heavy: heavy.peakPlug });
  assert.ok(light.plug && light.plug.state === 'normal', `sin carga no debe avisar: ${JSON.stringify(light.plug)}`);
  assert.ok(heavy.peakPlug > light.peakPlug + 0.15, `con carga el indicador sube: ${light.peakPlug.toFixed(2)} → ${heavy.peakPlug.toFixed(2)}`);
  assert.ok(heavy.p > light.p + 50, `más carga debe subir la presión: ${light.p.toFixed(1)} → ${heavy.p.toFixed(1)} Pa`);
}

// 4) sin aire configurado todo sigue como antes (modelo rápido, sin solver)
{
  const sim = makeSim({ airModel: 'rapido' });
  assert.equal(sim.solverMode, false);
  assert.equal(sim.airPending(), false);
  for (let n = 0; n < 5; n += 1) sim.step(1 / 60);
  assert.ok(sim.air, 'el modelo rápido sigue disponible');
}

console.log('airParticles.test OK');
