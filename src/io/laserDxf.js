// DXF para corte láser: geometría 1:1 en mm, sin cotas ni cajetín, solo capa(s) de corte.
// Entrada: { circles: [{ layer, x, y, r }], polylines: [{ layer, closed, vertices: [{ x, y, bulge }] }] } (bulge = tan(ángulo/4), + antihorario).
// - 'r2000': LWPOLYLINE cerrada con arcos (un contorno por pieza: el láser lo toma sin unir segmentos).
// - 'r12': LINE + ARC + CIRCLE sueltos (lo lee hasta el software láser más viejo, que une los segmentos solo).
const LAYER_COLORS = { CORTE: 1, GRABADO: 5 };
const f = (value) => (Math.round(value * 10000) / 10000).toString();

// Arco de un tramo p→q con bulge b: centro, radio y ángulos (grados, antihorario de `start` a `end`).
export function bulgeArc(p, q, bulge) {
  const chord = Math.hypot(q.x - p.x, q.y - p.y);
  const included = 4 * Math.atan(bulge); // con signo
  const radius = chord / (2 * Math.sin(Math.abs(included) / 2));
  const mid = [(p.x + q.x) / 2, (p.y + q.y) / 2];
  const left = [-(q.y - p.y) / chord, (q.x - p.x) / chord];
  const offset = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge)); // distancia del centro a la cuerda, + hacia la izquierda
  const center = { x: mid[0] + left[0] * offset, y: mid[1] + left[1] * offset };
  const angle = (point) => (((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI) % 360 + 360) % 360;
  return bulge > 0 ? { center, radius, start: angle(p), end: angle(q) } : { center, radius, start: angle(q), end: angle(p) };
}

function header(layers, version) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', version, '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC'];
  out.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0', '0', 'ENDTAB');
  out.push('0', 'TABLE', '2', 'LAYER', '70', String(layers.length));
  layers.forEach((name) => out.push('0', 'LAYER', '2', name, '70', '0', '62', String(LAYER_COLORS[name] ?? 7), '6', 'CONTINUOUS'));
  out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  return out;
}

export function laserEntitiesToDxf({ circles = [], polylines = [] }, { format = 'r2000' } = {}) {
  const layers = [...new Set([...circles, ...polylines].map((item) => item.layer ?? 'CORTE'))];
  const out = header(layers, format === 'r12' ? 'AC1009' : 'AC1015');
  circles.forEach((c) => out.push('0', 'CIRCLE', '8', c.layer ?? 'CORTE', '10', f(c.x), '20', f(c.y), '30', '0', '40', f(c.r)));
  polylines.forEach((poly) => {
    const layer = poly.layer ?? 'CORTE';
    const pts = poly.vertices;
    if (format === 'r2000') {
      out.push('0', 'LWPOLYLINE', '8', layer, '100', 'AcDbEntity', '100', 'AcDbPolyline', '90', String(pts.length), '70', poly.closed ? '1' : '0');
      pts.forEach((v) => out.push('10', f(v.x), '20', f(v.y), ...(v.bulge ? ['42', String(Math.round(v.bulge * 1e6) / 1e6)] : [])));
      return;
    }
    const count = poly.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i += 1) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if (p.bulge) {
        const arc = bulgeArc(p, q, p.bulge);
        out.push('0', 'ARC', '8', layer, '10', f(arc.center.x), '20', f(arc.center.y), '30', '0', '40', f(arc.radius), '50', f(arc.start), '51', f(arc.end));
      } else out.push('0', 'LINE', '8', layer, '10', f(p.x), '20', f(p.y), '30', '0', '11', f(q.x), '21', f(q.y), '31', '0');
    }
  });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
