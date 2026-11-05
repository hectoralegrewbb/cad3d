import { PartBuilder, circle, numberArg, onCircle, poly, rect, slot } from './helpers.js';

const category = 'Tolvas, canales y chapa';
const rad = (deg) => (deg * Math.PI) / 180;

export const hopperItems = [
  {
    id: 'tolva-conica', category, label: 'Tolva cónica / embudo (de chapa, con brida superior)',
    ask: [{ name: 'dTop', label: 'Diámetro superior interior (mm)', value: 300 }, { name: 'dBottom', label: 'Diámetro de salida interior (mm)', value: 60 }, { name: 'height', label: 'Altura del cono (mm)', value: 250 }, { name: 'wall', label: 'Espesor de chapa (mm)', value: 3 }],
    description: 'Cono de revolución con pared; la boca de salida queda en z = 0. Sirve para simulaciones de descarga.',
    build({ dTop, dBottom, height, wall } = {}) {
      const Dt = numberArg(dTop, 300);
      const Db = Math.min(numberArg(dBottom, 60), Dt - 20);
      const H = numberArg(height, 250);
      const t = numberArg(wall, 3);
      const b = new PartBuilder(`Tolva cónica Ø${Dt}→Ø${Db}`, [['Dt', Dt], ['Db', Db], ['H', H], ['t', t]]);
      // pared de espesor t medido en horizontal (cono delgado): contorno exterior e interior del tronco de cono
      b.lathe([['Db/2', 0], ['Dt/2', 'H'], ['Dt/2+t', 'H'], ['Db/2+t', 0]]);
      b.add('XY', 'H-t', [circle('Dt+2*t+30'), circle('Dt')], 't');
      return b.build();
    },
    expect: { bbox: [336, 336, 250] },
  },
  {
    id: 'silo-cilindrico', category, label: 'Silo cilíndrico con fondo cónico y patas',
    ask: [{ name: 'd', label: 'Diámetro del cilindro (mm)', value: 800 }, { name: 'hCyl', label: 'Altura del cilindro (mm)', value: 1000 }, { name: 'hCone', label: 'Altura del cono (mm)', value: 500 }, { name: 'out', label: 'Diámetro de la boca de salida (mm)', value: 150 }],
    build({ d, hCyl, hCone, out } = {}) {
      const D = numberArg(d, 800);
      const Hc = numberArg(hCyl, 1000);
      const Hk = numberArg(hCone, 500);
      const O = Math.min(numberArg(out, 150), D / 2);
      const t = 4;
      const legH = 450;
      const b = new PartBuilder(`Silo Ø${D}×${Hc}`, [['D', D], ['Hc', Hc], ['Hk', Hk], ['O', O], ['t', t], ['leg', legH]]);
      b.lathe([['O/2', 'leg'], ['D/2', 'leg+Hk'], ['D/2', 'leg+Hk+Hc'], ['D/2-t', 'leg+Hk+Hc'], ['D/2-t', 'leg+Hk'], ['O/2-t*0.5', 'leg']]);
      b.add('XY', 'leg+Hk+Hc-t', [circle('D'), circle('D*0.4')], 't');
      const post = 60;
      const r = D / 2 - 40;
      const members = onCircle(4, r, 45).map(([x, y], i) => ({ a: [x, y, 0], b: [x, y, legH + Hk * 0.9], roll: 0, label: `Pata ${i + 1}` }));
      b.frame(members, { profile: 'tubo-60x40x3', mitre: false });
      void post;
      return b.build();
    },
  },
  {
    id: 'tolva-piramidal', category, label: 'Tolva piramidal de chapa (cuadrada a cuadrada, con boca de salida)',
    ask: [{ name: 'top', label: 'Lado superior interior (mm)', value: 400 }, { name: 'bottom', label: 'Lado de la boca de salida (mm)', value: 100 }, { name: 'height', label: 'Altura (mm)', value: 300 }, { name: 'wall', label: 'Espesor de chapa (mm)', value: 3 }],
    description: 'Cuatro paneles inclinados que se superponen en las esquinas (sin fugas para la simulación). La boca de salida queda en z = 0.',
    build({ top, bottom, height, wall } = {}) {
      const At = numberArg(top, 400);
      const Ab = Math.min(numberArg(bottom, 100), At - 20);
      const H = numberArg(height, 300);
      const t = numberArg(wall, 3);
      const tilt = (Math.atan(((At - Ab) / 2) / H) * 180) / Math.PI; // inclinación respecto de la vertical
      const slant = Math.hypot((At - Ab) / 2, H);
      const b = new PartBuilder(`Tolva piramidal ${At}→${Ab}`, [['At', At], ['Ab', Ab], ['H', H], ['t', t], ['slant', Math.round(slant * 100) / 100]]);
      const wTop = At + 2 * t + 2;
      const wBot = Ab + 2 * t + 2;
      // panel trapezoidal (ancho arriba/abajo, alto = largo del faldón) apoyado en la arista de la boca y girado hacia afuera
      const panel = (plane, offset, axisName, signedTilt, pivot, reverse) => {
        const id = b.add(plane, offset, [poly([[`-${wBot}/2`, 0], [`${wBot}/2`, 0], [`${wTop}/2`, 'slant'], [`-${wTop}/2`, 'slant']])], 't', { reverse });
        b.turn(id, axisName, signedTilt, pivot);
      };
      const edge = Ab / 2;
      panel('XZ', edge, 'x', tilt, [0, -edge, 0], false); // frente (−Y): plano XZ tiene la normal en −Y
      panel('XZ', -edge, 'x', -tilt, [0, edge, 0], true); // fondo (+Y)
      panel('YZ', edge, 'y', tilt, [edge, 0, 0], false); // costado +X
      panel('YZ', -edge, 'y', -tilt, [-edge, 0, 0], true); // costado −X
      b.add('XY', 'H-t', [rect('At+2*t+60', 'At+2*t+60'), rect('At+2*t', 'At+2*t')], 't');
      return b.build();
    },
  },
  {
    id: 'canal-u', category, label: 'Canal recto en U inclinado (rampa de deslizamiento)',
    ask: [{ name: 'width', label: 'Ancho interior (mm)', value: 100 }, { name: 'depth', label: 'Altura de las paredes (mm)', value: 50 }, { name: 'length', label: 'Largo (mm)', value: 600 }, { name: 'angle', label: 'Inclinación (°)', value: 25 }],
    build({ width, depth, length, angle } = {}) {
      const W = numberArg(width, 100);
      const D = numberArg(depth, 50);
      const L = numberArg(length, 600);
      const A = Number(angle) || 0;
      const t = 3;
      const b = new PartBuilder(`Canal U ${W}×${D}×${L}`, [['W', W], ['D', D], ['L', L], ['t', t]]);
      const id = b.add('YZ', 0, [poly([['-W/2-t', 0], ['W/2+t', 0], ['W/2+t', 'D'], ['W/2', 'D'], ['W/2', 't'], ['-W/2', 't'], ['-W/2', 'D'], ['-W/2-t', 'D']])], 'L');
      b.turn(id, 'y', A, [0, 0, 0]);
      return b.build();
    },
  },
  {
    id: 'canal-semicircular', category, label: 'Canal semicircular (medio caño) inclinado',
    ask: [{ name: 'd', label: 'Diámetro interior (mm)', value: 120 }, { name: 'length', label: 'Largo (mm)', value: 600 }, { name: 'angle', label: 'Inclinación (°)', value: 20 }],
    build({ d, length, angle } = {}) {
      const D = numberArg(d, 120);
      const L = numberArg(length, 600);
      const A = Number(angle) || 0;
      const t = 3;
      const b = new PartBuilder(`Medio caño Ø${D}×${L}`, [['D', D], ['L', L], ['t', t]]);
      const ring = b.add('YZ', 0, [circle('D+2*t'), circle('D')], 'L');
      const cutTop = b.cut('YZ', 0, [rect('D+4*t', 'D/2+t', 0, '(D/2+t)/2+D*0.0001+0')], 'L', { through: false, reverse: false });
      b.move(cutTop, [0, 0, 0]);
      void ring;
      b.turn(ring, 'y', A, [0, 0, 0]);
      b.turn(cutTop, 'y', A, [0, 0, 0]);
      return b.build();
    },
  },
  {
    id: 'gabinete-chapa', category, label: 'Caja de chapa abierta (gabinete / carcasa)',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 300 }, { name: 'd', label: 'Profundidad (mm)', value: 200 }, { name: 'h', label: 'Alto (mm)', value: 150 }, { name: 't', label: 'Espesor (mm)', value: 2 }],
    build({ w, d, h, t } = {}) {
      const W = numberArg(w, 300);
      const D = numberArg(d, 200);
      const H = numberArg(h, 150);
      const T = Math.min(numberArg(t, 2), 8);
      const b = new PartBuilder(`Caja ${W}×${D}×${H}`, [['W', W], ['D', D], ['H', H], ['t', T]]);
      b.add('XY', 0, [rect('W', 'D')], 't');
      b.add('XY', 't', [rect('W', 'D'), rect('W-2*t', 'D-2*t')], 'H-t');
      b.fillet('t', 'vertical');
      b.add('XY', 'H-t', [rect('W+16', 'D+16'), rect('W-2*t', 'D-2*t')], 't');
      return b.build();
    },
    expect: { bbox: [316, 216, 150] },
  },
  {
    id: 'bandeja', category, label: 'Bandeja / tolva abierta rectangular (fondo y bordes)',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 400 }, { name: 'd', label: 'Largo (mm)', value: 300 }, { name: 'h', label: 'Altura de borde (mm)', value: 60 }],
    build({ w, d, h } = {}) {
      const W = numberArg(w, 400);
      const D = numberArg(d, 300);
      const H = numberArg(h, 60);
      const b = new PartBuilder(`Bandeja ${W}×${D}×${H}`, [['W', W], ['D', D], ['H', H], ['t', 3]]);
      b.add('XY', 0, [rect('W', 'D')], 't');
      b.add('XY', 't', [rect('W', 'D'), rect('W-2*t', 'D-2*t')], 'H-t');
      b.fillet(2, 'vertical');
      return b.build();
    },
    expect: { bbox: [400, 300, 60] },
  },
  {
    id: 'tapa-inspeccion', category, label: 'Tapa de inspección con manija y agujeros',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 200 }, { name: 'h', label: 'Alto (mm)', value: 150 }],
    build({ w, h } = {}) {
      const W = numberArg(w, 200);
      const H = numberArg(h, 150);
      const b = new PartBuilder(`Tapa ${W}×${H}`, [['W', W], ['H', H], ['t', 3], ['hole', 7]]);
      b.add('XY', 0, [rect('W', 'H')], 't');
      b.fillet(6, 'vertical');
      b.cut('XY', 't', [circle('hole', 'W/2-14', 'H/2-14'), circle('hole', '-W/2+14', 'H/2-14'), circle('hole', 'W/2-14', '-H/2+14'), circle('hole', '-W/2+14', '-H/2+14')], 't', { through: true });
      b.add('XY', 't', [rect(60, 10, 0, 0)], 6);
      b.add('XY', 't+6', [rect(80, 12, 0, 0)], 6);
      return b.build();
    },
  },
  {
    id: 'guarda-proteccion', category, label: 'Guarda de protección: marco de perfil con malla perforada',
    ask: [{ name: 'w', label: 'Ancho (mm)', value: 800 }, { name: 'h', label: 'Alto (mm)', value: 1000 }],
    build({ w, h } = {}) {
      const W = numberArg(w, 800);
      const H = numberArg(h, 1000);
      const b = new PartBuilder(`Guarda ${W}×${H}`, [['W', W], ['H', H]]);
      const post = 30;
      const m = [
        { a: [0, 0, 0], b: [0, 0, H], roll: 0, label: 'Montante izq.' }, { a: [W, 0, 0], b: [W, 0, H], roll: 0, label: 'Montante der.' },
        { a: [post / 2, 0, post / 2], b: [W - post / 2, 0, post / 2], roll: 0, label: 'Travesaño inf.' }, { a: [post / 2, 0, H - post / 2], b: [W - post / 2, 0, H - post / 2], roll: 0, label: 'Travesaño sup.' },
      ];
      b.frame(m, { profile: 'tubo-30x30x2', mitre: false });
      // malla: chapa de 1,5 mm con agujeros de 10 mm cada 16 mm en el hueco del marco
      // el kernel tarda mucho con cientos de agujeros en un boceto: el paso se agranda para quedar en unos 80
      const area = (W - 2 * post - 20) * (H - 2 * post - 20);
      const pitch = Math.max(16, Math.ceil(Math.sqrt(area / 80)));
      const nx = Math.max(1, Math.floor((W - 2 * post - 20) / pitch));
      const ny = Math.max(1, Math.floor((H - 2 * post - 20) / pitch));
      const holes = [];
      for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) holes.push(circle(Math.round(pitch * 0.62), (i - (nx - 1) / 2) * pitch + W / 2, (j - (ny - 1) / 2) * pitch + H / 2));
      b.add('XZ', post / 2 + 1, [rect(W - post, H - post, W / 2, H / 2), ...holes], 1.5);
      return b.build();
    },
  },
];
