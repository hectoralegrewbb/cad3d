import { assemblyRelations } from './assemblyRelations.js';
import { button, checkInput, el, exprInput, field, section, selectInput } from './dom.js';
import { materials } from '../drawing/features3d.js';
import { partColor } from '../core/partColor.js';

const fmtMass = (kg) => (kg > 0 ? `${kg.toFixed(kg < 1 ? 3 : 2).replace('.', ',')} kg` : '—');

// Panel del ensamble: instancias (posición/rotación), ayudas de colocación, interferencias, lista de materiales y exportación.
export class AssemblyPanel {
  constructor(container, handlers) {
    this.container = container;
    this.h = handlers;
    this.weldSelection = new Set();
  }

  render(project, built, error) {
    const c = this.container;
    c.replaceChildren();
    c.append(el('h3', { text: 'Ensamble' }));
    if (error) c.append(el('p', { class: 'err-block', text: error }));
    if (!project.instances.length) c.append(el('p', { class: 'hint-block', text: 'Todavía no hay piezas en el ensamble. Usá ⇢ en la lista de piezas.' }));

    const colorOf = (partId) => {
      const index = Math.max(0, project.parts.findIndex((item) => item.id === partId));
      return partColor(project.parts[index].part, index, { palette: true });
    };
    if(this.h.onRelations)c.append(assemblyRelations(project, this.h.onRelations));
    for (const id of this.weldSelection) if (!project.instances.some(instance => instance.id === id)) this.weldSelection.delete(id);
    if (this.h.onWeld) {
      const weldButton = button('Unir en una pieza', async () => {
        weldButton.disabled = true;
        weldButton.textContent = 'Uniendo segmentos…';
        try { await this.h.onWeld([...this.weldSelection]); }
        finally { weldButton.disabled = false; weldButton.textContent = 'Unir en una pieza'; }
      });
      c.append(section('Unir segmentos'), el('p', {class:'hint-block', text:'Marcá los segmentos y unilos en una pieza fija. Deben tocarse o solaparse. Se conservan las piezas originales; sus instancias seleccionadas se reemplazan por la unión.'}),
        weldButton,
        el('p', {class:'hint-block',text:'No rellena separaciones ni abre bocas que ya estén tapadas. Con materiales diferentes, revisá el material de la pieza resultante.'}));
    }
    const inst = built?.instances ?? [];
    project.instances.forEach((instance) => {
      const part = project.parts.find((item) => item.id === instance.partId);
      const live = inst.find((item) => item.id === instance.id);
      const others = project.instances.filter((other) => other.id !== instance.id);
      const collides = built?.interferences.filter((hit) => hit.a === instance.id || hit.b === instance.id) ?? [];
      const triple = (label, values, key, unit) => el('div', { class: 'xyz-row' }, el('label', { text: label }), ...[0, 1, 2].map((axis) => exprInput(values[axis], {}, (value) => {
        const next = [...values];
        next[axis] = typeof value === 'number' ? value : 0;
        this.h.onUpdate(instance.id, { [key]: next });
      }, { unit })));
      const stackSelect = others.length ? selectInput([['', 'Apoyar sobre…'], ...others.map((other) => [other.id, `${project.parts.find((item) => item.id === other.partId)?.part.meta.name ?? other.id} (${other.id})`])], '', (target) => target && this.h.onStack(instance.id, target)) : null;
      c.append(el('div', { class: `entity${collides.length ? ' warn' : ''}` },
        el('div', { class: 'inst-head' }, el('span', { class: 'swatch', style: `background:${colorOf(instance.partId)}` }), el('b', { text: `${part?.part.meta.name ?? '¿?'} · ${instance.id}` }), button('✕', () => this.h.onRemove(instance.id), { danger: true, title: 'Quitar del ensamble' })),
        this.h.onWeld ? checkInput(this.weldSelection.has(instance.id), selected => selected ? this.weldSelection.add(instance.id) : this.weldSelection.delete(instance.id), 'Incluir en unión') : null,
        button(instance.fixed?'Desfijar instancia':'Fijar instancia',()=>this.h.onUpdate(instance.id,{fixed:!instance.fixed})),
        triple('Pos X/Y/Z', instance.pos, 'pos', 'mm'),
        triple('Giro X/Y/Z', instance.rot, 'rot', '°'),
        live ? el('p', { class: 'hint-block', text: `Recuadro: ${live.bounds[0].map((v, i) => `${v.toFixed(1)}…${live.bounds[1][i].toFixed(1)}`).join(' · ')}` }) : null,
        stackSelect,
        el('div', { class: 'row-wrap' }, button('Duplicar', () => this.h.onDuplicate(instance.id)), button('Centrar X/Y en origen', () => this.h.onCenter(instance.id)))));
    });

    if (built) {
      c.append(section('Interferencias'));
      if(built.unchecked?.length)c.append(el('p',{class:'alert soft',text:`${built.unchecked.length} instancia(s) solo malla: interferencias y masa aproximada sin verificación B-Rep.`}));
      if (!built.interferences.length) c.append(el('p', { class: 'hint-block', text: built.unchecked?.length?'Sin interferencias detectadas entre los sólidos verificados.':'Sin interferencias entre piezas.' }));
      built.interferences.forEach((hit) => c.append(el('p', { class: 'err-block', text: `${hit.a} ↔ ${hit.b}: se superponen ${Number.isFinite(hit.volume) ? `${Math.round(hit.volume)} mm³` : '(no se pudo calcular)'}` })));

      c.append(section('Lista de materiales'));
      const table = el('table', { class: 'bom' },
        el('thead', {}, el('tr', {}, ['Pos', 'Cant', 'Pieza', 'Material', 'Masa u.'].map((title) => el('th', { text: title })))),
        el('tbody', {}, built.bom.map((row) => el('tr', {}, [row.item, row.qty, row.name, materials[row.material]?.label ?? '—', fmtMass(row.unitMass)].map((cell) => el('td', { text: String(cell) }))))));
      c.append(table);
      c.append(el('p', { class: 'hint-block', text: `Masa total: ${fmtMass(built.totalMass)}` }));
    }

    c.append(section('Exportar conjunto'));
    c.append(el('div', { class: 'row-wrap' }, button('STL', () => this.h.onExport('stl')), button('3MF (1 objeto por pieza)', () => this.h.onExport('3mf')), button('STEP', () => this.h.onExport('step'))));
  }
}
