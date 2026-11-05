/**
 * Tests for frontend/js/pages/explore.js, the Explore tool's entry: which screen a visit's session opens on (the tool,
 * the finished-region overlay, or the all-regions-finished dialog), and the page-wide touch and text-selection
 * behavior it installs before the tool starts. Main and the session loader have suites of their own (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush } from './support/routeFetch.js';

/** What the fakes saw during one page load; rebuilt per test. */
let h;

mockModule('frontend/js/common/pageSession.js', () => ({
  loadPageSession: (url) => { h.sessionUrl = url; return Promise.resolve(h.session); },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (src) => { h.imagerySource = src; return h.Viewer; },
}));
mockModule('frontend/js/explore/Main.js', () => ({
  Main: class {
    constructor(param, session) { h.main = { param, session }; }

    start() { return Promise.resolve('svl'); }
  },
}));
mockModule('frontend/js/explore/detectUnsupportedBrowser.js', () => ({}));

// The parts of explore.scala.html this entry reaches for.
const MARKUP = `
  <script type="application/json" id="page-data">{"imagerySource":"gsv","sessionUrl":"/explore/session"}</script>
  <div id="page-loading"></div>
  <div class="tool-ui ps-invisible"></div>
  <div id="interaction-area-holder"><canvas id="pano-canvas"></canvas></div>
  <div class="audit-selectable"><span id="sidebar-text">Street name</span></div>
  <label id="severity-word">Severe</label>
  <input id="search-box">
  <div id="area-completion-overlay-wrapper">
    <button id="continue-current"></button><button id="redirect-new"></button>
  </div>
  <div id="already-completed-region-overlay" style="display: none">
    <a id="already-completed-region-new"></a><a id="already-completed-region-validate"></a><a id="already-completed-region-cities"></a>
  </div>
  <dialog id="all-regions-finished">
    <a id="all-regions-finished-validate"></a><a id="all-regions-finished-cities"></a>
  </dialog>`;

/**
 * Loads the entry, runs its DOM-ready handler, and lets the session-driven start finish.
 * @returns {Promise<void>} Resolves once the page has started.
 */
async function boot() {
  document.body.innerHTML = MARKUP;
  const ready = [];
  useUtil({ onDomReady: (fn) => ready.push(fn) });
  await loadModules('frontend/js/pages/explore.js');
  ready.forEach((fn) => fn());
  await flush();
}

const el = (id) => document.getElementById(id);

// Each load adds its touch listeners to the one document every test shares; they come off after each test, or a
// touch would be replayed once per earlier load.
const documentListeners = [];
// jsdom has no non-modal dialog API; this one opens the way the browser's would.
beforeAll(() => { window.HTMLDialogElement.prototype.show = function show() { this.setAttribute('open', ''); }; });
afterAll(() => { delete window.HTMLDialogElement.prototype.show; });
afterEach(() => {
  documentListeners.splice(0).forEach(([type, fn]) => document.removeEventListener(type, fn));
  window.history.replaceState(null, '', '/');
});

beforeEach(() => {
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
    documentListeners.push([type, fn]);
    add(type, fn, opts);
  });
  h = {
    session: { task: { id: 1 } },
    Viewer: { preloadLibrary: vi.fn(() => Promise.resolve()) },
  };
  window.appManager = { ready: (fn) => fn() };
  window.logWebpageActivity = vi.fn();
  delete window.svl;
});

describe('starting a visit', () => {
  test('a session with a task starts the tool with the page\'s settings, its viewer preloading meanwhile', async () => {
    window.history.replaceState(null, '', '/explore?regionId=5');
    await boot();
    expect(h.sessionUrl).toBe('/explore/session?regionId=5');
    expect(h.imagerySource).toBe('gsv');
    expect(h.Viewer.preloadLibrary).toHaveBeenCalled();
    expect(h.main.param).toEqual({ imagerySource: 'gsv', sessionUrl: '/explore/session', viewerType: h.Viewer });
    expect(h.main.session).toBe(h.session);
    expect(window.svl).toBe('svl');
  });

  test('a viewer library that fails to preload only warns; the tool still starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('chunk 404');
    h.Viewer.preloadLibrary = () => Promise.reject(failure);
    await boot();
    expect(warn).toHaveBeenCalledWith('Pano viewer library preload failed:', failure);
    expect(window.svl).toBe('svl');
  });

  test('a finished region shows its overlay over the revealed tool instead of starting it', async () => {
    h.session = { task: null };
    await boot();
    expect(h.main).toBeUndefined();
    expect(document.querySelector('.tool-ui').classList.contains('ps-invisible')).toBe(false);
    expect(el('already-completed-region-overlay').style.display).toBe('block');

    el('already-completed-region-new').click();
    el('already-completed-region-validate').click();
    el('already-completed-region-cities').click();
    expect(window.logWebpageActivity.mock.calls).toEqual([
      ['Click_AlreadyCompletedRegion_NewRegion'], ['Click_AlreadyCompletedRegion_Validate'],
      ['Click_AlreadyCompletedRegion_OtherCities'],
    ]);
  });

  test('a city with no street left opens the all-finished dialog, whose links are logged', async () => {
    h.session = { all_regions_finished: true, task: { id: 1 } };
    await boot();
    expect(h.main).toBeUndefined();
    expect(el('page-loading').style.visibility).toBe('hidden');
    expect(el('all-regions-finished').open).toBe(true);

    el('all-regions-finished-validate').click();
    el('all-regions-finished-cities').click();
    expect(window.logWebpageActivity.mock.calls).toEqual([
      ['Click_AllRegionsFinished_Validate'], ['Click_AllRegionsFinished_OtherCities'],
    ]);
  });
});

describe('the region overlays', () => {
  test('"continue" hides the region-complete overlay; "new region" leaves for one', async () => {
    await boot();
    el('continue-current').click();
    expect(el('area-completion-overlay-wrapper').style.display).toBe('none');

    const navigations = navigationAttempts();
    el('redirect-new').click();
    expect(navigations).toHaveBeenCalledTimes(1);
  });
});

describe('text selection', () => {
  /**
   * Starts a selection on a node, the way the browser would.
   * @param {Node} target - Where the press landed.
   * @returns {boolean} Whether the page let the selection start.
   */
  const selectStart = (target) => document.onselectstart(/** @type {any} */ ({ target }));

  test('is allowed inside a selectable area, even starting on a bare text node', async () => {
    await boot();
    expect(selectStart(el('sidebar-text'))).toBe(true);
    expect(selectStart(el('sidebar-text').firstChild)).toBe(true);
  });

  test('is refused elsewhere, and an earlier selection is cleared so a label\'s click still reaches its input',
    async () => {
      await boot();
      const removeAllRanges = vi.fn();
      vi.spyOn(document, 'getSelection').mockReturnValue(/** @type {any} */ ({ removeAllRanges }));
      expect(selectStart(el('severity-word'))).toBe(false);
      expect(removeAllRanges).toHaveBeenCalled();
    });

  test('is refused in a text field without clearing the field\'s own selection', async () => {
    await boot();
    const removeAllRanges = vi.fn();
    vi.spyOn(document, 'getSelection').mockReturnValue(/** @type {any} */ ({ removeAllRanges }));
    expect(selectStart(el('search-box'))).toBe(false);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  test('is refused on a node outside the document tree, and with no selection to clear', async () => {
    await boot();
    vi.spyOn(document, 'getSelection').mockReturnValue(null);
    expect(selectStart(document.createTextNode('detached'))).toBe(false);
  });
});

describe('touch support', () => {
  test('each touch is replayed as the matching mouse event on the touched element', async () => {
    await boot();
    const seen = [];
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      el('pano-canvas').addEventListener(type, (e) => seen.push([e.type, e.clientX, e.clientY, e.screenX]));
    }
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      const touch = new Event(type, { bubbles: true });
      touch.changedTouches = [{ target: el('pano-canvas'), clientX: 10, clientY: 20, screenX: 30, screenY: 40 }];
      el('pano-canvas').dispatchEvent(touch);
    }
    expect(seen).toEqual([['mousedown', 10, 20, 30], ['mousemove', 10, 20, 30], ['mouseup', 10, 20, 30]]);
  });

  test('a drag on the pano doesn\'t scroll the page', async () => {
    await boot();
    const drag = new Event('touchmove', { bubbles: true, cancelable: true });
    drag.changedTouches = [{ target: el('pano-canvas') }];
    el('pano-canvas').dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
  });
});
