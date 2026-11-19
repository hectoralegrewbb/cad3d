// API pública de edición 2D. Recibe entidades resueltas (mm); no modifica sus argumentos.
export const SKETCH_TOLERANCE = 1e-6;
const EPS = SKETCH_TOLERANCE, TAU = Math.PI * 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mod = a => (a % TAU + TAU) % TAU;
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e9 && Math.abs(p.y) <= 1e9;
const point = p => ({ x: p.x, y: p.y });
const open = pts => ({ t: 'poly', closed: false, pts });

export function segmentGeometry(a, b, bulge = 0) {
  if (!finite(a) || !finite(b) || !Number.isFinite(bulge) || dist(a, b) <= EPS) throw new Error('Tramo nulo o coordenadas inválidas');
  if (!bulge) return { kind: 'line', a: point(a), b: point(b) };
  const dx = b.x - a.x, dy = b.y - a.y, k = (1 - bulge * bulge) / (4 * bulge);
  const c = { x: (a.x + b.x) / 2 - dy * k, y: (a.y + b.y) / 2 + dx * k };
  const r = dist(a, c), sweep = 4 * Math.atan(bulge);
  if (!finite(c) || !Number.isFinite(r) || r <= EPS || r > 1e9 || Math.abs(sweep) >= TAU - 1e-10) throw new Error('Arco degenerado o radio fuera de rango');
  return { kind: 'arc', a: point(a), b: point(b), c, r, start: Math.atan2(a.y - c.y, a.x - c.x), sweep };
}

export function entitySegments(e) {
  if (e.t === 'guide') return [];
  if (e.t === 'circle') {
    if (!finite(e) || !(e.d > EPS * 2) || !Number.isFinite(e.d)) throw new Error('Círculo inválido');
    const a = { x: e.x + e.d / 2, y: e.y };
    if (!finite(a)) throw new Error('Círculo fuera de rango');
    return [{ kind: 'arc', a, b: a, c: point(e), r: e.d / 2, start: 0, sweep: TAU, full: true }];
  }
  let pts = e.pts, closed = e.closed !== false;
  if (e.t === 'rect') {
    const x = e.centered ? e.x - e.w / 2 : e.x, y = e.centered ? e.y - e.h / 2 : e.y;
    pts = [{ x, y }, { x: x + e.w, y }, { x: x + e.w, y: y + e.h }, { x, y: y + e.h }];
  } else if (e.t === 'polygon') {
    const r = e.d / 2 / (e.across === 'corners' ? 1 : Math.cos(Math.PI / e.n));
    pts = Array.from({ length: e.n }, (_, i) => { const a = (e.angle ?? 0) * Math.PI / 180 + TAU * i / e.n; return { x: e.x + r * Math.cos(a), y: e.y + r * Math.sin(a) }; });
  } else if (e.t === 'slot') {
    const r = e.width / 2, h = e.length / 2 - r, a = e.angle * Math.PI / 180;
    pts = [[-h, -r, 0], [h, -r, 1], [h, r, 0], [-h, r, 1]].map(([x, y, bulge]) => ({ x: e.x + x * Math.cos(a) - y * Math.sin(a), y: e.y + x * Math.sin(a) + y * Math.cos(a), bulge }));
  } else if (e.t !== 'poly') throw new Error('Esta figura todavía no admite edición por tramos; usá líneas, círculos o polilíneas');
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 10000) throw new Error('Cantidad de vértices inválida (máximo 10000)');
  return Array.from({ length: closed ? pts.length : pts.length - 1 }, (_, i) => segmentGeometry(pts[i], pts[(i + 1) % pts.length], pts[i].bulge ?? 0));
}

export function segmentPoint(s, t) {
  if (s.kind === 'line') return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  const a = s.start + s.sweep * t;
  return { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) };
}
const parameter = (s, p) => {
  if (s.kind === 'line') { const d = sub(s.b, s.a), q = sub(p, s.a); return (q.x * d.x + q.y * d.y) / (d.x * d.x + d.y * d.y); }
  const a = Math.atan2(p.y - s.c.y, p.x - s.c.x);
  if (dist(p, s.a) <= EPS) return 0;
  if (!s.full && dist(p, s.b) <= EPS) return 1;
  const angle = s.sweep > 0 ? mod(a - s.start) : mod(s.start - a);
  return angle / Math.abs(s.sweep);
};
export function nearestOnSegment(s, p) {
  let t = parameter(s, p);
  if (s.kind === 'arc' && !s.full && t > 1) t = dist(p, s.a) <= dist(p, s.b) ? 0 : 1;
  t = Math.max(0, Math.min(1, t));
  const q = segmentPoint(s, t);
  return { t, point: q, distance: dist(p, q) };
}

// Intersecciones analíticas, filtradas por el intervalo de cada arco. Sin teselar curvas.
export function segmentIntersections(a, b, extendA = false) {
  let points = [];
  if (a.kind === 'line' && b.kind === 'line') {
    const r = sub(a.b, a.a), s = sub(b.b, b.a), den = cross(r, s), q = sub(b.a, a.a);
    if (Math.abs(den) <= 1e-12 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) {
      // Coincidentes: sólo extremos compartidos; no inventar un cruce de solapes.
      if (Math.abs(cross(q, r)) / Math.hypot(r.x, r.y) <= EPS) points = [a.a, a.b, b.a, b.b].filter(p => nearestOnSegment(a, p).distance <= EPS && nearestOnSegment(b, p).distance <= EPS);
    } else { const t = cross(q, s) / den; points = [segmentPoint(a, t)]; }
  } else if (a.kind === 'line' || b.kind === 'line') {
    const line = a.kind === 'line' ? a : b, arc = a.kind === 'arc' ? a : b;
    const d = sub(line.b, line.a), f = sub(line.a, arc.c), A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - arc.r * arc.r;
    const disc = B * B - 4 * A * C, tol = 1e-12 * Math.max(B * B, Math.abs(4 * A * C), 1);
    if (disc >= -tol) points = [(-B - Math.sqrt(Math.max(0, disc))) / (2 * A), (-B + Math.sqrt(Math.max(0, disc))) / (2 * A)].map(t => segmentPoint(line, t));
  } else {
    const d = dist(a.c, b.c);
    if (d <= EPS) {
      if (Math.abs(a.r - b.r) <= EPS) points = [a.a, a.b, b.a, b.b];
    } else if (d <= a.r + b.r + EPS && d >= Math.abs(a.r - b.r) - EPS) {
      const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
      const ux = (b.c.x - a.c.x) / d, uy = (b.c.y - a.c.y) / d;
      points = [-1, 1].map(sign => ({ x: a.c.x + x * ux - sign * h * uy, y: a.c.y + x * uy + sign * h * ux }));
    }
  }
  return points.filter((p, i) => finite(p) && (extendA || nearestOnSegment(a, p).distance <= EPS) && nearestOnSegment(b, p).distance <= EPS && !points.slice(0, i).some(q => dist(p, q) <= EPS));
}
const piece = (s, lo, hi) => {
  if (hi - lo < 1e-10) return null;
  return open([{ ...segmentPoint(s, lo), bulge: s.kind === 'arc' ? Math.tan(s.sweep * (hi - lo) / 4) : 0 }, { ...segmentPoint(s, hi), bulge: 0 }]);
};
const unique = ts => ts.sort((a, b) => a - b).filter((t, i, all) => i === 0 || Math.abs(t - all[i - 1]) > 1e-9);
export function pickSketchSegment(entities, p, tolerance) {
  let best = null;
  for (const entity of entities) {
    let segments;
    try { segments = entitySegments(entity); } catch { continue; }
    segments.forEach((segment, index) => { const hit = nearestOnSegment(segment, p); if (hit.distance <= tolerance && (!best || hit.distance < best.distance)) best = { ...hit, entityId: entity.id, index, segment }; });
  }
  return best;
}

export function editSketchSegment(entities, hit, operation) {
  const entity = entities.find(e => e.id === hit.entityId);
  if (!entity) throw new Error('La figura cambió; seleccioná el tramo nuevamente');
  const segments = entitySegments(entity), s = segments[hit.index];
  if (!s) throw new Error('Tramo inexistente');
  let replacements, preview;
  if (operation === 'split') {
    if (s.full) { const t = hit.t; replacements = [piece(s, t, t + .5), piece(s, t + .5, t + 1)]; }
    else {
      if (hit.t <= 1e-9 || hit.t >= 1 - 1e-9) throw new Error('Elegí un punto interior del tramo para partir');
      replacements = [piece(s, 0, hit.t), piece(s, hit.t, 1)];
    }
    preview = piece(s, 0, s.full ? .5 : 1);
  } else if (operation === 'trim') {
    let cuts = [];
    for (const e of entities) {
      if (e.id === entity.id || e.t === 'guide' || e.t === 'ellipse') continue;
      for (const other of entitySegments(e)) cuts.push(...segmentIntersections(s, other).map(p => parameter(s, p)));
    }
    cuts = unique(cuts.filter(t => t >= -1e-9 && t <= 1 + 1e-9).map(t => Math.max(0, Math.min(1, t))));
    let lo, hi;
    if (s.full) {
      cuts = unique(cuts.map(t => t >= 1 - 1e-9 ? 0 : t));
      if (cuts.length < 2) throw new Error('El círculo necesita dos intersecciones distintas para recortar');
      lo = cuts.filter(t => t < hit.t - 1e-9).at(-1) ?? cuts.at(-1) - 1;
      hi = cuts.find(t => t > hit.t + 1e-9) ?? cuts[0] + 1;
      if (hi - lo >= 1 - 1e-9) throw new Error('Seleccioná el interior del tramo, lejos de la intersección');
      const span = 1 - (hi - lo);
      replacements = span > .5 ? [piece(s, hi, hi + span / 2), piece(s, hi + span / 2, lo + 1)] : [piece(s, hi, lo + 1)];
    } else {
      const internal = cuts.filter(t => t > 1e-9 && t < 1 - 1e-9);
      if (!internal.length && segments.length === 1) throw new Error('No hay intersecciones interiores: usá Supr para borrar la figura');
      if (internal.some(t => Math.abs(t - hit.t) < 1e-9)) throw new Error('Seleccioná el tramo a un lado de la intersección');
      const bounds = [0, ...internal, 1];
      lo = bounds.filter(t => t <= hit.t).at(-1); hi = bounds.find(t => t > hit.t);
      if (hi === undefined) throw new Error('Elegí el interior del tramo');
      replacements = [piece(s, 0, lo), piece(s, hi, 1)].filter(Boolean);
    }
    preview = piece(s, lo, hi);
  } else throw new Error('Operación de boceto desconocida');
  const result = segments.flatMap((segment, i) => i === hit.index ? replacements : segment.full ? [piece(segment, 0, .5), piece(segment, .5, 1)] : [piece(segment, 0, 1)]);
  return { removeIds: [entity.id], entities: result, preview };
}

export function extendSketchSegment(entities, hit, boundaryId) {
  const entity = entities.find(e => e.id === hit.entityId), boundary = entities.find(e => e.id === boundaryId);
  if (!entity || entity.t !== 'poly' || entity.closed !== false || !boundary || entity.id === boundaryId) throw new Error('Elegí una línea abierta distinta del límite');
  const segments = entitySegments(entity), s = segments[hit.index], atStart = hit.t < .5;
  if (s.kind !== 'line' || (atStart ? hit.index !== 0 : hit.index !== segments.length - 1)) throw new Error('Alargá un extremo recto de la polilínea');
  const hits = entitySegments(boundary).flatMap(other => segmentIntersections(s, other, true)).map(p => ({ p, t: parameter(s, p) })).filter(h => atStart ? h.t < -1e-9 : h.t > 1 + 1e-9).sort((a, b) => Math.abs(a.t - (atStart ? 0 : 1)) - Math.abs(b.t - (atStart ? 0 : 1)));
  if (!hits.length) throw new Error('El extremo no alcanza el límite en esa dirección');
  const pts = entity.pts.map(p => ({ ...p }));
  pts[atStart ? 0 : pts.length - 1] = { ...pts[atStart ? 0 : pts.length - 1], ...hits[0].p };
  return { removeIds: [entity.id], entities: [open(pts)] };
}
const reverse = pts => pts.slice().reverse().map((p, i, arr) => ({ ...p, bulge: i < arr.length - 1 ? -(pts[pts.length - 2 - i].bulge ?? 0) : 0 }));
export function joinSketchEntities(a, b) {
  if (a.id === b.id || [a, b].some(e => e.t !== 'poly' || e.closed !== false)) throw new Error('Seleccioná dos polilíneas abiertas distintas');
  entitySegments(a); entitySegments(b);
  let left, right;
  for (const ap of [a.pts, reverse(a.pts)]) for (const bp of [b.pts, reverse(b.pts)]) {
    if (dist(ap.at(-1), bp[0]) <= EPS) { if (left) continue; left = ap; right = bp; }
  }
  if (!left) throw new Error('Los extremos no coinciden (tolerancia 0,000001 mm); alargá o mové primero');
  let pts = [...left.slice(0, -1), ...right].map(p => ({ ...p }));
  const closed = dist(pts[0], pts.at(-1)) <= EPS;
  if (closed) pts.pop();
  if (closed && pts.length < 3 && !pts.some(p => p.bulge)) throw new Error('La unión no forma un área cerrada');
  return { removeIds: [a.id, b.id], entities: [{ t: 'poly', closed, pts }] };
}

// Sólo encadena extremos ya coincidentes. No rellena huecos ni elige ramas ambiguas.
export function closedSketchProfiles(entities) {
  const closed = entities.filter(e => e.t !== 'poly' || e.closed !== false);
  const pending = entities.filter(e => e.t === 'poly' && e.closed === false).map(e => ({ ...e, pts: e.pts.map(p => ({ ...p })) }));
  if (!pending.length) return entities;
  if (pending.length > 2000) throw new Error('Demasiados tramos abiertos; uní perfiles por partes (máximo 2000)');
  // Una red con más de dos extremos en un nodo es ambigua.
  const endpoints = pending.flatMap(e => [e.pts[0], e.pts.at(-1)]);
  if (endpoints.some(p => endpoints.filter(q => dist(p, q) <= EPS).length !== 2)) throw new Error('Boceto abierto o con ramificaciones: uní los extremos antes de extruir');
  while (pending.length) {
    let chain = pending.shift();
    while (chain.closed === false) {
      const index = pending.findIndex(e => [e.pts[0], e.pts.at(-1)].some(p => dist(p, chain.pts.at(-1)) <= EPS));
      if (index < 0) throw new Error('Boceto abierto: cerrá o uní los extremos antes de extruir');
      const next = pending.splice(index, 1)[0];
      chain = { ...joinSketchEntities(chain, next).entities[0], id: chain.id };
    }
    closed.push(validateSketchPolyline(chain));
  }
  return closed;
}

// Valida perfiles nuevos antes de enviarlos al kernel. Los bocetos legacy no se reinterpretan.
export function validateSketchPolyline(entity) {
  if (entity.t !== 'poly') return entity;
  const segments = entitySegments(entity);
  if (segments.length > 2000) throw new Error('Perfil demasiado complejo para validar (máximo 2000 tramos)');
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    const adjacent = j === i + 1 || (entity.closed !== false && i === 0 && j === segments.length - 1);
    const hits = segmentIntersections(a, b);
    if (a.kind === 'line' && b.kind === 'line' && hits.length > 1) throw new Error('El perfil tiene tramos superpuestos');
    if (hits.some(p => !adjacent || ![a.a, a.b].some(q => dist(p, q) <= EPS) || ![b.a, b.b].some(q => dist(p, q) <= EPS))) throw new Error('El perfil se cruza o tiene ramificaciones');
    if (a.kind === 'arc' && b.kind === 'arc' && dist(a.c, b.c) <= EPS && Math.abs(a.r - b.r) <= EPS) {
      const interior = (s, p) => { const h = nearestOnSegment(s, p); return h.distance <= EPS && h.t > 1e-9 && h.t < 1 - 1e-9; };
      if ([a.a, a.b, segmentPoint(a, .5)].some(p => interior(b, p)) || [b.a, b.b, segmentPoint(b, .5)].some(p => interior(a, p))) throw new Error('El perfil tiene arcos superpuestos');
    }
  }
  if (entity.closed !== false) {
    const area = segments.reduce((sum, s) => sum + cross(s.a, s.b) / 2 + (s.kind === 'arc' ? s.r * s.r * (s.sweep - Math.sin(s.sweep)) / 2 : 0), 0);
    if (Math.abs(area) <= EPS * EPS) throw new Error('El perfil cerrado no tiene área');
  }
  return entity;
}
