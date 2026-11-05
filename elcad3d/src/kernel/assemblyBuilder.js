import { solveAssemblyMates } from '../core/assemblyMates.js';
import { extractMesh } from './meshExtractor.js';
import { transformMesh, mergeMeshData } from '../core/meshTransform.js';
import { buildPart } from './partBuilder.js';
import { massKg, meshVolume } from '../drawing/features3d.js';
import { gearFeatureSpecs } from './gearGeometry.js';
import { evaluateParams } from '../core/expression.js';
import { findLinks, solveTrain, worldGears } from '../core/kinematics.js';
import { meshShape } from './batchMesh.js';

// Posiciona una instancia: rotaciones en grados alrededor de X, Y y Z (en ese orden, sobre el origen de la pieza) y luego traslación.
export function placeShape(shape, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  let placed = shape.clone();
  [[rot[0], [1, 0, 0]], [rot[1], [0, 1, 0]], [rot[2], [0, 0, 1]]].forEach(([angle, axis]) => {
    if (Math.abs(angle) > 1e-9) placed = placed.rotate(angle, [0, 0, 0], axis);
  });
  return placed.translate(pos[0], pos[1], pos[2]);
}

const overlap = (a, b) => [0, 1, 2].every((i) => a[0][i] < b[1][i] - 1e-6 && b[0][i] < a[1][i] - 1e-6);

// Caché de piezas ya construidas (clave = contenido de la pieza): mover una instancia no debe reconstruir todas las piezas.
// El caché es dueño de las formas base; las instancias llevan copias. `pruneAssemblyCache` libera las que ya no se usan.
const partCache = new Map();
const partKey = (part, forDrawing = false) => JSON.stringify([part.params, part.features, part.meta?.material ?? '', forDrawing]);
export function pruneAssemblyCache(project = null) {
  const keep = new Set((project?.parts ?? []).flatMap((item) => [partKey(item.part), partKey(item.part, true)]));
  [...partCache.entries()].forEach(([key, entry]) => {
    if (keep.has(key)) return;
    entry.shape?.delete?.();
    partCache.delete(key);
  });
}

// Reconstruye las piezas del proyecto (las que no cambiaron salen del caché) y arma el ensamble: instancias, interferencias y lista de materiales.
export function buildAssembly(rep, project, { checkInterference = true, forDrawing = false } = {}) {
  project = solveAssemblyMates(project);
  const parts = project.parts.map((item) => {
    const key = partKey(item.part, forDrawing);
    let entry = partCache.get(key);
    if (!entry) {
      const built = buildPart(rep, item.part, { forDrawing });
      const meshOnly = built.meshOnly ?? [];
      const data = [ ...(built.shape ? [extractMesh(built.shape)] : []), ...meshOnly ];
      const volume = (built.shape ? rep.measureVolume(built.shape) : 0) + meshOnly.reduce((sum, m) => sum + meshVolume(m), 0);
      entry = { shape: built.shape, mesh: data.length ? mergeMeshData(data) : null, meshOnly: meshOnly.length > 0, results: built.results, volume, massKg: massKg(volume, item.part.meta.material ?? '') };
      partCache.set(key, entry);
    }
    return { id: item.id, part: item.part, shape: entry.shape, mesh: entry.mesh, meshOnly: entry.meshOnly, results: entry.results, volume: entry.volume, massKg: entry.massKg };
  });
  pruneAssemblyCache(project);
  const partById = Object.fromEntries(parts.map((part) => [part.id, part]));
  const instances = project.instances
    .filter((inst) => partById[inst.partId]?.mesh)
    .map((inst) => {
      const part = partById[inst.partId];
      const shape = part.shape ? placeShape(part.shape, inst) : null;
      const mesh = transformMesh(part.mesh, inst);
      return { ...inst, shape, mesh, meshOnly: part.meshOnly, bounds: [mesh.bounds.min, mesh.bounds.max], name: part.part.meta.name };
    });

  const interferences = [];
  if (checkInterference) {
    // Sweep-and-prune: descartar pares separados en X antes de las booleanas.
    const ordered = instances.filter((item) => item.shape && !item.meshOnly).sort((a,b) => a.bounds[0][0]-b.bounds[0][0]);
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length && ordered[j].bounds[0][0] < ordered[i].bounds[1][0]; j += 1) {
        const a = ordered[i], b = ordered[j];
        if (!overlap(a.bounds, b.bounds)) continue;
        try {
          const common = a.shape.intersect(b.shape);
          const volume = rep.measureVolume(common);
          common.delete?.();
          if (volume > 1) interferences.push({ a: a.id, b: b.id, volume });
        } catch {
          interferences.push({ a: a.id, b: b.id, volume: NaN });
        }
      }
    }
  }

  // Lista de materiales: una fila por pieza usada, con la cantidad de instancias (orden de primera aparición).
  const bom = [];
  instances.forEach((inst) => {
    let row = bom.find((item) => item.partId === inst.partId);
    if (!row) {
      const part = partById[inst.partId];
      row = { item: bom.length + 1, partId: inst.partId, name: part.part.meta.name, material: part.part.meta.material ?? '', qty: 0, unitMass: part.massKg, instances: [] };
      bom.push(row);
    }
    row.qty += 1;
    row.instances.push(inst.id);
  });
  const itemOfInstance = Object.fromEntries(bom.flatMap((row) => row.instances.map((id) => [id, row.item])));
  const totalMass = bom.reduce((sum, row) => sum + row.qty * row.unitMass, 0);
  const solids = instances.filter((inst) => inst.shape);
  const compound = solids.length ? rep.makeCompound(solids.map((inst) => inst.shape.clone())) : null;
  return { parts, partById, instances, interferences, bom, itemOfInstance, totalMass, compound };
}

// Coloca `instance` apoyada sobre `target` (cara superior del recuadro) y centrada en X/Y: ayuda rápida de ensamble.
export function stackOn(instance, target) {
  const dz = target.bounds[1][2] - instance.bounds[0][2];
  const cx = (a) => (a.bounds[0][0] + a.bounds[1][0]) / 2;
  const cy = (a) => (a.bounds[0][1] + a.bounds[1][1]) / 2;
  const pos = [instance.pos[0] + cx(target) - cx(instance), instance.pos[1] + cy(target) - cy(instance), instance.pos[2] + dz];
  return pos.map((v) => Math.round(v * 1000) / 1000);
}

// Engranajes de todas las instancias del proyecto (en coordenadas del mundo).
export function projectGears(project) {
  const cache = {};
  const specsOf = (partId) => {
    if (!cache[partId]) {
      const part = project.parts.find((item) => item.id === partId)?.part;
      cache[partId] = part ? gearFeatureSpecs(part, evaluateParams(part.params).values) : [];
    }
    return cache[partId];
  };
  return project.instances.flatMap((inst) => worldGears(inst, specsOf(inst.partId)));
}

// Ids de las instancias que tienen al menos un engranaje.
export const geared = (project) => [...new Set(projectGears(project).map((gear) => gear.instance))];

// Tren de engranajes para un motor en `driverId`: pares, relaciones y fases (ver core/kinematics.js).
export function assemblyTrain(project, driverId, options = {}) {
  const gears = projectGears(project);
  const links = findLinks(gears);
  return { ...solveTrain(gears, driverId, { links, ...options }), links };
}

const sweptBox = (a, b) => [0, 1, 2].map((i) => [Math.min(a[0][i], b[0][i]), Math.max(a[1][i], b[1][i])]).reduce((box, [lo, hi], i) => { box[0][i] = lo; box[1][i] = hi; return box; }, [[0, 0, 0], [0, 0, 0]]);

// Cuánto se puede desplazar el grupo `ids` por `delta` ([x,y,z] mm) antes de chocar con el resto del ensamble.
// Devuelve { t, blockedBy }: t ∈ [0,1] es la fracción libre del desplazamiento. Choque = volumen común > minVolume mm³.
// Los pares que ya interferían antes de mover se ignoran (si no, no habría forma de separarlos).
export function safeTravel(rep, built, ids, delta, { minVolume = 1, refine = 7 } = {}) {
  const moving = built.instances.filter((inst) => inst.shape && ids.includes(inst.id));
  const others = built.instances.filter((inst) => inst.shape && !ids.includes(inst.id));
  const length = Math.hypot(...delta);
  if (!moving.length || !others.length || length < 1e-9) return { t: 1, blockedBy: null };
  const already = new Set(built.interferences.flatMap((hit) => [`${hit.a}|${hit.b}`, `${hit.b}|${hit.a}`]));
  const endBounds = (inst) => [inst.bounds[0].map((v, i) => v + delta[i]), inst.bounds[1].map((v, i) => v + delta[i])];
  // Solo cuentan los que están en el barrido del recuadro (inicio → fin).
  const candidates = others.filter((other) => moving.some((inst) => {
    const swept = sweptBox(inst.bounds, endBounds(inst));
    return overlap(swept, other.bounds);
  }));
  if (!candidates.length) return { t: 1, blockedBy: null };
  const blockerAt = (t) => {
    for (const inst of moving) {
      const shifted = inst.shape.clone().translate(delta[0] * t, delta[1] * t, delta[2] * t);
      try {
        const box = shifted.boundingBox.bounds;
        for (const other of candidates) {
          if (already.has(`${inst.id}|${other.id}`) || !overlap(box, other.bounds)) continue;
          const common = shifted.intersect(other.shape);
          const volume = rep.measureVolume(common);
          common.delete?.();
          if (volume > minVolume) return other.id;
        }
      } finally {
        shifted.delete?.();
      }
    }
    return null;
  };
  const samples = Math.min(24, Math.max(4, Math.ceil(length / 3)));
  let free = 0;
  let blocked = null;
  let blockedBy = null;
  for (let k = 1; k <= samples && blocked === null; k += 1) {
    const hit = blockerAt(k / samples);
    if (hit) {
      blocked = k / samples;
      blockedBy = hit;
    } else free = k / samples;
  }
  if (blocked === null) return { t: 1, blockedBy: null };
  let lo = free;
  let hi = blocked;
  for (let i = 0; i < refine; i += 1) {
    const mid = (lo + hi) / 2;
    if (blockerAt(mid)) hi = mid;
    else lo = mid;
  }
  return { t: lo, blockedBy };
}
