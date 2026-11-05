import { materials } from '../drawing/features3d.js';
import { button, el, field, section, selectInput } from './dom.js';
import { MAX_PARTS } from '../core/projectModel.js';
import { partColor } from '../core/partColor.js';

// Panel de proyecto: lista de piezas (máx. 8), activa, duplicar, eliminar y agregar al ensamble.
export class ProjectPanel {
  constructor(container, handlers) {
    this.container = container;
    this.h = handlers;
  }

  // Color de la pieza: clic para elegir; ↺ vuelve al automático (paleta / material).
  swatch(item, index) {
    const input = el('input', { type: 'color', class: 'swatch-input', value: partColor(item.part, index, { palette: true }), title: 'Color de la pieza (3D y ensamble)' });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('change', () => this.h.onColor(item.id, input.value));
    if (!item.part.meta.color) return input;
    const reset = el('button', { type: 'button', class: 'mini', title: 'Volver al color automático', onClick: (event) => { event.stopPropagation(); this.h.onColor(item.id, ''); } }, '↺');
    return el('span', { class: 'swatch-wrap' }, input, reset);
  }

  render(project, { scope, templateOptions }) {
    const c = this.container;
    c.replaceChildren();
    c.append(el('h3', { text: 'Proyecto' }));
    const rows = project.parts.map((item, index) => {
      const count = project.instances.filter((inst) => inst.partId === item.id).length;
      const active = item.id === project.activePartId;
      return el('div', { class: `part-row${active && scope === 'part' ? ' active' : ''}`, onClick: () => this.h.onSelect(item.id) },
        this.swatch(item, index),
        el('span', { class: 'part-title', text: item.part.meta.name }),
        el('span', { class: 'part-count', title: 'Instancias en el ensamble', text: count ? `×${count}` : '' }),
        button('⇢', (event) => { event.stopPropagation(); this.h.onAddInstance(item.id); }, { title: 'Agregar al ensamble' }),
        button('⧉', (event) => { event.stopPropagation(); this.h.onDuplicate(item.id); }, { title: 'Duplicar pieza' }),
        button('✕', (event) => { event.stopPropagation(); this.h.onRemove(item.id); }, { title: 'Eliminar pieza', danger: true }));
    });
    c.append(el('div', { class: 'part-list' }, rows));
    const row = el('div', { class: 'row-wrap' }, button('+ Pieza vacía', () => this.h.onAddEmpty()));
    const select = selectInput([['', 'Agregar desde plantilla…'], ...templateOptions], '', (key) => {
      if (key) this.h.onAddTemplate(key);
      select.value = '';
    });
    row.append(select);
    c.append(row);
    const active = project.parts.find((item) => item.id === project.activePartId);
    if (active) c.append(field('Material', selectInput(Object.entries(materials).map(([key, m]) => [key, m.label]), active.part.meta.material ?? '', (material) => this.h.onMaterial(material))));
    c.append(el('div', { class: 'row-wrap' }, button('Guardar pieza (.part3d)', () => this.h.onSavePart())));
    c.append(el('p', { class: 'hint-block', text: `${project.parts.length}/${MAX_PARTS} piezas · ⇢ agrega la pieza al ensamble` }));
  }
}
