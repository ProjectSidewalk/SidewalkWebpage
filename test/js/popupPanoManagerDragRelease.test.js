/**
 * Tests that PopupPanoManager (frontend/js/common/label-detail/PopupPanoManager.js) mounts the drag-release watch on
 * its holder (#5295): a drag on the card's imagery released over one of its disabled overlay buttons must still end,
 * for the crop fallback as for the live viewers, and from the moment the card exists, before the lazily built viewer
 * (#5128) does. The watch itself is pinned in panoDragRelease.test.js.
 *
 * jsdom has neither pointer capture nor PointerEvent and doesn't suppress events on disabled controls, so a release
 * the browser swallows is modelled as a `pointerup` with no `mouseup` after it, and capture is a spy.
 */

const { loadModules } = require('./loadGlobalScript');

/**
 * A pointer event as a browser would send it, the pointer fields defined on a MouseEvent.
 * @param {string} type
 * @param {object} [init]
 * @returns {MouseEvent}
 */
function ptr(type, init = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init });
  Object.defineProperties(ev, { pointerType: { value: 'mouse' }, pointerId: { value: 1 }, isPrimary: { value: true } });
  return ev;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PopupPanoManager ends drags released over disabled controls', () => {
  let svHolder;
  let viewerType;
  let captures;
  let listeners;

  beforeEach(() => {
    jest.resetModules();
    listeners = new AbortController();
    document.body.innerHTML = `
      <div class="label-detail__pano-wrap">
        <button type="button" class="label-detail__paging" disabled><svg id="arrow-icon"></svg></button>
        <div id="sv-holder"></div>
        <div class="label-detail__pano-overlay">
          <button type="button" class="label-detail__pano-overlay-button" disabled>Agree</button>
        </div>
      </div>
      <div id="button-holder"></div>`;
    svHolder = document.getElementById('sv-holder');

    captures = [];
    Element.prototype.setPointerCapture = function setPointerCapture(id) { captures.push({ el: this, id }); };

    window.panzoom = () => ({ on: jest.fn(), zoomAbs: jest.fn(), moveTo: jest.fn(), getTransform: () => ({}) });
    window.util = {
      assetPath: (p) => `/assets/${p}`,
      afterLoadIdle: () => {},
      isMobile: () => false,
      misc: { getIconImagePaths: () => null, getLabelColors: () => '#000' },
    };
    window.i18next = { t: (k) => k };
    window.createPanoViewerLogo = () => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() });
    window.createPanoAttribution = () => ({ show: jest.fn(), hide: jest.fn() });
    window.LabelVisibilityToggle = { HIDDEN_CLASS: 'hidden' };
    viewerType = { create: jest.fn(), preloadLibrary: jest.fn(() => Promise.resolve()) };

    Object.assign(window, loadModules('frontend/js/common/label-detail/PopupPanoManager.js'));
  });

  afterEach(() => {
    listeners.abort();
    delete Element.prototype.setPointerCapture;
    jest.restoreAllMocks();
  });

  const createManager = () => window.PopupPanoManager.create(svHolder, document.getElementById('button-holder'),
    false, viewerType, 'token');

  test('a crop-fallback drag released on a disabled overlay button ends, before any viewer is built', async () => {
    await createManager();
    // panzoom's own wiring: it starts on mousedown and ends on a document mouseup.
    const panzoom = { dragging: false };
    const pz = svHolder.querySelector('#pano-fallback-pz');
    pz.addEventListener('mousedown', () => { panzoom.dragging = true; }, { signal: listeners.signal });
    document.addEventListener('mouseup', () => { panzoom.dragging = false; }, { signal: listeners.signal });

    pz.dispatchEvent(ptr('pointerdown'));
    pz.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(captures).toEqual([{ el: pz, id: 1 }]);

    document.querySelector('.label-detail__pano-overlay-button').dispatchEvent(ptr('pointerup', { buttons: 0 }));
    await nextTask();
    expect(panzoom.dragging).toBe(false);
    expect(viewerType.create).not.toHaveBeenCalled();
  });

  test('the live viewer\'s canvas is captured on a press, so a pointer-driven viewer hears its release', async () => {
    await createManager();
    const pano = svHolder.querySelector('#pano');
    pano.dispatchEvent(ptr('pointerdown'));
    expect(captures).toEqual([{ el: pano, id: 1 }]);
  });
});
