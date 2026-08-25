/**
 * Tests for the page-level behavior in public/js/mobileValidate.js.
 *
 * The page suppresses double-tap zoom over the imagery by cancelling a touchstart that lands on a pano canvas within
 * half a second of another. Cancelling a touchstart also cancels that touch's scrolling and its click, so everything
 * the tool draws over the pano — verdicts, the marker, Undo, the reason panels — and the mission screens beyond it
 * have to be left alone, and a second quick flick or tap there is ordinary use. Nor is a pinch a double tap: its
 * second finger lands inside the same window, and cancelling it would cancel the page's pinch zoom.
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
     * Fires a touchstart at `target` and reports whether the page cancelled it. jsdom has no TouchEvent, so this is a
     * plain bubbling, cancelable Event carrying the two properties the handler reads: `target` and `touches`.
     * @param {HTMLElement} target - Where the finger landed.
     * @param {number} [fingers=1] - Fingers on the glass, counting this one, as TouchEvent.touches would report.
     * @returns {boolean} True if the page called preventDefault on it.
     */
    function touchStartOn(target, fingers = 1) {
        const event = new Event('touchstart', {bubbles: true, cancelable: true});
        event.touches = {length: fingers};
        target.dispatchEvent(event);
        return event.defaultPrevented;
    }

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'));
        document.body.innerHTML = `
            <div id="svv-panorama-holder">
              <div id="svv-panorama"></div>
              <div id="svv-panorama-pannellum"></div>
              <div id="view-control-layer"><div id="validate-pano-marker"></div></div>
              <div id="label-card">
                <button type="button" id="label-visibility-button-on-label"></button>
              </div>
              <button type="button" id="validate-undo-button"></button>
              <div id="validation-button-holder">
                <button type="button" id="validate-no-button"></button>
                <button type="button" id="validate-yes-button"></button>
              </div>
              <div id="validate-why-no-section" class="validation-menu-section">
                <div id="no-reason-options"><button type="button" id="no-button-1"></button></div>
                <div id="no-submit-section"><button type="button" id="no-menu-submit-button"></button></div>
              </div>
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

        test('never cancels the tap-a-reason-then-tap-Submit flow', () => {
            loadPage();

            expect(touchStartOn(document.getElementById('validate-no-button'))).toBe(false);
            expect(touchStartOn(document.getElementById('no-button-1'))).toBe(false);
            expect(touchStartOn(document.getElementById('no-menu-submit-button'))).toBe(false);
        });

        test('never cancels a scroll of a reason panel, which a landscape phone caps into one', () => {
            loadPage();
            const panel = document.getElementById('validate-why-no-section');

            touchStartOn(panel);
            expect(touchStartOn(panel)).toBe(false);
        });

        test('never cancels verdicts cast in quick succession', () => {
            // Each verdict submits and loads the next label, so a validator agreeing several times running taps well
            // inside the double-tap window — and a cancelled touchstart is a cancelled click, i.e. a lost verdict.
            loadPage();
            const agree = document.getElementById('validate-yes-button');

            expect(touchStartOn(agree)).toBe(false);
            expect(touchStartOn(agree)).toBe(false);
            expect(touchStartOn(agree)).toBe(false);
        });

        test('never cancels a tap on a control drawn over the pano', () => {
            // Each of these is a tap whose click matters and which routinely follows another within the window: the
            // marker toggles the label card, its button hides the label, Undo takes back the verdict just cast.
            loadPage();

            for (const id of ['validate-pano-marker', 'label-visibility-button-on-label', 'validate-undo-button']) {
                touchStartOn(panoCanvas); // Arm the window with a tap on the imagery.
                expect(touchStartOn(document.getElementById(id))).toBe(false);
            }
        });

        test('still cancels a quick second tap on the Pannellum fallback, which is imagery too', () => {
            loadPage();
            const pannellum = document.getElementById('svv-panorama-pannellum');

            touchStartOn(pannellum);
            expect(touchStartOn(pannellum)).toBe(true);
        });

        test('leaves the second finger of a pinch alone, so the page can still be zoomed', () => {
            loadPage();

            touchStartOn(panoCanvas);
            expect(touchStartOn(panoCanvas, 2)).toBe(false);
        });

        test('a tap inside a mission screen does not leave the next pano tap uncancelled', () => {
            // The scoping is about which touch is cancelled, not about disarming the detector: a genuine double-tap
            // on the pano must still be caught right after the validator leaves a mission screen.
            loadPage();

            touchStartOn(modalForeground);
            expect(touchStartOn(panoCanvas)).toBe(true);
        });
    });
});
