/**
 * Turns touch and pen Pointer Events on one of Explore's pano layers into taps, drags and pinches (#5664).
 *
 * Mouse input is deliberately not handled here: Canvas keeps its mouse listeners, so the desktop path is unchanged.
 * Cancelling a touch `pointerdown` is what stops the browser from replaying the touch as mouse events afterwards; a
 * replayed mouseup would otherwise place a second label on the same tap. Browsers that replay them anyway are caught
 * by `isCompatMouseEvent`, which Canvas checks at the top of each mouse handler.
 *
 * @example
 * const input = new PointerInput(layer, {
 *   onTap: ({ clientX, clientY }) => placeLabel(clientX, clientY),
 *   onDrag: ({ dx, dy }) => pan(dx, dy),           // dx/dy in CSS px since the previous move
 *   onPinch: ({ zoomDelta }) => zoomBy(zoomDelta),  // log2 of the finger spread since the pinch began
 * });
 */
export class PointerInput {
  // How far a finger may wander, in CSS px, and still count as a tap. Validate's touch markers use about the same.
  static TAP_SLOP_PX = 10;

  // How long after a touch the browser may still deliver the mouse events it replays from it (`click` lands within
  // ~300 ms on every engine measured for PanoMarker's equivalent guard).
  static COMPAT_MOUSE_WINDOW_MS = 800;

  #layer;
  #handlers;
  /** @type {Map<number, {startX: number, startY: number, lastX: number, lastY: number, moved: boolean}>} */
  #pointers = new Map();
  #pinch = null;
  #lastTouchTime = -Infinity;
  #lastPointerType = 'mouse';

  /**
   * @param {HTMLElement} layer - The element whose pointers are tracked.
   * @param {object} handlers - Callbacks; each is optional.
   * @param {(p: {clientX: number, clientY: number, pointerType: string}) => void} [handlers.onDown] - A finger or pen
   *   touched down (also the second finger of a pinch).
   * @param {(p: {clientX: number, clientY: number, pointerType: string}) => void} [handlers.onTap] - Lifted without
   *   moving further than TAP_SLOP_PX and without a pinch in between.
   * @param {(p: {pointerType: string}) => void} [handlers.onDragStart] - The first move past the slop.
   * @param {(p: {dx: number, dy: number, clientX: number, clientY: number}) => void} [handlers.onDrag] - CSS px since
   *   the previous move.
   * @param {(p: {clientX: number, clientY: number, pointerType: string}) => void} [handlers.onDragEnd] - Lifted after
   *   a drag, or the browser cancelled it.
   * @param {() => void} [handlers.onPinchStart] - A second finger went down.
   * @param {(p: {zoomDelta: number, dx: number, dy: number}) => void} [handlers.onPinch] - `zoomDelta` is
   *   log2(spread / spread at start); dx/dy move the centroid since the previous event.
   * @param {() => void} [handlers.onPinchEnd] - Fewer than two fingers remain.
   */
  constructor(layer, handlers) {
    this.#layer = layer;
    this.#handlers = handlers;
    layer.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    layer.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    layer.addEventListener('pointerup', (e) => this.#onPointerEnd(e, false));
    layer.addEventListener('pointercancel', (e) => this.#onPointerEnd(e, true));
    // An Android long press opens the browser's menu over the pano; a right click with a mouse still should.
    layer.addEventListener('contextmenu', (e) => {
      if (this.#lastPointerType !== 'mouse') e.preventDefault();
    });
  }

  /**
   * Whether a mouse event is the browser replaying a recent touch rather than a real mouse.
   * @param {MouseEvent} e
   * @returns {boolean}
   */
  isCompatMouseEvent(e) {
    return e.timeStamp - this.#lastTouchTime < PointerInput.COMPAT_MOUSE_WINDOW_MS;
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} Whether this pointer is ours to handle (touch or pen).
   */
  #isTouchLike(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  /** @param {PointerEvent} e */
  #onPointerDown(e) {
    this.#lastPointerType = e.pointerType;
    if (!this.#isTouchLike(e)) return;
    // Suppresses the mouse events the browser would replay from this touch (Pointer Events §11).
    e.preventDefault();
    this.#lastTouchTime = e.timeStamp;
    // A primary pointer means no other finger is down, so anything still tracked lost its pointerup somewhere else.
    if (e.isPrimary) {
      this.#pointers.clear();
      this.#pinch = null;
    }
    this.#pointers.set(e.pointerId, {
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false,
    });
    this.#handlers.onDown?.({ clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });

    if (this.#pointers.size === 2) {
      // A second finger turns whatever the first was doing into a pinch; neither finger can end as a tap.
      for (const p of this.#pointers.values()) p.moved = true;
      this.#pinch = this.#pinchGeometry();
      this.#capture(e.pointerId);
      this.#handlers.onPinchStart?.();
    }
  }

  /** @param {PointerEvent} e */
  #onPointerMove(e) {
    const p = this.#pointers.get(e.pointerId);
    if (!p) return;
    this.#lastTouchTime = e.timeStamp;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;

    if (this.#pinch) {
      if (this.#pointers.size < 2) return;
      const now = this.#pinchGeometry();
      this.#handlers.onPinch?.({
        zoomDelta: Math.log2(now.spread / this.#pinch.spread),
        dx: now.x - this.#pinch.lastX,
        dy: now.y - this.#pinch.lastY,
      });
      this.#pinch.lastX = now.x;
      this.#pinch.lastY = now.y;
      return;
    }

    if (!p.moved) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= PointerInput.TAP_SLOP_PX) return;
      p.moved = true;
      // Captured only once it is a drag: a tap left uncaptured keeps its own target, so a tap on a nav arrow inside the
      // layer still delivers that arrow its click.
      this.#capture(e.pointerId);
      this.#handlers.onDragStart?.({ pointerType: e.pointerType });
    }
    this.#handlers.onDrag?.({ dx, dy, clientX: e.clientX, clientY: e.clientY });
  }

  /**
   * @param {PointerEvent} e
   * @param {boolean} cancelled - The browser took the gesture over (e.g. a system edge swipe); never a tap.
   */
  #onPointerEnd(e, cancelled) {
    const p = this.#pointers.get(e.pointerId);
    if (!p) return;
    this.#lastTouchTime = e.timeStamp;
    this.#pointers.delete(e.pointerId);
    this.#release(e.pointerId);
    const where = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };

    if (this.#pinch) {
      if (this.#pointers.size < 2) {
        this.#pinch = null;
        this.#handlers.onPinchEnd?.();
      }
      return;
    }
    if (p.moved) this.#handlers.onDragEnd?.(where);
    else if (!cancelled) this.#handlers.onTap?.(where);
  }

  /** @returns {{x: number, y: number, spread: number, lastX: number, lastY: number}} Centroid and finger distance. */
  #pinchGeometry() {
    const [a, b] = [...this.#pointers.values()];
    const x = (a.lastX + b.lastX) / 2;
    const y = (a.lastY + b.lastY) / 2;
    return { x, y, spread: Math.max(1, Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY)), lastX: x, lastY: y };
  }

  /** @param {number} pointerId */
  #capture(pointerId) {
    try {
      this.#layer.setPointerCapture(pointerId);
    } catch {
      // The pointer is already gone, or the browser (jsdom) has no capture; the gesture still works within the layer.
    }
  }

  /** @param {number} pointerId */
  #release(pointerId) {
    try {
      if (this.#layer.hasPointerCapture?.(pointerId)) this.#layer.releasePointerCapture(pointerId);
    } catch {
      // Already released.
    }
  }
}
