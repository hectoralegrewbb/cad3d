import { evaluate } from '../core/expression.js';
import { rotateVector } from './planes.js';

const turnAxes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

// Giro del cuerpo de una operación: ángulo (°) alrededor de un eje (X/Y/Z o vector propio) por un pivote, en coordenadas del mundo.
// Devuelve null si no hay giro.
export function featureTurn(feature, params = {}) {
  const turn = feature.turn;
  if (!turn?.axis) return null;
  const angle = evaluate(turn.angle ?? 0, params);
  if (!Number.isFinite(angle) || Math.abs(angle) < 1e-9) return null;
  let axis = turnAxes[turn.axis];
  if (turn.axis === 'custom') {
    axis = [evaluate(turn.vx ?? 0, params), evaluate(turn.vy ?? 0, params), evaluate(turn.vz ?? 0, params)];
    const length = Math.hypot(...axis);
    if (!(length > 1e-9)) throw new Error('El eje de giro personalizado no puede ser el vector nulo');
    axis = axis.map((v) => v / length);
  }
  if (!axis) return null;
  return { angle, axis, pivot: [evaluate(turn.px ?? 0, params), evaluate(turn.py ?? 0, params), evaluate(turn.pz ?? 0, params)] };
}

// Aplica el giro (si lo hay) a un punto o a un vector libre.
export function turnPoint(turn, point) {
  if (!turn) return point;
  const rel = point.map((v, i) => v - turn.pivot[i]);
  return rotateVector(rel, turn.axis, turn.angle).map((v, i) => v + turn.pivot[i]);
}
export const turnVector = (turn, vector) => (turn ? rotateVector(vector, turn.axis, turn.angle) : vector);
