import { commands } from '../core/commands.js';
import { createPart } from '../core/partModel.js';
import { sceneOps, emptyScene } from '../core/scene.js';

// Piezas de ejemplo editables (parámetros arriba, todo lo demás depende de ellos).
const withSketch = (part, patch, entities) => {
  let next = commands.addFeature(part, 'sketch', patch);
  const id = next.features[next.features.length - 1].id;
  entities.forEach((entity) => (next = commands.addEntity(next, id, entity)));
  return { next, id };
};
const setParams = (part, list) => list.reduce((acc, [name, value]) => commands.setParam(acc, name, value), part);
const polyPts = (list) => list.map(([x, y]) => ({ x, y, bulge: 0 }));

export const templates = {
  eje: {
    label: 'Eje escalonado',
    build() {
      let part = setParams(createPart('Eje escalonado'), [['D1', 40], ['D2', 30], ['D3', 25], ['L1', 50], ['L2', 40], ['L3', 30], ['c', 1]]);
      const pts = polyPts([[0, 0], ['D1/2', 0], ['D1/2', 'L1'], ['D2/2', 'L1'], ['D2/2', 'L1+L2'], ['D3/2', 'L1+L2'], ['D3/2', 'L1+L2+L3'], [0, 'L1+L2+L3']]);
      const made = withSketch(part, { plane: 'XZ' }, [{ t: 'poly', pts }]);
      part = commands.addFeature(made.next, 'revolve', { sketch: made.id, axis: 'y', angle: 360 });
      return commands.addFeature(part, 'chamfer', { size: 'c', selector: { kind: 'circles' } });
    },
  },
  transportador: {
    label: 'Transportador helicoidal (tornillo + camisa)',
    build() {
      let part = setParams(createPart('Transportador'), [['L', 120], ['Dt', 40], ['Dcam', 52], ['Dcint', 43], ['paso', 30]]);
      const made = withSketch(part, { plane: 'YZ' }, [{ t: 'circle', x: 0, y: 0, d: 'Dcam' }, { t: 'circle', x: 0, y: 0, d: 'Dcint' }]);
      part = commands.addFeature(made.next, 'extrude', { sketch: made.id, depth: 'L' });
      return commands.addFeature(part, 'screw', { plane: 'YZ', length: 'L', shaft: 12, outer: 'Dt', pitch: 'paso', thickness: 3 });
    },
  },
  tolva: {
    label: 'Tolva con guillotina (acciones + partículas)',
    build() {
      let part = setParams(createPart('Tolva con guillotina'), [['A', 60], ['e', 3], ['H', 50]]);
      const hopper = withSketch(part, { plane: 'XY' }, [{ t: 'rect', x: 0, y: 0, w: 'A', h: 'A', centered: true }, { t: 'rect', x: 0, y: 0, w: 'A-2*e', h: 'A-2*e', centered: true }]);
      part = commands.addFeature(hopper.next, 'extrude', { sketch: hopper.id, depth: 'H' });
      const gate = withSketch(part, { plane: 'XY', offset: -3 }, [{ t: 'rect', x: 0, y: 0, w: 'A+10', h: 'A', centered: true }]);
      part = commands.addFeature(gate.next, 'extrude', { sketch: gate.id, depth: 3 });
      const gateId = part.features[part.features.length - 1].id;
      // La guillotina retiene el material y se abre a los 1,5 s (editable en ⚡ Acciones).
      const made = sceneOps.addAction(emptyScene(), 'slide', { name: 'Abrir guillotina', targets: [gateId], axis: 'x', from: 0, to: 80, duration: 1.2, start: { type: 'time', t: 1.5 } });
      return { ...part, actions: made.scene.actions, nozzles: [] };
    },
  },
  canalVibratorio: {
    label: 'Canal vibratorio curvo (acción Vibrar + partículas)',
    build() {
      let part = setParams(createPart('Canal vibratorio'), [['A', 60], ['h', 25], ['e', 3], ['L', 300], ['R', 250], ['ang', 40]]);
      const profile = withSketch(part, { plane: 'YZ' }, [{ t: 'poly', pts: polyPts([['-A/2', 0], ['A/2', 0], ['A/2', 'h'], ['A/2-e', 'h'], ['A/2-e', 'e'], ['-A/2+e', 'e'], ['-A/2+e', 'h'], ['-A/2', 'h']]) }]);
      part = commands.addFeature(profile.next, 'pipe', { profile: 'sketch', sketch: profile.id, radius: 'R', segments: [{ len: 'L', turn: 'ang', toward: '+y', radius: '' }, { len: 150, turn: 0, toward: '+y', radius: '' }] });
      const made = sceneOps.addAction(emptyScene(), 'vibrate', { name: 'Vibrar canal', targets: ['pipe1'], axis: [0.866, 0, 0.5], amp: 2, freq: 25, start: { type: 'time', t: 0.3 } });
      return { ...part, actions: made.scene.actions, nozzles: [] };
    },
  },
  cañeriaT: {
    label: 'Cañería con codo y derivación en T (tubos)',
    build() {
      let part = setParams(createPart('Cañería con T'), [['D', 50], ['pared', 3], ['R', 75]]);
      part = commands.addFeature(part, 'pipe', { start: [0, 0, 0], dir: [0, 0, 1], od: 'D', wall: 'pared', radius: 'R', segments: [{ len: 200, turn: 90, toward: '+x', radius: '' }, { len: 250, turn: 0, toward: '+x', radius: '' }] });
      // Derivación: sale del tramo horizontal hacia −Y (se une y abre el hueco en la pared)
      return commands.addFeature(part, 'pipe', { start: [ 'R+120', 0, 'R+200' ], dir: [0, -1, 0], od: 'D*0.7', wall: 'pared', radius: 40, segments: [{ len: 120, turn: 0, toward: '+x', radius: '' }] });
    },
  },
  brida: {
    label: 'Brida con agujeros en PCD',
    build() {
      let part = setParams(createPart('Brida'), [['Dext', 120], ['Dint', 50], ['e', 14], ['PCD', 90], ['dAg', 11], ['n', 6]]);
      const made = withSketch(part, { plane: 'XY' }, [{ t: 'circle', x: 0, y: 0, d: 'Dext' }, { t: 'circle', x: 0, y: 0, d: 'Dint' }]);
      part = commands.addFeature(made.next, 'extrude', { sketch: made.id, depth: 'e' });
      return commands.addFeature(part, 'hole', { plane: 'XY', offset: 'e', d: 'dAg', through: true, count: 'n', pcd: 'PCD' });
    },
  },
  soporte: {
    label: 'Soporte en L',
    build() {
      let part = setParams(createPart('Soporte en L'), [['A', 80], ['H', 60], ['t', 8], ['W', 50]]);
      const made = withSketch(part, { plane: 'XZ' }, [{ t: 'poly', pts: polyPts([[0, 0], ['A', 0], ['A', 't'], ['t', 't'], ['t', 'H'], [0, 'H']]) }]);
      part = commands.addFeature(made.next, 'extrude', { sketch: made.id, depth: 'W' });
      return commands.addFeature(part, 'fillet', { radius: 2, selector: { kind: 'vertical' } });
    },
  },
  placa: {
    label: 'Placa con ranura',
    build() {
      let part = setParams(createPart('Placa con ranura'), [['L', 80], ['T', 10]]);
      const base = withSketch(part, { plane: 'XY' }, [{ t: 'rect', x: 0, y: 0, w: 'L', h: 50, centered: true }]);
      part = commands.addFeature(base.next, 'extrude', { sketch: base.id, depth: 'T' });
      const cut = withSketch(part, { plane: 'XY', offset: 'T' }, [{ t: 'slot', x: 0, y: 0, length: 40, width: 10, angle: 0 }]);
      part = commands.addFeature(cut.next, 'extrude', { sketch: cut.id, depth: 'T', mode: 'cut', reverse: true });
      return commands.addFeature(part, 'fillet', { radius: 3, selector: { kind: 'vertical' } });
    },
  },
};

// ---------- Catálogo (valores normalizados) ----------
// DIN 6885 forma A: [d desde, d hasta, b, h, t1 (profundidad en el eje)]
export const keyTable = [
  [6, 8, 2, 2, 1.2], [8, 10, 3, 3, 1.8], [10, 12, 4, 4, 2.5], [12, 17, 5, 5, 3.0], [17, 22, 6, 6, 3.5], [22, 30, 8, 7, 4.0],
  [30, 38, 10, 8, 5.0], [38, 44, 12, 8, 5.0], [44, 50, 14, 9, 5.5], [50, 58, 16, 10, 6.0], [58, 65, 18, 11, 7.0], [65, 75, 20, 12, 7.5],
];
const keyLengths = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 70, 80, 90, 100, 110, 125, 140, 160, 180, 200];

export function keyFor(shaftDiameter) {
  const row = keyTable.find(([from, to]) => shaftDiameter > from && shaftDiameter <= to);
  if (!row) throw new Error(`Diámetro de eje fuera de DIN 6885 (6 a 75 mm): ${shaftDiameter}`);
  const [, , b, h, t1] = row;
  const length = keyLengths.find((value) => value >= shaftDiameter * 1.25) ?? keyLengths[keyLengths.length - 1];
  return { b, h, t1, length };
}

const numberArg = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

templates.chaveta = {
  label: 'Catálogo · Chaveta DIN 6885-A',
  ask: [{ name: 'd', label: 'Diámetro del eje (mm)', value: 25 }],
  build({ d } = {}) {
    const key = keyFor(numberArg(d, 25));
    let part = setParams(createPart(`Chaveta ${key.b}x${key.h}x${key.length} DIN 6885-A`), [['b', key.b], ['h', key.h], ['L', key.length]]);
    const made = withSketch(part, { plane: 'XY' }, [{ t: 'slot', x: 0, y: 0, length: 'L', width: 'b', angle: 0 }]);
    return commands.addFeature(made.next, 'extrude', { sketch: made.id, depth: 'h' });
  },
};

templates.ejeChavetero = {
  label: 'Catálogo · Eje con chavetero',
  ask: [{ name: 'd', label: 'Diámetro del eje (mm)', value: 25 }, { name: 'length', label: 'Largo del eje (mm)', value: 100 }],
  build({ d, length } = {}) {
    const diameter = numberArg(d, 25);
    const key = keyFor(diameter);
    const total = numberArg(length, 100);
    let part = setParams(createPart(`Eje Ø${diameter} con chavetero`), [['D', diameter], ['L', total], ['b', key.b], ['t1', key.t1], ['Lk', key.length], ['c', 1]]);
    const profile = withSketch(part, { plane: 'XZ' }, [{ t: 'poly', pts: polyPts([[0, 0], ['D/2', 0], ['D/2', 'L'], [0, 'L']]) }]);
    part = commands.addFeature(profile.next, 'revolve', { sketch: profile.id, axis: 'y', angle: 360 });
    part = commands.addFeature(part, 'chamfer', { size: 'c', selector: { kind: 'circles' } });
    // Chavetero: ranura en la cara +X, a 5 mm del extremo; el plano de boceto queda a D/2 - t1 y el corte sale hacia afuera.
    const seat = withSketch(part, { plane: 'YZ', offset: 'D/2 - t1' }, [{ t: 'slot', x: 0, y: 'L - 5 - Lk/2', length: 'Lk', width: 'b', angle: 90 }]);
    return commands.addFeature(seat.next, 'extrude', { sketch: seat.id, depth: 't1 + 2', mode: 'cut' });
  },
};

templates.buje = {
  label: 'Catálogo · Buje / casquillo',
  ask: [{ name: 'od', label: 'Diámetro exterior (mm)', value: 40 }, { name: 'id', label: 'Diámetro interior (mm)', value: 25 }, { name: 'length', label: 'Largo (mm)', value: 30 }],
  build({ od, id, length } = {}) {
    const outer = numberArg(od, 40);
    const inner = Math.min(numberArg(id, 25), outer - 2);
    const wall = (outer - inner) / 2;
    let part = setParams(createPart(`Buje Ø${outer}/Ø${inner} x ${numberArg(length, 30)}`), [['OD', outer], ['ID', inner], ['L', numberArg(length, 30)], ['c', Math.min(1, Math.round((wall / 4) * 10) / 10)]]);
    const made = withSketch(part, { plane: 'XY' }, [{ t: 'circle', x: 0, y: 0, d: 'OD' }, { t: 'circle', x: 0, y: 0, d: 'ID' }]);
    part = commands.addFeature(made.next, 'extrude', { sketch: made.id, depth: 'L' });
    return commands.addFeature(part, 'chamfer', { size: 'c', selector: { kind: 'circles' } });
  },
};
