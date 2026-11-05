import assert from 'node:assert/strict';
import { PoissonPcg } from '../src/particles/pcg.js';

// Laplaciano 3D con p = 0 en las seis caras del dominio (Dirichlet): u(x,y,z) conocida por solución manufacturada.
const build = (n, mask = null) => {
  const solver = new PoissonPcg(n, n, n);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const c = i + n * (j + n * k);
        if (mask && !mask(i, j, k)) continue;
        solver.active[c] = 1;
        solver.diag[c] = 6;
        if (i < n - 1 && (!mask || mask(i + 1, j, k))) solver.ax[c] = -1;
        if (j < n - 1 && (!mask || mask(i, j + 1, k))) solver.ay[c] = -1;
        if (k < n - 1 && (!mask || mask(i, j, k + 1))) solver.az[c] = -1;
      }
    }
  }
  solver.buildPreconditioner();
  return solver;
};

// 1) converge y el residuo baja del umbral; con arranque en caliente no itera de más
{
  const n = 24;
  const solver = build(n);
  const b = new Float64Array(solver.n);
  for (let c = 0; c < solver.n; c += 1) b[c] = Math.sin(c * 0.37) + 0.5;
  const x = new Float64Array(solver.n);
  const first = solver.solve(b, x, { tolerance: 1e-8, maxIterations: 300 });
  assert.ok(first.residual <= 1e-8, `residuo ${first.residual}`);
  assert.ok(first.iterations < 60, `MIC(0) debe converger rápido: ${first.iterations} iteraciones`);
  const again = solver.solve(b, x, { tolerance: 1e-8 });
  assert.equal(again.iterations, 0, 'con la solución ya hallada no itera');
}

// 2) comparado con un barrido de Gauss-Seidel largo da la misma solución
{
  const n = 10;
  const solver = build(n);
  const b = new Float64Array(solver.n).fill(1);
  const x = new Float64Array(solver.n);
  solver.solve(b, x, { tolerance: 1e-12, maxIterations: 200 });
  const ref = new Float64Array(solver.n);
  for (let it = 0; it < 4000; it += 1) {
    for (let k = 0; k < n; k += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const c = i + n * (j + n * k);
          let s = b[c];
          if (i > 0) s -= solver.ax[c - 1] * ref[c - 1];
          if (i < n - 1) s -= solver.ax[c] * ref[c + 1];
          if (j > 0) s -= solver.ay[c - n] * ref[c - n];
          if (j < n - 1) s -= solver.ay[c] * ref[c + n];
          if (k > 0) s -= solver.az[c - n * n] * ref[c - n * n];
          if (k < n - 1) s -= solver.az[c] * ref[c + n * n];
          ref[c] = s / solver.diag[c];
        }
      }
    }
  }
  let worst = 0;
  for (let c = 0; c < solver.n; c += 1) worst = Math.max(worst, Math.abs(ref[c] - x[c]));
  assert.ok(worst < 1e-6, `diferencia con Gauss-Seidel ${worst}`);
}

// 3) celdas inactivas (un bloque sólido en el medio) no rompen la solución ni producen NaN
{
  const n = 16;
  const solver = build(n, (i, j, k) => !(i > 5 && i < 10 && j > 5 && j < 10 && k > 5 && k < 10));
  const b = new Float64Array(solver.n).fill(1);
  const x = new Float64Array(solver.n);
  const result = solver.solve(b, x, { tolerance: 1e-9, maxIterations: 300 });
  assert.ok(result.residual <= 1e-9);
  assert.ok(x.every((value) => Number.isFinite(value)));
  assert.equal(x[8 + n * (8 + n * 8)], 0, 'celda inactiva queda en 0');
}

console.log('pcg.test OK');
