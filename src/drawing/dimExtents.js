// Espacio que necesitan las cotas alrededor de una vista (mm de hoja): permite reservar el lugar al repartir las vistas en la hoja.
const rad = (deg) => (deg * Math.PI) / 180;

export function dimMargins(view, dims, scale, { min = 8, pad = 3 } = {}) {
  const b = view.bbox;
  const margin = { left: 0, right: 0, top: 0, bottom: 0 };
  const midU = (b.minX + b.maxX) / 2;
  const midV = (b.minY + b.maxY) / 2;
  const halfW = (b.width * scale) / 2;
  const halfH = (b.height * scale) / 2;
  dims.forEach((dim) => {
    if (dim.type === 'linear') {
      if (dim.direct) return;
      if (dim.orientation === 'h') {
        margin.bottom = Math.max(margin.bottom, (b.minY - dim.line) * scale);
        margin.top = Math.max(margin.top, (dim.line - b.maxY) * scale);
      } else if (dim.orientation === 'v') {
        margin.left = Math.max(margin.left, (b.minX - dim.line) * scale);
        margin.right = Math.max(margin.right, (dim.line - b.maxX) * scale);
      }
      return;
    }
    if (!dim.center) return;
    if (dim.type === 'angle') {
      const reachOut = ((dim.arc ?? 16) + 8) / 1; // arco + texto (mm de hoja)
      const cx = (dim.center[0] - midU) * scale;
      const cy = (dim.center[1] - midV) * scale;
      margin.right = Math.max(margin.right, cx + reachOut - halfW);
      margin.left = Math.max(margin.left, -cx + reachOut - halfW);
      margin.top = Math.max(margin.top, cy + reachOut - halfH);
      margin.bottom = Math.max(margin.bottom, -cy + reachOut - halfH);
      return;
    }
    const angle = rad(dim.angle ?? 45);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = dim.reach ?? 12;
    const ex = (dim.center[0] + cos * dim.radius - midU) * scale + cos * reach;
    const ey = (dim.center[1] + sin * dim.radius - midV) * scale + sin * reach;
    const textWidth = String(dim.text ?? `Ø${dim.radius * 2}`).length * 1.9 + 3 + (dim.count > 1 ? 6 : 0);
    const exEnd = ex + (cos >= 0 ? 1 : -1) * textWidth;
    margin.right = Math.max(margin.right, Math.max(ex, exEnd) - halfW);
    margin.left = Math.max(margin.left, -Math.min(ex, exEnd) - halfW);
    margin.top = Math.max(margin.top, ey - halfH + 3);
    margin.bottom = Math.max(margin.bottom, -ey - halfH + 3);
  });
  return Object.fromEntries(Object.entries(margin).map(([side, value]) => [side, Math.max(min, value + pad)]));
}
