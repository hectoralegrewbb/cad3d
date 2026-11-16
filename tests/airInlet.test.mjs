import assert from 'node:assert/strict';
import { AirSolver } from '../src/particles/airSolver.js';

// Conducto de pared fina: la grilla contiene tanto el aire interior como el exterior.
// La entrada sobredimensionada debe seleccionar sólo la sección conectada a su centro.
const tubeMesh = (axis, sign) => {
  const vertices = [], triangles = [];
  const ring = (x, radius) => {
    const base = vertices.length / 3;
    for (let k = 0; k < 48; k += 1) {
      const a = k * Math.PI / 24;
      const p = [radius * Math.cos(a), radius * Math.sin(a)];
      const xyz = [];
      xyz[axis] = x * sign;
      [0, 1, 2].filter(j => j !== axis).forEach((j, n) => { xyz[j] = p[n]; });
      vertices.push(...xyz);
    }
    return base;
  };
  const quad = (a, b) => {
    for (let k = 0; k < 48; k += 1) {
      const n = (k + 1) % 48;
      triangles.push(a + k, b + k, b + n, a + k, b + n, a + n);
    }
  };
  const oa = ring(0, 31.75), ob = ring(200, 31.75);
  const ia = ring(0, 30.25), ib = ring(200, 30.25);
  quad(oa, ob); quad(ib, ia); quad(oa, ia); quad(ib, ob);
  return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles) };
};

for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
  const mesh = tubeMesh(axis, sign);
  const lo = [-60, -60, -60], hi = [60, 60, 60];
  lo[axis] = sign < 0 ? -220 : -20;
  hi[axis] = sign > 0 ? 220 : 20;
  const air = new AirSolver({ lo, hi, bodies: [{ mesh, movable: false }], cells: 12000 });
  const pos = [0, 0, 0], dir = [0, 0, 0];
  pos[axis] = 30 * sign; dir[axis] = sign;
  const flow = 100 / 3600;
  air.setInlets([{ pos, dir, radius: 35, flow }]);
  assert.deepEqual(air.warnings, []);
  const group = air.inletGroups[0];
  assert.ok(group.faces.length > 0);
  const others = [0, 1, 2].filter(j => j !== axis);
  for (const { ijk } of group.faces) {
    const r = Math.hypot(...others.map(j => air.origin[j] + (ijk[j] + .5) * air.hmm));
    assert.ok(r < 31.75, `entrada ${axis}/${sign}: no imponer aire exterior (r=${r})`);
  }
  const injected = group.faces.reduce((q, { face }) => q + group.weights[face] * group.values[face] * air.h ** 2 * sign, 0);
  assert.ok(Math.abs(injected / flow - 1) < 1e-6, 'conservar el caudal tras recortar la sección');
  // La misma restricción se aplica al plenum de presión.
  air.setInlets([{ pos, dir, radius: 35, pressure: 1000 }]);
  let fixed = 0;
  for (let c = 0; c < air.n; c += 1) if (air.pfix[c]) {
    fixed += 1;
    const ijk = [c % air.dims[0], Math.floor(c / air.dims[0]) % air.dims[1], Math.floor(c / (air.dims[0] * air.dims[1]))];
    const r = Math.hypot(...others.map(j => air.origin[j] + (ijk[j] + .5) * air.hmm));
    assert.ok(r < 31.75, 'no fijar presión en el aire exterior');
  }
  assert.ok(fixed > 0);
}
// Boca centrada sobre un eje macizo (tornillo sin fin, conducto anular): el centro cae dentro de un sólido cerrado.
// La entrada debe tomar la corona de aire, no el interior sellado del eje ni el aire de afuera del caño.
for (const rod of [4, 12, 20]) {
  const mesh = tubeMesh(0, 1);
  const vertices = [...mesh.vertices], triangles = [...mesh.triangles];
  const ring = (x) => {
    const base = vertices.length / 3;
    for (let k = 0; k < 48; k += 1) vertices.push(x, rod * Math.cos(k * Math.PI / 24), rod * Math.sin(k * Math.PI / 24));
    return base;
  };
  const a = ring(-5), b = ring(205);
  for (let k = 0; k < 48; k += 1) {
    const n = (k + 1) % 48;
    triangles.push(a + k, b + k, b + n, a + k, b + n, a + n);
  }
  for (const [start, x] of [[a, -5], [b, 205]]) {
    const centre = vertices.length / 3;
    vertices.push(x, 0, 0);
    for (let k = 0; k < 48; k += 1) triangles.push(centre, start + k, start + (k + 1) % 48);
  }
  const air = new AirSolver({ lo: [-20, -60, -60], hi: [220, 60, 60], bodies: [{ mesh: { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles) }, movable: false }], cells: 12000 });
  const flow = 100 / 3600;
  air.setInlets([{ pos: [30, 0, 0], dir: [1, 0, 0], radius: 30, flow }]);
  assert.deepEqual(air.warnings, [], `eje Ø${2 * rod}: la boca centrada en el eje debe tocar aire`);
  const group = air.inletGroups[0];
  assert.ok(group.faces.length >= 12, `eje Ø${2 * rod}: la entrada debe abarcar la corona (caras: ${group.faces.length})`);
  const quadrants = new Set();
  for (const { ijk } of group.faces) {
    const y = air.origin[1] + (ijk[1] + .5) * air.hmm, z = air.origin[2] + (ijk[2] + .5) * air.hmm;
    const r = Math.hypot(y, z);
    assert.ok(r < 31.75, `eje Ø${2 * rod}: no imponer aire exterior (r=${r})`);
    assert.ok(r > rod - air.hmm, `eje Ø${2 * rod}: no imponer dentro del eje (r=${r})`);
    quadrants.add(`${y > 0}${z > 0}`);
  }
  assert.equal(quadrants.size, 4, `eje Ø${2 * rod}: la entrada rodea al eje`);
  assert.ok(Math.abs(air.inletFlow() / flow - 1) < 1e-6, 'caudal pedido conservado');
  for (let n = 0; n < 25; n += 1) air.step();
  assert.ok(Number.isFinite(air.delta) && !air.diverging(), `eje Ø${2 * rod}: el aire avanza estable`);
}
console.log('airInlet OK · sección interior y caudal/presión en X/Y/Z, ambos sentidos');
