import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dwgToEntities } from '../src/io/dwgEntities.js';
import { buildProfiles } from '../src/io/profileBuilder.js';

// 1) conversión pura (sin WASM): modelo de LibreDWG → modelo interno
const db = {
  entities: [
    { type: 'LINE', layer: 'A', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
    { type: 'LINE', layer: 'A', startPoint: { x: 10, y: 0 }, endPoint: { x: 10, y: 5 } },
    { type: 'ARC', layer: 'A', center: { x: 5, y: 5 }, radius: 5, startAngle: 0, endAngle: Math.PI, extrusionDirection: { x: 0, y: 0, z: 1 } },
    { type: 'LINE', layer: 'A', startPoint: { x: 0, y: 5 }, endPoint: { x: 0, y: 0 } },
    { type: 'CIRCLE', layer: 'B', center: { x: 5, y: 2 }, radius: 1 },
    { type: 'LWPOLYLINE', layer: 'C', flag: 512, vertices: [{ x: 20, y: 0, bulge: 0 }, { x: 30, y: 0, bulge: 0 }, { x: 30, y: 10, bulge: 0 }] },
    { type: 'ELLIPSE', layer: 'B', center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 4, y: 0 }, axisRatio: 0.5, startAngle: 0, endAngle: 2 * Math.PI },
    { type: 'HATCH', layer: 'B' }, { type: 'INSERT', layer: 'B' }, { type: 'MTEXT', layer: 'B' },
  ],
};
const out = dwgToEntities(db);
assert.deepEqual(out.layers, ['A', 'B', 'C']);
assert.deepEqual(out.skipped, { HATCH: 1, 'INSERT (bloques)': 1, MTEXT: 1 });
const profiles = buildProfiles(out.entities);
assert.deepEqual(profiles.entities.map((e) => e.t).sort(), ['circle', 'ellipse', 'poly', 'poly']);
assert.equal(out.entities.find((e) => e.type === 'polyline').closed, true, 'bit 512 = cerrado');
assert.equal(dwgToEntities({ entities: [{ type: 'LINE', layer: '0', startPoint: { x: 5, y: 0 }, endPoint: { x: 6, y: 0 }, extrusionDirection: { x: 0, y: 0, z: -1 } }] }).entities[0].a[0], -5, 'Z = −1 espeja X');

// 2) archivos reales (si LibreDWG está disponible junto al proyecto): se omite sin fallar si falta
import { fileURLToPath } from 'node:url';
const sample = process.env.DWG_SAMPLES ?? fileURLToPath(new URL('./data', import.meta.url));
if (sample && existsSync(`${sample}/example_2013.dwg`)) {
  const { readDwg } = await import('../src/io/dwgReader.js');
  const read = async (name) => { const buf = readFileSync(`${sample}/${name}`); return readDwg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); };
  const real = await read('example_2013.dwg');
  assert.ok(real.entities.length > 20 && real.layers.includes('Tavolo 2'), JSON.stringify(real.layers));
  assert.equal(real.unitScale, 1);
  const prof = buildProfiles(real.entities.filter((e) => e.layer === 'Tavolo 2'), { scale: 1, tolerance: 0.05 });
  assert.ok(prof.entities.length >= 1, 'Tavolo 2 tiene contornos cerrados');
  const small = await read('entities-2d.dwg');
  assert.ok(small.entities.some((e) => e.type === 'circle') && small.entities.some((e) => e.type === 'arc'));
  await assert.rejects(read('example_2000.dwg'), /No se pudo decodificar/);
  console.log('dwgImport (archivos reales) OK');
} else console.log('dwgImport: sin DWG_SAMPLES, se probó solo la conversión');
console.log('dwgImport OK');
