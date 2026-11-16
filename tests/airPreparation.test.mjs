import assert from 'node:assert/strict';
import { ParticleSim } from '../src/particles/sim.js';
import { ParticlePanel } from '../src/ui/particlePanel.js';

// Distinguir los motivos de salida aun cuando todos habilitan la corrida existente.
for (const [status, converged, stalled, steps, delta] of [
  ['pending', false, false, 20, .02],
  ['converged', true, false, 60, .005],
  ['stalled', false, true, 120, .03],
  ['limit', false, false, 800, .02],
]) {
  const sim = new ParticleSim([], { airModel: 'rapido', airCells: 0, rate: 0 });
  sim.solverMode = true; sim.airSettled = false; sim.inletKey = '[]';
  sim.air = {
    advance: () => converged, stalled: () => stalled, diverging: () => false,
    steps, delta, n: 100, hmm: 5, stepCost: 1, pcgIterations: 3, inletFlow: () => 0,
  };
  const result = sim.solveAirSlice(12);
  const info = sim.airInfo();
  assert.equal(result.done, status !== 'pending');
  assert.equal(info.initialSolve.status, status);
  assert.equal(info.initialSolve.steps, steps);
  assert.equal(info.initialSolve.residual, delta);
  assert.equal(info.ready, status !== 'pending');
  assert.doesNotThrow(() => structuredClone(info));
  const text = ParticlePanel.prototype.airText.call({ stats: { air: info }, hooks: { getInfo: () => ({ sensors: [] }) } });
  if (status === 'converged') assert.match(text, /[Cc]onvergencia alcanzada/);
  if (status === 'stalled' || status === 'limit') {
    assert.match(text, /[Ss]in convergencia/);
    assert.match(text, /provisional/i);
    assert.match(text, /[Rr]evis/);
  }
}
console.log('airPreparation OK · motivos y advertencias de finalización');
