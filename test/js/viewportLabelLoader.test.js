/**
 * Tests for public/js/ps-map/ViewportLabelLoader.js (#5002): the viewport-scoped label feed's fetch policy —
 * padded-bbox construction and maxBounds clamping, the containment skip, moveend debouncing, the in-flight /
 * stale-response guards, the zoom floor, failure/retry recovery, and late-subscriber replay.
 *
 * ViewportLabelLoader is a Grunt-concatenated `class` that reaches for page globals (fetchLabelFeed, util), so
 * the source is eval'd into jsdom with those stubbed. The map is a four-method stub; no mapbox-gl involved.
 */

const fs = require('fs');
const path = require('path');

const LOADER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/ps-map/ViewportLabelLoader.js'), 'utf8');

const DEBOUNCE_MS = 350;

/** A LngLatBounds-shaped stub. */
function bounds(w, s, e, n) {
    return { getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n };
}

/** A map stub with just the surface the loader touches. Mutate `.view`/`.zoom` to move the camera. */
function stubMap({ zoom = 15, view = bounds(-0.1, -0.1, 0.1, 0.1), maxBounds = null } = {}) {
    const handlers = {};
    return {
        zoom,
        view,
        maxBounds,
        getZoom() { return this.zoom; },
        getBounds() { return this.view; },
        getMaxBounds() { return this.maxBounds; },
        on(event, handler) { (handlers[event] ??= []).push(handler); },
        off(event, handler) { handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler); },
        fire(event) { [...(handlers[event] ?? [])].forEach((h) => h()); },
    };
}

/** Runs queued microtasks so awaited fetch results propagate under fake timers. */
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Fires a moveend and lets the debounce elapse. */
async function settleMove(map) {
    map.fire('moveend');
    jest.advanceTimersByTime(DEBOUNCE_MS);
    await flush();
}

describe('ViewportLabelLoader', () => {
    /** @type {Array<{url: URL, resolve: Function, reject: Function}>} */
    let fetches;

    beforeAll(() => {
        window.eval(`${LOADER_SRC}\nwindow.ViewportLabelLoader = ViewportLabelLoader;`);
    });

    beforeEach(() => {
        jest.useFakeTimers();
        fetches = [];
        // Deferred-style stub of psMapUtilities' fetchLabelFeed: each call is resolved/rejected by the test,
        // and an abort surfaces as the AbortError the real fetch would throw.
        window.fetchLabelFeed = jest.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
            fetches.push({ url: new URL(url), resolve, reject });
            signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** Builds a started loader over the given map, collecting its emissions. */
    function build(map, options = {}) {
        const loader = new window.ViewportLabelLoader(map, 'http://localhost/labels/all',
            { floorApplies: () => false, ...options });
        const seen = { data: [], errors: [], states: [] };
        loader.onData((fc, meta) => seen.data.push({ fc, meta }));
        loader.onError((e) => seen.errors.push(e));
        loader.onStateChange((state) => seen.states.push(state));
        loader.start();
        return { loader, seen };
    }

    /** The bbox param of the nth request, as numbers. */
    const bboxOf = (n) => fetches[n].url.searchParams.get('bbox').split(',').map(Number);

    const FC = { type: 'FeatureCollection', features: [{ properties: { label_id: 1 } }] };

    test('first fetch requests the viewport padded by half its span per side', async () => {
        build(stubMap({ view: bounds(-0.1, -0.1, 0.1, 0.1) }));
        expect(fetches).toHaveLength(1);
        expect(bboxOf(0)).toEqual([-0.2, -0.2, 0.2, 0.2]);
    });

    test('padding is clamped to the map maxBounds, and page-level params survive on the URL', async () => {
        const map = stubMap({ view: bounds(-0.1, -0.1, 0.1, 0.1), maxBounds: bounds(-0.15, -0.12, 0.15, 0.12) });
        const loader = new window.ViewportLabelLoader(map, 'http://localhost/labels/all?regions=5',
            { floorApplies: () => false });
        loader.start();
        expect(bboxOf(0)).toEqual([-0.15, -0.12, 0.15, 0.12]);
        expect(fetches[0].url.searchParams.get('regions')).toBe('5');
    });

    test('a move that stays inside the fetched bbox fetches nothing; escaping it fetches once', async () => {
        const map = stubMap({ view: bounds(-0.1, -0.1, 0.1, 0.1) });
        const { seen } = build(map);
        fetches[0].resolve(FC);
        await flush();
        expect(seen.data).toHaveLength(1);

        map.view = bounds(-0.15, -0.15, 0.05, 0.05); // Still inside the padded (-0.2..0.2) box.
        await settleMove(map);
        expect(fetches).toHaveLength(1);

        map.view = bounds(0.15, 0.15, 0.35, 0.35); // East/north edge escapes.
        await settleMove(map);
        expect(fetches).toHaveLength(2);
        expect(bboxOf(1)).toEqual([0.05, 0.05, 0.45, 0.45]);
    });

    test('a burst of movends debounces into one evaluation', async () => {
        const map = stubMap();
        build(map);
        fetches[0].resolve(FC);
        await flush();

        map.view = bounds(1, 1, 1.2, 1.2);
        map.fire('moveend');
        jest.advanceTimersByTime(100);
        map.fire('moveend');
        jest.advanceTimersByTime(100);
        map.fire('moveend');
        jest.advanceTimersByTime(DEBOUNCE_MS);
        await flush();
        expect(fetches).toHaveLength(2);
    });

    test('a move during an in-flight fetch queues exactly one follow-up against the newest viewport', async () => {
        const map = stubMap({ view: bounds(0, 0, 0.1, 0.1) });
        const { seen } = build(map);
        expect(fetches).toHaveLength(1);

        map.view = bounds(1, 1, 1.1, 1.1);
        await settleMove(map); // Busy: queues, doesn't fetch.
        map.view = bounds(2, 2, 2.1, 2.1);
        await settleMove(map); // Still busy: the single queued follow-up must use this newer viewport.
        expect(fetches).toHaveLength(1);

        fetches[0].resolve(FC);
        await flush();
        expect(fetches).toHaveLength(2);
        expect(bboxOf(1)).toEqual([1.95, 1.95, 2.15, 2.15]);
        fetches[1].resolve(FC);
        await flush();
        expect(seen.data).toHaveLength(2);
    });

    test('below the zoom floor: one empty emission, a belowFloor state, and no network', async () => {
        const map = stubMap({ zoom: 10 });
        const { seen } = build(map, { floorApplies: () => true, minFetchZoom: 13 });
        expect(fetches).toHaveLength(0);
        expect(seen.data).toHaveLength(1);
        expect(seen.data[0].fc.features).toEqual([]);
        expect(seen.states).toEqual(['belowFloor']);

        await settleMove(map); // Panning around below the floor stays silent.
        expect(fetches).toHaveLength(0);
        expect(seen.data).toHaveLength(1);
    });

    test('crossing back above the floor always refetches, even into the same viewport', async () => {
        const map = stubMap({ zoom: 15 });
        const { seen } = build(map, { floorApplies: () => true, minFetchZoom: 13 });
        fetches[0].resolve(FC);
        await flush();

        map.zoom = 10; // The floor clears the layers...
        await settleMove(map);
        expect(seen.data).toHaveLength(2);
        expect(seen.data[1].fc.features).toEqual([]);

        map.zoom = 15; // ...so returning must refill them: containment can't skip this fetch.
        await settleMove(map);
        expect(fetches).toHaveLength(2);
        fetches[1].resolve(FC);
        await flush();
        expect(seen.data).toHaveLength(3);
        expect(seen.states).toEqual(['loading', 'idle', 'belowFloor', 'loading', 'idle']);
    });

    test('entering the floor aborts an in-flight fetch, whose response then never applies', async () => {
        const map = stubMap({ zoom: 15 });
        const { seen } = build(map, { floorApplies: () => true, minFetchZoom: 13 });
        expect(fetches).toHaveLength(1);

        map.zoom = 10;
        await settleMove(map);
        await flush();
        // Only the floor's empty collection was emitted; the aborted request contributed nothing.
        expect(seen.data).toHaveLength(1);
        expect(seen.data[0].fc.features).toEqual([]);
        expect(seen.errors).toHaveLength(0);
    });

    test('the floor is inert where floorApplies says so', async () => {
        const map = stubMap({ zoom: 8 });
        build(map, { floorApplies: () => false, minFetchZoom: 13 });
        expect(fetches).toHaveLength(1);
    });

    test('a failed fetch emits an error, stores nothing, and refetch() recovers', async () => {
        const map = stubMap();
        const { loader, seen } = build(map);
        fetches[0].reject(new Error('Label feed returned an unreadable body (truncated stream?)'));
        await flush();
        expect(seen.errors).toHaveLength(1);
        expect(seen.states).toEqual(['loading', 'error']);

        loader.refetch();
        await flush();
        expect(fetches).toHaveLength(2);
        fetches[1].resolve(FC);
        await flush();
        expect(seen.data).toHaveLength(1);
        expect(seen.states).toEqual(['loading', 'error', 'loading', 'idle']);
    });

    test('a moveend after a failure retries on its own (the failed bbox is not remembered)', async () => {
        const map = stubMap();
        build(map);
        fetches[0].reject(new Error('boom'));
        await flush();

        await settleMove(map); // Same viewport — still refetches, because the failure stored no bbox.
        expect(fetches).toHaveLength(2);
    });

    test('subscribing after data has arrived replays the latest emission', async () => {
        const map = stubMap();
        const { loader } = build(map);
        fetches[0].resolve(FC);
        await flush();

        const late = jest.fn();
        loader.onData(late);
        expect(late).toHaveBeenCalledTimes(1);
        expect(late.mock.calls[0][0]).toBe(FC);
        expect(late.mock.calls[0][1]).toEqual({ isInitial: true });
    });

    test('the default floor predicate asks util.isMobile', async () => {
        window.util = { isMobile: () => true };
        const map = stubMap({ zoom: 10 });
        const loader = new window.ViewportLabelLoader(map, 'http://localhost/labels/all');
        const states = [];
        loader.onStateChange((s) => states.push(s));
        loader.start();
        expect(states).toEqual(['belowFloor']);
        expect(fetches).toHaveLength(0);
        delete window.util;
    });

    test('destroy() unbinds from the map', async () => {
        const map = stubMap();
        const { loader } = build(map);
        fetches[0].resolve(FC);
        await flush();

        loader.destroy();
        map.view = bounds(5, 5, 5.1, 5.1);
        await settleMove(map);
        expect(fetches).toHaveLength(1);
    });
});
