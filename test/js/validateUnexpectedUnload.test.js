/**
 * Tests for frontend/js/validate/util/MissionLiveMarker.js (issue #5561).
 *
 * iOS ends a tab it wants memory back from by killing the page and reloading it when the user next looks, and
 * nothing fires on the way out. The marker is how the next page life finds out: `sessionStorage` survives that
 * reload, a marker set while a mission is live is cleared by every orderly exit (`pagehide`), so one that is still
 * there on the next load means the last life was cut short. The suite pins that contract, and that a browser with
 * storage switched off (Safari private browsing throws) degrades to "nothing to report" rather than an exception in
 * the middle of Validate's startup.
 */

const path = require('path');
const { loadModules } = require('./loadGlobalScript');

const MARKER_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/util/MissionLiveMarker.js');

/**
 * Load the bare `class MissionLiveMarker` declaration out of the production file: the Grunt bundle concatenates it
 * into page scope, so wrap the source in an IIFE that returns the class.
 * @returns {Function} The class.
 */
function loadMarkerClass() {
    return loadModules(MARKER_PATH).MissionLiveMarker;
}

/** @returns {Storage} An in-memory stand-in for sessionStorage, shared across the "page lives" of one tab. */
function fakeStorage() {
    const items = new Map();
    return {
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: (key) => items.delete(key),
    };
}

/** @returns {Storage} A storage every access to which throws, as Safari's does with site data blocked. */
function throwingStorage() {
    const boom = () => { throw new Error('SecurityError: The operation is insecure.'); };
    return { getItem: boom, setItem: boom, removeItem: boom };
}

describe('MissionLiveMarker (issue #5561)', () => {
    let MissionLiveMarker;
    let storage;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);
        // jsdom's `performance` has no Navigation Timing, so the entry a browser would report is supplied here.
        performance.getEntriesByType = jest.fn(() => [{ type: 'reload' }]);
        MissionLiveMarker = loadMarkerClass();
        storage = fakeStorage();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete performance.getEntriesByType;
    });

    /** A page life ending the way pages are supposed to. */
    function orderlyExit() {
        window.dispatchEvent(new Event('pagehide'));
    }

    test('a fresh tab has nothing to report', () => {
        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toBeNull();
    });

    test('a life that ended without a pagehide is reported to the next one, with what it was doing', () => {
        new MissionLiveMarker(storage).markLive(42);
        jest.advanceTimersByTime(90 * 1000);
        // The kill: no pagehide, and a new page life reads the same tab's storage.

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload())
            .toEqual({ missionId: 42, ageSec: 90, navType: 'reload' });
    });

    test('the report is consumed, so a life is only ever reported once', () => {
        new MissionLiveMarker(storage).markLive(42);

        const next = new MissionLiveMarker(storage);
        expect(next.takeUnexpectedUnload()).not.toBeNull();
        expect(next.takeUnexpectedUnload()).toBeNull();
    });

    test('a pagehide withdraws the marker, so a deliberate reload reports nothing', () => {
        new MissionLiveMarker(storage).markLive(42);
        orderlyExit();

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toBeNull();
    });

    test('a life that already reported the last one still leaves its own marker for the next', () => {
        new MissionLiveMarker(storage).markLive(1);

        const second = new MissionLiveMarker(storage);
        expect(second.takeUnexpectedUnload().missionId).toBe(1);
        second.markLive(2);

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload().missionId).toBe(2);
    });

    test('says how the page arrived, and "unknown" when the browser does not say', () => {
        performance.getEntriesByType.mockReturnValue([]);
        new MissionLiveMarker(storage).markLive(42);

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload().navType).toBe('unknown');
    });

    test('storage that throws is treated as no marker, in both directions', () => {
        const marker = new MissionLiveMarker(throwingStorage());

        expect(() => marker.markLive(42)).not.toThrow();
        expect(marker.takeUnexpectedUnload()).toBeNull();
        expect(() => marker.clear()).not.toThrow();
    });

    test('a marker that is not what this code wrote is ignored', () => {
        storage.setItem(MissionLiveMarker.KEY, '{not json');

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toBeNull();
    });

    test('each mission re-marks the life, so a kill names the mission cut short and its own age', () => {
        const marker = new MissionLiveMarker(storage);
        marker.markLive(1);
        jest.advanceTimersByTime(60 * 1000);
        marker.markLive(2);
        jest.advanceTimersByTime(30 * 1000);

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toMatchObject({ missionId: 2, ageSec: 30 });
    });

    test('the exit listener is registered once however many missions a page runs', () => {
        const listen = jest.spyOn(window, 'addEventListener');
        const marker = new MissionLiveMarker(storage);
        marker.markLive(1);
        marker.markLive(2);

        expect(listen.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(1);
        listen.mockRestore();
    });

    test('a page restored from the back/forward cache marks itself live again', () => {
        new MissionLiveMarker(storage).markLive(42);
        orderlyExit(); // Into the cache: pagehide fires with persisted = true.
        const restored = new Event('pageshow');
        Object.defineProperty(restored, 'persisted', { value: true });
        window.dispatchEvent(restored);

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toMatchObject({ missionId: 42 });
    });

    test('a pageshow that is a fresh load, not a restore, marks nothing', () => {
        new MissionLiveMarker(storage).markLive(42);
        orderlyExit();
        window.dispatchEvent(new Event('pageshow'));

        expect(new MissionLiveMarker(storage).takeUnexpectedUnload()).toBeNull();
    });
});
