// Interpolación multieje: una trayectoria en el espacio (líneas, arcos, círculos, espirales y hélices) recorrida por varios ejes a
// la vez, con un único perfil de velocidad a lo largo del camino. Los vértices pueden redondearse («blending / contorneado»): el
// recorrido no se detiene y la velocidad baja solo lo que exige la curva (aceleración centrípeta ≤ aMax). Sin blending el camino
// se divide en tramos de reposo a reposo.
const eps = 1e-9;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (norm(a) || 1));
const vec = (value) => (Array.isArray(value) ? [0, 1, 2].map((i) => Number(value[i]) || 0) : [0, 0, 0]);
const planes = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [1, 2, 0] };

function makeLine(a, b, feed) {
  const length = norm(sub(b, a));
  return { kind: 'line', length, feed, radius: Infinity, start: a, end: b, at: (s) => add(a, mul(sub(b, a), length > eps ? s / length : 0)) };
}

// Arco, círculo, espiral o hélice. `center` = desplazamiento (i, j) del centro respecto del punto inicial, en los ejes del plano.
function makeArc(p0, segment, feed) {
  const [ia, ib, inN] = planes[segment.plane] ?? planes.xy;
  const end = vec(segment.to);
  const centerOffset = [Number(segment.center?.[0]) || 0, Number(segment.center?.[1]) || 0];
  const c = [p0[ia] + centerOffset[0], p0[ib] + centerOffset[1]];
  const r0 = Math.hypot(p0[ia] - c[0], p0[ib] - c[1]);
  const r1 = Math.hypot(end[ia] - c[0], end[ib] - c[1]);
  if (r0 < 1e-6) return { error: 'el centro del arco coincide con el punto inicial' };
  const a0 = Math.atan2(p0[ib] - c[1], p0[ia] - c[0]);
  const a1 = Math.atan2(end[ib] - c[1], end[ia] - c[0]);
  const ccw = segment.ccw !== false;
  let sweep = a1 - a0;
  if (ccw) while (sweep <= 1e-9) sweep += 2 * Math.PI;
  else while (sweep >= -1e-9) sweep -= 2 * Math.PI;
  sweep += (ccw ? 1 : -1) * 2 * Math.PI * Math.max(0, Math.round(Number(segment.turns) || 0));
  const total = Math.abs(sweep);
  const pointAtPhase = (phi) => {
    const u = phi / total;
    const radius = r0 + (r1 - r0) * u;
    const angle = a0 + Math.sign(sweep) * phi;
    const out = [0, 0, 0];
    out[ia] = c[0] + radius * Math.cos(angle);
    out[ib] = c[1] + radius * Math.sin(angle);
    out[inN] = p0[inN] + (end[inN] - p0[inN]) * u;
    return out;
  };
  const steps = Math.max(24, Math.min(8000, Math.ceil(total / (Math.PI / 120))));
  const cumulative = new Float64Array(steps + 1);
  let previous = pointAtPhase(0);
  for (let i = 1; i <= steps; i += 1) {
    const point = pointAtPhase((total * i) / steps);
    cumulative[i] = cumulative[i - 1] + norm(sub(point, previous));
    previous = point;
  }
  const length = cumulative[steps];
  const phaseAt = (s) => {
    if (s <= 0) return 0;
    if (s >= length) return total;
    let low = 0;
    let high = steps;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] <= s) low = mid;
      else high = mid;
    }
    const f = (s - cumulative[low]) / Math.max(eps, cumulative[high] - cumulative[low]);
    return (total * (low + f)) / steps;
  };
  const spiral = Math.abs(r1 - r0) > 1e-6 * Math.max(r0, r1);
  return { kind: 'arc', length, feed, radius: Math.min(r0, r1 > 0 ? r1 : r0), start: pointAtPhase(0), end: pointAtPhase(total), at: (s) => pointAtPhase(phaseAt(s)), spiral };
}

const tangentOf = (piece, atEnd) => {
  const d = Math.min(piece.length * 0.5, Math.max(1e-4, piece.length * 1e-3));
  const s = atEnd ? piece.length : 0;
  return unit(atEnd ? sub(piece.at(s), piece.at(Math.max(0, s - d))) : sub(piece.at(Math.min(piece.length, s + d)), piece.at(s)));
};

// Redondea la esquina entre dos líneas con un arco tangente a ambas, a distancia `d` del vértice.
function fillet(first, second, distance) {
  const d1 = unit(sub(first.end, first.start));
  const d2 = unit(sub(second.end, second.start));
  const cosTurn = Math.max(-1, Math.min(1, dot(d1, d2)));
  const turn = Math.acos(cosTurn);
  if (turn < 0.0087 || turn > Math.PI - 0.0087) return null; // colineales o marcha atrás: no se redondea
  const vertex = first.end;
  const limit = Math.min(distance, first.length * 0.5, second.length * 0.5);
  if (limit < 1e-6) return null;
  const radius = limit / Math.tan(turn / 2);
  const p1 = sub(vertex, mul(d1, limit));
  const p2 = add(vertex, mul(d2, limit));
  const n = unit(sub(d2, mul(d1, cosTurn)));
  const center = add(p1, mul(n, radius));
  const at = (s) => {
    const phi = s / radius;
    return add(center, add(mul(n, -radius * Math.cos(phi)), mul(d1, radius * Math.sin(phi))));
  };
  return { trimmed: { first: p1, second: p2 }, arc: { kind: 'fillet', length: radius * turn, feed: 0, radius, start: p1, end: p2, at } };
}

// Convierte los segmentos en piezas continuas. Devuelve { pieces, vertices, warnings }; vertices[i] = { stop, limit } entre pieza i e i+1.
export function buildPieces(motion) {
  const warnings = [];
  const raw = [];
  let current = vec(motion.start);
  (motion.segments ?? []).forEach((segment, index) => {
    const feed = Math.max(0, Number(segment.feed) || 0);
    let piece;
    if (segment.type === 'arc' || segment.type === 'helix') {
      piece = makeArc(current, segment, feed);
      if (piece.error) {
        warnings.push(`Segmento ${index + 1}: ${piece.error}`);
        return;
      }
      if (piece.spiral && segment.type === 'arc') warnings.push(`Segmento ${index + 1}: el punto final no está sobre la circunferencia: se traza una espiral`);
    } else {
      piece = makeLine(current, vec(segment.to), feed);
      if (piece.length < 1e-6) return;
    }
    piece.blend = Math.max(0, Number(segment.blend) || 0);
    raw.push(piece);
    current = piece.end;
  });
  // Redondeos entre líneas consecutivas
  const pieces = [];
  const vertices = [];
  raw.forEach((piece, index) => {
    const previous = pieces[pieces.length - 1];
    if (previous) {
      const prevRaw = raw[index - 1];
      let junction = { stop: true, limit: 0 };
      if (prevRaw.blend > 0 && previous.kind === 'line' && piece.kind === 'line') {
        const rounded = fillet(previous, piece, prevRaw.blend);
        if (rounded) {
          previous.end = rounded.trimmed.first;
          previous.length = norm(sub(previous.end, previous.start));
          const a = previous.start;
          const b = previous.end;
          previous.at = (s) => add(a, mul(sub(b, a), previous.length > eps ? s / previous.length : 0));
          const start = rounded.trimmed.second;
          const trimmed = makeLine(start, piece.end, piece.feed);
          trimmed.blend = piece.blend;
          vertices.push({ stop: false, limit: Infinity }, { stop: false, limit: Infinity });
          pieces.push(rounded.arc, trimmed);
          return;
        }
      }
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(tangentOf(previous, true), tangentOf(piece, false)))));
      if (turn < 0.0087) junction = { stop: false, limit: Infinity };
      else if (prevRaw.blend > 0) junction = { stop: false, limit: 'corner', blend: prevRaw.blend };
      vertices.push(junction);
    }
    pieces.push(piece);
  });
  return { pieces, vertices, warnings };
}

// Perfil de velocidad a lo largo de una cadena de piezas (de reposo a reposo): adelante/atrás con aceleración máxima + suavizado S.
function planChain(chain, vertices, motion) {
  const velocity = Math.max(1e-6, Number(motion.velocity) || 200);
  const accel = Math.max(1e-6, Number(motion.accel) || 1000);
  const jerk = Number(motion.jerk) > 0 ? Number(motion.jerk) : Infinity;
  const total = chain.reduce((sum, piece) => sum + piece.length, 0);
  const count = Math.max(8, Math.min(6000, Math.ceil(total / Math.max(0.05, total / 4000))));
  const ds = total / count;
  const offsets = [];
  let acc = 0;
  chain.forEach((piece) => { offsets.push(acc); acc += piece.length; });
  const limit = new Float64Array(count + 1).fill(velocity);
  const pieceAt = (s) => {
    let i = chain.length - 1;
    while (i > 0 && offsets[i] > s) i -= 1;
    return i;
  };
  for (let k = 0; k <= count; k += 1) {
    const s = Math.min(total, k * ds);
    const piece = chain[pieceAt(Math.min(s, total - 1e-9))];
    let v = piece.feed > 0 ? Math.min(velocity, piece.feed) : velocity;
    if (Number.isFinite(piece.radius)) v = Math.min(v, Math.sqrt(accel * piece.radius));
    limit[k] = v;
  }
  vertices.forEach((vertex, i) => {
    if (vertex.limit !== 'corner') return;
    const k = Math.round(offsets[i + 1] / ds);
    const cap = Math.sqrt(accel * vertex.blend);
    for (let j = Math.max(0, k - 1); j <= Math.min(count, k + 1); j += 1) limit[j] = Math.min(limit[j], cap);
  });
  limit[0] = 0;
  limit[count] = 0;
  const back = Float64Array.from(limit);
  for (let k = count - 1; k >= 0; k -= 1) back[k] = Math.min(back[k], Math.sqrt(back[k + 1] ** 2 + 2 * accel * ds));
  const speed = Float64Array.from(back);
  for (let k = 1; k <= count; k += 1) speed[k] = Math.min(speed[k], Math.sqrt(speed[k - 1] ** 2 + 2 * accel * ds));
  // tiempo acumulado por tramo con aceleración constante
  const time = new Float64Array(count + 1);
  for (let k = 1; k <= count; k += 1) {
    const sum = speed[k - 1] + speed[k];
    time[k] = time[k - 1] + (sum > 1e-12 ? (2 * ds) / sum : Math.sqrt((2 * ds) / accel));
  }
  let duration = time[count];
  let dtGrid = Math.max(0.0005, duration / 40000);
  const window = Number.isFinite(jerk) ? accel / jerk : 0;
  const smooth = motion.profile === 'scurve' && window > dtGrid * 2;
  const samples = Math.ceil(duration / dtGrid) + 1;
  const sOfT = new Float64Array(samples);
  const vOfT = new Float64Array(samples);
  let cursor = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = Math.min(duration, i * dtGrid);
    while (cursor < count - 1 && time[cursor + 1] < t) cursor += 1;
    const span = Math.max(1e-12, time[cursor + 1] - time[cursor]);
    const f = Math.min(1, Math.max(0, (t - time[cursor]) / span));
    sOfT[i] = (cursor + f) * ds;
    vOfT[i] = speed[cursor] + (speed[cursor + 1] - speed[cursor]) * f;
  }
  if (!smooth) return { length: total, duration, dt: dtGrid, s: sOfT, v: vOfT, chain, offsets };
  // suavizado: promedio móvil de ancho `window` sobre la velocidad (conserva la distancia total; limita el jerk a aMax/window)
  const half = Math.max(1, Math.round(window / dtGrid));
  const padded = samples + half * 2;
  const smoothed = new Float64Array(padded);
  const prefix = new Float64Array(samples + 1);
  for (let i = 0; i < samples; i += 1) prefix[i + 1] = prefix[i] + vOfT[i];
  for (let i = 0; i < padded; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(samples, i);
    smoothed[i] = hi > lo ? (prefix[hi] - prefix[lo]) / half : 0;
  }
  const outS = new Float64Array(padded);
  for (let i = 1; i < padded; i += 1) outS[i] = outS[i - 1] + ((smoothed[i - 1] + smoothed[i]) / 2) * dtGrid;
  const scale = outS[padded - 1] > 0 ? total / outS[padded - 1] : 1; // corrige el error de integración numérica
  for (let i = 0; i < padded; i += 1) {
    outS[i] *= scale;
    smoothed[i] *= scale;
  }
  duration = (padded - 1) * dtGrid;
  return { length: total, duration, dt: dtGrid, s: outS, v: smoothed, chain, offsets };
}

// Trayectoria completa: { duration, length, warnings, at(t) → { pos, vel, speed } }.
export function buildPath(motion) {
  const { pieces, vertices, warnings } = buildPieces(motion);
  if (!pieces.length) return { duration: 0, length: 0, warnings, vertices: [], at: () => ({ pos: vec(motion.start), vel: [0, 0, 0], speed: 0 }) };
  const chains = [];
  let currentChain = [pieces[0]];
  let currentVertices = [];
  const chainVertices = [];
  vertices.forEach((vertex, i) => {
    if (vertex.stop) {
      chains.push(currentChain);
      chainVertices.push(currentVertices);
      currentChain = [pieces[i + 1]];
      currentVertices = [];
    } else {
      currentChain.push(pieces[i + 1]);
      currentVertices.push(vertex);
    }
  });
  chains.push(currentChain);
  chainVertices.push(currentVertices);
  const plans = chains.map((chain, i) => planChain(chain, chainVertices[i], motion));
  const dwell = Math.max(0, Number(motion.dwell) || 0);
  const t0 = Number(motion.startTime) || 0;
  const starts = [];
  let clock = t0;
  plans.forEach((plan, i) => {
    starts.push(clock);
    clock += plan.duration + (i < plans.length - 1 ? dwell : 0);
  });
  const duration = clock - t0;
  const stateAt = (plan, localT) => {
    const index = Math.min(plan.s.length - 2, Math.max(0, Math.floor(localT / plan.dt)));
    const f = Math.min(1, Math.max(0, localT / plan.dt - index));
    const s = plan.s[index] + (plan.s[index + 1] - plan.s[index]) * f;
    const v = plan.v[index] + (plan.v[index + 1] - plan.v[index]) * f;
    return { s: Math.min(plan.length, Math.max(0, s)), v };
  };
  const pointOnChain = (plan, s) => {
    let i = plan.chain.length - 1;
    while (i > 0 && plan.offsets[i] > s) i -= 1;
    return { point: plan.chain[i].at(Math.min(plan.chain[i].length, Math.max(0, s - plan.offsets[i]))), piece: plan.chain[i], local: s - plan.offsets[i] };
  };
  const at = (t) => {
    let i = plans.length - 1;
    while (i > 0 && starts[i] > t) i -= 1;
    const plan = plans[i];
    const localT = t - starts[i];
    if (localT <= 0 && i === 0) return { pos: vec(motion.start), vel: [0, 0, 0], speed: 0 };
    if (localT >= plan.duration) return { pos: pointOnChain(plan, plan.length).point, vel: [0, 0, 0], speed: 0 };
    const { s, v } = stateAt(plan, Math.max(0, localT));
    const { point, piece, local } = pointOnChain(plan, s);
    const delta = Math.min(1e-3 * Math.max(1, piece.length), 0.01);
    const direction = unit(sub(piece.at(Math.min(piece.length, local + delta)), piece.at(Math.max(0, local - delta))));
    return { pos: point, vel: mul(direction, v), speed: v };
  };
  return { duration, length: plans.reduce((sum, plan) => sum + plan.length, 0), warnings, vertices, stops: plans.length - 1, startTime: t0, at };
}
