import { PartBuilder, circle, numberArg, onCircle, poly, rect, slot } from './helpers.js';
import { keyFor } from '../templates.js';

const category = 'Mecanismos y accionamiento manual';
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
const r2 = (v) => Math.round(v * 100) / 100;

export const mechanismItems = [
  {
    id: 'leva-excentrica', category, label: 'Leva excéntrica (disco descentrado con agujero y chavetero)',
    ask: [{ name: 'd', label: 'Diámetro del disco (mm)', value: 80 }, { name: 'e', label: 'Excentricidad (mm)', value: 10 }, { name: 'bore', label: 'Agujero del eje (mm)', value: 20 }, { name: 'width', label: 'Ancho (mm)', value: 20 }],
    build({ d, e, bore, width } = {}) {
      const D = numberArg(d, 80);
      const E = Math.min(numberArg(e, 10), D / 2 - 15);
      const B = Math.min(numberArg(bore, 20), D / 2);
      const W = numberArg(width, 20);
      const key = keyFor(Math.min(75, Math.max(6.1, B)));
      const b = new PartBuilder(`Leva excéntrica Ø${D} e${E}`, [['D', D], ['e', E], ['bore', B], ['W', W]]);
      b.add('XY', 0, [circle('D', 'e', 0), circle('bore', 0, 0)], 'W');
      b.cut('XY', 'W', [rect(key.h - key.t1 + 1.2, key.b, B / 2 + (key.h - key.t1 - 1) / 2, 0)], 'W');
      b.chamfer(0.5, 'circles');
      return b.build();
    },
  },
  {
    id: 'leva-perfil', category, label: 'Leva de perfil (subida y bajada armónicas) con eje',
    ask: [{ name: 'r0', label: 'Radio base (mm)', value: 30 }, { name: 'lift', label: 'Alzada (mm)', value: 12 }, { name: 'bore', label: 'Agujero (mm)', value: 16 }, { name: 'width', label: 'Ancho (mm)', value: 16 }],
    description: 'Una subida armónica simple en 120°, detención arriba 60°, bajada armónica en 120° y detención abajo 60°.',
    build({ r0, lift, bore, width } = {}) {
      const R0 = numberArg(r0, 30);
      const H = numberArg(lift, 12);
      const B = Math.min(numberArg(bore, 16), R0 * 1.2);
      const W = numberArg(width, 16);
      const pts = [];
      for (let a = 0; a < 360; a += 5) {
        let rise;
        if (a < 120) rise = (1 - Math.cos((Math.PI * a) / 120)) / 2;
        else if (a < 180) rise = 1;
        else if (a < 300) rise = (1 + Math.cos((Math.PI * (a - 180)) / 120)) / 2;
        else rise = 0;
        const rr = R0 + H * rise;
        const t = (a * Math.PI) / 180;
        pts.push([r2(rr * Math.cos(t)), r2(rr * Math.sin(t))]);
      }
      const b = new PartBuilder(`Leva r${R0} +${H}`, [['bore', B], ['W', W]]);
      b.add('XY', 0, [poly(pts), circle('bore')], 'W');
      return b.build();
    },
  },
  {
    id: 'biela', category, label: 'Biela con dos agujeros (cabeza grande y pie)',
    ask: [{ name: 'l', label: 'Distancia entre centros (mm)', value: 150 }, { name: 'big', label: 'Agujero de cabeza (mm)', value: 30 }, { name: 'small', label: 'Agujero de pie (mm)', value: 16 }, { name: 'width', label: 'Espesor (mm)', value: 14 }],
    build({ l, big, small, width } = {}) {
      const L = numberArg(l, 150);
      const Db = numberArg(big, 30);
      const Ds = Math.min(numberArg(small, 16), Db - 4);
      const W = numberArg(width, 14);
      const b = new PartBuilder(`Biela ${L}`, [['L', L], ['Db', Db], ['Ds', Ds], ['W', W]]);
      const Rb = Db * 0.9;
      const Rs = Ds * 1.05 + 4;
      // forma: círculo de cabeza en 0, círculo de pie en L y alma recta tangente entre ambos
      b.add('XY', 0, [circle('Db*1.8', 0, 0), circle('Ds*2.1+8', 'L', 0)], 'W');
      b.add('XY', 0, [poly([[0, -Rb * 0.55], ['L', -Rs * 0.62], ['L', Rs * 0.62], [0, Rb * 0.55]])], 'W');
      b.cut('XY', 'W', [circle('Db', 0, 0), circle('Ds', 'L', 0)], 'W', { through: true });
      return b.build();
    },
  },
  {
    id: 'manivela', category, label: 'Manivela de dos agujeros (brazo con cubo y muñón)',
    ask: [{ name: 'r', label: 'Radio de giro (mm)', value: 40 }, { name: 'bore', label: 'Agujero del eje (mm)', value: 20 }, { name: 'pin', label: 'Diámetro del muñón (mm)', value: 16 }],
    build({ r, bore, pin } = {}) {
      const R = numberArg(r, 40);
      const B = numberArg(bore, 20);
      const P = numberArg(pin, 16);
      const t = 14;
      const b = new PartBuilder(`Manivela r${R}`, [['R', R], ['bore', B], ['pin', P], ['t', t]]);
      b.add('XY', 0, [circle('bore*2.1', 0, 0), circle('pin*2', 'R', 0)], 't');
      b.add('XY', 0, [poly([[0, 'bore*1.0'], ['R', 'pin*0.9'], ['R', '-pin*0.9'], [0, '-bore*1.0']])], 't');
      b.cut('XY', 't', [circle('bore')], 't', { through: true });
      b.add('XY', 't', [circle('pin', 'R', 0)], 'pin*1.6');
      return b.build();
    },
  },
  {
    id: 'piston', category, label: 'Pistón con bulón y canales de aros',
    ask: [{ name: 'd', label: 'Diámetro (mm)', value: 60 }],
    build({ d } = {}) {
      const D = numberArg(d, 60);
      const H = Math.round(D * 1.0);
      const b = new PartBuilder(`Pistón Ø${D}`, [['D', D], ['H', H], ['pin', Math.round(D * 0.3)], ['wall', 5]]);
      b.add('XY', 0, [circle('D')], 'H');
      b.chamfer(1, 'top');
      // faldón hueco por abajo
      b.cut('XY', 0, [circle('D-2*wall')], 'H*0.62', { reverse: false });
      // tres canales de aros y agujero del bulón
      for (let i = 0; i < 3; i += 1) b.cut('XY', H - 8 - i * 6, [circle(D + 4), circle(D - 5)], 2.5); // canales de aros (corona entre D−5 y D)
      b.cut('XZ', 'D/2', [circle('pin', 0, 'H*0.38')], 'D', { reverse: true });
      return b.build();
    },
  },
  {
    id: 'horquilla', category, label: 'Horquilla con espiga roscada (DIN 71752, simplificada)',
    ask: [{ name: 'd', label: 'Rosca M: 8, 10, 12, 16', value: 10 }],
    build({ d } = {}) {
      const M = nearest([8, 10, 12, 16], numberArg(d, 10));
      const b = new PartBuilder(`Horquilla M${M}`, [['M', M], ['W', M * 2.4], ['L', M * 5.2], ['pin', M]]);
      b.add('XY', 0, [rect('W', 'W')], 'L*0.62');
      b.cut('XY', 'L*0.62', [rect('M*0.75+2', 'W+2')], 'L*0.48');
      b.cut('XZ', 'W', [circle('pin', 0, 'L*0.45')], 'W*2', { reverse: false, through: true });
      b.add('XY', '-M*2.2', [circle('M')], 'M*2.2+1');
      b.chamfer(0.5, 'bottom');
      return b.build();
    },
  },
  {
    id: 'terminal-rotula', category, label: 'Terminal articulado (cabeza de rótula) con vástago',
    ask: [{ name: 'd', label: 'Agujero de la cabeza (mm): 8, 10, 12, 16', value: 12 }],
    build({ d } = {}) {
      const D = nearest([8, 10, 12, 16], numberArg(d, 12));
      const b = new PartBuilder(`Terminal rótula Ø${D}`, [['d', D], ['ring', D * 3], ['t', D * 0.9], ['shank', D * 1.3]]);
      b.add('XY', 0, [circle('ring'), circle('d')], 't');
      b.add('XY', 0, [circle('d*1.9'), circle('d')], 't*1.05');
      b.add('XZ', 'ring/2-2', [circle('shank', 0, 't/2')], 'D*4.0'.replace('D', String(D)), { reverse: false });
      return b.build();
    },
  },
  {
    id: 'bisagra', category, label: 'Bisagra de dos hojas con pasador',
    ask: [{ name: 'l', label: 'Largo (mm)', value: 80 }, { name: 'leaf', label: 'Ancho de cada hoja (mm)', value: 35 }],
    build({ l, leaf } = {}) {
      const L = numberArg(l, 80);
      const A = numberArg(leaf, 35);
      const b = new PartBuilder(`Bisagra ${L}`, [['L', L], ['A', A], ['t', 3], ['k', 10]]);
      b.add('XY', 0, [rect('A', 'L', '-A/2-k/2+k/2', 0)], 't');
      b.add('XY', 0, [rect('A', 'L', 'A/2+k/2-k/2', 0)], 't');
      b.add('XY', '-k/2+t/2', [circle('k', 0, 0)], 'L', { reverse: false });
      b.cut('XY', 0, [circle(3, '-A/2+4', 'L/2-10'), circle(3, '-A/2+4', '-L/2+10'), circle(3, 'A/2-4', 'L/2-10'), circle(3, 'A/2-4', '-L/2+10')], 't', { through: true });
      return b.build();
    },
  },
  {
    id: 'volante-mano', category, label: 'Volante de mano (cubo, aro y rayos)',
    ask: [{ name: 'd', label: 'Diámetro (mm)', value: 160 }, { name: 'spokes', label: 'Cantidad de rayos (3 a 6)', value: 4 }, { name: 'bore', label: 'Agujero (mm)', value: 16 }],
    build({ d, spokes, bore } = {}) {
      const D = numberArg(d, 160);
      const n = Math.max(3, Math.min(6, Math.round(numberArg(spokes, 4))));
      const B = numberArg(bore, 16);
      const b = new PartBuilder(`Volante Ø${D}`, [['D', D], ['bore', B], ['n', n]]);
      b.add('XY', 0, [circle('D'), circle('D-22')], 16);
      b.add('XY', 0, [circle('bore*2.6'), circle('bore')], 30);
      b.radial(n, () => b.add('XY', 4, [rect('D*0.42', 12, 'D*0.24', 0)], 8), 'z');
      return b.build();
    },
  },
  {
    id: 'palanca-bola', category, label: 'Palanca con empuñadura esférica y cubo',
    ask: [{ name: 'l', label: 'Largo (mm)', value: 160 }, { name: 'bore', label: 'Agujero (mm)', value: 12 }],
    build({ l, bore } = {}) {
      const L = numberArg(l, 160);
      const B = numberArg(bore, 12);
      const b = new PartBuilder(`Palanca ${L}`, [['L', L], ['bore', B]]);
      b.add('XY', 0, [circle('bore*2.4'), circle('bore')], 22);
      b.add('XY', 6, [poly([[0, 'bore*0.8'], ['L', 'bore*0.45'], ['L', '-bore*0.45'], [0, '-bore*0.8']])], 10);
      // empuñadura: esfera (dos arcos) al final del brazo, centrada en la altura del brazo
      const grip = b.lathe([[0, -14, 0.41421356], [14, 0, 0.41421356], [0, 14]]);
      b.move(grip, [L, 0, 11]);
      return b.build();
    },
  },
  {
    id: 'husillo-trapecial', category, label: 'Husillo (tornillo de potencia trapecial)',
    ask: [{ name: 'd', label: 'Diámetro (mm)', value: 20 }, { name: 'length', label: 'Largo (mm)', value: 120 }, { name: 'pitch', label: 'Paso (mm)', value: 5 }],
    build({ d, length, pitch } = {}) {
      const D = numberArg(d, 20);
      const L = numberArg(length, 250);
      const P = numberArg(pitch, 4);
      const b = new PartBuilder(`Husillo Tr${D}×${P}×${L}`, [['D', D], ['L', L], ['P', P]]);
      b.feature('screw', { plane: 'XY', offset: 0, length: 'L', shaft: Math.round(D * 0.8 * 10) / 10, outer: 'D', pitch: 'P', thickness: Math.round(P * 0.45 * 100) / 100, starts: 1 });
      return b.build();
    },
  },
  {
    id: 'tuerca-husillo', category, label: 'Tuerca de bronce con brida para husillo',
    ask: [{ name: 'd', label: 'Diámetro del husillo (mm)', value: 20 }],
    build({ d } = {}) {
      const D = numberArg(d, 20);
      const b = new PartBuilder(`Tuerca de husillo Ø${D}`, [['D', D]]);
      b.add('XY', 0, [circle('D*2.0'), circle('D')], 'D*1.6');
      b.add('XY', 0, [circle('D*2.7'), circle('D')], 5);
      b.cut('XY', 5, onCircle(4, D * 1.55, 45).map(([x, y]) => circle(Math.max(4.5, D * 0.28), x, y)), 5, { through: true });
      return b.build();
    },
  },
  {
    id: 'polea-tensora', category, label: 'Polea tensora con soporte regulable',
    ask: [{ name: 'd', label: 'Diámetro de la polea (mm)', value: 70 }, { name: 'width', label: 'Ancho (mm)', value: 24 }],
    build({ d, width } = {}) {
      const D = numberArg(d, 70);
      const W = numberArg(width, 24);
      const b = new PartBuilder(`Polea tensora Ø${D}`, [['D', D], ['W', W]]);
      b.lathe([[8, 0], ['D/2', 0], ['D/2', 3], ['D/2-4', 5], ['D/2-4', 'W-5'], ['D/2', 'W-3'], ['D/2', 'W'], [8, 'W']]);
      b.add('XY', 'W', [circle(14), circle(8)], 3);
      b.add('XY', -3, [circle(14), circle(8)], 3);
      b.add('XY', 'W+3', [circle(8)], 'D*0.0+2');
      // soporte en L con ranura de regulación
      b.add('XY', 'W+3', [slot('D*1.6', 18, 'D*0.6', 0, 0)], 4);
      b.cut('XY', 'W+7', [slot('D*0.8', 8, 'D*0.6', 0, 0)], 4, { through: true });
      return b.build();
    },
  },
];
