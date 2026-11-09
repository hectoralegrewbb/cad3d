// Inspección pura de mallas y contornos de sección. No modifica geometría.
export function meshAudit(mesh) {
  const {vertices:v,triangles:t}=mesh;
  if(!v?.length||!t?.length||t.length%3||v.length%3||t.length/3>300000)throw new Error('Inspección: malla vacía o mayor a 300.000 triángulos.');
  const ids=new Int32Array(v.length/3),points=[],map=new Map(),edges=new Map(),parents=Int32Array.from({length:t.length/3},(_,i)=>i);
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const diag=mesh.bounds?.size?Math.hypot(...mesh.bounds.size):1000,tol=Math.max(1e-7,diag*1e-8);
  for(let i=0;i<v.length;i+=3){const p=[v[i],v[i+1],v[i+2]];if(!p.every(Number.isFinite))throw new Error('Coordenada inválida');const key=p.map(x=>Math.round(x/tol)).join(',');if(!map.has(key)){map.set(key,points.length);points.push(p);}ids[i/3]=map.get(key);}
  let degenerate=0;
  for(let n=0;n<t.length;n+=3){
    const tri=[t[n],t[n+1],t[n+2]].map(i=>{if(!Number.isInteger(i)||i<0||i>=ids.length)throw new Error('Índice de malla inválido');return ids[i];});
    const [a,b,c]=tri.map(i=>points[i]),ab=b.map((x,k)=>x-a[k]),ac=c.map((x,k)=>x-a[k]);
    if(new Set(tri).size<3||Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])<tol*tol){degenerate++;continue;}
    for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;if(!edges.has(key))edges.set(key,{a,b,owners:[]});const e=edges.get(key);if(e.owners.length)parents[root(n/3)]=root(e.owners[0]);e.owners.push(n/3);}
  }
  const boundary=[],nonManifold=[];
  for(const e of edges.values()){if(e.owners.length===1)boundary.push(e);else if(e.owners.length!==2)nonManifold.push(e);}
  const groups=new Map();
  for(let n=0;n<t.length;n+=3){const id=root(n/3);if(!groups.has(id))groups.set(id,{triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});const group=groups.get(id);group.triangles++;for(let j=0;j<3;j++)for(let k=0;k<3;k++){const value=v[t[n+j]*3+k];group.min[k]=Math.min(group.min[k],value);group.max[k]=Math.max(group.max[k],value);}}
  const components=Array.from(groups.values()).slice(0,50);
  return {vertices:points.length,triangles:t.length/3,bodies:groups.size,components,boundary:boundary.length,nonManifold:nonManifold.length,degenerate,
    lines:[...boundary,...nonManifold].slice(0,500).map(e=>[points[e.a],points[e.b]]),tolerance:tol};
}

const pointInside=(p,poly)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++)if((poly[i][1]>p[1])!==(poly[j][1]>p[1])&&p[0]<(poly[j][0]-poly[i][0])*(p[1]-poly[i][1])/(poly[j][1]-poly[i][1])+poly[i][0])inside=!inside;return inside;};
export function sectionContours(segments,axis,position,tolerance=1e-5) {
  if(![0,1,2].includes(axis)||!Number.isFinite(position)||!(tolerance>0))throw new Error('Plano de sección inválido');
  const nodes=new Map(),edges=new Map();
  const key=p=>p.map(x=>Math.round(x/tolerance)).join(',');
  for(const [a,b] of segments){const ka=key(a),kb=key(b);if(ka===kb)continue;const id=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;if(edges.has(id))continue;edges.set(id,[ka,kb]);for(const [k,p] of [[ka,a],[kb,b]]){if(!nodes.has(k))nodes.set(k,{p,edges:[]});nodes.get(k).edges.push(id);}}
  if(!edges.size)throw new Error('El plano no corta el material. Mové la sección hacia el interior.');
  const visited=new Set(),loops=[];let open=0;
  for(const [id,[start]] of edges){if(visited.has(id))continue;let current=start,edge=id,points=[],closed=false;
    while(edge&&!visited.has(edge)){visited.add(edge);points.push(nodes.get(current).p);const pair=edges.get(edge);current=pair[0]===current?pair[1]:pair[0];if(current===start){closed=true;break;}if(nodes.get(current).edges.length!==2){points.push(nodes.get(current).p);break;}edge=nodes.get(current).edges.find(e=>!visited.has(e));}
    if(!closed)open++;loops.push({points,closed});
  }
  const u=(axis+1)%3,w=(axis+2)%3,polys=loops.filter(l=>l.closed).map(l=>l.points.map(p=>[p[u],p[w]]));
  let area=0,perimeter=0;
  for(let n=0;n<polys.length;n++){const poly=polys[n];let signed=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];signed+=a[0]*b[1]-b[0]*a[1];perimeter+=Math.hypot(b[0]-a[0],b[1]-a[1]);}const depth=polys.reduce((sum,p,i)=>sum+(i!==n&&pointInside(poly[0],p)?1:0),0);area+=Math.abs(signed)/2*(depth%2?-1:1);}
  const ambiguous=[...nodes.values()].some(n=>n.edges.length!==2);
  return {axis,position,loops,open,area:open||ambiguous?null:area,perimeter,tolerance,approximate:true};
}
export function meshSection(mesh,axis,position) {
  const {vertices:v,triangles:t}=mesh,segments=[];
  for(let n=0;n<t.length;n+=3){const p=[0,1,2].map(k=>Array.from(v.subarray(t[n+k]*3,t[n+k]*3+3))),hits=[];
    for(let k=0;k<3;k++){const a=p[k],b=p[(k+1)%3],da=a[axis]-position,db=b[axis]-position;if(Math.abs(da)<1e-8)hits.push(a);if(da*db<0){const u=da/(da-db);hits.push(a.map((x,j)=>x+u*(b[j]-x)));}}
    const unique=hits.filter((p,i)=>!hits.slice(0,i).some(q=>Math.hypot(...p.map((x,k)=>x-q[k]))<1e-7));if(unique.length===2)segments.push(unique);
  }
  return sectionContours(segments,axis,position);
}
export function sectionDxf(section) {
  if(section.open||section.area===null)throw new Error('La sección tiene contornos abiertos o ambiguos. Revisá la geometría.');
  const u=(section.axis+1)%3,v=(section.axis+2)%3,out=['0','SECTION','2','HEADER','9','$ACADVER','1','AC1015','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES'];
  for(const loop of section.loops){out.push('0','LWPOLYLINE','8','SECCION','90',String(loop.points.length),'70',loop.closed?'1':'0');for(const p of loop.points)out.push('10',String(p[u]),'20',String(p[v]));}
  out.push('0','ENDSEC','0','EOF');return out.join('\r\n');
}
