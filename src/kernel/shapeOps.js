// Operaciones sobre formas que evitan booleanas caras cuando se puede.

const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// `whole` − `body`. Si `body` ya es uno de los cuerpos sueltos de `whole` (mismo recinto), se lo saca sin booleana
// (cortar un tornillo helicoidal a una pieza grande tarda segundos). Devuelve null si no queda nada. Sin coincidencia: corte normal.
export function removeBody(rep, whole, body) {
  try {
    const solids = [...rep.iterTopo(whole.wrapped, 'solid')].map((wrapped) => rep.cast(wrapped));
    if (solids.length > 1) {
      const [min, max] = body.boundingBox.bounds;
      const volume = rep.measureVolume(body);
      const tol = 0.02;
      const index = solids.findIndex((solid) => {
        const [a, b] = solid.boundingBox.bounds;
        return near(a, min, tol) && near(b, max, tol) && Math.abs(rep.measureVolume(solid) - volume) <= Math.max(1e-3, volume * 1e-4);
      });
      if (index >= 0) {
        const rest = solids.filter((_, i) => i !== index).map((solid) => solid.clone());
        return rest.length === 1 ? rest[0] : rep.makeCompound(rest);
      }
    }
  } catch {
    /* si algo falla, corte normal */
  }
  return whole.cut(body.clone());
}
