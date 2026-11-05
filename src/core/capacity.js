// Capacidad interior de recipientes (tolvas, silos, cañerías, tanques) por voxelización de la malla. Puro, sin DOM.
//
// 1) Por cada columna (x, y) se intersectan los triángulos con la recta vertical y se ordenan los cruces: par-impar → material.
// 2) Un voxel vacío cuenta como interior si tiene material a ambos lados en al menos 2 de los 3 ejes: eso admite bocas abiertas
//    (tolva abierta arriba, caño abierto en las puntas) y descarta el exterior. «sellado» = vacíos que no se alcanzan desde afuera.
// Es una estimación: el error crece con la relación superficie/volumen y baja al afinar la grilla.

const jitter = [0.3719, 0.6283]; // desplazamiento irracional de las columnas: evita que un rayo caiga justo sobre una arista compartida

export function voxelize(mesh, { maxCells = 6e6, maxAxis = 220 } = {}) {
  const { vertices: v, triangles: t } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], v[i + k]); max[k] = Math.max(max[k], v[i + k]); }
  const size = max.map((m, k) => m - min[k]);
  if (!(Math.max(...size) > 0)) return null;
  // voxel cúbico: lo más fino que permitan maxAxis y maxCells
  let h = Math.max(...size) / maxAxis;
  const cellsAt = (step) => size.reduce((p, s) => p * (Math.floor(s / step) + 3), 1);
  while (cellsAt(h) > maxCells) h *= 1.05;
  const origin = min.map((m) => m - h); // un voxel de margen por lado
  const n = size.map((s) => Math.floor(s / h) + 3);
  const [nx, ny, nz] = n;
  const solid = new Uint8Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // cruces por columna
  const columns = new Map();
  for (let q = 0; q < t.length; q += 3) {
    const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2], bx = v[b], by = v[b + 1], bz = v[b + 2], cx = v[c], cy = v[c + 1], cz = v[c + 2];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue; // triángulo vertical
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - origin[0]) / h - jitter[0]));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - origin[0]) / h - jitter[0]));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - origin[1]) / h - jitter[1]));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - origin[1]) / h - jitter[1]));
    for (let j = j0; j <= j1; j += 1) {
      const py = origin[1] + (j + jitter[1]) * h;
      for (let i = i0; i <= i1; i += 1) {
        const px = origin[0] + (i + jitter[0]) * h;
        const w1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det;
        const w2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det;
        if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
        const z = az + w1 * (bz - az) + w2 * (cz - az);
        const key = j * nx + i;
        let list = columns.get(key);
        if (!list) columns.set(key, (list = []));
        list.push(z);
      }
    }
  }
  columns.forEach((zs, key) => {
    zs.sort((p, q) => p - q);
    const i = key % nx;
    const j = (key - i) / nx;
    for (let s = 0; s + 1 < zs.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((zs[s] - origin[2]) / h - 0.5));
      const k1 = Math.min(nz - 1, Math.floor((zs[s + 1] - origin[2]) / h - 0.5));
      for (let k = k0; k <= k1; k += 1) solid[idx(i, j, k)] = 1;
    }
  });
  return { solid, n, h, origin, idx };
}

// Marca con 1 los voxeles vacíos con material a ambos lados en el eje dado.
function enclosedAlong(grid, axis) {
  const { solid, n, idx } = grid;
  const [nx, ny, nz] = n;
  const out = new Uint8Array(solid.length);
  const lens = [nx, ny, nz];
  const outer = [0, 1, 2].filter((a) => a !== axis);
  for (let p = 0; p < lens[outer[0]]; p += 1) {
    for (let q = 0; q < lens[outer[1]]; q += 1) {
      const at = (s) => { const c = [0, 0, 0]; c[outer[0]] = p; c[outer[1]] = q; c[axis] = s; return idx(c[0], c[1], c[2]); };
      let first = -1;
      let last = -1;
      for (let s = 0; s < lens[axis]; s += 1) if (solid[at(s)]) { if (first < 0) first = s; last = s; }
      if (first < 0) continue;
      for (let s = first; s <= last; s += 1) if (!solid[at(s)]) out[at(s)] = 1;
    }
  }
  return out;
}

// Vacíos alcanzables desde el borde de la grilla (6-vecinos): el exterior de verdad.
function exteriorFlood(grid) {
  const { solid, n, idx } = grid;
  const [nx, ny, nz] = n;
  const seen = new Uint8Array(solid.length);
  const stack = [];
  const push = (i, j, k) => { const id = idx(i, j, k); if (!solid[id] && !seen[id]) { seen[id] = 1; stack.push(i, j, k); } };
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) { push(i, j, 0); push(i, j, nz - 1); }
  for (let i = 0; i < nx; i += 1) for (let k = 0; k < nz; k += 1) { push(i, 0, k); push(i, ny - 1, k); }
  for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) { push(0, j, k); push(nx - 1, j, k); }
  while (stack.length) {
    const k = stack.pop(); const j = stack.pop(); const i = stack.pop();
    if (i > 0) push(i - 1, j, k); if (i < nx - 1) push(i + 1, j, k);
    if (j > 0) push(i, j - 1, k); if (j < ny - 1) push(i, j + 1, k);
    if (k > 0) push(i, j, k - 1); if (k < nz - 1) push(i, j, k + 1);
  }
  return seen;
}

// Resultado en mm³: { capacity, sealed, solidVolume, h, bounds, byLevel } — byLevel[k] = capacidad acumulada hasta la capa k (para llenar hasta una altura).
export function internalCapacity(mesh, options = {}) {
  const grid = voxelize(mesh, options);
  if (!grid) return null;
  const { solid, n, h, origin, idx } = grid;
  const [nx, ny, nz] = n;
  const ex = enclosedAlong(grid, 0);
  const ey = enclosedAlong(grid, 1);
  const ez = enclosedAlong(grid, 2);
  const outside = exteriorFlood(grid);
  const cell = h * h * h;
  let internal = 0;
  let sealed = 0;
  let solidCount = 0;
  const perLayer = new Float64Array(nz);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const id = idx(i, j, k);
        if (solid[id]) { solidCount += 1; continue; }
        if (!outside[id]) sealed += 1;
        if (ex[id] + ey[id] + ez[id] >= 2) { internal += 1; perLayer[k] += 1; }
      }
    }
  }
  const byLevel = [];
  let acc = 0;
  for (let k = 0; k < nz; k += 1) { acc += perLayer[k] * cell; byLevel.push({ z: origin[2] + (k + 1) * h, volume: acc }); }
  return { capacity: internal * cell, sealed: sealed * cell, solidVolume: solidCount * cell, h, byLevel };
}

// Capacidad hasta una altura z (mm, mismo sistema que la malla), interpolando entre capas.
export function capacityUpTo(result, z) {
  const levels = result.byLevel;
  if (!levels.length) return 0;
  if (z <= levels[0].z - result.h) return 0;
  if (z >= levels[levels.length - 1].z) return levels[levels.length - 1].volume;
  for (let k = 0; k < levels.length; k += 1) {
    if (z <= levels[k].z) {
      const prev = k ? levels[k - 1].volume : 0;
      const f = (z - (levels[k].z - result.h)) / result.h;
      return prev + (levels[k].volume - prev) * Math.max(0, Math.min(1, f));
    }
  }
  return levels[levels.length - 1].volume;
}

// Producto contenido: kg a partir de capacidad mm³, llenado 0–1 y densidad aparente en kg/m³.
export const productKg = (capacityMm3, fill, bulkKgM3) => (capacityMm3 * 1e-9) * fill * bulkKgM3;

export const bulkMaterials = [
  ['Agua', 1000], ['Trigo', 780], ['Maíz', 720], ['Arroz', 850], ['Soja', 750], ['Harina', 560], ['Azúcar', 850],
  ['Sal fina', 1200], ['Arena seca', 1600], ['Cemento', 1440], ['Pellets plástico', 650], ['Yerba mate', 400], ['Carbón', 800],
];

export { hopperCavity } from './hopperFill.js';
