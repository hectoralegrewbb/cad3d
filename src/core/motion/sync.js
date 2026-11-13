// Sincronismo multieje: GearIn (engranaje electrónico), GearOut, Phasing, CamIn (leva electrónica), registro con marca (TouchProbe)
// y bobinado con tensión. El esclavo lee la trayectoria ya calculada del maestro (env.master(id)): la planificación va en orden de dependencia.
import { buildCam, camAt } from './cams.js';
import { quinticBlend, rampPhases, smoothOffset } from './profiles.js';

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : fallback);
const smoothStep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// Generador pseudoaleatorio determinista (mulberry32): las marcas de una preset son siempre las mismas para una semilla.
export function seededRandom(seed) {
  let state = (Math.round(finite(seed, 1)) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Error de la marca k respecto de su posición nominal: deriva acumulada + ruido uniforme ±jitter.
export function registrationErrors({ seed = 1, jitter = 2, drift = 0, count = 100 } = {}) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, k) => drift * k + (random() * 2 - 1) * jitter);
}

const masterOf = (ctx, command) => {
  const master = ctx.env.master?.(command.master);
  if (!master) ctx.warn('el eje maestro no existe o depende de este eje', command);
  return master;
};

// ¿Cuánto vale el máximo de |v| y |a| de un tramo del perfil? (para elegir un punto de enganche alcanzable)
function peaks(at, t0, t1, samples = 120) {
  let v = 0;
  let a = 0;
  for (let i = 0; i <= samples; i += 1) {
    const s = at(t0 + ((t1 - t0) * i) / samples);
    v = Math.max(v, Math.abs(s.v));
    a = Math.max(a, Math.abs(s.a));
  }
  return { v, a };
}

// Empalma el estado actual del esclavo con `target(t)` (función de tiempo) completando el empalme en la lista de instantes candidatos.
// Devuelve la función del segmento (empalme quíntico + objetivo) y el instante de enganche.
function engageSmooth(ctx, tc, target, candidates, limits) {
  const state = ctx.tl.at(tc);
  const from = { p: state.x, v: state.v, a: 0 };
  let best = null;
  for (const tS of candidates) {
    if (!(tS > tc + 1e-3)) continue;
    const goal = target(tS);
    const blend = quinticBlend(from, { p: goal.x, v: goal.v, a: goal.a }, tS - tc);
    const peak = peaks((t) => blend.at(t - tc), tc, tS);
    const ok = peak.v <= limits.vMax * 1.001 && peak.a <= limits.aMax * 1.001;
    best = { tS, blend, peak, ok };
    if (ok) break;
  }
  return best;
}

const unitFollow = (ctx, tc, tS, blend, target) => (t) => {
  if (t < tc) return { x: ctx.tl.at(tc).x, v: 0, a: 0, force: 0 };
  if (t < tS) {
    const s = blend.at(t - tc);
    return { x: s.p, v: s.v, a: s.a, force: 0 };
  }
  return { ...target(t), force: 0 };
};

const gearIn = (ctx, command, start) => {
  const master = masterOf(ctx, command);
  if (!master) return { status: 'error', note: 'sin maestro', done: ctx.tl.end.t };
  const denominator = finite(command.denominator, 1) || 1;
  const ratio = finite(command.numerator, 1) / denominator;
  const limits = ctx.limits({ accel: command.accel });
  const period = Math.abs(finite(command.period));
  const slavePos = ctx.physical(finite(command.syncSlavePos));
  const followFrom = (masterSyncPos) => (t) => {
    const m = master.at(t);
    return { x: slavePos + ratio * (m.pos - masterSyncPos), v: ratio * m.v, a: ratio * m.a };
  };
  if (command.mode === 'position') {
    const mPos = master.at(start).pos;
    const base = finite(command.syncMasterPos);
    const first = period > 0 ? Math.max(0, Math.ceil((mPos - base) / period)) : 0;
    const tries = period > 0 ? 12 : 1;
    const candidates = [];
    for (let k = 0; k < tries; k += 1) {
      const point = base + (first + k) * period;
      const time = master.timeAtPos(point, start);
      if (time != null) candidates.push({ point, time });
    }
    let best = null;
    for (const candidate of candidates) {
      const target = followFrom(candidate.point);
      const tried = engageSmooth(ctx, start, target, [candidate.time], limits);
      if (!tried) continue;
      best = { ...tried, target };
      if (tried.ok) break;
    }
    if (!best) {
      ctx.warn('el maestro no pasa por la posición de enganche', command);
      return { status: 'error', note: 'sin punto de enganche', done: ctx.tl.end.t };
    }
    if (!best.ok) ctx.warn(`el enganche pide ${best.peak.a.toFixed(0)} de aceleración (límite ${limits.aMax.toFixed(0)}): alargá la distancia de aproximación o subí la aceleración`, command);
    ctx.tl.addFunction(start, Infinity, unitFollow(ctx, start, best.tS, best.blend, best.target));
    return { done: best.tS, note: `enganchado en el segundo ${best.tS.toFixed(2)}` };
  }
  // Enganche solo en velocidad: el esclavo acelera hasta la velocidad del maestro × relación y se bloquea con la fase que tenga.
  const dt = ctx.env.dt ?? 0.002;
  const a = limits.aMax;
  const first = ctx.tl.at(start);
  const xs = [first.x];
  const vs = [first.v];
  let t = start;
  let locked = null;
  while (t < ctx.horizon) {
    const m = master.at(t);
    const target = ratio * m.v;
    const v = vs[vs.length - 1];
    const step = Math.max(-a * dt, Math.min(a * dt, target - v));
    const next = v + step;
    xs.push(xs[xs.length - 1] + ((v + next) / 2) * dt);
    vs.push(next);
    t += dt;
    if (Math.abs(next - ratio * master.at(t).v) < 1e-6 * Math.max(1, Math.abs(next))) { locked = t; break; }
  }
  if (locked == null) locked = Math.min(t, ctx.horizon);
  ctx.tl.addSamples(start, dt, { x: Float64Array.from(xs), v: Float64Array.from(vs) });
  const xLock = xs[xs.length - 1];
  const mLock = master.at(locked).pos;
  ctx.tl.addFunction(locked, Infinity, (time) => {
    const m = master.at(time);
    return { x: xLock + ratio * (m.pos - mLock), v: ratio * m.v, a: ratio * m.a, force: 0 };
  });
  return { done: locked, note: `bloqueado en el segundo ${locked.toFixed(2)}` };
};

const gearOut = (ctx, command) => {
  if (command.after === 'continue') return { done: ctx.tl.end.t };
  ctx.stopToRest(ctx.limits({}), ctx.kind(command));
  return { done: ctx.tl.end.t };
};

// Phasing: desfasa al esclavo respecto del maestro sin detener nada (se suma a lo que ya hace).
const phasing = (ctx, command, start) => {
  const duration = Math.max(0.01, finite(command.duration, 1));
  const offset = smoothOffset(finite(command.shift), duration);
  ctx.overlays.push({ t0: start, at: (tau) => offset.at(tau) });
  return { done: start + duration, note: `${finite(command.shift)} en ${duration} s` };
};

const camIn = (ctx, command, start) => {
  const master = masterOf(ctx, command);
  if (!master) return { status: 'error', note: 'sin maestro', done: ctx.tl.end.t };
  const cam = buildCam(command.cam ?? {});
  const period = Math.max(1e-6, Math.abs(finite(command.period, 100)));
  const scale = finite(command.scale, 1);
  const base = ctx.physical(finite(command.offset));
  const sync = finite(command.syncMasterPos);
  const once = command.cycles === 'once';
  const sample = (phase) => (once ? cam.eval(Math.min(1, Math.max(0, phase))) : camAt(cam, phase));
  const target = (t) => {
    const m = master.at(t);
    const phase = (m.pos - sync) / period;
    const live = !once || (phase > 0 && phase < 1); // una leva de un solo ciclo queda quieta antes y después
    const s = sample(phase);
    const rate = live ? m.v / period : 0;
    const accel = live ? m.a / period : 0;
    return { x: base + scale * s.y, v: scale * s.dy * rate, a: scale * (s.ddy * rate * rate + s.dy * accel) };
  };
  if (command.engage === 'ready') {
    ctx.tl.addFunction(start, Infinity, (t) => ({ ...target(t), force: 0 }));
    return { done: start, note: 'ya en posición' };
  }
  const limits = ctx.limits({});
  const mPos = master.at(start).pos;
  const first = Math.max(0, Math.ceil((mPos - sync) / period));
  const candidates = [];
  for (let k = 0; k < 10; k += 1) {
    const time = master.timeAtPos(sync + (first + k) * period, start);
    if (time != null) candidates.push(time);
  }
  let best = null;
  for (const time of candidates) {
    best = engageSmooth(ctx, start, target, [time], limits) ?? best;
    if (best?.ok) break;
  }
  if (!best) {
    ctx.warn('el maestro no llega a un comienzo de ciclo', command);
    return { status: 'error', note: 'sin comienzo de ciclo', done: ctx.tl.end.t };
  }
  if (!best.ok) ctx.warn(`el empalme a la leva pide ${best.peak.a.toFixed(0)} de aceleración (límite ${limits.aMax.toFixed(0)})`, command);
  ctx.tl.addFunction(start, Infinity, unitFollow(ctx, start, best.tS, best.blend, target));
  return { done: best.tS, note: `en leva desde el segundo ${best.tS.toFixed(2)}` };
};

// Registro con marca: un sensor rápido (TouchProbe) fija la posición del maestro cuando pasa cada marca impresa; el esclavo corrige su fase.
const registration = (ctx, command, start) => {
  const master = masterOf(ctx, command);
  if (!master) return { status: 'error', note: 'sin maestro', done: ctx.tl.end.t };
  const pitch = Math.max(1e-6, Math.abs(finite(command.pitch, 200)));
  const phase = finite(command.markPhase);
  const ratio = finite(command.ratio, 1);
  const limit = Math.max(0, finite(command.correctionLimit, 5));
  const duration = Math.max(0.01, finite(command.duration, 0.4));
  const errors = registrationErrors({ seed: command.seed, jitter: finite(command.jitter), drift: finite(command.drift), count: 400 });
  const firstPos = master.at(start).pos;
  let k = Math.max(0, Math.ceil((firstPos - phase) / pitch));
  let previous = 0;
  let count = 0;
  for (; k < errors.length && count < 400; k += 1, count += 1) {
    const time = master.timeAtPos(phase + k * pitch + errors[k], start);
    if (time == null || time >= ctx.horizon) break;
    const wanted = ratio * (errors[k] - previous);
    const applied = Math.max(-limit, Math.min(limit, wanted));
    const offset = smoothOffset(applied, duration);
    ctx.overlays.push({ t0: time, at: (tau) => offset.at(tau) });
    ctx.events.push({ id: `${command.id}:${k}`, type: 'probe', t0: time, t1: time + duration, status: Math.abs(wanted) > limit + 1e-9 ? 'limited' : 'ok', note: `marca ${k}: error ${errors[k].toFixed(2)}, corrección ${applied.toFixed(2)}` });
    previous += applied / (ratio || 1);
  }
  return { done: start + duration, nonBlocking: true, note: `${count} marcas leídas` };
};

// Bobinador / desbobinador: velocidad angular = velocidad de línea / radio (el radio cambia con el material enrollado); el par = tensión × radio.
const winder = (ctx, command, start) => {
  if (!ctx.rotary) ctx.warn('el bobinador necesita un eje rotativo', command);
  const dt = ctx.env.dt ?? 0.005;
  const master = command.master ? ctx.env.master?.(command.master) : null;
  const core = Math.max(1e-3, finite(command.coreRadius, 40));
  const thickness = Math.max(0, finite(command.thickness, 0.5));
  const unwinder = command.mode === 'unwinder';
  const fixed = finite(command.startRadius, NaN);
  const r0 = Number.isFinite(fixed) && fixed > core ? fixed : unwinder ? core * 2.5 : core;
  const duration = finite(command.duration) > 0 ? finite(command.duration) : ctx.horizon - start;
  const count = Math.max(2, Math.min(200000, Math.round(duration / dt) + 1));
  const x = new Float64Array(count);
  const v = new Float64Array(count);
  const force = new Float64Array(count);
  const first = ctx.tl.at(start);
  x[0] = first.x;
  v[0] = first.v;
  let length = 0;
  for (let i = 1; i < count; i += 1) {
    const time = start + i * dt;
    const line = master ? master.at(time).v : finite(command.lineSpeed, 200);
    const area = (thickness * length) / Math.PI;
    const radius = Math.max(core, Math.sqrt(Math.max(core * core, unwinder ? r0 * r0 - area : r0 * r0 + area)));
    const target = ((line / radius) * 180) / Math.PI; // °/s
    const blend = smoothStep(((i * dt) / 0.3));
    v[i] = first.v + (target - first.v) * blend;
    x[i] = x[i - 1] + ((v[i - 1] + v[i]) / 2) * dt;
    length += (Math.abs(line) + Math.abs(master ? master.at(time - dt).v : line)) / 2 * dt;
    force[i] = (finite(command.tension, 50) * radius) / 1000;
  }
  ctx.tl.addSamples(start, dt, { x, v, force });
  return { done: start + (finite(command.duration) > 0 ? finite(command.duration) : 0.3), note: unwinder ? 'desbobinando' : 'bobinando' };
};

gearOut.passive = false;
phasing.passive = true;
registration.passive = true;

export const syncHandlers = { gearIn, gearOut, phasing, camIn, registration, winder };
export { rampPhases };
