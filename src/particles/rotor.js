// Dinámica de un eje con motor, inercia y fricción (puro, sin DOM). Unidades SI: N·m, kg·m², rad/s.
// J·dω/dt = τmotor − τcarga − τfricción(ω)
//   motor    : par proporcional al error de velocidad, saturado en `torqueMax` (curva de un motor con deslizamiento del 10 %)
//   fricción : Stribeck (estática → Coulomb con transición exponencial) + viscosa b·ω
//   adherencia: si el eje está casi parado y el par neto no supera el estático, queda trabado
// Integración semi-implícita en motor y viscosa (estable aunque J sea chica); el Coulomb se trata con el cruce por cero.

export const defaultRotorParams = () => ({
  inertia: 0.02, // kg·m²
  torqueMax: 5, // N·m
  staticTorque: 0.25, // N·m, par para arrancar un eje parado
  coulombTorque: 0.15, // N·m, par de deslizamiento
  viscous: 0.002, // N·m·s/rad
  stribeckSpeed: 1, // rad/s, velocidad de transición estática → deslizamiento
});

export const createRotor = () => ({ angle: 0, omega: 0, motorTorque: 0, frictionTorque: 0, loadTorque: 0, stuck: true });

export function frictionTorque(params, omega) {
  const speed = Math.abs(omega);
  const sign = omega < 0 ? -1 : 1;
  const stribeck = params.coulombTorque + (params.staticTorque - params.coulombTorque) * Math.exp(-((speed / Math.max(1e-6, params.stribeckSpeed)) ** 2));
  return sign * stribeck + params.viscous * omega;
}

// Avanza `dt` s con velocidad objetivo `targetOmega` (rad/s, 0 = motor apagado) y par de carga `load` (N·m, positivo = frena el sentido +).
export function stepRotor(state, params, targetOmega, load, dt) {
  const J = Math.max(1e-9, params.inertia);
  const tauMax = Math.max(0, params.torqueMax);
  const slip = Math.max(0.5, Math.abs(targetOmega) * 0.1);
  const kp = tauMax / slip; // N·m por rad/s de error
  const driven = tauMax > 0 && targetOmega !== 0;
  const w0 = state.omega;
  const coulomb = (w) => frictionTorque({ ...params, viscous: 0 }, w);
  // adherencia: parado y sin par suficiente → se queda
  const motorAtRest = driven ? Math.max(-tauMax, Math.min(tauMax, kp * (targetOmega - w0))) : 0;
  if (Math.abs(w0) < 1e-4 && Math.abs(motorAtRest - load) <= params.staticTorque) {
    state.omega = 0;
    state.stuck = true;
    state.motorTorque = motorAtRest;
    state.frictionTorque = motorAtRest - load;
    state.loadTorque = load;
    return state;
  }
  state.stuck = false;
  const fc = coulomb(w0 === 0 ? motorAtRest - load : w0);
  // implícito en motor (kp) y viscosa (b)
  const kEff = (driven ? kp : 0) + params.viscous;
  let w1 = (w0 + (dt / J) * ((driven ? kp * targetOmega : 0) - load - fc)) / (1 + (dt / J) * kEff);
  let motor = driven ? kp * (targetOmega - w1) : 0;
  if (Math.abs(motor) > tauMax) {
    // saturado: par constante ±τmax, resto explícito-viscoso
    motor = Math.sign(motor) * tauMax;
    w1 = (w0 + (dt / J) * (motor - load - fc)) / (1 + (dt / J) * params.viscous);
  }
  // cruce por cero: si la fricción invirtió el signo, se frena en seco (adherencia en el próximo paso)
  if (w0 !== 0 && Math.sign(w1) !== Math.sign(w0)) w1 = Math.abs(motor - load) > params.staticTorque ? w1 : 0;
  state.omega = w1;
  state.angle += 0.5 * (w0 + w1) * dt;
  state.motorTorque = motor;
  state.frictionTorque = fc + params.viscous * w1;
  state.loadTorque = load;
  return state;
}
