import { evaluate } from '../core/expression.js';
import { resolveThread } from '../data/threads.js';

// Roscas con rango ("de A a B" sobre un eje): geometría pura compartida por el modelo 3D, el plano y las pruebas.
// Ejes: z → (cx, cy) = (X, Y) · x → (cx, cy) = (Y, Z) · y → (cx, cy) = (X, Z). from/to son coordenadas absolutas sobre el eje.
const axisVectors = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const pointOn = (axis, cx, cy, t) => (axis === 'z' ? [cx, cy, t] : axis === 'x' ? [t, cx, cy] : [cx, t, cy]);

export const defaultThreadFeature = () => ({ axis: 'z', cx: 0, cy: 0, from: 0, to: 20, internal: false, d: 20, thread: { on: true, type: 'M', size: 'auto', depth: '' }, real: false, lefthand: false, chamferStart: 0, chamferEnd: 0 });

// Perfil ISO simplificado: altura del filete H1 = 0,6134·P (externa: raíz = mayor − 1,2269·P).
export function threadSpec(feature, params) {
  const num = (value) => evaluate(value, params);
  const d = num(feature.d);
  const from = num(feature.from);
  const to = num(feature.to);
  const row = resolveThread({ ...feature.thread, on: true }, d);
  if (!row) throw new Error(`Ø${Math.round(d * 100) / 100} no coincide con una rosca de ese tipo: elegí la medida o ajustá el Ø`);
  if (!(Math.abs(to - from) > row.pitch)) throw new Error('El tramo roscado debe ser más largo que el paso');
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const chamferStart = num(feature.chamferStart ?? 0);
  const chamferEnd = num(feature.chamferEnd ?? 0);
  if (chamferStart < 0 || chamferEnd < 0) throw new Error('El chaflán no puede ser negativo');
  const cx = num(feature.cx);
  const cy = num(feature.cy);
  const major = row.major;
  const minor = feature.internal ? row.tap : major - 1.2269 * row.pitch;
  return {
    from, to, chamferStart, chamferEnd, axis: feature.axis, vector: axisVectors[feature.axis], cx, cy, lo, hi, length: hi - lo, row, pitch: row.pitch, internal: Boolean(feature.internal),
    major, minor, p0: pointOn(feature.axis, cx, cy, lo), p1: pointOn(feature.axis, cx, cy, hi),
    label: `${row.label} L=${Math.round((hi - lo) * 100) / 100}`.replace('.', ','),
  };
}

// Surco helicoidal (herramienta de corte) en el sistema local con eje Z, centrado en el origen.
function localGroove(rep, spec, lefthand) {
  const p = spec.pitch;
  const margin = p;
  const z0 = spec.lo - margin;
  const total = spec.length + 2 * margin;
  const extra = 0.3;
  let points;
  let radius;
  if (spec.internal) {
    // Cavidad entre dientes de la tuerca: raíz plana (P/8) en el diámetro mayor, abriéndose hacia el eje.
    const rootR = spec.major / 2;
    const crestR = spec.minor / 2;
    const slope = (0.375 * p - p / 16) / (rootR - crestR);
    radius = rootR;
    points = [[rootR, p / 16], [crestR - extra, 0.375 * p + slope * extra], [crestR - extra, -(0.375 * p + slope * extra)], [rootR, -p / 16]];
  } else {
    const rootR = spec.minor / 2;
    const crestR = spec.major / 2;
    const slope = (0.4375 * p - p / 8) / (crestR - rootR);
    radius = rootR;
    points = [[rootR, p / 8], [crestR + extra, 0.4375 * p + slope * extra], [crestR + extra, -(0.4375 * p + slope * extra)], [rootR, -p / 8]];
  }
  const helix = rep.makeHelix(p, total, radius, [0, 0, z0], [0, 0, 1], lefthand);
  const wire = rep.makePolygon(points.map(([r, z]) => [r, 0, z0 + z])).outerWire();
  return rep.genericSweep(wire, helix, { frenet: true });
}

// El cilindro extruido llega partido en dos medias caras: se unifican antes de un corte helicoidal/cónico (si no, el booleano falla en silencio).
function unifyFaces(rep, solid) {
  try {
    const oc = rep.getOC();
    const unify = new oc.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, true);
    unify.Build();
    const body = rep.cast(unify.Shape());
    unify.delete?.();
    return body;
  } catch {
    return solid;
  }
}

// Mueve una herramienta construida con eje Z centrado en el origen a la posición/eje de la rosca.
function placeTool(tool, spec) {
  if (spec.axis === 'z') return tool.translate(spec.cx, spec.cy, 0);
  if (spec.axis === 'x') return tool.translate(-spec.cy, spec.cx, 0).rotate(90, [0, 0, 0], [0, 1, 0]);
  return tool.translate(spec.cx, -spec.cy, 0).rotate(-90, [0, 0, 0], [1, 0, 0]);
}

// Chaflán a 45° en los extremos del tramo roscado ("inicio" = desde, "fin" = hasta). Externa: cono que baja hacia el
// fondo del filete; interna: avellanado en la boca del agujero. `c` = cateto medido en el diámetro mayor.
export function chamferThread(rep, solid, spec) {
  const ends = [[spec.from, spec.to, spec.chamferStart], [spec.to, spec.from, spec.chamferEnd]];
  let result = unifyFaces(rep, solid);
  ends.forEach(([at, other, c]) => {
    if (!(c > 0)) return;
    const s = other > at ? 1 : -1;
    const m = 0.5;
    const rMajor = spec.major / 2;
    let points;
    if (spec.internal) {
      const rTap = spec.minor / 2;
      const rIn = rTap - 0.3;
      points = [[rIn, at - s * m], [rMajor + c + m, at - s * m], [rIn, at + s * (rMajor + c - rIn)]];
    } else {
      const r0 = rMajor - c;
      if (r0 - m <= 0) throw new Error('El chaflán de rosca es mayor que el radio');
      const rBig = rMajor + 1;
      points = [[r0 - m, at - s * m], [rBig, at - s * m], [rBig, at + s * (rBig - r0)]];
    }
    let pen = rep.draw(points[0]);
    points.slice(1).forEach((point) => (pen = pen.lineTo(point)));
    const cutter = placeTool(pen.close().sketchOnPlane('XZ').revolve([0, 0, 1], { origin: [0, 0, 0] }), spec);
    result = result.cut(cutter);
  });
  return result;
}

// Corta el filete real en `solid`. Costoso (segundos): solo si la persona activa "Rosca real".
export const MAX_REAL_TURNS = 40;

export function cutThread(rep, solid, spec, lefthand = false) {
  if (spec.length / spec.pitch > MAX_REAL_TURNS) throw new Error(`Filete real limitado a ${MAX_REAL_TURNS} vueltas (tramo ÷ paso = ${Math.round(spec.length / spec.pitch)}): acortá el tramo o usá rosca cosmética`);
  // Giro arbitrario del inicio de la hélice: evita que coincida con la costura del cilindro (el booleano fallaba en silencio).
  const tool = placeTool(localGroove(rep, spec, lefthand).rotate(23, [0, 0, 0], [0, 0, 1]), spec);
  const body = unifyFaces(rep, solid);
  const result = body.cut(tool);
  if (!(rep.measureVolume(result) < rep.measureVolume(body) - 1e-3)) throw new Error('No se pudo cortar el filete (¿el cuerpo está en el tramo y el Ø coincide con la rosca?)');
  return result;
}

// ¿La pieza tiene filete real activo? (esas reconstrucciones cuestan segundos: la app las difiere mientras se edita)
export const hasRealThread = (part) => Boolean(part?.features?.some((feature) => feature.type === 'thread' && feature.real && !feature.suppressed));

// Roscas de la pieza (no suprimidas y válidas) para el plano.
export function threadFeatureSpecs(part, params) {
  const specs = [];
  part.features.forEach((feature) => {
    if (feature.type !== 'thread' || feature.suppressed) return;
    try {
      specs.push(threadSpec(feature, params));
    } catch {
      /* rosca inválida: sin marca en el plano */
    }
  });
  return specs;
}

// Zona de la rosca para resaltarla en el visor: no exige que el Ø coincida con una rosca de la tabla (sirve mientras se la ubica).
export function threadZone(feature, params) {
  const num = (value) => evaluate(value, params);
  const axis = feature.axis ?? 'z';
  const from = num(feature.from);
  const to = num(feature.to);
  const cx = num(feature.cx);
  const cy = num(feature.cy);
  const d = num(feature.d);
  if (![from, to, cx, cy, d].every(Number.isFinite) || !(d > 0) || from === to) return null;
  return { vector: axisVectors[axis], p0: pointOn(axis, cx, cy, from), p1: pointOn(axis, cx, cy, to), length: Math.abs(to - from), major: d };
}
