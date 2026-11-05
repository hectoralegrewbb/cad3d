import { evaluate } from '../core/expression.js';
import { rotateVector } from './planes.js';

// Cañería / extrusión curva: un perfil (círculo con pared, o un boceto cualquiera) que recorre un camino de tramos rectos y curvas.
// Puro (sin kernel): resuelve el camino en tramos con su pose; el armado de sólidos está en partBuilder.
// Unidades mm y grados. Pose = { p: punto, d: dirección unitaria, u: vector "arriba" del perfil (perpendicular a d) }.

export const bendTargets = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
export const bendLabels = { '+x': 'hacia +X', '-x': 'hacia −X', '+y': 'hacia +Y', '-y': 'hacia −Y', '+z': 'hacia +Z', '-z': 'hacia −Z' };

export const defaultSegment = () => ({ len: 100, turn: 0, toward: '+x', radius: '' });
export const defaultPipeFeature = () => ({
  from: null,
  start: [0, 0, 0],
  dir: [0, 0, 1],
  profile: 'circle',
  sketch: null,
  od: 50,
  wall: 3,
  radius: 75,
  mode: 'tube',
  segments: [{ len: 150, turn: 90, toward: '+x', radius: '' }, { len: 150, turn: 0, toward: '+x', radius: '' }],
});

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const unit = (a) => {
  const l = Math.hypot(...a);
  return l > 1e-12 ? a.map((v) => v / l) : null;
};

// Vector "arriba" por defecto para un perfil redondo: Z del mundo (o X si el camino va en Z).
export function defaultUp(d) {
  const ref = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  return unit(add(ref, scale(d, -dot(ref, d))));
}

// Avanza una pose: tramo recto de `length`.
const straight = (pose, length) => ({ p: add(pose.p, scale(pose.d, length)), d: pose.d, u: pose.u });

// Curva de `angle` grados y radio `radius` hacia la dirección global `target` (se usa su parte perpendicular a d).
// Devuelve la pose final y los datos para revolucionar el perfil: centro y eje.
export function bendPose(pose, angle, radius, target) {
  const c = unit(add(target, scale(pose.d, -dot(target, pose.d))));
  if (!c) throw new Error('No se puede curvar hacia esa dirección: es paralela al caño en ese punto');
  const axis = unit(cross(pose.d, c));
  const center = add(pose.p, scale(c, radius));
  const cEnd = rotateVector(c, axis, angle);
  return {
    center,
    axis,
    end: {
      p: add(center, scale(cEnd, -radius)),
      d: rotateVector(pose.d, axis, angle),
      u: rotateVector(pose.u, axis, angle),
    },
  };
}

// Lista de pasos del camino: { kind: 'straight', pose, length } | { kind: 'bend', pose, center, axis, angle, radius }, más la pose final.
export function pipePath(feature, params, startPose) {
  const defaultRadius = evaluate(feature.radius ?? 0, params);
  let pose = startPose;
  const steps = [];
  (feature.segments ?? []).forEach((segment, index) => {
    const length = evaluate(segment.len ?? 0, params);
    if (!(length >= 0)) throw new Error(`Tramo ${index + 1}: el largo no puede ser negativo`);
    if (length > 1e-9) {
      steps.push({ kind: 'straight', pose, length });
      pose = straight(pose, length);
    }
    const angle = evaluate(segment.turn ?? 0, params);
    if (Math.abs(angle) > 1e-9) {
      const radius = segment.radius === '' || segment.radius === undefined ? defaultRadius : evaluate(segment.radius, params);
      if (!(radius > 0)) throw new Error(`Tramo ${index + 1}: el radio de curva debe ser mayor que 0`);
      const target = bendTargets[segment.toward];
      if (!target) throw new Error(`Tramo ${index + 1}: elegí hacia dónde curva`);
      if (Math.abs(angle) >= 360) throw new Error(`Tramo ${index + 1}: la curva debe ser menor a 360°`);
      const bend = bendPose(pose, Math.abs(angle), radius, angle < 0 ? scale(target, -1) : target);
      steps.push({ kind: 'bend', pose, center: bend.center, axis: bend.axis, angle: Math.abs(angle), radius });
      pose = bend.end;
    }
  });
  if (steps.length === 0) throw new Error('El camino está vacío: agregá un tramo con largo o curva');
  return { steps, end: pose };
}
