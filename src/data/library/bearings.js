import { PartBuilder, circle, numberArg, poly, rect, slot } from './helpers.js';
import { bearingByDesignation, bearings, pillowRow } from './tables.js';

const category = 'Rodamientos y soportes';

// Esfera de radio r centrada en el eje Z (revolución de un semicírculo) lista para mover y repetir en círculo.
const ball = (b, radius) => b.lathe([[0, `-(${radius})`, 0.41421356], [radius, 0, 0.41421356], [0, radius]]);

// Rodamiento rígido de bolas: aro interior, aro exterior y bolas que apoyan en ambos (todo queda como un solo sólido).
function ballBearing(name, d, D, B) {
  const pitch = (D + d) / 4;
  const db = Math.round(((D - d) * 0.3) * 100) / 100;
  const n = Math.max(6, Math.min(16, Math.floor((Math.PI * 2 * pitch) / (db * 1.35))));
  const b = new PartBuilder(name, [['d', d], ['D', D], ['B', B], ['Rp', pitch], ['db', db], ['n', n]]);
  // aros con un resalte hacia el centro de la bola (0,3 mm de solape): los tres quedan fusionados
  b.lathe([[d / 2, 0], ['Rp-db/2+0.3', 0], ['Rp-db/2+0.3', 'B'], ['d/2', 'B']]);
  b.lathe([['Rp+db/2-0.3', 0], ['D/2', 0], ['D/2', 'B'], ['Rp+db/2-0.3', 'B']]);
  const first = ball(b, 'db/2');
  b.move(first, [pitch, 0, B / 2]); // el desplazamiento de una operación es numérico (no admite expresiones)
  b.pattern(first, { kind: 'circular', count: 'n', axis: 'z', cx: 0, cy: 0, cz: 0, total: 360 });
  b.chamfer(0.3, 'circles');
  return b;
}

export const bearingItems = [
  {
    id: 'rodamiento-bolas', category, label: 'Rodamiento rígido de bolas (6000 / 6200 / 6300)',
    ask: [{ name: 'code', label: 'Designación (ej. 6205, 6304, 6001)', value: 6205 }],
    description: 'Aros y bolas en un solo sólido. Tabla ISO 15 de las series 60, 62 y 63 (hasta 60 mm de eje).',
    build({ code } = {}) {
      const row = bearingByDesignation(Math.round(numberArg(code, 6205))) ?? bearingByDesignation('6205');
      const [id, d, D, B] = row;
      return ballBearing(`Rodamiento ${id} (${d}×${D}×${B})`, d, D, B).build();
    },
    expect: { bbox: [52, 52, 15] },
  },
  {
    id: 'rodamiento-axial', category, label: 'Rodamiento axial de bolas (serie 511xx)',
    ask: [{ name: 'd', label: 'Diámetro del eje (mm): 10, 15, 20, 25, 30, 35, 40, 50', value: 25 }],
    build({ d } = {}) {
      const table = { 10: [24, 9], 15: [28, 9], 20: [35, 10], 25: [42, 11], 30: [47, 11], 35: [52, 12], 40: [60, 13], 50: [70, 14] };
      const sizes = Object.keys(table).map(Number);
      const dia = sizes.reduce((best, v) => (Math.abs(v - numberArg(d, 25)) < Math.abs(best - numberArg(d, 25)) ? v : best), sizes[0]);
      const [D, H] = table[dia];
      const db = Math.round(H * 0.4 * 100) / 100;
      const pitch = (D + dia) / 4;
      const n = Math.max(6, Math.floor((Math.PI * 2 * pitch) / (db * 1.4)));
      const b = new PartBuilder(`Rodamiento axial ${dia}×${D}×${H}`, [['d', dia], ['D', D], ['H', H], ['db', db], ['Rp', pitch], ['n', n], ['tw', Math.round(((H - db) / 2 + 0.3) * 100) / 100]]);
      b.add('XY', 0, [circle('D-0.6'), circle('d')], 'tw');
      b.add('XY', 'H-tw', [circle('D'), circle('d+0.6')], 'tw');
      const first = ball(b, 'db/2');
      b.move(first, [pitch, 0, H / 2]);
      b.pattern(first, { kind: 'circular', count: 'n', axis: 'z', cx: 0, cy: 0, cz: 0, total: 360 });
      return b.build();
    },
    expect: { bbox: [42, 42, 11] },
  },
  {
    id: 'caja-rodamiento', category, label: 'Caja / alojamiento para rodamiento',
    ask: [{ name: 'code', label: 'Rodamiento a alojar (ej. 6205)', value: 6205 }],
    build({ code } = {}) {
      const [id, d, D, B] = bearingByDesignation(Math.round(numberArg(code, 6205))) ?? bearingByDesignation('6205');
      const side = Math.round(D * 1.9);
      const e = B + 6;
      const b = new PartBuilder(`Caja para ${id}`, [['D', D], ['B', B], ['side', side], ['e', e], ['hole', Math.max(6, Math.round(D * 0.14))], ['pad', Math.round(side * 0.38)]]);
      b.add('XY', 0, [rect('side', 'side')], 'e');
      b.fillet('side*0.15', 'vertical');
      b.cut('XY', 'e', [circle('D')], 'B+0.2');
      b.cut('XY', 0, [circle('D-6')], 'e', { through: true });
      b.cut('XY', 'e', [circle('hole', 'pad', 'pad'), circle('hole', '-pad', 'pad'), circle('hole', 'pad', '-pad'), circle('hole', '-pad', '-pad')], 'e', { through: true });
      return b.build();
    },
    expect: { bbox: [99.8, 99.8, 21], tol: 1.5 },
  },
  ...['ucp', 'ucf', 'ucfl'].map((kind) => ({
    id: `chumacera-${kind}`, category,
    label: { ucp: 'Chumacera de pie UCP2xx', ucf: 'Chumacera de brida cuadrada UCF2xx', ucfl: 'Chumacera de brida oval UCFL2xx' }[kind],
    ask: [{ name: 'd', label: 'Diámetro del eje (mm): 12 a 50', value: 25 }],
    description: 'Soporte de fundición con el agujero del eje pasante y su inserto; dimensiones típicas de catálogo (verificar con el fabricante).',
    build({ d } = {}) {
      const r = pillowRow(numberArg(d, 25));
      if (kind === 'ucp') {
        const [H, L, J, A, N, e, Btot] = r.ucp;
        const dout = Math.round(2 * (Btot - H) * 10) / 10;
        const b = new PartBuilder(`Chumacera UCP ${r.series} Ø${r.d}`, [['d', r.d], ['H', H], ['L', L], ['J', J], ['A', A], ['N', N], ['e', e], ['Dh', dout]]);
        b.add('XY', 0, [rect('L', 'A')], 'e');
        b.fillet(4, 'vertical');
        // pedestal trapecial en el plano XZ, extruido simétrico en Y (el eje corre a lo largo de Y)
        b.add('XZ', 0, [poly([['-L*0.32', 0], ['L*0.32', 0], ['Dh*0.5', 'H'], ['-Dh*0.5', 'H']])], 'A*0.7', { symmetric: true });
        b.add('XZ', 0, [circle('Dh', 0, 'H')], 'A*0.7', { symmetric: true });
        b.add('XZ', 0, [circle('d*1.5', 0, 'H')], 'A*1.25', { symmetric: true });
        b.cut('XZ', 0, [circle('d', 0, 'H')], 'A*3', { through: true });
        b.cut('XY', 'e', [circle('N', 'J/2', 0), circle('N', '-J/2', 0)], 'e', { through: true });
        return b.build();
      }
      if (kind === 'ucf') {
        const [L, J, e, N] = r.ucf;
        const b = new PartBuilder(`Chumacera UCF ${r.series} Ø${r.d}`, [['d', r.d], ['L', L], ['J', J], ['e', e], ['N', N], ['hub', Math.round(r.d * 2.1)], ['W', Math.round(r.d * 1.2 + 14)]]);
        b.add('XY', 0, [rect('L', 'L')], 'e');
        b.fillet('L*0.12', 'vertical');
        b.add('XY', 'e', [circle('hub')], 'W-e');
        b.add('XY', 0, [circle('d*1.45')], 'W+4');
        b.cut('XY', 0, [circle('d')], 'W*4', { through: true });
        b.cut('XY', 'e', [circle('N', 'J/2', 'J/2'), circle('N', '-J/2', 'J/2'), circle('N', 'J/2', '-J/2'), circle('N', '-J/2', '-J/2')], 'e', { through: true });
        return b.build();
      }
      const [L, J, A, e, N] = r.ucfl;
      const b = new PartBuilder(`Chumacera UCFL ${r.series} Ø${r.d}`, [['d', r.d], ['L', L], ['J', J], ['A', A], ['e', e], ['N', N], ['hub', Math.round(r.d * 2.1)], ['W', Math.round(r.d * 1.2 + 14)]]);
      b.add('XY', 0, [slot('L', 'A', 0, 0, 0)], 'e');
      b.add('XY', 'e', [circle('hub')], 'W-e');
      b.add('XY', 0, [circle('d*1.45')], 'W+4');
      b.cut('XY', 0, [circle('d')], 'W*4', { through: true });
      b.cut('XY', 'e', [circle('N', 'J/2', 0), circle('N', '-J/2', 0)], 'e', { through: true });
      return b.build();
    },
  })),
  {
    id: 'guia-lineal-riel', category, label: 'Guía lineal: riel con agujeros (tipo HGR)',
    ask: [{ name: 'size', label: 'Tamaño (15, 20, 25)', value: 20 }, { name: 'length', label: 'Largo (mm)', value: 300 }],
    build({ size, length } = {}) {
      const table = { 15: [15, 15, 60, 4.5, 7.5, 5.3], 20: [20, 17.5, 60, 6, 9.5, 8.5], 25: [23, 22, 60, 7, 11, 9] };
      const key = [15, 20, 25].reduce((best, v) => (Math.abs(v - numberArg(size, 20)) < Math.abs(best - numberArg(size, 20)) ? v : best), 15);
      const [W, H, P, bolt, cbore, cdepth] = table[key];
      const L = numberArg(length, 300);
      const b = new PartBuilder(`Riel HGR${key}×${L}`, [['W', W], ['H', H], ['P', P], ['L', L], ['bolt', bolt], ['cb', cbore], ['cd', cdepth]]);
      b.add('YZ', 0, [poly([['-W/2', 0], ['W/2', 0], ['W/2', 'H*0.55'], ['W*0.38', 'H*0.62'], ['W*0.38', 'H'], ['-W*0.38', 'H'], ['-W*0.38', 'H*0.62'], ['-W/2', 'H*0.55']])], 'L');
      const count = Math.max(1, Math.floor((L - 20) / P) + 1);
      const first = (L - (count - 1) * P) / 2;
      const holes = Array.from({ length: count }, (_, i) => [first + i * P, 0]);
      // agujeros pasantes con avellanado en la cara superior, repartidos a lo largo del eje X
      b.cut('XY', 'H', holes.map(([x]) => circle('bolt', x, 0)), 'H', { through: true });
      b.cut('XY', 'H', holes.map(([x]) => circle('cb', x, 0)), 'cd');
      return b.build();
    },
    expect: { bbox: [300, 20, 17.5], tol: 0.6 },
  },
  {
    id: 'guia-lineal-carro', category, label: 'Guía lineal: carro con brida (tipo HGW)',
    ask: [{ name: 'size', label: 'Tamaño (15, 20, 25)', value: 20 }],
    build({ size } = {}) {
      const table = { 15: [34, 61.4, 24, 26, 26, 4.5], 20: [44, 77.5, 30, 32, 36, 5.5], 25: [48, 83, 36, 35, 50, 6.5] };
      const key = [15, 20, 25].reduce((best, v) => (Math.abs(v - numberArg(size, 20)) < Math.abs(best - numberArg(size, 20)) ? v : best), 15);
      const [W, L, H, Bw, Cs, N] = table[key];
      const b = new PartBuilder(`Carro HGW${key}`, [['W', W], ['L', L], ['H', H], ['Bw', Bw], ['Cs', Cs], ['N', N], ['t', Math.round(H * 0.3)]]);
      b.add('XY', 0, [rect('L', 'W*0.72')], 'H-t');
      b.add('XY', 'H-t', [rect('L', 'W')], 't');
      b.cut('XY', 'H-t', [rect('L+1', 'W*0.4')], 'H*0.55');
      b.cut('XY', 'H', [circle('N', 'Bw/2', 'Cs/2'), circle('N', '-Bw/2', 'Cs/2'), circle('N', 'Bw/2', '-Cs/2'), circle('N', '-Bw/2', '-Cs/2')], 't', { through: false });
      return b.build();
    },
    expect: { bbox: [77.5, 44, 30] },
  },
  {
    id: 'casquillo-lineal', category, label: 'Casquillo lineal (tipo LM..UU) con eje guía',
    ask: [{ name: 'd', label: 'Diámetro del eje (mm): 8, 10, 12, 16, 20', value: 12 }, { name: 'length', label: 'Largo del eje (mm)', value: 200 }],
    build({ d, length } = {}) {
      const table = { 8: [15, 24], 10: [19, 29], 12: [21, 30], 16: [28, 37], 20: [32, 42] };
      const key = [8, 10, 12, 16, 20].reduce((best, v) => (Math.abs(v - numberArg(d, 12)) < Math.abs(best - numberArg(d, 12)) ? v : best), 8);
      const [D, L] = table[key];
      const rod = numberArg(length, 200);
      const b = new PartBuilder(`Casquillo LM${key}UU + eje`, [['d', key], ['D', D], ['Lb', L], ['Lr', rod]]);
      b.add('XY', 0, [circle('d')], 'Lr');
      b.add('XY', '(Lr-Lb)/2', [circle('D'), circle('d')], 'Lb');
      b.chamfer(0.5, 'circles');
      return b.build();
    },
    expect: { bbox: [21, 21, 200] },
  },
];
