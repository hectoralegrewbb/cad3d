import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { boxMembers, frameSpec, profileCatalog, profileShape } from '../src/kernel/frameGeometry.js';

const rep = await loadKernel();
const volume = (shape) => {
  const { vertices, triangles } = shape.mesh({ tolerance: 0.02, angularTolerance: 0.05 });
  let v = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => triangles[t + k] * 3);
    v += (vertices[a] * (vertices[b + 1] * vertices[c + 2] - vertices[b + 2] * vertices[c + 1]) - vertices[a + 1] * (vertices[b] * vertices[c + 2] - vertices[b + 2] * vertices[c]) + vertices[a + 2] * (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c])) / 6;
  }
  return Math.abs(v);
};
const bboxOf = (shape) => { const b = shape.boundingBox; return { min: b.bounds[0], max: b.bounds[1] }; };
const build = (members, patch = {}) => {
  const part = commands.addFeature(createPart('Marco'), 'frame', { members, ...patch });
  return buildPart(rep, part);
};

// 1) Una barra recta: volumen = área del perfil × largo
{
  const res = build([{ a: [0, 0, 0], b: [0, 0, 600] }]);
  assert.ok(res.shape, JSON.stringify(res.results));
  const expected = profileShape(profileCatalog['tubo-40x40x2']).area * 600;
  assert.ok(Math.abs(volume(res.shape) - expected) / expected < 0.01, `volumen ${volume(res.shape)} vs ${expected}`);
  const box = bboxOf(res.shape);
  assert.ok(Math.abs(box.max[2] - box.min[2] - 600) < 1e-3 && Math.abs(box.max[0] - box.min[0] - 40) < 1e-3, 'caja 40×40×600');
}

// 2) Esquina a inglete: dos barras que se encuentran a 90°; el volumen total es la suma de las dos (sin superposición)
{
  const members = [{ a: [0, 0, 0], b: [500, 0, 0] }, { a: [500, 0, 0], b: [500, 300, 0] }];
  const res = build(members);
  assert.ok(res.shape, JSON.stringify(res.results));
  const area = profileShape(profileCatalog['tubo-40x40x2']).area;
  const v = volume(res.shape);
  // el inglete conserva el eje de cada barra: el material perdido en una punta lo gana la otra (≈ eje·área)
  assert.ok(Math.abs(v - area * 800) / (area * 800) < 0.03, `volumen del L ingletado ${v} vs ${area * 800}`);
  const box = bboxOf(res.shape);
  assert.ok(Math.abs(box.max[0] - 520) < 1e-3, `la punta exterior llega a 520: ${box.max[0]}`);
  assert.ok(Math.abs(box.max[1] - 300) < 1e-3 || Math.abs(box.max[1] - 300) < 1, 'barra vertical hasta 300');
}

// 3) Marco en caja de 12 barras: sólido válido y dimensiones exteriores
{
  const res = build(boxMembers({ sx: 800, sy: 600, sz: 900, post: 40 }));
  assert.ok(res.shape, JSON.stringify(res.results));
  const box = bboxOf(res.shape);
  assert.ok(Math.abs(box.max[0] - box.min[0] - 840) < 1e-2 && Math.abs(box.max[1] - box.min[1] - 640) < 1e-2 && Math.abs(box.max[2] - box.min[2] - 900) < 1e-2, `caja exterior ${JSON.stringify(box)}`);
  assert.ok(volume(res.shape) > 0);
}

// 4) Ángulo y perfil U construyen
for (const profile of ['angulo-40x40x4', 'u-80x40x4', 'barra-40x10', 'cano-48x3']) {
  const res = build([{ a: [0, 0, 0], b: [300, 0, 0] }], { profile });
  assert.ok(res.shape, `${profile}: ${JSON.stringify(res.results)}`);
  const expected = profileShape(profileCatalog[profile]).area * 300;
  assert.ok(Math.abs(volume(res.shape) - expected) / expected < 0.01, `${profile} volumen`);
}

// 5) errores claros
{
  const res = build([]);
  assert.ok(!res.shape);
  assert.match(JSON.stringify(res.results), /al menos una barra/);
}
console.log('frame ok');
