/**
 * Tests for Validate's window-resize response, wired up in frontend/js/validate/Main.js (#5367, #5580).
 *
 * A resize is when GSV is most likely to stop painting (#2468), so the tool both re-measures the viewer and asks it
 * to force a frame, and records that the viewport moved — the `Window_Resized` line is what later says whether a
 * black-pano report followed a resize, and what accounts for the `POV_Changed` the repaint provokes.
 *
 * Two things have to hold for that record to mean anything, and they are what these tests pin: page load runs the
 * same rescale but must log nothing (nothing was resized), and a drag must log once, on the settled size, however
 * long it lasts. Since #5580 the same handler serves phones, so it also has to skip a pinch (which resizes the visual
 * viewport only), say whether the settled size turned the screen, and pin the scale at 1 at phone width. They drive
 * the real static handlers over a fake viewer and tracker.
 *
 * `Main` is a bare `class` declaration that the Grunt bundle concatenates into page scope, so the source is eval'd
 * inside an IIFE that returns the class, following validatePanoPovThrottle.test.js.
 */

const path = require('path');
const { loadModules } = require('./loadGlobalScript');

const MAIN_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/Main.js');

/**
 * Loads the `Main` class out of the production file.
 * @returns {Function} The Main class.
 */
function loadMainClass() {
    return loadModules(MAIN_PATH).Main;
}

/**
 * Sets the layout viewport jsdom reports, since it does no layout of its own.
 * @param {number} width - clientWidth.
 * @param {number} height - clientHeight.
 */
function setViewport(width, height) {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
}

describe('Validate resize handling (#5367, #5580)', () => {
    let Main;
    let viewer;
    let handler; // The listener a test attached, so the next test's dispatches don't reach it too.
    let narrow;

    beforeEach(() => {
        jest.useFakeTimers();
        setViewport(1280, 720);
        narrow = false;
        window.matchMedia = (query) => ({ matches: query === '(width <= 600px)' ? narrow : false });

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
        handler = Main.createResizeHandler();
        window.addEventListener('resize', handler);

        // A drag that outlasts the quiet window many times over: the burst shape a throttle would log repeatedly.
        for (let i = 0; i < 6; i++) {
            setViewport(1280 - 10 * (i + 1), 720);
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
        expect(windowResizedNotes())
            .toEqual([{ width: 1220, height: 720, orientation: 'landscape', rotated: false }]);
        jest.advanceTimersByTime(5000);
        expect(windowResizedNotes()).toHaveLength(1);
    });

    test('the handler talks to whichever viewer is current, not the one that was up when it was attached', () => {
        handler = Main.createResizeHandler();
        window.addEventListener('resize', handler);
        setViewport(1200, 720);
        window.dispatchEvent(new Event('resize'));

        // A label whose imagery expired swaps svv.panoViewer for the Pannellum fallback mid-mission (#4828).
        const fallback = { resize: jest.fn(), repaint: jest.fn() };
        svv.panoViewer = fallback;
        setViewport(1100, 720);
        window.dispatchEvent(new Event('resize'));

        expect(viewer.repaint).toHaveBeenCalledTimes(1);
        expect(fallback.resize).toHaveBeenCalledTimes(1);
        expect(fallback.repaint).toHaveBeenCalledTimes(1);
    });

    // iOS fires resize for a pinch, which zooms the visual viewport and leaves the layout the shape it was.
    test('a resize that leaves the layout viewport alone (a pinch) is neither relaid out nor logged', () => {
        handler = Main.createResizeHandler();
        window.addEventListener('resize', handler);
        window.dispatchEvent(new Event('resize'));
        jest.advanceTimersByTime(1000);

        expect(viewer.resize).not.toHaveBeenCalled();
        expect(windowResizedNotes()).toEqual([]);
    });

    test('a rotation is logged as one, and turning back again is too', () => {
        setViewport(390, 844);
        handler = Main.createResizeHandler();
        window.addEventListener('resize', handler);

        setViewport(844, 390);
        window.dispatchEvent(new Event('resize'));
        jest.advanceTimersByTime(200);
        setViewport(390, 844);
        window.dispatchEvent(new Event('resize'));
        jest.advanceTimersByTime(200);

        expect(windowResizedNotes()).toEqual([
            { width: 844, height: 390, orientation: 'landscape', rotated: true },
            { width: 390, height: 844, orientation: 'portrait', rotated: true },
        ]);
    });

    test('immersive at phone width writes scale 1 rather than fitting the desktop footprint', () => {
        narrow = true;
        svv.immersiveMode = { isActive: () => true };
        Main.applyValidateScale();
        expect(util.applyToolScale).toHaveBeenLastCalledWith(['--pano-base-width'], expect.any(Array), { scale: 1 });

        // Wider than a phone, immersive fits again.
        narrow = false;
        Main.applyValidateScale();
        expect(util.applyToolScale).toHaveBeenLastCalledWith(['--pano-base-width'], expect.any(Array),
            { maxScale: 3, hMargin: 0, bottomReserve: 0 });
    });
});
