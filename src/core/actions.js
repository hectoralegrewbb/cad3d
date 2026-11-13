// Acciones: movimientos y eventos programados sobre operaciones (Pieza) o instancias (Conjunto). Puro, sin DOM ni kernel.
// kind 'rotate': gira alrededor de un eje por un pivote — continuo (rpm) o barrido de `from` a `to` grados en `duration` s (clapeta).
// kind 'slide' : desplaza sobre un eje de `from` a `to` mm en `duration` s (guillotina, válvula de corredera).
// mode 'valve' (slide y rotate): ciclo temporizado cerrada → abre (`openTime`) → queda abierta (`holdOpen`; 0 = queda abierta) → cierra (`closeTime`)
//   → cerrada (`closedHold`) y repite si `loop` = 'loop'. `from` es la posición cerrada y `to` la abierta.
// kind 'vibrate': oscila sobre un vector (con ángulo de lanzamiento) con amplitud `amp` mm y frecuencia `freq` Hz (canal vibratorio).
// kind 'air'   : lleva una boquilla al nivel `level` (0–1) en `duration` s (soplador que arranca o se corta).
// kind 'axis'  : eje de movimiento (Motion): perfil trapezoidal / triangular / curva en S y un programa de comandos (Jog, Homing, MoveAbsolute,
//   MoveRelative, MoveVelocity, MoveTorque, MoveSuperimposed, GearIn, Phasing, CamIn…). Ver core/motion. `motion.startPos` = posición donde está modelada la pieza.
// kind 'path'  : trayectoria interpolada (líneas, arcos, hélices, con blending) que mueven los ejes que la tengan como `motion.source`.
// Disparo (`start`): en un instante, después de otra acción, o cuando salieron N partículas. Los ejes y trayectorias se disparan con `motion.startTime`.

import { defaultMotion, defaultPathMotion, getMotionPlan, validateMotion } from './motion/index.js';

export const actionKinds = { rotate: 'Girar', slide: 'Deslizar', vibrate: 'Vibrar', air: 'Aire (boquilla)', axis: 'Eje de movimiento (Motion)', path: 'Trayectoria interpolada' };
export const startKinds = { time: 'En el segundo…', after: 'Al terminar otra acción', exited: 'Cuando salieron N partículas',
  zone: 'Cuando hay N partículas en un sensor' };
export const loopKinds = { once: 'Una vez', loop: 'Repetir', pingpong: 'Ida y vuelta' };
export const axisVectors = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export const defaultAction = (kind = 'slide', patch = {}) => ({
  name: '',
  kind,
  targets: [],
  axis: kind === 'rotate' ? 'x' : kind === 'vibrate' ? [0.866, 0, 0.5] : kind === 'axis' ? (patch.motion?.type === 'rotary' ? 'z' : 'x') : 'z',
  motion: kind === 'axis' ? defaultMotion(patch.motion?.type ?? 'linear', patch.motion) : kind === 'path' ? defaultPathMotion(patch.motion) : undefined,
  amp: 2,
  freq: 25,
  pivot: [0, 0, 0],
  mode: 'sweep', // rotate: 'continuous' | 'sweep'
  rpm: 60,
  from: 0,
  to: kind === 'rotate' ? 90 : 20,
  duration: 1,
  openTime: 1, // válvula: s que tarda en abrir
  holdOpen: 2, // válvula: s que queda abierta (0 = queda abierta para siempre)
  closeTime: 1, // válvula: s que tarda en cerrar
  closedHold: 0, // válvula con repetición: s cerrada entre ciclos
  level: 1,
  speed: 200, // slide en modo cinta: velocidad de la superficie, mm/s
  nozzle: null,
  start: { type: 'time', t: 0, action: null, delay: 0, n: 100, sensor: null, rearm: false },
  loop: 'once',
  // rotate continuo con dinámica real: el eje tiene inercia, motor con par máximo y fricción; la carga sale de los granos
  dynamics: false,
  inertia: 0.02, // kg·m²
  torqueMax: 5, // N·m
  staticTorque: 0.25, // N·m
  coulombTorque: 0.15, // N·m
  viscous: 0.002, // N·m·s/rad
  stribeckSpeed: 1, // rad/s
  ratedTorque: 0, // N·m nominales del motor elegido del catálogo (0 = sin dato): se usa para el % de carga
  motorId: '',
  // Transmisión: con mode 'follow' el eje (o el carro, si es Deslizar) sigue a otra acción de giro.
  link: { master: null, type: 'directa', a: 1, b: 1, ratio: 1, eff: 0.95, inertia: 0, pitch: 100 },
  ...patch,
});

export const linkTypes = { directa: 'Directa (1:1)', reductor: 'Reductor (i : 1)', correa: 'Correa / cadena (motriz → conducida)', engranaje: 'Engranaje externo (invierte el giro)', manual: 'Relación manual' };

// Relación salida/entrada de una transmisión: reductor i:1 → 1/i; correa/cadena → Dm/Dc (o z1/z2); engranaje externo → −z1/z2.
export const linkRatio = (link = {}) => {
  const a = Number(link.a);
  const b = Number(link.b);
  switch (link.type) {
    case 'reductor': return a > 0 ? 1 / a : 0;
    case 'correa': return b > 0 ? a / b : 0;
    case 'engranaje': return b > 0 ? -a / b : 0;
    case 'manual': return Number(link.ratio) || 0;
    default: return 1;
  }
};

export const rotorParamsOf = (action) => ({
  inertia: Number(action.inertia) > 0 ? Number(action.inertia) : 0.02,
  torqueMax: Math.max(0, Number(action.torqueMax) || 0),
  staticTorque: Math.max(0, Number(action.staticTorque) || 0),
  coulombTorque: Math.max(0, Number(action.coulombTorque) || 0),
  viscous: Math.max(0, Number(action.viscous) || 0),
  stribeckSpeed: Number(action.stribeckSpeed) > 0 ? Number(action.stribeckSpeed) : 1,
  rated: Math.max(0, Number(action.ratedTorque) || 0),
});

export const axisOf = (axis) => (Array.isArray(axis) ? axis : axisVectors[axis] ?? axisVectors.z);

export const bodyKey = (targets) => [...targets].sort().join('+');

// Suavizado de arranque/frenado (la clapeta no salta de golpe).
const smooth = (u) => u * u * (3 - 2 * u);
const smoothSlope = (u) => 6 * u * (1 - u);

// Cuánto dura una acción desde que arranca hasta que termina (s); null si no termina (continua, vibración o válvula repetida).
export function actionSpan(action) {
  if (action.kind === 'vibrate' || (action.kind === 'rotate' && action.mode === 'continuous')) return null;
  if (action.mode === 'valve') {
    const open = Math.max(1e-3, Number(action.openTime) || 0);
    const hold = Math.max(0, Number(action.holdOpen) || 0);
    if (hold === 0) return open; // queda abierta: el movimiento termina al abrir
    if (action.loop === 'loop') return null;
    return open + hold + Math.max(1e-3, Number(action.closeTime) || 0);
  }
  return Math.max(0, Number(action.duration) || 0);
}

// Instante de arranque de cada acción (null = todavía no disparada). ctx.exitTime(n) devuelve cuándo salió la partícula n (o null).
export function resolveStarts(actions, ctx = {}) {
  const starts = new Map();
  const seen = new Set();
  const resolve = (action) => {
    if (starts.has(action.id)) return starts.get(action.id);
    if (seen.has(action.id)) return null; // ciclo: nunca arranca
    seen.add(action.id);
    const start = action.start ?? { type: 'time', t: 0 };
    let value = null;
    if (start.type === 'time') value = Number(start.t) || 0;
    else if (start.type === 'exited') {
      const at = ctx.exitTime?.(Number(start.n) || 1);
      value = at == null ? null : at + (Number(start.delay) || 0);
    } else if (start.type === 'zone') {
      const at = start.sensor ? ctx.zoneTime?.(start.sensor, Number(start.n) || 1, !!start.rearm) : null;
      value = at == null ? null : at + (Number(start.delay) || 0);
    } else if (start.type === 'after') {
      const previous = actions.find((item) => item.id === start.action);
      const base = previous ? resolve(previous) : null;
      if (base !== null && previous) {
        const span = actionSpan(previous);
        value = span === null ? base : base + span + (Number(start.delay) || 0);
      }
    }
    starts.set(action.id, value);
    return value;
  };
  actions.forEach(resolve);
  return starts;
}

// Válvula: progreso 0 (cerrada) .. 1 (abierta) y su pendiente por segundo. Cada recorrido se suaviza (arranca y frena sin saltos).
function valve(action, t, start) {
  if (start === null || t <= start) return { u: 0, du: 0 };
  const open = Math.max(1e-3, Number(action.openTime) || 0);
  const hold = Math.max(0, Number(action.holdOpen) || 0);
  const close = Math.max(1e-3, Number(action.closeTime) || 0);
  const gap = Math.max(0, Number(action.closedHold) || 0);
  let tau = t - start;
  if (hold === 0) { const p = Math.min(1, tau / open); return { u: smooth(p), du: tau < open ? smoothSlope(p) / open : 0 }; } // abre y se queda abierta
  const cycle = open + hold + close + gap;
  if (action.loop === 'loop') tau %= cycle;
  else if (tau >= open + hold + close) return { u: 0, du: 0 };
  if (tau < open) return { u: smooth(tau / open), du: smoothSlope(tau / open) / open };
  if (tau < open + hold) return { u: 1, du: 0 };
  if (tau < open + hold + close) { const p = (tau - open - hold) / close; return { u: 1 - smooth(p), du: -smoothSlope(p) / close }; }
  return { u: 0, du: 0 };
}

// Progreso 0..1 (y su pendiente por segundo, con signo) de un barrido en el instante t.
function sweep(action, t, start) {
  if (action.mode === 'valve') return valve(action, t, start);
  const duration = Math.max(1e-6, Number(action.duration) || 1);
  if (start === null || t <= start) return { u: 0, du: 0 };
  const tau = t - start;
  const loop = action.loop ?? 'once';
  let phase;
  let sign = 1;
  if (loop === 'once') phase = Math.min(1, tau / duration);
  else if (loop === 'loop') phase = (tau / duration) % 1;
  else {
    const cycle = (tau / duration) % 2;
    phase = cycle <= 1 ? cycle : 2 - cycle;
    sign = cycle <= 1 ? 1 : -1;
  }
  const moving = loop !== 'once' || tau < duration;
  return { u: smooth(phase), du: moving ? (sign * smoothSlope(phase)) / duration : 0 };
}

const unitOf = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
};

// Desplazamiento (mm) y velocidad de un eje lineal respecto de su posición modelada, más lo que le aportan los ejes que lo transportan.
function linearMotion(action, plan, t, depth = 0) {
  const zero = { offset: [0, 0, 0], vel: [0, 0, 0] };
  const state = plan?.axisState(action.id, t);
  if (!state || action.motion?.type === 'rotary' || depth > 8) return zero;
  const k = unitOf(axisOf(action.axis));
  const d = state.x - (Number(action.motion.startPos) || 0);
  return { offset: k.map((v) => v * d), vel: k.map((v) => v * state.v) };
}

function carriedMotion(action, plan, t, actions, depth = 0) {
  const total = { offset: [0, 0, 0], vel: [0, 0, 0] };
  if (depth > 8) return total;
  (action.motion?.carriedBy ?? []).forEach((id) => {
    const parent = actions.find((item) => item.id === id && item.kind === 'axis');
    if (!parent) return;
    const own = linearMotion(parent, plan, t);
    const inherited = carriedMotion(parent, plan, t, actions, depth + 1);
    for (let i = 0; i < 3; i += 1) {
      total.offset[i] += own.offset[i] + inherited.offset[i];
      total.vel[i] += own.vel[i] + inherited.vel[i];
    }
  });
  return total;
}

// Pose de un eje de movimiento: lineal → desplazamiento a lo largo de su dirección; rotativo → giro alrededor de su eje y pivote.
function applyAxis(body, action, plan, t, actions) {
  const state = plan?.axisState(action.id, t);
  if (!state) return;
  const d = state.x - (Number(action.motion.startPos) || 0);
  if (action.motion.type === 'rotary') {
    body.axis = axisOf(action.axis);
    body.pivot = action.pivot ?? [0, 0, 0];
    body.angle += (d * Math.PI) / 180;
    body.omega += (state.v * Math.PI) / 180;
    return;
  }
  const own = linearMotion(action, plan, t);
  const carried = carriedMotion(action, plan, t, actions);
  for (let i = 0; i < 3; i += 1) {
    body.offset[i] += own.offset[i] + carried.offset[i];
    body.vel[i] += own.vel[i] + carried.vel[i];
  }
}

// Cuerpos (grupos de targets) con su pose en el instante t y niveles de aire por boquilla.
export function evaluateActions(actions, t, ctx = {}) {
  const starts = resolveStarts(actions, ctx);
  const plan = getMotionPlan(actions);
  const bodies = new Map();
  const nozzles = {};
  const contrib = {}; // acción de giro → { angle, omega } que aporta (los seguidores lo usan)
  const pending = []; // seguidores (mode 'follow') a resolver cuando su maestro esté listo
  actions.forEach((action) => {
    const start = starts.get(action.id) ?? null;
    if (action.kind === 'air') {
      if (!action.nozzle) return;
      const { u } = sweep({ ...action, loop: 'once' }, t, start);
      if (start !== null && t > start) nozzles[action.nozzle] = u * (Number(action.level) || 0); // la última acción disparada manda
      return;
    }
    if (action.kind === 'path' || !action.targets?.length) return;
    const key = bodyKey(action.targets);
    if (!bodies.has(key)) bodies.set(key, { key, targets: [...action.targets], axis: [0, 0, 1], pivot: [0, 0, 0], angle: 0, omega: 0, offset: [0, 0, 0], vel: [0, 0, 0], surf: [0, 0, 0], rotor: null });
    const body = bodies.get(key);
    if (action.kind === 'axis') {
      applyAxis(body, action, plan, t, actions);
      return;
    }
    if (action.kind === 'rotate') {
      body.axis = axisOf(action.axis);
      body.pivot = action.pivot ?? [0, 0, 0];
      if (action.mode === 'follow') {
        pending.push({ action, body });
        return;
      }
      contrib[action.id] = { angle: 0, omega: 0 };
      if (action.mode === 'continuous' && action.dynamics) {
        // el ángulo lo integra la simulación (ParticleSim.advanceRotors); acá solo se declara el motor y su objetivo
        const started = start !== null && t > start;
        body.rotor = { id: action.id, params: rotorParamsOf(action), target: started ? ((Number(action.rpm) || 0) * 2 * Math.PI) / 60 : 0 };
        return;
      }
      if (start === null || t <= start) return;
      if (action.mode === 'continuous') {
        const omega = ((Number(action.rpm) || 0) * 2 * Math.PI) / 60;
        body.angle += omega * (t - start);
        body.omega += omega;
        contrib[action.id] = { angle: omega * (t - start), omega };
      } else {
        const { u, du } = sweep(action, t, start);
        const from = ((Number(action.from) || 0) * Math.PI) / 180;
        const to = ((Number(action.to) || 0) * Math.PI) / 180;
        body.angle += from + (to - from) * u;
        body.omega += (to - from) * du;
        contrib[action.id] = { angle: from + (to - from) * u, omega: (to - from) * du };
      }
    } else if (action.kind === 'vibrate') {
      if (start === null || t <= start) return;
      const raw = axisOf(action.axis);
      const length = Math.hypot(...raw) || 1;
      const k = raw.map((v) => v / length);
      const w = 2 * Math.PI * Math.max(0, Number(action.freq) || 0);
      const amp = Number(action.amp) || 0;
      const tau = t - start;
      const ramp = smooth(Math.min(1, tau / 0.3)); // arranque suave (0,3 s)
      const distance = amp * Math.sin(w * tau) * ramp;
      const speed = amp * w * Math.cos(w * tau) * ramp;
      for (let i = 0; i < 3; i += 1) {
        body.offset[i] += k[i] * distance;
        body.vel[i] += k[i] * speed;
      }
    } else if (action.kind === 'slide' && (action.mode === 'follow' || (action.mode === 'belt' && action.link?.master))) {
      pending.push({ action, body });
    } else if (action.kind === 'slide' && action.mode === 'belt') {
      // cinta transportadora: el cuerpo no se mueve, su superficie arrastra lo que apoya (arranque suave de 0,5 s)
      if (start === null || t <= start) return;
      const k = axisOf(action.axis);
      const speed = (Number(action.speed) || 0) * smooth(Math.min(1, (t - start) / 0.5));
      for (let i = 0; i < 3; i += 1) body.surf[i] += k[i] * speed;
    } else if (action.kind === 'slide') {
      const k = axisOf(action.axis);
      const from = Number(action.from) || 0;
      const to = Number(action.to) || 0;
      const { u, du } = start === null || t <= start ? { u: 0, du: 0 } : sweep(action, t, start);
      const distance = from + (to - from) * u;
      const speed = (to - from) * du;
      for (let i = 0; i < 3; i += 1) {
        body.offset[i] += k[i] * distance;
        body.vel[i] += k[i] * speed;
      }
    }
  });
  // Seguidores: el ángulo (o el recorrido) sale del maestro por la relación de transmisión; se resuelven en cadena (A → B → C).
  const links = [];
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i += 1) {
      const { action, body } = pending[i];
      const link = action.link ?? {};
      const master = contrib[link.master];
      if (!actions.some((item) => item.id === link.master && item.kind === 'rotate')) {
        pending.splice(i, 1); // sin maestro válido: queda quieto
        i -= 1;
        continue;
      }
      if (!master) continue;
      if (action.kind === 'rotate') {
        const ratio = linkRatio(link);
        body.angle += ratio * master.angle;
        body.omega += ratio * master.omega;
        contrib[action.id] = { angle: ratio * master.angle, omega: ratio * master.omega };
        links.push({ id: action.id, key: body.key, kind: 'rotate', master: link.master, ratio, eff: Math.max(0.05, Math.min(1, Number(link.eff) || 1)), inertia: Math.max(0, Number(link.inertia) || 0) });
      } else {
        const k = axisOf(action.axis);
        const perRad = (Number(link.pitch) || 0) / (2 * Math.PI); // mm de recorrido por radian del maestro
        const belt = action.mode === 'belt';
        for (let c = 0; c < 3; c += 1) {
          if (belt) body.surf[c] += k[c] * perRad * master.omega;
          else {
            body.offset[c] += k[c] * perRad * master.angle;
            body.vel[c] += k[c] * perRad * master.omega;
          }
        }
        links.push({ id: action.id, key: body.key, kind: 'slide', belt, master: link.master, ratio: perRad, axis: k, eff: 1, inertia: 0 });
      }
      pending.splice(i, 1);
      i -= 1;
      progress = true;
    }
  }
  return { bodies: [...bodies.values()], nozzles, contrib, links };
}

// Avisos de configuración (se muestran en el panel; no impiden simular).
export function validateActions(actions, { targetIds = null, nozzleIds = null, sensorIds = null } = {}) {
  const warnings = [];
  const owners = new Map();
  getMotionPlan(actions)?.warnings.forEach((text) => warnings.push(text));
  actions.forEach((action) => {
    const label = action.name || action.id;
    if (action.kind === 'path') return;
    if (action.kind === 'axis') warnings.push(...validateMotion(action, actions).filter((text) => !text.includes('no tiene nada tildado')));
    if (action.kind === 'air') {
      if (!action.nozzle || (nozzleIds && !nozzleIds.includes(action.nozzle))) warnings.push(`${label}: elegí una boquilla`);
      return;
    }
    if (!action.targets?.length) warnings.push(`${label}: no tiene nada tildado para mover`);
    action.targets?.forEach((id) => {
      if (targetIds && !targetIds.includes(id)) warnings.push(`${label}: "${id}" ya no existe`);
      const key = owners.get(id);
      if (key && key !== bodyKey(action.targets)) warnings.push(`${label}: "${id}" está en otra acción con distintos elementos (usá la misma selección)`);
      owners.set(id, bodyKey(action.targets));
    });
    if (action.mode === 'follow') {
      const master = actions.find((item) => item.id === action.link?.master);
      if (!master || master.kind !== 'rotate') warnings.push(`${label}: elegí el eje que lo mueve (una acción de giro)`);
      else if (master.id === action.id) warnings.push(`${label}: no puede seguirse a sí mismo`);
    }
    if (action.start?.type === 'zone' && (!action.start.sensor || (sensorIds && !sensorIds.includes(action.start.sensor)))) warnings.push(`${label}: elegí un sensor para el disparo`);
    if (action.start?.type === 'after' && !actions.some((item) => item.id === action.start.action)) warnings.push(`${label}: la acción previa no existe`);
  });
  return warnings;
}

// Quita de las demás acciones lo que apuntaba a la acción `id` (maestro, eje transportador, trayectoria).
export const detachMotionRefs = (actions, id) => actions.map((action) => {
  if (action.kind !== 'axis') return action;
  const motion = action.motion;
  const uses = (motion.carriedBy ?? []).includes(id) || motion.source?.path === id || (motion.program ?? []).some((command) => command.master === id);
  if (!uses) return action;
  return {
    ...action,
    motion: {
      ...motion,
      carriedBy: (motion.carriedBy ?? []).filter((item) => item !== id),
      source: motion.source?.path === id ? null : motion.source,
      program: (motion.program ?? []).map((command) => (command.master === id ? { ...command, master: '' } : command)),
    },
  };
});

// Quita referencias a elementos o boquillas borrados.
export function pruneActions(actions, { targetIds, nozzleIds, sensorIds = null }) {
  const ids = new Set(targetIds);
  return actions.map((action) => ({
    ...action,
    targets: (action.targets ?? []).filter((id) => ids.has(id)),
    nozzle: action.nozzle && nozzleIds.includes(action.nozzle) ? action.nozzle : null,
    start: sensorIds && action.start?.type === 'zone' && !sensorIds.includes(action.start.sensor) ? { ...action.start, sensor: null } : action.start,
  }));
}
