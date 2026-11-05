// Ruedas dentadas (piñones) para cadena de rodillos: tabla ISO 606 (serie B) y ANSI, perfil del diente, cadena de varias hileras,
// par de piñones a una distancia de centros con cantidad de eslabones par, y acciones enlazadas. Puro: sin DOM ni kernel.
import { evaluate } from './expression.js';
import { commands } from './commands.js';
import { sceneFields, sceneOf, sceneOps } from './scene.js';
import { planeFrame } from '../kernel/planes.js';
import { featureTurn, turnPoint, turnVector } from '../kernel/turn.js';

// paso p, Ø rodillo d1, ancho interior b1, paso entre hileras pt (mm). Valores de catálogo: verificá con tu fabricante.
export const chainTable = {
  '05B': { label: '05B (8 mm)', p: 8, d1: 5, b1: 3, pt: 5.64 },
  '06B': { label: '06B (3/8")', p: 9.525, d1: 6.35, b1: 5.72, pt: 10.24 },
  '08B': { label: '08B (1/2")', p: 12.7, d1: 8.51, b1: 7.75, pt: 13.92 },
  '10B': { label: '10B (5/8")', p: 15.875, d1: 10.16, b1: 9.65, pt: 16.59 },
  '12B': { label: '12B (3/4")', p: 19.05, d1: 12.07, b1: 11.68, pt: 19.46 },
  '16B': { label: '16B (1")', p: 25.4, d1: 15.88, b1: 17.02, pt: 31.88 },
  '20B': { label: '20B (1 1/4")', p: 31.75, d1: 19.05, b1: 19.56, pt: 36.45 },
  '24B': { label: '24B (1 1/2")', p: 38.1, d1: 25.4, b1: 25.4, pt: 48.36 },
  A25: { label: 'ANSI 25 (1/4")', p: 6.35, d1: 3.3, b1: 3.18, pt: 6.4 },
  A35: { label: 'ANSI 35 (3/8")', p: 9.525, d1: 5.08, b1: 4.77, pt: 10.13 },
  A40: { label: 'ANSI 40 (1/2")', p: 12.7, d1: 7.92, b1: 7.95, pt: 14.38 },
  A50: { label: 'ANSI 50 (5/8")', p: 15.875, d1: 10.16, b1: 9.53, pt: 18.11 },
  A60: { label: 'ANSI 60 (3/4")', p: 19.05, d1: 11.91, b1: 12.57, pt: 22.78 },
  A80: { label: 'ANSI 80 (1")', p: 25.4, d1: 15.88, b1: 15.75, pt: 29.29 },
  A100: { label: 'ANSI 100 (1 1/4")', p: 31.75, d1: 19.05, b1: 18.9, pt: 35.76 },
};
export const chainIds = Object.keys(chainTable);
export const strandOptions = { 1: 'Simple', 2: 'Doble', 3: 'Triple' };

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const rad = (deg) => (deg * Math.PI) / 180;
const TAU = Math.PI * 2;

export function sprocketGeometry({ chain = '08B', z = 19, strands = 1 }) {
  const c = chainTable[chain];
  if (!c) throw new Error(`Cadena desconocida: ${chain}`);
  const teeth = Math.round(z);
  if (!(teeth >= 9 && teeth <= 120)) throw new Error('La rueda necesita entre 9 y 120 dientes.');
  const n = Math.max(1, Math.min(3, Math.round(strands)));
  const rp = c.p / (2 * Math.sin(Math.PI / teeth));
  const ri = 0.505 * c.d1 + 0.069 * Math.cbrt(c.d1); // radio del asiento del rodillo
  const da = c.p * (0.6 + 1 / Math.tan(Math.PI / teeth)); // Ø exterior máximo
  const df = 2 * rp - 2 * ri; // Ø de pie
  const tooth = (c.p > 12.7 ? 0.95 : 0.93) * c.b1; // ancho del diente por hilera
  return { ...c, chain, z: teeth, strands: n, rp, ri, da, df, tooth, width: round((n - 1) * c.pt + tooth, 3), pitchDiameter: 2 * rp };
}

// Contorno cerrado (antihorario) en coordenadas del plano, centrado en (cx, cy); el asiento 0 queda sobre el ángulo `phaseDeg`.
export function sprocketOutline(geo, { cx = 0, cy = 0, phaseDeg = 0, arcSteps = 8 } = {}) {
  const { z, rp, ri, da } = geo;
  const step = TAU / z;
  const gamma = rad(70 - 45 / z); // semiángulo del asiento
  const rt = da / 2;
  const tipHalf = Math.min((0.12 * geo.p) / rt / 2, step * 0.2);
  const pts = [];
  for (let i = 0; i < z; i += 1) {
    const phi = rad(phaseDeg) + i * step;
    const [ox, oy] = [rp * Math.cos(phi), rp * Math.sin(phi)];
    for (let k = 0; k <= arcSteps; k += 1) {
      const s = gamma - (2 * gamma * k) / arcSteps;
      const a = phi + Math.PI + s;
      pts.push([ox + ri * Math.cos(a), oy + ri * Math.sin(a)]);
    }
    const mid = phi + step / 2;
    pts.push([rt * Math.cos(mid - tipHalf), rt * Math.sin(mid - tipHalf)], [rt * Math.cos(mid + tipHalf), rt * Math.sin(mid + tipHalf)]);
  }
  return pts.map(([x, y]) => [round(cx + x, 4), round(cy + y, 4)]);
}

export const outlineArea = (pts) => Math.abs(pts.reduce((sum, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return sum + (x * ny - nx * y); }, 0)) / 2;

// Eslabones de la cadena (a redondear al par superior) para una distancia de centros C.
export const chainLinks = (z1, z2, c, p) => (2 * c) / p + (z1 + z2) / 2 + (((z2 - z1) / TAU) ** 2 * p) / c;
// Distancia de centros exacta para un número de eslabones L.
export function centerForLinks(z1, z2, links, p) {
  const m = links - (z1 + z2) / 2;
  const disc = m * m - 8 * ((z2 - z1) / TAU) ** 2;
  if (disc < 0) throw new Error('Con tantos eslabones la cadena no cierra: usá más eslabones.');
  return (p / 4) * (m + Math.sqrt(disc));
}
// Distancia pedida → eslabones pares y distancia real resultante.
export function chainLayout(z1, z2, requested, p) {
  const minC = (Math.max(z1, z2) * p) / Math.PI * 0.6 + p; // evita que se toquen los dientes
  let links = Math.ceil(chainLinks(z1, z2, Math.max(requested, minC), p) / 2) * 2;
  let c = centerForLinks(z1, z2, links, p);
  while (c < minC) { links += 2; c = centerForLinks(z1, z2, links, p); }
  return { links, center: round(c, 3) };
}

const FRAME_KEYS = ['plane', 'offset', 'rot'];
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const lastId = (state) => state.features[state.features.length - 1].id;

// Agrega una rueda de cadena a la pieza: contorno (boceto + extrusión), cubo y agujero. La extrusión del dentado lleva
// `sprocket` con los datos para poder armar el par. `frame` copia plano/desplazamiento/rotación de otra rueda (para el par).
export function addSprocket(state, { chain = '08B', z = 19, strands = 1, bore = 20, x = 0, y = 0, plane = 'XY', offset = 0, rot, phaseDeg = 0, move, turn } = {}) {
  const geo = sprocketGeometry({ chain, z, strands });
  const frame = { plane, offset, ...(rot ? { rot: clone(rot) } : {}) };
  const hole = Math.max(0, Math.min(bore, geo.df - 4));
  const hubDia = Math.min(Math.max(hole * 1.8, hole + 12), geo.df - 3);
  const hubLen = Math.max(geo.width + 6, hole);
  const extra = { ...(move ? { move: clone(move) } : {}), ...(turn ? { turn: clone(turn) } : {}) };
  let next = commands.addFeature(state, 'sketch', frame);
  let sketchId = lastId(next);
  next = commands.addEntity(next, sketchId, { t: 'poly', pts: sprocketOutline(geo, { cx: x, cy: y, phaseDeg }).map(([px, py]) => ({ x: px, y: py, bulge: 0 })) });
  next = commands.addFeature(next, 'extrude', { sketch: sketchId, depth: geo.width, mode: 'add', name: `Rueda ${geo.z}z ${chainTable[chain].label}${geo.strands > 1 ? ` ×${geo.strands}` : ''}`, sprocket: { chain, z: geo.z, strands: geo.strands, x, y, bore: hole, phaseDeg }, ...extra });
  const toothId = lastId(next);
  if (hubDia > hole + 1) {
    next = commands.addFeature(next, 'sketch', { ...frame, offset: Number(offset) + geo.width });
    sketchId = lastId(next);
    next = commands.addEntity(next, sketchId, { t: 'circle', x, y, d: round(hubDia, 3) });
    next = commands.addFeature(next, 'extrude', { sketch: sketchId, depth: round(hubLen - 0, 3), mode: 'add', ...extra });
  }
  if (hole > 0) {
    next = commands.addFeature(next, 'sketch', frame);
    sketchId = lastId(next);
    next = commands.addEntity(next, sketchId, { t: 'circle', x, y, d: hole });
    next = commands.addFeature(next, 'extrude', { sketch: sketchId, depth: 10, mode: 'cut', through: true, ...extra });
  }
  return { state: next, toothId, geo };
}

// Centro y eje del piñón en coordenadas del conjunto de la pieza (para la acción de giro).
function sprocketPose(state, toothFeature, params) {
  const sketch = state.features.find((item) => item.id === toothFeature.sketch);
  const { x, y } = toothFeature.sprocket;
  const frame = planeFrame(null, sketch, params);
  const turn = featureTurn(toothFeature, params);
  const move = Array.isArray(toothFeature.move) ? toothFeature.move : [0, 0, 0];
  const center = turnPoint(turn, [0, 1, 2].map((i) => frame.origin[i] + x * frame.xDir[i] + y * frame.yDir[i])).map((v, i) => round(v + (Number(move[i]) || 0), 3));
  return { center, axis: turnVector(turn, frame.normal).map((v) => round(v, 6)), frame, turn };
}

// Par de piñones: agrega la segunda rueda a la distancia de centros pedida (corregida a eslabones pares) y las acciones enlazadas.
// opts: { teeth, distance, thetaDeg, bore, rpm }.
export function addSprocketPair(state, toothId, params, opts = {}) {
  const tooth = state.features.find((item) => item.id === toothId && item.sprocket);
  if (!tooth) throw new Error('Elegí la extrusión del dentado de una rueda de cadena.');
  const s = tooth.sprocket;
  const geo = sprocketGeometry(s);
  const z2 = Math.round(Number(opts.teeth));
  const geo2 = sprocketGeometry({ chain: s.chain, z: z2, strands: s.strands });
  const requested = Number(opts.distance);
  if (!(requested > 0)) throw new Error('Indicá la distancia entre centros (mm).');
  const layout = chainLayout(geo.z, geo2.z, requested, geo.p);
  const theta = rad(Number(opts.thetaDeg) || 0);
  const sketch = state.features.find((item) => item.id === tooth.sketch);
  const frame = {};
  FRAME_KEYS.forEach((key) => { if (sketch[key] !== undefined) frame[key] = clone(sketch[key]); });
  const made = addSprocket(state, { chain: s.chain, z: z2, strands: s.strands, bore: Number(opts.bore) || s.bore, x: round(s.x + layout.center * Math.cos(theta), 4), y: round(s.y + layout.center * Math.sin(theta), 4), ...frame, move: tooth.move, turn: tooth.turn });
  let next = made.state;
  const pose1 = sprocketPose(next, tooth, params);
  const pose2 = sprocketPose(next, next.features.find((item) => item.id === made.toothId), params);
  let scene = sceneOf(next);
  let master = scene.actions.find((a) => a.kind === 'rotate' && a.mode !== 'follow' && a.targets?.length === 1 && a.targets[0] === toothId);
  let masterId = master?.id;
  if (!master) {
    const first = sceneOps.addAction(scene, 'rotate', { name: 'Giro de la rueda motriz', targets: [toothId], axis: pose1.axis, pivot: pose1.center, mode: 'continuous', rpm: Number(opts.rpm) || 60 });
    scene = first.scene;
    masterId = first.id;
  }
  const follow = sceneOps.addAction(scene, 'rotate', { name: 'Giro de la rueda conducida (cadena)', targets: [made.toothId], axis: pose2.axis, pivot: pose2.center, mode: 'follow', link: { master: masterId, type: 'correa', a: geo.z, b: geo2.z, ratio: 1, eff: 0.95, inertia: 0, pitch: 100 } });
  next = { ...next, ...sceneFields(follow.scene) };
  return { state: next, mateToothId: made.toothId, links: layout.links, center: layout.center, requested, masterId, followId: follow.id, ratio: geo.z / geo2.z };
}
