// Cuerpos rígidos tipo caja (productos sobre cintas): dinámica de posiciones (XPBD) con fricción de Coulomb, contacto contra el
// entorno (SDF de las piezas, con velocidad de superficie para cintas) y entre cajas. Puro, sin DOM. Unidades: mm, kg, s; inercia en kg·mm².
// Cada caja se prueba con 26 puntos (8 vértices, 12 mitades de arista y 6 centros de cara) contra el entorno y contra las otras cajas.

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qNorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
// Rotación de un vector por el cuaternión q = [x, y, z, w].
const rot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const quatFromYaw = (degrees) => {
  const h = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(h), Math.cos(h)];
};

// Puntos de prueba sobre la superficie: retícula de paso ≤ `spacing` mm en cada eje (solo los de la cáscara). Una caja apoyada sobre
// rodillos de 50 mm con huecos de 40 mm necesita al menos un punto sobre cada rodillo, por eso no alcanza con vértices y centros.
const samplePoints = (hx, hy, hz, spacing = 45) => {
  const segments = [hx, hy, hz].map((h) => Math.max(1, Math.min(8, Math.ceil((2 * h) / spacing))));
  const axis = (h, n) => Array.from({ length: n + 1 }, (_, i) => -h + (2 * h * i) / n);
  const [xs, ys, zs] = [axis(hx, segments[0]), axis(hy, segments[1]), axis(hz, segments[2])];
  const pts = [];
  xs.forEach((x, i) => ys.forEach((y, j) => zs.forEach((z, k) => {
    if (i === 0 || i === xs.length - 1 || j === 0 || j === ys.length - 1 || k === 0 || k === zs.length - 1) pts.push([x, y, z]);
  })));
  return pts;
};

// Matriz de rotación (9 números, por filas) de un cuaternión [x, y, z, w].
const matrixOf = (q, m) => {
  const [x, y, z, w] = q;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
};

// Distancia con signo a una caja (en su marco) y normal local hacia afuera.
function boxSdf(local, half, out) {
  const q = [Math.abs(local[0]) - half[0], Math.abs(local[1]) - half[1], Math.abs(local[2]) - half[2]];
  const sign = [local[0] < 0 ? -1 : 1, local[1] < 0 ? -1 : 1, local[2] < 0 ? -1 : 1];
  const outside = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)];
  const length = Math.hypot(...outside);
  if (length > 0) {
    out.d = length;
    out.n = outside.map((v, i) => (v / length) * sign[i]);
    return;
  }
  const axis = q[0] >= q[1] && q[0] >= q[2] ? 0 : q[1] >= q[2] ? 1 : 2;
  out.d = q[axis];
  out.n = [0, 0, 0];
  out.n[axis] = sign[axis];
}

export class RigidWorld {
  constructor({ gravity = 9810, damping = 0.4, iterations = 6, spacing = 45 } = {}) {
    this.gravity = gravity;
    this.spacing = spacing;
    this.damping = damping;
    this.iterations = iterations;
    this.bodies = [];
    this.nextId = 1;
  }

  get count() {
    return this.bodies.length;
  }

  // size = [x, y, z] mm completos; mass kg; friction μ (entre el producto y lo que toque).
  add({ pos, quat = [0, 0, 0, 1], size, mass, friction = 0.5, group = null }) {
    const [sx, sy, sz] = size;
    const half = [sx / 2, sy / 2, sz / 2];
    const body = {
      id: this.nextId,
      group,
      x: [...pos],
      q: qNorm(quat),
      v: [0, 0, 0],
      w: [0, 0, 0],
      half,
      mass,
      invM: 1 / mass,
      invI: [12 / (mass * (sy * sy + sz * sz)), 12 / (mass * (sx * sx + sz * sz)), 12 / (mass * (sx * sx + sy * sy))],
      friction,
      pts: samplePoints(half[0], half[1], half[2], this.spacing),
      reach: Math.hypot(...half),
      xp: [...pos],
      qp: qNorm(quat),
      R: new Float64Array(9),
      Rp: new Float64Array(9),
      touch: 0,
    };
    matrixOf(body.q, body.R);
    body.Rp.set(body.R);
    this.nextId += 1;
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    this.bodies = this.bodies.filter((item) => item !== body);
  }

  clear() {
    this.bodies = [];
  }

  // Inercia inversa en el marco del mundo aplicada a un vector (R · diag(invI) · Rᵀ · v).
  invIApply(b, v) {
    const R = b.R;
    const lx = (R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) * b.invI[0];
    const ly = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) * b.invI[1];
    const lz = (R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) * b.invI[2];
    return [R[0] * lx + R[1] * ly + R[2] * lz, R[3] * lx + R[4] * ly + R[5] * lz, R[6] * lx + R[7] * ly + R[8] * lz];
  }

  // Un contacto: el punto `p` (mundo) de A penetró `d` (<0) a lo largo de `n` (de la superficie hacia afuera).
  // B = null: entorno fijo (con velocidad de superficie `surf` mm/s). Corrige posiciones y recorta el deslizamiento por Coulomb.
  contact(a, p, d, n, b, surf, h) {
    a.touch += 1;
    if (b) b.touch += 1;
    const ra = [p[0] - a.x[0], p[1] - a.x[1], p[2] - a.x[2]];
    const rn = cross(ra, n);
    const ia = this.invIApply(a, rn);
    let w = a.invM + dot(rn, ia);
    let rb = null;
    let ib = null;
    if (b) {
      rb = [p[0] - b.x[0], p[1] - b.x[1], p[2] - b.x[2]];
      const rnb = cross(rb, n);
      ib = this.invIApply(b, rnb);
      w += b.invM + dot(rnb, ib);
    }
    const lambda = -d / w;
    this.push(a, n, lambda, ra, 1);
    if (b) this.push(b, n, lambda, rb, -1);
    // fricción: desplazamiento relativo del punto en este subpaso (menos lo que avanza la superficie de la cinta)
    const pa = this.prevPoint(a, p, a);
    let slip = [p[0] - pa[0] - (surf ? surf[0] * h : 0), p[1] - pa[1] - (surf ? surf[1] * h : 0), p[2] - pa[2] - (surf ? surf[2] * h : 0)];
    if (b) {
      const pb = this.prevPoint(b, p, b);
      slip = [slip[0] - (p[0] - pb[0]), slip[1] - (p[1] - pb[1]), slip[2] - (p[2] - pb[2])];
    }
    const normal = dot(slip, n);
    const tangent = [slip[0] - normal * n[0], slip[1] - normal * n[1], slip[2] - normal * n[2]];
    const length = Math.hypot(...tangent);
    if (length < 1e-12) return;
    const mu = b ? Math.min(a.friction, b.friction) : a.friction;
    const cut = Math.min(length, mu * -d);
    const t = tangent.map((v) => v / length);
    const rt = cross(ra, t);
    let wt = a.invM + dot(rt, this.invIApply(a, rt));
    if (b) {
      const rtb = cross(rb, t);
      wt += b.invM + dot(rtb, this.invIApply(b, rtb));
    }
    const lt = cut / wt;
    this.push(a, t, lt, ra, -1);
    if (b) this.push(b, t, lt, rb, 1);
  }

  // Aplica un impulso de posición λ·dir en el punto con brazo r.
  push(b, dir, lambda, r, sign) {
    const k = sign * lambda;
    b.x[0] += b.invM * dir[0] * k;
    b.x[1] += b.invM * dir[1] * k;
    b.x[2] += b.invM * dir[2] * k;
    const theta = this.invIApply(b, cross(r, dir));
    const dq = qMul([theta[0] * k * 0.5, theta[1] * k * 0.5, theta[2] * k * 0.5, 0], b.q);
    b.q = qNorm([b.q[0] + dq[0], b.q[1] + dq[1], b.q[2] + dq[2], b.q[3] + dq[3]]);
    matrixOf(b.q, b.R);
  }

  // Posición que tendría en el paso anterior el punto del cuerpo `of` que hoy está en `p` (usa las matrices actual y previa).
  prevPoint(of, p) {
    const R = of.R;
    const Rp = of.Rp;
    const dx = p[0] - of.x[0];
    const dy = p[1] - of.x[1];
    const dz = p[2] - of.x[2];
    const lx = R[0] * dx + R[3] * dy + R[6] * dz;
    const ly = R[1] * dx + R[4] * dy + R[7] * dz;
    const lz = R[2] * dx + R[5] * dy + R[8] * dz;
    return [of.xp[0] + Rp[0] * lx + Rp[1] * ly + Rp[2] * lz, of.xp[1] + Rp[3] * lx + Rp[4] * ly + Rp[5] * lz, of.xp[2] + Rp[6] * lx + Rp[7] * ly + Rp[8] * lz];
  }

  // env.query(x, y, z, out) → true si hay material cerca; out = { d, nx, ny, nz, vx, vy, vz } (d con signo, normal hacia afuera, velocidad de superficie).
  // Un paso `h`: se subdivide si algún punto de una caja recorrería más de ~2,5 mm (más que la banda del SDF del entorno: sin esto una
  // caja que cae rápido atraviesa un rodillo delgado porque dentro de la banda no hay normal).
  step(h, env) {
    let fastest = 0;
    this.bodies.forEach((b) => {
      const speed = Math.hypot(b.v[0], b.v[1], b.v[2] - this.gravity * h) + Math.hypot(b.w[0], b.w[1], b.w[2]) * b.reach;
      fastest = Math.max(fastest, speed);
    });
    const sub = Math.max(1, Math.min(8, Math.ceil((fastest * h) / 2)));
    for (let k = 0; k < sub; k += 1) this.stepOnce(h / sub, env);
  }

  stepOnce(h, env) {
    const bodies = this.bodies;
    bodies.forEach((b) => {
      b.touch = 0;
      b.xp = [b.x[0], b.x[1], b.x[2]];
      b.qp = [b.q[0], b.q[1], b.q[2], b.q[3]];
      b.Rp.set(b.R);
      b.v[2] -= this.gravity * h;
      b.x[0] += b.v[0] * h;
      b.x[1] += b.v[1] * h;
      b.x[2] += b.v[2] * h;
      const dq = qMul([b.w[0] * h * 0.5, b.w[1] * h * 0.5, b.w[2] * h * 0.5, 0], b.q);
      b.q = qNorm([b.q[0] + dq[0], b.q[1] + dq[1], b.q[2] + dq[2], b.q[3] + dq[3]]);
      matrixOf(b.q, b.R);
    });
    const out = { d: 0, nx: 0, ny: 0, nz: 1, vx: 0, vy: 0, vz: 0 };
    const sdf = { d: 0, n: [0, 0, 1] };
    const p = [0, 0, 0];
    const normal = [0, 0, 1];
    const surf = [0, 0, 0];
    const local = [0, 0, 0];
    for (let iteration = 0; iteration < this.iterations; iteration += 1) {
      const reverse = iteration % 2 === 1; // barrido simétrico: una fila de cajas empujada contra un tope converge en pocas pasadas
      for (let ii = 0; ii < bodies.length; ii += 1) {
        const i = reverse ? bodies.length - 1 - ii : ii;
        for (let jj = ii + 1; jj < bodies.length; jj += 1) {
          const j = reverse ? bodies.length - 1 - jj : jj;
          const a = bodies[i];
          const b = bodies[j];
          const dx = a.x[0] - b.x[0];
          const dy = a.x[1] - b.x[1];
          const dz = a.x[2] - b.x[2];
          const reach = a.reach + b.reach;
          if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
          for (let side = 0; side < 2; side += 1) {
            const from = side === 0 ? a : b;
            const into = side === 0 ? b : a;
            const R = from.R;
            const Q = into.R;
            for (let k = 0; k < from.pts.length; k += 1) {
              const l = from.pts[k];
              p[0] = from.x[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2];
              p[1] = from.x[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2];
              p[2] = from.x[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2];
              const rx = p[0] - into.x[0];
              const ry = p[1] - into.x[1];
              const rz = p[2] - into.x[2];
              local[0] = Q[0] * rx + Q[3] * ry + Q[6] * rz;
              local[1] = Q[1] * rx + Q[4] * ry + Q[7] * rz;
              local[2] = Q[2] * rx + Q[5] * ry + Q[8] * rz;
              if (Math.abs(local[0]) > into.half[0] || Math.abs(local[1]) > into.half[1] || Math.abs(local[2]) > into.half[2]) continue; // fuera de la caja: sin contacto
              boxSdf(local, into.half, sdf);
              normal[0] = Q[0] * sdf.n[0] + Q[1] * sdf.n[1] + Q[2] * sdf.n[2];
              normal[1] = Q[3] * sdf.n[0] + Q[4] * sdf.n[1] + Q[5] * sdf.n[2];
              normal[2] = Q[6] * sdf.n[0] + Q[7] * sdf.n[1] + Q[8] * sdf.n[2];
              this.contact(from, p, sdf.d, normal, into, null, h);
            }
          }
        }
      }
      for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i];
        for (let k = 0; k < a.pts.length; k += 1) {
          const l = a.pts[k];
          const R = a.R;
          p[0] = a.x[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2];
          p[1] = a.x[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2];
          p[2] = a.x[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2];
          if (!env.query(p[0], p[1], p[2], out) || out.d >= 0) continue;
          normal[0] = out.nx; normal[1] = out.ny; normal[2] = out.nz;
          surf[0] = out.vx; surf[1] = out.vy; surf[2] = out.vz;
          this.contact(a, p, out.d, normal, null, surf, h);
        }
      }
    }
    bodies.forEach((b) => {
      // adherencia de reposo: el solver de posiciones deja un «creep» lateral minúsculo en una pila apoyada; si el corrimiento del
      // subpaso es despreciable (< 0,03 mm y < 0,006°) la caja se queda donde estaba (solo sigue asentándose en vertical)
      if (b.touch > 0) {
        const dqRest = qMul(b.q, conj(b.qp));
        if (Math.hypot(b.x[0] - b.xp[0], b.x[1] - b.xp[1]) < 0.03 && 2 * Math.hypot(dqRest[0], dqRest[1], dqRest[2]) < 1e-4) {
          b.x[0] = b.xp[0];
          b.x[1] = b.xp[1];
          b.q = [b.qp[0], b.qp[1], b.qp[2], b.qp[3]];
          matrixOf(b.q, b.R);
        }
      }
      const dq = qMul(b.q, conj(b.qp));
      const sgn = dq[3] < 0 ? -2 / h : 2 / h;
      let vx = (b.x[0] - b.xp[0]) / h;
      let vy = (b.x[1] - b.xp[1]) / h;
      let vz = (b.x[2] - b.xp[2]) / h;
      let wx = dq[0] * sgn;
      let wy = dq[1] * sgn;
      let wz = dq[2] * sgn;
      // apoyada y casi quieta: se amortigua fuerte para que el «creep» del solver de posiciones no la haga derivar
      const slow = b.touch > 0 && Math.hypot(vx, vy, vz) < 40 && Math.hypot(wx, wy, wz) < 0.08;
      const keep = Math.max(0, 1 - (slow ? 25 : this.damping) * h);
      vx *= keep; vy *= keep; vz *= keep; wx *= keep; wy *= keep; wz *= keep;
      b.v = [vx, vy, vz];
      b.w = [wx, wy, wz];
    });
  }

  // x, y, z, qx, qy, qz, qw, hx, hy, hz por cuerpo (para el visor).
  snapshot() {
    const out = new Float32Array(this.bodies.length * 10);
    this.bodies.forEach((b, i) => out.set([...b.x, ...b.q, ...b.half], i * 10));
    return out;
  }
}
