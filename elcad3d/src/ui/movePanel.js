import { button, checkInput, el, field, selectInput, textInput } from './dom.js';
import { dragModes } from '../core/moveSnap.js';

// Mover operaciones: se tildan una o varias (extrusión, revolución, engranaje), se bloquea un eje y se desplazan en pasos.
// Modifica el modelo (campo `move` de cada operación) con un único paso de historial.
// `hooks`: { getOptions() → [{id,label,move}], getSelectedId() → id|null, onMove(ids, delta, absolute) }.
const axisIndex = { x: 0, y: 1, z: 2 };

export class MovePanel {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.config = { selected: [], axis: 'z', step: 5, stopOnHit: true, pick: true };
    this.message = '';
  }

  get open() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    this.hooks.onActiveChange?.();
    if (this.open) {
      const current = this.hooks.getSelectedId?.();
      if (current && !this.config.selected.length) this.config.selected = [current];
      this.sync();
    }
  }

  close() {
    const wasOpen = this.open;
    this.root.hidden = true;
    if (wasOpen) this.hooks.onActiveChange?.();
  }

  // Refresca la lista cuando el modelo cambia (se agregan/borran operaciones).
  sync() {
    if (!this.open) return;
    const valid = new Set(this.hooks.getOptions().map((option) => option.id));
    this.config.selected = this.config.selected.filter((id) => valid.has(id));
    this.render();
  }

  move(sign) {
    const { config } = this;
    if (!config.selected.length || !(config.step > 0)) return;
    const delta = [0, 0, 0];
    delta[axisIndex[config.axis]] = sign * config.step;
    // onMove puede devolver el aviso directo o una promesa (en Conjunto el motor corre en otro hilo).
    Promise.resolve(this.hooks.onMove(config.selected, delta, false, { stopOnHit: config.stopOnHit })).then((message) => {
      this.message = message ?? '';
      this.render();
    });
  }

  setSelected(ids) {
    this.config.selected = ids;
    this.render();
    this.hooks.onSelectionChange?.(ids);
  }

  render() {
    const { config } = this;
    const options = this.hooks.getOptions();
    const info = this.hooks.getInfo?.() ?? {};
    const chosen = options.filter((option) => config.selected.includes(option.id));
    const axes = ['X', 'Y', 'Z'];
    const total = chosen.length === 0 ? null : [0, 1, 2].map((i) => (chosen.every((option) => (option.move?.[i] ?? 0) === (chosen[0].move?.[i] ?? 0)) ? String(chosen[0].move?.[i] ?? 0) : 'varios'));
    const stepInput = textInput(String(config.step), (value) => {
      const n = Number(String(value).replace(',', '.'));
      if (n > 0 && Number.isFinite(n)) config.step = n;
      else stepInput.value = String(config.step);
    });
    this.root.replaceChildren(...[
      el('h3', { text: info.heading ?? '↔ Mover operaciones' }),
      options.length === 0 ? el('p', { class: 'muted', text: info.empty ?? 'No hay extrusiones, revoluciones ni engranajes para mover.' }) : el('div', { class: 'motor-targets' },
        el('b', { text: info.title ?? 'Qué se mueve (podés tildar varias)' }),
        ...options.map((option) => checkInput(config.selected.includes(option.id), (on) => this.setSelected(on ? [...config.selected, option.id] : config.selected.filter((id) => id !== option.id)), option.label)),
        el('div', { class: 'row-wrap' }, button('Todas', () => this.setSelected(options.map((option) => option.id))), button('Ninguna', () => this.setSelected([])))),
      checkInput(config.pick, (on) => { config.pick = on; this.render(); this.hooks.onPickChange?.(on); }, 'Elegir y arrastrar en el visor (imanes y distancias)'),
      config.pick ? el('p', { class: 'muted', text: 'Clic en un cuerpo = elegirlo (Mayús suma o quita). Arrastrá para moverlo sobre el eje o plano elegido: se imanta a caras, centros y origen de los otros cuerpos (Alt = sin imanes) y muestra la distancia libre a los vecinos. Clic en el vacío = soltar la selección.' }) : null,
      field('Mover sobre', selectInput(Object.entries(dragModes).map(([key, mode]) => [key, mode.label]), config.axis, (value) => { config.axis = value; this.render(); })),
      field('Paso (mm)', el('div', { class: 'row-wrap' }, stepInput, ...[0.1, 1, 10].map((value) => button(String(value), () => { config.step = value; this.render(); })))),
      !Object.prototype.hasOwnProperty.call(axisIndex, config.axis) ? el('p', { class: 'muted', text: 'En un plano se mueve arrastrando en el visor; para pasos exactos elegí un solo eje.' }) : null,
      el('div', { class: 'row-wrap' },
        Object.prototype.hasOwnProperty.call(axisIndex, config.axis) ? button(`− ${axes[axisIndex[config.axis]]}`, () => this.move(-1), { title: 'Mover en sentido negativo' }) : null,
        Object.prototype.hasOwnProperty.call(axisIndex, config.axis) ? button(`+ ${axes[axisIndex[config.axis]]}`, () => this.move(1), { title: 'Mover en sentido positivo' }) : null,
        info.collision ? null : button('↺ Volver al origen', () => config.selected.length && this.hooks.onMove(config.selected, [0, 0, 0], true), { title: 'Quita el desplazamiento de lo tildado' })),
      info.collision ? checkInput(config.stopOnHit, (value) => { config.stopOnHit = value; }, 'Detener al chocar con otra pieza') : null,
      el('p', { class: 'readout', text: total ? `${info.valueLabel ?? 'Desplazamiento'}: X ${total[0]} · Y ${total[1]} · Z ${total[2]} mm` : 'Tildá al menos una operación.' }),
      this.message ? el('p', { class: this.message.startsWith('⚠') ? 'err-block' : 'hint-block', text: this.message }) : null,
      el('p', { class: 'muted', text: info.help ?? 'Mueve la operación completa (su boceto va con ella) respecto del origen. Los agujeros y roscas no la siguen: se ubican por sus propias coordenadas.' }),
    ].filter(Boolean));
  }
}
