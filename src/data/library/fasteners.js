import { PartBuilder, circle, hexagon, numberArg, poly, rect, slot, onCircle } from './helpers.js';
import { isoRow } from './tables.js';

const category = 'Tornillería y fijación';
const askBolt = (d = 10, length = 40) => [{ name: 'd', label: 'Rosca M (diámetro nominal, mm)', value: d }, { name: 'length', label: 'Largo del vástago (mm)', value: length }];
const askSize = (d = 10) => [{ name: 'd', label: 'Rosca M (diámetro nominal, mm)', value: d }];
const cname = (prefix, row, extra = '') => `${prefix} M${row.d}${extra}`;

export const fasteners = [
  {
    id: 'tornillo-hex', category, label: 'Tornillo hexagonal ISO 4017', ask: askBolt(),
    description: 'Cabeza hexagonal, vástago liso del diámetro nominal. Cabeza sobre z = 0, vástago hacia −Z.',
    build({ d, length } = {}) {
      const r = isoRow(numberArg(d, 10));
      const L = numberArg(length, 40);
      const b = new PartBuilder(`${cname('Tornillo hexagonal', r)}×${L}`, [['d', r.d], ['L', L], ['s', r.s], ['k', r.k]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [hexagon('s')], 'k');
      return b.build();
    },
    expect: { bbox: [null, null, 46.4] },
  },
  {
    id: 'tornillo-allen', category, label: 'Tornillo Allen cabeza cilíndrica ISO 4762', ask: askBolt(),
    build({ d, length } = {}) {
      const r = isoRow(numberArg(d, 10));
      const L = numberArg(length, 40);
      const b = new PartBuilder(`${cname('Tornillo Allen', r)}×${L}`, [['d', r.d], ['L', L], ['dk', r.dk], ['k', r.d], ['sk', r.sk]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [circle('dk')], 'k');
      b.cut('XY', 'k', [hexagon('sk')], 'k*0.55');
      b.chamfer(0.4, 'top');
      return b.build();
    },
    expect: { bbox: [16, 16, 50] },
  },
  {
    id: 'tornillo-avellanado', category, label: 'Tornillo Allen avellanado ISO 10642', ask: askBolt(10, 40),
    build({ d, length } = {}) {
      const r = isoRow(Math.max(6, numberArg(d, 10)));
      const L = numberArg(length, 40);
      const b = new PartBuilder(`${cname('Tornillo avellanado', r)}×${L}`, [['d', r.d], ['L', L], ['dk', r.dkc], ['k', r.kc], ['sk', r.skc]]);
      b.lathe([[0, -L], [r.d / 2, -L], [r.d / 2, 0], [r.dkc / 2, r.kc], [0, r.kc]]);
      b.cut('XY', 'k', [hexagon('sk')], 'k*0.6');
      return b.build();
    },
    expect: { bbox: [20, 20, 45.5] },
  },
  {
    id: 'tornillo-boton', category, label: 'Tornillo Allen cabeza bombé (botón) ISO 7380', ask: askBolt(8, 25),
    build({ d, length } = {}) {
      const r = isoRow(numberArg(d, 8));
      const L = numberArg(length, 25);
      const b = new PartBuilder(`${cname('Tornillo botón', r)}×${L}`, [['d', r.d], ['L', L], ['dk', Math.round(r.d * 1.75 * 10) / 10], ['k', Math.round(r.d * 0.55 * 10) / 10], ['sk', Math.max(2, Math.round(r.d * 0.5))]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [circle('dk')], 'k');
      b.fillet('k*0.7', 'top');
      b.cut('XY', 'k', [hexagon('sk')], 'k*0.6');
      return b.build();
    },
    expect: { bbox: [14, 14, 29.4], tol: 0.7 },
  },
  {
    id: 'prisionero', category, label: 'Prisionero (tornillo sin cabeza) ISO 4026', ask: askBolt(8, 12),
    build({ d, length } = {}) {
      const r = isoRow(numberArg(d, 8));
      const L = numberArg(length, 12);
      const b = new PartBuilder(`Prisionero M${r.d}×${L}`, [['d', r.d], ['L', L], ['sk', Math.max(1.5, Math.round(r.d * 0.5 * 2) / 2)]]);
      b.add('XY', 0, [circle('d')], 'L');
      b.cut('XY', 'L', [hexagon('sk')], 'd*0.6');
      b.chamfer(0.5, 'bottom');
      return b.build();
    },
    expect: { bbox: [8, 8, 12] },
  },
  {
    id: 'esparrago', category, label: 'Espárrago / varilla roscada DIN 975', ask: askBolt(10, 100),
    build({ d, length } = {}) {
      const r = isoRow(numberArg(d, 10));
      const L = numberArg(length, 100);
      const b = new PartBuilder(`Varilla roscada M${r.d}×${L}`, [['d', r.d], ['L', L]]);
      b.add('XY', 0, [circle('d')], 'L');
      b.chamfer(0.7, 'circles');
      return b.build();
    },
    expect: { bbox: [10, 10, 100] },
  },
  {
    id: 'tuerca-hex', category, label: 'Tuerca hexagonal ISO 4032', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const b = new PartBuilder(cname('Tuerca hexagonal', r), [['d', r.d], ['s', r.s], ['m', r.m]]);
      b.add('XY', 0, [hexagon('s'), circle('d')], 'm');
      b.chamfer(0.5, 'circles');
      return b.build();
    },
    expect: { bbox: [null, null, 8.4] },
  },
  {
    id: 'tuerca-autofrenante', category, label: 'Tuerca autofrenante con inserto de nailon DIN 985', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const hCap = Math.round(r.d * 0.45 * 10) / 10;
      const b = new PartBuilder(cname('Tuerca autofrenante', r), [['d', r.d], ['s', r.s], ['m', r.m], ['hc', hCap]]);
      b.add('XY', 0, [hexagon('s'), circle('d')], 'm');
      b.add('XY', 'm', [circle('s*0.95'), circle('d')], 'hc');
      return b.build();
    },
    expect: { bbox: [null, null, 12.9], tol: 0.2 },
  },
  {
    id: 'tuerca-cuadrada', category, label: 'Tuerca cuadrada DIN 557', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const b = new PartBuilder(cname('Tuerca cuadrada', r), [['d', r.d], ['s', r.s], ['m', Math.round(r.d * 0.8 * 10) / 10]]);
      b.add('XY', 0, [rect('s', 's'), circle('d')], 'm');
      return b.build();
    },
    expect: { bbox: [16, 16, 8] },
  },
  {
    id: 'arandela-plana', category, label: 'Arandela plana ISO 7089', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const b = new PartBuilder(cname('Arandela', r), [['d1', r.w1], ['d2', r.w2], ['h', r.wh]]);
      b.add('XY', 0, [circle('d2'), circle('d1')], 'h');
      return b.build();
    },
    expect: { bbox: [20, 20, 2] },
  },
  {
    id: 'arandela-grande', category, label: 'Arandela ancha ISO 7093', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const b = new PartBuilder(cname('Arandela ancha', r), [['d1', r.w1], ['d2', r.d * 3], ['h', Math.max(1, Math.round(r.d * 0.2 * 10) / 10)]]);
      b.add('XY', 0, [circle('d2'), circle('d1')], 'h');
      return b.build();
    },
    expect: { bbox: [30, 30, 2] },
  },
  {
    id: 'arandela-grower', category, label: 'Arandela de presión (Grower) DIN 127', ask: askSize(),
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const di = r.d + 0.2;
      const b = new PartBuilder(cname('Arandela Grower', r), [['d1', di], ['d2', Math.round((r.d * 1.7 + 1.5) * 10) / 10], ['h', Math.max(1, Math.round(r.d * 0.22 * 10) / 10)]]);
      b.add('XY', 0, [circle('d2'), circle('d1')], 'h');
      b.cut('XY', 'h', [rect('d2/2', 0.6, 'd2/4+d1/4', 0)], 'h');
      return b.build();
    },
    expect: { bbox: [18.5, 18.5, 2.2], tol: 0.6 },
  },
  {
    id: 'pasador-horquilla', category, label: 'Pasador de horquilla con cabeza ISO 2341', ask: [{ name: 'd', label: 'Diámetro del pasador (mm)', value: 10 }, { name: 'length', label: 'Largo útil (mm)', value: 40 }],
    build({ d, length } = {}) {
      const dia = numberArg(d, 10);
      const L = numberArg(length, 40);
      const b = new PartBuilder(`Pasador Ø${dia}×${L}`, [['d', dia], ['L', L], ['dk', dia * 1.6], ['k', Math.max(2, dia * 0.2)], ['hole', Math.max(2, Math.round(dia * 0.2 * 2) / 2)]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [circle('dk')], 'k');
      b.chamfer(0.5, 'bottom');
      // agujero transversal para el pasador de aletas, a 2 d del extremo
      b.cut('YZ', '-d', [circle('hole', 0, '-L+d*1.2')], '2*d', { through: true, symmetric: true, reverse: false });
      return b.build();
    },
    expect: { bbox: [16, 16, 42] },
  },
  {
    id: 'pasador-elastico', category, label: 'Pasador elástico (tubo ranurado) ISO 8752', ask: [{ name: 'd', label: 'Diámetro (mm)', value: 6 }, { name: 'length', label: 'Largo (mm)', value: 30 }],
    build({ d, length } = {}) {
      const dia = numberArg(d, 6);
      const L = numberArg(length, 30);
      const wall = Math.max(0.5, Math.round(dia * 0.18 * 10) / 10);
      const b = new PartBuilder(`Pasador elástico Ø${dia}×${L}`, [['d', dia], ['L', L], ['t', wall]]);
      b.add('XY', 0, [circle('d'), circle('d-2*t')], 'L');
      b.cut('XY', 'L', [rect('d/2', 'd*0.12', 'd/4', 0)], 'L', { through: true });
      b.chamfer(0.3, 'circles');
      return b.build();
    },
    expect: { bbox: [6, 6, 30] },
  },
  {
    id: 'seeger-externo', category, label: 'Anillo elástico exterior (seeger) DIN 471', ask: [{ name: 'd', label: 'Diámetro del eje (mm)', value: 25 }],
    build({ d } = {}) {
      const dia = numberArg(d, 25);
      const thick = Math.max(0.6, Math.round(dia * 0.05 * 10) / 10);
      const b = new PartBuilder(`Seeger exterior Ø${dia}`, [['d', dia], ['t', thick], ['ro', Math.round((dia + 2 + dia * 0.12) * 10) / 10], ['ri', Math.round(dia * 0.94 * 10) / 10]]);
      b.add('XY', 0, [circle('ro'), circle('ri')], 't');
      b.cut('XY', 't', [rect('ro/2', 'd*0.12', 'ro/4+ri/4', 0)], 't', { through: true });
      return b.build();
    },
    expect: { bbox: [30.5, 30.5, 1.2], tol: 1.2 },
  },
  {
    id: 'o-ring', category, label: 'Junta tórica (O-ring)', ask: [{ name: 'id', label: 'Diámetro interior (mm)', value: 30 }, { name: 'cs', label: 'Diámetro de la sección (mm)', value: 3 }],
    build({ id, cs } = {}) {
      const inner = numberArg(id, 30);
      const section = numberArg(cs, 3);
      const b = new PartBuilder(`O-ring ${inner}×${section}`, [['ID', inner], ['cs', section]]);
      b.feature('revolve', { sketch: b.sketch('XZ', 0, [circle('cs', 'ID/2+cs/2', 0)]), axis: 'y', angle: 360 });
      return b.build();
    },
    expect: { bbox: [36, 36, 3] },
  },
  {
    id: 'cancamo', category, label: 'Cáncamo (tornillo de ojo) DIN 580', ask: [{ name: 'd', label: 'Rosca M (mm)', value: 10 }],
    build({ d } = {}) {
      const r = isoRow(numberArg(d, 10));
      const dRing = r.d * 4;
      const b = new PartBuilder(`Cáncamo M${r.d}`, [['d', r.d], ['Dring', dRing], ['cs', Math.round(r.d * 0.8 * 10) / 10], ['L', Math.round(r.d * 2.2)], ['Dc', r.d * 2.4], ['hc', Math.max(2, r.d * 0.35)]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [circle('Dc')], 'hc');
      // ojo: anillo plano en el plano YZ (un toro fusionado con la base da mallas incompletas en el kernel)
      b.add('YZ', 0, [circle('Dring', 0, 'hc+Dring/2-1'), circle('Dring-2*cs', 0, 'hc+Dring/2-1')], 'cs*1.2', { symmetric: true });
      return b.build();
    },
  },
  {
    id: 'remache', category, label: 'Remache de cabeza redonda DIN 660', ask: [{ name: 'd', label: 'Diámetro (mm)', value: 6 }, { name: 'length', label: 'Largo (mm)', value: 16 }],
    build({ d, length } = {}) {
      const dia = numberArg(d, 6);
      const L = numberArg(length, 16);
      const b = new PartBuilder(`Remache Ø${dia}×${L}`, [['d', dia], ['L', L], ['dk', dia * 1.75], ['k', dia * 0.6]]);
      b.add('XY', '-L', [circle('d')], 'L');
      b.add('XY', 0, [circle('dk')], 'k');
      b.fillet('k*0.8', 'top');
      return b.build();
    },
    expect: { bbox: [10.5, 10.5, 19.6], tol: 0.7 },
  },
  {
    id: 'u-bulon', category, label: 'Abrazadera en U (U-bolt)', ask: [{ name: 'id', label: 'Diámetro del caño a abrazar (mm)', value: 48 }, { name: 'd', label: 'Diámetro de la varilla (mm)', value: 8 }, { name: 'leg', label: 'Largo de las patas (mm)', value: 50 }],
    build({ id, d, leg } = {}) {
      const pipe = numberArg(id, 48);
      const rod = numberArg(d, 8);
      const legs = numberArg(leg, 50);
      const b = new PartBuilder(`Abrazadera U Ø${pipe}`, [['Dp', pipe], ['d', rod], ['Lp', legs]]);
      b.feature('pipe', { start: ['Dp/2+d/2', 0, 0], dir: [0, 0, -1], profile: 'circle', od: 'd', wall: 0, radius: 'Dp/2+d/2', segments: [{ len: 'Lp', turn: 180, toward: '-x', radius: '' }, { len: 'Lp', turn: 0, toward: '-x', radius: '' }] });
      return b.build();
    },
  },
  {
    id: 'juego-fijacion', category, label: 'Juego tornillo + arandelas + tuerca (hexagonal)', ask: [{ name: 'd', label: 'Rosca M (mm)', value: 10 }, { name: 'length', label: 'Largo del tornillo (mm)', value: 40 }, { name: 'grip', label: 'Espesor a unir (mm)', value: 20 }],
    description: 'Tornillo pasante con una arandela bajo la cabeza, otra bajo la tuerca y la tuerca; las chapas a unir quedan por tu cuenta.',
    build({ d, length, grip } = {}) {
      const r = isoRow(numberArg(d, 10));
      const L = numberArg(length, 40);
      const g = Math.min(numberArg(grip, 20), L - r.m - r.wh - 2);
      const b = new PartBuilder(`Fijación M${r.d}×${L}`, [['d', r.d], ['L', L], ['g', g], ['s', r.s], ['k', r.k], ['m', r.m], ['w1', r.w1], ['w2', r.w2], ['wh', r.wh]]);
      // eje en Z: cabeza arriba (z de 0 a k), arandela bajo la cabeza (−wh a 0), chapas, arandela y tuerca
      b.add('XY', '-L', [circle('d')], 'L+0.001');
      b.add('XY', 0, [hexagon('s')], 'k');
      b.add('XY', '-wh', [circle('w2'), circle('w1')], 'wh+0.0');
      b.add('XY', '-wh-g-wh', [circle('w2'), circle('w1')], 'wh');
      b.add('XY', '-wh-g-wh-m', [hexagon('s'), circle('d')], 'm');
      return b.build();
    },
  },
];
