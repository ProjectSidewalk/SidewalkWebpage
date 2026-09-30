/**
 * Tests for the toast-over-the-pano fix in Explore (issue #5496): Canvas.watchPanoExit and the `explore-labeling`
 * body class RibbonMenu.modeSwitch keeps in step with the mode.
 *
 * Leaving the pano cancels an armed label type. Toasts float over the pano but mount on <body>, so before this the
 * pointer crossing a toast on its way from the ribbon into the pano counted as leaving it, and the label type was
 * dropped the instant it was picked. While labeling, the toast card is click-through (svl-canvas.css) and only its
 * buttons take the pointer, so the realistic toast-side path is through the close X.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const { assetPathStub } = require('./loadGlobalScript');

const CANVAS_SRC = read('public/js/explore/src/canvas/Canvas.js');
const TOAST_SRC = read('public/js/common/Toast.js');
const RIBBON_SRC = read('public/js/explore/src/menu/RibbonMenu.js');

describe('Canvas.watchPanoExit', () => {
    let holder;
    let pano;
    let panoToast;
    let panoToastClose;
    let otherToastClose;
    let ribbon;
    let onExit;
    let abort;

    /** Fires what a browser fires when the pointer moves from `from` onto `to` (null = out of the window). */
    function movePointer(from, to) {
        from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
        // mouseleave fires, without bubbling, on each ancestor of `from` the pointer is no longer inside; mouseenter
        // likewise on each ancestor of `to` it newly entered.
        for (let el = from; el && el !== document; el = el.parentNode) {
            if (to && el.contains(to)) break;
            el.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: to }));
        }
        for (let el = to; el && el !== document; el = el.parentNode) {
            if (el.contains(from)) break;
            el.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: from }));
        }
    }

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="ribbon"></div>
            <div id="interaction-area-holder"><div id="pano"></div></div>
            <div class="ps-toast" id="pano-toast">
              <div class="ps-toast__text">Resuming your mission</div>
              <button class="ps-toast__close" id="pano-toast-close"></button>
            </div>
            <div class="ps-toast" id="other-toast"><button class="ps-toast__close" id="other-toast-close"></button></div>`;
        holder = document.getElementById('interaction-area-holder');
        pano = document.getElementById('pano');
        ribbon = document.getElementById('ribbon');
        panoToast = document.getElementById('pano-toast');
        panoToastClose = document.getElementById('pano-toast-close');
        otherToastClose = document.getElementById('other-toast-close');
        onExit = jest.fn();
        abort = new AbortController();

        window.eval(`${CANVAS_SRC}\nwindow.Canvas = Canvas;`);
        window.Canvas.watchPanoExit(holder, onExit, { signal: abort.signal });
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

    test('reaching a toast\'s close X from the pano is not an exit', () => {
        movePointer(pano, panoToastClose);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('moving within the toast is not an exit', () => {
        movePointer(pano, panoToastClose);
        movePointer(panoToastClose, panoToast);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('going from the close X back onto the pano is not an exit', () => {
        movePointer(pano, panoToastClose);
        movePointer(panoToastClose, pano);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('leaving the close X for the page is an exit, once', () => {
        movePointer(pano, panoToastClose);
        movePointer(panoToastClose, ribbon);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('returning to the pano forgets the toast visit, so a later off-pano toast is not an exit', () => {
        movePointer(pano, panoToastClose);
        movePointer(panoToastClose, pano);
        movePointer(pano, ribbon);
        movePointer(ribbon, otherToastClose);
        movePointer(otherToastClose, ribbon);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    test('crossing a toast that was never reached from the pano is not an exit', () => {
        // The badge-unlock toast over the mission-complete modal, say: the pointer comes from the page, not the pano.
        movePointer(ribbon, otherToastClose);
        movePointer(otherToastClose, ribbon);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('a missing holder watches nothing rather than throwing', () => {
        expect(() => window.Canvas.watchPanoExit(null, onExit)).not.toThrow();
    });

    test('mouseout from elements that are not toasts is ignored', () => {
        movePointer(ribbon, document.body);
        expect(onExit).not.toHaveBeenCalled();
    });

    test('aborting the signal removes the listeners', () => {
        abort.abort();
        movePointer(pano, ribbon);
        expect(onExit).not.toHaveBeenCalled();
    });
});

describe('Toast data-anchor', () => {
    let Toast;

    beforeEach(() => {
        document.body.innerHTML = '<div id="pano"></div><div class="modal"></div>';
        global.i18next = { t: (key) => key };
        global.util = { assetPath: assetPathStub };
        Toast = new Function(`${TOAST_SRC}; return Toast;`)();
    });

    // svl-canvas.css keys the click-through on data-anchor="pano", so a toast over anything else must not carry it.
    test('names the reference it floats over', () => {
        Toast.show({ message: 'm', reference: document.getElementById('pano') });
        expect(document.querySelector('.ps-toast').dataset.anchor).toBe('pano');
    });

    test('is absent for a reference without an id, or no reference', () => {
        Toast.show({ message: 'm', reference: document.querySelector('.modal') });
        Toast.show({ message: 'm' });
        document.querySelectorAll('.ps-toast').forEach((el) => expect(el.hasAttribute('data-anchor')).toBe(false));
    });
});

describe('RibbonMenu.modeSwitch and the explore-labeling class', () => {
    let ribbon;

    beforeEach(() => {
        document.body.className = '';
        // Only the containers modeSwitch styles; the ribbon's own markup isn't under test.
        document.body.innerHTML = `<div id="mode-switch-button-other"></div><div id="ribbon-menu-holder"></div>
            <div id="pano-border-frame"></div><div id="ribbon-menu-other-subcategory-holder"></div>`;
        window.util = { misc: { getLabelColors: () => new Proxy({}, { get: () => ({ fillStyle: 'black' }) }) } };
        window.svl = { ui: { canvas: {} } };
        window.eval(`${RIBBON_SRC}\nwindow.RibbonMenu = RibbonMenu;`);
        ribbon = new window.RibbonMenu({ push: jest.fn() });
    });

    test('arming a label type adds the class, and Walk removes it', () => {
        ribbon.modeSwitch('CurbRamp');
        expect(document.body.classList.contains('explore-labeling')).toBe(true);
        ribbon.modeSwitch('Walk');
        expect(document.body.classList.contains('explore-labeling')).toBe(false);
    });

    test('a switch the ribbon refuses leaves the class alone', () => {
        ribbon.disableModeSwitch();
        ribbon.modeSwitch('CurbRamp');
        expect(document.body.classList.contains('explore-labeling')).toBe(false);
    });
});
