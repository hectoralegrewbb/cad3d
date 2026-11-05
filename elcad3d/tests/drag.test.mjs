import assert from 'node:assert/strict';
import { dragCoefficient, ergunGradient, grainRelaxation, terminalVelocity } from '../src/particles/drag.js';

// 1) velocidad terminal contra valores de tablas (esferas de vidrio en aire, ρ = 2500 kg/m³)
{
  const v1mm = terminalVelocity({ diameter: 1e-3, density: 2500 });
  assert.ok(v1mm > 6.2 && v1mm < 7.4, `1 mm: ${v1mm.toFixed(2)} m/s (tablas: 6,5–7,2)`);
  const v01 = terminalVelocity({ diameter: 1e-4, density: 2500 });
  assert.ok(v01 > 0.45 && v01 < 0.7, `0,1 mm: ${v01.toFixed(2)} m/s (tablas ≈ 0,5–0,6)`);
  // régimen de Stokes puro: coincide con ρp d² g / (18 μ)
  const dust = 2e-5;
  const stokes = (2500 * dust * dust * 9.81) / (18 * 1.81e-5);
  assert.ok(Math.abs(terminalVelocity({ diameter: dust, density: 2500 }) / stokes - 1) < 0.02);
}

// 2) la relajación crece con la velocidad relativa (inercia) y con la presencia de otros granos
{
  const base = { diameter: 5e-4, density: 1600 };
  const slow = grainRelaxation({ ...base, slip: 0.1 });
  const fast = grainRelaxation({ ...base, slip: 10 });
  assert.ok(fast > 5 * slow, 'a mayor velocidad relativa, más arrastre por unidad de masa');
  assert.ok(grainRelaxation({ ...base, slip: 5, porosity: 0.9 }) > grainRelaxation({ ...base, slip: 5, porosity: 1 }), 'ε < 1 aumenta el arrastre (Wen-Yu)');
}

// 3) lecho denso: β reproduce el gradiente de Ergun (ε ∂p/∂x = β·u_intersticial)
{
  const diameter = 1e-3;
  const porosity = 0.4;
  const superficial = 1;
  const interstitial = superficial / porosity;
  const beta = dragCoefficient({ diameter, slip: interstitial, porosity });
  const gradient = (beta * interstitial) / porosity; // dp/dx = β·u_g / ε
  const reference = ergunGradient({ diameter, porosity, superficial });
  assert.ok(Math.abs(gradient / reference - 1) < 0.05, `Ergun: ${gradient.toFixed(0)} contra ${reference.toFixed(0)} Pa/m`);
}

// 4) continuidad en el cambio de modelo (ε = 0,8): sin saltos desmedidos
{
  const above = dragCoefficient({ diameter: 5e-4, slip: 3, porosity: 0.801 });
  const below = dragCoefficient({ diameter: 5e-4, slip: 3, porosity: 0.799 });
  assert.ok(above / below < 3 && below / above < 3, `salto Gidaspow ${above.toFixed(0)} → ${below.toFixed(0)}`);
}

console.log('drag.test OK');
