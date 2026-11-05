// Buffers de arrays tipados dentro de un resultado, para pasarlos al hilo principal sin copiarlos (sin repetidos).
export function collectTransfers(value, found = new Set(), seen = new Set()) {
  if (!value || typeof value !== 'object') return [...found];
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
    return [...found];
  }
  if (value instanceof ArrayBuffer) {
    found.add(value);
    return [...found];
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return [...found];
  if (seen.has(value)) return [...found];
  seen.add(value);
  (Array.isArray(value) ? value : Object.values(value)).forEach((child) => collectTransfers(child, found, seen));
  return [...found];
}
