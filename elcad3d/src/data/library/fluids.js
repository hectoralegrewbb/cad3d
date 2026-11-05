import { PartBuilder, circle, numberArg, onCircle, poly, rect } from './helpers.js';
import { flangeRow } from './tables.js';

const category = 'Neumática, fluidos y aire';
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
const rad = (deg) => (deg * Math.PI) / 180;

// Brida plana de cañería con agujeros en círculo (se usa dentro de otras piezas): anillo exterior D, interior d, espesor b, en el plano XY a altura z.
function flangeAt(b, row, z, inner, reverse = false) {
  b.add('XY', z, [circle(row.D), circle(inner)], row.b, { reverse });
  b.cut('XY', reverse ? z : z + row.b, onCircle(row.n, row.K / 2, 0).map(([x, y]) => circle(row.hole, x, y)), row.b, { through: false });
}

export const fluidItems = [
  {
    id: 'venturi', category, label: 'Tubo Venturi (convergente - garganta - divergente) con escena de aire',
    ask: [{ name: 'd1', label: 'Diámetro interior de entrada (mm)', value: 100 }, { name: 'd2', label: 'Diámetro de la garganta (mm)', value: 50 }, { name: 'throat', label: 'Largo de la garganta (mm)', value: 50 }, { name: 'flow', label: 'Caudal de aire de prueba (m³/h)', value: 200 }],
    description: 'Cono convergente de 21°, garganta recta y divergente de 7°, con la escena lista: boquilla de caudal en la entrada y sensores en la entrada y la garganta. Iniciá las partículas con «Solo aire» para ver Δp contra Bernoulli (con calidad Media el Δp da ~20 % menos que el ideal; con Alta se acerca). El cálculo inicial tarda de decenas de segundos a un par de minutos según la máquina.',
    build({ d1, d2, throat, flow } = {}) {
      const D1 = numberArg(d1, 100);
      const D2 = Math.min(numberArg(d2, 50), D1 * 0.9);
      const Lt = numberArg(throat, 50);
      const t = 3;
      const lConv = (D1 - D2) / 2 / Math.tan(rad(10.5));
      const lDiv = (D1 - D2) / 2 / Math.tan(rad(3.5));
      const lIn = D1;
      const lOut = D1;
      const z1 = lIn;
      const z2 = z1 + lConv;
      const z3 = z2 + Lt;
      const z4 = z3 + lDiv;
      const total = z4 + lOut;
      const r = (v) => Math.round(v * 100) / 100;
      const b = new PartBuilder(`Venturi ${D1}→${D2}`, [['D1', D1], ['D2', D2], ['t', t]]);
      b.lathe([[D1 / 2, 0], [D1 / 2, r(z1)], [D2 / 2, r(z2)], [D2 / 2, r(z3)], [D1 / 2, r(z4)], [D1 / 2, r(total)], [D1 / 2 + t, r(total)], [D1 / 2 + t, r(z4)], [D2 / 2 + t, r(z3)], [D2 / 2 + t, r(z2)], [D1 / 2 + t, r(z1)], [D1 / 2 + t, 0]]);
      b.nozzle({ name: 'Soplador', pos: [0, 0, 2], dir: [0, 0, 1], radius: D1 / 2 - 2, bc: 'caudal', flow: numberArg(flow, 200), cone: 0, speed: 0, range: 100 });
      b.sensor({ name: 'Entrada', center: [0, 0, r(z1 * 0.6)], size: [D1 * 0.8, D1 * 0.8, 12] });
      b.sensor({ name: 'Garganta', center: [0, 0, r((z2 + z3) / 2)], size: [D2 * 0.8, D2 * 0.8, 12] });
      return b.build();
    },
    expect: { bbox: [106, 106, null], tol: 0.5 },
  },
  {
    id: 'reduccion-concentrica', category, label: 'Reducción concéntrica con bridas',
    ask: [{ name: 'dn1', label: 'DN mayor (25 a 200)', value: 100 }, { name: 'dn2', label: 'DN menor', value: 50 }, { name: 'length', label: 'Largo (mm)', value: 150 }],
    build({ dn1, dn2, length } = {}) {
      const r1 = flangeRow(numberArg(dn1, 100));
      const r2 = flangeRow(Math.min(numberArg(dn2, 50), r1.dn - 1));
      const L = numberArg(length, 150);
      const t = 4;
      const b = new PartBuilder(`Reducción DN${r1.dn}→DN${r2.dn}`, [['L', L], ['t', t]]);
      b.lathe([[r1.pipe / 2 - t, 0], [r1.pipe / 2, 0], [r2.pipe / 2, L], [r2.pipe / 2 - t, L]]);
      flangeAt(b, r1, 0, r1.pipe - 2 * t, true);
      flangeAt(b, r2, L - r2.b, r2.pipe - 2 * t);
      return b.build();
    },
  },
  {
    id: 'brida-cano', category, label: 'Brida de cañería EN 1092-1 PN16 (plana con cuello corto)',
    ask: [{ name: 'dn', label: 'DN: 25, 32, 40, 50, 65, 80, 100, 125, 150, 200', value: 100 }],
    build({ dn } = {}) {
      const r = flangeRow(numberArg(dn, 100));
      const b = new PartBuilder(`Brida DN${r.dn} PN16`, [['D', r.D], ['K', r.K], ['hole', r.hole], ['b', r.b], ['pipe', r.pipe], ['n', r.n]]);
      b.add('XY', 0, [circle('D'), circle('pipe')], 'b');
      b.add('XY', 'b', [circle('pipe+14'), circle('pipe')], 12);
      b.cut('XY', 'b', onCircle(r.n, r.K / 2, 0).map(([x, y]) => circle('hole', x, y)), 'b', { through: true });
      b.chamfer(1, 'top');
      return b.build();
    },
  },
  {
    id: 'cano-recto-bridado', category, label: 'Caño recto con bridas en los extremos',
    ask: [{ name: 'dn', label: 'DN (25 a 200)', value: 100 }, { name: 'length', label: 'Largo total (mm)', value: 500 }],
    build({ dn, length } = {}) {
      const r = flangeRow(numberArg(dn, 100));
      const L = Math.max(numberArg(length, 500), 3 * r.b);
      const t = 4;
      const b = new PartBuilder(`Caño DN${r.dn}×${L}`, [['L', L], ['t', t]]);
      b.add('XY', 0, [circle(r.pipe), circle(r.pipe - 2 * t)], 'L');
      flangeAt(b, r, 0, r.pipe - 2 * t);
      flangeAt(b, r, L - r.b, r.pipe - 2 * t);
      return b.build();
    },
  },
  {
    id: 'codo-90', category, label: 'Codo de 90° (radio largo) con bridas',
    ask: [{ name: 'dn', label: 'DN (25 a 200)', value: 100 }, { name: 'leg', label: 'Tramo recto en cada extremo (mm)', value: 60 }],
    build({ dn, leg } = {}) {
      const r = flangeRow(numberArg(dn, 100));
      const straight = Math.max(numberArg(leg, 60), r.b + 10);
      const t = 4;
      const R = r.pipe * 1.5;
      const b = new PartBuilder(`Codo 90° DN${r.dn}`, [['od', r.pipe], ['t', t], ['R', R], ['a', straight]]);
      b.feature('pipe', { start: [0, 0, 0], dir: [0, 0, 1], profile: 'circle', od: 'od', wall: 't', radius: 'R', segments: [{ len: 'a', turn: 90, toward: '+x', radius: '' }, { len: 'a', turn: 0, toward: '+x', radius: '' }] });
      flangeAt(b, r, 0, r.pipe - 2 * t, false);
      return b.build();
    },
  },
  {
    id: 'te-derivacion', category, label: 'Te de derivación a 90° (tubos fusionados)',
    ask: [{ name: 'dn', label: 'DN principal (25 a 200)', value: 100 }, { name: 'branch', label: 'DN de la derivación', value: 50 }, { name: 'length', label: 'Largo del tramo principal (mm)', value: 300 }],
    build({ dn, branch, length } = {}) {
      const rm = flangeRow(numberArg(dn, 100));
      const rb = flangeRow(Math.min(numberArg(branch, 50), rm.dn));
      const L = numberArg(length, 300);
      const t = 4;
      const b = new PartBuilder(`Te DN${rm.dn}/DN${rb.dn}`, [['L', L], ['t', t]]);
      b.tube('XY', 0, [circle(rm.pipe), circle(rm.pipe - 2 * t)], 'L');
      b.tube('XZ', 0, [circle(rb.pipe, 0, L / 2)], rm.pipe + 80, { reverse: true });
      return b.build();
    },
  },
  {
    id: 'valvula-bola', category, label: 'Válvula de bola con manija',
    ask: [{ name: 'dn', label: 'DN (25 a 200)', value: 50 }],
    build({ dn } = {}) {
      const r = flangeRow(numberArg(dn, 50));
      const body = r.pipe * 1.35;
      const L = Math.round(r.pipe * 2.1);
      const b = new PartBuilder(`Válvula bola DN${r.dn}`, [['od', r.pipe], ['body', body], ['L', L]]);
      b.add('XY', 0, [circle('od+8'), circle('od-8')], 'L*0.2');
      b.add('XY', 'L*0.8', [circle('od+8'), circle('od-8')], 'L*0.2');
      b.lathe([['od/2-4', 'L*0.18'], ['body/2', 'L*0.3'], ['body/2', 'L*0.7'], ['od/2-4', 'L*0.82']]);
      b.add('XZ', 0, [circle('od*0.22', 0, 'L/2')], 'body*0.85', { reverse: true });
      b.add('XY', 'body*0.85', [rect('od*1.7', 'od*0.18', 'od*0.55', 0)], 'od*0.1');
      b.cut('XY', 0, [circle('od-12')], 'L', { through: true });
      return b.build();
    },
  },
  {
    id: 'valvula-mariposa', category, label: 'Válvula mariposa entre bridas (disco y palanca)',
    ask: [{ name: 'dn', label: 'DN (50 a 200)', value: 100 }],
    build({ dn } = {}) {
      const r = flangeRow(numberArg(dn, 100));
      const W = Math.round(r.pipe * 0.42);
      const b = new PartBuilder(`Válvula mariposa DN${r.dn}`, [['id', r.pipe - 8], ['OD', r.D * 0.88], ['W', W]]);
      b.add('XY', 0, [circle('OD'), circle('id')], 'W');
      b.add('XY', 'W*0.35', [circle('id-2')], 'W*0.3');
      b.add('XZ', 'OD*0.0', [circle('W*0.22', 0, 'W/2')], 'OD*0.5+10', { symmetric: false, reverse: true });
      b.add('XZ', 'OD*0.5+10', [rect(18, 6, 0, 'W/2')], 16, { reverse: true });
      b.add('XZ', 'OD*0.5+26', [rect(200, 16, 90, 'W/2')], 8, { reverse: true });
      return b.build();
    },
  },
  {
    id: 'compuerta-guillotina', category, label: 'Compuerta guillotina deslizante con escena (se abre sola)',
    ask: [{ name: 'w', label: 'Ancho del paso (mm)', value: 150 }, { name: 'h', label: 'Alto del paso (mm)', value: 150 }],
    description: 'Marco con ranura, hoja guillotina como operación aparte y una acción «Deslizar» que la abre a los 2 s (editable en ⚡ Acciones).',
    build({ w, h } = {}) {
      const W = numberArg(w, 150);
      const H = numberArg(h, 150);
      const t = 8;
      const b = new PartBuilder(`Compuerta ${W}×${H}`, [['W', W], ['H', H], ['t', t]]);
      b.add('XY', 0, [rect('W+60', 'H+60'), rect('W', 'H')], '2*t+6');
      b.cut('XY', 't', [rect('W+60', 'H+60')], 't+0.6', { reverse: false });
      const blade = b.add('XY', 't+0.3', [rect('W+30', 'H+30')], 't');
      b.action('slide', { name: 'Abrir compuerta', targets: [blade], axis: 'x', from: 0, to: W + 40, duration: 1.2, start: { type: 'time', t: 2 } });
      return b.build();
    },
  },
  {
    id: 'ciclon', category, label: 'Ciclón separador (cuerpo cilíndrico, cono y entrada tangencial)',
    ask: [{ name: 'd', label: 'Diámetro del cuerpo (mm)', value: 300 }],
    description: 'Proporciones tipo Stairmand: entrada 0,5D × 0,2D, salida de aire 0,5D, cuerpo 1,5D y cono 2D.',
    build({ d } = {}) {
      const D = numberArg(d, 300);
      const t = 3;
      const b = new PartBuilder(`Ciclón Ø${D}`, [['D', D], ['t', t], ['De', D * 0.5], ['Hc', D * 1.5], ['Hk', D * 2], ['Dd', D * 0.375]]);
      // cuerpo + cono (revolución del contorno exterior e interior)
      b.lathe([['Dd/2', 0], ['D/2', 'Hk'], ['D/2', 'Hk+Hc'], ['D/2-t', 'Hk+Hc'], ['D/2-t', 'Hk'], ['Dd/2-t', 0]]);
      b.add('XY', 'Hk+Hc-t', [circle('D'), circle('De')], 't');
      // tubo de salida de aire (buscador de vórtice) que entra desde arriba
      b.add('XY', 'Hk+Hc*0.45', [circle('De'), circle('De-2*t')], 'Hc*0.55+De*0.5');
      // entrada rectangular tangencial
      b.add('XZ', 'D/2-t', [rect('D*0.2', 'D*0.5', 'D*0.0', 'Hk+Hc-D*0.28')], 'D*0.55', { reverse: true });
      b.cut('XZ', 'D/2-t', [rect('D*0.2-2*t', 'D*0.5-2*t', 0, 'Hk+Hc-D*0.28')], 'D*0.3', { reverse: true });
      return b.build();
    },
  },
  {
    id: 'esclusa-rotativa', category, label: 'Esclusa rotativa (válvula celular) con rotor de paletas y acción de giro',
    ask: [{ name: 'd', label: 'Diámetro interior de la carcasa (mm)', value: 200 }, { name: 'width', label: 'Ancho (mm)', value: 200 }, { name: 'vanes', label: 'Cantidad de paletas (6 u 8)', value: 8 }],
    description: 'Carcasa con boca superior e inferior cuadradas y rotor de paletas como operación aparte; incluye la acción de giro continuo para simular el dosificado.',
    build({ d, width, vanes } = {}) {
      const D = numberArg(d, 200);
      const W = numberArg(width, 200);
      const n = Math.round(numberArg(vanes, 8)) >= 7 ? 8 : 6;
      const t = 8;
      const b = new PartBuilder(`Esclusa rotativa Ø${D}`, [['D', D], ['W', W], ['t', t], ['n', n]]);
      // carcasa cilíndrica con eje a lo largo de X y dos bocas cuadradas (arriba y abajo)
      b.add('YZ', '-W/2', [circle('D+2*t'), circle('D')], 'W');
      b.add('XY', 'D/2', [rect('W', 'D*0.6+2*t'), rect('W-2*t', 'D*0.6')], 40);
      b.add('XY', '-D/2-40', [rect('W', 'D*0.6+2*t'), rect('W-2*t', 'D*0.6')], 40);
      b.cut('XY', 'D/2+t', [rect('W-2*t', 'D*0.6')], 'D*0.2+t', { through: false });
      b.cut('XY', '-D/2+0.0', [rect('W-2*t', 'D*0.6')], 'D*0.2+t', { through: false, reverse: false });
      // tapas laterales
      b.add('YZ', 'W/2', [circle('D+2*t+20')], t);
      b.add('YZ', '-W/2-t', [circle('D+2*t+20')], t);
      // rotor: núcleo + paletas radiales (cada una operación propia para poder moverlas juntas)
      const core = b.add('YZ', '-W/2+2', [circle('D*0.18')], 'W-4');
      const vaneIds = b.radial(n, () => b.add('YZ', '-W/2+2', [rect('D*0.46', 6, 'D*0.23', 0)], 'W-4'), 'x');
      b.action('rotate', { name: 'Girar rotor', targets: [core, ...vaneIds], axis: 'x', pivot: [0, 0, 0], mode: 'continuous', rpm: 30 });
      return b.build();
    },
  },
  {
    id: 'ventilador-axial', category, label: 'Ventilador axial en virola (buje y aspas)',
    ask: [{ name: 'd', label: 'Diámetro (mm)', value: 300 }, { name: 'blades', label: 'Cantidad de aspas', value: 5 }],
    build({ d, blades } = {}) {
      const D = numberArg(d, 300);
      const n = Math.max(3, Math.min(9, Math.round(numberArg(blades, 5))));
      const b = new PartBuilder(`Ventilador axial Ø${D}`, [['D', D], ['n', n], ['hub', D * 0.28], ['W', D * 0.28]]);
      b.add('XY', 0, [circle('D+16'), circle('D+4')], 'W');
      const hub = b.add('XY', 'W*0.1', [circle('hub')], 'W*0.8');
      const bladeIds = b.radial(n, () => b.add('XY', 'W*0.3', [poly([['hub/2-3', '-D*0.045'], ['D/2-1', '-D*0.075'], ['D/2-1', 'D*0.045'], ['hub/2-3', 'D*0.03']])], 'W*0.25'), 'z');
      b.action('rotate', { name: 'Girar ventilador', targets: [hub, ...bladeIds], axis: 'z', pivot: [0, 0, 0], mode: 'continuous', rpm: 1450 });
      return b.build();
    },
  },
  {
    id: 'soplador-centrifugo', category, label: 'Soplador centrífugo: voluta, rodete con álabes y boca de salida',
    ask: [{ name: 'd', label: 'Diámetro del rodete (mm)', value: 200 }, { name: 'width', label: 'Ancho del rodete (mm)', value: 50 }, { name: 'blades', label: 'Cantidad de álabes', value: 10 }],
    description: 'Voluta en espiral de Arquímedes con lengüeta, boca de aspiración axial y rodete con álabes rectos como operación aparte (acción de giro incluida).',
    build({ d, width, blades } = {}) {
      const D = numberArg(d, 200);
      const W = numberArg(width, 50);
      const n = Math.max(6, Math.min(24, Math.round(numberArg(blades, 10))));
      const t = 3;
      const b = new PartBuilder(`Soplador Ø${D}`, [['D', D], ['W', W], ['n', n], ['t', t], ['R', D / 2]]);
      // contorno de la voluta: radio creciente de 1,12·R a 1,5·R en 360° (lengüeta a 0°)
      const R = D / 2;
      const outer = [];
      const inner = [];
      const steps = 36;
      for (let i = 0; i <= steps; i += 1) {
        const a = (i / steps) * 2 * Math.PI;
        const rr = R * (1.12 + 0.42 * (i / steps));
        outer.push([Math.round(Math.cos(a) * (rr + t) * 100) / 100, Math.round(Math.sin(a) * (rr + t) * 100) / 100]);
        inner.push([Math.round(Math.cos(a) * rr * 100) / 100, Math.round(Math.sin(a) * rr * 100) / 100]);
      }
      const spiral = [...outer, ...inner.slice().reverse()];
      b.add('XY', 0, [poly(spiral)], 'W+2*t');
      // boca de salida tangencial hacia +Y (a la salida de la espiral)
      b.add('XZ', '-R*1.54', [rect('R*0.9', 'W+2*t', 0, '(W+2*t)/2')], 'R*0.9', { reverse: true });
      b.cut('XZ', '-R*1.54', [rect('R*0.9-2*t', 'W', 0, '(W+2*t)/2')], 'R*0.9', { reverse: true });
      // tapa de aspiración con ojo
      b.add('XY', 0, [circle('D*1.6'), circle('D*0.55')], 't');
      // rodete: disco trasero + álabes radiales; el motor lo hace girar
      const disc = b.add('XY', 't', [circle('D*0.98'), circle('D*0.14')], 't');
      const bladeIds = b.radial(n, () => b.add('XY', 't', [rect('D*0.3', 3, 'D*0.34', 0)], 'W'), 'z');
      b.action('rotate', { name: 'Girar rodete', targets: [disc, ...bladeIds], axis: 'z', pivot: [0, 0, 0], mode: 'continuous', rpm: 2900 });
      return b.build();
    },
  },
  {
    id: 'cilindro-neumatico', category, label: 'Cilindro neumático ISO 15552 con vástago (acción de carrera)',
    ask: [{ name: 'bore', label: 'Diámetro de émbolo: 32, 40, 50, 63, 80, 100', value: 50 }, { name: 'stroke', label: 'Carrera (mm)', value: 150 }],
    description: 'Camisa, tapas con tirantes y vástago como operación aparte; la acción «Deslizar» lo extiende y recoge (editable). Eje del cilindro a lo largo de +X.',
    build({ bore, stroke } = {}) {
      const table = { 32: [12, 45, 32.5, 30, 6.5], 40: [16, 54, 38, 36, 8], 50: [20, 64, 46.5, 40, 9], 63: [20, 75, 56.5, 45, 9], 80: [25, 94, 72, 45, 12], 100: [25, 111, 89, 55, 12] };
      const key = nearest(Object.keys(table).map(Number), numberArg(bore, 50));
      const [rod, cap, tie, thread, tieD] = table[key];
      const S = numberArg(stroke, 150);
      const tube = key + 8;
      const L = S + 40;
      const b = new PartBuilder(`Cilindro ISO ${key}×${S}`, [['bore', key], ['rod', rod], ['cap', cap], ['S', S], ['tube', tube], ['L', L]]);
      b.add('YZ', 0, [circle('tube'), circle('bore')], 'L');
      b.add('YZ', '-20', [rect('cap', 'cap'), circle('rod+2')], 20);
      b.add('YZ', 'L', [rect('cap', 'cap'), circle('rod+2')], 20);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.add('YZ', -20, [circle(tieD, sx * tie * 0.5 * 1.0, sy * tie * 0.5)], 'L+40');
      // vástago: pieza móvil (se extiende por el lado +X)
      const rodId = b.add('YZ', 20, [circle('rod')], 'S+60');
      b.action('slide', { name: 'Carrera del vástago', targets: [rodId], axis: 'x', from: 0, to: S, duration: 1.2, start: { type: 'time', t: 1 }, loop: 'pingpong' });
      void thread;
      return b.build();
    },
  },
];
