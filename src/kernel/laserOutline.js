// Contornos de una cara plana del sólido B-Rep para corte láser: lazo exterior + lazos interiores (agujeros, chaflanes de boceto, etc.)
// tal como están en la pieza. Devuelve datos planos (clonables, sin objetos del kernel): el marco 3D de la cara y, por lazo, sus tramos.
// Tramo: { type: 'line', p0, p1 } | { type: 'arc', p0, pm, p1 } (pm = punto medio) | { type: 'circle', pts: [a, b, c] } | { type: 'poly', points, closed }.
const CURVE_TOLERANCE = 0.02;
const MAX_CURVE_POINTS = 4096;

const tuple = (vector) => {
  const out = [vector.x, vector.y, vector.z];
  vector.delete?.();
  return out;
};

function edgeItem(edge) {
  const type = edge.geomType;
  if (type === 'LINE') return { type: 'line', p0: tuple(edge.startPoint), p1: tuple(edge.endPoint) };
  if (type === 'CIRCLE') {
    if (edge.isClosed) return { type: 'circle', pts: [0, 1 / 3, 2 / 3].map((t) => tuple(edge.pointAt(t))) };
    return { type: 'arc', p0: tuple(edge.startPoint), pm: tuple(edge.pointAt(0.5)), p1: tuple(edge.endPoint) };
  }
  // Elipse, spline u otra curva: se muestrea (no hay entidad DXF equivalente sin perder exactitud en R12).
  const points=[tuple(edge.pointAt(0))];
  const deviation=(p,a,b)=>{const ab=b.map((x,k)=>x-a[k]),ap=p.map((x,k)=>x-a[k]),den=ab.reduce((s,x)=>s+x*x,0),t=den?Math.max(0,Math.min(1,ab.reduce((s,x,k)=>s+x*ap[k],0)/den)):0;return Math.hypot(...ap.map((x,k)=>x-t*ab[k]));};
  const sample=(t0,t1,a,b,depth)=>{const mid=(t0+t1)/2,m=tuple(edge.pointAt(mid)),q1=tuple(edge.pointAt((t0+mid)/2)),q3=tuple(edge.pointAt((mid+t1)/2));const error=Math.max(deviation(m,a,b),deviation(q1,a,b),deviation(q3,a,b));if(error>CURVE_TOLERANCE){if(depth>=16)throw new Error('La curva no alcanza la tolerancia de corte. Simplificá el perfil.');sample(t0,mid,a,m,depth+1);sample(mid,t1,m,b,depth+1);}else{points.push(b);if(points.length>MAX_CURVE_POINTS)throw new Error('La curva excede 4096 puntos de corte. Simplificá el perfil.');}};
  for(let i=0;i<8;i++)sample(i/8,(i+1)/8,points[points.length-1],tuple(edge.pointAt((i+1)/8)),0);
  return {type:'poly',points,closed:edge.isClosed};
}

function wireLoop(wire, outer) {
  const edges = wire.edges;
  try {
    return { outer, items: edges.map(edgeItem) };
  } finally {
    edges.forEach((edge) => edge.delete());
    wire.delete();
  }
}

// Marco de la cara visto desde afuera: u hacia la derecha, v hacia arriba, normal hacia el observador (sin espejar).
function faceFrame(normal, origin) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const n = unit(normal);
  const u = Math.abs(n[2]) > 0.9 ? unit([1-n[0]*n[0],-n[0]*n[1],-n[0]*n[2]]) : unit(cross([0, 0, 1], n));
  return { origin, normal: n, u, v: cross(n, u), dot };
}

// Elige la cara plana más grande (o la de `faceId`, el hashCode que devuelve el visor) y extrae sus lazos.
export function planarFaceLoops(rep, shape, { faceId, faceIndex } = {}) {
  if (!shape) throw new Error('El DXF para láser requiere un sólido B-Rep.');
  const faces = shape.faces;
  try {
    let best = null;
    faces.forEach((face,index) => {
      if(faceIndex!==undefined&&index!==faceIndex)return;
      if (faceId !== undefined && face.hashCode !== faceId) return;
      if (face.geomType !== 'PLANE') return;
      const area = rep.measureArea(face);
      if (!best || area > best.area) best = { face, area };
    });
    if (!best) throw new Error(faceId !== undefined ? 'La cara elegida no es plana: el láser corta contornos planos.' : 'La pieza no tiene caras planas para cortar con láser.');
    const normalVector = best.face.normalAt();
    const normal = [normalVector.x, normalVector.y, normalVector.z];
    normalVector.delete();
    const center = best.face.center;
    const origin = [center.x, center.y, center.z];
    center.delete();
    const { u, v, normal: n } = faceFrame(normal, origin);
    const loops = [wireLoop(best.face.clone().outerWire(), true), ...best.face.clone().innerWires().map((wire) => wireLoop(wire, false))];
    const vertices=[...rep.iterTopo(shape.wrapped,'vertex')].map(vertex=>rep.cast(vertex));let min=Infinity,max=-Infinity;
    try{for(const vertex of vertices){const point=vertex.asTuple(),projection=point.reduce((sum,x,k)=>sum+x*n[k],0);min=Math.min(min,projection);max=Math.max(max,projection);}}finally{vertices.forEach(vertex=>vertex.delete());}
    const thickness=max-min,volume=rep.measureVolume(shape),prismatic=Number.isFinite(thickness)&&thickness>1e-7&&Math.abs(volume-best.area*thickness)<=Math.max(1e-4,Math.abs(volume)*1e-5);
    const approximate=loops.some(loop=>loop.items.some(item=>item.type==='poly'));
    return { frame: { origin, normal: n, u, v }, loops, area: best.area,assessment:{thickness,prismatic,approximate,samplingTolerance:CURVE_TOLERANCE,reason:prismatic?'Perfil compatible por volumen y espesor; verificar material y fabricación.':'Perfil de una cara: el sólido tiene escalones, rebajes, múltiples cuerpos o espesor variable. No es un desarrollo de chapa.'} };
  } finally {
    faces.forEach((face) => face.delete());
  }
}

export function planarFaces(rep,shape){
  if(!shape)throw new Error('No hay un sólido B-Rep para corte láser.');
  const faces=shape.faces;
  try{return faces.flatMap((face,index)=>{if(face.geomType!=='PLANE')return [];const normal=face.normalAt(),center=face.center;try{return [{index,faceId:face.hashCode,area:rep.measureArea(face),normal:[normal.x,normal.y,normal.z],center:[center.x,center.y,center.z]}];}finally{normal.delete();center.delete();}}).sort((a,b)=>b.area-a.area);}finally{faces.forEach(face=>face.delete());}
}
