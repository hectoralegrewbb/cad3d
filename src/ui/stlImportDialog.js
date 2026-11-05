import { button, checkInput, el, field, selectInput, textInput } from './dom.js';
import { encodeMesh } from '../core/meshCodec.js';
import { meshVolume, simplifyMesh } from '../core/meshSimplify.js';
import { maxStlTriangles } from '../io/stlReader.js';

// Diálogo de importación de STL: unidades/escala, ubicación y cómo tratar la malla según su tamaño:
//  · Sólido (B-Rep): cada triángulo pasa a ser una cara cosida; sirve para cortar, unir, exportar y planos, pero tarda ~0,7 s por cada 1000 triángulos.
//  · Reducir y convertir: simplifica la malla (colapso de aristas con métrica cuádrica) al objetivo elegido y luego la convierte en sólido.
//  · Solo malla: se usa tal cual en la vista y la simulación (partículas, aire); sin límite de triángulos, sin cortes ni planos.
// `onCreate({ name, file, mesh, scale, move, meshOnly, info })` recibe la malla ya codificada para guardarla en la operación.
const unitOptions = [['1', 'Milímetros (mm)'], ['10', 'Centímetros (cm)'], ['1000', 'Metros (m)'], ['25.4', 'Pulgadas (in)']];
const targetPresets = [3000, 5000, 10000, 15000, 20000];

const num = (text, fallback) => {
  const value = Number(String(text).replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const round = (value) => Math.round(value * 100) / 100;
const seconds = (triangles) => Math.max(1, Math.round(triangles * 0.0012)); // orden de magnitud: depende de la PC (la barra de progreso afina el tiempo restante al correr)

export function openStlImportDialog(stl, { fileName, onCreate }) {
  const tooBig = stl.triangleCount > maxStlTriangles;
  const state = { scale: 1, toOrigin: false, mode: tooBig ? 'reduce' : 'solid', target: Math.min(15000, Math.max(500, Math.round(stl.triangleCount * 0.35))), busy: null, progress: 0, phase: '' };
  const overlay = el('div', { class: 'modal-overlay' });
  const body = el('div', { class: 'modal import-dialog' });
  overlay.append(body);
  const close = () => overlay.remove();

  const needsClosed = () => state.mode !== 'mesh';

  const finish = (mesh, extra = {}) => {
    const { min, max } = stl.bounds;
    const move = state.toOrigin ? [-(min[0] + max[0]) / 2 * state.scale, -(min[1] + max[1]) / 2 * state.scale, -min[2] * state.scale].map((value) => Math.round(value * 1000) / 1000) : [0, 0, 0];
    onCreate({ name: fileName.replace(/\.stl$/i, ''), file: fileName, mesh: encodeMesh(mesh), scale: state.scale, move, meshOnly: state.mode === 'mesh', triangles: mesh.triangles.length / 3, ...extra });
    close();
  };

  async function run() {
    if (state.mode === 'mesh' || state.mode === 'solid') { finish(stl); return; }
    const signal = { cancelled: false };
    state.busy = signal;
    state.progress = 0;
    state.phase = 'Simplificando la malla…';
    render();
    try {
      const volumeBefore = meshVolume(stl.vertices, stl.triangles);
      const result = await simplifyMesh(stl, state.target, { signal, onProgress: (p) => { state.progress = p; updateBar(); } });
      const volumeAfter = meshVolume(result.vertices, result.triangles);
      const error = Math.round(result.maxError * state.scale * 1000) / 1000;
      const dv = volumeBefore > 0 ? Math.abs(volumeAfter - volumeBefore) / volumeBefore * 100 : 0;
      finish(result, { reduced: { from: result.before, to: result.after, errorMm: error, volumePct: Math.round(dv * 100) / 100, reached: result.reached } });
    } catch (error) {
      state.busy = null;
      state.phase = error.message === 'Cancelado' ? '' : `Error: ${error.message}`;
      render();
    }
  }

  let bar = null;
  let barLabel = null;
  function updateBar() {
    if (bar) bar.style.width = `${Math.round(state.progress * 100)}%`;
    if (barLabel) barLabel.textContent = `${state.phase} ${Math.round(state.progress * 100)} %`;
  }

  const render = () => {
    const size = stl.bounds.size.map((value) => round(value * state.scale));
    const closedProblem = needsClosed() && stl.openEdges > 0;
    const targetTris = state.mode === 'reduce' ? Math.min(state.target, stl.triangleCount) : stl.triangleCount;
    const warnings = [];
    if (closedProblem) warnings.push(`La malla no está cerrada (${stl.openEdges} arista(s) abiertas): no se puede convertir en sólido. Repará el STL en el CAD o usá «Solo malla».`);
    if (state.mode === 'solid' && tooBig) warnings.push(`Tiene ${stl.triangleCount} triángulos y el sólido completo admite hasta ${maxStlTriangles}: elegí «Reducir» o «Solo malla».`);
    const notes = [];
    if (stl.multiEdges > 0 && needsClosed()) notes.push(`${stl.multiEdges} arista(s) donde se tocan cuerpos o láminas: se separan automáticamente (desplazamiento de micras).`);
    if (stl.degenerate > 0) notes.push(`${stl.degenerate} triángulo(s) degenerados descartados.`);
    const blocked = closedProblem || (state.mode === 'solid' && tooBig);

    const option = (id, title, text, disabled = false) => el('label', { class: `mode-option${state.mode === id ? ' on' : ''}${disabled ? ' off' : ''}` },
      el('input', { type: 'radio', name: 'stlmode', checked: state.mode === id, disabled, onChange: () => { state.mode = id; render(); } }),
      el('span', {}, el('b', { text: title }), el('br'), el('span', { class: 'muted', text: text })));

    const reduceRow = state.mode === 'reduce' ? el('div', { class: 'row-wrap' },
      el('label', { text: 'Triángulos objetivo' }),
      el('input', { type: 'number', min: 200, max: stl.triangleCount, step: 500, value: String(state.target), onChange: (e) => { state.target = Math.max(200, Math.min(stl.triangleCount, Math.round(Number(e.target.value) || state.target))); render(); } }),
      ...targetPresets.filter((p) => p < stl.triangleCount).map((p) => button(`${p / 1000}k`, () => { state.target = p; render(); }, { active: state.target === p })),
      el('p', { class: 'muted', style: 'flex-basis:100%;margin:2px 0', text: `${stl.triangleCount} → ${targetTris} triángulos (${Math.round((targetTris / stl.triangleCount) * 100)} %). Convertirlo en sólido tardaría del orden de ${seconds(targetTris)} s (sin reducir: ~${seconds(stl.triangleCount)} s; depende de tu PC). Al terminar se informa el cambio de volumen y el desvío típico.` })) : null;

    const progress = state.busy ? el('div', {},
      el('div', { class: 'progress-track' }, (bar = el('div', { class: 'progress-fill' }))),
      (barLabel = el('p', { class: 'muted', text: '' }))) : null;
    if (!state.busy) { bar = null; barLabel = null; }

    body.replaceChildren(...[
      el('h3', { text: `Importar STL: ${fileName}` }),
      el('p', { class: 'muted', text: `${stl.triangleCount} triángulos · ${stl.vertexCount} vértices · el STL no guarda unidades: elegí las del archivo` }),
      field('Unidades del archivo', selectInput(unitOptions, unitOptions.some(([value]) => Number(value) === state.scale) ? String(state.scale) : '', (value) => { state.scale = num(value, state.scale); render(); })),
      field('Escala (× a mm)', textInput(String(state.scale), (value) => { state.scale = num(value, state.scale); render(); })),
      checkInput(state.toOrigin, (on) => { state.toOrigin = on; render(); }, 'Llevar al origen (centra X/Y y apoya en Z = 0)'),
      el('p', { class: 'hint-block', text: `Tamaño: ${size.join(' × ')} mm` }),
      el('h4', { text: '¿Cómo cargarlo?' }),
      option('reduce', 'Reducir y convertir en sólido', 'Simplifica la malla al objetivo y la convierte en sólido (se puede cortar, unir, exportar y hacer planos).', stl.triangleCount <= 500),
      reduceRow,
      option('mesh', 'Cargar completo (solo malla)', `Usa los ${stl.triangleCount} triángulos tal cual: sin límite, carga casi instantánea. Sirve para ver y simular (partículas, aire); admite conjuntos y STL/3MF; cortes, STEP y planos requieren B-Rep.`),
      option('solid', 'Sólido completo sin reducir', tooBig ? `Solo hasta ${maxStlTriangles} triángulos (este tiene ${stl.triangleCount}).` : `Convierte los ${stl.triangleCount} triángulos en sólido (~${seconds(stl.triangleCount)} s).`, tooBig),
      ...warnings.map((text) => el('p', { class: 'err-block', text })),
      ...notes.map((text) => el('p', { class: 'muted', text })),
      progress,
      state.phase && !state.busy ? el('p', { class: 'err-block', text: state.phase }) : null,
      el('div', { class: 'row-wrap' },
        state.busy
          ? button('Cancelar simplificación', () => { state.busy.cancelled = true; }, { cls: 'danger' })
          : button(state.mode === 'reduce' ? 'Reducir e importar' : 'Importar', () => { if (!blocked) run(); }, { active: !blocked, title: blocked ? 'Corregí lo marcado en rojo' : undefined }),
        state.busy ? null : button('Cancelar', close)),
    ].filter(Boolean));
    updateBar();
  };
  render();
  overlay.addEventListener('pointerdown', (event) => event.target === overlay && !state.busy && close());
  document.body.append(overlay);
  return close;
}
