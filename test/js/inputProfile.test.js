/**
 * Tests for the input-capability helpers in frontend/js/common/utilities.js (#5580, #5664): `util.inputProfile()`
 * reads the device from media queries rather than the UA, and `util.isTouchPrimary()` is its `coarse` answer, the
 * predicate every touch-vs-mouse control variant keys on.
 *
 * jsdom has no matchMedia and no navigator.maxTouchPoints, so each case stubs both as that device would report them.
 */

const { realUtil } = require('./loadGlobalScript');

/**
 * Gives the window's navigator a maxTouchPoints, or takes it away (undefined) as jsdom ships it.
 * @param {number|undefined} n - The touch point count to report.
 */
function stubTouchPoints(n) {
    if (n === undefined) delete window.navigator.maxTouchPoints;
    else Object.defineProperty(window.navigator, 'maxTouchPoints', { value: n, configurable: true });
}

/**
 * Stubs matchMedia so exactly the given queries match.
 * @param {string[]} matching - The media queries that should report `matches: true`.
 */
function stubMedia(matching) {
    window.matchMedia = jest.fn((query) => ({ matches: matching.includes(query) }));
}

describe('util.inputProfile', () => {
    let util;

    beforeEach(() => {
        util = realUtil();
    });

    afterEach(() => {
        stubTouchPoints(undefined);
    });

    test('a phone: coarse, no hover, the short edge of the window', () => {
        stubMedia(['(pointer: coarse)']);
        stubTouchPoints(5);
        window.innerWidth = 390;
        window.innerHeight = 844;
        expect(util.inputProfile()).toEqual({ coarse: true, hover: false, shortSide: 390, maxTouchPoints: 5 });
        expect(util.isTouchPrimary()).toBe(true);
    });

    test('a mouse desktop: fine, hover, no touch points', () => {
        stubMedia(['(hover: hover)']);
        stubTouchPoints(0);
        window.innerWidth = 1440;
        window.innerHeight = 900;
        expect(util.inputProfile()).toEqual({ coarse: false, hover: true, shortSide: 900, maxTouchPoints: 0 });
        expect(util.isTouchPrimary()).toBe(false);
    });

    // A touch laptop reports touch points but a mouse as its primary pointer: the pointer decides, not the hardware.
    test('a touch laptop is not touch-primary', () => {
        stubMedia(['(hover: hover)']);
        stubTouchPoints(10);
        expect(util.inputProfile().maxTouchPoints).toBe(10);
        expect(util.isTouchPrimary()).toBe(false);
    });

    test('reports no touch points when the browser does not say', () => {
        stubMedia([]);
        expect(util.inputProfile().maxTouchPoints).toBe(0);
    });

    test('reads the media queries live, so a later call sees a changed device', () => {
        stubMedia([]);
        expect(util.isTouchPrimary()).toBe(false);
        stubMedia(['(pointer: coarse)']);
        expect(util.isTouchPrimary()).toBe(true);
    });
});
