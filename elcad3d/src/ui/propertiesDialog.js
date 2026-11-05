import { geometryJob } from '../io/geometryClient.js';
import { bulkMaterials, capacityUpTo, internalCapacity, productKg } from '../core/capacity.js';
import { inertiaKgM2, massFromVolume, mergeMeshes, meshProperties } from '../core/massProps.js';
import { materials } from '../drawing/features3d.js';
import { button, el, field, selectInput, textInput } from './dom.js';

// Diálogo «Propiedades físicas»: volumen, superficie, masa, centro de masa, inercia, capacidad interior y producto contenido.
// `model` = { title, items: [{ name, mesh, density, materialLabel }], frames: [{ label, count, totalLength, totalWeight }] }
const num = (value) => Number(String(value).replace(',', '.'));
const fmt = (value, digits = 3) => (Number.isFinite(value) ? (Number(value.toPrecision(digits + 2)) || 0).toLocaleString('es-AR', { maximumFractionDigits: digits }).replace(/^-(0(,0*)?)$/, '$1') : '—');
const row = (label, value, hint) => el('tr', {}, el('td', { class: 'muted', text: label }), el('td', { text: value }), el('td', { class: 'muted', text: hint ?? '' }));

export function openPropertiesDialog(model) {
  const overlay = el('div', { class: 'modal-overlay' });
  const body = el('div', { class: 'modal properties-dialog' });
  overlay.append(body);
  let job = null;
  const close = () => { job?.abort(); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });

  const items = model.items.filter((item) => item.mesh);
  const state = { target: 'all', capacity: null, fill: '100', fillMode: 'pct', height: '', bulk: 780, bulkName: 'Trigo', busy: false };
  const selected = () => (state.target === 'all' ? items : items.filter((item) => item.name === state.target));
  const merged = () => mergeMeshes(selected().map((item) => item.mesh));

  const render = () => {
    const list = selected();
    if (!list.length) {
      body.replaceChildren(el('h3', { text: 'Propiedades físicas' }), el('p', { class: 'muted', text: 'No hay geometría para medir.' }), button('Cerrar', close));
      return;
    }
    const props = meshProperties(merged());
    // masa y inercia por elemento (cada uno con su densidad); la inercia del conjunto se arma con Steiner sobre el centro de masa total
    const per = list.map((item) => ({ item, p: meshProperties(item.mesh) }));
    const mass = per.reduce((sum, { item, p }) => sum + massFromVolume(p.volume, item.density), 0);
    const missing = per.some(({ item }) => !(item.density > 0));
    const com = mass > 0
      ? [0, 1, 2].map((k) => per.reduce((sum, { item, p }) => sum + massFromVolume(p.volume, item.density) * p.centroid[k], 0) / mass)
      : props.centroid;
    let inertia = null;
    if (mass > 0 && per.every(({ p }) => p.inertia)) {
      inertia = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 };
      per.forEach(({ item, p }) => {
        const m = massFromVolume(p.volume, item.density);
        const own = inertiaKgM2(p.inertia, item.density);
        const d = [0, 1, 2].map((k) => (p.centroid[k] - com[k]) / 1000); // m
        const mm = m;
        inertia.xx += own.xx + mm * (d[1] ** 2 + d[2] ** 2);
        inertia.yy += own.yy + mm * (d[0] ** 2 + d[2] ** 2);
        inertia.zz += own.zz + mm * (d[0] ** 2 + d[1] ** 2);
        inertia.xy += own.xy - mm * d[0] * d[1];
        inertia.yz += own.yz - mm * d[1] * d[2];
        inertia.zx += own.zx - mm * d[2] * d[0];
      });
    }
    const targetSelect = selectInput([['all', items.length > 1 ? `Todo lo visible (${items.length} cuerpos)` : 'Todo lo visible'], ...items.map((item) => [item.name, item.name])], state.target, (value) => { state.target = value; state.capacity = null; render(); });
    const size = props.bounds.size;
    const table = el('table', { class: 'props-table' },
      row('Volumen de material', `${fmt(props.volume / 1000, 2)} cm³`, `${fmt(props.volume / 1e6, 3)} L · ${fmt(props.volume / 1e9, 6)} m³`),
      row('Superficie total', `${fmt(props.area / 100, 2)} cm²`, `${fmt(props.area / 1e6, 4)} m² (pintura, chorreado, aislación)`),
      row('Masa', missing ? (mass > 0 ? `${fmt(mass, 3)} kg (parcial)` : 'sin material asignado') : `${fmt(mass, 3)} kg`, missing ? 'Asigná material a la pieza para tener masa' : [...new Set(list.map((item) => item.materialLabel))].join(' · ')),
      row('Dimensiones (X × Y × Z)', `${fmt(size[0], 2)} × ${fmt(size[1], 2)} × ${fmt(size[2], 2)} mm`, `Caja envolvente: ${fmt(size[0] * size[1] * size[2] / 1e6, 2)} L`),
      row('Centro de masa', `${com.map((v) => fmt(v, 2)).join(' ; ')} mm`, 'X ; Y ; Z'),
      ...(inertia ? [row('Inercia en el centro de masa', `Ixx ${fmt(inertia.xx, 3)} · Iyy ${fmt(inertia.yy, 3)} · Izz ${fmt(inertia.zz, 3)} kg·m²`, 'ejes globales'), row('Productos de inercia', `Ixy ${fmt(inertia.xy, 3)} · Iyz ${fmt(inertia.yz, 3)} · Izx ${fmt(inertia.zx, 3)} kg·m²`, '')] : []),
    );

    // Material de la pieza activa: se cambia acá mismo (la masa depende de él)
    const materialRow = model.onMaterial ? field('Material de la pieza', selectInput(Object.entries(materials).map(([key, m]) => [key, m.label]), model.material ?? '', (value) => {
      model.onMaterial(value);
      model.material = value;
      items.forEach((item) => { item.density = materials[value]?.density ?? 0; item.materialLabel = materials[value]?.label ?? 'sin material'; });
      state.capacity = state.capacity; render();
    })) : null;
    const frames = model.frames ?? [];
    const frameBlock = frames.length ? [el('h4', { class: 'section', text: 'Estructura (perfiles)' }), el('table', { class: 'props-table' },
      ...frames.map((frame) => row(frame.label, `${frame.count} barras · ${fmt(frame.totalLength / 1000, 3)} m`, `${fmt(frame.totalWeight, 3)} kg de perfil (acero)`)))] : [];

    // capacidad
    const cap = state.capacity;
    const capBlock = [el('h4', { class: 'section', text: 'Capacidad interior (tolvas, cañerías, tanques)' })];
    if (!cap) {
      capBlock.push(
        el('p', { class: 'muted', text: 'Mide el volumen hueco que puede contener la pieza (bocas abiertas incluidas), sin descontar nada. Es una estimación por voxeles: ±3–5 %.' }),
        button(state.busy ? 'Cancelar cálculo' : 'Calcular capacidad', async () => {
          if (state.busy) { job?.abort(); return; }
          job = new AbortController(); state.busy = true; render();
          try { state.capacity = await geometryJob('capacity', merged(), {signal:job.signal}); }
          catch (error) { if (error.message !== 'Cancelado') state.error=error.message; }
          finally { state.busy=false; if (overlay.isConnected) render(); }
        }, { active: true }));
    } else {
      const zMin = props.bounds.min[2];
      const zMax = props.bounds.max[2];
      if (state.height === '') state.height = String(Math.round(zMax));
      const upTo = state.fillMode === 'pct' ? cap.capacity * Math.max(0, Math.min(100, num(state.fill) || 0)) / 100 : capacityUpTo(cap, num(state.height));
      const kg = productKg(upTo, 1, state.bulk);
      const bulkSelect = selectInput([...bulkMaterials.map(([name, density]) => [name, `${name} (${density} kg/m³)`]), ['otro', 'Otro…']], state.bulkName, (value) => {
        state.bulkName = value;
        const found = bulkMaterials.find(([name]) => name === value);
        if (found) state.bulk = found[1];
        render();
      });
      capBlock.push(
        el('table', { class: 'props-table' },
          row('Capacidad', `${fmt(cap.capacity / 1e6, 3)} L`, `${fmt(cap.capacity / 1e9, 5)} m³`),
          row('Cavidad cerrada (sin bocas)', `${fmt(cap.sealed / 1e6, 3)} L`, cap.sealed < cap.capacity * 0.01 ? 'recipiente abierto' : 'tanque con tapa'),
          row('Voxel usado', `${fmt(cap.h, 2)} mm`, 'más chico = más preciso')),
        el('div', { class: 'row-wrap' },
          field('Llenar por', selectInput([['pct', 'Porcentaje'], ['height', 'Altura Z (mm)']], state.fillMode, (value) => { state.fillMode = value; render(); })),
          state.fillMode === 'pct'
            ? field('Llenado %', textInput(state.fill, (value) => { state.fill = value; render(); }))
            : field(`Altura Z (${fmt(zMin, 1)} a ${fmt(zMax, 1)})`, textInput(state.height, (value) => { state.height = value; render(); }))),
        el('div', { class: 'row-wrap' },
          field('Producto', bulkSelect),
          field('Densidad aparente kg/m³', textInput(String(state.bulk), (value) => { state.bulk = num(value) || 0; state.bulkName = 'otro'; render(); }))),
        el('table', { class: 'props-table' },
          row('Volumen de producto', `${fmt(upTo / 1e6, 3)} L`, ''),
          row('Producto contenido', `${fmt(kg, 3)} kg`, mass > 0 ? `Total con la estructura: ${fmt(kg + mass, 3)} kg` : '')),
        button('Recalcular', () => { state.capacity = null; render(); }));
    }

    body.replaceChildren(
      el('h3', { text: model.title ?? 'Propiedades físicas' }),
      items.length > 1 ? field('Medir', targetSelect) : el('span'),
      ...(materialRow ? [materialRow] : []), table, ...frameBlock, ...capBlock, ...(state.error ? [el('p',{class:'alert',text:state.error})] : []),
      el('p', { class: 'muted', text: 'Propiedades calculadas sobre la malla; su precisión depende de la teselación. En un conjunto, las piezas que se superponen se suman dos veces (revisá las interferencias).' }),
      el('div', { class: 'row-wrap' }, button('Cerrar', close)));
  };
  render();
  document.body.append(overlay);
}
