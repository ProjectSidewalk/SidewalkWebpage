/**
 * Tests for desktop Validate's window-resize response, wired up in public/js/validate/src/Main.js (#5367).
 *
 * A resize is when GSV is most likely to stop painting (#2468), so the tool both re-measures the viewer and asks it
 * to force a frame, and records that the viewport moved — the `Window_Resized` line is what later says whether a
 * black-pano report followed a resize, and what accounts for the `POV_Changed` the repaint provokes.
 *
 * Two things have to hold for that record to mean anything, and they are what these tests pin: page load runs the
 * same rescale but must log nothing (nothing was resized), and a drag must log once, on the settled size, however
 * long it lasts. They drive the real static handlers over a fake viewer and tracker.
 *
 * `Main` is a bare `class` declaration that the Grunt bundle concatenates into page scope, so the source is eval'd
 * inside an IIFE that returns the class, following validatePanoPovThrottle.test.js.
 */

const fs = require('fs');
const path = require('path');

const MAIN_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/Main.js');

/**
 * Loads the `Main` class out of the production file.
 * @returns {Function} The Main class.
 */
function loadMainClass() {
    const src = fs.readFileSync(MAIN_PATH, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn Main;\n})()');
}

describe('desktop Validate resize handling (#5367)', () => {
    let Main;
    let viewer;
    let handler; // The listener a test attached, so the next test's dispatches don't reach it too.

    beforeEach(() => {
        jest.useFakeTimers();

        // jsdom does no layout, so the viewport the note reports has to be stated outright.
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1280, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 720, configurable: true });

        global.util = { applyToolScale: jest.fn(() => 1.5) };

        viewer = { resize: jest.fn(), repaint: jest.fn() };
        global.svv = {
            tracker: { push: jest.fn() },
            panoManager: { setMarkerScale: jest.fn() },
            panoViewer: viewer,
        };

        Main = loadMainClass();
    });

    afterEach(() => {
        if (handler) window.removeEventListener('resize', handler);
        handler = undefined;
        jest.useRealTimers();
        delete global.util;
        delete global.svv;
    });

    /** The notes of every Window_Resized the tracker was handed. */
    function windowResizedNotes() {
        return svv.tracker.push.mock.calls.filter((call) => call[0] === 'Window_Resized').map((call) => call[1]);
    }

    test('the startup rescale tells the viewer to repaint but logs nothing', () => {
        Main.applyValidateScale();

        expect(svv.panoManager.setMarkerScale).toHaveBeenCalledWith(1.5);
        expect(viewer.resize).toHaveBeenCalledTimes(1);
        expect(viewer.repaint).toHaveBeenCalledTimes(1);
        expect(windowResizedNotes()).toEqual([]); // Nothing was resized: the page had only just loaded.
    });

    test('a drag rescales on every event but logs one line, on the size that stuck', () => {
        handler = Main.createDesktopResizeHandler();
        window.addEventListener('resize', handler);

        // A drag that outlasts the quiet window many times over: the burst shape a throttle would log repeatedly.
        for (let i = 0; i < 6; i++) {
            window.dispatchEvent(new Event('resize'));
            jest.advanceTimersByTime(100);
        }

        // Every event rescales — a frame drawn at the old scale is visibly wrong — while nothing has been logged:
        // the drag is still going as far as the tool can tell.
        expect(viewer.resize).toHaveBeenCalledTimes(6);
        expect(viewer.repaint).toHaveBeenCalledTimes(6);
        expect(windowResizedNotes()).toEqual([]);

        // 100 ms of the 150 ms quiet window have already passed since the last event.
        jest.advanceTimersByTime(50);
        expect(windowResizedNotes()).toEqual([{ width: 1280, height: 720 }]);
        jest.advanceTimersByTime(5000);
        expect(windowResizedNotes()).toHaveLength(1);
    });

    test('the handler talks to whichever viewer is current, not the one that was up when it was attached', () => {
        handler = Main.createDesktopResizeHandler();
        window.addEventListener('resize', handler);
        window.dispatchEvent(new Event('resize'));

        // A label whose imagery expired swaps svv.panoViewer for the Pannellum fallback mid-mission (#4828).
        const fallback = { resize: jest.fn(), repaint: jest.fn() };
        svv.panoViewer = fallback;
        window.dispatchEvent(new Event('resize'));

        expect(viewer.repaint).toHaveBeenCalledTimes(1);
        expect(fallback.resize).toHaveBeenCalledTimes(1);
        expect(fallback.repaint).toHaveBeenCalledTimes(1);
    });
});
