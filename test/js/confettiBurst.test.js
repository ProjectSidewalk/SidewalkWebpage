/**
 * Tests for public/js/common/Confetti.js — the burst that celebrates a finished mobile Validate mission (#4886).
 *
 * Two things about it are easy to get wrong. It covers the whole viewport, and a large one on a high-density
 * display asks for more device pixels than a canvas is allowed: iOS Safari refuses past ~16.7M, and over that
 * `getContext` still succeeds while every draw is a silent no-op — so the failure is an invisible celebration,
 * with nothing thrown and nothing logged. And it draws in brand colors that live in the design tokens, which a
 * color frozen into the source would drift away from.
 *
 * Confetti.js declares a top-level class, so the tests evaluate the source rather than using loadGlobalScript.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/Confetti.js'), 'utf8'
);
const Confetti = new Function(`${SOURCE}; return Confetti;`)();

// iOS Safari's canvas-area ceiling, spelled out here rather than read off the class so a change to the constant
// has to be a deliberate one rather than something these tests follow silently.
const IOS_CANVAS_AREA_CAP = 4096 * 4096;

// A desktop window big enough that the full device pixel ratio would blow the budget: 2560x1440 at ratio 3 is
// ~33M device pixels, twice what is allowed.
const OVERSIZED_LAYOUT = {width: 2560, height: 1440};

describe('Confetti.backingRatio', () => {
    test('an unconstrained canvas is drawn at the display’s full device pixel ratio', () => {
        expect(Confetti.backingRatio(390, 844, 3)).toBe(3);
        expect(Confetti.backingRatio(390, 844, 1)).toBe(1);
    });

    test('a canvas that would blow the budget is drawn at a ratio that fits it', () => {
        const ratio = Confetti.backingRatio(OVERSIZED_LAYOUT.width, OVERSIZED_LAYOUT.height, 3);

        expect(ratio).toBeLessThan(3);
        const area = (OVERSIZED_LAYOUT.width * ratio) * (OVERSIZED_LAYOUT.height * ratio);
        expect(area).toBeLessThanOrEqual(IOS_CANVAS_AREA_CAP + 1e-6); // The cap, to within a float's last bit.
    });

    test('the backing store stays inside the cap across every plausible viewport and ratio', () => {
        for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900], [2560, 1440]]) {
            for (const deviceRatio of [1, 1.5, 2, 2.625, 3, 4]) {
                const ratio = Confetti.backingRatio(width, height, deviceRatio);
                expect(ratio).toBeLessThanOrEqual(deviceRatio);
                expect((width * ratio) * (height * ratio)).toBeLessThanOrEqual(IOS_CANVAS_AREA_CAP + 1e-6);
            }
        }
    });

    test('it gives up exactly as much ratio as the cap demands, and no more', () => {
        // Right at the budget the full ratio is still allowed; a hair past it, the ratio is trimmed.
        const side = Math.sqrt(IOS_CANVAS_AREA_CAP);
        expect(Confetti.backingRatio(side, side, 1)).toBe(1);
        expect(Confetti.backingRatio(side + 1, side + 1, 1)).toBeLessThan(1);
        // And the cap is an area budget, not a per-axis one: a wide, short canvas keeps its full ratio.
        expect(Confetti.backingRatio(6000, 100, 2)).toBe(2);
    });

    test('a canvas with no laid-out size falls back to the device ratio rather than dividing by zero', () => {
        expect(Confetti.backingRatio(0, 0, 2)).toBe(2);
        expect(Confetti.backingRatio(390, 0, 3)).toBe(3);
    });
});

describe('Confetti.burst', () => {
    let ctx;
    let reduceMotion;

    beforeEach(() => {
        reduceMotion = false;
        window.matchMedia = jest.fn((query) => ({
            matches: query.includes('prefers-reduced-motion: reduce') ? reduceMotion : !reduceMotion,
        }));
        // jsdom lays nothing out, so the canvas is told what it covers. The default is the case the cap bites on.
        jest.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockReturnValue(OVERSIZED_LAYOUT.width);
        jest.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockReturnValue(OVERSIZED_LAYOUT.height);
        ctx = {
            scale: jest.fn(), clearRect: jest.fn(), save: jest.fn(), restore: jest.fn(),
            translate: jest.fn(), rotate: jest.fn(), fillRect: jest.fn(),
        };
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        window.requestAnimationFrame = jest.fn(); // Hold the first frame so the canvas can be inspected.
        Object.defineProperty(window, 'devicePixelRatio', {value: 3, configurable: true});
        setTokens(['#FBD98C', '#1F7A5C', '#F4772E', '#3B6FD4', '#9A73D8', '#4FBFA8']);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.body.innerHTML = '';
    });

    /** Publishes `values` as the six brand color tokens Confetti reads off the document root. */
    function setTokens(values) {
        const tokens = [
            '--color-banana-600', '--color-pine-500', '--color-orange-500',
            '--color-blue-500', '--color-purple-400', '--color-jade-400',
        ];
        tokens.forEach((token, i) => document.documentElement.style.setProperty(token, values[i] ?? ''));
    }

    /** @returns {?HTMLCanvasElement} The canvas the burst appended, if it appended one. */
    const canvas = () => document.body.querySelector('canvas');

    test('the canvas it draws into is inside the cap that would otherwise no-op every draw', () => {
        Confetti.burst();

        expect(canvas()).not.toBeNull();
        expect(canvas().width * canvas().height).toBeLessThanOrEqual(IOS_CANVAS_AREA_CAP);
        // Sized in CSS px of the layout it covers, so the pieces are still thrown across the whole screen.
        expect(canvas().style.width).toBe('100%');
        expect(ctx.scale).toHaveBeenCalledTimes(1);
        // The drawing is scaled by whatever ratio the backing store was sized at, or the pieces land off-canvas.
        // (The canvas's own width is that ratio rounded to whole device pixels, so compare against the ratio.)
        const capped = Confetti.backingRatio(OVERSIZED_LAYOUT.width, OVERSIZED_LAYOUT.height, 3);
        const [scaleX, scaleY] = ctx.scale.mock.calls[0];
        expect(scaleX).toBe(capped);
        expect(scaleY).toBe(scaleX);
        expect(canvas().width).toBe(Math.floor(OVERSIZED_LAYOUT.width * capped));
    });

    test('a display that fits inside the cap keeps its full ratio', () => {
        jest.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockReturnValue(390);
        jest.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockReturnValue(844);

        Confetti.burst();

        expect(canvas().width).toBe(390 * 3);
        expect(canvas().height).toBe(844 * 3);
    });

    test('it draws only in colors the design tokens actually publish', () => {
        Confetti.burst();
        // Run the frame the burst scheduled, and collect the fill colors it used.
        window.requestAnimationFrame.mock.calls[0][0](0);

        const used = new Set(ctx.fillRect.mock.calls.map(() => ctx.fillStyle));
        expect(ctx.fillRect).toHaveBeenCalled();
        for (const color of used) {
            expect(['#FBD98C', '#1F7A5C', '#F4772E', '#3B6FD4', '#9A73D8', '#4FBFA8']).toContain(color);
        }
    });

    test('a page carrying none of the tokens gets no confetti, rather than confetti in a color frozen in source', () => {
        setTokens([]);

        Confetti.burst();

        expect(canvas()).toBeNull();
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    test('tokens that are only partly published still draw, in the ones that resolved', () => {
        setTokens(['#FBD98C', '', '', '#3B6FD4', '', '']);

        Confetti.burst();
        window.requestAnimationFrame.mock.calls[0][0](0);

        expect(canvas()).not.toBeNull();
        expect(ctx.fillStyle === '#FBD98C' || ctx.fillStyle === '#3B6FD4').toBe(true);
    });

    test('a visitor who asked for less motion gets nothing at all, and no canvas is ever added', () => {
        reduceMotion = true;

        Confetti.burst();

        expect(canvas()).toBeNull();
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    test('the canvas is inert and hidden from assistive technology while it is up', () => {
        Confetti.burst();

        expect(canvas().getAttribute('aria-hidden')).toBe('true');
        expect(canvas().style.pointerEvents).toBe('none');
    });
});
