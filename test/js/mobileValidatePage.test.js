/**
 * Tests for the page-level behavior in public/js/mobileValidate.js.
 *
 * The page suppresses double-tap zoom by cancelling any touchstart that follows another within half a second.
 * Cancelling a touchstart also cancels that touch's scrolling and its click, which is harmless over the panorama but
 * not over a scroll surface — the mission briefing and its examples carousel are two, and their way forward is a tap,
 * so a second quick flick or tap there must be left alone.
 */

const fs = require('fs');
const path = require('path');

const MOBILE_VALIDATE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/mobileValidate.js'), 'utf8'
);

describe('mobile Validate page behavior', () => {
    let modalForeground;
    let panoCanvas;

    /** Loads mobileValidate.js into jsdom with the globals it reaches for at load time. */
    function loadPage() {
        // jQuery's surface here is $(document).ready — a no-op for these tests, whose subject is the document-level
        // touchstart listener the ready handler is installed alongside.
        const ready = [];
        window.$ = jest.fn(() => ({append: jest.fn(), on: jest.fn()}));
        window.$.mockImplementation((arg) => {
            if (arg === document) return {ready: (fn) => ready.push(fn)};
            return {append: jest.fn(), on: jest.fn()};
        });
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
        // install the listener under test.
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
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
        delete window.$;
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
