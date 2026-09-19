/**
 * Tests for AccessScoreFetch (public/js/access-score/src/AccessScoreFetch.js, #5418): the retry a cold AccessScore
 * server asks for. A `503` with `Retry-After` is waited out on the server's schedule, a proxy `502` on the built-in
 * backoff, a `4xx` is never retried, and the page hears about each wait through `onWait`.
 *
 * Timers are faked so a test that "waits 30 seconds" runs in milliseconds; each wait is advanced explicitly, which
 * also pins that the helper waits exactly as long as it says it will.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

/**
 * A minimal `Response` stand-in: status, headers and a JSON body.
 * @param {number} status - HTTP status.
 * @param {object} [options]
 * @param {object} [options.body] - What `json()` resolves to.
 * @param {Record<string, string>} [options.headers] - Response headers.
 * @returns {{ok: boolean, status: number, headers: {get: (name: string) => ?string}, json: () => Promise<object>}}
 */
function response(status, { body = {}, headers = {} } = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => lower[name.toLowerCase()] ?? null },
        json: () => Promise.resolve(body),
    };
}

describe('AccessScoreFetch.fetchJsonWithRetry', () => {
    let AccessScoreFetch;
    const URL = '/v3/api/accessScoreStreets';

    beforeAll(() => {
        window.eval(`${read('public/js/access-score/src/AccessScoreFetch.js')}\nwindow.AccessScoreFetch = AccessScoreFetch;`);
        AccessScoreFetch = window.AccessScoreFetch;
    });

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.fetch;
    });

    test('returns the JSON of a first-try success without waiting', async () => {
        global.fetch = jest.fn().mockResolvedValue(response(200, { body: { type: 'FeatureCollection' } }));
        const onWait = jest.fn();

        await expect(AccessScoreFetch.fetchJsonWithRetry(URL, { onWait })).resolves.toEqual({ type: 'FeatureCollection' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(onWait).not.toHaveBeenCalled();
    });

    test('retries a 503 after exactly the Retry-After the server named, and reports the wait', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(503, { headers: { 'Retry-After': '30' } }))
            .mockResolvedValueOnce(response(200, { body: { features: [1] } }));
        const onWait = jest.fn();

        const result = AccessScoreFetch.fetchJsonWithRetry(URL, { onWait });
        // Let the first attempt resolve and the wait start.
        await jest.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(onWait).toHaveBeenCalledWith(1, 30);

        // One second short of the header: still waiting, so a client that came back early would find nothing.
        await jest.advanceTimersByTimeAsync(29_000);
        expect(fetch).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1_000);
        expect(fetch).toHaveBeenCalledTimes(2);

        await expect(result).resolves.toEqual({ features: [1] });
    });

    test('retries a 502 with no Retry-After on the 5, 10, 20, 30 s backoff', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(502))
            .mockResolvedValueOnce(response(502))
            .mockResolvedValueOnce(response(504))
            .mockResolvedValueOnce(response(200, { body: { ok: true } }));
        const onWait = jest.fn();

        const result = AccessScoreFetch.fetchJsonWithRetry(URL, { onWait });
        await jest.advanceTimersByTimeAsync(0);
        expect(onWait).toHaveBeenLastCalledWith(1, 5);
        await jest.advanceTimersByTimeAsync(5_000);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(onWait).toHaveBeenLastCalledWith(2, 10);
        await jest.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(onWait).toHaveBeenLastCalledWith(3, 20);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(fetch).toHaveBeenCalledTimes(4);

        await expect(result).resolves.toEqual({ ok: true });
        expect(onWait).toHaveBeenCalledTimes(3);
    });

    test('never retries a 4xx: the request itself is wrong', async () => {
        global.fetch = jest.fn().mockResolvedValue(response(404));
        const onWait = jest.fn();

        await expect(AccessScoreFetch.fetchJsonWithRetry(URL, { onWait })).rejects.toThrow('HTTP 404');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(onWait).not.toHaveBeenCalled();
    });

    test('never retries a 500 either, only the "not yet" statuses', async () => {
        global.fetch = jest.fn().mockResolvedValue(response(500));

        await expect(AccessScoreFetch.fetchJsonWithRetry(URL)).rejects.toThrow('HTTP 500');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('gives up with the last failure once the next wait would pass the total cap', async () => {
        global.fetch = jest.fn().mockResolvedValue(response(503, { headers: { 'Retry-After': '40' } }));
        const onWait = jest.fn();

        // A 100 s cap admits two 40 s waits (80 s) and refuses the third (120 s): three attempts, two waits.
        const result = AccessScoreFetch.fetchJsonWithRetry(URL, { onWait, maxTotalWaitSeconds: 100 });
        // Attach the rejection handler before the timers run so the failure is never an unhandled rejection.
        const outcome = expect(result).rejects.toThrow('HTTP 503');
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(40_000);
        await jest.advanceTimersByTimeAsync(40_000);
        await outcome;
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(onWait).toHaveBeenCalledTimes(2);
    });

    test('reads a Retry-After of 0 as one second rather than hammering the server', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(503, { headers: { 'Retry-After': '0' } }))
            .mockResolvedValueOnce(response(200, { body: {} }));
        const onWait = jest.fn();

        const result = AccessScoreFetch.fetchJsonWithRetry(URL, { onWait });
        await jest.advanceTimersByTimeAsync(0);
        expect(onWait).toHaveBeenCalledWith(1, 1);
        await jest.advanceTimersByTimeAsync(1_000);
        await expect(result).resolves.toEqual({});
    });

    test('falls back to the backoff when Retry-After is an HTTP date', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(503, { headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }))
            .mockResolvedValueOnce(response(200, { body: {} }));
        const onWait = jest.fn();

        const result = AccessScoreFetch.fetchJsonWithRetry(URL, { onWait });
        await jest.advanceTimersByTimeAsync(0);
        expect(onWait).toHaveBeenCalledWith(1, 5);
        await jest.advanceTimersByTimeAsync(5_000);
        await expect(result).resolves.toEqual({});
    });
});
