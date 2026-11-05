// Campo de distancia con signo (SDF) sobre una grilla regular, a partir de una malla de triángulos cerrada.
// Solo se guarda la distancia real en una banda estrecha pegada a la superficie; fuera de la banda vale ±band.
// El signo sale de la paridad de cruces de un rayo en X por cada columna (y, z).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Distancia al cuadrado de un punto a un triángulo (Ericson, Real-Time Collision Detection).
function pointTriangleSq(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
      } else {
        const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  const dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz;
}

// vertices: Float32Array xyz; triangles: índices. Devuelve { origin, dims, cell, band, data }.
export function buildSdf(vertices, triangles, { cell = 1, band = 4, maxVoxels = 3_000_000 } = {}) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], vertices[i + k]);
      max[k] = Math.max(max[k], vertices[i + k]);
    }
  }
  let step = cell;
  const sizeOf = (s) => [0, 1, 2].map((k) => Math.ceil((max[k] - min[k] + 2 * (band + 2 * s)) / s) + 1);
  let dims = sizeOf(step);
  while (dims[0] * dims[1] * dims[2] > maxVoxels) {
    step *= 1.15;
    dims = sizeOf(step);
  }
  const reach = band;
  const origin = min.map((v) => v - (reach + 2 * step));
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz).fill(reach);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const vert = (t) => [vertices[t * 3], vertices[t * 3 + 1], vertices[t * 3 + 2]];
  const triCount = triangles.length / 3;
  const span = Math.ceil(reach / step);
  const p = [0, 0, 0];
  for (let t = 0; t < triCount; t += 1) {
    const a = vert(triangles[t * 3]);
    const b = vert(triangles[t * 3 + 1]);
    const c = vert(triangles[t * 3 + 2]);
    const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - origin[k]) / step) - span));
    const hi = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.ceil((Math.max(a[k], b[k], c[k]) - origin[k]) / step) + span));
    for (let k = lo[2]; k <= hi[2]; k += 1) {
      p[2] = origin[2] + k * step;
      for (let j = lo[1]; j <= hi[1]; j += 1) {
        p[1] = origin[1] + j * step;
        for (let i = lo[0]; i <= hi[0]; i += 1) {
          p[0] = origin[0] + i * step;
          const d2 = pointTriangleSq(p, a, b, c);
          const at = idx(i, j, k);
          if (d2 < data[at] * data[at]) data[at] = Math.sqrt(d2);
        }
      }
    }
  }
  // Signo: cruces por columna (y, z) con un pequeño corrimiento para no pegarle justo a aristas.
  const jy = 0.00137 * step;
  const jz = 0.00291 * step;
  const columns = new Array(ny * nz);
  for (let t = 0; t < triCount; t += 1) {
    const a = vert(triangles[t * 3]);
    const b = vert(triangles[t * 3 + 1]);
    const c = vert(triangles[t * 3 + 2]);
    const det = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2]);
    if (Math.abs(det) < 1e-12) continue;
    const j0 = Math.max(0, Math.ceil((Math.min(a[1], b[1], c[1]) - jy - origin[1]) / step));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1], c[1]) - jy - origin[1]) / step));
    const k0 = Math.max(0, Math.ceil((Math.min(a[2], b[2], c[2]) - jz - origin[2]) / step));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(a[2], b[2], c[2]) - jz - origin[2]) / step));
    for (let k = k0; k <= k1; k += 1) {
      const z = origin[2] + k * step + jz;
      for (let j = j0; j <= j1; j += 1) {
        const y = origin[1] + j * step + jy;
        const u = ((y - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (z - a[2])) / det;
        const v = ((b[1] - a[1]) * (z - a[2]) - (y - a[1]) * (b[2] - a[2])) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]);
        (columns[j + ny * k] ??= []).push(x);
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const crossings = columns[j + ny * k];
      if (!crossings) continue;
      crossings.sort((x, y) => x - y);
      let next = 0;
      let inside = false;
      for (let i = 0; i < nx; i += 1) {
        const x = origin[0] + i * step;
        while (next < crossings.length && crossings[next] < x) {
          inside = !inside;
          next += 1;
        }
        if (inside) data[idx(i, j, k)] *= -1;
      }
    }
  }
  return { origin, dims, cell: step, band: reach, data };
}

// Muestrea distancia y gradiente (interpolación trilineal exacta). Devuelve la distancia; el gradiente queda en `grad`.
export function sampleSdf(sdf, x, y, z, grad) {
  const { origin, dims, cell, data, band } = sdf;
  const fx = (x - origin[0]) / cell;
  const fy = (y - origin[1]) / cell;
  const fz = (z - origin[2]) / cell;
  const nx = dims[0];
  const ny = dims[1];
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= dims[2] - 1) {
    grad[0] = 0;
    grad[1] = 0;
    grad[2] = 0;
    return band;
  }
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  const base = i + nx * (j + ny * k);
  const sy = nx;
  const sz = nx * ny;
  const c000 = data[base];
  const c100 = data[base + 1];
  const c010 = data[base + sy];
  const c110 = data[base + sy + 1];
  const c001 = data[base + sz];
  const c101 = data[base + sz + 1];
  const c011 = data[base + sz + sy];
  const c111 = data[base + sz + sy + 1];
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  grad[0] = ((c100 - c000) * (1 - ty) * (1 - tz) + (c110 - c010) * ty * (1 - tz) + (c101 - c001) * (1 - ty) * tz + (c111 - c011) * ty * tz) / cell;
  grad[1] = ((x10 - x00) * (1 - tz) + (x11 - x01) * tz) / cell;
  grad[2] = (y1 - y0) / cell;
  return y0 + (y1 - y0) * tz;
}
