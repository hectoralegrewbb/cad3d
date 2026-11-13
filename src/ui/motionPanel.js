import { actionKinds } from '../core/actions.js';
import { axisTypes, commandTypes, commandGroups, defaultCommand, homingMethods, segmentTypes, startModes } from '../core/motion/commands.js';
import { profileKinds } from '../core/motion/profiles.js';
import { getMotionPlan } from '../core/motion/index.js';
import { button, checkInput, el, field, selectInput, textInput } from './dom.js';
import { drawChart } from './seriesChart.js';

// Cuerpo de las tarjetas «Eje de movimiento» y «Trayectoria interpolada» del panel de escena.
// `panel` = el ScenePanel (aporta num / triple / render); `set(patch)` actualiza la acción.
const plots = { x: ['Posición', 'x'], v: ['Velocidad', 'v'], a: ['Aceleración', 'a'], force: ['Fuerza / par', 'force'] };
const toNumber = (value, fallback) => {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
const move = (list, index, delta) => {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
};

// Gráfico de la simulación del eje (posición, velocidad, aceleración o fuerza) más los eventos del programa.
function plotBlock(panel, action, scene) {
  const plan = getMotionPlan(scene.actions);
  const data = plan?.series(action.id);
  if (!data) return null;
  const which = panel.motionPlot?.[action.id] ?? 'x';
  const canvas = el('canvas', { width: 320, height: 150, class: 'motion-chart' });
  const unit = action.motion.type === 'rotary' ? '°' : 'mm';
  queueMicrotask(() => drawChart(canvas, [{ name: plots[which][0], times: data.times, values: data[plots[which][1]] }], { yLabel: `${plots[which][0]} (${unit})` }));
  const events = plan.axes.get(action.id)?.events ?? [];
  return el('div', {},
    field('Gráfico', selectInput(Object.entries(plots).map(([key, [label]]) => [key, label]), which, (value) => { panel.motionPlot = { ...(panel.motionPlot ?? {}), [action.id]: value }; panel.render(); })),
    canvas,
    events.length ? el('p', { class: 'muted', text: events.slice(0, 12).map((event) => `${(Math.round(event.t * 100) / 100).toString().replace('.', ',')} s · ${event.note ?? event.type}`).join(' · ') }) : null);
}

function camEditor(panel, command, setCommand) {
  const cam = command.cam ?? { kind: 'rise' };
  const setCam = (patch) => setCommand({ cam: { ...cam, ...patch } });
  const kinds = [['rise', 'Subida · reposo · bajada'], ['sync', 'Sincronizada con la línea (corte al vuelo)'], ['table', 'Tabla de puntos']];
  const rows = [field('Tipo de leva', selectInput(kinds, cam.kind ?? 'rise', (value) => setCam({ kind: value })))];
  if (cam.kind === 'sync') {
    rows.push(
      panel.num('Largo del ciclo', cam.cycleLength ?? command.period, (value) => setCam({ cycleLength: Math.max(1e-3, value) }), 'maestro'),
      panel.num('Ventana de sincronismo', cam.windowLength ?? 0, (value) => setCam({ windowLength: Math.max(0, value) }), 'maestro'),
      panel.num('Pendiente en la ventana', cam.slope ?? 1, (value) => setCam({ slope: value }), 'esclavo/maestro'),
      panel.num('Avance neto por ciclo', cam.net ?? 0, (value) => setCam({ net: value }), 'esclavo'));
  } else if (cam.kind === 'table') {
    const text = (cam.points ?? [[0, 0], [0.5, 1], [1, 0]]).map(([u, y]) => `${u}:${y}`).join(' ');
    rows.push(field('Puntos fase:valor', textInput(text, (value) => setCam({ points: value.split(/\s+/).map((pair) => pair.split(':').map((n) => toNumber(n, 0))).filter((pair) => pair.length === 2) }))));
  } else {
    rows.push(
      panel.num('Carrera', cam.stroke ?? 1, (value) => setCam({ stroke: value }), 'esclavo'),
      panel.num('Fracción de subida', cam.rise ?? 0.4, (value) => setCam({ rise: Math.max(0.01, value) }), '0–1'),
      panel.num('Fracción en reposo arriba', cam.dwellHigh ?? 0.1, (value) => setCam({ dwellHigh: Math.max(0, value) }), '0–1'),
      panel.num('Fracción de bajada', cam.fall ?? 0.4, (value) => setCam({ fall: Math.max(0.01, value) }), '0–1'));
  }
  return el('div', { class: 'motion-sub' }, ...rows);
}

function commandCard(panel, action, scene, command, index, setProgram) {
  const program = action.motion.program;
  const spec = commandTypes[command.type];
  const setCommand = (patch) => setProgram(program.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const setStart = (patch) => setCommand({ start: { ...command.start, ...patch } });
  const masters = scene.actions.filter((item) => item.kind === 'axis' && item.id !== action.id);
  const groups = commandGroups.map((group) => el('optgroup', { label: group }, ...Object.entries(commandTypes).filter(([, type]) => type.group === group).map(([key, type]) => el('option', { value: key, selected: key === command.type }, type.label))));
  const typeSelect = el('select', {}, ...groups);
  typeSelect.addEventListener('change', () => setCommand({ ...defaultCommand(typeSelect.value), id: command.id }));
  const rows = (spec?.params ?? []).map((param) => {
    if (param.kind === 'select') return field(param.label, selectInput(Object.entries(param.options), String(command[param.key] ?? param.value), (value) => setCommand({ [param.key]: value })));
    if (param.kind === 'master') return field(param.label, selectInput([['', '— elegí —'], ...masters.map((item) => [item.id, item.name || item.id])], command[param.key] ?? '', (value) => setCommand({ [param.key]: value })));
    return panel.num(param.label, command[param.key] ?? param.value, (value) => setCommand({ [param.key]: value }), param.unit);
  });
  return el('div', { class: 'motion-cmd' },
    el('div', { class: 'row-wrap' },
      el('b', { text: `${index + 1}.` }), typeSelect,
      button('↑', () => setProgram(move(program, index, -1)), { title: 'Subir' }),
      button('↓', () => setProgram(move(program, index, 1)), { title: 'Bajar' }),
      button('✕', () => setProgram(program.filter((_, i) => i !== index)), { danger: true, title: 'Quitar comando' })),
    field('Arranca', selectInput(Object.entries(startModes), command.start?.type ?? 'after', (value) => setStart({ type: value }))),
    command.start?.type === 'time' ? panel.num('Segundo', command.start.t ?? 0, (value) => setStart({ t: Math.max(0, value) }), 's') : panel.num('Demora', command.start?.delay ?? 0, (value) => setStart({ delay: Math.max(0, value) }), 's'),
    command.start?.type === 'time' ? field('Si hay algo en marcha', selectInput([['abort', 'Interrumpirlo'], ['wait', 'Esperar a que termine']], command.start.interrupt ?? 'abort', (value) => setStart({ interrupt: value }))) : null,
    ...rows,
    command.type === 'camIn' ? camEditor(panel, command, setCommand) : null);
}

export function axisBody(panel, action, scene, set) {
  const motion = action.motion;
  const setMotion = (patch) => set({ motion: { ...motion, ...patch } });
  const setProgram = (program) => setMotion({ program });
  const rotary = motion.type === 'rotary';
  const unit = rotary ? '°' : 'mm';
  const linearAxes = scene.actions.filter((item) => item.kind === 'axis' && item.id !== action.id && item.motion?.type !== 'rotary');
  const paths = scene.actions.filter((item) => item.kind === 'path');
  const homing = motion.homing ?? {};
  const setHoming = (patch) => setMotion({ homing: { ...homing, ...patch } });
  const usesHoming = (motion.program ?? []).some((command) => command.type === 'home');
  return [
    field('Tipo de eje', selectInput(Object.entries(axisTypes), motion.type, (value) => set({ motion: { ...motion, type: value, vMax: value === 'rotary' ? 360 : 500, aMax: value === 'rotary' ? 1440 : 2000, jerk: value === 'rotary' ? 14400 : 20000, vJog: value === 'rotary' ? 90 : 100 } }))),
    panel.num(`Posición de la pieza modelada`, motion.startPos, (value) => setMotion({ startPos: value }), unit),
    field('Perfil de movimiento', selectInput(Object.entries(profileKinds), motion.profile, (value) => setMotion({ profile: value }))),
    panel.num('Velocidad máxima', motion.vMax, (value) => setMotion({ vMax: Math.max(1e-3, value) }), `${unit}/s`),
    panel.num('Aceleración máxima', motion.aMax, (value) => setMotion({ aMax: Math.max(1e-3, value) }), `${unit}/s²`),
    panel.num('Jerk máximo (curva en S)', motion.jerk, (value) => setMotion({ jerk: Math.max(1e-3, value) }), `${unit}/s³`),
    panel.num('Velocidad de jog', motion.vJog, (value) => setMotion({ vJog: Math.max(0, value) }), `${unit}/s`),
    panel.num('Inicio del programa', motion.startTime ?? 0, (value) => setMotion({ startTime: Math.max(0, value) }), 's'),
    panel.num('Repeticiones del programa (0 = sin parar)', motion.repeat ?? 1, (value) => setMotion({ repeat: Math.max(0, Math.round(value)) }), ''),
    checkInput(motion.referenced !== false, (on) => setMotion({ referenced: on }), 'Eje ya referenciado (si no, hace falta Homing antes de MoveAbsolute)'),
    rotary ? null : el('div', {}, el('b', { text: 'Limites de carrera (vacío = sin límite)' }),
      field(`Mínimo (${unit})`, textInput(motion.posMin ?? '', (text) => setMotion({ posMin: text.trim() === '' ? null : toNumber(text, null) }))),
      field(`Máximo (${unit})`, textInput(motion.posMax ?? '', (text) => setMotion({ posMax: text.trim() === '' ? null : toNumber(text, null) })))),
    el('b', { text: 'Carga (para MoveTorque)' }),
    panel.num('Inercia / masa', motion.inertia, (value) => setMotion({ inertia: Math.max(1e-6, value) }), rotary ? 'kg·m²' : 'kg'),
    panel.num('Fricción viscosa', motion.viscous, (value) => setMotion({ viscous: Math.max(0, value) }), ''),
    panel.num('Fricción de Coulomb', motion.coulomb, (value) => setMotion({ coulomb: Math.max(0, value) }), ''),
    panel.num('Fuerza constante (gravedad, peso)', motion.loadForce, (value) => setMotion({ loadForce: value }), ''),
    usesHoming || motion.referenced === false ? el('div', { class: 'motion-sub' },
      el('b', { text: 'Homing' }),
      field('Método', selectInput(Object.entries(homingMethods), homing.method ?? 'switchMark', (value) => setHoming({ method: value }))),
      field('Sentido de búsqueda', selectInput([['-1', '− (atrás)'], ['1', '+ (adelante)']], String(homing.dir ?? -1), (value) => setHoming({ dir: Number(value) }))),
      panel.num('Posición del final de carrera / tope', homing.limitPos ?? -100, (value) => setHoming({ limitPos: value }), unit),
      panel.num('Velocidad de búsqueda', homing.searchVel ?? 100, (value) => setHoming({ searchVel: Math.abs(value) }), `${unit}/s`),
      panel.num('Velocidad de aproximación', homing.creepVel ?? 10, (value) => setHoming({ creepVel: Math.abs(value) }), `${unit}/s`),
      panel.num('Distancia a la marca cero', homing.markDistance ?? 2, (value) => setHoming({ markDistance: Math.abs(value) }), unit),
      panel.num('Retroceso tras el flanco', homing.backoff ?? 2, (value) => setHoming({ backoff: Math.abs(value) }), unit),
      panel.num('Posición asignada al terminar', homing.offset ?? 0, (value) => setHoming({ offset: value }), unit)) : null,
    rotary ? null : el('div', { class: 'motion-sub' },
      el('b', { text: 'Lo transportan (ejes que lo desplazan)' }),
      ...(linearAxes.length ? linearAxes.map((item) => checkInput((motion.carriedBy ?? []).includes(item.id), (on) => setMotion({ carriedBy: on ? [...(motion.carriedBy ?? []), item.id] : (motion.carriedBy ?? []).filter((id) => id !== item.id) }), item.name || item.id)) : [el('p', { class: 'muted', text: 'No hay otros ejes lineales. Ej.: el eje Z de un pórtico viaja con el eje X.' })]),
      paths.length ? field('Sigue una trayectoria', selectInput([['', '— ninguna —'], ...paths.map((item) => [item.id, item.name || item.id])], motion.source?.path ?? '', (value) => setMotion({ source: value ? { path: value, component: motion.source?.component ?? 0 } : null }))) : null,
      motion.source ? field('Componente de la trayectoria', selectInput([['0', 'X'], ['1', 'Y'], ['2', 'Z']], String(motion.source.component ?? 0), (value) => setMotion({ source: { ...motion.source, component: Number(value) } }))) : null),
    el('b', { text: 'Programa de comandos (se ejecutan en orden)' }),
    ...(motion.program ?? []).map((command, index) => commandCard(panel, action, scene, command, index, setProgram)),
    el('div', { class: 'row-wrap' }, ...['moveAbsolute', 'moveRelative', 'moveVelocity', 'jog', 'home', 'moveTorque', 'gearIn', 'camIn'].map((type) => button(`+ ${commandTypes[type].label.split(' (')[0]}`, () => setProgram([...(motion.program ?? []), defaultCommand(type)]), { title: commandTypes[type].label })),
      button('+ otro…', () => setProgram([...(motion.program ?? []), defaultCommand('wait')]), { title: 'Agrega una espera; cambiale el tipo en la lista' })),
    plotBlock(panel, action, scene),
  ].filter(Boolean);
}

export function pathBody(panel, action, scene, set) {
  const motion = action.motion;
  const setMotion = (patch) => set({ motion: { ...motion, ...patch } });
  const setSegments = (segments) => setMotion({ segments });
  const setSegment = (index, patch) => setSegments(motion.segments.map((segment, i) => (i === index ? { ...segment, ...patch } : segment)));
  const plan = getMotionPlan(scene.actions);
  const info = plan?.pathState(action.id, 0);
  const built = plan?.paths.get(action.id);
  return [
    panel.triple('Punto de partida', motion.start, (value) => setMotion({ start: value })),
    panel.num('Velocidad de avance', motion.velocity, (value) => setMotion({ velocity: Math.max(1e-3, value) }), 'mm/s'),
    panel.num('Aceleración', motion.accel, (value) => setMotion({ accel: Math.max(1e-3, value) }), 'mm/s²'),
    panel.num('Jerk', motion.jerk, (value) => setMotion({ jerk: Math.max(1e-3, value) }), 'mm/s³'),
    field('Perfil', selectInput(Object.entries(profileKinds), motion.profile, (value) => setMotion({ profile: value }))),
    panel.num('Pausa en cada parada', motion.dwell ?? 0, (value) => setMotion({ dwell: Math.max(0, value) }), 's'),
    panel.num('Inicio', motion.startTime ?? 0, (value) => setMotion({ startTime: Math.max(0, value) }), 's'),
    el('b', { text: 'Segmentos' }),
    ...motion.segments.map((segment, index) => el('div', { class: 'motion-cmd' },
      el('div', { class: 'row-wrap' },
        el('b', { text: `${index + 1}.` }),
        selectInput(Object.entries(segmentTypes), segment.type, (value) => setSegment(index, value === 'line' ? { type: value } : { type: value, plane: segment.plane ?? 'xy', center: segment.center ?? [-50, 0], ccw: segment.ccw ?? true, turns: segment.turns ?? 0 })),
        button('↑', () => setSegments(move(motion.segments, index, -1))),
        button('↓', () => setSegments(move(motion.segments, index, 1))),
        button('✕', () => setSegments(motion.segments.filter((_, i) => i !== index)), { danger: true })),
      panel.triple('Punto final', segment.to ?? [0, 0, 0], (value) => setSegment(index, { to: value })),
      panel.num('Redondeo del vértice final (blending)', segment.blend ?? 0, (value) => setSegment(index, { blend: Math.max(0, value) }), 'mm'),
      panel.num('Velocidad en este tramo (0 = la general)', segment.feed ?? 0, (value) => setSegment(index, { feed: Math.max(0, value) }), 'mm/s'),
      segment.type === 'line' ? null : el('div', {},
        field('Plano', selectInput([['xy', 'XY'], ['xz', 'XZ'], ['yz', 'YZ']], segment.plane ?? 'xy', (value) => setSegment(index, { plane: value }))),
        panel.triple('Centro respecto del punto inicial (i, j)', [...(segment.center ?? [0, 0])].slice(0, 2), (value) => setSegment(index, { center: value.slice(0, 2) }), 'mm'),
        checkInput(segment.ccw !== false, (on) => setSegment(index, { ccw: on }), 'Antihorario'),
        panel.num('Vueltas completas extra', segment.turns ?? 0, (value) => setSegment(index, { turns: Math.max(0, Math.round(value)) }), '')))),
    el('div', { class: 'row-wrap' },
      button('+ Línea', () => setSegments([...motion.segments, { type: 'line', to: [...(motion.segments.at(-1)?.to ?? motion.start)], blend: 0, feed: 0 }])),
      button('+ Arco', () => setSegments([...motion.segments, { type: 'arc', plane: 'xy', to: [...(motion.segments.at(-1)?.to ?? motion.start)], center: [-50, 0], ccw: true, turns: 0, blend: 0, feed: 0 }])),
      button('+ Hélice', () => setSegments([...motion.segments, { type: 'helix', plane: 'xy', to: [...(motion.segments.at(-1)?.to ?? motion.start)].map((v, i) => (i === 2 ? v + 20 : v)), center: [-50, 0], ccw: true, turns: 1, blend: 0, feed: 0 }]))),
    built ? el('p', { class: 'muted', text: `Largo ${Math.round(built.length * 10) / 10} mm · duración ${Math.round(built.duration * 100) / 100} s. Para mover piezas: creá ejes («Eje de movimiento») y en «Sigue una trayectoria» elegí esta y el componente X, Y o Z.` }) : null,
    info ? null : null,
  ].filter(Boolean);
}

export const motionKinds = ['axis', 'path'];
export const motionKindLabel = (kind) => actionKinds[kind];
