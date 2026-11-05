import { evaluate } from '../core/expression.js';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  });
  if(tag==='button'&&props.title&&!props['aria-label'])node.setAttribute('aria-label',props.title);
  children.flat().forEach((child) => child != null && node.append(child.nodeType ? child : document.createTextNode(String(child))));
  return node;
}

export const button = (label, onClick, { title, danger, active } = {}) => el('button', { type: 'button', class: `btn${danger ? ' danger' : ''}${active ? ' active' : ''}`, title, onClick }, label);

// Campo numérico que acepta expresiones ("D/2+1"); muestra el valor resuelto y marca errores.
export function exprInput(value, params, onCommit, { unit = 'mm' } = {}) {
  const input = el('input', { type: 'text', value: String(value ?? ''), spellcheck: 'false' });
  const hint = el('span', { class: 'hint' });
  const refresh = (text) => {
    try {
      const resolved = evaluate(text, params);
      const isLiteral = String(text).trim() !== '' && !Number.isNaN(Number(String(text).replace(',', '.')));
      hint.textContent = isLiteral ? unit : `= ${Math.round(resolved * 1000) / 1000} ${unit}`;
      hint.classList.remove('bad');
      input.classList.remove('bad');
    } catch (error) {
      hint.textContent = error.message;
      hint.classList.add('bad');
      input.classList.add('bad');
    }
  };
  refresh(value);
  input.addEventListener('input', () => refresh(input.value));
  input.addEventListener('change', () => {
    const text = input.value.trim();
    const asNumber = Number(text.replace(',', '.'));
    onCommit(text !== '' && Number.isFinite(asNumber) && /^-?\d*[.,]?\d+$/.test(text) ? asNumber : text);
  });
  input.addEventListener('keydown', (event) => event.key === 'Enter' && input.blur());
  return el('div', { class: 'expr' }, input, hint);
}

export const textInput = (value, onCommit) => {
  const input = el('input', { type: 'text', value: value ?? '' });
  input.addEventListener('change', () => onCommit(input.value));
  return input;
};

export function selectInput(options, value, onChange) {
  const select = el('select', {}, options.map(([key, label]) => el('option', { value: key, selected: key === value }, label)));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function checkInput(value, onChange, label) {
  const input = el('input', { type: 'checkbox', checked: Boolean(value) });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'check' }, input, label);
}

let fieldCounter=0;
export const field = (label, control) => {
  const input=control?.matches?.('input,select,textarea')?control:control?.querySelector?.('input,select,textarea');
  if(input&&!input.id)input.id=`field-${++fieldCounter}`;
  return el('div',{class:'field'},el('label',{text:label,...(input?{for:input.id}:{})}),control);
};
export const section = (title) => el('h4', { class: 'section', text: title });
