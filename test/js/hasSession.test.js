/**
 * Tests for util.hasSession, the shared read of whether the server rendered this page for a visitor who has an
 * identity. Public pages render for cookie-less visitors (#4643), and that is exactly what a SecuredAction endpoint
 * answers 200 vs 401 on — so an init-time read of one consults this and skips the request rather than catching the
 * failure, because the browser logs a 401 as a console error regardless of how the caller handles it.
 *
 * The signal is the navbar's data-has-session attribute, so the contract is: true/false when a navbar reported it,
 * and null when nothing did (a page rendered without a navbar), which callers must treat as "request anyway" rather
 * than as "no session".
 */

const {loadGlobalScript} = require('./loadGlobalScript');

beforeEach(() => {
    // utilities.js builds a Bowser parser at load time; this helper never touches it, but the file needs the global.
    window.bowser = {
        getParser: () => ({
            getBrowserName: () => 'Test', getBrowserVersion: () => '1',
            getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
        }),
    };
    loadGlobalScript('public/js/common/utilities.js');
});

afterEach(() => {
    document.body.innerHTML = '';
});

/** Renders a navbar the way navbar.scala.html does, with data-has-session set when `value` is given. */
const renderNavbar = (value) => {
    const attr = value === undefined ? '' : ` data-has-session="${value}"`;
    document.body.innerHTML = `<nav id="header" aria-label="Main"${attr}></nav>`;
};

describe('util.hasSession', () => {
    test('reports true when the navbar says the render had an identity', () => {
        renderNavbar('true');
        expect(window.util.hasSession()).toBe(true);
    });

    test('reports false for a cookie-less render', () => {
        renderNavbar('false');
        expect(window.util.hasSession()).toBe(false);
    });

    test('reports null when the page has no navbar at all', () => {
        expect(window.util.hasSession()).toBeNull();
    });

    test('reports null when a navbar carries no session attribute', () => {
        renderNavbar(undefined);
        expect(window.util.hasSession()).toBeNull();
    });

    test('anything other than the literal "true" is not a session', () => {
        renderNavbar('True');
        expect(window.util.hasSession()).toBe(false);
    });
});
