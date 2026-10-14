/**
 * Integration test for the POV_Changed logging throttle wired up in
 * frontend/js/validate/panorama/PanoManager.js, which subscribes the primary viewer on its first load (issue #2745).
 *
 * Dragging the pano fires `pov_changed` on every frame; before #2745 each one was logged, flooding the Tracker's
 * interaction buffer and forcing its 200-action mid-mission flush every few validations. This test drives the REAL
 * `PanoManager.create` factory (with a fake pano viewer) and the REAL `util.throttle`, then fires a `pov_changed`
 * firehose and asserts the tracker sees at most one `POV_Changed` per window — pinning the wiring itself, not just
 * the throttle in isolation (throttle.test.js covers that).
 *
 * Fake timers also mock Date.now, which the throttle's elapsed-time math reads.
 */

import { loadModules } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';

fakePanoOverlays();

describe('PanoManager POV_Changed throttling (issue #2745)', () => {
    let PanoManager;
    let listeners; // event name -> callback captured from the fake viewer's addListener
    let FakeViewerType;
    let tracker;

    beforeEach(async () => {
        vi.useFakeTimers();
        // Anchor the fake clock at a non-zero time so the throttle's first elapsed check reliably exceeds the window.
        vi.setSystemTime(1_000_000);

        // The pano canvas #init looks up, with a parent for the fallback canvas + viewer logo to attach to.
        document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

        window.i18next = { language: 'en' };
        tracker = fakeTracker();

        const panoData = {
            getPanoId: () => 'pano1',
            getProperty: () => new Date(2026, 5)
        };
        listeners = {};
        const fakeViewer = {
            setPano: vi.fn(() => Promise.resolve(panoData)),
            addListener: vi.fn((event, cb) => { listeners[event] = cb; }),
            resize: vi.fn()
        };
        FakeViewerType = class FakeViewerType {
            static create() { return Promise.resolve(fakeViewer); }
        };

        ({ PanoManager } = await loadModules('frontend/js/validate/panorama/PanoManager.js'));
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    /**
     * Create the manager and load the first label's pano, the way Validate's first render does.
     * @returns {Promise<void>}
     */
    async function loadFirstPano() {
        const viewerUi = { date: { textContent: '' }, controlLayer: document.createElement('div') };
        const panoManager = await PanoManager.create(
            'token', viewerUi, { viewerType: FakeViewerType, labelRadius: 10 }, { addPanoMetadata: vi.fn() }, {},
            tracker,
        );
        await panoManager.setPanorama('pano1', null);
    }

    /** Count how many times the tracker logged a POV_Changed action. */
    function povChangedLogCount() {
        return tracker.push.mock.calls.filter(call => call[0] === 'POV_Changed').length;
    }

    test('a pov_changed firehose is coalesced into one leading + one trailing log per window', async () => {
        await loadFirstPano();
        expect(listeners.pov_changed).toBeDefined();

        // Simulate one continuous drag: dozens of pov_changed events within a single 500ms window.
        for (let i = 0; i < 25; i++) {
            listeners.pov_changed();
        }
        expect(povChangedLogCount()).toBe(1); // leading edge only

        vi.advanceTimersByTime(500);
        expect(povChangedLogCount()).toBe(2); // one trailing log so the final POV is still recorded
    });

    test('panning again after a quiet period logs again (the listener stays wired)', async () => {
        await loadFirstPano();

        listeners.pov_changed();
        expect(povChangedLogCount()).toBe(1);

        vi.advanceTimersByTime(5000); // quiet period, well past the window (no burst, so no trailing call)
        expect(povChangedLogCount()).toBe(1);

        listeners.pov_changed();
        expect(povChangedLogCount()).toBe(2);
    });

    test('sustained panning logs at most ~one POV_Changed per window, not one per frame', async () => {
        await loadFirstPano();

        // 100 frames of dragging, 50ms apart (~5s of continuous panning).
        for (let i = 0; i < 100; i++) {
            listeners.pov_changed();
            vi.advanceTimersByTime(50);
        }

        // ~one per 500ms window over ~5s: on the order of 10 logs, nowhere near the 100 raw events.
        expect(povChangedLogCount()).toBeGreaterThan(2);
        expect(povChangedLogCount()).toBeLessThan(15);
    });
});
