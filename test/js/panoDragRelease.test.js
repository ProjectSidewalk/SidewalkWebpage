/**
 * Tests for watchPanoDragRelease (frontend/js/common/pano-viewer/PanoDragRelease.js, #5295 and the Infra3D half of
 * #5294).
 *
 * A drag on the label card's pano released over one of its disabled overlay buttons never produced the `mouseup` the
 * viewer ends a drag on, because browsers don't dispatch mouse events to a disabled form control; and Infra3D, which
 * listens for pointer events on its canvas alone, missed any release off the canvas. The module captures the pointer
 * on the pressed element and fills in a release only when the browser's own is missing.
 *
 * jsdom implements neither PointerEvent nor pointer capture, and doesn't suppress events on disabled controls, so the
 * browser is modelled here: pointer events are MouseEvents with the pointer fields defined on them, capture is a spy
 * on Element.prototype, and a "swallowed" release is a `pointerup` with no `mouseup` after it.
 */

const { loadModules } = require('./loadGlobalScript');

/**
 * A pointer event as a browser would send it. jsdom has no PointerEvent, so the pointer-only fields are defined on a
 * MouseEvent; `pointerType: undefined` leaves the field off, as a browser without PointerEvent would.
 * @param {string} type
 * @param {object} [init]
 * @returns {MouseEvent}
 */
function ptr(type, init = {}) {
  const { pointerType = 'mouse', pointerId = 1, isPrimary = true, ...mouse } = init;
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...mouse });
  if ('pointerType' in init && init.pointerType === undefined) return ev;
  Object.defineProperties(ev, {
    pointerType: { value: pointerType }, pointerId: { value: pointerId }, isPrimary: { value: isPrimary },
  });
  return ev;
}

/** The browser's compatibility mouse event that follows a pointer event. */
const mouse = (el, type, init = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

/** One macrotask, past the module's same-task wait for a native mouseup. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchPanoDragRelease', () => {
  let watchPanoDragRelease;
  let dispose;
  let holder;
  let canvas;
  let arrow;
  let arrowIcon;
  let mouseups;
  let docLib;
  let containerLib;
  let pointerLib;
  let captures;
  let listeners; // Aborts the suite's own window/document listeners, which outlive each test's DOM.

  beforeEach(() => {
    listeners = new AbortController();
    const { signal } = listeners;
    // Mirrors the card: the paging arrow is a sibling of the viewer's holder inside the pano wrap.
    document.body.innerHTML = `
      <div class="label-detail__pano-wrap">
        <button type="button" class="label-detail__paging" disabled><svg id="arrow-icon"></svg></button>
        <div id="sv-holder"><div id="pano"><div id="canvas"></div></div>
          <a id="cta" href="#">Explore this street</a></div>
      </div>
      <div id="elsewhere"></div>`;
    holder = document.getElementById('sv-holder');
    canvas = document.getElementById('canvas');
    arrow = document.querySelector('.label-detail__paging');
    arrowIcon = document.getElementById('arrow-icon');

    captures = [];
    Element.prototype.setPointerCapture = function setPointerCapture(id) { captures.push({ el: this, id }); };
    Element.prototype.hasPointerCapture = function hasPointerCapture(id) {
      return captures.some((c) => c.el === this && c.id === id);
    };
    Element.prototype.releasePointerCapture = function releasePointerCapture(id) {
      captures = captures.filter((c) => !(c.el === this && c.id === id));
    };

    // Every mouseup on the page, first in line.
    mouseups = [];
    window.addEventListener('mouseup', (e) => mouseups.push(e), { capture: true, signal });

    // A mouse-driven library ending its drag on a document mouseup: GSV, PSV (window), Pannellum, panzoom. An
    // unpaired mouseup is a no-op, as in all of them.
    docLib = { dragging: false, ends: 0 };
    canvas.addEventListener('mousedown', () => { docLib.dragging = true; });
    document.addEventListener('mouseup', () => {
      if (docLib.dragging) docLib.ends += 1;
      docLib.dragging = false;
    }, { signal });
    // The same, listening on its own container only.
    containerLib = { dragging: false };
    document.getElementById('pano').addEventListener('mousedown', () => { containerLib.dragging = true; });
    document.getElementById('pano').addEventListener('mouseup', () => { containerLib.dragging = false; });
    // Infra3D: pointer events on its canvas, no capture of its own.
    pointerLib = { dragging: false };
    canvas.addEventListener('pointerdown', () => { pointerLib.dragging = true; });
    canvas.addEventListener('pointerup', () => { pointerLib.dragging = false; });

    ({ watchPanoDragRelease } = loadModules('frontend/js/common/pano-viewer/PanoDragRelease.js'));
    dispose = watchPanoDragRelease(holder);
  });

  afterEach(() => {
    dispose();
    listeners.abort();
    delete Element.prototype.setPointerCapture;
    delete Element.prototype.hasPointerCapture;
    delete Element.prototype.releasePointerCapture;
  });

  /** A press on the canvas as a mouse makes it: pointerdown, then its compatibility mousedown. */
  const pressCanvas = (init = {}) => {
    canvas.dispatchEvent(ptr('pointerdown', init));
    mouse(canvas, 'mousedown', { button: init.button ?? 0 });
  };

  test('a press captures the pointer on the element pressed', () => {
    canvas.dispatchEvent(ptr('pointerdown', { pointerId: 7 }));
    expect(captures).toEqual([{ el: canvas, id: 7 }]);
  });

  test('a release over a disabled arrow, which gets no mouseup, gets exactly one synthetic one at the canvas',
    async () => {
      pressCanvas({ clientX: 10, clientY: 20 });
      arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0, clientX: 30, clientY: 40 }));
      expect(mouseups).toHaveLength(0); // Not before the release's task is over.

      await nextTask();
      expect(mouseups).toHaveLength(1);
      const [up] = mouseups;
      expect(up.target).toBe(canvas);
      expect(up.bubbles).toBe(true);
      expect([up.button, up.buttons, up.clientX, up.clientY]).toEqual([0, 0, 30, 40]);
      expect(docLib).toEqual({ dragging: false, ends: 1 });
      expect(containerLib.dragging).toBe(false);
    });

  test('a native mouseup after the pointerup means no synthetic one, wherever it lands', async () => {
    pressCanvas();
    arrow.disabled = false;
    arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    mouse(arrowIcon, 'mouseup');
    await nextTask();
    expect(mouseups).toHaveLength(1);
    expect(mouseups[0].target).toBe(arrowIcon);
    expect(docLib.ends).toBe(1);

    pressCanvas();
    canvas.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    mouse(canvas, 'mouseup');
    await nextTask();
    expect(mouseups).toHaveLength(2);
    expect(docLib.ends).toBe(2);
  });

  test('a viewer that cancelled its pointerdown (no mousedown) gets no synthetic mouseup', async () => {
    canvas.dispatchEvent(ptr('pointerdown'));
    arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    await nextTask();
    expect(mouseups).toHaveLength(0);
  });

  test('pointercancel ends a mouse-driven drag with one synthetic mouseup', async () => {
    pressCanvas();
    document.dispatchEvent(ptr('pointercancel', { buttons: 0 }));
    await nextTask();
    expect(mouseups).toHaveLength(1);
    expect(docLib.dragging).toBe(false);
  });

  test('a window blur mid-drag releases the pointer and ends both kinds of viewer at once', () => {
    pressCanvas();
    window.dispatchEvent(new Event('blur'));
    expect(mouseups).toHaveLength(1);
    expect(mouseups[0].target).toBe(canvas);
    expect(docLib.dragging).toBe(false);
    expect(pointerLib.dragging).toBe(false);
    expect(captures).toHaveLength(0);
  });

  test('a move with the button up ends the drag once; later moves do nothing', () => {
    pressCanvas();
    document.getElementById('elsewhere').dispatchEvent(ptr('pointermove', { buttons: 0, clientX: 5, clientY: 6 }));
    expect(mouseups).toHaveLength(1);
    expect([mouseups[0].clientX, mouseups[0].clientY]).toEqual([5, 6]);
    expect(pointerLib.dragging).toBe(false);

    document.getElementById('elsewhere').dispatchEvent(ptr('pointermove', { buttons: 0 }));
    expect(mouseups).toHaveLength(1);
  });

  test('a move with the button still down changes nothing', async () => {
    pressCanvas();
    document.dispatchEvent(ptr('pointermove', { buttons: 1 }));
    await nextTask();
    expect(mouseups).toHaveLength(0);
    expect(docLib.dragging).toBe(true);
  });

  test('touch is left to the viewer: no capture and no synthetic release', async () => {
    canvas.dispatchEvent(ptr('pointerdown', { pointerType: 'touch' }));
    arrowIcon.dispatchEvent(ptr('pointerup', { pointerType: 'touch', buttons: 0 }));
    window.dispatchEvent(new Event('blur'));
    await nextTask();
    expect(captures).toHaveLength(0);
    expect(mouseups).toHaveLength(0);
  });

  test('a secondary-button press is ignored', async () => {
    pressCanvas({ button: 2, buttons: 2 });
    arrowIcon.dispatchEvent(ptr('pointerup', { button: 2, buttons: 0 }));
    await nextTask();
    expect(captures).toHaveLength(0);
    expect(mouseups).toHaveLength(0);
  });

  test('a press on a link inside the holder is not captured', async () => {
    const cta = document.getElementById('cta');
    cta.dispatchEvent(ptr('pointerdown'));
    mouse(cta, 'mousedown');
    arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    await nextTask();
    expect(captures).toHaveLength(0);
    expect(mouseups).toHaveLength(0);
  });

  test('a pointer event without pointerType is treated as a mouse', async () => {
    canvas.dispatchEvent(ptr('pointerdown', { pointerType: undefined }));
    mouse(canvas, 'mousedown');
    arrowIcon.dispatchEvent(ptr('pointerup', { pointerType: undefined, buttons: 0 }));
    await nextTask();
    expect(mouseups).toHaveLength(1);
  });

  test('stray events after a release, and any press after dispose(), do nothing', async () => {
    pressCanvas();
    arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    await nextTask();
    expect(mouseups).toHaveLength(1);

    document.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(ptr('pointermove', { buttons: 0 }));
    await nextTask();
    expect(mouseups).toHaveLength(1);

    dispose();
    captures = [];
    pressCanvas();
    document.body.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    window.dispatchEvent(new Event('blur'));
    await nextTask();
    expect(captures).toHaveLength(0);
    expect(mouseups).toHaveLength(1);
  });

  test('a second press before the first one released settles the first, and one release ends the second',
    async () => {
      pressCanvas();
      canvas.dispatchEvent(ptr('pointerdown')); // The first press's release was lost.
      expect(mouseups).toHaveLength(1); // The stale drag ended before the new mousedown re-arms the viewer.
      mouse(canvas, 'mousedown');
      expect(docLib.dragging).toBe(true);

      arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
      await nextTask();
      expect(mouseups).toHaveLength(2);
      expect(docLib.dragging).toBe(false);
    });

  test('a press right after a swallowed release settles it before the new drag starts', async () => {
    pressCanvas();
    arrowIcon.dispatchEvent(ptr('pointerup', { buttons: 0 }));
    pressCanvas(); // Before the same-task wait is over.
    expect(mouseups).toHaveLength(1);
    expect(docLib.dragging).toBe(true); // The new drag is not ended by the old release's late check.
    await nextTask();
    expect(mouseups).toHaveLength(1);
    expect(docLib.dragging).toBe(true);
  });
});
