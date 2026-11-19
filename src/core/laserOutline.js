// De los lazos 3D de una cara plana (kernel/laserOutline.js) a geometría 2D 1:1 para el DXF de láser:
// CIRCLE para agujeros redondos, polilíneas cerradas con arcos (bulge) para el resto. Lo interior se corta primero.
// La esquina inferior izquierda de la silueta exterior queda en (0, 0).
const TOL = 1e-3;
const TAU = Math.PI * 2;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < TOL;

// bulge = tan(θ/4) = 2·sagita/cuerda; + antihorario. `m` es el punto medio del arco.
function bulgeOf(p, m, q) {
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const side = (q[0] - p[0]) * (m[1] - p[1]) - (q[1] - p[1]) * (m[0] - p[0]); // < 0: el arco queda a la derecha de p→q (antihorario)
  const sagitta = Math.abs(side) / chord;
  return round((-Math.sign(side) * 2 * sagitta) / chord, 6);
}

function circleOf(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) throw new Error('Arco degenerado en el contorno');
  const sq = (p) => p[0] * p[0] + p[1] * p[1];
  const x = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
  const y = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

// Une los tramos de un lazo extremo con extremo (en cualquier sentido) → vértices { x, y, bulge } de una polilínea cerrada.
function chainLoop(segments) {
  const rest = [...segments];
  const ordered = [rest.shift()];
  while (rest.length) {
    const end = ordered[ordered.length - 1].q;
    const at = rest.findIndex((s) => near(s.p, end) || near(s.q, end));
    if (at < 0) throw new Error('Contorno abierto: no se pudo cerrar el lazo para el láser.');
    const [next] = rest.splice(at, 1);
    ordered.push(near(next.p, end) ? next : { ...next, p: next.q, q: next.p, points: next.points && [...next.points].reverse() });
  }
  if (!near(ordered[ordered.length - 1].q, ordered[0].p)) throw new Error('Contorno abierto: no se pudo cerrar el lazo para el láser.');
  return ordered.flatMap((s) => {
    if (s.points) return s.points.slice(0, -1).map(([x, y]) => ({ x: round(x), y: round(y), bulge: 0 }));
    return [{ x: round(s.p[0]), y: round(s.p[1]), bulge: s.m ? bulgeOf(s.p, s.m, s.q) : 0 }];
  });
}

// ¿Todos los tramos son arcos de la misma circunferencia que cierran 360°? (agujero redondo partido en dos mitades)
function asCircle(vertices) {
  if (vertices.length < 2 || vertices.some((v) => !v.bulge)) return null;
  const sweep = vertices.reduce((sum, v) => sum + Math.abs(4 * Math.atan(v.bulge)), 0);
  if (Math.abs(sweep - TAU) > 1e-3) return null;
  const arcs=vertices.map((p,i)=>{
    const q=vertices[(i+1)%vertices.length],dx=q.x-p.x,dy=q.y-p.y,chord=Math.hypot(dx,dy),offset=chord*(1-p.bulge*p.bulge)/(4*p.bulge);
    return {x:(p.x+q.x)/2-dy/chord*offset,y:(p.y+q.y)/2+dx/chord*offset,r:chord/(2*Math.sin(Math.abs(2*Math.atan(p.bulge))))};
  });
  return arcs.every(a=>Math.hypot(a.x-arcs[0].x,a.y-arcs[0].y)<TOL&&Math.abs(a.r-arcs[0].r)<TOL)?arcs[0]:null;
}

function sampleBounds(vertices) {
  const xs = [];
  const ys = [];
  vertices.forEach((p, i) => {
    xs.push(p.x); ys.push(p.y);
    if (!p.bulge) return;
    const q = vertices[(i + 1) % vertices.length];
    const theta = 4 * Math.atan(p.bulge);
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const offset = (chord / 2) * ((1 - p.bulge ** 2) / (2 * p.bulge));
    const c = [(p.x + q.x) / 2 - ((q.y - p.y) / chord) * offset, (p.y + q.y) / 2 + ((q.x - p.x) / chord) * offset];
    const a0 = Math.atan2(p.y - c[1], p.x - c[0]);
    for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
      const delta=theta>0?((angle-a0)%TAU+TAU)%TAU:((a0-angle)%TAU+TAU)%TAU;
      if(delta<=Math.abs(theta)+1e-10){xs.push(c[0]+radius*Math.cos(angle));ys.push(c[1]+radius*Math.sin(angle));}
    }
  });
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function loopsToLaserEntities({ frame, loops }, { layer = 'CORTE' } = {}) {
  if(!loops?.length||!frame?.origin||!frame.u||!frame.v)throw new Error('No hay contornos de fabricación válidos.');
  const { origin, u, v } = frame;
  const to2 = (p) => {
    const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]];
  };
  const prepared = loops.map((loop) => {
    if (loop.items.length === 1 && loop.items[0].type === 'circle') {
      const c = circleOf(...loop.items[0].pts.map(to2));
      return { outer: loop.outer, circle: c, bounds: { minX: c.x - c.r, maxX: c.x + c.r, minY: c.y - c.r, maxY: c.y + c.r } };
    }
    const segments = loop.items.map((item) => {
      if (item.type === 'line') return { p: to2(item.p0), q: to2(item.p1) };
      if (item.type === 'arc') return { p: to2(item.p0), m: to2(item.pm), q: to2(item.p1) };
      if (item.type === 'poly') {
        const points = item.points.map(to2);
        return { p: points[0], q: points[points.length - 1], points };
      }
      throw new Error(`Tramo no soportado: ${item.type}`);
    });
    const vertices = chainLoop(segments);
    const circle = asCircle(vertices);
    if (circle) return {outer:loop.outer,circle,bounds:{minX:circle.x-circle.r,maxX:circle.x+circle.r,minY:circle.y-circle.r,maxY:circle.y+circle.r}};
    return { outer: loop.outer, vertices, bounds: sampleBounds(vertices) };
  });
  const outer = prepared.find((loop) => loop.outer) ?? prepared[0];
  const { minX, minY, maxX, maxY } = outer.bounds;
  const shift = (x, y) => ({ x: round(x - minX), y: round(y - minY) });
  const circles = [];
  const polylines = [];
  const order=[];
  [...prepared.filter((loop) => !loop.outer), outer].forEach((loop) => {
    if (loop.circle){order.push({type:'circle',index:circles.length});circles.push({ layer, ...shift(loop.circle.x, loop.circle.y), r: round(loop.circle.r) });}
    else {order.push({type:'polyline',index:polylines.length});polylines.push({ layer, closed: true, vertices: loop.vertices.map((p) => ({ ...shift(p.x, p.y), bulge: p.bulge })) });}
  });
  return { circles, polylines, order, origin2D:[minX,minY], width: round(maxX - minX, 3), height: round(maxY - minY, 3), holes: prepared.length - 1 };
}

export function validateLaserEntities({circles=[],polylines=[]}){
  if(!circles.length&&!polylines.length)throw new Error('No hay contornos para exportar.');
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e8;
  const circleKeys=new Set();for(const c of circles){if(![c.x,c.y,c.r].every(finite)||c.r<=0)throw new Error('Círculo de fabricación inválido.');const key=[c.x,c.y,c.r].map(v=>v.toFixed(4)).join(':');if(circleKeys.has(key))throw new Error('Círculos de corte duplicados.');circleKeys.add(key);}
  const edges=new Set();
  for(const poly of polylines){if(!poly.closed||poly.vertices.length<2)throw new Error('El contorno debe estar cerrado.');for(let i=0;i<poly.vertices.length;i++){
    const p=poly.vertices[i],q=poly.vertices[(i+1)%poly.vertices.length];if(![p.x,p.y,p.bulge??0].every(finite)||Math.hypot(p.x-q.x,p.y-q.y)<1e-5)throw new Error('Contorno con segmento degenerado o coordenadas inválidas.');
    const a=`${p.x},${p.y}`,b=`${q.x},${q.y}`,key=a<b?`${a}|${b}|${p.bulge??0}`:`${b}|${a}|${-(p.bulge??0)}`;if(edges.has(key))throw new Error('Hay segmentos duplicados en el corte.');edges.add(key);
  }}
  return true;
}
