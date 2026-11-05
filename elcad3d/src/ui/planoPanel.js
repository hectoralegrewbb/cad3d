import { button, checkInput, el, exprInput, field, section, selectInput, textInput } from './dom.js';
import { materials } from '../drawing/features3d.js';
import { sheetSizes, isoScales, formatScale, parseScale, stepScale } from '../drawing/sheet.js';
import { viewKinds, viewLabels } from '../drawing/projection.js';

// Panel derecho del modo Plano: hoja, vistas, cotas, cajetín y exportaciones.
export class PlanoPanel {
  constructor(container, handlers) {
    this.container = container;
    this.h = handlers;
  }

  render(part, drawing, info) {
    const { selectedDim, tool, hiddenCount, movedCount = 0 } = info;
    const c = this.container;
    c.replaceChildren();
    c.append(el('h3', { text: 'Plano' }));

    c.append(section('Herramientas de cotado'));
    const tools = [['select', 'Seleccionar (V)'], ['move', 'Mover vistas (M)'], ['linear', 'Lineal (L)'], ['diameter', 'Ø (D)'], ['radius', 'R (R)']];
    c.append(el('div', { class: 'row-wrap' }, tools.map(([key, label]) => button(label, () => this.h.onTool(key), { active: tool === key }))));
    if ((drawing.viewOffsets && Object.keys(drawing.viewOffsets).length) > 0) c.append(button(`Reubicar vistas (${Object.keys(drawing.viewOffsets).length} movidas)`, () => this.h.onResetViewPositions(), { title: 'Devuelve cada vista a su lugar automático' }));
    if (selectedDim) {
      c.append(el('div', { class: 'entity' },
        el('b', { text: selectedDim.auto ? 'Cota automática' : 'Cota manual' }),
        field('Texto (reemplaza el valor)', textInput(selectedDim.text ?? '', (value) => this.h.onDimText(selectedDim, { text: value.trim() }))),
        field('Antes del valor', textInput(selectedDim.prefix ?? '', (value) => this.h.onDimText(selectedDim, { prefix: value }))),
        field('Después del valor', textInput(selectedDim.suffix ?? '', (value) => this.h.onDimText(selectedDim, { suffix: value }))),
        selectedDim.type === 'linear' ? checkInput(selectedDim.diameter, (value) => this.h.onDimText(selectedDim, { diameter: value }), 'Prefijo Ø') : null,
        el('p', { class: 'hint-block', text: 'Ej.: antes "2× ", después " H7" o " (ref.)". Vacío = volver al valor medido.' }),
        button('Quitar cota', () => this.h.onDeleteDim(selectedDim), { danger: true }),
      ));
    }

    c.append(section('Hoja'));
    c.append(field('Formato', selectInput(Object.keys(sheetSizes).map((s) => [s, s]), drawing.sheet.size, (size) => this.h.onDrawing({ sheet: { size } }))));
    c.append(field('Orientación', selectInput([['landscape', 'Apaisada'], ['portrait', 'Vertical']], drawing.sheet.orientation, (orientation) => this.h.onDrawing({ sheet: { orientation } }))));
    c.append(field('Escala', selectInput([['auto', 'Automática'], ...isoScales.map((s) => [String(s), formatScale(s)])], String(drawing.scale), (scale) => this.h.onDrawing({ scale }))));
    c.append(field('Material', selectInput(Object.entries(materials).map(([key, m]) => [key, m.label]), part.meta.material ?? '', (material) => this.h.onMeta({ material }))));

    c.append(section('Vistas'));
    viewKinds.filter((kind) => kind !== 'section').forEach((kind) => {
      const view = drawing.views.find((item) => item.kind === kind);
      const row = el('div', { class: 'view-row' }, checkInput(Boolean(view), () => this.h.onToggleView(kind), viewLabels[kind]));
      if (view) {
        row.append(checkInput(view.showHidden, (showHidden) => this.h.onView(view.id, { showHidden }), 'ocultas'));
        row.append(checkInput(view.showAxes !== false, (showAxes) => this.h.onView(view.id, { showAxes }), 'ejes'));
        row.append(button('⟳', () => this.h.onView(view.id, { rotation: ((view.rotation ?? 0) + 90) % 360 }), { title: 'Rotar 90°' }));
      }
      c.append(row);
      if (view) c.append(this.viewScaleRow(view, info.sheetScale));
    });

    const sec = drawing.views.find((item) => item.kind === 'section');
    c.append(el('div', { class: 'view-row' }, checkInput(Boolean(sec), () => this.h.onToggleSection(), 'Vista en corte')));
    if (sec) {
      c.append(field('Plano de corte', selectInput([['x', 'X (mira desde −X)'], ['y', 'Y (mira desde −Y)'], ['z', 'Z (mira desde arriba)']], sec.plane ?? 'x', (plane) => this.h.onView(sec.id, { plane }))));
      c.append(field('Posición (mm)', textInput(String(sec.offset ?? 'auto'), (value) => {
        const text = value.trim().replace(',', '.');
        this.h.onView(sec.id, { offset: text === '' || text === 'auto' || Number.isNaN(Number(text)) ? 'auto' : Number(text) });
      })));
      c.append(field('Letra', textInput(sec.label ?? 'A', (value) => this.h.onView(sec.id, { label: (value.trim() || 'A').slice(0, 2).toUpperCase() }))));
      c.append(el('p', { class: 'hint-block', text: 'Posición "auto" = centro de la pieza en ese eje. Se conserva el lado hacia donde mira el observador.' }));
    }

    c.append(section('Cotas automáticas'));
    c.append(checkInput(drawing.autoDims, (autoDims) => this.h.onDrawing({ autoDims }), 'Acotar automáticamente'));
    const opts = drawing.autoOptions;
    [['general', 'Medidas generales'], ['diameters', 'Diámetros'], ['holes', 'Agujeros / PCD'], ['chains', 'Cadenas de cotas']].forEach(([key, label]) =>
      c.append(checkInput(opts[key] !== false, (value) => this.h.onDrawing({ autoOptions: { [key]: value } }), label)));
    if (movedCount > 0) c.append(button(`Restablecer posición de ${movedCount} cota(s) movida(s)`, () => this.h.onResetDimPositions()));
    if (hiddenCount > 0) c.append(button(`Restaurar ${hiddenCount} cota(s) quitada(s)`, () => this.h.onRestoreDims()));

    c.append(section('Cajetín'));
    const tb = drawing.titleBlock;
    [['number', 'N° de plano'], ['author', 'Dibujó'], ['date', 'Fecha (vacío = hoy)'], ['revision', 'Revisión'], ['tolerance', 'Tolerancia general']].forEach(([key, label]) =>
      c.append(field(label, textInput(tb[key] ?? '', (value) => this.h.onDrawing({ titleBlock: { [key]: value } })))));
    const notes = el('textarea', { rows: 4, spellcheck: 'false' });
    notes.value = (drawing.notes ?? []).join('\n');
    notes.addEventListener('change', () => this.h.onDrawing({ notes: notes.value.split('\n') }));
    c.append(field('Notas', notes));

    c.append(section('Exportar plano'));
    c.append(el('div', { class: 'row-wrap' },
      button('SVG', () => this.h.onExport('svg')),
      button('PDF / imprimir', () => this.h.onExport('pdf')),
      button('DXF', () => this.h.onExport('dxf'))));
    c.append(el('p', { class: 'hint-block', text: 'Rueda: zoom · Espacio+arrastrar o botón central: mover · F: ajustar. Shift al ubicar una cota lineal la deja alineada.' }));
  }
  // Escala propia de una vista: «= hoja» o un valor ISO / libre (2:1, 1:3, 1,5). − / + recorren las escalas normalizadas.
  viewScaleRow(view, sheetScale) {
    const own = parseScale(view.scale);
    const current = typeof own === 'number' ? own : sheetScale ?? 1;
    const options = [['auto', '= hoja'], ...isoScales.map((s) => [String(s), formatScale(s)])];
    if (typeof own === 'number' && !isoScales.includes(own)) options.splice(1, 0, [String(own), formatScale(own)]);
    const select = selectInput(options, typeof own === 'number' ? String(own) : 'auto', (value) => this.h.onView(view.id, { scale: value === 'auto' ? 'auto' : Number(value) }));
    const custom = textInput('', (value) => {
      const parsed = parseScale(value);
      if (parsed !== null && value.trim() !== '') this.h.onView(view.id, { scale: parsed });
    });
    custom.placeholder = 'otra: 3:1';
    custom.style.width = '70px';
    return el('div', { class: 'view-row view-scale' },
      el('span', { class: 'muted', text: `Escala ${viewLabels[view.kind] ?? view.kind}` }),
      button('−', () => this.h.onView(view.id, { scale: stepScale(current, -1) }), { title: 'Achicar esta vista (escala ISO anterior)' }),
      select,
      button('+', () => this.h.onView(view.id, { scale: stepScale(current, 1) }), { title: 'Agrandar esta vista (escala ISO siguiente)' }),
      custom);
  }
}
