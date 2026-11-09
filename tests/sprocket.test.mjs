import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { createPart } from '../src/core/partModel.js';
import { laserEntitiesToDxf, bulgeArc } from '../src/io/laserDxf.js';
import { planarFaceLoops } from '../src/kernel/laserOutline.js';
import { loopsToLaserEntities } from '../src/core/laserOutline.js';
import { commands } from '../src/core/commands.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { addSprocket, addSprocketPair, isAsaChain, sprocketFeatureSpecs, sprocketArcProfile, centerForLinks, chainIds, chainLayout, chainLinks, chainTable, outlineArea, sprocketGeometry, sprocketOutline } from '../src/core/sprocket.js';

const near = (a, b, tol, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} vs ${b}`);
const rep = await loadKernel();

// 1) geometría pura para toda la tabla y varios z: contorno simple (área > 0 y entre pie y exterior)
for (const id of chainIds) {
  for (const z of [9, 11, 19, 40, 120]) {
    const g = sprocketGeometry({ chain: id, z, strands: 1 });
    const pts = sprocketOutline(g);
    const area = outlineArea(pts);
    assert.ok(area > Math.PI * (g.df / 2 - 0.1) ** 2 * 0.9 && area < Math.PI * (g.da / 2) ** 2, `${id} z=${z} área ${area.toFixed(1)}`);
    const r = pts.map(([x, y]) => Math.hypot(x, y));
    assert.ok(Math.max(...r) <= g.da / 2 + 1e-3, `${id} z=${z} radio exterior`);
    assert.ok(Math.min(...r) >= g.df / 2 - 1e-3, `${id} z=${z} radio de pie ${Math.min(...r)} < ${g.df / 2}`);
  }
}
// 2) cadena: eslabones ↔ distancia son inversos
{
  const p = 12.7;
  for (const [z1, z2, c] of [[19, 38, 400], [15, 15, 300], [11, 60, 800]]) {
    const L = Math.ceil(chainLinks(z1, z2, c, p) / 2) * 2;
    const cc = centerForLinks(z1, z2, L, p);
    near(chainLinks(z1, z2, cc, p), L, 1e-6, 'inverso');
    near(cc, c, p * 1.2, 'cerca de lo pedido');
  }
  const l = chainLayout(19, 38, 400, p);
  assert.equal(l.links % 2, 0);
}
// 3) anchos de hileras
near(sprocketGeometry({ chain: '08B', z: 19, strands: 2 }).width, 13.92 + 0.93 * 7.75, 1e-3);
near(sprocketGeometry({ chain: '16B', z: 19, strands: 3 }).width, 2 * 31.88 + 0.95 * 17.02, 1e-3);
assert.throws(() => sprocketGeometry({ chain: '08B', z: 5 }));
assert.throws(() => sprocketGeometry({ chain: 'XX', z: 19 }));

// 4) sólido real en el kernel: volumen consistente con el área del contorno
for (const [chain, z, strands, bore] of [['08B', 19, 1, 20], ['10B', 11, 2, 12], ['A80', 40, 3, 30]]) {
  const made = addSprocket(createPart('s'), { chain, z, strands, bore });
  const built = buildPart(rep, made.state);
  assert.ok(built.shape, `${chain} z=${z} se construye`);
  const vol = rep.measureVolume(built.shape);
  const g = made.geo;
  const toothVol = outlineArea(sprocketOutline(g)) * g.width;
  assert.ok(vol > 0.5 * toothVol && vol < 1.6 * toothVol, `${chain} z=${z}: volumen ${vol.toFixed(0)} vs dentado ${toothVol.toFixed(0)}`);
  const bb = rep.boundingBox ? rep.boundingBox(built.shape) : null;
  console.log(`  ${chain} z=${z} ×${strands}: ok volumen ${vol.toFixed(0)} mm³ (dentado ${toothVol.toFixed(0)})${bb ? '' : ''}`);
}
// 5) par: segunda rueda a la distancia corregida, acción de seguimiento con relación z1/z2 (mismo sentido)
{
  const made = addSprocket(createPart('par'), { chain: '08B', z: 19, strands: 1, bore: 16 });
  const pair = addSprocketPair(made.state, made.toothId, {}, { teeth: 38, distance: 400, thetaDeg: 0 });
  assert.equal(pair.links % 2, 0);
  const second = pair.state.features.find((f) => f.id === pair.mateToothId);
  near(second.sprocket.x, pair.center, 1e-3, 'centro 2 en X');
  const [master, follow] = pair.state.actions;
  assert.equal(follow.mode, 'follow'); assert.equal(follow.link.type, 'correa');
  assert.equal(follow.link.master, master.id); assert.equal(follow.link.a, 19); assert.equal(follow.link.b, 38);
  near(follow.pivot[0], pair.center, 1e-2); near(master.pivot[0], 0, 1e-9);
  assert.ok(buildPart(rep, pair.state).shape, 'el par se construye');
  assert.throws(() => addSprocketPair(made.state, made.toothId, {}, { teeth: 38, distance: 0 }));
  console.log(`  par ok · ${pair.links} eslabones · C=${pair.center} mm (pedido 400)`);
}
// 6) ASA 40 (= ANSI 40, ANSI B29.1): paso 1/2", Ø rodillo 7,92, asiento 1,005·d1 + 0,076, diente 0,93·b1 − 0,15
{
  assert.ok(isAsaChain('A40') && !isAsaChain('08B'));
  const g = sprocketGeometry({ chain: 'A40', z: 19 });
  assert.equal(g.designation, 'ASA 40'); assert.equal(g.standard, 'ASA / ANSI B29.1');
  assert.match(chainTable.A40.label, /ASA 40/); assert.match(chainTable.A40.label, /ANSI 40/);
  near(g.p, 12.7, 1e-9, 'paso'); near(g.d1, 7.92, 1e-9, 'rodillo');
  near(g.rp, 12.7 / (2 * Math.sin(Math.PI / 19)), 1e-9, 'radio primitivo');
  near(g.seatDiameter, 1.005 * 7.92 + 0.076, 1e-9, 'Ø asiento');
  near(g.df, g.pitchDiameter - g.seatDiameter, 1e-9, 'Ø pie = primitivo − asiento');
  near(g.da, 12.7 * (0.6 + 1 / Math.tan(Math.PI / 19)), 1e-9, 'Ø exterior');
  near(g.tooth, 0.93 * 7.95 - 0.15, 1e-9, 'ancho de diente');
  assert.equal(sprocketGeometry({ chain: '08B', z: 19 }).designation, 'ISO 08B');
}
// 7) plano del piñón ASA 40: notas con designación y diámetros, círculo primitivo/pie y cotas Ø exterior/primitivo/pie
{
  const made = addSprocket(createPart('asa40'), { chain: 'A40', z: 19, strands: 1, bore: 16 });
  const part = made.state;
  const specs = sprocketFeatureSpecs(part, {});
  assert.equal(specs.length, 1); near(specs[0].rp, made.geo.rp, 1e-9, 'rp');
  const drawing = buildDrawing(rep, buildPart(rep, part).shape, part);
  const notes = drawing.drawing.notes.join('\n');
  assert.match(notes, /Rueda de cadena ASA 40 \(ASA \/ ANSI B29\.1\) · paso 12,7 mm · 19 dientes · simple/);
  assert.match(notes, new RegExp(`Ø primitivo ${String(Math.round(made.geo.pitchDiameter * 100) / 100).replace('.', ',')}`));
  assert.match(notes, /Ø rodillo 7,92/);
  const front = drawing.viewModels.find((v) => v.sprockets?.some((item) => item.mode === 'face'));
  assert.ok(front, 'hay una vista de frente con la rueda');
  const edgeView = drawing.viewModels.find((v) => v.sprockets?.some((item) => item.mode === 'edge'));
  assert.ok(edgeView, 'hay una vista de canto con la rueda');
  const edgeDims = drawing.dims.filter((d) => d.view === edgeView.id && d.type === 'linear');
  assert.ok(edgeDims.some((d) => d.diameter && Math.abs(Math.abs(d.b[0] - d.a[0]) - made.geo.da) < 1e-6), 'Ø exterior de canto');
  assert.ok(edgeDims.some((d) => d.orientation === 'v' && Math.abs(Math.abs(d.b[1] - d.a[1]) - made.geo.width) < 1e-6), 'ancho del dentado de canto');
  const texts = drawing.dims.filter((d) => d.view === front.id && d.type === 'diameter').map((d) => d.text);
  ['Ø exterior', 'Ø primitivo', 'Ø pie'].forEach((name) => assert.ok(texts.some((t) => t?.startsWith(name)), `cota ${name}: ${texts}`));
  assert.ok(texts.some((t) => t === `Ø pie ${String(Math.round(made.geo.df * 100) / 100).replace('.', ',')}`), 'valor del Ø pie');
  assert.ok(front.threadMarks.some((m) => m.mode === 'pitch') && front.threadMarks.some((m) => m.mode === 'root'));
  console.log(`  plano ASA 40 ok · ${drawing.dims.length} cotas`);
}
// 8) DXF para láser desde la pieza REAL: piñón con asientos en arco exacto + agujeros y chaflanes agregados después
{
  const made = addSprocket(createPart('laser'), { chain: 'A40', z: 19, strands: 1, bore: 16 });
  const g = made.geo;
  let state = made.state;
  // agujero extra (corte pasante) y una polilínea con esquinas chaflanadas como boceto aparte
  state = commands.addFeature(state, 'sketch', { plane: 'XY', offset: 0 });
  const holeSketch = state.features[state.features.length - 1].id;
  state = commands.addEntity(state, holeSketch, { t: 'circle', x: 25, y: 0, d: 6 });
  state = commands.addFeature(state, 'extrude', { sketch: holeSketch, depth: 10, mode: 'cut', through: true });
  const built = buildPart(rep, state);
  const data = planarFaceLoops(rep, built.shape);
  const laser = loopsToLaserEntities(data);
  built.shape.delete();
  assert.equal(laser.circles.length, 2, 'agujero Ø16 + agujero extra Ø6');
  assert.deepEqual(laser.circles.map((c) => c.r).sort((a, b) => a - b), [3, 8]);
  assert.equal(laser.polylines.length, 1);
  const outline = laser.polylines[0].vertices;
  assert.equal(outline.length, 4 * 19, 'contorno dentado: 4 vértices por diente');
  assert.equal(outline.filter((v) => v.bulge).length, 19, 'un arco exacto por asiento');
  near(laser.width, g.da, 0.5, 'ancho ≈ Ø exterior'); near(laser.height, g.da, 0.5, 'alto ≈ Ø exterior');
  laser.circles.forEach((c) => assert.ok(c.x >= 0 && c.y >= 0));
  // el arco del asiento sale con el radio ASA
  const arc = bulgeArc(outline.find((v) => v.bulge), outline[(outline.findIndex((v) => v.bulge) + 1) % outline.length], outline.find((v) => v.bulge).bulge);
  near(arc.radius, g.seatDiameter / 2, 2e-3, 'radio del asiento ASA en la pieza real');
  const r2000 = laserEntitiesToDxf(laser, { format: 'r2000' });
  assert.match(r2000, /AC1015/); assert.equal((r2000.match(/\nCIRCLE\n/g) ?? []).length, 2); assert.equal((r2000.match(/\nLWPOLYLINE\n/g) ?? []).length, 1);
  assert.ok(r2000.lastIndexOf('CIRCLE') < r2000.indexOf('LWPOLYLINE'), 'agujeros antes que el contorno exterior');
  const r12 = laserEntitiesToDxf(laser, { format: 'r12' });
  assert.equal((r12.match(/\nARC\n/g) ?? []).length, 19); assert.equal((r12.match(/\nLINE\n/g) ?? []).length, 57); assert.doesNotMatch(r12, /LWPOLYLINE/);
  // chaflanes de boceto en un contorno rectangular: 4 esquinas → 8 vértices, medidas reales
  let plate = commands.addFeature(createPart('chapa'), 'sketch', { plane: 'XY', offset: 0 });
  const plateSketch = plate.features[plate.features.length - 1].id;
  plate = commands.addEntity(plate, plateSketch, { t: 'poly', pts: [{ x: 0, y: 0, c: 5 }, { x: 80, y: 0, c: 5 }, { x: 80, y: 40, c: 5 }, { x: 0, y: 40, c: 5 }] });
  plate = commands.addFeature(plate, 'extrude', { sketch: plateSketch, depth: 3, mode: 'add' });
  const plateBuilt = buildPart(rep, plate);
  const plateLaser = loopsToLaserEntities(planarFaceLoops(rep, plateBuilt.shape));
  plateBuilt.shape.delete();
  assert.equal(plateLaser.polylines[0].vertices.length, 8, 'chaflanes presentes en el contorno');
  assert.equal(plateLaser.width, 80); assert.equal(plateLaser.height, 40);
  assert.ok(plateLaser.polylines[0].vertices.every((v) => !v.bulge));
  console.log(`  DXF láser ok · piñón Ø${Math.round(g.da * 100) / 100} con ${laser.circles.length} agujeros · chapa chaflanada ${plateLaser.width}×${plateLaser.height}`);
}
console.log('sprocket ok');
