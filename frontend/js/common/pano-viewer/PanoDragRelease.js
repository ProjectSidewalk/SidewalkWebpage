/**
 * Makes sure a pano viewer hears the end of every mouse drag that starts on it, wherever the button is released
 * (#5295, and the Infra3D half of #5294).
 *
 * The label card lays its paging arrows and vote buttons over the imagery, and disables them as it pages. Browsers
 * never dispatch `mousedown`/`mouseup`/`click` to a disabled form control (pointer events still go through), so a
 * drag released over a disabled arrow ended without the `mouseup` that GSV, Panoramax (PSV), Pannellum and panzoom
 * wait for, and the pano kept panning. Infra3D's viewer listens for pointer events on its own canvas without
 * capturing the pointer, so a release anywhere off the canvas went unnoticed there too.
 *
 * Two measures, both scoped to one press of the primary button by a mouse or pen:
 *
 * 1. Pointer capture on the element pressed. Every later pointer event of the press, and in Chrome and Firefox the
 *    compatibility mouse events too, is then targeted at the viewer's own element, so neither a disabled control nor
 *    a release off the canvas can take the release away from it.
 * 2. A synthetic release, only when the native one is missing. When the viewer is mouse-driven (the press produced a
 *    `mousedown`) and no `mouseup` follows the `pointerup` within the same task, one is dispatched on the pressed
 *    element; bubbling carries it to whichever level the library listens at (element, document or window). A press
 *    that loses its release entirely (the window blurred, or the button is seen up on a later move) also gets a
 *    synthetic `pointerup` for pointer-driven viewers. A library receiving a release it did not pair with a press of
 *    its own ignores it, the same as a press outside the viewer and a release over it.
 *
 * Touch is left alone: viewers end touch drags on `touchend`, which no form control suppresses.
 *
 * Whether a drag should instead end when the pointer leaves the frame is an open question (#5294); this module only
 * makes the existing "release ends the drag" rule hold.
 *
 * @example
 * const dispose = watchPanoDragRelease(svHolder); // Once, before or after the viewer is built inside svHolder.
 * dispose(); // Stops watching; a press in progress is left to the browser.
 */

/** Elements whose own press and release must not be redirected to themselves by pointer capture. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [contenteditable]';

/**
 * Watches `holder` for drags of the primary mouse/pen button and guarantees the viewer inside it sees the release.
 *
 * @param {HTMLElement} holder - The element the viewer (and any fallback viewer) is mounted in.
 * @returns {() => void} Stops watching.
 */
export function watchPanoDragRelease(holder) {
  /** The press being tracked, if any. @type {?{flush: () => void, dispose: () => void}} */
  let current = null;

  /**
   * Arms one press. Registered in the capture phase so a viewer that stops propagation can't hide the press from it.
   * @param {PointerEvent} e
   */
  const onPointerDown = (e) => {
    // A press before the last one resolved means that release was lost; settle it before the new drag begins.
    current?.flush();
    current = null;

    if ((e.pointerType ?? 'mouse') === 'touch' || e.button !== 0 || e.isPrimary === false) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(INTERACTIVE)) return;
    current = trackPress(target, e);
  };

  holder.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    holder.removeEventListener('pointerdown', onPointerDown, true);
    current?.dispose();
    current = null;
  };
}

/**
 * Follows one press from `pointerdown` to its release, capturing the pointer and filling in a missing release.
 *
 * @param {Element} target - The element pressed: the viewer's own canvas or div.
 * @param {PointerEvent} down - The `pointerdown` that started the press.
 * @returns {{flush: () => void, dispose: () => void}} `flush` settles the press now, as if its release were lost if
 *     none has arrived; `dispose` drops it without dispatching anything.
 */
function trackPress(target, down) {
  const pointerId = down.pointerId;
  const pointerType = down.pointerType ?? 'mouse';
  let last = { clientX: down.clientX ?? 0, clientY: down.clientY ?? 0 };
  // The compatibility mouse events this press produced. No `mousedown` means the viewer cancelled the pointerdown
  // (Infra3D and Mapillary do) or never wanted mouse events, so no mouse-driven drag exists to end.
  let sawMouseDown = false;
  let sawMouseUp = false;
  let released = false; // A pointerup/pointercancel arrived, or the release was declared lost.
  let pendingCheck = null; // Timer that decides, after the release's task, whether a mouseup is missing.

  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // An unknown or already-ended pointer (a synthetic event); the synthetic release below still covers it.
  }

  const onMouseDown = () => {
    if (!released) sawMouseDown = true;
  };
  const onMouseUp = () => {
    sawMouseUp = true;
  };
  const onPointerEnd = (ev) => {
    last = coords(ev);
    release(false);
  };
  const onPointerMove = (ev) => {
    last = coords(ev);
    // The primary button is up although no pointerup came: it was released outside the window, or over something
    // that swallowed it.
    if ((ev.buttons & 1) === 0) release(true);
  };
  const onBlur = () => release(true);

  // Window capture listeners run before any other, so a mouseup can't be hidden from them by stopPropagation.
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  document.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('blur', onBlur);

  /** Stops listening for the pointer's end. */
  const unlistenPointer = () => {
    document.removeEventListener('pointerup', onPointerEnd, true);
    document.removeEventListener('pointercancel', onPointerEnd, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('blur', onBlur);
  };

  /** Stops listening for mouse events. */
  const unlistenMouse = () => {
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  };

  /**
   * Dispatches the `mouseup` the browser withheld, unless the native one arrived. Removes its own listeners first,
   * so neither its event nor anything that event triggers is counted as the native release.
   */
  const settle = () => {
    if (pendingCheck !== null) clearTimeout(pendingCheck);
    pendingCheck = null;
    unlistenMouse();
    if (sawMouseDown && !sawMouseUp) {
      target.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, composed: true, view: window,
        button: 0, buttons: 0, clientX: last.clientX, clientY: last.clientY,
      }));
    }
  };

  /**
   * Ends the press. A native release is followed in the same task by its mouseup (if the browser sends one), so the
   * check waits one task; a lost release has no native events coming, so the viewer is told directly.
   * @param {boolean} lost - True when no pointerup reached the page for this press.
   */
  const release = (lost) => {
    if (released) return;
    released = true;
    unlistenPointer();
    if (lost) {
      try {
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // The pointer is already gone; nothing is holding capture.
      }
      // Pointer-driven viewers (Infra3D) end the drag on a pointerup at their element.
      target.dispatchEvent(pointerEvent('pointerup', { pointerId, pointerType, ...last }));
      settle();
    } else {
      pendingCheck = setTimeout(settle, 0);
    }
  };

  return {
    flush: () => {
      if (!released) release(true);
      else if (pendingCheck !== null) settle();
    },
    dispose: () => {
      if (pendingCheck !== null) clearTimeout(pendingCheck);
      pendingCheck = null;
      released = true;
      unlistenPointer();
      unlistenMouse();
    },
  };
}

/**
 * @param {MouseEvent} ev
 * @returns {{clientX: number, clientY: number}} The event's viewport position, zero where it has none (blur).
 */
function coords(ev) {
  return { clientX: ev.clientX ?? 0, clientY: ev.clientY ?? 0 };
}

/**
 * Builds a bubbling pointer event for the primary button's release, as a MouseEvent where PointerEvent is missing.
 * @param {string} type
 * @param {{pointerId: number, pointerType: string, clientX: number, clientY: number}} init
 * @returns {MouseEvent}
 */
function pointerEvent(type, init) {
  /** @type {PointerEventInit} */
  const eventInit = {
    bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 0, isPrimary: true, ...init,
  };
  return typeof PointerEvent === 'function' ? new PointerEvent(type, eventInit) : new MouseEvent(type, eventInit);
}
