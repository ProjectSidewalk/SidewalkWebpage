/**
 * Tests for how Validate's pano label marker is activated (public/js/common/PanoMarker.js), which is the only way
 * to reach the label card — the one place a label's rating, tags, and description appear.
 *
 * Mobile is where this is delicate. The marker is the single `pointer-events: auto` element over a click-through
 * layer, so both fingers of a pinch can land on it, and the page it lives on cancels touchstarts to suppress
 * double-tap zoom. The card therefore has to open on a tap that stayed put, stay shut through a pinch or a drag,
 * and answer the click an assistive technology sends without also answering the click a browser synthesizes from
 * a tap already handled — a double toggle reads as nothing happening at all.
 *
 * The tests drive the real PanoMarker with a fake pano viewer, dispatching synthetic touch events (jsdom has no
 * TouchEvent constructor, so they are plain Events carrying the fields the handlers read).
 */

const fs = require('fs');
const path = require('path');

const PANO_MARKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/PanoMarker.js');

/**
 * Load a bare `class` declaration out of a production file, the way the Grunt bundle would put it in page scope.
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
    const src = fs.readFileSync(filePath, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

/**
 * Dispatch a synthetic touch event carrying the fields PanoMarker reads.
 * @param {HTMLElement} el - The element the touch is on.
 * @param {string} type - 'touchstart', 'touchend', or 'touchcancel'.
 * @param {Object[]} changedTouches - The touch points that changed, e.g. [{identifier: 0, clientX, clientY}].
 * @param {Object[]} [touches] - The touch points still down after the event; defaults to none.
 */
function fireTouch(el, type, changedTouches, touches = []) {
    const event = new Event(type, {bubbles: true, cancelable: true});
    event.changedTouches = changedTouches;
    event.touches = touches;
    el.dispatchEvent(event);
}

/** A touch point. @returns {Object} */
const touch = (identifier, clientX, clientY) => ({identifier, clientX, clientY});

describe('Validate pano marker activation', () => {
    let toggleLabelCard;
    let isMobile;

    /** @returns {HTMLElement} The marker element PanoMarker created. */
    const markerEl = () => document.getElementById('validate-pano-marker');

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'));
        document.body.innerHTML = '<div id="view-control-layer"></div><div id="label-card"></div>';
        isMobile = true;
        toggleLabelCard = jest.fn();

        global.util = {
            isMobile: () => isMobile,
            pano: {
                centeredPovToCanvasCoord2d: () => ({x: 0, y: 0}),
                centeredPovToCanvasCoord: () => ({x: 0, y: 0}),
            },
        };
        // jsdom has no WebGL, so PanoMarker takes its 2d projection fallback; where the marker lands is irrelevant
        // here. Returning null directly keeps that deterministic without jsdom's "not implemented" noise.
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        global.svv = {
            labelVisibilityControl: {
                toggleLabelCard,
                showLabelCard: jest.fn(),
                scheduleHideLabelCard: jest.fn(),
                cancelScheduledCardHide: jest.fn(),
                reanchorLabelCard: jest.fn(), // draw() re-glues the card to the marker on every reposition.
            },
        };
        global.PanoMarker = loadClassFromFile(PANO_MARKER_PATH, 'PanoMarker');
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        document.body.innerHTML = '';
        delete global.util;
        delete global.svv;
        delete global.PanoMarker;
    });

    /** Builds the real Validate marker on a fake viewer. @returns {Object} The PanoMarker. */
    function createMarker() {
        return new PanoMarker({
            panoViewer: {addListener: jest.fn(), getPov: () => ({heading: 0, pitch: 0, zoom: 1})},
            markerContainer: document.getElementById('view-control-layer'),
            id: 'validate-pano-marker',
            size: {width: 52, height: 52},
        });
    }

    /** A tap that starts and ends at the same point, as a still finger does. */
    function tap(x = 100, y = 100, id = 0) {
        fireTouch(markerEl(), 'touchstart', [touch(id, x, y)], [touch(id, x, y)]);
        fireTouch(markerEl(), 'touchend', [touch(id, x, y)], []);
    }

    describe('on mobile', () => {
        beforeEach(() => {
            createMarker();
        });

        test('a tap that stayed put opens the card', () => {
            tap();

            expect(toggleLabelCard).toHaveBeenCalledTimes(1);
        });

        test('a small wobble is still a tap; a drag past the slop is not', () => {
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchend', [touch(0, 112, 112)], []); // ~17 units — inside the slop.
            expect(toggleLabelCard).toHaveBeenCalledTimes(1);

            // A pan that began on the marker: the finger travelled, so it must not leave the card open behind it.
            fireTouch(markerEl(), 'touchstart', [touch(1, 100, 100)], [touch(1, 100, 100)]);
            fireTouch(markerEl(), 'touchend', [touch(1, 200, 260)], []);
            expect(toggleLabelCard).toHaveBeenCalledTimes(1);
        });

        test('a pinch that begins on the marker never toggles the card', () => {
            // Finger A lands on the marker, then finger B does — the marker is the one thing over the pano that
            // takes pointer events, so both can. B lifting near where A started must not read as A's tap.
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchstart', [touch(1, 140, 140)], [touch(0, 100, 100), touch(1, 140, 140)]);
            fireTouch(markerEl(), 'touchend', [touch(1, 108, 108)], [touch(0, 300, 300)]);
            fireTouch(markerEl(), 'touchend', [touch(0, 300, 300)], []);

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });

        test('the second finger of a pinch does not become the tap the first one started', () => {
            // The order that matters: A lands, B lands, A lifts far away, then B lifts about where it landed. With
            // one slot and no guard, B overwrites A on the way in and B's own small travel then reads as a tap.
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchstart', [touch(1, 140, 140)], [touch(0, 100, 100), touch(1, 140, 140)]);
            fireTouch(markerEl(), 'touchend', [touch(0, 300, 300)], [touch(1, 141, 141)]);
            fireTouch(markerEl(), 'touchend', [touch(1, 141, 141)], []);

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });

        test('a lift while another finger is still down is not a tap', () => {
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchend', [touch(0, 100, 100)], [touch(1, 300, 300)]);

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });

        test('a touchend from a finger the tap did not start with is ignored', () => {
            fireTouch(markerEl(), 'touchstart', [touch(7, 100, 100)], [touch(7, 100, 100)]);
            fireTouch(markerEl(), 'touchend', [touch(9, 100, 100)], []);

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });

        test('a cancelled touch leaves nothing armed, and the next real tap still works', () => {
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchcancel', [touch(0, 100, 100)], []);
            fireTouch(markerEl(), 'touchend', [touch(0, 100, 100)], []);
            expect(toggleLabelCard).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1000);
            tap();
            expect(toggleLabelCard).toHaveBeenCalledTimes(1);
        });

        test('the click a browser synthesizes from a handled tap does not toggle it back shut', () => {
            tap();
            markerEl().dispatchEvent(new MouseEvent('click', {bubbles: true}));

            expect(toggleLabelCard).toHaveBeenCalledTimes(1);
        });

        test('the click after a rejected drag does not sneak the card open either', () => {
            fireTouch(markerEl(), 'touchstart', [touch(0, 100, 100)], [touch(0, 100, 100)]);
            fireTouch(markerEl(), 'touchend', [touch(0, 300, 300)], []);
            markerEl().dispatchEvent(new MouseEvent('click', {bubbles: true}));

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });

        test('an assistive technology’s press, which arrives as a click with no touch behind it, opens the card', () => {
            markerEl().dispatchEvent(new MouseEvent('click', {bubbles: true}));

            expect(toggleLabelCard).toHaveBeenCalledTimes(1);
        });

        test('a click well after the last touch is a real press, not a synthesized one', () => {
            tap();
            jest.advanceTimersByTime(1000);
            markerEl().dispatchEvent(new MouseEvent('click', {bubbles: true}));

            expect(toggleLabelCard).toHaveBeenCalledTimes(2);
        });

        test('Enter and Space open the card, since role=button brings no key handling of its own', () => {
            for (const key of ['Enter', ' ']) {
                const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
                markerEl().dispatchEvent(event);
                expect(event.defaultPrevented).toBe(true); // Space would otherwise scroll the page.
            }

            expect(toggleLabelCard).toHaveBeenCalledTimes(2);
        });

        test('other keys are left to the page', () => {
            const event = new KeyboardEvent('keydown', {key: 'a', bubbles: true, cancelable: true});
            markerEl().dispatchEvent(event);

            expect(toggleLabelCard).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        test('it announces itself as the disclosure it now is', () => {
            // LabelVisibilityControl stamps aria-expanded only onto a marker whose role is button, so claiming the
            // role is also what earns the mobile marker the open/shut state a screen reader reads back.
            expect(markerEl().getAttribute('role')).toBe('button');
            expect(markerEl().getAttribute('tabindex')).toBe('0');
            expect(markerEl().getAttribute('aria-haspopup')).toBe('dialog');
            expect(markerEl().getAttribute('aria-expanded')).toBe('false');
            expect(markerEl().getAttribute('aria-describedby')).toBe('label-card');
        });
    });

    describe('on desktop', () => {
        beforeEach(() => {
            isMobile = false;
            createMarker();
        });

        test('it keeps the same disclosure contract', () => {
            expect(markerEl().getAttribute('role')).toBe('button');
            expect(markerEl().getAttribute('tabindex')).toBe('0');
            expect(markerEl().getAttribute('aria-haspopup')).toBe('dialog');
            expect(markerEl().getAttribute('aria-expanded')).toBe('false');
            expect(markerEl().getAttribute('aria-describedby')).toBe('label-card');
        });

        test('hovering opens the card and leaving schedules its hide', () => {
            markerEl().dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
            expect(svv.labelVisibilityControl.showLabelCard).toHaveBeenCalledTimes(1);

            markerEl().dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
            expect(svv.labelVisibilityControl.scheduleHideLabelCard).toHaveBeenCalledTimes(1);
        });

        test('the cursor passing over mid-pan does not re-open the card', () => {
            markerEl().dispatchEvent(new MouseEvent('mouseover', {bubbles: true, buttons: 1}));

            expect(svv.labelVisibilityControl.showLabelCard).not.toHaveBeenCalled();
        });

        test('the keys stay with Validate’s KeyboardManager, which handles them with capture', () => {
            markerEl().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
            markerEl().dispatchEvent(new MouseEvent('click', {bubbles: true}));

            expect(toggleLabelCard).not.toHaveBeenCalled();
        });
    });

    test('a marker that is not Validate’s gets none of this', () => {
        new PanoMarker({
            panoViewer: {addListener: jest.fn(), getPov: () => ({heading: 0, pitch: 0, zoom: 1})},
            markerContainer: document.getElementById('view-control-layer'),
            id: 'some-other-marker',
            size: {width: 32, height: 32},
        });
        const other = document.getElementById('some-other-marker');

        expect(other.getAttribute('role')).toBeNull();
        other.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        expect(toggleLabelCard).not.toHaveBeenCalled();
    });
});
