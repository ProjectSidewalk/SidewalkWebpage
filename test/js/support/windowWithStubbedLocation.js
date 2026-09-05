/**
 * Runs a production "global script" against a `window` whose `location` is a stub the test can assert on.
 *
 * jsdom 26 (Jest 30) made `location` a non-configurable accessor with a read-only `reload`, so the old
 * `Object.defineProperty(window, 'location', ...)` swap throws -- and plain assignment silently no-ops in sloppy
 * mode, which is worse, since the test then asserts against the real thing and passes for the wrong reason. Nothing
 * that mutates the real window works, so these change how the source *sees* `window` instead.
 */

/** The `location` fields a give-up path can reach. Rebuilt per test so nothing leaks between them. */
function newLocationStub() {
    return { reload: jest.fn(), replace: jest.fn(), assign: jest.fn(), href: '' };
}

/**
 * Reset a stub in place, so a suite that loaded its subject once at module scope can still start each test clean.
 *
 * @param {object} locationStub - The stub handed to {@link windowWithStubbedLocation}; mutated, not replaced, because
 *                               the proxy closed over this exact object.
 */
function resetLocationStub(locationStub) {
    Object.assign(locationStub, newLocationStub());
}

/**
 * A `window` that behaves like the real one except that every route to `location` yields the stub.
 *
 * The window aliases (`self`/`top`/`parent`/`window`) and `document` are trapped too, so `self.location.reload()` and
 * `document.location.replace(...)` are caught rather than reaching the real `Location` and passing vacuously.
 * Values are handed back unbound: jsdom accepts the proxy as a receiver, and binding would strip statics
 * (`window.Promise.all`) and break identity.
 *
 * @param {object} locationStub - What `location` resolves to; defaults to a fresh {@link newLocationStub}.
 * @param {Window} [realWindow] - The window to forward everything else to. Defaults to the jsdom global.
 * @returns {Window} A proxy suitable for passing to {@link runScriptWithWindow}.
 */
function windowWithStubbedLocation(locationStub = newLocationStub(), realWindow = globalThis.window) {
    const ALIASES = new Set(['window', 'self', 'top', 'parent', 'globalThis']);
    const doc = new Proxy(realWindow.document, {
        get: (target, prop) => (prop === 'location' ? locationStub : Reflect.get(target, prop))
    });
    const win = new Proxy(realWindow, {
        get(target, prop) {
            if (prop === 'location') return locationStub;
            if (prop === 'document') return doc;
            return ALIASES.has(prop) ? win : Reflect.get(target, prop);
        },
        // Assigning to `location` is navigation; record it rather than letting jsdom attempt it, so a test can see it.
        set(target, prop, value) {
            if (prop === 'location') {
                locationStub.href = String(value);
                return true;
            }
            return Reflect.set(target, prop, value);
        }
    });
    return win;
}

/**
 * Evaluates a production script with `window` and a bare `location` bound to the given window.
 *
 * `location` is a parameter of its own because a function body shadows only the names it declares: a source calling
 * bare `location.reload()` -- the pattern #2745 removed from Form.js -- would otherwise resolve straight past the
 * proxy to the real jsdom `Location`, and the assertion guarding against its return would pass vacuously.
 *
 * @param {string} body - Function body: the file's source, optionally followed by a `return` naming what to hand back.
 * @param {Window} win - The `window` the source should see, typically from {@link windowWithStubbedLocation}.
 * @returns {*} The body's return value, if any.
 */
function runScriptWithWindow(body, win) {
    return new Function('window', 'location', body)(win, win.location);
}

module.exports = { windowWithStubbedLocation, runScriptWithWindow, newLocationStub, resetLocationStub };
