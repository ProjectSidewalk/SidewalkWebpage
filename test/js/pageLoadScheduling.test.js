/**
 * The page-load helpers in frontend/js/common/utilities.js that decide when deferred work starts: `afterLoadIdle`,
 * `onDomReady`, `onFirstInteractionOrIdle` (the landing page's map and validation grid wait on it), and
 * `importOrReload`, which rescues a tab opened before a deploy that asks for lazy chunks the new build lacks. Starting
 * too early puts the work back on the critical path, never starting it leaves a blank space where it belongs, and a
 * reload loop locks the visitor out of the page entirely (#5840).
 */

import { navigationAttempts } from './fakes.js';
import { flush } from './support/routeFetch.js';
import { loadModules } from './loader.js';

let util;

/**
 * Makes the document report a load stage it has already passed, since jsdom finishes loading before any test runs.
 * @param {DocumentReadyState} state - What `document.readyState` should answer.
 */
function setReadyState(state) {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });
}

beforeEach(async () => {
  ({ util } = await loadModules('frontend/js/common/utilities.js'));
});

afterEach(() => {
  delete document.readyState;
  delete window.requestIdleCallback;
  window.sessionStorage.clear();
});

describe('util.afterLoadIdle', () => {
  test('hands the work to the browser\'s idle queue, with a deadline so a busy page can\'t starve it', () => {
    window.requestIdleCallback = vi.fn();
    const work = vi.fn();
    util.afterLoadIdle(work);
    expect(window.requestIdleCallback).toHaveBeenCalledWith(work, { timeout: 2000 });
  });

  test('falls back to a short delay where the browser has no idle queue', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    util.afterLoadIdle(work);
    vi.advanceTimersByTime(199);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  test('waits for the page to finish loading first', () => {
    vi.useFakeTimers();
    setReadyState('interactive');
    const work = vi.fn();
    util.afterLoadIdle(work);
    vi.advanceTimersByTime(1000);
    expect(work).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(200);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('util.onDomReady', () => {
  test('runs right away once the page is parsed', () => {
    const work = vi.fn();
    util.onDomReady(work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  test('waits for parsing to finish when the page is still loading', () => {
    setReadyState('loading');
    const work = vi.fn();
    util.onDomReady(work);
    expect(work).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('util.onFirstInteractionOrIdle', () => {
  beforeEach(() => {
    // Run idle work at once, so what is being timed is the wait for a visitor, not the idle queue.
    window.requestIdleCallback = vi.fn((work) => work());
  });

  test('starts as soon as a visitor moves the mouse, and only once', async () => {
    vi.useFakeTimers();
    const work = vi.fn();
    util.onFirstInteractionOrIdle(work);
    expect(work).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointermove'));
    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledTimes(1);

    // The fallback still fires later, and must not start the work a second time.
    await vi.advanceTimersByTimeAsync(5000);
    expect(work).toHaveBeenCalledTimes(1);
  });

  test('counts an interaction that came before the caller asked', async () => {
    window.dispatchEvent(new Event('keydown'));
    const work = vi.fn();
    util.onFirstInteractionOrIdle(work);
    await flush();
    expect(work).toHaveBeenCalledTimes(1);
  });

  test('starts anyway after the fallback delay when no visitor ever shows up', async () => {
    vi.useFakeTimers();
    const work = vi.fn();
    util.onFirstInteractionOrIdle(work, 3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('util.importOrReload', () => {
  /** @returns {Promise<never>} A lazy import whose chunk the server no longer has. */
  const missingChunk = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

  test('hands back the module when the import works', async () => {
    const module = { createPSMap: () => {} };
    await expect(util.importOrReload(() => Promise.resolve(module))).resolves.toBe(module);
  });

  test('reloads the page once to pick up the new build, and never settles meanwhile', async () => {
    const reloads = navigationAttempts();
    const settled = vi.fn();
    util.importOrReload(missingChunk).then(settled, settled);
    await flush();
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('reloadedForNewBuild')).toBe('1');
    // Nothing should run against a page that is going away.
    expect(settled).not.toHaveBeenCalled();
  });

  test('reports the failure instead of reloading again when a reload didn\'t help', async () => {
    window.sessionStorage.setItem('reloadedForNewBuild', '1');
    const reloads = navigationAttempts();
    await expect(util.importOrReload(missingChunk)).rejects.toThrow('dynamically imported module');
    expect(reloads).not.toHaveBeenCalled();
  });

  test('reports the failure where it can\'t remember a reload, rather than risk a reload loop', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const reloads = navigationAttempts();
    await expect(util.importOrReload(missingChunk)).rejects.toThrow('dynamically imported module');
    expect(reloads).not.toHaveBeenCalled();
  });
});
