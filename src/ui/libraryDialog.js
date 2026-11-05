import { button, el, field, textInput } from './dom.js';

// Biblioteca de piezas de máquina: categorías a la izquierda, búsqueda y tarjetas a la derecha; al elegir una se piden sus medidas.
// `onAdd(item, args)` agrega la pieza al proyecto (args = respuestas numéricas de item.ask).
const plain = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function openLibraryDialog(items, { onAdd }) {
  const categories = [...new Set(items.map((entry) => entry.category))];
  const state = { category: 'Todas', query: '', selected: null, args: {} };
  const overlay = el('div', { class: 'modal-overlay' });
  const body = el('div', { class: 'modal library-dialog' });
  overlay.append(body);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const visible = () => {
    const words = plain(state.query).split(/\s+/).filter(Boolean);
    return items.filter((entry) => (state.category === 'Todas' || entry.category === state.category)
      && words.every((word) => plain(`${entry.label} ${entry.description ?? ''} ${entry.id} ${entry.category}`).includes(word)));
  };

  const choose = (entry) => {
    state.selected = entry;
    state.args = {};
    (entry.ask ?? []).forEach((question) => { state.args[question.name] = question.value; });
    render(false);
  };

  const render = (keepSearchFocus = true) => {
    const list = visible();
    // campo propio (no textInput): su evento «change» al perder el foco reconstruía el diálogo y se perdía el clic sobre la tarjeta
    const search = el('input', { type: 'text', value: state.query, spellcheck: 'false', placeholder: 'Buscar: rodamiento, venturi, cinta, M10, motor…' });
    const counter = el('p', { class: 'muted', text: `${list.length} pieza(s)` });
    search.addEventListener('input', () => { state.query = search.value; renderList(); counter.textContent = `${visible().length} pieza(s)`; });
    const listBox = el('div', { class: 'library-list' });
    const detail = el('div', { class: 'library-detail' });
    const renderList = () => {
      const shown = visible();
      listBox.replaceChildren(...(shown.length ? shown.map((entry) => el('button', { type: 'button', class: `library-card${state.selected === entry ? ' selected' : ''}`, onClick: () => choose(entry), onDblclick: () => add(entry) },
        el('b', { text: entry.label }),
        el('span', { class: 'muted', text: entry.description ?? entry.category }))) : [el('p', { class: 'muted', text: 'Nada coincide con la búsqueda.' })]));
    };
    const add = (entry) => {
      const args = {};
      (entry.ask ?? []).forEach((question) => { args[question.name] = Number(String(state.args[question.name]).replace(',', '.')); });
      close();
      onAdd(entry, args);
    };
    renderList();
    if (state.selected) {
      const entry = state.selected;
      detail.append(
        el('h4', { text: entry.label }),
        el('p', { class: 'muted', text: entry.description ?? entry.category }),
        ...(entry.ask ?? []).map((question) => field(question.label, textInput(String(state.args[question.name]), (value) => { state.args[question.name] = value; }))),
        el('div', { class: 'row-wrap' }, button('Agregar al proyecto', () => add(entry), { active: true }), button('Cerrar', close)),
      );
    } else detail.append(el('p', { class: 'muted', text: 'Elegí una pieza de la lista (doble clic la agrega con sus valores por defecto). Todas se pueden editar después: son operaciones paramétricas.' }));
    body.replaceChildren(
      el('h3', { text: `Biblioteca de piezas · ${items.length} piezas` }),
      el('div', { class: 'library-layout' },
        el('div', { class: 'library-cats' }, ...['Todas', ...categories].map((name) => el('button', { type: 'button', class: `library-cat${state.category === name ? ' selected' : ''}`, onClick: () => { state.category = name; state.selected = null; render(false); } },
          `${name} `, el('span', { class: 'muted', text: String(name === 'Todas' ? items.length : items.filter((entry) => entry.category === name).length) })))),
        el('div', { class: 'library-main' }, search, counter, listBox),
        detail));
    if (keepSearchFocus) {
      const input = body.querySelector('.library-main input');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  };
  render(false);
  overlay.addEventListener('pointerdown', (event) => event.target === overlay && close());
  document.body.append(overlay);
  body.querySelector('.library-main input')?.focus();
  return close;
}
