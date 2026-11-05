// Cinemática de engranajes del ensamble: qué engranajes engranan, con qué relación y en qué fase.
// Puro y sin DOM: trabaja con datos de `gearFeatureSpecs` (centro, eje, dirección del diente 0, tramo axial) en coordenadas de la pieza.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => a.map((v) => v * k);
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / (norm(a) || 1));
const TWO_PI = 2 * Math.PI;
// Ángulo envuelto a (-π/period, π/period].
const wrap = (angle, period = TWO_PI) => {
  const w = ((angle % period) + period) % period;
  return w > period / 2 ? w - period : w;
};

const rotateAxis = (v, axis, degrees) => {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = axis;
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd);
};

// Igual que placeShape: giros en grados alrededor de X, Y y Z globales (en ese orden) y después traslación.
export const placeVector = (vector, rot = [0, 0, 0]) => [[rot[0], [1, 0, 0]], [rot[1], [0, 1, 0]], [rot[2], [0, 0, 1]]].reduce((v, [angle, axis]) => (Math.abs(angle) > 1e-12 ? rotateAxis(v, axis, angle) : v), vector);
export const placePoint = (point, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) => placeVector(point, rot).map((v, i) => v + pos[i]);

// Engranajes de una instancia llevados al mundo.
export function worldGears(instance, specs) {
  return specs.map((spec) => ({
    ...spec,
    instance: instance.id,
    center: placePoint(spec.center, instance),
    vector: unit(placeVector(spec.vector, instance.rot)),
    xDir: unit(placeVector(spec.xDir ?? [1, 0, 0], instance.rot)),
  }));
}

// Ángulo de `v` alrededor del eje `n` (regla de la mano derecha) respecto de una base fija perpendicular a n.
function angleAbout(n, v) {
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(sub(helper, scale(n, dot(helper, n))));
  const e2 = cross(n, e1);
  const flat = sub(v, scale(n, dot(v, n)));
  return Math.atan2(dot(flat, e2), dot(flat, e1));
}

// Pares de engranajes de instancias distintas que pueden tocarse: ejes paralelos y tramos axiales que se superponen.
// estado: 'mesh' (engranan), 'overlap' (se pisan: interfieren), 'apart' (separados por poco), 'module' (módulos distintos).
export function findLinks(gears, { axisTolerance = 0.9995 } = {}) {
  const links = [];
  for (let i = 0; i < gears.length; i += 1) {
    for (let j = i + 1; j < gears.length; j += 1) {
      const a = gears[i];
      const b = gears[j];
      if (a.instance === b.instance) continue;
      const parallel = Math.abs(dot(a.vector, b.vector));
      if (parallel < axisTolerance) continue;
      const delta = sub(b.center, a.center);
      const along = dot(delta, a.vector);
      const radial = norm(sub(delta, scale(a.vector, along)));
      // Superposición axial: tramo de a en su eje vs tramo de b proyectado al eje de a.
      const aLo = Math.min(...a.axial);
      const aHi = Math.max(...a.axial);
      const s = Math.sign(dot(a.vector, b.vector)) || 1;
      const bRange = b.axial.map((value) => along + s * value).sort((x, y) => x - y);
      const overlap = Math.min(aHi, bRange[1]) - Math.max(aLo, bRange[0]);
      if (!(overlap > 0.05 * Math.min(a.width, b.width))) continue;
      const sum = a.rp + b.rp;
      const sameModule = Math.abs(a.m - b.m) < 1e-6 * a.m;
      const tol = 0.1 * Math.min(a.m, b.m) + 0.05;
      let status = null;
      if (!sameModule) status = radial < a.ra + b.ra + a.m ? 'module' : null;
      else if (Math.abs(radial - sum) <= tol) status = 'mesh';
      else if (radial < sum - tol) status = radial < Math.abs(a.rp - b.rp) + 0.5 ? null : 'overlap';
      else if (radial < sum + 3 * a.m) status = 'apart';
      if (!status) continue;
      links.push({ a: a.instance, b: b.instance, ga: a.id, gb: b.id, gearA: a, gearB: b, status, distance: radial, expected: sum, gap: radial - sum });
    }
  }
  return links;
}

// Fase que deja los dientes de b intercalados con los de a: Σ z·θ = K (mod 2π), con θ alrededor del eje de a.
function phaseConstant(a, b) {
  const n = a.vector;
  const s = Math.sign(dot(a.vector, b.vector)) || 1;
  const delta = sub(b.center, a.center);
  const beta = angleAbout(n, delta);
  const phiA = angleAbout(n, a.xDir) + ((a.twist ?? 0) * Math.PI) / 180 / 2;
  const phiB = angleAbout(n, b.xDir) + (s * ((b.twist ?? 0) * Math.PI) / 180) / 2;
  return beta * (a.z + b.z) - phiA * a.z - phiB * b.z + Math.PI * b.z - Math.PI;
}

// Propaga el giro del motor (instancia `driverId`, alrededor del eje de su primer engranaje) por todos los pares que engranan.
// Devuelve por instancia: eje y pivote (mundo), relación ω/ω_motor y fase inicial (rad) que intercala los dientes; más conflictos.
export function solveTrain(gears, driverId, { links = findLinks(gears), syncTeeth = true } = {}) {
  const byInstance = (id) => gears.filter((gear) => gear.instance === id);
  const driverGear = byInstance(driverId)[0];
  if (!driverGear) return { bodies: {}, links, conflicts: [], error: 'El elemento que gira no tiene engranajes' };
  const bodies = { [driverId]: { id: driverId, axis: driverGear.vector, pivot: driverGear.center, ratio: 1, phase: 0 } };
  const conflicts = [];
  const meshing = links.filter((link) => link.status === 'mesh');
  const queue = [driverId];
  while (queue.length) {
    const id = queue.shift();
    const body = bodies[id];
    meshing.forEach((link) => {
      const [mine, other, theirs] = link.a === id ? [link.gearA, link.b, link.gearB] : link.b === id ? [link.gearB, link.a, link.gearA] : [null, null, null];
      if (!mine) return;
      // Giro de mi engranaje respecto de su propio eje (el eje de la instancia puede estar invertido).
      const sMine = Math.sign(dot(mine.vector, body.axis)) || 1;
      const coaxial = norm(cross(sub(mine.center, body.pivot), body.axis)) < 0.05;
      if (!coaxial) {
        conflicts.push({ instance: id, reason: 'Tiene engranajes en ejes distintos: no puede girar sobre uno solo' });
        return;
      }
      const ratioMine = sMine * body.ratio;
      const phaseMine = sMine * body.phase;
      const s = Math.sign(dot(theirs.vector, mine.vector)) || 1;
      const ratioTheirs = -s * ratioMine * (mine.z / theirs.z);
      // Con `mine` como referencia (a): θ_b alrededor del eje de a = (K − za·θa)/zb; en el eje propio de b se multiplica por s.
      const pair = { a: mine, b: theirs };
      const kappa = syncTeeth ? phaseConstant(pair.a, pair.b) : 0;
      const phaseTheirs = syncTeeth ? s * wrap((kappa - mine.z * phaseMine) / theirs.z, TWO_PI / theirs.z) : 0;
      const known = bodies[other];
      if (!known) {
        bodies[other] = { id: other, axis: theirs.vector, pivot: theirs.center, ratio: ratioTheirs, phase: phaseTheirs };
        queue.push(other);
      } else {
        const sTheirs = Math.sign(dot(theirs.vector, known.axis)) || 1;
        if (Math.abs(sTheirs * known.ratio - ratioTheirs) > 1e-9) conflicts.push({ instance: other, reason: 'Trabado: los engranajes forman un anillo con sentidos de giro incompatibles' });
      }
    });
  }
  return { bodies, links, conflicts, error: null };
}

export const linkLabels = {
  mesh: 'engranan',
  overlap: 'interfieren (centros demasiado cerca)',
  apart: 'no llegan a engranar (separados)',
  module: 'módulos distintos: no pueden engranar',
};

// --- Aplicar la fase a la pose de la instancia ---
const matrixOf = (rot) => {
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => placeVector(e, rot));
  return [0, 1, 2].map((row) => [0, 1, 2].map((col) => basis[col][row])); // columnas = imágenes de los ejes
};
const rodrigues = (axis, angle) => {
  const [x, y, z] = unit(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
};
const multiply = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const applyMatrix = (m, v) => m.map((row) => dot(row, v));

// Ángulos (°) X, Y, Z de una matriz R = Rz·Ry·Rx (el orden con que se coloca una instancia).
export function eulerFromMatrix(m) {
  const deg = (r) => (r * 180) / Math.PI;
  const round = (v) => Math.round(v * 1e6) / 1e6;
  const sy = Math.max(-1, Math.min(1, -m[2][0]));
  const beta = Math.asin(sy);
  if (Math.abs(sy) > 0.999999) return [0, deg(beta), deg(Math.atan2(-m[0][1], m[1][1]))].map(round);
  return [deg(Math.atan2(m[2][1], m[2][2])), deg(beta), deg(Math.atan2(m[1][0], m[0][0]))].map(round);
}

// Nueva pose de la instancia tras girarla `phase` rad alrededor del eje (axis, pivot) del mundo.
export function turnedPose(instance, { axis, pivot, phase }) {
  const turn = rodrigues(axis, phase);
  const rot = eulerFromMatrix(multiply(turn, matrixOf(instance.rot ?? [0, 0, 0])));
  const origin = instance.pos ?? [0, 0, 0];
  const moved = applyMatrix(turn, sub(origin, pivot)).map((v, i) => v + pivot[i]);
  return { rot, pos: moved.map((v) => Math.round(v * 1e6) / 1e6) };
}

// Traslaciones que dejan a los pares 'apart'/'overlap' a la distancia de engrane ((z1+z2)·m/2), moviendo la instancia que el motor
// todavía no alcanza (recorriendo los pares desde `driverId`). Devuelve [{ instance, delta }] acumulado por instancia.
export function engageMoves(gears, links, driverId) {
  const reached = new Set([driverId]);
  const grow = () => {
    let changed = true;
    while (changed) {
      changed = false;
      links.filter((link) => link.status === 'mesh').forEach((link) => {
        if (reached.has(link.a) !== reached.has(link.b)) {
          reached.add(link.a);
          reached.add(link.b);
          changed = true;
        }
      });
    }
  };
  grow();
  const moves = {};
  links.filter((link) => link.status === 'apart' || link.status === 'overlap').forEach((link) => {
    const { gearA: a, gearB: b } = link;
    const along = sub(b.center, a.center);
    const radial = sub(along, scale(a.vector, dot(along, a.vector)));
    if (norm(radial) < 1e-9) return;
    const direction = unit(radial);
    const shift = link.expected - link.distance;
    const moveB = !(reached.has(link.b) && !reached.has(link.a));
    const [instance, sign] = moveB ? [link.b, 1] : [link.a, -1];
    const delta = scale(direction, sign * shift);
    const bucket = (moves[instance] ??= [0, 0, 0]);
    [0, 1, 2].forEach((i) => (bucket[i] += delta[i]));
    reached.add(link.a);
    reached.add(link.b);
  });
  return Object.entries(moves).map(([instance, delta]) => ({ instance, delta: delta.map((v) => Math.round(v * 1e6) / 1e6) }));
}
