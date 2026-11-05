import { button, el, exprInput, textInput } from './dom.js';

// Tabla de parámetros nombrados (variables de diseño): D1, L, PCD…
export class ParamsPanel {
  constructor(root, { onSet, onRename, onRemove }) {
    this.root = root;
    this.handlers = { onSet, onRename, onRemove };
  }

  render(part, evaluated) {
    const { onSet, onRename, onRemove } = this.handlers;
    const rows = part.params.map((param, index) => {
      const known = Object.fromEntries(part.params.slice(0, index).map((p) => [p.name, evaluated.values[p.name]]).filter(([, v]) => v !== undefined));
      return el('div', { class: 'param-row' },
        textInput(param.name, (value) => /^[A-Za-z_][\w]*$/.test(value) && onRename(param.name, value)),
        exprInput(param.value, known, (value) => onSet(param.name, value), { unit: '' }),
        el('button', { class: 'mini danger', title: 'Eliminar parámetro', onClick: () => onRemove(param.name) }, '✕'),
      );
    });
    const add = button('+ Parámetro', () => {
      let n = 1;
      while (part.params.some((p) => p.name === `P${n}`)) n += 1;
      onSet(`P${n}`, 10);
    });
    this.root.replaceChildren(
      el('h3', { text: 'Parámetros' }),
      part.params.length === 0 ? el('p', { class: 'muted', text: 'Variables como D1, L o PCD. Usalas en cualquier campo: “D1/2 + 1”.' }) : el('div', { class: 'params' }, rows),
      add,
    );
  }
}
