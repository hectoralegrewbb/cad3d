import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { buildSdf, sampleSdf } from '../src/particles/sdf.js';
import { ParticleSim, materialPresets } from '../src/particles/sim.js';
import { defaultAction } from '../src/core/actions.js';

const rep = await loadKernel();

// 1) SDF de una esfera: distancia con signo y gradiente radial
{
  const sphere = rep.makeSphere(10);
  const mesh = extractMesh(sphere);
  const sdf = buildSdf(mesh.vertices, mesh.triangles, { cell: 1, band: 4 });
  const grad = [0, 0, 0];
  const out = sampleSdf(sdf, 12, 0, 0, grad);
  assert.ok(Math.abs(out - 2) < 0.3, `fuera ${out}`);
  assert.ok(grad[0] > 0.9);
  const inside = sampleSdf(sdf, 8, 0, 0, grad);
  assert.ok(inside < -1.5 && inside > -2.5, `dentro ${inside}`);
  assert.ok(sampleSdf(sdf, 0, 0, 0, grad) <= -3.9, 'centro profundo');
  assert.equal(sampleSdf(sdf, 40, 0, 0, grad), 4);
}

// 2) Transportador: tornillo horizontal (eje X) dentro de una camisa abierta por ambos extremos
const screwPart = commands.addFeature(createPart('Tornillo'), 'screw', { plane: 'YZ', length: 120, shaft: 12, outer: 40, pitch: 30, thickness: 3, starts: 1 });
const screw = buildPart(rep, screwPart).shape;
assert.ok(screw, 'tornillo');
const housing = rep.makeCylinder(25, 120, [0, 0, 0], [1, 0, 0]).cut(rep.makeCylinder(21.5, 120, [0, 0, 0], [1, 0, 0]));
const screwMesh = extractMesh(screw);
const housingMesh = extractMesh(housing);
const makeBodies = () => [
  { sdf: buildSdf(housingMesh.vertices, housingMesh.triangles, { cell: 1.2, band: 4 }) },
  { sdf: buildSdf(screwMesh.vertices, screwMesh.triangles, { cell: 1.2, band: 4 }), movable: true, key: 'screw1', radiusMax: 20 },
];
const run = (rpm) => {
  const sim = new ParticleSim(makeBodies(), { radius: 1.5, cap: 900, maxCap: 900, rate: 300, emitter: { center: [10, 0, 14], size: [14, 14, 4] }, floorZ: -60, seed: 7 });
  sim.setScene({ actions: [defaultAction('rotate', { id: 'g', targets: ['screw1'], axis: 'x', mode: 'continuous', rpm })] });
  for (let n = 0; n < 60 * 14; n += 1) sim.step(1 / 60);
  let sum = 0;
  for (let i = 0; i < sim.count; i += 1) sum += sim.x[i * 3];
  return { meanX: sim.count ? sum / sim.count : 0, count: sim.count, exited: sim.exited, exitX: sim.exited ? sim.exitSum[0] / sim.exited : 0, sim };
};
const still = run(0);
const forward = run(120);
const backward = run(-120);
console.log({ still: [still.exitX, still.exited], forward: [forward.exitX, forward.exited], backward: [backward.exitX, backward.exited] });
assert.ok(backward.exitX > forward.exitX + 20, 'el sentido de giro decide por qué extremo sale el material (hélice derecha: giro + lleva el material hacia −eje)');
assert.ok(still.count > 300, 'el material se acumula con el tornillo quieto');
assert.ok(Math.abs(forward.meanX - backward.meanX) > 8 || Math.abs(forward.exited - backward.exited) > 50, 'girar en sentidos opuestos transporta distinto');
assert.ok(Math.abs(forward.meanX - still.meanX) > 4 || Math.abs(backward.meanX - still.meanX) > 4 || forward.exited !== still.exited, 'el giro cambia el resultado');
// todas las partículas siguen finitas
for (const r of [still, forward, backward]) for (let i = 0; i < r.sim.count * 3; i += 1) assert.ok(Number.isFinite(r.sim.x[i]));

const boxMesh = (a, b) => extractMesh(rep.makeBox(a, b));
const sdfOf = (mesh, cell = 1) => buildSdf(mesh.vertices, mesh.triangles, { cell, band: 4 });

// 3) Compuerta que desliza: retiene el material y lo suelta al abrirse
{
  const gate = { sdf: sdfOf(boxMesh([-20, -20, -3], [20, 20, 0])), movable: true, key: 'gate', radiusMax: 30 };
  const rails = { sdf: sdfOf(boxMesh([-22, -22, -40], [-20, 22, 20])) };
  const open = defaultAction('slide', { id: 's', targets: ['gate'], axis: 'x', from: 0, to: 60, duration: 0.5, start: { type: 'time', t: 1.5 } });
  const sim = new ParticleSim([rails, gate], { radius: 1.5, cap: 200, maxCap: 200, rate: 100, emitter: { center: [0, 0, 12], size: [20, 20, 4] }, floorZ: -30, seed: 3 });
  sim.setScene({ actions: [open] });
  for (let n = 0; n < 60 * 1.4; n += 1) sim.step(1 / 60);
  assert.equal(sim.exited, 0, 'cerrada: nada pasa');
  assert.ok(sim.count > 60, 'cerrada: el material se apoya en la compuerta');
  for (let n = 0; n < 60 * 3; n += 1) sim.step(1 / 60);
  assert.ok(sim.exited > 40, `abierta: cae el material (${sim.exited})`);
}

// 3b) Sensor de zona: la compuerta abre sola cuando se juntaron 40 partículas encima
{
  const gate = { sdf: sdfOf(boxMesh([-20, -20, -3], [20, 20, 0])), movable: true, key: 'gate', radiusMax: 30 };
  const rails = { sdf: sdfOf(boxMesh([-22, -22, -40], [-20, 22, 20])) };
  const open = defaultAction('slide', { id: 's', targets: ['gate'], axis: 'x', from: 0, to: 60, duration: 0.3, start: { type: 'zone', sensor: 's1', n: 40, delay: 0 } });
  const sim = new ParticleSim([rails, gate], { radius: 1.5, cap: 200, maxCap: 200, rate: 60, emitter: { center: [0, 0, 12], size: [20, 20, 4] }, floorZ: -30, seed: 3 });
  sim.setScene({ actions: [open], sensors: [{ id: 's1', min: [-20, -20, 0], max: [20, 20, 10] }] });
  for (let n = 0; n < 30; n += 1) sim.step(1 / 60);
  assert.equal(sim.exited, 0, 'con pocas partículas la compuerta sigue cerrada');
  for (let n = 0; n < 60 * 5; n += 1) sim.step(1 / 60);
  assert.ok(sim.zoneReached.has('s1:40'), 'el sensor alcanzó el umbral');
  assert.ok(sim.exited > 20, `la compuerta abrió y salió material (${sim.exited})`);
}

// 4) Boquilla de aire: arrastra polvo fino; una pared entre medio le hace sombra; sin disparar no sopla
{
  const run = (extra = {}, nozzleOn = true) => {
    const bodies = [{ sdf: sdfOf(boxMesh([-40, -40, -2], [140, 40, 0])) }, ...(extra.wall ? [{ sdf: sdfOf(boxMesh([20, -40, 0], [24, 40, 40])) }] : [])];
    const sim = new ParticleSim(bodies, { radius: 0.8, grain: 0.1, drag: 4, cap: 150, maxCap: 150, rate: 150, emitter: { center: [0, 0, 6], size: [6, 6, 3] }, floorZ: -30, seed: 5 });
    sim.setScene({
      nozzles: [{ id: 'n1', pos: [-12, 0, 6], dir: [1, 0, 0], speed: 4000, range: 150, tan: Math.tan((25 * Math.PI) / 180), radius: 6, controlled: true }],
      actions: nozzleOn ? [defaultAction('air', { id: 'a', nozzle: 'n1', level: 1, duration: 0.2, start: { type: 'time', t: 0 } })] : [],
    });
    for (let n = 0; n < 60 * 3; n += 1) sim.step(1 / 60);
    let sum = 0;
    for (let i = 0; i < sim.count; i += 1) sum += sim.x[i * 3];
    return sum / Math.max(1, sim.count);
  };
  const still = run({}, false);
  const blown = run({}, true);
  const shadowed = run({ wall: true }, true);
  console.log({ still, blown, shadowed });
  assert.ok(blown > still + 20, 'el aire arrastra el polvo');
  assert.ok(shadowed < 24, 'la pared frena el polvo');
}

// 5) Líquido: se desparrama sobre una placa mucho más que la arena y se aquieta; en un recipiente llena parejo
{
  const spread = (preset) => {
    const plate = { sdf: sdfOf(boxMesh([-60, -60, -3], [60, 60, 0])) };
    const sim = new ParticleSim([plate], { ...materialPresets[preset], cap: 500, maxCap: 500, rate: 250, emitter: { center: [0, 0, 14], size: [6, 6, 3] }, floorZ: -30, seed: 11 });
    for (let n = 0; n < 60 * 5; n += 1) sim.step(1 / 60);
    let r = 0;
    let speed = 0;
    for (let i = 0; i < sim.count; i += 1) {
      r += Math.hypot(sim.x[i * 3], sim.x[i * 3 + 1]);
      speed += Math.hypot(sim.v[i * 3], sim.v[i * 3 + 1], sim.v[i * 3 + 2]);
    }
    const zs = [];
    for (let i = 0; i < sim.count; i += 1) zs.push(sim.x[i * 3 + 2]);
    zs.sort((a, b) => a - b);
    const height = zs[Math.floor(zs.length * 0.95)];
    return { radius: r / sim.count, height, aspect: height / (r / sim.count), speed: speed / sim.count, count: sim.count, sim };
  };
  const sand = spread('arena');
  const water = spread('agua');
  console.log({ sand: [sand.radius, sand.height, sand.aspect], water: [water.radius, water.height, water.aspect], waterSpeed: water.speed });
  assert.ok(water.aspect < sand.aspect * 0.7, 'el agua forma una capa más plana que el montículo de arena');
  assert.ok(water.count > 400, 'no se pierde líquido');
  for (let i = 0; i < water.sim.count * 3; i += 1) assert.ok(Number.isFinite(water.sim.x[i]));

  // recipiente: paredes + piso; al llenarse el nivel es parejo
  const walls = [[-22, -22, -3, 22, 22, 0], [-22, -22, 0, -20, 22, 30], [20, -22, 0, 22, 22, 30], [-22, -22, 0, 22, -20, 30], [-22, 20, 0, 22, 22, 30]];
  const cup = walls.map((w) => ({ sdf: sdfOf(boxMesh([w[0], w[1], w[2]], [w[3], w[4], w[5]])) }));
  const sim = new ParticleSim(cup, { ...materialPresets.agua, cap: 700, maxCap: 700, rate: 350, emitter: { center: [0, 0, 28], size: [8, 8, 3] }, floorZ: -30, seed: 4 });
  for (let n = 0; n < 60 * 6; n += 1) sim.step(1 / 60);
  const zs = [];
  for (let i = 0; i < sim.count; i += 1) {
    assert.ok(Math.abs(sim.x[i * 3]) < 21 && Math.abs(sim.x[i * 3 + 1]) < 21, 'queda dentro del recipiente');
    zs.push(sim.x[i * 3 + 2]);
  }
  zs.sort((a, b) => a - b);
  const top = zs[Math.floor(zs.length * 0.95)];
  const median = zs[Math.floor(zs.length / 2)];
  console.log({ cupCount: sim.count, top, median });
  assert.ok(sim.count > 500);
  assert.ok(top - median < 6, 'el nivel queda parejo');
  assert.ok(top > 3, 'el líquido se apila en varias capas (no queda aplastado en una sola)');
  const onFloor = zs.filter((z) => z < 2).length / zs.length;
  assert.ok(onFloor < 0.75, 'no más de 3/4 del líquido en la capa del fondo');
}

// 6) Canal vibratorio: la vibración inclinada lanza el granulado hacia donde apunta su componente horizontal
{
  const box = (a, b) => rep.makeBox(a, b);
  const canal = box([0, -20, -3], [300, 20, 0]).fuse(box([0, -20, 0], [300, -18, 20])).fuse(box([0, 18, 0], [300, 20, 20]));
  const mesh = extractMesh(canal);
  const sdf = sdfOf(mesh, 1.2);
  const run = (axis, amp) => {
    const sim = new ParticleSim([{ sdf, movable: true, key: 'canal', radiusMax: 300 }], { ...materialPresets.granulado, cap: 300, maxCap: 300, rate: 200, emitter: { center: [30, 0, 10], size: [20, 20, 4] }, floorZ: -60, seed: 5 });
    sim.setScene({ actions: [defaultAction('vibrate', { id: 'v', targets: ['canal'], axis, amp, freq: 25, start: { type: 'time', t: 0.3 } })] });
    for (let n = 0; n < 60 * 4; n += 1) sim.step(1 / 60);
    let mx = 0;
    for (let i = 0; i < sim.count; i += 1) {
      assert.ok(Number.isFinite(sim.x[i * 3]));
      mx += sim.x[i * 3];
    }
    return mx / sim.count;
  };
  const c = Math.cos(Math.PI / 6);
  const s30 = Math.sin(Math.PI / 6);
  const still = run([c, 0, s30], 0);
  const forward = run([c, 0, s30], 2);
  const backward = run([-c, 0, s30], 2);
  console.log({ still, forward, backward });
  assert.ok(forward > still + 50, 'vibración hacia +X: el material avanza');
  assert.ok(backward < still - 15, 'vibración hacia −X: el material retrocede');
}
console.log('particles.test OK');
