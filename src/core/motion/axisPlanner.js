// Planificador de un eje: recorre el programa (lista de comandos) y arma su línea de tiempo. Cada tipo de comando lo resuelve un
// «handler» registrado (singleAxis.js, sync.js): el planificador no conoce los tipos (abierto a nuevos comandos sin tocarlo).
import { Timeline, trackOf } from './timeline.js';
import { rampPhases } from './profiles.js';
import { limitsFor, profileOf } from './commands.js';

const eps = 1e-9;
const maxIterations = 2000;

export function planAxis(motion, env) {
  const { handlers, horizon = 60, warn = () => {} } = env;
  const t0 = Number(motion.startTime) || 0;
  const tl = new Timeline({ t: t0, x: Number(motion.startPos) || 0 });
  const overlays = [];
  const events = [];
  const state = { referenced: motion.referenced !== false, origin: motion.referenced !== false ? 0 : null, originHistory: [{ t: -Infinity, origin: 0 }] };
  const ctx = {
    motion,
    env,
    tl,
    overlays,
    events,
    state,
    horizon,
    rotary: motion.type === 'rotary',
    limits: (command) => limitsFor(motion, command),
    kind: (command) => profileOf(motion, command),
    // Fija el origen lógico (Homing): desde ese instante la posición lógica es física − origen.
    setOrigin(origin, t) {
      state.origin = origin;
      state.referenced = true;
      state.originHistory.push({ t, origin });
    },
    logical: (x) => x - (state.origin ?? 0),
    physical: (p) => p + (state.origin ?? 0),
    warn: (text, command) => warn(`${motion.label ?? 'Eje'}: ${command?.type ? `${command.type}: ` : ''}${text}`),
    // Frena hasta el reposo si el eje está en marcha. Devuelve true si tuvo que frenar.
    stopToRest(limits, kind) {
      const speed = tl.end.v;
      if (Math.abs(speed) < eps) return false;
      tl.addPhases(rampPhases(speed, 0, limits, kind));
      return true;
    },
  };
  const expanded = [];
  const loops = Number(motion.repeat) === 0 ? maxIterations : Math.max(1, Math.round(Number(motion.repeat) || 1));
  let lastDone = t0;
  let lastStart = t0;
  let guard = 0;
  for (let round = 0; round < loops && guard < maxIterations; round += 1) {
    const roundStart = lastDone;
    expanded.length = 0;
    expanded.push(...(motion.program ?? []));
    if (!expanded.length) break;
    for (const command of expanded) {
      guard += 1;
      const handler = handlers[command.type];
      if (!handler) {
        ctx.warn('comando no soportado', command);
        continue;
      }
      const spec = command.start ?? { type: 'after', delay: 0 };
      const delay = Number(spec.delay) || 0;
      let start;
      if (spec.type === 'time') {
        const wanted = (Number(spec.t) || 0) + (Number(motion.repeat) === 0 || loops > 1 ? roundStart - t0 : 0);
        start = spec.interrupt === 'wait' ? Math.max(wanted, lastDone) : wanted;
      } else if (spec.type === 'with') start = lastStart + delay;
      else start = lastDone + delay;
      start = Math.max(start, t0);
      if (start >= horizon) break;
      if (!handler.passive) {
        if (start < tl.end.t - eps) tl.truncate(start); // el comando nuevo interrumpe lo que esté en marcha
        else tl.advanceTo(start);
      }
      const result = handler(ctx, command, start) ?? {};
      const done = result.done ?? tl.end.t;
      events.push({ id: command.id, type: command.type, t0: start, t1: Math.min(done, horizon), status: result.status ?? 'ok', note: result.note ?? '' });
      lastStart = start;
      if (!result.nonBlocking) lastDone = Math.max(start, done);
      if (lastDone >= horizon) break;
    }
    if (lastDone <= roundStart + eps && loops > 1) break; // una vuelta sin tiempo: no hay nada que repetir
    if (lastDone >= horizon) break;
  }
  return { track: trackOf(tl, overlays), events, referenced: state.referenced, origin: state.origin ?? 0, originHistory: state.originHistory, end: tl.end, programEnd: lastDone };
}
