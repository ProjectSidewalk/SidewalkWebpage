/**
 * Tests for util.misc.markerPercentInCoverBox (public/js/common/utilitiesSidewalk.js, #5085).
 *
 * Card surfaces cover-fit a label's crop into a fixed-aspect box and place the marker at a percentage of that box.
 * The helper re-expresses the label's frame position in the visible part of the crop; these pin that it is the
 * identity for the 3:2 corpus and trims the right axis for wider and taller frames.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

window.util = { assetPath: (p) => `/assets/${p}` };
loadGlobalScript('public/js/common/utilitiesSidewalk.js');

const percent = window.util.misc.markerPercentInCoverBox;

describe('util.misc.markerPercentInCoverBox', () => {
    it('is the identity when the frame has the box\'s aspect', () => {
        expect(percent(180, 120, 720, 480, 3 / 2)).toEqual({ left: 25, top: 25 });
        expect(percent(0, 480, 720, 480, 3 / 2)).toEqual({ left: 0, top: 100 });
        // Uniform scaling of the frame changes nothing.
        expect(percent(360, 240, 1440, 960, 3 / 2)).toEqual({ left: 25, top: 25 });
    });

    it('keeps the frame center at the box center for any aspect', () => {
        expect(percent(360, 202.5, 720, 405, 3 / 2)).toEqual({ left: 50, top: 50 });
        expect(percent(360, 720, 720, 1440, 3 / 2)).toEqual({ left: 50, top: 50 });
    });

    it('spreads a wider frame horizontally: only the box-shaped middle of the crop is visible', () => {
        // A 21:9 crop in a 3:2 box shows 9/14 of its width, so a point at 1/4 of the frame sits at
        // (0.25 - 0.5) * (21/9) / (3/2) + 0.5 = 0.1111 of the box, and the vertical fraction is untouched.
        const p = percent(180, 154.3, 720, 308.6, 3 / 2);
        expect(p.left).toBeCloseTo(11.11, 1);
        expect(p.top).toBeCloseTo(50, 1);
        // A point at the frame's edge lands outside the box, which is where a trimmed-away spot really is.
        expect(percent(0, 0, 720, 308.6, 3 / 2).left).toBeLessThan(0);
    });

    it('spreads a taller frame vertically', () => {
        // A 4:3 crop in a 3:2 box shows 8/9 of its height.
        const p = percent(180, 135, 720, 540, 3 / 2);
        expect(p.left).toBeCloseTo(25, 6);
        expect(p.top).toBeCloseTo((0.25 - 0.5) * (3 / 2) / (4 / 3) * 100 + 50, 6);
    });
});
