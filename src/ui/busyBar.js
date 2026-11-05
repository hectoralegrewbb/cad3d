// Barra de actividad del motor: aparece si un trabajo tarda más de `delay` ms, muestra qué se calcula y el tiempo, y permite cancelar.
const labels = {
  weldAssembly: 'Uniendo segmentos',
  importStep: 'Importando sólido STEP',
  build: 'Reconstruyendo pieza',
  resplit: 'Separando cuerpos',
  drawing: 'Generando plano',
  assemblyDrawing: 'Generando plano del conjunto',
  buildAssembly: 'Armando ensamble',
  safeTravel: 'Verificando choques',
  export: 'Exportando',
  referenceMesh: 'Calculando referencia',
  centerOf: 'Calculando centro',
  nextInstancePos: 'Ubicando instancia',
};

export class BusyBar {
  constructor({ root, label, cancelButton, onCancel, delay = 350 }) {
    this.root = root;
    this.label = label;
    this.delay = delay;
    this.jobs = [];
    this.timer = null;
    this.tick = null;
    this.prog = null; // avance real del trabajo en curso (fase, fracción, estimado)
    this.track = root.querySelector('.busy-track');
    this.fill = root.querySelector('.busy-fill');
    cancelButton.addEventListener('click', () => onCancel?.());
  }

  // `jobs`: [{ type, since }] pendientes (vacío = libre).
  update(jobs) {
    this.jobs = jobs;
    if (!jobs.length) {
      this.prog = null;
      this.track?.classList.remove('det');
      clearTimeout(this.timer);
      clearInterval(this.tick);
      this.timer = null;
      this.tick = null;
      this.root.hidden = true;
      return;
    }
    if (!this.timer && !this.tick) this.timer = setTimeout(() => this.show(), Math.max(0, this.delay - (Date.now() - jobs[0].since)));
  }

  show() {
    this.timer = null;
    if (!this.jobs.length) return;
    this.root.hidden = false;
    this.render();
    this.tick = setInterval(() => this.render(), 120);
  }

  // Avance informado por el motor: { type, phase, fraction 0-1, estimateMs, until }. Si trae estimado, la barra avanza sola hacia `until`.
  progress(info) {
    this.prog = { ...info, at: Date.now() };
    this.render();
  }

  render() {
    const [first] = this.jobs;
    if (!first) return;
    const elapsed = Date.now() - first.since;
    const seconds = (elapsed / 1000).toFixed(1).replace('.', ',');
    const more = this.jobs.length > 1 ? ` (+${this.jobs.length - 1})` : '';
    const name = labels[first.type] ?? 'Calculando';
    const prog = this.prog && this.prog.type === first.type ? this.prog : null;
    this.track?.classList.toggle('det', Boolean(prog));
    if (!prog) { this.label.textContent = `${name}${more} · ${seconds} s`; return; }
    const sub = prog.estimateMs > 0 ? Math.min(0.97, (Date.now() - prog.at) / prog.estimateMs) : 0;
    const fraction = Math.min(0.995, prog.fraction + (prog.until - prog.fraction) * sub);
    if (this.fill) this.fill.style.width = `${Math.round(fraction * 100)}%`;
    const rest = fraction > 0.08 && elapsed > 1500 ? Math.max(0, Math.round(elapsed / fraction - elapsed) / 1000) : null;
    this.label.textContent = `${name}${more} · ${prog.phase} · ${Math.round(fraction * 100)} %${rest !== null ? ` · ~${Math.ceil(rest)} s restantes` : ''} · ${seconds} s`;
  }
}
