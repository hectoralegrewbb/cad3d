import { evaluate } from '../core/expression.js';

// Plano de trabajo de un boceto o agujero: plano base (XY/XZ/YZ) + desplazamiento + rotación opcional alrededor de un eje
// del mundo que pasa por un centro de giro. Todos los bocetos comparten los mismos ejes cartesianos del mundo: rotar un
// plano no mueve los demás, solo coloca este en otra orientación.
const axisVector = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export const hasRotation = (rot, params = {}) => {
  if (!rot?.axis || !axisVector[rot.axis]) return false;
  try {
    return Math.abs(evaluate(rot.angle ?? 0, params)) > 1e-9;
  } catch {
    return false;
  }
};

// Rotación de Rodrigues de un vector alrededor de un eje unitario.
export function rotateVector(v, axis, degrees) {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const [kx, ky, kz] = axis;
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  return [
    v[0] * c + (ky * v[2] - kz * v[1]) * s + kx * dot * (1 - c),
    v[1] * c + (kz * v[0] - kx * v[2]) * s + ky * dot * (1 - c),
    v[2] * c + (kx * v[1] - ky * v[0]) * s + kz * dot * (1 - c),
  ];
}

// Marcos de los planos nombrados (idénticos a los de replicad: XZ tiene la normal en −Y). Sin kernel: sirve también a la interfaz.
const baseFrames = {
  XY: { xDir: [1, 0, 0], normal: [0, 0, 1], shift: [0, 0, 1] },
  XZ: { xDir: [1, 0, 0], normal: [0, -1, 0], shift: [0, -1, 0] },
  YZ: { xDir: [0, 1, 0], normal: [1, 0, 0], shift: [1, 0, 0] },
};

// Marco del plano en coordenadas del mundo: { origin, xDir, yDir, normal }. `rep` ya no hace falta (se acepta por compatibilidad).
export function planeFrame(_rep, node, params) {
  const offset = evaluate(node.offset ?? 0, params);
  const base = baseFrames[node.plane] ?? baseFrames.XY;
  let origin = base.shift.map((v) => v * offset);
  let xDir = [...base.xDir];
  let normal = [...base.normal];
  if (hasRotation(node.rot, params)) {
    const { rot } = node;
    const angle = evaluate(rot.angle, params);
    const pivot = [evaluate(rot.px ?? 0, params), evaluate(rot.py ?? 0, params), evaluate(rot.pz ?? 0, params)];
    const axis = axisVector[rot.axis];
    const rel = [origin[0] - pivot[0], origin[1] - pivot[1], origin[2] - pivot[2]];
    const turned = rotateVector(rel, axis, angle);
    origin = [pivot[0] + turned[0], pivot[1] + turned[1], pivot[2] + turned[2]];
    xDir = rotateVector(xDir, axis, angle);
    normal = rotateVector(normal, axis, angle);
  }
  const yDir = [normal[1] * xDir[2] - normal[2] * xDir[1], normal[2] * xDir[0] - normal[0] * xDir[2], normal[0] * xDir[1] - normal[1] * xDir[0]];
  return { origin, xDir, yDir, normal };
}

// Plano de replicad para sketchOnPlane. Sin rotación se usa el plano nombrado (mantiene exactamente el comportamiento anterior).
export function workPlane(rep, node, params) {
  if (!hasRotation(node.rot, params)) return { plane: node.plane, offset: evaluate(node.offset ?? 0, params), frame: planeFrame(rep, node, params) };
  const frame = planeFrame(rep, node, params);
  return { plane: new rep.Plane(frame.origin, frame.xDir, frame.normal), offset: undefined, frame };
}
