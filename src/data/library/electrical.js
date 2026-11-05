import { PartBuilder, circle, hexagon, numberArg, onCircle, poly, rect, slot } from './helpers.js';

const category = 'Eléctrica y automatización';
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);

export const electricalItems = [
  {
    id: 'riel-din', category, label: 'Riel DIN omega 35×7,5 ranurado',
    ask: [{ name: 'length', label: 'Largo (mm)', value: 300 }],
    build({ length } = {}) {
      const L = numberArg(length, 300);
      const b = new PartBuilder(`Riel DIN 35×7,5×${L}`, [['L', L]]);
      // perfil sombrero: alma superior, dos paredes y alas hacia afuera (espesor 1 mm)
      b.add('XY', 0, [poly([[-17.5, 0], [-13.5, 0], [-13.5, 6.5], [13.5, 6.5], [13.5, 0], [17.5, 0], [17.5, 1], [14.5, 1], [14.5, 7.5], [-14.5, 7.5], [-14.5, 1], [-17.5, 1]])], 'L');
      // ranuras de 5,2×12 mm cada 25 mm en el alma (se cortan hacia abajo desde la cara superior, y = 7,5)
      const n = Math.max(1, Math.min(40, Math.floor((L - 10) / 25)));
      const first = (L - (n - 1) * 25) / 2;
      b.cut('XZ', -7.5, Array.from({ length: n }, (_, i) => rect(5.2, 12, 0, first + i * 25)), 2, { reverse: false });
      return b.build();
    },
    expect: { bbox: [35, 7.5, 300], tol: 0.1 },
  },
  {
    id: 'canaleta-ranurada', category, label: 'Canaleta ranurada para cableado (con tapa)',
    ask: [{ name: 'w', label: 'Ancho (mm): 25, 40, 60, 80, 100', value: 60 }, { name: 'h', label: 'Alto (mm): 40, 60, 80', value: 60 }, { name: 'length', label: 'Largo (mm)', value: 500 }],
    build({ w, h, length } = {}) {
      const W = nearest([25, 40, 60, 80, 100], numberArg(w, 60));
      const H = nearest([40, 60, 80], numberArg(h, 60));
      const L = numberArg(length, 500);
      const t = 2;
      const b = new PartBuilder(`Canaleta ${W}×${H}×${L}`, [['W', W], ['H', H], ['L', L], ['t', t]]);
      b.add('XY', 0, [poly([['-W/2', 0], ['W/2', 0], ['W/2', 'H'], ['W/2-t', 'H'], ['W/2-t', 't'], ['-W/2+t', 't'], ['-W/2+t', 'H'], ['-W/2', 'H']])], 'L');
      // ranuras abiertas hacia arriba cada 12 mm, a través de las dos paredes (peine)
      const count = Math.min(30, Math.floor((L - 20) / 12));
      const first = (L - (count - 1) * 12) / 2;
      const slotH = H - 14 + 1;
      b.cut('YZ', 0, Array.from({ length: count }, (_, i) => rect(slotH, 5, 14 + slotH / 2, first + i * 12)), 'W*2', { through: true });
      return b.build();
    },
  },
  {
    id: 'gabinete-electrico', category, label: 'Gabinete eléctrico con puerta (acción de apertura), placa de montaje y riel',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 600 }, { name: 'h', label: 'Alto (mm)', value: 800 }, { name: 'd', label: 'Profundidad (mm)', value: 250 }],
    description: 'Cuerpo de chapa, puerta como operación aparte con una acción de giro sobre la bisagra (se abre a los 2 s), placa de montaje y dos rieles DIN.',
    build({ w, h, d } = {}) {
      const W = numberArg(w, 600);
      const H = numberArg(h, 800);
      const D = numberArg(d, 250);
      const t = 2;
      const b = new PartBuilder(`Gabinete ${W}×${H}×${D}`, [['W', W], ['H', H], ['D', D], ['t', t]]);
      // frente en y = 0 (la puerta); el gabinete se hunde hacia +Y. Plano XZ: normal −Y, por eso «reverse» extruye hacia +Y.
      b.add('XZ', 0, [rect('W', 'H', 0, 'H/2'), rect('W-2*t', 'H-2*t', 0, 'H/2')], 'D', { reverse: true });
      b.add('XZ', '-(D-t)', [rect('W', 'H', 0, 'H/2')], 't', { reverse: true });
      // placa de montaje a 30 mm del fondo y dos rieles DIN
      b.add('XZ', '-(D-33)', [rect('W-60', 'H-60', 0, 'H/2')], 3, { reverse: true });
      b.add('XZ', '-(D-41)', [rect('W-100', 35, 0, 'H*0.35')], 8, { reverse: true });
      b.add('XZ', '-(D-41)', [rect('W-100', 35, 0, 'H*0.65')], 8, { reverse: true });
      // puerta como operación aparte, delante del cuerpo (y de −3 a 0), con la cerradura
      const door = b.add('XZ', 0, [rect('W+6', 'H+6', 0, 'H/2'), ], 3, { reverse: false });
      b.add('XZ', 3, [circle(18, 'W/2-40', 'H/2')], 8, { reverse: false });
      b.action('rotate', { name: 'Abrir puerta', targets: [door], axis: 'z', pivot: [-W / 2, 0, 0], mode: 'sweep', from: 0, to: -100, duration: 1.5, start: { type: 'time', t: 2 } });
      return b.build();
    },
  },
  {
    id: 'botonera-22', category, label: 'Botonera con pulsadores Ø22,5',
    ask: [{ name: 'n', label: 'Cantidad de pulsadores (1 a 6)', value: 3 }],
    build({ n } = {}) {
      const count = Math.max(1, Math.min(6, Math.round(numberArg(n, 3))));
      const pitch = 40;
      const h = 30 + count * pitch;
      const b = new PartBuilder(`Botonera ×${count}`, [['H', h], ['n', count]]);
      b.add('XY', 0, [rect(80, 'H')], 3);
      b.fillet(4, 'vertical');
      const holes = Array.from({ length: count }, (_, i) => circle(22.5, 0, (i - (count - 1) / 2) * pitch));
      b.cut('XY', 3, holes, 3, { through: true });
      Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch).forEach((y) => {
        b.add('XY', 3, [circle(30, 0, y)], 4);
        b.add('XY', 7, [circle(22, 0, y)], 8);
      });
      return b.build();
    },
  },
  {
    id: 'pulsador-emergencia', category, label: 'Pulsador de emergencia tipo hongo Ø40',
    ask: [],
    build() {
      const b = new PartBuilder('Pulsador de emergencia', []);
      b.lathe([[0, 0], [14, 0], [14, 8], [10, 8], [10, 12], [20, 14], [20, 22], [18, 25], [8, 27], [0, 27]]);
      b.add('XY', 0, [circle(30), circle(22.5)], 3);
      return b.build();
    },
    expect: { bbox: [40, 40, 27], tol: 0.1 },
  },
  {
    id: 'baliza-luminosa', category, label: 'Baliza luminosa apilable (columna de señalización)',
    ask: [{ name: 'n', label: 'Cantidad de módulos (1 a 5)', value: 3 }],
    build({ n } = {}) {
      const count = Math.max(1, Math.min(5, Math.round(numberArg(n, 3))));
      const b = new PartBuilder(`Baliza ×${count}`, [['n', count]]);
      b.add('XY', 0, [circle(60), circle(22)], 38);
      b.add('XY', 38, [circle(30)], 90 * 0.0 + 70);
      for (let i = 0; i < count; i += 1) {
        b.add('XY', 38 + i * 46, [circle(60)], 42);
        b.add('XY', 38 + i * 46 + 42, [circle(54)], 4);
      }
      b.add('XY', 38 + count * 46, [circle(60)], 10);
      return b.build();
    },
  },
  {
    id: 'sensor-inductivo', category, label: 'Sensor inductivo cilíndrico roscado (M12 / M18 / M30) con tuercas',
    ask: [{ name: 'm', label: 'Rosca M: 12, 18, 30', value: 18 }, { name: 'length', label: 'Largo del cuerpo (mm)', value: 60 }],
    build({ m, length } = {}) {
      const d = nearest([12, 18, 30], numberArg(m, 18));
      const L = numberArg(length, 60);
      const s = { 12: 17, 18: 24, 30: 36 }[d];
      const b = new PartBuilder(`Sensor inductivo M${d}`, [['d', d], ['L', L], ['s', s]]);
      b.add('XY', 0, [circle('d')], 'L');
      b.add('XY', 'L*0.2', [hexagon('s')], 'd*0.5');
      b.add('XY', 'L*0.55', [hexagon('s')], 'd*0.5');
      b.add('XY', 'L', [circle('d*0.8')], 'd*1.0');
      b.cut('XY', 0, [circle('d*0.7')], 1, { through: false });
      b.chamfer(0.5, 'bottom');
      return b.build();
    },
  },
  {
    id: 'fotocelula', category, label: 'Fotocélula rectangular con óptica y fijación',
    ask: [],
    build() {
      const b = new PartBuilder('Fotocélula rectangular', []);
      b.add('XY', 0, [rect(50, 32)], 18);
      b.fillet(3, 'vertical');
      b.cut('XY', 18, [circle(11, -12, 0), circle(11, 12, 0)], 10);
      b.add('XY', 0, [rect(72, 8, 0, 0)], 6);
      b.cut('XY', 6, [slot(10, 4.5, -30, 0, 0), slot(10, 4.5, 30, 0, 0)], 6, { through: true });
      return b.build();
    },
  },
  {
    id: 'variador-frecuencia', category, label: 'Variador de frecuencia montado en pared (caja con disipador)',
    ask: [{ name: 'kw', label: 'Potencia aproximada: 0.75, 1.5, 3, 7.5 kW', value: 3 }],
    build({ kw } = {}) {
      const key = nearest([0.75, 1.5, 3, 7.5], numberArg(kw, 3));
      const dims = { 0.75: [173, 196, 165], 1.5: [173, 196, 165], 3: [200, 291, 172], 7.5: [275, 419, 204] }[key];
      const [W, H, D] = dims;
      const b = new PartBuilder(`Variador ${key} kW`, [['W', W], ['H', H], ['D', D]]);
      b.add('XY', 0, [rect('W', 'D')], 'H');
      b.fillet(6, 'vertical');
      // panel frontal (−Y) y aletas del disipador en la cara trasera (+Y)
      b.add('XZ', 'D/2', [rect('W*0.8', 'H*0.4', 0, 'H*0.68')], 4, { reverse: false });
      const fins = Math.min(9, Math.floor((W * 0.8) / 14));
      b.add('XZ', '-D/2+1', Array.from({ length: fins }, (_, i) => rect(4, 'H*0.85', (i - (fins - 1) / 2) * 14, 'H/2')), 24, { reverse: true });
      return b.build();
    },
  },
  {
    id: 'prensacable', category, label: 'Prensacable métrico (cuerpo hexagonal y tuerca)',
    ask: [{ name: 'm', label: 'Rosca M: 12, 16, 20, 25, 32', value: 20 }],
    build({ m } = {}) {
      const d = nearest([12, 16, 20, 25, 32], numberArg(m, 20));
      const b = new PartBuilder(`Prensacable M${d}`, [['d', d], ['s', Math.round(d * 1.4)]]);
      b.add('XY', 0, [circle('d*0.95'), circle('d*0.55')], 'd*0.7');
      b.add('XY', 'd*0.7', [hexagon('s'), circle('d*0.55')], 'd*0.5');
      b.add('XY', 'd*1.2', [circle('s*0.95'), circle('d*0.35')], 'd*0.7');
      b.chamfer(0.5, 'top');
      return b.build();
    },
  },
  {
    id: 'celda-carga-s', category, label: 'Celda de carga tipo S (con agujeros roscados)',
    ask: [{ name: 'size', label: 'Tamaño (mm de alto): 60, 80, 100', value: 80 }],
    build({ size } = {}) {
      const H = nearest([60, 80, 100], numberArg(size, 80));
      const W = Math.round(H * 0.28);
      const b = new PartBuilder(`Celda S ${H}`, [['H', H], ['W', W], ['hole', Math.round(H * 0.1)]]);
      // «S»: dos ménsulas opuestas unidas por un alma central con dos agujeros pasantes
      b.add('XY', 0, [poly([['-W', 0], ['W', 0], ['W', 'H*0.22'], ['W*0.35', 'H*0.22'], ['W*0.35', 'H*0.78'], ['W', 'H*0.78'], ['W', 'H'], ['-W', 'H'], ['-W', 'H*0.78'], ['-W*0.35', 'H*0.78'], ['-W*0.35', 'H*0.22'], ['-W', 'H*0.22']])], 'W*1.1');
      b.cut('XY', 0, [circle('W*0.55')], 'W*1.1', { through: true });
      b.cut('YZ', 0, [circle('hole', 'W*0.55', 'H*0.11'), circle('hole', 'W*0.55', 'H*0.89')], 'W*2', { through: true });
      return b.build();
    },
  },
  {
    id: 'escalerilla-cables', category, label: 'Escalerilla portacables (dos largueros y travesaños)',
    ask: [{ name: 'length', label: 'Largo (mm)', value: 1500 }, { name: 'width', label: 'Ancho (mm)', value: 300 }],
    build({ length, width } = {}) {
      const L = numberArg(length, 1500);
      const W = numberArg(width, 300);
      const members = [{ a: [0, 0, 0], b: [L, 0, 0], roll: 0, label: 'Larguero 1' }, { a: [0, W, 0], b: [L, W, 0], roll: 0, label: 'Larguero 2' }];
      for (let x = 150; x < L; x += 300) members.push({ a: [x, 15, 0], b: [x, W - 15, 0], roll: 0, label: 'Travesaño' });
      const b = new PartBuilder(`Escalerilla ${L}×${W}`, [['L', L], ['W', W]]);
      b.frame(members, { profile: 'tubo-30x30x2', mitre: false });
      return b.build();
    },
  },
];
