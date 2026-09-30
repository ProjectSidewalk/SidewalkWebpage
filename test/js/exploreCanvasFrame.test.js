/**
 * Tests for util.exploreCanvasFrame (public/js/common/utilities.js, #5085).
 *
 * Explore projects every click through a logical frame that is always 720 px wide and as tall as the displayed
 * pano's aspect makes it, and stores that frame with the label. These pin the two things that matter downstream:
 * every boxed-tool size yields exactly 720x480 (so the corpus stays homogeneous), and other aspects yield the height
 * the projection needs.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);

/** Puts a drawing layer of the given on-screen size in the document (jsdom's real rect is all zeroes). */
function layerOfSize(width, height) {
    document.body.innerHTML = '<div id="label-drawing-layer"></div>';
    document.getElementById('label-drawing-layer').getBoundingClientRect = () => ({
        left: 0, top: 0, right: width, bottom: height, width, height,
    });
}

describe('util.exploreCanvasFrame', () => {
    let util;

    beforeEach(() => {
        window.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
            getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
        window.eval(UTILITIES_SRC);
        util = window.util;
    });

    it.each([[720, 480], [468, 312], [1296, 864], [1080, 720]])(
        'is exactly 720x480 for the boxed tool at any scale (%ix%i)', (w, h) => {
            layerOfSize(w, h);
            expect(util.exploreCanvasFrame()).toEqual({ width: 720, height: 480 });
        });

    it.each([[1920, 1080, 405], [2520, 1080, 309], [1920, 950, 356], [1440, 1080, 540]])(
        'follows the displayed aspect otherwise (%ix%i -> 720x%i)', (w, h, expected) => {
            layerOfSize(w, h);
            expect(util.exploreCanvasFrame()).toEqual({ width: 720, height: expected });
        });

    it('falls back to 720x480 when the street view is absent or unmeasurable', () => {
        document.body.innerHTML = '';
        expect(util.exploreCanvasFrame()).toEqual({ width: 720, height: 480 });
        layerOfSize(0, 0);
        expect(util.exploreCanvasFrame()).toEqual({ width: 720, height: 480 });
    });
});
