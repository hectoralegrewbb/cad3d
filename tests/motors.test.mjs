import assert from 'node:assert/strict';
import { motorCatalog, motorPatch, peakTorqueFactor } from '../src/data/motors.js';
import { defaultAction, rotorParamsOf } from '../src/core/actions.js';

// P = M·ω: el par nominal del catálogo es coherente con la potencia y las rpm (±3 %)
motorCatalog.forEach((m) => {
  const ideal = (m.kw * 1000) / ((m.rpm * 2 * Math.PI) / 60);
  assert.ok(Math.abs(m.ratedNm - ideal) / ideal < 0.03, `${m.kw} kW: ${m.ratedNm} vs ${ideal.toFixed(2)}`);
});
const patch = motorPatch(motorCatalog.find((m) => m.id === '1.5'), 0.01);
assert.equal(patch.rpm, 1410);
assert.ok(Math.abs(patch.torqueMax - 10.2 * peakTorqueFactor) < 0.01);
assert.equal(patch.ratedTorque, 10.2);
assert.ok(Math.abs(patch.inertia - 0.0135) < 1e-9);
const params = rotorParamsOf(defaultAction('rotate', patch));
assert.equal(params.rated, 10.2);
console.log('motors ok');
