import { buildSdf } from '../src/particles/sdf.js';
import { ParticleSim, materialPresets } from '../src/particles/sim.js';
// placa cuadrada (±L) con agujero circular de radio R, espesor t, como sólido cerrado
const plateWithHole = (L, R, t, seg = 24) => {
  const V = []; const T = [];
  const ring = (z, r) => { const base = V.length / 3; for (let k = 0; k < seg; k++) { const a = (k / seg) * 2 * Math.PI; V.push(r * Math.cos(a), r * Math.sin(a), z); } return base; };
  const square = (z) => { const base = V.length / 3; for (let k = 0; k < seg; k++) { const a = (k / seg) * 2 * Math.PI; const c = Math.cos(a), s = Math.sin(a); const m = Math.max(Math.abs(c), Math.abs(s)); V.push((c / m) * L, (s / m) * L, z); } return base; };
  const hi = ring(0, R), ho = ring(-t, R), si = square(0), so = square(-t);
  const strip = (a, b) => { for (let k = 0; k < seg; k++) { const n = (k + 1) % seg; T.push(a + k, b + k, b + n, a + k, b + n, a + n); } };
  strip(hi, si); strip(so, ho); strip(ho, hi); strip(si, so);
  return { vertices: Float32Array.from(V), triangles: Uint32Array.from(T) };
};
const box = (min, max) => { const [x0,y0,z0] = min, [x1,y1,z1] = max; const v = [x0,y0,z0, x1,y0,z0, x1,y1,z0, x0,y1,z0, x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1]; const q = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[3,0,4,7]]; const t = []; q.forEach(([a,b,c,d]) => t.push(a,b,c,a,c,d)); return { vertices: Float32Array.from(v), triangles: Uint32Array.from(t) }; };
export const discharge = (preset, overrides = {}, D = 12, L = 22, fillH = 60) => {
  const p = { ...materialPresets[preset], ...overrides };
  const meshes = [plateWithHole(L + 3, D / 2, 4), box([-L - 3, -L - 3, 0], [-L, L + 3, 140]), box([L, -L - 3, 0], [L + 3, L + 3, 140]), box([-L, -L - 3, 0], [L, -L, 140]), box([-L, L, 0], [L, L + 3, 140])];
  const bodies = meshes.map((m) => ({ sdf: buildSdf(m.vertices, m.triangles, { cell: Math.max(0.6, p.radius * 0.7), band: Math.max(4, p.radius * 2.5) }) }));
  const sim = new ParticleSim(bodies, { ...p, cap: 6000, maxCap: 6000, rate: 0, emitter: { center: [0, 0, 300], size: [1, 1, 1] }, floorZ: -30, seed: 3 });
  const r = p.radius, d = 2.05 * r; let n = 0;
  for (let k = 0; ; k++) { const z = r + 0.3 + k * d * 0.82; if (z > fillH) break; for (let j = -Math.floor(L / d) + 1; j < Math.floor(L / d); j++) for (let i = -Math.floor(L / d) + 1; i < Math.floor(L / d); i++) { const a = n * 3; sim.x[a] = (i + (k % 2) * 0.4) * d; sim.x[a + 1] = (j + (k % 2) * 0.4) * d; sim.x[a + 2] = z; sim.prev.set(sim.x.subarray(a, a + 3), a); n++; } }
  sim.count = n;
  if (process.env.NOLOAD) sim.computeOverburden = function () { this.maxLoad = 0; if (this.load) this.load.fill(0); };
  const total = n; const t0 = Date.now(); const series = [];
  for (let s = 0; s < 60 * 3; s++) { sim.step(1 / 60); if (s % 15 === 14) series.push(sim.exited); }
  // caudal: entre 0,5 s y 1,5 s
  const rate = (series[5] - series[1]) / 1.0; const stepMs = sim.stepMs;
  const beverloo = 0.58 * (0.6 / ((4 / 3) * Math.PI * r ** 3)) * Math.sqrt(9810) * Math.max(0, D - 1.4 * 2 * r) ** 2.5;
  return { total, rate, beverloo: Math.round(beverloo), ratio: (rate / beverloo).toFixed(2), exited6s: sim.exited, ms: Date.now() - t0, stepMs: stepMs.toFixed(1) };
};

// Pila vertida desde un punto: devuelve la pendiente del flanco (entre el 70 % y el 20 % de la altura) y si quedó todo dormido.
export const pourPile = (preset, count = 1200) => {
  const p = { ...materialPresets[preset] };
  const plate = box([-120, -120, -4], [120, 120, 0]);
  const sdf = buildSdf(plate.vertices, plate.triangles, { cell: Math.max(0.6, p.radius * 0.7), band: Math.max(4, p.radius * 2.5) });
  const sim = new ParticleSim([{ sdf }], { ...p, cap: count, maxCap: count, rate: 300, emitter: { center: [0, 0, 20], size: [3, 3, 3] }, floorZ: -50, seed: 7 });
  for (let n = 0; n < 60 * 12; n += 1) sim.step(1 / 60);
  const bins = new Map();
  for (let i = 0; i < sim.count; i += 1) {
    const r = Math.floor(Math.hypot(sim.x[i * 3], sim.x[i * 3 + 1]) / 4) * 4;
    bins.set(r, Math.max(bins.get(r) ?? -Infinity, sim.x[i * 3 + 2] - p.radius));
  }
  const profile = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  const peak = Math.max(...profile.map(([, z]) => z));
  const at = (fraction) => profile.filter(([, z]) => z <= peak * fraction).sort((a, b) => a[0] - b[0])[0];
  const hi = profile.filter(([, z]) => z >= peak * 0.7).pop();
  const lo = profile.find(([r, z]) => r > hi[0] && z <= peak * 0.2) ?? profile[profile.length - 1];
  const slope = (Math.atan((hi[1] - lo[1]) / Math.max(1, lo[0] - hi[0])) * 180) / Math.PI;
  return { slope, peak, count: sim.count, asleep: sim.asleep.slice(0, sim.count).reduce((a, b) => a + b, 0), stepMs: sim.stepMs };
};
