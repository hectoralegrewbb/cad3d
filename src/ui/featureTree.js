import { featureLabels } from '../core/partModel.js';
import { button, el } from './dom.js';

const icons = { step:'▣', shell:'⊔', loft:'◇', sweep:'↝', sketch: '✎', extrude: '⬆', revolve: '↻', hole: '◎', thread: '⌇', gear: '⚙', screw: '🌀', pattern: '⁂', mesh: '▦', frame: '⌗', pipe: '⌒', fillet: '◜', chamfer: '◿' };

// Árbol de operaciones: orden = historial paramétrico.
export class FeatureTree {
  constructor(root, { onSelect, onAdd, onRemove, onMove, onSuppress, onEditSketch }) {
    this.root = root;
    this.handlers = { onSelect, onAdd, onRemove, onMove, onSuppress, onEditSketch };
  }

  label(feature, index, part) {
    const same = part.features.slice(0, index + 1).filter((item) => item.type === feature.type).length;
    return feature.name || `${featureLabels[feature.type]} ${same}`;
  }

  render(part, results, selectedId) {
    const { onSelect, onAdd, onRemove, onMove, onSuppress, onEditSketch } = this.handlers;
    const list = el('ul', { class: 'tree' });
    part.features.forEach((feature, index) => {
      const result = results[feature.id] ?? { status: 'ok' };
      const row = el(
        'li',
        { class: `tree-row ${selectedId === feature.id ? 'selected' : ''} st-${result.status}`, title: result.error ?? '', onClick: () => onSelect(feature.id), onDblclick: () => feature.type === 'sketch' && onEditSketch(feature.id) },
        el('span', { class: 'ico', text: icons[feature.type] }),
        el('span', { class: 'name', text: this.label(feature, index, part) }),
        result.status === 'error' ? el('span', { class: 'badge err', text: '!' }) : null,
        result.status === 'skipped' ? el('span', { class: 'badge skip', text: '·' }) : null,
        el('span', { class: 'row-actions' },
          el('button', { class: 'mini', title: feature.suppressed ? 'Activar' : 'Suprimir', onClick: (event) => { event.stopPropagation(); onSuppress(feature.id); } }, feature.suppressed ? '◌' : '●'),
          el('button', { class: 'mini', title: 'Subir', onClick: (event) => { event.stopPropagation(); onMove(feature.id, -1); } }, '↑'),
          el('button', { class: 'mini', title: 'Bajar', onClick: (event) => { event.stopPropagation(); onMove(feature.id, 1); } }, '↓'),
          el('button', { class: 'mini danger', title: 'Eliminar', onClick: (event) => { event.stopPropagation(); onRemove(feature.id); } }, '✕'),
        ),
      );
      if (feature.suppressed) row.classList.add('suppressed');
      list.append(row);
    });
    const add = el('div', { class: 'add-row' }, Object.entries(featureLabels).map(([type, label]) => button(`${icons[type]} ${label}`, () => onAdd(type), { title: `Agregar ${label.toLowerCase()}` })));
    this.root.replaceChildren(el('h3', { text: 'Operaciones' }), part.features.length === 0 ? el('p', { class: 'muted', text: 'Empezá con un boceto, o cargá una plantilla.' }) : list, add);
  }
}
