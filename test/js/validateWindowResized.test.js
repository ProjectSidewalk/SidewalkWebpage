/**
 * Tests for desktop Validate's window-resize response, wired up in public/js/validate/src/Main.js (#5367).
 *
 * A resize is when GSV is most likely to stop painting (#2468), so the tool both re-measures the viewer and asks it
 * to force a frame, and records that the viewport moved — the `Window_Resized` line is what later says whether a
 * black-pano report followed a resize, and what accounts for the `POV_Changed` the repaint provokes.
 *
 * Two things have to hold for that record to mean anything, and they are what these tests pin: page load runs the
 * same rescale but must log nothing (nothing was resized), and a drag must log once or twice rather than per event.
 * They drive the real static handlers with the real `util.throttle` over a fake viewer and tracker.
 *
 * `Main` is a bare `class` declaration that the Grunt bundle concatenates into page scope, so the source is eval'd
 * inside an IIFE that returns the class, following validatePanoPovThrottle.test.js.
 */

const fs = require('fs');
const path = require('path');

const MAIN_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/Main.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

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

    beforeEach(() => {
        jest.useFakeTimers();
        // Anchor the fake clock at a non-zero time so the throttle's first elapsed check reliably exceeds the window.
        jest.setSystemTime(1_000_000);

        // jsdom does no layout, so the viewport the note reports has to be stated outright.
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1280, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 720, configurable: true });

        // Real throttle implementation — the coalescing under test is the wiring of it, not the throttle itself.
        global.util = {};
        (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
        util.applyToolScale = jest.fn(() => 1.5);

        viewer = { resize: jest.fn(), repaint: jest.fn() };
        global.svv = {
            tracker: { push: jest.fn() },
            panoManager: { setMarkerScale: jest.fn() },
            panoViewer: viewer,
        };

        Main = loadMainClass();
    });

    afterEach(() => {
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

    test('a drag rescales on every event but logs one line, with the viewport size', () => {
        window.addEventListener('resize', Main.createDesktopResizeHandler());

        window.dispatchEvent(new Event('resize'));
        jest.advanceTimersByTime(20);
        window.dispatchEvent(new Event('resize'));

        // Every event rescales — a frame drawn at the old scale is visibly wrong — while the log is coalesced.
        expect(viewer.resize).toHaveBeenCalledTimes(2);
        expect(viewer.repaint).toHaveBeenCalledTimes(2);
        expect(windowResizedNotes()).toEqual([{ width: 1280, height: 720 }]);

        // One trailing line at the end of the burst records the size that stuck, and that is the last of them.
        jest.advanceTimersByTime(150);
        expect(windowResizedNotes()).toHaveLength(2);
        jest.advanceTimersByTime(5000);
        expect(windowResizedNotes()).toHaveLength(2);
    });
});
