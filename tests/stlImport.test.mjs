import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { decodeMesh, encodeMesh } from '../src/core/meshCodec.js';
import { parseStl } from '../src/io/stlReader.js';

const rep = await loadKernel();

// ---------- utilidades de prueba ----------
// Cubo [0,s]³ como 12 triángulos con la normal hacia afuera; `inward` invierte el orden de los vértices.
const cubeTriangles = (size, origin = [0, 0, 0], inward = false) => {
  const p = (x, y, z) => [origin[0] + x * size, origin[1] + y * size, origin[2] + z * size];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)], // z=0 (hacia -z)
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], // z=1
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], // y=0
    [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)], // y=1
    [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)], // x=0
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], // x=1
  ];
  const out = [];
  quads.forEach(([a, b, c, d]) => {
    out.push(inward ? [a, c, b] : [a, b, c], inward ? [a, d, c] : [a, c, d]);
  });
  return out;
};

const binaryStl = (triangles) => {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, i) => {
    let offset = 84 + i * 50 + 12;
    triangle.forEach((point) => point.forEach((value) => {
      view.setFloat32(offset, value, true);
      offset += 4;
    }));
  });
  return buffer;
};

const asciiStl = (triangles) => {
  const lines = ['solid test'];
  triangles.forEach((triangle) => {
    lines.push('facet normal 0 0 0', 'outer loop');
    triangle.forEach((point) => lines.push(`vertex ${point[0]} ${point[1]} ${point[2]}`));
    lines.push('endloop', 'endfacet');
  });
  lines.push('endsolid test');
  return new TextEncoder().encode(lines.join('\n')).buffer;
};

const featureFrom = (buffer, patch = {}) => ({ file: 'test.stl', mesh: encodeMesh(parseStl(buffer)), ...patch });
const partWith = (...features) => features.reduce((part, patch) => commands.addFeature(part, 'mesh', patch), createPart('malla'));
const volumeOf = (built) => rep.measureVolume(built.shape);

// 1) lector: binario y de texto dan la misma malla; vértices unificados; cerrada
{
  const triangles = cubeTriangles(10);
  const binary = parseStl(binaryStl(triangles));
  const ascii = parseStl(asciiStl(triangles));
  assert.equal(binary.triangleCount, 12);
  assert.equal(binary.vertexCount, 8);
  assert.equal(binary.openEdges, 0);
  assert.equal(binary.multiEdges, 0);
  assert.deepEqual(binary.bounds.size, [10, 10, 10]);
  assert.equal(ascii.triangleCount, 12);
  assert.equal(ascii.vertexCount, 8);
}

// 2) lector: errores claros
{
  assert.throws(() => parseStl(new ArrayBuffer(10)), /demasiado chico/);
  assert.throws(() => parseStl(new TextEncoder().encode('esto no es un stl, es texto cualquiera').buffer), /No parece un STL/);
  const open = parseStl(binaryStl(cubeTriangles(10).slice(2)));
  assert.equal(open.openEdges > 0, true);
}

// 3) códec: ida y vuelta exacta
{
  const mesh = parseStl(binaryStl(cubeTriangles(7)));
  const back = decodeMesh(encodeMesh(mesh));
  assert.deepEqual([...back.vertices], [...mesh.vertices]);
  assert.deepEqual([...back.triangles], [...mesh.triangles]);
  assert.throws(() => decodeMesh({ nv: 8, nt: 12, v: 'AAAA', t: 'AAAA' }), /dañada/);
}

// 4) cubo → un sólido válido, 6 caras (los triángulos coplanares se funden), volumen 1000
{
  const built = buildPart(rep, partWith(featureFrom(binaryStl(cubeTriangles(10)))));
  assert.equal(built.results.mesh1.status, 'ok', built.results.mesh1.error);
  assert.equal(built.solids, 1);
  assert.equal(built.shape.faces.length, 6);
  assert.ok(Math.abs(volumeOf(built) - 1000) < 1e-6);
  const mesh = extractMesh(built.shape);
  assert.ok(mesh.triangles.length / 3 >= 12);
}

// 5) escala (número y expresión con parámetros)
{
  const doubled = buildPart(rep, partWith(featureFrom(binaryStl(cubeTriangles(10)), { scale: 2 })));
  assert.ok(Math.abs(volumeOf(doubled) - 8000) < 1e-4);
  let part = commands.setParam(createPart('p'), 'k', 0.5);
  part = commands.addFeature(part, 'mesh', featureFrom(binaryStl(cubeTriangles(10)), { scale: 'k' }));
  assert.ok(Math.abs(volumeOf(buildPart(rep, part)) - 125) < 1e-4);
  const bad = buildPart(rep, partWith(featureFrom(binaryStl(cubeTriangles(10)), { scale: 0 })));
  assert.equal(bad.results.mesh1.status, 'error');
}

// 6) triángulos con la normal hacia adentro: el volumen sale positivo igual
{
  const built = buildPart(rep, partWith(featureFrom(binaryStl(cubeTriangles(10, [0, 0, 0], true)))));
  assert.equal(built.results.mesh1.status, 'ok', built.results.mesh1.error);
  assert.ok(Math.abs(volumeOf(built) - 1000) < 1e-6);
}

// 7) dos cuerpos sueltos en el mismo STL → dos sólidos
{
  const two = [...cubeTriangles(10), ...cubeTriangles(10, [50, 0, 0])];
  const built = buildPart(rep, partWith(featureFrom(binaryStl(two))));
  assert.equal(built.results.mesh1.status, 'ok', built.results.mesh1.error);
  assert.equal(built.solids, 2);
  assert.ok(Math.abs(volumeOf(built) - 2000) < 1e-5);
}

// 8) malla abierta → error con mensaje útil; las operaciones siguientes se saltean
{
  const built = buildPart(rep, partWith(featureFrom(binaryStl(cubeTriangles(10).slice(2)))));
  assert.equal(built.results.mesh1.status, 'error');
  assert.match(built.results.mesh1.error, /no es un sólido cerrado/);
  assert.equal(built.shape, null);
}

// 9) corte con otra malla y desplazamiento (move): 1000 − 5³ = 875
{
  const part = partWith(
    featureFrom(binaryStl(cubeTriangles(10))),
    featureFrom(binaryStl(cubeTriangles(5)), { mode: 'cut', move: [2, 2, 2] }),
  );
  const built = buildPart(rep, part);
  assert.equal(built.results.mesh2.status, 'ok', built.results.mesh2.error);
  assert.ok(Math.abs(volumeOf(built) - 875) < 1e-5);
}

// 10) mover la malla con el comando de la herramienta Mover
{
  let part = partWith(featureFrom(binaryStl(cubeTriangles(10))));
  part = commands.translateFeatures(part, ['mesh1'], [100, 0, 0]);
  const built = buildPart(rep, part);
  assert.deepEqual(built.shape.boundingBox.bounds[0].map((v) => Math.round(v)), [100, 0, 0]);
}

// 11) giro del cuerpo (turn) igual que en otras operaciones: 90° sobre Z deja el cubo en [-10,0]×[0,10]
{
  const part = partWith(featureFrom(binaryStl(cubeTriangles(10)), { turn: { axis: 'z', angle: 90, px: 0, py: 0, pz: 0 } }));
  const built = buildPart(rep, part);
  const [min, max] = built.shape.boundingBox.bounds;
  assert.deepEqual([min[0], max[0], min[1], max[1]].map((v) => Math.round(v)), [-10, 0, 0, 10]);
}

// 12) dos cubos que se tocan solo en una arista (4 triángulos en la misma arista): dos sólidos válidos, sin mezclar caras
{
  const touching = [...cubeTriangles(10), ...cubeTriangles(10, [10, 10, 0])];
  const stl = parseStl(binaryStl(touching));
  assert.equal(stl.multiEdges, 1);
  const built = buildPart(rep, partWith({ file: 'aristas.stl', mesh: encodeMesh(stl) }));
  assert.equal(built.results.mesh1.status, 'ok', built.results.mesh1.error);
  assert.equal(built.solids, 2);
  assert.ok(Math.abs(volumeOf(built) - 2000) < 1, `volumen ${volumeOf(built)}`);
}

// 13) operaciones posteriores sobre una malla teselada (placa + agujero + corte): el kernel no debe re-unificar caras casi coplanares
{
  // Cubo con una esfera aproximada por una caja girada: caras que casi (no exactamente) son coplanares tras el redondeo a float32.
  const tilted = cubeTriangles(10).map((triangle) => triangle.map(([x, y, z]) => [Math.fround(x + z * 1e-5), Math.fround(y), Math.fround(z)]));
  let part = commands.addFeature(createPart('mixta'), 'sketch', { plane: 'XY' });
  const sketchId = part.features[0].id;
  part = commands.addEntity(part, sketchId, { t: 'rect', x: 0, y: 0, w: 60, h: 60 });
  part = commands.addFeature(part, 'extrude', { sketch: sketchId, depth: 5 });
  part = commands.addFeature(part, 'mesh', featureFrom(binaryStl(tilted), { move: [-5, -5, 5] }));
  part = commands.addFeature(part, 'hole', { plane: 'XY', offset: 0, x: 20, y: 20, d: 6, depth: 5, through: true });
  const built = buildPart(rep, part);
  Object.entries(built.results).forEach(([id, result]) => assert.equal(result.status, 'ok', `${id}: ${result.error}`));
  assert.ok(volumeOf(built) > 18000 - 1);
  assert.equal(globalThis.__elcadNoSimplify, undefined, 'el interruptor se restituye al terminar');
}

// 14) muestra real opcional: STL_SAMPLE=/ruta/al/archivo.stl
if (process.env.STL_SAMPLE) {
  const data = readFileSync(process.env.STL_SAMPLE);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const stl = parseStl(buffer);
  const t0 = Date.now();
  const built = buildPart(rep, partWith({ file: 'muestra.stl', mesh: encodeMesh(stl) }));
  assert.equal(built.results.mesh1.status, 'ok', built.results.mesh1.error);
  const mesh = extractMesh(built.shape);
  const withPlate = partWith({ file: 'muestra.stl', mesh: encodeMesh(stl) }, featureFrom(binaryStl(cubeTriangles(20)), { move: [100, 0, 0] }), featureFrom(binaryStl(cubeTriangles(20)), { mode: 'cut', move: [400, 300, 20] }));
  const chained = buildPart(rep, withPlate);
  Object.entries(chained.results).forEach(([id, result]) => assert.equal(result.status, 'ok', `${id}: ${result.error}`));
  assert.ok(chained.solids >= 3, `cuerpos tras encadenar: ${chained.solids}`);
  console.log(`muestra: ${stl.triangleCount} triángulos → ${built.shape.faces.length} caras, ${built.solids} cuerpo(s), ${Math.round(volumeOf(built))} mm³, ${mesh.triangles.length / 3} triángulos de malla, ${Date.now() - t0} ms`);
}

console.log('stlImport.test OK');
