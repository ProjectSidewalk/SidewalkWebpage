/**
 * Tests for frontend/js/validate/util/throttle.js (`util.throttle`).
 *
 * The throttle exists to stop continuous events (panning a pano fires `pov_changed` every frame) from flooding the
 * interaction logger and forcing the Tracker's 200-action mid-mission flush every few validations (#2745). These
 * tests pin its contract: leading-edge fire, in-window coalescing into a single trailing call, the next window
 * starting clean, and latest-args forwarding.
 *
 * Uses fake timers, which also mock Date.now so elapsed-time math is deterministic.
 */

import { loadModules } from './loader.js';

describe('util.throttle', () => {
    let throttle;

    beforeEach(async () => {
        vi.useFakeTimers();
        // Anchor the fake clock at a non-zero time so the first call's elapsed (now - 0) reliably exceeds `wait`.
        vi.setSystemTime(1_000_000);
        // throttle.js puts the factory on `util` rather than exporting it.
        ({ util: { throttle } } = await loadModules('frontend/js/validate/util/throttle.js',
            'frontend/js/common/utilities.js'));
    });

    test('runs immediately on the leading edge', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('coalesces a burst within the window into one leading + one trailing call', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled(); // leading: fires now
        throttled(); // within window: schedules trailing
        throttled(); // within window: no additional schedule
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(500); // trailing fires
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('does not schedule a trailing call when only the leading call happens', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled();
        vi.advanceTimersByTime(10_000);

        expect(fn).toHaveBeenCalledTimes(1); // no spurious trailing run
    });

    test('a call after the window has fully elapsed fires immediately again', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled();
        expect(fn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(600); // past the window
        throttled();
        expect(fn).toHaveBeenCalledTimes(2); // leading edge of the next window, not a trailing call
    });

    test('forwards the most recent arguments to the trailing call', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled('first');  // leading runs with 'first'
        throttled('second'); // schedules trailing
        throttled('third');  // updates the args the trailing call will use

        expect(fn).toHaveBeenNthCalledWith(1, 'first');
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenNthCalledWith(2, 'third');
    });

    test('a trailing run starts a new window (a call right after it does not fire on the leading edge)', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        throttled();                       // t=0: leading
        vi.advanceTimersByTime(100);
        throttled();                       // t=100: schedules trailing at t=500
        vi.advanceTimersByTime(400);     // t=500: trailing fires
        expect(fn).toHaveBeenCalledTimes(2);

        // Only 100ms into the window opened by the trailing run — must coalesce, not fire immediately.
        vi.advanceTimersByTime(100);
        throttled();                       // t=600
        expect(fn).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(400);     // t=1000: its trailing call fires
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('independently created throttled functions do not share state', () => {
        const fnA = vi.fn();
        const fnB = vi.fn();
        const throttledA = throttle(fnA, 500);
        const throttledB = throttle(fnB, 500);

        throttledA();
        throttledB(); // must fire on its own leading edge, unaffected by A's window
        expect(fnA).toHaveBeenCalledTimes(1);
        expect(fnB).toHaveBeenCalledTimes(1);

        throttledA(); // within A's window: schedules A's trailing only
        vi.advanceTimersByTime(500);
        expect(fnA).toHaveBeenCalledTimes(2);
        expect(fnB).toHaveBeenCalledTimes(1); // B had no burst, so no trailing call
    });

    test('sustained calls fire at roughly one per window, not once per call', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);

        // 20 calls spread 100ms apart over ~2s. Expect ~1 per 500ms window, far fewer than 20.
        for (let i = 0; i < 20; i++) {
            throttled();
            vi.advanceTimersByTime(100);
        }

        expect(fn.mock.calls.length).toBeGreaterThan(2);
        expect(fn.mock.calls.length).toBeLessThan(8); // nowhere near the 20 raw calls
    });
});
