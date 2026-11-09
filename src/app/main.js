import {alignedPlacement} from '../core/alignment.js';
import { particleConfig } from '../core/particleConfig.js';
import { solveAssemblyMates } from '../core/assemblyMates.js';
import { createWorkbench, downloadCsv } from '../ui/workbench.js';
import { geometryJob } from '../io/geometryClient.js';
import { threadZone } from '../kernel/threadGeometry.js';
import { planeFrame } from '../kernel/planes.js';
import { sketchReference } from '../core/sketchReference.js';
import { evaluate } from '../core/expression.js';
import { DocumentStore } from '../core/documentStore.js';
import { commands } from '../core/commands.js';
import { createPart, featureLabels } from '../core/partModel.js';
import { partColor } from '../core/partColor.js';
import { patternEntities } from '../core/patterns.js';
import { createKernelClient, isSuperseded } from '../kernel/kernelClient.js';
import { fromDrawingData } from '../drawing/drawingData.js';
import { BusyBar } from '../ui/busyBar.js';
import { Viewer } from '../viewer/viewer.js';
import { FeatureTree } from '../ui/featureTree.js';
import { ParamsPanel } from '../ui/paramsPanel.js';
import { PropertiesPanel } from '../ui/propertiesPanel.js';
import { SketchEditor } from '../ui/sketchEditor.js';
import { PlanoView } from '../ui/planoView.js';
import { PlanoPanel } from '../ui/planoPanel.js';
import { MotorPanel } from '../ui/motorPanel.js';
import { MovePanel } from '../ui/movePanel.js';
import { MoveTool } from '../ui/moveTool.js';
import { ParticlePanel } from '../ui/particlePanel.js';
import { ParticleRunner, meshHash } from '../particles/particleRunner.js';
import { materialPresets } from '../particles/sim.js';
import { screwFeatureSpecs } from '../kernel/screwGeometry.js';
import { ScenePanel } from '../ui/scenePanel.js';
import { bodyKey, evaluateActions } from '../core/actions.js';
import { sceneFields, sceneOf, sceneOps, simFeeders, simNozzles, simSensors } from '../core/scene.js';
import { openImportDialog } from '../ui/importDialog.js';
import { readCadFile } from '../io/cadImport.js';
import { parseStl } from '../io/stlReader.js';
import { openStlImportDialog } from '../ui/stlImportDialog.js';
import { defaultDrawing } from '../drawing/sheetPrimitives.js';
import { formatScale } from '../drawing/sheet.js';
import { primitivesToDxf } from '../drawing/dxfWriter.js';
import { assemblyViews } from '../drawing/assemblyDrawing.js';
import { assemblyTrain, geared, projectGears, stackOn } from '../kernel/assemblyBuilder.js';
import { engageMoves, findLinks, linkLabels, solveTrain, turnedPose } from '../core/kinematics.js';
import { gearFeatureSpecs } from '../kernel/gearGeometry.js';
import { addGearMate } from '../core/gearPair.js';
import { addSprocketPair } from '../core/sprocket.js';
import { laserEntitiesToDxf } from '../io/laserDxf.js';
import { loopsToLaserEntities } from '../core/laserOutline.js';
import * as projects from '../core/projectModel.js';
import { ProjectPanel } from '../ui/projectPanel.js';
import { AssemblyPanel } from '../ui/assemblyPanel.js';
import { templates } from '../data/templates.js';
import { libraryItems } from '../data/library/index.js';
import { openLibraryDialog } from '../ui/libraryDialog.js';
import { openPropertiesDialog } from '../ui/propertiesDialog.js';
import { materials as materialTable } from '../drawing/features3d.js';
import { cutList as frameCutList, frameSpec as frameSpecOf } from '../kernel/frameGeometry.js';
import { clearLocal, downloadBlob, loadLocal, parsePart, saveLocal, serializePart, localLoadError } from '../io/persistence.js';

const byId = (id) => document.getElementById(id);
let workbench = null;
let localSaveBlocked=false;
const statusEl = byId('status');
const setStatus = (text, error = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', error);
};

// El motor (OpenCascade) corre en un worker: acá solo se piden trabajos y se reciben datos (mallas, parámetros, planos).
const busyBar = new BusyBar({ root: byId('busy'), label: byId('busyLabel'), cancelButton: byId('busyCancel'), onCancel: () => cancelKernelWork() });
const kernel = createKernelClient({ createWorker: () => new Worker(new URL('../kernel/kernelWorker.js', import.meta.url), { type: 'module' }), onBusy: (jobs) => busyBar.update(jobs), onProgress: (info) => busyBar.progress(info) });
let kernelReady = false;
let lastBuild = null; // { hasShape, results, params, paramErrors, solids } de la última construcción
let selectedId = null;
let editingSketchId = null;
let pickingFeatureId = null;
let rebuildTimer = null;
let saveTimer = null;
let mode = '3d'; // '3d' | 'plano'
let scope = 'part'; // 'part' (pieza activa) | 'asm' (conjunto)
let project = projects.createProject(createPart('Pieza nueva'));
let lastAssembly = null;
let assemblyError = null;
let asmTimer = null;
const histories = {};
const projectJournal = new DocumentStore(project, {historyLimit:100});
let restoringJournal=false,journalTimer=null;
let planoResult = null;
let planoTool = 'select';
let planoSelected = null;

const store = new DocumentStore(createPart('Pieza nueva'));
const asmStore = new DocumentStore(commands.updateDrawing(createPart('Conjunto'), { views: assemblyViews }));
const viewer = new Viewer(byId('view3d'));
workbench = createWorkbench(viewer, {
  status: setStatus, recover: () => restartForMemory(), save: () => {if(localSaveBlocked&&!confirm('No se pudo leer el guardado anterior. ¿Reemplazarlo con el proyecto actual? Las revisiones existentes se conservan.'))return false;localSaveBlocked=false;return persistNow();}, restore: activateProject,
  stopTools: () => { stopParticles();closeMotorMove(); stopPick(); stopPreview(); viewer.cancelPlacement(); },
  clearance: (first,second) => { if(scope!=='asm')throw new Error('Pasá a Conjunto para medir separación mínima entre instancias');return kernel.request('measureBodies',{first,second}); },
  audit: id => geometryJob('audit',viewer.itemGeometry(id)),
  errors: () => scope==='asm'?(lastAssembly?.errors??[]):Object.entries(lastBuild?.results??{}).filter(([,r])=>r.status==='error').map(([id,r])=>({id,error:r.error})),
  selectError: error => {if(error.partId&&error.partId!==project.activePartId)activatePart(error.partId);else if(scope==='asm')setScope('part');select(error.id);},
  entity: hit => kernel.request('inspectEntity',hit),
  section: (itemId,axis,position,approximate) => approximate?geometryJob('section',{mesh:viewer.itemGeometry(itemId),axis,position}):kernel.request('sectionGeometry',{itemId,axis,position}),
  prepareAlignment: async (moving,target,options) => {
    if(scope!=='asm')throw new Error('Pasá a Conjunto para alinear instancias.');
    if(moving.itemId===target.itemId)throw new Error('Seleccioná dos instancias distintas.');
    const instance=project.instances.find(i=>i.id===moving.itemId);
    if(!instance||instance.fixed)throw new Error('Desfijá la instancia móvil antes de alinearla.');
    if((project.mates??[]).some(m=>m.a===instance.id||m.b===instance.id))throw new Error('Quitá las relaciones de esta instancia antes de colocarla manualmente.');
    if(getScene().actions.some(a=>a.targets?.includes(instance.id)))throw new Error('Quitá las acciones de movimiento de la instancia antes de alinearla.');
    stopParticles();stopPreview();
    const signature=JSON.stringify(projectSnapshot());
    const first=await kernel.request('inspectEntity',moving),second=await kernel.request('inspectEntity',target);
    if(signature!==JSON.stringify(projectSnapshot()))throw new Error('El proyecto cambió. Repetí la selección.');
    return {id:instance.id,transform:alignedPlacement(instance,first,second,options),signature};
  },
  applyAlignment: pending => {
    if(scope!=='asm'||pending.signature!==JSON.stringify(projectSnapshot()))throw new Error('La vista previa quedó desactualizada. Repetí la selección.');
    project=projects.updateInstance(project,pending.id,pending.transform);afterProjectChange();
  },
  bom: async () => {
    syncActive(); await rebuildAssembly();
    if (!lastAssembly?.bom.length) throw new Error('Agregá instancias al conjunto para exportar su lista de materiales.');
    downloadCsv(`${safeName(project.name,'proyecto')}-BOM.csv`, [['Posición','Cantidad','Pieza','Material','Masa unitaria kg'],...lastAssembly.bom.map(r=>[r.item,r.qty,r.name,r.material,r.unitMass])]);
  },
  cutList: () => {
    const rows=store.state.features.filter(f=>f.type==='frame'&&!f.suppressed).flatMap(f=>frameCutList(frameSpecOf(f,lastBuild?.params??{})).rows);
    if(!rows.length) throw new Error('Agregá una estructura de perfiles para obtener la lista de corte.');
    downloadCsv(`${safeName(store.state.meta.name,'pieza')}-cortes.csv`,[['N°','Elemento','Perfil','Largo eje mm','Largo corte mm','Ángulo A','Ángulo B','Masa kg'],...rows.map(r=>[r.n,r.label,r.profile,r.axisLength,r.cutLength,r.angleA,r.angleB,r.weight])]);
  },
});

// Operaciones que agregan material (las que pueden girar solas): extrusión/revolución en modo agregar y engranajes.
const motorFeatures = () => store.state.features.filter((feature) => !feature.suppressed && ((feature.type === 'extrude' || feature.type === 'revolve') ? (feature.mode ?? 'add') !== 'cut' : (feature.type === 'gear' || feature.type === 'screw' || feature.type === 'pipe' || feature.type === 'mesh' || feature.type === 'frame' || ['step','loft','sweep'].includes(feature.type))));
let motorSplit = []; // ids de operaciones que giran; el resto de la pieza queda quieto
// Físicas dentro de una pieza: cada operación Engranaje es un cuerpo (hace falta más de una).
const partGearFeatures = () => store.state.features.filter((feature) => feature.type === 'gear' && !feature.suppressed);
const partGears = () => gearFeatureSpecs(store.state, lastBuild?.params ?? {}).map((spec) => ({ ...spec, instance: spec.id }));
const physicsInPart = () => scope === 'part' && motorPanel.config.physics && partGears().length >= 2;
const driverOf = (selected) => {
  if (scope === 'part') return selected.find((id) => partGears().some((gear) => gear.id === id)) ?? partGears()[0]?.id ?? null;
  const withGears = geared(project);
  return selected.find((id) => withGears.includes(id)) ?? withGears[0] ?? null;
};
function syncTeeth(selected) {
  const driver = driverOf(selected);
  if (!driver) return 0;
  if (scope === 'part') {
    const gears = partGears();
    const result = solveTrain(gears, driver, { links: findLinks(gears) });
    let changed = 0;
    Object.values(result.bodies).forEach((body) => {
      if (body.id === driver || Math.abs(body.phase) < 1e-9) return;
      const feature = store.state.features.find((item) => item.id === body.id);
      const current = Number(feature?.phase) || 0;
      const next = Math.round((current + (body.phase * 180) / Math.PI) * 1e4) / 1e4;
      apply((state) => commands.updateFeature(state, body.id, { phase: next }));
      changed += 1;
    });
    return changed;
  }
  const result = assemblyTrain(project, driver);
  let changed = 0;
  Object.values(result.bodies).forEach((body) => {
    if (body.id === driver || Math.abs(body.phase) < 1e-9) return;
    const instance = project.instances.find((item) => item.id === body.id);
    if (!instance) return;
    project = projects.updateInstance(project, body.id, turnedPose(instance, body));
    changed += 1;
  });
  afterProjectChange();
  return changed;
}
const motorPanel = new MotorPanel(byId('motorPanel'), viewer, {
  getOptions: () => {
    if (scope === 'asm') return { options: (viewer.items ?? []).map((item) => ({ id: item.id, label: item.name })), hint: '' };
    const part = store.state;
    const base = physicsInPart() ? partGearFeatures() : motorFeatures();
    const options = base.map((feature) => {
      const sketch = part.features.find((item) => item.id === feature.sketch);
      const label = tree.label(feature, part.features.indexOf(feature), part);
      return { id: feature.id, label: sketch ? `${label} (${tree.label(sketch, part.features.indexOf(sketch), part)})` : label };
    });
    return { options, hint: physicsInPart() ? 'El motor va en el engranaje tildado; los demás giran por engrane.' : 'Gira lo que sale de las operaciones tildadas; lo demás queda fijo.' };
  },
  getTargets: (selected) => {
    if (scope === 'asm') return selected.length ? selected : (viewer.items ?? []).map((item) => item.id);
    return selected.length && (viewer.items ?? []).some((item) => item.id === 'moving') ? ['moving'] : ['part'];
  },
  // Físicas del conjunto: motor en una instancia con engranajes; las demás giran por engrane.
  physicsAvailable: () => (scope === 'asm' ? geared(project).length > 0 : partGears().length >= 2),
  onPhysics: () => {
    if (scope === 'part') rebuild();
  },
  getTrain: (selected) => {
    if (scope === 'part') {
      if (!physicsInPart()) return null;
      const gears = partGears();
      const names = Object.fromEntries(partGearFeatures().map((feature) => [feature.id, tree.label(feature, store.state.features.indexOf(feature), store.state)]));
      const links = findLinks(gears);
      const result = solveTrain(gears, driverOf(selected), { links });
      return {
        error: result.error,
        conflicts: result.conflicts.map((conflict) => `${names[conflict.instance] ?? conflict.instance}: ${conflict.reason}`),
        links: links.map((link) => ({ status: link.status, text: `${names[link.a] ?? link.a} ↔ ${names[link.b] ?? link.b}: ${linkLabels[link.status]}${link.status === 'overlap' || link.status === 'apart' ? ` (centros ${link.distance.toFixed(2)} mm, ideal ${link.expected.toFixed(2)})` : ''}` })),
        bodies: Object.values(result.bodies).map((body) => ({ itemIds: [body.id], axis: body.axis, pivot: body.pivot, ratio: body.ratio, phase: body.phase })),
      };
    }
    if (scope !== 'asm') return null;
    const names = Object.fromEntries((viewer.items ?? []).map((item) => [item.id, item.name]));
    const withGears = geared(project);
    const driver = selected.find((id) => withGears.includes(id)) ?? withGears[0];
    if (!driver) return { error: 'Ninguna instancia tiene engranajes (operación Engranaje)', bodies: [], links: [], conflicts: [] };
    const result = assemblyTrain(project, driver);
    const links = result.links.map((link) => ({
      status: link.status,
      text: `${names[link.a] ?? link.a} ↔ ${names[link.b] ?? link.b}: ${linkLabels[link.status]}${link.status === 'overlap' || link.status === 'apart' ? ` (centros ${link.distance.toFixed(2)} mm, ideal ${link.expected.toFixed(2)})` : ''}`,
    }));
    const bodies = Object.values(result.bodies).map((body) => ({ itemIds: [body.id], axis: body.axis, pivot: body.pivot, ratio: body.ratio, phase: body.phase }));
    return { error: result.error, conflicts: result.conflicts.map((conflict) => `${names[conflict.instance] ?? conflict.instance}: ${conflict.reason}`), links, bodies };
  },
  // Gira cada instancia engranada lo justo para que sus dientes se intercalen (no cambia distancias entre centros).
  onSyncTeeth: (selected) => syncTeeth(selected),
  // Lleva los pares separados/pisados a la distancia de engrane y después intercala los dientes.
  onEngage: (selected) => {
    const driver = driverOf(selected);
    if (!driver) return 0;
    if (scope === 'part') {
      const gears = partGears();
      const moves = engageMoves(gears, findLinks(gears), driver);
      moves.forEach(({ instance, delta }) => apply((state) => commands.translateFeatures(state, [instance], delta)));
      return moves.length + syncTeeth(selected);
    }
    const gears = projectGears(project);
    const moves = engageMoves(gears, findLinks(gears), driver);
    moves.forEach(({ instance, delta }) => {
      const current = project.instances.find((item) => item.id === instance);
      if (current) project = projects.updateInstance(project, instance, { pos: current.pos.map((value, i) => Math.round((value + delta[i]) * 1000) / 1000) });
    });
    return moves.length + syncTeeth(selected);
  },
  onSelect: (ids) => {
    if (scope !== 'part') return;
    motorSplit = ids;
    rebuild();
  },
  onClose: () => {
    if (motorSplit.length || partGears().length >= 2) {
      motorSplit = [];
      if (scope === 'part') rebuild();
    }
  },
});
const styleModes = [['solid', '◐ Sólido'], ['wire', '▦ Malla'], ['edges', '▱ Aristas']];
let styleIndex = 0;
try {
  styleIndex = Math.max(0, styleModes.findIndex(([key]) => key === localStorage.getItem('elcad3d.style')));
} catch {
  /* sin almacenamiento */
}
const applyStyle = () => {
  viewer.setRenderMode(styleModes[styleIndex][0]);
  byId('styleBtn').textContent = styleModes[styleIndex][1];
  byId('styleBtn').classList.toggle('active', styleIndex > 0);
  try {
    localStorage.setItem('elcad3d.style', styleModes[styleIndex][0]);
  } catch {
    /* sin almacenamiento */
  }
};
byId('styleBtn').addEventListener('click', () => {
  styleIndex = (styleIndex + 1) % styleModes.length;
  applyStyle();
});
viewer.renderMode = styleModes[styleIndex][0];
byId('styleBtn').textContent = styleModes[styleIndex][1];
byId('styleBtn').classList.toggle('active', styleIndex > 0);
const movableFeatures = () => store.state.features.filter((feature) => !feature.suppressed && ['extrude', 'revolve', 'gear', 'screw', 'pipe', 'mesh', 'frame', 'step', 'loft', 'sweep'].includes(feature.type));
const instanceLabel = (instance, index) => `${project.parts.find((item) => item.id === instance.partId)?.part.meta.name ?? 'Pieza'} #${index + 1}`;
const fmt = (value) => String(Math.round(value * 100) / 100).replace('.', ',');
// Empuja instancias del conjunto; con `stopOnHit` se frena al chocar con otra pieza (ver safeTravel).
async function pushInstances(ids, delta, stopOnHit) {
  if (!lastAssembly) await rebuildAssembly();
  let t = 1;
  let blockedBy = null;
  if (stopOnHit && lastAssembly) ({ t, blockedBy } = await kernel.request('safeTravel', { ids, delta }));
  const applied = delta.map((value) => Math.round(value * t * 1000) / 1000);
  ids.forEach((id) => {
    const instance = project.instances.find((item) => item.id === id);
    if (instance) project = projects.updateInstance(project, id, { pos: instance.pos.map((value, i) => Math.round((value + applied[i]) * 1000) / 1000) });
  });
  afterProjectChange();
  const asked = Math.hypot(...delta);
  if (!blockedBy) return `Movido ${fmt(asked)} mm.`;
  const name = instanceLabel(project.instances.find((item) => item.id === blockedBy), project.instances.findIndex((item) => item.id === blockedBy));
  return `⚠ Se frenó a ${fmt(asked * t)} de ${fmt(asked)} mm: choca con ${name}.`;
}
const movePanel = new MovePanel(byId('movePanel'), {
  getOptions: () => {
    if (scope === 'asm') return project.instances.map((instance, index) => ({ id: instance.id, move: instance.pos, label: instanceLabel(instance, index) }));
    const part = store.state;
    return movableFeatures().map((feature) => {
      const sketch = part.features.find((item) => item.id === feature.sketch);
      const label = tree.label(feature, part.features.indexOf(feature), part);
      return { id: feature.id, move: feature.move, label: sketch ? `${label} (${tree.label(sketch, part.features.indexOf(sketch), part)})` : label };
    });
  },
  getInfo: () => (scope === 'asm'
    ? { collision: true, heading: '↔ Mover piezas del conjunto', title: 'Qué se mueve (podés tildar varias)', valueLabel: 'Posición', empty: 'No hay piezas en el conjunto.', help: 'Empuja las instancias sobre el eje elegido y se frena al tocar otra pieza (se ignoran los choques que ya existían). Para que dos engranajes giren juntos: llevalos a distancia de centros (z1+z2)·m/2 y usá ⚙ Motor.' }
    : {}),
  getSelectedId: () => {
    if (scope === 'asm') return null;
    const feature = selectedFeature();
    if (!feature) return null;
    if (feature.type === 'sketch') return movableFeatures().find((item) => item.sketch === feature.id)?.id ?? null;
    return movableFeatures().some((item) => item.id === feature.id) ? feature.id : null;
  },
  onMove: (ids, delta, absolute, { stopOnHit = false } = {}) => {
    if (scope === 'asm') return pushInstances(ids, delta, stopOnHit);
    apply((state) => commands.translateFeatures(state, ids, delta, absolute));
    return '';
  },
  // elegir y arrastrar en el visor: en Pieza hace falta un cuerpo por operación (se separan al abrir el panel)
  onActiveChange: () => { refreshSplit(); moveTool.refresh(); },
  onPickChange: () => { refreshSplit(); moveTool.refresh(); },
  onSelectionChange: () => moveTool.refresh(),
});

function refreshSplit() {
  if (scope !== 'part' || !lastBuild?.hasShape) return;
  if (canResplit()) resplit(); else rebuild();
}

// Operaciones solo malla: su cuerpo en el visor es «meshonly», «meshonly1»…
const meshOnlyFeatures = () => movableFeatures().filter((feature) => feature.meshOnly && feature.mesh);
const meshOnlyItemId = (index) => (index === 0 ? 'meshonly' : `meshonly${index}`);
const moveTool = new MoveTool(viewer, {
  isActive: () => movePanel.open && movePanel.config.pick && mode === '3d',
  getSelected: () => movePanel.config.selected,
  setSelected: (ids) => movePanel.setSelected(ids),
  getMode: () => movePanel.config.axis,
  itemIdsOf: (id) => {
    if (scope === 'asm') return [id];
    const index = meshOnlyFeatures().findIndex((feature) => feature.id === id);
    return index >= 0 ? [meshOnlyItemId(index)] : [`grp:${id}`];
  },
  optionOf: (itemId) => {
    let optionId = null;
    if (scope === 'asm') optionId = itemId;
    else if (itemId.startsWith('grp:')) optionId = itemId.slice(4);
    else if (itemId.startsWith('meshonly')) optionId = meshOnlyFeatures().find((_, index) => meshOnlyItemId(index) === itemId)?.id ?? null;
    const option = optionId ? movePanel.hooks.getOptions().find((item) => item.id === optionId) : null;
    return option ? { id: option.id, label: option.label } : null;
  },
  onCommit: async (ids, delta) => {
    const message = await movePanel.hooks.onMove(ids, delta, false, { stopOnHit: movePanel.config.stopOnHit });
    movePanel.message = message ?? '';
    movePanel.render();
  },
});
const syncPanelButtons = () => {
  byId('motorBtn').classList.toggle('active', motorPanel.open);
  byId('moveBtn').classList.toggle('active', movePanel.open);
  byId('particleBtn').classList.toggle('active', particlePanel.open);
  byId('sceneBtn').classList.toggle('active', scenePanel.open);
};
byId('motorBtn').addEventListener('click', () => {
  closeScenePanels();
  if (!motorPanel.open && movePanel.open) movePanel.close();
  motorPanel.toggle();
  syncPanelButtons();
  if (scope === 'part' && motorPanel.open && physicsInPart()) rebuild(); // un cuerpo por engranaje
});
byId('moveBtn').addEventListener('click', () => {
  closeScenePanels();
  if (motorPanel.open) motorPanel.toggle();
  movePanel.toggle();
  syncPanelButtons();
});

// ── Escena: acciones (girar/deslizar/aire) + boquillas, y partículas ──
// La escena vive en la pieza (state.actions / state.nozzles) o, en el conjunto, en el proyecto.
let sceneGroups = []; // [{ key, targets }]: grupos que se mueven; en Pieza se separan del resto de la malla
let sceneBusy = false; // true mientras la propia escena reconstruye la pieza (no debe frenar la simulación)
let preview = null;
let particleStaticIds = [];
let lastModelState = null;
const screwSpecs = () => screwFeatureSpecs(store.state, lastBuild?.params ?? {});
const sceneDoc = () => (scope === 'asm' ? project : store.state);
const getScene = () => sceneOf(sceneDoc());
const sceneTargets = () => {
  if (scope === 'asm') return project.instances.map((instance, index) => ({ id: instance.id, label: instanceLabel(instance, index) }));
  const part = store.state;
  return movableFeatures().map((feature) => {
    const sketch = part.features.find((item) => item.id === feature.sketch);
    const label = tree.label(feature, part.features.indexOf(feature), part);
    return { id: feature.id, label: sketch ? `${label} (${tree.label(sketch, part.features.indexOf(sketch), part)})` : label };
  });
};
const groupsOf = (scene) => {
  const seen = new Map();
  scene.actions.forEach((action) => {
    if (action.kind === 'air' || !action.targets?.length) return;
    const key = bodyKey(action.targets);
    if (!seen.has(key)) seen.set(key, { key, targets: [...action.targets] });
  });
  return [...seen.values()];
};
const itemIdsOfKey = (key) => (scope === 'asm' ? sceneGroups.find((group) => group.key === key)?.targets ?? [] : [`grp:${key}`]);
const sceneStaticIds = () => viewer.items.map((item) => item.id).filter((id) => !sceneGroups.some((group) => itemIdsOfKey(group.key).includes(id)));

function setScene(reducer) {
  if (scope === 'asm') {
    const next = reducer(getScene());
    project = { ...project, ...sceneFields(next) };
    scheduleSave();
  } else {
    store.apply((state) => {
      const next = reducer(sceneOf(state));
      return { ...state, ...sceneFields(next) };
    }); // la suscripción del store refresca la escena
    return;
  }
  afterSceneChange();
}

function afterSceneChange() {
  const scene = getScene();
  syncSceneGroups();
  if (sceneUsed()) {
    viewer.showNozzles(simNozzles(scene));
    viewer.showSensors(scene.sensors);
  }
  if (particleRunner.active) particleRunner.setScene({ actions: scene.actions, nozzles: simNozzles(scene), sensors: simSensors(scene), feeders: simFeeders(scene) });
  scenePanel.sync();
  particlePanel.sync();
}

const sceneUsed = () => scenePanel.open || particlePanel.open;

// Separa en la malla lo que se mueve (solo Pieza; en Conjunto cada instancia ya es un elemento) mientras haya paneles abiertos.
async function syncSceneGroups() {
  const desired = sceneUsed() ? groupsOf(getScene()) : [];
  const signature = (list) => list.map((group) => group.key).join('|');
  if (signature(desired) === signature(sceneGroups)) return;
  sceneGroups = desired;
  if (scope !== 'part') return;
  // Si el modelo no cambió, solo se re-separan los cuerpos con la última construcción (sin recalcular toda la pieza).
  if (canResplit()) await resplit();
  else await rebuild();
}

const canResplit = () => lastBuild?.hasShape && lastMeshReady && lastBuiltPart && lastBuiltPart.features === store.state.features && lastBuiltPart.params === store.state.params && !pickingFeatureId;

// Cómo separar la pieza en cuerpos: lo que se mueve (acciones), lo que gira (motor) o un cuerpo por engranaje (físicas). Solo datos: separa el motor.
function splitSpec(part) {
  const color = partColor(part);
  if (scope === 'part' && movePanel.open && movePanel.config.pick) {
    const groups = movableFeatures().filter((feature) => !feature.meshOnly).map((feature) => ({ key: feature.id, targets: [feature.id] }));
    if (groups.length) return { kind: 'groups', color, groups };
  }
  if (sceneGroups.length && !motorPanel.open) return { kind: 'groups', color, groups: sceneGroups.map((group) => ({ key: group.key, targets: group.targets })) };
  if (motorPanel.open && physicsInPart()) return { kind: 'physics', color, gears: partGearFeatures().map((feature) => ({ id: feature.id, name: tree.label(feature, part.features.indexOf(feature), part) })) };
  const chosen = motorSplit.filter((id) => motorFeatures().some((feature) => feature.id === id));
  if (!chosen.length || chosen.length === motorFeatures().length) return { kind: 'none', color };
  return { kind: 'motor', color, chosen };
}

async function resplit() {
  if (!sceneBusy && particleRunner.active) { stopParticles(); particlePanel.stats=null;particlePanel.message='El modelo cambió. Iniciá una nueva corrida para actualizar resultados.'; }
  const started = performance.now();
  const seq = ++viewSeq;
  let result;
  try {
    result = await kernel.request('resplit', { split: splitSpec(store.state) }, { channel: 'split', latestOnly: true });
  } catch (error) {
    setStatus(`Error del kernel: ${error.message}. Usá Herramientas → Recuperar motor.`, true);
    return;
  }
  if (isSuperseded(result) || seq !== viewSeq) return;
  viewer.setMeshes(result.items);
  result.notes.forEach((note) => setStatus(note.text, note.error));
  refreshPlaneOverlay();
  lastRebuildMs = performance.now() - started;
  renderPanels();
}

// Centro de la caja envolvente de lo elegido (pivote sugerido); lo calcula el motor.
const centerOf = (ids) => kernel.request('centerOf', { scope, ids, part: scope === 'part' ? store.state : null });

// Pose de cada grupo (y niveles de aire) sobre el visor.
function applyPoses(poses, nozzleLevels) {
  poses.forEach((pose) => viewer.setBodyPose(itemIdsOfKey(pose.key), pose));
  viewer.setNozzleLevels(nozzleLevels ?? {});
  viewer.render();
}

function playPreview() {
  if (particleRunner.active || preview) return;
  syncSceneGroups();
  const started = performance.now();
  preview = { frame: 0 };
  const loop = (now) => {
    const t = (now - started) / 1000;
    const result = evaluateActions(getScene().actions, t, { exitTime: () => null });
    applyPoses(result.bodies, result.nozzles);
    scenePanel.setClock(t);
    preview.frame = requestAnimationFrame(loop);
  };
  preview.frame = requestAnimationFrame(loop);
  scenePanel.sync();
}

function stopPreview() {
  if (!preview) return;
  cancelAnimationFrame(preview.frame);
  preview = null;
  viewer.clearBodyAngle();
  viewer.setNozzleLevels({});
  scenePanel.setClock(0);
  scenePanel.sync();
}

const scenePanel = new ScenePanel(byId('scenePanel'), {
  getScene,
  setScene,
  getTargets: sceneTargets,
  pivotFor: centerOf,
  isPlaying: () => !!preview,
  onPlay: playPreview,
  onStop: () => {
    stopPreview();
    closeSceneIfIdle();
  },
  pickPoint: (done) => {
    setStatus('Hacé clic sobre el modelo (Esc cancela)');
    viewer.startPlacement((hit) => {
      setStatus('Listo');
      done(hit);
    });
  },
  cancelPick: () => viewer.cancelPlacement(),
  sensorDefaults: () => {
    const bounds = viewer.bounds;
    if (!bounds) return {};
    const center = bounds.min.map((v, k) => v + bounds.size[k] / 2);
    return { center, size: bounds.size.map((v) => Math.max(10, v / 2)) };
  },
  feederDefaults: () => {
    const bounds = viewer.bounds;
    if (!bounds) return {};
    const top = bounds.max[2];
    return { pos: [bounds.min[0] + bounds.size[0] * 0.1, bounds.min[1] + bounds.size[1] / 2, top + 60], size: [Math.max(40, Math.min(200, bounds.size[0] / 6)), Math.max(30, Math.min(150, bounds.size[1] / 3)), 80] };
  },
  nozzleDefaults: () => {
    const bounds = viewer.bounds;
    if (!bounds) return {};
    const center = bounds.min.map((v, k) => v + bounds.size[k] / 2);
    return { pos: [bounds.min[0] - 30, center[1], center[2]], dir: [1, 0, 0] };
  },
});

function closeSceneIfIdle() {
  if (sceneUsed()) return;
  viewer.clearNozzles();
  if (sceneGroups.length) {
    sceneGroups = [];
    if (scope === 'part') rebuild();
  }
}

byId('sceneBtn').addEventListener('click', () => {
  closeMotorMove();
  scenePanel.toggle();
  if (scenePanel.open) afterSceneChange();
  else closeSceneIfIdle();
  syncPanelButtons();
});

function closeMotorMove() {
  if (motorPanel.open) motorPanel.toggle();
  movePanel.close();
}

let fillPreparation=null;
let particleStartSeq=0;
const particleRunner = new ParticleRunner({
  onError: error => {stopParticles();particlePanel.setState('idle',`La simulación se detuvo: ${error.message??'error de cálculo'}. Revisá los parámetros y reiniciá.`);setStatus(particlePanel.message,true);},
  onProgress: (info) => particlePanel.setProgress(`Preparando colisiones ${info.done + 1}/${info.total}${info.name ? ` · ${info.name}` : ''}…`),
  onFrame: (frame) => {
    viewer.setParticles(frame.pos);
    viewer.updateHopperFill(frame.fill);
    applyPoses(frame.poses, frame.nozzleLevels);
    scenePanel.setClock(frame.time);
    scenePanel.setSensorCounts(frame.sensorCounts);
    viewer.setSensorCounts(frame.sensorCounts);
    if (frame.tracers) viewer.setTracers(frame.tracers);
    viewer.setProducts(frame.products);
    if (frame.slice) viewer.setAirSlice(frame.slice, frame.sliceMode);
    particlePanel.setStats(frame);
  },
});

const defaultEmitter = () => {
  const bounds = viewer.bounds;
  const spec = scope === 'part' ? screwSpecs()[0] : null;
  const top = bounds ? bounds.max[2] : 50;
  if (spec) {
    // Dentro de la camisa, justo sobre el eje: así carga también cuando el tornillo está encerrado (sin camisa cae por los costados).
    const along = spec.axis.map((value, i) => spec.pivot[i] + value * spec.length * 0.2);
    const inside = Math.min(top - 2, spec.pivot[2] + spec.outer * 0.3);
    return { center: [along[0], along[1], inside], size: [Math.min(20, spec.outer * 0.4), Math.min(20, spec.outer * 0.3), 5] };
  }
  const center = bounds ? bounds.min.map((v, k) => v + bounds.size[k] / 2) : [0, 0, 0];
  return { center: [center[0], center[1], top + 10], size: [20, 20, 6] };
};

const particlePanel = new ParticlePanel(byId('particlePanel'), {
  getConfig: () => sceneDoc().simulation,
  getContext: () => `${scope}:${project.activePartId}`,
  onConfigChange: config => {
    const validated=particleConfig(config);
    if(scope==='asm')project={...project,simulation:validated};
    else store.apply(state=>commands.updateSimulation(state,validated));
    scheduleJournal();scheduleSave();return sceneDoc().simulation;
  },
  getInfo: () => ({ actions: getScene().actions.length, nozzles: getScene().nozzles.length, feeders: (getScene().feeders ?? []).length, sensors: (getScene().sensors ?? []).map((sensor) => ({ id: sensor.id, name: sensor.name })), hasScrew: scope === 'part' && screwSpecs().length > 0, targets: (viewer.items??[]).map(item=>({id:item.id,name:item.name||item.id})) }),
  onEmitter: (center, size) => viewer.showEmitter(center, size),
  onSlice: (request) => {
    particleRunner.setSlice(request);
    if (request.mode === 'ninguno') viewer.clearAirSlice();
  },
  onExportCsv: (text) => downloadBlob(new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' }), `${safeName(store.state.meta.name, 'pieza')}-corrida.csv`),
  pickPoint: (done) => {
    setStatus('Hacé clic sobre el modelo (Esc cancela)');
    viewer.startPlacement((hit) => {
      setStatus('Listo');
      done(hit);
    });
  },
  cancelPick: () => viewer.cancelPlacement(),
  onOpenScene: () => {
    if (!scenePanel.open) {
      closeMotorMove();
      scenePanel.toggle();
      afterSceneChange();
      syncPanelButtons();
    }
  },
  onSeeThrough: (on) => particleStaticIds.forEach((id) => viewer.setItemOpacity(id, on ? 0.22 : 1)),
  onLive: (patch) => {
    const metadata=particlePanel.recorder.metadata;if(metadata){if(metadata.changes.length<100)metadata.changes.push({time:particlePanel.stats?.time??0,patch:structuredClone(patch)});else metadata.changesTruncated=true;}
    const { emitter, ...rest } = patch;
    particleRunner.liveSettings(emitter ? { ...rest, emitter: { center: emitter.center, size: emitter.size } } : rest);
  },
  onPause: () => {
    particleRunner.pause();
    particlePanel.setState('paused');
  },
  onResume: () => {
    particleRunner.resume();
    particlePanel.setState('running');
  },
  onReset: () => particleRunner.reset(),
  onStop: () => stopParticles(),
  onFill: patch => particleRunner.liveSettings(patch),
  onStart: async (config) => {
    stopParticles();
    const startSeq=++particleStartSeq;
    stopPreview();
    particlePanel.setState('preparing');
    await new Promise((resolve) => setTimeout(resolve, 30)); // deja pintar el aviso
    try {
      config=particleConfig(config);
      // Sin acciones y con un tornillo: se crea su giro (editable en ⚡ Acciones).
      const screw = scope === 'part' ? screwSpecs()[0] : null;
      if (screw && getScene().actions.length === 0) {
        const made = sceneOps.addAction(getScene(), 'rotate', { name: 'Giro del tornillo', targets: [screw.id], axis: screw.axis, pivot: screw.pivot.map((v) => Math.round(v * 100) / 100), mode: 'continuous', rpm: -60 });
        setScene(() => made.scene);
      }
      sceneBusy = true;
      await syncSceneGroups();
      sceneBusy = false;
      const scene = getScene();
      const bodies = [];
      const ids = viewer.items.map((item) => item.id);
      const itemBounds = (id) => viewer.items.find((item) => item.id === id)?.bounds;
      const merged = (itemIds) => {
        const parts = itemIds.map((id) => viewer.itemGeometry(id)).filter(Boolean);
        let offset = 0;
        const vertices = new Float32Array(parts.reduce((sum, item) => sum + item.vertices.length, 0));
        const triangles = new Uint32Array(parts.reduce((sum, item) => sum + item.triangles.length, 0));
        let v = 0;
        let t = 0;
        parts.forEach((item) => {
          vertices.set(item.vertices, v);
          item.triangles.forEach((index, n) => (triangles[t + n] = index + offset));
          offset += item.vertices.length / 3;
          v += item.vertices.length;
          t += item.triangles.length;
        });
        return { vertices, triangles };
      };
      const pivotOf = (key) => scene.actions.find((action) => action.kind === 'rotate' && action.targets?.length && bodyKey(action.targets) === key)?.pivot ?? [0, 0, 0];
      const reachOf = (itemIds, pivot) => {
        let reach = 20;
        itemIds.forEach((id) => {
          const box = itemBounds(id);
          if (!box) return;
          const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n & 1 ? box.max[0] : box.min[0], n & 2 ? box.max[1] : box.min[1], n & 4 ? box.max[2] : box.min[2]]);
          corners.forEach((corner) => (reach = Math.max(reach, Math.hypot(corner[0] - pivot[0], corner[1] - pivot[1], corner[2] - pivot[2]))));
        });
        return reach;
      };
      sceneGroups.forEach((group) => {
        const itemIds = itemIdsOfKey(group.key).filter((id) => ids.includes(id));
        if (itemIds.length) bodies.push({ ...merged(itemIds), label: `grp:${group.key}`, key: group.key, movable: true, radiusMax: reachOf(itemIds, pivotOf(group.key)) });
      });
      particleStaticIds = sceneStaticIds();
      particleStaticIds.forEach((id) => {
        const geometry = viewer.itemGeometry(id);
        if (geometry) bodies.push({ ...geometry, label: id, movable: false });
      });
      if (bodies.length === 0) throw new Error('No hay geometría para colisionar');
      const preset = materialPresets[config.preset];
      let fill=null;
      if(config.initialFill.enabled){
        if(config.noGrains||config.airOnly)throw new Error('Desactivá Solo aire / Sin granos para cargar la tolva');
        if(preset.kind==='liquid')throw new Error('Elegí un material granular para el llenado de tolva');
        const target=config.initialFill.target;
        if(!target||!ids.includes(target))throw new Error('Elegí la pieza de la tolva en Carga inicial');
        if(sceneGroups.some(group=>itemIdsOfKey(group.key).includes(target)))throw new Error('El llenado inicial necesita una tolva fija; quitá sus acciones de movimiento');
        if(scope==='part'&&Object.values(lastBuild?.results??{}).some(r=>r.status==='error'))throw new Error('Corregí las operaciones con error antes de cargar material');
        if(scope==='asm'&&lastAssembly?.errors?.length)throw new Error('El conjunto tiene operaciones con error. Corregilas antes del llenado');
        const signature=JSON.stringify(projectSnapshot());
        fillPreparation=new AbortController();
        particlePanel.setProgress('Detectando la cavidad interior de la tolva…');
        fill=await geometryJob('hopper',viewer.itemGeometry(target),{signal:fillPreparation.signal});
        if(startSeq!==particleStartSeq)return;
        if(signature!==JSON.stringify(projectSnapshot()))throw new Error('El proyecto cambió durante la preparación. Volvé a iniciar');
        fillPreparation=null;
      }
      const floorZ = (viewer.bounds?.min[2] ?? 0) - 25;
      const radiusMm = config.initialFill.enabled ? config.initialFill.radius : config.radiusMm > 0 ? config.radiusMm : preset.radius;
      const settings = { ...preset, seed: config.seed ?? 1, radius: radiusMm, rate: config.airOnly || config.noGrains ? 0 : config.rate, airCells: { baja: 12000, media: 20000, alta: 40000 }[config.airQuality] ?? 20000, airModel: config.airModel, airSolverCells: { baja: 12000, media: 30000, alta: 90000 }[config.airQuality] ?? 30000, massFlow: config.massFlowKgH / 3600, cap: config.cap, wind: config.wind, emitter: config.emitter, floorZ, initialFill:config.initialFill };
      if(fill){settings.maxCap=config.initialFill.execution==='interactive'?8000:config.initialFill.budget;settings.cap=settings.maxCap;}
      viewer.initParticles(settings.maxCap ?? 8000, radiusMm, preset.color);
      viewer.showEmitter(fill?null:config.emitter.center, config.emitter.size);
      if(fill)viewer.showFillOutlet(config.initialFill);
      viewer.showNozzles(simNozzles(scene));
      viewer.showSensors(scene.sensors);
      particleStaticIds.forEach((id) => viewer.setItemOpacity(id, config.seeThrough ? 0.22 : 1));
      particlePanel.recorder.metadata={version:'0.3.0',createdAt:new Date().toISOString(),scope,settings:structuredClone(settings),geometry:bodies.map(b=>({label:b.label,hash:`${meshHash(b.vertices)}:${meshHash(b.triangles)}`})),changes:[]};
      const started=await particleRunner.start({ bodies, settings, fill, scene: { actions: scene.actions, nozzles: simNozzles(scene), sensors: simSensors(scene), feeders: simFeeders(scene) } });
      if(startSeq!==particleStartSeq)return;
      // Toda la carga está en las posiciones dinámicas; no hay nube de reservorio.
      particleRunner.setSlice(config.slice);
      particlePanel.setState('running');
    } catch (error) {
      if(startSeq!==particleStartSeq)return;
      sceneBusy = false;
      stopParticles();
      particlePanel.setState('idle', `⚠ ${error.message}`);
    }
  },
});

function stopParticles() {
  particleStartSeq++;fillPreparation?.abort();fillPreparation=null;
  const wasActive = particleRunner.active;
  particleRunner.stop();
  if (wasActive || viewer.points) {
    viewer.clearAirSlice(false);
    viewer.clearParticles();
    viewer.clearBodyAngle();
    particleStaticIds.forEach((id) => viewer.setItemOpacity(id, 1));
    viewer.showEmitter(null);
    viewer.render();
  }
  if (particlePanel.open && particlePanel.state !== 'idle') particlePanel.setState('idle');
  scenePanel.setClock(0);
}

function closeScenePanels() {
  viewer.cancelPlacement();
  stopPreview();
  if (scenePanel.open) scenePanel.close();
  closeParticles();
  closeSceneIfIdle();
  syncPanelButtons();
}

function closeParticles() {
  if (!particlePanel.open) return;
  particlePanel.close();
  closeSceneIfIdle();
  syncPanelButtons();
}

byId('particleBtn').addEventListener('click', () => {
  if (particlePanel.open) return closeParticles();
  closeMotorMove();
  particlePanel.toggle();
  if(!sceneDoc().simulation){particlePanel.config.emitter=defaultEmitter();particlePanel.render();}
  afterSceneChange();
  syncPanelButtons();
});

// Cualquier cambio del modelo (no solo de acciones) frena lo que esté corriendo y limpia referencias rotas.
function modelChanged(state) {
  const previous = lastModelState;
  lastModelState = state;
  if (!previous) return true;
  return Object.keys({ ...previous, ...state }).some((key) => key !== 'simulation' && key !== 'actions' && key !== 'nozzles' && key !== 'sensors' && key !== 'feeders' && previous[key] !== state[key]);
}

const apply = (reducer) => store.apply(reducer);
const selectedFeature = () => store.state.features.find((feature) => feature.id === selectedId) ?? null;

const tree = new FeatureTree(byId('tree'), {
  onSelect: (id) => select(id),
  onAdd: (type) => addFeature(type),
  onRemove: (id) => {
    const removed=commands.removeFeature(store.state,id);
    const count=store.state.features.length-removed.features.length;
    if(count>1&&!confirm(`Se eliminarán ${count} operaciones, incluidas las dependientes. ¿Continuar?`)) return;
    if (editingSketchId === id) closeSketch();
    if (selectedId === id) selectedId = null;
    apply((state) => commands.removeFeature(state, id));
  },
  onMove: (id, delta) => apply((state) => commands.moveFeature(state, id, delta)),
  onSuppress: (id) => apply((state) => commands.toggleSuppressed(state, id)),
  onEditSketch: (id) => openSketch(id),
});
const paramsPanel = new ParamsPanel(byId('paramsPanel'), {
  onSet: (name, value) => apply((state) => commands.setParam(state, name, value)),
  onRename: (oldName, newName) => apply((state) => commands.renameParam(state, oldName, newName)),
  onRemove: (name) => apply((state) => commands.removeParam(state, name)),
});
const props = new PropertiesPanel(byId('props'), {
  onUpdate: (id, patch) => apply((state) => commands.updateFeature(state, id, patch)),
  onRefresh: () => renderPanels(),
  onAddSprocketPair: (toothId, opts) => {
    try {
      let made = null;
      apply((state) => {
        made = addSprocketPair(state, toothId, lastBuild?.params ?? {}, opts);
        return made.state;
      });
      if (made) {
        selectedId = made.mateToothId;
        setStatus(`Par de ruedas de cadena: ${made.links} eslabones, distancia real ${made.center} mm (pedida ${made.requested} mm)`);
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onExportSprocketLaser: (toothId, format) => exportLaser(format),
  onAddGearMate: (gearId, opts) => {
    try {
      let made = null;
      apply((state) => {
        made = addGearMate(state, gearId, lastBuild?.params ?? {}, opts);
        return made.state;
      });
      if (made) {
        selectedId = made.mateId;
        setStatus(opts.kind === 'rack' ? 'Cremallera agregada y enlazada al giro del piñón' : 'Engranaje conjugado agregado y enlazado al giro del piñón');
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onUpdateEntity: (sketchId, entityId, patch) => apply((state) => commands.updateEntity(state, sketchId, entityId, patch)),
  onAddEntity: (sketchId, entity) => apply((state) => commands.addEntity(state, sketchId, entity)),
  onRemoveEntity: (sketchId, entityId) => apply((state) => commands.removeEntity(state, sketchId, entityId)),
  onPattern: (sketchId, entity, config) => {
    try {
      const { copies, original } = patternEntities(entity, config, lastBuild?.params ?? {});
      apply((state) => commands.addEntities(state, sketchId, copies, original && Object.keys(original).length ? original : null, entity.id));
      setStatus(`${copies.length} copia(s) creada(s)`);
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onEditSketch: (id) => openSketch(id),
  onTogglePick: (id) => togglePick(id),
});
const sketchEditor = new SketchEditor(byId('sketchCanvas'), {
  onAddEntity: (sketchId, entity) => apply((state) => commands.addEntity(state, sketchId, entity)),
  onUpdateEntity: (sketchId, entityId, patch) => apply((state) => commands.updateEntity(state, sketchId, entityId, patch)),
  onRemoveEntity: (sketchId, entityId) => apply((state) => commands.removeEntity(state, sketchId, entityId)),
  onSelectEntity: () => {},
  onCursor: (_point, info) => (byId('skHint').textContent = `${info.text} — rueda: zoom · Espacio+arrastrar: mover · Alt: sin imán · Supr: borrar`),
  onToolChange: () => syncSketchTools(),
  onOptionsChange: () => syncSketchTools(),
  onReferenceOptions: () => refreshSketchReference(),
  onClose: () => closeSketch(),
}, { inputHost: byId('skInput') });

// ---------- modo plano ----------
const docStore = () => (scope === 'asm' ? asmStore : store);
const applyDoc = (reducer) => docStore().apply(reducer);
const currentDrawing = () => ({ ...defaultDrawing(), ...(docStore().state.drawing ?? {}) });
const planoView = new PlanoView(byId('planoSvg'), {
  onSelectDim: (id) => { planoSelected = id; renderPlanoPanel(); },
  onAddDim: (dim) => applyDoc((state) => commands.addDim(state, dim)),
  onDeleteDim: (id) => deleteDimById(id),
  onMoveDim: (dim, patch) => applyDoc((state) => commands.moveDim(state, dim, patch)),
  onMoveView: (viewId, delta) => applyDoc((state) => commands.moveView(state, viewId, delta)),
  onToolChange: (tool) => setPlanoTool(tool),
});
const planoPanel = new PlanoPanel(byId('planoPanel'), {
  onTool: (tool) => setPlanoTool(tool),
  onDrawing: (patch) => applyDoc((state) => commands.updateDrawing(state, patch)),
  onMeta: (patch) => applyDoc((state) => commands.updateMeta(state, patch)),
  onView: (id, patch) => applyDoc((state) => commands.setView(state, id, patch)),
  onToggleView: (kind) => applyDoc((state) => commands.toggleView(state, kind)),
  onToggleSection: () => applyDoc((state) => commands.toggleSection(state)),
  onDimText: (dim, patch) => applyDoc((state) => commands.setDimField(state, dim, patch)),
  onDeleteDim: (dim) => deleteDimById(dim.id),
  onResetDimPositions: () => applyDoc((state) => commands.resetDimPositions(state)),
  onResetViewPositions: () => applyDoc((state) => commands.resetViewPositions(state)),
  onRestoreDims: () => applyDoc((state) => commands.restoreAutoDims(state)),
  onExport: (kind) => exportPlano(kind),
});

const selectedDimObject = () => planoResult?.dims.find((dim) => dim.id === planoSelected) ?? null;

function deleteDimById(id) {
  const dim = planoResult?.dims.find((item) => item.id === id);
  if (!dim) return;
  planoSelected = null;
  planoView.selectedDim = null;
  applyDoc((state) => commands.removeDim(state, dim));
}

function setPlanoTool(tool) {
  planoTool = tool;
  planoView.setTool(tool);
  byId('planoHint').textContent = planoView.hint();
  renderPlanoPanel();
}

function renderPlanoPanel() {
  if (mode !== 'plano') return;
  const drawing = currentDrawing();
  planoPanel.render(docStore().state, drawing, { selectedDim: selectedDimObject(), tool: planoTool, sheetScale: planoResult?.layout?.scale, hiddenCount: (drawing.hiddenAuto ?? []).length, movedCount: Object.keys(drawing.dimOverrides ?? {}).length, scope });
  byId('planoHint').textContent = planoView.hint();
}

const drawingLabel = () => `${currentDrawing().sheet.size} ${currentDrawing().sheet.orientation === 'portrait' ? 'vertical' : 'apaisada'}`;

let planoSeq = 0;
async function rebuildPlano() {
  if (mode !== 'plano') return;
  if (scope === 'part' && !lastBuild?.hasShape) return;
  const seq = ++planoSeq;
  try {
    let data;
    if (scope === 'asm') {
      if (!lastAssembly) await rebuildAssembly();
      data = await kernel.request('assemblyDrawing', { doc: asmStore.state }, { channel: 'plano', latestOnly: true });
    } else data = await kernel.request('drawing', { part: store.state }, { channel: 'plano', latestOnly: true });
    if (isSuperseded(data) || seq !== planoSeq || mode !== 'plano') return; // si ya volvió a 3D, el contenedor está oculto
    planoResult = fromDrawingData(data);
  } catch (error) {
    setStatus(`No se pudo generar el plano: ${error.message}`, true);
    return;
  }
  planoView.selectedDim = planoSelected;
  const first = !planoView.viewBox;
  planoView.setResult(planoResult);
  if (first) planoView.fit();
  renderPlanoPanel();
  const { layout, mass } = planoResult;
  setStatus(`Plano ${drawingLabel()} · escala ${formatScale(layout.scale)}${layout.overflow ? ' · NO ENTRA en la hoja' : ''}${mass > 0 ? ` · masa ${mass.toFixed(3)} kg` : ''}`, layout.overflow);
}

function applyLayout() {
  const plano = mode === 'plano';
  const partScope = scope === 'part';
  byId('planoLayer').hidden = !plano;
  byId('view3d').style.visibility = plano ? 'hidden' : 'visible';
  byId('planoPanel').hidden = !plano;
  byId('props').hidden = plano || !partScope;
  byId('asmPanel').hidden = plano || partScope;
  byId('tree').hidden = !partScope;
  byId('paramsPanel').hidden = !partScope;
  byId('viewButtons').hidden = plano;
  byId('styleBtn').parentElement.hidden = plano;
  byId('stlBtn').hidden = !partScope && plano;
  if (plano && motorPanel.open) motorPanel.toggle();
  if (plano) movePanel.close();
  syncPanelButtons();
  byId('moveBtn').hidden = plano;
  byId('particleBtn').hidden = plano;
  byId('sceneBtn').hidden = plano;
  if (plano) closeScenePanels();
  movePanel.sync();
  if (!sceneBusy) { particlePanel.sync(); scenePanel.sync(); }
  byId('mode3d').classList.toggle('active', !plano);
  byId('modePlano').classList.toggle('active', plano);
  byId('scopePart').classList.toggle('active', partScope);
  byId('scopeAsm').classList.toggle('active', !partScope);
}

function refresh() {
  applyLayout();
  if (mode === 'plano') {
    planoView.viewBox = null;
    planoSelected = null;
    rebuildPlano();
    return;
  }
  viewer.resize();
  if (scope === 'asm') {
    rebuildAssembly().then(() => showAssembly(true));
  } else {
    scheduleRebuild(true);
  }
  renderPanels();
}

function setMode(next) {
  if (next === mode) return;
  if (next === 'plano') {
    closeSketch();
    stopPick();
  }
  mode = next;
  refresh();
}

function setScope(next) {
  if (next === scope) return;
  viewer.restoreItems();
  closeScenePanels();
  closeSketch();
  stopPick();
  syncActive();
  scope = next;
  planoSelected = null;
  refresh();
}
byId('mode3d').addEventListener('click', () => setMode('3d'));
byId('modePlano').addEventListener('click', () => setMode('plano'));
byId('scopePart').addEventListener('click', () => setScope('part'));
byId('scopeAsm').addEventListener('click', () => setScope('asm'));

function exportPlano(kind) {
  if (!planoResult) return setStatus('No hay plano para exportar', true);
  const name = exportName();
  if (kind === 'svg') downloadBlob(new Blob([planoResult.svg()], { type: 'image/svg+xml' }), `${name}.svg`);
  else if (kind === 'dxf') downloadBlob(new Blob([primitivesToDxf(planoResult.sheet, planoResult.primitives)], { type: 'application/dxf' }), `${name}.dxf`);
  else {
    const { width, height } = planoResult.sheet;
    const win = window.open('', '_blank');
    if (!win) return setStatus('El navegador bloqueó la ventana de impresión', true);
    win.document.write(`<!doctype html><title>${name}</title><style>@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0}svg{display:block}</style>${planoResult.svg()}`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }
}

// ---------- acciones ----------
function select(id) {
  if (pickingFeatureId && pickingFeatureId !== id) stopPick();
  selectedId = id;
  renderPanels();
  const feature = selectedFeature();
  refreshPlaneOverlay();
}

// Plano de trabajo resaltado (con rotación incluida) del boceto o agujero seleccionado.
function refreshPlaneOverlay() {
  const feature = selectedFeature();
  // Zona de rosca resaltada (cilindro rojo punteado) al elegir una operación Rosca.
  let zone = null;
  if (feature?.type === 'thread') {
    try {
      zone = threadZone(feature, lastBuild?.params ?? {});
    } catch {
      zone = null;
    }
  }
  viewer.showThreadZone(zone);
  const show = feature && ((feature.type === 'sketch' && !editingSketchId) || feature.type === 'hole');
  if (!show) return viewer.showSketchFrame(null);
  try {
    viewer.showSketchFrame(planeFrame(null, feature, lastBuild?.params ?? {}));
  } catch {
    viewer.showSketchFrame(null);
  }
}

function addFeature(type) {
  if (type === 'mesh') return requestStlImport(); // la malla se crea importando un STL
  const sketches = store.state.features.filter((feature) => feature.type === 'sketch');
  const patch = {};
  if (type === 'extrude' || type === 'revolve') {
    const chosen = sketches.find((sketch) => sketch.id === selectedId) ?? sketches[sketches.length - 1];
    if (!chosen) return setStatus('Primero creá un boceto', true);
    patch.sketch = chosen.id;
  }
  apply((state) => commands.addFeature(state, type, patch));
  const added = store.state.features[store.state.features.length - 1];
  selectedId = added.id;
  if (type === 'sketch') openSketch(added.id);
  else renderPanels();
}

function openSketch(id) {
  stopPick();
  editingSketchId = id;
  selectedId = id;
  byId('sketchLayer').hidden = false;
  viewer.showSketchPlane(null);
  sketchEditor.open(id, store.state, lastBuild?.params ?? {});
  refreshSketchReference();
  sketchEditor.fit();
  syncSketchTools();
  byId('viewHint').textContent = '';
  renderPanels();
}

// Papel cebolla: malla de la pieza justo antes de la operación que usa este boceto (así no se superpone con lo que se está dibujando).
let referenceMeshCache = { key: null, mesh: null };
async function referenceMesh(part, sketchId) {
  const consumer = part.features.find((feature) => (feature.type === 'extrude' || feature.type === 'revolve') && feature.sketch === sketchId);
  const before = consumer ? part.features.slice(0, part.features.indexOf(consumer)) : part.features;
  const key = JSON.stringify([before.filter((feature) => feature.id !== sketchId), part.params, consumer?.id ?? null]);
  if (referenceMeshCache.key === key) return referenceMeshCache.mesh;
  let mesh = null;
  try {
    const result = await kernel.request('referenceMesh', { part, stopBefore: consumer?.id ?? null }, { channel: 'reference', latestOnly: true });
    if (isSuperseded(result)) return referenceMeshCache.mesh;
    mesh = result;
  } catch {
    mesh = null;
  }
  referenceMeshCache = { key, mesh };
  return mesh;
}

let referenceSeq = 0;
async function refreshSketchReference() {
  if (!editingSketchId) return;
  const part = store.state;
  const sketchId = editingSketchId;
  const seq = ++referenceSeq;
  const mesh = sketchEditor.refSolidOn ? await referenceMesh(part, sketchId) : null;
  if (seq !== referenceSeq || editingSketchId !== sketchId) return;
  sketchEditor.setReference(sketchReference({ part, params: lastBuild?.params ?? {}, sketchId, mesh, showSketches: sketchEditor.refSketchesOn, showSolid: sketchEditor.refSolidOn }));
}

function closeSketch() {
  editingSketchId = null;
  sketchEditor.close();
  byId('sketchLayer').hidden = true;
  viewer.resize();
  renderPanels();
}

function togglePick(featureId) {
  if (pickingFeatureId === featureId) return stopPick();
  pickingFeatureId = featureId;
  selectedId = featureId;
  scheduleRebuild(true);
}

function stopPick() {
  if (!pickingFeatureId) return;
  pickingFeatureId = null;
  viewer.setPickMode(false);
  byId('viewHint').textContent = '';
  scheduleRebuild(true);
}

viewer.onEdgePick = (mid) => {
  const feature = store.state.features.find((item) => item.id === pickingFeatureId);
  if (!feature) return;
  const points = feature.selector?.points ?? [];
  const index = points.findIndex((point) => Math.hypot(point[0] - mid[0], point[1] - mid[1], point[2] - mid[2]) < 0.6);
  const next = index >= 0 ? points.filter((_, i) => i !== index) : [...points, mid];
  apply((state) => commands.updateFeature(state, feature.id, { selector: { kind: 'near', points: next } }));
};

// ---------- reconstrucción ----------
// Pausa antes de recalcular: si la última reconstrucción fue pesada (rosca real, engranajes grandes) se espera más
// para no encolar un cálculo por cada tecla mientras se escribe un valor.
let lastRebuildMs = 0;
function scheduleRebuild(immediate = false) {
  clearTimeout(rebuildTimer);
  const wait = immediate ? 0 : Math.min(1500, Math.max(40, lastRebuildMs * 1.5));
  if (!immediate && lastRebuildMs > 400) setStatus('Recalculando…');
  rebuildTimer = setTimeout(rebuild, wait);
}

let rebuildSeq = 0;
let viewSeq = 0;
let rebuildPromise = Promise.resolve();
// Reconstruye en el motor. Si mientras tanto pidieron otra, esta respuesta se descarta y se espera la más nueva.
function rebuild() {
  rebuildPromise = runRebuild();
  return rebuildPromise;
}

async function runRebuild() {
  if (!kernelReady) return;
  if (!sceneBusy && particleRunner.active) { stopParticles(); particlePanel.stats=null;particlePanel.message='El modelo cambió. Iniciá una nueva corrida para actualizar resultados.'; }
  const started = performance.now();
  const part = store.state;
  const seq = ++rebuildSeq;
  const myView = ++viewSeq;
  const picking = pickingFeatureId;
  let result;
  try {
    result = await kernel.request('build', { part, stopBefore: picking, split: splitSpec(part) }, { channel: 'build', latestOnly: true });
  } catch (error) {
    setStatus(`Error del kernel: ${error.message}. Usá Herramientas → Recuperar motor.`, true);
    return;
  }
  if (seq !== rebuildSeq) return rebuildPromise;
  if (isSuperseded(result)) return undefined;
  lastBuild = result;
  lastBuiltPart = part;
  lastMeshReady = !picking && result.items.length > 0;
  if (myView === viewSeq) { viewer.setMeshes(result.items); workbench?.sync(); }
  refreshPlaneOverlay();
  if (picking) {
    const pickedFeature = part.features.find((feature) => feature.id === picking);
    viewer.setPickMode(true, pickedFeature?.selector?.points ?? []);
    byId('viewHint').textContent = 'Clic en una arista para marcarla/quitarla · Shift suma · mostrando la pieza antes de esta operación';
  }
  const hasMesh = result.items.length > 0;
  if (!lastFit && hasMesh) {
    viewer.setView('iso');
    lastFit = true;
  }
  const failed = Object.values(result.results).filter((item) => item.status === 'error').length;
  const size = result.size ? result.size.map((value) => Math.round(value * 100) / 100).join(' × ') : '—';
  const loose = result.solids > 1 && !part.features.some((feature) => feature.type === 'mesh' && !feature.suppressed); // un STL puede traer varios cuerpos a propósito
  const notes = result.notes.map((note) => note.text).join(' · ');
  setStatus(`${size} mm · ${Math.round(performance.now() - started)} ms${failed ? ` · ${failed} operación con error` : ''}${loose ? ` · ⚠ ${result.solids} cuerpos separados: no se tocan entre sí (superponelos al menos en una cara para unirlos)` : ''}${notes ? ` · ${notes}` : ''}`, failed > 0 || loose || result.notes.length > 0);
  lastRebuildMs = performance.now() - started;
  renderPanels();
  if (editingSketchId) {
    sketchEditor.update(part, result.params);
    refreshSketchReference();
  }
  await rebuildPlano();
}
let lastFit = false;
let lastBuiltPart = null;
let lastMeshReady = false;
function renderPanels() {
  const part = store.state;
  const results = lastBuild?.results ?? {};
  tree.render(part, results, selectedId);
  paramsPanel.render(part, { values: lastBuild?.params ?? {}, errors: lastBuild?.paramErrors ?? {} });
  props.render(part, lastBuild?.params ?? {}, results, selectedFeature(), Boolean(pickingFeatureId));
  renderProject();
  movePanel.sync();
  if (!sceneBusy) { particlePanel.sync(); scenePanel.sync(); }
}

function renderProject() {
  const nameInput = byId('partName');
  const doc = docStore().state;
  if (document.activeElement !== nameInput) nameInput.value = doc.meta.name;
  byId('undoBtn').disabled = !projectJournal.canUndo;
  byId('redoBtn').disabled = !projectJournal.canRedo;
  const options = Object.entries(templates).map(([key, template]) => [key, template.label]);
  projectPanel.render(projects.updatePart(project, project.activePartId, store.state), { scope, templateOptions: options });
  asmPanel.render(project, lastAssembly, assemblyError);
  movePanel.sync();
  if (!sceneBusy) { particlePanel.sync(); scenePanel.sync(); }
}

function syncSketchTools() {
  document.querySelectorAll('[data-sktool]').forEach((button) => button.classList.toggle('active', button.dataset.sktool === sketchEditor.tool));
  document.querySelector('[data-skopt="snap"]')?.classList.toggle('active', sketchEditor.snapOn);
  document.querySelector('[data-skopt="dist"]')?.classList.toggle('active', sketchEditor.distOn);
  document.querySelector('[data-skopt="guides"]')?.classList.toggle('active', sketchEditor.guidesOn);
  document.querySelector('[data-skopt="refSketches"]')?.classList.toggle('active', sketchEditor.refSketchesOn);
  document.querySelector('[data-skopt="refSolid"]')?.classList.toggle('active', sketchEditor.refSolidOn);
  const unitButton = document.querySelector('[data-skopt="unit"]');
  if (unitButton) unitButton.textContent = sketchEditor.unit;
}

// ---------- barra superior ----------
byId('partName').addEventListener('change', (event) => applyDoc((state) => commands.rename(state, event.target.value || (scope === 'asm' ? 'Conjunto' : 'Pieza'))));
byId('undoBtn').addEventListener('click', () => journalMove());
byId('redoBtn').addEventListener('click', () => journalMove(true));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => viewer.setView(button.dataset.view)));
document.querySelectorAll('[data-sktool]').forEach((button) => button.addEventListener('click', () => { sketchEditor.setTool(button.dataset.sktool); syncSketchTools(); }));
document.querySelectorAll('[data-skopt]').forEach((button) => button.addEventListener('click', () => {
  const name = button.dataset.skopt;
  if (name === 'unit') sketchEditor.setUnit(sketchEditor.unit === 'mm' ? 'cm' : 'mm');
  else sketchEditor.setOption(name, !sketchEditor.getOption(name));
  syncSketchTools();
}));
byId('skFit').addEventListener('click', () => sketchEditor.fit());
byId('skDone').addEventListener('click', () => closeSketch());

// La biblioteca de piezas se registra como plantillas más (clave `lib:<id>`): el diálogo «Biblioteca» las agrupa por categoría.
libraryItems.forEach((entry) => { templates[`lib:${entry.id}`] = { label: `${entry.category} · ${entry.label}`, ask: entry.ask, build: entry.build, library: entry }; });

const templateSelect = byId('templateSelect');
Object.entries(templates).forEach(([key, template]) => templateSelect.append(Object.assign(document.createElement('option'), { value: key, textContent: template.label })));
templateSelect.append(Object.assign(document.createElement('option'), { value: '__empty', textContent: 'Pieza vacía' }));
templateSelect.addEventListener('change', () => {
  const key = templateSelect.value;
  templateSelect.value = '';
  if (!key) return;
  if (!window.confirm('Se reemplaza la pieza actual junto con su plano y cotas (podés deshacer con Ctrl+Z). ¿Continuar?')) return;
  if (key === '__empty') return loadPart(createPart('Pieza nueva'));
  const template = templates[key];
  const args = {};
  for (const question of template.ask ?? []) {
    const answer = window.prompt(question.label, String(question.value));
    if (answer === null) return;
    args[question.name] = Number(String(answer).replace(',', '.'));
  }
  try {
    loadPart(template.build(args));
  } catch (error) {
    setStatus(error.message, true);
  }
});

// Limpia el estado de la vista de plano (selección, zoom) para que no quede nada de la pieza anterior.
function resetPlanoState() {
  planoSelected = null;
  planoView.selectedDim = null;
  planoView.viewBox = null;
}

function newProject() {
  const detail = `${project.parts.length} pieza(s), ${project.instances?.length ?? 0} instancia(s) del conjunto, planos y cotas`;
  if (!window.confirm(`Nuevo proyecto: se borra TODO lo actual (${detail}) y también el autoguardado. Guardá antes con Ctrl+S si lo necesitás. ¿Continuar?`)) return;
  clearTimeout(projectSaveTimer);
  activateProject(projects.createProject(createPart('Pieza nueva')));
  resetPlanoState();
  store.undoStack = [];
  store.redoStack = [];
  clearLocal().then(() => saveLocal(projectSnapshot()));
  setStatus('Proyecto nuevo: se borraron piezas, conjunto, planos y autoguardado');
}
byId('newBtn').addEventListener('click', newProject);

function loadPart(part) {
  closeScenePanels();
  closeSketch();
  stopPick();
  resetPlanoState();
  selectedId = null;
  lastFit = false;
  apply(() => part);
}

byId('saveBtn').addEventListener('click', saveFile);
byId('helpBtn').addEventListener('click', () => (byId('helpModal').hidden = false));
byId('helpClose').addEventListener('click', () => (byId('helpModal').hidden = true));
byId('helpModal').addEventListener('click', (event) => event.target.id === 'helpModal' && (byId('helpModal').hidden = true));
const safeName = (text, fallback) => (text || fallback).replace(/[^\w-]+/g, '_');
// Historial de documento completo: estructura, instancias y operaciones, con un paso por gesto.
function sameProjectSnapshot(old,next) {
  return old.parts.length===next.parts.length&&old.parts.every((p,i)=>p.id===next.parts[i].id&&p.part===next.parts[i].part)&&old.instances===next.instances&&old.assembly===next.assembly&&old.mates===next.mates&&old.simulation===next.simulation;
}
function scheduleJournal() {
  if(restoringJournal)return;
  clearTimeout(journalTimer);
  journalTimer=setTimeout(()=>{
    journalTimer=null;
    const next=projectSnapshot(),old=projectJournal.state;
    const same=sameProjectSnapshot(old,next);
    if(!same)projectJournal.apply(()=>next);
    renderProject();
  },0);
}
function journalMove(redo=false) {
  store.commitTransient();asmStore.commitTransient();
  if(journalTimer){clearTimeout(journalTimer);journalTimer=null;const next=projectSnapshot();if(!sameProjectSnapshot(projectJournal.state,next))projectJournal.apply(()=>next);}
  if(!(redo?projectJournal.redo():projectJournal.undo()))return;
  const sketchId=editingSketchId;
  restoringJournal=true;
  try{activateProject(projectJournal.state);if(sketchId&&store.state.features.some(f=>f.id===sketchId))openSketch(sketchId);}finally{restoringJournal=false;}
}
function projectSnapshot() {
  syncActive();
  return { ...project, assembly: asmStore.state };
}
function saveFile() {
  downloadBlob(new Blob([JSON.stringify(projectSnapshot(), null, 1)], { type: 'application/json' }), `${safeName(project.name, 'proyecto')}.proj3d`);
  setStatus('Proyecto .proj3d guardado (todas las piezas y el ensamble)');
}
function savePartFile() {
  downloadBlob(new Blob([serializePart(store.state)], { type: 'application/json' }), `${safeName(store.state.meta.name, 'pieza')}.part3d`);
  setStatus('Pieza .part3d guardada');
}
byId('openBtn').addEventListener('click', () => byId('fileInput').click());
byId('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 100*1024*1024) throw new Error('El archivo supera 100 MiB');
    const text = await file.text();
    const data = JSON.parse(text);
    const isProject = data?.format === 'elcad3d-project';
    if (!isProject && project.parts.length > 0 && window.confirm('¿Agregar el archivo como pieza nueva del proyecto?\n(Cancelar = reemplazar todo el proyecto)')) {
      syncActive();
      project = projects.addPart(project, parsePart(text));
      activatePart(project.activePartId, { already: true });
      return;
    }
    activateProject(projects.parseProject(text));
  } catch (error) {
    setStatus(error.message, true);
  }
});

// Importar STL: malla de triángulos → operación «Malla STL» (sólido cosido en el kernel) en la pieza activa.
function requestStlImport() {
  if (scope !== 'part') return setStatus('Importar STL agrega una operación a la pieza: pasá a modo Pieza', true);
  byId('stlInput').click();
}
byId('importStepBtn').addEventListener('click',()=>{if(scope!=='part')return setStatus('Pasá a modo Pieza para importar STEP',true);byId('stepInput').click();});
byId('stepInput').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try {
    if(file.size>100*1024*1024)throw new Error('El STEP supera 100 MiB');
    setStatus('Importando STEP… Podés cancelar desde la barra de actividad.');
    const result=await kernel.request('importStep',{buffer:await file.arrayBuffer()});
    if(isSuperseded(result))return;
    apply(state=>commands.addFeature(state,'step',{brep:result.brep,file:file.name}));
    selectedId=store.state.features.at(-1).id;lastFit=false;renderPanels();
  }catch(error){setStatus(`No se pudo importar STEP: ${error.message}`,true);}
});
byId('importStlBtn').addEventListener('click', requestStlImport);
// Propiedades físicas de lo que se ve (pieza o conjunto): mallas del visor + material de cada pieza.
byId('propsBtn').addEventListener('click', () => {
  const viewItems = viewer.items ?? [];
  if (!viewItems.length) return setStatus('No hay geometría para medir', true);
  const materialOf = (partId) => (partId ? project.parts.find((entry) => entry.id === partId)?.part.meta.material : store.state.meta.material) ?? '';
  const items = viewItems.map((item) => {
    const instance = scope === 'asm' ? lastAssembly?.instances.find((inst) => inst.id === item.id) : null;
    const material = materialOf(instance?.partId);
    return { name: item.name, mesh: viewer.itemGeometry(item.id), density: materialTable[material]?.density ?? 0, materialLabel: materialTable[material]?.label ?? 'sin material' };
  });
  const frames = [];
  if (scope !== 'asm') {
    store.state.features.filter((feature) => feature.type === 'frame' && !feature.suppressed).forEach((feature, index) => {
      try {
        const list = frameCutList(frameSpecOf(feature, lastBuild?.params ?? {}));
        frames.push({ label: feature.name || `Estructura ${index + 1}`, count: list.rows.length, totalLength: list.totalLength, totalWeight: list.totalWeight });
      } catch { /* estructura incompleta: se omite */ }
    });
  }
  openPropertiesDialog({ title: scope === 'asm' ? 'Propiedades del conjunto' : `Propiedades: ${store.state.meta.name}`, items, frames, ...(scope === 'asm' ? {} : { material: store.state.meta.material ?? '', onMaterial: (material) => applyDoc((state) => commands.updateMeta(state, { material })) }) });
});

byId('libraryBtn').addEventListener('click', () => openLibraryDialog(libraryItems, {
  onAdd: (entry, args) => {
    try {
      addProjectPart(entry.build(args));
      setStatus(`«${entry.label}» agregada al proyecto`);
    } catch (error) {
      setStatus(error.message, true);
    }
  },
}));
let stlReadController=null;
byId('cancelReadBtn').addEventListener('click',()=>stlReadController?.abort());
byId('stlInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  stlReadController?.abort();
  const controller=new AbortController();stlReadController=controller;byId('cancelReadBtn').hidden=false;
  setStatus(`Analizando STL: ${file.name}…`);
  try {
    if (file.size > 100*1024*1024) throw new Error('El STL supera 100 MiB. Reducilo antes de importar.');
    const stl = await geometryJob('stl', await file.arrayBuffer(),{signal:controller.signal});
    setStatus('Listo');
    openStlImportDialog(stl, {
      fileName: file.name,
      onCreate: ({ name, file: fileName, mesh, scale, move, meshOnly, triangles, reduced }) => {
        closeSketch();
        lastFit = false; // la próxima reconstrucción encuadra la cámara en la malla importada
        apply((state) => commands.addFeature(state, 'mesh', { name, file: fileName, mesh, scale, move, meshOnly: Boolean(meshOnly) }));
        selectedId = store.state.features[store.state.features.length - 1].id;
        renderPanels();
        const fmtMm = (v) => (v < 0.01 ? '< 0,01' : String(v).replace('.', ','));
        const reducedText = reduced ? ` (reducido de ${reduced.from} a ${reduced.to}; desvío típico ${fmtMm(reduced.errorMm)} mm, volumen ${String(reduced.volumePct).replace('.', ',')} % de diferencia)` : '';
        setStatus(meshOnly ? `STL cargado como malla: ${triangles} triángulos.` : `STL importado: ${triangles} triángulos${reducedText}. Se está convirtiendo en sólido…`);
      },
    });
  } catch (error) {
    setStatus(error.message, error.message!=='Cancelado');
  } finally { if(stlReadController===controller){stlReadController=null;byId('cancelReadBtn').hidden=true;} }
});

// Importar DXF/DWG: entidades 2D → un boceto nuevo en la pieza activa (listo para extruir).
byId('importBtn').addEventListener('click', () => {
  if (scope !== 'part') return setStatus('Importar 2D crea un boceto: pasá a modo Pieza', true);
  byId('cadInput').click();
});
byId('cadInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  stlReadController?.abort();
  const controller=new AbortController();stlReadController=controller;byId('cancelReadBtn').hidden=false;
  setStatus(`Analizando STL: ${file.name}…`);
  try {
    const cad = await readCadFile(file);
    setStatus('Listo');
    openImportDialog(cad, {
      fileName: file.name,
      onCreate: ({ entities, plane }) => {
        closeSketch();
        apply((state) => {
          let next = commands.addFeature(state, 'sketch', { plane });
          const sketchId = next.features[next.features.length - 1].id;
          entities.forEach((entity) => (next = commands.addEntity(next, sketchId, entity)));
          return next;
        });
        const added = store.state.features[store.state.features.length - 1];
        selectedId = added.id;
        renderPanels();
        setStatus(`Boceto importado: ${entities.length} contorno(s). Usá Extrusión para darle espesor.`);
      },
    });
  } catch (error) {
    setStatus(error.message, true);
  }
});

const exportName = () => safeName(docStore().state.meta.name, scope === 'asm' ? 'conjunto' : 'pieza');
async function exportModel(kind) {
  setStatus('Preparando exportación…');
  try {
    if(scope==='asm')await rebuildAssembly();
    else if(!lastBuiltPart || lastBuiltPart.features!==store.state.features || lastBuiltPart.params!==store.state.params)await rebuild();
    if(scope==='asm'?!lastAssembly?.hasCompound:!lastBuild?.hasShape)throw new Error('No hay geometría válida para exportar');
    const blob=await kernel.request('export',{kind,scope,name:store.state.meta.name});
    if(isSuperseded(blob))return;
    downloadBlob(blob,`${exportName()}.${kind}`);setStatus(`Exportado ${exportName()}.${kind}`);
  }catch(error){setStatus(error.message,true);}
}
// DXF 1:1 para cortadora láser: la cara plana más grande de la pieza REAL (contorno, agujeros, chaflanes/redondeos de boceto, cortes).
async function exportLaser(format = 'r2000') {
  setStatus('Preparando DXF para láser…');
  try {
    if (scope === 'asm') throw new Error('El DXF para láser sale de una pieza: pasá a Pieza.');
    if (!lastBuiltPart || lastBuiltPart.features !== store.state.features || lastBuiltPart.params !== store.state.params) await rebuild();
    if (!lastBuild?.hasShape) throw new Error('No hay geometría válida para exportar');
    const data = await kernel.request('laserOutline', {});
    if (isSuperseded(data)) return;
    const laser = loopsToLaserEntities(data);
    downloadBlob(new Blob([laserEntitiesToDxf(laser, { format })], { type: 'application/dxf' }), `${exportName()}-laser${format === 'r12' ? '-r12' : ''}.dxf`);
    setStatus(`DXF para láser (1:1): ${laser.width} × ${laser.height} mm · ${laser.holes} agujero${laser.holes === 1 ? '' : 's'} interior${laser.holes === 1 ? '' : 'es'} · cara más grande de la pieza`);
  } catch (error) {
    setStatus(error.message, true);
  }
}
byId('stlBtn').addEventListener('click', () => exportModel('stl'));
byId('dxfLaserBtn').addEventListener('click', () => exportLaser('r2000'));
byId('dxfLaserR12Btn').addEventListener('click', () => exportLaser('r12'));
byId('mfBtn').addEventListener('click', () => exportModel('3mf'));
byId('stepBtn').addEventListener('click', () => exportModel('step'));

// ---------- proyecto y ensamble ----------
const projectPanel = new ProjectPanel(byId('projectPanel'), {
  onSelect: (id) => activatePart(id),
  onColor: (id, color) => setPartColor(id, color),
  onMaterial: (material) => applyDoc((state) => commands.updateMeta(state, { material })),
  onAddEmpty: () => addProjectPart(createPart(`Pieza ${project.parts.length + 1}`)),
  onAddTemplate: (key) => {
    const template = templates[key];
    const args = {};
    for (const question of template.ask ?? []) {
      const answer = window.prompt(question.label, String(question.value));
      if (answer === null) return;
      args[question.name] = Number(String(answer).replace(',', '.'));
    }
    try {
      addProjectPart(template.build(args));
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onDuplicate: (id) => {
    syncActive();
    try {
      project = projects.duplicatePart(project, id);
      activatePart(project.activePartId, { already: true });
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onRemove: (id) => {
    const name = project.parts.find((item) => item.id === id)?.part.meta.name;
    if (!window.confirm(`¿Eliminar la pieza "${name}" y sus instancias del ensamble?`)) return;
    try {
      const wasActive = project.activePartId === id;
      syncActive();
      project = projects.removePart(project, id);
      if (wasActive) activatePart(project.activePartId, { already: true });
      else afterProjectChange();
    } catch (error) {
      setStatus(error.message, true);
    }
  },
  onAddInstance: (id) => addInstanceOf(id),
  onSavePart: () => savePartFile(),
});

let welding = false;
const asmPanel = new AssemblyPanel(byId('asmPanel'), {
  onWeld: async ids => {
    if (welding) return;
    if (ids.length < 2) return setStatus('Marcá al menos dos segmentos del conjunto para unir.', true);
    if (project.parts.length >= projects.MAX_PARTS) return setStatus('La unión crea una pieza nueva. Liberá un cupo del catálogo del proyecto (máximo 8) y reintentá.', true);
    const actions = getScene().actions ?? [];
    if (actions.some(action => action.targets?.some(id => ids.includes(id)))) return setStatus('Quitá las acciones de movimiento de estos segmentos antes de convertirlos en una pieza fija.', true);
    welding = true;
    try {
      stopParticles(); stopPreview();
      const input = projectSnapshot();
      const snapshot = JSON.stringify(input);
      setStatus('Uniendo segmentos y verificando continuidad del sólido…');
      const result = await kernel.request('weldAssembly', {project: input, ids});
      if (isSuperseded(result)) return;
      if (snapshot !== JSON.stringify(projectSnapshot())) throw new Error('El proyecto cambió mientras se unía. Seleccioná los segmentos y reintentá.');
      const sources = input.instances.filter(instance => ids.includes(instance.id));
      const materials = new Set(sources.map(instance => input.parts.find(entry => entry.id === instance.partId)?.part.meta.material ?? ''));
      let part = createPart('Unión de segmentos');
      if (materials.size === 1) part = commands.updateMeta(part, {material: [...materials][0]});
      part = commands.addFeature(part, 'step', {brep: result.brep, name: 'Unión booleana de segmentos'});
      let next = projects.addPart(project, part);
      for (const id of ids) next = projects.removeInstance(next, id);
      next = projects.addInstance(next, next.activePartId, [0, 0, 0]);
      project = next;
      activatePart(project.activePartId, {already: true});
      setScope('asm'); afterProjectChange();
      setStatus('Unión creada. Reiniciá la simulación para usar la geometría continua. Podés deshacer para recuperar las instancias originales.');
    } catch (error) { setStatus(`No se pudo unir: ${error.message}`, true); }
    finally { welding = false; }
  },
  onRelations: (mates) => {
    try { project=solveAssemblyMates({...project,mates});afterProjectChange(); }
    catch(error){setStatus(error.message,true);}
  },
  onUpdate: (id, patch) => {
    project = projects.updateInstance(project, id, patch);
    afterProjectChange();
  },
  onRemove: (id) => {
    project = projects.removeInstance(project, id);
    afterProjectChange();
  },
  onDuplicate: (id) => {
    const instance = project.instances.find((item) => item.id === id);
    const live = lastAssembly?.instances.find((item) => item.id === id);
    if (!instance) return;
    const width = live ? live.bounds[1][0] - live.bounds[0][0] + 5 : 20;
    project = projects.addInstance(project, instance.partId, [instance.pos[0] + width, instance.pos[1], instance.pos[2]]);
    const copy = project.instances[project.instances.length - 1];
    project = projects.updateInstance(project, copy.id, { rot: [...instance.rot] });
    afterProjectChange();
  },
  onStack: (id, targetId) => {
    const instance = lastAssembly?.instances.find((item) => item.id === id);
    const target = lastAssembly?.instances.find((item) => item.id === targetId);
    if (!instance || !target) return;
    project = projects.updateInstance(project, id, { pos: stackOn(instance, target) });
    afterProjectChange();
  },
  onCenter: (id) => {
    const live = lastAssembly?.instances.find((item) => item.id === id);
    const instance = project.instances.find((item) => item.id === id);
    if (!live || !instance) return;
    const cx = (live.bounds[0][0] + live.bounds[1][0]) / 2;
    const cy = (live.bounds[0][1] + live.bounds[1][1]) / 2;
    project = projects.updateInstance(project, id, { pos: [Math.round((instance.pos[0] - cx) * 1000) / 1000, Math.round((instance.pos[1] - cy) * 1000) / 1000, instance.pos[2]] });
    afterProjectChange();
  },
  onExport: (kind) => exportModel(kind),
});

// La pieza activa vive en `store`; el proyecto guarda su última copia al cambiar de pieza, guardar o armar el ensamble.
function syncActive() {
  project = projects.updatePart(project, project.activePartId, store.state);
}

function activatePart(id, { already = false } = {}) {
  viewer.restoreItems();
  closeScenePanels();
  closeSketch();
  stopPick();
  if (!already) {
    syncActive();
    histories[project.activePartId] = { undo: store.undoStack, redo: store.redoStack };
    project = projects.setActivePart(project, id);
  }
  const entry = project.parts.find((item) => item.id === id);
  selectedId = null;
  lastFit = false;
  store.replace(entry.part, { resetHistory: false });
  store.undoStack = histories[id]?.undo ?? [];
  store.redoStack = histories[id]?.redo ?? [];
  if (scope !== 'part') {
    scope = 'part';
    refresh();
  } else refresh();
  scheduleJournal();scheduleSave();
}

function addProjectPart(part) {
  try {
    syncActive();
    histories[project.activePartId] = { undo: store.undoStack, redo: store.redoStack };
    project = projects.addPart(project, part);
    activatePart(project.activePartId, { already: true });
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function addInstanceOf(partId) {
  syncActive();
  let pos = [0, 0, 0];
  const entry = project.parts.find((item) => item.id === partId);
  if (project.instances.length && entry) pos = await kernel.request('nextInstancePos', { project, partId });
  project = projects.addInstance(project, partId, pos);
  setStatus(`${entry?.part.meta.name} agregada al ensamble`);
  afterProjectChange();
}

function afterProjectChange() {
  try { project=solveAssemblyMates(project); }
  catch(error){setStatus(error.message,true);}
  scheduleJournal();
  clearTimeout(asmTimer);
  asmTimer = setTimeout(async () => {
    if (scope === 'asm') {
      await rebuildAssembly();
      if (mode === '3d') await showAssembly(false);
      else await rebuildPlano();
    }
    renderProject();
    scheduleSave();
  }, 30);
  renderProject();
}

// El ensamble vive en el motor; acá queda una copia de datos (instancias con su recuadro, interferencias, lista de materiales).
let lastAssemblyMeshes = null;
let assemblySeq = 0;
let assemblyPromise = Promise.resolve();
function rebuildAssembly() {
  assemblyPromise = runRebuildAssembly();
  return assemblyPromise;
}

async function runRebuildAssembly() {
  if (!kernelReady) return;
  syncActive();
  const seq = ++assemblySeq;
  let result;
  try {
    result = await kernel.request('buildAssembly', { project, withItems: mode === '3d', sharedItems: true }, { channel: 'asm', latestOnly: true });
  } catch (error) {
    if (seq !== assemblySeq) return assemblyPromise;
    assemblyError = error.message;
    lastAssembly = null;
    lastAssemblyMeshes = null;
    renderProject();
    return;
  }
  if (seq !== assemblySeq) return assemblyPromise;
  if (isSuperseded(result)) return;
  const { meshes, sharedMeshes, ...data } = result;
  lastAssembly = data;
  lastAssemblyMeshes = sharedMeshes ? {shared:sharedMeshes} : meshes;
  assemblyError = null;
  renderProject();
}

let asmFitted = false;
async function showAssembly(fit) {
  if (!lastAssembly) return;
  if (!lastAssemblyMeshes) await rebuildAssembly();
  if (!lastAssembly || !lastAssemblyMeshes) return;
  const items = lastAssembly.instances.map((inst, index) => ({ id: inst.id, name: `${project.parts.find((item) => item.id === inst.partId)?.part.meta.name ?? 'Pieza'} #${index + 1}`, data: lastAssemblyMeshes.shared ? lastAssemblyMeshes.shared[inst.partId] : lastAssemblyMeshes[inst.id], transform: lastAssemblyMeshes.shared ? {pos:inst.pos,rot:inst.rot} : null, bounds:{min:inst.bounds[0],max:inst.bounds[1],size:inst.bounds[1].map((v,k)=>v-inst.bounds[0][k])}, color: assemblyColorOf(inst.partId) }));
  viewer.setMeshes(items); workbench?.sync();
  if (fit || !asmFitted) {
    viewer.setView('iso');
    asmFitted = true;
  }
  const clash = lastAssembly.interferences.length;
  setStatus(`Ensamble: ${lastAssembly.instances.length} instancias · ${lastAssembly.bom.length} piezas distintas · ${lastAssembly.totalMass.toFixed(3)} kg${clash ? ` · ${clash} interferencia(s)` : ''}`, clash > 0);
}

function assemblyColorOf(partId) {
  const index = Math.max(0, project.parts.findIndex((item) => item.id === partId));
  return partColor(project.parts[index].part, index, { palette: true });
}

function setPartColor(id, color) {
  if (id === project.activePartId) return applyDoc((state) => commands.updateMeta(state, { color }));
  const item = project.parts.find((entry) => entry.id === id);
  if (!item) return;
  project = projects.updatePart(project, id, commands.updateMeta(item.part, { color }));
  afterProjectChange();
}

function activateProject(data) {
  viewer.restoreItems();
  data=projects.parseProject(JSON.stringify(data));
  localSaveBlocked=false;
  closeScenePanels();
  closeSketch();
  stopPick();
  project = data;
  Object.keys(histories).forEach((key) => delete histories[key]);
  const first = project.parts.find((item) => item.id === project.activePartId) ?? project.parts[0];
  store.replace(first.part);
  asmStore.replace(data.assembly ? { ...commands.updateDrawing(createPart('Conjunto'), { views: assemblyViews }), ...data.assembly } : commands.updateDrawing(createPart('Conjunto'), { views: assemblyViews }));
  const active = project.parts.find((item) => item.id === project.activePartId) ?? project.parts[0];
  project = projects.setActivePart(project, active.id);
  lastAssembly = null;
  lastAssemblyMeshes = null;
  if (kernelReady) kernel.request('disposeAssembly');
  asmFitted = false;
  selectedId = null;
  lastFit = false;
  if(!restoringJournal){clearTimeout(journalTimer);journalTimer=null;projectJournal.replace(projectSnapshot());}
  refresh();
}


let projectSaveTimer = null;
function scheduleSave() {
  clearTimeout(projectSaveTimer);
  workbench?.setSaving('saving');
  projectSaveTimer = setTimeout(() => persistNow(), 600);
}

async function persistNow() {
  clearTimeout(projectSaveTimer);
  if(localSaveBlocked){workbench?.setSaving('error');return false;}
  const ok = await saveLocal(projectSnapshot());
  workbench?.setSaving(ok ? 'saved' : 'error');
  return ok;
}
window.addEventListener('pagehide', () => { persistNow(); });
document.addEventListener('visibilitychange', () => { if(document.hidden) persistNow(); });

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName);
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveFile();
  } else if (mod && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    journalMove(event.shiftKey);
  } else if (mod && event.key.toLowerCase() === 'y' && !typing) {
    event.preventDefault();
    journalMove(true);
  }
});

// ---------- arranque ----------
store.subscribe((event) => {
  if(!['transient','replace'].includes(event?.reason))scheduleJournal();
  if (scope === 'part' && sceneUsed()) afterSceneChange();
  if (scope === 'part' && modelChanged(store.state)) {
    scheduleRebuild();
    // operaciones borradas: se quitan de las acciones
    const ids = new Set(sceneTargets().map((target) => target.id));
    if ((store.state.actions ?? []).some((action) => (action.targets ?? []).some((id) => !ids.has(id)))) {
      setTimeout(() => setScene((scene) => sceneOps.prune(scene, [...ids])), 0);
    }
  }
  scheduleSave();
});
asmStore.subscribe((event) => {
  if(!['transient','replace'].includes(event?.reason))scheduleJournal();
  if (scope === 'asm' && mode === 'plano') rebuildPlano();
  renderProject();
  scheduleSave();
});

// Memoria del kernel (WASM): solo crece y el navegador no la devuelve. El motor vive en un worker: cerca del límite
// se descarta ese worker (con toda su memoria) y se arranca otro; la pieza y el proyecto se reconstruyen sin recargar la página.
// Aviso desde ~1 GB; liberación automática en reposo desde 1,2 GB (sin tocar nada durante 20 s y sin simulación en curso) y siempre cerca de 2,6 GB.
let kernelMB = 0;
const kernelMemoryMB = () => kernelMB;
let restarting = false;
let lastInput = Date.now();
['pointerdown', 'keydown', 'wheel'].forEach((name) => window.addEventListener(name, () => { lastInput = Date.now(); }, true));
async function restartForMemory(automatic = false) {
  if (restarting) return;
  restarting = true;
  const freed = kernelMB;
  setStatus(automatic ? 'Liberando memoria del motor en reposo…' : 'Memoria del kernel alta: guardando y reiniciando el motor…', !automatic);
  try {
    if (!await persistNow()) throw new Error('El guardado local falló. Descargá el proyecto con Guardar y reintentá.');
    kernelReady = false;
    await kernel.restart();
    kernelReady = true;
    kernelMB = 0;
    lastBuiltPart = null;
    lastMeshReady = false;
    lastAssembly = null;
    lastAssemblyMeshes = null;
    refresh();
    updateMemory();
    if (automatic) setStatus(`Memoria liberada automáticamente (${(freed / 1024).toFixed(1).replace('.', ',')} GB → el motor arranca de nuevo; el modelo se vuelve a calcular).`);
  } catch (error) {
    setStatus(`No se pudo reiniciar el motor: ${error.message}. Descargá el proyecto antes de recargar.`, true);
  } finally {
    restarting = false;
  }
}
function updateMemory() {
  const mb = kernelMemoryMB();
  const button = byId('memBtn');
  button.hidden = mb < 1000;
  button.textContent = `🧠 ${(mb / 1024).toFixed(1).replace('.', ',')} GB · liberar`;
  const mobile = matchMedia('(pointer: coarse)').matches;
  const hard = mobile ? 700 : 2600, idle = mobile ? 400 : 1200;
  if (mb > hard && !pickingFeatureId && !motorPanel.open) restartForMemory();
  else if (mb > idle && Date.now() - lastInput > 20000 && !particleRunner.active && !preview && !sceneBusy && !pickingFeatureId && !motorPanel.open && !sketchEditor.active) restartForMemory(true);
}
let polling = false;
async function pollMemory() {
  if (polling || !kernelReady || restarting) return;
  polling = true;
  try {
    const mb = await kernel.request('memoryMB', {}, { silent: true });
    if (!isSuperseded(mb)) kernelMB = mb;
  } catch {
    /* motor ocupado o reiniciando */
  } finally {
    polling = false;
  }
  updateMemory();
}
byId('memBtn').addEventListener('click', () => restartForMemory());

// Cancelar: el motor es un solo hilo ocupado, así que se descarta el worker y se arranca otro. Lo que se ve en pantalla no cambia;
// la próxima edición vuelve a construir.
async function cancelKernelWork() {
  if (restarting) return;
  restarting = true;
  clearTimeout(rebuildTimer);
  clearTimeout(asmTimer);
  try {
    kernelReady = false;
    setStatus('Cancelando…', true);
    await kernel.restart();
    kernelReady = true;
    kernelMB = 0;
    lastBuiltPart = null;
    lastMeshReady = false;
    lastAssembly = null;
    lastAssemblyMeshes = null;
    setStatus('Cálculo cancelado: el modelo en pantalla puede estar desactualizado. Cualquier cambio vuelve a calcular.', true);
  } catch (error) {
    setStatus(`No se pudo reiniciar el motor: ${error.message}`, true);
  } finally {
    restarting = false;
  }
}
setInterval(pollMemory, 4000);

byId('bootRetry').addEventListener('click',()=>location.reload());
(async function start() {
  try {
    await kernel.start();
    kernelReady = true;
  } catch (error) {
    setStatus(`No se pudo cargar el kernel: ${error.message}`, true);
    byId('bootText').textContent='No se pudo cargar el motor CAD. Reintentá la carga; el guardado local se conserva.';byId('bootRetry').hidden=false;
    return;
  }
  const saved = await loadLocal();
  const loadIssue=localLoadError();
  if (saved) activateProject(saved);
  else activateProject(projects.createProject(templates.brida.build()));
  store.undoStack.length = 0;
  if(loadIssue){localSaveBlocked=true;clearTimeout(projectSaveTimer);workbench?.setSaving('error');setStatus('No se pudo leer el guardado local. Revisá Herramientas → Revisiones locales. No se reemplazará automáticamente.',true);}
  else setStatus('Listo');
  byId('bootScreen').hidden=true;
  window.elcad3d = { debugMemory: (mb, idleMs = 0) => { kernelMB = mb; lastInput = Date.now() - idleMs; updateMemory(); }, kernelMemoryMB, planoView, get planoResult() { return planoResult; }, setMode, setScope, store, asmStore, get project() { return project; }, get assembly() { return lastAssembly; }, projects, addInstanceOf, activatePart, activateProject, viewer, commands, get build() { return lastBuild; }, sketchEditor, openSketch, closeSketch, select, rebuild, templates, featureLabels };
})();
