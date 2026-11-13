// Línea de tiempo de un eje: segmentos consecutivos (perfil analítico, función o muestras) + desplazamientos superpuestos.
// Después del último segmento el eje sigue con la velocidad final (un MoveVelocity "indefinido" no se detiene solo).
import { makeProfile } from './profiles.js';

const rest = { x: 0, v: 0, a: 0, force: 0 };

// Segmento de perfil: `profile` es relativo (p desde 0); se desplaza a la posición x0.
const profileSegment = (t0, x0, profile) => ({
  t0,
  t1: t0 + profile.duration,
  at: (t) => {
    const s = profile.at(t - t0);
    return { x: x0 + s.p, v: s.v, a: s.a, force: 0 };
  },
});

export class Timeline {
  constructor(start = {}) {
    this.start = { t: start.t ?? 0, x: start.x ?? 0, v: start.v ?? 0 };
    this.segments = [];
    this.last = { t: this.start.t, x: this.start.x, v: this.start.v, a: 0, force: 0 };
  }

  get end() {
    return this.last;
  }

  // Estado en el instante t (antes del inicio: la posición inicial; después del último segmento: velocidad final constante).
  at(t) {
    if (t <= this.start.t) return { x: this.start.x, v: this.start.v, a: 0, force: 0 };
    if (!this.segments.length) return { x: this.last.x + this.last.v * (t - this.last.t), v: this.last.v, a: 0, force: 0 };
    let low = 0;
    let high = this.segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.segments[mid].t0 <= t) low = mid;
      else high = mid - 1;
    }
    const segment = this.segments[low];
    if (t <= segment.t1) return segment.at(t);
    const tail = segment === this.segments[this.segments.length - 1] ? this.last : segment.at(segment.t1);
    return { x: tail.x + tail.v * (t - segment.t1), v: tail.v, a: 0, force: 0 };
  }

  push(segment) {
    if (segment.t0 > this.last.t + 1e-12) this.hold(segment.t0 - this.last.t);
    this.segments.push(segment);
    this.last = { ...segment.at(segment.t1), t: segment.t1 };
  }

  // Sigue a velocidad constante `duration` segundos (espera con el eje parado o en marcha).
  hold(duration) {
    if (!(duration > 1e-12)) return;
    const t0 = this.last.t;
    const x0 = this.last.x;
    const v = this.last.v;
    this.segments.push({ t0, t1: t0 + duration, at: (t) => ({ x: x0 + v * (t - t0), v, a: 0, force: 0 }) });
    this.last = { t: t0 + duration, x: x0 + v * duration, v, a: 0, force: 0 };
  }

  advanceTo(t) {
    this.hold(t - this.last.t);
  }

  // Agrega fases de jerk constante a partir del estado final.
  addPhases(phases) {
    const profile = makeProfile(phases, { p: 0, v: this.last.v });
    if (profile.duration <= 0) return profile;
    this.push(profileSegment(this.last.t, this.last.x, profile));
    return profile;
  }

  // Segmento definido por una función t → { x, v, a, force } válida entre t0 y t1 (t1 puede ser Infinity: se corta con `truncate`).
  addFunction(t0, t1, at) {
    const closing = Number.isFinite(t1) ? t1 : t0 + 1e6;
    if (t0 > this.last.t + 1e-12) this.hold(t0 - this.last.t);
    this.segments.push({ t0: this.last.t, t1: closing, at });
    this.last = { ...at(closing), t: closing };
    return this;
  }

  // Muestras uniformes { dt, x[], v[], force[] } desde t0 (simulaciones numéricas: par, bobinado).
  addSamples(t0, dt, data) {
    const count = data.x.length;
    const t1 = t0 + (count - 1) * dt;
    const at = (t) => {
      const u = Math.min(Math.max((t - t0) / dt, 0), count - 1);
      const i = Math.min(Math.floor(u), count - 2);
      const f = u - i;
      if (count < 2) return { x: data.x[0], v: data.v[0], a: 0, force: data.force?.[0] ?? 0 };
      const mix = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
      return { x: mix(data.x), v: mix(data.v), a: (data.v[i + 1] - data.v[i]) / dt, force: data.force ? mix(data.force) : 0 };
    };
    this.addFunction(t0, t1, at);
  }

  // Corta la línea de tiempo en t (un comando nuevo interrumpe al anterior). El resto sigue con la velocidad que había en t.
  truncate(t) {
    if (t >= this.last.t - 1e-12) return;
    const state = this.at(t);
    while (this.segments.length && this.segments[this.segments.length - 1].t0 >= t) this.segments.pop();
    const lastSegment = this.segments[this.segments.length - 1];
    if (lastSegment) lastSegment.t1 = Math.min(lastSegment.t1, t);
    this.last = { t, x: state.x, v: state.v, a: 0, force: state.force ?? 0 };
  }

  // Cambio brusco de velocidad (choque contra un tope): conserva la posición.
  impact(velocity = 0) {
    this.last = { ...this.last, v: velocity, a: 0 };
  }
}

// Suma de la línea de tiempo base y de los desplazamientos superpuestos: cada uno { t0, at(tau) → { p, v, a } }.
export function trackOf(timeline, overlays = []) {
  return {
    timeline,
    overlays,
    at(t) {
      const base = timeline.at(t);
      let { x, v, a } = base;
      overlays.forEach((overlay) => {
        if (t <= overlay.t0) return;
        const s = overlay.at(t - overlay.t0);
        x += s.p;
        v += s.v;
        a += s.a;
      });
      return { x, v, a, force: base.force ?? rest.force };
    },
  };
}
