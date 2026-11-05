// Operaciones puras sobre entidades de boceto.
const shift = (value, delta) => (typeof value === 'number' ? Math.round((value + delta) * 1000) / 1000 : `(${value}) + ${delta}`);

// Copia de la entidad (sin id) desplazada dx, dy; las coordenadas con expresiones se conservan como expresión.
export function offsetEntity(entity, dx, dy) {
  const { id, ...rest } = entity;
  if (rest.t === 'poly') return { ...rest, pts: rest.pts.map((point) => ({ ...point, x: shift(point.x, dx), y: shift(point.y, dy) })) };
  return { ...rest, x: shift(rest.x, dx), y: shift(rest.y, dy) };
}
