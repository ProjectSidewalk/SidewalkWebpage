/**
 * Runs a production "global script" against a `window` whose `location` is a stub the test can assert on.
 *
 * jsdom 26 (Jest 30) made `location` a non-configurable accessor with a read-only `reload`, so the old
 * `Object.defineProperty(window, 'location', ...)` swap throws -- and plain assignment silently no-ops in sloppy
 * mode, which is worse, since the test then asserts against the real thing and passes for the wrong reason. Nothing
 * that mutates the real window works, so these change how the source *sees* `window` instead.
 */

/**
 * A `window` that behaves like the real one except that `location` is the given stub. Methods come back bound to the
 * real window: jsdom's natives (`addEventListener`, `getComputedStyle`, ...) reject a proxy as their receiver.
 *
 * @param {object} locationStub - What `window.location` resolves to, e.g. `{reload: jest.fn(), replace: jest.fn()}`.
 * @param {Window} [realWindow] - The window to forward everything else to. Defaults to the jsdom global.
 * @returns {Window} A proxy suitable for passing to {@link runScriptWithWindow}.
 */
function windowWithStubbedLocation(locationStub, realWindow = globalThis.window) {
    return new Proxy(realWindow, {
        get(target, prop) {
            if (prop === 'location') return locationStub;
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        // Assigning to `location` is navigation; letting it through would trip jsdom's "not implemented" error.
        set(target, prop, value) {
            if (prop === 'location') return true;
            return Reflect.set(target, prop, value);
        }
    });
}

/**
 * @param {string} body - Function body: the file's source, optionally followed by a `return` naming what to hand back.
 * @param {Window} win - The `window` the source should see, typically from {@link windowWithStubbedLocation}.
 * @returns {*} The body's return value, if any.
 */
function runScriptWithWindow(body, win) {
    return new Function('window', body)(win);
}

module.exports = { windowWithStubbedLocation, runScriptWithWindow };
