// Acotado automático: cotas generales, diámetros, agujeros (n× Ø, PCD) y cadenas de longitudes.
import { formatNumber } from './dimensions.js';

let counter = 0;
const uid = (viewId) => `auto_${viewId}_${(counter += 1)}`;
const near = (a, b, tolerance = 0.01) => Math.abs(a - b) < tolerance;
const unique = (values, tolerance = 0.01) => {
  const out = [];
  [...values].sort((a, b) => a - b).forEach((value) => {
    if (out.length === 0 || value - out[out.length - 1] > tolerance) out.push(value);
  });
  return out;
};

// Descarta posiciones demasiado juntas para acotarlas (quedan fuera cotas ilegibles de 1-2 mm de papel). Los extremos siempre se conservan.
export function thin(values, minGap) {
  const sorted = unique(values);
  if (sorted.length <= 2) return sorted;
  const kept = [sorted[0]];
  for (let i = 1; i < sorted.length - 1; i += 1) if (sorted[i] - kept[kept.length - 1] >= minGap) kept.push(sorted[i]);
  while (kept.length > 1 && sorted[sorted.length - 1] - kept[kept.length - 1] < minGap) kept.pop();
  kept.push(sorted[sorted.length - 1]);
  return kept;
}

// Círculos vistos de frente, sin duplicados (la cara superior e inferior de un agujero se proyectan igual).
export function faceCircles(view) {
  const seen = [];
  view.circles
    .filter((circle) => circle.closed && circle.mode === 'face')
    .forEach((circle) => {
      if (!seen.some((other) => near(other.center[0], circle.center[0], 0.01) && near(other.center[1], circle.center[1], 0.01) && near(other.radius, circle.radius, 0.01))) seen.push(circle);
    });
  return seen;
}

const linear = (view, patch) => ({ id: uid(view.id), auto: true, view: view.id, type: 'linear', ...patch });

function revolvedSide(view, settings, mm) {
  const dims = [];
  const r = view.revolve;
  const horizontal = r.horizontal;
  const along = (t) => (horizontal ? r.at(t)[0] : r.at(t)[1]);
  const middle = horizontal ? r.origin[1] : r.origin[0];
  const { bbox } = view;
  const lo = Math.min(along(r.lo), along(r.hi));
  const hi = Math.max(along(r.lo), along(r.hi));
  const boundaries = thin([lo, hi, ...r.planes.map(along)], mm(4));
  const base = mm(10);
  const row = mm(8);
  if (settings.diameters) {
    // En un corte también se acotan los diámetros interiores (visibles en la sección).
    const all = r.cylinders.filter((cylinder) => !cylinder.internal || view.kind === 'section');
    const keyOf = (cylinder) => `${cylinder.internal ? 'i' : 'e'}${Math.round(cylinder.r * 200)}`;
    const groups = [...new Set(all.map(keyOf))].map((key) => all.filter((c) => keyOf(c) === key).sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))[0]);
    groups.sort((a, b) => b.r - a.r);
    let outside = 0;
    const taken = []; // posiciones axiales ya ocupadas por cotas de diámetro dentro de la vista
    const minSep = mm(7);
    const placeDirect = (start, end) => {
      const low = Math.min(start, end);
      const span = Math.abs(end - start);
      // Se prueban varias posiciones dentro del tramo para que los textos no se encimen.
      const options = [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => low + span * f);
      return options.find((candidate) => taken.every((other) => Math.abs(other - candidate) >= minSep)) ?? null;
    };
    groups.forEach((cylinder) => {
      const start = along(cylinder.t0);
      const end = along(cylinder.t1);
      const touchesHi = near(Math.max(start, end), hi, 0.02);
      const touchesLo = near(Math.min(start, end), lo, 0.02);
      const narrow = Math.abs(end - start) < mm(14);
      const slot = narrow ? null : placeDirect(start, end);
      if (slot === null && (touchesHi || touchesLo)) {
        // Tramo corto o sin lugar: la cota va fuera de la vista, con líneas de referencia que nacen en la silueta.
        const up = touchesHi && touchesLo ? outside % 2 === 0 : touchesHi;
        const level = Math.floor(outside / (touchesHi && touchesLo ? 2 : 1));
        outside += 1;
        const edge = up ? hi : lo;
        const gap = base + level * mm(8);
        const dim = horizontal
          ? linear(view, { orientation: 'v', diameter: true, a: [edge, middle - cylinder.r], b: [edge, middle + cylinder.r], line: up ? bbox.maxX + gap : bbox.minX - gap })
          : linear(view, { orientation: 'h', diameter: true, a: [middle - cylinder.r, edge], b: [middle + cylinder.r, edge], line: up ? bbox.maxY + gap : bbox.minY - gap });
        dims.push(dim);
        return;
      }
      const position = slot ?? (start + end) / 2;
      taken.push(position);
      dims.push(horizontal
        ? linear(view, { orientation: 'v', diameter: true, direct: true, a: [position, middle - cylinder.r], b: [position, middle + cylinder.r], line: position })
        : linear(view, { orientation: 'h', diameter: true, direct: true, a: [middle - cylinder.r, position], b: [middle + cylinder.r, position], line: position }));
    });
  }
  if (settings.chains || settings.general) {
    let level = 0;
    if (settings.chains && boundaries.length > 2) {
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        dims.push(horizontal
          ? linear(view, { orientation: 'h', a: [boundaries[i], bbox.minY], b: [boundaries[i + 1], bbox.minY], line: bbox.minY - base })
          : linear(view, { orientation: 'v', a: [bbox.maxX, boundaries[i]], b: [bbox.maxX, boundaries[i + 1]], line: bbox.maxX + base }));
      }
      level = 1;
    }
    if (settings.general) {
      dims.push(horizontal
        ? linear(view, { orientation: 'h', a: [lo, bbox.minY], b: [hi, bbox.minY], line: bbox.minY - base - level * row })
        : linear(view, { orientation: 'v', a: [bbox.maxX, lo], b: [bbox.maxX, hi], line: bbox.maxX + base + level * row }));
    }
  }
  return dims;
}

const r2 = (value) => Math.round(value * 100) / 100;
// Clave estable de una cota automática (para poder ocultarla de forma persistente).
export function dimKey(dim) {
  const pt = (p) => (p ? `${r2(p[0])},${r2(p[1])}` : '');
  return [dim.view, dim.type, dim.orientation ?? '', pt(dim.a), pt(dim.b), pt(dim.center), dim.radius !== undefined ? r2(dim.radius) : '', dim.pcd ? 'pcd' : '', dim.type === 'angle' ? r2(dim.from) : ''].join('|');
}

// Corta la silueta visible con la recta (coordenada m = t) y devuelve la coordenada perpendicular más extrema del lado s (+1/-1).
export function extremeAt(view, m, t, s, eps = 0.01) {
  const p = 1 - m;
  let best = null;
  const take = (value) => {
    if (best === null || (s > 0 ? value > best : value < best)) best = value;
  };
  view.visible.forEach((line) => {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (t < Math.min(a[m], b[m]) - eps || t > Math.max(a[m], b[m]) + eps) continue;
      if (Math.abs(b[m] - a[m]) < 1e-9) {
        take(a[p]);
        take(b[p]);
      } else {
        const k = Math.max(0, Math.min(1, (t - a[m]) / (b[m] - a[m])));
        take(a[p] + k * (b[p] - a[p]));
      }
    }
  });
  return best;
}

// Las líneas de referencia deben nacer en la geometría real (no en el recuadro envolvente): ajusta cada extremo al borde más
// externo de la silueta del lado donde se coloca la cota.
function anchorDims(view, dims) {
  const { bbox } = view;
  return dims.map((dim) => {
    if (dim.type !== 'linear' || dim.direct || (dim.orientation !== 'h' && dim.orientation !== 'v')) return dim;
    const m = dim.orientation === 'h' ? 0 : 1;
    const p = 1 - m;
    const centre = p === 1 ? (bbox.minY + bbox.maxY) / 2 : (bbox.minX + bbox.maxX) / 2;
    const side = dim.line > centre ? 1 : -1;
    const fit = (point, fixed) => {
      if (fixed) return point;
      const value = extremeAt(view, m, point[m], side);
      const next = [...point];
      if (value !== null) next[p] = value;
      return next;
    };
    return { ...dim, a: fit(dim.a, dim.fixA), b: fit(dim.b, dim.fixB) };
  });
}

// Reparte cotas lineales que quedaron sobre la misma línea y se pisan: las empuja hacia afuera por niveles.
// Las cadenas (tramos contiguos que solo se tocan en los extremos) comparten línea a propósito y no se tocan.
export function declutter(view, dims, mm) {
  const step = mm(8);
  const spanOf = (dim) => {
    const m = dim.orientation === 'h' ? 0 : 1;
    return [Math.min(dim.a[m], dim.b[m]), Math.max(dim.a[m], dim.b[m])];
  };
  const placed = [];
  const centre = (orientation) => (orientation === 'h' ? (view.bbox.minY + view.bbox.maxY) / 2 : (view.bbox.minX + view.bbox.maxX) / 2);
  return dims.map((dim) => {
    if (dim.type !== 'linear' || dim.direct || (dim.orientation !== 'h' && dim.orientation !== 'v')) return dim;
    const side = dim.line > centre(dim.orientation) ? 1 : -1;
    const [lo, hi] = spanOf(dim);
    let line = dim.line;
    const clash = () => placed.some((other) => other.orientation === dim.orientation && other.side === side && Math.abs(other.line - line) < step * 0.75 && Math.min(hi, other.hi) - Math.max(lo, other.lo) > mm(1));
    let guard = 0;
    while (clash() && guard < 8) {
      line += side * step;
      guard += 1;
    }
    placed.push({ orientation: dim.orientation, side, line, lo, hi });
    return line === dim.line ? dim : { ...dim, line };
  });
}

// Elige para cada cota con línea de referencia (Ø, PCD) el ángulo cuya flecha sale limpia: lejos de los demás agujeros,
// con el codo fuera de la silueta y separado de los codos ya colocados.
export function placeLeaders(view, dims, scale) {
  const { bbox } = view;
  const obstacles = faceCircles(view);
  // Los rótulos fijos (agujeros de costado) ya ocupan su lugar: los demás se apartan de sus codos.
  const placed = dims.filter((dim) => dim.fixed && dim.type === 'diameter').map((dim) => {
    const rad = ((dim.angle ?? 0) * Math.PI) / 180;
    const reach = (dim.reach ?? 10) / scale;
    return [dim.center[0] + Math.cos(rad) * reach, dim.center[1] + Math.sin(rad) * reach];
  });
  // Zonas ocupadas por las cotas lineales (con un margen para el texto): los rótulos de Ø no deben cruzarlas.
  const margin = 2 / scale;
  const zones = dims
    .filter((dim) => dim.type === 'linear' && (dim.orientation === 'h' || dim.orientation === 'v'))
    .map((dim) => {
      const us = [dim.a[0], dim.b[0]];
      const vs = [dim.a[1], dim.b[1]];
      if (dim.orientation === 'v') us.push(dim.line);
      else vs.push(dim.line);
      return { x0: Math.min(...us) - margin, x1: Math.max(...us) + margin, y0: Math.min(...vs) - margin, y1: Math.max(...vs) + margin };
    });
  const crossings = (points) => zones.filter((zone) => points.some(([x, y]) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1)).length;
  const exitDistance = (p, dx, dy) => {
    const ts = [];
    if (dx > 1e-9) ts.push((bbox.maxX - p[0]) / dx);
    if (dx < -1e-9) ts.push((bbox.minX - p[0]) / dx);
    if (dy > 1e-9) ts.push((bbox.maxY - p[1]) / dy);
    if (dy < -1e-9) ts.push((bbox.minY - p[1]) / dy);
    return Math.max(0, Math.min(...ts));
  };
  const clearance = (p, dx, dy, length, self) => {
    let worst = Infinity;
    obstacles.forEach((circle) => {
      if (self && circle.center[0] === self.center[0] && circle.center[1] === self.center[1] && Math.abs(circle.radius - self.radius) < 1e-6) return;
      const t = Math.max(0, Math.min(length, (circle.center[0] - p[0]) * dx + (circle.center[1] - p[1]) * dy));
      worst = Math.min(worst, Math.hypot(circle.center[0] - (p[0] + dx * t), circle.center[1] - (p[1] + dy * t)) - circle.radius);
    });
    return worst;
  };
  return dims.map((dim) => {
    if (dim.type !== 'diameter' || dim.manual || dim.fixed) return dim;
    const self = dim.pcd ? null : { center: dim.center, radius: dim.radius };
    let best = null;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const p = [dim.center[0] + dx * dim.radius, dim.center[1] + dy * dim.radius];
      const out = exitDistance(p, dx, dy);
      const margin = 6 / scale;
      const elbow = [p[0] + dx * (out + margin), p[1] + dy * (out + margin)];
      let score = Math.min(clearance(p, dx, dy, out, self), 4 / scale) * scale; // hasta 4 mm de hoja de aire libre
      placed.forEach((other) => {
        if (Math.hypot(other[0] - elbow[0], other[1] - elbow[1]) * scale < 16) score -= 10;
      });
      // Recorrido del rótulo: flecha → codo → tramo horizontal con el texto.
      const textLength = (String(dim.text ?? `Ø${dim.radius * 2}`).length * 1.9 + 3) / scale;
      const side = dx >= 0 ? 1 : -1;
      const path = [];
      for (let k = 0; k <= 8; k += 1) path.push([p[0] + (dx * (out + margin) * k) / 8, p[1] + (dy * (out + margin) * k) / 8]);
      for (let k = 1; k <= 10; k += 1) path.push([elbow[0] + (side * textLength * k) / 10, elbow[1]]);
      score -= crossings(path) * 8;
      if (deg % 90 === 0) score -= 2; // no correr sobre las líneas de ejes
      score -= (out + margin) * scale * 0.01; // y por llegadas cortas
      if (dx < 0) score -= 0.15; // texto a la derecha del dibujo
      if (!best || score > best.score) best = { score, deg, reach: (out + margin) * scale, elbow };
    }
    placed.push(best.elbow);
    return { ...dim, angle: best.deg, reach: Math.round(best.reach * 10) / 10 };
  });
}

export function autoDimensions(view, { scale, options = {}, threads = [], overrides = {} }) {
  const mm = (sheetMm) => sheetMm / scale;
  const settings = { general: true, diameters: true, holes: true, chains: true, ...options };
  const base = autoDimensionsRaw(view, { scale, options });
  const measured = (dim) => (dim.orientation === 'h' ? Math.abs(dim.b[0] - dim.a[0]) : Math.abs(dim.b[1] - dim.a[1]));
  const referenced = base.filter((dim) => dim.type === 'linear' && dim.fixB);
  // Una altura/posición que ya está acotada (agujero visto de frente) no se repite.
  const side = (view.kind === 'iso' ? [] : sideHoleDims(view, settings, mm)).filter((dim) => !(dim.type === 'linear' && referenced.some((other) => other.orientation === dim.orientation && Math.abs(measured(other) - measured(dim)) < 0.01)));
  const raw = [...base, ...side, ...(view.kind === 'iso' ? [] : threadCallouts(view, mm))];
  const spread = declutter(view, anchorDims(view, raw), mm);
  const labelled = spread.map((dim) => {
    if (dim.type !== 'diameter' || dim.pcd) return dim;
    const spec = threads.find((item) => Math.abs(item.d - (dim.sideD ?? dim.radius * 2)) < 0.02);
    if (!spec) return dim;
    if (!dim.sideD) view.threadArcs?.push({ center: dim.center, radius: spec.major / 2 });
    return { ...dim, text: `${dim.count > 1 ? `${dim.count}× ` : ''}${spec.label}` };
  });
  const keyed = placeLeaders(view, labelled, scale).map((dim) => ({ ...dim, key: dimKey(dim) }));
  // Posiciones movidas a mano por la persona: se aplican al final y las líneas de referencia se reanclan al nuevo lado.
  const moved = keyed.map((dim) => (overrides[dim.key] ? { ...dim, ...overrides[dim.key] } : dim));
  const reanchor = new Set(keyed.filter((dim) => overrides[dim.key]?.line !== undefined && !dim.direct).map((dim) => dim.key));
  const anchored = anchorDims(view, moved.filter((dim) => reanchor.has(dim.key)));
  return moved.map((dim) => (reanchor.has(dim.key) ? anchored.find((item) => item.key === dim.key) : dim));
}

// Rosca con rango visto de costado y alineado con la vista: cota del tramo roscado con el rótulo (M20×1,5 L=30).
function threadCallouts(view, mm) {
  const { bbox } = view;
  return (view.threadMarks ?? []).filter((mark) => mark.mode === 'side').flatMap((mark) => {
    const dx = Math.abs(mark.b[0] - mark.a[0]);
    const dy = Math.abs(mark.b[1] - mark.a[1]);
    if (dx > 1e-6 && dy < 1e-6) return [linear(view, { orientation: 'h', a: [mark.a[0], bbox.maxY], b: [mark.b[0], bbox.maxY], line: bbox.maxY + mm(10), text: mark.label })];
    if (dy > 1e-6 && dx < 1e-6) return [linear(view, { orientation: 'v', a: [bbox.minX, mark.a[1]], b: [bbox.minX, mark.b[1]], line: bbox.minX - mm(10), text: mark.label })];
    return [];
  });
}

// Agujeros que no se ven de frente en esta vista (radiales, inclinados): se rotula Ø/rosca con una línea de referencia al extremo
// del eje y se ubican por altura (eje horizontal/vertical en la vista) o por ángulo (eje inclinado dentro del plano de la vista).
function sideHoleDims(view, settings, mm) {
  const dims = [];
  const { bbox } = view;
  const cu = (bbox.minX + bbox.maxX) / 2;
  const cv = (bbox.minY + bbox.maxY) / 2;
  const holes = view.circles.filter((circle) => circle.synthetic && circle.axisLine && circle.mode !== 'face').sort((a, b) => a.center[1] - b.center[1] || a.center[0] - b.center[0]);
  let rowLeft = 0;
  let rowBottom = 0;
  const done = [];
  holes.forEach((hole, index) => {
    const [a, b] = hole.axisLine;
    // Dos agujeros iguales cuyos ejes se proyectan sobre la misma recta (p. ej. a 0° y a 45° vistos de frente) se rotulan una sola vez.
    const lineKey = (() => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / l;
      const ny = (b[0] - a[0]) / l;
      const sign = nx < -1e-9 || (Math.abs(nx) <= 1e-9 && ny < 0) ? -1 : 1;
      return `${Math.round(hole.radius * 1000)}|${Math.round(((a[0] * nx + a[1] * ny) * sign) * 100)}|${Math.round(Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) * 1000) % 3142}`;
    })();
    if (done.includes(lineKey)) return;
    done.push(lineKey);
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const length = Math.hypot(du, dv);
    if (length < 1e-6) return;
    const far = Math.hypot(a[0] - cu, a[1] - cv) >= Math.hypot(b[0] - cu, b[1] - cv) ? a : b;
    const nearEnd = far === a ? b : a;
    const axisDeg = (Math.atan2(far[1] - nearEnd[1], far[0] - nearEnd[0]) * 180) / Math.PI;
    const diameter = hole.radius * 2;
    if (settings.holes || settings.diameters) {
      // El rótulo sale hacia arriba (lejos de las cotas de altura, que cuelgan desde la base).
      const leaderAngle = [axisDeg + 35, axisDeg - 35].sort((p, q) => Math.sin((q * Math.PI) / 180) - Math.sin((p * Math.PI) / 180) || 0)[0];
      dims.push({ id: uid(view.id), auto: true, view: view.id, type: 'diameter', fixed: true, sideD: diameter, center: far, radius: 0, text: `Ø${formatNumber(diameter)}`, angle: Math.round(leaderAngle), reach: 9 + (index % 3) * 5 });
    }
    if (!settings.holes) return;
    const horizontal = Math.abs(dv) < 1e-4 * length;
    const vertical = Math.abs(du) < 1e-4 * length;
    if (horizontal) {
      const mouth = a[0] <= b[0] ? a : b; // la boca del lado izquierdo: la referencia nace en la superficie
      dims.push(linear(view, { orientation: 'v', a: [bbox.minX, bbox.minY], b: [mouth[0], hole.center[1]], line: bbox.minX - mm(10 + rowLeft * 8), fixB: true }));
      rowLeft += 1;
    } else if (vertical) {
      const mouth = a[1] <= b[1] ? a : b;
      dims.push(linear(view, { orientation: 'h', a: [bbox.minX, bbox.minY], b: [hole.center[0], mouth[1]], line: bbox.minY - mm(10 + rowBottom * 8), fixB: true }));
      rowBottom += 1;
    } else if (hole.mode === 'edge') {
      // Ángulo agudo del eje respecto de la horizontal de la vista.
      const theta = (((Math.atan2(dv, du) * 180) / Math.PI) % 180 + 180) % 180;
      const toLeft = theta > 90;
      const value = toLeft ? 180 - theta : theta;
      dims.push({ id: uid(view.id), auto: true, view: view.id, type: 'angle', center: hole.center, from: toLeft ? theta : 0, to: toLeft ? 180 : theta, value: Math.round(value * 100) / 100, arc: 14 + Math.min(10, length * 0.1) });
    }
  });
  return dims;
}

function autoDimensionsRaw(view, { scale, options = {} }) {
  const settings = { general: true, diameters: true, holes: true, chains: true, ...options };
  const mm = (sheetMm) => sheetMm / scale; // mm de hoja -> unidades del modelo
  const { bbox } = view;
  const id = view.id;
  if (view.kind === 'iso') return []; // la isométrica no se acota
  if (view.revolve?.mode === 'side') return revolvedSide(view, settings, mm);

  const dims = [];
  const circles = faceCircles(view);
  const endView = view.revolve?.mode === 'end';
  const origin = view.revolve?.origin;
  const onAxis = (circle) => endView && near(circle.center[0], origin[0], 0.02) && near(circle.center[1], origin[1], 0.02);

  // Círculos que se acotan: en vista de canto de una pieza de revolución, solo agujeros fuera del eje y alojamientos internos.
  let candidates = circles;
  if (endView) {
    const internalRadii = view.revolve.cylinders?.filter((c) => c.internal).map((c) => c.r) ?? [];
    candidates = circles.filter((circle) => !onAxis(circle) || internalRadii.some((r) => near(r, circle.radius, 0.01)));
  }
  const holeGroups = [];
  if (candidates.length > 0 && (settings.holes || settings.diameters)) {
    const byRadius = new Map();
    candidates.forEach((circle) => {
      const key = Math.round(circle.radius * 1000);
      byRadius.set(key, [...(byRadius.get(key) ?? []), circle]);
    });
    const groups = [...byRadius.values()].sort((a, b) => b[0].radius - a[0].radius);
    const reference = endView ? { center: origin } : groups[0][0];
    groups.forEach((group, index) => {
      const circle = group[0];
      const concentric = group.length === 1 && near(circle.center[0], reference.center[0], 0.02) && near(circle.center[1], reference.center[1], 0.02);
      if (concentric && !settings.diameters) return;
      if (!concentric && !settings.holes) return;
      dims.push({ id: uid(id), auto: true, view: id, type: 'diameter', center: circle.center, radius: circle.radius, count: group.length, angle: concentric ? 45 + index * 12 : 55 + index * 12, reach: 10 + index * 3 });
      if (!concentric) holeGroups.push(group);
    });
    holeGroups.forEach((group) => {
      if (group.length < 3) return;
      const cx = group.reduce((sum, c) => sum + c.center[0], 0) / group.length;
      const cy = group.reduce((sum, c) => sum + c.center[1], 0) / group.length;
      const radii = group.map((c) => Math.hypot(c.center[0] - cx, c.center[1] - cy));
      // Agujeros colocados a mano también cuentan como círculo de agujeros si están casi a la misma distancia del centro (±1 %).
      const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
      if (Math.max(...radii) - Math.min(...radii) < Math.max(0.02, mean * 0.01) && mean > 0.5) {
        dims.push({ id: uid(id), auto: true, view: id, type: 'diameter', pcd: true, center: [cx, cy], radius: mean, count: 1, angle: 20, reach: 14 });
        view.extraCircles.push({ center: [cx, cy], radius: mean });
      }
    });
    // Agujeros sueltos (sin patrón circular): posición respecto de la esquina inferior izquierda.
    if (settings.holes && view.extraCircles.length === 0) {
      const loose = circles.filter((circle) => !onAxis(circle) && !(endView === false && near(circle.center[0], groups[0][0].center[0], 0.02) && near(circle.center[1], groups[0][0].center[1], 0.02)));
      // Extremo b en el centro del agujero (fixB): la referencia nace en el eje del agujero y no en el borde de la pieza.
      // Con muchas posiciones distintas el acotado automático sería ilegible: se omite (acotá a mano los que importen).
      const crowded = unique(loose.map((circle) => circle.center[0])).length > 5 || unique(loose.map((circle) => circle.center[1])).length > 5;
      if (!crowded) unique(loose.map((circle) => circle.center[0])).forEach((u, i) => {
        const hole = loose.find((circle) => near(circle.center[0], u, 0.01));
        dims.push(linear(view, { orientation: 'h', a: [bbox.minX, bbox.minY], b: [u, hole.center[1]], line: bbox.minY - mm(10 + i * 8), fixB: true }));
      });
      if (!crowded) unique(loose.map((circle) => circle.center[1])).forEach((v, i) => {
        const hole = loose.find((circle) => near(circle.center[1], v, 0.01));
        dims.push(linear(view, { orientation: 'v', a: [bbox.minX, bbox.minY], b: [hole.center[0], v], line: bbox.minX - mm(10 + i * 8), fixB: true }));
      });
    }
  }

  // Cotas generales y cadenas sobre los vértices de la silueta (no en vistas de canto de piezas de revolución).
  const dominatedByCircle = circles.some((circle) => near(circle.radius * 2, bbox.width, 0.05) && near(circle.radius * 2, bbox.height, 0.05));
  if (!dominatedByCircle && !endView && settings.general) {
    const us = thin([bbox.minX, bbox.maxX, ...view.corners.map((p) => p[0])], mm(12));
    const vs = thin([bbox.minY, bbox.maxY, ...view.corners.map((p) => p[1])], mm(12));
    const rowsBelow = unique(dims.filter((d) => d.orientation === 'h').map((d) => d.line)).length;
    const bottom = mm(10) + mm(8) * rowsBelow;
    const chainU = settings.chains && us.length > 2 && us.length <= 8;
    const chainV = settings.chains && vs.length > 2 && vs.length <= 8;
    if (chainU) us.slice(0, -1).forEach((u, i) => dims.push(linear(view, { orientation: 'h', a: [u, bbox.minY], b: [us[i + 1], bbox.minY], line: bbox.minY - bottom })));
    dims.push(linear(view, { orientation: 'h', a: [bbox.minX, bbox.minY], b: [bbox.maxX, bbox.minY], line: bbox.minY - bottom - (chainU ? mm(8) : 0) }));
    if (chainV) vs.slice(0, -1).forEach((v, i) => dims.push(linear(view, { orientation: 'v', a: [bbox.maxX, v], b: [bbox.maxX, vs[i + 1]], line: bbox.maxX + mm(10) })));
    dims.push(linear(view, { orientation: 'v', a: [bbox.maxX, bbox.minY], b: [bbox.maxX, bbox.maxY], line: bbox.maxX + mm(10) + (chainV ? mm(8) : 0) }));
  }
  return dims;
}
