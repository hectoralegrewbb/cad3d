// Tablas de roscas: [nombre, diámetro nominal, paso, diámetro de broca de macho]. Valores usuales de taller (ISO 724 / ISO 228 / ASME B1.1).
const metricCoarse = [['M3', 3, 0.5, 2.5], ['M4', 4, 0.7, 3.3], ['M5', 5, 0.8, 4.2], ['M6', 6, 1, 5], ['M8', 8, 1.25, 6.8], ['M10', 10, 1.5, 8.5], ['M12', 12, 1.75, 10.2], ['M14', 14, 2, 12], ['M16', 16, 2, 14], ['M18', 18, 2.5, 15.5], ['M20', 20, 2.5, 17.5], ['M22', 22, 2.5, 19.5], ['M24', 24, 3, 21], ['M27', 27, 3, 24], ['M30', 30, 3.5, 26.5], ['M36', 36, 4, 32], ['M42', 42, 4.5, 37.5], ['M48', 48, 5, 43]];
const metricFine = [['M6', 6, 0.75, 5.25], ['M8', 8, 1, 7], ['M10', 10, 1.25, 8.8], ['M10', 10, 1, 9], ['M12', 12, 1.5, 10.5], ['M12', 12, 1.25, 10.8], ['M14', 14, 1.5, 12.5], ['M16', 16, 1.5, 14.5], ['M18', 18, 1.5, 16.5], ['M20', 20, 1.5, 18.5], ['M22', 22, 1.5, 20.5], ['M24', 24, 2, 22], ['M27', 27, 2, 25], ['M30', 30, 2, 28], ['M36', 36, 3, 33]];
const gas = [['G 1/8', 9.728, 0.907, 8.8], ['G 1/4', 13.157, 1.337, 11.8], ['G 3/8', 16.662, 1.337, 15.25], ['G 1/2', 20.955, 1.814, 19], ['G 5/8', 22.911, 1.814, 21], ['G 3/4', 26.441, 1.814, 24.5], ['G 1', 33.249, 2.309, 30.5], ['G 1 1/4', 41.91, 2.309, 39.2], ['G 1 1/2', 47.803, 2.309, 45]];
const unc = [['1/4-20 UNC', 6.35, 1.27, 5.1], ['5/16-18 UNC', 7.938, 1.411, 6.5], ['3/8-16 UNC', 9.525, 1.588, 7.94], ['1/2-13 UNC', 12.7, 1.954, 10.7], ['5/8-11 UNC', 15.875, 2.309, 13.5], ['3/4-10 UNC', 19.05, 2.54, 16.5], ['1-8 UNC', 25.4, 3.175, 22.2]];
const unf = [['1/4-28 UNF', 6.35, 0.907, 5.5], ['5/16-24 UNF', 7.938, 1.058, 6.9], ['3/8-24 UNF', 9.525, 1.058, 8.5], ['1/2-20 UNF', 12.7, 1.27, 11.5]];

const fmt = (value) => String(Math.round(value * 1000) / 1000).replace('.', ',');
const build = (rows, label) => rows.map(([name, major, pitch, tap]) => ({ name, major, pitch, tap, label: label(name, pitch) }));

export const threadTypes = {
  M: { label: 'Métrica gruesa (ISO)', rows: build(metricCoarse, (name, pitch) => `${name}×${fmt(pitch)}`) },
  MF: { label: 'Métrica fina (ISO)', rows: build(metricFine, (name, pitch) => `${name}×${fmt(pitch)}`) },
  X: { label: 'Especial (Ø y paso propios)', rows: [] },
  G: { label: 'Gas BSP cilíndrica (G)', rows: build(gas, (name) => name) },
  UNC: { label: 'UNC (pulgadas, gruesa)', rows: build(unc, (name) => name) },
  UNF: { label: 'UNF (pulgadas, fina)', rows: build(unf, (name) => name) },
};

export const defaultThread = () => ({ on: false, type: 'M', size: 'auto', depth: '', pitch: '' });

// Rosca especial (no normalizada): Ø nominal y paso propios. Con `drill` el Ø dado es el de la broca (agujero) y el nominal = broca + paso.
const customRow = (pitchText, d, drill) => {
  const pitch = Number(String(pitchText ?? '').replace(',', '.'));
  if (!(pitch > 0) || !Number.isFinite(d)) return null;
  const major = drill ? d + pitch : d;
  return { name: `Ø${fmt(major)}`, major, pitch, tap: major - pitch, label: `Ø${fmt(major)}×${fmt(pitch)}` };
};

// Rosca que corresponde a un agujero de diámetro d: coincide con la broca de macho o con el nominal (±0,15 mm).
export function detectThread(type, d, tolerance = 0.15) {
  const rows = threadTypes[type]?.rows ?? [];
  let best = null;
  rows.forEach((row) => {
    const diff = Math.min(Math.abs(row.tap - d), Math.abs(row.major - d));
    if (diff <= tolerance && (!best || diff < best.diff)) best = { row, diff };
  });
  return best?.row ?? null;
}

export const findThread = (type, key) => (threadTypes[type]?.rows ?? []).find((row) => `${row.name}|${row.pitch}` === key) ?? null;
export const threadKey = (row) => `${row.name}|${row.pitch}`;

// Rosca efectiva de un agujero según lo elegido ('auto' detecta por el diámetro).
export function resolveThread(thread, d, { drill = false } = {}) {
  if (!thread?.on) return null;
  if (thread.type === 'X') return customRow(thread.pitch, d, drill);
  const chosen = thread.size && thread.size !== 'auto' ? findThread(thread.type, thread.size) : detectThread(thread.type, d);
  return chosen;
}

// Texto de la cota: "M8×1,25" (+ "prof. 12" si se indicó).
export function threadCallout(row, depth) {
  const n = Number(String(depth ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? `${row.label} prof. ${fmt(n)}` : row.label;
}
