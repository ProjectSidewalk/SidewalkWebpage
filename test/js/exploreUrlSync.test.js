/**
 * Tests for Explore's live URL (public/js/explore/src/navigation/ExploreUrlSync.js, #5480): the address bar follows
 * the labeler's pano, view and immersive state, through `replaceState` and under a write budget.
 *
 * What the module has to get right is the contract with the read side (ExploreController binds these names), that
 * the mission's own params never survive into a link, that a pan is not a Back entry, and that a drag's per-frame
 * POV events collapse to one write per interval with the last view winning. ExploreUrlSync is a Grunt-concatenated
 * `class` reaching for `util.url`, so the source is eval'd into jsdom with urlQuery.js loaded first.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

describe('ExploreUrlSync', () => {
    let ExploreUrlSync;
    let viewer;
    let listeners;
    let immersive;
    let replaceState;

    /** A viewer stub: the three getters the URL reads, and the two events it subscribes to. */
    function makeViewer(state) {
        listeners = { pano_changed: [], pov_changed: [] };
        return {
            state,
            getPanoId: () => state.panoId,
            getPosition: () => state.position,
            getPov: () => state.pov,
            addListener: (event, handler) => listeners[event].push(handler),
        };
    }

    const fire = (event) => listeners[event].forEach((handler) => handler());
    const currentUrl = () => `${window.location.pathname}${window.location.search}`;

    beforeAll(() => {
        window.eval(read('public/js/common/urlQuery.js'));
        window.eval(`${read('public/js/explore/src/navigation/ExploreUrlSync.js')}\nwindow.ExploreUrlSync = ExploreUrlSync;`);
        ExploreUrlSync = window.ExploreUrlSync;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        window.history.replaceState(null, '', '/explore?routeId=12&resumeRoute=true&placeName=Here');
        immersive = false;
        viewer = makeViewer({
            panoId: 'abc123',
            position: { lat: 47.6062095, lng: -122.3320708 },
            pov: { heading: 91.26, pitch: -3.04, zoom: 1.5 },
        });
        replaceState = jest.spyOn(window.history, 'replaceState');
    });

    afterEach(() => {
        replaceState.mockRestore();
        jest.useRealTimers();
    });

    test('writes the pano, its position, the view and nothing of the mission, as the read side names them', () => {
        new ExploreUrlSync(viewer, () => immersive).start();
        expect(currentUrl()).toBe('/explore?panoId=abc123&lat=47.606209&lng=-122.332071&heading=91.3&pitch=-3&zoom=1.5');
        expect(window.location.search).not.toMatch(/routeId|resumeRoute|placeName/);
    });

    test('carries immersive mode as immersive=1 and drops it on exit', () => {
        immersive = true;
        const sync = new ExploreUrlSync(viewer, () => immersive);
        sync.start();
        expect(window.location.search).toMatch(/&immersive=1$/);

        immersive = false;
        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);
        sync.request();
        expect(window.location.search).not.toContain('immersive');
    });

    test('normalizes /audit to /explore and keeps the hash', () => {
        window.history.replaceState(null, '', '/audit?regionId=3#frag');
        new ExploreUrlSync(viewer, () => immersive).start();
        expect(window.location.pathname).toBe('/explore');
        expect(window.location.search).not.toContain('regionId');
        expect(window.location.hash).toBe('#frag');
    });

    test('never pushes a history entry', () => {
        const pushState = jest.spyOn(window.history, 'pushState');
        const sync = new ExploreUrlSync(viewer, () => immersive);
        sync.start();
        viewer.state.pov = { heading: 10, pitch: 0, zoom: 1 };
        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);
        sync.request();
        expect(pushState).not.toHaveBeenCalled();
        expect(replaceState).toHaveBeenCalledTimes(2);
        pushState.mockRestore();
    });

    test('collapses a drag to one write per interval, with the view that ends it', () => {
        const sync = new ExploreUrlSync(viewer, () => immersive);
        sync.start();
        expect(replaceState).toHaveBeenCalledTimes(1);

        // Sixty frames of a drag, well inside one interval.
        for (let frame = 1; frame <= 60; frame++) {
            viewer.state.pov = { heading: frame, pitch: 0, zoom: 1 };
            fire('pov_changed');
            jest.advanceTimersByTime(5);
        }
        expect(replaceState).toHaveBeenCalledTimes(1);
        expect(window.location.search).toContain('heading=91.3');

        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);
        expect(replaceState).toHaveBeenCalledTimes(2);
        expect(window.location.search).toContain('heading=60');
    });

    test('writes a pano change at once when the page has been quiet', () => {
        const sync = new ExploreUrlSync(viewer, () => immersive);
        sync.start();
        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);

        viewer.state.panoId = 'next456';
        viewer.state.position = { lat: 47.61, lng: -122.33 };
        fire('pano_changed');
        expect(replaceState).toHaveBeenCalledTimes(2);
        expect(window.location.search).toMatch(/^\?panoId=next456&lat=47.61&lng=-122.33&/);
    });

    test('skips a write that would change nothing', () => {
        const sync = new ExploreUrlSync(viewer, () => immersive);
        sync.start();
        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);
        fire('pov_changed');
        expect(replaceState).toHaveBeenCalledTimes(1);
    });

    test('wraps the heading into [0, 360), after rounding', () => {
        viewer.state.pov = { heading: 450, pitch: 0, zoom: 1 };
        expect(ExploreUrlSync.paramsFor(viewer, false).get('heading')).toBe('90');
        viewer.state.pov = { heading: -90, pitch: 0, zoom: 1 };
        expect(ExploreUrlSync.paramsFor(viewer, false).get('heading')).toBe('270');
        viewer.state.pov = { heading: 359.96, pitch: 0, zoom: 1 };
        expect(ExploreUrlSync.paramsFor(viewer, false).get('heading')).toBe('0');
    });

    test('has nothing to say while the viewer has no pano or view', () => {
        viewer.state.panoId = null;
        expect(ExploreUrlSync.paramsFor(viewer, false)).toBeNull();
        viewer.state.panoId = 'abc123';
        viewer.state.pov = { heading: Number.NaN, pitch: 0, zoom: 1 };
        expect(ExploreUrlSync.paramsFor(viewer, false)).toBeNull();

        new ExploreUrlSync(viewer, () => immersive).start();
        expect(replaceState).not.toHaveBeenCalled();
        expect(currentUrl()).toBe('/explore?routeId=12&resumeRoute=true&placeName=Here');
    });

    test('survives a browser that has run out of history writes', () => {
        replaceState.mockImplementation(() => { throw new Error('SecurityError'); });
        const sync = new ExploreUrlSync(viewer, () => immersive);
        expect(() => sync.start()).not.toThrow();
        // The next write is attempted again rather than the module giving up.
        replaceState.mockRestore();
        replaceState = jest.spyOn(window.history, 'replaceState');
        viewer.state.pov = { heading: 10, pitch: 0, zoom: 1 };
        jest.advanceTimersByTime(ExploreUrlSync.WRITE_INTERVAL_MS);
        sync.request();
        expect(window.location.search).toContain('heading=10');
    });
});
