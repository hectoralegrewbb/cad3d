// Definición de ejes y comandos de movimiento (datos puros). Un eje es una acción `kind: 'axis'` con `motion` = configuración + programa.
// El programa es una lista de comandos estilo PLCopen que se ejecutan en orden; cada uno puede disparar «al terminar el anterior»,
// «junto con el anterior» o «en el segundo t» (interrumpiendo lo que esté en marcha).
import { normalizeLimits, profileKinds } from './profiles.js';

export const axisTypes = { linear: 'Lineal (mm)', rotary: 'Rotativo (°)' };
export const startModes = { after: 'Al terminar el anterior', with: 'Junto con el anterior', time: 'En el segundo…' };
export const homingMethods = { switchMark: 'Final de carrera + marca cero del encoder', switch: 'Solo final de carrera (flanco)', blockStop: 'Contra tope mecánico (por par)', direct: 'Poner posición (encoder absoluto, sin mover)' };

// Esquema de parámetros por comando: { key, label, unit?, kind: number | select | bool | master | text, options?, value }. Sirve para la UI y para validar.
const num = (key, label, value, unit = '') => ({ key, label, unit, kind: 'number', value });
const sel = (key, label, options, value) => ({ key, label, kind: 'select', options, value });
const master = (key = 'master', label = 'Eje maestro') => ({ key, label, kind: 'master', value: '' });
const profilePick = sel('profile', 'Perfil (vacío = el del eje)', { '': 'Del eje', ...profileKinds }, '');
const overrides = [num('velocity', 'Velocidad (0 = máx. del eje)', 0, '/s'), num('accel', 'Aceleración (0 = del eje)', 0, '/s²'), num('jerk', 'Jerk (0 = del eje)', 0, '/s³'), profilePick];

export const commandTypes = {
  jog: { label: 'Jog (manual continuo)', group: 'Un eje', params: [sel('direction', 'Sentido', { 1: '+ (adelante)', '-1': '− (atrás)' }, '1'), num('velocity', 'Velocidad (0 = jog del eje)', 0, '/s'), num('hold', 'Tiempo con la señal activa', 2, 's'), num('accel', 'Aceleración (0 = del eje)', 0, '/s²'), profilePick] },
  home: { label: 'Homing (referenciar)', group: 'Un eje', params: [] },
  moveAbsolute: { label: 'MoveAbsolute (a una coordenada)', group: 'Un eje', params: [num('position', 'Posición', 0), sel('direction', 'Sentido (rotativo)', { shortest: 'Camino más corto', positive: 'Siempre +', negative: 'Siempre −' }, 'shortest'), ...overrides] },
  moveRelative: { label: 'MoveRelative (una distancia)', group: 'Un eje', params: [num('distance', 'Distancia', 10), ...overrides] },
  moveVelocity: { label: 'MoveVelocity (mantener velocidad)', group: 'Un eje', params: [num('velocity', 'Velocidad objetivo', 100, '/s'), num('hold', 'Mantener (0 = hasta el próximo comando)', 0, 's'), num('accel', 'Aceleración (0 = del eje)', 0, '/s²'), num('jerk', 'Jerk (0 = del eje)', 0, '/s³'), profilePick] },
  moveTorque: { label: 'MoveTorque (par / fuerza)', group: 'Un eje', params: [num('torque', 'Fuerza (N) o par (N·m)', 50), num('velocityLimit', 'Límite de velocidad (0 = del eje)', 0, '/s'), num('rampTime', 'Rampa de par', 0.1, 's'), num('duration', 'Duración', 2, 's'), num('contactPos', 'Tope / pieza en la posición (vacío = sin tope)', '', ''), num('stiffness', 'Rigidez del tope (N/mm o N·m/°)', 200)] },
  moveSuperimposed: { label: 'MoveSuperimposed (corrección en marcha)', group: 'Un eje', params: [num('distance', 'Desplazamiento extra', 5), ...overrides] },
  stop: { label: 'Parada controlada', group: 'Un eje', params: [num('accel', 'Desaceleración (0 = del eje)', 0, '/s²')] },
  wait: { label: 'Esperar', group: 'Un eje', params: [num('duration', 'Tiempo', 1, 's')] },
  gearIn: { label: 'GearIn (engranaje electrónico)', group: 'Sincronismo', params: [master(), num('numerator', 'Relación: esclavo (numerador)', 1), num('denominator', 'Relación: maestro (denominador)', 1), sel('mode', 'Enganche', { velocity: 'Solo velocidad (fase libre)', position: 'En posición (fase exacta)' }, 'velocity'), num('syncMasterPos', 'Posición del maestro al enganchar', 0), num('syncSlavePos', 'Posición del esclavo al enganchar', 0), num('period', 'Repetir cada (maestro, 0 = una vez)', 0), num('accel', 'Aceleración de enganche (0 = del eje)', 0, '/s²')] },
  gearOut: { label: 'GearOut (soltar engranaje)', group: 'Sincronismo', params: [sel('after', 'Al soltar', { stop: 'Frenar el esclavo', continue: 'Seguir a velocidad constante' }, 'stop')] },
  phasing: { label: 'Phasing (desfasar en marcha)', group: 'Sincronismo', params: [num('shift', 'Desfase', 5), num('duration', 'Tiempo del ajuste', 1, 's')] },
  camIn: { label: 'CamIn (leva electrónica)', group: 'Sincronismo', params: [master(), num('period', 'Ciclo = distancia del maestro', 100), num('scale', 'Escala de la leva (× recorrido)', 1), num('offset', 'Posición base del esclavo', 0), num('syncMasterPos', 'Maestro al comenzar un ciclo', 0), sel('cycles', 'Ciclos', { repeat: 'Repetir', once: 'Una vez' }, 'repeat'), sel('engage', 'Enganche', { smooth: 'Empalme suave', ready: 'Ya en posición' }, 'smooth')] },
  registration: { label: 'Registro con marca (TouchProbe)', group: 'Sincronismo', params: [master(), num('pitch', 'Paso entre marcas (maestro)', 200), num('markPhase', 'Posición de la marca en el paso', 0), num('jitter', 'Error aleatorio de cada marca (±)', 2), num('drift', 'Deriva por marca (acumulada)', 0.3), num('seed', 'Semilla', 1), num('correctionLimit', 'Corrección máxima por marca', 5), num('duration', 'Tiempo de cada ajuste', 0.4, 's'), num('ratio', 'Relación esclavo/maestro', 1)] },
  winder: { label: 'Bobinador / desbobinador (velocidad + par)', group: 'Sincronismo', params: [master('master', 'Eje de línea (vacío = velocidad fija)'), num('lineSpeed', 'Velocidad de línea fija (mm/s)', 200), sel('mode', 'Modo', { winder: 'Bobinador (el diámetro crece)', unwinder: 'Desbobinador (el diámetro baja)' }, 'winder'), num('coreRadius', 'Radio del núcleo (mm)', 40), num('thickness', 'Espesor del material (mm)', 0.5), num('startRadius', 'Radio inicial (mm, vacío = núcleo/lleno)', ''), num('tension', 'Tensión (N)', 50), num('duration', 'Duración (0 = hasta el final)', 0, 's')] },
};

export const commandGroups = [...new Set(Object.values(commandTypes).map((type) => type.group))];

let commandCounter = 0;
export const newCommandId = () => `c${(commandCounter += 1)}`;

export function defaultCommand(type = 'moveRelative', patch = {}) {
  const spec = commandTypes[type] ?? commandTypes.moveRelative;
  const values = {};
  spec.params.forEach((param) => { values[param.key] = param.value; });
  const extra = type === 'camIn' ? { cam: { kind: 'rise', stroke: 100, rise: 0.4, dwellHigh: 0.1, fall: 0.4, law: 'cycloidal' } } : {};
  return { id: newCommandId(), type, start: { type: 'after', delay: 0, t: 0, interrupt: 'abort' }, ...values, ...extra, ...patch };
}

export const defaultMotion = (type = 'linear', patch = {}) => ({
  type,
  startPos: 0, // posición física donde está modelada la pieza (t = 0): el desplazamiento es relativo a ella
  referenced: true, // false: hay que ejecutar Homing antes de MoveAbsolute
  vMax: type === 'rotary' ? 360 : 500,
  aMax: type === 'rotary' ? 1440 : 2000,
  jerk: type === 'rotary' ? 14400 : 20000,
  profile: 'scurve',
  vJog: type === 'rotary' ? 90 : 100,
  posMin: null,
  posMax: null,
  modulo: 360,
  inertia: type === 'rotary' ? 0.05 : 10, // kg o kg·m²
  viscous: 0,
  coulomb: 0,
  loadForce: 0,
  homing: { method: 'switchMark', dir: -1, limitPos: -100, searchVel: 100, creepVel: 10, markDistance: 2, backoff: 2, offset: 0 },
  carriedBy: [],
  source: null, // { path: id, component: 0 | 1 | 2 }: la posición sale de una trayectoria interpolada
  program: [],
  repeat: 1, // 0 = repetir el programa sin parar
  startTime: 0,
  ...patch,
});

export const defaultAxisAction = (patch = {}) => ({ motion: defaultMotion(patch.motion?.type ?? 'linear', patch.motion), ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'motion')) });

// Segmento de una trayectoria interpolada (ver path.js).
export const segmentTypes = { line: 'Línea recta', arc: 'Arco / círculo / espiral', helix: 'Hélice (arco + avance)' };

export const defaultPathMotion = (patch = {}) => ({
  start: [0, 0, 0],
  velocity: 200,
  accel: 1000,
  jerk: 10000,
  profile: 'scurve',
  startTime: 0,
  dwell: 0, // pausa en cada vértice donde el eje se detiene
  segments: [{ type: 'line', to: [100, 0, 0], blend: 0, feed: 0 }],
  ...patch,
});

// Límites de un eje con los valores que el comando sobrescribe (0 / vacío = los del eje).
export function limitsFor(motion, command = {}) {
  const pick = (own, over) => (Number(over) > 0 ? Math.min(Number(over), own) : own);
  return normalizeLimits({ vMax: pick(motion.vMax, command.velocity), aMax: Number(command.accel) > 0 ? Number(command.accel) : motion.aMax, jerk: Number(command.jerk) > 0 ? Number(command.jerk) : motion.jerk });
}

export const profileOf = (motion, command = {}) => (profileKinds[command.profile] ? command.profile : motion.profile);

// Avisos de configuración de un eje (no impiden simular).
export function validateMotion(action, actions = []) {
  const warnings = [];
  const label = action.name || action.id;
  const motion = action.motion;
  if (!motion) return warnings;
  const ids = new Set(actions.map((item) => item.id));
  if (!action.targets?.length) warnings.push(`${label}: no tiene nada tildado para mover`);
  if (motion.source && !actions.some((item) => item.id === motion.source.path && item.kind === 'path')) warnings.push(`${label}: la trayectoria que lo mueve no existe`);
  (motion.carriedBy ?? []).forEach((id) => { if (!ids.has(id)) warnings.push(`${label}: el eje que lo transporta ya no existe`); });
  (motion.program ?? []).forEach((command, index) => {
    const spec = commandTypes[command.type];
    if (!spec) return warnings.push(`${label}: comando ${index + 1} desconocido`);
    if (spec.params.some((param) => param.kind === 'master') && command.type !== 'winder' && !actions.some((item) => item.id === command.master && item.kind === 'axis' && item.id !== action.id)) warnings.push(`${label}: «${spec.label}» necesita un eje maestro válido`);
    if (command.type === 'gearIn' && !(Number(command.denominator) !== 0 && Number(command.numerator) !== 0)) warnings.push(`${label}: la relación de engranaje no puede ser 0`);
  });
  return warnings;
}
