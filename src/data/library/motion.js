import { PartBuilder, circle, numberArg, rect } from './helpers.js';
import { defaultCommand } from '../../core/motion/commands.js';

// Plantillas industriales de control de movimiento. Cada una arma geometría simple + ejes (acciones `axis`) con su programa de comandos;
// todo se puede editar después en el panel de Escena. La posición modelada de cada pieza es la de t = 0 (startPos = 0).
const category = 'Control de movimiento (simulación)';
const cmd = (type, patch = {}, startPatch = {}) => {
  const base = defaultCommand(type, patch);
  return { ...base, start: { ...base.start, ...startPatch } };
};
const atTime = (t) => ({ type: 'time', t });

const axis = (b, name, targets, direction, motion, extra = {}) => b.action('axis', { name, targets, axis: direction, motion, ...extra });

export const motionItems = [
  {
    id: 'mov-cizalla-volante', category, label: 'Cizalla volante (Flying Shear): carro que se sincroniza con la banda y corta',
    description: 'La banda avanza a velocidad constante; el carro hace GearIn 1:1, el cuchillo baja y sube en sincronismo, GearOut y retorno.',
    ask: [{ name: 'speed', label: 'Velocidad de la banda (mm/s)', value: 200 }, { name: 'stroke', label: 'Carrera del carro (mm)', value: 400 }],
    build({ speed, stroke } = {}) {
      const v = numberArg(speed, 200);
      const L = numberArg(stroke, 400);
      const b = new PartBuilder('Cizalla volante', [['L', L]]);
      const web = b.add('XY', 0, [rect(1500, 120, 0, 0)], 2, { move: [0, 0, 0] });
      const carriage = b.add('XY', 20, [rect(120, 200, 0, 0)], 30);
      const knife = b.add('XY', 50, [rect(20, 160, 0, 0)], 40);
      const webId = axis(b, 'Banda', [web], 'x', { type: 'linear', vMax: v * 2, program: [cmd('moveVelocity', { velocity: v, hold: 0 })] });
      const carId = axis(b, 'Carro', [carriage], 'x', {
        type: 'linear', vMax: v * 3, aMax: 3000, program: [
          cmd('gearIn', { master: webId, mode: 'velocity' }, atTime(1)),
          cmd('gearOut', { after: 'stop' }, atTime(3.5)),
          cmd('moveAbsolute', { position: 0 }, { type: 'after', delay: 0 }),
        ],
      });
      axis(b, 'Cuchillo', [knife], 'z', { type: 'linear', vMax: 400, carriedBy: [carId], program: [cmd('moveRelative', { distance: -40 }, atTime(2)), cmd('moveRelative', { distance: 40 })] });
      return b.build();
    },
  },
  {
    id: 'mov-cuchilla-rotativa', category, label: 'Cuchilla rotativa (leva electrónica sincronizada con la línea)',
    description: 'La cuchilla gira con una leva que iguala la velocidad tangencial a la de la banda durante el corte y reparte la diferencia el resto de la vuelta.',
    ask: [{ name: 'speed', label: 'Velocidad de la banda (mm/s)', value: 300 }, { name: 'cut', label: 'Largo de corte (mm)', value: 600 }, { name: 'radius', label: 'Radio de la cuchilla (mm)', value: 80 }],
    build({ speed, cut, radius } = {}) {
      const v = numberArg(speed, 300);
      const C = numberArg(cut, 600);
      const R = numberArg(radius, 80);
      const b = new PartBuilder('Cuchilla rotativa', [['R', R]]);
      const web = b.add('XY', 0, [rect(1500, 120, 0, 0)], 2);
      const drum = b.add('XY', 150, [circle(R * 2, 0, 0)], 120);
      const blade = b.add('XY', 150 + 120, [rect(10, R * 2 + 20, 0, 0)], 20);
      const webId = axis(b, 'Banda', [web], 'x', { type: 'linear', vMax: v * 2, program: [cmd('moveVelocity', { velocity: v, hold: 0 })] });
      axis(b, 'Cuchilla', [drum, blade], 'y', {
        type: 'rotary', vMax: 720, aMax: 7200, program: [cmd('camIn', { master: webId, period: C, scale: 1, offset: 0, cycles: 'repeat', engage: 'smooth', cam: { kind: 'sync', cycleLength: C, windowLength: Math.min(C * 0.3, 120), slope: 180 / (Math.PI * R), net: 360 } }, atTime(0.5))],
      }, { pivot: [0, 0, 0] });
      return b.build();
    },
  },
  {
    id: 'mov-registro', category, label: 'Registro con marca (TouchProbe): alimentador corrige el error de cada marca',
    description: 'Cada marca de la banda llega con un error aleatorio y deriva; el eje esclavo mide con TouchProbe y desplaza el corte para compensarlo.',
    ask: [{ name: 'speed', label: 'Velocidad de la banda (mm/s)', value: 200 }, { name: 'pitch', label: 'Paso entre marcas (mm)', value: 200 }],
    build({ speed, pitch } = {}) {
      const v = numberArg(speed, 200);
      const P = numberArg(pitch, 200);
      const b = new PartBuilder('Registro de marca', [['P', P]]);
      const web = b.add('XY', 0, [rect(1500, 120, 0, 0)], 2);
      const head = b.add('XY', 20, [rect(60, 160, 0, 0)], 30);
      const webId = axis(b, 'Banda', [web], 'x', { type: 'linear', vMax: v * 2, program: [cmd('moveVelocity', { velocity: v, hold: 0 })] });
      axis(b, 'Cabezal', [head], 'x', {
        type: 'linear', vMax: v * 3, program: [cmd('gearIn', { master: webId, mode: 'velocity' }, atTime(0.5)), cmd('registration', { master: webId, pitch: P }, atTime(0.5))],
      });
      return b.build();
    },
  },
  {
    id: 'mov-bobinador', category, label: 'Bobinador / desbobinador (velocidad angular según el diámetro, con tensión)',
    ask: [{ name: 'speed', label: 'Velocidad de línea (mm/s)', value: 200 }, { name: 'core', label: 'Radio del núcleo (mm)', value: 40 }],
    build({ speed, core } = {}) {
      const v = numberArg(speed, 200);
      const R = numberArg(core, 40);
      const b = new PartBuilder('Bobinador', [['R', R]]);
      const reel = b.add('XY', 0, [circle(R * 2, 0, 0)], 100);
      const spokes = b.add('XY', 100, [rect(R * 2.4, 6, 0, 0)], 10);
      axis(b, 'Bobina', [reel, spokes], 'z', {
        type: 'rotary', vMax: 3600, aMax: 7200, program: [cmd('winder', { lineSpeed: v, coreRadius: R, thickness: 0.5, tension: 50, mode: 'winder' }, atTime(0))],
      }, { pivot: [0, 0, 0] });
      return b.build();
    },
  },
  {
    id: 'mov-mesa-indexadora', category, label: 'Mesa indexadora (pasos rotativos con pausa)',
    ask: [{ name: 'stations', label: 'Estaciones', value: 6 }, { name: 'diameter', label: 'Diámetro (mm)', value: 300 }],
    build({ stations, diameter } = {}) {
      const n = Math.max(2, Math.round(numberArg(stations, 6)));
      const D = numberArg(diameter, 300);
      const b = new PartBuilder('Mesa indexadora', [['D', D]]);
      const table = b.add('XY', 0, [circle(D, 0, 0)], 20);
      const marker = b.add('XY', 20, [rect(20, 20, D / 2 - 25, 0)], 10);
      const program = [];
      for (let i = 0; i < 12; i += 1) {
        program.push(cmd('moveRelative', { distance: 360 / n, velocity: 0 }, { type: 'after', delay: 0 }));
        program.push(cmd('wait', { duration: 0.8 }));
      }
      axis(b, 'Mesa', [table, marker], 'z', { type: 'rotary', vMax: 360, aMax: 1440, jerk: 14400, program }, { pivot: [0, 0, 0] });
      return b.build();
    },
  },
  {
    id: 'mov-pick-place', category, label: 'Pick & Place (pórtico XZ con ejes encadenados y ciclo repetitivo)',
    ask: [{ name: 'reach', label: 'Recorrido X (mm)', value: 300 }, { name: 'lift', label: 'Recorrido Z (mm)', value: 120 }],
    build({ reach, lift } = {}) {
      const X = numberArg(reach, 300);
      const Z = numberArg(lift, 120);
      const b = new PartBuilder('Pick & Place', [['X', X]]);
      const beam = b.add('XY', 0, [rect(X + 200, 40, 0, 0)], 20);
      const slider = b.add('XY', 20, [rect(60, 50, 0, 0)], 40);
      const gripper = b.add('XY', 60, [rect(20, 20, 0, 0)], 60);
      const xId = axis(b, 'Eje X', [slider], 'x', {
        type: 'linear', repeat: 3, program: [cmd('moveRelative', { distance: X }), cmd('wait', { duration: 0.4 }), cmd('moveRelative', { distance: -X }), cmd('wait', { duration: 0.4 })],
      });
      axis(b, 'Eje Z', [gripper], 'z', {
        type: 'linear', carriedBy: [xId], repeat: 3, program: [cmd('moveRelative', { distance: Z / 2 }), cmd('moveRelative', { distance: -Z / 2 }), cmd('wait', { duration: 0.7 }), cmd('moveRelative', { distance: Z / 2 }), cmd('moveRelative', { distance: -Z / 2 }), cmd('wait', { duration: 0.7 })],
      });
      void beam;
      return b.build();
    },
  },
];
