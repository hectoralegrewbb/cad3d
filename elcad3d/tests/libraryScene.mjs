import { buildPart } from '../src/kernel/partBuilder.js';
import { extractMesh } from '../src/kernel/meshExtractor.js';
import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim, materialPresets } from '../src/particles/sim.js';
import { bodyKey } from '../src/core/actions.js';
import { simFeeders, simSensors } from '../src/core/scene.js';

// Arma una simulación a partir de una pieza de la biblioteca como lo hace la aplicación: cada grupo de operaciones que mueve una
// acción es un cuerpo móvil (su malla es la unión de sus operaciones) y el resto de la pieza es el entorno fijo.
export function simFromPart(rep, part, { preset = 'arena', settings = {}, cell = 2 } = {}) {
  const movable = new Set(['extrude', 'revolve', 'gear', 'screw', 'pipe', 'mesh', 'frame']);
  const groups = new Map();
  (part.actions ?? []).forEach((action) => {
    if (!action.targets?.length || action.kind === 'air') return;
    groups.set(bodyKey(action.targets), [...action.targets]);
  });
  const targetIds = new Set([...groups.values()].flat());
  const meshOf = (ids) => {
    const parts = ids.map((id) => {
      const feature = part.features.find((f) => f.id === id);
      const keep = part.features.filter((f) => f.id === id || f.id === feature.sketch);
      const built = buildPart(rep, { ...part, features: keep });
      if (!built.shape) throw new Error(`no se pudo construir ${id}: ${JSON.stringify(built.results)}`);
      return extractMesh(built.shape);
    });
    let offset = 0;
    const vertices = [];
    const triangles = [];
    parts.forEach((m) => {
      vertices.push(...m.vertices);
      m.triangles.forEach((i) => triangles.push(i + offset));
      offset += m.vertices.length / 3;
    });
    return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles) };
  };
  const radius = (materialPresets[preset] ?? materialPresets.arena).radius;
  const band = Math.max(4, radius * 2.5, part.feeders?.length ? 10 : 0);
  const sdfOf = (mesh) => buildSdf(mesh.vertices, mesh.triangles, { cell: Math.max(0.6, radius * 0.7, cell), band });
  const bodies = [];
  groups.forEach((ids, key) => {
    const mesh = meshOf(ids);
    bodies.push({ sdf: sdfOf(mesh), movable: true, key, radiusMax: 200 });
  });
  // entorno fijo: la pieza sin las operaciones que se mueven (ni sus bocetos)
  const staticFeatures = part.features.filter((f) => !targetIds.has(f.id) && !part.features.some((g) => targetIds.has(g.id) && g.sketch === f.id));
  if (staticFeatures.some((f) => f.type !== 'sketch')) {
    const built = buildPart(rep, { ...part, features: staticFeatures });
    if (built.shape) bodies.push({ sdf: sdfOf(extractMesh(built.shape)), movable: false });
  }
  const sim = new ParticleSim(bodies, { ...materialPresets[preset], rate: 0, cap: 2000, maxCap: 2000, floorZ: -400, seed: 3, ...settings });
  sim.setScene({ actions: part.actions ?? [], nozzles: part.nozzles ?? [], sensors: simSensors({ sensors: part.sensors }), feeders: simFeeders({ feeders: part.feeders }) });
  return sim;
}

export const run = (sim, seconds, every = 0, onTick = null) => {
  for (let n = 0; n < Math.round(seconds * 60); n += 1) {
    sim.step(1 / 60);
    if (every && n % every === every - 1) onTick?.(sim, (n + 1) / 60);
  }
};
