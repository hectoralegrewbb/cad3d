import { PartBuilder, circle, numberArg, onCircle, poly, rect, slot } from './helpers.js';
import { keyFor } from '../templates.js';
import { iecRow, wormRow } from './tables.js';
import { addSprocket, chainIds, chainTable } from '../../core/sprocket.js';
import { createPart } from '../../core/partModel.js';

const category = 'Transmisión y mecánica';
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);

// Chavetero en un cubo: ranura rectangular desde el agujero hacia afuera, de largo total `top` (z desde `from` hasta `top`).
function hubKeyway(b, bore, zTop, depthZ) {
  const key = keyFor(Math.min(75, Math.max(6.1, bore)));
  const t2 = key.h - key.t1 + 0.2;
  b.cut('XY', zTop, [rect(t2 + 1, key.b, bore / 2 + (t2 - 1) / 2, 0)], depthZ);
  return key;
}

const vBelts = { SPZ: { w: 8.5, h: 9, e: 12, f: 8, a: 34 }, SPA: { w: 11, h: 11, e: 15, f: 10, a: 34 }, SPB: { w: 14, h: 14, e: 19, f: 12.5, a: 36 }, SPC: { w: 19, h: 18, e: 25.5, f: 17, a: 36 } };

export const transmissionItems = [
  {
    id: 'polea-v', category, label: 'Polea en V (correa trapecial SPZ / SPA / SPB / SPC)',
    ask: [{ name: 'dp', label: 'Diámetro primitivo (mm)', value: 125 }, { name: 'bore', label: 'Agujero (mm)', value: 28 }, { name: 'grooves', label: 'Cantidad de canales', value: 2 }, { name: 'profile', label: 'Perfil: 1=SPZ 2=SPA 3=SPB 4=SPC', value: 2 }],
    description: 'Disco con canales en V y chavetero normalizado en el cubo. Aligerada con agujeros si es grande.',
    build({ dp, bore, grooves, profile } = {}) {
      const name = ['SPZ', 'SPA', 'SPB', 'SPC'][Math.max(1, Math.min(4, Math.round(numberArg(profile, 2)))) - 1];
      const p = vBelts[name];
      const Dp = numberArg(dp, 125);
      const hole = numberArg(bore, 28);
      const n = Math.max(1, Math.min(6, Math.round(numberArg(grooves, 2))));
      const Ro = Dp / 2 + p.h * 0.18;
      const W = 2 * p.f + (n - 1) * p.e;
      const bottomW = Math.max(2, p.w - 2 * p.h * Math.tan((p.a / 2) * (Math.PI / 180)));
      const pts = [[hole / 2, 0], [Ro, 0]];
      let outer = [];
      for (let i = 0; i < n; i += 1) {
        const zc = p.f + i * p.e;
        outer.push([Ro, zc - p.w / 2], [Ro - p.h, zc - bottomW / 2], [Ro - p.h, zc + bottomW / 2], [Ro, zc + p.w / 2]);
      }
      pts.push(...outer, [Ro, W], [hole / 2, W]);
      const b = new PartBuilder(`Polea ${name} Ø${Dp}×${n}c`, [['Dp', Dp], ['bore', hole], ['W', W]]);
      b.lathe(pts);
      hubKeyway(b, hole, 'W', 'W+1');
      if (Ro > 60) {
        const hub = hole * 1.9;
        const mid = (Ro - p.h + hub / 2) / 2;
        const dia = Math.max(8, (Ro - p.h - hub / 2) * 0.55);
        b.cut('XY', 'W', onCircle(6, mid, 30).map(([x, y]) => circle(dia, x, y)), 'W+1');
      }
      return b.build();
    },
    expect: { bbox: [null, null, 35], tol: 0.5 },
  },
  {
    id: 'polea-dentada', category, label: 'Polea dentada HTD / T5 con bridas',
    ask: [{ name: 'z', label: 'Cantidad de dientes', value: 30 }, { name: 'pitch', label: 'Paso de la correa (5, 8 mm)', value: 5 }, { name: 'width', label: 'Ancho de correa (mm)', value: 15 }, { name: 'bore', label: 'Agujero (mm)', value: 14 }],
    build({ z, pitch, width, bore } = {}) {
      const teeth = Math.max(10, Math.min(120, Math.round(numberArg(z, 30))));
      const p = numberArg(pitch, 5) >= 6.5 ? 8 : 5;
      const w = numberArg(width, 15);
      const hole = numberArg(bore, 14);
      const pd = (teeth * p) / Math.PI;
      const od = pd - (p === 5 ? 0.9 : 1.4);
      const toothD = p === 5 ? 3.0 : 4.6;
      const flange = od + 2 * (p === 5 ? 2 : 3);
      const hub = Math.min(od - 4, Math.max(hole * 1.8, hole + 10));
      const hubL = w + 2 * 1.5 + 6;
      const b = new PartBuilder(`Polea HTD${p}M ${teeth}z`, [['od', od], ['W', w], ['bore', hole], ['flange', flange]]);
      b.lathe([[hole / 2, 0], [flange / 2, 0], [flange / 2, 1.5], [od / 2, 1.5], [od / 2, 1.5 + w], [flange / 2, 1.5 + w], [flange / 2, 3 + w], [hub / 2, 3 + w], [hub / 2, hubL], [hole / 2, hubL]]);
      b.cut('XY', 1.5 + w, onCircle(teeth, od / 2 + 0.2, 0).map(([x, y]) => circle(toothD, x, y)), w); // solo entre las bridas
      hubKeyway(b, hole, hubL, 3);
      return b.build();
    },
  },
  {
    id: 'rueda-cadena', category, label: 'Rueda dentada para cadena de rodillos (ISO 606 / ANSI, simple a triple)',
    ask: [
      { name: 'chain', label: `Cadena (número): ${chainIds.map((id, k) => `${k + 1}=${chainTable[id].label}`).join(' · ')}`, value: 3 },
      { name: 'z', label: 'Cantidad de dientes (9–120)', value: 19 },
      { name: 'strands', label: 'Hileras (1=simple, 2=doble, 3=triple)', value: 1 },
      { name: 'bore', label: 'Agujero (mm)', value: 20 },
    ],
    description: 'Perfil de diente con asiento de rodillo según el paso, cubo y agujero. Con el botón «Armar par» de Propiedades se genera la rueda conducida a la distancia de centros pedida (eslabones pares) con el giro enlazado.',
    build({ chain, z, strands, bore } = {}) {
      const id = chainIds[Math.max(0, Math.min(chainIds.length - 1, Math.round(numberArg(chain, 3)) - 1))];
      const made = addSprocket(createPart('Rueda cadena'), { chain: id, z: Math.round(numberArg(z, 19)), strands: Math.round(numberArg(strands, 1)), bore: numberArg(bore, 20) });
      return { ...made.state, meta: { ...made.state.meta, name: `Rueda cadena ${made.geo.z}z ${chainTable[id].label}${made.geo.strands > 1 ? ` ×${made.geo.strands}` : ''}` } };
    },
  },
  {
    id: 'engranaje-recto', category, label: 'Engranaje recto de evolvente con cubo y chavetero',
    ask: [{ name: 'm', label: 'Módulo (mm)', value: 2 }, { name: 'z', label: 'Cantidad de dientes', value: 24 }, { name: 'width', label: 'Ancho (mm)', value: 20 }, { name: 'bore', label: 'Agujero (mm)', value: 20 }],
    build({ m, z, width, bore } = {}) {
      const mod = numberArg(m, 2);
      const teeth = Math.max(8, Math.min(120, Math.round(numberArg(z, 24))));
      const w = numberArg(width, 20);
      const hole = numberArg(bore, 20);
      const b = new PartBuilder(`Engranaje m${mod} z${teeth}`, [['m', mod], ['z', teeth], ['w', w], ['bore', 0]]);
      b.feature('gear', { m: 'm', z: 'z', width: 'w', bore: hole, hub: Math.min(mod * teeth * 0.5, Math.max(hole * 1.8, hole + 10)), hubWidth: Math.round(w * 0.5), alpha: 20 });
      hubKeyway(b, hole, 'w+' + Math.round(w * 0.5), 'w+' + Math.round(w * 0.5) + '+1');
      return b.build();
    },
  },
  {
    id: 'cremallera', category, label: 'Cremallera (engrana con un piñón del mismo módulo)',
    ask: [{ name: 'm', label: 'Módulo (mm)', value: 2 }, { name: 'teeth', label: 'Cantidad de dientes', value: 20 }, { name: 'width', label: 'Ancho (mm)', value: 20 }, { name: 'height', label: 'Altura de la barra bajo el pie (mm)', value: 15 }],
    build({ m, teeth, width, height } = {}) {
      const mod = numberArg(m, 2);
      const n = Math.max(3, Math.min(100, Math.round(numberArg(teeth, 20))));
      const w = numberArg(width, 20);
      const base = numberArg(height, 15);
      const p = Math.PI * mod;
      const add = mod;
      const ded = 1.25 * mod;
      const t = Math.tan((20 * Math.PI) / 180);
      const pts = [[0, -base], [n * p, -base], [n * p, -ded]];
      for (let i = n - 1; i >= 0; i -= 1) {
        const x0 = i * p;
        // diente simétrico: raíz en −ded, cabeza en +add (ancho de cabeza ≈ 0,35·p con flancos a 20°)
        pts.push([x0 + p - (p / 4 - t * ded) + 0, -ded], [x0 + p / 2 + (p / 4 - t * add), add], [x0 + p / 2 - (p / 4 - t * add), add], [x0 + p / 4 - t * ded, -ded]);
      }
      pts.push([0, -ded]);
      const dedup = pts.filter((pt, i) => i === 0 || Math.hypot(pt[0] - pts[i - 1][0], pt[1] - pts[i - 1][1]) > 1e-6);
      const b = new PartBuilder(`Cremallera m${mod} ×${n}`, [['m', mod], ['W', w]]);
      b.add('XZ', 0, [poly(dedup)], 'W', { symmetric: true });
      return b.build();
    },
  },
  {
    id: 'acople-mordazas', category, label: 'Acople elástico de mordazas (jaw coupling) con araña',
    ask: [{ name: 'size', label: 'Tamaño: 14, 19, 24, 28, 38, 42', value: 28 }, { name: 'bore1', label: 'Agujero lado 1 (mm)', value: 20 }, { name: 'bore2', label: 'Agujero lado 2 (mm)', value: 24 }],
    build({ size, bore1, bore2 } = {}) {
      const table = { 14: [30, 35, 11, 16], 19: [40, 52, 16, 18], 24: [55, 66, 18, 24], 28: [65, 78, 20, 30], 38: [80, 90, 24, 40], 42: [95, 114, 28, 46] };
      const key = nearest(Object.keys(table).map(Number), numberArg(size, 28));
      const [OD, L, spider, maxBore] = table[key];
      const b1 = Math.min(numberArg(bore1, 20), maxBore);
      const b2 = Math.min(numberArg(bore2, 24), maxBore);
      const half = (L - spider) / 2;
      const b = new PartBuilder(`Acople mordazas GR${key}`, [['OD', OD], ['L', L], ['sp', spider], ['half', half], ['b1', b1], ['b2', b2]]);
      b.add('XY', 0, [circle('OD*0.82'), circle('b1')], 'half');
      b.add('XY', 'half', [circle('OD*0.66')], 'sp');
      b.add('XY', 'half+sp', [circle('OD*0.82'), circle('b2')], 'half');
      b.add('XY', 'half-0.1', [circle('OD*0.92'), circle('OD*0.40')], 'sp+0.2');
      b.cut('XY', 'half', [circle('OD*0.66')], 'sp+0.0001', { through: false });
      b.cut('XZ', 0, [circle(5, 0, 'half*0.5')], 'OD', { through: false });
      return b.build();
    },
  },
  {
    id: 'collar-fijacion', category, label: 'Collar de fijación (aro con prisionero)',
    ask: [{ name: 'd', label: 'Diámetro del eje (mm)', value: 25 }],
    build({ d } = {}) {
      const dia = numberArg(d, 25);
      const OD = Math.round(dia * 1.8 * 10) / 10;
      const W = Math.max(8, Math.round(dia * 0.6));
      const b = new PartBuilder(`Collar Ø${dia}`, [['d', dia], ['OD', OD], ['W', W]]);
      b.add('XY', 0, [circle('OD'), circle('d')], 'W');
      b.chamfer(0.8, 'circles');
      b.cut('XZ', 0, [circle('d*0.28', 0, 'W/2')], 'OD', { reverse: true });
      return b.build();
    },
    expect: { bbox: [45, 45, 15] },
  },
  {
    id: 'rodillo-transportador', category, label: 'Rodillo de transporte (tubo con tapas y eje con planos)',
    ask: [{ name: 'd', label: 'Diámetro del tubo (mm)', value: 50 }, { name: 'length', label: 'Largo del tubo (mm)', value: 400 }, { name: 'shaft', label: 'Diámetro del eje (mm)', value: 12 }],
    description: 'Tubo de acero con tapas de rodamiento y eje pasante con dos planos en cada extremo. El tubo es una operación separada: sirve para animarlo con una acción de giro.',
    build({ d, length, shaft } = {}) {
      const D = numberArg(d, 50);
      const L = numberArg(length, 400);
      const s = numberArg(shaft, 12);
      const wall = Math.max(1.5, Math.round(D * 0.04 * 10) / 10);
      const b = new PartBuilder(`Rodillo Ø${D}×${L}`, [['D', D], ['L', L], ['sh', s], ['wall', wall], ['ext', 22]]);
      b.add('XY', 0, [circle('D'), circle('D-2*wall')], 'L');
      b.add('XY', 4, [circle('D-2*wall+0.4'), circle('sh+10')], 8);
      b.add('XY', 'L-12', [circle('D-2*wall+0.4'), circle('sh+10')], 8);
      b.add('XY', '-ext', [circle('sh')], 'L+2*ext');
      b.cut('XZ', 'sh*0.36', [rect('sh', 'ext*0.9', 0, '-ext*0.55')], 'sh');
      return b.build();
    },
    expect: { bbox: [50, 50, 444], tol: 0.5 },
  },
  {
    id: 'tambor-cinta', category, label: 'Tambor para cinta transportadora (con abombado)',
    ask: [{ name: 'd', label: 'Diámetro del tambor (mm)', value: 160 }, { name: 'width', label: 'Ancho de cinta (mm)', value: 500 }, { name: 'shaft', label: 'Diámetro del eje (mm)', value: 40 }],
    build({ d, width, shaft } = {}) {
      const D = numberArg(d, 160);
      const W = numberArg(width, 500);
      const s = numberArg(shaft, 40);
      const crown = Math.max(0.5, Math.round(D * 0.004 * 10) / 10);
      const hubW = Math.round(s * 1.0);
      const b = new PartBuilder(`Tambor Ø${D}×${W}`, [['D', D], ['W', W], ['sh', s]]);
      const shell = Math.max(6, Math.round(D * 0.04));
      b.lathe([[D / 2 - shell, 0], [D / 2 - crown, 0], [D / 2, W * 0.25], [D / 2, W * 0.75], [D / 2 - crown, W], [D / 2 - shell, W]]);
      b.add('XY', 'W*0', [circle('D-2*' + shell), circle('sh*1.8')], 12);
      b.add('XY', 'W-12', [circle('D-2*' + shell), circle('sh*1.8')], 12);
      b.add('XY', '-60', [circle('sh')], 'W+120');
      b.add('XY', 0, [circle('sh*1.8'), circle('sh')], hubW);
      b.add('XY', 'W-' + hubW, [circle('sh*1.8'), circle('sh')], hubW);
      return b.build();
    },
    expect: { bbox: [160, 160, 620] },
  },
  {
    id: 'reductor-sinfin', category, label: 'Motorreductor de sinfín-corona tipo NMRV (carcasa y ejes)',
    ask: [{ name: 'size', label: 'Tamaño (30, 40, 50, 63, 75, 90)', value: 50 }],
    description: 'Carcasa con eje de salida macizo hacia +X, brida de entrada para el motor hacia +Y y base con agujeros. El eje de salida queda en el origen.',
    build({ size } = {}) {
      const r = wormRow(numberArg(size, 50));
      const b = new PartBuilder(`Reductor NMRV${r.size}`, [['a', r.a], ['w', r.w], ['h', r.h], ['l', r.l], ['out', r.out], ['outL', r.outL], ['inD', r.inD], ['fl', r.flange]]);
      b.add('XY', '-h/2', [rect('w', 'l')], 'h');
      b.fillet('w*0.12', 'vertical');
      // eje de salida hacia +X (y un resalte del lado opuesto)
      b.add('YZ', 'w/2-1', [circle('out*1.7')], 9);
      b.add('YZ', 'w/2+8', [circle('out')], 'outL');
      b.add('YZ', '-w/2+1', [circle('out*1.7')], 9, { reverse: true });
      // entrada hacia +Y: brida cuadrada, centrado y eje del sinfín
      b.add('XZ', '-(l/2-1)', [rect('fl*0.85', 'fl*0.85', 0, 'a*0.0')], 7, { reverse: true });
      b.add('XZ', '-(l/2+6)', [circle('fl*0.6')], 4, { reverse: true });
      b.add('XZ', '-(l/2+10)', [circle('inD')], 'inD*1.8', { reverse: true });
      // base con cuatro agujeros
      b.add('XY', '-h/2-8', [rect('w*1.25', 'l*1.1')], 8.5);
      b.cut('XY', '-h/2', [circle(9, 'w*0.55', 'l*0.47'), circle(9, '-w*0.55', 'l*0.47'), circle(9, 'w*0.55', '-l*0.47'), circle(9, '-w*0.55', '-l*0.47')], 12, { through: true });
      return b.build();
    },
  },
  ...['b3', 'b5'].map((mount) => ({
    id: `motor-iec-${mount}`, category,
    label: mount === 'b3' ? 'Motor trifásico IEC con patas (B3)' : 'Motor trifásico IEC con brida (B5)',
    ask: [{ name: 'frame', label: 'Carcasa IEC: 63, 71, 80, 90, 100, 112, 132, 160', value: 90 }],
    description: 'Carcasa, caja de bornes, tapa de ventilador, eje y patas o brida normalizadas. Eje a lo largo de −Z desde z = 0 (lado del eje); la carcasa va hacia +Z y la caja de bornes hacia +Y.',
    build({ frame } = {}) {
      const r = iecRow(numberArg(frame, 90));
      const flange = { 63: [140, 95, 115, 9.5], 71: [160, 110, 130, 9.5], 80: [200, 130, 165, 11.5], 90: [200, 130, 165, 11.5], 100: [250, 180, 215, 14], 112: [250, 180, 215, 14], 132: [300, 230, 265, 14], 160: [350, 250, 300, 18] }[r.frame];
      const [P, N, M, S] = flange;
      const lead = mount === 'b5' ? 14 : 0; // la brida y su centrador adelantan la cara de salida
      const b = new PartBuilder(`Motor IEC ${r.frame} ${mount.toUpperCase()}`, [['H', r.h], ['d', r.d], ['E', r.e], ['AC', r.ac], ['Lc', r.l], ['A', r.a], ['B', r.b], ['C', r.c], ['K', r.k], ['tf', 12]]);
      b.lathe([[0, 0], ['AC/2-4', 0], ['AC/2', 5], ['AC/2', 'Lc*0.82'], ['AC/2*0.9', 'Lc*0.84'], ['AC/2*0.9', 'Lc'], [0, 'Lc']]);
      b.add('XZ', '-(AC/2-8)', [rect('AC*0.5', 'Lc*0.28', 0, 'Lc*0.45')], 'AC*0.3', { reverse: true });
      b.add('XY', 0, [circle('d')], r.e + lead, { reverse: true });
      b.add('XY', 0, [circle('d*1.55')], 5 + lead * 0, { reverse: true });
      if (mount === 'b3') {
        b.add('XZ', 'H', [rect('A+3*K', 'B+3*K', 0, 'C+B/2')], 'H-AC*0.3', { reverse: true });
        b.cut('XZ', 'H', [circle('K', 'A/2', 'C'), circle('K', '-A/2', 'C'), circle('K', 'A/2', 'C+B'), circle('K', '-A/2', 'C+B')], 'K*2', { reverse: true });
      } else {
        b.add('XY', 2, [circle(P)], 12, { reverse: true });
        b.add('XY', -10, [circle(N)], 4, { reverse: true });
        b.cut('XY', 2, onCircle(4, M / 2, 45).map(([x, y]) => circle(S, x, y)), 12, { through: true });
      }
      return b.build();
    },
  })),
];
