import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { libraryItems } from '../src/data/library/index.js';
import { run, simFromPart } from './libraryScene.mjs';

// Las máquinas de la biblioteca vienen con su escena (motores, transmisiones, cintas, productos, sensores): acá se las simula como la
// aplicación y se comprueba que hagan lo que dicen, para que una plantilla no se rompa sin que nadie lo note.
const rep = await loadKernel();
const sceneOf = (id, args = {}, settings = {}) => {
  const item = libraryItems.find((entry) => entry.id === id);
  const defaults = {};
  (item.ask ?? []).forEach((q) => { defaults[q.name] = q.value; });
  return simFromPart(rep, item.build({ ...defaults, ...args }), { settings });
};

// 1) Cinta completa: motor → reductor → tambor → cinta; las cajas viajan a la velocidad pedida y llegan a la fotocelda
{
  const sim = sceneOf('cinta-transportadora', { speed: 250 });
  let seen = 0;
  run(sim, 11, 6, (s) => { seen = Math.max(seen, s.sensorCounts.s1 ?? 0); });
  const motor = sim.rotorInfo().find((r) => !r.follower);
  const belt = sim.bodies.find((b) => b.surf && Math.hypot(...b.surf) > 0);
  console.log('cinta', { rpm: motor.rpm.toFixed(0), surf: Math.hypot(...belt.surf).toFixed(1), seen, cajas: sim.rigid.count, salidas: sim.productsExited });
  assert.ok(motor.rpm > 1200 && motor.rpm < 1450, `motor a régimen: ${motor.rpm}`);
  assert.ok(Math.abs(Math.hypot(...belt.surf) - 250) < 15, `cinta a 250 mm/s: ${Math.hypot(...belt.surf)}`);
  assert.ok(seen >= 1, 'la fotocelda ve pasar una caja');
  assert.ok(sim.rigid.count + sim.productsExited >= 3, 'aparecen cajas');
  assert.ok(sim.rigid.bodies.every((b) => Number.isFinite(b.x[0]) && b.x[2] > 700), 'las cajas sobre la cinta quedan apoyadas');
}

// 2) Empujador: la fotocelda dispara la acción cada vez; las cajas salen de la cinta hacia la mesa lateral
{
  const sim = sceneOf('linea-empujador');
  run(sim, 24);
  const pushed = sim.rigid.bodies.filter((b) => b.x[1] > 200).length + sim.productsExited;
  console.log('empujador', { pushed, cajas: sim.rigid.count, edges: [...sim.zoneLast.entries()] });
  assert.ok(sim.zoneLast.get('s1:1') != null, 'la fotocelda disparó');
  assert.ok(pushed >= 2, `el empujador sacó cajas de la cinta: ${pushed}`);
}

// 3) Transportador de rodillos: las cajas avanzan y hacen fila contra el tope
{
  const sim = sceneOf('transportador-rodillos');
  run(sim, 14);
  const xs = sim.rigid.bodies.map((b) => b.x[0]).sort((a, b) => b - a);
  console.log('rodillos', xs.map(Math.round));
  assert.ok(xs.length >= 3 && xs[0] > 900, `la primera caja llegó al tope: ${xs[0]}`);
  assert.ok(sim.rigid.bodies.every((b) => b.x[2] > 520 && b.x[2] < 545), 'apoyadas sobre los rodillos');
}

// 4) Mesa giratoria: el plato arrastra a las cajas (cambian de posición angular)
{
  const sim = sceneOf('mesa-giratoria');
  const angles = () => sim.rigid.bodies.map((b) => Math.atan2(b.x[1], b.x[0]));
  run(sim, 6);
  const before = angles();
  run(sim, 3);
  const after = angles();
  const moved = after.slice(0, before.length).filter((a, i) => Math.abs(Math.atan2(Math.sin(a - before[i]), Math.cos(a - before[i]))) > 0.2).length;
  console.log('mesa', { cajas: sim.rigid.count, moved });
  assert.ok(sim.rigid.count >= 2, 'hay cajas');
  assert.ok(moved >= 1, 'el plato giratorio arrastra las cajas');
}
console.log('libraryScenes ok');
