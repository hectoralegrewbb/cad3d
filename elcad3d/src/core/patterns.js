import { resolveEntity } from '../kernel/geometry2d.js';
import { offsetEntity } from './entityOps.js';

// Repetición de entidades de boceto: fila, círculo y elipse. Puro: devuelve las copias (y el nuevo lugar del original en la elipse).
const r3 = (value) => Math.round(value * 1000) / 1000;
const rad = (deg) => (deg * Math.PI) / 180;
export const MAX_COPIES = 64;

// Punto de referencia de una entidad ya resuelta: centro (rect/círculo/elipse/ranura/polígono) o promedio de vértices (polilínea).
export function referencePoint(entity) {
  if (entity.t === 'poly') return [entity.pts.reduce((s, p) => s + p.x, 0) / entity.pts.length, entity.pts.reduce((s, p) => s + p.y, 0) / entity.pts.length];
  if (entity.t === 'rect' && !entity.centered) return [entity.x + entity.w / 2, entity.y + entity.h / 2];
  return [entity.x, entity.y];
}

const rotates = new Set(['polygon', 'slot', 'ellipse', 'guide']);

// Copia de `original` (conserva sus expresiones) con el punto de referencia en `target`; `turn` gira la forma (grados) si admite ángulo.
function placed(original, resolved, target, turn, center) {
  const [rx, ry] = referencePoint(resolved);
  if (original.t === 'poly') {
    const c = Math.cos(rad(turn));
    const s = Math.sin(rad(turn));
    const pts = resolved.pts.map((p, i) => {
      if (!turn) return { ...original.pts[i], x: r3(p.x + target[0] - rx), y: r3(p.y + target[1] - ry) };
      const dx = p.x - center[0];
      const dy = p.y - center[1];
      return { ...original.pts[i], x: r3(center[0] + dx * c - dy * s), y: r3(center[1] + dx * s + dy * c) };
    });
    return { ...stripId(original), pts };
  }
  const copy = { ...stripId(original) };
  if (original.t === 'rect' && !original.centered) {
    copy.x = r3(target[0] - resolved.w / 2);
    copy.y = r3(target[1] - resolved.h / 2);
  } else {
    copy.x = r3(target[0]);
    copy.y = r3(target[1]);
  }
  if (turn && rotates.has(original.t)) copy.angle = r3((resolved.angle ?? 0) + turn);
  return copy;
}

const stripId = ({ id, ...rest }) => rest;

// config: { kind: 'row'|'circle'|'ellipse', count, ... } → { copies: [entidad], original?: patch }
export function patternEntities(entity, config, params) {
  const count = Math.round(config.count);
  if (!(count >= 2 && count <= MAX_COPIES)) throw new Error(`La cantidad debe estar entre 2 y ${MAX_COPIES}`);
  const resolved = resolveEntity(entity, params);
  const [ox, oy] = referencePoint(resolved);
  const copies = [];
  if (config.kind === 'row') {
    const angle = rad(config.angle ?? 0);
    if (!(Math.abs(config.spacing) > 1e-9)) throw new Error('La separación no puede ser 0');
    for (let i = 1; i < count; i += 1) copies.push(offsetEntity(entity, r3(config.spacing * i * Math.cos(angle)), r3(config.spacing * i * Math.sin(angle))));
    return { copies };
  }
  const center = [config.cx ?? 0, config.cy ?? 0];
  if (config.kind === 'circle') {
    if (Math.hypot(ox - center[0], oy - center[1]) < 1e-9) throw new Error('El objeto está en el centro del círculo: movelo o cambiá el centro');
    const total = config.total ?? 360;
    const step = Math.abs(total) >= 360 ? total / count : total / (count - 1);
    for (let i = 1; i < count; i += 1) {
      const a = rad(step * i);
      const dx = ox - center[0];
      const dy = oy - center[1];
      const target = [center[0] + dx * Math.cos(a) - dy * Math.sin(a), center[1] + dx * Math.sin(a) + dy * Math.cos(a)];
      copies.push(placed(entity, resolved, target, config.rotateCopies === false ? 0 : step * i, center));
    }
    return { copies };
  }
  if (config.kind === 'ellipse') {
    if (!(config.rx > 0) || !(config.ry > 0)) throw new Error('Los radios de la elipse deben ser mayores que 0');
    const start = rad(config.start ?? 0);
    const at = (i) => [center[0] + config.rx * Math.cos(start + (2 * Math.PI * i) / count), center[1] + config.ry * Math.sin(start + (2 * Math.PI * i) / count)];
    const first = placed(entity, resolved, at(0), 0, center);
    for (let i = 1; i < count; i += 1) copies.push(placed(entity, resolved, at(i), 0, center));
    return { copies, original: Object.fromEntries(Object.entries(first).filter(([key]) => key === 'x' || key === 'y' || key === 'pts')) };
  }
  throw new Error('Tipo de repetición desconocido');
}
