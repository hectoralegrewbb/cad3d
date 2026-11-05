import assert from 'node:assert/strict';
import { defaultAction, evaluateActions, linkRatio, validateActions } from '../src/core/actions.js';

const rpm = (id, patch) => defaultAction('rotate', { id, targets: [id], axis: 'z', mode: 'continuous', rpm: 60, ...patch });
const follower = (id, master, link, patch = {}) => defaultAction('rotate', { id, targets: [id], axis: 'x', mode: 'follow', link: { master, ...link }, ...patch });
const poseOf = (poses, key) => poses.bodies.find((b) => b.key === key);

// relaciones
assert.equal(linkRatio({ type: 'reductor', a: 10 }), 0.1);
assert.equal(linkRatio({ type: 'correa', a: 80, b: 160 }), 0.5);
assert.equal(linkRatio({ type: 'engranaje', a: 20, b: 40 }), -0.5);
assert.equal(linkRatio({ type: 'directa' }), 1);

// reductor 10:1: el eje de salida gira a 6 rpm cuando el motor gira a 60
{
  const actions = [rpm('m'), follower('o', 'm', { type: 'reductor', a: 10 })];
  const poses = evaluateActions(actions, 2); // 2 s a 60 rpm = 2 vueltas
  assert.ok(Math.abs(poseOf(poses, 'm').angle - 4 * Math.PI) < 1e-9);
  assert.ok(Math.abs(poseOf(poses, 'o').angle - 0.4 * Math.PI) < 1e-9, 'la salida da 1/10 de vuelta por vuelta');
  assert.ok(Math.abs(poseOf(poses, 'o').omega - (6 * 2 * Math.PI) / 60) < 1e-9);
  assert.equal(poses.links.length, 1);
}
// cadena motor → reductor → engranaje invertido → carro lineal (paso 100 mm/vuelta)
{
  const actions = [
    follower('c', 'g', { type: 'manual', ratio: 1, pitch: 120 }, { kind: 'slide', axis: 'y' }),
    follower('g', 'r', { type: 'engranaje', a: 20, b: 20 }),
    follower('r', 'm', { type: 'reductor', a: 5 }),
    rpm('m', { rpm: 100 }),
  ].map((a) => (a.id === 'c' ? { ...a, kind: 'slide' } : a));
  const poses = evaluateActions(actions, 1.2); // 120 rev motor → r: 24 → g: −24 → c: 120 mm × (−24)
  const g = poseOf(poses, 'g');
  assert.ok(Math.abs(g.angle / (2 * Math.PI) - -(100 / 60 * 1.2) / 5) < 1e-9, `engranaje: ${g.angle / (2 * Math.PI)} vueltas`);
  const c = poseOf(poses, 'c');
  assert.ok(Math.abs(c.offset[1] - 120 * (g.angle / (2 * Math.PI))) < 1e-6, `carro avanzó ${c.offset[1]} mm`);
  assert.equal(poses.links.length, 3);
}
// maestro con barrido (clapeta) también arrastra
{
  const sweep = defaultAction('rotate', { id: 's', targets: ['s'], axis: 'z', mode: 'sweep', from: 0, to: 90, duration: 1 });
  const poses = evaluateActions([sweep, follower('f', 's', { type: 'correa', a: 100, b: 50 })], 2);
  assert.ok(Math.abs(poseOf(poses, 'f').angle - Math.PI) < 1e-9, 'polea chica gira el doble: 90° → 180°');
}
// avisos
assert.ok(validateActions([follower('f', null, { type: 'directa' })]).some((w) => /eje que lo mueve/.test(w)));
assert.ok(validateActions([follower('f', 'f', { type: 'directa' })]).some((w) => /sí mismo/.test(w)));
assert.deepEqual(validateActions([rpm('m'), follower('f', 'm', { type: 'directa' })]), []);
// un seguidor sin maestro válido queda quieto sin romper
{
  const poses = evaluateActions([follower('f', 'nada', { type: 'directa' })], 1);
  assert.equal(poseOf(poses, 'f').angle, 0);
}
console.log('transmission ok');
