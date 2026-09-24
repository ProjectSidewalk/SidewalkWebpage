/**
 * Tests for Canvas.watchPanoExit (public/js/explore/src/canvas/Canvas.js, issue #5496).
 *
 * Leaving the pano cancels an armed label type. Toasts float over the pano but mount on <body>, so before this the
 * pointer crossing a toast on its way from the ribbon into the pano counted as leaving it, and the label type was
 * dropped the instant it was picked.
 */

const fs = require('fs');
const path = require('path');

const CANVAS_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/canvas/Canvas.js'), 'utf8'
);

/** Loads a fresh Canvas class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadCanvas() {
    window.eval(`${CANVAS_SRC}\nwindow.Canvas = Canvas;`);
    return window.Canvas;
}

describe('Canvas.watchPanoExit', () => {
    let holder;
    let pano;
    let toast;
    let toastText;
    let ribbon;
    let onExit;
    let abort;

    /** Fires what a browser fires when the pointer moves from `from` onto `to` (null = out of the window). */
    function movePointer(from, to) {
        from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
        // mouseleave fires on each ancestor of `from` the pointer is no longer inside, not bubbling.
        for (let el = from; el && el !== document; el = el.parentNode) {
            if (to && el.contains(to)) break;
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: to }));
        }
    }

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="ribbon"></div>
            <div id="interaction-area-holder"><div id="pano"></div></div>
            <div class="ps-toast"><div class="ps-toast__text">Resuming your mission</div></div>`;
        holder = document.getElementById('interaction-area-holder');
        pano = document.getElementById('pano');
        ribbon = document.getElementById('ribbon');
        toast = document.querySelector('.ps-toast');
        toastText = document.querySelector('.ps-toast__text');
        onExit = jest.fn();

        // The helper binds on document; scope each test's listener so they don't pile up across tests.
        abort = new AbortController();
        const add = EventTarget.prototype.addEventListener;
        jest.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (type, fn, opts) {
            add.call(this, type, fn, { ...(typeof opts === 'object' ? opts : {}), signal: abort.signal });
        });
        loadCanvas().watchPanoExit(holder, onExit);
        EventTarget.prototype.addEventListener.mockRestore();
    });

    afterEach(() => abort.abort());

    test('leaving the pano for the page is an exit', () => {
        movePointer(pano, ribbon);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('leaving the window is an exit', () => {
        movePointer(pano, null);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('crossing onto a toast is not an exit', () => {
        movePointer(pano, toastText);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('moving within the toast is not an exit', () => {
        movePointer(toastText, toast);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('leaving the toast back onto the pano is not an exit', () => {
        movePointer(pano, toast);
        movePointer(toast, pano);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('leaving the toast for the page is an exit, once', () => {
        movePointer(pano, toastText);
        movePointer(toastText, ribbon);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('mouseout from elements that are not toasts is ignored', () => {
        movePointer(ribbon, document.body);
        expect(onExit).not.toHaveBeenCalled();
    });
});
