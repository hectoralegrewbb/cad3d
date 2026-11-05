import assert from 'node:assert/strict';
import { AirSolver } from '../src/particles/airSolver.js';
import { pressureColor, speedColor, sliceToRgba } from '../src/particles/colormap.js';

// Tubo de 30 mm de radio con una garganta de 15 mm: el corte longitudinal debe mostrar el aire dentro del tubo y la pared como máscara.
const L = 200;
const radiusOf = (x) => (x < 60 ? 30 : x < 100 ? 30 - (15 * (x - 60)) / 40 : x < 130 ? 15 : 15 + (15 * (x - 130)) / 70);
const solver = new AirSolver({ lo: [-20, -45, -45], hi: [L + 20, 45, 45], bodies: [{ distance: (x, y, z) => Math.max(Math.max(-x, x - L), radiusOf(Math.min(L, Math.max(0, x))) - Math.hypot(y, z)) }], cells: 30000 });
solver.setInlets([{ pos: [15, 0, 0], dir: [1, 0, 0], radius: 30, flow: 8 * Math.PI * 0.03 ** 2 }]);
solver.solveSteady({ maxSteps: 600, tolerance: 6e-3 });

const slice = solver.sliceField(2, 0.5, 80); // plano ⟂ Z por el eje: ejes (x, y)
assert.equal(slice.axis, 2);
assert.equal(slice.nx * slice.ny, slice.pressure.length);
assert.ok(slice.size[0] > L && slice.size[1] > 80, 'cubre el dominio');
let air = 0;
for (const m of slice.mask) air += m;
const share = air / slice.mask.length;
assert.ok(share > 0.1 && share < 0.7, `el aire ocupa el tubo y no el sólido: ${share.toFixed(2)}`);
// la velocidad en la garganta (centro) supera a la de la entrada: la máscara y el campo están alineados con el eje del tubo
const at = (x, y) => Math.floor(((y - slice.lo[1]) / slice.size[1]) * slice.ny) * slice.nx + Math.floor(((x - slice.lo[0]) / slice.size[0]) * slice.nx);
assert.ok(slice.mask[at(110, 0)] && slice.mask[at(30, 0)], 'el eje está en el aire');
assert.ok(!slice.mask[at(110, 40)], 'fuera del tubo es sólido');
assert.ok(slice.speed[at(110, 0)] > 1.5 * slice.speed[at(30, 0)], `garganta más rápida: ${slice.speed[at(110, 0)].toFixed(1)} vs ${slice.speed[at(30, 0)].toFixed(1)}`);
assert.ok(slice.pressure[at(110, 0)] < slice.pressure[at(30, 0)], 'la presión baja en la garganta (venturi)');

// colores: presión divergente y velocidad secuencial; fuera del aire alfa 0
assert.deepEqual(pressureColor(0), [245, 245, 245]);
const red = pressureColor(1);
const blue = pressureColor(-1);
assert.ok(red[0] > red[2] && blue[2] > blue[0]);
assert.ok(speedColor(1)[0] > speedColor(0)[0]);
const rgba = sliceToRgba(slice, 'presion');
assert.equal(rgba[at(110, 40) * 4 + 3], 0);
assert.ok(rgba[at(110, 0) * 4 + 3] > 0);
console.log('airSlice ok');
