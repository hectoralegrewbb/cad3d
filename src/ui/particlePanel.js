import { particleConfig } from '../core/particleConfig.js';
import { downloadBlob } from '../io/persistence.js';
import { materialPresets } from '../particles/sim.js';
import { button, checkInput, el, field, selectInput, textInput } from './dom.js';
import { RunRecorder, labelOf } from '../particles/recorder.js';
import { drawChart } from './seriesChart.js';

// Panel Partículas: material granular/polvo que cae sobre la pieza (el tornillo gira y transporta).
// Los movimientos (tornillo, compuertas, aire) salen de las acciones del documento (panel ⚡ Acciones).
// `hooks`: { getInfo() → {actions, nozzles, movers}, onStart(config), onPause/onResume/onStop/onReset, onLive(patch), onEmitter(center,size), onSeeThrough(on), onOpenScene() }.
const toNumber = (value, fallback) => {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

export class ParticlePanel {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.state = 'idle'; // idle | preparing | running | paused
    this.stats = null;
    this.recorder = new RunRecorder();
    this.references = []; // corridas guardadas para superponer
    this.channel = 'perSecond';
    this.knownKeys = 0;
    this.hadFeeders = false;
    this.lastDraw = 0;
    this.message = '';
    this.config = particleConfig();
    this.loadedConfig = null;
    this.context = null;
    this.lastConfigText = '';
    root.addEventListener('change',()=>this.persist());
    root.addEventListener('click',()=>queueMicrotask(()=>this.persist()));
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
    if (!this.root.hidden) this.hooks.onStop();
    this.root.hidden = true;
    this.state = 'idle';
  }

  sync() {
    const source=this.hooks.getConfig?.();
    const context=this.hooks.getContext?.();
    if(context!==this.context||source!==this.loadedConfig){
      this.config=particleConfig(source);this.loadedConfig=source;this.context=context;this.lastConfigText=JSON.stringify(this.config);
    }
    if (!this.open) return;
    this.render();
  }

  persist() {
    try {
      const config=particleConfig(this.config),text=JSON.stringify(config);
      if(text===this.lastConfigText)return;
      this.lastConfigText=text;
      this.loadedConfig=this.hooks.onConfigChange?.(config);
    } catch(error){this.message=error.message;this.render();}
  }

  restart() {
    this.persist();
    this.hooks.onStop();this.stats=null;this.recorder.reset();
    return this.hooks.onStart(structuredClone(this.config));
  }

  fillControls(info, active) {
    const fill=this.config.initialFill;
    const update=(key,value)=>{fill[key]=value;if(key==='enabled'&&value){this.config.airOnly=false;this.config.noGrains=false;}this.message=active?'Aplicá los cambios con Reiniciar.':'';this.render();};
    const number=(label,key,unit)=>field(label,textInput(String(fill[key]),text=>update(key,toNumber(text,fill[key]))));
    return [el('b',{text:'Carga inicial de la tolva'}),checkInput(fill.enabled,v=>update('enabled',v),'Arrancar con la tolva cargada'),
      ...(fill.enabled?[
        field('Pieza de la tolva',selectInput([['','Elegir la tolva…'],...(info.targets??[]).map(item=>[item.id,item.name])],fill.target,v=>update('target',v))),
        number('Llenado por volumen (%)','percent'),number('Asentamiento previo (s)','settleSeconds'),
        number('Radio de colisión de toda la carga (mm)','radius'),number('Fracción sólida del material (0,1–0,62)','packing'),
        field('Ejecución',selectInput([['interactive','Interactiva (máximo 8.000)'],['slow','Cálculo lento (carga completa)']],fill.execution,v=>update('execution',v))),
        ...(fill.execution==='slow'?[number('Presupuesto máximo de partículas (1.000–600.000)','budget')]:[]),
        field('Sección de salida: eje',selectInput([[0,'X'],[1,'Y'],[2,'Z']],fill.outletAxis,v=>update('outletAxis',Number(v)))),
        number('Sección de salida: posición (mm)','outletPosition'),number('Centro sección U (eje siguiente, mm)','outletU'),number('Centro sección V (tercer eje, mm)','outletV'),number('Radio sección de medición (mm)','outletRadius'),
        field('Sentido de salida',selectInput([[1,'Hacia +'],[-1,'Hacia −']],fill.outletSign,v=>update('outletSign',Number(v)))),
        el('p',{class:'hint-block',text:'Toda la carga son partículas dinámicas. La descarga comienza cerrada y el aire apagado. El aro rojo marca la compuerta virtual de salida; al abrir pasa a verde. Se retiene también el límite inferior de la cavidad. Tras asentar, abrí la descarga y activá el aire por separado. Cálculo lento avanza en tiempo simulado; Detener cancela el worker. No se aumenta el radio ni se recorta la carga.'}),
        ...(active?[
          button(this.stats?.fill?.open?'Cerrar descarga':'Abrir descarga',()=>{if(this.stats?.fill?.phase==='settling'){this.message='Esperá a completar el asentamiento antes de abrir.';this.render();return;}this.hooks.onFill?.({fillOpen:!this.stats?.fill?.open});}),
          button(this.stats?.fill?.airEnabled?'Apagar aire':'Activar aire',()=>this.hooks.onFill?.({fillAir:!this.stats?.fill?.airEnabled}))
        ]:[])
      ]:[])];
  }

  setProgress(text) {
    const node = this.root.querySelector('.p-progress');
    if (node) node.textContent = text;
  }

  sensorNames() {
    return Object.fromEntries((this.hooks.getInfo().sensors ?? []).map((sensor) => [sensor.id, sensor.name || sensor.id]));
  }

  // Redibuja el gráfico (máx. 4 veces por segundo): la corrida actual y las referencias guardadas del mismo canal.
  redrawChart(force = false) {
    const canvas = this.root.querySelector('.p-chart');
    const now = performance.now();
    if (!canvas || (!force && now - this.lastDraw < 250)) return;
    this.lastDraw = now;
    const names = this.sensorNames();
    const series = [{ name: 'Actual', ...this.recorder.series(this.channel) }];
    this.references.forEach((ref, n) => series.push({ name: ref.name, times: ref.times, values: ref.channels.get(this.channel) ?? [], dashed: true, color: ['#ffb74d', '#aed581', '#ba68c8'][n % 3] }));
    drawChart(canvas, series, { yLabel: labelOf(this.channel, names) });
    const legend = this.root.querySelector('.p-chart-legend');
    if (legend) legend.textContent = this.references.length ? `── Actual   ${this.references.map((ref) => `╌╌ ${ref.name}`).join('   ')}` : '';
  }

  setStats(stats) {
    const previous=this.stats?.fill;
    const changed=stats.fill&&(previous?.phase!==stats.fill.phase||previous?.open!==stats.fill.open||previous?.airEnabled!==stats.fill.airEnabled);
    this.stats = stats;
    if(changed&&this.open)this.render();
    if (this.state === 'running') {
      this.recorder.push(stats);
      if (this.recorder.keys().length !== this.knownKeys) this.render(); // apareció un canal nuevo (sensor, eje): se actualiza la lista
      else this.redrawChart();
    }
    const readout = this.root.querySelector('.p-readout');
    if (readout) readout.textContent = this.readoutText();
    const fillNode=this.root.querySelector('.p-fill');
    if(fillNode)fillNode.textContent=this.fillText();
    const fillProgress=this.root.querySelector('.p-fill-progress');
    if(fillProgress)fillProgress.value=stats.fill?.progress??0;
    const airNode = this.root.querySelector('.p-air');
    if (airNode) airNode.textContent = this.airText();
  }

  fillText() {
    const fill=this.stats?.fill;if(!fill)return '';
    const fmt=v=>v.toLocaleString('es-AR',{maximumFractionDigits:2});
    return `${fill.phase==='settling'?'Asentando · descarga cerrada':fill.phase==='ready'?'Lista · descarga cerrada':'Descargando'} · aire ${fill.airEnabled?'activo':'apagado'}
${fill.initialCount?.toLocaleString('es-AR')} partículas dinámicas · carga inicial efectiva ${fmt(fill.actualFillPercent??0)} % · nivel Z ${fmt(fill.level)} mm
Masa inicial ${fmt(fill.initialKg)} kg · activa ${fmt(fill.activeKg)} kg · retirada del dominio ${fmt(fill.exitedKg)} kg
Cruce de sección ${fmt(fill.crossedKg??0)} kg · caudal último segundo ${fmt(fill.flowKgS??0)} kg/s
Costo estimado: 1 s simulado ≈ ${fmt((this.stats?.stepMs??0)*60/1000)} s de cálculo
Volumen suelto equivalente ${fmt(fill.remainingLiters)} L · cavidad estimada ${fmt(fill.capacityLiters)} L`;

  }

  // Estado del aire calculado y lecturas de los sensores (presión manométrica, velocidad media y caudal por su plano central).
  airText() {
    const air = this.stats?.air;
    const fmt = (value, digits = 0) => value.toFixed(digits).replace('.', ',');
    const rotors = (this.stats?.rotors ?? []).map((r) => (r.follower ? `Eje ${r.key} (transmisión): ${fmt(r.rpm, 1)} rpm` : `Eje ${r.key}: ${fmt(r.rpm, 1)} rpm · motor ${fmt(r.motorTorque, 2)} N·m · carga de los granos ${fmt(r.loadTorque, 2)} N·m · fricción ${fmt(r.frictionTorque, 2)} N·m${r.rated > 0 ? ` · ${fmt((100 * Math.abs(r.motorTorque)) / r.rated)} % del nominal${Math.abs(r.motorTorque) > r.rated * 1.05 ? ' ⚠ SOBRECARGA' : ''}` : ''}${r.stuck ? ' · TRABADO' : ''}`));
    if (!air || air.model !== 'calculado') return [...rotors, air?.message ?? ''].filter(Boolean).join('\n');
    const lines = [...rotors];
    if (!air.ready) lines.push(`Calculando el aire… ${Math.round(air.progress * 100)} % (${fmt(air.cellMm, 1)} mm por celda, ${fmt(air.stepMs)} ms por paso)`);
    else lines.push(`Aire: ${Math.round(air.cells / 1000)}k celdas de ${fmt(air.cellMm, 1)} mm · entra ${fmt(air.inletFlow)} m³/h · ${fmt(air.stepMs)} ms por paso`);
    const names = Object.fromEntries((this.hooks.getInfo().sensors ?? []).map((sensor) => [sensor.id, sensor.name || sensor.id]));
    Object.entries(air.readings ?? {}).forEach(([id, r]) => lines.push(`${names[id] ?? id}: p = ${fmt(r.pressure)} Pa · v = ${fmt(r.speed, 1)} m/s · Q = ${fmt(Math.abs(r.flow))} m³/h`));
    (air.plug ?? []).forEach((mon) => {
      if (mon.state === 'normal') return;
      const how = mon.bc === 'caudal' ? `la presión de entrada subió ×${fmt(mon.ratio, 1)} sobre la línea limpia` : `el caudal cayó a ${fmt(100 / mon.ratio)} % del de la línea limpia`;
      lines.push(`${mon.state === 'taponada' ? '🛑 LÍNEA TAPONADA' : '⚠ Posible taponamiento'}: ${how}`);
    });
    if(Number.isFinite(air.residual))lines.push(`Convergencia Δ ${air.residual.toExponential(2)} · PCG ${air.pcg??'—'}`);
    if (air.message) lines.push(`⚠ ${air.message}`);
    return lines.join('\n');
  }

  // Gráfico en el tiempo de un canal (presión, caudal, rpm, par, salidas…), referencias guardadas y exportación a CSV.
  chartSection() {
    const keys = this.recorder.keys();
    this.knownKeys = keys.length;
    if (!keys.includes(this.channel)) this.channel = 'perSecond';
    const names = this.sensorNames();
    const canvas = el('canvas', { class: 'p-chart', width: 340, height: 170, style: 'width:100%;max-width:340px;background:rgba(127,127,127,.08);border-radius:4px' });
    setTimeout(() => this.redrawChart(true), 0);
    return el('div', { class: 'chart-block' },
      el('b', { text: 'Gráfico en el tiempo' }),
      field('Canal', selectInput(keys.map((key) => [key, labelOf(key, names)]), this.channel, (value) => { this.channel = value; this.redrawChart(true); })),
      canvas,
      el('p', { class: 'muted p-chart-legend', text: '' }),
      el('div', { class: 'row-wrap' },
        button('Guardar como referencia', () => {
          if (!this.recorder.times.length) return;
          this.references = [...this.references.slice(-2), this.recorder.snapshot(`Corrida ${this.references.length + 1} (${this.recorder.times[this.recorder.times.length - 1].toFixed(1)} s)`)];
          this.redrawChart(true);
        }, { title: 'Congela esta corrida (hasta 3) para superponerla con la siguiente: por ejemplo antes y después de modificar el venturi' }),
        button('Quitar referencias', () => { this.references = []; this.redrawChart(true); }),
        button('Informe de corrida',()=>{if(!this.recorder.times.length){this.message='Iniciá una simulación para registrar resultados.';this.render();return;}const snapshot=this.recorder.snapshot('Corrida');downloadBlob(new Blob([JSON.stringify({...snapshot,channels:Object.fromEntries(snapshot.channels)},null,2)],{type:'application/json'}),'corrida-elcad3d.json');}),
        button('Exportar CSV', () => this.hooks.onExportCsv?.(this.recorder.csv(names)), { title: 'Todos los canales en el tiempo, separados por punto y coma' })),
    );
  }

  readoutText() {
    const s = this.stats;
    if (!s) return '—';
    const fmt = (value, digits = 0) => value.toFixed(digits).replace('.', ',');
    return `${s.count}/${s.cap} partículas · salen ${s.perSecond}/s (${fmt(s.volumePerSecond / 1000, 1)} cm³/s) · total ${s.exited} · ${fmt(s.stepMs, 1)} ms/paso${s.airCells ? ` (aire ${fmt(s.airMs, 1)} ms, ${Math.round(s.airCells / 1000)}k celdas)` : ''} · t ${fmt(s.time, 1)} s${s.capNote ? `\n⚠ ${s.capNote}` : ''}`;
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.render();
  }

  live(patch) {
    if (this.state === 'running' || this.state === 'paused') this.hooks.onLive(patch);
  }

  // Tamaño de la partícula simulada: cada una representa muchos granos, así que agrandarla permite llenar espacios grandes (una tolva)
  // con pocas partículas. Masa y volumen crecen con el radio³; con «mantener el caudal» la carga por segundo baja en esa proporción.
  sizeControls(config, active) {
    const preset = materialPresets[config.preset];
    const radius = config.radiusMm > 0 ? config.radiusMm : preset.radius;
    const setRadius = (next) => {
      const value = Math.max(0.3, Math.min(60, Math.round(next * 100) / 100));
      if (config.keepFlow && config.rate > 0) config.rate = Math.max(1, Math.round(config.rate * (radius / value) ** 3));
      config.radiusMm = Math.abs(value - preset.radius) < 1e-9 ? 0 : value;
      this.message = active ? 'Aplicá el tamaño nuevo con ↺ Reiniciar.' : '';
      this.render();
    };
    const sphere = (4 / 3) * Math.PI * radius ** 3; // mm³
    const kg = (preset.density * sphere) / 1e9;
    const fmt = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)).replace('.', ',');
    return [
      field('Tamaño de partícula (radio, mm)', textInput(String(radius), (text) => setRadius(toNumber(text, radius)))),
      el('div', { class: 'row-wrap' },
        button('Del material', () => setRadius(preset.radius), { active: config.radiusMm === 0 }),
        ...[2, 3, 5].map((k) => button(`×${k}`, () => setRadius(preset.radius * k), { active: Math.abs(radius - preset.radius * k) < 1e-6 })),
        checkInput(config.keepFlow, (value) => { config.keepFlow = value; }, 'Mantener el caudal de material')),
      el('p', { class: 'muted', text: `1 partícula = bola de Ø${fmt(radius * 2)} mm · ${fmt(kg * 1000)} g · ≈ ${fmt(sphere / 0.6 / 1000)} cm³ de material suelto. Más grande = menos detalle fino pero llena volúmenes grandes con pocas partículas (el arrastre del aire sigue usando el grano real: ${preset.grain} mm).` }),
    ];
  }

  render() {
    const { config } = this;
    const info = this.hooks.getInfo();
    const active = this.state === 'running' || this.state === 'paused';
    const numField = (label, value, onChange, unit) => field(`${label}${unit ? ` (${unit})` : ''}`, textInput(String(value), (text) => onChange(toNumber(text, value))));
    const triple = (label, values, onChange, unit) => field(`${label} (${unit})`, el('div', { class: 'row-wrap' }, ...values.map((value, i) => {
      const input = textInput(String(value), (text) => {
        const next = [...values];
        next[i] = toNumber(text, value);
        onChange(next);
      });
      return input;
    })));
    // una escena con cajas (cinta, línea, mesa…) casi nunca quiere además un chorro de granos: se arranca sin ellos (se puede tildar de nuevo)
    if (info.feeders > 0 && !this.hadFeeders) config.noGrains = true;
    this.hadFeeders = info.feeders > 0;
    const startLabel = this.state === 'running' ? '⏸ Pausar' : this.state === 'paused' ? '▶ Seguir' : '▶ Iniciar';
    this.root.replaceChildren(...[
      el('h3', { text: '✦ Partículas (granulado / polvo)' }),
      numField('Semilla de emisión',config.seed,v=>{config.seed=Math.max(1,Math.min(4294967295,Math.floor(v)));},''),
      el('p', { class: 'readout', text: `Acciones: ${info.actions} · boquillas: ${info.nozzles}` }),
      el('div', { class: 'row-wrap' }, button('⚡ Editar acciones y aire', () => this.hooks.onOpenScene(), { title: 'Giros, compuertas y boquillas que se ejecutan durante la simulación' })),
      info.actions === 0 && info.hasScrew ? el('p', { class: 'hint-block', text: 'Al iniciar se crea una acción de giro para el tornillo (editable).' }) : null,
      field('Material', selectInput(Object.entries(materialPresets).map(([id, preset]) => [id, preset.label]), config.preset, (value) => { config.preset = value; this.message = active ? 'El material nuevo se aplica al reiniciar.' : ''; this.render(); })),
      ...this.fillControls(info,active),
      ...(!config.initialFill.enabled?this.sizeControls(config, active):[]),
      ...(!config.initialFill.enabled?[
      el('b', { text: config.initialFill.enabled?'Emisor continuo (no se usa con carga inicial)':'Emisor (caja celeste)' }),
      button(this.placing ? 'Hacé clic en el modelo… (Esc cancela)' : '📍 Soltar sobre un punto del modelo', () => {
        if (this.placing) {
          this.hooks.cancelPick?.();
          this.placing = false;
          return this.render();
        }
        this.placing = true;
        this.render();
        this.hooks.pickPoint?.((hit) => {
          this.placing = false;
          config.emitter.center = [hit.point[0], hit.point[1], hit.point[2] + config.emitter.size[2] / 2 + 12].map((v) => Math.round(v * 10) / 10);
          this.live({ emitter: config.emitter });
          this.hooks.onEmitter(config.emitter.center, config.emitter.size);
          this.render();
        });
      }, { title: 'Clic en el modelo: el emisor queda 12 mm arriba de ese punto' }),
      triple('Centro', config.emitter.center, (value) => { config.emitter.center = value; this.live({ emitter: config.emitter }); this.hooks.onEmitter(config.emitter.center, config.emitter.size); }, 'mm'),
      triple('Tamaño', config.emitter.size, (value) => { config.emitter.size = value; this.live({ emitter: config.emitter }); this.hooks.onEmitter(config.emitter.center, config.emitter.size); }, 'mm'),
      numField('Caudal de carga', config.rate, (value) => { config.rate = value; this.live({ rate: value }); }, 'partículas/s'),
      numField('Caudal de producto (0 = automático)', config.massFlowKgH, (value) => { config.massFlowKgH = Math.max(0, value); this.live({ massFlow: config.massFlowKgH / 3600 }); }, 'kg/h'),
      ]:[]),
      !config.initialFill.enabled ? numField('Tope de partículas', config.cap, (value) => { config.cap = Math.max(100, Math.min(8000, value)); this.live({ cap: config.cap }); this.render(); }, 'máx. 8000, se adapta solo') : null,
      checkInput(config.seeThrough, (value) => { config.seeThrough = value; this.hooks.onSeeThrough?.(value); }, 'Piezas fijas translúcidas'),
      el('b', { text: 'Aire' }),
      field('Modelo de aire', selectInput([['calculado', 'Calculado (presión y caudal)'], ['rapido', 'Rápido (solo visual)']], config.airModel, (value) => { config.airModel = value; this.message = active ? 'El modelo nuevo se aplica al reiniciar.' : ''; this.render(); })),
      config.airModel === 'calculado' ? el('p', { class: 'muted', text: 'Resuelve un campo de aire incompresible (presión y velocidad) con las boquillas como entradas de caudal o presión; los sensores miden p, v y Q. Modelo aproximado; requiere calibración experimental.' }) : null,
      field('Calidad del campo de aire', selectInput([['baja', 'Baja (rápida)'], ['media', 'Media'], ['alta', 'Alta (lenta)']], config.airQuality, (value) => { config.airQuality = value; this.message = active ? 'La calidad nueva se aplica al reiniciar.' : ''; this.render(); })),
      field('Plano de corte del aire', selectInput([['ninguno', 'Sin corte'], ['presion', 'Presión (azul −, rojo +)'], ['velocidad', 'Velocidad']], config.slice.mode, (value) => { config.slice.mode = value; this.hooks.onSlice?.({ ...config.slice }); this.render(); })),
      config.slice.mode !== 'ninguno' ? el('div', { class: 'row-wrap' },
        selectInput([[0, 'Plano ⟂ X'], [1, 'Plano ⟂ Y'], [2, 'Plano ⟂ Z']], config.slice.axis, (value) => { config.slice.axis = Number(value); this.hooks.onSlice?.({ ...config.slice }); }),
        el('input', { type: 'range', min: 0, max: 100, value: Math.round(config.slice.t * 100), title: 'Posición del plano a lo largo del dominio', onInput: (event) => { config.slice.t = Number(event.target.value) / 100; this.hooks.onSlice?.({ ...config.slice }); } })) : null,
      !config.initialFill.enabled?checkInput(config.noGrains, (value) => { config.noGrains = value; this.live({ rate: value || config.airOnly ? 0 : config.rate }); this.render(); }, 'Sin granos: solo cajas, cintas, mecanismos y motores'):null,
      !config.initialFill.enabled?checkInput(config.airOnly, (value) => { config.airOnly = value; this.live({ rate: value || config.noGrains ? 0 : config.rate }); }, 'Solo aire (sin granos): ver el flujo'):null,
      el('b', { text: 'Viento (velocidad del aire)' }),
      triple('Vector', config.wind, (value) => { config.wind = value; this.live({ wind: value }); }, 'mm/s'),
      el('div', { class: 'row-wrap' },
        button('Calma', () => { config.wind = [0, 0, 0]; this.live({ wind: config.wind }); this.render(); }),
        button('+X 2 m/s', () => { config.wind = [2000, 0, 0]; this.live({ wind: config.wind }); this.render(); }),
        button('Racha lateral 6 m/s', () => { config.wind = [0, 6000, 0]; this.live({ wind: config.wind }); this.render(); })),
      el('div', { class: 'row-wrap' },
        button(startLabel, () => (this.state === 'running' ? this.hooks.onPause() : this.state === 'paused' ? this.hooks.onResume() : (this.recorder.reset(), this.hooks.onStart({ ...config }))), { title: 'Prepara las colisiones (unos segundos) y arranca' }),
        button('↺ Reiniciar', () => this.restart(), { title: 'Reconstruye la simulación con la configuración y carga inicial actuales' }),
        button('■ Detener', () => this.hooks.onStop(), { title: 'Detiene y libera el Worker' })),
      this.state === 'preparing' ? el('p', { class: 'hint-block p-progress', text: 'Preparando colisiones…' }) : null,
      el('p', { class: 'readout p-readout', text: this.readoutText(), style: 'white-space:pre-line' }),
      el('p',{class:'readout p-fill',text:this.fillText(),style:'white-space:pre-line'}),
      config.initialFill.enabled?el('progress',{class:'p-fill-progress',max:1,value:this.stats?.fill?.progress??0,'aria-label':'Asentamiento de carga'}):null,
      el('p', { class: 'readout p-air', text: this.airText(), style: 'white-space:pre-line' }),
      this.chartSection(),
      this.message ? el('p', { class: this.message.startsWith('⚠') ? 'err-block' : 'hint-block', text: this.message }) : null,
      el('p', { class: 'muted', text: 'Simulación cualitativa en un Worker (granos esféricos con fricción, colisión contra la malla, arrastre del aire). Sirve para ver cómo avanza el material, no para dimensionar caudales. Sin camisa alrededor, el material cae por los costados.' }),
    ].filter(Boolean));
  }
}
