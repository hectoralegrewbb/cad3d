import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { buildPart } from '../src/kernel/partBuilder.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { projectView, toViewPoint, viewKinds } from '../src/drawing/projection.js';
import { buildDrawing } from '../src/drawing/buildDrawing.js';
import { templates } from '../src/data/templates.js';

const rep = await loadKernel();
const distToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Verdad de campo: las aristas 3D proyectadas con la regla de ingeniería (primer diedro) deben contener toda línea visible
// y producir el mismo recuadro. Una vista espejada o con lados cambiados falla en piezas asimétricas.
for (const key of ['soporte', 'placa', 'brida', 'eje']) {
  const part = templates[key].build();
  const { shape } = buildPart(rep, part);
  const mesh = extractMesh(shape);
  for (const kind of viewKinds) {
    const edges2d = mesh.edges.map((edge) => {
      const pts = [];
      for (let i = 0; i < edge.points.length; i += 3) pts.push(toViewPoint(kind, [edge.points[i], edge.points[i + 1], edge.points[i + 2]]));
      return pts;
    });
    const projected = projectView(rep, shape, kind);
    const tol = key === 'brida' || key === 'eje' ? 0.5 : 0.05; // aristas curvas: la malla las aproxima por cuerdas
    const bad = projected.visible.flat().filter((point) => !edges2d.some((pts) => pts.some((p, i) => i > 0 && distToSegment(point, pts[i - 1], p) < tol)));
    assert.equal(bad.length, 0, `${key}/${kind}: ${bad.length} puntos visibles fuera de las aristas proyectadas (ej. ${JSON.stringify(bad[0])})`);
    const all = edges2d.flat();
    const box = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
    const got = [projected.bbox.minX, projected.bbox.maxX, projected.bbox.minY, projected.bbox.maxY];
    got.forEach((value, i) => assert.ok(Math.abs(value - box[i]) < tol, `${key}/${kind}: recuadro ${got.map((v) => v.toFixed(2))} != ${box.map((v) => v.toFixed(2))}`));
  }
}

// Cotas: los extremos de cada cota lineal automática deben ser puntos reales de la vista y la medida debe coincidir.
for (const key of ['soporte', 'placa', 'eje', 'brida']) {
  const part = templates[key].build();
  const { shape } = buildPart(rep, part);
  const drawing = buildDrawing(rep, shape, part);
  drawing.dims.filter((dim) => dim.type === 'linear' && dim.auto).forEach((dim) => {
    const view = drawing.viewModels.find((item) => item.id === dim.view);
    const onGeometry = (point) => view.visible.concat(view.hidden).some((line) => line.some((p, i) => i > 0 && distToSegment(point, line[i - 1], p) < 0.05)) || view.circles.some((c) => Math.abs(Math.hypot(point[0] - c.center[0], point[1] - c.center[1]) - c.radius) < 0.05 || Math.hypot(point[0] - c.center[0], point[1] - c.center[1]) < 0.05) || view.revolveView;
    assert.ok(onGeometry(dim.a) && onGeometry(dim.b), `${key}/${dim.view}: cota fuera de la geometría ${JSON.stringify([dim.a, dim.b])}`);
  });
}
console.log('OK vistas y lados');
