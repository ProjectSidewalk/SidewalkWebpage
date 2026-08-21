/**
 * Tests for the two page-level behaviors in public/js/mobileValidate.js, plus the measurement they rest on
 * (util.legacyViewportScale in public/js/common/utilities.js).
 *
 * mobile Validate ships no viewport meta (#4875 Phase 3 removes that; SeoSpec pins its absence today), so a device
 * lays the page out at a legacy ~980px viewport and shrinks the result to fit. Two consequences are tested here:
 *
 *   1. The mission screens are authored in real design-system units and scaled back up to cancel that shrink, so
 *      the factor has to be measured per device. Every device the server's mobile UA regex routes here — phones
 *      and, deliberately, tablets — is shrunk by a different amount, and a single number baked into the stylesheet
 *      rendered tablets at roughly double their intended size and small phones under it.
 *   2. The page suppresses double-tap zoom by cancelling any touchstart that follows another within half a second.
 *      Cancelling a touchstart also cancels that touch's scrolling and its click, which was harmless while the page
 *      had no scroll surfaces — the mission briefing and its examples carousel are two, and their way forward is a
 *      tap, so a second quick flick or tap there must be left alone.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);
const MOBILE_VALIDATE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/mobileValidate.js'), 'utf8'
);

/** The legacy viewport width a browser lays a page out at when it is given no viewport meta. */
const LEGACY_VIEWPORT = 980;

/** Loads utilities.js into jsdom, the way the other utilities suites do. */
function loadUtil() {
    // utilities.js builds a Bowser parser at load time; nothing under test consults it.
    window.bowser = {getParser: () => ({getBrowserName: () => 'Safari', getBrowserVersion: () => '1',
        getOSName: () => 'iOS', getPlatformType: () => 'mobile'})};
    window.eval(UTILITIES_SRC);
    return window.util;
}

describe('util.legacyViewportScale', () => {
    let util;

    beforeEach(() => {
        util = loadUtil();
    });

    test('a 390pt phone gets the ~2.5x the stylesheet assumed by default', () => {
        expect(util.legacyViewportScale(LEGACY_VIEWPORT, 390)).toBeCloseTo(2.513, 3);
        expect(util.DEFAULT_LEGACY_VIEWPORT_SCALE).toBe(2.5);
    });

    test('a tablet, which the server also routes to this page, gets about half that', () => {
        // A 768pt iPad rendered at the phone's 2.5 would draw ~49pt titles and ~100pt-tall buttons.
        expect(util.legacyViewportScale(LEGACY_VIEWPORT, 768)).toBeCloseTo(1.276, 3);
        expect(util.legacyViewportScale(LEGACY_VIEWPORT, 810)).toBeCloseTo(1.21, 2);
    });

    test('a small phone gets more, not the 0.82x of intended size a fixed 2.5 left it at', () => {
        expect(util.legacyViewportScale(LEGACY_VIEWPORT, 320)).toBeCloseTo(3.0625, 4);
    });

    test('scaling up by the factor returns UI to its authored size, on every device width', () => {
        for (const screenWidth of [320, 360, 375, 390, 414, 430, 768, 810, 979]) {
            const displayedFraction = screenWidth / LEGACY_VIEWPORT; // How far the browser shrinks the page.
            const scale = util.legacyViewportScale(LEGACY_VIEWPORT, screenWidth);
            expect(displayedFraction * scale).toBeCloseTo(1, 6);
        }
    });

    test('a page that is not being shrunk is not scaled up', () => {
        expect(util.legacyViewportScale(390, 390)).toBe(1);
        expect(util.legacyViewportScale(390, 1024)).toBe(1);
    });

    test('an absurd measurement is clamped rather than passed through', () => {
        expect(util.legacyViewportScale(LEGACY_VIEWPORT, 1)).toBe(4);
    });

    test('a missing or nonsense measurement falls back to the default rather than to zero', () => {
        for (const args of [[0, 390], [LEGACY_VIEWPORT, 0], [undefined, 390], [LEGACY_VIEWPORT, undefined],
            [NaN, 390], [LEGACY_VIEWPORT, NaN], [-980, 390]]) {
            expect(util.legacyViewportScale(...args)).toBe(util.DEFAULT_LEGACY_VIEWPORT_SCALE);
        }
    });
});

describe('mobile Validate page behavior', () => {
    let util;
    let modalForeground;
    let panoCanvas;

    /**
     * Loads mobileValidate.js into jsdom with the globals it reaches for at load time.
     * @param {number} screenWidth - The device width `screen.width` should report.
     */
    function loadPage(screenWidth = 390) {
        Object.defineProperty(window.screen, 'width', {value: screenWidth, configurable: true});
        Object.defineProperty(document.documentElement, 'clientWidth',
            {value: LEGACY_VIEWPORT, configurable: true});
        // jQuery's surface here is $(document).ready, $('head').append, and $(window).on — all no-ops for these
        // tests, whose subjects are the two document-level listeners and the scale written to the root.
        const ready = [];
        window.$ = jest.fn(() => ({append: jest.fn(), on: jest.fn()}));
        window.$.mockImplementation((arg) => {
            if (arg === document) return {ready: (fn) => ready.push(fn)};
            return {append: jest.fn(), on: jest.fn()};
        });
        window.screen.orientation = {type: 'portrait-primary'};
        window.svv = {modalLandscape: {show: jest.fn(), hide: jest.fn()}};
        window.eval(MOBILE_VALIDATE_SRC);
        ready.forEach((fn) => fn());
    }

    /**
     * Fires a touchstart at `target` and reports whether the page cancelled it. jsdom has no TouchEvent, so this
     * is a plain bubbling, cancelable Event — the handler reads only `target` and calls `preventDefault`.
     * @param {HTMLElement} target - Where the finger landed.
     * @returns {boolean} True if the page called preventDefault on it.
     */
    function touchStartOn(target) {
        const event = new Event('touchstart', {bubbles: true, cancelable: true});
        target.dispatchEvent(event);
        return event.defaultPrevented;
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'));
        document.body.innerHTML = `
            <div id="svv-panorama-holder"><div id="svv-panorama"></div></div>
            <div id="validation-button-holder">
              <button type="button" id="validate-no-button"></button>
            </div>
            <div id="modal-mission-holder">
              <div id="modal-mission-foreground">
                <div id="modal-mission-instruction">
                  <div class="mv-examples"><figure class="mv-example"></figure></div>
                </div>
                <div class="mv-modal__actions"><button type="button" id="modal-mission-close-button"></button></div>
              </div>
            </div>
            <div id="modal-mission-complete-holder">
              <div id="modal-mission-complete-foreground">
                <div class="mv-modal__actions">
                  <button type="button" id="modal-mission-complete-close-button-primary"></button>
                </div>
              </div>
            </div>`;
        // Every control the page's ready handler decorates with .animate-button; absent, it throws before it can
        // install the listeners under test.
        ['validate-no-button', 'validate-unsure-button', 'validate-yes-button', 'no-menu-submit-button',
            'unsure-menu-submit-button', 'modal-mission-complete-close-button-primary',
            'modal-mission-complete-close-button-secondary', 'label-visibility-control-button'].forEach((id) => {
            if (!document.getElementById(id)) {
                const el = document.createElement('button');
                el.id = id;
                document.body.appendChild(el);
            }
        });
        modalForeground = document.getElementById('modal-mission-foreground');
        panoCanvas = document.getElementById('svv-panorama');
        util = loadUtil();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
        document.documentElement.style.removeProperty('--mobile-mission-scale');
        delete window.$;
        delete window.svv;
        delete window.util;
    });

    describe('the mission screens’ scale', () => {
        test('is measured from this device and published to the root for the stylesheet to read', () => {
            loadPage(390);

            const written = document.documentElement.style.getPropertyValue('--mobile-mission-scale');
            expect(parseFloat(written)).toBeCloseTo(util.legacyViewportScale(LEGACY_VIEWPORT, 390), 3);
        });

        test('is different on a tablet than on a phone, which is the whole point of measuring it', () => {
            loadPage(768);

            expect(parseFloat(document.documentElement.style.getPropertyValue('--mobile-mission-scale')))
                .toBeCloseTo(1.276, 2);
        });

        test('is re-measured when the viewport changes, e.g. a rotation', () => {
            loadPage(390);
            Object.defineProperty(window.screen, 'width', {value: 768, configurable: true});

            window.dispatchEvent(new Event('resize'));

            expect(parseFloat(document.documentElement.style.getPropertyValue('--mobile-mission-scale')))
                .toBeCloseTo(1.276, 2);
        });
    });

    describe('the double-tap suppressor', () => {
        test('still cancels a quick second tap on the pano, which is what it is for', () => {
            loadPage();

            expect(touchStartOn(panoCanvas)).toBe(false); // First tap always goes through.
            expect(touchStartOn(panoCanvas)).toBe(true);
        });

        test('leaves a tap alone once the double-tap window has passed', () => {
            loadPage();

            touchStartOn(panoCanvas);
            jest.advanceTimersByTime(501);
            expect(touchStartOn(panoCanvas)).toBe(false);
        });

        test('never cancels a swipe of the briefing’s examples carousel', () => {
            loadPage();
            const carousel = document.querySelector('.mv-examples');

            expect(touchStartOn(carousel)).toBe(false);
            expect(touchStartOn(carousel)).toBe(false); // The second flick to the next example must still scroll.
            expect(touchStartOn(carousel)).toBe(false);
        });

        test('never cancels a tap on the way forward, whichever mission screen it is on', () => {
            loadPage();

            for (const id of ['modal-mission-close-button', 'modal-mission-complete-close-button-primary']) {
                touchStartOn(panoCanvas); // Arm the window with a tap elsewhere.
                expect(touchStartOn(document.getElementById(id))).toBe(false);
            }
        });

        test('never cancels a second scroll of a long briefing', () => {
            loadPage();

            touchStartOn(modalForeground);
            expect(touchStartOn(modalForeground)).toBe(false);
        });

        test('a tap inside a mission screen does not leave the next pano tap uncancelled', () => {
            // The exemption is about which touch is cancelled, not about disarming the detector: a genuine
            // double-tap on the pano must still be caught right after the validator leaves a mission screen.
            loadPage();

            touchStartOn(modalForeground);
            expect(touchStartOn(panoCanvas)).toBe(true);
        });
    });
});
