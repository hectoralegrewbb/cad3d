// Control de par / fuerza (MoveTorque): el eje no sigue una trayectoria sino que recibe una fuerza (lineal, N) o un par (rotativo, N·m)
// que sube con una rampa. La respuesta sale de integrar la dinámica: inercia, fricción viscosa y de Coulomb, carga externa constante,
// un tope elástico opcional (prensado, bobinado contra el rollo) y un límite de velocidad.
// Unidades de posición: mm (lineal) o grados (rotativo). `unitScale` convierte a SI: 1000 mm/m · 180/π °/rad.

export const unitScaleOf = (type) => (type === 'rotary' ? 180 / Math.PI : 1000);

export function simulateTorque(config) {
  const {
    x0 = 0, v0 = 0, duration = 1, dt = 0.001, torque = 0, rampTime = 0.05, velocityLimit = Infinity,
    inertia = 10, viscous = 0, coulomb = 0, loadForce = 0, contact = null, unitScale = 1000,
  } = config;
  const count = Math.max(2, Math.min(300000, Math.round(duration / dt) + 1));
  const x = new Float64Array(count);
  const v = new Float64Array(count);
  const force = new Float64Array(count);
  const direction = Math.sign(torque) || 1;
  const limit = Number.isFinite(velocityLimit) ? Math.abs(velocityLimit) : Infinity;
  const mass = Math.max(1e-9, inertia);
  x[0] = x0;
  v[0] = v0;
  for (let i = 1; i < count; i += 1) {
    const time = (i - 1) * dt;
    const command = torque * (rampTime > 0 ? Math.min(1, time / rampTime) : 1);
    const speedSi = v[i - 1] / unitScale;
    let net = command - viscous * speedSi - loadForce;
    if (contact) {
      const penetration = Math.max(0, (x[i - 1] - contact.pos) * Math.sign(contact.direction ?? direction));
      if (penetration > 0) net -= Math.sign(contact.direction ?? direction) * (contact.stiffness * penetration + (contact.damping ?? 0) * speedSi);
    }
    // Coulomb: se opone al movimiento; en reposo solo cede si la fuerza neta lo vence
    let friction = 0;
    if (Math.abs(v[i - 1]) > 1e-9) friction = coulomb * Math.sign(v[i - 1]);
    else if (Math.abs(net) <= coulomb) friction = net;
    else friction = coulomb * Math.sign(net);
    let accel = ((net - friction) / mass) * unitScale;
    let speed = v[i - 1] + accel * dt;
    // fricción de Coulomb no invierte el sentido por sí sola: si cruza por cero, se detiene
    if (Math.abs(v[i - 1]) > 1e-9 && Math.sign(speed) !== Math.sign(v[i - 1]) && Math.abs(net) <= coulomb) speed = 0;
    if (Math.abs(speed) > limit && Math.sign(speed) === direction) {
      speed = limit * direction;
      accel = 0;
    }
    v[i] = speed;
    x[i] = x[i - 1] + (v[i - 1] + v[i]) * 0.5 * dt;
    force[i] = command;
  }
  force[0] = 0;
  return { dt, x, v, force };
}
