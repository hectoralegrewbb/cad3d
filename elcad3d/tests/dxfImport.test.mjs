import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { parseDxf } from '../src/io/dxfReader.js';
import { buildProfiles } from '../src/io/profileBuilder.js';

const rep = await loadKernel();
const dxf = (...entities) => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF'].join('\n');
const line = (x1, y1, x2, y2, layer = '0') => ['0', 'LINE', '8', layer, '10', x1, '20', y1, '30', 0, '11', x2, '21', y2, '31', 0];
const arc = (x, y, r, a0, a1, layer = '0') => ['0', 'ARC', '8', layer, '10', x, '20', y, '30', 0, '40', r, '50', a0, '51', a1];
const circle = (x, y, r, layer = '0') => ['0', 'CIRCLE', '8', layer, '10', x, '20', y, '30', 0, '40', r];
const area = (profile) => {
  let part = commands.addFeature(createPart('t'), 'sketch', { plane: 'XY' });
  const sk = part.features.at(-1).id;
  profile.entities.forEach((entity) => (part = commands.addEntity(part, sk, entity)));
  part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 1 });
  const built = buildPart(rep, part);
  assert.ok(built.shape, JSON.stringify(built.results));
  return rep.measureVolume(built.shape);
};

// 1) rectángulo con LINEs desordenadas y sentidos mezclados + agujero circular: 40×20 − π·5²
const rect = parseDxf(dxf(line(0, 0, 40, 0), line(40, 20, 40, 0), line(40, 20, 0, 20), line(0, 0, 0, 20), circle(20, 10, 5)));
assert.equal(rect.entities.length, 5);
const rp = buildProfiles(rect.entities);
assert.equal(rp.entities.length, 2);
assert.equal(rp.open.length, 0);
assert.ok(Math.abs(area(rp) - (800 - Math.PI * 25)) < 0.05, `área ${area(rp)}`);

// 2) ranura: dos líneas + dos semicírculos (LINE + ARC encadenados) de 30 de largo y 10 de ancho: 20·10 + π·25
const slot = parseDxf(dxf(line(10, 0, 30, 0), arc(30, 5, 5, 270, 90), line(30, 10, 10, 10), arc(10, 5, 5, 90, 270)));
const sp = buildProfiles(slot.entities);
assert.equal(sp.entities.length, 1);
assert.ok(Math.abs(area(sp) - (200 + Math.PI * 25)) < 0.5, `ranura ${area(sp)}`);

// 3) LWPOLYLINE cerrada con bulge (semicírculo arriba): 20×10 + π·10²/2
const lw = ['0', 'LWPOLYLINE', '8', '0', '90', 4, '70', 1, '10', 0, '20', 0, '10', 20, '20', 0, '10', 20, '20', 10, '42', 1, '10', 0, '20', 10];
const lwp = buildProfiles(parseDxf(dxf(lw)).entities);
assert.equal(lwp.entities.length, 1);
assert.ok(Math.abs(area(lwp) - (200 + (Math.PI * 100) / 2)) < 0.5, `bulge ${area(lwp)}`);

// 4) círculo hecho con dos arcos = círculo; lente de dos arcos distintos se divide y sigue siendo válida
const twoArcs = buildProfiles(parseDxf(dxf(arc(0, 0, 10, 0, 180), arc(0, 0, 10, 180, 360))).entities);
assert.deepEqual(twoArcs.entities.map((e) => e.t), ['circle']);
assert.ok(Math.abs(twoArcs.entities[0].d - 20) < 1e-6);
const lens = buildProfiles(parseDxf(dxf(arc(0, -4, 5.65685425, 45, 135), arc(0, 4, 5.65685425, 225, 315))).entities, { tolerance: 0.02 });
assert.equal(lens.entities.length, 1);
assert.ok(area(lens) > 10 && area(lens) < 20, `lente ${area(lens)}`);

// 5) unidades: $INSUNITS=1 (pulgadas) escala 25,4
const inch = parseDxf(['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', dxf(line(0, 0, 1, 0), line(1, 0, 1, 1), line(1, 1, 0, 1), line(0, 1, 0, 0))].join('\n'));
assert.equal(inch.unitScale, 25.4);
const ip = buildProfiles(inch.entities, { scale: inch.unitScale });
assert.ok(Math.abs(area(ip) - 25.4 * 25.4) < 0.1);

// 6) contornos abiertos se informan; entidades no soportadas se cuentan; tolerancia de cierre
const messy = parseDxf(dxf(line(0, 0, 10, 0), line(10, 0, 10, 10), ['0', 'SPLINE', '8', '0'], ['0', 'TEXT', '8', '0', '1', 'hola'], line(50, 0, 60, 0), line(60, 0, 60, 10), line(60, 10, 50, 10), line(50, 10, 50.004, 0.003)));
assert.deepEqual(messy.skipped, { SPLINE: 1, TEXT: 1 });
const mp = buildProfiles(messy.entities, { tolerance: 0.01 });
assert.equal(mp.entities.length, 1, 'el cuadrado de 50..60 cierra dentro de la tolerancia');
assert.equal(mp.open.length, 1);
assert.deepEqual(parseDxf(dxf(line(0, 0, 1, 1, 'COTAS'), line(0, 0, 1, 1, 'PIEZA'))).layers, ['COTAS', 'PIEZA']);

// 7) extrusión con Z = −1 espeja en X
const flipped = parseDxf(dxf(['0', 'LINE', '8', '0', '10', 5, '20', 0, '11', 10, '21', 0, '230', -1]));
assert.deepEqual(flipped.entities[0].a, [-5, 0]);

// 8) POLYLINE antigua con VERTEX
const old = parseDxf(dxf(['0', 'POLYLINE', '8', '0', '70', 1], ['0', 'VERTEX', '8', '0', '10', 0, '20', 0], ['0', 'VERTEX', '8', '0', '10', 10, '20', 0], ['0', 'VERTEX', '8', '0', '10', 10, '20', 10], ['0', 'SEQEND', '8', '0']));
assert.equal(old.entities.length, 1);
assert.equal(old.entities[0].closed, true);
console.log('dxfImport OK');
