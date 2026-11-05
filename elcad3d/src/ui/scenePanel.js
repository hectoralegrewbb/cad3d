import { actionKinds, loopKinds, startKinds, validateActions, linkRatio, linkTypes } from '../core/actions.js';
import { sceneOps } from '../core/scene.js';
import { button, checkInput, el, field, selectInput, textInput } from './dom.js';

// Panel ⚡ Acciones y aire: acciones (girar / deslizar / aire) con disparos encadenados + boquillas de aire.
// `hooks`: { getScene(), setScene(reducer), getTargets() → [{id,label}], pivotFor(ids) → [x,y,z]|null, onPlay(), onStop(), isPlaying() }.
const toNumber = (value, fallback) => {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
const fmt = (value) => String(Math.round(value * 1000) / 1000).replace('.', ',');

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

export class ScenePanel {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.openId = null;
    this.clock = 0;
  }

  get open() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (!this.open) this.hooks.onStop();
    else this.sync();
  }

  close() {
    if (this.open) this.hooks.onStop();
    this.root.hidden = true;
  }

  sync() {
    if (this.open) this.render();
  }

  setClock(t) {
    this.clock = t;
    const node = this.root.querySelector('.s-clock');
    if (node) node.textContent = `t = ${fmt(t)} s`;
  }

  apply(reducer) {
    this.hooks.setScene(reducer);
    this.render();
  }

  // Transmisión: de qué eje depende la acción y con qué relación (reductor, correa o cadena, engranaje, carro lineal).
  linkControls(action, scene, set, kind) {
    const link = action.link ?? {};
    const setLink = (patch) => set({ link: { ...link, ...patch } });
    const masters = scene.actions.filter((item) => item.kind === 'rotate' && item.id !== action.id);
    const rows = [
      field('Lo mueve', selectInput([['', '— elegir el eje motor —'], ...masters.map((item) => [item.id, item.name || item.id])], link.master ?? '', (value) => setLink({ master: value || null }))),
    ];
    if (kind === 'slide') {
      rows.push(
        this.num('Recorrido por vuelta del eje', link.pitch ?? 100, (value) => setLink({ pitch: value }), 'mm/vuelta'),
        el('p', { class: 'muted', text: 'Cremallera: π·diámetro del piñón. Correa o cadena: π·diámetro de la polea que mueve el carro. Tornillo de potencia: el paso.' }),
      );
      return el('div', {}, ...rows);
    }
    const type = link.type ?? 'directa';
    rows.push(field('Tipo', selectInput(Object.entries(linkTypes), type, (value) => setLink({ type: value }))));
    if (type === 'reductor') rows.push(this.num('Relación del reductor (i : 1)', link.a ?? 10, (value) => setLink({ a: value }), ': 1'));
    if (type === 'correa' || type === 'engranaje') {
      rows.push(
        this.num(type === 'engranaje' ? 'Dientes del piñón motriz' : 'Diámetro (o dientes) de la motriz', link.a ?? 1, (value) => setLink({ a: value }), ''),
        this.num(type === 'engranaje' ? 'Dientes de la rueda conducida' : 'Diámetro (o dientes) de la conducida', link.b ?? 1, (value) => setLink({ b: value }), ''),
      );
    }
    if (type === 'manual') rows.push(this.num('Relación salida / entrada (negativa invierte)', link.ratio ?? 1, (value) => setLink({ ratio: value }), ''));
    rows.push(
      this.num('Rendimiento de la transmisión', link.eff ?? 0.95, (value) => setLink({ eff: Math.max(0.05, Math.min(1, value)) }), '0–1'),
      this.num('Inercia de lo que mueve (reflejada al motor)', link.inertia ?? 0, (value) => setLink({ inertia: Math.max(0, value) }), 'kg·m²'),
      el('p', { class: 'muted', text: `Relación salida/entrada = ${linkRatio(link).toFixed(4).replace('.', ',')}. Si el eje motor tiene «dinámica real», la carga de los granos sobre este eje le llega dividida por la relación (con el rendimiento) y la inercia indicada se suma a la suya.` }),
    );
    return el('div', {}, ...rows);
  }

  num(label, value, onChange, unit) {
    return field(`${label}${unit ? ` (${unit})` : ''}`, textInput(String(value), (text) => onChange(toNumber(text, value))));
  }

  // Válvula / clapeta temporizada: posición cerrada y abierta + tiempos de apertura, abierta, cierre y pausa entre ciclos.
  valveControls(action, set, unit) {
    const open = Math.max(0, Number(action.openTime) || 0);
    const hold = Math.max(0, Number(action.holdOpen) || 0);
    const close = Math.max(0, Number(action.closeTime) || 0);
    const gap = Math.max(0, Number(action.closedHold) || 0);
    const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const summary = hold === 0
      ? `Abre en ${fmt(open)} s y queda abierta.`
      : action.loop === 'loop'
        ? `Ciclo de ${fmt(open + hold + close + gap)} s: abre ${fmt(open)} s · abierta ${fmt(hold)} s · cierra ${fmt(close)} s${gap ? ` · cerrada ${fmt(gap)} s` : ''}, y se repite.`
        : `Abre en ${fmt(open)} s, queda abierta ${fmt(hold)} s y cierra en ${fmt(close)} s (total ${fmt(open + hold + close)} s).`;
    return el('div', {},
      this.num(`Posición cerrada`, action.from, (value) => set({ from: value }), unit),
      this.num(`Posición abierta`, action.to, (value) => set({ to: value }), unit),
      this.num('Tiempo de apertura', open, (value) => set({ openTime: Math.max(0.01, value) }), 's'),
      this.num('Tiempo abierta (0 = queda abierta)', hold, (value) => set({ holdOpen: Math.max(0, value) }), 's'),
      this.num('Tiempo de cierre', close, (value) => set({ closeTime: Math.max(0.01, value) }), 's'),
      action.loop === 'loop' && hold > 0 ? this.num('Cerrada entre ciclos', gap, (value) => set({ closedHold: Math.max(0, value) }), 's') : null,
      el('p', { class: 'muted', text: `${summary} Para encadenar con otra acción usá «Al terminar otra acción» (espera a que cierre).` }));
  }

  // Botón que espera un clic sobre el modelo (hooks.pickPoint) y entrega {point, normal}.
  placeButton(label, onHit, title = '') {
    return button(this.placing ? 'Hacé clic en el modelo… (Esc cancela)' : label, () => {
      if (this.placing) {
        this.hooks.cancelPick?.();
        this.placing = false;
        return this.render();
      }
      this.placing = true;
      this.render();
      this.hooks.pickPoint((hit) => {
        this.placing = false;
        onHit(hit);
        this.render();
      });
    }, { title });
  }

  triple(label, values, onChange, unit = 'mm') {
    return field(`${label} (${unit})`, el('div', { class: 'row-wrap' }, ...values.map((value, i) => textInput(String(value), (text) => {
      const next = [...values];
      next[i] = toNumber(text, value);
      onChange(next);
    }))));
  }

  actionCard(action, scene, targets) {
    const set = (patch) => this.apply((s) => sceneOps.updateAction(s, action.id, patch));
    const setStart = (patch) => set({ start: { ...action.start, ...patch } });
    const open = this.openId === action.id;
    const index = scene.actions.findIndex((item) => item.id === action.id);
    const head = el('div', { class: 'row-wrap scene-head' },
      button(open ? '▾' : '▸', () => { this.openId = open ? null : action.id; this.render(); }),
      el('b', { text: `${action.name || action.id} · ${actionKinds[action.kind]}` }),
      button('↑', () => this.apply((s) => sceneOps.moveAction(s, action.id, -1)), { title: 'Subir' }),
      button('↓', () => this.apply((s) => sceneOps.moveAction(s, action.id, 1)), { title: 'Bajar' }),
      button('✕', () => this.apply((s) => sceneOps.removeAction(s, action.id)), { danger: true, title: 'Borrar acción' }));
    if (!open) return el('div', { class: 'scene-card' }, head);
    const body = [
      field('Nombre', textInput(action.name, (value) => set({ name: value }))),
      field('Tipo', selectInput(Object.entries(actionKinds), action.kind, (value) => set({ kind: value, axis: value === 'rotate' ? 'x' : value === 'slide' ? 'z' : value === 'vibrate' ? [0.866, 0, 0.5] : action.axis }))),
    ];
    if (action.kind === 'air') {
      body.push(
        field('Boquilla', selectInput([['', '— elegí —'], ...scene.nozzles.map((nozzle) => [nozzle.id, nozzle.name || nozzle.id])], action.nozzle ?? '', (value) => set({ nozzle: value || null }))),
        this.num('Nivel final (0–1)', action.level, (value) => set({ level: Math.max(0, Math.min(1, value)) })),
        this.num('Rampa', action.duration, (value) => set({ duration: Math.max(0, value) }), 's'),
      );
    } else {
      body.push(
        el('div', { class: 'motor-targets' }, el('b', { text: 'Qué se mueve' }), ...targets.map((target) => checkInput(action.targets.includes(target.id), (on) => set({ targets: on ? [...action.targets, target.id] : action.targets.filter((id) => id !== target.id) }), target.label))),
        action.kind === 'vibrate' ? null : field('Eje', selectInput([['x', 'X'], ['y', 'Y'], ['z', 'Z']], typeof action.axis === 'string' ? action.axis : 'z', (value) => set({ axis: value }))),
      );
      if (action.kind === 'rotate') {
        body.push(
          field('Modo', selectInput([['continuous', 'Continuo (rpm)'], ['sweep', 'Barrido (una posición a otra)'], ['valve', 'Válvula / clapeta temporizada (abre · mantiene · cierra)'], ['follow', 'Sigue a otro eje (transmisión)']], action.mode, (value) => set({ mode: value }))),
          action.mode === 'follow'
            ? this.linkControls(action, scene, set, 'rotate')
            : action.mode === 'continuous'
            ? this.num('Velocidad (negativo = sentido contrario)', action.rpm, (value) => set({ rpm: value }), 'rpm')
            : action.mode === 'valve'
            ? this.valveControls(action, set, '°')
            : el('div', {},
              this.num('Desde', action.from, (value) => set({ from: value }), '°'),
              this.num('Hasta', action.to, (value) => set({ to: value }), '°'),
              this.num('Duración', action.duration, (value) => set({ duration: Math.max(0.01, value) }), 's')),
          this.triple('Pivote (punto por donde pasa el eje)', action.pivot, (value) => set({ pivot: value })),
          button('Pivote = centro de lo elegido', () => Promise.resolve(this.hooks.pivotFor(action.targets)).then((center) => { if (center) set({ pivot: center.map((v) => Math.round(v * 100) / 100) }); }), { title: 'Toma el centro de la caja envolvente de lo tildado' }),
        );
        if (action.mode === 'continuous') {
          body.push(
            checkInput(!!action.dynamics, (on) => set({ dynamics: on }), 'Dinámica real del eje (inercia, motor limitado, fricción)'),
            ...(action.dynamics ? [
              field('Motor del catálogo', selectInput([['', '— valores propios —'], ...motorCatalog.map((motor) => [motor.id, motorLabel(motor)])], action.motorId ?? '', (value) => {
                const motor = motorCatalog.find((item) => item.id === value);
                set(motor ? motorPatch(motor, 0) : { motorId: '', ratedTorque: 0 });
              })),
              this.num('Inercia del conjunto', action.inertia, (value) => set({ inertia: Math.max(1e-6, value) }), 'kg·m²'),
              this.num('Par máximo del motor', action.torqueMax, (value) => set({ torqueMax: Math.max(0, value) }), 'N·m'),
              this.num('Fricción estática (arranque)', action.staticTorque, (value) => set({ staticTorque: Math.max(0, value) }), 'N·m'),
              this.num('Fricción de deslizamiento', action.coulombTorque, (value) => set({ coulombTorque: Math.max(0, value) }), 'N·m'),
              this.num('Fricción viscosa', action.viscous, (value) => set({ viscous: Math.max(0, value) }), 'N·m·s/rad'),
              el('p', { class: 'muted', text: 'El eje arranca con el par del motor (hasta su máximo), lo frenan la fricción y los granos que empujan las paletas. Si la carga supera el par máximo el eje se frena o se traba; las rpm y los pares se leen en el panel de partículas.' }),
            ] : []),
          );
        }
      } else if (action.kind === 'vibrate') {
        const vector = Array.isArray(action.axis) ? action.axis : [0, 0, 1];
        const tilt = (deg) => [Math.round(Math.cos((deg * Math.PI) / 180) * 1000) / 1000, 0, Math.round(Math.sin((deg * Math.PI) / 180) * 1000) / 1000];
        body.push(
          this.triple('Dirección de la vibración (vector)', vector, (value) => set({ axis: value }), 'x, y, z'),
          el('div', { class: 'row-wrap' },
            button('Horizontal X', () => set({ axis: [1, 0, 0] })),
            button('Horizontal Y', () => set({ axis: [0, 1, 0] })),
            button('Vertical Z', () => set({ axis: [0, 0, 1] })),
            ...[20, 30, 45].map((deg) => button(`X ↗ ${deg}°`, () => set({ axis: tilt(deg) }), { title: 'Lanzamiento: la vibración sube y avanza; el granulado salta hacia +X' })),
            ...[20, 30, 45].map((deg) => button(`X ↖ ${deg}°`, () => set({ axis: tilt(deg).map((v, i) => (i === 0 ? -v : v)) }), { title: 'Salta hacia −X' }))),
          this.num('Amplitud (pico)', action.amp, (value) => set({ amp: Math.max(0, value) }), 'mm'),
          this.num('Frecuencia', action.freq, (value) => set({ freq: Math.max(1, Math.min(60, value)) }), 'Hz'),
          el('p', { class: 'muted', text: 'Vibra sin parar desde que arranca (arranque suave de 0,3 s). Aceleración pico ≈ amplitud·(2π·f)²: si supera ~1 g (9810 mm/s²) en la dirección vertical, el granulado empieza a saltar. Frecuencias de hasta 60 Hz.' }),
        );
      } else {
        body.push(
          field('Modo', selectInput([['sweep', 'Por tiempo (de una posición a otra)'], ['valve', 'Válvula temporizada (abre · mantiene · cierra)'], ['follow', 'Sigue a un eje que gira (cremallera, correa, carro)'], ['belt', 'Cinta transportadora (la superficie arrastra, no se desplaza)']], ['follow', 'belt', 'valve'].includes(action.mode) ? action.mode : 'sweep', (value) => set({ mode: value }))),
          ...(action.mode === 'follow'
            ? [this.linkControls(action, scene, set, 'slide')]
            : action.mode === 'belt'
            ? [
              this.num('Velocidad de la cinta (si no sigue a un rodillo)', action.speed ?? 200, (value) => set({ speed: value }), 'mm/s'),
              el('p', { class: 'muted', text: 'Elegí la pieza de la cinta (la superficie superior debe ser la que apoya el producto) y el eje de avance. Arranca suave en 0,5 s. Para moverla con un motor, elegí abajo el eje que la mueve.' }),
              this.linkControls(action, scene, set, 'slide'),
            ]
            : action.mode === 'valve'
            ? [this.valveControls(action, set, 'mm')]
            : [
              this.num('Posición inicial', action.from, (value) => set({ from: value }), 'mm'),
              this.num('Posición final', action.to, (value) => set({ to: value }), 'mm'),
              this.num('Duración', action.duration, (value) => set({ duration: Math.max(0.01, value) }), 's'),
            ]),
        );
      }
      if (!(action.kind === 'rotate' && action.mode === 'continuous') && action.mode !== 'follow' && action.kind !== 'vibrate') body.push(field('Repetición', selectInput(Object.entries(loopKinds).filter(([key]) => action.mode !== 'valve' || key !== 'pingpong'), action.mode === 'valve' && action.loop === 'pingpong' ? 'loop' : action.loop, (value) => set({ loop: value }))));
    }
    const others = scene.actions.filter((item) => item.id !== action.id);
    body.push(
      el('b', { text: 'Cuándo arranca' }),
      field('Disparo', selectInput(Object.entries(startKinds), action.start.type, (value) => setStart({ type: value, action: value === 'after' ? (others[0]?.id ?? null) : action.start.action }))),
      action.start.type === 'time' ? this.num('Segundo', action.start.t, (value) => setStart({ t: Math.max(0, value) }), 's') : null,
      action.start.type === 'after' ? field('Después de', selectInput(others.map((item) => [item.id, item.name || item.id]), action.start.action ?? '', (value) => setStart({ action: value }))) : null,
      action.start.type === 'exited' ? this.num('Partículas salidas', action.start.n, (value) => setStart({ n: Math.max(1, Math.round(value)) })) : null,
      action.start.type === 'zone' ? field('Sensor', selectInput([['', '— elegí —'], ...(scene.sensors ?? []).map((sensor) => [sensor.id, sensor.name || sensor.id])], action.start.sensor ?? '', (value) => setStart({ sensor: value || null }))) : null,
      action.start.type === 'zone' ? this.num('Partículas adentro (o más)', action.start.n, (value) => setStart({ n: Math.max(1, Math.round(value)) })) : null,
      action.start.type === 'zone' ? checkInput(!!action.start.rearm, (on) => setStart({ rearm: on }), 'Repetir cada vez que el sensor vuelva a cumplirlo') : null,
      action.start.type !== 'time' ? this.num('Demora', action.start.delay ?? 0, (value) => setStart({ delay: Math.max(0, value) }), 's') : null,
    );
    return el('div', { class: 'scene-card' }, head, ...body.filter(Boolean), index < 0 ? null : null);
  }

  setSensorCounts(counts) {
    this.sensorCounts = counts ?? {};
    this.root.querySelectorAll('[data-sensor-count]').forEach((node) => {
      node.textContent = String(this.sensorCounts[node.dataset.sensorCount] ?? 0);
    });
  }

  sensorCard(sensor) {
    const set = (patch) => this.apply((s) => sceneOps.updateSensor(s, sensor.id, patch));
    const open = this.openId === sensor.id;
    const head = el('div', { class: 'row-wrap scene-head' },
      button(open ? '▾' : '▸', () => { this.openId = open ? null : sensor.id; this.render(); }),
      el('b', { text: `${sensor.name || sensor.id} · sensor` }),
      el('span', { class: 'readout', 'data-sensor-count': sensor.id, text: String(this.sensorCounts?.[sensor.id] ?? 0) }),
      button('✕', () => this.apply((s) => sceneOps.removeSensor(s, sensor.id)), { danger: true, title: 'Borrar sensor' }));
    if (!open) return el('div', { class: 'scene-card' }, head);
    return el('div', { class: 'scene-card' }, head,
      field('Nombre', textInput(sensor.name, (value) => set({ name: value }))),
      this.placeButton('📍 Centrar en un punto del modelo', (hit) => set({ center: hit.point.map(round1) })),
      this.triple('Centro de la caja', sensor.center, (value) => set({ center: value })),
      this.triple('Tamaño de la caja', sensor.size, (value) => set({ size: value.map((v) => Math.max(1, Math.abs(v))) })),
      field('Qué cuenta', selectInput([['granos', 'Granos / polvo'], ['productos', 'Productos (cajas)'], ['todo', 'Todo']], sensor.counts ?? 'granos', (value) => set({ counts: value }))),
      el('p', { class: 'muted', text: 'Cuenta lo que hay dentro de la caja. Sirve como disparo: «Cuando hay N partículas en un sensor» (p. ej. sensor de nivel que abre una compuerta, o fotocelda que detecta cajas y arranca un empujador).' }),
    );
  }

  // Alimentador de productos: caja rígida que aparece cada cierto tiempo (sobre cintas, rampas, guías).
  feederCard(feeder) {
    const set = (patch) => this.apply((s) => sceneOps.updateFeeder(s, feeder.id, patch));
    const open = this.openId === feeder.id;
    const head = el('div', { class: 'row-wrap scene-head' },
      button(open ? '▾' : '▸', () => { this.openId = open ? null : feeder.id; this.render(); }),
      el('b', { text: `${feeder.name || feeder.id} · producto` }),
      button('✕', () => this.apply((s) => sceneOps.removeFeeder(s, feeder.id)), { danger: true, title: 'Borrar producto' }));
    if (!open) return el('div', { class: 'scene-card' }, head);
    return el('div', { class: 'scene-card' }, head,
      field('Nombre', textInput(feeder.name, (value) => set({ name: value }))),
      this.placeButton('📍 Soltar sobre un punto del modelo', (hit) => set({ pos: [hit.point[0], hit.point[1], hit.point[2] + feeder.size[2] / 2 + 2].map(round1) })),
      this.triple('Posición del centro de la caja', feeder.pos, (value) => set({ pos: value })),
      this.triple('Tamaño (largo X, ancho Y, alto Z)', feeder.size, (value) => set({ size: value.map((v) => Math.max(5, Math.abs(v))) })),
      this.num('Giro sobre Z', feeder.yaw, (value) => set({ yaw: value }), '°'),
      this.num('Masa', feeder.mass, (value) => set({ mass: Math.max(0.01, value) }), 'kg'),
      this.num('Aparece una cada', feeder.every, (value) => set({ every: Math.max(0.1, value) }), 's'),
      this.num('Máximo en simultáneo', feeder.max, (value) => set({ max: Math.max(1, Math.min(200, Math.round(value))) }), 'cajas'),
      this.num('Empieza en', feeder.start ?? 0, (value) => set({ start: Math.max(0, value) }), 's'),
      this.num('Fricción (caja con lo que toca)', feeder.friction, (value) => set({ friction: Math.max(0, Math.min(2, value)) }), 'μ'),
      el('p', { class: 'muted', text: 'Cajas rígidas con gravedad, fricción y choque entre sí y contra las piezas (cintas, guías, topes). No interactúan con los granos. Una caja que cae bajo el piso de la escena se retira.' }),
    );
  }

  nozzleCard(nozzle) {
    const set = (patch) => this.apply((s) => sceneOps.updateNozzle(s, nozzle.id, patch));
    const open = this.openId === nozzle.id;
    const head = el('div', { class: 'row-wrap scene-head' },
      button(open ? '▾' : '▸', () => { this.openId = open ? null : nozzle.id; this.render(); }),
      el('b', { text: `${nozzle.name || nozzle.id} · aire` }),
      button('✕', () => this.apply((s) => sceneOps.removeNozzle(s, nozzle.id)), { danger: true, title: 'Borrar boquilla' }));
    if (!open) return el('div', { class: 'scene-card' }, head);
    const dirButtons = [['+X', [1, 0, 0]], ['−X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['−Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['−Z', [0, 0, -1]]];
    return el('div', { class: 'scene-card' }, ...[head,
      field('Nombre', textInput(nozzle.name, (value) => set({ name: value }))),
      this.placeButton('📍 Apuntar a un punto del modelo', (hit) => set({ pos: hit.point.map((v, k) => round1(v + hit.normal[k] * 8)), dir: hit.normal.map((v) => round2(-v)) }), 'Clic en una cara: la boca queda 8 mm delante de la cara y sopla hacia ella'),
      this.triple('Posición de la boca', nozzle.pos, (value) => set({ pos: value })),
      this.triple('Dirección (se normaliza)', nozzle.dir, (value) => set({ dir: value }), 'vector'),
      el('div', { class: 'row-wrap' }, ...dirButtons.map(([label, dir]) => button(label, () => set({ dir })))),
      field('Entrada de aire', selectInput([['chorro', 'Chorro (velocidad en la boca)'], ['caudal', 'Caudal de soplador'], ['presion', 'Presión de soplador (plenum)']], nozzle.bc ?? 'chorro', (value) => set({ bc: value }))),
      (nozzle.bc ?? 'chorro') === 'caudal' ? this.num('Caudal', fmt(nozzle.flow ?? 0), (value) => set({ flow: Math.max(0, value) }), 'm³/h') : null,
      (nozzle.bc ?? 'chorro') === 'presion' ? this.num('Presión manométrica', fmt(nozzle.pressure ?? 0), (value) => set({ pressure: Math.max(0, value) }), 'Pa') : null,
      (nozzle.bc ?? 'chorro') === 'chorro' ? this.num('Velocidad en la boca', fmt(nozzle.speed / 1000), (value) => set({ speed: Math.max(0, value) * 1000 }), 'm/s') : null,
      this.num('Apertura del cono', nozzle.cone, (value) => set({ cone: Math.max(0, Math.min(120, value)) }), '° total'),
      this.num('Alcance', nozzle.range, (value) => set({ range: Math.max(1, value) }), 'mm'),
      this.num('Radio de la boca', nozzle.radius, (value) => set({ radius: Math.max(0.5, value) }), 'mm'),
      el('p', { class: 'muted', text: 'Sin acción de aire asignada, la boquilla está siempre activa. Con el aire «calculado» la boca es una entrada de caudal o presión que debe estar DENTRO del conducto (radio ≈ el del caño); el aire sale por los extremos abiertos y se calcula presión y velocidad (elegí «Caudal» o «Presión» arriba). El «Chorro» es un cono visual: se frena detrás de paredes pero no rodea esquinas.' }),
    ].filter(Boolean));
  }

  render() {
    const scene = this.hooks.getScene();
    const targets = this.hooks.getTargets();
    const warnings = validateActions(scene.actions, { targetIds: targets.map((target) => target.id), nozzleIds: scene.nozzles.map((nozzle) => nozzle.id), sensorIds: (scene.sensors ?? []).map((sensor) => sensor.id) });
    const playing = this.hooks.isPlaying();
    this.root.replaceChildren(...[
      el('h3', { text: '⚡ Acciones y aire' }),
      el('div', { class: 'row-wrap' },
        button(playing ? '■ Detener' : '▶ Reproducir', () => (playing ? this.hooks.onStop() : this.hooks.onPlay()), { title: 'Reproduce la secuencia (sin partículas). Con ✦ Partículas abierto se ejecuta junto con la simulación.' }),
        el('span', { class: 'readout s-clock', text: `t = ${fmt(this.clock)} s` })),
      scene.actions.some((action) => action.mode === 'belt' || action.dynamics) || (scene.feeders ?? []).length
        ? el('p', { class: 'hint-block', text: 'Reproducir solo mueve las piezas. Las cajas, la cinta que arrastra, la fotocelda y la carga de los motores se ven en ✦ Partículas → ▶ Iniciar.' })
        : null,
      targets.length === 0 ? el('p', { class: 'muted', text: 'No hay nada para mover todavía.' }) : null,
      el('b', { text: 'Acciones (se evalúan en este orden)' }),
      scene.actions.length === 0 ? el('p', { class: 'muted', text: 'Sin acciones. Creá una: por ejemplo «Deslizar» una guillotina o «Girar» una clapeta.' }) : null,
      ...scene.actions.map((action) => this.actionCard(action, scene, targets)),
      el('div', { class: 'row-wrap' },
        ...['rotate', 'slide', 'vibrate', 'air'].map((kind) => button(`+ ${actionKinds[kind]}`, () => {
          const made = sceneOps.addAction(this.hooks.getScene(), kind);
          this.openId = made.id;
          this.apply(() => made.scene);
        }))),
      el('b', { text: 'Boquillas de aire' }),
      ...scene.nozzles.map((nozzle) => this.nozzleCard(nozzle)),
      el('div', { class: 'row-wrap' }, button('+ Boquilla', () => {
        const made = sceneOps.addNozzle(this.hooks.getScene(), this.hooks.nozzleDefaults?.() ?? {});
        this.openId = made.id;
        this.apply(() => made.scene);
      })),
      el('b', { text: 'Sensores de zona' }),
      ...(scene.sensors ?? []).map((sensor) => this.sensorCard(sensor)),
      el('div', { class: 'row-wrap' }, button('+ Sensor', () => {
        const made = sceneOps.addSensor(this.hooks.getScene(), this.hooks.sensorDefaults?.() ?? {});
        this.openId = made.id;
        this.apply(() => made.scene);
      })),
      el('b', { text: 'Productos (cajas)' }),
      ...(scene.feeders ?? []).map((feeder) => this.feederCard(feeder)),
      el('div', { class: 'row-wrap' }, button('+ Producto', () => {
        const made = sceneOps.addFeeder(this.hooks.getScene(), this.hooks.feederDefaults?.() ?? {});
        this.openId = made.id;
        this.apply(() => made.scene);
      })),
      ...warnings.map((text) => el('p', { class: 'err-block', text: `⚠ ${text}` })),
    ].filter(Boolean));
  }
}
