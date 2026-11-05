// DXF R12 (ASCII) para enviar a talleres: líneas, círculos y textos por capa. Coordenadas en mm, Y hacia arriba.
const layers = { visible: { name: 'CONTORNO', color: 7 }, hidden: { name: 'OCULTAS', color: 8 }, axes: { name: 'EJES', color: 1 }, dims: { name: 'COTAS', color: 3 }, hatch: { name: 'RAYADO', color: 5 }, text: { name: 'TEXTO', color: 7 }, frame: { name: 'MARCO', color: 7 }, block: { name: 'CAJETIN', color: 7 } };

export function primitivesToDxf(sheet, primitives) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(Object.keys(layers).length)];
  Object.values(layers).forEach((layer) => out.push('0', 'LAYER', '2', layer.name, '70', '0', '62', String(layer.color), '6', 'CONTINUOUS'));
  out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  const y = (value) => sheet.height - value; // hoja (y abajo) -> DXF (y arriba)
  const f = (value) => (Math.round(value * 10000) / 10000).toString();
  const lineEntity = (layer, x1, y1, x2, y2) => out.push('0', 'LINE', '8', layer, '10', f(x1), '20', f(y(y1)), '30', '0', '11', f(x2), '21', f(y(y2)), '31', '0');
  primitives.forEach((p) => {
    const layer = layers[p.layer]?.name ?? '0';
    if (p.k === 'line') lineEntity(layer, p.x1, p.y1, p.x2, p.y2);
    else if (p.k === 'poly') for (let i = 0; i < p.points.length - 1; i += 1) lineEntity(layer, p.points[i][0], p.points[i][1], p.points[i + 1][0], p.points[i + 1][1]);
    else if (p.k === 'rect') [[p.x, p.y, p.x + p.w, p.y], [p.x + p.w, p.y, p.x + p.w, p.y + p.h], [p.x + p.w, p.y + p.h, p.x, p.y + p.h], [p.x, p.y + p.h, p.x, p.y]].forEach(([a, b, c, d]) => p.layer !== 'paper' && lineEntity(layer, a, b, c, d));
    else if (p.k === 'circle') out.push('0', 'CIRCLE', '8', layer, '10', f(p.x), '20', f(y(p.y)), '30', '0', '40', f(p.r));
    else if (p.k === 'arrow') for (let i = 0; i < 3; i += 1) lineEntity(layer, p.points[i][0], p.points[i][1], p.points[(i + 1) % 3][0], p.points[(i + 1) % 3][1]);
    else if (p.k === 'text') out.push('0', 'TEXT', '8', layer, '10', f(p.x), '20', f(y(p.y)), '30', '0', '40', f(p.size), '1', p.text, '50', f(-(p.angle ?? 0)), ...(p.anchor === 'middle' ? ['72', '1', '11', f(p.x), '21', f(y(p.y)), '31', '0'] : []));
  });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
