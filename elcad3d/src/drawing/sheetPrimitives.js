import { autoDimensions, faceCircles } from './autoDims.js';
import { dimMargins } from './dimExtents.js';
import { dimensionPrimitives } from './dimensions.js';
import { formatScale, layoutViews, sheetGeometry, toSheet } from './sheet.js';
import { materials } from './features3d.js';

export const defaultNotes = ['Tolerancias generales según ISO 2768-mK.', 'Rebajar cantos vivos 0,5 × 45°.', 'Rugosidad general Ra 3,2 µm.', 'Dimensiones en mm.'];
export const defaultTitleBlock = () => ({ number: '', author: '', date: '', revision: 'A', tolerance: 'ISO 2768-mK' });

export const defaultDrawing = () => ({
  sheet: { size: 'A4', orientation: 'landscape' },
  scale: 'auto',
  views: [
    { id: 'front', kind: 'front', rotation: 0, showHidden: false, showAxes: true },
    { id: 'top', kind: 'top', rotation: 0, showHidden: false, showAxes: true },
  ],
  autoDims: true,
  autoOptions: { general: true, diameters: true, holes: true, chains: true },
  dims: [],
  hiddenAuto: [],
  dimOverrides: {},
  viewOffsets: {}, // posición libre de cada vista en la hoja: id → [dx, dy] mm respecto del lugar automático
  notes: defaultNotes,
  titleBlock: defaultTitleBlock(),
});

const dateText = (value) => {
  if (value) return value;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
};

const formatMass = (kg) => (kg > 0 ? `${kg.toFixed(kg < 1 ? 3 : 2).replace('.', ',')} kg` : '—');

// Ejes y marcas de centro (línea fina de trazo y punto) en coordenadas del modelo de la vista.
export function centerlines(view, scale) {
  const ext = 2 / scale;
  const segments = [];
  faceCircles(view).forEach((circle) => {
    const [cx, cy] = circle.center;
    const r = circle.radius + ext;
    segments.push([[cx - r, cy], [cx + r, cy]], [[cx, cy - r], [cx, cy + r]]);
  });
  const groups = [];
  view.circles.filter((circle) => circle.closed && circle.mode === 'edge' && !circle.synthetic).forEach((circle) => {
    const group = groups.find((g) => Math.abs(Math.abs(g.axis[0] * circle.axis[0] + g.axis[1] * circle.axis[1]) - 1) < 1e-6 && Math.abs((circle.center[0] - g.center[0]) * g.perp[0] + (circle.center[1] - g.center[1]) * g.perp[1]) < 0.01);
    if (group) group.items.push(circle);
    else groups.push({ axis: circle.axis, perp: circle.perp, center: circle.center, items: [circle] });
  });
  groups.forEach((group) => {
    const ts = group.items.map((c) => (c.center[0] - group.center[0]) * group.axis[0] + (c.center[1] - group.center[1]) * group.axis[1]);
    const lo = Math.min(...ts) - ext;
    const hi = Math.max(...ts) + ext;
    segments.push([[group.center[0] + group.axis[0] * lo, group.center[1] + group.axis[1] * lo], [group.center[0] + group.axis[0] * hi, group.center[1] + group.axis[1] * hi]]);
  });
  // Eje de los agujeros sin arista circular (radiales / inclinados): línea de trazo y punto sobre todo su recorrido.
  view.circles.filter((circle) => circle.synthetic && circle.axisLine && circle.mode !== 'face').forEach((circle) => {
    const [a, b] = circle.axisLine;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-6) return;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    segments.push([[a[0] - ux * ext, a[1] - uy * ext], [b[0] + ux * ext, b[1] + uy * ext]]);
  });
  (view.extraCircles ?? []).forEach((circle) => {
    const points = Array.from({ length: 73 }, (_, i) => [circle.center[0] + circle.radius * Math.cos((i / 72) * 2 * Math.PI), circle.center[1] + circle.radius * Math.sin((i / 72) * 2 * Math.PI)]);
    segments.push(points);
  });
  return segments;
}

function titleBlockPrimitives(sheet, { meta, drawing, scale, mass }) {
  const { block } = sheet;
  const prims = [];
  const line = (x1, y1, x2, y2, layer = 'block') => prims.push({ k: 'line', x1, y1, x2, y2, layer });
  const text = (x, y, value, size, extra = {}) => prims.push({ k: 'text', x, y, text: value, size, angle: 0, anchor: 'start', layer: 'text', ...extra });
  const tb = { ...defaultTitleBlock(), ...(drawing.titleBlock ?? {}) };
  prims.push({ k: 'rect', x: block.x, y: block.y, w: block.w, h: block.h, layer: 'block' });
  const rows = [block.y + 12, block.y + 24];
  rows.forEach((y) => line(block.x, y, block.x + block.w, y));
  const cells = [
    [{ w: 110, label: 'Título', value: meta.name, big: true }, { w: 70, label: 'N° de plano', value: tb.number }],
    [{ w: 60, label: 'Material', value: materials[meta.material ?? '']?.label?.replace('— sin definir —', '') ?? '' }, { w: 30, label: 'Masa', value: formatMass(mass) }, { w: 30, label: 'Escala', value: typeof scale === 'string' ? scale : formatScale(scale) }, { w: 60, label: 'Tolerancia general', value: tb.tolerance }],
    [{ w: 50, label: 'Dibujó', value: tb.author }, { w: 40, label: 'Fecha', value: dateText(tb.date) }, { w: 20, label: 'Rev.', value: tb.revision }, { w: 70, label: 'Proyección / unidades', value: 'mm', symbol: true }],
  ];
  cells.forEach((row, rowIndex) => {
    let x = block.x;
    const top = block.y + rowIndex * 12;
    row.forEach((cell, cellIndex) => {
      if (cellIndex > 0) line(x, top, x, top + 12);
      text(x + 1.2, top + 3, cell.label, 2.1, { fill: 'muted' });
      const size = cell.big ? 5 : 3.5;
      const maxChars = Math.floor((cell.w - 2.4) / (size * 0.55));
      const value = String(cell.value ?? '');
      text(x + 1.2, top + 10, value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value, size);
      if (cell.symbol) {
        // Símbolo del primer diedro (ISO 5456-2): vista frontal a la izquierda, vista lateral (círculos) a la derecha.
        const sx = x + cell.w - 30;
        const sy = top + 7;
        prims.push({ k: 'poly', points: [[sx, sy - 3.2], [sx + 7, sy - 2], [sx + 7, sy + 2], [sx, sy + 3.2], [sx, sy - 3.2]], layer: 'block' });
        line(sx - 1.5, sy, sx + 10, sy, 'axes');
        prims.push({ k: 'circle', x: sx + 15, y: sy, r: 3.2, layer: 'block' }, { k: 'circle', x: sx + 15, y: sy, r: 2, layer: 'block' });
        line(sx + 10, sy, sx + 19, sy, 'axes');
        line(sx + 15, sy - 4.7, sx + 15, sy + 4.7, 'axes');
      }
      x += cell.w;
    });
  });
  return prims;
}

// Lista de materiales (ISO 7573): sobre el cajetín, encabezado abajo y posiciones en orden ascendente hacia arriba.
const BOM_ROW = 6;
const BOM_COLUMNS = [['Pos.', 10], ['Cant.', 14], ['Descripción', 76], ['Material', 50], ['Masa u.', 30]];
function bomPrimitives(sheet, rows) {
  if (!rows.length) return [];
  const prims = [];
  const total = BOM_COLUMNS.reduce((sum, [, w]) => sum + w, 0);
  const scale = sheet.block.w / total;
  const columns = BOM_COLUMNS.map(([title, w]) => [title, w * scale]);
  const bottom = sheet.block.y;
  const table = [{ cells: columns.map(([title]) => title), header: true }, ...rows.map((row) => ({ cells: [String(row.item), String(row.qty), row.name, row.material, row.mass] }))];
  table.forEach((row, r) => {
    const y1 = bottom - r * BOM_ROW;
    const y0 = y1 - BOM_ROW;
    prims.push({ k: 'line', x1: sheet.block.x, y1: y0, x2: sheet.block.x + sheet.block.w, y2: y0, layer: 'block' });
    let x = sheet.block.x;
    columns.forEach(([, w], c) => {
      prims.push({ k: 'line', x1: x, y1: y0, x2: x, y2: y1, layer: 'block' });
      prims.push({ k: 'text', x: x + 1.5, y: y1 - 1.8, text: row.cells[c], size: row.header ? 2.5 : 3, angle: 0, anchor: 'start', fill: row.header ? 'muted' : undefined, layer: 'text' });
      x += w;
    });
    prims.push({ k: 'line', x1: x, y1: y0, x2: x, y2: y1, layer: 'block' });
  });
  return prims;
}

// Globos numerados (ISO 6433) sobre la primera vista ortogonal, con línea de referencia al centro de cada instancia.
function balloonPrimitives(viewModels, placementById, balloons) {
  if (!balloons.length) return [];
  const view = ['front', 'top', 'left', 'right', 'back', 'bottom'].map((kind) => viewModels.find((v) => v.kind === kind)).find(Boolean) ?? viewModels.find((v) => v.kind !== 'section');
  const placement = view && placementById[view.id];
  if (!placement) return [];
  const prims = [];
  const radius = 4;
  const targets = balloons.map((balloon) => ({ n: balloon.n, target: toSheet(placement, view.map(balloon.point)) })).sort((a, b) => a.target[0] - b.target[0]);
  const y = placement.cell.y + radius + 2;
  let lastX = -Infinity;
  targets.forEach(({ n, target }) => {
    const x = Math.max(target[0], lastX + radius * 2 + 2);
    lastX = x;
    prims.push({ k: 'line', x1: x, y1: y + radius, x2: target[0], y2: target[1], layer: 'dims' });
    prims.push({ k: 'circle', x: target[0], y: target[1], r: 0.6, layer: 'dims' });
    prims.push({ k: 'circle', x, y, r: radius, layer: 'block' });
    prims.push({ k: 'text', x, y: y + 1.3, text: String(n), size: 3.5, angle: 0, anchor: 'middle', layer: 'text' });
  });
  return prims;
}

// Rayado a 45° (ISO 128-50) de una región (lazos en mm de papel, regla par/impar). Devuelve segmentos [[x1,y1],[x2,y2]].
export function hatchSegments(loops, spacing = 3) {
  const sums = loops.flat().map(([x, y]) => x + y);
  if (!sums.length) return [];
  const out = [];
  const step = spacing * Math.SQRT2;
  const start = Math.ceil(Math.min(...sums) / step) * step;
  for (let c = start; c < Math.max(...sums); c += step) {
    const xs = [];
    loops.forEach((loop) => {
      for (let i = 1; i < loop.length; i += 1) {
        const [px, py] = loop[i - 1];
        const [qx, qy] = loop[i];
        const ps = px + py;
        const qs = qx + qy;
        if (ps <= c !== qs <= c) xs.push(px + ((c - ps) / (qs - ps)) * (qx - px));
      }
    });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.3) out.push([[xs[i], c - xs[i]], [xs[i + 1], c - xs[i + 1]]]);
  }
  return out;
}

const axisOf = { x: 0, y: 1, z: 2 };
const lookDirection = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }; // hacia donde mira el observador de cada corte

// Rayado de la sección, rótulo "A-A" y trazas del plano de corte (con flechas y letras) en las vistas donde el plano se ve de canto.
function sectionPrimitives(viewModels, placementById, bounds) {
  const prims = [];
  viewModels.filter((view) => view.section).forEach((view) => {
    const placement = placementById[view.id];
    if (!placement) return;
    const { plane, offset, label, loops } = view.section;
    hatchSegments(loops.map((loop) => loop.map((point) => toSheet(placement, point))), 3).forEach(([a, b]) => prims.push({ k: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], layer: 'hatch', view: view.id }));
    prims.push({ k: 'text', x: placement.cell.x + 2, y: placement.cell.y + 6, text: `${label}-${label}`, size: 5, angle: 0, anchor: 'start', layer: 'text', view: view.id });
    if (!bounds) return;
    const i = axisOf[plane];
    const others = [0, 1, 2].filter((axis) => axis !== i);
    const centre = bounds[0].map((v, k) => (v + bounds[1][k]) / 2);
    const margin = 8; // mm de papel que sobresale la traza
    viewModels.filter((other) => !other.section && other.kind !== 'iso').forEach((other) => {
      const otherPlacement = placementById[other.id];
      if (!otherPlacement) return;
      const extent = margin / otherPlacement.scale;
      const candidates = others.map((axis) => {
        const a = [...centre];
        const b = [...centre];
        a[i] = offset;
        b[i] = offset;
        a[axis] = bounds[0][axis] - extent;
        b[axis] = bounds[1][axis] + extent;
        return [other.map(a), other.map(b)];
      });
      const lengths = candidates.map(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]));
      const edgeOn = lengths.filter((l) => l < 1e-6).length === 1;
      if (!edgeOn) return;
      const [a, b] = candidates[lengths[0] < 1e-6 ? 1 : 0].map((point) => toSheet(otherPlacement, point));
      const origin = other.map([0, 0, 0]);
      const look = other.map(lookDirection[plane]);
      let dx = look[0] - origin[0];
      let dy = -(look[1] - origin[1]); // eje v hacia arriba -> hoja hacia abajo
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      prims.push({ k: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], layer: 'axes' });
      [[a, 1], [b, -1]].forEach(([end, inward]) => {
        const tickEnd = [end[0] + ux * inward * 6, end[1] + uy * inward * 6];
        prims.push({ k: 'line', x1: end[0], y1: end[1], x2: tickEnd[0], y2: tickEnd[1], layer: 'visible' });
        const tip = [end[0] + dx * 7, end[1] + dy * 7];
        prims.push({ k: 'line', x1: end[0], y1: end[1], x2: tip[0], y2: tip[1], layer: 'visible' });
        const base = [tip[0] - dx * 4, tip[1] - dy * 4];
        prims.push({ k: 'arrow', points: [tip, [base[0] - dy * 1.4, base[1] + dx * 1.4], [base[0] + dy * 1.4, base[1] - dx * 1.4]], layer: 'dims' });
        prims.push({ k: 'text', x: tip[0] + dx * 4 - 0.3 + (dx === 0 ? 0 : 0), y: tip[1] + dy * 4 + 1.8, text: label, size: 5, angle: 0, anchor: 'middle', layer: 'text' });
      });
    });
  });
  return prims;
}

// Construye todas las primitivas de la hoja (en mm de papel) a partir de las vistas ya proyectadas.
export function buildSheetPrimitives({ viewModels, drawing, meta, mass = 0, bounds = null, extras = null, threads = [] }) {
  const noteLines = (drawing.notes ?? []).filter((note) => note.trim() !== '').length;
  const bomHeight = extras?.bom?.length ? (extras.bom.length + 1) * BOM_ROW : 0;
  const sheet = sheetGeometry({ ...drawing.sheet, notesLines: noteLines, extraHeight: bomHeight });
  // Cada vista reserva el espacio que necesitan sus cotas automáticas en su lugar natural (según la escala probada).
  // Las cotas movidas a mano y las manuales NO entran en el cálculo: mover una cota no debe reacomodar ni reescalar el plano.
  const margins = (view, scale) => {
    view.extraCircles = [];
    view.threadArcs = [];
    const auto = drawing.autoDims ? autoDimensions(view, { scale, options: drawing.autoOptions, threads, overrides: {} }).filter((dim) => !(drawing.hiddenAuto ?? []).includes(dim.key)) : [];
    return dimMargins(view, auto, scale);
  };
  const layout = layoutViews(viewModels, sheet, { scale: drawing.scale, margins });
  // Vistas movidas a mano: se desplazan respecto de su lugar automático (todo lo que se dibuja usa `placement`).
  const offsets = drawing.viewOffsets ?? {};
  layout.placements.forEach((placement) => {
    const offset = offsets[placement.id];
    if (!offset || (offset[0] === 0 && offset[1] === 0)) return;
    placement.ox += offset[0];
    placement.oy += offset[1];
    placement.cell = { ...placement.cell, x: placement.cell.x + offset[0], y: placement.cell.y + offset[1] };
    placement.occupied = { ...placement.occupied, x: placement.occupied.x + offset[0], y: placement.occupied.y + offset[1] };
    placement.moved = true;
  });
  const primitives = [];
  primitives.push({ k: 'rect', x: 0, y: 0, w: sheet.width, h: sheet.height, layer: 'paper' });
  primitives.push({ k: 'rect', x: sheet.frame.x, y: sheet.frame.y, w: sheet.frame.w, h: sheet.frame.h, layer: 'frame' });
  const placementById = Object.fromEntries(layout.placements.map((placement) => [placement.id, placement]));
  const viewById = Object.fromEntries(viewModels.map((view) => [view.id, view]));

  viewModels.forEach((view) => {
    const placement = placementById[view.id];
    const toPoly = (polyline) => polyline.map((point) => toSheet(placement, point));
    view.extraCircles = [];
    view.threadArcs = [];
    if (view.config.showHidden !== false) view.hidden.forEach((polyline) => primitives.push({ k: 'poly', points: toPoly(polyline), layer: 'hidden', view: view.id }));
    view.visible.forEach((polyline) => primitives.push({ k: 'poly', points: toPoly(polyline), layer: 'visible', view: view.id }));
  });

  primitives.push(...sectionPrimitives(viewModels, placementById, bounds));
  // Vistas con escala propia: se rotula al lado de la vista (ISO 5455) para que se lea qué se amplió.
  viewModels.forEach((view) => {
    const placement = placementById[view.id];
    if (!placement?.own) return;
    primitives.push({ k: 'text', x: placement.cell.x + 2, y: placement.cell.y + (view.section ? 12 : 3), text: `Esc. ${formatScale(placement.scale)}`, size: 3, angle: 0, anchor: 'start', layer: 'text', view: view.id });
  });

  const allDims = [];
  viewModels.forEach((view) => {
    const placement = placementById[view.id];
    if (drawing.autoDims) allDims.push(...autoDimensions(view, { scale: placement.scale, options: drawing.autoOptions, threads, overrides: drawing.dimOverrides ?? {} }).filter((dim) => !(drawing.hiddenAuto ?? []).includes(dim.key)));
  });
  viewModels.forEach((view) => {
    if (view.config.showAxes === false) return;
    const placement = placementById[view.id];
    centerlines(view, placement.scale).forEach((segment) => primitives.push({ k: 'poly', points: segment.map((point) => toSheet(placement, point)), layer: 'axes', view: view.id }));
  });
  // Rosca cosmética (ISO 6410): circunferencia fina de ¾ de vuelta al diámetro nominal, en las vistas de frente del agujero.
  viewModels.forEach((view) => {
    const placement = placementById[view.id];
    (view.threadArcs ?? []).forEach((arc) => {
      const points = Array.from({ length: 55 }, (_, i) => {
        const a = (0.15 + (i / 54) * 1.5) * Math.PI;
        return toSheet(placement, [arc.center[0] + arc.radius * Math.cos(a), arc.center[1] + arc.radius * Math.sin(a)]);
      });
      primitives.push({ k: 'poly', points, layer: 'dims', view: view.id });
    });
  });
  // Roscas con rango: de costado dos líneas finas entre A y B (una interna solo se ve en corte); de frente, ¾ de vuelta.
  viewModels.forEach((view) => {
    const placement = placementById[view.id];
    (view.threadMarks ?? []).forEach((mark) => {
      if (mark.mode === 'pitch') {
        const points = Array.from({ length: 73 }, (_, i) => toSheet(placement, [mark.center[0] + mark.radius * Math.cos((i / 72) * 2 * Math.PI), mark.center[1] + mark.radius * Math.sin((i / 72) * 2 * Math.PI)]));
        primitives.push({ k: 'poly', points, layer: 'axes', view: view.id });
      } else if (mark.mode === 'end') {
        const points = Array.from({ length: 55 }, (_, i) => {
          const a = (0.15 + (i / 54) * 1.5) * Math.PI;
          return toSheet(placement, [mark.center[0] + mark.radius * Math.cos(a), mark.center[1] + mark.radius * Math.sin(a)]);
        });
        primitives.push({ k: 'poly', points, layer: 'dims', view: view.id });
      } else if (!mark.internal || view.section) {
        [-1, 1].forEach((side) => primitives.push({ k: 'poly', points: [mark.a, mark.b].map((p) => toSheet(placement, [p[0] + side * mark.perp[0] * mark.radius, p[1] + side * mark.perp[1] * mark.radius])), layer: 'dims', view: view.id }));
      }
    });
  });
  (drawing.dims ?? []).forEach((dim) => allDims.push(dim));
  allDims.forEach((dim) => {
    const placement = placementById[dim.view];
    if (!placement || !viewById[dim.view]) return;
    const { lines, arrows, texts } = dimensionPrimitives(dim, placement);
    lines.forEach((l) => primitives.push({ k: 'line', ...l, layer: 'dims', dim: dim.id, view: dim.view }));
    arrows.forEach((points) => primitives.push({ k: 'arrow', points, layer: 'dims', dim: dim.id, view: dim.view }));
    texts.forEach((t) => primitives.push({ k: 'text', ...t, layer: 'text', dim: dim.id, view: dim.view }));
  });

  primitives.push(...titleBlockPrimitives(sheet, { meta, drawing, scale: layout.allOwn ? 'Indicada' : layout.scale, mass }));
  if (extras) {
    primitives.push(...bomPrimitives(sheet, extras.bom ?? []));
    primitives.push(...balloonPrimitives(viewModels, placementById, extras.balloons ?? []));
  }
  const notes = (drawing.notes ?? []).filter((note) => note.trim() !== '');
  notes.forEach((note, index) => primitives.push({ k: 'text', x: sheet.block.x, y: sheet.block.y - bomHeight - 3 - (notes.length - 1 - index) * 4, text: note, size: 2.8, angle: 0, anchor: 'start', layer: 'text' }));
  return { sheet, layout, primitives, dims: allDims };
}
