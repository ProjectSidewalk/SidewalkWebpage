/**
 * Tests for the `window.fetch` CSRF wrapper installed by frontend/js/common/AppManager.js (`_setupCSRF`).
 *
 * The wrapper attaches Play's `Csrf-Token` header to same-origin requests only. Cross-origin requests must be left
 * strictly alone: the token is meaningless to a third party, and adding a custom header turns a simple request into
 * one that needs a CORS preflight, which several of the hosts we talk to (Mapillary, Infra3d, sibling city servers)
 * reject (#4232).
 *
 * `fetch` accepts three argument types -- string, `URL`, `Request` -- and the same-origin decision has to be right
 * for all three. These tests pin that matrix: same-origin string/URL/Request receive the token, cross-origin
 * string/URL/Request do not.
 *
 * Node's `fetch` and `Request` are not the page's, so both are supplied here: the fetch under test is a vi.fn()
 * standing in for the browser's, captured by the wrapper as its `originalFetch`.
 */

import { loadModules } from './loader.js';

const CSRF_TOKEN = 'test-csrf-token';
const CROSS_ORIGIN = 'https://graph.mapillary.com/images?fields=id';

// Node's `Request` rejects a relative URL; the page's resolves it against the document and exposes the result as
// `.url`, which is what tells a Request from a `URL` (address via stringification) in the wrapper.
window.Request = class Request {
  constructor(input) {
    this.url = new URL(String(input), window.location.origin).href;
  }
};

describe('AppManager CSRF fetch wrapper', () => {
  let originalFetch;
  /** Absolute same-origin URL string, built from jsdom's actual origin so the tests do not hardcode one. */
  let sameOriginUrl;

  /** The options object the wrapper passed to the underlying fetch on its most recent call. */
  function forwardedOptions() {
    return originalFetch.mock.lastCall[1];
  }

  /** The token the wrapper sent on its most recent call, or null; headers are forwarded as a `Headers`. */
  function forwardedToken() {
    const headers = forwardedOptions().headers;
    return headers instanceof Headers ? headers.get('Csrf-Token') : null;
  }

  /** The first argument (the URL/Request) the wrapper passed to the underlying fetch on its most recent call. */
  function forwardedTarget() {
    return originalFetch.mock.lastCall[0];
  }

  beforeEach(async () => {
    sameOriginUrl = `${window.location.origin}/label/geo`;

    // Install a stand-in for the browser's fetch *before* loading AppManager, since the wrapper closes over
    // whatever `window.fetch` is at setup time and delegates to it.
    originalFetch = vi.fn(() => Promise.resolve({ ok: true }));
    window.fetch = originalFetch;

    await loadModules('frontend/js/common/AppManager.js');
    window.appManager._setupCSRF(CSRF_TOKEN);
  });

  afterEach(() => {
    delete window.appManager;
    delete window.fetch;
  });

  describe('same-origin requests get the token', () => {
    test('relative string (our own routes)', async () => {
      await window.fetch('/label/geo');

      expect(forwardedToken()).toBe(CSRF_TOKEN);
    });

    test('absolute same-origin string', async () => {
      await window.fetch(sameOriginUrl);

      expect(forwardedToken()).toBe(CSRF_TOKEN);
    });

    test('URL object', async () => {
      await window.fetch(new URL(sameOriginUrl));

      expect(forwardedToken()).toBe(CSRF_TOKEN);
    });

    test('Request object', async () => {
      await window.fetch(new Request('/label/geo'));

      expect(forwardedToken()).toBe(CSRF_TOKEN);
    });

    test('existing options and headers are preserved alongside the token', async () => {
      await window.fetch('/label/geo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      const { headers, ...rest } = forwardedOptions();
      expect(rest).toEqual({ method: 'POST', body: '{}' });
      expect(Object.fromEntries(headers)).toEqual({ 'content-type': 'application/json', 'csrf-token': CSRF_TOKEN });
    });

    // pmtiles passes its Range header as a `Headers`, and a lost range is a whole-file download pmtiles rejects.
    test('headers given as a Headers instance or as pairs are kept', async () => {
      await window.fetch('/basemap/a.pmtiles', { headers: new Headers({ Range: 'bytes=0-16383' }) });
      expect(forwardedOptions().headers.get('Range')).toBe('bytes=0-16383');
      expect(forwardedToken()).toBe(CSRF_TOKEN);

      await window.fetch('/basemap/a.pmtiles', { headers: [['Range', 'bytes=0-99']] });
      expect(forwardedOptions().headers.get('Range')).toBe('bytes=0-99');
    });
  });

  test('a malformed header rejects the returned promise instead of throwing', async () => {
    let returned;
    expect(() => { returned = window.fetch('/label/geo', { headers: { 'Bad Name': 'x' } }); }).not.toThrow();
    await expect(returned).rejects.toThrow();
  });

  describe('cross-origin requests are left untouched', () => {
    test('string', async () => {
      await window.fetch(CROSS_ORIGIN);

      expect(forwardedOptions()).not.toHaveProperty(['headers', 'Csrf-Token']);
    });

    // The regression this file exists to pin: a wrapper that reads `.url` off a URL gets undefined, which
    // resolves to <origin>/undefined, passes the same-origin check, and hands the token to a cross-origin host.
    test('URL object', async () => {
      await window.fetch(new URL(CROSS_ORIGIN));

      expect(forwardedOptions()).not.toHaveProperty(['headers', 'Csrf-Token']);
    });

    test('Request object', async () => {
      await window.fetch(new Request(CROSS_ORIGIN));

      expect(forwardedOptions()).not.toHaveProperty(['headers', 'Csrf-Token']);
    });

    test('the caller\'s own options object is forwarded unmodified', async () => {
      const options = { method: 'GET', headers: { Accept: 'application/json' } };

      await window.fetch(CROSS_ORIGIN, options);

      expect(forwardedOptions()).toBe(options); // same reference, not a copy with a header added
      expect(options.headers).toEqual({ Accept: 'application/json' });
    });
  });

  describe('the request itself is passed through unchanged', () => {
    test('a URL object reaches fetch as the same URL instance, not a string', async () => {
      const url = new URL(sameOriginUrl);

      await window.fetch(url);

      expect(forwardedTarget()).toBe(url);
    });

    test('a Request object reaches fetch as the same Request instance', async () => {
      const request = new Request('/label/geo');

      await window.fetch(request);

      expect(forwardedTarget()).toBe(request);
    });

    test('the underlying fetch response is returned to the caller', async () => {
      const response = await window.fetch('/label/geo');

      expect(response).toEqual({ ok: true });
    });
  });

  test('an unparseable URL is forwarded untouched rather than guessed at', async () => {
    // Malformed IPv6 literal: `new URL(...)` throws, so the wrapper cannot decide the origin and must not assume.
    await window.fetch('http://[');

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(forwardedOptions()).not.toHaveProperty(['headers', 'Csrf-Token']);
  });
});
