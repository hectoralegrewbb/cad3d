// Motor de movimiento (solo visual): perfil de velocidad en el tiempo e integración del ángulo. Puro y sin DOM.
export const motorModes = { const: 'Constante', ramp: 'Rampa (acelera y frena)', sine: 'Oscilante (va y vuelve)', steps: 'Escalones (¼, ½, ¾, 1)' };

// Velocidad (rpm, con signo) en el instante t (s).
export function rpmAt(config, t) {
  const rpm = Number(config.rpm) || 0;
  const direction = config.reverse ? -1 : 1;
  const period = Math.max(0.2, Number(config.period) || 6);
  const phase = (t % period) / period;
  switch (config.mode) {
    case 'ramp': return direction * rpm * (phase < 0.5 ? phase * 2 : (1 - phase) * 2);
    case 'sine': return direction * rpm * Math.sin(2 * Math.PI * phase);
    case 'steps': return direction * rpm * (Math.floor(phase * 4) + 1) / 4;
    default: return direction * rpm;
  }
}

// Ángulo acumulado (rad) tras `dt` segundos desde el ángulo `angle`.
export const advance = (angle, rpm, dt) => angle + (rpm * 2 * Math.PI * dt) / 60;

// Eje unitario de un nombre ('x'|'y'|'z') o de un vector.
export function axisVector(axis) {
  if (Array.isArray(axis)) {
    const l = Math.hypot(...axis);
    if (!(l > 1e-9)) throw new Error('El eje de giro no puede ser nulo');
    return axis.map((v) => v / l);
  }
  const table = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  if (!table[axis]) throw new Error(`Eje desconocido: ${axis}`);
  return table[axis];
}

// Rotación de `angle` rad alrededor del eje que pasa por `pivot` (Rodrigues): devuelve la función punto → punto.
export function rotationAbout(axis, pivot, angle) {
  const [kx, ky, kz] = axisVector(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (point) => {
    const v = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
    const dot = kx * v[0] + ky * v[1] + kz * v[2];
    const cross = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
    return [0, 1, 2].map((i) => pivot[i] + v[i] * c + cross[i] * s + [kx, ky, kz][i] * dot * (1 - c));
  };
}
