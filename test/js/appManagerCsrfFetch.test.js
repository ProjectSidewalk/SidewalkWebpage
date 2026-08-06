/**
 * Tests for the `window.fetch` CSRF wrapper installed by public/js/common/AppManager.js (`_setupCSRF`).
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
 * Runs under jsdom (jest.config.js). jsdom implements neither `fetch` nor `Request`, so both are supplied here: the
 * fetch under test is a jest.fn() standing in for the browser's, captured by the wrapper as its `originalFetch`.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const CSRF_TOKEN = 'test-csrf-token';
const CROSS_ORIGIN = 'https://graph.mapillary.com/images?fields=id';

// jsdom ships no Fetch API, so `Request` is absent. Model the one behavior the wrapper relies on: a Request resolves
// its input against the document's base URL and exposes the resulting absolute address as `.url`. That matches the
// browser, and it is what distinguishes a Request (address on `.url`) from a `URL` (address via stringification).
if (typeof global.Request === 'undefined') {
    global.Request = class Request {
        constructor(input) {
            this.url = new URL(String(input), window.location.origin).href;
        }
    };
}

describe('AppManager CSRF fetch wrapper', () => {
    let originalFetch;
    /** Absolute same-origin URL string, built from jsdom's actual origin so the tests do not hardcode one. */
    let sameOriginUrl;

    /** The options object the wrapper passed to the underlying fetch on its most recent call. */
    function forwardedOptions() {
        return originalFetch.mock.lastCall[1];
    }

    /** The first argument (the URL/Request) the wrapper passed to the underlying fetch on its most recent call. */
    function forwardedTarget() {
        return originalFetch.mock.lastCall[0];
    }

    beforeEach(() => {
        sameOriginUrl = `${window.location.origin}/label/geo`;

        // AppManager's _setupCSRF also configures jQuery; stub just enough for it to run under jsdom.
        global.$ = { ajaxSetup: jest.fn() };

        // Install a stand-in for the browser's fetch *before* loading AppManager, since the wrapper closes over
        // whatever `window.fetch` is at setup time and delegates to it.
        originalFetch = jest.fn(() => Promise.resolve({ ok: true }));
        window.fetch = originalFetch;

        loadGlobalScript('public/js/common/AppManager.js');
        window.appManager._setupCSRF(CSRF_TOKEN);
    });

    afterEach(() => {
        delete global.$;
        delete window.appManager;
        delete window.fetch;
    });

    describe('same-origin requests get the token', () => {
        test('relative string (our own routes)', async () => {
            await window.fetch('/label/geo');

            expect(forwardedOptions().headers['Csrf-Token']).toBe(CSRF_TOKEN);
        });

        test('absolute same-origin string', async () => {
            await window.fetch(sameOriginUrl);

            expect(forwardedOptions().headers['Csrf-Token']).toBe(CSRF_TOKEN);
        });

        test('URL object', async () => {
            await window.fetch(new URL(sameOriginUrl));

            expect(forwardedOptions().headers['Csrf-Token']).toBe(CSRF_TOKEN);
        });

        test('Request object', async () => {
            await window.fetch(new Request('/label/geo'));

            expect(forwardedOptions().headers['Csrf-Token']).toBe(CSRF_TOKEN);
        });

        test('existing options and headers are preserved alongside the token', async () => {
            await window.fetch('/label/geo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });

            expect(forwardedOptions()).toEqual({
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Csrf-Token': CSRF_TOKEN },
                body: '{}',
            });
        });
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
