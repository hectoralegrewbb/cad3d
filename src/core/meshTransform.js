// Transformaciones rígidas de mallas: mismo orden X/Y/Z que placeShape.
export function transformMesh(data, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  const angles = rot.map((v) => v * Math.PI / 180);
  const point = (v, translate = true) => {
    let [x, y, z] = v;
    let c = Math.cos(angles[0]), s = Math.sin(angles[0]); [y, z] = [c*y-s*z, s*y+c*z];
    c = Math.cos(angles[1]); s = Math.sin(angles[1]); [x, z] = [c*x+s*z, -s*x+c*z];
    c = Math.cos(angles[2]); s = Math.sin(angles[2]); [x, y] = [c*x-s*y, s*x+c*y];
    return translate ? [x+pos[0], y+pos[1], z+pos[2]] : [x,y,z];
  };
  const apply = (array, translate) => {
    const out = new Float32Array(array.length);
    for (let i=0;i<array.length;i+=3) out.set(point(array.slice(i,i+3), translate),i);
    return out;
  };
  const vertices = apply(data.vertices,true);
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=3) for(let k=0;k<3;k++){min[k]=Math.min(min[k],vertices[i+k]);max[k]=Math.max(max[k],vertices[i+k]);}
  return { ...data, vertices, normals: apply(data.normals,false), triangles: new Uint32Array(data.triangles),
    edges: data.edges.map((e)=>({...e,points:apply(e.points,true),mid:point(e.mid)})),
    bounds:{min,max,size:max.map((v,k)=>v-min[k])} };
}
export function mergeMeshData(items) {
  const vertices=[],normals=[],triangles=[],edges=[];
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for(const data of items){
    const offset=vertices.length/3;
    for(const v of data.vertices)vertices.push(v);
    for(const n of data.normals)normals.push(n);
    for(const t of data.triangles)triangles.push(t+offset);
    edges.push(...data.edges);
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],data.bounds.min[k]);max[k]=Math.max(max[k],data.bounds.max[k]);}
  }
  return {vertices:Float32Array.from(vertices),normals:Float32Array.from(normals),triangles:Uint32Array.from(triangles),edges,bounds:{min,max,size:max.map((v,k)=>v-min[k])}};
}
