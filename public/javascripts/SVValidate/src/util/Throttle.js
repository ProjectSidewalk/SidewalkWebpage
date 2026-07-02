var util = util || {};

/**
 * Creates a throttled wrapper around `fn` that invokes it at most once per `wait` milliseconds.
 *
 * The first call after a quiet period runs immediately (leading edge); further calls within the window are coalesced
 * into a single trailing call once the window elapses, so the effect of the final call is never dropped. This is used
 * to keep continuous events from flooding the interaction logger — e.g. panning a pano fires `pov_changed` on every
 * frame, which otherwise fills the Tracker's submission buffer every few validations (#2745).
 *
 * The most recent arguments are forwarded to whichever `fn` invocation actually runs.
 *
 * @param {Function} fn   - The function to throttle.
 * @param {number}   wait - Minimum milliseconds between invocations of `fn`.
 * @returns {Function} The throttled wrapper.
 */
util.throttle = function(fn, wait) {
    let lastRunTime = 0;
    let trailingTimer = null;
    let lastArgs = null;

    return function(...args) {
        lastArgs = args;
        const now = Date.now();
        const elapsed = now - lastRunTime;
        if (elapsed >= wait) {
            // Leading edge (or a call after the window has fully elapsed): run immediately.
            lastRunTime = now;
            fn(...lastArgs);
        } else if (trailingTimer === null) {
            // Mid-window: schedule one trailing run so the final call in a burst still takes effect.
            trailingTimer = setTimeout(() => {
                trailingTimer = null;
                lastRunTime = Date.now();
                fn(...lastArgs);
            }, wait - elapsed);
        }
    };
};
