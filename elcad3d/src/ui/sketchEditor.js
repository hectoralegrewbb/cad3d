import { solveSketchConstraints } from '../core/sketchConstraints.js';
import { entityPolygon, pointInPolygon, resolveEntity } from '../kernel/geometry2d.js';
import { entityDefaults } from '../core/partModel.js';
import { offsetEntity } from '../core/entityOps.js';
import { formatUnit, parseLength, toUnit } from '../core/lengthInput.js';
import { collectGeometry, computeSnap } from './sketchSnap.js';
import { distanceBetween, nearestOnShape, nearestShape } from '../core/sketchDistance.js';
import { button, el } from './dom.js';

const axisLabels = { XY: ['X', 'Y'], XZ: ['X', 'Z'], YZ: ['Y', 'Z'] };
const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const colors = { bg: '#1d222b', grid: '#2a3240', gridMajor: '#364054', axis: '#5a6a85', stroke: '#9fd0ff', fill: 'rgba(77,163,255,0.12)', sel: '#ffb020', dim: '#c9d3e3', bad: '#ff6b6b', axisRev: '#ff9b3d', preview: '#7ee08a', guide: '#c58cff', align: '#5ad1c5', ruler: '#232a36', rulerText: '#9aa7bd', cursor: '#ff6b6b', measure: '#ffd24d', refSketch: 'rgba(120,170,230,0.55)', refSolid: 'rgba(214,160,90,0.6)' };
const markerColors = { edge: '#b0b8c8', vertex: '#ffd24d', center: '#7ee08a', midpoint: '#6fc3ff', quadrant: '#ff9bd0', intersection: '#ff8a5c', origin: '#ffffff' };
export const RULER = 20; // grosor de las reglas (px)
const r3 = (value) => Math.round(value * 1000) / 1000;

// Campos que se piden al tipear el tamaño tras el primer clic, por herramienta.
const typedFields = {
  rect: [{ key: 'w', label: 'Ancho' }, { key: 'h', label: 'Alto' }],
  square: [{ key: 'side', label: 'Lado' }],
  circle: [{ key: 'd', label: 'Ø (o r12)', radius: true }],
  ellipse: [{ key: 'w', label: 'Eje X' }, { key: 'h', label: 'Eje Y' }],
  slot: [{ key: 'length', label: 'Largo' }, { key: 'width', label: 'Ancho' }],
  poly: [{ key: 'length', label: 'Largo' }, { key: 'angle', label: 'Ángulo °', angle: true }],
  guide: [{ key: 'angle', label: 'Ángulo °', angle: true }],
  polygon: [{ key: 'flats', label: 'Entre caras' }, { key: 'corners', label: 'Entre vértices' }, { key: 'n', label: 'Lados', integer: true, fallback: 6 }, { key: 'angle', label: 'Giro °', angle: true }],
};
const toolTitles = { rect: 'Rectángulo', square: 'Cuadrado', circle: 'Círculo', ellipse: 'Elipse', slot: 'Ranura', poly: 'Línea / polilínea', guide: 'Guía auxiliar', polygon: 'Polígono regular', measure: 'Medir', gap: 'Distancia entre objetos' };

// Editor de bocetos 2D sobre canvas: dibujar, mover, borrar, imanes con marcadores, tamaño tipeado, reglas y medición.
export class SketchEditor {
  constructor(canvas, handlers, { inputHost = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = handlers;
    this.inputHost = inputHost;
    this.tool = 'select';
    this.unit = 'mm';
    this.snapOn = true;
    this.distOn = true; // distancias en vivo al dibujar
    this.guidesOn = true;
    this.refSketchesOn = true; // papel cebolla: otros bocetos
    this.refSolidOn = true; // papel cebolla: corte de la pieza
    this.reference = null;
    this.view = { cx: 0, cy: 0, scale: 4 };
    this.sketchId = null;
    this.part = null;
    this.params = {};
    this.selectedEntityId = null;
    this.draft = null;
    this.typed = {};
    this.hover = null;
    this.hoverRaw = null;
    this.snap = null;
    this.drag = null;
    this.pan = null;
    this.spaceDown = false;
    this.revolveAxis = null;
    this.measure = null;
    this.gap = null; // herramienta «Distancia»: { a, b, fixed }
    this.geometryCache = new Map();

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('dblclick', () => this.finishPoly());
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => e.code === 'Space' && (this.spaceDown = false));
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  get active() {
    return this.sketchId !== null;
  }

  open(sketchId, part, params) {
    this.sketchId = sketchId;
    this.selectedEntityId = null;
    this.draft = null;
    this.measure = null;
    this.tool = 'select';
    this.closeTyped();
    this.update(part, params);
    this.resize();
    this.fit();
  }

  close() {
    this.sketchId = null;
    this.draft = null;
    this.closeTyped();
  }

  update(part, params) {
    this.part = part;
    this.params = params;
    this.geometryCache.clear();
    const sketch = this.sketch;
    const revolve = part.features.find((feature) => feature.type === 'revolve' && feature.sketch === this.sketchId);
    this.revolveAxis = revolve ? revolve.axis : null;
    if (sketch && this.selectedEntityId && !sketch.entities.some((entity) => entity.id === this.selectedEntityId)) this.selectedEntityId = null;
    this.render();
  }

  get sketch() {
    const sketch=this.part?.features.find((feature) => feature.id === this.sketchId) ?? null;
    if(!sketch?.constraints?.length)return sketch;
    try { return {...sketch,entities:solveSketchConstraints(sketch.entities.map(e=>resolveEntity(e,this.params)),sketch.constraints,this.params)}; }
    catch { return sketch; }
  }

  setTool(tool) {
    this.tool = tool;
    this.draft = null;
    this.measure = null;
    this.gap = null;
    this.closeTyped();
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    this.h.onToolChange?.(tool);
    this.render();
  }

  setUnit(unit) {
    this.unit = unit;
    this.h.onOptionsChange?.();
    this.refreshTypedUnit();
    this.render();
  }

  setOption(name, value) {
    if (name === 'snap') this.snapOn = value;
    if (name === 'dist') this.distOn = value;
    if (name === 'guides') this.guidesOn = value;
    if (name === 'refSketches') this.refSketchesOn = value;
    if (name === 'refSolid') this.refSolidOn = value;
    this.geometryCache.clear();
    this.h.onOptionsChange?.();
    if (name === 'refSketches' || name === 'refSolid') this.h.onReferenceOptions?.();
    this.render();
  }

  getOption(name) {
    return { dist: this.distOn, snap: this.snapOn, guides: this.guidesOn, refSketches: this.refSketchesOn, refSolid: this.refSolidOn }[name];
  }

  // Geometría de referencia (otros bocetos y corte de la pieza) en coordenadas de este boceto.
  setReference(reference) {
    this.reference = reference;
    this.geometryCache.clear();
    this.render();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
    if (!w || !h) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = w * ratio;
    this.canvas.height = h * ratio;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.size = { w, h };
    this.render();
  }

  // --- coordenadas ---
  toScreen(x, y) {
    return [this.size.w / 2 + (x - this.view.cx) * this.view.scale, this.size.h / 2 - (y - this.view.cy) * this.view.scale];
  }
  toWorld(px, py) {
    return [this.view.cx + (px - this.size.w / 2) / this.view.scale, this.view.cy - (py - this.size.h / 2) / this.view.scale];
  }
  gridStep() {
    return niceSteps.find((step) => step * this.view.scale >= 14) ?? 1000;
  }

  // --- imanes ---
  resolvedEntities(excludeId = null) {
    return (this.sketch?.entities ?? [])
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => {
        try {
          return resolveEntity(entity, this.params);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // Formas para medir distancias: contornos de las entidades, guías infinitas y la referencia (papel cebolla).
  shapes(excludeId = null) {
    const key = `shapes:${excludeId ?? ''}`;
    if (this.geometryCache.has(key)) return this.geometryCache.get(key);
    const out = [];
    const add = (resolved, id) => {
      if (resolved.t === 'guide') return out.push({ id, line: { x: resolved.x, y: resolved.y, angle: resolved.angle }, kind: 'guide' });
      const polygon = entityPolygon(resolved);
      if (polygon.length >= 2) out.push({ id, pts: polygon.map((p) => [p.x, p.y]), closed: polygon.length > 2, kind: resolved.t });
    };
    (this.sketch?.entities ?? []).forEach((entity) => {
      if (entity.id === excludeId) return;
      try { add(resolveEntity(entity, this.params), entity.id); } catch { /* entidad inválida */ }
    });
    (this.reference?.entities ?? []).forEach((resolved, i) => { try { add(resolved, `ref-e${i}`); } catch { /* referencia inválida */ } });
    (this.reference?.polylines ?? []).forEach((line, i) => out.push({ id: `ref-p${i}`, pts: line.points, closed: line.closed, kind: 'ref' }));
    this.geometryCache.set(key, out);
    return out;
  }

  geometry(excludeId = null) {
    const key = excludeId ?? '';
    if (!this.geometryCache.has(key)) this.geometryCache.set(key, collectGeometry(this.resolvedEntities(excludeId), this.reference));
    return this.geometryCache.get(key);
  }

  // Punto de anclaje de la operación en curso (para guías de ángulo y medidas).
  get anchor() {
    if (this.tool === 'measure') return this.measure && !this.measure.fixed ? this.measure.a : null;
    if (this.tool === 'gap') return null;
    if (!this.draft) return null;
    if (this.draft.tool === 'poly') return this.draft.pts[this.draft.pts.length - 1] ?? null;
    return this.draft.start ?? null;
  }

  computeSnapAt(world, free) {
    const step = this.gridStep();
    const grid = step >= 5 ? step / (step >= 10 ? 10 : 5) : step;
    const info = computeSnap(world, this.geometry(this.drag?.id ?? null), this.view.scale, {
      anchor: this.anchor,
      snapPoints: this.snapOn && !free,
      guides: this.guidesOn && !free,
      grid: free ? 0 : Math.max(grid, 0.5),
    });
    if (free) return { ...info, x: world[0], y: world[1] };
    return info;
  }

  snapPoint(x, y, free = false) {
    const info = this.computeSnapAt([x, y], free);
    return [info.x, info.y];
  }

  fit() {
    const polys = [];
    (this.sketch?.entities ?? []).forEach((entity) => {
      if (entity.t === 'guide') return;
      try {
        polys.push(...entityPolygon(resolveEntity(entity, this.params)));
      } catch {
        /* ignora */
      }
    });
    // Boceto vacío: se encuadra la referencia (otros bocetos / corte de la pieza), que es donde hay que ubicarse.
    if (polys.length === 0) (this.reference?.boxes ?? []).forEach((box) => polys.push({ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 }));
    if (polys.length === 0 || !this.size) {
      this.view = { cx: 0, cy: 0, scale: 4 };
      return this.render();
    }
    const xs = polys.map((p) => p.x);
    const ys = polys.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) || 10;
    const h = Math.max(...ys) - Math.min(...ys) || 10;
    this.view = { cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, scale: Math.min((this.size.w * 0.7) / w, (this.size.h * 0.7) / h, 40) };
    this.render();
  }

  // --- interacción ---
  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  wheel(event) {
    event.preventDefault();
    const [px, py] = this.eventPoint(event);
    const [wx, wy] = this.toWorld(px, py);
    this.view.scale = Math.min(400, Math.max(0.3, this.view.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    this.view.cx = wx - (px - this.size.w / 2) / this.view.scale;
    this.view.cy = wy + (py - this.size.h / 2) / this.view.scale;
    this.render();
  }

  hitEntity(wx, wy) {
    const entities = this.sketch?.entities ?? [];
    for (let i = entities.length - 1; i >= 0; i -= 1) {
      try {
        const resolved = resolveEntity(entities[i], this.params);
        if (resolved.t === 'guide') {
          const rad = (resolved.angle * Math.PI) / 180;
          if (Math.abs(-(wx - resolved.x) * Math.sin(rad) + (wy - resolved.y) * Math.cos(rad)) < 6 / this.view.scale) return entities[i];
          continue;
        }
        const polygon = entityPolygon(resolved);
        const tolerance = 6 / this.view.scale;
        const near = polygon.some((p, idx) => {
          const q = polygon[(idx + 1) % polygon.length];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const t = Math.max(0, Math.min(1, ((wx - p.x) * dx + (wy - p.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(wx - (p.x + t * dx), wy - (p.y + t * dy)) < tolerance;
        });
        if (near || pointInPolygon({ x: wx, y: wy }, polygon)) return entities[i];
      } catch {
        /* entidad inválida */
      }
    }
    return null;
  }

  down(event) {
    this.canvas.focus();
    const [px, py] = this.eventPoint(event);
    if (event.button === 1 || event.button === 2 || this.spaceDown) {
      this.pan = { px, py, cx: this.view.cx, cy: this.view.cy };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || px < RULER || py < RULER) return;
    const raw = this.toWorld(px, py);
    if (this.tool === 'select') {
      const hit = this.hitEntity(...raw);
      this.selectedEntityId = hit?.id ?? null;
      this.h.onSelectEntity?.(this.selectedEntityId);
      if (hit) {
        this.drag = { id: hit.id, start: null, delta: [0, 0], entity: hit };
        const snapped = this.computeSnapAt(raw, event.altKey);
        this.drag.start = [snapped.x, snapped.y];
        this.canvas.setPointerCapture(event.pointerId);
      }
      return this.render();
    }
    let snapped = this.computeSnapAt(raw, event.altKey);
    if (event.shiftKey && this.anchor) snapped = this.orthoSnap(snapped, this.anchor);
    this.pointerDownTool(snapped.x, snapped.y, event.shiftKey);
  }

  // Lo que hay bajo el cursor para la herramienta Distancia: una forma (entidad, guía o referencia) o, con Shift, un punto.
  pickForGap(wx, wy, asPoint) {
    if (asPoint) return { kind: 'point', p: [wx, wy] };
    const shapes = this.shapes();
    const tolerance = 6 / this.view.scale;
    const entity = this.hitEntity(wx, wy);
    const shape = entity ? shapes.find((item) => item.id === entity.id) : null;
    if (shape) return { kind: 'shape', shape };
    const near = nearestShape([wx, wy], shapes.filter((item) => item.id.startsWith('ref-')));
    if (near && near.d < tolerance) return { kind: 'shape', shape: near.shape };
    return { kind: 'point', p: [wx, wy] };
  }

  pointerDownTool(wx, wy, shift = false) {
    const { tool } = this;
    if (tool === 'gap') {
      const pick = this.pickForGap(wx, wy, shift);
      if (!this.gap || this.gap.fixed) this.gap = { a: pick, b: null, fixed: false };
      else this.gap = { ...this.gap, b: pick, fixed: true };
      return this.render();
    }
    if (tool === 'measure') {
      if (!this.measure || this.measure.fixed) this.measure = { a: [wx, wy], b: null, fixed: false };
      else this.measure = { ...this.measure, b: [wx, wy], fixed: true };
      return this.render();
    }
    if (tool === 'poly') {
      this.draft = this.draft ?? { tool, pts: [] };
      const last = this.draft.pts[this.draft.pts.length - 1];
      if (!last || Math.hypot(last[0] - wx, last[1] - wy) > 1e-9) this.draft.pts.push([wx, wy]);
      this.typed = {};
      this.openTyped();
      return this.render();
    }
    if (!this.draft) {
      this.draft = { tool, start: [wx, wy] };
      this.typed = {};
      this.openTyped();
      return this.render();
    }
    this.commitDraft([wx, wy]);
  }

  // Cierra el borrador con el punto final dado y los valores tipeados que haya.
  commitDraft(end) {
    const { tool, start } = this.draft;
    const entity = this.entityFromDraft(tool, start, end, this.typed);
    if (entity?.t === 'polygon') this.polygonSides = entity.n;
    this.draft = null;
    this.typed = {};
    this.closeTyped();
    if (entity) this.h.onAddEntity(this.sketchId, entity);
    this.setTool('select');
  }

  // Entidad a partir del primer clic, un punto final (ratón) y valores tipeados que lo reemplazan.
  entityFromDraft(tool, [sx, sy], [ex, ey], typed = {}) {
    const dx = ex - sx;
    const dy = ey - sy;
    const sgnX = dx < 0 ? -1 : 1;
    const sgnY = dy < 0 ? -1 : 1;
    const value = (key, fallback) => typed[key]?.value ?? fallback;
    const store = (key, fallback) => typed[key]?.store ?? r3(fallback);
    // Esquina mínima según la dirección del ratón; si el tamaño es una expresión se guarda como expresión.
    const corner = (start, size, sign) => (sign > 0 ? r3(start) : typeof size === 'number' ? r3(start - size) : `${r3(start)} - (${size})`);
    if (tool === 'polygon') {
      const sides = typed.n ? Math.round(typed.n.value) : this.polygonSides ?? 6;
      const sized = typed.flats ?? typed.corners;
      const mouseDist = Math.hypot(dx, dy);
      const mouseAngle = mouseDist > 1e-9 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
      const size = sized ? sized.value : mouseDist * 2;
      if (!(size > 0) || !(sides >= 3 && sides <= 64)) return null;
      const across = typed.flats ? 'flats' : 'corners';
      return { ...entityDefaults.polygon(), x: r3(sx), y: r3(sy), n: sides, d: sized ? sized.store : r3(size), across: sized ? across : 'corners', angle: typed.angle ? typed.angle.store : sized ? 0 : r3(mouseAngle) };
    }
    if (tool === 'guide') {
      const mouseAngle = Math.hypot(dx, dy) > 1e-9 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
      return { ...entityDefaults.guide(), x: r3(sx), y: r3(sy), angle: typed.angle ? typed.angle.store : r3(mouseAngle) };
    }
    if (tool === 'rect' || tool === 'square') {
      const side = typed.side?.value ?? Math.max(Math.abs(dx), Math.abs(dy));
      const wv = tool === 'square' ? side : value('w', Math.abs(dx));
      const hv = tool === 'square' ? side : value('h', Math.abs(dy));
      if (!(wv > 0) || !(hv > 0)) return null;
      const ws = tool === 'square' ? typed.side?.store ?? r3(side) : store('w', Math.abs(dx));
      const hs = tool === 'square' ? ws : store('h', Math.abs(dy));
      return { ...entityDefaults.rect(), x: corner(sx, ws, sgnX), y: corner(sy, hs, sgnY), w: ws, h: hs, centered: false };
    }
    if (tool === 'circle') {
      const radius = typed.d?.radius;
      const dv = typed.d ? (radius ? typed.d.value * 2 : typed.d.value) : Math.hypot(dx, dy) * 2;
      if (!(dv > 0)) return null;
      const ds = typed.d ? (radius ? (typeof typed.d.store === 'number' ? typed.d.store * 2 : `2*(${typed.d.store})`) : typed.d.store) : r3(dv);
      return { ...entityDefaults.circle(), x: r3(sx), y: r3(sy), d: ds };
    }
    if (tool === 'ellipse') {
      const wv = value('w', Math.abs(dx) * 2);
      const hv = value('h', Math.abs(dy) * 2);
      if (!(wv > 0) || !(hv > 0)) return null;
      return { ...entityDefaults.ellipse(), x: r3(sx), y: r3(sy), w: store('w', wv), h: store('h', hv), angle: 0 };
    }
    if (tool === 'slot') {
      const dist = Math.hypot(dx, dy);
      const widthV = value('width', Math.min(Math.max(dist / 4, 4), Math.max(dist / 3, 1)));
      const lengthV = value('length', dist + widthV);
      if (!(lengthV > widthV) || !(widthV > 0)) return null;
      const angle = dist > 1e-9 ? Math.atan2(dy, dx) : 0;
      const centerDist = lengthV - widthV;
      return { ...entityDefaults.slot(), x: r3(sx + (Math.cos(angle) * centerDist) / 2), y: r3(sy + (Math.sin(angle) * centerDist) / 2), length: store('length', lengthV), width: store('width', widthV), angle: r3((angle * 180) / Math.PI) };
    }
    return null;
  }

  // Siguiente vértice de una polilínea con longitud/ángulo tipeados (el ángulo por defecto es el del ratón).
  polyPointFromTyped() {
    const last = this.draft.pts[this.draft.pts.length - 1];
    const length = this.typed.length?.value;
    if (!(length > 0)) return null;
    const mouse = this.hover ?? last;
    const angle = this.typed.angle ? this.typed.angle.value : (Math.atan2(mouse[1] - last[1], mouse[0] - last[0]) * 180) / Math.PI;
    const rad = (angle * Math.PI) / 180;
    return [r3(last[0] + Math.cos(rad) * length), r3(last[1] + Math.sin(rad) * length)];
  }

  finishPoly() {
    if (this.tool !== 'poly' || !this.draft || this.draft.pts.length < 3) return;
    const pts = this.draft.pts.slice();
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    if (prev && Math.hypot(last[0] - prev[0], last[1] - prev[1]) < 1e-9) pts.pop();
    this.draft = null;
    this.typed = {};
    this.closeTyped();
    this.h.onAddEntity(this.sketchId, { t: 'poly', pts: pts.map(([x, y]) => ({ x: r3(x), y: r3(y), bulge: 0 })) });
    this.setTool('select');
  }

  move(event) {
    const [px, py] = this.eventPoint(event);
    if (this.pan) {
      this.view.cx = this.pan.cx - (px - this.pan.px) / this.view.scale;
      this.view.cy = this.pan.cy + (py - this.pan.py) / this.view.scale;
      return this.render();
    }
    this.hoverRaw = this.toWorld(px, py);
    this.hoverPx = [px, py];
    this.shiftDown = event.shiftKey;
    let info = this.computeSnapAt(this.hoverRaw, event.altKey);
    // Shift: movimiento/trazo en línea recta (múltiplos de 45°) desde el punto de partida.
    const reference = this.drag ? this.drag.start : this.anchor;
    if (event.shiftKey && reference) info = this.orthoSnap(info, reference);
    this.snap = info;
    this.hover = [info.x, info.y];
    if (this.drag) this.drag.delta = [info.x - this.drag.start[0], info.y - this.drag.start[1]];
    this.h.onCursor?.(this.hover, { label: info.label, unit: this.unit, text: this.cursorText(info) });
    this.render();
  }

  orthoSnap(info, reference) {
    const dx = info.x - reference[0];
    const dy = info.y - reference[1];
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = dx * Math.cos(angle) + dy * Math.sin(angle);
    const deg = ((Math.round((angle * 180) / Math.PI) % 360) + 360) % 360;
    return {
      ...info,
      x: reference[0] + length * Math.cos(angle),
      y: reference[1] + length * Math.sin(angle),
      kind: 'angle',
      label: `Shift · ${deg}°`,
      marker: null,
      lines: [{ from: reference, to: [reference[0] + Math.cos(angle) * 1e6, reference[1] + Math.sin(angle) * 1e6], kind: 'angle' }, { from: reference, to: [reference[0] - Math.cos(angle) * 1e6, reference[1] - Math.sin(angle) * 1e6], kind: 'angle' }],
    };
  }

  cursorText(info) {
    const u = this.unit;
    let text = `x ${formatUnit(info.x, u)}  y ${formatUnit(info.y, u)} ${u}`;
    const anchor = this.anchor;
    if (anchor) {
      const length = Math.hypot(info.x - anchor[0], info.y - anchor[1]);
      const angle = (Math.atan2(info.y - anchor[1], info.x - anchor[0]) * 180) / Math.PI;
      text += `  ·  L ${formatUnit(length, u)} ${u}  ∠ ${Math.round(((angle % 360) + 360) % 360 * 10) / 10}°`;
    }
    if (info.label) text += `  ·  ${info.label}`;
    return text;
  }

  up() {
    this.pan = null;
    if (this.drag) {
      const { id, delta, entity } = this.drag;
      this.drag = null;
      if (Math.hypot(...delta) > 1e-9) {
        if (entity.t === 'poly') this.h.onUpdateEntity(this.sketchId, id, { pts: entity.pts.map((p) => ({ ...p, x: r3(this.num(p.x) + delta[0]), y: r3(this.num(p.y) + delta[1]) })) });
        else this.h.onUpdateEntity(this.sketchId, id, { x: r3(this.num(entity.x) + delta[0]), y: r3(this.num(entity.y) + delta[1]) });
      } else this.render();
    }
  }

  num(value) {
    try {
      return Number(typeof value === 'number' ? value : resolveEntity({ t: 'circle', x: value, y: 0, d: 1 }, this.params).x);
    } catch {
      return 0;
    }
  }

  key(event) {
    if (!this.active || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.code === 'Space') {
      this.spaceDown = true;
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      this.cancelOperation();
      return;
    }
    if (event.key === 'Enter') this.finishPoly();
    if (this.draft && /^[0-9.,rR-]$/.test(event.key) && this.inputHost && !this.inputHost.hidden) this.focusTyped();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.selectedEntityId) {
      event.preventDefault();
      const entity = this.sketch?.entities.find((item) => item.id === this.selectedEntityId);
      if (entity) this.h.onAddEntity(this.sketchId, offsetEntity(entity, 10, 10));
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedEntityId) this.h.onRemoveEntity(this.sketchId, this.selectedEntityId);
    const tools = { v: 'select', r: 'rect', q: 'square', c: 'circle', e: 'ellipse', s: 'slot', p: 'poly', l: 'poly', n: 'polygon', g: 'guide', m: 'measure', d: 'gap' };
    if (!event.ctrlKey && !event.metaKey && tools[event.key.toLowerCase()]) this.setTool(tools[event.key.toLowerCase()]);
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey) this.fit();
  }

  cancelOperation() {
    if (this.draft || this.measure || this.gap) {
      this.draft = null;
      this.measure = null;
      this.gap = null;
      this.typed = {};
      this.closeTyped();
      this.render();
    } else if (this.tool !== 'select') this.setTool('select');
    else this.h.onClose?.();
  }

  // --- tamaño tipeado (tarjeta flotante) ---
  openTyped() {
    const host = this.inputHost;
    const fields = typedFields[this.draft?.tool];
    if (!host || !fields) return;
    // Polilínea: se reutiliza la tarjeta (sin recrear los campos) para no perder el foco entre vértices.
    if (!host.hidden && this.typedFor === this.draft.tool && Object.keys(this.typedInputs ?? {}).length) {
      Object.values(this.typedInputs).forEach((input) => {
        input.value = '';
        input.classList.remove('bad');
      });
      if (this.typedMessage) this.typedMessage.textContent = '';
      this.positionTyped();
      Object.values(this.typedInputs)[0].focus();
      return;
    }
    this.typedFor = this.draft.tool;
    host.hidden = false;
    host.replaceChildren();
    this.typedInputs = {};
    const title = el('div', { class: 'sk-input-title', text: `${toolTitles[this.draft.tool]} · tamaño` });
    const unitButton = button(this.unit, () => this.setUnit(this.unit === 'mm' ? 'cm' : 'mm'), { title: 'Unidad de lo que tipeás (también acepta 2cm, 1in o expresiones con parámetros)' });
    unitButton.classList.add('sk-unit');
    this.typedUnitButton = unitButton;
    const rows = fields.map((field, index) => {
      const input = el('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'data-field': field.key, placeholder: 'del ratón', value: field.integer ? String(this.polygonSides ?? field.fallback) : '' });
      this.typedInputs[field.key] = input;
      input.addEventListener('input', () => this.onTypedInput(field, input));
      input.addEventListener('keydown', (event) => this.onTypedKey(event, field, index, fields));
      return el('label', { class: 'sk-field' }, el('span', { text: field.label }), input);
    });
    this.typedMessage = el('div', { class: 'sk-input-msg' });
    host.append(el('div', { class: 'sk-input-head' }, title, unitButton), ...rows, this.typedMessage, el('div', { class: 'sk-input-hint', text: 'Enter: aplicar · Tab: siguiente campo · Esc: cancelar · o hacé clic para fijar con el ratón' }));
    fields.filter((field) => field.integer).forEach((field) => this.onTypedInput(field, this.typedInputs[field.key]));
    this.positionTyped();
    const first = Object.values(this.typedInputs)[0];
    setTimeout(() => first?.focus(), 0);
  }

  positionTyped() {
    const host = this.inputHost;
    if (!host || host.hidden || !this.draft || !this.size) return;
    const anchor = this.anchor;
    if (!anchor) return;
    const [sx, sy] = this.toScreen(anchor[0], anchor[1]);
    const width = host.offsetWidth || 220;
    const height = host.offsetHeight || 140;
    host.style.left = `${Math.max(RULER + 4, Math.min(sx + 18, this.size.w - width - 8))}px`;
    host.style.top = `${Math.max(RULER + 4, Math.min(sy + 18, this.size.h - height - 8))}px`;
  }

  refreshTypedUnit() {
    if (this.typedUnitButton) this.typedUnitButton.textContent = this.unit;
    Object.entries(this.typedInputs ?? {}).forEach(([key, input]) => {
      const field = typedFields[this.draft?.tool]?.find((item) => item.key === key);
      if (field) this.onTypedInput(field, input);
    });
  }

  closeTyped() {
    if (this.inputHost) {
      this.inputHost.hidden = true;
      this.inputHost.replaceChildren();
    }
    this.typedInputs = {};
    this.typedFor = null;
    this.typedUnitButton = null;
    this.typedMessage = null;
  }

  focusTyped() {
    const inputs = Object.values(this.typedInputs ?? {});
    const target = inputs.find((input) => input.value === '') ?? inputs[0];
    target?.focus();
  }

  onTypedInput(field, input) {
    const text = input.value;
    if (text.trim() === '') {
      delete this.typed[field.key];
      input.classList.remove('bad');
      if (this.typedMessage) this.typedMessage.textContent = '';
    } else {
      const parsed = field.integer
        ? this.parseInteger(text)
        : field.angle
        ? this.parseAngle(text)
        : parseLength(text, { unit: this.unit, params: this.params, allowRadius: Boolean(field.radius) });
      if (parsed.ok) {
        this.typed[field.key] = parsed;
        input.classList.remove('bad');
        if (this.typedMessage) this.typedMessage.textContent = '';
      } else {
        delete this.typed[field.key];
        input.classList.add('bad');
        if (this.typedMessage) this.typedMessage.textContent = parsed.error ?? '';
      }
    }
    this.render();
  }

  parseInteger(text) {
    const value = Number(String(text).trim());
    return Number.isInteger(value) && value >= 3 && value <= 64 ? { ok: true, value, store: value } : { ok: false, error: 'Lados: entero de 3 a 64' };
  }

  parseAngle(text) {
    const value = Number(String(text).replace(',', '.').replace('°', ''));
    return Number.isFinite(value) ? { ok: true, value, store: value } : { ok: false, error: 'Ángulo inválido' };
  }

  onTypedKey(event, field, index, fields) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelOperation();
      this.canvas.focus();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = fields.map((item) => this.typedInputs[item.key]);
    // Con varios campos: Enter pasa al siguiente campo vacío; con el último lleno (o si ya hay suficiente) aplica.
    const nextEmpty = inputs.findIndex((input, i) => i > index && input.value.trim() === '');
    if (this.draft.tool !== 'poly' && nextEmpty !== -1 && this.needsAllFields(this.draft.tool)) {
      inputs[nextEmpty].focus();
      return;
    }
    this.applyTyped();
  }

  needsAllFields(tool) {
    return tool === 'rect' && this.typed.w && !this.typed.h ? true : tool === 'ellipse' && this.typed.w && !this.typed.h;
  }

  applyTyped() {
    if (!this.draft) return;
    if (this.draft.tool === 'poly') {
      const point = this.polyPointFromTyped();
      if (point) {
        this.draft.pts.push(point);
        this.typed = {};
        this.openTyped();
        this.render();
      } else if (this.draft.pts.length >= 3) this.finishPoly();
      else if (this.typedMessage) this.typedMessage.textContent = 'Tipeá un largo mayor que 0';
      return;
    }
    const end = this.hover ?? this.draft.start;
    if (!this.entityFromDraft(this.draft.tool, this.draft.start, end, this.typed)) {
      if (this.typedMessage) this.typedMessage.textContent = 'Falta un tamaño válido';
      return;
    }
    this.commitDraft(end);
    this.canvas.focus();
  }

  // --- dibujo ---
  render() {
    if (!this.active || !this.size) return;
    const { ctx } = this;
    const { w, h } = this.size;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);
    this.drawGrid();
    const sketch = this.sketch;
    if (!sketch) return;
    this.drawReference();
    sketch.entities.forEach((entity) => this.drawEntity(entity));
    this.drawDraft();
    this.drawProximity();
    this.drawSnap();
    this.drawDragDistances();
    this.drawMeasure();
    this.drawGap();
    this.drawAxisLabels(sketch.plane);
    this.drawRulers();
    this.positionTyped();
  }

  // Papel cebolla: bocetos y corte de la pieza en tenue, sin relleno. Solo se dibuja; atrae el cursor como el resto.
  drawReference() {
    const reference = this.reference;
    if (!reference) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 1.3;
    const trace = (points, closed) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const [sx, sy] = this.toScreen(x, y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    reference.entities.forEach((entity) => {
      ctx.strokeStyle = colors.refSketch;
      ctx.setLineDash(entity.t === 'guide' ? [10, 4, 2, 4] : [7, 4]);
      if (entity.t === 'guide') {
        const rad = (entity.angle * Math.PI) / 180;
        const far = (this.size.w + this.size.h) / this.view.scale;
        trace([[entity.x - Math.cos(rad) * far, entity.y - Math.sin(rad) * far], [entity.x + Math.cos(rad) * far, entity.y + Math.sin(rad) * far]], false);
        return;
      }
      trace(entityPolygon(entity).map(({ x, y }) => [x, y]), true);
    });
    reference.polylines.forEach((line) => {
      ctx.strokeStyle = line.kind === 'solid' ? colors.refSolid : colors.refSketch;
      ctx.setLineDash(line.kind === 'solid' ? [] : [7, 4]);
      trace(line.points, line.closed);
    });
    ctx.restore();
    const legend = [];
    if (this.refSketchesOn) legend.push('bocetos (azul)');
    if (this.refSolidOn) legend.push('corte de la pieza (ámbar)');
    if (legend.length) {
      ctx.fillStyle = '#8c98ad';
      ctx.font = '11px system-ui';
      ctx.fillText(`Referencia tenue: ${legend.join(' · ')}`, RULER + 8, this.size.h - 10);
    }
  }

  drawGrid() {
    const { ctx } = this;
    const { w, h } = this.size;
    const step = this.gridStep();
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(w, h);
    ctx.lineWidth = 1;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.strokeStyle = Math.abs(x / (step * 5) - Math.round(x / (step * 5))) < 1e-9 ? colors.gridMajor : colors.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, h);
      ctx.stroke();
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.strokeStyle = Math.abs(y / (step * 5) - Math.round(y / (step * 5))) < 1e-9 ? colors.gridMajor : colors.grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(w, Math.round(sy) + 0.5);
      ctx.stroke();
    }
    const [ox, oy] = this.toScreen(0, 0);
    ctx.strokeStyle = colors.axis;
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.stroke();
    if (this.revolveAxis) {
      ctx.strokeStyle = colors.axisRev;
      ctx.setLineDash([10, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (this.revolveAxis === 'y') {
        ctx.moveTo(ox, 0);
        ctx.lineTo(ox, h);
      } else {
        ctx.moveTo(0, oy);
        ctx.lineTo(w, oy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors.axisRev;
      ctx.font = '11px system-ui';
      ctx.fillText('eje de revolución', ox + 8, RULER + 14);
    }
    ctx.fillStyle = '#8c98ad';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`cuadrícula ${formatUnit(step, this.unit)} ${this.unit}`, w - 10, h - 10);
    ctx.textAlign = 'start';
  }

  // Reglas superior e izquierda en la unidad elegida, con marcas de cursor.
  drawRulers() {
    const { ctx } = this;
    const { w, h } = this.size;
    const stepMm = niceSteps.find((step) => step * this.view.scale >= 56) ?? 1000;
    const minor = stepMm / 5;
    ctx.save();
    ctx.fillStyle = colors.ruler;
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillRect(0, 0, RULER, h);
    ctx.strokeStyle = '#3a4558';
    ctx.beginPath();
    ctx.moveTo(0, RULER + 0.5);
    ctx.lineTo(w, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0);
    ctx.lineTo(RULER + 0.5, h);
    ctx.stroke();
    ctx.fillStyle = colors.rulerText;
    ctx.strokeStyle = colors.rulerText;
    ctx.font = '10px system-ui';
    const [x0] = this.toWorld(RULER, 0);
    const [x1] = this.toWorld(w, 0);
    for (let x = Math.floor(x0 / minor) * minor; x <= x1; x += minor) {
      const [sx] = this.toScreen(x, 0);
      if (sx < RULER) continue;
      const major = Math.abs(x / stepMm - Math.round(x / stepMm)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(Math.round(sx) + 0.5, RULER);
      ctx.lineTo(Math.round(sx) + 0.5, RULER - (major ? 10 : 4));
      ctx.stroke();
      if (major) ctx.fillText(formatUnit(x, this.unit), sx + 3, 10);
    }
    const [, yTop] = this.toWorld(0, RULER);
    const [, yBottom] = this.toWorld(0, h);
    for (let y = Math.floor(yBottom / minor) * minor; y <= yTop; y += minor) {
      const [, sy] = this.toScreen(0, y);
      if (sy < RULER) continue;
      const major = Math.abs(y / stepMm - Math.round(y / stepMm)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(RULER, Math.round(sy) + 0.5);
      ctx.lineTo(RULER - (major ? 10 : 4), Math.round(sy) + 0.5);
      ctx.stroke();
      if (major) {
        ctx.save();
        ctx.translate(9, sy - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(formatUnit(y, this.unit), 0, 0);
        ctx.restore();
      }
    }
    // Marcas del cursor
    if (this.hoverPx && this.hover) {
      const [sx, sy] = this.toScreen(this.hover[0], this.hover[1]);
      ctx.strokeStyle = colors.cursor;
      ctx.fillStyle = colors.cursor;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, RULER);
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(RULER, sy + 0.5);
      ctx.stroke();
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(formatUnit(this.hover[0], this.unit), Math.min(sx + 4, w - 40), RULER - 11 + 9);
    }
    ctx.fillStyle = '#1a1f28';
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.fillStyle = colors.rulerText;
    ctx.font = 'bold 9px system-ui';
    ctx.fillText(this.unit, 3, 13);
    ctx.restore();
  }

  drawAxisLabels(plane) {
    const [a, b] = axisLabels[plane] ?? ['X', 'Y'];
    const { ctx } = this;
    ctx.fillStyle = '#8c98ad';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText(`→ ${a}`, this.size.w - 40, Math.max(RULER + 14, this.toScreen(0, 0)[1] - 6));
    ctx.fillText(`↑ ${b}`, Math.max(RULER + 6, this.toScreen(0, 0)[0] + 6), RULER + 14);
  }

  tracePath(polygon) {
    const { ctx } = this;
    ctx.beginPath();
    polygon.forEach((p, i) => {
      const [sx, sy] = this.toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
  }

  traceEntity(entity, polygon) {
    const { ctx } = this;
    if (entity.t === 'circle') {
      const [cx, cy] = this.toScreen(entity.x, entity.y);
      ctx.beginPath();
      ctx.arc(cx, cy, (entity.d / 2) * this.view.scale, 0, Math.PI * 2);
    } else if (entity.t === 'ellipse') {
      const [cx, cy] = this.toScreen(entity.x, entity.y);
      ctx.beginPath();
      ctx.ellipse(cx, cy, (entity.w / 2) * this.view.scale, (entity.h / 2) * this.view.scale, (-(entity.angle ?? 0) * Math.PI) / 180, 0, Math.PI * 2);
    } else this.tracePath(polygon);
  }

  drawEntity(entity) {
    const { ctx } = this;
    let resolved;
    try {
      resolved = resolveEntity(entity, this.params);
    } catch {
      return;
    }
    const offset = this.drag?.id === entity.id ? this.drag.delta : [0, 0];
    if (resolved.t === 'guide') return this.drawGuide({ ...resolved, x: resolved.x + offset[0], y: resolved.y + offset[1] }, entity.id === this.selectedEntityId);
    const moved = resolved.t === 'poly' ? { ...resolved, pts: resolved.pts.map((p) => ({ ...p, x: p.x + offset[0], y: p.y + offset[1] })) } : { ...resolved, x: resolved.x + offset[0], y: resolved.y + offset[1] };
    const polygon = entityPolygon(moved);
    const selected = entity.id === this.selectedEntityId;
    this.traceEntity(moved, polygon);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : 1.8;
    ctx.strokeStyle = selected ? colors.sel : colors.stroke;
    ctx.stroke();
    this.drawDimensions(moved, selected);
    if (moved.t === 'poly') {
      ctx.fillStyle = selected ? colors.sel : colors.stroke;
      moved.pts.forEach((p) => {
        const [sx, sy] = this.toScreen(p.x, p.y);
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      });
    }
  }

  // Línea auxiliar infinita: punteada, no entra en el perfil.
  drawGuide(guide, selected) {
    const { ctx } = this;
    const rad = (guide.angle * Math.PI) / 180;
    const far = (this.size.w + this.size.h) / this.view.scale;
    const [ax, ay] = this.toScreen(guide.x - Math.cos(rad) * far, guide.y - Math.sin(rad) * far);
    const [bx, by] = this.toScreen(guide.x + Math.cos(rad) * far, guide.y + Math.sin(rad) * far);
    ctx.save();
    ctx.strokeStyle = selected ? colors.sel : '#6ea8c9';
    ctx.lineWidth = selected ? 1.8 : 1.2;
    ctx.setLineDash([10, 4, 2, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
    const [px, py] = this.toScreen(guide.x, guide.y);
    ctx.fillStyle = selected ? colors.sel : '#6ea8c9';
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }

  label(text, sx, sy, color = colors.dim) {
    const { ctx } = this;
    ctx.font = '11px system-ui';
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(29,34,43,0.85)';
    ctx.fillRect(sx - width / 2, sy - 9, width, 17);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, sx, sy + 4);
    ctx.textAlign = 'start';
  }

  drawDimensions(entity, selected) {
    const fmt = (v) => formatUnit(v, this.unit);
    const color = selected ? colors.sel : colors.dim;
    if (entity.t === 'rect') {
      const x0 = entity.centered ? entity.x - entity.w / 2 : entity.x;
      const y0 = entity.centered ? entity.y - entity.h / 2 : entity.y;
      this.label(fmt(entity.w), ...this.toScreen(x0 + entity.w / 2, y0 + entity.h), color);
      this.label(fmt(entity.h), ...this.toScreen(x0 + entity.w, y0 + entity.h / 2), color);
    } else if (entity.t === 'circle') {
      this.label(`Ø${fmt(entity.d)}`, ...this.toScreen(entity.x, entity.y), color);
    } else if (entity.t === 'ellipse') {
      this.label(`${fmt(entity.w)} × ${fmt(entity.h)}`, ...this.toScreen(entity.x, entity.y), color);
    } else if (entity.t === 'polygon') {
      this.label(`${entity.n} lados · ${fmt(entity.d)} ${entity.across === 'flats' ? 'entre caras' : 'entre vért.'}`, ...this.toScreen(entity.x, entity.y), color);
    } else if (entity.t === 'slot') {
      this.label(`${fmt(entity.length)} × ${fmt(entity.width)}`, ...this.toScreen(entity.x, entity.y), color);
    } else if (entity.t === 'poly') {
      entity.pts.forEach((p, i) => {
        const q = entity.pts[(i + 1) % entity.pts.length];
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        if (!p.bulge) this.label(fmt(length), ...this.toScreen((p.x + q.x) / 2, (p.y + q.y) / 2), color);
      });
    }
  }

  drawDraft() {
    if (!this.draft || !this.hover) return;
    const { ctx } = this;
    ctx.strokeStyle = colors.preview;
    ctx.fillStyle = 'rgba(126,224,138,0.1)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.6;
    const [hx, hy] = this.hover;
    if (this.draft.tool === 'poly') {
      const typedPoint = this.typed.length ? this.polyPointFromTyped() : null;
      const next = typedPoint ?? [hx, hy];
      const pts = [...this.draft.pts, next];
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const [sx, sy] = this.toScreen(x, y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      const last = this.draft.pts[this.draft.pts.length - 1];
      if (last) {
        const dx = next[0] - last[0];
        const dy = next[1] - last[1];
        const text = formatUnit(Math.hypot(dx, dy), this.unit);
        const extra = this.distOn ? `  ·  Δx ${formatUnit(dx, this.unit)}  Δy ${formatUnit(dy, this.unit)}  ·  ${Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 * 100) / 100}°` : '';
        this.label(text + extra, ...this.toScreen((next[0] + last[0]) / 2, (next[1] + last[1]) / 2), colors.preview);
      }
    } else {
      const entity = this.entityFromDraft(this.draft.tool, this.draft.start, [hx, hy], this.typed);
      if (entity) {
        try {
          const resolved = resolveEntity(entity, this.params);
          if (resolved.t === 'guide') this.drawGuide(resolved, false);
          else {
            this.traceEntity(resolved, entityPolygon(resolved));
            ctx.fill();
            ctx.stroke();
            this.drawDimensions(resolved, false);
          }
        } catch {
          /* vista previa inválida */
        }
      }
    }
    ctx.setLineDash([]);
  }

  drawMarker(kind, sx, sy, size = 6) {
    const { ctx } = this;
    ctx.strokeStyle = markerColors[kind] ?? '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kind === 'vertex') ctx.rect(sx - size, sy - size, size * 2, size * 2);
    else if (kind === 'center') {
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.moveTo(sx - size - 3, sy);
      ctx.lineTo(sx + size + 3, sy);
      ctx.moveTo(sx, sy - size - 3);
      ctx.lineTo(sx, sy + size + 3);
    } else if (kind === 'midpoint') {
      ctx.moveTo(sx, sy - size);
      ctx.lineTo(sx + size, sy + size - 1);
      ctx.lineTo(sx - size, sy + size - 1);
      ctx.closePath();
    } else if (kind === 'quadrant') {
      ctx.moveTo(sx, sy - size - 1);
      ctx.lineTo(sx + size + 1, sy);
      ctx.lineTo(sx, sy + size + 1);
      ctx.lineTo(sx - size - 1, sy);
      ctx.closePath();
    } else if (kind === 'intersection') {
      ctx.moveTo(sx - size, sy - size);
      ctx.lineTo(sx + size, sy + size);
      ctx.moveTo(sx + size, sy - size);
      ctx.lineTo(sx - size, sy + size);
    } else if (kind === 'edge') {
      ctx.moveTo(sx - size + 1, sy);
      ctx.lineTo(sx + size - 1, sy);
      ctx.moveTo(sx, sy - size + 1);
      ctx.lineTo(sx, sy + size - 1);
    } else if (kind === 'origin') {
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.moveTo(sx - size - 3, sy);
      ctx.lineTo(sx + size + 3, sy);
      ctx.moveTo(sx, sy - size - 3);
      ctx.lineTo(sx, sy + size + 3);
    }
    ctx.stroke();
  }

  // Marcadores de imán: puntos cercanos tenues, el activo resaltado con su nombre y las guías de ángulo/alineación.
  drawSnap() {
    if (!this.snap || this.tool === 'select' || !this.hover) return;
    const { ctx } = this;
    const { w, h } = this.size;
    this.snap.near.forEach((p) => {
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.fillStyle = markerColors[p.kind] ?? '#fff';
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    this.snap.lines.forEach((line) => {
      ctx.save();
      ctx.strokeStyle = line.kind === 'angle' ? colors.guide : colors.align;
      ctx.lineWidth = 1;
      ctx.setLineDash(line.kind === 'angle' ? [8, 5] : [3, 4]);
      const [ax, ay] = this.toScreen(...line.from);
      const [bx, by] = this.toScreen(...line.to);
      ctx.beginPath();
      ctx.moveTo(Math.max(-1e5, Math.min(1e5, ax)), Math.max(-1e5, Math.min(1e5, ay)));
      ctx.lineTo(Math.max(-1e5, Math.min(1e5, bx)), Math.max(-1e5, Math.min(1e5, by)));
      ctx.stroke();
      ctx.restore();
    });
    (this.snap.alignedWith ?? []).forEach((p) => {
      const [sx, sy] = this.toScreen(p.x, p.y);
      this.drawMarker(p.kind, sx, sy, 4);
    });
    const [hx, hy] = this.toScreen(this.hover[0], this.hover[1]);
    if (this.snap.marker) this.drawMarker(this.snap.marker.kind, hx, hy);
    else if (this.snap.kind === 'angle' || this.snap.kind === 'align') {
      ctx.strokeStyle = this.snap.kind === 'angle' ? colors.guide : colors.align;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.snap.label && this.snap.kind !== 'grid') {
      ctx.font = '11px system-ui';
      const width = ctx.measureText(this.snap.label).width + 10;
      const lx = Math.min(hx + 12, w - width - 4);
      const ly = Math.min(hy + 22, h - 8);
      ctx.fillStyle = 'rgba(20,24,31,0.92)';
      ctx.fillRect(lx, ly - 12, width, 17);
      ctx.fillStyle = this.snap.marker ? markerColors[this.snap.marker.kind] : this.snap.kind === 'angle' ? colors.guide : colors.align;
      ctx.fillText(this.snap.label, lx + 5, ly);
    }
  }

  // Cuadro envolvente de una entidad resuelta (ya desplazada).
  boxOf(resolved) {
    const points = entityPolygon(resolved);
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  // Al mover una entidad: distancia a lo más cercano en las 4 direcciones (otras formas, guías rectas y ejes).
  drawDragDistances() {
    const drag = this.drag;
    if (!drag || Math.hypot(...drag.delta) < 1e-9) return;
    let moved;
    try {
      const resolved = resolveEntity(drag.entity, this.params);
      const [dx, dy] = drag.delta;
      moved = resolved.t === 'poly' ? { ...resolved, pts: resolved.pts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } : { ...resolved, x: resolved.x + dx, y: resolved.y + dy };
    } catch {
      return;
    }
    const self = this.boxOf(moved);
    if (!self) return;
    const boxes = [];
    const vLines = [0];
    const hLines = [0];
    this.resolvedEntities(drag.id).forEach((entity) => {
      if (entity.t === 'guide') {
        const a = (((entity.angle % 180) + 180) % 180);
        if (Math.abs(a - 90) < 1e-6) vLines.push(entity.x);
        else if (a < 1e-6 || Math.abs(a - 180) < 1e-6) hLines.push(entity.y);
        return;
      }
      const box = this.boxOf(entity);
      if (box) boxes.push(box);
    });
    (this.reference?.boxes ?? []).forEach((box) => boxes.push(box));
    const midX = (self.x0 + self.x1) / 2;
    const midY = (self.y0 + self.y1) / 2;
    const overlap = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
    const found = [];
    const consider = (dir, gap, at) => {
      if (gap < -1e-6) return;
      const index = found.findIndex((item) => item.dir === dir);
      const item = { dir, gap: Math.max(0, gap), at };
      if (index === -1) found.push(item);
      else if (item.gap < found[index].gap) found[index] = item;
    };
    boxes.forEach((box) => {
      const [oy0, oy1] = overlap(self.y0, self.y1, box.y0, box.y1);
      const [ox0, ox1] = overlap(self.x0, self.x1, box.x0, box.x1);
      if (oy1 > oy0) {
        consider('left', self.x0 - box.x1, (oy0 + oy1) / 2);
        consider('right', box.x0 - self.x1, (oy0 + oy1) / 2);
      }
      if (ox1 > ox0) {
        consider('down', self.y0 - box.y1, (ox0 + ox1) / 2);
        consider('up', box.y0 - self.y1, (ox0 + ox1) / 2);
      }
    });
    vLines.forEach((x) => {
      consider('left', self.x0 - x, midY);
      consider('right', x - self.x1, midY);
    });
    hLines.forEach((y) => {
      consider('down', self.y0 - y, midX);
      consider('up', y - self.y1, midX);
    });
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = colors.measure;
    ctx.lineWidth = 1;
    found.forEach(({ dir, gap, at }) => {
      let a;
      let b;
      if (dir === 'left') [a, b] = [[self.x0, at], [self.x0 - gap, at]];
      if (dir === 'right') [a, b] = [[self.x1, at], [self.x1 + gap, at]];
      if (dir === 'down') [a, b] = [[at, self.y0], [at, self.y0 - gap]];
      if (dir === 'up') [a, b] = [[at, self.y1], [at, self.y1 + gap]];
      const [ax, ay] = this.toScreen(...a);
      const [bx, by] = this.toScreen(...b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      const horizontal = dir === 'left' || dir === 'right';
      [[ax, ay], [bx, by]].forEach(([x, y]) => {
        ctx.moveTo(horizontal ? x : x - 4, horizontal ? y - 4 : y);
        ctx.lineTo(horizontal ? x : x + 4, horizontal ? y + 4 : y);
      });
      ctx.stroke();
      this.label(`${formatUnit(gap, this.unit)} ${this.unit}`, (ax + bx) / 2, (ay + by) / 2 - (horizontal ? 10 : 0), colors.measure);
    });
    ctx.restore();
  }

  // Segmento de cota entre dos puntos del mundo, con topes y rótulo.
  drawDistanceLine(p, q, text, color, { dashed = false, legs = false } = {}) {
    const { ctx } = this;
    const [ax, ay] = this.toScreen(...p);
    const [bx, by] = this.toScreen(...q);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    if (legs) {
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
    [[ax, ay], [bx, by]].forEach(([x, y]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    if (text) this.label(text, (ax + bx) / 2, (ay + by) / 2 - 12, color);
  }

  // Resalta una forma elegida para medir.
  strokeShape(shape, color) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.9;
    if (shape.line) {
      const rad = (shape.line.angle * Math.PI) / 180;
      const [ax, ay] = this.toScreen(shape.line.x - Math.cos(rad) * 1e5, shape.line.y - Math.sin(rad) * 1e5);
      const [bx, by] = this.toScreen(shape.line.x + Math.cos(rad) * 1e5, shape.line.y + Math.sin(rad) * 1e5);
      ctx.beginPath();
      ctx.moveTo(Math.max(-1e5, Math.min(1e5, ax)), Math.max(-1e5, Math.min(1e5, ay)));
      ctx.lineTo(Math.max(-1e5, Math.min(1e5, bx)), Math.max(-1e5, Math.min(1e5, by)));
      ctx.stroke();
    } else {
      ctx.beginPath();
      shape.pts.forEach(([x, y], i) => {
        const [sx, sy] = this.toScreen(x, y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (shape.closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Distancia mínima entre dos picks (forma o punto): { d, p, q, overlap } con p en a y q en b.
  gapBetween(a, b) {
    if (a.kind === 'point' && b.kind === 'point') return { d: Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]), p: a.p, q: b.p, overlap: false };
    if (a.kind === 'point') {
      const hit = nearestOnShape(a.p, b.shape);
      return hit ? { d: hit.d, p: a.p, q: hit.q, overlap: false } : null;
    }
    if (b.kind === 'point') {
      const hit = nearestOnShape(b.p, a.shape);
      return hit ? { d: hit.d, p: hit.q, q: b.p, overlap: false } : null;
    }
    return distanceBetween(a.shape, b.shape);
  }

  // Herramienta Distancia: mínima distancia entre dos objetos (o un punto y un objeto), con Δx y Δy entre los puntos más cercanos.
  drawGap() {
    const g = this.gap;
    if (this.tool !== 'gap') return;
    const u = this.unit;
    if (!g) {
      if (this.hover) this.hoverPick = this.pickForGap(this.hover[0], this.hover[1], false);
      if (this.hoverPick?.kind === 'shape') this.strokeShape(this.hoverPick.shape, 'rgba(255,210,77,0.45)');
      return;
    }
    const aColor = colors.measure;
    if (g.a.kind === 'shape') this.strokeShape(g.a.shape, aColor);
    let b = g.b;
    if (!b && this.hover) b = this.pickForGap(this.hover[0], this.hover[1], this.shiftDown);
    if (!b) {
      if (g.a.kind === 'point') this.drawDistanceLine(g.a.p, g.a.p, '', aColor);
      return;
    }
    if (b.kind === 'shape') this.strokeShape(b.shape, g.fixed ? aColor : 'rgba(255,210,77,0.55)');
    const r = this.gapBetween(g.a, b);
    if (!r) return;
    if (r.overlap) {
      const mid = r.p;
      const [sx, sy] = this.toScreen(...mid);
      this.label('0 · se tocan o se superponen', sx, sy - 12, colors.bad);
      return;
    }
    const dx = r.q[0] - r.p[0];
    const dy = r.q[1] - r.p[1];
    this.drawDistanceLine(r.p, r.q, `${formatUnit(r.d, u)} ${u}  ·  Δx ${formatUnit(Math.abs(dx), u)}  Δy ${formatUnit(Math.abs(dy), u)}`, aColor, { legs: Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9 });
  }

  // Al dibujar: distancia perpendicular del cursor a lo más cercano (borde, guía o referencia) para ubicar el próximo punto.
  drawProximity() {
    if (!this.distOn || !this.hover || ['select', 'measure', 'gap'].includes(this.tool)) return;
    const shapes = this.shapes();
    if (!shapes.length) return;
    const hit = nearestShape(this.hover, shapes);
    if (!hit || hit.d < 1e-6 || hit.d * this.view.scale > 420) return;
    const text = `⊥ ${formatUnit(hit.d, this.unit)} ${this.unit}`;
    this.drawDistanceLine(this.hover, hit.q, text, colors.align, { dashed: true });
    // si el vértice más cercano está bastante más cerca que el borde proyectado no se agrega nada: el imán ya lo marca
  }

  drawMeasure() {
    const m = this.measure;
    if (!m) return;
    const b = m.b ?? this.hover;
    if (!b) return;
    const { ctx } = this;
    const [ax, ay] = this.toScreen(...m.a);
    const [bx, by] = this.toScreen(...b);
    ctx.save();
    ctx.strokeStyle = colors.measure;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
    [[ax, ay], [bx, by]].forEach(([x, y]) => {
      ctx.fillStyle = colors.measure;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    const dx = b[0] - m.a[0];
    const dy = b[1] - m.a[1];
    const dist = Math.hypot(dx, dy);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const u = this.unit;
    this.label(`${formatUnit(dist, u)} ${u}  ·  Δx ${formatUnit(dx, u)}  Δy ${formatUnit(dy, u)}  ·  ${Math.round(angle * 100) / 100}°`, (ax + bx) / 2, (ay + by) / 2 - 14, colors.measure);
  }
}
