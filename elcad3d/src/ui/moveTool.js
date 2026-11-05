// Mover cuerpos con el ratón en el visor: clic = elegir (Mayús suma/quita), arrastrar = mover sobre el eje o plano elegido en el panel.
// Mientras se arrastra: imanes a caras, centros y origen de los demás cuerpos (Alt los apaga), cotas de distancia libre a los vecinos y
// el desplazamiento. Al soltar se confirma de una vez por `hooks.onCommit` (un solo paso de historial).
// hooks: { isActive(), getSelected() → ids, setSelected(ids), getMode(), itemIdsOf(id) → [itemId], optionOf(itemId) → { id, label }|null, onCommit(ids, delta) }
import { boxCenter, dragDelta, dragModes, neighbourGaps, snapMove, translateBox } from '../core/moveSnap.js';

const fmt = (value) => (Math.round(value * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const signed = (value) => `${value >= 0 ? '+' : '−'}${fmt(Math.abs(value))}`;
const kindText = { min: 'cara mín', max: 'cara máx', center: 'centro', origen: 'origen' };
const axisNames = ['X', 'Y', 'Z'];

export class MoveTool {
  constructor(viewer, hooks) {
    this.viewer = viewer;
    this.hooks = hooks;
    this.drag = null;
    this.hover = null;
    this.down = null;
    const canvas = viewer.canvas;
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event), true);
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.drag) this.cancel(); });
    viewer.meshListeners.push(() => this.refresh());
  }

  get active() { return this.hooks.isActive(); }

  // Reaplica el resaltado (después de reconstruir las mallas o cambiar la selección).
  refresh() {
    if (!this.active) { this.viewer.setItemHighlight([], null); return; }
    const ids = this.hooks.getSelected().flatMap((id) => this.hooks.itemIdsOf(id));
    this.viewer.setItemHighlight(ids, this.hover);
  }

  optionIdOf(itemId) { return itemId === null ? null : this.hooks.optionOf(itemId)?.id ?? null; }

  boxesOf(itemIds) {
    const boxes = this.viewer.items.filter((item) => itemIds.includes(item.id) && item.bounds).map((item) => item.bounds);
    if (!boxes.length) return null;
    return { min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))), max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) };
  }

  pointerDown(event) {
    if (!this.active || event.button !== 0) return;
    const itemId = this.viewer.pickItem(event);
    const optionId = this.optionIdOf(itemId);
    this.down = { x: event.clientX, y: event.clientY, optionId, shift: event.shiftKey, moved: false };
    if (!optionId) return; // vacío o cuerpo que no se puede mover: el visor sigue girando la cámara
    event.stopImmediatePropagation();
    this.viewer.controls.enabled = false;
    this.viewer.canvas.setPointerCapture(event.pointerId);
    let selected = this.hooks.getSelected();
    if (event.shiftKey) {
      this.hooks.setSelected(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]);
      this.down.handled = true;
      return;
    }
    if (!selected.includes(optionId)) { selected = [optionId]; this.hooks.setSelected(selected); }
    const itemIds = selected.flatMap((id) => this.hooks.itemIdsOf(id));
    const box = this.boxesOf(itemIds);
    if (!box) return;
    this.drag = { itemIds, selected, box, center: boxCenter(box), startRay: this.viewer.rayFromEvent(event), delta: [0, 0, 0] };
  }

  pointerMove(event) {
    if (this.drag) return this.dragMove(event);
    if (!this.active || event.buttons) return;
    const itemId = this.viewer.pickItem(event);
    const hover = this.optionIdOf(itemId) ? itemId : null;
    if (hover !== this.hover) {
      this.hover = hover;
      this.viewer.canvas.style.cursor = hover ? 'move' : '';
      this.refresh();
    }
  }

  dragMove(event) {
    const drag = this.drag;
    if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 4 && !this.down.moved) return;
    if (this.down) this.down.moved = true;
    const mode = this.hooks.getMode();
    const spec = dragModes[mode] ?? dragModes.z;
    const raw = dragDelta(mode, drag.startRay, this.viewer.rayFromEvent(event), drag.center);
    if (!raw) return;
    const others = this.viewer.items
      .filter((item) => item.bounds && !drag.itemIds.includes(item.id))
      .map((item) => ({ id: item.id, name: this.hooks.optionOf(item.id)?.label ?? 'el resto de la pieza', min: item.bounds.min, max: item.bounds.max }));
    const tol = event.altKey ? 0 : 8 * this.viewer.unitsPerPixel(drag.center);
    const snapped = snapMove({ box: drag.box, delta: raw.map((v, i) => (spec.axes[i] ? Math.round(v * 100) / 100 : 0)), axes: spec.axes, others, tol });
    const delta = snapped.delta.map((v, i) => (spec.axes[i] ? Math.round(v * 1000) / 1000 : 0));
    drag.delta = delta;
    this.viewer.setBodyPose(drag.itemIds, { axis: [0, 0, 1], pivot: [0, 0, 0], angle: 0, offset: delta });
    this.drawGuides(drag, snapped.snaps, others, spec, delta);
  }

  drawGuides(drag, snaps, others, spec, delta) {
    const moved = translateBox(drag.box, delta);
    const lines = [];
    const labels = [];
    snaps.forEach((snap) => {
      // rectángulo punteado en el plano de alineación, del tamaño de los dos cuerpos
      const [u, v] = [0, 1, 2].filter((a) => a !== snap.axis);
      const boxes = snap.box ? [moved, snap.box] : [moved];
      const pad = 8;
      const lo = (a) => Math.min(...boxes.map((b) => b.min[a])) - pad;
      const hi = (a) => Math.max(...boxes.map((b) => b.max[a])) + pad;
      const corner = (cu, cv) => { const p = [0, 0, 0]; p[snap.axis] = snap.value; p[u] = cu; p[v] = cv; return p; };
      lines.push({ points: [corner(lo(u), lo(v)), corner(hi(u), lo(v)), corner(hi(u), hi(v)), corner(lo(u), hi(v)), corner(lo(u), lo(v))], color: 0x5ad1c5, dashed: true });
      labels.push({ p: corner((lo(u) + hi(u)) / 2, hi(v)), text: `${axisNames[snap.axis]}: ${kindText[snap.mine]} ↔ ${kindText[snap.theirs]} de ${snap.target}`, color: '#5ad1c5' });
    });
    // distancias libres a los vecinos en los ejes que se mueven
    neighbourGaps({ box: moved, others, axes: spec.axes }).forEach((gap) => {
      const tick = (p, along) => { const a = [0, 1, 2].find((i) => i !== gap.axis && i !== along); const q1 = [...p]; const q2 = [...p]; q1[a] -= 3; q2[a] += 3; return [q1, q2]; };
      lines.push({ points: [gap.from, gap.to], color: 0xffd24d }, { points: tick(gap.from, gap.axis), color: 0xffd24d }, { points: tick(gap.to, gap.axis), color: 0xffd24d });
      labels.push({ p: gap.from.map((v, i) => (v + gap.to[i]) / 2), text: `${fmt(gap.gap)} mm → ${gap.target}`, color: '#ffd24d' });
    });
    const where = boxCenter(moved);
    where[2] = moved.max[2] + 6;
    labels.push({ p: where, text: [0, 1, 2].filter((i) => spec.axes[i]).map((i) => `Δ${axisNames[i]} ${signed(delta[i])}`).join(' · ') + ' mm', color: '#ffffff' });
    this.viewer.showGuides({ lines, labels });
  }

  cancel() {
    if (!this.drag) return;
    this.viewer.setBodyPose(this.drag.itemIds, { axis: [0, 0, 1], pivot: [0, 0, 0], angle: 0, offset: [0, 0, 0] });
    this.viewer.clearGuides();
    this.drag = null;
    this.viewer.controls.enabled = true;
  }

  async pointerUp(event) {
    const drag = this.drag;
    const down = this.down;
    this.down = null;
    if (drag) {
      this.drag = null;
      this.viewer.controls.enabled = true;
      try { this.viewer.canvas.releasePointerCapture(event.pointerId); } catch { /* ya liberado */ }
      this.viewer.clearGuides();
      if (down?.moved && drag.delta.some((v) => v !== 0)) await this.hooks.onCommit(drag.selected, drag.delta);
      else this.viewer.setBodyPose(drag.itemIds, { axis: [0, 0, 1], pivot: [0, 0, 0], angle: 0, offset: [0, 0, 0] });
      return;
    }
    this.viewer.controls.enabled = true;
    // clic en el vacío (sin arrastrar la cámara): se deselecciona todo
    if (this.active && down && !down.optionId && !down.shift && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4 && this.hooks.getSelected().length) this.hooks.setSelected([]);
  }
}
