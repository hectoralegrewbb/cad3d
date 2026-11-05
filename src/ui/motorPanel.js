import { motorModes, rpmAt } from '../core/motion.js';
import { button, checkInput, el, field, selectInput, textInput } from './dom.js';

// Motor de movimiento: elegir qué gira (una o varias operaciones/instancias; el resto queda quieto), un eje que pasa por un punto,
// y la velocidad (constante o variable). Es solo una animación del visor: no modifica el modelo ni el kernel.
// `hooks`: { getOptions() → { options: [{id,label}], hint }, getTargets(selected) → ids del visor, onSelect(ids), onClose() }.
export class MotorPanel {
  constructor(root, viewer, hooks) {
    this.root = root;
    this.viewer = viewer;
    this.hooks = hooks;
    this.config = { selected: [], axis: 'z', pivot: [0, 0, 0], rpm: 60, mode: 'const', period: 6, reverse: false, physics: true };
    this.readout = el('span', { class: 'readout', text: 'detenido' });
    viewer.onMeshesChanged = () => this.sync();
  }

  get open() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.root.hidden) {
      this.viewer.stopMotor(true);
      this.viewer.showMotorAxis(null);
      this.hooks.onClose?.();
    } else this.sync();
  }

  targets() {
    return this.hooks.getTargets(this.config.selected);
  }

  // Centro de la caja que envuelve los elementos que giran.
  centerOfTargets() {
    const wanted = new Set(this.targets());
    const boxes = (this.viewer.items ?? []).filter((item) => wanted.has(item.id)).map((item) => item.bounds);
    if (!boxes.length) return [0, 0, 0];
    return [0, 1, 2].map((i) => Math.round(((Math.min(...boxes.map((b) => b.min[i])) + Math.max(...boxes.map((b) => b.max[i]))) / 2) * 1000) / 1000);
  }

  extent() {
    const size = this.viewer.bounds?.size ?? [100, 100, 100];
    return Math.max(...size, 20) * 0.9;
  }

  sync() {
    const { options } = this.hooks.getOptions();
    const valid = new Set(options.map((option) => option.id));
    this.config.selected = this.config.selected.filter((id) => valid.has(id));
    this.readout.textContent = 'detenido';
    if (this.open) {
      if (this.config.pivotAuto !== false) this.config.pivot = this.centerOfTargets();
      this.render();
    }
  }

  drawAxis() {
    if (this.open) this.viewer.showMotorAxis(this.config.axis, this.config.pivot, this.extent());
  }

  // Con físicas: el motor está en una instancia y lo demás gira por engranes (relación z1/z2, sentido y fase de dientes).
  train() {
    return this.config.physics && this.hooks.getTrain ? this.hooks.getTrain(this.config.selected) : null;
  }

  start() {
    const { config } = this;
    try {
      const train = this.train();
      if (train) {
        if (train.error) throw new Error(train.error);
        if (train.conflicts.length) throw new Error(train.conflicts[0]);
        this.viewer.startMotor({
          bodies: train.bodies,
          rpmAt: (t) => rpmAt(config, t),
          onTick: (angle, rpm) => { this.readout.textContent = `${angle.toFixed(0)}° · ${rpm.toFixed(0)} rpm (motor)`; },
        });
        return;
      }
      this.viewer.startMotor({
        itemIds: this.targets(),
        axis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[config.axis],
        pivot: config.pivot,
        rpmAt: (t) => rpmAt(config, t),
        onTick: (angle, rpm) => { this.readout.textContent = `${angle.toFixed(0)}° · ${rpm.toFixed(0)} rpm`; },
      });
    } catch (error) {
      this.readout.textContent = error.message;
    }
  }

  select(ids) {
    this.viewer.stopMotor(true);
    this.config.selected = ids;
    this.config.pivotAuto = true;
    this.hooks.onSelect(ids); // la pieza puede reconstruirse: sync() vuelve a pintar
    this.config.pivot = this.centerOfTargets();
    this.render();
  }

  // Casilla de físicas + informe de pares (engranan / interfieren / separados) cuando hay engranajes.
  physicsBlock() {
    if (!this.hooks.getTrain || (this.hooks.physicsAvailable && !this.hooks.physicsAvailable())) return [];
    const { config } = this;
    const train = this.train();
    const rows = [];
    if (train && !train.error) {
      train.links.forEach((link) => rows.push(el('p', { class: link.status === 'mesh' ? 'hint-block' : 'err-block', text: link.text })));
      train.conflicts.forEach((text) => rows.push(el('p', { class: 'err-block', text })));
      if (!train.links.length) rows.push(el('p', { class: 'hint-block', text: 'Ningún engranaje toca a otro: alineá ejes paralelos y distancia entre centros = (z1+z2)·m/2.' }));
    } else if (train?.error) rows.push(el('p', { class: 'err-block', text: train.error }));
    const canEngage = train && !train.error && train.links.some((link) => link.status === 'apart' || link.status === 'overlap') && this.hooks.onEngage;
    const canSync = train && !train.error && train.links.some((link) => link.status === 'mesh') && this.hooks.onSyncTeeth;
    return [
      checkInput(config.physics, (value) => { config.physics = value; this.viewer.stopMotor(true); this.config.selected = []; this.hooks.onPhysics?.(); this.render(); }, 'Físicas: transmitir por engranajes'),
      ...rows,
      canEngage ? button('Engranar (distancia + dientes)', () => {
        this.viewer.stopMotor(true);
        const changed = this.hooks.onEngage(config.selected);
        this.readout.textContent = changed ? 'pares ubicados a distancia de engrane' : 'nada para ajustar';
      }, { title: 'Mueve el engranaje que el motor no alcanza hasta la distancia de centros (z1+z2)·m/2 y sincroniza los dientes' }) : null,
      canSync ? button('Sincronizar dientes', () => {
        this.viewer.stopMotor(true);
        const changed = this.hooks.onSyncTeeth(config.selected);
        this.readout.textContent = changed ? `dientes sincronizados (${changed} instancia(s) giradas)` : 'los dientes ya estaban sincronizados';
      }, { title: 'Gira cada engranaje engranado lo justo para que los dientes se intercalen sin chocar' }) : null,
    ].filter(Boolean);
  }

  render() {
    const { config } = this;
    const train = this.train();
    const { options, hint } = this.hooks.getOptions();
    const num = (label, index) => el('label', {}, `${label} `, textInput(String(config.pivot[index]), (value) => {
      const n = Number(String(value).replace(',', '.'));
      if (Number.isFinite(n)) {
        config.pivot[index] = n;
        config.pivotAuto = false;
        this.drawAxis();
      }
    }));
    const running = this.viewer.motorRunning;
    const rpmInput = el('input', { type: 'text', value: String(config.rpm) });
    const slider = el('input', { type: 'range', min: '0', max: '600', step: '1', value: String(Math.min(600, config.rpm)) });
    const setRpm = (value) => {
      const n = Number(String(value).replace(',', '.'));
      if (Number.isFinite(n) && n >= 0 && n <= 5000) config.rpm = n; // velocidad en vivo: el motor lee config en cada cuadro
      rpmInput.value = String(config.rpm);
      slider.value = String(Math.min(600, config.rpm));
    };
    slider.addEventListener('input', () => setRpm(slider.value));
    rpmInput.addEventListener('change', () => setRpm(rpmInput.value));
    const toggleOption = (id, on) => this.select(on ? [...config.selected, id] : config.selected.filter((item) => item !== id));
    this.root.replaceChildren(...[
      el('h3', { text: '⚙ Motor de movimiento' }),
      options.length === 0 ? el('p', { class: 'muted', text: 'No hay nada para mover: armá una pieza o un ensamble.' }) : el('div', { class: 'motor-targets' },
        el('b', { text: train ? 'Motor en… (lo demás gira por engranes)' : 'Qué gira (el resto queda quieto)' }),
        ...options.map((option) => checkInput(config.selected.includes(option.id), (on) => toggleOption(option.id, on), option.label)),
        el('div', { class: 'row-wrap' }, button('Todo', () => this.select([])), button('Ninguno quieto', () => this.select(options.map((option) => option.id)))),
        el('p', { class: 'muted', text: config.selected.length ? `${config.selected.length} elegido(s) gira(n)` : 'Sin elegir: gira todo' }),
        hint ? el('p', { class: 'muted', text: hint }) : null),
      ...this.physicsBlock(),
      train ? null : field('Eje de giro', selectInput([['x', 'Eje X'], ['y', 'Eje Y'], ['z', 'Eje Z']], config.axis, (value) => { config.axis = value; this.drawAxis(); if (this.viewer.motorRunning) this.start(); })),
      train ? null : el('div', { class: 'row-wrap' }, num('X', 0), num('Y', 1), num('Z', 2)),
      train ? null : el('div', { class: 'row-wrap' }, button('Centro de lo que gira', () => { config.pivot = this.centerOfTargets(); config.pivotAuto = true; this.drawAxis(); this.render(); }), button('Origen', () => { config.pivot = [0, 0, 0]; config.pivotAuto = false; this.drawAxis(); this.render(); })),
      field('Velocidad (rpm)', el('div', { class: 'row-wrap' }, slider, rpmInput)),
      field('Perfil', selectInput(Object.entries(motorModes), config.mode, (value) => { config.mode = value; this.render(); })),
      config.mode !== 'const' ? field('Período (s)', textInput(String(config.period), (value) => { const n = Number(String(value).replace(',', '.')); if (n >= 0.2) config.period = n; })) : null,
      checkInput(config.reverse, (value) => { config.reverse = value; }, 'Sentido inverso'),
      el('div', { class: 'row-wrap' },
        button(running ? '⏸ Pausa' : '▶ Girar', () => { if (running) this.viewer.pauseMotor(); else this.start(); this.render(); }, { active: running }),
        button('⏹ Detener', () => { this.viewer.stopMotor(true); this.readout.textContent = 'detenido'; this.render(); })),
      this.readout,
      el('p', { class: 'muted', text: 'Solo animación: no cambia el modelo. La línea amarilla es el eje de giro.' }),
    ].filter(Boolean));
    this.drawAxis();
  }
}
