import { commands } from '../../core/commands.js';
import { createPart } from '../../core/partModel.js';
import { emptyScene, sceneOps } from '../../core/scene.js';

// Ayudas para armar piezas de la biblioteca. Convención: las piezas de revolución tienen el eje a lo largo de Z y arrancan en z = 0;
// los perfiles de revolución se dibujan en el plano XZ como puntos [radio, z]. Todo parámetro puede ser número o expresión.
export const numberArg = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
export const polyPts = (list) => list.map(([x, y, bulge = 0]) => ({ x, y, bulge }));
export const circle = (d, x = 0, y = 0) => ({ t: 'circle', x, y, d });
export const rect = (w, h, x = 0, y = 0) => ({ t: 'rect', x, y, w, h, centered: true });
export const slot = (length, width, x = 0, y = 0, angle = 0) => ({ t: 'slot', x, y, length, width, angle });
export const hexagon = (across, x = 0, y = 0, angle = 0) => ({ t: 'polygon', x, y, n: 6, d: across, across: 'flats', angle });
export const poly = (pts) => ({ t: 'poly', pts: polyPts(pts) });

// Puntos de una circunferencia de `n` posiciones a radio `r` empezando en `start` grados.
export const onCircle = (n, r, start = 0) => Array.from({ length: n }, (_, i) => {
  const a = ((start + (360 * i) / n) * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
// Cuadrícula de nx × ny posiciones separadas px × py, centrada en el origen.
export const grid = (nx, ny, px, py) => {
  const out = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) out.push([(i - (nx - 1) / 2) * px, (j - (ny - 1) / 2) * py]);
  return out;
};
export const round3 = (v) => Math.round(v * 1000) / 1000;

export class PartBuilder {
  constructor(name, params = []) {
    this.part = params.reduce((acc, [key, value]) => commands.setParam(acc, key, value), createPart(name));
    this.scene = emptyScene();
  }

  get lastId() {
    return this.part.features[this.part.features.length - 1].id;
  }

  feature(type, patch = {}) {
    this.part = commands.addFeature(this.part, type, patch);
    return this.lastId;
  }

  sketch(plane, offset, entities) {
    const id = this.feature('sketch', { plane, offset });
    entities.forEach((entity) => { this.part = commands.addEntity(this.part, id, entity); });
    return id;
  }

  // Agrega material: boceto + extrusión (hacia +normal del plano; `reverse` hacia −normal; `symmetric` a ambos lados).
  add(plane, offset, entities, depth, patch = {}) {
    return this.feature('extrude', { sketch: this.sketch(plane, offset, entities), depth, mode: 'add', ...patch });
  }

  // Corta material desde el plano hacia −normal (hacia adentro de una cara superior), o pasante si `through`.
  cut(plane, offset, entities, depth, patch = {}) {
    return this.feature('extrude', { sketch: this.sketch(plane, offset, entities), depth, mode: 'cut', reverse: !patch.through, ...patch });
  }

  // Tubo (pared + hueco): el primer contorno es el exterior; los anidados, huecos.
  tube(plane, offset, entities, depth, patch = {}) {
    return this.feature('extrude', { sketch: this.sketch(plane, offset, entities), depth, mode: 'tube', ...patch });
  }

  // Sólido de revolución alrededor de Z: puntos [radio, z] en el plano XZ.
  lathe(pts, patch = {}) {
    return this.feature('revolve', { sketch: this.sketch('XZ', 0, [poly(pts)]), axis: 'y', angle: 360, ...patch });
  }

  hole(patch) {
    return this.feature('hole', { plane: 'XY', offset: 0, through: true, ...patch });
  }

  fillet(radius, kind = 'all') {
    return this.feature('fillet', { radius, selector: { kind } });
  }

  chamfer(size, kind = 'all') {
    return this.feature('chamfer', { size, selector: { kind } });
  }

  move(id, vector) {
    this.part = commands.updateFeature(this.part, id, { move: vector });
    return id;
  }

  turn(id, axis, angle, pivot = [0, 0, 0]) {
    this.part = commands.updateFeature(this.part, id, { turn: { axis, angle, px: pivot[0], py: pivot[1], pz: pivot[2] } });
    return id;
  }

  // Copias de una operación repartidas en círculo, cada una como operación propia (con giro): a diferencia de «Repetir»,
  // todas pueden elegirse como cuerpo móvil de una acción. `make()` crea la operación y devuelve su id.
  radial(count, make, axis, pivot = [0, 0, 0], total = 360) {
    const ids = [];
    const step = total === 360 ? 360 / count : total / (count - 1);
    for (let i = 0; i < count; i += 1) {
      const id = make(i);
      if (i > 0) this.turn(id, axis, step * i, pivot);
      ids.push(id);
    }
    return ids;
  }

  pattern(source, patch) {
    return this.feature('pattern', { source, ...patch });
  }

  frame(members, patch = {}) {
    return this.feature('frame', { members, ...patch });
  }

  action(kind, patch) {
    this.scene = sceneOps.addAction(this.scene, kind, patch).scene;
    return this.scene.actions[this.scene.actions.length - 1].id;
  }

  nozzle(patch) { this.scene = sceneOps.addNozzle(this.scene, patch).scene; }

  sensor(patch) { this.scene = sceneOps.addSensor(this.scene, patch).scene; }

  feeder(patch) { this.scene = sceneOps.addFeeder(this.scene, patch).scene; }

  build() {
    return { ...this.part, actions: this.scene.actions, nozzles: this.scene.nozzles, sensors: this.scene.sensors, feeders: this.scene.feeders };
  }
}

// Registro: cada ítem { id, category, label, description?, ask?, build(args) }. `expect` (opcional) = { bbox: [x, y, z], tol } para el test.
export const item = (definition) => definition;
