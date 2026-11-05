// Gradiente conjugado precondicionado (MIC(0)) para la ecuación de Poisson de 7 puntos con coeficientes variables.
// Puro: sin DOM. Matriz simétrica definida positiva sobre las celdas `active`:
//   (A x)[c] = diag[c]·x[c] + ax[c]·x[c+1] + ax[c−1]·x[c−1] + ay[c]·x[c+nx] + ay[c−nx]·x[c−nx] + az[c]·x[c+nx·ny] + az[c−nx·ny]·x[c−nx·ny]
// `ax/ay/az[c]` acoplan la celda c con su vecina +x/+y/+z (valores ≤ 0; 0 si la cara está cerrada o la vecina está inactiva).

export class PoissonPcg {
  constructor(nx, ny, nz) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.n = nx * ny * nz;
    const make = () => new Float64Array(this.n);
    this.diag = make();
    this.ax = make();
    this.ay = make();
    this.az = make();
    this.active = new Uint8Array(this.n);
    this.pre = make();
    this.r = make();
    this.z = make();
    this.d = make();
    this.q = make();
    this.tmp = make();
    this.lastIterations = 0;
    this.lastResidual = 0;
  }

  // Precondicionador de Cholesky incompleto modificado (tau = 0,97, sigma = 0,25: valores clásicos de Bridson).
  buildPreconditioner() {
    const { nx, ny, nz, diag, ax, ay, az, active, pre } = this;
    const nxy = nx * ny;
    const tau = 0.97;
    const sigma = 0.25;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        let c = nx * (j + ny * k);
        for (let i = 0; i < nx; i += 1, c += 1) {
          if (!active[c]) {
            pre[c] = 0;
            continue;
          }
          let e = diag[c];
          if (i > 0) {
            const p = pre[c - 1];
            const a = ax[c - 1];
            e -= a * a * p * p + tau * a * (ay[c - 1] + az[c - 1]) * p * p;
          }
          if (j > 0) {
            const p = pre[c - nx];
            const a = ay[c - nx];
            e -= a * a * p * p + tau * a * (ax[c - nx] + az[c - nx]) * p * p;
          }
          if (k > 0) {
            const p = pre[c - nxy];
            const a = az[c - nxy];
            e -= a * a * p * p + tau * a * (ax[c - nxy] + ay[c - nxy]) * p * p;
          }
          if (e < sigma * diag[c]) e = diag[c];
          pre[c] = 1 / Math.sqrt(e);
        }
      }
    }
  }

  // z = M⁻¹ r (dos barridos triangulares).
  applyPreconditioner(r, z) {
    const { nx, ny, nz, ax, ay, az, active, pre, q } = this;
    const nxy = nx * ny;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        let c = nx * (j + ny * k);
        for (let i = 0; i < nx; i += 1, c += 1) {
          if (!active[c]) {
            q[c] = 0;
            continue;
          }
          let t = r[c];
          if (i > 0) t -= ax[c - 1] * pre[c - 1] * q[c - 1];
          if (j > 0) t -= ay[c - nx] * pre[c - nx] * q[c - nx];
          if (k > 0) t -= az[c - nxy] * pre[c - nxy] * q[c - nxy];
          q[c] = t * pre[c];
        }
      }
    }
    for (let k = nz - 1; k >= 0; k -= 1) {
      for (let j = ny - 1; j >= 0; j -= 1) {
        let c = nx - 1 + nx * (j + ny * k);
        for (let i = nx - 1; i >= 0; i -= 1, c -= 1) {
          if (!active[c]) {
            z[c] = 0;
            continue;
          }
          let t = q[c];
          if (i < nx - 1) t -= ax[c] * pre[c] * z[c + 1];
          if (j < ny - 1) t -= ay[c] * pre[c] * z[c + nx];
          if (k < nz - 1) t -= az[c] * pre[c] * z[c + nxy];
          z[c] = t * pre[c];
        }
      }
    }
  }

  multiply(x, y) {
    const { nx, ny, nz, diag, ax, ay, az, active } = this;
    const nxy = nx * ny;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        let c = nx * (j + ny * k);
        for (let i = 0; i < nx; i += 1, c += 1) {
          if (!active[c]) {
            y[c] = 0;
            continue;
          }
          let s = diag[c] * x[c];
          if (i < nx - 1) s += ax[c] * x[c + 1];
          if (i > 0) s += ax[c - 1] * x[c - 1];
          if (j < ny - 1) s += ay[c] * x[c + nx];
          if (j > 0) s += ay[c - nx] * x[c - nx];
          if (k < nz - 1) s += az[c] * x[c + nxy];
          if (k > 0) s += az[c - nxy] * x[c - nxy];
          y[c] = s;
        }
      }
    }
  }

  // Resuelve A x = b partiendo de x (arranque en caliente). Corta cuando max|r| ≤ tolerance o tras maxIterations.
  // Devuelve { iterations, residual }.
  solve(b, x, { tolerance = 1e-6, maxIterations = 200 } = {}) {
    const { n, r, z, d, q, active } = this;
    this.multiply(x, q);
    let rmax = 0;
    for (let c = 0; c < n; c += 1) {
      r[c] = active[c] ? b[c] - q[c] : 0;
      rmax = Math.max(rmax, Math.abs(r[c]));
    }
    if (rmax <= tolerance) {
      this.lastIterations = 0;
      this.lastResidual = rmax;
      return { iterations: 0, residual: rmax };
    }
    this.applyPreconditioner(r, z);
    let sigma = 0;
    for (let c = 0; c < n; c += 1) {
      d[c] = z[c];
      sigma += r[c] * z[c];
    }
    let iterations = 0;
    while (iterations < maxIterations) {
      this.multiply(d, q);
      let dq = 0;
      for (let c = 0; c < n; c += 1) dq += d[c] * q[c];
      if (!(dq > 0)) break;
      const alpha = sigma / dq;
      rmax = 0;
      for (let c = 0; c < n; c += 1) {
        x[c] += alpha * d[c];
        r[c] -= alpha * q[c];
        rmax = Math.max(rmax, Math.abs(r[c]));
      }
      iterations += 1;
      if (rmax <= tolerance) break;
      this.applyPreconditioner(r, z);
      let next = 0;
      for (let c = 0; c < n; c += 1) next += r[c] * z[c];
      const beta = next / sigma;
      sigma = next;
      for (let c = 0; c < n; c += 1) d[c] = z[c] + beta * d[c];
    }
    this.lastIterations = iterations;
    this.lastResidual = rmax;
    return { iterations, residual: rmax };
  }
}
