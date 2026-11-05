import assert from 'node:assert/strict';
import { loadKernel } from '../src/kernel/occNode.js';
import { createKernelService } from '../src/kernel/kernelService.js';
import { createLocalClient } from '../src/kernel/kernelClient.js';
import { collectTransfers } from '../src/kernel/transfer.js';
import { fromDrawingData } from '../src/drawing/drawingData.js';
import { templates } from '../src/data/templates.js';
import * as projects from '../src/core/projectModel.js';

const rep = await loadKernel();
const kernel = createLocalClient(createKernelService(rep));
const clones = (value) => structuredClone(value, { transfer: collectTransfers(value) });

// 1) construir una pieza: el resultado cruza structuredClone y trae la malla
{
  const part = templates.brida.build();
  const built = clones(await kernel.request('build', { part, split: { kind: 'none', color: '#999999' } }));
  assert.ok(built.hasShape && built.items.length === 1 && built.items[0].data.vertices.length > 0);
  assert.ok(built.size.every((v) => v > 0));
  assert.equal(built.solids, 1);
}

// 2) separar cuerpos (grupos) y volver a separar sin reconstruir
{
  const part = templates.eje.build();
  const target = part.features.find((feature) => feature.type === 'extrude' || feature.type === 'revolve');
  const split = { kind: 'groups', color: '#999999', groups: [{ key: 'eje', targets: [target.id] }] };
  const built = await kernel.request('build', { part, split });
  assert.ok(built.items.some((item) => item.id === 'grp:eje'));
  const again = await kernel.request('resplit', { split });
  assert.deepEqual(again.items.map((item) => item.id), built.items.map((item) => item.id));
}

// 3) plano: datos puros y svg reconstruido afuera
{
  const part = templates.brida.build();
  await kernel.request('build', { part });
  const data = clones(await kernel.request('drawing', { part }));
  const drawing = fromDrawingData(data);
  assert.ok(drawing.primitives.length > 10 && drawing.svg().startsWith('<svg'));
  assert.ok(drawing.viewModels.every((view) => typeof view.map === 'undefined'));
}

// 4) exportar devuelve Blob
{
  const part = templates.brida.build();
  await kernel.request('build', { part });
  const blob = await kernel.request('export', { kind: 'stl', scope: 'part', name: 'x' });
  assert.ok(blob.size > 1000);
}

// 5) ensamble: instancias sin formas, malla por instancia, desplazamiento seguro y borrado
{
  let project = projects.createProject(templates.brida.build());
  const partId = project.parts[0].id;
  project = projects.addInstance(project, partId, [0, 0, 0]);
  const pos = await kernel.request('nextInstancePos', { project, partId });
  project = projects.addInstance(project, partId, pos);
  const built = clones(await kernel.request('buildAssembly', { project }));
  assert.equal(built.instances.length, 2);
  assert.ok(built.instances.every((inst) => inst.shape === undefined && inst.bounds));
  assert.ok(Object.keys(built.meshes).length === 2 && built.totalMass >= 0);
  const asm = clones(await kernel.request('assemblyDrawing', { doc: project.assembly ?? templates.brida.build() }));
  assert.ok(asm.primitives.length > 0);
  const travel = await kernel.request('safeTravel', { ids: [built.instances[1].id], delta: [-200, 0, 0] });
  assert.ok(travel.t >= 0 && travel.t <= 1);
  assert.equal(await kernel.request('disposeAssembly'), true);
}

// 6) pedido desconocido → rechazo
await assert.rejects(() => kernel.request('nope'), /desconocido/);
console.log('kernelService.test OK');
