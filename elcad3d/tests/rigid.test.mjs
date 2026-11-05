import assert from 'node:assert/strict';
import { RigidWorld, quatFromYaw } from '../src/particles/rigid.js';

// Entorno de prueba: piso en z = 0 (opcionalmente con velocidad de superficie) y una pared en x = 600
const floor = (surf = [0, 0, 0], x1 = Infinity) => ({
  query(x, y, z, out) {
    const onFloor = z < 30 && x < x1;
    if (onFloor) { out.d = z; out.nx = 0; out.ny = 0; out.nz = 1; out.vx = surf[0]; out.vy = surf[1]; out.vz = surf[2]; return true; }
    return false;
  },
});
const run = (world, env, seconds, h = 1 / 240) => { for (let t = 0; t < seconds; t += h) world.step(h, env); };

// 1) una caja apoyada en el piso se queda quieta, plana y a su altura
{
  const w = new RigidWorld();
  const box = w.add({ pos: [0, 0, 100], size: [200, 150, 100], mass: 2 });
  run(w, floor(), 2);
  assert.ok(Math.abs(box.x[2] - 50) < 1.5, `altura de reposo ${box.x[2]}`);
  assert.ok(Math.hypot(...box.v) < 20, `queda quieta: ${Math.hypot(...box.v)}`);
  assert.ok(Math.abs(box.q[0]) < 0.02 && Math.abs(box.q[1]) < 0.02, 'no se inclina');
}
// 2) cinta: la caja apoyada acelera hasta la velocidad de la superficie (y no antes de eso, Coulomb)
{
  const w = new RigidWorld();
  const box = w.add({ pos: [0, 0, 51], size: [200, 150, 100], mass: 2, friction: 0.5 });
  run(w, floor([300, 0, 0]), 2);
  assert.ok(Math.abs(box.v[0] - 300) < 40, `viaja con la cinta: ${box.v[0]}`);
  assert.ok(box.x[0] > 150, 'avanzó');
  // con fricción muy baja resbala: nunca alcanza la cinta en el mismo tiempo
  const slippery = new RigidWorld();
  const b2 = slippery.add({ pos: [0, 0, 51], size: [200, 150, 100], mass: 2, friction: 0.02 });
  run(slippery, floor([300, 0, 0]), 0.5);
  const grippy = new RigidWorld();
  const b3 = grippy.add({ pos: [0, 0, 51], size: [200, 150, 100], mass: 2, friction: 0.5 });
  run(grippy, floor([300, 0, 0]), 0.5);
  assert.ok(b2.v[0] < 0.65 * 300, `resbala: ${b2.v[0]}`);
  assert.ok(b2.v[0] < 0.6 * b3.v[0], `con poca fricción acelera mucho menos: ${b2.v[0]} vs ${b3.v[0]}`);
}
// 3) una caja que cae sobre otra queda apilada
{
  const w = new RigidWorld();
  const lower = w.add({ pos: [0, 0, 50.5], size: [200, 200, 100], mass: 3 });
  const upper = w.add({ pos: [0, 0, 160], size: [100, 100, 80], mass: 1 });
  run(w, floor(), 3);
  assert.ok(Math.abs(lower.x[2] - 50) < 2, `base ${lower.x[2]}`);
  assert.ok(Math.abs(upper.x[2] - (100 + 40)) < 3, `apilada a ${upper.x[2]}`);
  assert.ok(Math.abs(upper.x[0]) < 15 && Math.abs(upper.x[1]) < 15, 'no se desplaza');
}
// 4) tope: dos cajas sobre una cinta chocan contra una pared y se detienen sin atravesarse
{
  const world = new RigidWorld();
  const env = {
    query(x, y, z, out) {
      if (x > 500) { out.d = 520 - x; out.nx = -1; out.ny = 0; out.nz = 0; out.vx = out.vy = out.vz = 0; if (out.d < 20) return true; }
      if (z < 30) { out.d = z; out.nx = 0; out.ny = 0; out.nz = 1; out.vx = 300; out.vy = 0; out.vz = 0; return true; }
      return false;
    },
  };
  const a = world.add({ pos: [380, 0, 51], size: [100, 100, 100], mass: 1 });
  const b = world.add({ pos: [200, 0, 51], size: [100, 100, 100], mass: 1 });
  run(world, env, 3);
  assert.ok(a.x[0] < 475, `no atraviesa la pared: ${a.x[0]}`);
  assert.ok(b.x[0] < a.x[0] - 90, `no se atraviesan entre sí: ${a.x[0] - b.x[0]}`);
  assert.ok(a.x[0] - b.x[0] < 130, 'se acumulan en fila contra el tope');
}
// 5) yaw inicial y snapshot
{
  const w = new RigidWorld();
  const box = w.add({ pos: [10, 20, 100], quat: quatFromYaw(90), size: [200, 100, 50], mass: 1 });
  assert.ok(Math.abs(box.q[2] - Math.SQRT1_2) < 1e-9);
  const snap = w.snapshot();
  assert.equal(snap.length, 10);
  assert.equal(snap[9], 25);
}
console.log('rigid ok');
