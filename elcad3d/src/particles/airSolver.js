import { sampleSdf } from './sdf.js';
import { PoissonPcg } from './pcg.js';

// Aire incompresible casi-estacionario sobre una grilla escalonada (MAC): u, v, w en las caras, presión en el centro.
// Pensado para ingeniería de primer orden (Venturi, líneas de transporte neumático), no para detalle fino:
//  · Sólidos con paredes recortadas por el SDF: cada cara guarda la fracción abierta (marching squares), no un escalón de vóxeles.
//  · Entradas por caudal (disco de caras con velocidad impuesta) o por presión de plenum (celdas con presión fija); salida a
//    atmósfera (p = 0) por las caras del dominio.
//  · Advección semi-Lagrangiana con paso grande, viscosidad turbulenta de Smagorinsky y fricción de pared (Blasius).
//  · La presión sale de la proyección: en régimen estacionario cumple Bernoulli (se valida en tests/airSolver.test.mjs).
//  · Los granos entran como porosidad (ε = 1 − α) y como arrastre bidireccional semi-implícito (ver deposit()).
// Unidades: posiciones en mm (como el resto del simulador); internamente SI para el aire: m/s, Pa, kg/m³.
// El aire se resuelve «casi-estacionario»: el tiempo de residencia del aire en la línea (ms) es mucho menor que el de los granos (s).

const MIN_WEIGHT = 0.03; // caras con menos de 3 % abiertas se cierran (mal condicionan la presión)
const list = new Float64Array(4);

const insideSegment = (l, r) => {
  if (l < 0 && r < 0) return 1;
  if (l < 0) return l / (l - r);
  if (r < 0) return r / (r - l);
  return 0;
};
const cycle = () => {
  const first = list[0];
  list[0] = list[1];
  list[1] = list[2];
  list[2] = list[3];
  list[3] = first;
};

// Fracción de un cuadrado unidad que cae dentro del sólido (phi < 0). Esquinas en orden cíclico a=(0,0) b=(1,0) c=(1,1) d=(0,1).
export function fractionInside(a, b, c, d) {
  list[0] = a;
  list[1] = b;
  list[2] = c;
  list[3] = d;
  const inside = (a < 0 ? 1 : 0) + (b < 0 ? 1 : 0) + (c < 0 ? 1 : 0) + (d < 0 ? 1 : 0);
  if (inside === 4) return 1;
  if (inside === 0) return 0;
  if (inside === 3) {
    while (list[0] < 0) cycle();
    const side0 = 1 - insideSegment(list[0], list[3]);
    const side1 = 1 - insideSegment(list[0], list[1]);
    return 1 - 0.5 * side0 * side1;
  }
  if (inside === 1) {
    while (list[0] >= 0) cycle();
    return 0.5 * insideSegment(list[0], list[3]) * insideSegment(list[0], list[1]);
  }
  while (list[0] >= 0 || !(list[1] < 0 || list[2] < 0)) cycle();
  if (list[1] < 0) return 0.5 * (insideSegment(list[0], list[3]) + insideSegment(list[1], list[2]));
  const middle = 0.25 * (list[0] + list[1] + list[2] + list[3]);
  if (middle < 0) {
    const side1 = 1 - insideSegment(list[0], list[3]);
    const side3 = 1 - insideSegment(list[2], list[3]);
    const side2 = 1 - insideSegment(list[2], list[1]);
    const side0 = 1 - insideSegment(list[0], list[1]);
    return 1 - 0.5 * side1 * side3 - 0.5 * side0 * side2;
  }
  return 0.5 * insideSegment(list[0], list[1]) * insideSegment(list[0], list[3]) + 0.5 * insideSegment(list[2], list[1]) * insideSegment(list[2], list[3]);
}

// Trilineal sobre un arreglo con dimensiones (sx, sy, sz); gx, gy, gz en índices de grilla (se acotan al interior).
function trilinear(f, sx, sy, sz, gx, gy, gz) {
  const x = gx < 0 ? 0 : gx > sx - 1.0001 ? sx - 1.0001 : gx;
  const y = gy < 0 ? 0 : gy > sy - 1.0001 ? sy - 1.0001 : gy;
  const z = gz < 0 ? 0 : gz > sz - 1.0001 ? sz - 1.0001 : gz;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const tx = x - i;
  const ty = y - j;
  const tz = z - k;
  const base = i + sx * (j + sy * k);
  const dy = sx;
  const dz = sx * sy;
  const a = f[base] + (f[base + 1] - f[base]) * tx;
  const b = f[base + dy] + (f[base + dy + 1] - f[base + dy]) * tx;
  const c = f[base + dz] + (f[base + dz + 1] - f[base + dz]) * tx;
  const d = f[base + dz + dy] + (f[base + dz + dy + 1] - f[base + dz + dy]) * tx;
  const e = a + (b - a) * ty;
  const g = c + (d - c) * ty;
  return e + (g - e) * tz;
}

// Igual que trilinear, pero ignora las caras cerradas (peso 0): junto a una pared el muestreo no se mezcla con ceros y no
// aparece una capa límite numérica; la fricción real la pone el modelo de pared.
function trilinearMasked(f, open, sx, sy, sz, gx, gy, gz) {
  const x = gx < 0 ? 0 : gx > sx - 1.0001 ? sx - 1.0001 : gx;
  const y = gy < 0 ? 0 : gy > sy - 1.0001 ? sy - 1.0001 : gy;
  const z = gz < 0 ? 0 : gz > sz - 1.0001 ? sz - 1.0001 : gz;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const tx = x - i;
  const ty = y - j;
  const tz = z - k;
  const base = i + sx * (j + sy * k);
  const dy = sx;
  const dz = sx * sy;
  let sum = 0;
  let weight = 0;
  for (let n = 0; n < 8; n += 1) {
    const at = base + (n & 1) + ((n >> 1) & 1) * dy + ((n >> 2) & 1) * dz;
    if (open[at] <= 0) continue;
    const wgt = ((n & 1) ? tx : 1 - tx) * (((n >> 1) & 1) ? ty : 1 - ty) * (((n >> 2) & 1) ? tz : 1 - tz);
    sum += f[at] * wgt;
    weight += wgt;
  }
  return weight > 1e-6 ? sum / weight : 0;
}

export class AirSolver {
  // lo, hi: caja del dominio en mm. bodies: [{ sdf, movable, … }] o [{ distance(x,y,z) }] (distancia con signo en mm, > 0 en el aire).
  constructor({ lo, hi, bodies = [], cells = 40000, rho = 1.2, mu = 1.81e-5, wallFriction = 0.004, smagorinsky = 0.12, cfl = 1.5, minWeight = MIN_WEIGHT, minCell = 0.3, wallShift = 0.05 }) {
    const size = [0, 1, 2].map((k) => Math.max(1, hi[k] - lo[k]));
    this.hmm = Math.cbrt((size[0] * size[1] * size[2]) / cells);
    this.h = this.hmm / 1000; // m
    this.dims = size.map((value) => Math.max(4, Math.ceil(value / this.hmm)));
    this.origin = lo.slice();
    const [nx, ny, nz] = this.dims;
    this.n = nx * ny * nz;
    this.rho = rho;
    this.nu = mu / rho;
    this.wallFriction = wallFriction;
    this.smagorinsky = smagorinsky;
    this.cfl = cfl;
    this.minWeight = minWeight;
    this.minCell = minCell;
    this.wallShift = wallShift; // las celdas descartadas dejan la sección ~2 % chica: la pared se corre 5 % de celda hacia el sólido
    this.bodies = bodies;
    this.poseKey = '';
    this.warnings = [];
    const f32 = (count) => new Float32Array(count);
    this.nU = (nx + 1) * ny * nz;
    this.nV = nx * (ny + 1) * nz;
    this.nW = nx * ny * (nz + 1);
    this.u = f32(this.nU);
    this.v = f32(this.nV);
    this.w = f32(this.nW);
    this.u0 = f32(this.nU);
    this.uh = f32(this.nU); // paso intermedio de MacCormack
    this.vh = f32(this.nV);
    this.wh = f32(this.nW);
    this.faceVel = new Float64Array(3);
    this.maccormack = true;
    this.v0 = f32(this.nV);
    this.w0 = f32(this.nW);
    this.au = f32(this.nU);
    this.av = f32(this.nV);
    this.aw = f32(this.nW);
    this.bu = new Uint8Array(this.nU); // 0 interior · 1 velocidad impuesta (entrada) · 2 borde abierto del dominio (p = 0)
    this.bv = new Uint8Array(this.nV);
    this.bw = new Uint8Array(this.nW);
    this.qu = f32(this.nU); // velocidad impuesta (m/s)
    this.qv = f32(this.nV);
    this.qw = f32(this.nW);
    this.p = f32(this.n); // presión manométrica (Pa)
    this.uc = f32(this.n); // velocidad al centro de la celda (m/s)
    this.vc = f32(this.n);
    this.wc = f32(this.n);
    this.eps = new Float32Array(this.n).fill(1); // porosidad (1 − fracción de sólidos de los granos)
    this.nut = f32(this.n);
    this.wallArea = f32(this.n); // área de pared por volumen de la celda (1/m)
    this.active = new Uint8Array(this.n);
    this.pfix = new Uint8Array(this.n); // celdas con presión fija (plenum de un soplador por presión)
    this.pval = f32(this.n);
    this.dragB = f32(this.n); // acople con los granos: rapidez de arrastre (1/s) y fuente de cantidad de movimiento (m/s²)
    this.dragX = f32(this.n);
    this.dragY = f32(this.n);
    this.dragZ = f32(this.n);
    this.hasDrag = false;
    this.phi = new Float64Array(this.n);
    this.rhs = new Float64Array(this.n);
    this.pcg = new PoissonPcg(nx, ny, nz);
    this.inlets = [];
    this.uRef = 1;
    this.lastDt = 1e-3;
    this.steps = 0;
    this.delta = 1;
    this.settled = 0;
    this.stepCost = 0;
    this.pcgIterations = 0;
    this.grad = [0, 0, 0];
    this.nodePhi = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
    this.rebuildGeometry();
  }

  cellIndex(i, j, k) {
    return i + this.dims[0] * (j + this.dims[1] * k);
  }

  // Recorrido de celdas (DDA): los marcadores no pueden saltar membranas entre cuadros.
  // Usa exactamente las caras MAC cerradas por el solver; no cambia presión ni caudal.
  blockedLine(ax, ay, az, bx, by, bz) {
    const start = [ax, ay, az], end = [bx, by, bz];
    if (![...start, ...end].every(Number.isFinite)) return true;
    const cell = start.map((value, axis) => Math.floor((value - this.origin[axis]) / this.hmm));
    if (cell.some((value, axis) => value < 0 || value >= this.dims[axis])) return true;
    const delta = end.map((value, axis) => value - start[axis]);
    const step = delta.map(value => Math.sign(value));
    const stride = delta.map(value => value ? this.hmm / Math.abs(value) : Infinity);
    const crossing = cell.map((value, axis) => delta[axis] ? (this.origin[axis] + (value + (step[axis] > 0 ? 1 : 0)) * this.hmm - start[axis]) / delta[axis] : Infinity);
    const [nx, ny] = this.dims;
    const maxSteps = this.dims[0] + this.dims[1] + this.dims[2] + 3;
    for (let n = 0; n < maxSteps; n++) {
      const t = Math.min(...crossing);
      if (t > 1) return false;
      for (let axis = 0; axis < 3; axis++) {
        if (crossing[axis] > t + 1e-12) continue;
        const [i, j, k] = cell;
        const face = cell[axis] + (step[axis] > 0 ? 1 : 0);
        const weight = axis === 0 ? this.au[face + (nx + 1) * (j + ny * k)]
          : axis === 1 ? this.av[i + nx * (face + (ny + 1) * k)]
          : this.aw[i + nx * (j + ny * face)];
        if (!(weight > 0)) return true;
        cell[axis] += step[axis];
        if (cell[axis] < 0 || cell[axis] >= this.dims[axis]) return true;
        crossing[axis] += stride[axis];
      }
    }
    return true;
  }

  // Distancia con signo (mm) del cuerpo a un punto del mundo, con la pose actual.
  bodyDistance(body, x, y, z) {
    if (body.distance) return body.distance(x, y, z);
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

  // SDF de los sólidos en los nodos de la grilla → fracciones abiertas de cada cara → bordes → celdas activas.
  rebuildGeometry() {
    this.sampleNodes();
    this.rebuildWeights();
  }

  // Lo caro (muestrear el SDF de cada cuerpo en cada nodo): solo cuando cambia la pose de un cuerpo móvil.
  sampleNodes() {
    const [nx, ny, nz] = this.dims;
    const { nodePhi, hmm, origin } = this;
    const mx = nx + 1;
    const my = ny + 1;
    for (let k = 0; k <= nz; k += 1) {
      for (let j = 0; j <= ny; j += 1) {
        for (let i = 0; i <= nx; i += 1) {
          const x = origin[0] + i * hmm;
          const y = origin[1] + j * hmm;
          const z = origin[2] + k * hmm;
          let d = 1e9;
          for (let b = 0; b < this.bodies.length; b += 1) {
            if (this.bodies[b].mesh) continue; // las mallas son membranas: markMembranes()
            d = Math.min(d, this.bodyDistance(this.bodies[b], x, y, z));
          }
          d += this.wallShift * hmm;
          nodePhi[i + mx * (j + my * k)] = d === 0 ? 1e-9 : d;
        }
      }
    }
  }

  // Fracciones abiertas de las caras, bordes, entradas y celdas activas a partir de los nodos ya muestreados.
  rebuildWeights() {
    const [nx, ny, nz] = this.dims;
    const { nodePhi } = this;
    const mx = nx + 1;
    const my = ny + 1;
    const open = (a, b, c, d) => {
      const weight = 1 - fractionInside(a, b, c, d);
      return weight < this.minWeight ? 0 : weight > 1 - this.minWeight ? 1 : weight;
    };
    const node = (i, j, k) => nodePhi[i + mx * (j + my * k)];
    const { au, av, aw, bu, bv, bw } = this;
    for (let k = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i <= nx; i += 1) {
      const f = i + mx * (j + ny * k);
      au[f] = open(node(i, j, k), node(i, j + 1, k), node(i, j + 1, k + 1), node(i, j, k + 1));
      bu[f] = i === 0 || i === nx ? 2 : 0;
    }
    for (let k = 0; k < nz; k += 1) for (let j = 0; j <= ny; j += 1) for (let i = 0; i < nx; i += 1) {
      const f = i + nx * (j + (ny + 1) * k);
      av[f] = open(node(i, j, k), node(i + 1, j, k), node(i + 1, j, k + 1), node(i, j, k + 1));
      bv[f] = j === 0 || j === ny ? 2 : 0;
    }
    for (let k = 0; k <= nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      const f = i + nx * (j + ny * k);
      aw[f] = open(node(i, j, k), node(i + 1, j, k), node(i + 1, j + 1, k), node(i, j + 1, k));
      bw[f] = k === 0 || k === nz ? 2 : 0;
    }
    this.markMembranes();
    this.cullSlivers();
    this.qu.fill(0);
    this.qv.fill(0);
    this.qw.fill(0);
    this.pfix.fill(0);
    this.applyInlets();
    this.classifyCells();
  }

  // Paredes como membrana: una cara queda cerrada si algún triángulo cruza el segmento que une los centros de las dos celdas
  // que separa. No depende del espesor (una chapa de 1,5 mm cierra igual que una pared gruesa) y no deja fugas; la posición
  // de la pared tiene un error de ±½ celda sin sesgo. `body.mesh = { vertices, triangles }` en coordenadas del mundo.
  markMembranes() {
    const meshes = this.bodies.filter((body) => body.mesh);
    if (!meshes.length) return;
    const [nx, ny, nz] = this.dims;
    const { origin, hmm, au, av, aw } = this;
    const mx = nx + 1;
    const my = ny + 1;
    const eps = 1e-6;
    const faces = [{ weights: au, size: [nx + 1, ny, nz] }, { weights: av, size: [nx, ny + 1, nz] }, { weights: aw, size: [nx, ny, nz + 1] }];
    const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    meshes.forEach(({ mesh }) => {
      const { vertices, triangles } = mesh;
      for (let t = 0; t < triangles.length; t += 3) {
        for (let n = 0; n < 3; n += 1) {
          const v = triangles[t + n] * 3;
          p[n][0] = vertices[v];
          p[n][1] = vertices[v + 1];
          p[n][2] = vertices[v + 2];
        }
        for (let axis = 0; axis < 3; axis += 1) {
          const a = (axis + 1) % 3;
          const b = (axis + 2) % 3;
          // proyección del triángulo en el plano (a, b); las rectas de enlace son paralelas al eje `axis`
          const a0 = p[0][a];
          const b0 = p[0][b];
          const da1 = p[1][a] - a0;
          const db1 = p[1][b] - b0;
          const da2 = p[2][a] - a0;
          const db2 = p[2][b] - b0;
          const det = da1 * db2 - da2 * db1;
          if (Math.abs(det) < 1e-12) continue;
          const minA = Math.min(p[0][a], p[1][a], p[2][a]);
          const maxA = Math.max(p[0][a], p[1][a], p[2][a]);
          const minB = Math.min(p[0][b], p[1][b], p[2][b]);
          const maxB = Math.max(p[0][b], p[1][b], p[2][b]);
          const iA0 = Math.max(0, Math.ceil((minA - origin[a]) / hmm - 0.5 - eps));
          const iA1 = Math.min(this.dims[a] - 1, Math.floor((maxA - origin[a]) / hmm - 0.5 + eps));
          const iB0 = Math.max(0, Math.ceil((minB - origin[b]) / hmm - 0.5 - eps));
          const iB1 = Math.min(this.dims[b] - 1, Math.floor((maxB - origin[b]) / hmm - 0.5 + eps));
          for (let ib = iB0; ib <= iB1; ib += 1) {
            const lb = origin[b] + (ib + 0.5) * hmm - b0;
            for (let ia = iA0; ia <= iA1; ia += 1) {
              const la = origin[a] + (ia + 0.5) * hmm - a0;
              const u = (la * db2 - da2 * lb) / det;
              const v = (da1 * lb - la * db1) / det;
              if (u < -eps || v < -eps || u + v > 1 + eps) continue;
              const x = p[0][axis] + u * (p[1][axis] - p[0][axis]) + v * (p[2][axis] - p[0][axis]);
              const link = Math.floor((x - origin[axis]) / hmm - 0.5); // el enlace entre las celdas `link` y `link + 1`
              const face = link + 1;
              if (face < 0 || face > this.dims[axis]) continue;
              const ijk = [0, 0, 0];
              ijk[axis] = face;
              ijk[a] = ia;
              ijk[b] = ib;
              const [sx, sy] = faces[axis].size;
              faces[axis].weights[ijk[0] + sx * (ijk[1] + sy * ijk[2])] = 0;
            }
          }
        }
      }
    });
    void mx;
    void my;
  }

  // Celdas con una lámina de fluido muy fina (menos de `minCell` de su espesor en la dirección más delgada) pasan a sólido:
  // son las que vuelven inestable la advección junto a una pared recortada. Se cierran todas sus caras.
  cullSlivers() {
    const [nx, ny, nz] = this.dims;
    const { au, av, aw, bu, bv, bw } = this;
    if (!(this.minCell > 0)) return;
    const mx = nx + 1;
    const my = ny + 1;
    const dead = new Uint8Array(this.n);
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const fu = i + mx * (j + ny * k);
          const fv = i + nx * (j + my * k);
          const fw = i + nx * (j + ny * k);
          const mxAxis = 0.5 * (au[fu] + au[fu + 1]);
          const myAxis = 0.5 * (av[fv] + av[fv + nx]);
          const mzAxis = 0.5 * (aw[fw] + aw[fw + nx * ny]);
          const thin = Math.min(mxAxis, myAxis, mzAxis);
          const open = Math.max(mxAxis, myAxis, mzAxis);
          if (open > 0 && thin < this.minCell) dead[i + nx * (j + ny * k)] = 1;
        }
      }
    }
    const isDead = (c) => c >= 0 && dead[c] === 1;
    for (let k = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i <= nx; i += 1) {
      if (isDead(i > 0 ? i - 1 + nx * (j + ny * k) : -1) || isDead(i < nx ? i + nx * (j + ny * k) : -1)) au[i + mx * (j + ny * k)] = 0;
    }
    for (let k = 0; k < nz; k += 1) for (let j = 0; j <= ny; j += 1) for (let i = 0; i < nx; i += 1) {
      if (isDead(j > 0 ? i + nx * (j - 1 + ny * k) : -1) || isDead(j < ny ? i + nx * (j + ny * k) : -1)) av[i + nx * (j + my * k)] = 0;
    }
    for (let k = 0; k <= nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      if (isDead(k > 0 ? i + nx * (j + ny * (k - 1)) : -1) || isDead(k < nz ? i + nx * (j + ny * k) : -1)) aw[i + nx * (j + ny * k)] = 0;
    }
    void bu; void bv; void bw;
  }

  // Los cuerpos móviles (tornillo) solo recalculan la geometría cuando cambió su pose.
  refreshMovable() {
    const movers = this.bodies.filter((body) => body.movable && !body.mesh); // las mallas se toman en su pose inicial
    if (!movers.length) return false;
    const key = movers.map((body) => `${body.angle.toFixed(2)},${body.offset.map((v) => v.toFixed(1))}`).join('|');
    if (key === this.poseKey) return false;
    this.poseKey = key;
    this.rebuildGeometry();
    return true;
  }

  // Entradas: { pos (mm), dir, radius (mm), speed (m/s) | flow (m³/s) | pressure (Pa) }. Caudal → disco de caras con velocidad
  // impuesta; presión → plenum: celdas del disco con presión fija (las caras del disco se cierran).
  setInlets(inlets) {
    this.inlets = inlets;
    this.rebuildWeights();
    this.settled = 0;
  }

  applyInlets() {
    const [nx, ny, nz] = this.dims;
    const { hmm, origin } = this;
    this.warnings = [];
    this.uRef = 1;
    this.inletFaces = [];
    this.inletGroups = [];
    this.inlets.forEach((inlet, index) => {
      const axis = [0, 1, 2].reduce((best, a) => (Math.abs(inlet.dir[a]) > Math.abs(inlet.dir[best]) ? a : best), 0);
      const sign = inlet.dir[axis] >= 0 ? 1 : -1;
      const others = [0, 1, 2].filter((a) => a !== axis);
      const plane = Math.round((inlet.pos[axis] - origin[axis]) / hmm);
      const faceMax = this.dims[axis] - 1;
      const planeIndex = Math.min(faceMax, Math.max(1, plane));
      const arrays = [[this.au, this.bu, this.qu, nx + 1, ny, nz], [this.av, this.bv, this.qv, nx, ny + 1, nz], [this.aw, this.bw, this.qw, nx, ny, nz + 1]][axis];
      const [weights, types, values, sx, sy] = arrays;
      const faces = [];
      let area = 0;
      const lim = [this.dims[others[0]], this.dims[others[1]]];
      for (let b = 0; b < lim[1]; b += 1) {
        for (let a = 0; a < lim[0]; a += 1) {
          const ca = origin[others[0]] + (a + 0.5) * hmm - inlet.pos[others[0]];
          const cb = origin[others[1]] + (b + 0.5) * hmm - inlet.pos[others[1]];
          const reach = inlet.radius + hmm; // una celda de margen: si no, las caras parciales de la pared dejan un anillo por donde el aire recircula
          if (ca * ca + cb * cb > reach * reach) continue;
          const ijk = [0, 0, 0];
          ijk[axis] = planeIndex;
          ijk[others[0]] = a;
          ijk[others[1]] = b;
          const face = ijk[0] + sx * (ijk[1] + sy * ijk[2]);
          if (weights[face] <= 0) continue;
          faces.push({ face, ijk });
          area += weights[face] * this.h * this.h;
        }
      }
      if (!faces.length) {
        this.warnings.push(`Entrada ${index + 1}: la boca no toca aire (revisá posición y radio)`);
        return;
      }
      if (inlet.pressure !== undefined && inlet.pressure !== null) {
        const dn = [0, 0, 0];
        dn[axis] = sign > 0 ? 0 : -1;
        faces.forEach(({ face, ijk }) => {
          weights[face] = 0;
          const cell = [ijk[0] + dn[0], ijk[1] + dn[1], ijk[2] + dn[2]];
          const c = this.cellIndex(cell[0], cell[1], cell[2]);
          this.pfix[c] = 1;
          this.pval[c] = inlet.pressure;
        });
        this.uRef = Math.max(this.uRef, Math.sqrt((2 * Math.abs(inlet.pressure)) / this.rho));
        this.inletFaces.push({ pressure: true, faces: faces.length });
      } else {
        const flow = inlet.flow ?? ((inlet.speed ?? 0) * Math.PI * (inlet.radius / 1000) ** 2);
        const speed = (flow / area) * sign;
        faces.forEach(({ face }) => {
          types[face] = 1;
          values[face] = speed;
        });
        this.uRef = Math.max(this.uRef, Math.abs(speed));
        const entry = { pressure: false, faces: faces.length, area, flow };
        this.inletFaces.push(entry);
        this.inletGroups.push({ axis, sign, flow, faces, weights, types, values, entry, dims: [nx, ny, nz] });
      }
    });
  }

  // Celdas activas = alcanzables desde un borde con presión (la atmósfera o un plenum): las demás (bolsillos cerrados, aguas
  // arriba de una entrada) no pueden evacuar caudal y se tratan como sólido.
  classifyCells() {
    const [nx, ny, nz] = this.dims;
    const { au, av, aw, bu, bv, bw, active, pfix } = this;
    const nxy = nx * ny;
    const mx = nx + 1;
    const queue = new Int32Array(this.n);
    let head = 0;
    let tail = 0;
    const seen = new Uint8Array(this.n);
    const push = (c) => {
      if (seen[c]) return;
      seen[c] = 1;
      queue[tail] = c;
      tail += 1;
    };
    const my = ny + 1;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const c = i + nx * (j + ny * k);
          if (pfix[c]) push(c);
          // cara abierta del dominio (atmósfera) pegada a la celda
          if (i === 0 && au[mx * (j + ny * k)] > 0) push(c);
          if (i === nx - 1 && au[nx + mx * (j + ny * k)] > 0) push(c);
          if (j === 0 && av[i + nx * my * k] > 0) push(c);
          if (j === ny - 1 && av[i + nx * (ny + my * k)] > 0) push(c);
          if (k === 0 && aw[i + nx * j] > 0) push(c);
          if (k === nz - 1 && aw[i + nx * (j + ny * nz)] > 0) push(c);
        }
      }
    }
    while (head < tail) {
      const c = queue[head];
      head += 1;
      const i = c % nx;
      const j = Math.floor(c / nx) % ny;
      const k = Math.floor(c / nxy);
      if (i > 0 && bu[i + mx * (j + ny * k)] === 0 && au[i + mx * (j + ny * k)] > 0) push(c - 1);
      if (i < nx - 1 && bu[i + 1 + mx * (j + ny * k)] === 0 && au[i + 1 + mx * (j + ny * k)] > 0) push(c + 1);
      if (j > 0 && bv[i + nx * (j + my * k)] === 0 && av[i + nx * (j + my * k)] > 0) push(c - nx);
      if (j < ny - 1 && bv[i + nx * (j + 1 + my * k)] === 0 && av[i + nx * (j + 1 + my * k)] > 0) push(c + nx);
      if (k > 0 && bw[i + nx * (j + ny * k)] === 0 && aw[i + nx * (j + ny * k)] > 0) push(c - nxy);
      if (k < nz - 1 && bw[i + nx * (j + ny * (k + 1))] === 0 && aw[i + nx * (j + ny * (k + 1))] > 0) push(c + nxy);
    }
    let reached = 0;
    for (let c = 0; c < this.n; c += 1) {
      active[c] = seen[c] && !pfix[c] ? 1 : 0;
      if (seen[c]) reached += 1;
    }
    this.reached = reached;
    // los caudales impuestos que no desembocan en un borde abierto son un error de armado
    if (this.inletFaces?.some((entry) => !entry.pressure) && reached === 0) this.warnings.push('El aire no tiene salida: ninguna celda llega a un borde abierto');
    this.pruneInlets();
    this.computeWallArea();
    this.zeroDeadFaces();
    this.pcgReady = false;
  }

  // Caras de entrada que no tocan ninguna celda de aire (caen sobre la pared o fuera del conducto) se descartan y el caudal pedido
  // se reparte solo sobre las que sí dan al aire: así el caudal que entra es exactamente el pedido.
  pruneInlets() {
    const [nx, ny, nz] = this.dims;
    const { active, h } = this;
    const cellAt = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : i + nx * (j + ny * k));
    this.uRef = Math.max(1, ...this.inletFaces.filter((entry) => entry.pressure).map(() => 0));
    this.inletGroups.forEach((group) => {
      const { axis, sign, weights, types, values, entry } = group;
      const kept = [];
      let area = 0;
      group.faces.forEach((item) => {
        const { face, ijk } = item;
        const before = [ijk[0], ijk[1], ijk[2]];
        const after = [ijk[0], ijk[1], ijk[2]];
        before[axis] -= 1;
        const left = cellAt(before[0], before[1], before[2]);
        const right = cellAt(after[0], after[1], after[2]);
        if ((left >= 0 && active[left]) || (right >= 0 && active[right])) {
          kept.push(item);
          area += weights[face] * h * h;
        } else {
          types[face] = 0;
          weights[face] = 0;
          values[face] = 0;
        }
      });
      group.faces = kept;
      entry.faces = kept.length;
      entry.area = area;
      if (!kept.length) {
        this.warnings.push('Una entrada de aire no toca el conducto (revisá su posición y radio)');
        return;
      }
      const speed = (group.flow / area) * sign;
      kept.forEach(({ face }) => { values[face] = speed; });
      this.uRef = Math.max(this.uRef, Math.abs(speed));
    });
    this.inlets.forEach((inlet) => {
      if (inlet.pressure !== undefined && inlet.pressure !== null) this.uRef = Math.max(this.uRef, Math.sqrt((2 * Math.abs(inlet.pressure)) / this.rho));
    });
  }

  // Área de pared por volumen en cada celda activa (para la fricción) y limpieza de caras entre celdas muertas.
  computeWallArea() {
    const [nx, ny, nz] = this.dims;
    const { au, av, aw, bu, bv, bw, wallArea, active, h } = this;
    const mx = nx + 1;
    wallArea.fill(0);
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const c = i + nx * (j + ny * k);
          if (!active[c]) continue;
          const fw = i + mx * (j + ny * k);
          const fs = i + nx * (j + (ny + 1) * k);
          const fb = i + nx * (j + ny * k);
          const closed = (bu[fw] === 0 ? 1 - au[fw] : 0) + (bu[fw + 1] === 0 ? 1 - au[fw + 1] : 0)
            + (bv[fs] === 0 ? 1 - av[fs] : 0) + (bv[fs + nx] === 0 ? 1 - av[fs + nx] : 0)
            + (bw[fb] === 0 ? 1 - aw[fb] : 0) + (bw[fb + nx * ny] === 0 ? 1 - aw[fb + nx * ny] : 0);
          wallArea[c] = closed / h;
        }
      }
    }
  }

  // Caras que no tienen ninguna celda viva a los lados quedan en 0 (así no arrastran velocidades viejas).
  zeroDeadFaces() {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, bu, bv, bw, active, pfix, qu, qv, qw } = this;
    const mx = nx + 1;
    const my = ny + 1;
    const alive = (c) => c >= 0 && (active[c] === 1 || pfix[c] === 1);
    for (let k = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i <= nx; i += 1) {
      const f = i + mx * (j + ny * k);
      if (bu[f] === 1) u[f] = qu[f];
      else if (!(alive(i > 0 ? i - 1 + nx * (j + ny * k) : -1) || alive(i < nx ? i + nx * (j + ny * k) : -1))) u[f] = 0;
    }
    for (let k = 0; k < nz; k += 1) for (let j = 0; j <= ny; j += 1) for (let i = 0; i < nx; i += 1) {
      const f = i + nx * (j + my * k);
      if (bv[f] === 1) v[f] = qv[f];
      else if (!(alive(j > 0 ? i + nx * (j - 1 + ny * k) : -1) || alive(j < ny ? i + nx * (j + ny * k) : -1))) v[f] = 0;
    }
    for (let k = 0; k <= nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      const f = i + nx * (j + ny * k);
      if (bw[f] === 1) w[f] = qw[f];
      else if (!(alive(k > 0 ? i + nx * (j + ny * (k - 1)) : -1) || alive(k < nz ? i + nx * (j + ny * k) : -1))) w[f] = 0;
    }
  }

  // ---------- paso de tiempo ----------

  // Velocidad máxima de las caras (m/s).
  maxSpeed() {
    let m = 0;
    for (let c = 0; c < this.nU; c += 1) m = Math.max(m, Math.abs(this.u[c]));
    for (let c = 0; c < this.nV; c += 1) m = Math.max(m, Math.abs(this.v[c]));
    for (let c = 0; c < this.nW; c += 1) m = Math.max(m, Math.abs(this.w[c]));
    return m;
  }

  // Velocidad completa (vx, vy, vz en m/s) en el centro de una cara del eje `axis`, a partir de los campos viejos u0, v0, w0.
  // En los bordes del dominio los vecinos que no existen se reemplazan por el más cercano (salida convectiva).
  faceVelocity(axis, i, j, k, out) {
    const [nx, ny, nz] = this.dims;
    const { u0, v0, w0 } = this;
    const mx = nx + 1;
    const my = ny + 1;
    const lo = (n) => (n < 0 ? 0 : n);
    if (axis === 0) {
      const iw = lo(i - 1);
      const ie = i < nx ? i : nx - 1;
      out[0] = u0[i + mx * (j + ny * k)];
      out[1] = 0.25 * (v0[iw + nx * (j + my * k)] + v0[ie + nx * (j + my * k)] + v0[iw + nx * (j + 1 + my * k)] + v0[ie + nx * (j + 1 + my * k)]);
      out[2] = 0.25 * (w0[iw + nx * (j + ny * k)] + w0[ie + nx * (j + ny * k)] + w0[iw + nx * (j + ny * (k + 1))] + w0[ie + nx * (j + ny * (k + 1))]);
    } else if (axis === 1) {
      const js = lo(j - 1);
      const jn = j < ny ? j : ny - 1;
      out[0] = 0.25 * (u0[i + mx * (js + ny * k)] + u0[i + 1 + mx * (js + ny * k)] + u0[i + mx * (jn + ny * k)] + u0[i + 1 + mx * (jn + ny * k)]);
      out[1] = v0[i + nx * (j + my * k)];
      out[2] = 0.25 * (w0[i + nx * (js + ny * k)] + w0[i + nx * (jn + ny * k)] + w0[i + nx * (js + ny * (k + 1))] + w0[i + nx * (jn + ny * (k + 1))]);
    } else {
      const kb = lo(k - 1);
      const kt = k < nz ? k : nz - 1;
      out[0] = 0.25 * (u0[i + mx * (j + ny * kb)] + u0[i + 1 + mx * (j + ny * kb)] + u0[i + mx * (j + ny * kt)] + u0[i + 1 + mx * (j + ny * kt)]);
      out[1] = 0.25 * (v0[i + nx * (j + my * kb)] + v0[i + nx * (j + 1 + my * kb)] + v0[i + nx * (j + my * kt)] + v0[i + nx * (j + 1 + my * kt)]);
      out[2] = w0[i + nx * (j + ny * k)];
    }
  }

  // Advección de un componente (eje 0, 1, 2). Semi-Lagrangiana; con `maccormack` se compensa el error con un paso inverso
  // (el resultado se acota entre el mínimo y el máximo de las celdas de origen para que no oscile).
  advectAxis(axis, dt) {
    const [nx, ny, nz] = this.dims;
    const sizes = [[nx + 1, ny, nz], [nx, ny + 1, nz], [nx, ny, nz + 1]][axis];
    const [sx, sy, sz] = sizes;
    const field = [this.u0, this.v0, this.w0][axis];
    const result = [this.u, this.v, this.w][axis];
    const hat = [this.uh, this.vh, this.wh][axis];
    const weights = [this.au, this.av, this.aw][axis];
    const types = [this.bu, this.bv, this.bw][axis];
    const scale = dt / this.h;
    const vel = this.faceVel;
    const faceCount = sx * sy * sz;
    hat.set(field);
    for (let k = 0; k < sz; k += 1) {
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          const f = i + sx * (j + sy * k);
          if (weights[f] <= 0 || types[f] === 1) continue;
          this.faceVelocity(axis, i, j, k, vel);
          hat[f] = trilinearMasked(field, weights, sx, sy, sz, i - vel[0] * scale, j - vel[1] * scale, k - vel[2] * scale);
        }
      }
    }
    if (!this.maccormack) {
      result.set(hat);
      return faceCount;
    }
    for (let k = 0; k < sz; k += 1) {
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          const f = i + sx * (j + sy * k);
          if (weights[f] <= 0 || types[f] === 1) {
            result[f] = field[f];
            continue;
          }
          this.faceVelocity(axis, i, j, k, vel);
          const bx = i - vel[0] * scale;
          const by = j - vel[1] * scale;
          const bz = k - vel[2] * scale;
          const back = trilinear(hat, sx, sy, sz, i + vel[0] * scale, j + vel[1] * scale, k + vel[2] * scale);
          // cota: mínimo y máximo de las ocho caras que rodean el punto de origen; si alguna es pared o está recortada,
          // se queda con la semi-Lagrangiana pura (la corrección de MacCormack se vuelve inestable junto a paredes recortadas)
          const cx = Math.min(sx - 2, Math.max(0, Math.floor(bx)));
          const cy = Math.min(sy - 2, Math.max(0, Math.floor(by)));
          const cz = Math.min(sz - 2, Math.max(0, Math.floor(bz)));
          const base = cx + sx * (cy + sy * cz);
          let mn = Infinity;
          let mxv = -Infinity;
          let clean = true;
          for (let n = 0; n < 8; n += 1) {
            const g8 = base + (n & 1) + ((n >> 1) & 1) * sx + ((n >> 2) & 1) * sx * sy;
            const g = field[g8];
            if (g < mn) mn = g;
            if (g > mxv) mxv = g;
            if (weights[g8] < 0.999 || types[g8] !== 0) clean = false;
          }
          if (clean && weights[f] >= 0.999) {
            const value = hat[f] + 0.5 * (field[f] - back);
            result[f] = value < mn ? mn : value > mxv ? mxv : value;
          } else result[f] = hat[f];
        }
      }
    }
    return faceCount;
  }

  advect(dt) {
    this.u0.set(this.u);
    this.v0.set(this.v);
    this.w0.set(this.w);
    this.advectAxis(0, dt);
    this.advectAxis(1, dt);
    this.advectAxis(2, dt);
  }

  // Velocidades al centro de las celdas (para la viscosidad turbulenta, los sensores y el muestreo de granos).
  centerVelocities() {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, uc, vc, wc, active, pfix } = this;
    const mx = nx + 1;
    const my = ny + 1;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const c = i + nx * (j + ny * k);
          if (!active[c] && !pfix[c]) {
            uc[c] = 0;
            vc[c] = 0;
            wc[c] = 0;
            continue;
          }
          uc[c] = 0.5 * (u[i + mx * (j + ny * k)] + u[i + 1 + mx * (j + ny * k)]);
          vc[c] = 0.5 * (v[i + nx * (j + my * k)] + v[i + nx * (j + 1 + my * k)]);
          wc[c] = 0.5 * (w[c] + w[c + nx * ny]);
        }
      }
    }
  }

  // Viscosidad turbulenta de Smagorinsky por celda: ν_t = (Cs·h)² |S|.
  updateTurbulence() {
    const [nx, ny, nz] = this.dims;
    const { uc, vc, wc, nut, active, h } = this;
    const cs2 = (this.smagorinsky * h) ** 2;
    const nxy = nx * ny;
    nut.fill(0);
    if (!(this.smagorinsky > 0)) return;
    const inv = 1 / (2 * h);
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        for (let i = 1; i < nx - 1; i += 1) {
          const c = i + nx * (j + ny * k);
          if (!active[c]) continue;
          const dudx = (uc[c + 1] - uc[c - 1]) * inv;
          const dudy = (uc[c + nx] - uc[c - nx]) * inv;
          const dudz = (uc[c + nxy] - uc[c - nxy]) * inv;
          const dvdx = (vc[c + 1] - vc[c - 1]) * inv;
          const dvdy = (vc[c + nx] - vc[c - nx]) * inv;
          const dvdz = (vc[c + nxy] - vc[c - nxy]) * inv;
          const dwdx = (wc[c + 1] - wc[c - 1]) * inv;
          const dwdy = (wc[c + nx] - wc[c - nx]) * inv;
          const dwdz = (wc[c + nxy] - wc[c - nxy]) * inv;
          const sxy = 0.5 * (dudy + dvdx);
          const sxz = 0.5 * (dudz + dwdx);
          const syz = 0.5 * (dvdz + dwdy);
          const s2 = 2 * (dudx * dudx + dvdy * dvdy + dwdz * dwdz + 2 * (sxy * sxy + sxz * sxz + syz * syz));
          nut[c] = cs2 * Math.sqrt(s2);
        }
      }
    }
  }

  // Viscosidad (molecular + turbulenta), fricción de pared y arrastre de los granos sobre las velocidades de las caras.
  applySources(dt) {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, uc, vc, wc, nut, wallArea, au, av, aw, bu, bv, bw, active, pfix, h } = this;
    const mx = nx + 1;
    const my = ny + 1;
    const nxy = nx * ny;
    const limit = (0.12 * h * h) / dt; // la difusión explícita debe cumplir ν·dt/h² ≤ 1/8
    const nuMol = this.nu;
    const cf = this.wallFriction;
    const speedAt = (c) => Math.sqrt(uc[c] * uc[c] + vc[c] * vc[c] + wc[c] * wc[c]);
    const live = (c) => active[c] || pfix[c];
    const drag = this.hasDrag;
    const { dragB, dragX, dragY, dragZ } = this;
    // difusión: se calcula sobre una copia para no mezclar pasos dentro del mismo barrido
    const u0 = this.u0;
    const v0 = this.v0;
    const w0 = this.w0;
    u0.set(u);
    v0.set(v);
    w0.set(w);
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 1; i < nx; i += 1) {
          const f = i + mx * (j + ny * k);
          if (au[f] <= 0 || bu[f] !== 0) continue;
          const cL = i - 1 + nx * (j + ny * k);
          const cR = cL + 1;
          if (!live(cL) || !live(cR)) {
            u[f] = 0;
            continue;
          }
          const nuf = Math.min(limit, nuMol + 0.5 * (nut[cL] + nut[cR]));
          const centre = u0[f];
          const west = bu[f - 1] === 0 && au[f - 1] > 0 ? u0[f - 1] : centre;
          const east = i + 1 < nx && bu[f + 1] === 0 && au[f + 1] > 0 ? u0[f + 1] : centre;
          const south = j > 0 && au[f - mx] > 0 ? u0[f - mx] : centre;
          const north = j + 1 < ny && au[f + mx] > 0 ? u0[f + mx] : centre;
          const down = k > 0 && au[f - mx * ny] > 0 ? u0[f - mx * ny] : centre;
          const up = k + 1 < nz && au[f + mx * ny] > 0 ? u0[f + mx * ny] : centre;
          let value = centre + (dt * nuf / (h * h)) * (west + east + south + north + down + up - 6 * centre);
          const wallK = 0.5 * cf * 0.5 * (wallArea[cL] * speedAt(cL) + wallArea[cR] * speedAt(cR));
          let rate = wallK;
          if (drag) {
            const b = 0.5 * (dragB[cL] + dragB[cR]);
            value += dt * 0.5 * (dragX[cL] + dragX[cR]);
            rate += b;
          }
          u[f] = value / (1 + dt * rate);
        }
      }
    }
    for (let k = 0; k < nz; k += 1) {
      for (let j = 1; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + my * k);
          if (av[f] <= 0 || bv[f] !== 0) continue;
          const cL = i + nx * (j - 1 + ny * k);
          const cR = cL + nx;
          if (!live(cL) || !live(cR)) {
            v[f] = 0;
            continue;
          }
          const nuf = Math.min(limit, nuMol + 0.5 * (nut[cL] + nut[cR]));
          const centre = v0[f];
          const west = i > 0 && av[f - 1] > 0 ? v0[f - 1] : centre;
          const east = i + 1 < nx && av[f + 1] > 0 ? v0[f + 1] : centre;
          const south = bv[f - nx] === 0 && av[f - nx] > 0 ? v0[f - nx] : centre;
          const north = j + 1 < ny && bv[f + nx] === 0 && av[f + nx] > 0 ? v0[f + nx] : centre;
          const down = k > 0 && av[f - nx * my] > 0 ? v0[f - nx * my] : centre;
          const up = k + 1 < nz && av[f + nx * my] > 0 ? v0[f + nx * my] : centre;
          let value = centre + (dt * nuf / (h * h)) * (west + east + south + north + down + up - 6 * centre);
          let rate = 0.5 * cf * 0.5 * (wallArea[cL] * speedAt(cL) + wallArea[cR] * speedAt(cR));
          if (drag) {
            rate += 0.5 * (dragB[cL] + dragB[cR]);
            value += dt * 0.5 * (dragY[cL] + dragY[cR]);
          }
          v[f] = value / (1 + dt * rate);
        }
      }
    }
    for (let k = 1; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + ny * k);
          if (aw[f] <= 0 || bw[f] !== 0) continue;
          const cL = f - nxy;
          const cR = f;
          if (!live(cL) || !live(cR)) {
            w[f] = 0;
            continue;
          }
          const nuf = Math.min(limit, nuMol + 0.5 * (nut[cL] + nut[cR]));
          const centre = w0[f];
          const west = i > 0 && aw[f - 1] > 0 ? w0[f - 1] : centre;
          const east = i + 1 < nx && aw[f + 1] > 0 ? w0[f + 1] : centre;
          const south = j > 0 && aw[f - nx] > 0 ? w0[f - nx] : centre;
          const north = j + 1 < ny && aw[f + nx] > 0 ? w0[f + nx] : centre;
          const down = bw[f - nxy] === 0 && aw[f - nxy] > 0 ? w0[f - nxy] : centre;
          const up = k + 1 < nz && bw[f + nxy] === 0 && aw[f + nxy] > 0 ? w0[f + nxy] : centre;
          let value = centre + (dt * nuf / (h * h)) * (west + east + south + north + down + up - 6 * centre);
          let rate = 0.5 * cf * 0.5 * (wallArea[cL] * speedAt(cL) + wallArea[cR] * speedAt(cR));
          if (drag) {
            rate += 0.5 * (dragB[cL] + dragB[cR]);
            value += dt * 0.5 * (dragZ[cL] + dragZ[cR]);
          }
          w[f] = value / (1 + dt * rate);
        }
      }
    }
  }

  // Proyección: resuelve φ = p·dt/(ρ·h) con Σ a_f (φ_c − φ_vecina) = −Σ a_f u*_saliente y corrige las velocidades.
  project(dt, tolerance) {
    const [nx, ny, nz] = this.dims;
    const { u, v, w, au, av, aw, bu, bv, bw, active, pfix, pval, eps, pcg, phi, rhs, h } = this;
    const { diag, ax, ay, az } = pcg;
    const mx = nx + 1;
    const my = ny + 1;
    const nxy = nx * ny;
    const scale = dt / (this.rho * h);
    diag.fill(0);
    ax.fill(0);
    ay.fill(0);
    az.fill(0);
    rhs.fill(0);
    pcg.active.set(active);
    const phiFixed = (c) => pval[c] * scale;
    // ε de la cara: promedio de las celdas que toca (en el borde, la única que hay)
    const epsFace = (cL, cR) => (cL < 0 ? eps[cR] : cR < 0 ? eps[cL] : 0.5 * (eps[cL] + eps[cR]));
    // acumula una cara entre las celdas cL (lado −) y cR (lado +); −1 = no existe (borde del dominio)
    const accumulate = (cL, cR, weight, velocity, kind, coefficients, stride) => {
      const liveL = cL >= 0 && active[cL] === 1;
      const liveR = cR >= 0 && active[cR] === 1;
      const fixedL = cL >= 0 && pfix[cL] === 1;
      const fixedR = cR >= 0 && pfix[cR] === 1;
      if (kind === 1) {
        if (liveL) rhs[cL] -= weight * velocity;
        if (liveR) rhs[cR] += weight * velocity;
        return;
      }
      if (liveL) rhs[cL] -= weight * velocity;
      if (liveR) rhs[cR] += weight * velocity;
      if (liveL) {
        diag[cL] += weight;
        if (liveR) coefficients[cL] = -weight;
        else if (fixedR) rhs[cL] += weight * phiFixed(cR);
      }
      if (liveR) {
        diag[cR] += weight;
        if (fixedL) rhs[cR] += weight * phiFixed(cL);
      }
    };
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i <= nx; i += 1) {
          const f = i + mx * (j + ny * k);
          if (au[f] <= 0) continue;
          const cL = i > 0 ? i - 1 + nx * (j + ny * k) : -1;
          const cR = i < nx ? i + nx * (j + ny * k) : -1;
          accumulate(cL, cR, au[f] * epsFace(cL, cR), u[f], bu[f], ax);
        }
      }
    }
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j <= ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + my * k);
          if (av[f] <= 0) continue;
          const cL = j > 0 ? i + nx * (j - 1 + ny * k) : -1;
          const cR = j < ny ? i + nx * (j + ny * k) : -1;
          accumulate(cL, cR, av[f] * epsFace(cL, cR), v[f], bv[f], ay);
        }
      }
    }
    for (let k = 0; k <= nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + ny * k);
          if (aw[f] <= 0) continue;
          const cL = k > 0 ? f - nxy : -1;
          const cR = k < nz ? f : -1;
          accumulate(cL, cR, aw[f] * epsFace(cL, cR), w[f], bw[f], az);
        }
      }
    }
    // solución inicial: la presión del paso anterior en las unidades de este dt
    for (let c = 0; c < this.n; c += 1) phi[c] = active[c] ? this.p[c] * scale : 0;
    pcg.buildPreconditioner();
    const result = pcg.solve(rhs, phi, { tolerance, maxIterations: 120 });
    this.pcgIterations = result.iterations;
    this.pcgResidual = result.residual;
    const phiOf = (c) => (active[c] ? phi[c] : pfix[c] ? phiFixed(c) : 0);
    // corrección de las velocidades
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i <= nx; i += 1) {
          const f = i + mx * (j + ny * k);
          if (bu[f] === 1) continue;
          if (au[f] <= 0) {
            u[f] = 0;
            continue;
          }
          const cL = i > 0 ? i - 1 + nx * (j + ny * k) : -1;
          const cR = i < nx ? i + nx * (j + ny * k) : -1;
          const aliveL = cL >= 0 && (active[cL] || pfix[cL]);
          const aliveR = cR >= 0 && (active[cR] || pfix[cR]);
          if (!aliveL && !aliveR) {
            u[f] = 0;
            continue;
          }
          if (cL >= 0 && cR >= 0 && !(aliveL && aliveR)) {
            u[f] = 0;
            continue;
          }
          u[f] -= (cR >= 0 ? phiOf(cR) : 0) - (cL >= 0 ? phiOf(cL) : 0);
        }
      }
    }
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j <= ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + my * k);
          if (bv[f] === 1) continue;
          if (av[f] <= 0) {
            v[f] = 0;
            continue;
          }
          const cL = j > 0 ? i + nx * (j - 1 + ny * k) : -1;
          const cR = j < ny ? i + nx * (j + ny * k) : -1;
          const aliveL = cL >= 0 && (active[cL] || pfix[cL]);
          const aliveR = cR >= 0 && (active[cR] || pfix[cR]);
          if ((!aliveL && !aliveR) || (cL >= 0 && cR >= 0 && !(aliveL && aliveR))) {
            v[f] = 0;
            continue;
          }
          v[f] -= (cR >= 0 ? phiOf(cR) : 0) - (cL >= 0 ? phiOf(cL) : 0);
        }
      }
    }
    for (let k = 0; k <= nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const f = i + nx * (j + ny * k);
          if (bw[f] === 1) continue;
          if (aw[f] <= 0) {
            w[f] = 0;
            continue;
          }
          const cL = k > 0 ? f - nxy : -1;
          const cR = k < nz ? f : -1;
          const aliveL = cL >= 0 && (active[cL] || pfix[cL]);
          const aliveR = cR >= 0 && (active[cR] || pfix[cR]);
          if ((!aliveL && !aliveR) || (cL >= 0 && cR >= 0 && !(aliveL && aliveR))) {
            w[f] = 0;
            continue;
          }
          w[f] -= (cR >= 0 ? phiOf(cR) : 0) - (cL >= 0 ? phiOf(cL) : 0);
        }
      }
    }
    const inverse = (this.rho * h) / dt;
    for (let c = 0; c < this.n; c += 1) this.p[c] = active[c] ? phi[c] * inverse : pfix[c] ? pval[c] : 0;
  }

  // Un paso pseudo-temporal: advección → fuentes → proyección. Devuelve el cambio máximo de velocidad relativo a la de referencia.
  step() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.refreshMovable();
    this.peakSpeed = this.maxSpeed();
    const reference = Math.max(this.uRef, this.peakSpeed, 1e-3);
    const dt = (this.cfl * this.h) / reference;
    this.lastDt = dt;
    const before = this.change0 ?? (this.change0 = new Float32Array(this.nU + this.nV + this.nW));
    before.set(this.u, 0);
    before.set(this.v, this.nU);
    before.set(this.w, this.nU + this.nV);
    this.centerVelocities();
    this.updateTurbulence();
    this.advect(dt);
    this.applySources(dt);
    this.project(dt, 1e-4 * Math.max(this.uRef, 1e-3));
    this.centerVelocities();
    // cambio cuadrático medio de las caras vivas (el máximo puntual oscila en bordes y esquinas aunque el campo ya no cambie)
    let change = 0;
    let total = 0;
    for (let c = 0; c < this.nU; c += 1) { const d = this.u[c] - before[c]; change += d * d; total += this.u[c] * this.u[c]; }
    for (let c = 0; c < this.nV; c += 1) { const d = this.v[c] - before[this.nU + c]; change += d * d; total += this.v[c] * this.v[c]; }
    for (let c = 0; c < this.nW; c += 1) { const d = this.w[c] - before[this.nU + this.nV + c]; change += d * d; total += this.w[c] * this.w[c]; }
    this.delta = Math.sqrt(change / Math.max(total, 1e-12));
    this.steps += 1;
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stepCost = this.stepCost ? this.stepCost * 0.7 + (t1 - t0) * 0.3 : t1 - t0;
    return this.delta;
  }

  // Itera hasta converger o agotar `budgetMs` (para repartirlo entre cuadros) / `maxSteps`. Devuelve true si convergió.
  advance({ budgetMs = Infinity, maxSteps = Infinity, tolerance = 6e-3 } = {}) {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let done = 0;
    while (done < maxSteps) {
      const delta = this.step();
      done += 1;
      this.settled = delta < tolerance ? this.settled + 1 : 0;
      if (this.settled >= 3) return true;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - start > budgetMs) break;
    }
    return this.settled >= 3;
  }

  // Resuelve hasta el estacionario.
  solveSteady({ maxSteps = 600, tolerance = 6e-3 } = {}) {
    this.settled = 0;
    const converged = this.advance({ maxSteps, tolerance });
    return { converged, steps: this.steps, delta: this.delta };
  }

  // ---------- acople con los granos ----------

  // Cada paso de aire: beginDeposit() → depositParticle() por grano → endDeposit(). Deja la porosidad ε = 1 − α de cada celda y,
  // para el arrastre semi-implícito de applySources, la rapidez de acople B (1/s) y la fuente de cantidad de movimiento X (m/s²).
  beginDeposit() {
    this.alpha ??= new Float32Array(this.n);
    this.alpha.fill(0);
    this.dragB.fill(0);
    this.dragX.fill(0);
    this.dragY.fill(0);
    this.dragZ.fill(0);
  }

  // x, y, z en mm; v en mm/s; solidVolume en m³; coupling = masa·k_arrastre del grano (kg/s).
  depositParticle(x, y, z, vx, vy, vz, solidVolume, coupling) {
    const [nx, ny, nz] = this.dims;
    const i = Math.floor((x - this.origin[0]) / this.hmm);
    const j = Math.floor((y - this.origin[1]) / this.hmm);
    const k = Math.floor((z - this.origin[2]) / this.hmm);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const c = i + nx * (j + ny * k);
    this.alpha[c] += solidVolume;
    this.dragB[c] += coupling;
    this.dragX[c] += coupling * vx * 0.001;
    this.dragY[c] += coupling * vy * 0.001;
    this.dragZ[c] += coupling * vz * 0.001;
  }

  endDeposit() {
    const { alpha, eps, dragB, dragX, dragY, dragZ, active, pfix } = this;
    const volume = this.h ** 3;
    let any = false;
    for (let c = 0; c < this.n; c += 1) {
      if (alpha[c] <= 0 || (!active[c] && !pfix[c])) {
        eps[c] = 1;
        dragB[c] = 0;
        dragX[c] = 0;
        dragY[c] = 0;
        dragZ[c] = 0;
        continue;
      }
      any = true;
      const solid = Math.min(0.62, alpha[c] / volume);
      eps[c] = 1 - solid;
      const factor = 1 / (this.rho * eps[c] * volume);
      dragB[c] *= factor;
      dragX[c] *= factor;
      dragY[c] *= factor;
      dragZ[c] *= factor;
    }
    this.hasDrag = any;
    if (any) this.settled = 0;
  }

  clearParticles() {
    this.eps.fill(1);
    this.dragB.fill(0);
    this.dragX.fill(0);
    this.dragY.fill(0);
    this.dragZ.fill(0);
    this.hasDrag = false;
  }

  // ---------- consultas ----------

  // ¿Se descontroló el campo? (NaN o velocidades muy por encima de lo que puede dar el caudal impuesto; la garganta de un
  // Venturi de relación 4:1 llega a ~4× la de entrada.)
  diverging() {
    const peak = this.peakSpeed ?? 0;
    return !Number.isFinite(peak) || peak > 12 * Math.max(this.uRef, 1) + 40;
  }

  // Porosidad ε de la celda que contiene el punto (1 = sin granos; fuera del dominio 1).
  cellPorosity(x, y, z) {
    const [nx, ny, nz] = this.dims;
    const i = Math.floor((x - this.origin[0]) / this.hmm);
    const j = Math.floor((y - this.origin[1]) / this.hmm);
    const k = Math.floor((z - this.origin[2]) / this.hmm);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 1;
    return this.eps[i + nx * (j + ny * k)];
  }

  // Interpolación trilineal de un campo de centros, ignorando las celdas muertas (pared, bolsillos).
  sampleCells(field, x, y, z, fallback = 0) {
    const [nx, ny, nz] = this.dims;
    const gx = (x - this.origin[0]) / this.hmm - 0.5;
    const gy = (y - this.origin[1]) / this.hmm - 0.5;
    const gz = (z - this.origin[2]) / this.hmm - 0.5;
    if (gx < -1 || gy < -1 || gz < -1 || gx > nx || gy > ny || gz > nz) return fallback;
    const fx = Math.min(nx - 1.001, Math.max(0, gx));
    const fy = Math.min(ny - 1.001, Math.max(0, gy));
    const fz = Math.min(nz - 1.001, Math.max(0, gz));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const base = i + nx * (j + ny * k);
    let sum = 0;
    let weight = 0;
    for (let c = 0; c < 8; c += 1) {
      const cell = base + (c & 1) + ((c >> 1) & 1) * nx + ((c >> 2) & 1) * nx * ny;
      if (!this.active[cell] && !this.pfix[cell]) continue;
      const wgt = ((c & 1) ? tx : 1 - tx) * (((c >> 1) & 1) ? ty : 1 - ty) * (((c >> 2) & 1) ? tz : 1 - tz);
      sum += field[cell] * wgt;
      weight += wgt;
    }
    return weight > 1e-6 ? sum / weight : fallback;
  }

  // Velocidad del aire en mm/s (la unidad de las partículas); fuera del dominio vale `fallback`.
  velocityAt(x, y, z, out, fallback = [0, 0, 0]) {
    const [nx, ny, nz] = this.dims;
    const gx = (x - this.origin[0]) / this.hmm;
    const gy = (y - this.origin[1]) / this.hmm;
    const gz = (z - this.origin[2]) / this.hmm;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx || gy > ny || gz > nz) {
      out[0] = fallback[0];
      out[1] = fallback[1];
      out[2] = fallback[2];
      return;
    }
    out[0] = this.sampleCells(this.uc, x, y, z) * 1000;
    out[1] = this.sampleCells(this.vc, x, y, z) * 1000;
    out[2] = this.sampleCells(this.wc, x, y, z) * 1000;
  }

  // Corte plano del campo: eje (0 x, 1 y, 2 z), posición t en [0,1] a lo largo del dominio y `res` píxeles en el lado mayor.
  // Devuelve presión (Pa) y rapidez (m/s) por píxel, máscara de aire y los extremos para escalar el color.
  sliceField(axis, t, res = 72) {
    const [nx, ny, nz] = this.dims;
    const dims = this.dims;
    const [a, b] = [0, 1, 2].filter((k) => k !== axis);
    const along = Math.max(0, Math.min(dims[axis] - 1, Math.round(t * (dims[axis] - 1))));
    const scale = Math.max(1, res / Math.max(dims[a], dims[b]));
    const w = Math.max(2, Math.round(dims[a] * scale));
    const h = Math.max(2, Math.round(dims[b] * scale));
    const pressure = new Float32Array(w * h);
    const speed = new Float32Array(w * h);
    const mask = new Uint8Array(w * h);
    let pMax = 0;
    let sMax = 0;
    const ijk = [0, 0, 0];
    ijk[axis] = along;
    for (let q = 0; q < h; q += 1) {
      ijk[b] = Math.min(dims[b] - 1, Math.floor((q / h) * dims[b]));
      for (let r = 0; r < w; r += 1) {
        ijk[a] = Math.min(dims[a] - 1, Math.floor((r / w) * dims[a]));
        const c = ijk[0] + nx * (ijk[1] + ny * ijk[2]);
        if (!this.active[c] && !this.pfix[c]) continue;
        const at = r + w * q;
        mask[at] = 1;
        pressure[at] = this.p[c];
        speed[at] = Math.sqrt(this.uc[c] * this.uc[c] + this.vc[c] * this.vc[c] + this.wc[c] * this.wc[c]);
        pMax = Math.max(pMax, Math.abs(this.p[c]));
        sMax = Math.max(sMax, speed[at]);
      }
    }
    const lo = [this.origin[a], this.origin[b]];
    return { axis, coord: this.origin[axis] + (along + 0.5) * this.hmm, nx: w, ny: h, lo, size: [dims[a] * this.hmm, dims[b] * this.hmm], pressure, speed, mask, pMax, sMax };
  }

  pressureAt(x, y, z) {
    return this.sampleCells(this.p, x, y, z, 0);
  }

  porosityAt(x, y, z) {
    return this.sampleCells(this.eps, x, y, z, 1);
  }

  // Lecturas de una caja de sensor: presión media (Pa), rapidez media (m/s) y caudal (m³/s) por el plano central de su eje más corto.
  readBox(center, size) {
    const [nx, ny, nz] = this.dims;
    const lo = center.map((c, k) => c - size[k] / 2);
    const hi = center.map((c, k) => c + size[k] / 2);
    const range = (k, n) => [Math.max(0, Math.floor((lo[k] - this.origin[k]) / this.hmm)), Math.min(n - 1, Math.floor((hi[k] - this.origin[k]) / this.hmm))];
    const [i0, i1] = range(0, nx);
    const [j0, j1] = range(1, ny);
    const [k0, k1] = range(2, nz);
    let count = 0;
    let pressure = 0;
    let speed = 0;
    for (let k = k0; k <= k1; k += 1) {
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const c = i + nx * (j + ny * k);
          if (!this.active[c] && !this.pfix[c]) continue;
          count += 1;
          pressure += this.p[c];
          speed += Math.hypot(this.uc[c], this.vc[c], this.wc[c]);
        }
      }
    }
    const axis = [0, 1, 2].reduce((best, a) => (size[a] < size[best] ? a : best), 0);
    let flow = 0;
    const mx = nx + 1;
    const my = ny + 1;
    const mid = Math.min(this.dims[axis] - 1, Math.max(1, Math.round((center[axis] - this.origin[axis]) / this.hmm)));
    const span = [[i0, i1], [j0, j1], [k0, k1]];
    const others = [0, 1, 2].filter((a) => a !== axis);
    for (let b = span[others[1]][0]; b <= span[others[1]][1]; b += 1) {
      for (let a = span[others[0]][0]; a <= span[others[0]][1]; a += 1) {
        const ijk = [0, 0, 0];
        ijk[axis] = mid;
        ijk[others[0]] = a;
        ijk[others[1]] = b;
        const [i, j, k] = ijk;
        if (axis === 0) flow += this.u[i + mx * (j + ny * k)] * this.au[i + mx * (j + ny * k)];
        else if (axis === 1) flow += this.v[i + nx * (j + my * k)] * this.av[i + nx * (j + my * k)];
        else flow += this.w[i + nx * (j + ny * k)] * this.aw[i + nx * (j + ny * k)];
      }
    }
    return { pressure: count ? pressure / count : 0, speed: count ? speed / count : 0, flow: flow * this.h * this.h, axis, cells: count };
  }

  // Caudal neto que sale por los bordes abiertos (m³/s): debe igualar el que entra (control de conservación de masa).
  boundaryOutflow() {
    const [nx, ny, nz] = this.dims;
    const mx = nx + 1;
    const my = ny + 1;
    let out = 0;
    for (let k = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) {
      out += this.u[nx + mx * (j + ny * k)] * this.au[nx + mx * (j + ny * k)] - this.u[mx * (j + ny * k)] * this.au[mx * (j + ny * k)];
    }
    for (let k = 0; k < nz; k += 1) for (let i = 0; i < nx; i += 1) {
      out += this.v[i + nx * (ny + my * k)] * this.av[i + nx * (ny + my * k)] - this.v[i + nx * my * k] * this.av[i + nx * my * k];
    }
    for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      out += this.w[i + nx * (j + ny * nz)] * this.aw[i + nx * (j + ny * nz)] - this.w[i + nx * j] * this.aw[i + nx * j];
    }
    return out * this.h * this.h;
  }

  inletFlow() {
    return this.inletFaces.reduce((sum, entry) => sum + (entry.flow ?? 0), 0);
  }
}
