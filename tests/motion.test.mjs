import assert from 'node:assert/strict';
import { advance, axisVector, rotationAbout, rpmAt } from '../src/core/motion.js';

// perfiles
assert.equal(rpmAt({ mode: 'const', rpm: 60 }, 3), 60);
assert.equal(rpmAt({ mode: 'const', rpm: 60, reverse: true }, 3), -60);
const ramp = { mode: 'ramp', rpm: 100, period: 10 };
assert.equal(rpmAt(ramp, 0), 0);
assert.equal(rpmAt(ramp, 5), 100);
assert.ok(Math.abs(rpmAt(ramp, 2.5) - 50) < 1e-9 && Math.abs(rpmAt(ramp, 7.5) - 50) < 1e-9);
assert.ok(Math.abs(rpmAt({ mode: 'sine', rpm: 100, period: 4 }, 1) - 100) < 1e-9);
assert.ok(rpmAt({ mode: 'sine', rpm: 100, period: 4 }, 3) < -99);
assert.deepEqual([0, 1.1, 2.1, 3.1].map((t) => rpmAt({ mode: 'steps', rpm: 100, period: 4 }, t)), [25, 50, 75, 100]);
// 60 rpm durante 1 s = una vuelta
assert.ok(Math.abs(advance(0, 60, 1) - 2 * Math.PI) < 1e-12);
// rotación alrededor de un eje por un punto: (10,0,0) sobre Z por (5,0,0) a 90° → (5,5,0)
const rot = rotationAbout('z', [5, 0, 0], Math.PI / 2);
const p = rot([10, 0, 0]);
assert.ok(Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 5) < 1e-9 && Math.abs(p[2]) < 1e-9, JSON.stringify(p));
// el punto del eje no se mueve
assert.deepEqual(rotationAbout('x', [0, 3, 4], 1.234)([7, 3, 4]).map((v) => Math.round(v * 1e9) / 1e9), [7, 3, 4]);
assert.throws(() => axisVector([0, 0, 0]), /nulo/);
assert.throws(() => axisVector('q'), /desconocido/);
console.log('motion OK');
