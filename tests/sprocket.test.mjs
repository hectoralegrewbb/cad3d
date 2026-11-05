import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { createPart } from '../src/core/partModel.js';
import { addSprocket, addSprocketPair, centerForLinks, chainIds, chainLayout, chainLinks, chainTable, outlineArea, sprocketGeometry, sprocketOutline } from '../src/core/sprocket.js';

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
console.log('sprocket ok');
