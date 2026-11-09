// Registro de una corrida de partículas: muestrea los cuadros del worker (~10 Hz) y guarda series en el tiempo. Puro, sin DOM.
// Canal = clave de serie: 'perSecond', 'count', 'exited', 'p:<sensor>' (Pa), 'v:<sensor>' (m/s), 'q:<sensor>' (m³/h),
// 'zone:<sensor>' (partículas en la zona), 'rpm:<eje>', 'motor:<eje>' (N·m), 'load:<eje>' (N·m), 'fric:<eje>' (N·m).

export const maxSamples = 4000;

export class RunRecorder {
  constructor({ interval = 0.1 } = {}) {
    this.interval = interval;
    this.reset();
  }

  reset() {
    this.metadata = null;
    this.times = [];
    this.channels = new Map(); // clave → number[] (misma longitud que times)
    this.lastTime = -Infinity;
    this.step = 1; // decimación creciente cuando se llena
  }

  // Un cuadro del worker. Devuelve true si se guardó una muestra.
  push(frame) {
    const t = frame.time;
    if (t < this.lastTime) this.reset(); // se reinició la simulación
    if (t - this.lastTime < this.interval * this.step) return false;
    this.lastTime = t;
    const row = { perSecond: frame.perSecond, count: frame.count, exited: frame.exited };
    if(frame.fill){row['fill:storedKg']=frame.fill.reservoirKg;row['fill:activeKg']=frame.fill.activeKg;row['fill:exitedKg']=frame.fill.exitedKg;row['fill:levelMm']=frame.fill.level;row['fill:crossedKg']=frame.fill.crossedKg??0;row['fill:flowKgS']=frame.fill.flowKgS??0;}
    Object.entries(frame.air?.readings ?? {}).forEach(([id, r]) => {
      row[`p:${id}`] = r.pressure;
      row[`v:${id}`] = r.speed;
      row[`q:${id}`] = r.flow;
    });
    (frame.air?.plug ?? []).forEach((mon) => { row[`plug:${mon.id}`] = mon.ratio; });
    Object.entries(frame.sensorCounts ?? {}).forEach(([id, n]) => { row[`zone:${id}`] = n; });
    (frame.rotors ?? []).forEach((r) => {
      row[`rpm:${r.key}`] = r.rpm;
      row[`motor:${r.key}`] = r.motorTorque;
      row[`load:${r.key}`] = r.loadTorque;
      row[`fric:${r.key}`] = r.frictionTorque;
    });
    const n = this.times.length;
    this.times.push(t);
    Object.keys(row).forEach((key) => {
      if (!this.channels.has(key)) this.channels.set(key, new Array(n).fill(null)); // canal que aparece tarde
      this.channels.get(key).push(Number.isFinite(row[key]) ? row[key] : null);
    });
    this.channels.forEach((series, key) => { if (!(key in row)) series.push(null); });
    if (this.times.length >= maxSamples) this.thin();
    return true;
  }

  // Descarta una de cada dos muestras y duplica el intervalo: la memoria queda acotada en corridas largas.
  thin() {
    const keep = (_, i) => i % 2 === 0;
    this.times = this.times.filter(keep);
    this.channels.forEach((series, key) => this.channels.set(key, series.filter(keep)));
    this.step *= 2;
  }

  keys() {
    return [...this.channels.keys()];
  }

  series(key) {
    return { times: this.times, values: this.channels.get(key) ?? [] };
  }

  // Copia congelada para comparar contra otra corrida.
  snapshot(name) {
    return { name, metadata: this.metadata ? structuredClone(this.metadata) : null, times: [...this.times], channels: new Map([...this.channels].map(([k, v]) => [k, [...v]])) };
  }

  csv(names = {}) {
    const keys = this.keys();
    const head = ['t (s)', ...keys.map((key) => labelOf(key, names))];
    const rows = this.times.map((t, i) => [t.toFixed(3), ...keys.map((key) => { const v = this.channels.get(key)[i]; return v == null ? '' : Number(v.toPrecision(6)); })]);
    return [head, ...rows].map((row) => row.join(';')).join('\n');
  }
}

const labels = { perSecond: 'salen/s', count: 'partículas', exited: 'salieron (total)', 'fill:storedKg':'reservorio (kg)', 'fill:activeKg':'partículas locales (kg)', 'fill:exitedKg':'retirado del dominio (kg)', 'fill:levelMm':'nivel de carga Z (mm)', 'fill:crossedKg':'masa por sección (kg)', 'fill:flowKgS':'caudal por sección (kg/s)' };
const prefixes = { p: 'presión (Pa)', v: 'velocidad (m/s)', q: 'caudal (m³/h)', zone: 'partículas en zona', rpm: 'rpm', motor: 'par motor (N·m)', load: 'par de carga (N·m)', fric: 'par de fricción (N·m)', plug: 'taponamiento (× sobre línea limpia)' };

// Nombre legible de un canal; `names` traduce ids de sensores.
export function labelOf(key, names = {}) {
  if (labels[key]) return labels[key];
  const [prefix, ...rest] = key.split(':');
  const id = rest.join(':');
  return `${names[id] ?? id} · ${prefixes[prefix] ?? prefix}`;
}
