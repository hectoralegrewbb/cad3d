import { evaluate } from './expression.js';

export const unitFactors = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const round = (value) => Math.round(value * 10000) / 10000;

// Interpreta lo que se tipea al dimensionar: "25", "2,5 cm", '1"', "r12" (radio) o una expresión con parámetros ("Dext/2").
// Devuelve { ok, value (mm, número), store (número o expresión para guardar en la entidad), radius?, error? }.
export function parseLength(text, { unit = 'mm', params = {}, allowRadius = false, allowNegative = false } = {}) {
  let source = String(text ?? '').trim();
  if (source === '') return { ok: false, empty: true };
  let radius = false;
  if (allowRadius && /^r\s*/i.test(source)) {
    radius = true;
    source = source.replace(/^r\s*/i, '');
  }
  const match = source.replace(',', '.').match(/^(-?\d*\.?\d+)\s*(mm|cm|m|in|")?$/i);
  if (match) {
    const suffix = (match[2] ?? unit).toLowerCase().replace('"', 'in');
    const value = round(Number(match[1]) * unitFactors[suffix]);
    if (!allowNegative && !(value > 0)) return { ok: false, error: 'Debe ser mayor que 0' };
    return { ok: true, value, store: value, radius };
  }
  try {
    const value = evaluate(source, params);
    if (!Number.isFinite(value) || (!allowNegative && !(value > 0))) return { ok: false, error: 'Debe ser mayor que 0' };
    return { ok: true, value: round(value), store: source, radius };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Mide en la unidad de pantalla (mm o cm) para etiquetas y reglas.
export const toUnit = (mm, unit) => mm / (unitFactors[unit] ?? 1);
export const formatUnit = (mm, unit) => {
  const value = toUnit(mm, unit);
  const text = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${Number(text)}`;
};
