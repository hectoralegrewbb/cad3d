import assert from 'node:assert/strict';
import { meshProperties, mergeMeshes } from '../src/core/massProps.js';
import { internalCapacity, capacityUpTo, productKg } from '../src/core/capacity.js';

// ---- generadores de mallas cerradas ----
function box(x0, y0, z0, x1, y1, z1, inward = false) {
  const vertices = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
  const tris = [];
  quads.forEach(([a, b, c, d]) => (inward ? tris.push(a, c, b, a, d, c) : tris.push(a, b, c, a, c, d)));
  return { vertices, triangles: new Uint32Array(tris) };
}
// Prisma/cilindro poligonal a lo largo de z; r0 > 0 → tubo (cascarón con hueco)
function cylinder(r, z0, z1, seg = 96, cx = 0, cy = 0) {
  const v = [];
  const t = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    v.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0, cx + r * Math.cos(a), cy + r * Math.sin(a), z1);
  }
  v.push(cx, cy, z0, cx, cy, z1);
  const c0 = seg * 2, c1 = seg * 2 + 1;
  for (let i = 0; i < seg; i += 1) {
    const j = (i + 1) % seg;
    t.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
    t.push(c0, j * 2, i * 2);
    t.push(c1, i * 2 + 1, j * 2 + 1);
  }
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t) };
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);

// 1) caja 100×60×40: volumen, área, centro, inercia (analítica) y bbox
{
  const p = meshProperties(box(10, 20, 30, 110, 80, 70));
  near(p.volume, 100 * 60 * 40, 1e-6, 'volumen caja');
  near(p.area, 2 * (100 * 60 + 100 * 40 + 60 * 40), 1e-6, 'área caja');
  assert.deepEqual(p.centroid.map((x) => Math.round(x * 1000) / 1000), [60, 50, 50]);
  assert.deepEqual(p.bounds.size, [100, 60, 40]);
  // Ixx = V/12 (b²+c²) por unidad de densidad
  near(p.inertia.xx, (100 * 60 * 40 / 12) * (60 * 60 + 40 * 40), 1e-5, 'Ixx');
  near(p.inertia.zz, (100 * 60 * 40 / 12) * (100 * 100 + 60 * 60), 1e-5, 'Izz');
  assert.ok(Math.abs(p.inertia.xy) < 1e-3 * p.inertia.xx, 'producto de inercia nulo en caja centrada en su centro');
}
// 2) malla con normales invertidas da el mismo volumen
near(meshProperties(box(0, 0, 0, 10, 10, 10, true)).volume, 1000, 1e-9, 'volumen normales invertidas');
// 3) cilindro (polígono de 96 lados): volumen ≈ πr²h con error del polígono
{
  const p = meshProperties(cylinder(50, 0, 200));
  near(p.volume, Math.PI * 50 * 50 * 200, 2e-3, 'volumen cilindro');
  near(p.centroid[2], 100, 1e-6, 'centro cilindro');
  near(p.inertia.zz, 0.5 * Math.PI * 50 * 50 * 200 * 50 * 50, 5e-3, 'Izz cilindro');
}
// 4) tubo = cilindro exterior − interior (malla con cavidad de normales invertidas): volumen y capacidad
{
  const outer = cylinder(50, 0, 300);
  const innerIn = cylinder(40, 0, 300);
  // el hueco: mismas caras con orden invertido
  const hole = { vertices: innerIn.vertices, triangles: Uint32Array.from(innerIn.triangles).map((_, i, a) => a[i - (i % 3) + ((3 - (i % 3)) % 3)]) };
  const tube = mergeMeshes([outer, hole]);
  const expected = Math.PI * (50 * 50 - 40 * 40) * 300;
  near(meshProperties(tube).volume, expected, 4e-3, 'volumen tubo');
  const cap = internalCapacity(tube);
  near(cap.capacity, Math.PI * 40 * 40 * 300, 0.06, 'capacidad interior del tubo (abierto en las puntas)');
  near(cap.solidVolume, expected, 0.08, 'material del tubo');
  assert.ok(cap.sealed < 1e-6 * cap.capacity + 1, `tubo abierto: nada sellado (${cap.sealed})`);
}
// 5) tolva abierta arriba: caja exterior 200³ con cavidad 160×160×(hasta arriba) — capacidad = hueco, y llenado por nivel
{
  // construcción explícita: paredes (4 prismas) + fondo, unidos en una sola malla de cuerpos cerrados
  const parts = [box(0, 0, 0, 200, 200, 20), box(0, 0, 20, 20, 200, 200), box(180, 0, 20, 200, 200, 200), box(20, 0, 20, 180, 20, 200), box(20, 180, 20, 180, 200, 200)];
  const tank = mergeMeshes(parts);
  near(meshProperties(tank).volume, 200 * 200 * 20 + 2 * 20 * 200 * 180 + 2 * 160 * 20 * 180, 1e-6, 'volumen tolva');
  const cap = internalCapacity(tank);
  near(cap.capacity, 160 * 160 * 180, 0.06, 'capacidad tolva abierta');
  // llenada hasta la mitad de la altura útil
  near(capacityUpTo(cap, 110), 160 * 160 * 90, 0.08, 'capacidad hasta z = 110');
  near(productKg(cap.capacity, 0.8, 780), 160 * 160 * 180 * 1e-9 * 0.8 * 780, 0.06, 'kg de producto');
}
// 6) tanque cerrado: la cavidad sellada coincide con la capacidad
{
  const tank = mergeMeshes([box(0, 0, 0, 100, 100, 100), box(10, 10, 10, 90, 90, 90, true)]);
  const cap = internalCapacity(tank);
  near(cap.capacity, 80 ** 3, 0.05, 'capacidad tanque cerrado');
  near(cap.sealed, 80 ** 3, 0.05, 'sellado = capacidad');
}
// 7) un sólido sin cavidad no tiene capacidad
{
  const cap = internalCapacity(box(0, 0, 0, 100, 100, 100));
  assert.ok(cap.capacity < 1, `maciza: ${cap.capacity}`);
}
console.log('massProps / capacity ok');
