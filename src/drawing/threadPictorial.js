// Roscas en la vista 3D del plano: representación pictórica sobre la rosca cosmética (el filete real no se proyecta: cuelga el HLR).
// Externa: hélice fina sobre el cilindro (solo la mitad que mira al observador). Interna o agujero roscado: ¾ de elipse al Ø nominal
// en cada boca que la proyección dejó visible. Todo es analítico: no vuelve a pasar por el motor.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };

const minPaperStep = 0.8; // mm de papel entre filetes: si el paso real queda más fino, se dibuja uno cada n
const samplesPerTurn = 24;
const maxTurns = 400;

// Dos direcciones unitarias perpendiculares al eje, con u × v = eje (giro de rosca derecha al avanzar).
function radialFrame(axis) {
  const a = unit(axis);
  const helper = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(helper, a));
  return { a, u, v: cross(a, u) };
}

// Imagen 2D de un marco 3D (map es lineal: alcanza con el origen y los tres vectores).
function frame2d(map, origin, { a, u, v }) {
  const o = map(origin);
  const image = (vector) => { const p = map(add(origin, vector)); return [p[0] - o[0], p[1] - o[1]]; };
  return { o, a: image(a), u: image(u), v: image(v) };
}

const distToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// ¿La circunferencia (centro, eje, radio) quedó dibujada como arista visible? Evita marcar bocas tapadas o del lado de atrás.
function circleIsVisible(map, center, frame, radius, visible) {
  const flat = frame2d(map, center, frame);
  const tol = Math.max(0.05, radius * 0.04);
  let hits = 0;
  const samples = 12;
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * 2 * Math.PI;
    const p = [flat.o[0] + radius * (Math.cos(t) * flat.u[0] + Math.sin(t) * flat.v[0]), flat.o[1] + radius * (Math.cos(t) * flat.u[1] + Math.sin(t) * flat.v[1])];
    if (onVisible(p, visible, tol)) hits += 1;
  }
  return hits >= samples / 2;
}

const mouthMark = (map, center, frame, radius) => ({ mode: 'pictorial', shape: 'mouth', ...frame2d(map, center, frame), radius });

// Marcas de una rosca con rango (feature "thread") vista en oblicuo.
export function pictorialThreadMarks(thread, toViewer, map, visible) {
  const frame = radialFrame(thread.vector);
  if (thread.lefthand) frame.v = frame.v.map((c) => -c);
  if (thread.internal) {
    return [thread.p0, thread.p1].filter((end) => circleIsVisible(map, end, frame, thread.minor / 2, visible)).map((end) => mouthMark(map, end, frame, thread.major / 2));
  }
  const length = Math.hypot(...add(thread.p1, thread.p0, -1));
  return [{ mode: 'pictorial', shape: 'helix', ...frame2d(map, thread.p0, frame), radius: thread.major / 2, pitch: thread.pitch, length, facing: [dot(frame.u, toViewer), dot(frame.v, toViewer)] }];
}

// Agujeros roscados (rosca declarada en el agujero o en un círculo de corte): se reconocen por el Ø de la broca.
export function pictorialHoleMarks(circles, threads, toViewer, map, visible) {
  const marks = [];
  circles.filter((circle) => !circle.synthetic && circle.closed !== false).forEach((circle) => {
    const spec = threads.find((item) => Math.abs(item.d - circle.radius * 2) < 0.02);
    if (!spec || Math.abs(dot(circle.normal, toViewer)) < 0.05) return;
    const frame = radialFrame(circle.normal);
    if (circleIsVisible(map, circle.center, frame, circle.radius, visible)) marks.push(mouthMark(map, circle.center, frame, spec.major / 2));
  });
  return marks;
}

const onVisible = (point, visible, tol) => visible.some((line) => line.some((q, k) => k > 0 && distToSegment(point, line[k - 1], q) < tol));

// Tramos del cilindro tapados por el resto de la pieza: ahí la proyección dejó ocultas las dos generatrices de contorno.
// Devuelve una función t (mm sobre el eje) -> ¿se ve el cilindro a esa altura?
function axialVisibility(mark, visible, step) {
  const foreshortening = Math.hypot(...mark.a);
  const normal = [-mark.a[1] / foreshortening, mark.a[0] / foreshortening];
  const binSize = step / 4;
  const count = Math.max(1, Math.ceil(mark.length / binSize));
  const tol = Math.max(0.05, mark.radius * 0.03);
  const bins = Array.from({ length: count + 1 }, (_, i) => {
    const t = Math.min(i * binSize, mark.length);
    const centre = [mark.o[0] + mark.a[0] * t, mark.o[1] + mark.a[1] * t];
    return [-1, 1].some((side) => onVisible([centre[0] + side * mark.radius * normal[0], centre[1] + side * mark.radius * normal[1]], visible, tol));
  });
  return (t) => bins[Math.min(count, Math.max(0, Math.round(t / binSize)))];
}

// Polilíneas (coordenadas de la vista, mm de modelo) de una marca pictórica a la escala del papel.
// `visible` son las líneas vistas de la vista: recortan la hélice donde otra parte de la pieza tapa la rosca.
export function pictorialPolylines(mark, scale, visible = null) {
  const at = (t, angle) => [
    mark.o[0] + mark.a[0] * t + mark.radius * (Math.cos(angle) * mark.u[0] + Math.sin(angle) * mark.v[0]),
    mark.o[1] + mark.a[1] * t + mark.radius * (Math.cos(angle) * mark.u[1] + Math.sin(angle) * mark.v[1]),
  ];
  if (mark.shape === 'mouth') return [Array.from({ length: 55 }, (_, i) => at(0, (0.15 + (i / 54) * 1.5) * Math.PI))];
  // Eje casi de punta: los filetes se amontonan y no aportan.
  const foreshortening = Math.hypot(...mark.a);
  if (foreshortening < 0.05 || !(mark.pitch > 0)) return [];
  let step = mark.pitch * Math.max(1, Math.ceil(minPaperStep / (mark.pitch * foreshortening * scale)));
  if (mark.length / step > maxTurns) step = mark.length / maxTurns;
  const total = Math.ceil((mark.length / step) * samplesPerTurn);
  const shows = visible?.length ? axialVisibility(mark, visible, step) : () => true;
  const lines = [];
  let current = null;
  for (let i = 0; i <= total; i += 1) {
    const turns = Math.min(i / samplesPerTurn, mark.length / step);
    const angle = turns * 2 * Math.PI;
    const facesViewer = Math.cos(angle) * mark.facing[0] + Math.sin(angle) * mark.facing[1] > 0;
    if (!facesViewer || !shows(turns * step)) { current = null; continue; }
    if (!current) lines.push((current = []));
    current.push(at(turns * step, angle));
  }
  return lines.filter((line) => line.length >= 2);
}
