// Refinamiento de contactos contra triángulos. El SDF sigue siendo la fase amplia;
// una chapa fina no desaparece aunque su espesor sea menor que la celda del SDF.
export class MeshCollider {
  constructor(mesh) {
    const v=mesh.vertices,t=mesh.triangles,n=mesh.normals;
    this.triangles=[];this.nodes=[];this.stack=new Int32Array(128);
    if(t.length/3>300000)throw new Error('La colisión precisa de carga inicial admite hasta 300.000 triángulos por cuerpo.');
    for(let i=0;i<t.length;i+=3){
      const a=Array.from(v.subarray(t[i]*3,t[i]*3+3)),b=Array.from(v.subarray(t[i+1]*3,t[i+1]*3+3)),c=Array.from(v.subarray(t[i+2]*3,t[i+2]*3+3));
      const ab=b.map((x,k)=>x-a[k]),ac=c.map((x,k)=>x-a[k]);let normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];const length=Math.hypot(...normal);if(length<1e-12)continue;
      if(n?.length&&normal.reduce((s,x,k)=>s+x*(n[t[i]*3+k]+n[t[i+1]*3+k]+n[t[i+2]*3+k]),0)<0)normal=normal.map(x=>-x);
      normal=normal.map(x=>x/length);
      this.triangles.push({a,ab,ac,normal,min:a.map((x,k)=>Math.min(x,b[k],c[k])),max:a.map((x,k)=>Math.max(x,b[k],c[k]))});
    }
    const build=list=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const i of list)for(let k=0;k<3;k++){min[k]=Math.min(min[k],this.triangles[i].min[k]);max[k]=Math.max(max[k],this.triangles[i].max[k]);}const index=this.nodes.length,node={min,max};this.nodes.push(node);if(list.length<=4)node.list=list;else{let axis=0;for(let k=1;k<3;k++)if(max[k]-min[k]>max[axis]-min[axis])axis=k;list.sort((a,b)=>this.triangles[a].min[axis]+this.triangles[a].max[axis]-this.triangles[b].min[axis]-this.triangles[b].max[axis]);const half=list.length>>1;node.left=build(list.slice(0,half));node.right=build(list.slice(half));}return index;};
    build(this.triangles.map((_,i)=>i));
  }
  distance(x,y,z,gradient,reach) {
    let best=reach*reach,result=null,top=1;this.stack[0]=0;
    while(top){const node=this.nodes[this.stack[--top]];let box=0;for(let k=0;k<3;k++){const v=k===0?x:k===1?y:z,d=v<node.min[k]?node.min[k]-v:v>node.max[k]?v-node.max[k]:0;box+=d*d;}if(box>best)continue;
      if(!node.list){this.stack[top++]=node.left;this.stack[top++]=node.right;continue;}
      for(const i of node.list){const {a,ab,ac,normal}=this.triangles[i],px=x-a[0],py=y-a[1],pz=z-a[2];
        const d1=ab[0]*px+ab[1]*py+ab[2]*pz,d2=ac[0]*px+ac[1]*py+ac[2]*pz;
        const bpx=px-ab[0],bpy=py-ab[1],bpz=pz-ab[2],d3=ab[0]*bpx+ab[1]*bpy+ab[2]*bpz,d4=ac[0]*bpx+ac[1]*bpy+ac[2]*bpz;
        const cpx=px-ac[0],cpy=py-ac[1],cpz=pz-ac[2],d5=ab[0]*cpx+ab[1]*cpy+ab[2]*cpz,d6=ac[0]*cpx+ac[1]*cpy+ac[2]*cpz;
        const vc=d1*d4-d3*d2,vb=d5*d2-d1*d6,va=d3*d6-d5*d4;let u=0,v=0;
        if(d1<=0&&d2<=0){}else if(d3>=0&&d4<=d3)u=1;else if(vc<=0&&d1>=0&&d3<=0)u=d1/(d1-d3);else if(d6>=0&&d5<=d6)v=1;else if(vb<=0&&d2>=0&&d6<=0)v=d2/(d2-d6);else if(va<=0&&d4-d3>=0&&d5-d6>=0){v=(d4-d3)/(d4-d3+d5-d6);u=1-v;}else{const den=1/(va+vb+vc);u=vb*den;v=vc*den;}
        const dx=px-u*ab[0]-v*ac[0],dy=py-u*ab[1]-v*ac[1],dz=pz-u*ab[2]-v*ac[2],sq=dx*dx+dy*dy+dz*dz;
        if(sq>best)continue;best=sq;const d=Math.sqrt(sq),sign=dx*normal[0]+dy*normal[1]+dz*normal[2]<-1e-10?-1:1;result=d*sign;
        gradient[0]=d>1e-10?dx/d*sign:normal[0];gradient[1]=d>1e-10?dy/d*sign:normal[1];gradient[2]=d>1e-10?dz/d*sign:normal[2];
      }
    }
    return result;
  }
}
