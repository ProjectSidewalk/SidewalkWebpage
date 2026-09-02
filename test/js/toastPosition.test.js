/**
 * Tests for Toast's placement (public/js/common/Toast.js).
 *
 * The toast is fixed-positioned and centered on a reference element, which means an overhang past the viewport is not
 * scrollable — whatever lands outside is simply unreachable. So the placement clamps the center back inside, and this
 * pins the four cases that behave differently: room on both sides, crowded against either edge, and a toast wider
 * than the viewport (where centering is impossible and it left-aligns instead). Like the anchoring geometry, these
 * only misbehave at the edges, which is where a manual pass is least likely to look.
 *
 * Toast.js declares a top-level class: on a page that makes it a global binding, but under require() it stays
 * module-scoped, so the test evaluates the source directly (the same approach badgeAchievements.test.js takes).
 * jsdom has no layout engine, so getBoundingClientRect is stubbed — the toast reports the width each test states and
 * the reference reports the rect it was given, which is what a geometry test wants anyway.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/Toast.js'), 'utf8'
);
const Toast = new Function(`${SOURCE}; return Toast;`)();

// Matches the constants in Toast.#position.
const EDGE = 8;
const VERTICAL_FRACTION = 0.10;

const VIEWPORT_WIDTH = 1000;

/** Installs a layout stub: elements report `toastWidth` if they are the toast, `refRect` otherwise. */
function stubLayout(toastWidth, refRect) {
    Element.prototype.getBoundingClientRect = function () {
        if (this.classList.contains('ps-toast')) {
            return { left: 0, top: 0, right: toastWidth, bottom: 40, width: toastWidth, height: 40 };
        }
        return { right: refRect.left + refRect.width, bottom: refRect.top + refRect.height, ...refRect };
    };
}

/** Shows a toast over a reference at `refRect` and returns the `left`/`top` px it placed itself at. */
function place(toastWidth, refRect) {
    stubLayout(toastWidth, refRect);
    const reference = document.createElement('div');
    document.body.appendChild(reference);

    // duration 0 disables the auto-dismiss timer, so nothing is left pending after the test.
    Toast.show({ message: 'hi', reference, duration: 0 });

    const el = document.querySelector('.ps-toast');
    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

describe('Toast placement', () => {
    const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    beforeEach(() => {
        document.body.innerHTML = '';
        window.innerWidth = VIEWPORT_WIDTH;
        global.i18next = { t: (key) => key };
        global.util = { assetPath: assetPathStub }; // The close button's icon URL.
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
    });

    it('centers on the reference and sits 10% down it when there is room on both sides', () => {
        const { left, top } = place(300, { left: 200, top: 100, width: 600, height: 400 });

        expect(left).toBe(500);                               // 200 + 600/2
        expect(top).toBe(100 + 400 * VERTICAL_FRACTION);      // 140
    });

    it('pulls the center right so the toast clears the left edge', () => {
        // Centering on a reference at x=40 would put the toast's left edge at -110, off-screen and unreachable.
        const { left } = place(300, { left: 0, top: 0, width: 80, height: 400 });

        expect(left).toBe(EDGE + 150); // 158
    });

    it('pulls the center left so the toast clears the right edge', () => {
        const { left } = place(300, { left: 900, top: 0, width: 100, height: 400 });

        expect(left).toBe(VIEWPORT_WIDTH - EDGE - 150); // 842
    });

    it('left-aligns a toast too wide to fit, rather than centering it off both edges', () => {
        // No center satisfies both bounds, so the start of the message is what stays on screen.
        const { left } = place(1200, { left: 0, top: 0, width: VIEWPORT_WIDTH, height: 400 });

        expect(left).toBe(EDGE + 600); // 608 -> left edge at EDGE
    });

    it('centers on the viewport when no reference is given', () => {
        stubLayout(300, {});
        Toast.show({ message: 'hi', duration: 0 });

        const el = document.querySelector('.ps-toast');
        expect(parseFloat(el.style.left)).toBe(VIEWPORT_WIDTH / 2);
    });
});
