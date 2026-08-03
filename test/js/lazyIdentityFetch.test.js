/**
 * Tests for util.lazyIdentityFetch (#4442), the shared first-write helper: public pages render with no session at
 * all (#4643), so a first-time visitor's first vote/comment/story/route save reaches the server unauthenticated.
 * The helper's contract:
 *   - a success (or any non-auth failure: 400 validation, 409 duplicate, 429 rate limit) passes through UNCHANGED —
 *     a rejected submission must never be silently re-posted;
 *   - an auth-shaped failure (401 | 403 | opaqueredirect | redirected) mints the anonymous session via
 *     GET /anonSignUp?url=%2F with { redirect: 'manual' }, then retries ONCE with the same options object;
 *   - a second auth failure after the mint (e.g. the mint itself was rate-limited) is returned, never looped on.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

/** A minimal Response-shaped object carrying only the fields the helper reads. */
function response(overrides = {}) {
    return { ok: false, status: 200, type: 'basic', redirected: false, ...overrides };
}

const OK = () => response({ ok: true });

beforeEach(() => {
    // utilities.js builds a Bowser parser at load time; the helper never touches it, but the file needs the global.
    window.bowser = {
        getParser: () => ({
            getBrowserName: () => 'Test', getBrowserVersion: () => '1',
            getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
        }),
    };
    loadGlobalScript('public/js/common/utilities.js');
});

/** Runs the helper against a scripted sequence of responses and returns { result, calls }. */
async function run(responses, options = { method: 'POST', body: '{"x":1}' }) {
    const fetchMock = jest.fn();
    responses.forEach((r) => fetchMock.mockResolvedValueOnce(r));
    window.fetch = fetchMock;
    const result = await window.util.lazyIdentityFetch('/labelmap/validate', options);
    return { result, options, calls: fetchMock.mock.calls };
}

describe('a response that is not an auth failure', () => {
    test('a success passes through untouched, with no mint and no retry', async () => {
        const ok = OK();
        const { result, calls } = await run([ok]);
        expect(result).toBe(ok);
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('/labelmap/validate');
    });

    test.each([400, 409, 429, 500])('a %i failure surfaces unchanged — no mint, no re-post', async (status) => {
        const failure = response({ status });
        const { result, calls } = await run([failure, OK()]);
        expect(result).toBe(failure);
        // The one call is the original request; in particular /anonSignUp was never fetched and nothing re-posted.
        expect(calls).toHaveLength(1);
        expect(calls.map((c) => c[0])).not.toContain('/anonSignUp?url=%2F');
    });
});

describe('an auth-shaped failure', () => {
    test('a 401 mints the anonymous session (redirect: manual), then retries once and returns the retry', async () => {
        const ok = OK();
        const { result, options, calls } = await run([response({ status: 401 }), response({ ok: true }), ok]);
        // Call order: original -> mint -> retry. The middle mock response is consumed by the mint fetch.
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toBe('/labelmap/validate');
        expect(calls[1]).toEqual(['/anonSignUp?url=%2F', { redirect: 'manual' }]);
        expect(calls[2][0]).toBe('/labelmap/validate');
        // The retry reuses the SAME options object — same method, headers, and body as the swallowed first attempt.
        expect(calls[2][1]).toBe(options);
        expect(result).toBe(ok);
    });

    test.each([
        ['403', response({ status: 403 })],
        ['opaqueredirect', response({ status: 0, type: 'opaqueredirect' })],
        ['followed redirect', response({ status: 404, redirected: true })],
    ])('a %s also mints and retries', async (_name, failure) => {
        const ok = OK();
        const { result, calls } = await run([failure, response({ ok: true }), ok]);
        expect(calls).toHaveLength(3);
        expect(calls[1][0]).toBe('/anonSignUp?url=%2F');
        expect(result).toBe(ok);
    });

    test('a second 401 after the mint is returned as-is — one retry, never a loop', async () => {
        // The mint can itself be refused (anon-signup rate limit), leaving the retry unauthenticated again.
        const second401 = response({ status: 401 });
        const { result, calls } = await run([response({ status: 401 }), response({ ok: true }), second401]);
        expect(result).toBe(second401);
        // original + mint + retry and nothing more: no second mint, no third attempt.
        expect(calls).toHaveLength(3);
        expect(calls.map((c) => c[0])).toEqual(['/labelmap/validate', '/anonSignUp?url=%2F', '/labelmap/validate']);
    });

    test('a redirected-but-OK response does not trigger the mint (only failures are auth-shaped)', async () => {
        const ok = response({ ok: true, redirected: true });
        const { result, calls } = await run([ok]);
        expect(result).toBe(ok);
        expect(calls).toHaveLength(1);
    });
});
