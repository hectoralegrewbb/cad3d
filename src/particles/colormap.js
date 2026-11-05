// Mapas de color para el plano de corte del aire (puro). Devuelven [r, g, b] 0–255.

// Divergente para presión: azul (negativa) → blanco (0) → rojo (positiva); `t` en [-1, 1].
export function pressureColor(t) {
  const u = Math.max(-1, Math.min(1, t));
  const a = Math.abs(u);
  const white = 245;
  if (u >= 0) return [white, Math.round(white - a * 190), Math.round(white - a * 215)];
  return [Math.round(white - a * 205), Math.round(white - a * 130), white];
}

// Secuencial para velocidad: azul oscuro → turquesa → amarillo; `t` en [0, 1].
export function speedColor(t) {
  const u = Math.max(0, Math.min(1, t));
  const stops = [[20, 25, 90], [30, 140, 190], [250, 235, 90]];
  const f = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const m = f - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * m));
}

// Pixeles RGBA (Uint8ClampedArray) de un corte {nx, ny, pressure, speed, mask}; fuera del aire alfa 0.
export function sliceToRgba(slice, mode) {
  const out = new Uint8ClampedArray(slice.nx * slice.ny * 4);
  const pMax = Math.max(1e-6, slice.pMax);
  const sMax = Math.max(1e-6, slice.sMax);
  for (let i = 0; i < slice.nx * slice.ny; i += 1) {
    if (!slice.mask[i]) continue;
    const [r, g, b] = mode === 'velocidad' ? speedColor(slice.speed[i] / sMax) : pressureColor(slice.pressure[i] / pMax);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 230;
  }
  return out;
}
