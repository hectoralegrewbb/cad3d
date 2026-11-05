// Exportaciones de la pieza. STL con tolerancia razonable (la de fábrica genera archivos enormes).
export const exportStl = (shape, { tolerance = 0.02, angularTolerance = 0.1, binary = true } = {}) => shape.blobSTL({ tolerance, angularTolerance, binary });
export const exportStep = (shape) => shape.blobSTEP();


// STL binario para cuerpos B-Rep y mallas sin convertir a sólidos.
export function exportMeshStl(meshes) {
  const count = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0);
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer); view.setUint32(80, count, true);
  let at = 84;
  for (const mesh of meshes) for (let t = 0; t < mesh.triangles.length; t += 3) {
    const points = [0,1,2].map((k) => Array.from(mesh.vertices.slice(mesh.triangles[t+k]*3,mesh.triangles[t+k]*3+3)));
    const a=points[1].map((v,k)=>v-points[0][k]), b=points[2].map((v,k)=>v-points[0][k]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const len=Math.hypot(...n)||1;
    for(const value of [...n.map(v=>v/len),...points.flat()]){view.setFloat32(at,value,true);at+=4;}
    at+=2;
  }
  return new Blob([buffer], {type:'application/sla'});
}
