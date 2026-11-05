import assert from 'node:assert/strict';
import { sketchMembers, boxMembers, cutList, frameSpec, profileCatalog, profileShape, defaultFrameFeature, steelDensity } from '../src/kernel/frameGeometry.js';

// áreas de perfiles
assert.ok(Math.abs(profileShape(profileCatalog['tubo-40x40x2']).area - (1600 - 36 * 36 - (4 - Math.PI) * 8)) < 1e-9, 'tubo con esquinas redondeadas');
assert.ok(Math.abs(profileShape(profileCatalog['angulo-40x40x4']).area - 4 * (40 + 40 - 4)) < 1e-9);
assert.ok(Math.abs(profileShape(profileCatalog['u-80x40x4']).area - (40 * 4 + 2 * 4 * 76)) < 1e-9, 'canal: alma + 2 alas');
assert.throws(() => profileShape({ kind: 'tube', w: 20, h: 20, t: 12 }), /espesor/);

// dos barras en L con inglete: plano a 45°, largos de corte mayores al eje
const feature = { ...defaultFrameFeature(), members: [{ a: [0, 0, 0], b: [500, 0, 0] }, { a: [500, 0, 0], b: [500, 300, 0] }] };
let spec = frameSpec(feature);
assert.ok(spec.members[0].miter[1] && spec.members[1].miter[0], 'el nudo une exactamente dos barras');
assert.ok(Math.abs(spec.members[0].miter[1].angle - 45) < 1e-9, 'inglete a 45° en una esquina recta');
assert.equal(spec.members[0].miter[0], null);
const cut = cutList(spec);
assert.ok(Math.abs(cut.rows[0].cutLength - (500 + 20)) < 1e-6, `punta larga = eje + medio lado: ${cut.rows[0].cutLength}`);
assert.ok(cut.totalWeight > 0 && Math.abs(cut.rows[0].weight - (304 - (4 - Math.PI) * 8) * 500 * steelDensity) < 1e-9);
// sin inglete automático
spec = frameSpec({ ...feature, mitre: false });
assert.equal(spec.members[0].miter[1], null);
// barras en línea: corte recto aunque se encuentren
spec = frameSpec({ ...defaultFrameFeature(), members: [{ a: [0, 0, 0], b: [100, 0, 0] }, { a: [100, 0, 0], b: [250, 0, 0] }] });
assert.equal(spec.members[0].miter[1], null);
// tres barras en un nudo: no se ingleta
spec = frameSpec({ ...defaultFrameFeature(), members: [{ a: [0, 0, 0], b: [100, 0, 0] }, { a: [0, 0, 0], b: [0, 100, 0] }, { a: [0, 0, 0], b: [0, 0, 100] }] });
assert.ok(spec.members.every((m) => m.miter.every((x) => x === null)));
// expresiones y errores
spec = frameSpec({ ...defaultFrameFeature(), members: [{ a: [0, 0, 0], b: ['L', 0, 0] }] }, { L: 750 });
assert.equal(spec.members[0].length, 750);
assert.throws(() => frameSpec({ ...defaultFrameFeature(), members: [{ a: [1, 1, 1], b: [1, 1, 1] }] }), /coinciden/);

// caja: 4 columnas + 2 aros de 4 travesaños; los travesaños van entre caras de columna (a tope, no se ingletan porque en cada nudo hay 1 extremo)
const box = boxMembers({ sx: 800, sy: 600, sz: 900, post: 40 });
assert.equal(box.length, 12);
spec = frameSpec({ ...defaultFrameFeature(), members: box });
const c = cutList(spec);
assert.equal(c.summary.reduce((n, g) => n + g.qty, 0), 12);
assert.ok(c.summary.some((g) => g.qty === 4 && Math.abs(g.axisLength - 900) < 1e-9), '4 columnas iguales');
assert.ok(c.summary.some((g) => g.qty === 4 && Math.abs(g.axisLength - 760) < 1e-9), '4 travesaños de 760 entre columnas');
assert.ok(c.summary.some((g) => g.qty === 4 && Math.abs(g.axisLength - 560) < 1e-9));
// barras desde un boceto: un rectángulo centrado en el plano XZ (la normal va a −Y) da 4 barras con extremos en el mundo
{
  const frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  const members = sketchMembers({ entities: [{ t: 'rect', x: 0, y: 500, w: 800, h: 1000, centered: true }, { t: 'circle', x: 0, y: 0, d: 5 }] }, {}, frame);
  assert.equal(members.length, 4, 'el círculo se ignora');
  assert.deepEqual(members[0].a, [-400, 0, 0]);
  assert.deepEqual(members[0].b, [400, 0, 0]);
  assert.deepEqual(members[1].b, [400, 0, 1000]);
  const spec = frameSpec({ ...defaultFrameFeature(), members });
  assert.ok(spec.members.every((m) => m.miter.every((x) => x)), 'las 4 esquinas se ingletan');
}
console.log('frameGeometry ok');
