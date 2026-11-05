import { materials } from '../drawing/features3d.js';
import { partColors } from './projectModel.js';

// Color de una pieza: el elegido por la persona; si no, el del material (vista de pieza) o la paleta por pieza (ensamble).
export const materialColor = (part) => materials[part.meta.material ?? '']?.color ?? null;
export const partColor = (part, index, { palette = false } = {}) => part.meta.color || (palette ? partColors[index % partColors.length] : materialColor(part) ?? undefined);
