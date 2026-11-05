import { analyzeRevolve, extractCircles, extractHoles, massKg, meshVolume } from './features3d.js';
import { buildSheetPrimitives, defaultDrawing } from './sheetPrimitives.js';
import { buildViewModel } from './viewModel.js';
import { primitivesToSvg } from './svgWriter.js';
import { evaluate, evaluateParams } from '../core/expression.js';
import { buildPart } from '../kernel/partBuilder.js';
import { gearFeatureSpecs } from '../kernel/gearGeometry.js';
import { threadFeatureSpecs } from '../kernel/threadGeometry.js';
import { resolveThread, threadCallout } from '../data/threads.js';
import { meshShape } from '../kernel/batchMesh.js';

// Roscas declaradas en el modelo (agujeros y círculos de corte): [{ d, major, label }] para rotular en el plano.
export function threadSpecs(part) {
  const { values: params } = evaluateParams(part.params);
  const specs = [];
  const add = (thread, d) => {
    if (!thread?.on || !Number.isFinite(d)) return;
    const row = resolveThread(thread, d, { drill: true });
    if (row) specs.push({ d, major: row.major, label: threadCallout(row, thread.depth) });
  };
  part.features.forEach((feature) => {
    if (feature.suppressed) return;
    try {
      if (feature.type === 'hole') add(feature.thread, evaluate(feature.d, params));
      if (feature.type === 'extrude' || feature.type === 'revolve') {
        const sketch = part.features.find((item) => item.id === feature.sketch);
        (sketch?.entities ?? []).filter((entity) => entity.t === 'circle').forEach((entity) => add(entity.thread, evaluate(entity.d, params)));
      }
    } catch {
      /* expresión inválida: sin rótulo de rosca */
    }
  });
  // Roscas internas con rango: el Ø de la broca (agujero) se rotula con la rosca y su largo.
  threadFeatureSpecs(part, params).filter((spec) => spec.internal).forEach((spec) => specs.push({ d: spec.row.tap, major: spec.major, label: spec.label }));
  return specs;
}

// Plano completo de una pieza: proyecta las vistas, acota y arma las primitivas de la hoja.
const fmtNote = (value) => String(Math.round(value * 100) / 100).replace('.', ',');

export function buildDrawing(rep, fullShape, part, { mass: massOverride = null, extras = null } = {}) {
  // El plano siempre usa las roscas cosmética: proyectar un filete helicoidal real cuelga el cálculo de aristas.
  const hasRealThread = (part.features ?? []).some((feature) => !feature.suppressed && ((feature.type === 'thread' && feature.real) || (feature.type === 'gear' && Number(feature.helix) !== 0)));
  const shape = hasRealThread ? (buildPart(rep, part, { forDrawing: true }).shape ?? fullShape) : fullShape;
  const drawing = { ...defaultDrawing(), ...(part.drawing ?? {}) };
  // Datos de cada engranaje como notas del plano (Ø primitivo, exterior, pie).
  const gearNotes = gearFeatureSpecs(part, evaluateParams(part.params).values).map((gear) => `Engranaje ${gear.label} · Ø primitivo ${fmtNote(gear.pitchDiameter)} · Ø exterior ${fmtNote(gear.outsideDiameter)} · Ø pie ${fmtNote(gear.rootDiameter)}${gear.helix ? ` · hélice ${gear.helix}°` : ''}`);
  if (gearNotes.length) drawing.notes = [...gearNotes, ...(drawing.notes ?? [])];
  const info = { circles: extractCircles(shape), holes: extractHoles(shape, rep), revolve: analyzeRevolve(shape), threads3d: threadFeatureSpecs(part, evaluateParams(part.params).values), gears3d: gearFeatureSpecs(part, evaluateParams(part.params).values) };
  const [bmin, bmax] = shape.boundingBox.bounds;
  const axisIndex = { x: 0, y: 1, z: 2 };
  const resolve = (config) => {
    if (config.kind !== 'section') return config;
    const i = axisIndex[config.plane ?? 'x'];
    const offset = Number.isFinite(Number(config.offset)) && config.offset !== 'auto' && config.offset !== '' ? Number(config.offset) : (bmin[i] + bmax[i]) / 2;
    return { ...config, offset };
  };
  const viewModels = drawing.views.map((config) => buildViewModel(rep, shape, info, resolve(config)));
  const mesh = meshShape(shape, { tolerance: 0.05, angularTolerance: 0.2 });
  const mass = massOverride ?? massKg(meshVolume(mesh), part.meta.material ?? '');
  const sheet = buildSheetPrimitives({ viewModels, drawing, meta: part.meta, mass, bounds: [bmin, bmax], extras, threads: threadSpecs(part) });
  return { ...sheet, viewModels, drawing, mass, svg: (options) => primitivesToSvg(sheet.sheet, sheet.primitives, options) };
}
