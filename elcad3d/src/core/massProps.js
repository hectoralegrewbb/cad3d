// Propiedades de masa de una malla cerrada ({ vertices: Float32Array, triangles: Uint32Array }): puro, sin DOM ni kernel.
// Todo por tetraedros firmados desde el origen. Unidades de entrada mm → volumen mm³, superficie mm², inercia mm⁵ (por unidad de densidad).

export function meshProperties(mesh) {
  const { vertices: v, triangles: t } = mesh;
  let volume = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  // integrales de segundo orden (∫x², ∫y², ∫z², ∫xy, ∫yz, ∫zx) sobre el sólido
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, iyz = 0, izx = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b], by = v[b + 1], bz = v[b + 2];
    const cx3 = v[c], cy3 = v[c + 1], cz3 = v[c + 2];
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx3, cy3, cz3]]) {
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
    // área del triángulo
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx3 - ax, wy = cy3 - ay, wz = cz3 - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    area += 0.5 * Math.hypot(nx, ny, nz);
    // tetraedro (0, a, b, c)
    const det = ax * (by * cz3 - bz * cy3) - ay * (bx * cz3 - bz * cx3) + az * (bx * cy3 - by * cx3);
    const dv = det / 6;
    volume += dv;
    cx += dv * (ax + bx + cx3) / 4;
    cy += dv * (ay + by + cy3) / 4;
    cz += dv * (az + bz + cz3) / 4;
    // ∫ p_i p_j dV de un tetraedro con un vértice en el origen = det/120 · (Σ_k p_ik p_jk + (Σ_k p_ik)(Σ_k p_jk))
    const k = det / 120;
    const sx = ax + bx + cx3, sy = ay + by + cy3, sz = az + bz + cz3;
    ixx += k * (ax * ax + bx * bx + cx3 * cx3 + sx * sx);
    iyy += k * (ay * ay + by * by + cy3 * cy3 + sy * sy);
    izz += k * (az * az + bz * bz + cz3 * cz3 + sz * sz);
    ixy += k * (ax * ay + bx * by + cx3 * cy3 + sx * sy);
    iyz += k * (ay * az + by * bz + cy3 * cz3 + sy * sz);
    izx += k * (az * ax + bz * bx + cz3 * cx3 + sz * sx);
  }
  const sign = volume < 0 ? -1 : 1; // malla con normales invertidas
  volume *= sign;
  if (!(volume > 1e-9) || !Number.isFinite(volume)) {
    return { volume: 0, area, centroid: [0, 0, 0], bounds: { min, max, size: max.map((m, k) => m - min[k]) }, inertia: null, closed: false };
  }
  const centroid = [(cx * sign) / volume, (cy * sign) / volume, (cz * sign) / volume];
  ixx *= sign; iyy *= sign; izz *= sign; ixy *= sign; iyz *= sign; izx *= sign;
  // desplazamiento al centro de masa (Steiner) → tensor de inercia por unidad de densidad (mm⁵)
  const [gx, gy, gz] = centroid;
  const sxx = ixx - volume * gx * gx, syy = iyy - volume * gy * gy, szz = izz - volume * gz * gz;
  const sxy = ixy - volume * gx * gy, syz = iyz - volume * gy * gz, szx = izx - volume * gz * gx;
  const inertia = { xx: syy + szz, yy: sxx + szz, zz: sxx + syy, xy: -sxy, yz: -syz, zx: -szx };
  return { volume, area, centroid, bounds: { min, max, size: max.map((m, k) => m - min[k]) }, inertia, closed: true };
}

// Une varias mallas en una sola (para tratar un conjunto como un cuerpo).
export function mergeMeshes(meshes) {
  const list = meshes.filter(Boolean);
  const vertices = new Float32Array(list.reduce((s, m) => s + m.vertices.length, 0));
  const triangles = new Uint32Array(list.reduce((s, m) => s + m.triangles.length, 0));
  let vo = 0;
  let to = 0;
  let base = 0;
  list.forEach((m) => {
    vertices.set(m.vertices, vo);
    for (let i = 0; i < m.triangles.length; i += 1) triangles[to + i] = m.triangles[i] + base;
    vo += m.vertices.length;
    to += m.triangles.length;
    base += m.vertices.length / 3;
  });
  return { vertices, triangles };
}

// Masa (kg) a partir de volumen mm³ y densidad g/cm³; inercia en kg·m² a partir de mm⁵ (por unidad de densidad).
export const massFromVolume = (volumeMm3, densityGcm3) => (densityGcm3 * volumeMm3) / 1e6;
export const inertiaKgM2 = (inertiaPerDensity, densityGcm3) => {
  // ρ[kg/m³] = g/cm³·1000; mm⁵ = 1e-15 m⁵
  const k = densityGcm3 * 1000 * 1e-15;
  const out = {};
  Object.keys(inertiaPerDensity).forEach((key) => { out[key] = inertiaPerDensity[key] * k; });
  return out;
};
