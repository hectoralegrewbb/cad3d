// Catálogo de motores trifásicos de inducción (4 polos, 50 Hz, valores típicos de catálogo: verificar con la chapa del motor real).
// ratedNm = par nominal (P / ω); el par máximo del motor ronda 2,3 veces el nominal; inertia = del rotor, kg·m².
export const motorCatalog = [
  { id: '0.37', kw: 0.37, rpm: 1370, ratedNm: 2.6, inertia: 0.00055 },
  { id: '0.55', kw: 0.55, rpm: 1380, ratedNm: 3.8, inertia: 0.0009 },
  { id: '0.75', kw: 0.75, rpm: 1390, ratedNm: 5.2, inertia: 0.0012 },
  { id: '1.1', kw: 1.1, rpm: 1400, ratedNm: 7.5, inertia: 0.0026 },
  { id: '1.5', kw: 1.5, rpm: 1410, ratedNm: 10.2, inertia: 0.0035 },
  { id: '2.2', kw: 2.2, rpm: 1420, ratedNm: 14.8, inertia: 0.0058 },
  { id: '3', kw: 3, rpm: 1430, ratedNm: 20, inertia: 0.0088 },
  { id: '4', kw: 4, rpm: 1440, ratedNm: 26.5, inertia: 0.011 },
  { id: '5.5', kw: 5.5, rpm: 1445, ratedNm: 36.3, inertia: 0.0185 },
  { id: '7.5', kw: 7.5, rpm: 1450, ratedNm: 49.4, inertia: 0.025 },
];

export const peakTorqueFactor = 2.3;

export const motorLabel = (motor) => `${motor.kw.toString().replace('.', ',')} kW · ${motor.rpm} rpm · ${motor.ratedNm.toString().replace('.', ',')} N·m`;

// Campos de una acción de giro con dinámica que fija un motor del catálogo. `inertiaLoad` suma la inercia de lo que arrastra.
export function motorPatch(motor, inertiaLoad = 0) {
  return { rpm: motor.rpm, torqueMax: Math.round(motor.ratedNm * peakTorqueFactor * 100) / 100, ratedTorque: motor.ratedNm, inertia: Math.round((motor.inertia + inertiaLoad) * 1e6) / 1e6, motorId: motor.id, dynamics: true };
}
