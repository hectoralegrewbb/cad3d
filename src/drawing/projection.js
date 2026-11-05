// Vistas ortogonales (proyección del primer diedro, IRAM/ISO): geometría 2D de cada vista en coordenadas de papel (v hacia arriba).

export const viewKinds = ['front', 'top', 'left', 'right', 'back', 'bottom', 'iso'];
export const viewLabels = { front: 'Frente', top: 'Planta', left: 'Lateral izquierda', right: 'Lateral derecha', back: 'Posterior', bottom: 'Inferior', iso: 'Isométrica', section: 'Corte' };

// Vista isométrica: observador adelante (-Y), a la derecha (+X) y arriba (+Z).
const unit = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const isoToViewer = unit([1, -1, 1]);
const isoRight = unit(cross3([0, 0, 1], isoToViewer));
const isoUp = cross3(isoToViewer, isoRight);

// Vista base de cada plano de corte: 'x' mira desde -X (queda x >= offset), 'y' desde -Y (y >= offset), 'z' desde +Z (z <= offset).
export const sectionBase = { x: 'left', y: 'front', z: 'top' };

// Nombre de la proyección en el kernel (sus nombres left/right están invertidos respecto de la norma).
const kernelKind = { front: 'front', back: 'back', top: 'top', bottom: 'bottom', left: 'right', right: 'left' };

// Punto 3D -> coordenadas de papel de cada vista (observador mirando la pieza).
export function toViewPoint(kind, [x, y, z]) {
  switch (kind) {
    case 'front': return [x, z];
    case 'back': return [-x, z];
    case 'top': return [x, y];
    case 'bottom': return [x, -y];
    case 'left': return [-y, z]; // observador en -X
    case 'right': return [y, z]; // observador en +X
    case 'iso': return [x * isoRight[0] + y * isoRight[1] + z * isoRight[2], x * isoUp[0] + y * isoUp[1] + z * isoUp[2]];
    default: throw new Error(`Vista desconocida: ${kind}`);
  }
}

// Dirección de mirada (de la cámara hacia la pieza) de cada vista, para saber qué ejes se ven de frente.
export const viewDirection = { front: [0, 1, 0], back: [0, -1, 0], top: [0, 0, -1], bottom: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0], iso: isoToViewer.map((c) => -c) };

// Convierte una coordenada del SVG del kernel a papel: en vistas laterales/frente se invierte la y; planta/inferior no.
const flipsY = (kind) => kind !== 'top' && kind !== 'bottom';

function arcPoints(x0, y0, rx, ry, rotation, large, sweep, x1, y1) {
  if (rx === 0 || ry === 0) return [[x1, y1]];
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  let rxa = Math.abs(rx);
  let rya = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lambda > 1) {
    rxa *= Math.sqrt(lambda);
    rya *= Math.sqrt(lambda);
  }
  const numerator = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const denominator = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  const coefficient = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rxa * y1p) / rya;
  const cyp = (-coefficient * rya * x1p) / rxa;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya);
  let delta = angle((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 48)));
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = theta1 + (delta * i) / steps;
    points.push([cosPhi * rxa * Math.cos(t) - sinPhi * rya * Math.sin(t) + cx, sinPhi * rxa * Math.cos(t) + cosPhi * rya * Math.sin(t) + cy]);
  }
  return points;
}

// "M x y L x y A rx ry rot large sweep x y Z" -> lista de polilíneas [[x,y]...].
export function parsePath(pathData) {
  const tokens = pathData.match(/[MLAZ]|-?\d+\.?\d*(?:e-?\d+)?/gi) ?? [];
  const polylines = [];
  let current = null;
  let start = null;
  let index = 0;
  const take = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (command === 'M') {
      const x = take();
      const y = take();
      current = [[x, y]];
      start = [x, y];
      polylines.push(current);
    } else if (command === 'L') {
      current.push([take(), take()]);
    } else if (command === 'A') {
      const [rx, ry, rot, large, sweep, x, y] = [take(), take(), take(), take(), take(), take(), take()];
      const last = current[current.length - 1];
      current.push(...arcPoints(last[0], last[1], rx, ry, rot, Boolean(large), Boolean(sweep), x, y));
    } else if (command === 'Z') {
      if (current && start) current.push([...start]);
    }
  }
  return polylines.filter((polyline) => polyline.length >= 2);
}

const bboxOf = (polylines) => {
  const points = polylines.flat();
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY };
};

// Proyección con eliminación de líneas ocultas (HLR) sin las aristas "suaves" (empalmes tangentes entre caras, p. ej. el lado plano de
// una placa que muere tangente en un cubo): la norma no las dibuja y parecen cortes en el material. Quedan aristas vivas y contornos.
function sampleEdge(edge) {
  const steps = edge.geomType === 'LINE' ? 1 : Math.max(24, Math.ceil(edge.length * 2));
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = edge.pointAt(i / steps);
    points.push([p.x, p.y]);
    p.delete?.();
  }
  return points;
}

// Une las polilíneas que comparten extremos en cadenas (el filtro de esquinas necesita recorridos continuos, no aristas sueltas).
function stitch(polylines, tolerance = 1e-4) {
  const close = (a, b) => Math.abs(a[0] - b[0]) < tolerance && Math.abs(a[1] - b[1]) < tolerance;
  const pool = polylines.map((line) => [...line]);
  const chains = [];
  while (pool.length) {
    let chain = pool.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const other = pool[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        if (close(tail, other[0])) chain = [...chain, ...other.slice(1)];
        else if (close(tail, other[other.length - 1])) chain = [...chain, ...[...other].reverse().slice(1)];
        else if (close(head, other[other.length - 1])) chain = [...other, ...chain.slice(1)];
        else if (close(head, other[0])) chain = [...[...other].reverse(), ...chain.slice(1)];
        else continue;
        pool.splice(i, 1);
        grew = true;
      }
    }
    chains.push(chain);
  }
  return chains;
}

function projectEdges(rep, shape, kind) {
  const oc = rep.getOC();
  const camera = kind === 'iso' ? new rep.ProjectionCamera([0, 0, 0], isoToViewer, isoRight) : rep.lookFromPlane(kernelKind[kind]);
  // Marca como continuas (G1) las aristas entre caras tangentes: HLR las separa como "suaves" y no las dibujamos.
  try {
    oc.BRepLib.EncodeRegularity(shape.wrapped);
  } catch {
    /* sin regularidad: se dibujan todas las aristas vivas */
  }
  const algo = new oc.HLRBRep_Algo();
  algo.Add(shape.wrapped, 0);
  const projector = new oc.HLRAlgo_Projector(camera.wrapped);
  algo.Projector(projector);
  algo.Update();
  algo.Hide();
  const shapes = new oc.HLRBRep_HLRToShape(algo);
  const edgesOf = (compound) => (compound.IsNull() ? [] : rep.cast(compound).edges);
  const visible = [...edgesOf(shapes.VCompound()), ...edgesOf(shapes.OutLineVCompound())];
  const hidden = [...edgesOf(shapes.HCompound()), ...edgesOf(shapes.OutLineHCompound())];
  const sign = kind === 'top' || kind === 'bottom' ? -1 : 1;
  const convert = (edges) => edges.map((edge) => sampleEdge(edge).map(([x, y]) => [x, sign * y]));
  const result = { visible: stitch(convert(visible)), hidden: stitch(convert(hidden)) };
  [algo, projector, shapes].forEach((item) => item.delete?.());
  return result;
}

export function projectView(rep, shape, kind) {
  let projected;
  try {
    projected = projectEdges(rep, shape, kind);
  } catch {
    projected = null;
  }
  if (projected && (projected.visible.length || projected.hidden.length)) return { kind, ...projected, bbox: bboxOf(projected.visible.length ? projected.visible : projected.hidden) };
  return projectViewLegacy(rep, shape, kind);
}

function projectViewLegacy(rep, shape, kind) {
  const camera = kind === 'iso' ? new rep.ProjectionCamera([0, 0, 0], isoToViewer, isoRight) : kernelKind[kind];
  const projection = rep.drawProjection(shape, camera);
  const sign = flipsY(kind) ? -1 : 1;
  const convert = (drawing) =>
    drawing
      .toSVGPaths()
      .flat()
      .flatMap((path) => parsePath(path))
      .map((polyline) => polyline.map(([x, y]) => [x, sign * y]));
  const visible = convert(projection.visible);
  const hidden = convert(projection.hidden);
  projection.visible.delete?.();
  projection.hidden.delete?.();
  return { kind, visible, hidden, bbox: bboxOf(visible.length ? visible : hidden) };
}
