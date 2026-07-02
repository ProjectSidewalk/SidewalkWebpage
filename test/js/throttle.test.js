/**
 * Tests for public/javascripts/SVValidate/src/util/Throttle.js (`util.throttle`).
 *
 * The throttle exists to stop continuous events (panning a pano fires `pov_changed` every frame) from flooding the
 * interaction logger and forcing the Tracker's 200-action mid-mission flush every few validations (#2745). These
 * tests pin its contract: leading-edge fire, in-window coalescing into a single trailing call, the next window
 * starting clean, and latest-args forwarding.
 *
 * Runs under jsdom (jest.config.js) and uses fake timers, which also mock Date.now so elapsed-time math is
 * deterministic.
 */

const fs = require('fs');
const path = require('path');

const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/javascripts/SVValidate/src/util/Throttle.js');

/** Load Throttle.js (a `var util = util || {}` global script) and return the throttle factory. */
function loadThrottle() {
    // Reset the shared util global each load so state can't leak between tests, then execute the global script.
    global.util = {};
    const src = fs.readFileSync(THROTTLE_PATH, 'utf8');
    (0, eval)(src); // assigns util.throttle
    return global.util.throttle;
}

describe('util.throttle', () => {
    let throttle;

    beforeEach(() => {
        jest.useFakeTimers();
        // Anchor the fake clock at a non-zero time so the first call's elapsed (now - 0) reliably exceeds `wait`.
        jest.setSystemTime(1_000_000);
        throttle = loadThrottle();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.util;
    });

    test('runs immediately on the leading edge', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        throttled();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('coalesces a burst within the window into one leading + one trailing call', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        throttled(); // leading: fires now
        throttled(); // within window: schedules trailing
        throttled(); // within window: no additional schedule
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(500); // trailing fires
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('does not schedule a trailing call when only the leading call happens', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        throttled();
        jest.advanceTimersByTime(10_000);

        expect(fn).toHaveBeenCalledTimes(1); // no spurious trailing run
    });

    test('a call after the window has fully elapsed fires immediately again', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        throttled();
        expect(fn).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(600); // past the window
        throttled();
        expect(fn).toHaveBeenCalledTimes(2); // leading edge of the next window, not a trailing call
    });

    test('forwards the most recent arguments to the trailing call', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        throttled('first');  // leading runs with 'first'
        throttled('second'); // schedules trailing
        throttled('third');  // updates the args the trailing call will use

        expect(fn).toHaveBeenNthCalledWith(1, 'first');
        jest.advanceTimersByTime(500);
        expect(fn).toHaveBeenNthCalledWith(2, 'third');
    });

    test('sustained calls fire at roughly one per window, not once per call', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 500);

        // 20 calls spread 100ms apart over ~2s. Expect ~1 per 500ms window, far fewer than 20.
        for (let i = 0; i < 20; i++) {
            throttled();
            jest.advanceTimersByTime(100);
        }

        expect(fn.mock.calls.length).toBeGreaterThan(2);
        expect(fn.mock.calls.length).toBeLessThan(8); // nowhere near the 20 raw calls
    });
});
