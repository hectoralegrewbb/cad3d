import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
if(!process.env.ELCAD_VIEWER_TEST){
  const result=spawnSync(process.execPath,['--experimental-loader','./scripts/three-loader.mjs','tests/viewerShared.test.mjs'],{encoding:'utf8',env:{...process.env,ELCAD_VIEWER_TEST:'1'}});
  assert.equal(result.status,0,result.stdout+result.stderr);console.log('viewerShared OK');
}else{
  const THREE=await import('../vendor/three/three.module.js');
  const {Viewer}=await import('../src/viewer/viewer.js');
  const viewer=Object.create(Viewer.prototype);
  Object.assign(viewer,{scene:new THREE.Scene(),modelGroup:new THREE.Group(),edgeGroup:new THREE.Group(),grid:new THREE.GridHelper(100,10),renderMode:'solid',meshListeners:[],render(){}});
  const data={vertices:Float32Array.from([0,0,0,10,0,0,0,10,0]),normals:Float32Array.from([0,0,1,0,0,1,0,0,1]),triangles:Uint32Array.from([0,1,2]),edges:[],bounds:{min:[0,0,0],max:[10,10,0],size:[10,10,0]}};
  viewer.setMeshes([{id:'a',data,transform:{pos:[20,30,40],rot:[0,0,90]},bounds:{min:[10,30,40],max:[20,40,40],size:[10,10,0]}},{id:'b',data,transform:{pos:[50,0,0],rot:[0,0,0]},bounds:{min:[50,0,0],max:[60,10,0],size:[10,10,0]}}]);
  assert.equal(viewer.modelGroup.children[0].geometry,viewer.modelGroup.children[1].geometry,'una geometría GPU por pieza');
  const world=viewer.itemGeometry('a');
  assert.ok(Math.abs(world.vertices[3]-20)<1e-5&&Math.abs(world.vertices[4]-40)<1e-5,'colisión en coordenadas del mundo');
  viewer.setBodyPose(['a'],{axis:[0,0,1],pivot:[0,0,0],offset:[5,0,0]});
  assert.ok(Math.abs(viewer.modelGroup.children[0].matrix.elements[12]-25)<1e-5,'la previsualización conserva la colocación base');
  viewer.clearBodyAngle();assert.ok(Math.abs(viewer.modelGroup.children[0].matrix.elements[12]-20)<1e-5,'restaurar pose base');
  assert.deepEqual(viewer.bounds.min,[10,0,0]);assert.deepEqual(viewer.bounds.max,[60,40,40]);
  viewer.setMeshes([]);
}
