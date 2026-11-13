import { defaultAction, detachMotionRefs, pruneActions } from './actions.js';

// Escena = { actions, nozzles }. Reductores puros: sirven igual para una pieza (state.actions) y para el proyecto (conjunto).
export const defaultNozzle = (patch = {}) => ({
  name: '',
  pos: [0, 0, 0],
  dir: [1, 0, 0],
  speed: 8000, // mm/s en la boca
  cone: 20, // apertura total, grados
  range: 300, // alcance, mm
  radius: 6, // radio de la boca, mm
  // Aire calculado: 'chorro' usa velocidad × área de la boca; 'caudal' usa `flow` (m³/h); 'presion' = plenum de un soplador a `pressure` (Pa)
  bc: 'chorro',
  flow: 0,
  pressure: 0,
  ...patch,
});

export const defaultSensor = (patch = {}) => ({ name: '', center: [0, 0, 0], size: [30, 30, 30], counts: 'granos', ...patch });

// Alimentador de productos (cajas rígidas): aparece uno cada `every` s en `pos` (giro `yaw` sobre Z) hasta `max` vivos a la vez.
export const defaultFeeder = (patch = {}) => ({ name: '', size: [200, 150, 100], mass: 1.5, pos: [0, 0, 100], yaw: 0, every: 2, max: 20, friction: 0.5, start: 0, ...patch });

export const emptyScene = () => ({ actions: [], nozzles: [], sensors: [], feeders: [] });
export const sceneOf = (doc) => ({ actions: doc?.actions ?? [], nozzles: doc?.nozzles ?? [], sensors: doc?.sensors ?? [], feeders: doc?.feeders ?? [] });
// Campos que la escena guarda en el documento (pieza o proyecto).
export const sceneFields = (scene) => ({ actions: scene.actions, nozzles: scene.nozzles, sensors: scene.sensors ?? [], feeders: scene.feeders ?? [] });

const nextId = (list, prefix) => `${prefix}${list.reduce((max, item) => Math.max(max, Number(String(item.id).slice(prefix.length)) || 0), 0) + 1}`;

export const sceneOps = {
  addAction(scene, kind, patch = {}) {
    const id = nextId(scene.actions, 'a');
    const action = defaultAction(kind, { id, name: `Acción ${id.slice(1)}`, ...patch });
    return { scene: { ...scene, actions: [...scene.actions, action] }, id };
  },
  updateAction: (scene, id, patch) => ({ ...scene, actions: scene.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) }),
  removeAction: (scene, id) => ({
    ...scene,
    actions: detachMotionRefs(scene.actions.filter((action) => action.id !== id), id).map((action) => (action.start?.action === id ? { ...action, start: { ...action.start, type: 'time', action: null } } : action)),
  }),
  moveAction(scene, id, delta) {
    const index = scene.actions.findIndex((action) => action.id === id);
    const to = index + delta;
    if (index < 0 || to < 0 || to >= scene.actions.length) return scene;
    const actions = [...scene.actions];
    [actions[index], actions[to]] = [actions[to], actions[index]];
    return { ...scene, actions };
  },
  addNozzle(scene, patch = {}) {
    const id = nextId(scene.nozzles, 'n');
    return { scene: { ...scene, nozzles: [...scene.nozzles, defaultNozzle({ id, name: `Boquilla ${id.slice(1)}`, ...patch })] }, id };
  },
  updateNozzle: (scene, id, patch) => ({ ...scene, nozzles: scene.nozzles.map((nozzle) => (nozzle.id === id ? { ...nozzle, ...patch } : nozzle)) }),
  removeNozzle: (scene, id) => ({
    ...scene,
    nozzles: scene.nozzles.filter((nozzle) => nozzle.id !== id),
    actions: scene.actions.map((action) => (action.nozzle === id ? { ...action, nozzle: null } : action)),
  }),
  addSensor(scene, patch = {}) {
    const id = nextId(scene.sensors ?? [], 's');
    return { scene: { ...scene, sensors: [...(scene.sensors ?? []), defaultSensor({ id, name: `Sensor ${id.slice(1)}`, ...patch })] }, id };
  },
  updateSensor: (scene, id, patch) => ({ ...scene, sensors: (scene.sensors ?? []).map((sensor) => (sensor.id === id ? { ...sensor, ...patch } : sensor)) }),
  removeSensor: (scene, id) => ({
    ...scene,
    sensors: (scene.sensors ?? []).filter((sensor) => sensor.id !== id),
    actions: scene.actions.map((action) => (action.start?.sensor === id ? { ...action, start: { ...action.start, sensor: null } } : action)),
  }),
  addFeeder(scene, patch = {}) {
    const id = nextId(scene.feeders ?? [], 'f');
    return { scene: { ...scene, feeders: [...(scene.feeders ?? []), defaultFeeder({ id, name: `Producto ${id.slice(1)}`, ...patch })] }, id };
  },
  updateFeeder: (scene, id, patch) => ({ ...scene, feeders: (scene.feeders ?? []).map((feeder) => (feeder.id === id ? { ...feeder, ...patch } : feeder)) }),
  removeFeeder: (scene, id) => ({ ...scene, feeders: (scene.feeders ?? []).filter((feeder) => feeder.id !== id) }),
  // Tras borrar operaciones o instancias.
  prune: (scene, targetIds) => ({ ...scene, actions: pruneActions(scene.actions, { targetIds, nozzleIds: scene.nozzles.map((nozzle) => nozzle.id), sensorIds: (scene.sensors ?? []).map((sensor) => sensor.id) }) }),
};

// Boquilla lista para el simulador: dirección unitaria, tangente del semiángulo y si alguna acción la gobierna.
export function simNozzles(scene) {
  return scene.nozzles.map((nozzle) => {
    const length = Math.hypot(...nozzle.dir) || 1;
    return {
      id: nozzle.id,
      pos: nozzle.pos.map(Number),
      dir: nozzle.dir.map((value) => Number(value) / length),
      speed: Number(nozzle.speed) || 0,
      range: Math.max(1, Number(nozzle.range) || 1),
      radius: Math.max(0.5, Number(nozzle.radius) || 1),
      bc: nozzle.bc ?? 'chorro',
      flow: Math.max(0, Number(nozzle.flow) || 0),
      pressure: Math.max(0, Number(nozzle.pressure) || 0),
      tan: Math.tan((Math.min(120, Math.max(0, Number(nozzle.cone) || 0)) * Math.PI) / 360),
      controlled: scene.actions.some((action) => action.kind === 'air' && action.nozzle === nozzle.id),
    };
  });
}

// Sensores listos para el simulador (caja alineada a los ejes).
export const simSensors = (scene) => (scene.sensors ?? []).map((sensor) => ({
  id: sensor.id,
  min: sensor.center.map((value, k) => Number(value) - Math.abs(Number(sensor.size[k])) / 2),
  max: sensor.center.map((value, k) => Number(value) + Math.abs(Number(sensor.size[k])) / 2),
  counts: sensor.counts ?? 'granos',
}));

// Alimentadores listos para el simulador (números válidos y positivos).
export const simFeeders = (scene) => (scene.feeders ?? []).map((feeder) => ({
  id: feeder.id,
  size: feeder.size.map((value) => Math.max(5, Number(value) || 5)),
  mass: Math.max(0.01, Number(feeder.mass) || 1),
  pos: feeder.pos.map(Number),
  yaw: Number(feeder.yaw) || 0,
  every: Math.max(0.1, Number(feeder.every) || 1),
  max: Math.max(1, Math.min(200, Math.floor(Number(feeder.max) || 1))),
  friction: Math.max(0, Math.min(2, Number(feeder.friction) || 0)),
  start: Math.max(0, Number(feeder.start) || 0),
}));
