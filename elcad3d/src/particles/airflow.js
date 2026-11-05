import { sampleSdf } from './sdf.js';

// Campo de aire en grilla (fluido estable de Stam): fuerzas de boquillas y viento → advección → proyección con sólidos.
// El aire rodea obstáculos, se frena contra paredes y se desvía en esquinas. Es cualitativo y de grilla gruesa.
// Un solo sentido: el aire arrastra partículas, las partículas no empujan al aire.
// Unidades: mm, s. `bodies` son los mismos cuerpos del simulador de partículas (con su pose actual).

export class AirGrid {
  constructor({ lo, hi, bodies, cells = 30000 }) {
    const size = [0, 1, 2].map((k) => Math.max(1, hi[k] - lo[k]));
    const h = Math.cbrt((size[0] * size[1] * size[2]) / cells);
    this.h = h;
    this.dims = size.map((value) => Math.max(4, Math.ceil(value / h) + 2));
    this.origin = lo.map((value) => value - h);
    const [nx, ny, nz] = this.dims;
    this.n = nx * ny * nz;
    const make = () => new Float32Array(this.n);
    this.u = make();
    this.v = make();
    this.w = make();
    this.u0 = make();
    this.v0 = make();
    this.w0 = make();
    this.p = make();
    this.div = make();
    this.fixed = new Uint8Array(this.n); // celdas con velocidad impuesta (boca de boquilla, viento entrante)
    this.tmp = make();
    this.solid = new Uint8Array(this.n);
    this.solidStatic = new Uint8Array(this.n);
    this.bodies = bodies;
    this.poseKey = '';
    this.acc = 0;
    this.stepCost = 0;
    this.grad = [0, 0, 0];
    this.buildStatic();
  }

  index(i, j, k) {
    return i + this.dims[0] * (j + this.dims[1] * k);
  }

  center(i, j, k, out) {
    out[0] = this.origin[0] + (i + 0.5) * this.h;
    out[1] = this.origin[1] + (j + 0.5) * this.h;
    out[2] = this.origin[2] + (k + 0.5) * this.h;
  }

  // Distancia de un punto a un cuerpo en su pose actual (misma convención que ParticleSim.bodyDistance).
  bodyDistance(body, x, y, z) {
    let lx = x;
    let ly = y;
    let lz = z;
    if (body.movable) {
      const [px, py, pz] = body.pivot;
      const rx = x - body.offset[0] - px;
      const ry = y - body.offset[1] - py;
      const rz = z - body.offset[2] - pz;
      if (body.angle !== 0) {
        const [kx, ky, kz] = body.axis;
        const c = Math.cos(body.angle);
        const s = Math.sin(body.angle);
        const kd = kx * rx + ky * ry + kz * rz;
        lx = px + rx * c - (ky * rz - kz * ry) * s + kx * kd * (1 - c);
        ly = py + ry * c - (kz * rx - kx * rz) * s + ky * kd * (1 - c);
        lz = pz + rz * c - (kx * ry - ky * rx) * s + kz * kd * (1 - c);
      } else {
        lx = px + rx;
        ly = py + ry;
        lz = pz + rz;
      }
    }
    return sampleSdf(body.sdf, lx, ly, lz, this.grad);
  }

  // Una celda es sólida si su centro está a menos de ~medio paso de la superficie (así las paredes finas no dejan pasar aire).
  markSolid(target, movable) {
    const c = [0, 0, 0];
    const [nx, ny, nz] = this.dims;
    const bodies = this.bodies.filter((body) => body.movable === movable);
    if (!bodies.length) return;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          this.center(i, j, k, c);
          for (const body of bodies) {
            const limit = Math.min(0.55 * this.h, body.sdf.band * 0.9);
            if (this.bodyDistance(body, c[0], c[1], c[2]) < limit) {
              target[this.index(i, j, k)] = 1;
              break;
            }
          }
        }
      }
    }
  }

  buildStatic() {
    this.markSolid(this.solidStatic, false);
    this.solid.set(this.solidStatic);
  }

  // Los cuerpos móviles solo se revoxelizan cuando cambió su pose.
  refreshMovable() {
    const movers = this.bodies.filter((body) => body.movable);
    if (!movers.length) return;
    const key = movers.map((body) => `${body.angle.toFixed(3)},${body.offset.map((v) => v.toFixed(2))}`).join('|');
    if (key === this.poseKey) return;
    this.poseKey = key;
    this.solid.set(this.solidStatic);
    this.markSolid(this.solid, true);
    for (let c = 0; c < this.n; c += 1) {
      if (this.solid[c]) {
        this.u[c] = 0;
        this.v[c] = 0;
        this.w[c] = 0;
      }
    }
  }

  // ¿Hay sólido entre a y b? (muestreo sobre la máscara)
  blockedLine(ax, ay, az, bx, by, bz) {
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(2, Math.ceil(length / (this.h * 0.8)));
    const [nx, ny, nz] = this.dims;
    for (let s = 1; s < steps; s += 1) {
      const f = s / steps;
      const i = Math.floor((ax + (bx - ax) * f - this.origin[0]) / this.h);
      const j = Math.floor((ay + (by - ay) * f - this.origin[1]) / this.h);
      const k = Math.floor((az + (bz - az) * f - this.origin[2]) / this.h);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
      if (this.solid[i + nx * (j + ny * k)]) return true;
    }
    return false;
  }

  // Velocidades impuestas: el chorro de cada boquilla activa (cono, caída con la distancia, con sombra de paredes) y el viento
  // entrante por las caras de barlovento. Esas celdas no las toca la proyección: funcionan como condición de borde.
  applySources(nozzles, wind) {
    const [nx, ny, nz] = this.dims;
    const { fixed, u, v, w } = this;
    fixed.fill(0);
    const c = [0, 0, 0];
    nozzles.forEach((nozzle) => {
      if (!(nozzle.level > 0)) return;
      const reach = nozzle.range;
      const radiusEnd = nozzle.radius + reach * nozzle.tan;
      const lo = [0, 1, 2].map((a) => Math.max(0, Math.floor((Math.min(nozzle.pos[a], nozzle.pos[a] + nozzle.dir[a] * reach) - radiusEnd - this.origin[a]) / this.h)));
      const hi = [0, 1, 2].map((a) => Math.min(this.dims[a] - 1, Math.ceil((Math.max(nozzle.pos[a], nozzle.pos[a] + nozzle.dir[a] * reach) + radiusEnd - this.origin[a]) / this.h)));
      for (let kk = lo[2]; kk <= hi[2]; kk += 1) {
        for (let jj = lo[1]; jj <= hi[1]; jj += 1) {
          for (let ii = lo[0]; ii <= hi[0]; ii += 1) {
            const cell = ii + nx * (jj + ny * kk);
            if (this.solid[cell]) continue;
            this.center(ii, jj, kk, c);
            const dx = c[0] - nozzle.pos[0];
            const dy = c[1] - nozzle.pos[1];
            const dz = c[2] - nozzle.pos[2];
            const along = dx * nozzle.dir[0] + dy * nozzle.dir[1] + dz * nozzle.dir[2];
            if (along < -this.h * 0.5 || along > reach) continue;
            const rx = dx - along * nozzle.dir[0];
            const ry = dy - along * nozzle.dir[1];
            const rz = dz - along * nozzle.dir[2];
            const radial2 = rx * rx + ry * ry + rz * rz;
            const rmax = nozzle.radius + Math.max(0, along) * nozzle.tan + this.h * 0.5;
            if (radial2 > rmax * rmax) continue;
            if (this.blockedLine(nozzle.pos[0], nozzle.pos[1], nozzle.pos[2], c[0], c[1], c[2])) continue;
            const axial = 1 - Math.max(0, along) / reach;
            const f = nozzle.level * nozzle.speed * axial * axial * (1 - radial2 / (rmax * rmax));
            // contra una pared el chorro deja de ser condición de borde: ahí el aire se frena y se abre hacia los costados
            const near = this.blockedLine(c[0], c[1], c[2], c[0] + nozzle.dir[0] * this.h * 2.4, c[1] + nozzle.dir[1] * this.h * 2.4, c[2] + nozzle.dir[2] * this.h * 2.4);
            fixed[cell] = near ? 0 : 1;
            u[cell] = nozzle.dir[0] * f;
            v[cell] = nozzle.dir[1] * f;
            w[cell] = nozzle.dir[2] * f;
          }
        }
      }
    });
    if (Math.hypot(...wind) > 1) {
      for (let a = 0; a < 3; a += 1) {
        if (Math.abs(wind[a]) < 1e-6) continue;
        const layer = wind[a] > 0 ? 1 : this.dims[a] - 2;
        for (let kk = 1; kk < nz - 1; kk += 1) {
          for (let jj = 1; jj < ny - 1; jj += 1) {
            for (let ii = 1; ii < nx - 1; ii += 1) {
              if ([ii, jj, kk][a] !== layer) continue;
              const cell = ii + nx * (jj + ny * kk);
              if (this.solid[cell] || fixed[cell]) continue;
              fixed[cell] = 1;
              u[cell] = wind[0];
              v[cell] = wind[1];
              w[cell] = wind[2];
            }
          }
        }
      }
    }
  }

  sampleInto(field, x, y, z) {
    const [nx, ny, nz] = this.dims;
    const fx = Math.min(nx - 1.001, Math.max(0, (x - this.origin[0]) / this.h - 0.5));
    const fy = Math.min(ny - 1.001, Math.max(0, (y - this.origin[1]) / this.h - 0.5));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - this.origin[2]) / this.h - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const base = i + nx * (j + ny * k);
    const sy = nx;
    const sz = nx * ny;
    const a = field[base] + (field[base + 1] - field[base]) * tx;
    const b = field[base + sy] + (field[base + sy + 1] - field[base + sy]) * tx;
    const c = field[base + sz] + (field[base + sz + 1] - field[base + sz]) * tx;
    const d = field[base + sz + sy] + (field[base + sz + sy + 1] - field[base + sz + sy]) * tx;
    const e = a + (b - a) * ty;
    const f = c + (d - c) * ty;
    return e + (f - e) * tz;
  }

  // Velocidad del aire en un punto del mundo (fuera del dominio vale `fallback`). Las celdas sólidas no cuentan en la
  // interpolación: un grano apoyado sobre el piso ve el aire de las celdas libres vecinas (la grilla es más gruesa que el grano).
  velocityAt(x, y, z, out, fallback = [0, 0, 0]) {
    const [nx, ny, nz] = this.dims;
    const gi = (x - this.origin[0]) / this.h;
    const gj = (y - this.origin[1]) / this.h;
    const gk = (z - this.origin[2]) / this.h;
    if (gi < 0 || gj < 0 || gk < 0 || gi > nx || gj > ny || gk > nz) {
      out[0] = fallback[0];
      out[1] = fallback[1];
      out[2] = fallback[2];
      return;
    }
    const fx = Math.min(nx - 1.001, Math.max(0, gi - 0.5));
    const fy = Math.min(ny - 1.001, Math.max(0, gj - 0.5));
    const fz = Math.min(nz - 1.001, Math.max(0, gk - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const base = i + nx * (j + ny * k);
    let ux = 0;
    let uy = 0;
    let uz = 0;
    let weight = 0;
    for (let c = 0; c < 8; c += 1) {
      const cell = base + (c & 1) + ((c >> 1) & 1) * nx + ((c >> 2) & 1) * nx * ny;
      if (this.solid[cell]) continue;
      const wgt = ((c & 1) ? tx : 1 - tx) * (((c >> 1) & 1) ? ty : 1 - ty) * (((c >> 2) & 1) ? tz : 1 - tz);
      ux += this.u[cell] * wgt;
      uy += this.v[cell] * wgt;
      uz += this.w[cell] * wgt;
      weight += wgt;
    }
    if (weight > 1e-6) {
      out[0] = ux / weight;
      out[1] = uy / weight;
      out[2] = uz / weight;
    } else {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
    }
  }

  // Trilineal de las tres componentes con un solo cálculo de índices y pesos.
  sample3(x, y, z, out) {
    const [nx, ny, nz] = this.dims;
    const fx = Math.min(nx - 1.001, Math.max(0, (x - this.origin[0]) / this.h - 0.5));
    const fy = Math.min(ny - 1.001, Math.max(0, (y - this.origin[1]) / this.h - 0.5));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - this.origin[2]) / this.h - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const base = i + nx * (j + ny * k);
    const sy = nx;
    const sz = nx * ny;
    const w000 = (1 - tx) * (1 - ty) * (1 - tz);
    const w100 = tx * (1 - ty) * (1 - tz);
    const w010 = (1 - tx) * ty * (1 - tz);
    const w110 = tx * ty * (1 - tz);
    const w001 = (1 - tx) * (1 - ty) * tz;
    const w101 = tx * (1 - ty) * tz;
    const w011 = (1 - tx) * ty * tz;
    const w111 = tx * ty * tz;
    const { u0, v0, w0 } = this;
    out[0] = u0[base] * w000 + u0[base + 1] * w100 + u0[base + sy] * w010 + u0[base + sy + 1] * w110 + u0[base + sz] * w001 + u0[base + sz + 1] * w101 + u0[base + sz + sy] * w011 + u0[base + sz + sy + 1] * w111;
    out[1] = v0[base] * w000 + v0[base + 1] * w100 + v0[base + sy] * w010 + v0[base + sy + 1] * w110 + v0[base + sz] * w001 + v0[base + sz + 1] * w101 + v0[base + sz + sy] * w011 + v0[base + sz + sy + 1] * w111;
    out[2] = w0[base] * w000 + w0[base + 1] * w100 + w0[base + sy] * w010 + w0[base + sy + 1] * w110 + w0[base + sz] * w001 + w0[base + sz + 1] * w101 + w0[base + sz + sy] * w011 + w0[base + sz + sy + 1] * w111;
  }

  advect(dt) {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, u0, v0, w0, solid, fixed, h } = this;
    u0.set(u);
    v0.set(v);
    w0.set(w);
    const maxBack = 40 * h; // retroceso acotado (chorros muy rápidos)
    const out = [0, 0, 0];
    for (let k = 0; k < nz; k += 1) {
      const z = this.origin[2] + (k + 0.5) * h;
      for (let j = 0; j < ny; j += 1) {
        const y = this.origin[1] + (j + 0.5) * h;
        for (let i = 0; i < nx; i += 1) {
          const cell = i + nx * (j + ny * k);
          if (solid[cell] || fixed[cell]) continue;
          let bx = u0[cell] * dt;
          let by = v0[cell] * dt;
          let bz = w0[cell] * dt;
          if (bx === 0 && by === 0 && bz === 0) continue;
          const back = Math.hypot(bx, by, bz);
          if (back > maxBack) {
            const f = maxBack / back;
            bx *= f;
            by *= f;
            bz *= f;
          }
          const x = this.origin[0] + (i + 0.5) * h;
          const px = x - bx;
          const py = y - by;
          const pz = z - bz;
          const oi = Math.floor((px - this.origin[0]) / h);
          const oj = Math.floor((py - this.origin[1]) / h);
          const ok = Math.floor((pz - this.origin[2]) / h);
          if (oi >= 0 && oj >= 0 && ok >= 0 && oi < nx && oj < ny && ok < nz && solid[oi + nx * (oj + ny * ok)]) {
            u[cell] *= 0.5;
            v[cell] *= 0.5;
            w[cell] *= 0.5;
            continue;
          }
          this.sample3(px, py, pz, out);
          u[cell] = out[0];
          v[cell] = out[1];
          w[cell] = out[2];
        }
      }
    }
  }

  // Un poco de difusión: abre los chorros como lo hace el aire real y da estabilidad.
  diffuse(alpha, iterations = 2) {
    const [nx, ny, nz] = this.dims;
    const { solid, fixed, tmp } = this;
    const sy = nx;
    const sz = nx * ny;
    [this.u, this.v, this.w].forEach((field) => {
      for (let it = 0; it < iterations; it += 1) {
        tmp.set(field);
        for (let k = 1; k < nz - 1; k += 1) {
          for (let j = 1; j < ny - 1; j += 1) {
            let cell = 1 + nx * (j + ny * k);
            for (let i = 1; i < nx - 1; i += 1, cell += 1) {
              if (solid[cell] || fixed[cell]) continue;
              const sum = tmp[cell - 1] + tmp[cell + 1] + tmp[cell - sy] + tmp[cell + sy] + tmp[cell - sz] + tmp[cell + sz];
              field[cell] = (tmp[cell] + alpha * sum) / (1 + 6 * alpha);
            }
          }
        }
      }
    });
  }

  // Proyección: quita la divergencia respetando sólidos (no atraviesan), celdas impuestas (borde con flujo dado) y caras abiertas
  // (presión 0 afuera). La presión se arrastra de un paso al otro (arranque en caliente) para converger con pocas iteraciones.
  project(iterations = 12) {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, p, div, solid, fixed, h } = this;
    const sx = 1;
    const sy = nx;
    const sz = nx * ny;
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        let c = 1 + nx * (j + ny * k);
        for (let i = 1; i < nx - 1; i += 1, c += 1) {
          if (solid[c] || fixed[c]) {
            div[c] = 0;
            continue;
          }
          const ue = solid[c + sx] ? 0 : u[c + sx];
          const uw = solid[c - sx] ? 0 : u[c - sx];
          const vn = solid[c + sy] ? 0 : v[c + sy];
          const vs = solid[c - sy] ? 0 : v[c - sy];
          const wt = solid[c + sz] ? 0 : w[c + sz];
          const wb = solid[c - sz] ? 0 : w[c - sz];
          div[c] = (ue - uw + vn - vs + wt - wb) / (2 * h);
        }
      }
    }
    const h2 = h * h;
    for (let it = 0; it < iterations; it += 1) {
      for (let k = 1; k < nz - 1; k += 1) {
        for (let j = 1; j < ny - 1; j += 1) {
          let c = 1 + nx * (j + ny * k);
          for (let i = 1; i < nx - 1; i += 1, c += 1) {
            if (solid[c] || fixed[c]) continue;
            let sum = 0;
            let count = 0;
            if (!solid[c - sx] && !fixed[c - sx]) { sum += p[c - sx]; count += 1; }
            if (!solid[c + sx] && !fixed[c + sx]) { sum += p[c + sx]; count += 1; }
            if (!solid[c - sy] && !fixed[c - sy]) { sum += p[c - sy]; count += 1; }
            if (!solid[c + sy] && !fixed[c + sy]) { sum += p[c + sy]; count += 1; }
            if (!solid[c - sz] && !fixed[c - sz]) { sum += p[c - sz]; count += 1; }
            if (!solid[c + sz] && !fixed[c + sz]) { sum += p[c + sz]; count += 1; }
            if (count === 0) continue;
            // las celdas del borde del dominio tienen un vecino fuera con presión 0 (salida abierta)
            const edge = (i === 1 || i === nx - 2 ? 1 : 0) + (j === 1 || j === ny - 2 ? 1 : 0) + (k === 1 || k === nz - 2 ? 1 : 0);
            p[c] = (sum - div[c] * h2) / (count + edge);
          }
        }
      }
    }
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        let c = 1 + nx * (j + ny * k);
        for (let i = 1; i < nx - 1; i += 1, c += 1) {
          if (solid[c]) {
            u[c] = 0;
            v[c] = 0;
            w[c] = 0;
            continue;
          }
          if (fixed[c]) continue;
          const pc = p[c];
          const pe = solid[c + sx] || fixed[c + sx] ? pc : p[c + sx];
          const pw = solid[c - sx] || fixed[c - sx] ? pc : p[c - sx];
          const pn = solid[c + sy] || fixed[c + sy] ? pc : p[c + sy];
          const ps = solid[c - sy] || fixed[c - sy] ? pc : p[c - sy];
          const pt = solid[c + sz] || fixed[c + sz] ? pc : p[c + sz];
          const pb = solid[c - sz] || fixed[c - sz] ? pc : p[c - sz];
          u[c] -= (pe - pw) / (2 * h);
          v[c] -= (pn - ps) / (2 * h);
          w[c] -= (pt - pb) / (2 * h);
        }
      }
    }
  }

  // Un paso de aire de `dt` segundos.
  step(dt, nozzles, wind) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.refreshMovable();
    this.applySources(nozzles, wind);
    this.advect(dt);
    this.diffuse(0.2, 1);
    this.project(8);
    const decay = Math.pow(0.9, dt * 3); // el aire se aquieta cuando se corta la fuente
    for (let c = 0; c < this.n; c += 1) {
      if (this.fixed[c]) continue;
      this.u[c] *= decay;
      this.v[c] *= decay;
      this.w[c] *= decay;
    }
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stepCost = this.stepCost ? this.stepCost * 0.8 + (t1 - t0) * 0.2 : t1 - t0;
  }
}
