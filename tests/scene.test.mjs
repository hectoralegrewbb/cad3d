import assert from 'node:assert/strict';
import { emptyScene, sceneOps, simNozzles } from '../src/core/scene.js';

let scene = emptyScene();
let made = sceneOps.addAction(scene, 'slide', { targets: ['extrude1'] });
scene = made.scene;
assert.equal(made.id, 'a1');
made = sceneOps.addAction(scene, 'rotate', { start: { type: 'after', action: 'a1', delay: 0 } });
scene = made.scene;
assert.equal(made.id, 'a2');
let n = sceneOps.addNozzle(scene, { pos: [1, 2, 3] });
scene = n.scene;
scene = sceneOps.addAction(scene, 'air', { nozzle: n.id }).scene;
assert.equal(scene.actions.length, 3);
// borrar una acción deja a la dependiente en tiempo fijo
scene = sceneOps.removeAction(scene, 'a1');
assert.equal(scene.actions.find((a) => a.id === 'a2').start.type, 'time');
// ids siempre nuevos aunque se borren intermedios
assert.equal(sceneOps.addAction(scene, 'slide').id, 'a4');
// borrar boquilla desasocia
scene = sceneOps.removeNozzle(scene, 'n1');
assert.equal(scene.actions.find((a) => a.kind === 'air').nozzle, null);
// prune
scene = sceneOps.updateAction(scene, 'a2', { targets: ['x', 'y'] });
assert.deepEqual(sceneOps.prune(scene, ['x']).actions.find((a) => a.id === 'a2').targets, ['x']);
// boquilla para el simulador
const sim = simNozzles({ actions: [{ kind: 'air', nozzle: 'n1' }], nozzles: [{ id: 'n1', pos: [0, 0, 0], dir: [0, 3, 4], speed: 1000, cone: 90, range: 100, radius: 5 }] });
assert.equal(sim[0].dir[2], 0.8);
assert.ok(Math.abs(sim[0].tan - 1) < 1e-9);
assert.equal(sim[0].controlled, true);
console.log('scene.test OK');
