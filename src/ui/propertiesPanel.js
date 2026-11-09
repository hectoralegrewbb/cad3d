import { constraintPanel } from './constraintPanel.js';
import { entityDefaults, entityLabels, featureLabels, planeLabels, selectorKinds } from '../core/partModel.js';
import { centerDistance, gearSpec } from '../kernel/gearGeometry.js';
import { chainLayout, chainTable, sprocketGeometry } from '../core/sprocket.js';
import { evaluate } from '../core/expression.js';
import { offsetEntity } from '../core/entityOps.js';
import { defaultThread, resolveThread, threadCallout, threadKey, threadTypes } from '../data/threads.js';
import { bendLabels, defaultSegment } from '../kernel/pipeGeometry.js';
import { boxMembers, cutList, frameSpec, profileCatalog, sketchMembers } from '../kernel/frameGeometry.js';
import { planeFrame } from '../kernel/planes.js';
import { downloadBlob } from '../io/persistence.js';
import { button, checkInput, el, exprInput, field, section, selectInput, textInput } from './dom.js';

const planeOptions = Object.entries(planeLabels);
const modeOptions = [['add', 'Agregar material'], ['cut', 'Cortar material'], ['tube', 'Tubo (pared + hueco: se une a otros tubos)']];

// Panel contextual: formulario de la operación seleccionada. Todo número acepta expresiones.
export class PropertiesPanel {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
  }

  render(part, params, results, feature, picking) {
    if (!feature) {
      this.root.replaceChildren(el('h3', { text: 'Propiedades' }), el('p', { class: 'muted', text: 'Elegí una operación del árbol.' }));
      return;
    }
    const num = (label, key, unit) => field(label, exprInput(feature[key], params, (value) => this.h.onUpdate(feature.id, { [key]: value }), { unit }));
    const content = [el('h3', { text: featureLabels[feature.type] })];
    const result = results[feature.id];
    if (result?.status === 'error') content.push(el('div', { class: 'alert', text: result.error }));
    if (result?.status === 'skipped') content.push(el('div', { class: 'alert soft', text: result.error }));

    const sketches = part.features.filter((item) => item.type === 'sketch');
    const sketchSelect = () =>
      field('Boceto', selectInput([['', '— elegir —'], ...sketches.map((item) => [item.id, item.name || item.id])], feature.sketch ?? '', (value) => this.h.onUpdate(feature.id, { sketch: value || null })));

    switch (feature.type) {
      case 'sketch':
        content.push(
          field('Plano', selectInput(planeOptions, feature.plane, (value) => this.h.onUpdate(feature.id, { plane: value }))),
          num('Desplazamiento del plano', 'offset', 'mm'),
          this.rotationSection(feature, params),
          button('Editar boceto…', () => this.h.onEditSketch(feature.id)),
          constraintPanel(feature, (id,patch)=>this.h.onUpdate(id,patch)),
          section(`Entidades (${feature.entities.length})`),
          ...feature.entities.map((entity) => this.entityCard(feature, entity, params)),
          el('div', { class: 'add-row' }, Object.entries(entityLabels).map(([t, label]) => button(`+ ${label}`, () => this.h.onAddEntity(feature.id, entityDefaults[t]())))),
        );
        break;
      case 'step':
        content.push(el('p',{text:feature.file||'Importá un archivo STEP desde la barra superior'}),field('Operación',selectInput(modeOptions.slice(0,2),feature.mode??'add',value=>this.h.onUpdate(feature.id,{mode:value}))),this.turnSection(feature,params));
        break;
      case 'shell':
        content.push(num('Espesor','thickness','mm'),field('Eje',selectInput([['x','X'],['y','Y'],['z','Z']],feature.axis,v=>this.h.onUpdate(feature.id,{axis:v}))),field('Cara a abrir',selectInput([['min','Extremo mínimo'],['max','Extremo máximo']],feature.side,v=>this.h.onUpdate(feature.id,{side:v}))));
        break;
      case 'loft':
      case 'sweep': {
        const key=feature.type==='loft'?'endSketch':'pathSketch';
        content.push(sketchSelect(),field(feature.type==='loft'?'Perfil final':'Boceto trayectoria',selectInput([['','Elegir…'],...sketches.filter(sk=>sk.id!==feature.sketch).map(sk=>[sk.id,sk.name||sk.id])],feature[key]??'',v=>this.h.onUpdate(feature.id,{[key]:v}))),field('Operación',selectInput(modeOptions.slice(0,2),feature.mode,v=>this.h.onUpdate(feature.id,{mode:v}))),this.turnSection(feature,params));
        if(feature.type==='loft')content.push(checkInput(feature.ruled,v=>this.h.onUpdate(feature.id,{ruled:v}),'Superficie reglada'));
        else content.push(el('p',{class:'muted',text:'Se usa la primera polilínea como trayectoria abierta. El perfil debe comenzar perpendicular al primer tramo.'}));
        break;
      }
      case 'extrude':
        content.push(
          sketchSelect(),
          field('Operación', selectInput(modeOptions, feature.mode, (value) => this.h.onUpdate(feature.id, { mode: value }))),
          this.turnSection(feature, params),
          ...(feature.sprocket ? this.sprocketControls(feature) : []),
          checkInput(feature.through, (value) => this.h.onUpdate(feature.id, { through: value }), 'Pasante (solo corte)'),
          feature.through ? null : num('Profundidad', 'depth', 'mm'),
          field('Dirección', selectInput(this.directionOptions(sketches.find((item) => item.id === feature.sketch)), feature.symmetric ? 'sym' : feature.reverse ? 'down' : 'up', (value) => this.h.onUpdate(feature.id, { symmetric: value === 'sym', reverse: value === 'down' }))),
        );
        break;
      case 'revolve':
        content.push(
          sketchSelect(),
          field('Operación', selectInput(modeOptions, feature.mode, (value) => this.h.onUpdate(feature.id, { mode: value }))),
          this.turnSection(feature, params),
          field('Eje de giro', selectInput([['y', 'Eje Y del boceto'], ['x', 'Eje X del boceto']], feature.axis, (value) => this.h.onUpdate(feature.id, { axis: value }))),
          num('Ángulo', 'angle', '°'),
          el('p', { class: 'muted', text: 'El perfil debe quedar de un solo lado del eje (p. ej. X ≥ 0 para girar sobre Y).' }),
        );
        break;
      case 'hole':
        content.push(
          field('Plano de partida', selectInput(planeOptions, feature.plane, (value) => this.h.onUpdate(feature.id, { plane: value }))),
          num('Desplazamiento del plano', 'offset', 'mm'),
          this.rotationSection(feature, params),
          num('Centro X', 'x', 'mm'),
          num('Centro Y', 'y', 'mm'),
          num('Diámetro', 'd', 'mm'),
          ...this.threadControls(feature, feature.d, params, (thread) => this.h.onUpdate(feature.id, { thread }), (d) => this.h.onUpdate(feature.id, { d })),
          checkInput(feature.through, (value) => this.h.onUpdate(feature.id, { through: value }), 'Pasante'),
          feature.through ? null : num('Profundidad', 'depth', 'mm'),
          checkInput(feature.reverse, (value) => this.h.onUpdate(feature.id, { reverse: value }), 'Invertir sentido (hacia la normal)'),
          section('Repetición circular'),
          num('Cantidad', 'count', 'u'),
          num('Diámetro de circunferencia (PCD)', 'pcd', 'mm'),
          num('Ángulo inicial', 'angle0', '°'),
          section('Alojamiento de cabeza (opcional)'),
          num('Ø del alojamiento', 'cboreD', 'mm'),
          num('Profundidad del alojamiento', 'cboreDepth', 'mm'),
        );
        break;
      case 'mesh': {
        const info = feature.mesh ? `${feature.mesh.nt} triángulos · ${feature.mesh.nv} vértices${feature.file ? ` · ${feature.file}` : ''}` : 'Sin malla: importá un STL';
        content.push(
          el('p', { class: 'muted', text: info }),
          feature.meshOnly ? el('p', { class: 'hint-block', text: 'Modo «solo malla»: se ve y se simula tal cual, sin sólido B-Rep. Se puede usar en conjuntos y exportar a STL/3MF. Los cortes, planos y STEP requieren un sólido B-Rep.' }) : field('Operación', selectInput([['add', 'Agregar material'], ['cut', 'Cortar material']], feature.mode ?? 'add', (value) => this.h.onUpdate(feature.id, { mode: value }))),
          num('Escala (× al STL, en mm)', 'scale', '×'),
          this.turnSection(feature, params),
          el('p', { class: 'muted', text: 'La malla se cose en sólido(s) cerrado(s): sirve para partículas, aire, conjunto y exportar. Para ubicarla usá la herramienta Mover. Si el STL trae piezas separadas quedan como cuerpos distintos.' }),
        );
        break;
      }
      case 'gear': {
        let spec = null;
        let problem = null;
        try {
          spec = gearSpec(feature, params);
        } catch (error) {
          problem = error.message;
        }
        const fmt = (value) => String(Math.round(value * 1000) / 1000).replace('.', ',');
        this.matingTeeth = this.matingTeeth ?? {};
        const mate = this.matingTeeth[feature.id] ?? '30';
        content.push(
          field('Plano de partida', selectInput(planeOptions, feature.plane, (value) => this.h.onUpdate(feature.id, { plane: value }))),
          num('Desplazamiento del plano', 'offset', 'mm'),
          this.rotationSection(feature, params),
          num('Centro X', 'x', 'mm'),
          num('Centro Y', 'y', 'mm'),
          this.turnSection(feature, params),
          section('Dentado'),
          num('Módulo', 'm', 'mm'),
          num('Cantidad de dientes', 'z', 'u'),
          num('Ángulo de presión', 'alpha', '°'),
          num('Desplazamiento de perfil (x)', 'shift', ''),
          num('Ángulo de hélice (0 = recto)', 'helix', '°'),
          num('Giro del dentado (fase)', 'phase', '°'),
          section('Cuerpo'),
          num('Ancho de cara', 'width', 'mm'),
          num('Ø agujero', 'bore', 'mm'),
          num('Ø cubo (0 = sin cubo)', 'hub', 'mm'),
          num('Largo del cubo', 'hubWidth', 'mm'),
          checkInput(feature.reverse, (value) => this.h.onUpdate(feature.id, { reverse: value }), 'Invertir sentido (hacia atrás de la normal)'),
          problem ? el('div', { class: 'alert soft', text: problem }) : el('p', { class: 'muted', text: `Ø primitivo ${fmt(spec.pitchDiameter)} · Ø exterior ${fmt(spec.outsideDiameter)} · Ø pie ${fmt(spec.rootDiameter)} · Ø base ${fmt(spec.baseDiameter)} mm` }),
        );
        if (spec) {
          const z2 = Number(String(mate).replace(',', '.'));
          content.push(
            section('Distancia entre centros'),
            field('Dientes del engranaje conjugado', textInput(mate, (value) => { this.matingTeeth[feature.id] = value; this.h.onRefresh?.(); })),
            el('p', { class: 'muted', text: Number.isFinite(z2) && z2 >= 6 ? `Mismo módulo: distancia entre centros = ${fmt(centerDistance(spec.m, spec.z, z2))} mm · relación ${fmt(z2 / spec.z)}:1` : 'Indicá un número de dientes (≥ 6).' }),
            ...this.gearMateControls(feature, spec, z2),
          );
        }
        break;
      }
      case 'pattern':
        content.push(...this.patternControls(feature, part, params));
        break;
      case 'pipe':
        content.push(...this.pipeControls(feature, part, params), this.turnSection(feature, params));
        break;
      case 'frame':
        content.push(...this.frameControls(feature, part, params), this.turnSection(feature, params));
        break;
      case 'screw':
        content.push(
          field('Plano de partida', selectInput(planeOptions, feature.plane, (value) => this.h.onUpdate(feature.id, { plane: value }))),
          num('Desplazamiento del plano', 'offset', 'mm'),
          this.rotationSection(feature, params),
          num('Centro X', 'x', 'mm'),
          num('Centro Y', 'y', 'mm'),
          this.turnSection(feature, params),
          section('Tornillo'),
          num('Largo', 'length', 'mm'),
          num('Ø eje', 'shaft', 'mm'),
          num('Ø exterior', 'outer', 'mm'),
          num('Paso', 'pitch', 'mm'),
          num('Espesor del filete', 'thickness', 'mm'),
          num('Entradas (1–4)', 'starts', 'u'),
          checkInput(!!feature.left, (value) => this.h.onUpdate(feature.id, { left: value }), 'Hélice a izquierdas'),
          checkInput(feature.reverse, (value) => this.h.onUpdate(feature.id, { reverse: value }), 'Invertir sentido (hacia atrás de la normal)'),
          el('p', { class: 'muted', text: 'En el plano se dibuja la envolvente cilíndrica (Ø exterior).' }),
        );
        break;
      case 'thread': {
        const axisLabels = { x: ['Y', 'Z'], y: ['X', 'Z'], z: ['X', 'Y'] }[feature.axis ?? 'z'];
        const thread = { ...defaultThread(), ...(feature.thread ?? {}), on: true };
        const set = (patch) => this.h.onUpdate(feature.id, { thread: { ...thread, ...patch } });
        const rows = threadTypes[thread.type].rows;
        let row = null;
        try {
          row = resolveThread(thread, evaluate(feature.d, params));
        } catch {
          /* Ø inválido */
        }
        content.push(
          field('Eje de la rosca', selectInput([['z', 'Eje Z'], ['x', 'Eje X'], ['y', 'Eje Y']], feature.axis ?? 'z', (value) => this.h.onUpdate(feature.id, { axis: value }))),
          num(`Centro del eje ${axisLabels[0]}`, 'cx', 'mm'),
          num(`Centro del eje ${axisLabels[1]}`, 'cy', 'mm'),
          num(`Rosca desde (${(feature.axis ?? 'z').toUpperCase()})`, 'from', 'mm'),
          num(`Rosca hasta (${(feature.axis ?? 'z').toUpperCase()})`, 'to', 'mm'),
          field('Ubicación', selectInput([['ext', 'Exterior (cuerpo cilíndrico)'], ['int', 'Interior (agujero)']], feature.internal ? 'int' : 'ext', (value) => this.h.onUpdate(feature.id, { internal: value === 'int' }))),
          num('Ø nominal de la rosca', 'd', 'mm'),
          field('Tipo de rosca', selectInput(Object.entries(threadTypes).map(([key, type]) => [key, type.label]), thread.type, (value) => set({ type: value, size: 'auto' }))),
          thread.type === 'X' ? field('Paso (mm)', textInput(thread.pitch ?? '', (value) => set({ pitch: value }))) : field('Medida', selectInput([['auto', 'Automática (según Ø)'], ...rows.map((item) => [threadKey(item), `${item.label} · broca Ø${item.tap}`])], thread.size, (value) => set({ size: value }))),
          el('p', { class: row ? 'muted' : 'alert soft', text: row ? `${threadCallout(row, '')} · ${feature.internal ? `el agujero debe ser Ø${row.tap} (broca de macho)` : 'el cuerpo debe tener el Ø nominal'}` : thread.type === 'X' ? 'Indicá el paso (ej. 1,5).' : 'El Ø no coincide con una rosca de ese tipo: elegí la medida, ajustá el Ø o usá "Especial".' }),
          section('Chaflán en los extremos (45°)'),
          num('Chaflán al inicio (desde)', 'chamferStart', 'mm'),
          num('Chaflán al final (hasta)', 'chamferEnd', 'mm'),
          el('p', { class: 'muted', text: feature.internal ? 'Avellanado de la boca del agujero: se mide hacia afuera del Ø nominal. Típico: 0,5–1 paso.' : 'Cono de entrada: el cateto se mide desde el Ø nominal hacia el eje (c = 1 paso baja hasta ~ el fondo del filete). 0 = sin chaflán.' }),
          checkInput(feature.real, (value) => this.h.onUpdate(feature.id, { real: value }), 'Filete real (helicoidal, lento: ~3 s por cambio)'),
          feature.real ? checkInput(feature.lefthand, (value) => this.h.onUpdate(feature.id, { lefthand: value }), 'Rosca izquierda') : null,
          el('p', { class: 'muted', text: 'Sin "filete real" el modelo no cambia: el plano muestra las líneas finas de rosca entre "desde" y "hasta" y la cota con el rótulo. Con filete real se corta el surco helicoidal (más pesado, útil para STEP/render).' }),
        );
        break;
      }
      case 'fillet':
      case 'chamfer':
        content.push(
          num(feature.type === 'fillet' ? 'Radio' : 'Distancia', feature.type === 'fillet' ? 'radius' : 'size', 'mm'),
          field('Aristas', selectInput(Object.entries(selectorKinds), feature.selector?.kind ?? 'all', (value) => this.h.onUpdate(feature.id, { selector: { kind: value, points: feature.selector?.points ?? [] } }))),
        );
        if (feature.selector?.kind === 'near') {
          const count = feature.selector.points?.length ?? 0;
          content.push(
            el('div', { class: 'pick-box' },
              el('span', { text: `${count} arista${count === 1 ? '' : 's'} elegida${count === 1 ? '' : 's'}` }),
              button(picking ? 'Terminar selección' : 'Elegir en el visor', () => this.h.onTogglePick(feature.id), { active: picking }),
              button('Limpiar', () => this.h.onUpdate(feature.id, { selector: { kind: 'near', points: [] } })),
            ),
            el('p', { class: 'muted', text: 'Clic en una arista para marcarla; clic otra vez para quitarla.' }),
          );
        }
        break;
      default:
        break;
    }
    this.root.replaceChildren(...content.filter(Boolean));
  }

  // Rosca: el rótulo del plano ("M8×1,25") sale del diámetro del agujero (broca de macho o nominal) o de la medida elegida.
  threadControls(owner, diameter, params, commit, setDiameter) {
    const thread = { ...defaultThread(), ...(owner.thread ?? {}) };
    const set = (patch) => commit({ ...thread, ...patch });
    const controls = [checkInput(thread.on, (value) => set({ on: value }), 'Rosca (se rotula en el plano)')];
    if (!thread.on) return controls;
    let d = Number.NaN;
    try {
      d = evaluate(diameter, params);
    } catch {
      /* diámetro inválido */
    }
    const rows = threadTypes[thread.type].rows;
    const row = resolveThread(thread, d, { drill: true });
    controls.push(
      field('Tipo de rosca', selectInput(Object.entries(threadTypes).map(([key, type]) => [key, type.label]), thread.type, (value) => set({ type: value, size: 'auto' }))),
      thread.type === 'X' ? field('Paso (mm)', textInput(thread.pitch ?? '', (value) => set({ pitch: value }))) : field('Medida', selectInput([['auto', 'Automática (según Ø)'], ...rows.map((item) => [threadKey(item), `${item.label} · broca Ø${item.tap}`])], thread.size, (value) => set({ size: value }))),
      field('Prof. de rosca', textInput(thread.depth, (value) => set({ depth: value }))),
      el('p', { class: row ? 'muted' : 'alert soft', text: row ? `Plano: ${threadCallout(row, thread.depth)} · broca de macho Ø${row.tap}` : `Ø${Math.round(d * 100) / 100} no coincide con una rosca de ese tipo: elegí la medida o ajustá el Ø.` }),
    );
    if (row && Math.abs(d - row.tap) > 0.01) controls.push(button(`Ø → broca de macho (${row.tap})`, () => setDiameter(row.tap)));
    return controls;
  }

  // Rotación del plano de trabajo alrededor de un eje del mundo (X/Y/Z) que pasa por un centro de giro.
  // Los demás bocetos no se mueven: todos comparten los mismos ejes cartesianos, solo este plano cambia de orientación.
  // Girar el cuerpo ya construido de la operación (no el plano): eje X/Y/Z o vector propio, ángulo y pivote en coordenadas del mundo.
  turnSection(owner, params) {
    const turn = { axis: '', angle: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 1, ...(owner.turn ?? {}) };
    const set = (patch) => this.h.onUpdate(owner.id, { turn: { ...turn, ...patch } });
    const rows = [field('Girar el cuerpo sobre', selectInput([['', 'Sin giro'], ['x', 'Eje X'], ['y', 'Eje Y'], ['z', 'Eje Z'], ['custom', 'Eje propio (vector)']], turn.axis ?? '', (value) => set({ axis: value })))];
    if (turn.axis) {
      if (turn.axis === 'custom') {
        rows.push(
          field('Vector X', exprInput(turn.vx, params, (value) => set({ vx: value }), { unit: '' })),
          field('Vector Y', exprInput(turn.vy, params, (value) => set({ vy: value }), { unit: '' })),
          field('Vector Z', exprInput(turn.vz, params, (value) => set({ vz: value }), { unit: '' })),
        );
      }
      rows.push(
        field('Ángulo', exprInput(turn.angle, params, (value) => set({ angle: value }), { unit: '°' })),
        el('div', { class: 'add-row' }, [-90, -45, -30, -20, -15, 15, 20, 30, 45, 90].map((deg) => button(`${deg > 0 ? '+' : ''}${deg}°`, () => set({ angle: deg })))),
        field('Pivote X', exprInput(turn.px, params, (value) => set({ px: value }), { unit: 'mm' })),
        field('Pivote Y', exprInput(turn.py, params, (value) => set({ py: value }), { unit: 'mm' })),
        field('Pivote Z', exprInput(turn.pz, params, (value) => set({ pz: value }), { unit: 'mm' })),
        el('p', { class: 'muted', text: 'Gira el sólido de esta operación como cuerpo rígido (después se aplica el desplazamiento). Ej.: tramo de caño a 20° acoplado a otro → pivote en el centro de la boca de unión y eje perpendicular al plano de la curva.' }),
      );
    }
    return el('details', { class: 'pattern', open: Boolean(turn.axis) }, el('summary', { text: turn.axis ? `Giro del cuerpo: ${turn.axis === 'custom' ? 'eje propio' : turn.axis.toUpperCase()} ${turn.angle}°` : 'Girar el cuerpo (cualquier ángulo)' }), el('div', { class: 'pattern-box' }, ...rows));
  }

  // Cañería / extrusión curva: perfil + lista de tramos (largo, giro, hacia dónde curva, radio).
  pipeControls(feature, part, params) {
    const set = (patch) => this.h.onUpdate(feature.id, patch);
    const num = (label, key, unit) => field(label, exprInput(feature[key], params, (value) => set({ [key]: value }), { unit }));
    const sketches = part.features.filter((item) => item.type === 'sketch');
    const priors = part.features.slice(0, part.features.indexOf(feature)).filter((item) => item.type === 'pipe');
    const triple = (label, key, fallback) => {
      const values = feature[key] ?? fallback;
      return [0, 1, 2].map((i) => field(`${label} ${['X', 'Y', 'Z'][i]}`, exprInput(values[i], params, (value) => { const next = [...values]; next[i] = value; set({ [key]: next }); }, { unit: i === 0 && key === 'start' ? 'mm' : key === 'start' ? 'mm' : '' })));
    };
    const segments = feature.segments ?? [];
    const setSegment = (index, patch) => set({ segments: segments.map((segment, i) => (i === index ? { ...segment, ...patch } : segment)) });
    const rows = [
      field('Perfil', selectInput([['circle', 'Redondo (Ø exterior + pared)'], ['sketch', 'Boceto (cualquier forma, con hueco opcional)']], feature.profile ?? 'circle', (value) => set({ profile: value }))),
      feature.profile === 'sketch'
        ? field('Boceto del perfil', selectInput([['', '— elegir —'], ...sketches.map((item) => [item.id, item.name || item.id])], feature.sketch ?? '', (value) => set({ sketch: value || null })))
        : null,
      feature.profile === 'sketch' ? null : num('Ø exterior', 'od', 'mm'),
      feature.profile === 'sketch' ? null : num('Pared (0 = macizo)', 'wall', 'mm'),
      num('Radio de curva (eje del caño)', 'radius', 'mm'),
      field('Continuar desde', selectInput([['', 'Punto de partida propio'], ...priors.map((item) => [item.id, `${item.name || item.id} (su extremo)`])], feature.from ?? '', (value) => set({ from: value || null }))),
    ];
    if (!feature.from && feature.profile !== 'sketch') rows.push(...triple('Partida', 'start', [0, 0, 0]), ...triple('Dirección', 'dir', [0, 0, 1]));
    if (!feature.from && feature.profile === 'sketch') rows.push(el('p', { class: 'muted', text: 'Arranca en el origen del plano del boceto, hacia su normal. Dibujá el perfil con su hueco (rectángulo dentro de rectángulo).' }));
    rows.push(section('Tramos (recto, y después una curva opcional)'));
    segments.forEach((segment, index) => {
      rows.push(el('div', { class: 'scene-card' },
        el('div', { class: 'row-wrap' },
          el('b', { text: `Tramo ${index + 1}` }),
          button('↑', () => index > 0 && set({ segments: segments.map((_, i) => segments[i === index ? index - 1 : i === index - 1 ? index : i]) }), { title: 'Subir' }),
          button('✕', () => set({ segments: segments.filter((_, i) => i !== index) }), { danger: true, title: 'Quitar tramo' })),
        field('Largo recto', exprInput(segment.len, params, (value) => setSegment(index, { len: value }), { unit: 'mm' })),
        field('Curva al final', exprInput(segment.turn, params, (value) => setSegment(index, { turn: value }), { unit: '° (0 = sin curva)' })),
        String(segment.turn).trim() === '0' ? null : field('Curva', selectInput(Object.entries(bendLabels), segment.toward ?? '+x', (value) => setSegment(index, { toward: value }))),
        field('Radio propio', exprInput(segment.radius ?? '', params, (value) => setSegment(index, { radius: value }), { unit: 'mm (vacío = el general)' }))));
    });
    rows.push(
      el('div', { class: 'row-wrap' }, button('+ Tramo', () => set({ segments: [...segments, defaultSegment()] }))),
      el('p', { class: 'muted', text: 'Siempre es un tubo (pared + hueco): se une a los demás tubos y los huecos quedan comunicados. El ángulo negativo curva hacia el lado opuesto. «Curva hacia +X» gira el caño hacia ese lado del mundo (la parte perpendicular a su dirección).' }),
    );
    return rows.filter(Boolean);
  }

  // Estructura de perfiles: perfil comercial, barras entre dos puntos (ingletes automáticos), generador de caja, barras desde boceto y lista de cortes.
  frameControls(feature, part, params) {
    const set = (patch) => this.h.onUpdate(feature.id, patch);
    const members = feature.members ?? [];
    const gen = feature.gen ?? { sx: 800, sy: 600, sz: 900, post: 40, x: 0, y: 0, z: 0 };
    const setGen = (patch) => set({ gen: { ...gen, ...patch } });
    const sketches = part.features.filter((item) => item.type === 'sketch');
    const setMember = (index, patch) => set({ members: members.map((member, i) => (i === index ? { ...member, ...patch } : member)) });
    const triple = (values, onChange) => el('div', { style: 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px' }, [0, 1, 2].map((i) => exprInput(values[i], params, (value) => { const next = [...values]; next[i] = value; onChange(next); }, { unit: ['X', 'Y', 'Z'][i] })));
    const rows = [
      field('Perfil', selectInput(Object.entries(profileCatalog).map(([id, item]) => [id, item.label]), feature.profile, (value) => set({ profile: value }))),
    ];
    if (feature.profile === 'personalizado') {
      const custom = feature.custom ?? { kind: 'tube', w: 40, h: 40, t: 2 };
      const setCustom = (patch) => set({ custom: { ...custom, ...patch } });
      rows.push(
        field('Tipo', selectInput([['tube', 'Tubo rectangular'], ['bar', 'Barra / planchuela'], ['angle', 'Ángulo (L)'], ['channel', 'Perfil U'], ['pipe', 'Caño redondo']], custom.kind, (value) => setCustom({ kind: value }))),
        field('Ancho (o Ø)', exprInput(custom.w, params, (value) => setCustom({ w: value }), { unit: 'mm' })),
        field('Alto', exprInput(custom.h, params, (value) => setCustom({ h: value }), { unit: 'mm' })),
        field('Espesor', exprInput(custom.t, params, (value) => setCustom({ t: value }), { unit: 'mm' })),
      );
    }
    rows.push(
      checkInput(feature.mitre !== false, (on) => set({ mitre: on }), 'Ingletar donde se encuentran dos barras'),
      section('Generar'),
      el('div', { class: 'scene-card' },
        el('b', { text: 'Marco en caja (4 columnas + aros)' }),
        field('Esquina (X, Y, Z)', triple([gen.x, gen.y, gen.z], ([x, y, z]) => setGen({ x, y, z }))),
        field('Largo X entre ejes', exprInput(gen.sx, params, (value) => setGen({ sx: value }), { unit: 'mm' })),
        field('Largo Y entre ejes', exprInput(gen.sy, params, (value) => setGen({ sy: value }), { unit: 'mm' })),
        field('Alto entre ejes', exprInput(gen.sz, params, (value) => setGen({ sz: value }), { unit: 'mm' })),
        field('Lado de la columna', exprInput(gen.post, params, (value) => setGen({ post: value }), { unit: 'mm' })),
        button('Agregar marco en caja', () => {
          const n = (v) => evaluate(v, params);
          set({ gen, members: [...members, ...boxMembers({ origin: [n(gen.x), n(gen.y), n(gen.z)], sx: n(gen.sx), sy: n(gen.sy), sz: n(gen.sz), post: n(gen.post) })] });
        }, { title: 'Agrega 4 columnas y 2 aros de 4 travesaños (a tope entre columnas)' })),
      el('div', { class: 'scene-card' },
        el('b', { text: 'Barras desde un boceto' }),
        field('Boceto', selectInput([['', '— elegir —'], ...sketches.map((item) => [item.id, item.name || item.id])], gen.sketch ?? '', (value) => setGen({ sketch: value || null }))),
        button('Agregar un perfil por cada lado', () => {
          const sketch = sketches.find((item) => item.id === gen.sketch);
          if (!sketch) return;
          set({ gen, members: [...members, ...sketchMembers(sketch, params, planeFrame(null, sketch, params))] });
        }, { title: 'Cada rectángulo o polilínea del boceto aporta una barra por lado, sobre el plano del boceto' }),
        el('p', { class: 'muted', text: 'Dibujá el esqueleto con rectángulos o polilíneas y obtené las barras sobre sus lados.' })),
      section(`Barras (${members.length})`),
    );
    members.forEach((member, index) => {
      rows.push(el('div', { class: 'scene-card' },
        el('div', { class: 'row-wrap' },
          el('b', { text: `Barra ${index + 1}` }),
          textInput(member.label ?? '', (value) => setMember(index, { label: value })),
          button('✕', () => set({ members: members.filter((_, i) => i !== index) }), { danger: true, title: 'Quitar barra' })),
        field('Desde', triple(member.a ?? [0, 0, 0], (value) => setMember(index, { a: value }))),
        field('Hasta', triple(member.b ?? [0, 0, 0], (value) => setMember(index, { b: value }))),
        field('Giro del perfil', exprInput(member.roll ?? 0, params, (value) => setMember(index, { roll: value }), { unit: '°' }))));
    });
    rows.push(el('div', { class: 'row-wrap' }, button('+ Barra', () => set({ members: [...members, { a: [0, 0, 0], b: [0, 0, 500], roll: 0, label: '' }] })), members.length ? button('Quitar todas', () => set({ members: [] }), { danger: true }) : null));
    try {
      if (members.length) {
        const list = cutList(frameSpec(feature, params));
        rows.push(section('Lista de cortes'));
        const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
        list.summary.forEach((row) => rows.push(el('p', { class: 'readout', text: `${row.qty} × ${row.profile} — ${fmt(row.cutLength)} mm${row.angleA || row.angleB ? ` (ingletes ${fmt(row.angleA)}° / ${fmt(row.angleB)}°)` : ''} · ${fmt(row.weight)} kg` })));
        rows.push(
          el('p', { class: 'muted', text: `${members.length} barras · ${fmt(list.totalLength / 1000, 2)} m de perfil · ${fmt(list.totalWeight)} kg (acero)` }),
          button('Exportar lista de cortes (CSV)', () => {
            const head = ['N', 'Barra', 'Perfil', 'Largo de eje (mm)', 'Largo a cortar (mm)', 'Ángulo A (°)', 'Ángulo B (°)', 'Peso (kg)'];
            const lines = list.rows.map((r) => [r.n, r.label, r.profile, r.axisLength.toFixed(1), r.cutLength.toFixed(1), r.angleA.toFixed(1), r.angleB.toFixed(1), r.weight.toFixed(2)].join(';'));
            downloadBlob(new Blob([`\ufeff${[head.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' }), `${part.meta.name || 'estructura'}-cortes.csv`);
          }),
          el('p', { class: 'muted', text: 'El largo a cortar es la punta larga del inglete (el eje más medio perfil por tangente del ángulo). Pesos con acero de 7,85 g/cm³; el perfil se toma con esquinas redondeadas.' }));
      }
    } catch (error) {
      rows.push(el('p', { class: 'alert soft', text: error.message }));
    }
    return rows.filter(Boolean);
  }

  patternControls(feature, part, params) {
    const num = (label, key, unit) => field(label, exprInput(feature[key], params, (value) => this.h.onUpdate(feature.id, { [key]: value }), { unit }));
    const before = part.features.slice(0, part.features.indexOf(feature)).filter((item) => ['extrude', 'revolve', 'gear', 'screw', 'pipe', 'mesh', 'frame'].includes(item.type));
    const label = (item) => `${featureLabels[item.type]} ${item.name || item.id}${item.type === 'extrude' || item.type === 'revolve' ? (item.mode === 'cut' ? ' (corte)' : item.mode === 'tube' ? ' (tubo)' : '') : ''}`;
    const rows = [
      field('Operación a repetir', selectInput([['', '— elegir —'], ...before.map((item) => [item.id, label(item)])], feature.source ?? '', (value) => this.h.onUpdate(feature.id, { source: value || null }))),
      field('Tipo', selectInput([['circular', 'Circular (alrededor de un eje)'], ['linear', 'Lineal']], feature.kind ?? 'circular', (value) => this.h.onUpdate(feature.id, { kind: value }))),
      num('Cantidad total (con la original)', 'count', 'u'),
    ];
    if (feature.kind === 'linear') {
      rows.push(num('Separación X', 'dx', 'mm'), num('Separación Y', 'dy', 'mm'), num('Separación Z', 'dz', 'mm'));
    } else {
      rows.push(
        field('Eje', selectInput([['x', 'Eje X'], ['y', 'Eje Y'], ['z', 'Eje Z']], feature.axis ?? 'z', (value) => this.h.onUpdate(feature.id, { axis: value }))),
        num('Centro X', 'cx', 'mm'), num('Centro Y', 'cy', 'mm'), num('Centro Z', 'cz', 'mm'),
        num('Ángulo total', 'total', '°'),
        el('p', { class: 'muted', text: '360° reparte las copias parejo en la vuelta completa; menos de 360° va de la original a la última. Para aspas: dejá en la operación original el giro de paso (Girar el cuerpo) y repetí alrededor del eje del buje.' }),
      );
    }
    return rows;
  }

  // Rueda de cadena: datos y armado del par (segunda rueda a la distancia de centros, eslabones pares y giro enlazado).
  sprocketControls(feature) {
    const info = feature.sprocket;
    this.sprocketConfig = this.sprocketConfig ?? {};
    const cfg = (this.sprocketConfig[feature.id] = { teeth: String(info.z * 2), distance: String(Math.round(40 * (chainTable[info.chain]?.p ?? 12.7))), theta: '0', ...(this.sprocketConfig[feature.id] ?? {}) });
    const chain = chainTable[info.chain];
    const fmt = (value) => String(Math.round(value * 100) / 100).replace('.', ',');
    let geo = null;
    try { geo = sprocketGeometry(info); } catch { /* datos inválidos */ }
    const teeth = Number(String(cfg.teeth).replace(',', '.'));
    const distance = Number(String(cfg.distance).replace(',', '.'));
    let preview = 'Indicá dientes y distancia entre centros.';
    if (geo && Number.isFinite(teeth) && teeth >= 9 && distance > 0) {
      try {
        const layout = chainLayout(geo.z, Math.round(teeth), distance, geo.p);
        preview = `${layout.links} eslabones · distancia real ${fmt(layout.center)} mm · relación ${fmt(Math.round(teeth) / geo.z)}:1`;
      } catch (error) { preview = error.message; }
    }
    return [
      section('Rueda de cadena'),
      el('p', { class: 'muted', text: `${chain?.label ?? info.chain} · ${info.z} dientes · ${info.strands} hilera(s)${geo ? ` · paso ${fmt(geo.p)} · Ø primitivo ${fmt(geo.pitchDiameter)} · Ø exterior ${fmt(geo.da)} · Ø pie ${fmt(geo.df)} · Ø rodillo ${fmt(geo.d1)} · ancho ${fmt(geo.width)} mm (${geo.standard})` : ''}` }),
      field('Dientes de la otra rueda', textInput(cfg.teeth, (value) => { cfg.teeth = value; this.h.onRefresh?.(); })),
      field('Distancia entre centros (mm)', textInput(cfg.distance, (value) => { cfg.distance = value; this.h.onRefresh?.(); })),
      field('Ubicación respecto de esta rueda', selectInput([['0', '+X del plano (derecha)'], ['180', '−X del plano (izquierda)'], ['90', '+Y del plano (arriba)'], ['270', '−Y del plano (abajo)']], cfg.theta, (value) => { cfg.theta = value; })),
      el('p', { class: 'muted', text: preview }),
      el('button', { class: 'btn', onClick: () => this.h.onAddSprocketPair?.(feature.id, { teeth: Math.round(teeth), distance, thetaDeg: Number(cfg.theta) }) }, 'Armar par'),
      el('p', { class: 'muted', text: 'Crea la otra rueda a esa distancia (corregida a eslabones pares) y, en ⚡ Acciones, el giro de esta rueda + el de la conducida enlazado como cadena (mismo sentido). La cadena no se dibuja.' }),
      section('Corte láser'),
      el('p', { class: 'muted', text: 'DXF 1:1 en mm de la cara plana más grande de la pieza: dentado (arcos exactos), agujeros, chaflanes/redondeos del boceto y cortes, tal como están. Capa CORTE, lo interior primero, esquina inferior izquierda en (0, 0). Sin cotas ni cajetín. El kerf se compensa en el software de la máquina.' }),
      el('div', { class: 'row-wrap' },
        el('button', { class: 'btn', title: 'Polilínea cerrada con arcos (AutoCAD 2000): LightBurn, LaserGRBL, RDWorks nuevo, CNC', onClick: () => this.h.onExportSprocketLaser?.(feature.id, 'r2000') }, 'DXF láser'),
        el('button', { class: 'btn', title: 'Líneas y arcos sueltos (AutoCAD R12): para software láser antiguo', onClick: () => this.h.onExportSprocketLaser?.(feature.id, 'r12') }, 'DXF láser (R12)')),
    ];
  }

  // Par engranado: crea el engranaje conjugado o la cremallera ya encajados, con las acciones enlazadas.
  gearMateControls(feature, spec, z2) {
    this.mateConfig = this.mateConfig ?? {};
    const cfg = (this.mateConfig[feature.id] = { kind: 'gear', theta: '0', ...(this.mateConfig[feature.id] ?? {}) });
    const rack = cfg.kind === 'rack';
    const teeth = rack ? Math.max(2, Math.round(z2 / 2)) : z2;
    return [
      section('Par engranado'),
      field('Agregar', selectInput([['gear', 'Engranaje conjugado'], ['rack', 'Cremallera']], cfg.kind, (value) => { cfg.kind = value; this.h.onRefresh?.(); })),
      field('Ubicación respecto del piñón', selectInput([['0', '+X del plano (derecha)'], ['180', '−X del plano (izquierda)'], ['90', '+Y del plano (arriba)'], ['270', '−Y del plano (abajo)']], cfg.theta, (value) => { cfg.theta = value; })),
      el('button', { class: 'btn', onClick: () => this.h.onAddGearMate?.(feature.id, { kind: cfg.kind, teeth, thetaDeg: Number(cfg.theta) }) }, rack ? `Agregar cremallera (${teeth} dientes)` : `Agregar par engranado (${teeth} dientes)`),
      el('p', { class: 'muted', text: 'Crea la pieza a la distancia correcta, con los dientes entrelazados, y en ⚡ Acciones el giro del piñón + el seguimiento enlazado (engranaje externo o avance por paso).' }),
    ];
  }

  rotationSection(owner, params) {
    const rot = { axis: '', angle: 0, px: 0, py: 0, pz: 0, ...(owner.rot ?? {}) };
    const set = (patch) => this.h.onUpdate(owner.id, { rot: { ...rot, ...patch } });
    const rows = [field('Girar el plano sobre', selectInput([['', 'Sin rotación'], ['x', 'Eje X'], ['y', 'Eje Y'], ['z', 'Eje Z']], rot.axis ?? '', (value) => set({ axis: value })))];
    if (rot.axis) {
      rows.push(
        field('Ángulo', exprInput(rot.angle, params, (value) => set({ angle: value }), { unit: '°' })),
        el('div', { class: 'add-row' }, [-90, -45, -30, 30, 45, 90].map((deg) => button(`${deg > 0 ? '+' : ''}${deg}°`, () => set({ angle: deg })))),
        field('Centro de giro X', exprInput(rot.px, params, (value) => set({ px: value }), { unit: 'mm' })),
        field('Centro de giro Y', exprInput(rot.py, params, (value) => set({ py: value }), { unit: 'mm' })),
        field('Centro de giro Z', exprInput(rot.pz, params, (value) => set({ pz: value }), { unit: 'mm' })),
        el('p', { class: 'muted', text: 'El plano se desplaza y gira como un cuerpo rígido alrededor de ese eje. Ej.: plano Alzado (XZ) girado sobre Z con centro en el eje del cubo = corte radial a ese ángulo.' }),
      );
    }
    return el('details', { class: 'pattern', open: Boolean(rot.axis) }, el('summary', { text: rot.axis ? `Rotación: ${rot.axis.toUpperCase()} ${rot.angle}°` : 'Rotar el plano (cualquier ángulo)' }), el('div', { class: 'pattern-box' }, ...rows));
  }

  // Radio (R) o chaflán (C) en esquinas puntuales del rectángulo: ↙ ↘ ↗ ↖ (en los ejes del boceto).
  cornersSection(entity, params, update) {
    const names = ['Inferior izquierda ↙', 'Inferior derecha ↘', 'Superior derecha ↗', 'Superior izquierda ↖'];
    const corners = [0, 1, 2, 3].map((i) => ({ r: 0, c: 0, ...(entity.corners?.[i] ?? {}) }));
    const set = (index, patch) => update({ corners: corners.map((corner, i) => (i === index ? { ...corner, ...patch } : corner)) });
    const rows = names.map((name, i) => el('div', { class: 'pt-row' }, el('span', { text: name }), exprInput(corners[i].r, params, (value) => set(i, { r: value, c: 0 }), { unit: 'R' }), exprInput(corners[i].c, params, (value) => set(i, { c: value, r: 0 }), { unit: 'C' })));
    const active = corners.some((corner) => Number(corner.r) !== 0 || Number(corner.c) !== 0 || (typeof corner.r === 'string' && corner.r !== '0') || (typeof corner.c === 'string' && corner.c !== '0'));
    return el('details', { class: 'pattern', open: active }, el('summary', { text: active ? 'Esquinas (redondeo / chaflán) ●' : 'Esquinas (redondeo / chaflán)' }), el('div', { class: 'pattern-box' }, ...rows,
      el('div', { class: 'add-row' }, button('Todas R=2', () => update({ corners: corners.map(() => ({ r: 2, c: 0 })) })), button('Todas C=2', () => update({ corners: corners.map(() => ({ r: 0, c: 2 })) })), button('Quitar', () => update({ corners: undefined }))),
      el('p', { class: 'muted', text: 'R redondea y C chaflana solo esa esquina (distancia sobre cada lado). Deja 0 donde no quieras nada. Se aplica al boceto, así que vale para extrusiones y cortes.' })));
  }

  // Dirección de extrusión: 'up' sigue la normal del plano del boceto, 'down' va al lado opuesto, 'sym' reparte a ambos lados.
  directionOptions(sketch) {
    const xy = !sketch || (sketch.plane === 'XY' && !sketch.rot?.axis);
    return [['up', xy ? 'Hacia arriba (+Z)' : 'Sentido de la normal del plano'], ['down', xy ? 'Hacia abajo (−Z)' : 'Sentido opuesto a la normal'], ['sym', 'Simétrica (a ambos lados)']];
  }

  // Repetir la entidad en fila, círculo o elipse: genera las copias como entidades independientes (editables una a una).
  patternSection(sketch, entity, params) {
    this.patterns = this.patterns ?? {};
    const cfg = (this.patterns[entity.id] = this.patterns[entity.id] ?? { kind: 'row', count: '6', spacing: '20', angle: '0', cx: '0', cy: '0', total: '360', rotate: true, rx: '30', ry: '20', start: '0' });
    const box = el('div', { class: 'pattern-box' });
    const text = (label, key, unit) => field(label, exprInput(cfg[key], params, (value) => (cfg[key] = String(value)), { unit }));
    const fill = () => {
      const rows = [selectInput([['row', 'En fila'], ['circle', 'En círculo'], ['ellipse', 'En elipse']], cfg.kind, (value) => { cfg.kind = value; fill(); }), text('Cantidad (con el original)', 'count', 'u')];
      if (cfg.kind === 'row') rows.push(text('Separación', 'spacing', 'mm'), text('Ángulo de la fila', 'angle', '°'));
      if (cfg.kind === 'circle') rows.push(text('Centro X', 'cx', 'mm'), text('Centro Y', 'cy', 'mm'), text('Ángulo total', 'total', '°'), checkInput(cfg.rotate, (value) => (cfg.rotate = value), 'Girar las copias'));
      if (cfg.kind === 'ellipse') rows.push(text('Centro X', 'cx', 'mm'), text('Centro Y', 'cy', 'mm'), text('Radio X', 'rx', 'mm'), text('Radio Y', 'ry', 'mm'), text('Ángulo inicial', 'start', '°'));
      const hint = { row: 'Copias a lo largo de una línea desde el original.', circle: 'El original queda donde está; las copias giran alrededor del centro.', ellipse: 'Reparte los objetos sobre la elipse: el original pasa al primer punto.' }[cfg.kind];
      rows.push(el('p', { class: 'muted', text: hint }), button('Crear copias', () => {
        const number = (key) => {
          try {
            return evaluate(cfg[key], params);
          } catch {
            return Number.NaN;
          }
        };
        this.h.onPattern(sketch.id, entity, { kind: cfg.kind, count: number('count'), spacing: number('spacing'), angle: number('angle'), cx: number('cx'), cy: number('cy'), total: number('total'), rotateCopies: cfg.rotate, rx: number('rx'), ry: number('ry'), start: number('start') });
      }));
      box.replaceChildren(...rows);
    };
    fill();
    return el('details', { class: 'pattern' }, el('summary', { text: 'Repetir (fila · círculo · elipse)' }), box);
  }

  entityCard(sketch, entity, params) {
    const update = (patch) => this.h.onUpdateEntity(sketch.id, entity.id, patch);
    const num = (label, key, unit = 'mm') => field(label, exprInput(entity[key], params, (value) => update({ [key]: value }), { unit }));
    const body = [];
    if (entity.t === 'rect') body.push(num('X', 'x'), num('Y', 'y'), num('Ancho', 'w'), num('Alto', 'h'), checkInput(entity.centered, (value) => update({ centered: value }), 'Centrado en (X, Y)'), this.cornersSection(entity, params, update));
    if (entity.t === 'circle') body.push(num('Centro X', 'x'), num('Centro Y', 'y'), num('Diámetro', 'd'), ...this.threadControls(entity, entity.d, params, (thread) => update({ thread }), (d) => update({ d })));
    if (entity.t === 'polygon') body.push(num('Centro X', 'x'), num('Centro Y', 'y'), num('Lados', 'n', 'u'), field('Medida entre', selectInput([['flats', 'Caras (llave)'], ['corners', 'Vértices']], entity.across ?? 'flats', (value) => update({ across: value }))), num('Medida', 'd'), num('Giro', 'angle', '°'));
    if (entity.t === 'guide') body.push(num('Pasa por X', 'x'), num('Pasa por Y', 'y'), num('Ángulo', 'angle', '°'));
    if (entity.t === 'ellipse') body.push(num('Centro X', 'x'), num('Centro Y', 'y'), num('Eje X (total)', 'w'), num('Eje Y (total)', 'h'), num('Ángulo', 'angle', '°'));
    if (entity.t === 'slot') body.push(num('Centro X', 'x'), num('Centro Y', 'y'), num('Largo total', 'length'), num('Ancho', 'width'), num('Ángulo', 'angle', '°'));
    if (entity.t === 'poly') {
      entity.pts.forEach((point, index) => {
        const setPoint = (patch) => update({ pts: entity.pts.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
        body.push(
          el('div', { class: 'pt-row' },
            el('span', { class: 'pt-n', text: index + 1 }),
            exprInput(point.x, params, (value) => setPoint({ x: value }), { unit: 'x' }),
            exprInput(point.y, params, (value) => setPoint({ y: value }), { unit: 'y' }),
            exprInput(point.bulge ?? 0, params, (value) => setPoint({ bulge: value }), { unit: 'arco' }),
            exprInput(point.r ?? 0, params, (value) => setPoint({ r: value }), { unit: 'R' }),
            exprInput(point.c ?? 0, params, (value) => setPoint({ c: value }), { unit: 'C' }),
            entity.pts.length > 3 ? el('button', { class: 'mini danger', title: 'Quitar vértice', onClick: () => update({ pts: entity.pts.filter((_, i) => i !== index) }) }, '✕') : el('span'),
          ),
        );
      });
      body.push(button('+ Vértice', () => update({ pts: [...entity.pts, { x: 0, y: 0, bulge: 0 }] })), el('p', { class: 'muted', text: 'R = radio y C = chaflán solo en ese vértice (0 = esquina viva; no aplica si un tramo vecino es un arco). Arco: “bulge” = tan(ángulo/4) del tramo al siguiente vértice (0 = recta, 1 = semicírculo, + antihorario).' }));
    }
    if (entity.t !== 'guide') body.push(this.patternSection(sketch, entity, params));
    return el('details', { class: 'entity', open: true }, el('summary', {}, entityLabels[entity.t], el('button', { class: 'mini', title: 'Duplicar (Ctrl+D), desplazada 10 mm', onClick: (event) => { event.preventDefault(); this.h.onAddEntity(sketch.id, offsetEntity(entity, 10, 10)); } }, '⧉'), el('button', { class: 'mini danger', title: 'Eliminar', onClick: (event) => { event.preventDefault(); this.h.onRemoveEntity(sketch.id, entity.id); } }, '✕')), ...body);
  }
}
