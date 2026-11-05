import { evaluate } from '../core/expression.js';
import { defaultUp } from './pipeGeometry.js';
import { rotateVector } from './planes.js';

// Estructuras de perfiles (como el Frame Generator de Inventor): barras rectas entre dos puntos con un perfil comercial,
// ingletes automáticos donde dos barras se encuentran y lista de cortes. Puro (sin kernel): resuelve poses y planos de corte;
// el armado de sólidos está en partBuilder (buildFrame). Unidades mm, grados, acero 7,85 g/cm³.

export const steelDensity = 7.85e-6; // kg/mm³

// Perfiles de catálogo. kind: tube (rectangular hueco), bar (macizo), angle (L), channel (U), pipe (caño redondo).
export const profileCatalog = {
  'tubo-30x30x2': { kind: 'tube', w: 30, h: 30, t: 2, label: 'Tubo 30×30×2' },
  'tubo-40x40x2': { kind: 'tube', w: 40, h: 40, t: 2, label: 'Tubo 40×40×2' },
  'tubo-50x50x2': { kind: 'tube', w: 50, h: 50, t: 2, label: 'Tubo 50×50×2' },
  'tubo-60x40x3': { kind: 'tube', w: 60, h: 40, t: 3, label: 'Tubo 60×40×3' },
  'tubo-80x40x3': { kind: 'tube', w: 80, h: 40, t: 3, label: 'Tubo 80×40×3' },
  'tubo-100x50x3': { kind: 'tube', w: 100, h: 50, t: 3, label: 'Tubo 100×50×3' },
  'angulo-40x40x4': { kind: 'angle', w: 40, h: 40, t: 4, label: 'Ángulo 40×40×4' },
  'angulo-50x50x5': { kind: 'angle', w: 50, h: 50, t: 5, label: 'Ángulo 50×50×5' },
  'u-80x40x4': { kind: 'channel', w: 40, h: 80, t: 4, label: 'Perfil U 80×40×4' },
  'u-100x50x5': { kind: 'channel', w: 50, h: 100, t: 5, label: 'Perfil U 100×50×5' },
  'barra-40x10': { kind: 'bar', w: 40, h: 10, t: 0, label: 'Planchuela 40×10' },
  'barra-40x40': { kind: 'bar', w: 40, h: 40, t: 0, label: 'Barra cuadrada 40×40' },
  'cano-48x3': { kind: 'pipe', w: 48.3, h: 48.3, t: 3, label: 'Caño Ø48,3×3' },
  personalizado: { kind: 'tube', w: 40, h: 40, t: 2, label: 'Personalizado (tubo)' },
};

export const defaultFrameFeature = () => ({
  profile: 'tubo-40x40x2',
  custom: { kind: 'tube', w: 40, h: 40, t: 2 },
  members: [],
  mitre: true, // ingleta automáticamente donde se encuentran exactamente dos barras
});

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a);
  return l > 1e-12 ? a.map((v) => v / l) : null;
};
const polyArea = (pts) => Math.abs(pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + (p[0] * q[1] - q[0] * p[1]); }, 0)) / 2;

// Forma del perfil en coordenadas locales (u horizontal, v vertical), centrada en su caja envolvente.
export function profileShape(profile) {
  const { kind, w, h, t } = profile;
  if (!(w > 0 && h > 0)) throw new Error('El perfil necesita ancho y alto mayores que 0');
  if (kind === 'bar') return { kind, outer: { type: 'rect', w, h, r: 0 }, hole: null, area: w * h };
  if (kind === 'pipe') {
    if (!(t > 0 && t < w / 2)) throw new Error('La pared del caño debe estar entre 0 y el radio');
    return { kind, outer: { type: 'circle', d: w }, hole: { type: 'circle', d: w - 2 * t }, area: (Math.PI / 4) * (w * w - (w - 2 * t) ** 2) };
  }
  if (!(t > 0 && t < Math.min(w, h) / 2)) throw new Error('El espesor debe ser mayor que 0 y menor que la mitad del lado menor');
  if (kind === 'tube') {
    return { kind, outer: { type: 'rect', w, h, r: 1.5 * t }, hole: { type: 'rect', w: w - 2 * t, h: h - 2 * t, r: 0.5 * t }, area: w * h - (w - 2 * t) * (h - 2 * t) - (4 - Math.PI) * ((1.5 * t) ** 2 - (0.5 * t) ** 2) };
  }
  if (kind === 'angle') {
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + t], [-w / 2 + t, -h / 2 + t], [-w / 2 + t, h / 2], [-w / 2, h / 2]];
    return { kind, outer: { type: 'poly', pts }, hole: null, area: polyArea(pts) };
  }
  if (kind === 'channel') {
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [w / 2 - t, h / 2], [w / 2 - t, -h / 2 + t], [-w / 2 + t, -h / 2 + t], [-w / 2 + t, h / 2], [-w / 2, h / 2]];
    return { kind, outer: { type: 'poly', pts }, hole: null, area: polyArea(pts) };
  }
  throw new Error(`Perfil desconocido: ${kind}`);
}

export const resolveProfile = (feature) => (feature.profile === 'personalizado' ? { ...profileCatalog.personalizado, ...feature.custom } : profileCatalog[feature.profile]);

const keyOf = (p) => p.map((v) => Math.round(v * 1000)).join(',');

// Barras con su marco (a, d, xDir, longitud) y planos de inglete. Devuelve { profile, shape, members, nodes }.
export function frameSpec(feature, params = {}) {
  const profile = resolveProfile(feature);
  if (!profile) throw new Error('Elegí un perfil');
  const shape = profileShape(profile);
  const members = (feature.members ?? []).map((member, index) => {
    const a = (member.a ?? [0, 0, 0]).map((v) => evaluate(v, params));
    const b = (member.b ?? [0, 0, 0]).map((v) => evaluate(v, params));
    const axis = sub(b, a);
    const length = Math.hypot(...axis);
    if (!(length > 1e-6)) throw new Error(`Barra ${index + 1}: los dos extremos coinciden`);
    const d = axis.map((v) => v / length);
    const roll = evaluate(member.roll ?? 0, params);
    let up = defaultUp(d);
    if (Math.abs(roll) > 1e-9) up = rotateVector(up, d, roll);
    return { index, a, b, d, up, xDir: cross(up, d), length, label: member.label ?? '', miter: [null, null] };
  });
  // Ingletes: en cada nudo con exactamente dos extremos no alineados
  const nodes = new Map();
  members.forEach((m) => [[m.a, m.d, 0], [m.b, m.d.map((v) => -v), 1]].forEach(([point, away, end]) => {
    const key = keyOf(point);
    if (!nodes.has(key)) nodes.set(key, []);
    nodes.get(key).push({ member: m, end, point, away });
  }));
  if (feature.mitre !== false) {
    nodes.forEach((entries) => {
      if (entries.length !== 2) return;
      const [e1, e2] = entries;
      if (e1.member === e2.member) return;
      if (Math.abs(dot(e1.away, e2.away)) > 0.9999) return; // continúan en línea: corte recto
      const n = unit(sub(e1.away, e2.away));
      e1.member.miter[e1.end] = { point: e1.point, keep: n, angle: (Math.acos(Math.min(1, Math.abs(dot(e1.away, n)))) * 180) / Math.PI };
      e2.member.miter[e2.end] = { point: e2.point, keep: n.map((v) => -v), angle: (Math.acos(Math.min(1, Math.abs(dot(e2.away, n)))) * 180) / Math.PI };
    });
  }
  return { profile, shape, members, nodes };
}

// Lista de cortes: cada barra con su largo de eje, largo mayor (punta larga del inglete) y ángulos; resumen agrupado.
export function cutList(spec) {
  const extent = Math.max(spec.profile.w, spec.profile.h);
  const rows = spec.members.map((m) => {
    const longPoint = m.length + m.miter.reduce((sum, mi) => sum + (mi ? (extent / 2) * Math.tan((mi.angle * Math.PI) / 180) : 0), 0);
    return {
      n: m.index + 1,
      label: m.label,
      profile: spec.profile.label ?? spec.profile.kind,
      axisLength: m.length,
      cutLength: longPoint,
      angleA: m.miter[0]?.angle ?? 0,
      angleB: m.miter[1]?.angle ?? 0,
      weight: spec.shape.area * m.length * steelDensity,
    };
  });
  const groups = new Map();
  rows.forEach((row) => {
    const key = `${row.profile}|${row.cutLength.toFixed(1)}|${row.angleA.toFixed(1)}|${row.angleB.toFixed(1)}`;
    const group = groups.get(key) ?? { ...row, qty: 0, weight: 0 };
    group.qty += 1;
    group.weight += row.weight;
    groups.set(key, group);
  });
  return { rows, summary: [...groups.values()], totalLength: rows.reduce((s, r) => s + r.axisLength, 0), totalWeight: rows.reduce((s, r) => s + r.weight, 0) };
}

// Generador de caja (marco típico de máquina): 4 columnas, aro superior y aro inferior; los travesaños van entre caras de columna.
// origin = esquina mínima (x, y, z) de los ejes de las columnas; sx, sy, sz = dimensiones entre ejes; post = lado de la columna.
export function boxMembers({ origin = [0, 0, 0], sx = 800, sy = 600, sz = 900, post = 40, top = true, bottom = true, bottomZ = 0 }) {
  const [x0, y0, z0] = origin;
  const [x1, y1, z1] = [x0 + sx, y0 + sy, z0 + sz];
  const members = [];
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => members.push({ a: [x, y, z0], b: [x, y, z1], roll: 0, label: `Columna ${i + 1}` }));
  const half = post / 2;
  const ring = (z, name) => {
    members.push({ a: [x0 + half, y0, z], b: [x1 - half, y0, z], roll: 0, label: `${name} frente` });
    members.push({ a: [x0 + half, y1, z], b: [x1 - half, y1, z], roll: 0, label: `${name} fondo` });
    members.push({ a: [x0, y0 + half, z], b: [x0, y1 - half, z], roll: 0, label: `${name} izquierda` });
    members.push({ a: [x1, y0 + half, z], b: [x1, y1 - half, z], roll: 0, label: `${name} derecha` });
  };
  if (top) ring(z1 - half, 'Aro superior');
  if (bottom) ring(z0 + bottomZ + half, 'Aro inferior');
  return members;
}

// Barras a partir de un boceto: cada rectángulo o polilínea cerrada aporta una barra por lado. `frame` = planeFrame(...) del boceto.
export function sketchMembers(sketch, params, frame) {
  const world = (x, y) => frame.origin.map((o, k) => o + frame.xDir[k] * x + frame.yDir[k] * y);
  const members = [];
  const loop = (points, name) => points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    members.push({ a: world(p[0], p[1]).map(round3), b: world(q[0], q[1]).map(round3), roll: 0, label: `${name} ${i + 1}` });
  });
  (sketch.entities ?? []).forEach((entity, index) => {
    const value = (v) => evaluate(v ?? 0, params);
    if (entity.t === 'rect') {
      const [x, y, w, h] = [value(entity.x), value(entity.y), value(entity.w), value(entity.h)];
      const x0 = entity.centered ? x - w / 2 : x;
      const y0 = entity.centered ? y - h / 2 : y;
      loop([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], `Rect ${index + 1} lado`);
    } else if (entity.t === 'poly' && entity.pts?.length >= 3) {
      loop(entity.pts.map((pt) => [value(pt.x), value(pt.y)]), `Poli ${index + 1} lado`);
    }
  });
  return members.filter((m) => Math.hypot(...m.a.map((v, k) => v - m.b[k])) > 1e-6);
}

const round3 = (v) => Math.round(v * 1000) / 1000;
