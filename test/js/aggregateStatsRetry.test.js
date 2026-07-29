/**
 * Behavior tests for public/js/common/aggregateStats.js (#4600).
 *
 * The API-docs landing page fell back to its error state whenever /v3/api/aggregateStats took longer than the fetch
 * timeout, because timeout aborts were exempted from the retry logic. These tests pin the fixed contract: a timed-out
 * attempt is retried (the server keeps computing the aborted request and caches its result, so retries converge), and
 * the error shown after all retries fail is human-readable rather than "signal is aborted without reason".
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment) so `window`/`document` are available.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

// jsdom (as bundled with this Jest version) implements AbortSignal but not the static AbortSignal.timeout()
// (Baseline 2022, present in all supported browsers). Shim it for these tests; fetch is stubbed anyway, so the
// signal's actual timing behavior never matters here.
if (typeof AbortSignal.timeout !== 'function') {
    AbortSignal.timeout = () => new AbortController().signal;
}

const MODULE_PATH = 'public/js/common/aggregateStats.js';
const STATS_PARAGRAPH_ID = 'project-sidewalk-aggregate-stats';

// Minimal snake_case /v3/api/aggregateStats response (v3 naming convention, issue #3871).
const GOOD_FIXTURE = {
    status: 'OK',
    km_explored: 1234,
    km_explored_no_overlap: 1000,
    total_labels: 50000,
    total_validations: 30000,
    num_cities: 18,
    num_countries: 9,
    num_languages: 7,
    by_label_type: {}
};

/**
 * Builds the error a fetch rejects with when its AbortSignal.timeout() fires.
 * @returns {Error} An error whose name matches the DOMException browsers raise on fetch timeout.
 */
function timeoutError() {
    return Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
}

/**
 * Polls an expectation until it passes, failing with its last error after timeoutMs. The script kicks off
 * loadProjectSidewalkStats() fire-and-forget from the appManager.ready callback, so tests can't await it directly —
 * they wait for its DOM effects instead.
 * @param {Function} expectation - Function that throws (e.g. contains Jest expects) until the condition holds.
 * @param {number} [timeoutMs=8000] - How long to keep polling before giving up.
 */
async function waitFor(expectation, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            expectation();
            return;
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
}

describe('aggregateStats fetch resilience', () => {
    let readyCallback;

    beforeEach(() => {
        document.body.innerHTML = `<p id="${STATS_PARAGRAPH_ID}"></p>`;

        // The script auto-registers via window.appManager.ready() at load; capture the callback to trigger manually.
        readyCallback = undefined;
        window.appManager = { ready: (cb) => { readyCallback = cb; } };

        // Globals the renderer reaches for (provided by other bundles in production).
        global.i18next = { t: (key, opts) => Number(opts.val).toLocaleString('en-US') };
        global.util = { math: { kmsToMiles: (km) => km * 0.621371 } };

        // Keep the retry/error logging out of Jest's output.
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        loadGlobalScript(MODULE_PATH);
    });

    afterEach(() => {
        delete global.fetch;
        delete global.i18next;
        delete global.util;
        delete window.appManager;
        jest.restoreAllMocks();
    });

    test('registers with appManager and passes a timeout signal to fetch', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(GOOD_FIXTURE) })
        );

        expect(readyCallback).toBeDefined();
        readyCallback();

        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        const options = global.fetch.mock.calls[0][1];
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    test('retries after a timeout and renders stats from the second attempt', async () => {
        global.fetch = jest.fn()
            .mockRejectedValueOnce(timeoutError())
            .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(GOOD_FIXTURE) });

        readyCallback();

        await waitFor(() => {
            const html = document.getElementById(STATS_PARAGRAPH_ID).innerHTML;
            expect(html).toContain('18 cities');
        });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(document.getElementById(STATS_PARAGRAPH_ID).innerHTML).not.toContain('Unable to load');
    }, 15000);

    test('shows a readable timeout message after every attempt times out', async () => {
        global.fetch = jest.fn(() => Promise.reject(timeoutError()));

        readyCallback();

        await waitFor(() => {
            const html = document.getElementById(STATS_PARAGRAPH_ID).innerHTML;
            expect(html).toContain('Request timed out after 15 seconds');
        });
        // Initial attempt + CONFIG.RETRY_ATTEMPTS retries.
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(document.getElementById(STATS_PARAGRAPH_ID).innerHTML).not.toContain('signal is aborted');
    }, 15000);
});
