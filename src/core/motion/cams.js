// Levas electrónicas: una leva es y(u) con u ∈ [0, 1] la fase del maestro (un ciclo). `eval(u)` devuelve { y, dy, ddy }
// (derivadas respecto de u). `net` = avance neto del esclavo por ciclo (0: vuelve al punto de partida; ≠ 0: avanza, p. ej. una
// cuchilla rotativa que da 1/n de vuelta por corte). Las levas son puras y no dependen de ningún eje.
import { quinticBlend } from './profiles.js';

export const camLaws = { cycloidal: 'Cicloidal', poly345: 'Polinomio 3-4-5', harmonic: 'Armónica (seno)', linear: 'Lineal' };
export const camKinds = { riseDwell: 'Subida – reposo – bajada – reposo', sync: 'Sincronizada (corte al vuelo / cuchilla)', table: 'Tabla de puntos (fase, posición)' };

const clamp01 = (u) => Math.min(1, Math.max(0, u));

// Ley de subida normalizada f: [0,1] → [0,1] con su primera y segunda derivada.
export function riseLaw(law, u) {
  const s = clamp01(u);
  switch (law) {
    case 'linear': return { y: s, dy: 1, ddy: 0 };
    case 'poly345': return { y: 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5, dy: 30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4, ddy: 60 * s - 180 * s ** 2 + 120 * s ** 3 };
    case 'harmonic': return { y: (1 - Math.cos(Math.PI * s)) / 2, dy: (Math.PI / 2) * Math.sin(Math.PI * s), ddy: (Math.PI ** 2 / 2) * Math.cos(Math.PI * s) };
    default: {
      const w = 2 * Math.PI * s;
      return { y: s - Math.sin(w) / (2 * Math.PI), dy: 1 - Math.cos(w), ddy: 2 * Math.PI * Math.sin(w) };
    }
  }
}

// Subida – reposo alto – bajada – reposo bajo. Las fracciones son del ciclo; lo que falta hasta 1 es el reposo bajo.
export function riseDwellCam({ stroke = 1, rise = 0.4, dwellHigh = 0.1, fall = 0.4, law = 'cycloidal' } = {}) {
  const r = Math.max(1e-6, rise);
  const f = Math.max(1e-6, fall);
  const h = Math.max(0, dwellHigh);
  const total = r + h + f;
  const scale = total > 1 ? 1 / total : 1; // si las fracciones suman más de 1 se escalan
  const a = r * scale;
  const b = (r + h) * scale;
  const c = (r + h + f) * scale;
  return {
    net: 0,
    eval(u) {
      if (u < a) { const s = riseLaw(law, u / a); return { y: stroke * s.y, dy: (stroke * s.dy) / a, ddy: (stroke * s.ddy) / (a * a) }; }
      if (u < b) return { y: stroke, dy: 0, ddy: 0 };
      if (u < c) { const s = riseLaw(law, (u - b) / (c - b)); return { y: stroke * (1 - s.y), dy: (-stroke * s.dy) / (c - b), ddy: (-stroke * s.ddy) / ((c - b) ** 2) }; }
      return { y: 0, dy: 0, ddy: 0 };
    },
  };
}

// Leva sincronizada: durante la ventana [0, windowFrac] el esclavo avanza con pendiente `slope` (unidades del esclavo por unidad del
// maestro), o sea iguala la velocidad del material; el resto del ciclo se acomoda con un empalme quíntico suave hasta el ciclo siguiente.
//   Corte al vuelo: slope 1 (carro y cinta a igual velocidad), net 0 (el carro vuelve).
//   Cuchilla rotativa: slope = 360 / (2πR) °/mm (la punta iguala la cinta), net = 360 / palas (° por corte).
export function syncCam({ cycleLength, windowLength, slope = 1, net = 0 } = {}) {
  const length = Math.max(1e-9, Number(cycleLength) || 1);
  const windowFrac = Math.min(0.95, Math.max(1e-6, (Number(windowLength) || length * 0.2) / length));
  const rate = slope * length; // dy/du en la ventana
  const yWindow = rate * windowFrac;
  const blend = quinticBlend({ p: yWindow, v: rate, a: 0 }, { p: net, v: rate, a: 0 }, 1 - windowFrac);
  return {
    net,
    windowFrac,
    eval(u) {
      if (u <= windowFrac) return { y: rate * u, dy: rate, ddy: 0 };
      const s = blend.at(u - windowFrac);
      return { y: s.p, dy: s.v, ddy: s.a };
    },
  };
}

// Tabla de puntos [fase 0..1, posición] unidos con Hermite cúbico (pendientes por diferencias centradas).
export function tableCam(pointsIn = [], { net = null } = {}) {
  const points = [...pointsIn].map(([u, y]) => [Number(u), Number(y)]).filter(([u, y]) => Number.isFinite(u) && Number.isFinite(y)).sort((p, q) => p[0] - q[0]);
  if (points.length < 2) return { net: 0, eval: () => ({ y: 0, dy: 0, ddy: 0 }) };
  const slopes = points.map((point, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    return (next[1] - prev[1]) / Math.max(1e-9, next[0] - prev[0]);
  });
  const first = points[0];
  const last = points[points.length - 1];
  return {
    net: net ?? last[1] - first[1],
    eval(u) {
      if (u <= first[0]) return { y: first[1], dy: slopes[0], ddy: 0 };
      if (u >= last[0]) return { y: last[1], dy: slopes[points.length - 1], ddy: 0 };
      let i = 0;
      while (i < points.length - 2 && points[i + 1][0] <= u) i += 1;
      const [u0, y0] = points[i];
      const [u1, y1] = points[i + 1];
      const h = u1 - u0;
      const s = (u - u0) / h;
      const m0 = slopes[i] * h;
      const m1 = slopes[i + 1] * h;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
      const h10 = s ** 3 - 2 * s ** 2 + s;
      const h01 = -2 * s ** 3 + 3 * s ** 2;
      const h11 = s ** 3 - s ** 2;
      return {
        y: h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1,
        dy: ((6 * s ** 2 - 6 * s) * (y0 - y1) + (3 * s ** 2 - 4 * s + 1) * m0 + (3 * s ** 2 - 2 * s) * m1) / h,
        ddy: ((12 * s - 6) * (y0 - y1) + (6 * s - 4) * m0 + (6 * s - 2) * m1) / (h * h),
      };
    },
  };
}

// Leva a partir de la descripción guardada en el comando ({ kind, ...parámetros }).
export function buildCam(spec = {}) {
  switch (spec.kind) {
    case 'sync': return syncCam({ cycleLength: spec.cycleLength, windowLength: spec.windowLength, slope: spec.slope ?? 1, net: spec.net ?? 0 });
    case 'table': return tableCam(spec.points ?? [[0, 0], [0.5, 1], [1, 0]], { net: spec.net ?? null });
    default: return riseDwellCam({ stroke: spec.stroke ?? 1, rise: spec.rise ?? 0.4, dwellHigh: spec.dwellHigh ?? 0.1, fall: spec.fall ?? 0.4, law: spec.law ?? 'cycloidal' });
  }
}

// Valor de la leva en una fase u cualquiera (ciclos completos suman `net`).
export function camAt(cam, phase) {
  const cycles = Math.floor(phase);
  const u = phase - cycles;
  const s = cam.eval(u);
  return { y: s.y + cycles * cam.net, dy: s.dy, ddy: s.ddy };
}
