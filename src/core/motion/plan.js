// Plan de movimiento de la escena: planifica todos los ejes (en orden de dependencia maestro → esclavo) y trayectorias, y los
// «hornea» en muestras uniformes. Después cualquier instante t se evalúa en O(1) (interpolación Hermite), así que la vista previa y la
// simulación de partículas pueden pedir la pose de cada eje en cada cuadro sin volver a planificar.
import { planAxis } from './axisPlanner.js';
import { singleAxisHandlers } from './singleAxis.js';
import { syncHandlers } from './sync.js';
import { buildPath } from './path.js';
import { commandTypes } from './commands.js';

export const motionHandlers = { ...singleAxisHandlers, ...syncHandlers };
export const isMotionAction = (action) => action?.kind === 'axis' || action?.kind === 'path';
export const defaultHorizon = 120;

const mastersOf = (action) => [
  ...(action.motion?.program ?? []).filter((command) => command.master && commandTypes[command.type]?.params.some((param) => param.kind === 'master')).map((command) => command.master),
  ...(action.motion?.source ? [action.motion.source.path] : []),
];

// Muestras horneadas de un eje (x físico, v, a, fuerza) con interpolación y extrapolación a velocidad constante.
function bakeSamples(count, dt, horizon, fill, originAt) {
  const x = new Float64Array(count + 1);
  const v = new Float64Array(count + 1);
  const a = new Float64Array(count + 1);
  const force = new Float64Array(count + 1);
  for (let i = 0; i <= count; i += 1) {
    const s = fill(i * dt);
    x[i] = s.x;
    v[i] = s.v;
    a[i] = s.a ?? 0;
    force[i] = s.force ?? 0;
  }
  const sample = (t) => {
    if (t <= 0) return { x: x[0], v: v[0], a: a[0], force: force[0] };
    if (t >= count * dt) return { x: x[count] + v[count] * (t - count * dt), v: v[count], a: 0, force: force[count] };
    const u = t / dt;
    const i = Math.floor(u);
    const f = u - i;
    const f2 = f * f;
    const f3 = f2 * f;
    const px = (2 * f3 - 3 * f2 + 1) * x[i] + (f3 - 2 * f2 + f) * dt * v[i] + (-2 * f3 + 3 * f2) * x[i + 1] + (f3 - f2) * dt * v[i + 1];
    return { x: px, v: v[i] + (v[i + 1] - v[i]) * f, a: a[i] + (a[i + 1] - a[i]) * f, force: force[i] + (force[i + 1] - force[i]) * f };
  };
  const at = (t) => {
    const s = sample(t);
    return { ...s, pos: s.x - originAt(t) };
  };
  // Primer instante ≥ fromT en que la posición lógica cruza `target`; null si nunca.
  const timeAtPos = (target, fromT = 0) => {
    const first = Math.max(0, Math.min(count - 1, Math.floor(fromT / dt)));
    let previous = x[first] - originAt(first * dt) - target;
    for (let i = first; i < count; i += 1) {
      const current = x[i + 1] - originAt((i + 1) * dt) - target;
      if (previous === 0 && i * dt >= fromT) return i * dt;
      if (previous * current < 0 || current === 0) {
        const f = previous === current ? 0 : previous / (previous - current);
        const time = (i + f) * dt;
        if (time >= fromT - 1e-9) return time;
      }
      previous = current;
    }
    const tail = v[count];
    if (Math.abs(tail) > 1e-9) {
      const time = count * dt + (target - (x[count] - originAt(count * dt))) / tail;
      if (time >= count * dt && time >= fromT) return time;
    }
    return null;
  };
  return { at, timeAtPos, arrays: { x, v, a, force }, dt, count, horizon };
}

export function buildMotionPlan(actions, options = {}) {
  const horizon = Number(options.horizon) > 0 ? Number(options.horizon) : defaultHorizon;
  const dt = Number(options.dt) > 0 ? Number(options.dt) : Math.max(0.002, horizon / 60000);
  const count = Math.ceil(horizon / dt);
  const warnings = [];
  const axes = new Map();
  const paths = new Map();
  const motionActions = actions.filter(isMotionAction);
  const label = (action) => action.name || action.id;
  motionActions.filter((action) => action.kind === 'path').forEach((action) => {
    const path = buildPath(action.motion ?? {});
    path.warnings.forEach((text) => warnings.push(`${label(action)}: ${text}`));
    paths.set(action.id, path);
  });
  const pending = motionActions.filter((action) => action.kind === 'axis');
  const ids = new Set(pending.map((action) => action.id));
  const master = (id) => axes.get(id) ?? null;
  const warnFor = (action) => (text) => warnings.push(text.replace(/^Eje/, label(action)));
  const bakeAction = (action) => {
    const motion = { ...action.motion, label: label(action) };
    const source = motion.source;
    const path = source ? paths.get(source.path) : null;
    if (path) {
      const component = Math.max(0, Math.min(2, Number(source.component) || 0));
      const rows = bakeSamples(count, dt, horizon, (t) => {
        const s = path.at(t);
        return { x: s.pos[component], v: s.vel[component], a: 0 };
      }, () => 0);
      for (let i = 1; i < count; i += 1) rows.arrays.a[i] = (rows.arrays.v[i + 1] - rows.arrays.v[i - 1]) / (2 * dt);
      axes.set(action.id, { id: action.id, motion, ...rows, events: [], referenced: true, programEnd: path.startTime + path.duration, origin: 0 });
      return;
    }
    const plan = planAxis(motion, { handlers: motionHandlers, horizon, dt: Math.min(dt, 0.002), master, warn: warnFor(action) });
    const history = plan.originHistory;
    const originAt = (t) => {
      let origin = 0;
      for (const entry of history) if (entry.t <= t) origin = entry.origin;
      return origin;
    };
    const rows = bakeSamples(count, dt, horizon, (t) => plan.track.at(t), originAt);
    axes.set(action.id, { id: action.id, motion, ...rows, events: plan.events, referenced: plan.referenced, programEnd: plan.programEnd, origin: plan.origin });
  };
  while (pending.length) {
    const index = pending.findIndex((action) => mastersOf(action).every((id) => !ids.has(id) || axes.has(id) || paths.has(id)));
    if (index < 0) {
      pending.forEach((action) => warnings.push(`${label(action)}: ciclo de dependencias entre ejes (maestro ↔ esclavo)`));
      pending.splice(0).forEach(bakeAction);
      break;
    }
    bakeAction(pending.splice(index, 1)[0]);
  }
  return {
    horizon,
    dt,
    warnings,
    axes,
    paths,
    axisState: (id, t) => axes.get(id)?.at(t) ?? null,
    pathState: (id, t) => paths.get(id)?.at(t) ?? null,
    // Series para graficar: { times, x, pos, v, a, force } muestreadas cada `step` segundos hasta `until`.
    series(id, { until = null, step = 0.02 } = {}) {
      const axis = axes.get(id);
      if (!axis) return null;
      const end = until ?? Math.min(horizon, Math.max(1, (axis.programEnd ?? 0) + 1));
      const times = [];
      const out = { times, x: [], pos: [], v: [], a: [], force: [] };
      for (let t = 0; t <= end + 1e-9; t += step) {
        const s = axis.at(t);
        times.push(t);
        out.x.push(s.x);
        out.pos.push(s.pos);
        out.v.push(s.v);
        out.a.push(s.a);
        out.force.push(s.force);
      }
      return out;
    },
  };
}

// Caché: el mismo arreglo de acciones (inmutable entre ediciones) o el mismo contenido reutiliza el plan.
const byArray = new WeakMap();
const bySignature = new Map();
export function getMotionPlan(actions, options = {}) {
  if (!actions.some(isMotionAction)) return null;
  const cached = byArray.get(actions);
  if (cached && !options.horizon) return cached;
  const signature = JSON.stringify([options.horizon ?? null, actions.filter(isMotionAction)]);
  let plan = bySignature.get(signature);
  if (!plan) {
    plan = buildMotionPlan(actions, options);
    bySignature.set(signature, plan);
    if (bySignature.size > 6) bySignature.delete(bySignature.keys().next().value);
  }
  if (!options.horizon) byArray.set(actions, plan);
  return plan;
}
