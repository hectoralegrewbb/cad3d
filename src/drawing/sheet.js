// Hoja normalizada (ISO 5457 / IRAM 4504): formato, marco, cajetín y escalas ISO 5455.

export const sheetSizes = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };
export const isoScales = [50, 20, 10, 5, 2, 1, 0.5, 0.4, 0.2, 0.1, 0.05, 0.04, 0.02, 0.01]; // factor de ampliación (2 = 2:1, 0.5 = 1:2)

// Escala propia de una vista: 'auto'/vacío = la de la hoja; si no, un factor de ampliación (2 = 2:1, 0.5 = 1:2).
export const viewScaleOf = (view) => {
  const value = view?.config?.scale ?? view?.scale;
  const n = Number(value);
  return value !== undefined && value !== null && value !== 'auto' && value !== '' && n > 0 && Number.isFinite(n) ? n : null;
};

// Texto del usuario → factor: «2:1», «1:3», «0,5», «2». Devuelve null si no se entiende.
export function parseScale(text) {
  const clean = String(text ?? '').trim().replace(',', '.');
  if (!clean || clean === 'auto') return 'auto';
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  const value = ratio ? Number(ratio[1]) / Number(ratio[2]) : Number(clean);
  return value > 0 && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

// Siguiente escala ISO más grande (dir = 1) o más chica (dir = -1) que la dada.
export function stepScale(current, dir) {
  const sorted = [...isoScales].sort((a, b) => a - b);
  if (dir > 0) return sorted.find((value) => value > current * 1.0001) ?? sorted[sorted.length - 1];
  return [...sorted].reverse().find((value) => value < current * 0.9999) ?? sorted[0];
}

export const formatScale = (scale) => (scale >= 1 ? `${scale}:1` : `1:${String(Math.round((1 / scale) * 10) / 10).replace('.', ',')}`);

export function sheetGeometry({ size = 'A4', orientation = 'landscape', notesLines = 0, extraHeight = 0 } = {}) {
  const [shortSide, longSide] = sheetSizes[size] ?? sheetSizes.A4;
  const width = orientation === 'portrait' ? shortSide : longSide;
  const height = orientation === 'portrait' ? longSide : shortSide;
  const margin = { left: 20, right: 10, top: 10, bottom: 10 };
  const frame = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom };
  const block = { w: Math.min(180, frame.w), h: 36 };
  block.x = frame.x + frame.w - block.w;
  block.y = frame.y + frame.h - block.h;
  // Zona útil para vistas: marco menos cajetín y un aire de 4 mm.
  const notesHeight = notesLines > 0 ? notesLines * 4 + 3 : 0;
  const area = { x: frame.x + 4, y: frame.y + 4, w: frame.w - 8, h: frame.h - 8 };
  // Obstáculo: cajetín + notas apiladas encima.
  const obstacle = { x: block.x, y: block.y - notesHeight - extraHeight, w: block.w, h: block.h + notesHeight + extraHeight };
  return { width, height, frame, block, obstacle, area, notesHeight, extraHeight, size, orientation };
}

// Disposición del primer diedro: columnas -1..2, filas -1 (arriba) / 0 / 1 (abajo).
const slotOf = { front: [0, 0], top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0], back: [3, 0], section: [2, 0], iso: [1, 1] };
export const slotFor = (kind) => slotOf[kind];

export function layoutViews(viewModels, sheet, { scale = 'auto', dimMargin = 14, gap = 4, margins = null } = {}) {
  if (viewModels.length === 0) return { scale: 1, placements: [], overflow: false };
  const cols = [...new Set(viewModels.map((view) => slotOf[view.kind][0]))].sort((a, b) => a - b);
  const rows = [...new Set(viewModels.map((view) => slotOf[view.kind][1]))].sort((a, b) => a - b); // fila -1 (vista inferior) arriba del papel; fila 1 (planta) debajo del frente
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // Cada vista puede tener su escala propia (view.config.scale); si no, usa la de la hoja.
  const scaleFor = (v, s) => viewScaleOf(v) ?? s;
  const compute = (s) => {
    // Margen de cotas por vista: el que pide el acotado real (o uno fijo si no se informa).
    const marginOf = Object.fromEntries(viewModels.map((v) => [v.id, margins ? margins(v, scaleFor(v, s)) : { left: dimMargin, right: dimMargin, top: dimMargin, bottom: dimMargin }]));
    const colViews = (c) => viewModels.filter((v) => slotOf[v.kind][0] === c);
    const rowViews = (r) => viewModels.filter((v) => slotOf[v.kind][1] === r);
    const colLeft = Object.fromEntries(cols.map((c) => [c, Math.max(...colViews(c).map((v) => marginOf[v.id].left))]));
    const colRight = Object.fromEntries(cols.map((c) => [c, Math.max(...colViews(c).map((v) => marginOf[v.id].right))]));
    const colInner = Object.fromEntries(cols.map((c) => [c, Math.max(...colViews(c).map((v) => v.bbox.width * scaleFor(v, s)))]));
    const rowTop = Object.fromEntries(rows.map((r) => [r, Math.max(...rowViews(r).map((v) => marginOf[v.id].top))]));
    const rowBottom = Object.fromEntries(rows.map((r) => [r, Math.max(...rowViews(r).map((v) => marginOf[v.id].bottom))]));
    const rowInner = Object.fromEntries(rows.map((r) => [r, Math.max(...rowViews(r).map((v) => v.bbox.height * scaleFor(v, s)))]));
    const colWidth = Object.fromEntries(cols.map((c) => [c, colLeft[c] + colInner[c] + colRight[c]]));
    const rowHeight = Object.fromEntries(rows.map((r) => [r, rowTop[r] + rowInner[r] + rowBottom[r]]));
    const total = { w: cols.reduce((sum, c) => sum + colWidth[c], 0) + gap * (cols.length - 1), h: rows.reduce((sum, r) => sum + rowHeight[r], 0) + gap * (rows.length - 1) };
    const attempt = (alignX, alignY) => {
    let x = sheet.area.x + (sheet.area.w - total.w) * alignX;
    const colX = {};
    cols.forEach((c) => {
      colX[c] = x;
      x += colWidth[c] + gap;
    });
    let y = sheet.area.y + (sheet.area.h - total.h) * alignY;
    const rowY = {};
    rows.forEach((r) => {
      rowY[r] = y;
      y += rowHeight[r] + gap;
    });
    const placements = viewModels.map((view) => {
      const [c, r] = slotOf[view.kind];
      const cx = colX[c] + colLeft[c] + colInner[c] / 2;
      const cy = rowY[r] + rowTop[r] + rowInner[r] / 2;
      const midU = (view.bbox.minX + view.bbox.maxX) / 2;
      const midV = (view.bbox.minY + view.bbox.maxY) / 2;
      // Zona ocupada por la vista con sus cotas.
      const mg = marginOf[view.id];
      const sv = scaleFor(view, s);
      const occupied = { x: cx - (view.bbox.width * sv) / 2 - mg.left, y: cy - (view.bbox.height * sv) / 2 - mg.top, w: view.bbox.width * sv + mg.left + mg.right, h: view.bbox.height * sv + mg.top + mg.bottom };
      return { id: view.id, scale: sv, own: viewScaleOf(view) !== null, ox: cx - midU * sv, oy: cy + midV * sv, cell: { x: colX[c], y: rowY[r], w: colWidth[c], h: rowHeight[r] }, occupied };
    });
    const insideArea = total.w <= sheet.area.w && total.h <= sheet.area.h;
    const clearOfBlock = placements.every((placement) => !overlaps(placement.occupied, sheet.obstacle));
    return { placements, ok: insideArea && clearOfBlock };
    };
    // Prueba alineaciones (centrado, izquierda/arriba…) hasta esquivar el cajetín.
    const tries = [[0.5, 0.5], [0, 0.5], [0.5, 0], [0, 0], [1, 0], [0, 1]];
    let last = null;
    for (const [alignX, alignY] of tries) {
      last = attempt(alignX, alignY);
      if (last.ok) return last;
    }
    return last;
  };

  const chosen = scale === 'auto' ? isoScales.find((s) => compute(s).ok) ?? isoScales[isoScales.length - 1] : Number(scale);
  const result = compute(chosen);
  return { scale: chosen, placements: result.placements, overflow: !result.ok, allOwn: viewModels.every((view) => viewScaleOf(view) !== null) };
}

// Coordenadas de papel (mm) de un punto (u,v) de una vista colocada. El eje v del modelo apunta arriba; el SVG hacia abajo.
export const toSheet = (placement, [u, v]) => [placement.ox + u * placement.scale, placement.oy - v * placement.scale];
