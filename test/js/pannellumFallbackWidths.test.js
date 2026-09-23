/**
 * Tests for the pano-viewer's downscale fallback ladder
 * (public/js/common/pano-viewer/src/PannellumViewer.js, issue #5256).
 *
 * A device that cannot texture a stored panorama asks `/backupImage` for a narrower copy, and when even that fails
 * it walks down to smaller ones. The rungs have to step down from the width the FIRST candidate is actually served
 * at, which is the pano's own width whenever that is under the GPU's cap. Anchoring on the cap instead produces
 * rungs at or above the pano width, and the server answers those with the native file — so the retry re-fetches the
 * image that just failed and the ladder never reaches a size the device can hold.
 *
 * The source is eval'd into jsdom, since it is a top-level class written for Grunt concatenation. Each case
 * re-evaluates it: the GPU cap is read once and cached in a module-scope variable, so one scope cannot answer for
 * two different devices.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VIEWER_SRC = fs.readFileSync(
    path.join(REPO_ROOT, 'public/js/common/pano-viewer/src/PannellumViewer.js'), 'utf8');

const IMAGE_URL = '/backupImage/pano1';

/**
 * The candidate URLs the viewer would try, for a device whose `MAX_TEXTURE_SIZE` is `maxTextureSize`.
 *
 * @param {number|null} maxTextureSize The GPU limit, or null for a browser with no WebGL context at all.
 * @param {object} metadata Pano metadata (`imageUrl`, `width`).
 * @returns {string[]}
 */
function candidatesFor(maxTextureSize, metadata) {
    window.PanoViewer = class {}; // PannellumViewer extends it at definition time.
    window.HTMLCanvasElement.prototype.getContext = () => maxTextureSize === null ? null : {
        MAX_TEXTURE_SIZE: 0x0d33,
        getParameter: () => maxTextureSize,
        getExtension: () => null,
    };
    window.eval(`${VIEWER_SRC}\nwindow.__candidates = panoramaUrlCandidates;`);
    return window.__candidates(metadata);
}

/** The `maxWidth` each candidate asks for; null for the native file, which carries no parameter. */
const widthsOf = (urls) => urls.map((u) => {
    const m = /[?&]maxWidth=([^&]*)/.exec(u);
    return m ? Number(m[1]) : null;
});

describe('panoramaUrlCandidates', () => {
    it('steps down from the pano width, not the GPU cap, when the pano is the narrower of the two', () => {
        // MAX_TEXTURE_SIZE 16384 -> a 32768 ceiling, far above this 8192-wide pano, so rung 0 is the native file.
        // Anchored on the cap, the rungs would be 16384 and 8192 -- both of which the server answers with that same
        // native file, making every attempt identical to the one that just failed.
        expect(widthsOf(candidatesFor(16384, { imageUrl: IMAGE_URL, width: 8192 }))).toEqual([null, 4096, 2048]);
    });

    it('never offers a rung at or above the width that just failed', () => {
        for (const [maxTextureSize, panoWidth] of [[16384, 8192], [8192, 8192], [8192, 16384], [4096, 16384]]) {
            const widths = widthsOf(candidatesFor(maxTextureSize, { imageUrl: IMAGE_URL, width: panoWidth }));
            const served = widths[0] === null ? panoWidth : widths[0];
            expect(widths.slice(1).every((w) => w < served)).toBe(true);
        }
    });

    it('asks for the cap first when the pano is wider than the device can texture', () => {
        // MAX_TEXTURE_SIZE 4096 -> an 8192 ceiling, under this pano's 16384, so even rung 0 needs a copy.
        expect(widthsOf(candidatesFor(4096, { imageUrl: IMAGE_URL, width: 16384 }))).toEqual([8192, 4096, 2048]);
    });

    it('stops at the narrowest width the server will cut', () => {
        const widths = widthsOf(candidatesFor(2048, { imageUrl: IMAGE_URL, width: 16384 }));
        expect(Math.min(...widths.filter((w) => w !== null))).toBeGreaterThanOrEqual(2048);
    });

    it('offers at most three attempts', () => {
        expect(candidatesFor(16384, { imageUrl: IMAGE_URL, width: 16384 }).length).toBeLessThanOrEqual(3);
    });

    it('still ladders down for a browser that reports no WebGL context', () => {
        // No cap to read, but the pano width alone is enough to know what smaller looks like.
        expect(widthsOf(candidatesFor(null, { imageUrl: IMAGE_URL, width: 16384 }))).toEqual([null, 8192, 4096]);
    });

    it('offers only the native file when neither the cap nor the width is known', () => {
        const urls = candidatesFor(null, { imageUrl: IMAGE_URL });
        expect(urls).toEqual([IMAGE_URL]);
        expect(urls.join()).not.toContain('Infinity');
    });
});
