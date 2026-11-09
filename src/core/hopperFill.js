// Cavidad de una tolva por rayos horizontales: no se pierde una pared fina al voxelizar su espesor.
// La máscara representa aire limitado por material en X e Y; no es el sólido del recipiente.
export function hopperCavity(mesh, { maxAxis = 100, maxCells = 1500000 } = {}) {
  const { vertices, triangles } = mesh;
  if (!vertices?.length || !triangles?.length || vertices.length % 3 || triangles.length % 3) throw new Error('La tolva no tiene una malla válida');
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=3)for(let k=0;k<3;k++){
    const v=vertices[i+k];if(!Number.isFinite(v))throw new Error('Coordenada no finita');min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);
  }
  const size=max.map((v,k)=>v-min[k]);
  let h=Math.max(...size)/Math.max(24,Math.min(160,maxAxis));
  if(!(h>0))throw new Error('Tolva sin dimensiones');
  const dimsAt=()=>size.map(v=>Math.ceil(v/h)+2);
  let dims=dimsAt();while(dims.reduce((a,b)=>a*b,1)>maxCells){h*=1.1;dims=dimsAt();}
  const origin=min.map(v=>v-h/2), [nx,ny,nz]=dims;
  const count=nx*ny*nz;
  const point=[[0,0,0],[0,0,0],[0,0,0]];
  const insideAxis=axis=>{
    const a=(axis+1)%3,b=(axis+2)%3, columns=new Map();
    for(let t=0;t<triangles.length;t+=3){
      for(let n=0;n<3;n++)for(let k=0;k<3;k++)point[n][k]=vertices[triangles[t+n]*3+k];
      const da1=point[1][a]-point[0][a],db1=point[1][b]-point[0][b],da2=point[2][a]-point[0][a],db2=point[2][b]-point[0][b],det=da1*db2-da2*db1;
      if(Math.abs(det)<1e-10)continue;
      const loA=Math.max(0,Math.ceil((Math.min(...point.map(p=>p[a]))-origin[a])/h-.5));
      const hiA=Math.min(dims[a]-1,Math.floor((Math.max(...point.map(p=>p[a]))-origin[a])/h-.5));
      const loB=Math.max(0,Math.ceil((Math.min(...point.map(p=>p[b]))-origin[b])/h-.5));
      const hiB=Math.min(dims[b]-1,Math.floor((Math.max(...point.map(p=>p[b]))-origin[b])/h-.5));
      for(let ib=loB;ib<=hiB;ib++)for(let ia=loA;ia<=hiA;ia++){
        const la=origin[a]+(ia+.5)*h-point[0][a],lb=origin[b]+(ib+.5)*h-point[0][b];
        const u=(la*db2-da2*lb)/det,v=(da1*lb-la*db1)/det;
        if(u< -1e-9||v< -1e-9||u+v>1+1e-9)continue;
        const hit=point[0][axis]+u*(point[1][axis]-point[0][axis])+v*(point[2][axis]-point[0][axis]);
        const key=ia+dims[a]*ib;if(!columns.has(key))columns.set(key,[]);columns.get(key).push(hit);
      }
    }
    const mask=new Uint8Array(count);
    for(const [key,intersections] of columns){
      intersections.sort((x,y)=>x-y);
      const hits=intersections.filter((v,i)=>!i||v-intersections[i-1]>h*1e-7);
      if(hits.length<4||hits.length%2)continue; // una abertura o chapa aislada no define una carga cerrada lateralmente
      const cell=[0,0,0];cell[a]=key%dims[a];cell[b]=Math.floor(key/dims[a]);
      // Entre el final de una pared y el inicio de la siguiente hay cavidad.
      for(let n=1;n+1<hits.length;n+=2){
        const from=Math.max(0,Math.ceil((hits[n]-origin[axis])/h-.5+1e-7));
        const to=Math.min(dims[axis]-1,Math.floor((hits[n+1]-origin[axis])/h-.5-1e-7));
        for(let c=from;c<=to;c++){cell[axis]=c;mask[cell[0]+nx*(cell[1]+ny*cell[2])]=1;}
      }
    }
    return mask;
  };
  const x=insideAxis(0),y=insideAxis(1),mask=new Uint8Array(count),rank=new Int32Array(count).fill(-1),positions=[];
  const layerCounts=new Uint32Array(nz);
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const index=i+nx*(j+ny*k);if(!(x[index]&&y[index]))continue;
    mask[index]=1;rank[index]=positions.length/3;layerCounts[k]++;positions.push(origin[0]+(i+.5)*h,origin[1]+(j+.5)*h,origin[2]+(k+.5)*h);
  }
  if(!positions.length)throw new Error('No se detectó una cavidad lateral cerrada. Elegí la pieza de la tolva y revisá sus paredes.');
  return {origin,dims,h,mask,rank,positions:Float32Array.from(positions),layerCounts,capacity:positions.length/3*h**3,bounds:{min,max,size}};
}

export function validateInitialFill(value = {}) {
  const result={enabled:false,percent:100,target:'',settleSeconds:2,radius:3,packing:0.6,feedRate:150,execution:'slow',budget:600000,outletAxis:0,outletPosition:700,outletSign:1,outletU:0,outletV:383,outletRadius:150,...value};
  if(typeof result.enabled!=='boolean'||typeof result.target!=='string'||result.target.length>128)throw new Error('Configuración de llenado inválida');
  for(const [key,lo,hi] of [['percent',0,100],['settleSeconds',0,20],['radius',0.3,20],['packing',0.1,0.62],['feedRate',0,2000],['outletU',-1e7,1e7],['outletV',-1e7,1e7],['outletRadius',0.1,1e6]]){
    if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<lo||result[key]>hi)throw new Error(`Llenado: ${key} fuera de rango (${lo}–${hi})`);
  }
  if(!['interactive','slow'].includes(result.execution)||!Number.isInteger(result.budget)||result.budget<1000||result.budget>600000||![0,1,2].includes(result.outletAxis)||![-1,1].includes(result.outletSign)||!Number.isFinite(result.outletPosition)||Math.abs(result.outletPosition)>1e7)throw new Error('Presupuesto o plano de salida inválido');
  return result;
}
