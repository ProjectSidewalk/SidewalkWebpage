/**
 * Tests for public/js/common/pano-viewer/src/PanoImageCache.js (issue #5562).
 *
 * The cache holds a pano's compressed bytes behind an object URL from the moment Validate knows the label is coming
 * until the viewer has loaded it. What matters is the contract the two sides meet on: an entry is keyed by the exact
 * network URL the viewer would request, a download in flight is never started twice, a failed one is not held, and
 * releasing an entry frees its bytes. Data Saver switches prefetching off, since it is the user saying not to spend
 * their data on imagery they haven't asked to see.
 *
 * jsdom has no object URLs, so `URL.createObjectURL` / `revokeObjectURL` are stubbed to hand out and record ids.
 */

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/PanoImageCache.js');

/**
 * Load the bare `class PanoImageCache` declaration out of the production file, wrapped in an IIFE that returns it.
 * @returns {Function} The class.
 */
function loadCacheClass() {
    const src = fs.readFileSync(CACHE_PATH, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn PanoImageCache;\n})()');
}

/**
 * A `fetch` that answers each URL with a small Blob, or as told.
 * @param {object} [byUrl] - Per-URL overrides: `{ status }` for a non-OK reply, `{ throws: true }` for a network error.
 * @returns {jest.Mock}
 */
function fetchStub(byUrl = {}) {
    return jest.fn((url) => {
        const spec = byUrl[url] ?? {};
        if (spec.throws) return Promise.reject(new Error('network down'));
        const status = spec.status ?? 200;
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            blob: () => Promise.resolve(new Blob([`bytes of ${url}`])),
        });
    });
}

describe('PanoImageCache (issue #5562)', () => {
    let PanoImageCache;
    let cache;
    let nextObjectUrl;

    beforeEach(() => {
        nextObjectUrl = 0;
        URL.createObjectURL = jest.fn(() => `blob:pano-${nextObjectUrl++}`);
        URL.revokeObjectURL = jest.fn();
        global.fetch = fetchStub();
        // The viewer's own URL builder; the cache only needs it to be the same function the viewer uses.
        global.panoramaUrlFor = jest.fn((metadata) => `${metadata.imageUrl}?maxWidth=8192`);
        delete navigator.connection;

        PanoImageCache = loadCacheClass();
        cache = new PanoImageCache();
    });

    afterEach(() => {
        delete URL.createObjectURL;
        delete URL.revokeObjectURL;
        delete global.fetch;
        delete global.panoramaUrlFor;
        delete navigator.connection;
    });

    test('a prefetched URL resolves to a local copy of its bytes', async () => {
        await expect(cache.prefetch('/backupImage/p1')).resolves.toBe(true);

        expect(global.fetch).toHaveBeenCalledWith('/backupImage/p1');
        expect(cache.has('/backupImage/p1')).toBe(true);
        expect(cache.resolve('/backupImage/p1')).toBe('blob:pano-0');
    });

    test('a URL never prefetched resolves to nothing, so the viewer loads it from the network', () => {
        expect(cache.has('/backupImage/p1')).toBe(false);
        expect(cache.resolve('/backupImage/p1')).toBeUndefined();
    });

    test('asking twice while the download is in flight downloads once', async () => {
        const first = cache.prefetch('/backupImage/p1');
        const second = cache.prefetch('/backupImage/p1');

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('asking again for a held URL downloads nothing', async () => {
        await cache.prefetch('/backupImage/p1');
        await cache.prefetch('/backupImage/p1');

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('a reply that is not OK is not held, and is reported rather than thrown', async () => {
        global.fetch = fetchStub({ '/backupImage/gone': { status: 404 } });

        await expect(cache.prefetch('/backupImage/gone')).resolves.toBe(false);
        expect(cache.has('/backupImage/gone')).toBe(false);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    test('a network error is not held, and is reported rather than thrown', async () => {
        global.fetch = fetchStub({ '/backupImage/p1': { throws: true } });

        await expect(cache.prefetch('/backupImage/p1')).resolves.toBe(false);
        expect(cache.has('/backupImage/p1')).toBe(false);
    });

    test('a failed download can be asked for again', async () => {
        global.fetch = fetchStub({ '/backupImage/p1': { throws: true } });
        await cache.prefetch('/backupImage/p1');

        global.fetch = fetchStub();
        await expect(cache.prefetch('/backupImage/p1')).resolves.toBe(true);
    });

    test('nothing is prefetched under Data Saver', async () => {
        navigator.connection = { saveData: true };

        await expect(cache.prefetch('/backupImage/p1')).resolves.toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('an empty URL is declined without a request', async () => {
        await expect(cache.prefetch(undefined)).resolves.toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('releasing an entry frees its bytes and forgets it', async () => {
        await cache.prefetch('/backupImage/p1');

        cache.release('/backupImage/p1');

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pano-0');
        expect(cache.has('/backupImage/p1')).toBe(false);
    });

    test('releasing a URL that was never held is a no-op', () => {
        expect(() => cache.release('/backupImage/never')).not.toThrow();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    test('holds no more than MAX_ENTRIES, dropping the oldest first', async () => {
        const urls = ['/backupImage/a', '/backupImage/b', '/backupImage/c', '/backupImage/d'];
        for (const url of urls) await cache.prefetch(url);

        expect(PanoImageCache.MAX_ENTRIES).toBe(3);
        expect(cache.has('/backupImage/a')).toBe(false);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pano-0');
        expect(urls.slice(1).every((url) => cache.has(url))).toBe(true);
    });

    test('prefetchBackups asks for each backup at the URL the viewer would load it from, nearest first', async () => {
        const backups = [{ imageUrl: '/backupImage/p1' }, { imageUrl: '/backupImage/p2' }];

        await cache.prefetchBackups(backups);

        expect(global.panoramaUrlFor).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls.map(([url]) => url))
            .toEqual(['/backupImage/p1?maxWidth=8192', '/backupImage/p2?maxWidth=8192']);
    });

    test('prefetchBackups downloads one at a time: the second starts once the first has settled', async () => {
        let finishFirst;
        global.fetch = jest.fn((url) => (url.includes('p1')
            ? new Promise((resolve) => { finishFirst = resolve; })
            : Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['p2'])) })));

        const done = cache.prefetchBackups([{ imageUrl: '/backupImage/p1' }, { imageUrl: '/backupImage/p2' }]);
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);

        finishFirst({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['p1'])) });
        await done;
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('settle() waits for a download in flight and then hands over its bytes', async () => {
        let finish;
        global.fetch = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
        cache.prefetch('/backupImage/p1');

        let settled;
        const waiting = cache.settle('/backupImage/p1', 10000).then((url) => { settled = url; });
        await Promise.resolve();
        expect(settled).toBeUndefined(); // Still waiting, not answered "nothing held".

        finish({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['p1'])) });
        await waiting;
        expect(settled).toBe('blob:pano-0');
    });

    test('settle() gives up on a stalled download after the timeout', async () => {
        jest.useFakeTimers();
        try {
            global.fetch = jest.fn(() => new Promise(() => {})); // Never answers.
            cache.prefetch('/backupImage/p1');

            const waiting = cache.settle('/backupImage/p1', 10000);
            await jest.advanceTimersByTimeAsync(10000);

            await expect(waiting).resolves.toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    test('settle() on a URL with nothing in flight answers at once', async () => {
        await expect(cache.settle('/backupImage/p1', 10000)).resolves.toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a URL released while its download is in flight is dropped on arrival, not held', async () => {
        let finish;
        global.fetch = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
        const download = cache.prefetch('/backupImage/p1');

        cache.release('/backupImage/p1'); // The viewer loaded it from the network meanwhile and is done with it.
        finish({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['p1'])) });

        await expect(download).resolves.toBe(false);
        expect(cache.has('/backupImage/p1')).toBe(false);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    test('a release before the download starts does not poison a later prefetch of the same URL', async () => {
        cache.release('/backupImage/p1');

        await expect(cache.prefetch('/backupImage/p1')).resolves.toBe(true);
        expect(cache.has('/backupImage/p1')).toBe(true);
    });

    test('clear() releases everything', async () => {
        await cache.prefetch('/backupImage/p1');
        await cache.prefetch('/backupImage/p2');

        cache.clear();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(cache.has('/backupImage/p1')).toBe(false);
        expect(cache.has('/backupImage/p2')).toBe(false);
    });
});
