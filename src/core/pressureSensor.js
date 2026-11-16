// Sensor de presión (toma puntual) de la escena: definición, unidades y cálculo de la lectura. Puro, sin DOM ni simulador.
// Imita un transmisor real: mide presión manométrica (0 = atmósfera, los bordes abiertos del aire calculado) en una toma,
// con un tiempo de respuesta, y puede ser de presión estática, total (tubo Pitot) o diferencial entre dos tomas.

export const pressureModes = {
  estatica: 'Estática (toma en la pared)',
  total: 'Total (tubo Pitot de frente al flujo)',
  diferencial: 'Diferencial (toma + menos toma −)',
};

// Pascales por unidad.
export const pressureUnits = { Pa: 1, mbar: 100, kPa: 1000, mmca: 9.80665 };
const unitDigits = { Pa: 0, mbar: 2, kPa: 3, mmca: 1 };

export const isPressureSensor = (sensor) => sensor?.kind === 'presion';

export const defaultPressureSensor = (patch = {}) => ({
  kind: 'presion',
  name: '',
  center: [0, 0, 0], // toma (+)
  ref: [0, 0, 0], // toma (−), solo en modo diferencial
  size: [1, 1, 1], // sin uso: mantiene la forma de los sensores de zona
  mode: 'estatica',
  unit: 'Pa',
  tau: 0.2, // tiempo de respuesta del transmisor, s (0 = instantáneo)
  ...patch,
});

export const toUnit = (pascals, unit = 'Pa') => pascals / (pressureUnits[unit] ?? 1);
export const fromUnit = (value, unit = 'Pa') => value * (pressureUnits[unit] ?? 1);

export function formatPressure(pascals, unit = 'Pa') {
  if (!Number.isFinite(pascals)) return '—';
  const known = pressureUnits[unit] ? unit : 'Pa';
  return `${toUnit(pascals, known).toFixed(unitDigits[known]).replace('.', ',')} ${known}`;
}

// Lectura instantánea a partir de las muestras del aire en cada toma: { pressure (Pa), speed (m/s) } o null si la toma no toca aire.
// Devuelve { value, staticPa, dynamicPa, totalPa, speed, valid }; `value` es lo que marca el instrumento según su modo.
export function measurePressure(mode, tap, refTap, rho = 1.2) {
  if (!tap || (mode === 'diferencial' && !refTap)) return { value: null, staticPa: null, dynamicPa: null, totalPa: null, speed: null, valid: false };
  const dynamicPa = 0.5 * rho * tap.speed * tap.speed;
  const totalPa = tap.pressure + dynamicPa;
  const value = mode === 'total' ? totalPa : mode === 'diferencial' ? tap.pressure - refTap.pressure : tap.pressure;
  return { value, staticPa: tap.pressure, dynamicPa, totalPa, speed: tap.speed, valid: true };
}

// Respuesta de primer orden del transmisor: fracción del salto que se recorre en `dt` segundos.
export const lagFactor = (dt, tau) => (tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1);

// Presostato: ¿la lectura cumple el umbral?
export const pressureOps = { '>=': 'sube hasta (≥)', '<=': 'baja hasta (≤)' };
export const pressureCrossed = (value, op, threshold) => Number.isFinite(value) && (op === '<=' ? value <= threshold : value >= threshold);
export const pressureKey = (sensor, op, value) => `${sensor}:${op === '<=' ? '<=' : '>='}:${Number(value) || 0}`;
