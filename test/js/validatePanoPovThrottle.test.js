/**
 * Integration test for the POV_Changed logging throttle wired up in
 * public/js/validate/src/panorama/PanoManager.js `#init` (issue #2745).
 *
 * Dragging the pano fires `pov_changed` on every frame; before #2745 each one was logged, flooding the Tracker's
 * interaction buffer and forcing its 200-action mid-mission flush every few validations. This test drives the REAL
 * `PanoManager.create` factory (with a fake pano viewer) and the REAL `util.throttle`, then fires a `pov_changed`
 * firehose and asserts the tracker sees at most one `POV_Changed` per window — pinning the wiring itself, not just
 * the throttle in isolation (throttle.test.js covers that).
 *
 * Runs under jsdom (jest.config.js) with fake timers (which also mock Date.now for the throttle's elapsed-time math).
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

/**
 * Load the `PanoManager` class out of the production file. Like Form.js, it is a bare `class` declaration that the
 * Grunt bundle concatenates into page scope, so wrap it in an IIFE that returns the class.
 * @returns {Function} The PanoManager class.
 */
function loadPanoManagerClass() {
    const src = fs.readFileSync(PANO_MANAGER_PATH, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn PanoManager;\n})()');
}

describe('PanoManager POV_Changed throttling (issue #2745)', () => {
    let PanoManager;
    let listeners; // event name -> callback captured from the fake viewer's addListener
    let FakeViewerType;

    beforeEach(() => {
        jest.useFakeTimers();
        // Anchor the fake clock at a non-zero time so the throttle's first elapsed check reliably exceeds the window.
        jest.setSystemTime(1_000_000);

        // The pano canvas #init looks up, with a parent for the fallback canvas + viewer logo to attach to.
        document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

        // Real throttle implementation — the unit under integration here.
        global.util = {};
        (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));

        // Globals PanoManager's init path reads.
        util.isMobile = () => false;
        global.createPanoViewerLogo = jest.fn(() => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() }));
        global.GsvViewer = class GsvViewer {};             // distinct from FakeViewerType, so the GSV-only
        global.MapillaryViewer = class MapillaryViewer {}; // and Mapillary-only attribution paths are skipped
        global.svv = {
            tracker: { push: jest.fn() },
            panoStore: { addPanoMetadata: jest.fn() },
            ui: { viewer: { date: { text: jest.fn() } } }
        };

        const panoData = {
            getPanoId: () => 'pano1',
            getProperty: () => ({ format: () => 'Jun 2026' })
        };
        listeners = {};
        const fakeViewer = {
            setPano: jest.fn(() => Promise.resolve(panoData)),
            addListener: jest.fn((event, cb) => { listeners[event] = cb; }),
            resize: jest.fn()
        };
        FakeViewerType = class FakeViewerType {
            static create() { return Promise.resolve(fakeViewer); }
        };

        PanoManager = loadPanoManagerClass();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
        delete global.util;
        delete global.createPanoViewerLogo;
        delete global.GsvViewer;
        delete global.MapillaryViewer;
        delete global.svv;
    });

    /** Count how many times the tracker logged a POV_Changed action. */
    function povChangedLogCount() {
        return svv.tracker.push.mock.calls.filter(call => call[0] === 'POV_Changed').length;
    }

    test('a pov_changed firehose is coalesced into one leading + one trailing log per window', async () => {
        await PanoManager.create(FakeViewerType, 'token', 'pano1');
        expect(listeners.pov_changed).toBeDefined();

        // Simulate one continuous drag: dozens of pov_changed events within a single 500ms window.
        for (let i = 0; i < 25; i++) {
            listeners.pov_changed();
        }
        expect(povChangedLogCount()).toBe(1); // leading edge only

        jest.advanceTimersByTime(500);
        expect(povChangedLogCount()).toBe(2); // one trailing log so the final POV is still recorded
    });

    test('panning again after a quiet period logs again (the listener stays wired)', async () => {
        await PanoManager.create(FakeViewerType, 'token', 'pano1');

        listeners.pov_changed();
        expect(povChangedLogCount()).toBe(1);

        jest.advanceTimersByTime(5000); // quiet period, well past the window (no burst, so no trailing call)
        expect(povChangedLogCount()).toBe(1);

        listeners.pov_changed();
        expect(povChangedLogCount()).toBe(2);
    });

    test('sustained panning logs at most ~one POV_Changed per window, not one per frame', async () => {
        await PanoManager.create(FakeViewerType, 'token', 'pano1');

        // 100 frames of dragging, 50ms apart (~5s of continuous panning).
        for (let i = 0; i < 100; i++) {
            listeners.pov_changed();
            jest.advanceTimersByTime(50);
        }

        // ~one per 500ms window over ~5s: on the order of 10 logs, nowhere near the 100 raw events.
        expect(povChangedLogCount()).toBeGreaterThan(2);
        expect(povChangedLogCount()).toBeLessThan(15);
    });
});
