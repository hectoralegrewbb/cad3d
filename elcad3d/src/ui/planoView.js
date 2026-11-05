import { toSheet } from '../drawing/sheet.js';
import { dimensionPrimitives } from '../drawing/dimensions.js';
import { primitivesToSvg } from '../drawing/svgWriter.js';

// Vista del plano (SVG): zoom/pan, selección de cotas y herramientas de cotado manual.
export class PlanoView {
  constructor(container, handlers) {
    this.container = container;
    this.h = handlers;
    this.tool = 'select';
    this.result = null;
    this.selectedDim = null;
    this.draft = null;
    this.viewBox = null;
    this.pan = null;
    this.spaceDown = false;
    container.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    container.addEventListener('pointerdown', (event) => this.down(event));
    container.addEventListener('pointermove', (event) => this.move(event));
    container.addEventListener('pointerup', (event) => this.up(event));
    window.addEventListener('keydown', (event) => this.key(event));
    window.addEventListener('keyup', (event) => event.code === 'Space' && (this.spaceDown = false));
  }

  get svg() {
    return this.container.querySelector('svg');
  }

  setTool(tool) {
    this.tool = tool;
    this.draft = null;
    this.container.style.cursor = tool === 'select' ? 'default' : tool === 'move' ? 'grab' : 'crosshair';
    this.drawOverlay();
  }

  setResult(result) {
    this.result = result;
    const keepBox = this.viewBox;
    this.container.innerHTML = primitivesToSvg(result.sheet, result.primitives, { interactive: true, selectedDim: this.selectedDim });
    this.viewBox = keepBox ?? [0, 0, result.sheet.width, result.sheet.height];
    this.applyViewBox();
    this.drawOverlay();
  }

  fit() {
    if (!this.result) return;
    this.viewBox = null;
    const { width, height } = this.result.sheet;
    this.viewBox = [-4, -4, width + 8, height + 8];
    this.applyViewBox();
  }

  applyViewBox() {
    const svg = this.svg;
    if (!svg || !this.viewBox) return;
    // Mantiene la proporción del contenedor.
    const rect = this.container.getBoundingClientRect();
    const [x, y, w, h] = this.viewBox;
    const ratio = rect.width / rect.height;
    const boxRatio = w / h;
    let [vx, vy, vw, vh] = [x, y, w, h];
    if (boxRatio < ratio) {
      vw = h * ratio;
      vx = x - (vw - w) / 2;
    } else {
      vh = w / ratio;
      vy = y - (vh - h) / 2;
    }
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }

  toSheetPoint(event) {
    const svg = this.svg;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  wheel(event) {
    if (!this.svg) return;
    event.preventDefault();
    const [px, py] = this.toSheetPoint(event);
    const factor = event.deltaY < 0 ? 1 / 1.15 : 1.15;
    const [x, y, w, h] = this.currentBox();
    this.viewBox = [px - (px - x) * factor, py - (py - y) * factor, w * factor, h * factor];
    this.applyViewBox();
  }

  currentBox() {
    return this.svg.getAttribute('viewBox').split(' ').map(Number);
  }

  // --- candidatos de cota (puntos notables de cada vista, en coordenadas de hoja) ---
  placementOf(viewId) {
    return this.result.layout.placements.find((placement) => placement.id === viewId);
  }

  candidates() {
    const out = [];
    this.result.viewModels.forEach((view) => {
      const placement = this.placementOf(view.id);
      const push = (point, kind) => out.push({ view: view.id, local: point, sheet: toSheet(placement, point), kind });
      view.corners.forEach((point) => push(point, 'vertex'));
      view.circles.filter((circle) => circle.mode === 'face').forEach((circle) => {
        push(circle.center, 'center');
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => push([circle.center[0] + dx * circle.radius, circle.center[1] + dy * circle.radius], 'quadrant'));
      });
      view.circles.filter((circle) => circle.mode === 'edge').forEach((circle) => {
        push([circle.center[0] + circle.perp[0] * circle.radius, circle.center[1] + circle.perp[1] * circle.radius], 'vertex');
        push([circle.center[0] - circle.perp[0] * circle.radius, circle.center[1] - circle.perp[1] * circle.radius], 'vertex');
      });
    });
    return out;
  }

  nearest(point, radius = 3.5) {
    let best = null;
    this.candidates().forEach((candidate) => {
      const dist = Math.hypot(candidate.sheet[0] - point[0], candidate.sheet[1] - point[1]);
      if (dist < radius && (!best || dist < best.dist)) best = { ...candidate, dist };
    });
    return best;
  }

  // Círculo/arco de una vista más cercano a un punto (para cotas de Ø y R).
  circleAt(point) {
    let best = null;
    this.result.viewModels.forEach((view) => {
      const placement = this.placementOf(view.id);
      view.circles.filter((circle) => circle.mode === 'face').forEach((circle) => {
        const center = toSheet(placement, circle.center);
        const dist = Math.abs(Math.hypot(point[0] - center[0], point[1] - center[1]) - circle.radius * placement.scale);
        if (dist < 3 && (!best || dist < best.dist)) best = { dist, circle, view: view.id, placement };
      });
    });
    return best;
  }

  // Vista cuya zona (con sus cotas) contiene el punto; si hay varias, la más chica.
  viewAt(point) {
    let best = null;
    (this.result?.layout.placements ?? []).forEach((placement) => {
      const { x, y, w, h } = placement.occupied;
      if (point[0] < x || point[0] > x + w || point[1] < y || point[1] > y + h) return;
      if (!best || w * h < best.area) best = { placement, area: w * h };
    });
    return best?.placement ?? null;
  }

  // Paso de ajuste al mover vistas: 1 mm; Shift = 5 mm; Alt = libre.
  snapDelta(delta, event) {
    const step = event.altKey ? 0.01 : event.shiftKey ? 5 : 1;
    return delta.map((value) => Math.round(value / step) * step);
  }

  applyViewDrag(drag) {
    const svg = this.svg;
    if (!svg) return;
    svg.querySelectorAll(`[data-view="${drag.id}"]`).forEach((node) => {
      if (!node.dataset.orig) node.dataset.orig = node.getAttribute('transform') ?? '';
      node.setAttribute('transform', `translate(${drag.delta[0]} ${drag.delta[1]}) ${node.dataset.orig}`.trim());
    });
    svg.querySelector('#overlay')?.remove();
  }

  toLocal(placement, [x, y]) {
    return [(x - placement.ox) / placement.scale, (placement.oy - y) / placement.scale];
  }

  // --- interacción ---
  down(event) {
    if (!this.result) return;
    if (event.button === 1 || event.button === 2 || this.spaceDown) {
      this.pan = { box: this.currentBox(), start: this.toSheetPoint(event), client: [event.clientX, event.clientY] };
      this.container.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const point = this.toSheetPoint(event);
    if (this.tool === 'move') {
      const placement = this.viewAt(point);
      this.selectedDim = null;
      this.h.onSelectDim(null);
      if (placement) {
        this.viewDrag = { id: placement.id, start: point, delta: [0, 0] };
        this.container.style.cursor = 'grabbing';
        this.container.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (this.tool === 'select') {
      const target = event.target.closest?.('[data-dim]');
      this.selectedDim = target?.getAttribute('data-dim') ?? null;
      this.h.onSelectDim(this.selectedDim);
      // Arrastrar una cota seleccionada para moverla (línea de cota o rótulo).
      const dim = this.selectedDim && this.result.dims.find((item) => item.id === this.selectedDim);
      if (dim) {
        this.dimDrag = { dim, start: point, patch: null };
        this.container.setPointerCapture(event.pointerId);
      } else if (event.altKey) {
        // Alt + arrastrar mueve la vista sin cambiar de herramienta.
        const placement = this.viewAt(point);
        if (placement) {
          this.viewDrag = { id: placement.id, start: point, delta: [0, 0] };
          this.container.setPointerCapture(event.pointerId);
        }
      }
      return;
    }
    if (this.tool === 'linear') return this.linearClick(point, event);
    if (this.tool === 'diameter' || this.tool === 'radius') return this.circleClick(point);
  }

  linearClick(point, event) {
    const snap = this.nearest(point);
    const draft = this.draft;
    if (!draft) {
      if (snap) this.draft = { stage: 1, view: snap.view, a: snap.local, sa: snap.sheet };
    } else if (draft.stage === 1) {
      if (snap && snap.view === draft.view) this.draft = { ...draft, stage: 2, b: snap.local, sb: snap.sheet };
    } else {
      const placement = this.placementOf(draft.view);
      const [mu, mv] = this.toLocal(placement, point);
      const midU = (draft.a[0] + draft.b[0]) / 2;
      const midV = (draft.a[1] + draft.b[1]) / 2;
      let dim;
      if (event.shiftKey) {
        const dx = draft.sb[0] - draft.sa[0];
        const dy = draft.sb[1] - draft.sa[1];
        const l = Math.hypot(dx, dy) || 1;
        const offset = ((point[0] - draft.sa[0]) * -dy) / l + ((point[1] - draft.sa[1]) * dx) / l;
        dim = { view: draft.view, type: 'linear', orientation: 'aligned', a: draft.a, b: draft.b, line: Math.round(offset * 10) / 10 };
      } else if (Math.abs(mv - midV) >= Math.abs(mu - midU)) {
        dim = { view: draft.view, type: 'linear', orientation: 'h', a: draft.a, b: draft.b, line: Math.round(mv * 100) / 100 };
      } else {
        dim = { view: draft.view, type: 'linear', orientation: 'v', a: draft.a, b: draft.b, line: Math.round(mu * 100) / 100 };
      }
      this.draft = null;
      this.h.onAddDim(dim);
    }
    this.drawOverlay();
  }

  circleClick(point) {
    if (!this.draft) {
      const hit = this.circleAt(point);
      if (hit) this.draft = { stage: 1, view: hit.view, circle: hit.circle, placement: hit.placement };
    } else {
      const { circle, placement, view } = this.draft;
      const center = toSheet(placement, circle.center);
      const dx = point[0] - center[0];
      const dy = center[1] - point[1];
      const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      const reach = Math.max(6, Math.round(Math.hypot(dx, dy) - circle.radius * placement.scale));
      this.draft = null;
      this.h.onAddDim({ view, type: this.tool, center: [...circle.center], radius: circle.radius, angle, reach, count: 1 });
    }
    this.drawOverlay();
  }

  move(event) {
    if (!this.result) return;
    if (this.pan) {
      const rect = this.container.getBoundingClientRect();
      const [x, y, w, h] = this.pan.box;
      const dx = ((event.clientX - this.pan.client[0]) / rect.width) * w;
      const dy = ((event.clientY - this.pan.client[1]) / rect.height) * h;
      this.viewBox = [x - dx, y - dy, w, h];
      this.applyViewBox();
      return;
    }
    this.hoverPoint = this.toSheetPoint(event);
    if (this.viewDrag) {
      const drag = this.viewDrag;
      drag.delta = this.snapDelta([this.hoverPoint[0] - drag.start[0], this.hoverPoint[1] - drag.start[1]], event);
      this.applyViewDrag(drag);
      return;
    }
    if (this.dimDrag) {
      const drag = this.dimDrag;
      if (!drag.patch && Math.hypot(this.hoverPoint[0] - drag.start[0], this.hoverPoint[1] - drag.start[1]) < 1) return;
      drag.patch = this.patchForDim(drag.dim, this.hoverPoint);
      this.drawDimPreview(drag.dim, drag.patch);
      return;
    }
    this.hoverShift = event.shiftKey;
    this.drawOverlay();
  }

  up() {
    this.pan = null;
    if (this.viewDrag) {
      const { id, delta } = this.viewDrag;
      this.viewDrag = null;
      this.container.style.cursor = this.tool === 'move' ? 'grab' : 'default';
      if (delta[0] !== 0 || delta[1] !== 0) this.h.onMoveView(id, delta);
      return;
    }
    if (!this.dimDrag) return;
    const { dim, patch } = this.dimDrag;
    this.dimDrag = null;
    this.svg?.querySelector('#dimPreview')?.remove();
    if (patch) this.h.onMoveDim(dim, patch);
  }

  // Nueva posición de la cota para el punto del puntero (en hoja).
  patchForDim(dim, point) {
    const placement = this.placementOf(dim.view);
    const round = (value) => Math.round(value * 100) / 100;
    if (dim.type === 'linear') {
      const [mu, mv] = this.toLocal(placement, point);
      if (dim.orientation === 'h') {
        const value = round(mv);
        return dim.direct ? { a: [dim.a[0], value], b: [dim.b[0], value], line: value } : { line: value };
      }
      if (dim.orientation === 'v') {
        const value = round(mu);
        return dim.direct ? { a: [value, dim.a[1]], b: [value, dim.b[1]], line: value } : { line: value };
      }
      const sa = toSheet(placement, dim.a);
      const sb = toSheet(placement, dim.b);
      const dx = sb[0] - sa[0];
      const dy = sb[1] - sa[1];
      const l = Math.hypot(dx, dy) || 1;
      return { line: Math.round((((point[0] - sa[0]) * -dy) / l + ((point[1] - sa[1]) * dx) / l) * 10) / 10 };
    }
    const center = toSheet(placement, dim.center);
    const dx = point[0] - center[0];
    const dy = center[1] - point[1];
    if (dim.type === 'angle') return { arc: Math.max(6, Math.round(Math.hypot(dx, dy))) };
    return { angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI), reach: Math.max(6, Math.round(Math.hypot(dx, dy) - dim.radius * placement.scale)) };
  }

  // Vista previa del movimiento: oculta la cota original y dibuja la nueva posición.
  drawDimPreview(dim, patch) {
    const svg = this.svg;
    if (!svg) return;
    svg.querySelectorAll(`[data-dim="${dim.id}"]`).forEach((node) => (node.style.display = 'none'));
    svg.querySelector('#dimPreview')?.remove();
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.id = 'dimPreview';
    group.setAttribute('pointer-events', 'none');
    const { lines, arrows, texts } = dimensionPrimitives({ ...dim, ...patch }, this.placementOf(dim.view));
    const add = (tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      if (text !== undefined) node.textContent = text;
      group.append(node);
    };
    lines.forEach((l) => add('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, stroke: '#1a73e8', 'stroke-width': 0.35 }));
    arrows.forEach((points) => add('polygon', { points: points.map(([x, y]) => `${x},${y}`).join(' '), fill: '#1a73e8' }));
    texts.forEach((t) => add('text', { x: t.x, y: t.y, 'font-size': t.size, 'text-anchor': t.anchor ?? 'start', fill: '#1a73e8', ...(t.angle ? { transform: `rotate(${t.angle} ${t.x} ${t.y})` } : {}) }, t.text));
    svg.append(group);
  }

  key(event) {
    if (!this.container.offsetParent || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.code === 'Space') {
      this.spaceDown = true;
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      if (this.draft) {
        this.draft = null;
        this.drawOverlay();
      } else if (this.tool !== 'select') {
        this.h.onToolChange('select');
      } else {
        this.selectedDim = null;
        this.h.onSelectDim(null);
      }
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedDim) this.h.onDeleteDim(this.selectedDim);
    const tools = { l: 'linear', d: 'diameter', r: 'radius', v: 'select', m: 'move' };
    if (!event.ctrlKey && !event.metaKey && tools[event.key.toLowerCase()]) this.h.onToolChange(tools[event.key.toLowerCase()]);
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey) this.fit();
  }

  drawOverlay() {
    const svg = this.svg;
    if (!svg) return;
    svg.querySelector('#overlay')?.remove();
    if (this.tool === 'select' || !this.result) return;
    if (this.tool === 'move') return this.drawMoveOverlay();
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.id = 'overlay';
    group.setAttribute('pointer-events', 'none');
    const add = (tag, attrs) => {
      const node = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      group.append(node);
    };
    const marker = (point, color = '#1a73e8') => add('circle', { cx: point[0], cy: point[1], r: 1.1, fill: 'none', stroke: color, 'stroke-width': 0.35 });
    if (this.hoverPoint) {
      if (this.tool === 'linear') {
        const snap = this.nearest(this.hoverPoint);
        if (snap) marker(snap.sheet, '#f59e0b');
      } else {
        const hit = this.circleAt(this.hoverPoint);
        if (hit) {
          const c = toSheet(hit.placement, hit.circle.center);
          add('circle', { cx: c[0], cy: c[1], r: hit.circle.radius * hit.placement.scale, fill: 'none', stroke: '#f59e0b', 'stroke-width': 0.5 });
        }
      }
    }
    if (this.draft?.sa) marker(this.draft.sa);
    if (this.draft?.sb) {
      marker(this.draft.sb);
      add('line', { x1: this.draft.sa[0], y1: this.draft.sa[1], x2: this.draft.sb[0], y2: this.draft.sb[1], stroke: '#1a73e8', 'stroke-width': 0.3, 'stroke-dasharray': '1.5 1' });
    }
    if (this.draft?.circle && this.hoverPoint) {
      const c = toSheet(this.draft.placement, this.draft.circle.center);
      add('line', { x1: c[0], y1: c[1], x2: this.hoverPoint[0], y2: this.hoverPoint[1], stroke: '#1a73e8', 'stroke-width': 0.3, 'stroke-dasharray': '1.5 1' });
    }
    svg.append(group);
  }

  // Herramienta Mover: marca la vista (con sus cotas) bajo el puntero.
  drawMoveOverlay() {
    const svg = this.svg;
    const placement = this.hoverPoint && !this.viewDrag ? this.viewAt(this.hoverPoint) : null;
    if (!svg || !placement) return;
    const { x, y, w, h } = placement.occupied;
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.id = 'overlay';
    group.setAttribute('pointer-events', 'none');
    const rect = document.createElementNS(ns, 'rect');
    Object.entries({ x, y, width: w, height: h, fill: 'rgba(26,115,232,0.06)', stroke: '#1a73e8', 'stroke-width': 0.3, 'stroke-dasharray': '2 1.5' }).forEach(([key, value]) => rect.setAttribute(key, value));
    group.append(rect);
    svg.append(group);
  }

  hint() {
    if (this.tool === 'move') return 'Mover vistas: arrastrá una vista con sus cotas (ajuste 1 mm · Shift 5 mm · Alt libre) · Alt+arrastrar también funciona en Seleccionar';
    if (this.tool === 'linear') return !this.draft ? 'Cota lineal: clic en el primer punto (vértice, centro o cuadrante)' : this.draft.stage === 1 ? 'Clic en el segundo punto' : 'Clic para ubicar la línea de cota (Shift = alineada)';
    if (this.tool === 'diameter' || this.tool === 'radius') return !this.draft ? 'Clic sobre un círculo o arco' : 'Clic para ubicar el texto';
    return 'Clic en una cota para seleccionarla y arrastrarla para moverla · Supr: quitar · L lineal · D diámetro · R radio · F ajustar';
  }
}
