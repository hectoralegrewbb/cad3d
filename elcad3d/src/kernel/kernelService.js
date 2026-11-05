import { weldAssembly } from './assemblyWeld.js';
import { buildPart, hasMeshFeature, withoutSimplify } from './partBuilder.js';
import { extractMesh } from './meshExtractor.js';
import { removeBody } from './shapeOps.js';
import { exportStep, exportStl, exportMeshStl } from './exporters.js';
import { exportThreeMf } from './threeMf.js';
import { buildAssembly, placeShape, pruneAssemblyCache, safeTravel } from './assemblyBuilder.js';
import { buildDrawing } from '../drawing/buildDrawing.js';
import { buildAssemblyDrawing } from '../drawing/assemblyDrawing.js';
import { toDrawingData } from '../drawing/drawingData.js';
import { meshShape } from './batchMesh.js';

// Servicio del motor: todo lo que toca OpenCascade, sin UI ni DOM. Corre dentro del worker (kernelWorker.js)
// y directamente en Node (tests). Las formas viven acá (`current`, `assembly`); hacia afuera solo salen datos clonables.
const bodyColors = ['#d9a441', '#6fb7c4', '#c47f9b', '#7fb88a'];

const withDependents = (part, keep) => {
  let changed=true;
  while(changed){
    const size=keep.size;
    part.features.forEach(feature=>{
      if(keep.has(feature.id))for(const key of ['sketch','source','endSketch','pathSketch',...(feature.type==='pipe'?['from']:[])])if(feature[key])keep.add(feature[key]);
      if(feature.type==='pattern'&&keep.has(feature.source))keep.add(feature.id);
    });
    changed=size!==keep.size;
  }
  return keep;
};
const subsetOf = (part, keep) => ({ ...part, features: part.features.filter((feature) => keep.has(feature.id)) });
const projectHasMesh = (project) => Boolean(project?.parts?.some((entry) => hasMeshFeature(entry.part)));

export function createKernelService(rep) {
  let current = null; // { part, shape, build }
  let assembly = null;
  let assemblyProject = null;
  let assemblyHasMesh = false; // alguna pieza del ensamble construido trae una malla STL: las booleanas no deben re-unificar caras

  const deleteAll = (shapes) => shapes.forEach((shape) => shape?.delete?.());
  const disposeCurrent = () => {
    current?.shape?.delete?.();
    current = null;
  };
  const disposeAssembly = () => {
    if (!assembly) return;
    assembly.instances.forEach((inst) => inst.shape?.delete?.());
    assembly.compound?.delete?.();
    assembly = null;
    assemblyHasMesh = false;
  };

  // `whole` − cada cuerpo de `bodies`: lo que queda quieto. Devuelve la forma sobrante (o null) sin tocar `whole`.
  const remainder = (whole, bodies) => {
    let fixed = whole;
    bodies.forEach((body) => {
      if (!fixed) return;
      const next = removeBody(rep, fixed, body);
      if (fixed !== whole) fixed.delete?.();
      fixed = next;
    });
    return fixed;
  };

  const volumeOf = (shape) => {
    try {
      return shape ? rep.measureVolume(shape) : 0;
    } catch {
      return 0;
    }
  };

  // Cuerpos «solo malla» de la última construcción como ítems del visor.
  const meshOnlyItems = (part, build) => (build.meshOnly ?? []).map((data, index) => ({ id: index === 0 ? 'meshonly' : `meshonly${index}`, name: `${part.meta.name} (malla)`, data, color: '#9fb4cc' }));

  // Cuerpos separados según `spec` ({kind: 'groups'|'physics'|'motor'|'none', color, ...}).
  function splitItems(part, whole, specIn) {
    const spec = specIn ?? { kind: 'none', color: '#9fb4cc' };
    const single = [{ id: 'part', name: part.meta.name, data: whole.data, color: spec.color }];
    if (!spec || spec.kind === 'none' || !whole.shape) return { items: single, note: null };
    const bodies = [];
    try {
      if (spec.kind === 'motor') {
        const moving = buildPart(rep, subsetOf(part, withDependents(part, new Set(spec.chosen)))).shape;
        if (!moving) return { items: single, note: null };
        bodies.push(moving);
        const fixed = removeBody(rep, whole.shape, moving);
        try {
          return {
            items: [
              ...(fixed ? [{ id: 'static', name: `${part.meta.name} (fija)`, data: extractMesh(fixed), color: spec.color }] : []),
              { id: 'moving', name: `${part.meta.name} (gira)`, data: extractMesh(moving), color: '#d9a441' },
            ],
            note: null,
          };
        } finally {
          fixed?.delete?.();
        }
      }
      const defs = spec.kind === 'groups'
        ? spec.groups.map((group) => ({ id: `grp:${group.key}`, name: group.key, part: subsetOf(part, withDependents(part, new Set(group.targets))), missing: 'un grupo no se pudo construir' }))
        : spec.gears.map((gear) => ({ id: gear.id, name: gear.name, part: { ...part, features: part.features.filter((feature) => feature.id === gear.id) }, missing: 'un engranaje no se pudo construir' }));
      const items = defs.map((def, index) => {
        const shape = buildPart(rep, def.part).shape;
        if (!shape) throw new Error(def.missing);
        bodies.push(shape);
        return { id: def.id, name: def.name, data: extractMesh(shape), color: bodyColors[index % bodyColors.length] };
      });
      const fixed = remainder(whole.shape, bodies);
      try {
        const leftover = fixed ? volumeOf(fixed) : 0;
        const staticItems = leftover > 1e-3 ? [{ id: 'static', name: `${part.meta.name} (fija)`, data: extractMesh(fixed), color: spec.color }] : [];
        return { items: [...staticItems, ...items], note: null };
      } finally {
        if (fixed && fixed !== whole.shape) fixed.delete?.();
      }
    } catch (error) {
      const label = { groups: 'Acciones: no se pudo separar lo que se mueve', physics: 'Físicas: no se pudo separar los engranajes', motor: 'Motor: no se pudo separar lo que gira' }[spec.kind];
      return { items: single, note: `${label} (${error.message})` };
    } finally {
      deleteAll(bodies);
    }
  }

  const methods = {
    weldAssembly({ project, ids }) {
      const built = buildAssembly(rep, project, { checkInterference: false });
      try { return weldAssembly(rep, built, ids); }
      finally {
        built.instances.forEach(instance => instance.shape?.delete?.());
        built.compound?.delete?.();
      }
    },
    async importStep({ buffer }) {
      if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>100*1024*1024)throw new Error('STEP inválido o mayor que 100 MiB');
      const text=new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(1024,buffer.byteLength)));
      if(!/ISO-10303-21/.test(text))throw new Error('El archivo no es un STEP de texto compatible');
      const shape=await rep.importSTEP(new Blob([buffer]));
      try { if(shape.isNull)throw new Error('STEP sin geometría'); return {brep:shape.serialize()}; }
      finally { shape.delete?.(); }
    },
    // Reconstruye la pieza y deja la forma como `current` (la anterior se libera).
    build({ part, stopBefore = null, split = null }) {
      const started = Date.now();
      const build = buildPart(rep, part, { stopBefore });
      disposeCurrent();
      current = { part, shape: build.shape ?? null, build };
      const notes = [];
      let data = null;
      if (build.shape) {
        try {
          data = extractMesh(build.shape);
        } catch (error) {
          notes.push({ text: `No se pudo mallar: ${error.message}`, error: true });
        }
      }
      let items = [];
      if (data) {
        const separated = splitItems(part, { shape: build.shape, data }, split);
        items = separated.items;
        if (separated.note) notes.push({ text: separated.note, error: true });
      }
      // mallas en modo «solo malla»: se muestran y simulan directo, sin forma B-Rep
      const meshItems = meshOnlyItems(part, build);
      items = [...items, ...meshItems];
      const sizeData = data ?? meshItems[0]?.data ?? null;
      return {
        hasShape: Boolean(build.shape) || meshItems.length > 0,
        meshOnly: meshItems.length > 0 && !build.shape,
        results: build.results,
        params: build.params,
        paramErrors: build.paramErrors,
        solids: build.solids ?? 1,
        size: sizeData?.bounds.size ?? null,
        items,
        notes,
        ms: Date.now() - started,
      };
    },

    // Vuelve a separar los cuerpos con la última construcción (sin recalcular la pieza).
    resplit({ split }) {
      if (!current?.shape) return { items: current ? meshOnlyItems(current.part, current.build) : [], notes: [] };
      const data = extractMesh(current.shape);
      const { items, note } = splitItems(current.part, { shape: current.shape, data }, split);
      return { items, notes: note ? [{ text: note, error: true }] : [] };
    },

    // Plano de la pieza actual (o de otra construcción del documento actual).
    drawing({ part }) {
      if (!current?.shape) throw new Error('No hay geometría para el plano');
      return toDrawingData(buildDrawing(rep, current.shape, part));
    },

    assemblyDrawing({ doc }) {
      if (!assembly) throw new Error('El ensamble no está construido');
      if (assembly.instances.some((i) => i.meshOnly)) throw new Error('Los planos requieren sólidos B-Rep; el conjunto incluye cuerpos solo malla.');
      const simplified = buildAssembly(rep, assemblyProject, { forDrawing: true, checkInterference: false });
      simplified.totalMass=assembly.totalMass;
      simplified.bom=simplified.bom.map(row=>({...row,unitMass:assembly.bom.find(r=>r.partId===row.partId)?.unitMass??row.unitMass}));
      try { return toDrawingData(buildAssemblyDrawing(rep, simplified, doc)); }
      finally { simplified.instances.forEach((i) => i.shape?.delete?.()); simplified.compound?.delete?.(); }
    },

    // Malla de la pieza antes de la operación que consume el boceto (papel cebolla del editor de bocetos).
    referenceMesh({ part, stopBefore = null }) {
      const built = buildPart(rep, part, { stopBefore });
      try {
        if (!built.shape) return null;
        const raw = meshShape(built.shape, { tolerance: 0.03, angularTolerance: 0.1 });
        return { vertices: Float32Array.from(raw.vertices), triangles: Uint32Array.from(raw.triangles) };
      } finally {
        if (built.shape && built.shape !== current?.shape) built.shape.delete?.();
      }
    },

    // Centro de la caja envolvente de lo elegido (pivote sugerido). En conjunto, de las instancias; en pieza, de cada operación sola.
    centerOf({ scope, ids, part = null }) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const grow = (shape) => {
        const [lo, hi] = shape.boundingBox.bounds;
        [0, 1, 2].forEach((k) => {
          min[k] = Math.min(min[k], lo[k]);
          max[k] = Math.max(max[k], hi[k]);
        });
      };
      if (scope === 'asm') {
        assembly?.instances.filter((inst) => ids.includes(inst.id)).forEach((inst) => grow(inst.shape));
      } else {
        ids.forEach((id) => {
          const keep = new Set([id]);
          withDependents(part,keep);
          try {
            const shape = buildPart(rep, subsetOf(part, keep)).shape;
            if (shape) {
              grow(shape);
              shape.delete?.();
            }
          } catch {
            /* operación sin geometría */
          }
        });
      }
      return Number.isFinite(min[0]) ? min.map((v, k) => (v + max[k]) / 2) : null;
    },

    // Exporta la forma actual (pieza) o el ensamble: devuelve un Blob.
    export({ kind, scope, name }) {
      if (scope === 'asm') {
        if(assembly?.parts.some(p=>Object.values(p.results).some(r=>r.status==='error')))throw new Error('Corregí las operaciones con error antes de exportar el conjunto');
        if (!assembly?.instances.length) throw new Error('El ensamble está vacío');
        if (kind === 'stl') return exportMeshStl(assembly.instances.map((i) => i.mesh));
        if (kind === 'step') { if (assembly.instances.some((i) => i.meshOnly)) throw new Error('STEP requiere sólidos: el conjunto contiene cuerpos solo malla. Exportá STL o 3MF.'); return exportStep(assembly.compound); }
        return exportThreeMf(assembly.instances.map((inst) => ({ name: `${inst.name} (${inst.id})`, shape: inst.shape, mesh: inst.mesh })));
      }
      if(current && Object.values(current.build.results).some(r=>r.status==='error'))throw new Error('Corregí las operaciones con error antes de exportar');
      if (current?.build.meshOnly?.length) {
        if (kind === 'step') throw new Error('STEP requiere sólidos B-Rep. Esta pieza contiene cuerpos solo malla.');
        const meshes = [...(current.shape ? [extractMesh(current.shape)] : []), ...current.build.meshOnly];
        return kind === 'stl' ? exportMeshStl(meshes) : exportThreeMf(meshes.map((mesh, i) => ({ name: `${name} ${i+1}`, mesh })));
      }
      if (!current?.shape) throw new Error('No hay geometría para exportar');
      if (kind === 'stl') return exportStl(current.shape);
      if (kind === 'step') return exportStep(current.shape);
      return exportThreeMf([{ name, shape: current.shape }]);
    },

    // Reconstruye el ensamble. Devuelve instancias (sin formas), interferencias, lista de materiales y la malla de cada instancia.
    buildAssembly({ project, withItems = true, sharedItems = false }) {
      const previous = assembly;
      assembly = null;
      try {
        assemblyProject = project;
        assembly = buildAssembly(rep, project);
      } catch (error) {
        previous?.instances.forEach((inst) => inst.shape?.delete?.());
        previous?.compound?.delete?.();
        throw error;
      }
      previous?.instances.forEach((inst) => inst.shape?.delete?.());
      previous?.compound?.delete?.();
      assemblyHasMesh = projectHasMesh(project);
      const { parts, partById, instances, ...rest } = assembly;
      return {
        instances: instances.map(({ shape, mesh, ...inst }) => inst),
        interferences: rest.interferences,
        bom: rest.bom,
        itemOfInstance: rest.itemOfInstance,
        totalMass: rest.totalMass,
        errors: parts.filter(p=>instances.some(i=>i.partId===p.id)).flatMap(p=>Object.entries(p.results).filter(([,r])=>r.status==='error').map(([id,r])=>({partId:p.id,id,error:r.error}))),
        unchecked: instances.filter(i=>i.meshOnly).map(i=>i.id),
        hasCompound: instances.length > 0,
        sharedMeshes: withItems && sharedItems ? Object.fromEntries(parts.filter(p=>p.mesh).map(p=>[p.id,structuredClone(p.mesh)])) : null,
        meshes: withItems && !sharedItems ? Object.fromEntries(instances.map((inst) => [inst.id, structuredClone(inst.mesh)])) : null,
      };
    },

    measureBodies({ first, second }) {
      const a=assembly?.instances.find(i=>i.id===first),b=assembly?.instances.find(i=>i.id===second);
      if(!a?.shape||!b?.shape||a.meshOnly||b.meshOnly)throw new Error('La distancia mínima precisa requiere dos instancias B-Rep del conjunto');
      if(first===second)throw new Error('Elegí dos instancias distintas');
      const tool=new rep.DistanceTool();
      try { return {distance:tool.distanceBetween(a.shape,b.shape)}; }
      finally { tool.delete(); }
    },

    safeTravel({ ids, delta }) {
      if (!assembly) return { t: 1, blockedBy: null };
      if(assembly.instances.some(i=>i.meshOnly))throw new Error('La verificación precisa de choques requiere sólidos B-Rep. Desactivá el bloqueo de movimiento para mover mallas.');
      return safeTravel(rep, assembly, ids, delta);
    },

    disposeAssembly() {
      disposeAssembly();
      pruneAssemblyCache(null);
      return true;
    },

    // Posición para una instancia nueva de `partId`: a la derecha de todo lo que ya hay (+10 mm).
    nextInstancePos({ project, partId }) {
      const entry = project.parts.find((item) => item.id === partId);
      if (!project.instances.length || !entry) return [0, 0, 0];
      const built=buildPart(rep,entry.part),shape=built.shape;
      const meshBounds=built.meshOnly?.[0]?.bounds;
      const bounds = shape?.boundingBox.bounds ?? (meshBounds?[meshBounds.min,meshBounds.max]:null);
      shape?.delete?.();
      if (!bounds) return [0, 0, 0];
      const maxX = Math.max(...project.instances.map((inst) => {
        const live = assembly?.instances.find((item) => item.id === inst.id)?.bounds;
        if (live) return live[1][0];
        const source = project.parts.find((item) => item.id === inst.partId);
        const base = source && buildPart(rep, source.part).shape;
        if (!base) return inst.pos[0];
        const placed = placeShape(base, inst);
        const x = placed.boundingBox.bounds[1][0];
        placed.delete?.();
        base.delete?.();
        return x;
      }));
      return [Math.round((maxX + 10 - bounds[0][0]) * 1000) / 1000, 0, 0];
    },

    memoryMB() {
      return (rep.getOC?.().wasmMemory?.buffer?.byteLength ?? 0) / 1048576;
    },

    ping() {
      return true;
    },
  };

  return {
    handle(type, payload = {}) {
      const method = methods[type];
      if (!method) throw new Error(`Pedido desconocido al motor: ${type}`);
      const meshy = hasMeshFeature(payload.part) || projectHasMesh(payload.project) || hasMeshFeature(current?.part) || assemblyHasMesh;
      return withoutSimplify(meshy, () => method(payload));
    },
  };
}
