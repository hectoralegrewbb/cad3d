import { evaluate } from '../core/expression.js';
import { planeFrame } from './planes.js';
import { featureTurn, turnPoint, turnVector } from './turn.js';

// Tornillo sin fin (transportador helicoidal): eje + hélice de sección rectangular. Unidades mm y grados.
export const defaultScrewFeature = () => ({ plane: 'XY', offset: 0, x: 0, y: 0, length: 120, shaft: 12, outer: 40, pitch: 30, thickness: 3, starts: 1, left: false, reverse: false });

// Medidas validadas del tornillo.
export function screwSpec(feature, params) {
  const num = (value) => evaluate(value, params);
  const length = num(feature.length);
  const shaft = num(feature.shaft);
  const outer = num(feature.outer);
  const pitch = num(feature.pitch);
  const thickness = num(feature.thickness);
  const starts = Math.round(num(feature.starts ?? 1));
  if (!(length > 0)) throw new Error('El largo debe ser mayor que 0');
  if (!(shaft > 0)) throw new Error('El Ø del eje debe ser mayor que 0');
  if (!(outer > shaft)) throw new Error('El Ø exterior debe ser mayor que el Ø del eje');
  if (!(pitch > 0)) throw new Error('El paso debe ser mayor que 0');
  if (!(thickness > 0 && thickness < pitch / starts)) throw new Error('El espesor del filete debe ser menor que el paso / entradas');
  if (!(starts >= 1 && starts <= 4)) throw new Error('Entradas entre 1 y 4');
  return { length, shaft, outer, pitch, thickness, starts, left: !!feature.left, turns: length / pitch, lead: pitch };
}

// Centro y eje del tornillo en coordenadas del mundo (para motor y partículas).
export function screwFrame(feature, params) {
  const frame = planeFrame(null, feature, params);
  const x = evaluate(feature.x, params);
  const y = evaluate(feature.y, params);
  const shift = Array.isArray(feature.move) ? feature.move : [0, 0, 0];
  const turn = featureTurn(feature, params);
  const base = [0, 1, 2].map((i) => frame.origin[i] + x * frame.xDir[i] + y * frame.yDir[i]);
  const origin = turnPoint(turn, base).map((v, i) => v + (Number(shift[i]) || 0));
  const sign = feature.reverse ? -1 : 1;
  return { origin, axis: turnVector(turn, frame.normal.map((v) => v * sign)), xDir: turnVector(turn, frame.xDir), yDir: turnVector(turn, frame.yDir) };
}

export function screwFeatureSpecs(part, params) {
  const specs = [];
  (part.features ?? []).forEach((feature) => {
    if (feature.type !== 'screw' || feature.suppressed) return;
    try {
      const spec = screwSpec(feature, params);
      const frame = screwFrame(feature, params);
      // Pivote = base del tornillo; el tramo útil va de 0 a length a lo largo del eje.
      specs.push({ id: feature.id, ...spec, pivot: frame.origin, axis: frame.axis, xDir: frame.xDir });
    } catch {
      /* tornillo inválido */
    }
  });
  return specs;
}
