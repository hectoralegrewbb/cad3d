import { createPart } from '../src/core/partModel.js';
import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { commands } from '../src/core/commands.js';
import { templates } from '../src/data/templates.js';

const rep = await loadKernel();

// 1) todas las plantillas generan plano con cotas, cajetín y escala ISO
for (const [key, template] of Object.entries(templates)) {
  let part = template.build();
  part = commands.updateMeta(part, { material: 'sae1045' });
  const { shape } = buildPart(rep, part);
  const drawing = buildDrawing(rep, shape, part);
  assert.ok(drawing.dims.length > 0, `${key}: sin cotas`);
  assert.ok(!drawing.layout.overflow, `${key}: no entra en la hoja`);
  assert.ok(drawing.mass > 0, `${key}: masa 0`);
  const svg = drawing.svg();
  assert.match(svg, /<svg/);
  assert.match(svg, new RegExp(part.meta.name));
  assert.match(svg, />\d+:\d+(,\d+)?</, `${key}: sin escala`);
}

// 2) ocultar cota automática y restaurarla; cota manual se agrega y se quita
{
  let part = templates.eje.build();
  const { shape } = buildPart(rep, part);
  const base = buildDrawing(rep, shape, part);
  const auto = base.dims.find((dim) => dim.auto);
  part = commands.removeDim(part, auto);
  assert.equal(buildDrawing(rep, shape, part).dims.length, base.dims.length - 1);
  part = commands.restoreAutoDims(part);
  assert.equal(buildDrawing(rep, shape, part).dims.length, base.dims.length);
  part = commands.addDim(part, { view: 'front', type: 'linear', orientation: 'h', a: [0, 0], b: [10, 0], line: -20 });
  const withManual = buildDrawing(rep, shape, part);
  assert.equal(withManual.dims.length, base.dims.length + 1);
  assert.match(withManual.svg(), />10</);
  part = commands.removeDim(part, part.drawing.dims[0]);
  assert.equal(part.drawing.dims.length, 0);
}

// 3) DXF y formatos de hoja
{
  const { primitivesToDxf } = await import('../src/drawing/dxfWriter.js');
  let part = templates.soporte.build();
  part = commands.updateDrawing(part, { sheet: { size: 'A3', orientation: 'portrait' } });
  const drawing = buildDrawing(rep, buildPart(rep, part).shape, part);
  assert.equal(Math.round(drawing.sheet.width), 297);
  const dxf = primitivesToDxf(drawing.sheet, drawing.primitives);
  assert.match(dxf, /SECTION/);
  assert.match(dxf, /EOF/);
}
console.log('OK planos');

// 4) vista en corte e isométrica: rayado presente, cajetín intacto; un chaflán que se superpone se reporta como error
{
  let part = commands.updateMeta(templates.eje.build(), { material: 'sae1045' });
  part = commands.updateDrawing(part, { views: [{ id: 'front', kind: 'front', rotation: 0, showHidden: false, showAxes: true }, { id: 'section', kind: 'section', plane: 'x', offset: 'auto', label: 'A', showHidden: false, showAxes: true }, { id: 'iso', kind: 'iso', rotation: 0, showHidden: false, showAxes: false }] });
  const { shape } = buildPart(rep, part);
  const drawing = buildDrawing(rep, shape, part);
  assert.ok(!drawing.layout.overflow);
  assert.ok(drawing.primitives.filter((p) => p.layer === 'hatch').length > 3, 'sin rayado');
  assert.match(drawing.svg(), />A-A</);
  const section = drawing.viewModels.find((v) => v.kind === 'section');
  const xs = section.visible.flat().map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 40) < 0.1, 'el corte debe mostrar el perfil de 40 mm');
  assert.ok(Math.abs(drawing.mass - 0.83) < 0.01, `masa ${drawing.mass}`);

  const bad = commands.setParam(templates.eje.build(), 'c', 1.5);
  const built = buildPart(rep, bad);
  const failed = Object.values(built.results).find((r) => r.status === 'error');
  assert.ok(failed && /inválida/.test(failed.error), 'chaflán superpuesto debe fallar con mensaje claro');
}
console.log('OK corte/iso');

// Rosca: agujero con rosca M8 se rotula "M8×1,25" y dibuja el arco cosmético
{
  const { detectThread, resolveThread } = await import('../src/data/threads.js');
  assert.equal(detectThread('M', 6.8).label, 'M8×1,25');
  assert.equal(detectThread('M', 8).label, 'M8×1,25');
  assert.equal(detectThread('G', 19).name, 'G 1/2');
  assert.equal(detectThread('M', 7.3), null);
  assert.equal(resolveThread({ on: true, type: 'MF', size: 'auto' }, 7).label, 'M8×1');
  let part = templates.brida.build();
  const hole = part.features.find((f) => f.type === 'hole');
  part = commands.updateFeature(part, hole.id, { d: 6.8, thread: { on: true, type: 'M', size: 'auto', depth: 12 } });
  const { shape } = buildPart(rep, part);
  const drawing = buildDrawing(rep, shape, part);
  const svg = drawing.svg();
  assert.ok(svg.includes('M8×1,25 prof. 12'), 'rótulo de rosca en el plano');
  assert.ok(drawing.viewModels.some((v) => v.threadArcs.length > 0), 'arco de rosca cosmética');
  console.log('OK rosca');
}

// Cotas movidas a mano: la posición se guarda por clave y sobrevive a regenerar el plano
{
  let part = templates.placa.build();
  const { shape } = buildPart(rep, part);
  const first = buildDrawing(rep, shape, part);
  const dim = first.dims.find((d) => d.auto && d.type === 'linear' && d.orientation === 'h');
  part = commands.moveDim(part, dim, { line: dim.line - 30 });
  const second = buildDrawing(rep, shape, part);
  const moved = second.dims.find((d) => d.key === dim.key);
  assert.equal(moved.line, dim.line - 30, 'cota movida');
  part = commands.resetDimPositions(part);
  assert.equal(buildDrawing(rep, shape, part).dims.find((d) => d.key === dim.key).line, dim.line, 'posición restablecida');
  console.log('OK cotas movibles');
}

// Agujeros colocados a mano casi en círculo se acotan como PCD y todo queda dentro del marco de la hoja
{
  let part = createPart('Flange');
  part = commands.addFeature(part, 'sketch', { plane: 'XY' });
  const sk = part.features[0].id;
  part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 155 });
  part = commands.addEntity(part, sk, { t: 'circle', x: 0, y: 0, d: 50 });
  for (let i = 0; i < 8; i += 1) {
    const r = 62.5 + (i === 3 ? 0.4 : 0);
    part = commands.addEntity(part, sk, { t: 'circle', x: +(r * Math.cos((i * Math.PI) / 4)).toFixed(3), y: +(r * Math.sin((i * Math.PI) / 4)).toFixed(3), d: 8 });
  }
  part = commands.addFeature(part, 'extrude', { sketch: sk, depth: 10 });
  const { shape } = buildPart(rep, part);
  const drawing = buildDrawing(rep, shape, part);
  assert.ok(drawing.dims.some((d) => d.pcd), 'PCD detectado');
  assert.ok(!drawing.dims.some((d) => d.type === 'linear' && d.orientation === 'v' && d.view === 'top' && d.fixB), 'sin cadenas de agujeros sueltos');
  const frame = drawing.sheet.frame;
  const inside = drawing.primitives.filter((p) => p.k === 'line' && p.dim).every((p) => [[p.x1, p.y1], [p.x2, p.y2]].every(([x, y]) => x >= frame.x - 0.01 && x <= frame.x + frame.w + 0.01 && y >= frame.y - 0.01 && y <= frame.y + frame.h + 0.01));
  assert.ok(inside, 'cotas dentro del marco');
  console.log('OK flange a mano y marco');
}

// ---- escala propia por vista ----
{
  const { layoutViews, parseScale, stepScale, viewScaleOf, sheetGeometry } = await import('../src/drawing/sheet.js');
  assert.equal(parseScale('2:1'), 2);
  assert.equal(parseScale('1:3'), Math.round((1 / 3) * 1e6) / 1e6);
  assert.equal(parseScale('0,5'), 0.5);
  assert.equal(parseScale('auto'), 'auto');
  assert.equal(parseScale('x'), null);
  assert.equal(stepScale(1, 1), 2);
  assert.equal(stepScale(1, -1), 0.5);
  const sheet = sheetGeometry({ size: 'A3' });
  const views = [
    { id: 'front', kind: 'front', bbox: { width: 100, height: 60, minX: 0, maxX: 100, minY: 0, maxY: 60 }, config: {} },
    { id: 'top', kind: 'top', bbox: { width: 100, height: 40, minX: 0, maxX: 100, minY: 0, maxY: 40 }, config: {} },
  ];
  const base = layoutViews(views, sheet, { scale: 'auto' });
  const front0 = base.placements.find((p) => p.id === 'front').scale;
  assert.equal(base.placements.find((p) => p.id === 'top').scale, front0, 'sin escala propia: todas igual');
  const mixed = views.map((v) => (v.id === 'top' ? { ...v, config: { scale: 0.5 } } : v));
  assert.equal(viewScaleOf(mixed[1]), 0.5);
  const lay = layoutViews(mixed, sheet, { scale: 2 });
  assert.equal(lay.placements.find((p) => p.id === 'front').scale, 2, 'la vista sin escala propia usa la de la hoja');
  assert.equal(lay.placements.find((p) => p.id === 'top').scale, 0.5, 'la vista con escala propia la mantiene');
  assert.equal(lay.placements.find((p) => p.id === 'top').own, true);
  // la vista ampliada ocupa más papel
  const big = layoutViews(views.map((v) => (v.id === 'front' ? { ...v, config: { scale: 3 } } : v)), sheet, { scale: 1 });
  const occ = (lay2, id) => lay2.placements.find((p) => p.id === id).occupied;
  const growth = (occ(big, 'front').w - 28) / (occ(layoutViews(views, sheet, { scale: 1 }), 'front').w - 28);
  assert.ok(Math.abs(growth - 3) < 1e-9, `la vista a 3:1 mide el triple: ${growth}`);
  assert.equal(big.allOwn, false);
  console.log('escala por vista ok');
}
