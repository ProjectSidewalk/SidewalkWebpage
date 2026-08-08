/**
 * Tests for util.sizeCanvasToDisplay (public/js/common/utilities.js).
 *
 * Explore draws into a fixed 720x480 logical frame but displays the pano larger, so both canvases over it — the
 * label canvas (#4719) and the tutorial's onboarding canvas (#4817) — size their bitmap to the on-screen box times
 * the device pixel ratio and push a matching context transform. Get that pairing wrong and nothing throws: the
 * drawing simply lands at the wrong scale, or blurs. That is only visible on a HiDPI display, at one particular
 * window size, which makes it exactly the kind of arithmetic worth pinning here instead of re-eyeballing.
 *
 * jsdom has no layout engine and no 2D context, so the canvas's rect is stated outright and the context is a stub
 * that records what the routine set on it — which is all this routine touches.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);

/** A canvas whose on-screen box is fixed, since jsdom's real getBoundingClientRect is all zeroes. */
function makeCanvas(displayWidth, displayHeight = displayWidth / 1.5) {
    const el = document.createElement('canvas');
    el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: displayWidth, bottom: displayHeight, width: displayWidth, height: displayHeight,
    });
    return el;
}

/** A stand-in for the 2D context, recording the transform and the smoothing hint. */
function makeCtx() {
    return {
        transform: null,
        imageSmoothingQuality: 'low',
        setTransform(a, b, c, d, e, f) { this.transform = [a, b, c, d, e, f]; },
    };
}

/** jsdom pins devicePixelRatio at 1; the whole point of the routine is what it does at other values. */
function setDpr(value) {
    Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true, writable: true });
}

describe('util.sizeCanvasToDisplay', () => {
    let util;

    beforeEach(() => {
        // utilities.js builds a Bowser parser at load time; the sizing under test never consults it.
        window.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
            getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
        window.eval(UTILITIES_SRC);
        util = window.util;
        setDpr(1);
    });

    it('rasterizes at the on-screen size when the display is not HiDPI', () => {
        const el = makeCanvas(1080);
        util.sizeCanvasToDisplay(el, makeCtx());

        expect(el.width).toBe(1080);
        expect(el.height).toBe(720); // 1080 / 1.5, the 720x480 aspect.
    });

    it('multiplies the bitmap by the device pixel ratio on a HiDPI display', () => {
        const el = makeCanvas(1080);
        setDpr(2);
        util.sizeCanvasToDisplay(el, makeCtx());

        expect(el.width).toBe(2160);
        expect(el.height).toBe(1440);
    });

    it('rounds a fractional bitmap size to whole device pixels', () => {
        const el = makeCanvas(1000);
        setDpr(1.5);
        util.sizeCanvasToDisplay(el, makeCtx());

        expect(el.width).toBe(1500);        // 1000 * 1.5
        expect(el.height).toBe(1000);       // 1000 / 1.5 * 1.5, rounded from 999.99...
        expect(Number.isInteger(el.width)).toBe(true);
        expect(Number.isInteger(el.height)).toBe(true);
    });

    it('scales the context so the logical frame spans the whole bitmap', () => {
        const el = makeCanvas(1080);
        const ctx = makeCtx();
        setDpr(2);
        util.sizeCanvasToDisplay(el, ctx);

        // A uniform scale with no translation or skew: logical (0,0) stays at the bitmap's origin...
        const scale = 2160 / util.EXPLORE_CANVAS_WIDTH;
        expect(ctx.transform).toEqual([scale, 0, 0, scale, 0, 0]);
        // ...and logical (720, 480) lands on its far corner, so drawing needs no other adjustment.
        expect(scale * util.EXPLORE_CANVAS_WIDTH).toBeCloseTo(el.width, 6);
        expect(scale * util.EXPLORE_CANVAS_HEIGHT).toBeCloseTo(el.height, 6);
    });

    it('asks for high-quality smoothing, so downscaled label icons keep a clean outer circle', () => {
        const ctx = makeCtx();
        util.sizeCanvasToDisplay(makeCanvas(1080), ctx);

        expect(ctx.imageSmoothingQuality).toBe('high');
    });

    it('falls back to the logical width when the canvas is unmeasurable, keeping the transform at 1:1', () => {
        const el = makeCanvas(0);
        const ctx = makeCtx();
        util.sizeCanvasToDisplay(el, ctx);

        expect(el.width).toBe(util.EXPLORE_CANVAS_WIDTH);
        expect(el.height).toBe(util.EXPLORE_CANVAS_HEIGHT);
        expect(ctx.transform).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('treats a missing devicePixelRatio as 1 rather than collapsing the bitmap', () => {
        const el = makeCanvas(1080);
        const ctx = makeCtx();
        setDpr(undefined);
        util.sizeCanvasToDisplay(el, ctx);

        expect(el.width).toBe(1080);
        expect(ctx.transform[0]).toBeCloseTo(1080 / util.EXPLORE_CANVAS_WIDTH, 6);
    });

    it('re-applies the transform on a second call, since setting width/height resets the context', () => {
        const el = makeCanvas(1080);
        const ctx = makeCtx();
        util.sizeCanvasToDisplay(el, ctx);

        // What a resize looks like: the box grew, and the context the browser just cleared is handed back in.
        el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 960, width: 1440, height: 960 });
        ctx.transform = null;
        ctx.imageSmoothingQuality = 'low';
        util.sizeCanvasToDisplay(el, ctx);

        expect(el.width).toBe(1440);
        expect(ctx.transform).toEqual([1440 / 720, 0, 0, 1440 / 720, 0, 0]);
        expect(ctx.imageSmoothingQuality).toBe('high');
    });
});
