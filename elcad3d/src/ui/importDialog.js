import { button, checkInput, el, field, section, selectInput, textInput } from './dom.js';
import { planeLabels } from '../core/partModel.js';
import { profilesFrom } from '../io/cadImport.js';
import { arcMidpoint } from '../kernel/geometry2d.js';

// Diálogo de importación 2D (DXF/DWG): capas, escala, plano y vista previa de los contornos que se van a crear.
// `onCreate({ entities, plane, name })` recibe las entidades ya escaladas (y centradas si se pidió).
const num = (text, fallback) => {
  const value = Number(String(text).replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// Puntos de un contorno poly (con arcos muestreados) para dibujarlo en la vista previa.
function polyPoints(entity) {
  const out = [];
  const pts = entity.pts;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    out.push([p.x, p.y]);
    if (p.bulge) {
      const theta = 4 * Math.atan(p.bulge);
      const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
      const mid = arcMidpoint(p, q, p.bulge);
      // Arco por tres puntos → centro y barrido.
      const [ax, ay, bx, by, cx, cy] = [p.x, p.y, mid.x, mid.y, q.x, q.y];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-12) return;
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      const r = Math.hypot(ax - ux, ay - uy);
      const a0 = Math.atan2(ay - uy, ax - ux);
      for (let k = 1; k < steps; k += 1) {
        const a = a0 + (theta * k) / steps;
        out.push([ux + r * Math.cos(a), uy + r * Math.sin(a)]);
      }
    }
  });
  return out;
}

function previewSvg(entities) {
  const paths = [];
  entities.forEach((entity) => {
    if (entity.t === 'poly') paths.push({ points: [...polyPoints(entity), [entity.pts[0].x, entity.pts[0].y]] });
    else if (entity.t === 'circle') paths.push({ points: Array.from({ length: 49 }, (_, i) => [entity.x + (entity.d / 2) * Math.cos((i / 48) * 2 * Math.PI), entity.y + (entity.d / 2) * Math.sin((i / 48) * 2 * Math.PI)]) });
    else if (entity.t === 'ellipse') {
      const a = (entity.angle * Math.PI) / 180;
      paths.push({ points: Array.from({ length: 49 }, (_, i) => {
        const u = (entity.w / 2) * Math.cos((i / 48) * 2 * Math.PI);
        const v = (entity.h / 2) * Math.sin((i / 48) * 2 * Math.PI);
        return [entity.x + u * Math.cos(a) - v * Math.sin(a), entity.y + u * Math.sin(a) + v * Math.cos(a)];
      }) });
    }
  });
  const all = paths.flatMap((path) => path.points);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'import-preview');
  if (!all.length) return svg;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0, 1e-6) * 0.04;
  svg.setAttribute('viewBox', `${x0 - pad} ${-(y1 + pad)} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`); // Y hacia arriba
  const stroke = Math.max(x1 - x0, y1 - y0) / 350;
  paths.forEach((path) => {
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', path.points.map(([x, y]) => `${x},${-y}`).join(' '));
    line.setAttribute('fill', 'rgba(111,183,196,0.12)');
    line.setAttribute('stroke', '#6fb7c4');
    line.setAttribute('stroke-width', String(stroke));
    svg.append(line);
  });
  return svg;
}

const shifted = (entity, dx, dy) => {
  if (entity.t === 'poly') return { ...entity, pts: entity.pts.map((p) => ({ ...p, x: Math.round((p.x - dx) * 1000) / 1000, y: Math.round((p.y - dy) * 1000) / 1000 })) };
  return { ...entity, x: Math.round((entity.x - dx) * 1000) / 1000, y: Math.round((entity.y - dy) * 1000) / 1000 };
};

export function boundsOf(entities) {
  const points = entities.flatMap((entity) => (entity.t === 'poly' ? polyPoints(entity) : entity.t === 'circle' ? [[entity.x - entity.d / 2, entity.y - entity.d / 2], [entity.x + entity.d / 2, entity.y + entity.d / 2]] : [[entity.x - Math.max(entity.w, entity.h) / 2, entity.y - Math.max(entity.w, entity.h) / 2], [entity.x + Math.max(entity.w, entity.h) / 2, entity.y + Math.max(entity.w, entity.h) / 2]]));
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

export function openImportDialog(cad, { fileName, onCreate }) {
  const layerCount = Object.fromEntries(cad.layers.map((layer) => [layer, cad.entities.filter((entity) => entity.layer === layer).length]));
  const state = { layers: new Set(cad.layers), scale: cad.unitScale, tolerance: 0.01, plane: 'XY', center: true };
  const overlay = el('div', { class: 'modal-overlay' });
  const body = el('div', { class: 'modal import-dialog' });
  overlay.append(body);
  const close = () => overlay.remove();
  const render = () => {
    const result = profilesFrom(cad, { layers: [...state.layers], scale: state.scale, tolerance: state.tolerance });
    const bounds = boundsOf(result.entities);
    const size = bounds ? `${Math.round((bounds.max[0] - bounds.min[0]) * 100) / 100} × ${Math.round((bounds.max[1] - bounds.min[1]) * 100) / 100} mm` : '—';
    const skipped = Object.entries(cad.skipped ?? {}).map(([type, count]) => `${type} ×${count}`).join(' · ');
    body.replaceChildren(...[
      el('h3', { text: `Importar ${cad.format}: ${fileName}` }),
      el('p', { class: 'muted', text: `${cad.entities.length} entidades 2D · unidades del archivo: ${cad.units ? `código ${cad.units} (×${cad.unitScale} a mm)` : 'sin definir (se asume mm)'}` }),
      section('Capas a importar'),
      el('div', { class: 'import-layers' }, cad.layers.map((layer) => checkInput(state.layers.has(layer), (on) => { on ? state.layers.add(layer) : state.layers.delete(layer); render(); }, `${layer} (${layerCount[layer]})`))),
      el('div', { class: 'row-wrap' }, button('Todas', () => { state.layers = new Set(cad.layers); render(); }), button('Ninguna', () => { state.layers = new Set(); render(); })),
      field('Escala (× a mm)', textInput(String(state.scale), (value) => { state.scale = num(value, state.scale); render(); })),
      field('Tolerancia de cierre (mm)', textInput(String(state.tolerance), (value) => { state.tolerance = num(value, state.tolerance); render(); })),
      field('Plano del boceto', selectInput(Object.entries(planeLabels), state.plane, (value) => { state.plane = value; })),
      checkInput(state.center, (on) => { state.center = on; render(); }, 'Centrar en el origen'),
      previewSvg(result.entities),
      el('p', { class: result.entities.length ? 'hint-block' : 'err-block', text: `${result.entities.length} contorno(s) cerrado(s) · tamaño ${size}${result.openSegments ? ` · ${result.openSegments} tramo(s) sin cerrar (se ignoran: subí la tolerancia o revisá el dibujo)` : ''}` }),
      skipped ? el('p', { class: 'muted', text: `No se importan: ${skipped}` }) : null,
      el('div', { class: 'row-wrap' },
        button('Crear boceto', () => {
          if (!result.entities.length) return;
          const centre = state.center && bounds ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2] : [0, 0];
          onCreate({ entities: result.entities.map((entity) => shifted(entity, centre[0], centre[1])), plane: state.plane, name: fileName });
          close();
        }, { active: true }),
        button('Cancelar', close)),
    ].filter(Boolean));
  };
  render();
  overlay.addEventListener('pointerdown', (event) => event.target === overlay && close());
  document.body.append(overlay);
  return close;
}
