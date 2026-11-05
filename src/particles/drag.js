// Arrastre aire-grano (puro, SI): rapidez con que un grano relaja su velocidad hacia la del aire.
//  · Fase diluida (ε ≥ 0,8): Stokes corregido por inercia (Schiller-Naumann) y por presencia de otros granos (Wen-Yu, ε^−2,65).
//  · Fase densa (ε < 0,8): Ergun (lecho empacado), que reproduce la caída de presión de un tapón de granos.
// Es el modelo de Gidaspow, el estándar en transporte neumático. `diameter` es el del grano REAL (no el radio numérico del
// simulador): la física del arrastre depende del grano verdadero aunque cada partícula simulada represente a muchos.

export const air = { density: 1.2, viscosity: 1.81e-5 };

// Coeficiente β (kg/(m³·s)): fuerza de arrastre por volumen de mezcla y por unidad de velocidad relativa.
export function dragCoefficient({ diameter, slip, porosity = 1, gasDensity = air.density, viscosity = air.viscosity }) {
  const eps = Math.min(1, Math.max(0.3, porosity));
  const alpha = 1 - eps;
  const speed = Math.max(slip, 0);
  if (eps >= 0.8) {
    const re = (gasDensity * diameter * speed * eps) / viscosity;
    const f = re < 1000 ? 1 + 0.15 * re ** 0.687 : 0.0183 * re;
    // β = ρp·α·k con k = (18 μ / (ρp d²)) · f · ε^−2,65 → β = 18 μ α f ε^−2,65 / d²
    return (18 * viscosity * Math.max(alpha, 1e-9) * f * eps ** -2.65) / (diameter * diameter);
  }
  return (150 * alpha * alpha * viscosity) / (eps * diameter * diameter) + (1.75 * alpha * gasDensity * speed) / diameter;
}

// Rapidez de relajación k (1/s) de un grano de densidad `density` (kg/m³): a = k·(u_aire − u_grano).
// Versión posicional y sin objetos: se llama por grano y por subpaso.
export function relaxation(diameter, density, slip, porosity = 1, gasDensity = air.density, viscosity = air.viscosity) {
  const eps = porosity > 1 ? 1 : porosity < 0.3 ? 0.3 : porosity;
  const alpha = 1 - eps;
  if (alpha < 1e-6) {
    const re = (gasDensity * diameter * (slip > 0 ? slip : 0)) / viscosity;
    const f = re < 1000 ? 1 + 0.15 * re ** 0.687 : 0.0183 * re;
    return ((18 * viscosity) / (density * diameter * diameter)) * f;
  }
  return dragCoefficient({ diameter, slip, porosity: eps, gasDensity, viscosity }) / (density * alpha);
}

export const grainRelaxation = ({ diameter, density, slip, porosity = 1, gasDensity = air.density, viscosity = air.viscosity }) => relaxation(diameter, density, slip, porosity, gasDensity, viscosity);

// Velocidad terminal de un grano aislado en aire quieto (bisección sobre k(v)·v = g). Para validar contra tablas.
export function terminalVelocity({ diameter, density, gravity = 9.81 }) {
  let lo = 1e-6;
  let hi = 200;
  for (let n = 0; n < 80; n += 1) {
    const mid = 0.5 * (lo + hi);
    const decel = grainRelaxation({ diameter, density, slip: mid }) * mid;
    if (decel < gravity) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Gradiente de presión (Pa/m) de un lecho fijo con velocidad superficial U (m/s): Ergun. Referencia para el tapón.
export function ergunGradient({ diameter, porosity, superficial, gasDensity = air.density, viscosity = air.viscosity }) {
  const alpha = 1 - porosity;
  return (150 * alpha * alpha * viscosity * superficial) / (porosity ** 3 * diameter * diameter) + (1.75 * alpha * gasDensity * superficial * superficial) / (porosity ** 3 * diameter);
}
