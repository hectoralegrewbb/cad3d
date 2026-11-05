import { PartBuilder, circle, numberArg, onCircle, poly, rect, slot, grid } from './helpers.js';
import { alu } from './tables.js';

const category = 'Estructura y perfilería';
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);

// Ranura en T del perfil de aluminio sobre la cara +X (dentro del cuadrado de lado S); se rota 90° para las otras caras.
function tSlot(side, mouth, depth, lip, rotation) {
  const half = side / 2;
  const cw = mouth * 2.1;
  const pts = [[half + 1, -mouth / 2], [half - lip, -mouth / 2], [half - lip, -cw / 2], [half - depth, -cw * 0.3], [half - depth, cw * 0.3], [half - lip, cw / 2], [half - lip, mouth / 2], [half + 1, mouth / 2]];
  const k = rotation;
  const turned = pts.map(([x, y]) => (k === 0 ? [x, y] : k === 1 ? [-y, x] : k === 2 ? [-x, -y] : [y, -x]));
  return poly(turned);
}

export const structureItems = [
  {
    id: 'perfil-aluminio', category, label: 'Perfil de aluminio ranurado (ranura en T, serie métrica)',
    ask: [{ name: 'size', label: 'Lado: 20, 30, 40 o 45 mm', value: 40 }, { name: 'length', label: 'Largo (mm)', value: 500 }],
    description: 'Perfil cuadrado con cuatro ranuras en T y agujero central: para armar bastidores atornillados.',
    build({ size, length } = {}) {
      const key = nearest(Object.keys(alu).map(Number), numberArg(size, 40));
      const p = alu[key];
      const L = numberArg(length, 500);
      const b = new PartBuilder(`Perfil aluminio ${key}×${key}×${L}`, [['S', key], ['L', L], ['core', p.core]]);
      b.add('XY', 0, [rect('S', 'S')], 'L');
      for (let k = 0; k < 4; k += 1) b.cut('XY', 0, [tSlot(key, p.mouth, p.depth, p.wall, k)], 'L+2', { through: true });
      b.cut('XY', 0, [circle('core')], 'L+2', { through: true });
      return b.build();
    },
    expect: { bbox: [40, 40, 500] },
  },
  {
    id: 'viga-ipe', category, label: 'Viga doble T IPE',
    ask: [{ name: 'h', label: 'Altura: 100, 120, 140, 160, 180, 200, 220, 240, 270, 300', value: 160 }, { name: 'length', label: 'Largo (mm)', value: 1000 }],
    build({ h, length } = {}) {
      const table = { 100: [55, 4.1, 5.7], 120: [64, 4.4, 6.3], 140: [73, 4.7, 6.9], 160: [82, 5, 7.4], 180: [91, 5.3, 8], 200: [100, 5.6, 8.5], 220: [110, 5.9, 9.2], 240: [120, 6.2, 9.8], 270: [135, 6.6, 10.2], 300: [150, 7.1, 10.7] };
      const key = nearest(Object.keys(table).map(Number), numberArg(h, 160));
      const [w, tw, tf] = table[key];
      const L = numberArg(length, 1000);
      const b = new PartBuilder(`IPE ${key}×${L}`, [['h', key], ['w', w], ['tw', tw], ['tf', tf], ['L', L]]);
      b.add('XY', 0, [poly([['-w/2', '-h/2'], ['w/2', '-h/2'], ['w/2', '-h/2+tf'], ['tw/2', '-h/2+tf'], ['tw/2', 'h/2-tf'], ['w/2', 'h/2-tf'], ['w/2', 'h/2'], ['-w/2', 'h/2'], ['-w/2', 'h/2-tf'], ['-tw/2', 'h/2-tf'], ['-tw/2', '-h/2+tf'], ['-w/2', '-h/2+tf']])], 'L');
      return b.build();
    },
    expect: { bbox: [82, 160, 1000] },
  },
  {
    id: 'perfil-upn', category, label: 'Perfil en U (UPN)',
    ask: [{ name: 'h', label: 'Altura: 80, 100, 120, 140, 160, 200', value: 100 }, { name: 'length', label: 'Largo (mm)', value: 1000 }],
    build({ h, length } = {}) {
      const table = { 80: [45, 6, 8], 100: [50, 6, 8.5], 120: [55, 7, 9], 140: [60, 7, 10], 160: [65, 7.5, 10.5], 200: [75, 8.5, 11.5] };
      const key = nearest(Object.keys(table).map(Number), numberArg(h, 100));
      const [w, tw, tf] = table[key];
      const L = numberArg(length, 1000);
      const b = new PartBuilder(`UPN ${key}×${L}`, [['h', key], ['w', w], ['tw', tw], ['tf', tf], ['L', L]]);
      b.add('XY', 0, [poly([[0, '-h/2'], ['w', '-h/2'], ['w', '-h/2+tf'], ['tw', '-h/2+tf'], ['tw', 'h/2-tf'], ['w', 'h/2-tf'], ['w', 'h/2'], [0, 'h/2']])], 'L');
      return b.build();
    },
    expect: { bbox: [50, 100, 1000] },
  },
  {
    id: 'perfil-l', category, label: 'Perfil ángulo (L de alas iguales)',
    ask: [{ name: 'a', label: 'Ala (mm): 30, 40, 50, 60, 70, 80', value: 50 }, { name: 't', label: 'Espesor (mm)', value: 5 }, { name: 'length', label: 'Largo (mm)', value: 1000 }],
    build({ a, t, length } = {}) {
      const wing = nearest([30, 40, 50, 60, 70, 80], numberArg(a, 50));
      const thick = Math.min(numberArg(t, 5), wing / 3);
      const L = numberArg(length, 1000);
      const b = new PartBuilder(`Ángulo ${wing}×${thick}×${L}`, [['a', wing], ['t', thick], ['L', L]]);
      b.add('XY', 0, [poly([[0, 0], ['a', 0], ['a', 't'], ['t', 't'], ['t', 'a'], [0, 'a']])], 'L');
      return b.build();
    },
    expect: { bbox: [50, 50, 1000] },
  },
  {
    id: 'tubo-estructural', category, label: 'Tubo estructural cuadrado / rectangular (una barra)',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 50 }, { name: 'h', label: 'Alto (mm)', value: 50 }, { name: 't', label: 'Espesor (mm)', value: 2 }, { name: 'length', label: 'Largo (mm)', value: 1000 }],
    build({ w, h, t, length } = {}) {
      const W = numberArg(w, 50);
      const H = numberArg(h, 50);
      const T = Math.min(numberArg(t, 2), Math.min(W, H) / 2 - 0.5);
      const L = numberArg(length, 1000);
      const b = new PartBuilder(`Tubo ${W}×${H}×${T}×${L}`, [['W', W], ['H', H], ['T', T], ['L', L]]);
      b.frame([{ a: [0, 0, 0], b: [0, 0, L], roll: 0, label: 'Tubo' }], { profile: 'personalizado', custom: { kind: 'tube', w: W, h: H, t: T } });
      return b.build();
    },
    expect: { bbox: [50, 50, 1000] },
  },
  {
    id: 'escuadra-refuerzo', category, label: 'Escuadra con nervio de refuerzo',
    ask: [{ name: 'a', label: 'Ala horizontal (mm)', value: 100 }, { name: 'h', label: 'Alto (mm)', value: 100 }, { name: 't', label: 'Espesor (mm)', value: 6 }, { name: 'w', label: 'Ancho (mm)', value: 60 }],
    build({ a, h, t, w } = {}) {
      const A = numberArg(a, 100);
      const H = numberArg(h, 100);
      const T = numberArg(t, 6);
      const W = numberArg(w, 60);
      const b = new PartBuilder('Escuadra reforzada', [['A', A], ['H', H], ['t', T], ['W', W], ['hole', Math.max(6, Math.round(T * 1.6))]]);
      b.add('XZ', 0, [poly([[0, 0], ['A', 0], ['A', 't'], ['t', 't'], ['t', 'H'], [0, 'H']])], 'W', { symmetric: true });
      b.add('XZ', 0, [poly([['t', 't'], ['A*0.7', 't'], ['t', 'H*0.7']])], 't', { symmetric: true });
      b.cut('XY', 't', [circle('hole', 'A*0.75', 'W*0.25'), circle('hole', 'A*0.75', '-W*0.25')], 't', { through: true });
      b.cut('YZ', 't', [circle('hole', 'W*0.25', 'H*0.8'), circle('hole', '-W*0.25', 'H*0.8')], 't', { through: true });
      return b.build();
    },
  },
  {
    id: 'placa-base-columna', category, label: 'Placa base de columna con cartelas',
    ask: [{ name: 'side', label: 'Lado de la placa (mm)', value: 200 }, { name: 'tube', label: 'Lado de la columna (mm)', value: 80 }, { name: 't', label: 'Espesor de la placa (mm)', value: 12 }, { name: 'height', label: 'Altura de la columna (mm)', value: 300 }],
    build({ side, tube, t, height } = {}) {
      const S = numberArg(side, 200);
      const C = Math.min(numberArg(tube, 80), S - 40);
      const T = numberArg(t, 12);
      const H = numberArg(height, 300);
      const b = new PartBuilder('Placa base de columna', [['S', S], ['C', C], ['T', T], ['H', H], ['hole', Math.max(12, Math.round(S * 0.075))], ['edge', Math.round(S * 0.14)]]);
      b.add('XY', 0, [rect('S', 'S')], 'T');
      b.fillet(6, 'vertical');
      b.add('XY', 'T', [rect('C', 'C'), rect('C-8', 'C-8')], 'H');
      for (const k of [0, 1, 2, 3]) {
        // cartela triangular a cada lado de la columna, en el plano radial
        const sign = k < 2 ? '' : '-';
        b.add(k % 2 === 0 ? 'XZ' : 'YZ', 0, [poly([[`${sign}C/2`, 'T'], [`${sign}(S/2-8)`, 'T'], [`${sign}C/2`, 'T+C*0.9']])], 6, { symmetric: true });
      }
      b.cut('XY', 'T', [circle('hole', 'S/2-edge', 'S/2-edge'), circle('hole', '-S/2+edge', 'S/2-edge'), circle('hole', 'S/2-edge', '-S/2+edge'), circle('hole', '-S/2+edge', '-S/2+edge')], 'T', { through: true });
      return b.build();
    },
  },
  {
    id: 'pata-regulable', category, label: 'Pata nivelante regulable (vástago roscado y base articulada)',
    ask: [{ name: 'd', label: 'Rosca M (mm): 8, 10, 12, 16', value: 12 }, { name: 'stud', label: 'Largo del vástago (mm)', value: 80 }, { name: 'base', label: 'Diámetro de la base (mm)', value: 60 }],
    build({ d, stud, base } = {}) {
      const dia = nearest([8, 10, 12, 16], numberArg(d, 12));
      const L = numberArg(stud, 80);
      const B = numberArg(base, 60);
      const b = new PartBuilder(`Pata nivelante M${dia}`, [['d', dia], ['L', L], ['B', B], ['nut', Math.round(dia * 1.6)], ['nm', Math.round(dia * 0.8)]]);
      b.add('XY', 6, [circle('d')], 'L');
      b.lathe([[0, 0], ['B/2', 0], ['B/2', 4], ['B/2-4', 6], [dia * 0.9, 8], [dia * 0.9, 12 + 0], [0, 12]]);
      b.add('XY', 'L*0.55', [{ t: 'polygon', x: 0, y: 0, n: 6, d: 'nut', across: 'flats', angle: 0 }], 'nm');
      b.add('XY', 'L+6', [circle('nut*1.4')], 6);
      return b.build();
    },
  },
  {
    id: 'rueda-giratoria', category, label: 'Rueda giratoria con placa (caster)',
    ask: [{ name: 'd', label: 'Diámetro de la rueda (mm)', value: 100 }, { name: 'width', label: 'Ancho de la rueda (mm)', value: 32 }],
    build({ d, width } = {}) {
      const D = numberArg(d, 100);
      const W = numberArg(width, 32);
      const fork = W + 12;
      const b = new PartBuilder(`Rueda giratoria Ø${D}`, [['D', D], ['W', W], ['fork', fork], ['axle', Math.max(8, Math.round(D * 0.1))]]);
      // rueda con eje a lo largo de Y, centrada a la altura D/2
      b.add('XZ', 0, [circle('D', 0, 'D/2'), circle('axle*1.8', 0, 'D/2')], 'W', { symmetric: true });
      b.add('XZ', 0, [circle('axle', 0, 'D/2')], 'fork', { symmetric: true });
      // horquilla: dos chapas laterales y puente superior
      b.add('XZ', 'fork/2', [poly([['-D*0.32', 'D*0.18'], ['D*0.32', 'D*0.18'], ['D*0.22', 'D*1.1'], ['-D*0.22', 'D*1.1']])], 4, { reverse: true });
      b.add('XZ', '-fork/2+4', [poly([['-D*0.32', 'D*0.18'], ['D*0.32', 'D*0.18'], ['D*0.22', 'D*1.1'], ['-D*0.22', 'D*1.1']])], 4, { reverse: true });
      b.add('XY', 'D*1.1', [rect('D*0.6', 'fork+8')], 4);
      b.add('XY', 'D*1.1+4', [rect('D*0.9', 'D*0.75')], 5);
      b.cut('XY', 'D*1.1+9', [circle(8, 'D*0.34', 'D*0.28'), circle(8, '-D*0.34', 'D*0.28'), circle(8, 'D*0.34', '-D*0.28'), circle(8, '-D*0.34', '-D*0.28')], 5, { through: true });
      return b.build();
    },
  },
  {
    id: 'abrazadera-cano', category, label: 'Abrazadera para caño (dos mitades con orejas)',
    ask: [{ name: 'd', label: 'Diámetro del caño (mm)', value: 60 }, { name: 'width', label: 'Ancho (mm)', value: 25 }],
    build({ d, width } = {}) {
      const D = numberArg(d, 60);
      const W = numberArg(width, 25);
      const t = Math.max(3, Math.round(D * 0.05));
      const b = new PartBuilder(`Abrazadera Ø${D}`, [['D', D], ['W', W], ['t', t], ['bolt', Math.max(6, Math.round(D * 0.12))]]);
      b.add('XY', 0, [circle('D+2*t'), circle('D')], 'W');
      // orejas a los lados del aro, con el agujero del bulón
      b.add('XY', 0, [rect('bolt*2.8', 'bolt*3', 'D/2+t+bolt*0.8', 0), rect('bolt*2.8', 'bolt*3', '-(D/2+t+bolt*0.8)', 0)], 'W');
      b.cut('XY', 'W', [circle('bolt', 'D/2+t+bolt*0.8', 0), circle('bolt', '-(D/2+t+bolt*0.8)', 0)], 'W', { through: true });
      b.cut('XY', 'W', [rect('D*1.2', 1.5)], 'W', { through: true });
      return b.build();
    },
  },
  {
    id: 'soporte-motor-placa', category, label: 'Base para motor con ranuras de regulación',
    ask: [{ name: 'frame', label: 'Carcasa IEC (63 a 160)', value: 90 }],
    build({ frame } = {}) {
      const table = { 63: [100, 80, 7], 71: [112, 90, 7], 80: [125, 100, 10], 90: [140, 100, 10], 100: [160, 140, 12], 112: [190, 140, 12], 132: [216, 178, 12], 160: [254, 210, 15] };
      const key = nearest(Object.keys(table).map(Number), numberArg(frame, 90));
      const [A, Bd, K] = table[key];
      const lp = Bd + 90;
      const wp = A + 80;
      const b = new PartBuilder(`Base motor IEC ${key}`, [['A', A], ['B', Bd], ['K', K], ['Lp', lp], ['Wp', wp], ['t', 10]]);
      b.add('XY', 0, [rect('Wp', 'Lp')], 't');
      b.fillet(8, 'vertical');
      b.cut('XY', 't', [slot('K*3', 'K', 'A/2', 'B/2', 90), slot('K*3', 'K', '-A/2', 'B/2', 90), slot('K*3', 'K', 'A/2', '-B/2', 90), slot('K*3', 'K', '-A/2', '-B/2', 90)], 't', { through: true });
      b.cut('XY', 't', [circle(11, 'Wp/2-14', 'Lp/2-14'), circle(11, '-Wp/2+14', 'Lp/2-14'), circle(11, 'Wp/2-14', '-Lp/2+14'), circle(11, '-Wp/2+14', '-Lp/2+14')], 't', { through: true });
      return b.build();
    },
  },
  {
    id: 'panel-perforado', category, label: 'Chapa perforada / criba (agujeros en cuadrícula, hasta 500)',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 150 }, { name: 'l', label: 'Largo (mm)', value: 200 }, { name: 't', label: 'Espesor (mm)', value: 2 }, { name: 'd', label: 'Diámetro de agujero (mm)', value: 8 }, { name: 'pitch', label: 'Paso (mm)', value: 15 }],
    build({ w, l, t, d, pitch } = {}) {
      const W = numberArg(w, 200);
      const Lg = numberArg(l, 300);
      const T = numberArg(t, 2);
      const D = numberArg(d, 8);
      const P = Math.max(D + 2, numberArg(pitch, 12));
      const nx = Math.floor((W - 10) / P);
      const ny = Math.floor((Lg - 10) / P);
      if (nx * ny > 500) throw new Error(`Son ${nx * ny} agujeros: el kernel tarda demasiado (máximo 500). Agrandá el paso o achicá la chapa`);
      const holes = grid(nx, ny, P, P).map(([x, y]) => circle('d', x, y));
      const b = new PartBuilder(`Chapa perforada ${W}×${Lg}`, [['W', W], ['Lg', Lg], ['t', T], ['d', D]]);
      b.add('XY', 0, [rect('W', 'Lg'), ...holes], 't'); // contorno + círculos anidados (relleno par/impar)
      return b.build();
    },
    expect: { bbox: [150, 200, 2] },
  },
  {
    id: 'bastidor-mesa', category, label: 'Bastidor de mesa con patas, travesaños y tablero',
    ask: [{ name: 'l', label: 'Largo (mm)', value: 1200 }, { name: 'w', label: 'Ancho (mm)', value: 600 }, { name: 'h', label: 'Alto (mm)', value: 850 }, { name: 'top', label: 'Espesor del tablero (mm, 0 = sin tablero)', value: 12 }],
    description: 'Cuatro columnas y dos aros de tubo 40×40, con tablero y patas niveladoras opcionales. La estructura es una sola operación (lista de cortes incluida).',
    build({ l, w, h, top } = {}) {
      const Lm = numberArg(l, 1200);
      const Wm = numberArg(w, 600);
      const Hm = numberArg(h, 850);
      const post = 40;
      const t = Number(top) > 0 ? Number(top) : 0;
      const b = new PartBuilder(`Bastidor ${Lm}×${Wm}×${Hm}`, [['L', Lm], ['W', Wm], ['H', Hm], ['t', t]]);
      const half = post / 2;
      const members = [];
      [[0, 0], [Lm, 0], [Lm, Wm], [0, Wm]].forEach(([x, y], i) => members.push({ a: [x, y, 0], b: [x, y, Hm], roll: 0, label: `Columna ${i + 1}` }));
      const ring = (z, name) => {
        members.push({ a: [half, 0, z], b: [Lm - half, 0, z], roll: 0, label: `${name} frente` }, { a: [half, Wm, z], b: [Lm - half, Wm, z], roll: 0, label: `${name} fondo` }, { a: [0, half, z], b: [0, Wm - half, z], roll: 0, label: `${name} izq.` }, { a: [Lm, half, z], b: [Lm, Wm - half, z], roll: 0, label: `${name} der.` });
      };
      ring(Hm - half, 'Aro superior');
      ring(150 + half, 'Aro inferior');
      b.frame(members, { profile: 'tubo-40x40x2' });
      if (t > 0) b.add('XY', 'H', [rect('L+40', 'W+40', 'L/2', 'W/2')], 't');
      return b.build();
    },
  },
  {
    id: 'baranda', category, label: 'Baranda de protección (parantes y pasamanos)',
    ask: [{ name: 'length', label: 'Largo (mm)', value: 2000 }, { name: 'height', label: 'Altura (mm)', value: 1000 }, { name: 'posts', label: 'Cantidad de parantes', value: 3 }],
    build({ length, height, posts } = {}) {
      const L = numberArg(length, 2000);
      const H = numberArg(height, 1000);
      const n = Math.max(2, Math.min(12, Math.round(numberArg(posts, 3))));
      const members = [];
      for (let i = 0; i < n; i += 1) members.push({ a: [(L * i) / (n - 1), 0, 0], b: [(L * i) / (n - 1), 0, H], roll: 0, label: `Parante ${i + 1}` });
      [H, H * 0.55].forEach((z, k) => members.push({ a: [0, 0, z], b: [L, 0, z], roll: 0, label: k === 0 ? 'Pasamanos' : 'Travesaño' }));
      const b = new PartBuilder(`Baranda ${L}×${H}`, [['L', L], ['H', H]]);
      b.frame(members, { profile: 'tubo-30x30x2', mitre: false });
      return b.build();
    },
  },
];
