// Gestos táctiles para lienzos 2D (boceto, plano).
// Tocar = clic · un dedo arrastrando = mover la vista (o mover lo seleccionado si el lienzo lo permite)
// · dos dedos = zoom + desplazamiento. Mover o ampliar la vista nunca modifica la geometría.
// Solo atiende pointerType 'touch': mouse y lápiz siguen el camino de siempre.

export const tapSlopPx = 10;
export const doubleTapMs = 320;
export const doubleTapPx = 30;

export function createTouchGestures(target, handlers) {
  const pointers = new Map();
  let single = null; // { id, start, last, mode: 'pending' | 'pan' | 'drag', down }
  let multi = false; // hubo dos o más dedos: se ignora el resto hasta levantarlos todos
  let pair = null; // { cx, cy, dist } del gesto de dos dedos
  let lastTap = null;

  const isTouch = (event) => event.pointerType === 'touch';
  const synth = (event) => ({
    clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: 'touch', target: event.target,
    button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {},
  });
  const metrics = () => {
    const [a, b] = [...pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };
  const cancelSingle = () => {
    if (single?.mode === 'drag') handlers.onDragCancel?.();
    single = null;
  };

  function onDown(event) {
    if (!isTouch(event)) return;
    event.stopImmediatePropagation();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { target.setPointerCapture?.(event.pointerId); } catch { /* puntero ya liberado */ }
    if (pointers.size === 1 && !multi) {
      single = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, last: { x: event.clientX, y: event.clientY }, mode: 'pending', down: synth(event) };
    } else if (pointers.size >= 2) {
      cancelSingle();
      if (!multi) handlers.onGestureStart?.();
      multi = true;
      pair = metrics();
    }
  }

  function onMove(event) {
    if (!isTouch(event) || !pointers.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (multi) {
      if (pointers.size < 2 || !pair) return;
      const now = metrics();
      handlers.onPinch?.({ cx: now.cx, cy: now.cy, dx: now.cx - pair.cx, dy: now.cy - pair.cy, scale: now.dist / pair.dist });
      pair = now;
      return;
    }
    if (!single || single.id !== event.pointerId) return;
    if (single.mode === 'pending') {
      if (Math.hypot(event.clientX - single.start.x, event.clientY - single.start.y) <= tapSlopPx) return;
      if (handlers.canDrag?.(single.down)) {
        single.mode = 'drag';
        handlers.onDragStart?.(single.down);
      } else {
        single.mode = 'pan';
        single.last = { ...single.start };
      }
    }
    if (single.mode === 'drag') handlers.onDragMove?.(synth(event));
    else {
      handlers.onPan?.(event.clientX - single.last.x, event.clientY - single.last.y);
      single.last = { x: event.clientX, y: event.clientY };
    }
  }

  function finish(event, cancelled) {
    if (!isTouch(event) || !pointers.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    pointers.delete(event.pointerId);
    if (single && single.id === event.pointerId) {
      const { mode } = single;
      single = null;
      if (mode === 'drag') cancelled ? handlers.onDragCancel?.() : handlers.onDragEnd?.(synth(event));
      else if (mode === 'pending' && !cancelled) {
        const tap = synth(event);
        const now = Date.now();
        const second = lastTap && now - lastTap.t <= doubleTapMs && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= doubleTapPx;
        handlers.onTap?.(tap);
        if (second) { handlers.onDoubleTap?.(tap); lastTap = null; } else lastTap = { t: now, x: event.clientX, y: event.clientY };
      }
    }
    if (multi && pointers.size < 2) pair = null;
    if (pointers.size === 0) {
      if (multi) handlers.onGestureEnd?.();
      multi = false;
      single = null;
    }
  }

  const onUp = (event) => finish(event, false);
  const onCancel = (event) => finish(event, true);
  const listeners = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel]];
  for (const [name, fn] of listeners) target.addEventListener(name, fn, true);
  return {
    get active() { return pointers.size > 0; },
    dispose() { for (const [name, fn] of listeners) target.removeEventListener(name, fn, true); pointers.clear(); single = null; multi = false; },
  };
}
