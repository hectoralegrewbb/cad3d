// Perfiles de trayectoria de un eje (cinemática pura, sin DOM ni kernel). Unidades coherentes: mm y mm/s para un eje lineal,
// grados y °/s para uno rotativo. Un perfil es una lista de fases de jerk constante; la integración es exacta (polinomios).
//   trapezoidal: aceleración constante, velocidad crucero y desaceleración constante (jerk infinito en los cambios).
//   triangular : sin velocidad crucero: acelera y frena de inmediato (se limita a vMax si la distancia es larga).
//   scurve     : curva en S, jerk limitado; suaviza arranques y frenadas.

export const profileKinds = { trapezoidal: 'Trapezoidal', triangular: 'Triangular', scurve: 'Curva en S (jerk limitado)' };

const eps = 1e-9;
const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

// Límites normalizados: jerk 0 / vacío = sin límite de jerk (rampas de aceleración constante).
export const normalizeLimits = (limits = {}) => ({
  vMax: positive(limits.vMax, 100),
  aMax: positive(limits.aMax, 500),
  jerk: positive(limits.jerk, Infinity),
});

// Una fase: { dt, j, a0 }. `a0` (opcional) fija la aceleración inicial; si falta, continúa la anterior.
const advance = (state, phase) => {
  const a0 = phase.a0 ?? state.a;
  const j = phase.j ?? 0;
  const dt = phase.dt;
  return { p: state.p + state.v * dt + (a0 * dt * dt) / 2 + (j * dt ** 3) / 6, v: state.v + a0 * dt + (j * dt * dt) / 2, a: a0 + j * dt };
};

// Perfil: estado inicial { p, v } y fases. `at(tau)` da { p, v, a } (tau < 0 = inicio; tau > duración = velocidad final constante).
export function makeProfile(phases, start = {}) {
  const first = { p: start.p ?? 0, v: start.v ?? 0, a: 0 };
  const steps = [];
  let state = first;
  let time = 0;
  phases.filter((phase) => phase.dt > 0).forEach((phase) => {
    const a0 = phase.a0 ?? state.a;
    steps.push({ t0: time, state: { ...state, a: a0 }, phase: { ...phase, a0 } });
    state = advance({ ...state, a: a0 }, phase);
    time += phase.dt;
  });
  const end = { p: state.p, v: state.v, a: 0 };
  return {
    duration: time,
    start: first,
    end,
    phases: steps.map((step) => step.phase),
    at(tau) {
      if (tau <= 0 || !steps.length) return { ...first, a: steps.length && tau >= 0 ? steps[0].state.a : 0 };
      if (tau >= time) return { p: end.p + end.v * (tau - time), v: end.v, a: 0 };
      let index = steps.length - 1;
      while (index > 0 && steps[index].t0 > tau) index -= 1;
      const step = steps[index];
      return advance(step.state, { ...step.phase, dt: tau - step.t0 });
    },
  };
}

const rampTime = (speed, limits, kind) => {
  if (kind !== 'scurve' || !Number.isFinite(limits.jerk)) return speed / limits.aMax;
  const knee = (limits.aMax * limits.aMax) / limits.jerk;
  return speed >= knee ? speed / limits.aMax + limits.aMax / limits.jerk : 2 * Math.sqrt(speed / limits.jerk);
};

// Fases que llevan la velocidad de v0 a v1 (con signo). Siempre terminan con aceleración 0.
export function rampPhases(v0, v1, limits, kind = 'trapezoidal') {
  const delta = v1 - v0;
  const size = Math.abs(delta);
  if (size < eps) return [];
  const sign = Math.sign(delta);
  if (kind === 'scurve' && Number.isFinite(limits.jerk)) {
    const { aMax: a, jerk: j } = limits;
    if (size >= (a * a) / j) {
      const tj = a / j;
      return [{ dt: tj, j: sign * j, a0: 0 }, { dt: size / a - tj, j: 0 }, { dt: tj, j: -sign * j }];
    }
    const tj = Math.sqrt(size / j);
    return [{ dt: tj, j: sign * j, a0: 0 }, { dt: tj, j: -sign * j }];
  }
  return [{ dt: size / limits.aMax, j: 0, a0: sign * limits.aMax }];
}

// Velocidad máxima alcanzable en un movimiento simétrico de distancia D sin crucero.
function peakSpeed(distance, limits, kind) {
  const { aMax: a, jerk: j } = limits;
  if (kind !== 'scurve' || !Number.isFinite(j)) return Math.sqrt(distance * a);
  const short = (distance * Math.sqrt(j) / 2) ** (2 / 3);
  if (short <= (a * a) / j) return short;
  return (a / 2) * (-a / j + Math.sqrt((a / j) ** 2 + (4 * distance) / a));
}

// Movimiento de reposo a reposo. Devuelve { phases, vPeak, cruise (s), duration, reachesCruise, clamped }.
export function restMove(distance, limitsIn, kind = 'trapezoidal') {
  const limits = normalizeLimits(limitsIn);
  const size = Math.abs(distance);
  if (!(size > eps)) return { phases: [], vPeak: 0, cruise: 0, duration: 0, reachesCruise: false, clamped: false };
  const sign = Math.sign(distance);
  const rampDistance = (speed) => speed * rampTime(speed, limits, kind);
  let vPeak;
  let cruise = 0;
  let clamped = false;
  if (kind === 'triangular') {
    vPeak = peakSpeed(size, limits, kind);
    if (vPeak > limits.vMax) {
      vPeak = limits.vMax;
      cruise = (size - rampDistance(vPeak)) / vPeak;
      clamped = true;
    }
  } else if (rampDistance(limits.vMax) <= size) {
    vPeak = limits.vMax;
    cruise = (size - rampDistance(vPeak)) / vPeak;
  } else {
    vPeak = peakSpeed(size, limits, kind);
  }
  const phases = [
    ...rampPhases(0, sign * vPeak, limits, kind),
    ...(cruise > eps ? [{ dt: cruise, j: 0, a0: 0 }] : []),
    ...rampPhases(sign * vPeak, 0, limits, kind),
  ];
  const duration = phases.reduce((sum, phase) => sum + phase.dt, 0);
  return { phases, vPeak: sign * vPeak, cruise, duration, reachesCruise: cruise > eps, clamped };
}

// Perfil listo para muestrear de un movimiento de reposo a reposo.
export const restMoveProfile = (distance, limits, kind, start = {}) => {
  const plan = restMove(distance, limits, kind);
  return { ...plan, profile: makeProfile(plan.phases, start) };
};

// Distancia recorrida al frenar desde la velocidad v hasta 0.
export function stopDistance(v, limitsIn, kind = 'trapezoidal') {
  const limits = normalizeLimits(limitsIn);
  return makeProfile(rampPhases(v, 0, limits, kind), { p: 0, v }).end.p;
}

// Desplazamiento suave de duración fija (quintico de mínimo jerk): fases de corrección en marcha (Phasing).
export function smoothOffset(distance, duration) {
  const total = positive(duration, 1);
  const quintic = (u) => 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
  const slope = (u) => 30 * u ** 2 - 60 * u ** 3 + 30 * u ** 4;
  const curve = (u) => 60 * u - 180 * u ** 2 + 120 * u ** 3;
  return {
    duration: total,
    at(tau) {
      if (tau <= 0) return { p: 0, v: 0, a: 0 };
      if (tau >= total) return { p: distance, v: 0, a: 0 };
      const u = tau / total;
      return { p: distance * quintic(u), v: (distance * slope(u)) / total, a: (distance * curve(u)) / (total * total) };
    },
  };
}

// Polinomio quíntico entre dos estados { p, v, a } en `span` segundos (empalme a un movimiento ya conocido).
export function quinticBlend(from, to, span) {
  const t = positive(span, 1e-3);
  const dp = to.p - from.p - from.v * t - (from.a * t * t) / 2;
  const dv = to.v - from.v - from.a * t;
  const da = to.a - from.a;
  const c3 = (10 * dp - 4 * dv * t + (da * t * t) / 2) / t ** 3;
  const c4 = (-15 * dp + 7 * dv * t - da * t * t) / t ** 4;
  const c5 = (6 * dp - 3 * dv * t + (da * t * t) / 2) / t ** 5;
  return {
    duration: t,
    at(tau) {
      const s = Math.min(Math.max(tau, 0), t);
      return {
        p: from.p + from.v * s + (from.a * s * s) / 2 + c3 * s ** 3 + c4 * s ** 4 + c5 * s ** 5,
        v: from.v + from.a * s + 3 * c3 * s ** 2 + 4 * c4 * s ** 3 + 5 * c5 * s ** 4,
        a: from.a + 6 * c3 * s + 12 * c4 * s ** 2 + 20 * c5 * s ** 3,
      };
    },
  };
}
