// Comandos de un solo eje: Jog, Homing, MoveAbsolute, MoveRelative, MoveVelocity, MoveTorque, MoveSuperimposed, Stop y Wait.
// Cada handler recibe (ctx, command, start) del planificador y deja su movimiento en ctx.tl; devuelve { done, status?, note?, nonBlocking? }.
import { makeProfile, normalizeLimits, rampPhases, restMove, smoothOffset } from './profiles.js';
import { simulateTorque, unitScaleOf } from './torque.js';

const eps = 1e-9;
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : fallback);

const skipped = (ctx, command, note) => {
  ctx.warn(note, command);
  return { status: 'error', note, done: ctx.tl.end.t };
};

// Recorre desde el estado final a `x` con un movimiento de reposo a reposo.
function moveTo(ctx, target, limits, kind) {
  const plan = restMove(target - ctx.tl.end.x, limits, kind);
  ctx.tl.addPhases(plan.phases);
  return plan;
}

// ¿Está el eje dentro de los fines de carrera por software? (coordenadas lógicas)
const withinLimits = (motion, position) => (motion.posMin == null || position >= Number(motion.posMin) - 1e-6) && (motion.posMax == null || position <= Number(motion.posMax) + 1e-6);

// Instante (dentro del perfil) en que la posición cruza `target` yendo en `direction`.
function crossingTime(profile, target, direction) {
  const reached = (tau) => (profile.at(tau).p - target) * direction >= 0;
  if (!reached(profile.duration)) return null;
  let low = 0;
  let high = profile.duration;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (reached(mid)) high = mid;
    else low = mid;
  }
  return high;
}

// Avanza a `velocity` hasta cruzar `trigger` (acelerando antes si hace falta). Devuelve el instante del cruce o null si ya estaba pasado.
function runUntil(ctx, trigger, velocity, limits, kind) {
  const tl = ctx.tl;
  const direction = Math.sign(velocity) || 1;
  if ((tl.end.x - trigger) * direction >= 0) return null;
  const ramp = rampPhases(tl.end.v, velocity, limits, kind);
  const probe = makeProfile(ramp, { p: tl.end.x, v: tl.end.v });
  const phases = [...ramp];
  const left = (trigger - probe.end.p) * direction;
  if (left > 0) phases.push({ dt: left / Math.abs(velocity), j: 0, a0: 0 });
  const t0 = tl.end.t;
  const profile = tl.addPhases(phases);
  const shifted = makeProfile(profile.phases, { p: tl.at(t0).x, v: tl.at(t0).v });
  const tau = crossingTime(shifted, trigger, direction);
  return t0 + (tau ?? profile.duration);
}

const jog = (ctx, command) => {
  const { motion, tl } = ctx;
  const speed = Math.min(finite(command.velocity) > 0 ? finite(command.velocity) : motion.vJog, motion.vMax);
  const direction = finite(command.direction, 1) >= 0 ? 1 : -1;
  const limits = ctx.limits({ ...command, velocity: 0 });
  const kind = ctx.kind(command);
  const t0 = tl.end.t;
  const x0 = tl.end.x;
  tl.addPhases(rampPhases(tl.end.v, direction * speed, limits, kind));
  tl.hold(Math.max(0, finite(command.hold, 1)));
  tl.addPhases(rampPhases(tl.end.v, 0, limits, kind));
  if (!ctx.rotary && ctx.state.referenced) {
    const lo = ctx.logical(Math.min(x0, tl.end.x));
    const hi = ctx.logical(Math.max(x0, tl.end.x));
    if (!withinLimits(motion, lo) || !withinLimits(motion, hi)) ctx.warn('el jog supera un fin de carrera por software', command);
  }
  return { done: tl.end.t, note: `${t0.toFixed(2)} s` };
};

const moveVelocity = (ctx, command) => {
  const { tl } = ctx;
  const speed = Math.max(-ctx.motion.vMax, Math.min(ctx.motion.vMax, finite(command.velocity)));
  tl.addPhases(rampPhases(tl.end.v, speed, ctx.limits({ ...command, velocity: 0 }), ctx.kind(command)));
  const reached = tl.end.t;
  const hold = finite(command.hold);
  if (hold > 0) tl.hold(hold);
  return { done: hold > 0 ? tl.end.t : reached, note: 'velocidad alcanzada' };
};

function absoluteDistance(ctx, command) {
  const rotary = ctx.rotary;
  const target = finite(command.position);
  const now = ctx.logical(ctx.tl.end.x);
  if (!rotary) return target - now;
  const modulo = Math.max(1, finite(ctx.motion.modulo, 360));
  const raw = (((target - now) % modulo) + modulo) % modulo; // 0..modulo en sentido +
  if (command.direction === 'positive') return raw;
  if (command.direction === 'negative') return raw === 0 ? 0 : raw - modulo;
  return raw > modulo / 2 ? raw - modulo : raw;
}

function positionMove(ctx, command, distance, limits, kind) {
  const { tl } = ctx;
  ctx.stopToRest(limits, kind);
  const target = tl.end.x + distance;
  if (!ctx.rotary && ctx.state.referenced && !withinLimits(ctx.motion, ctx.logical(target))) return skipped(ctx, command, 'el destino queda fuera de los fines de carrera por software');
  const plan = moveTo(ctx, target, limits, kind);
  const note = plan.reachesCruise ? 'con velocidad crucero' : 'sin crucero (triangular)';
  if (plan.clamped) ctx.warn('perfil triangular limitado por la velocidad máxima: se agregó un tramo de crucero', command);
  return { done: tl.end.t, note };
}

const moveAbsolute = (ctx, command) => {
  if (!ctx.state.referenced) return skipped(ctx, command, 'eje no referenciado: ejecutá Homing antes de MoveAbsolute');
  const limits = ctx.limits(command);
  const kind = ctx.kind(command);
  ctx.stopToRest(limits, kind); // la distancia se mide desde donde queda parado el eje
  return positionMove(ctx, command, absoluteDistance(ctx, command), limits, kind);
};

const moveRelative = (ctx, command) => {
  const limits = ctx.limits(command);
  const kind = ctx.kind(command);
  return positionMove(ctx, command, finite(command.distance), limits, kind);
};

// Corrección superpuesta: se suma a lo que el eje ya esté haciendo y no bloquea al programa.
const moveSuperimposed = (ctx, command, start) => {
  const limits = ctx.limits(command);
  const plan = restMove(finite(command.distance), limits, ctx.kind(command));
  const profile = makeProfile(plan.phases, { p: 0, v: 0 });
  ctx.overlays.push({ t0: start, at: (tau) => profile.at(tau) });
  return { done: start + plan.duration, nonBlocking: true, note: 'sumado al movimiento en curso' };
};

const stop = (ctx, command) => {
  const limits = ctx.limits({ accel: command.accel });
  ctx.stopToRest(limits, ctx.kind(command));
  return { done: ctx.tl.end.t };
};

// Esperar no toca el movimiento: un esclavo enganchado sigue enganchado mientras espera.
const wait = (ctx, command, start) => ({ done: start + Math.max(0, finite(command.duration)) });
wait.passive = true;
moveSuperimposed.passive = true;

// MoveTorque: integra la dinámica con la fuerza/par pedido (prensado, bobinado, apriete).
const moveTorque = (ctx, command, start) => {
  const { tl, motion } = ctx;
  const duration = Math.max(0.01, finite(command.duration, 1));
  const contactRaw = command.contactPos;
  const hasContact = contactRaw !== '' && contactRaw != null && Number.isFinite(Number(contactRaw));
  const direction = Math.sign(finite(command.torque)) || 1;
  const scale = unitScaleOf(motion.type);
  const stiffness = Math.max(0, finite(command.stiffness, 200)); // N/mm o N·m/° (el tope amortigua al 70 % del crítico)
  const sim = simulateTorque({
    x0: tl.end.x,
    v0: tl.end.v,
    duration,
    dt: Math.max(0.0005, Math.min(0.002, duration / 4000)),
    torque: finite(command.torque),
    rampTime: finite(command.rampTime, 0.05),
    velocityLimit: finite(command.velocityLimit) > 0 ? Math.min(finite(command.velocityLimit), motion.vMax) : motion.vMax,
    inertia: motion.inertia,
    viscous: motion.viscous,
    coulomb: motion.coulomb,
    loadForce: motion.loadForce,
    contact: hasContact ? { pos: ctx.physical(Number(contactRaw)), stiffness, damping: 2 * 0.7 * Math.sqrt(stiffness * scale * motion.inertia), direction } : null,
    unitScale: scale,
  });
  tl.addSamples(start, sim.dt, sim);
  return { done: tl.end.t, note: hasContact ? 'empuja contra el tope' : 'sin tope' };
};

// Homing: búsqueda del final de carrera, retroceso lento, marca cero y posicionado exacto. Define el origen lógico del eje.
const home = (ctx, command) => {
  const { tl, motion } = ctx;
  const h = motion.homing ?? {};
  if (h.method === 'direct') {
    ctx.setOrigin(tl.end.x - finite(h.offset), tl.end.t);
    return { done: tl.end.t, note: 'posición asignada' };
  }
  const direction = finite(h.dir, -1) >= 0 ? 1 : -1;
  const kind = motion.profile;
  const search = normalizeLimits({ vMax: Math.max(1e-3, finite(h.searchVel, 100)), aMax: motion.aMax, jerk: motion.jerk });
  const creep = normalizeLimits({ vMax: Math.max(1e-3, finite(h.creepVel, 10)), aMax: motion.aMax, jerk: motion.jerk });
  const switchPos = finite(h.limitPos);
  ctx.stopToRest(search, kind);
  let referenceX;
  if (h.method === 'blockStop') {
    const hit = runUntil(ctx, switchPos, direction * search.vMax, search, kind);
    if (hit != null) {
      tl.truncate(hit);
      tl.impact(0);
    }
    referenceX = tl.end.x - direction * finite(h.backoff, 2);
    moveTo(ctx, referenceX, creep, kind);
  } else {
    const hit = runUntil(ctx, switchPos, direction * search.vMax, search, kind);
    if (hit != null) ctx.stopToRest(search, kind);
    // retroceso lento hasta soltar el final de carrera
    runUntil(ctx, switchPos, -direction * creep.vMax, creep, kind);
    // marca cero del encoder: está a `markDistance` del flanco, del lado libre
    referenceX = h.method === 'switch' ? switchPos : switchPos - direction * Math.max(0, finite(h.markDistance, 2));
    if (h.method !== 'switch') runUntil(ctx, referenceX, -direction * creep.vMax, creep, kind);
    ctx.stopToRest(creep, kind);
    moveTo(ctx, referenceX, creep, kind);
  }
  ctx.setOrigin(referenceX - finite(h.offset), tl.end.t);
  return { done: tl.end.t, note: `origen en ${referenceX.toFixed(2)}` };
};

export const singleAxisHandlers = { jog, home, moveAbsolute, moveRelative, moveVelocity, moveTorque, moveSuperimposed, stop, wait };
export { smoothOffset, eps };
