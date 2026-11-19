const vector=p=>{if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw new Error('Punto o vector inválido.');return p;};
export function pointAngle(a,vertex,b){[a,vertex,b].forEach(vector);const u=a.map((x,k)=>x-vertex[k]),v=b.map((x,k)=>x-vertex[k]),length=Math.hypot(...u)*Math.hypot(...v);if(length<1e-10)throw new Error('Los puntos del ángulo deben ser distintos.');return Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,k)=>sum+x*v[k],0)/length)))*180/Math.PI;}
export function directionAngle(a,b){vector(a);vector(b);return pointAngle(a,[0,0,0],b);}
