import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { extractHoles } from '../src/drawing/features3d.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
import { rotateVector } from '../src/kernel/planes.js';

const rep = await loadKernel();
const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance;

// Cubo con barra: Ø20 x 22 con Ø7 y ranura; prisioneros Ø5 radiales a distintos ángulos con el plano rotado alrededor de Z.
const hubPart = (angles) => {
  let part = createPart('cubo');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const sk = part.features[0].id;
  part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 20 });
  part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 7 });
  part = commands.addEntity(part, sk, { t: 'slot', x: 30, y: 0, length: 60, width: 14, angle: 0 });
  part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 22 });
  angles.forEach((angle) => {
    part = commands.addFeature(part, 'hole', { plane: 'XZ', offset: 0, x: 0, y: 11, d: 5, through: true, thread: { on: true, type: 'M', size: 'M5', depth: 0 }, rot: angle ? { axis: 'z', angle, px: 0, py: 0, pz: 0 } : undefined });
  });
  return part;
};

// 1) rotar el plano de un agujero lo coloca en ese ángulo: el eje del agujero sale a 0°, 30° y 45° respecto de X
{
  const angles = [0, 30, 45];
  const built = buildPart(rep, hubPart(angles));
  Object.values(built.results).forEach((result) => assert.equal(result.status, 'ok', result.error));
  const radial = extractHoles(built.shape, rep).filter((hole) => near(hole.radius, 2.5));
  assert.equal(radial.length, 3, 'tres prisioneros');
  const found = radial.map((hole) => Math.round((Math.atan2(hole.axis[1], hole.axis[0]) * 180) / Math.PI + 360) % 180).sort((a, b) => a - b);
  // Plano XZ rotado: la normal (eje del agujero) queda en -Y girado ángulo° → a 270°+ángulo; módulo 180° = 90°+ángulo.
  assert.deepEqual(found, [90 + 0, 90 + 30, 90 + 45].map((v) => v % 180).sort((a, b) => a - b));
  // El agujero pasa por el centro de giro a la altura pedida (z = 11)
  radial.forEach((hole) => {
    // distancia del eje del agujero a la vertical por el centro de giro (0, 0, z)
    const dist = Math.abs(hole.center[0] * hole.axis[1] - hole.center[1] * hole.axis[0]);
    assert.ok(near(hole.center[2], 11, 1e-3) && near(dist, 0, 1e-3), JSON.stringify(hole));
  });
}

// 2) la rotación de bocetos: extrusión de un círculo sobre un plano rotado respeta el origen y los demás bocetos no se mueven
{
  let part = createPart('rot');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const base = part.features[0].id;
  part = commands.addEntity(part, base, { t: 'rect', x: 0, y: 0, w: 60, h: 60, centered: true });
  part = commands.addFeature(part, 'extrude', { sketch: base, depth: 30 });
  part = commands.addFeature(part, 'sketch', { plane: 'YZ', offset: 0, rot: { axis: 'z', angle: 90, px: 0, py: 0, pz: 0 } });
  const tilted = part.features.filter((f) => f.type === 'sketch')[1].id;
  part = commands.addEntity(part, tilted, { t: 'circle', x: 0, y: 15, d: 10 });
  part = commands.addFeature(part, 'extrude', { sketch: tilted, depth: 100, mode: 'cut', through: true });
  const built = buildPart(rep, part);
  assert.equal(built.results.extrude2.status, 'ok', built.results.extrude2.error);
  const holes = extractHoles(built.shape, rep);
  assert.equal(holes.length, 1);
  // YZ girado 90° sobre Z = plano XZ: su normal queda sobre Y y el agujero cruza el bloque en Y a x=0, z=15
  assert.ok(near(Math.abs(holes[0].axis[1]), 1) && near(holes[0].center[2], 15) && near(holes[0].center[0], 0), JSON.stringify(holes[0]));
  assert.deepEqual(rotateVector([1, 0, 0], [0, 0, 1], 90).map((v) => Math.round(v * 1e6) / 1e6), [0, 1, 0]);
}

// 3) el plano acota los prisioneros radiales: Ø/rosca, altura y ángulo
{
  const part = hubPart([0, 90, 45]);
  const built = buildPart(rep, part);
  const drawing = buildDrawing(rep, built.shape, part);
  const texts = drawing.dims.map((dim) => dim.text ?? '');
  const labels = drawing.dims.filter((dim) => dim.type === 'diameter' && /M5|Ø5/.test(dim.text ?? ''));
  assert.ok(labels.length >= 3, `rótulos de los prisioneros: ${labels.length}`);
  assert.ok(drawing.dims.some((dim) => dim.type === 'angle' && near(dim.value, 45, 0.01)), 'cota angular de 45°');
  assert.ok(drawing.dims.some((dim) => dim.type === 'linear' && dim.orientation === 'v' && near(Math.abs(dim.b[1] - dim.a[1]), 11, 0.05)), 'altura 11 del eje del prisionero');
  const svg = drawing.svg();
  assert.match(svg, />45°</);
  assert.match(svg, />70</, 'largo exacto, no 69,99');
  assert.ok(!drawing.layout.overflow);
  assert.ok(texts.length > 0);
}

// 4) mover cotas no reacomoda ni reescala el plano
{
  const part = hubPart([0, 90, 45]);
  const built = buildPart(rep, part);
  const base = buildDrawing(rep, built.shape, part);
  let moved = part;
  base.dims.filter((dim) => dim.auto).slice(0, 6).forEach((dim) => {
    moved = commands.moveDim(moved, dim, dim.type === 'linear' ? { line: (dim.line ?? 0) + (dim.orientation === 'v' ? 400 : -400) } : { angle: 10, reach: 80 });
  });
  const after = buildDrawing(rep, built.shape, moved);
  assert.equal(after.layout.scale, base.layout.scale, 'la escala no cambia al mover cotas');
  base.layout.placements.forEach((placement, i) => {
    const other = after.layout.placements[i];
    assert.ok(near(placement.ox, other.ox, 1e-6) && near(placement.oy, other.oy, 1e-6), 'las vistas no se desplazan');
  });
  const moveds = after.dims.filter((dim) => moved.drawing.dimOverrides[dim.key]);
  assert.ok(moveds.length >= 4, 'las cotas movidas conservan su posición');
}
// 5) aristas tangentes fuera del plano; cuerpos sueltos se detectan; el resaltado de cotas no engrosa el texto
{
  const { projectView } = await import('../src/drawing/projection.js');
  const { primitivesToSvg } = await import('../src/drawing/svgWriter.js');
  let part = createPart('tang');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const a = part.features[0].id;
  part = commands.addEntity(part, a, { t: 'slot', x: 30, y: 0, length: 80, width: 20, angle: 0 });
  part = commands.addFeature(part, 'extrude', { sketch: a, depth: 2 });
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const b = part.features.filter((f) => f.type === 'sketch')[1].id;
  part = commands.addEntity(part, b, { t: 'circle', x: 0, y: 0, d: 20 });
  part = commands.addFeature(part, 'extrude', { sketch: b, depth: 22 });
  const built = buildPart(rep, part);
  assert.equal(built.solids, 1);
  const front = projectView(rep, built.shape, 'front');
  // en la vista de frente no queda ninguna línea vertical dentro de la placa (z entre 0 y 2) salvo los bordes de la silueta
  const xs = new Set();
  front.visible.forEach((line) => {
    for (let i = 1; i < line.length; i += 1) {
      const [p, q] = [line[i - 1], line[i]];
      if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) > 0.5 && Math.max(p[1], q[1]) <= 2.0001) xs.add(Math.round(p[0] * 100) / 100);
    }
  });
  assert.deepEqual([...xs].sort((p, q) => p - q), [-10, 70], `líneas verticales en la placa: ${[...xs]}`);
  // dos cuerpos sin tocarse
  let apart = createPart('sueltos');
  apart = commands.addFeature(apart, 'sketch', { plane: 'XY' });
  const s1 = apart.features[0].id;
  apart = commands.addEntity(apart, s1, { t: 'circle', x: 0, y: 0, d: 10 });
  apart = commands.addEntity(apart, s1, { t: 'circle', x: 40, y: 0, d: 10 });
  apart = commands.addFeature(apart, 'extrude', { sketch: s1, depth: 5 });
  assert.equal(buildPart(rep, apart).solids, 2);
  const svg = primitivesToSvg({ width: 100, height: 100 }, [{ k: 'text', x: 1, y: 1, text: 'Ø4', size: 3.5, angle: 0, layer: 'text', dim: 'd1' }], { interactive: true, selectedDim: 'd1' });
  assert.match(svg, /text\.sel,polygon\.sel\{fill:#1a73e8;stroke:none\}/);
}

console.log('OK agujeros radiales, rotación de planos y layout estable');
