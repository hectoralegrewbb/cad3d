import { validateSketchPolyline } from './sketchEditing.js';
import { particleConfig } from './particleConfig.js';
import { createPart, featureDefaults, makeEntity, nextId } from './partModel.js';
import { defaultDrawing } from '../drawing/sheetPrimitives.js';

// Reducers puros sobre el estado de la pieza.
const mapFeature = (state, id, fn) => {
  let changed = false;
  const features = state.features.map((feature) => {
    if (feature.id !== id) return feature;
    const next = fn(feature);
    if (next !== feature) changed = true;
    return next;
  });
  return changed ? { ...state, features } : state;
};

// Metadatos organizativos: nunca modifican la geometría ni las restricciones.
const liveGroups = (groups, entities) => {
  const ids = new Set(entities.map(e => e.id));
  return groups.map(g => ({ ...g, entityIds: g.entityIds.filter(id => ids.has(id)) })).filter(g => g.entityIds.length);
};
const groupName = name => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('El nombre del grupo debe tener entre 1 y 80 caracteres');
  return name.trim();
};

export const commands = {
  updateSimulation: (state, config) => ({...state,simulation:particleConfig(config)}),
  newPart: (name) => createPart(name),

  rename: (state, name) => ({ ...state, meta: { ...state.meta, name } }),
  updateMeta: (state, patch) => ({ ...state, meta: { ...state.meta, ...patch } }),

  addFeature(state, type, patch = {}) {
    const { id, counters } = nextId(state, type);
    const feature = { id, type, name: '', ...featureDefaults[type](), ...patch };
    return { ...state, counters, features: [...state.features, feature] };
  },

  insertFeatureAfter(state, afterId, type, patch = {}) {
    const added = commands.addFeature(state, type, patch);
    const feature = added.features[added.features.length - 1];
    const rest = added.features.slice(0, -1);
    const index = rest.findIndex((item) => item.id === afterId);
    const features = index < 0 ? added.features : [...rest.slice(0, index + 1), feature, ...rest.slice(index + 1)];
    return { ...added, features };
  },

  updateFeature: (state, id, patch) => mapFeature(state, id, (feature) => ({ ...feature, ...patch })),

  // Suma `delta` ([x,y,z] mm) al desplazamiento de varias operaciones a la vez (un solo paso de historial).
  // Si `absolute`, lo fija en lugar de sumarlo.
  translateFeatures(state, ids, delta, absolute = false) {
    const wanted = new Set(ids);
    let changed = false;
    const features = state.features.map((feature) => {
      if (!wanted.has(feature.id) || !['extrude', 'revolve', 'gear', 'screw', 'pipe', 'mesh', 'frame', 'step', 'loft', 'sweep', 'sphere'].includes(feature.type)) return feature;
      const current = Array.isArray(feature.move) ? feature.move : [0, 0, 0];
      const move = [0, 1, 2].map((i) => Math.round(((absolute ? 0 : Number(current[i]) || 0) + (Number(delta[i]) || 0)) * 1e6) / 1e6);
      changed = true;
      return { ...feature, move };
    });
    return changed ? { ...state, features } : state;
  },

  removeFeature(state, id) {
    // Cierre transitivo: no dejar patrones, cañerías o extrusiones huérfanas.
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      state.features.forEach((feature) => {
        if (!removed.has(feature.id) && [feature.sketch, feature.source, feature.type==='pipe'?feature.from:null, feature.endSketch, feature.pathSketch].some((ref) => removed.has(ref))) {
          removed.add(feature.id); changed = true;
        }
      });
    }
    const features = state.features.filter((feature) => !removed.has(feature.id));
    return features.length === state.features.length ? state : { ...state, features };
  },

  moveFeature(state, id, delta) {
    const index = state.features.findIndex((feature) => feature.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.features.length) return state;
    const features = [...state.features];
    [features[index], features[target]] = [features[target], features[index]];
    const order = new Map(features.map((feature, i) => [feature.id, i]));
    if (features.some((feature, i) => [feature.sketch, feature.source, feature.type==='pipe'?feature.from:null, feature.endSketch, feature.pathSketch].some((ref) => ref && order.has(ref) && order.get(ref) >= i))) return state;
    return { ...state, features };
  },

  toggleSuppressed: (state, id) => mapFeature(state, id, (feature) => ({ ...feature, suppressed: !feature.suppressed })),

  // --- entidades de boceto ---
  addEntity(state, sketchId, entity) {
    const made = makeEntity(state, entity);
    const next = mapFeature({ ...state, counters: made.counters }, sketchId, (sketch) => ({ ...sketch, entities: [...sketch.entities, made.entity] }));
    return next;
  },

  // Varias entidades de una vez (una sola entrada en el historial): repeticiones en fila, círculo o elipse.
  addEntities(state, sketchId, entities, originalPatch = null, originalId = null) {
    let next = originalPatch && originalId ? commands.updateEntity(state, sketchId, originalId, originalPatch) : state;
    entities.forEach((entity) => (next = commands.addEntity(next, sketchId, entity)));
    return next;
  },

  // Repetición agrupada: conserva addEntities y aplica original/copias/grupo en una sola transacción.
  addEntityPattern(state, sketchId, entities, originalPatch, originalId, kind) {
    const sketch = state.features.find(f => f.id === sketchId && f.type === 'sketch');
    if (!sketch || !sketch.entities.some(e => e.id === originalId)) throw new Error('El boceto cambió; volvé a seleccionar el original');
    if (!['row', 'circle', 'ellipse'].includes(kind) || !Array.isArray(entities) || entities.length < 1 || entities.length > 63) throw new Error('Repetición inválida (2 a 64 elementos con el original)');
    if (sketch.entities.length + entities.length > 100000 || (sketch.entityGroups?.length ?? 0) >= 2000) throw new Error('Demasiadas entidades o grupos en el boceto');
    const copies = entities.map(entity => { if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw new Error('Copia inválida'); const { id, ...data } = entity; return data; });
    const next = commands.addEntities(state, sketchId, copies, originalPatch, originalId);
    const added = next.features.find(f => f.id === sketchId).entities.slice(-entities.length).map(e => e.id);
    const made = nextId(next, 'group');
    const name = { row: 'Repetición en fila', circle: 'Repetición circular', ellipse: 'Repetición elíptica' }[kind];
    return mapFeature({ ...next, counters: made.counters }, sketchId, f => ({ ...f,
      entityGroups: [...liveGroups((f.entityGroups ?? []).map(g => ({ ...g, entityIds: g.entityIds.filter(id => id !== originalId) })), f.entities), { id: made.id, name, kind, entityIds: [originalId, ...added] }],
    }));
  },

  renameEntityGroup(state, sketchId, groupId, name) {
    const value = groupName(name);
    return mapFeature(state, sketchId, f => {
      if (!(f.entityGroups ?? []).some(g => g.id === groupId)) throw new Error('El grupo ya no existe');
      return { ...f, entityGroups: f.entityGroups.map(g => g.id === groupId ? { ...g, name: value } : g) };
    });
  },

  ungroupEntities: (state, sketchId, groupId) => mapFeature(state, sketchId, f => ({ ...f, entityGroups: (f.entityGroups ?? []).filter(g => g.id !== groupId) })),

  updateEntity: (state, sketchId, entityId, patch) =>
    mapFeature(state, sketchId, (sketch) => ({
      ...sketch,
      entities: sketch.entities.map((entity) => (entity.id === entityId ? { ...entity, ...patch } : entity)),
    })),

  removeEntity: (state, sketchId, entityId) =>
    mapFeature(state, sketchId, sketch => {
      const entities = sketch.entities.filter(e => e.id !== entityId);
      return { ...sketch, entities, constraints: (sketch.constraints ?? []).filter(c => c.a !== entityId && c.b !== entityId), ...(sketch.entityGroups ? { entityGroups: liveGroups(sketch.entityGroups, entities) } : {}) };
    }),

  // Reemplazo atómico: un único paso de historial y ningún ID de restricción huérfano.
  replaceSketchEntities(state, sketchId, removeIds, entities) {
    const sketch = state.features.find(f => f.id === sketchId && f.type === 'sketch');
    if (!sketch || !Array.isArray(removeIds) || !removeIds.length || new Set(removeIds).size !== removeIds.length || removeIds.some(id => !sketch.entities.some(e => e.id === id))) throw new Error('El boceto cambió; volvé a seleccionar');
    if ((sketch.constraints ?? []).some(c => removeIds.includes(c.a) || removeIds.includes(c.b))) throw new Error('La figura tiene restricciones: retiralas antes de editar sus tramos');
    if (!Array.isArray(entities) || entities.length > 10000 || sketch.entities.length - removeIds.length + entities.length > 100000) throw new Error('Demasiados tramos');
    entities.forEach(validateSketchPolyline);
    let next = state;
    const added = entities.map(e => { const { id, ...data } = e; const made = makeEntity(next, data); next = { ...next, counters: made.counters }; return made.entity; });
    return mapFeature(next, sketchId, f => {
      const entities = [...f.entities.filter(e => !removeIds.includes(e.id)), ...added];
      if (!f.entityGroups) return { ...f, entities };
      // Reemplazos de un mismo grupo permanecen allí; una unión entre grupos queda independiente.
      const owner = f.entityGroups.find(g => removeIds.every(id => g.entityIds.includes(id)));
      const groups = f.entityGroups.map(g => ({ ...g, entityIds: [...g.entityIds.filter(id => !removeIds.includes(id)), ...(g === owner ? added.map(e => e.id) : [])] }));
      return { ...f, entities, entityGroups: liveGroups(groups, entities) };
    });
  },

  // --- plano (hoja, vistas, cotas) ---
  updateDrawing(state, patch) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const next = { ...base, ...patch };
    if (patch.sheet) next.sheet = { ...base.sheet, ...patch.sheet };
    if (patch.titleBlock) next.titleBlock = { ...base.titleBlock, ...patch.titleBlock };
    if (patch.autoOptions) next.autoOptions = { ...base.autoOptions, ...patch.autoOptions };
    return { ...state, drawing: next };
  },
  setView(state, viewId, patch) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    return { ...state, drawing: { ...base, views: base.views.map((view) => (view.id === viewId ? { ...view, ...patch } : view)) } };
  },
  toggleView(state, kind) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const exists = base.views.some((view) => view.kind === kind);
    const views = exists ? base.views.filter((view) => view.kind !== kind) : [...base.views, { id: kind, kind, rotation: 0, showHidden: false, showAxes: true }];
    return { ...state, drawing: { ...base, views } };
  },
  toggleSection(state) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const exists = base.views.some((view) => view.kind === 'section');
    const views = exists ? base.views.filter((view) => view.kind !== 'section') : [...base.views, { id: 'section', kind: 'section', plane: 'x', offset: 'auto', label: 'A', rotation: 0, showHidden: false, showAxes: true }];
    return { ...state, drawing: { ...base, views } };
  },
  addDim(state, dim) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    return { ...state, drawing: { ...base, dims: [...base.dims, { id: `dim_${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`, ...dim }] } };
  },
  updateDim(state, id, patch) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    return { ...state, drawing: { ...base, dims: base.dims.map((dim) => (dim.id === id ? { ...dim, ...patch } : dim)) } };
  },
  // Mueve una cota: la manual se actualiza; la automática guarda la posición por clave (sobrevive a regenerar el plano).
  moveDim(state, dim, patch) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    if (!dim.auto) return { ...state, drawing: { ...base, dims: base.dims.map((item) => (item.id === dim.id ? { ...item, ...patch } : item)) } };
    return { ...state, drawing: { ...base, dimOverrides: { ...(base.dimOverrides ?? {}), [dim.key]: { ...(base.dimOverrides?.[dim.key] ?? {}), ...patch } } } };
  },
  // Texto/prefijo/sufijo/Ø de una cota. Las automáticas lo guardan por clave (como la posición); un valor vacío borra el campo.
  setDimField(state, dim, patch) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const apply = (target) => {
      const next = { ...target, ...patch };
      Object.keys(patch).forEach((key) => {
        if (patch[key] === undefined || patch[key] === '' || (patch[key] === false && key !== 'diameter')) delete next[key];
      });
      return next;
    };
    if (!dim.auto) return { ...state, drawing: { ...base, dims: base.dims.map((item) => (item.id === dim.id ? apply(item) : item)) } };
    const overrides = base.dimOverrides ?? {};
    const next = apply(overrides[dim.key] ?? {});
    const { [dim.key]: _removed, ...rest } = overrides;
    return { ...state, drawing: { ...base, dimOverrides: Object.keys(next).length ? { ...rest, [dim.key]: next } : rest } };
  },
  // Mueve una vista del plano `delta` mm (papel) respecto de su posición actual; (0,0) la deja en su lugar automático.
  moveView(state, viewId, delta, absolute = false) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const current = base.viewOffsets?.[viewId] ?? [0, 0];
    const next = absolute ? delta : [current[0] + delta[0], current[1] + delta[1]];
    const rounded = next.map((value) => Math.round(value * 100) / 100);
    const viewOffsets = { ...(base.viewOffsets ?? {}) };
    if (rounded[0] === 0 && rounded[1] === 0) delete viewOffsets[viewId];
    else viewOffsets[viewId] = rounded;
    return { ...state, drawing: { ...base, viewOffsets } };
  },
  resetViewPositions(state) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    return { ...state, drawing: { ...base, viewOffsets: {} } };
  },
  // Vuelve las cotas a su lugar automático; los textos/prefijos/sufijos escritos se conservan.
  resetDimPositions(state) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    const keep = ['text', 'prefix', 'suffix', 'diameter'];
    const dimOverrides = {};
    Object.entries(base.dimOverrides ?? {}).forEach(([key, value]) => {
      const kept = Object.fromEntries(Object.entries(value).filter(([field]) => keep.includes(field)));
      if (Object.keys(kept).length) dimOverrides[key] = kept;
    });
    return { ...state, drawing: { ...base, dimOverrides } };
  },
  // Quita una cota manual; una automática se oculta (por clave) y se puede restaurar.
  removeDim(state, dim) {
    const base = { ...defaultDrawing(), ...(state.drawing ?? {}) };
    if (dim.auto) return { ...state, drawing: { ...base, hiddenAuto: [...new Set([...(base.hiddenAuto ?? []), dim.key])] } };
    return { ...state, drawing: { ...base, dims: base.dims.filter((item) => item.id !== dim.id) } };
  },
  restoreAutoDims: (state) => ({ ...state, drawing: { ...defaultDrawing(), ...(state.drawing ?? {}), hiddenAuto: [] } }),

  // --- parámetros ---
  setParam(state, name, value) {
    const exists = state.params.some((param) => param.name === name);
    const params = exists ? state.params.map((param) => (param.name === name ? { ...param, value } : param)) : [...state.params, { name, value }];
    return { ...state, params };
  },
  renameParam: (state, oldName, newName) => ({ ...state, params: state.params.map((param) => (param.name === oldName ? { ...param, name: newName } : param)) }),
  removeParam: (state, name) => ({ ...state, params: state.params.filter((param) => param.name !== name) }),
};
