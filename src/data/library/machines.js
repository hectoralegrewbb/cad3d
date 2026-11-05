import { PartBuilder, circle, numberArg, onCircle, poly, rect } from './helpers.js';
import { motorCatalog, motorPatch } from '../motors.js';

const category = 'Máquinas completas (con escena lista)';
const motor = (id) => motorCatalog.find((m) => m.id === id);

// Patas y largueros de una mesa de transporte: dos bastidores laterales de tubo con travesaños.
function conveyorFrame(b, { L, W, topZ, post = 40 }) {
  const half = post / 2;
  const y0 = -(W / 2 + post);
  const y1 = W / 2 + post;
  const members = [];
  [0, L].forEach((x, i) => [y0, y1].forEach((y, j) => members.push({ a: [x, y, 0], b: [x, y, topZ - half], roll: 0, label: `Pata ${i * 2 + j + 1}` })));
  [y0, y1].forEach((y, j) => members.push({ a: [half, y, topZ - half], b: [L - half, y, topZ - half], roll: 0, label: `Larguero ${j + 1}` }));
  [0, L].forEach((x, i) => members.push({ a: [x, y0 + half, topZ - half], b: [x, y1 - half, topZ - half], roll: 0, label: `Travesaño ${i + 1}` }));
  members.push({ a: [half, y0, 220], b: [L - half, y0, 220], roll: 0, label: 'Refuerzo inferior 1' }, { a: [half, y1, 220], b: [L - half, y1, 220], roll: 0, label: 'Refuerzo inferior 2' });
  b.frame(members, { profile: 'tubo-40x40x2' });
}

export const machineItems = [
  {
    id: 'cinta-transportadora', category, label: 'Cinta transportadora completa: bastidor, tambores, guías, motor con reductor y cajas',
    ask: [{ name: 'length', label: 'Largo (mm)', value: 1500 }, { name: 'width', label: 'Ancho de cinta (mm)', value: 300 }, { name: 'speed', label: 'Velocidad de la cinta (mm/s)', value: 250 }],
    description: 'Escena lista: motor 0,37 kW con dinámica → reductor → tambor motriz → cinta (superficie que arrastra), un alimentador de cajas y una fotocelda al final. Iniciá ✦ Partículas con el caudal de granos en 0.',
    build({ length, width, speed } = {}) {
      const L = numberArg(length, 1500);
      const W = numberArg(width, 300);
      const v = numberArg(speed, 250);
      const Hb = 800; // altura de la superficie de la cinta
      const Dd = 160;
      const t = 6;
      const b = new PartBuilder(`Cinta transportadora ${L}×${W}`, [['L', L], ['W', W], ['Hb', Hb], ['Dd', Dd], ['t', t]]);
      conveyorFrame(b, { L, W, topZ: Hb - Dd / 2 - 8 });
      // cinta: cuerpo aparte (su superficie arrastra al producto)
      const belt = b.add('XY', 'Hb-t', [rect('L', 'W', 'L/2', 0)], 't');
      // tambor motriz (x = L) y de cola (x = 0): cilindros con eje a lo largo de Y
      const drive = b.add('XZ', 0, [circle('Dd', L, Hb - Dd / 2)], 'W+60', { symmetric: true });
      b.add('XZ', 0, [circle('Dd', 0, Hb - Dd / 2)], 'W+60', { symmetric: true });
      // guías laterales
      b.add('XY', 'Hb', [rect('L', 14, 'L/2', 'W/2+7')], 70);
      b.add('XY', 'Hb', [rect('L', 14, 'L/2', '-W/2-7')], 70);
      // motorreductor (cuerpo aparte, a un costado del tambor motriz)
      const mot = b.add('XY', 220, [rect(120, 90, L + 120, -(W / 2 + 140))], 90);
      const m = motor('0.37');
      const ratio = Math.max(2, Math.round((m.rpm / ((v * 60) / (Math.PI * Dd))) * 10) / 10); // reducción para que la cinta marche a v
      const aM = b.action('rotate', { name: 'Motor 0,37 kW', targets: [mot], axis: 'y', pivot: [L + 120, -(W / 2 + 140), 265], mode: 'continuous', ...motorPatch(m, 0.002), start: { type: 'time', t: 0.5 } });
      const aD = b.action('rotate', { name: 'Tambor motriz', targets: [drive], axis: 'y', pivot: [L, 0, Hb - Dd / 2], mode: 'follow', link: { master: aM, type: 'reductor', a: ratio, b: 1, ratio: 1, eff: 0.9, inertia: 0.05, pitch: 100 } });
      b.action('slide', { name: 'Cinta', targets: [belt], axis: 'x', mode: 'belt', link: { master: aD, type: 'manual', a: 1, b: 1, ratio: 1, eff: 0.95, inertia: 0, pitch: Math.PI * Dd }, speed: v });
      b.feeder({ name: 'Caja', size: [140, 110, 80], mass: 1.2, pos: [160, 0, Hb + 60], yaw: 0, every: 2.5, max: 10, friction: 0.5, start: 1 });
      b.sensor({ name: 'Fotocelda final', center: [L - 220, 0, Hb + 70], size: [160, W, 120], counts: 'productos' });
      return b.build();
    },
  },
  {
    id: 'linea-empujador', category, label: 'Línea con fotocelda y empujador neumático (la lógica arranca una acción)',
    ask: [{ name: 'length', label: 'Largo de la cinta (mm)', value: 1400 }, { name: 'speed', label: 'Velocidad (mm/s)', value: 300 }],
    description: 'Las cajas avanzan por la cinta; cuando la fotocelda detecta una, el empujador la saca de la cinta y vuelve. Ejemplo de «sensor → acción» con disparo por zona.',
    build({ length, speed } = {}) {
      const L = numberArg(length, 1400);
      const v = numberArg(speed, 300);
      const W = 300;
      const Hb = 600;
      const b = new PartBuilder(`Línea con empujador ${L}`, [['L', L], ['W', W], ['Hb', Hb]]);
      const belt = b.add('XY', 'Hb-6', [rect('L', 'W', 'L/2', 0)], 6);
      b.add('XY', 'Hb', [rect('L', 14, 'L/2', '-W/2-7')], 70); // guía del lado opuesto al empujador
      b.add('XY', 'Hb', [rect('L*0.55', 14, 'L*0.2', 'W/2+7')], 70); // guía del lado del empujador, interrumpida donde sale la caja
      b.add('XY', 'Hb', [rect(14, 'W+28', 'L-7', 0)], 70); // tope final
      b.add('XY', 'Hb-6', [rect(520, 300, 'L*0.78', 'W/2+170')], 6); // mesa de descarga lateral
      const pusher = b.add('XY', 'Hb+2', [rect(180, 24, 'L*0.78', '-W/2-12'), rect(40, 160, 'L*0.78', '-W/2-100')], 80); // pala + brazo
      b.action('slide', { name: 'Cinta', targets: [belt], axis: 'x', mode: 'belt', speed: v, start: { type: 'time', t: 0 } });
      const out = b.action('slide', { name: 'Empujador sale', targets: [pusher], axis: 'y', from: 0, to: W + 40, duration: 0.5, start: { type: 'zone', sensor: 's1', n: 1, delay: 0.15, rearm: true } });
      b.action('slide', { name: 'Empujador vuelve', targets: [pusher], axis: 'y', from: 0, to: -(W + 40), duration: 0.8, start: { type: 'after', action: out, delay: 0.3 } });
      b.sensor({ name: 'Fotocelda', center: [L * 0.78, 0, Hb + 60], size: [150, W, 110], counts: 'productos' });
      b.feeder({ name: 'Caja', size: [120, 100, 70], mass: 1, pos: [160, 0, Hb + 50], yaw: 0, every: 3, max: 6, friction: 0.5, start: 1 });
      return b.build();
    },
  },
  {
    id: 'transportador-rodillos', category, label: 'Transportador de rodillos motorizado con cajas',
    ask: [{ name: 'rollers', label: 'Cantidad de rodillos', value: 16 }, { name: 'pitch', label: 'Paso entre rodillos (mm)', value: 75 }, { name: 'speed', label: 'Velocidad de superficie (mm/s)', value: 300 }],
    description: 'Los rodillos se mueven como un solo cuerpo cuya superficie arrastra las cajas (modo cinta). Un tope al final las detiene.',
    build({ rollers, pitch, speed } = {}) {
      const n = Math.max(4, Math.min(30, Math.round(numberArg(rollers, 12))));
      const p = Math.max(numberArg(pitch, 75), 62);
      const v = numberArg(speed, 300);
      const W = 360;
      const D = 60;
      const L = (n - 1) * p + D;
      const Hb = 500;
      const b = new PartBuilder(`Transportador de rodillos ×${n}`, [['L', L], ['W', W], ['D', D]]);
      const ids = [];
      for (let i = 0; i < n; i += 1) ids.push(b.add('XZ', 0, [circle('D', D / 2 + i * p, Hb - D / 2)], 'W+20', { symmetric: true }));
      b.add('XY', Hb - D, [rect('L+40', 20, 'L/2', 'W/2+10')], 'D*0.8');
      b.add('XY', Hb - D, [rect('L+40', 20, 'L/2', '-W/2-10')], 'D*0.8');
      b.add('XY', Hb, [rect(14, 'W', 'L+6', 0)], 70);
      b.action('slide', { name: 'Rodillos (superficie)', targets: ids, axis: 'x', mode: 'belt', speed: v, start: { type: 'time', t: 0 } });
      b.feeder({ name: 'Caja', size: [140, 100, 70], mass: 1, pos: [80, 0, Hb + 50], yaw: 0, every: 2.5, max: 8, friction: 0.45, start: 1 });
      return b.build();
    },
  },
  {
    id: 'mesa-giratoria', category, label: 'Mesa giratoria con cajas y rascador fijo',
    ask: [{ name: 'd', label: 'Diámetro de la mesa (mm)', value: 800 }, { name: 'rpm', label: 'Velocidad (rpm)', value: 6 }],
    description: 'El plato gira y arrastra por fricción a las cajas que caen encima; un rascador fijo las empuja hacia afuera. Prueba la velocidad de superficie de cuerpos que giran.',
    build({ d, rpm } = {}) {
      const D = numberArg(d, 800);
      const b = new PartBuilder(`Mesa giratoria Ø${D}`, [['D', D]]);
      const table = b.add('XY', 400, [circle('D')], 20);
      b.add('XY', 380, [circle('D*0.12')], 20);
      b.add('XY', 0, [circle('D*0.12')], 380); // columna fija
      b.add('XY', 420, [circle('D*1.0+4'), circle('D')], 40); // borde: se mueve con el plato (misma operación abajo)
      b.add('XY', 420, [poly([['D/2-10', 'D*0.0'], ['D*0.08', 'D*0.36'], ['D*0.08', 'D*0.36+16'], ['D/2-10', 16]])], 50); // rascador fijo
      b.action('rotate', { name: 'Girar mesa', targets: [table], axis: 'z', pivot: [0, 0, 400], mode: 'continuous', rpm: numberArg(rpm, 6), start: { type: 'time', t: 0 } });
      b.feeder({ name: 'Caja', size: [110, 90, 70], mass: 1, pos: [-D * 0.28, 0, 520], yaw: 0, every: 4, max: 5, friction: 0.5, start: 1 });
      return b.build();
    },
  },
  {
    id: 'mezclador-paletas', category, label: 'Mezclador de paletas (artesa semicircular y rotor con motor y reductor)',
    ask: [{ name: 'd', label: 'Diámetro de la artesa (mm)', value: 160 }, { name: 'length', label: 'Largo (mm)', value: 300 }, { name: 'paddles', label: 'Paletas por vuelta (4 a 8)', value: 6 }],
    description: 'Motor catalogado con dinámica → reductor → rotor con paletas helicoidales. Medidas chicas para que los granos de la simulación (hasta 8000) cubran las paletas: elegí el material «Granulado», emisor sobre la artesa y mirá en el panel el par que pide el mezclado.',
    build({ d, length, paddles } = {}) {
      const D = numberArg(d, 400);
      const L = numberArg(length, 700);
      const n = Math.max(4, Math.min(8, Math.round(numberArg(paddles, 6))));
      const t = 4;
      const b = new PartBuilder(`Mezclador Ø${D}×${L}`, [['D', D], ['L', L], ['t', t]]);
      // artesa: tubo medio (abierto arriba) con tapas; el eje del rotor corre a lo largo de X a la altura del centro del medio caño
      b.add('YZ', 0, [circle('D+2*t'), circle('D')], 'L');
      b.cut('YZ', 0, [rect('D+4*t', 'D/2+t', 0, '(D/2+t)/2')], 'L', { reverse: false });
      b.add('YZ', -10, [circle('D+2*t+20')], 10);
      b.add('YZ', 'L', [circle('D+2*t+20')], 10);
      // rotor
      const shaft = b.add('YZ', -60, [circle(26)], 'L+120');
      const blades = [];
      for (let i = 0; i < n; i += 1) {
        const phase = (i * 360) / n;
        const x = 20 + (i * (L - 70)) / (n - 1 || 1);
        const id = b.add('YZ', x, [rect('D*0.42', 'D*0.14', 'D*0.26', 0)], 24);
        b.turn(id, 'x', phase, [x, 0, 0]);
        blades.push(id);
      }
      // motor (cuerpo aparte) y reductor 1:25 hacia el rotor
      const motorBody = b.add('XY', -D / 2 - 60, [rect(120, 90, -170, 0)], 90);
      const m = motor('2.2');
      const aM = b.action('rotate', { name: 'Motor 2,2 kW', targets: [motorBody], axis: 'x', pivot: [-170, 0, 0], mode: 'continuous', ...motorPatch(m, 0.01), start: { type: 'time', t: 0.2 } });
      b.action('rotate', { name: 'Rotor del mezclador', targets: [shaft, ...blades], axis: 'x', pivot: [0, 0, 0], mode: 'follow', link: { master: aM, type: 'reductor', a: 25, b: 1, ratio: 1, eff: 0.92, inertia: 0.4, pitch: 100 } });
      return b.build();
    },
  },
  {
    id: 'tornillo-alimentador-motor', category, label: 'Alimentador a tornillo con tolva, motor y reductor',
    ask: [{ name: 'length', label: 'Largo del tubo (mm)', value: 600 }, { name: 'd', label: 'Diámetro del tornillo (mm)', value: 100 }],
    description: 'Tolva, tubo con tornillo sin fin (operación aparte) y motor catalogado con reductor. El tornillo transporta lo que cae de la tolva; mirá la carga sobre el motor en el panel.',
    build({ length, d } = {}) {
      const L = numberArg(length, 600);
      const D = numberArg(d, 100);
      const b = new PartBuilder(`Alimentador a tornillo Ø${D}×${L}`, [['L', L], ['D', D], ['Dc', D + 16]]);
      // tubo (camisa) abierto en ambos extremos, eje a lo largo de X
      b.add('YZ', 0, [circle('Dc+8'), circle('Dc')], 'L');
      // tolva de entrada (sin fondo) sobre el primer tercio y boca de descarga abajo al final
      b.add('XY', 'Dc/2', [rect('D*1.5+8', 'D*1.5+8', 'D*0.9', 0), rect('D*1.5', 'D*1.5', 'D*0.9', 0)], 'D*1.6');
      b.cut('XY', 'Dc/2+4', [rect('D*1.2', 'D*1.2', 'D*0.9', 0)], 'D*0.6', { reverse: true });
      const screw = b.feature('screw', { plane: 'YZ', offset: 0, length: 'L', shaft: 24, outer: 'D', pitch: 'D*0.8', thickness: 4, starts: 1 });
      const motorBody = b.add('XY', -D, [rect(200, 150, -170, 0)], 150);
      const m = motor('0.75');
      const aM = b.action('rotate', { name: 'Motor 0,75 kW', targets: [motorBody], axis: 'x', pivot: [-170, 0, 0], mode: 'continuous', ...motorPatch(m, 0.004), start: { type: 'time', t: 0.2 } });
      b.action('rotate', { name: 'Tornillo', targets: [screw], axis: 'x', pivot: [0, 0, 0], mode: 'follow', link: { master: aM, type: 'reductor', a: 20, b: 1, ratio: 1, eff: 0.9, inertia: 0.02, pitch: 100 } });
      return b.build();
    },
  },
];
