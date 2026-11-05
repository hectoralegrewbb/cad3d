// Simplificación de mallas por colapso de aristas con métrica cuádrica (Garland–Heckbert). Puro: sin DOM ni kernel.
// Conserva la topología (condición de enlace: una malla cerrada sigue cerrada), no deja que los triángulos se den vuelta y
// mantiene los bordes abiertos. Es asíncrono por tandas para poder mostrar progreso y cancelar sin congelar la interfaz.

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Q = [aa ab ac ad bb bc bd cc cd dd] por vértice, en un solo arreglo.
const addPlane = (Q, v, a, b, c, d, w) => {
  const o = v * 10;
  Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
  Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
  Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
};
const quadricError = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];

// Volumen con signo por tetraedros (mm³): sirve para informar cuánto cambió la forma.
export function meshVolume(vertices, triangles) {
  let volume = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3; const b = triangles[t + 1] * 3; const c = triangles[t + 2] * 3;
    volume += (vertices[a] * (vertices[b + 1] * vertices[c + 2] - vertices[b + 2] * vertices[c + 1])
      - vertices[a + 1] * (vertices[b] * vertices[c + 2] - vertices[b + 2] * vertices[c])
      + vertices[a + 2] * (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c])) / 6;
  }
  return Math.abs(volume);
}

// mesh: { vertices: Float32Array|Float64Array, triangles: Uint32Array }. target: triángulos deseados.
// Devuelve { vertices, triangles, maxError, reached, before, after }. `maxError` ≈ desvío máximo (en unidades de la malla).
export async function simplifyMesh(mesh, target, { onProgress, signal, batch = 1500 } = {}) {
  const n = mesh.vertices.length / 3;
  const pos = Float64Array.from(mesh.vertices);
  const tri = Uint32Array.from(mesh.triangles);
  const F = tri.length / 3;
  const alive = new Uint8Array(F).fill(1);
  let faceCount = F;
  const goal = Math.max(4, Math.floor(target));
  if (F <= goal) return { vertices: Float32Array.from(mesh.vertices), triangles: tri, maxError: 0, reached: true, before: F, after: F };

  const vFaces = Array.from({ length: n }, () => []);
  for (let f = 0; f < F; f += 1) for (let k = 0; k < 3; k += 1) vFaces[tri[f * 3 + k]].push(f);

  // cuádricas: planos de las caras (ponderados por área) + planos perpendiculares en bordes abiertos (para no comerse el borde)
  const Q = new Float64Array(n * 10);
  const W = new Float64Array(n); // área acumulada por vértice: cost / W = desvío cuadrático medio (mm²), así el error se informa en mm
  const normalOf = (f, p = pos) => {
    const a = tri[f * 3] * 3; const b = tri[f * 3 + 1] * 3; const c = tri[f * 3 + 2] * 3;
    const ux = p[b] - p[a]; const uy = p[b + 1] - p[a + 1]; const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a]; const vy = p[c + 1] - p[a + 1]; const vz = p[c + 2] - p[a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const edgeFaces = new Map();
  const ekey = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let f = 0; f < F; f += 1) {
    const [nx, ny, nz] = normalOf(f);
    const len = Math.hypot(nx, ny, nz);
    for (let k = 0; k < 3; k += 1) {
      const key = ekey(tri[f * 3 + k], tri[f * 3 + (k + 1) % 3]);
      edgeFaces.set(key, (edgeFaces.get(key) ?? 0) + 1);
    }
    if (len < 1e-18) continue;
    const a = nx / len; const b = ny / len; const c = nz / len;
    const p0 = tri[f * 3] * 3;
    const d = -(a * pos[p0] + b * pos[p0 + 1] + c * pos[p0 + 2]);
    for (let k = 0; k < 3; k += 1) { addPlane(Q, tri[f * 3 + k], a, b, c, d, len / 2); W[tri[f * 3 + k]] += len / 2; }
  }
  for (let f = 0; f < F; f += 1) {
    const [nx, ny, nz] = normalOf(f);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-18) continue;
    for (let k = 0; k < 3; k += 1) {
      const u = tri[f * 3 + k]; const v = tri[f * 3 + (k + 1) % 3];
      if (edgeFaces.get(ekey(u, v)) !== 1) continue;
      const ex = pos[v * 3] - pos[u * 3]; const ey = pos[v * 3 + 1] - pos[u * 3 + 1]; const ez = pos[v * 3 + 2] - pos[u * 3 + 2];
      let px = ey * nz - ez * ny; let py = ez * nx - ex * nz; let pz = ex * ny - ey * nx; // perpendicular al borde y a la cara
      const pl = Math.hypot(px, py, pz);
      if (pl < 1e-18) continue;
      px /= pl; py /= pl; pz /= pl;
      const d = -(px * pos[u * 3] + py * pos[u * 3 + 1] + pz * pos[u * 3 + 2]);
      const w = Math.hypot(ex, ey, ez) * 100;
      addPlane(Q, u, px, py, pz, d, w); addPlane(Q, v, px, py, pz, d, w);
    }
  }

  const version = new Uint32Array(n);
  const heap = new MinHeap();
  const merged = new Float64Array(10);
  let maxCost = 0;

  // Mejor posición para colapsar (a,b) y su costo.
  const target3 = new Float64Array(3);
  const bestPoint = (a, b) => {
    for (let i = 0; i < 10; i += 1) merged[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const [aa, ab, ac, ad, bb, bc, bd, cc, cd] = merged;
    const det = aa * (bb * cc - bc * bc) - ab * (ab * cc - bc * ac) + ac * (ab * bc - bb * ac);
    const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    let best = null;
    const consider = (x, y, z) => { const e = quadricError(merged, x, y, z); if (!best || e < best.cost) best = { cost: e, x, y, z }; };
    consider(...pa); consider(...pb); consider((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
    if (Math.abs(det) > 1e-12 * (Math.abs(aa) + Math.abs(bb) + Math.abs(cc) + 1e-30) ** 3) {
      const x = -(ad * (bb * cc - bc * bc) - ab * (bd * cc - bc * cd) + ac * (bd * bc - bb * cd)) / det;
      const y = -(aa * (bd * cc - cd * bc) - ad * (ab * cc - bc * ac) + ac * (ab * cd - bd * ac)) / det;
      const z = -(aa * (bb * cd - bc * bd) - ab * (ab * cd - bd * ac) + ad * (ab * bc - bb * ac)) / det;
      // la solución óptima no debe irse lejos del par (evita picos en zonas casi planas)
      const reach = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) * 2 + 1e-9;
      if (Number.isFinite(x + y + z) && Math.hypot(x - pa[0], y - pa[1], z - pa[2]) < reach * 3) consider(x, y, z);
    }
    target3[0] = best.x; target3[1] = best.y; target3[2] = best.z;
    return Math.max(0, best.cost);
  };

  const liveFaces = (v) => {
    const list = vFaces[v];
    let w = 0;
    for (let i = 0; i < list.length; i += 1) if (alive[list[i]]) list[w++] = list[i];
    list.length = w;
    return list;
  };

  const pushEdge = (a, b) => {
    const cost = bestPoint(a, b);
    heap.push([cost, a, b, version[a], version[b]]);
  };
  const seen = new Set();
  for (let f = 0; f < F; f += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = tri[f * 3 + k]; const b = tri[f * 3 + (k + 1) % 3];
      const key = ekey(a, b);
      if (!seen.has(key)) { seen.add(key); pushEdge(a, b); }
    }
  }
  seen.clear();

  // ¿Se puede colapsar b → a en (x,y,z)? Condición de enlace + sin triángulos dados vuelta ni degenerados.
  const canCollapse = (a, b, x, y, z) => {
    const fa = liveFaces(a); const fb = liveFaces(b);
    const nbrA = new Set();
    fa.forEach((f) => { for (let k = 0; k < 3; k += 1) nbrA.add(tri[f * 3 + k]); });
    const opposite = new Set();
    let shared = 0;
    fb.forEach((f) => {
      let hasA = false;
      for (let k = 0; k < 3; k += 1) if (tri[f * 3 + k] === a) hasA = true;
      if (hasA) { shared += 1; for (let k = 0; k < 3; k += 1) { const v = tri[f * 3 + k]; if (v !== a && v !== b) opposite.add(v); } }
    });
    if (shared === 0 || shared > 2) return false;
    // vecinos comunes de a y b distintos de ellos: deben ser exactamente los vértices opuestos
    let common = 0;
    fb.forEach((f) => { for (let k = 0; k < 3; k += 1) { const v = tri[f * 3 + k]; if (v !== a && v !== b && nbrA.has(v)) { if (!opposite.has(v)) common = Infinity; } } });
    if (common === Infinity) return false;
    const commonSet = new Set();
    fb.forEach((f) => { for (let k = 0; k < 3; k += 1) { const v = tri[f * 3 + k]; if (v !== a && v !== b && nbrA.has(v)) commonSet.add(v); } });
    if (commonSet.size !== opposite.size) return false;
    // sin inversión de normales
    const check = (f, moving) => {
      let hasOther = false;
      for (let k = 0; k < 3; k += 1) if (tri[f * 3 + k] === (moving === a ? b : a)) hasOther = true;
      if (hasOther) return true; // esta cara desaparece
      const before = normalOf(f);
      const idx = [0, 1, 2].map((k) => tri[f * 3 + k]);
      const p = idx.map((v) => (v === moving ? [x, y, z] : [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
      const ux = p[1][0] - p[0][0]; const uy = p[1][1] - p[0][1]; const uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0]; const vy = p[2][1] - p[0][1]; const vz = p[2][2] - p[0][2];
      const after = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const lb = Math.hypot(...before); const la = Math.hypot(...after);
      if (lb < 1e-18) return true;
      if (la < lb * 1e-3) return false;
      return (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (lb * la) > 0.2;
    };
    return fa.every((f) => check(f, a)) && fb.every((f) => check(f, b));
  };

  let done = 0;
  const total = F - goal;
  while (faceCount > goal && heap.size) {
    for (let step = 0; step < batch && faceCount > goal && heap.size; step += 1) {
      const [cost, a, b, va, vb] = heap.pop();
      if (version[a] !== va || version[b] !== vb) continue;
      // las cuádricas cambian al colapsar: se revalida el costo antes de aceptar
      const fresh = bestPoint(a, b);
      if (fresh > cost * 1.0001 + 1e-12) { heap.push([fresh, a, b, version[a], version[b]]); continue; }
      const x = target3[0]; const y = target3[1]; const z = target3[2];
      if (!canCollapse(a, b, x, y, z)) continue;
      // colapso: b → a
      maxCost = Math.max(maxCost, fresh / Math.max(1e-30, W[a] + W[b]));
      W[a] += W[b];
      for (let i = 0; i < 10; i += 1) Q[a * 10 + i] += Q[b * 10 + i];
      pos[a * 3] = x; pos[a * 3 + 1] = y; pos[a * 3 + 2] = z;
      liveFaces(b).forEach((f) => {
        let hasA = false;
        for (let k = 0; k < 3; k += 1) if (tri[f * 3 + k] === a) hasA = true;
        if (hasA) { alive[f] = 0; faceCount -= 1; return; }
        for (let k = 0; k < 3; k += 1) if (tri[f * 3 + k] === b) tri[f * 3 + k] = a;
        vFaces[a].push(f);
      });
      vFaces[b] = [];
      version[a] += 1; version[b] += 1;
      const neighbours = new Set();
      liveFaces(a).forEach((f) => { for (let k = 0; k < 3; k += 1) { const v = tri[f * 3 + k]; if (v !== a) neighbours.add(v); } });
      neighbours.forEach((v) => { version[v] += 0; pushEdge(a, v); });
      done = F - faceCount;
    }
    onProgress?.(Math.min(1, done / total));
    if (signal?.cancelled) throw new Error('Cancelado');
    await nextTick();
  }

  // compactar: solo vértices usados
  const remap = new Int32Array(n).fill(-1);
  const outVertices = [];
  const outTriangles = [];
  for (let f = 0; f < F; f += 1) {
    if (!alive[f]) continue;
    for (let k = 0; k < 3; k += 1) {
      const v = tri[f * 3 + k];
      if (remap[v] < 0) { remap[v] = outVertices.length / 3; outVertices.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      outTriangles.push(remap[v]);
    }
  }
  onProgress?.(1);
  return { vertices: Float32Array.from(outVertices), triangles: Uint32Array.from(outTriangles), maxError: Math.sqrt(maxCost), reached: faceCount <= goal, before: F, after: faceCount };
}
