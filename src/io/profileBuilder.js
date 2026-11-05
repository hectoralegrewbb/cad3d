// Convierte entidades 2D importadas (líneas, arcos, polilíneas, círculos) en contornos cerrados listos para un boceto:
// encadena tramos que se tocan (tolerancia en mm) y devuelve entidades `circle` / `ellipse` / `poly` (con "bulge" para arcos).
const TWO_PI = 2 * Math.PI;

const arcSweep = (a0, a1) => {
  let sweep = (a1 - a0) % TWO_PI;
  if (sweep <= 0) sweep += TWO_PI;
  return sweep;
};

// Tramo = { p: [x,y], q: [x,y], bulge } (bulge = tan(θ/4), + = antihorario, de p a q).
function toSegments(entities, scale) {
  const segments = [];
  const circles = [];
  const loops = [];
  const ellipses = [];
  entities.forEach((entity) => {
    if (entity.type === 'line') {
      if (Math.hypot(entity.b[0] - entity.a[0], entity.b[1] - entity.a[1]) * scale > 1e-9) segments.push({ p: entity.a.map((v) => v * scale), q: entity.b.map((v) => v * scale), bulge: 0 });
    } else if (entity.type === 'arc') {
      const sweep = arcSweep(entity.a0, entity.a1);
      const at = (angle) => [(entity.c[0] + entity.r * Math.cos(angle)) * scale, (entity.c[1] + entity.r * Math.sin(angle)) * scale];
      segments.push({ p: at(entity.a0), q: at(entity.a0 + sweep), bulge: Math.tan(sweep / 4) });
    } else if (entity.type === 'circle') {
      if (entity.r > 0) circles.push({ x: entity.c[0] * scale, y: entity.c[1] * scale, d: 2 * entity.r * scale });
    } else if (entity.type === 'ellipse') {
      ellipses.push({ x: entity.c[0] * scale, y: entity.c[1] * scale, w: 2 * entity.major * scale, h: 2 * entity.major * entity.ratio * scale, angle: (entity.angle * 180) / Math.PI });
    } else if (entity.type === 'polyline') {
      const pts = entity.pts.map((point) => ({ x: point.x * scale, y: point.y * scale, bulge: point.bulge ?? 0 }));
      if (entity.closed && pts.length >= 3) loops.push(pts);
      else {
        const count = entity.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < count; i += 1) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) segments.push({ p: [a.x, a.y], q: [b.x, b.y], bulge: a.bulge });
        }
      }
    }
  });
  return { segments, circles, loops, ellipses };
}

// Parte el primer arco en dos mitades (un contorno de solo dos tramos no alcanza para una polilínea de ≥3 vértices).
// El punto medio del arco queda a la derecha de la cuerda p→q para bulge > 0 (antihorario), a distancia sagita = bulge·cuerda/2.
function splitFirstArc(pts) {
  const a = pts[0];
  const b = pts[1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const sagitta = (a.bulge * chord) / 2;
  const apex = { x: (a.x + b.x) / 2 + ((b.y - a.y) / chord) * sagitta, y: (a.y + b.y) / 2 - ((b.x - a.x) / chord) * sagitta };
  const halfBulge = Math.tan(Math.atan(a.bulge) / 2); // θ/4 → θ/8
  return [{ x: a.x, y: a.y, bulge: halfBulge }, { x: apex.x, y: apex.y, bulge: halfBulge }, ...pts.slice(1)];
}

const sameStep = (value, tolerance) => Math.round(value / tolerance);

export function buildProfiles(entities, { scale = 1, tolerance = 0.01 } = {}) {
  const { segments, circles, loops, ellipses } = toSegments(entities, scale);
  // Índice espacial de extremos.
  const buckets = new Map();
  const keyOf = (point) => `${sameStep(point[0], tolerance * 4)}|${sameStep(point[1], tolerance * 4)}`;
  const near = (point) => {
    const ix = sameStep(point[0], tolerance * 4);
    const iy = sameStep(point[1], tolerance * 4);
    const out = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) out.push(...(buckets.get(`${ix + dx}|${iy + dy}`) ?? []));
    return out;
  };
  segments.forEach((segment, index) => {
    [['p', segment.p], ['q', segment.q]].forEach(([end, point]) => {
      const key = keyOf(point);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ index, end });
    });
  });
  const used = new Set();
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const chains = [];
  const open = [];
  segments.forEach((segment, start) => {
    if (used.has(start)) return;
    used.add(start);
    // Cadena como lista de tramos orientados { p, q, bulge } (bulge ya refleja el sentido).
    const chain = [{ ...segment }];
    const extend = (atEnd) => {
      for (;;) {
        const tip = atEnd ? chain[chain.length - 1].q : chain[0].p;
        const candidate = near(tip).find(({ index, end }) => !used.has(index) && dist(end === 'p' ? segments[index].p : segments[index].q, tip) <= tolerance);
        if (!candidate) return;
        used.add(candidate.index);
        const seg = segments[candidate.index];
        // Si el extremo que toca es q, el tramo se recorre al revés (bulge cambia de signo).
        const oriented = atEnd
          ? (candidate.end === 'p' ? { p: seg.p, q: seg.q, bulge: seg.bulge } : { p: seg.q, q: seg.p, bulge: -seg.bulge })
          : (candidate.end === 'q' ? { p: seg.p, q: seg.q, bulge: seg.bulge } : { p: seg.q, q: seg.p, bulge: -seg.bulge });
        if (atEnd) chain.push(oriented);
        else chain.unshift(oriented);
      }
    };
    extend(true);
    extend(false);
    const closed = chain.length >= 2 && dist(chain[0].p, chain[chain.length - 1].q) <= tolerance;
    if (closed || (chain.length === 1 && false)) chains.push(chain);
    else open.push(chain);
  });

  const polys = [];
  const asPoly = (pts) => {
    let list = pts;
    if (list.length === 2) list = splitFirstArc(list);
    if (list.length >= 3) polys.push({ t: 'poly', pts: list.map((point) => ({ x: round(point.x), y: round(point.y), bulge: round6(point.bulge) })) });
  };
  chains.forEach((chain) => {
    let pts = chain.map((seg) => ({ x: seg.p[0], y: seg.p[1], bulge: seg.bulge }));
    // Dos arcos con mismo centro y radio = círculo.
    if (pts.length === 2 && pts.every((point) => Math.abs(Math.abs(point.bulge) - 1) < 1e-6)) {
      circles.push({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, d: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) });
      return;
    }
    // Vértices colineales sin arco: se conservan (no se simplifica geometría ajena).
    asPoly(pts);
  });
  loops.forEach((pts) => asPoly(pts));
  const out = [...circles.map((c) => ({ t: 'circle', x: round(c.x), y: round(c.y), d: round(c.d) })), ...ellipses.map((e) => ({ t: 'ellipse', x: round(e.x), y: round(e.y), w: round(e.w), h: round(e.h), angle: round(e.angle) })), ...polys];
  const openLength = open.reduce((sum, chain) => sum + chain.length, 0);
  return { entities: out, open: open.map((chain) => ({ segments: chain.length, from: chain[0].p, to: chain[chain.length - 1].q })), openSegments: openLength };
}

const round = (value) => Math.round(value * 1000) / 1000;
const round6 = (value) => Math.round(value * 1e6) / 1e6;
