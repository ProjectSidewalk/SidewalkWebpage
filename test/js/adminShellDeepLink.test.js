/**
 * Tests for AdminShell holding a deep link's target in place while sections above it land (#5001).
 *
 * The browser scrolls to the fragment once, at load; a section that renders afterwards above the target (the
 * dashboard's cross-city breakdown, the mistake gallery) pushes it down the page. The shell watches the content column
 * for height changes and re-scrolls the target — until the reader scrolls, keys, or touches, after which the page
 * must never move under them.
 *
 * Runs under jsdom (jest.config.js), which has neither ResizeObserver nor Element.scrollIntoView: the observer is
 * stubbed so a test can fire it by hand, and scrollIntoView is a spy. AdminShell is a bare top-level class in a
 * concatenated bundle, so it is eval'd into global scope rather than required.
 *
 * jsdom fires `hashchange` for a `location.hash` assignment on a later task, after the synchronous test body, and
 * every AdminShell built here leaves its window listeners behind. Those late events reach stale instances whose
 * observer callbacks were dropped with `resizeCallbacks`, so they can't scroll anything; the re-arm test dispatches
 * its own `hashchange` rather than waiting for jsdom's.
 */

const fs = require('fs');
const path = require('path');

const SHELL_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/AdminShell.js'), 'utf8');

let AdminShell;
/** The callbacks handed to `new ResizeObserver(cb)`, so a test can simulate the content column changing height. */
let resizeCallbacks = [];
/** Elements passed to `observe()`, to assert the shell watches the content column and nothing else. */
let observed = [];

beforeAll(() => {
  global.initSidebarDisclosure = () => {};
  AdminShell = (0, eval)(`${SHELL_SRC}\nAdminShell;`);
});

beforeEach(() => {
  resizeCallbacks = [];
  observed = [];
  window.ResizeObserver = class {
    constructor(cb) { resizeCallbacks.push(cb); }
    observe(el) { observed.push(el); }
    disconnect() {}
  };
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn();
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: false });
  performance.getEntriesByType = jest.fn(() => []);
  setScrollY(0);
  window.location.hash = '';
});

/**
 * jsdom never scrolls or lays out, so the scroll offset and page height are pinned by hand to stand in for wherever
 * the page is and how tall it has become.
 *
 * @param {number} y
 * @param {number} [height=0]
 */
function setScrollY(y, height = 0) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: height, configurable: true });
}

/**
 * How the browser says this page was reached; jsdom reports no navigation entry at all, which the shell reads as a
 * plain navigation.
 *
 * @param {string} type - A PerformanceNavigationTiming type: 'navigate', 'reload', 'back_forward'.
 */
function setNavigationType(type) {
  performance.getEntriesByType = jest.fn((kind) => (kind === 'navigation' ? [{ type }] : []));
}

/**
 * A page with one section that is hidden at load above the deep link's target, as the dashboard's cross-city
 * section sits above My Routes, and one below it for the TOC to navigate to.
 *
 * @returns {{ hiddenSection: HTMLElement, target: HTMLElement }}
 */
function buildDom() {
  document.body.innerHTML = `
    <nav class="page-toc"><ul></ul></nav>
    <div class="page-content">
      <div class="page-section" id="ud-cities-section" hidden>
        <h2 class="page-heading" id="cities">Cities you've mapped <a href="#cities" class="permalink">#</a></h2>
      </div>
      <div class="page-section" id="ud-routes-section">
        <h2 class="page-heading" id="my-routes">My Routes <a href="#my-routes" class="permalink">#</a></h2>
      </div>
      <div class="page-section" id="ud-team-section">
        <h2 class="page-heading" id="team">Your team <a href="#team" class="permalink">#</a></h2>
      </div>
    </div>`;
  return {
    hiddenSection: document.getElementById('ud-cities-section'),
    target: document.getElementById('my-routes'),
  };
}

/** Simulates the content column changing height, as the async section's arrival does. */
function contentResized() {
  resizeCallbacks.forEach((cb) => cb([]));
}

const scrollCalls = () => /** @type {jest.Mock} */ (window.HTMLElement.prototype.scrollIntoView).mock.contexts;

describe('deep-link target while sections above it load', () => {
  test('re-scrolls the fragment target each time the content column changes height', () => {
    window.location.hash = '#my-routes';
    const { hiddenSection, target } = buildDom();
    new AdminShell().init();
    expect(observed).toEqual([document.querySelector('.page-content')]);
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    hiddenSection.hidden = false;
    contentResized();

    expect(scrollCalls()).toEqual([target]);
  });

  test.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])(
    'stops once the reader has taken over with a %s',
    (type) => {
      window.location.hash = '#my-routes';
      buildDom();
      new AdminShell().init();
      jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

      window.dispatchEvent(new Event(type));
      contentResized();

      expect(scrollCalls()).toEqual([]);
    });

  test('stops at a scroll it did not make, which is a scrollbar drag or a screen reader moving the page', () => {
    window.location.hash = '#my-routes';
    buildDom();
    new AdminShell().init();
    contentResized();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    setScrollY(500);
    window.dispatchEvent(new Event('scroll'));
    contentResized();

    expect(scrollCalls()).toEqual([]);
  });

  test('keeps holding through a scroll that came with a taller page, which is scroll anchoring at work', () => {
    window.location.hash = '#my-routes';
    const { target } = buildDom();
    new AdminShell().init();
    contentResized();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    setScrollY(1131, 1249);
    window.dispatchEvent(new Event('scroll'));
    contentResized();

    expect(scrollCalls()).toEqual([target]);
  });

  test('keeps holding through the scroll event its own re-scroll raises', () => {
    window.location.hash = '#my-routes';
    const { target } = buildDom();
    new AdminShell().init();
    contentResized();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    window.dispatchEvent(new Event('scroll'));
    contentResized();

    expect(scrollCalls()).toEqual([target]);
  });

  test('stops when the reader picks a destination from the page\'s own table of contents', () => {
    window.location.hash = '#my-routes';
    buildDom();
    new AdminShell().init();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    // click() carries no pointerdown, as voice control and switch access don't either.
    /** @type {HTMLAnchorElement} */ (document.querySelector('.page-toc a[href="#team"]')).click();
    contentResized();

    expect(scrollCalls()).toEqual([]);
  });

  test.each(['reload', 'back_forward'])(
    'leaves the position the browser restored on a %s alone',
    (navType) => {
      setNavigationType(navType);
      window.location.hash = '#my-routes';
      buildDom();
      new AdminShell().init();
      jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

      contentResized();

      expect(scrollCalls()).toEqual([]);
    });

  test('holds on a plain navigation the browser reports as such', () => {
    setNavigationType('navigate');
    window.location.hash = '#my-routes';
    const { target } = buildDom();
    new AdminShell().init();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    contentResized();

    expect(scrollCalls()).toEqual([target]);
  });

  test('does nothing on a page opened without a fragment', () => {
    buildDom();
    new AdminShell().init();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    contentResized();

    expect(scrollCalls()).toEqual([]);
  });

  test('ignores a fragment that names no element', () => {
    window.location.hash = '#no-such-section';
    buildDom();
    new AdminShell().init();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    contentResized();

    expect(scrollCalls()).toEqual([]);
  });

  test('re-arms on a hash change, so a later fragment is held in place too', () => {
    buildDom();
    new AdminShell().init();
    window.dispatchEvent(new Event('wheel'));
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    window.location.hash = '#cities';
    window.dispatchEvent(new Event('hashchange'));
    contentResized();

    expect(scrollCalls()).toEqual([document.getElementById('cities')]);
  });

  test('matches a fragment as written when it does not decode, as the browser does', () => {
    window.location.hash = '#%E0%A4%A';
    buildDom();
    const raw = document.createElement('div');
    raw.id = '%E0%A4%A';
    document.querySelector('.page-content').appendChild(raw);
    new AdminShell().init();
    jest.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();

    contentResized();

    expect(scrollCalls()).toEqual([raw]);
  });

  test('skips itself where ResizeObserver is missing rather than failing the shell', () => {
    delete window.ResizeObserver;
    window.location.hash = '#my-routes';
    buildDom();
    expect(() => new AdminShell().init()).not.toThrow();
  });
});
