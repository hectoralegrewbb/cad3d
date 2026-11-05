// Pares engranados: dado un engranaje (piñón) de la pieza, calcula el engranaje conjugado o la cremallera ya ubicados a la distancia
// correcta y con los dientes entrelazados, más las acciones de giro enlazadas. Puro: sin DOM ni kernel (usa la geometría del engranaje).
import { evaluate } from './expression.js';
import { centerDistance, gearFeatureSpecs, gearSpec } from '../kernel/gearGeometry.js';
import { planeFrame } from '../kernel/planes.js';
import { featureTurn, turnVector } from '../kernel/turn.js';
import { commands } from './commands.js';
import { sceneFields, sceneOf, sceneOps } from './scene.js';

const TAU = 360;
export const frac = (x) => x - Math.floor(x);
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const rad = (deg) => (deg * Math.PI) / 180;

// Dirección en que se pone el otro elemento, en grados dentro del plano del piñón (0 = +X del plano, 90 = +Y…).
export const directionOptions = { 0: '+X (derecha)', 180: '−X (izquierda)', 90: '+Y (arriba)', 270: '−Y (abajo)' };

// Fase (°) del engranaje conjugado para que sus dientes entren en los huecos del piñón sobre la línea de centros.
// Los dientes del engranaje i están en phase_i + k·360/z_i (antihorario). En el punto primitivo la fracción de diente f1 y f2 suman ½.
export function matingPhase({ z1, phase1 = 0, z2, thetaDeg }) {
  const f1 = frac(((thetaDeg - phase1) * z1) / TAU);
  const f2 = frac(0.5 - f1);
  return round(thetaDeg + 180 - (TAU / z2) * f2, 4);
}

// Posición u0 (mm, a lo largo de la tangente antihoraria) de un diente de la cremallera, para que entre en un hueco del piñón.
export function rackToothOrigin({ z1, phase1 = 0, thetaDeg, m }) {
  const f1 = frac(((thetaDeg - phase1) * z1) / TAU);
  return round(frac(-f1 - 0.5) * Math.PI * m, 5);
}

const COPY_SKIP = new Set(['id', 'type', 'name', 'suppressed']);

// Engranaje conjugado: mismo plano, módulo, ancho y ángulo de presión; hélice opuesta; centro a `thetaDeg` a distancia de centros.
// Devuelve el parche de campos para commands.addFeature(state, 'gear', patch).
export function matingGearFeature(feature, params, { teeth, thetaDeg = 0 }) {
  const spec = gearSpec(feature, params);
  const z2 = Math.round(teeth);
  const d = centerDistance(spec.m, spec.z, z2);
  const x1 = evaluate(feature.x, params);
  const y1 = evaluate(feature.y, params);
  const phase1 = evaluate(feature.phase ?? 0, params) || 0;
  const patch = {};
  Object.entries(feature).forEach(([key, value]) => { if (!COPY_SKIP.has(key)) patch[key] = typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value; });
  const rp2 = (spec.m * z2) / 2;
  return {
    ...patch,
    x: round(x1 + d * Math.cos(rad(thetaDeg)), 4),
    y: round(y1 + d * Math.sin(rad(thetaDeg)), 4),
    z: z2,
    shift: 0,
    helix: -spec.helix || 0,
    phase: matingPhase({ z1: spec.z, phase1, z2, thetaDeg }),
    bore: Math.min(spec.bore || 8, Math.max(0, 2 * (rp2 - 1.25 * spec.m) - 3)),
    hub: 0,
    hubWidth: 0,
  };
}

// Contorno (polígono cerrado, en coordenadas del plano) de una cremallera de `teeth` dientes engranando con el piñón en `thetaDeg`.
export function rackOutline(feature, params, { teeth = 20, baseHeight = 12, thetaDeg = 0 } = {}) {
  const spec = gearSpec(feature, params);
  const { m, alpha } = spec;
  const p = Math.PI * m;
  const x1 = evaluate(feature.x, params);
  const y1 = evaluate(feature.y, params);
  const phase1 = evaluate(feature.phase ?? 0, params) || 0;
  const u0 = rackToothOrigin({ z1: spec.z, phase1, thetaDeg, m });
  const add = m * (1 + spec.shift * 0); // cabeza = módulo
  const ded = 1.25 * m;
  const t = Math.tan(alpha);
  // coordenadas locales (u a lo largo de la tangente, v hacia el piñón; v = 0 en la línea primitiva)
  // dientes centrados en u0 + k·p, para k simétrico alrededor de 0
  const first = -Math.floor(teeth / 2);
  const local = [];
  const base = -baseHeight - ded;
  const start = u0 + (first - 0.5) * p;
  const end = start + teeth * p;
  local.push([start, base], [end, base], [end, -ded]);
  for (let k = first + teeth - 1; k >= first; k -= 1) {
    const c = u0 + k * p; // centro del diente (cabeza)
    // diente: ancho en la línea primitiva = p/2; flancos a α
    const halfPitch = p / 4;
    local.push([c + halfPitch + t * ded, -ded], [c + halfPitch - t * add, add], [c - halfPitch + t * add, add], [c - halfPitch - t * ded, -ded]);
  }
  local.push([start, -ded]);
  const clean = local.filter((pt, i) => i === 0 || Math.hypot(pt[0] - local[i - 1][0], pt[1] - local[i - 1][1]) > 1e-6);
  const n = [Math.cos(rad(thetaDeg)), Math.sin(rad(thetaDeg))];
  const tangent = [-Math.sin(rad(thetaDeg)), Math.cos(rad(thetaDeg))];
  // punto local (u, v) → plano: centro + n·rp + t·u − n·v
  const plane = clean.map(([u, v]) => [round(x1 + n[0] * spec.rp + tangent[0] * u - n[0] * v, 4), round(y1 + n[1] * spec.rp + tangent[1] * u - n[1] * v, 4)]);
  return { points: plane, pitch: p, length: teeth * p, spec };
}

const FRAME_KEYS = ['plane', 'offset', 'rot', 'move', 'turn'];
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// Reductor completo: agrega el engranaje conjugado (o la cremallera) y las acciones enlazadas al giro del piñón.
// opts: { kind: 'gear'|'rack', teeth, thetaDeg, rackBase, rpm }. Devuelve { state, mateId, pinionAction, mateAction } o lanza Error.
export function addGearMate(state, gearId, params, opts = {}) {
  const feature = state.features.find((item) => item.id === gearId && item.type === 'gear');
  if (!feature) throw new Error('Elegí un engranaje.');
  const kind = opts.kind === 'rack' ? 'rack' : 'gear';
  const teeth = Math.round(Number(opts.teeth));
  if (!Number.isFinite(teeth) || teeth < (kind === 'rack' ? 2 : 6)) throw new Error(kind === 'rack' ? 'La cremallera necesita al menos 2 dientes.' : 'El engranaje conjugado necesita al menos 6 dientes.');
  const thetaDeg = Number(opts.thetaDeg) || 0;
  const spec = gearSpec(feature, params);
  let next = state;
  let mateId;
  if (kind === 'gear') {
    const patch = matingGearFeature(feature, params, { teeth, thetaDeg });
    next = commands.addFeature(next, 'gear', patch);
    mateId = next.features[next.features.length - 1].id;
  } else {
    const rack = rackOutline(feature, params, { teeth, baseHeight: Number(opts.rackBase) || 12, thetaDeg });
    const frame = {};
    FRAME_KEYS.forEach((key) => { if (feature[key] !== undefined) frame[key] = clone(feature[key]); });
    next = commands.addFeature(next, 'sketch', { ...frame, move: undefined });
    const sketchId = next.features[next.features.length - 1].id;
    next = commands.addEntity(next, sketchId, { t: 'poly', pts: rack.points.map(([x, y]) => ({ x, y, bulge: 0 })) });
    next = commands.addFeature(next, 'extrude', { sketch: sketchId, depth: spec.width, reverse: !!feature.reverse, mode: 'add', ...(feature.move ? { move: clone(feature.move) } : {}), ...(feature.turn ? { turn: clone(feature.turn) } : {}) });
    mateId = next.features[next.features.length - 1].id;
  }
  // acciones
  const gear = gearFeatureSpecs(next, params).find((item) => item.id === gearId);
  const mateGear = kind === 'gear' ? gearFeatureSpecs(next, params).find((item) => item.id === mateId) : null;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  let scene = sceneOf(next);
  let master = scene.actions.find((action) => action.kind === 'rotate' && action.targets?.length === 1 && action.targets[0] === gearId && action.mode !== 'follow');
  let pinionAction = master?.id;
  if (!master) {
    const made = sceneOps.addAction(scene, 'rotate', { name: 'Giro del piñón', targets: [gearId], axis: gear.vector, pivot: gear.center.map(round3), mode: 'continuous', rpm: Number(opts.rpm) || 60 });
    scene = made.scene;
    pinionAction = made.id;
  }
  let link;
  let follower;
  if (kind === 'gear') {
    link = { master: pinionAction, type: 'engranaje', a: spec.z, b: teeth, ratio: 1, eff: 0.95, inertia: 0, pitch: 100 };
    follower = { name: 'Giro del engranaje conjugado', targets: [mateId], axis: mateGear.vector, pivot: mateGear.center.map(round3), mode: 'follow', link };
  } else {
    const frame = planeFrame(null, feature, params);
    const turn = featureTurn(feature, params);
    const c = Math.cos(rad(thetaDeg));
    const s = Math.sin(rad(thetaDeg));
    const tangent = turnVector(turn, [0, 1, 2].map((i) => -s * frame.xDir[i] + c * frame.yDir[i])).map(round3);
    // sentido: el piñón antihorario (+) empuja el punto de contacto hacia +tangente; la cremallera va con él
    link = { master: pinionAction, type: 'manual', a: 1, b: 1, ratio: 1, eff: 0.95, inertia: 0, pitch: round(Math.PI * spec.m * spec.z, 4) };
    follower = { name: 'Cremallera (sigue al piñón)', targets: [mateId], axis: tangent, mode: 'follow', link };
  }
  const made = sceneOps.addAction(scene, kind === 'gear' ? 'rotate' : 'slide', follower);
  next = { ...next, ...sceneFields(made.scene) };
  return { state: next, mateId, pinionAction, mateAction: made.id };
}
