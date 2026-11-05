import { decodeMesh } from '../core/meshCodec.js';
import { makeManifold, splitBodies } from '../core/meshTopology.js';
import { evaluate } from '../core/expression.js';

// Malla de triángulos (STL importado) → sólido B-Rep. La malla se repara (láminas que se tocan en una arista), se separa en cuerpos
// (ver meshTopology.js) y cada cuerpo se cose por su cuenta: una cara plana por triángulo → cáscara cerrada → caras coplanares fusionadas → sólido.
// Devuelve una forma nueva (compuesto si hay más de un cuerpo). Las coordenadas se escalan acá, en JS.

const release = (shape) => shape?.delete?.();

// Avisa el avance al hilo principal (solo existe dentro del worker): { fase, fracción 0-1, estimado en ms para fases de un solo paso }.
const report = (phase, fraction, estimateMs = 0, until = fraction) => globalThis.__elcadProgress?.(phase, fraction, estimateMs, until);

// Sólido de una cáscara; si el volumen sale negativo (triángulos con la normal hacia adentro) se da vuelta.
function solidOfShell(rep, oc, shell) {
  const maker = new oc.BRepBuilderAPI_MakeSolid();
  try {
    maker.Add(oc.TopoDS.Shell(shell));
    let solid = rep.cast(maker.Solid());
    if (rep.measureVolume(solid) < 0) {
      const flipped = rep.cast(solid.wrapped.Reversed());
      release(solid);
      solid = flipped;
    }
    return solid;
  } finally {
    maker.delete();
  }
}

// Un cuerpo de la malla → sólidos. `tolerance` es la de cosido (mm).
function solidsOfBody(rep, oc, body, tolerance, bodyIndex, slot = { base: 0, span: 1, bodies: 1 }) {
  const sewing = new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false);
  let unifier = null;
  let sewn = null;
  let merged = null;
  try {
    // Fases (aprox. 45 % caras, 40 % cosido, 15 % unificación): las caras avanzan de verdad; el cosido y la unificación son una sola
    // llamada del kernel, así que se estiman con lo que tardaron las caras.
    const label = slot.bodies > 1 ? ` (cuerpo ${bodyIndex + 1}/${slot.bodies})` : '';
    const at = (part) => slot.base + slot.span * part;
    const facesStart = Date.now();
    const total = body.triangles.length / 3;
    let lastReport = 0;
    for (let t = 0; t < body.triangles.length; t += 3) {
      const face = rep.makePolygon([body.points[body.triangles[t]], body.points[body.triangles[t + 1]], body.points[body.triangles[t + 2]]]);
      sewing.Add(face.wrapped);
      face.delete();
      const now = Date.now();
      if (now - lastReport > 120) { lastReport = now; report(`Creando caras${label}`, at(0.45 * (t / 3 / total))); }
    }
    const facesMs = Math.max(200, Date.now() - facesStart);
    report(`Cosiendo caras${label}`, at(0.45), facesMs, at(0.85));
    sewing.Perform(new oc.Message_ProgressRange());
    const free = sewing.NbFreeEdges();
    if (free > 0) throw new Error(`La malla no es un sólido cerrado: el cuerpo ${bodyIndex + 1} tiene ${free} arista(s) abiertas (huecos o triángulos que faltan). Repará el STL en el CAD`);
    report(`Uniendo caras planas${label}`, at(0.85), facesMs * 0.4, at(0.99));
    sewn = sewing.SewedShape();
    unifier = new oc.ShapeUpgrade_UnifySameDomain(sewn, true, true, false);
    unifier.Build();
    merged = unifier.Shape();
    return [...rep.iterTopo(merged, 'shell')].map((shell) => solidOfShell(rep, oc, shell));
  } finally {
    release(merged);
    unifier?.delete();
    release(sewn);
    sewing.delete();
  }
}

export function buildMeshSolid(rep, feature, params) {
  if (!feature.mesh) throw new Error('La operación no tiene malla: importá un STL');
  const scale = evaluate(feature.scale ?? 1, params);
  if (!(scale > 0)) throw new Error('La escala debe ser mayor que 0');
  const { vertices, triangles } = decodeMesh(feature.mesh);
  const scaled = Float64Array.from(vertices, (value) => value * scale);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < scaled.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], scaled[i + k]);
      max[k] = Math.max(max[k], scaled[i + k]);
    }
  }
  const tolerance = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-6);
  const oc = rep.getOC();
  const valid = (shape) => {
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
    try { return analyzer.IsValid_1 ? analyzer.IsValid_1() : analyzer.IsValid(); }
    finally { analyzer.delete(); }
  };
  const construct = (opposite) => {
    const repaired = makeManifold(scaled, triangles, tolerance * 10, { opposite });
    report('Preparando la malla', 0.01);
    const bodies = splitBodies(repaired.vertices, repaired.triangles);
    const totalTris = bodies.reduce((sum, body) => sum + body.triangles.length / 3, 0) || 1;
    let doneTris = 0;
    const solids = [];
    try {
      bodies.forEach((body, index) => {
        const share = body.triangles.length / 3 / totalTris;
        const slot = { base: 0.02 + 0.97 * (doneTris / totalTris), span: 0.97 * share, bodies: bodies.length };
        doneTris += body.triangles.length / 3;
        solids.push(...solidsOfBody(rep, oc, body, tolerance, index, slot));
      });
      return solids;
    } catch (error) { solids.forEach(release); throw error; }
  };
  let solids = construct(false);
  if (solids.length && !solids.every(valid)) {
    solids.forEach(release);
    // Aristas con cuatro caras: probar el otro emparejamiento, sin omitir la validación.
    solids = construct(true);
    let sourceVolume = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
      sourceVolume += (scaled[a] * (scaled[b+1]*scaled[c+2]-scaled[b+2]*scaled[c+1])
        - scaled[a+1] * (scaled[b]*scaled[c+2]-scaled[b+2]*scaled[c])
        + scaled[a+2] * (scaled[b]*scaled[c+1]-scaled[b+1]*scaled[c])) / 6;
    }
    const volume = solids.reduce((sum, shape) => sum + rep.measureVolume(shape), 0);
    const error = Math.abs(volume - Math.abs(sourceVolume)) / Math.max(1e-9, Math.abs(sourceVolume));
    if (!solids.every(valid) || error > 0.02) {
      solids.forEach(release);
      throw new Error('La malla no se pudo reparar como sólido válido conservando su volumen. Repará o reexportá el STL.');
    }
  }
  if (solids.length === 0) throw new Error('La malla no formó ningún cuerpo cerrado');
  if (solids.length === 1) return solids[0];
  try { return rep.makeCompound(solids); }
  finally { solids.forEach(release); }
}
