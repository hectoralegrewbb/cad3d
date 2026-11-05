import { loadKernel } from '../src/kernel/occNode.js';
import { createKernelService } from '../src/kernel/kernelService.js';
import { templates } from '../src/data/templates.js';
import { createProject, addInstance } from '../src/core/projectModel.js';
const rep=await loadKernel(),service=createKernelService(rep);
for(const count of [1,10,40]){
  let project=createProject(templates.brida.build());
  for(let i=0;i<count;i++)project=addInstance(project,'p1',[i*150,0,0]);
  const started=performance.now();const result=service.handle('buildAssembly',{project,sharedItems:true});
  console.log(JSON.stringify({instances:count,ms:Math.round(performance.now()-started),sharedMeshes:Object.keys(result.sharedMeshes).length,kernelMB:Math.round(service.handle('memoryMB'))}));
}
