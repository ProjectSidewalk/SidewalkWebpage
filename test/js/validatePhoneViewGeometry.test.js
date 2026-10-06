/**
 * Tests for the two pano-view helpers Validate's phone layout leans on (#5580), both in
 * frontend/js/common/pano-viewer/panoUtilities.js:
 * - util.pano.pitchShiftForScreenMove, the pitch change that pans a label up out from under the phone dock. The
 *   cases pin the rectilinear geometry: exact at the frame's edge, zero for no move, and not the linear
 *   px-per-degree ratio that overshoots away from the centre.
 * - util.pano.gsvZoomRange, the zoom span that visibly changes a GSV view of a given shape.
 */

const { loadGlobalScript, realUtil } = require('./loadGlobalScript');

window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
window.util = realUtil();
loadGlobalScript('frontend/js/common/utilitiesMath.js');
loadGlobalScript('frontend/js/common/pano-viewer/panoUtilities.js');
const shift = window.util.pano.pitchShiftForScreenMove;

describe('util.pano.pitchShiftForScreenMove', () => {
    test('moving the centre to the top edge looks down by half the vertical field', () => {
        expect(shift(0, -400, 800, 90)).toBeCloseTo(45, 6);
        expect(shift(0, -400, 800, 60)).toBeCloseTo(30, 6);
    });

    test('no move, no pan', () => {
        expect(shift(120, 120, 800, 75)).toBeCloseTo(0, 6);
    });

    test('a move up the screen is a positive shift, down a negative one, by the same amount', () => {
        const up = shift(200, -100, 844, 100);
        expect(up).toBeGreaterThan(0);
        expect(shift(-100, 200, 844, 100)).toBeCloseTo(-up, 6);
    });

    // Equal screen distances cover fewer degrees away from the centre, so a linear ratio would overshoot there.
    test('is the rectilinear angle, not a linear px-per-degree ratio', () => {
        const nearCentre = shift(100, 0, 800, 90);
        const nearEdge = shift(400, 300, 800, 90);
        expect(nearCentre).toBeGreaterThan(nearEdge);
        expect(nearCentre).toBeCloseTo(Math.atan(100 / 400) * 180 / Math.PI, 6);
    });
});

// #5580: GSV's vertical clamps make part of a fixed 1-3 zoom range dead on a frame that isn't about 3:2.
describe('util.pano.gsvZoomRange', () => {
    const range = window.util.pano.gsvZoomRange;
    const { min: narrowest, max: widest } = window.util.pano.GSV_VFOV_CLAMP_DEG;
    const vFovAt = (zoom, aspect) => window.util.pano.hFovToVFov(window.util.pano.zoomToFov(zoom), aspect);

    test('is exactly 1-3 on the 3:2 frame the buttons were designed for', () => {
        const { min, max } = range(3 / 2);
        expect(min).toBe(1);
        expect(max).toBe(3);
    });

    test('on a portrait phone, starts where the wide clamp lets go and keeps two levels of zoom', () => {
        const aspect = 390 / 844;
        const { min, max } = range(aspect);
        expect(min).toBeGreaterThan(2);
        expect(vFovAt(min, aspect)).toBeCloseTo(widest, 3);
        expect(max - min).toBeCloseTo(2, 6);
        expect(vFovAt(max, aspect)).toBeGreaterThan(narrowest);
    });

    test('on a landscape phone, stops where the narrow clamp takes over', () => {
        const aspect = 844 / 390;
        const { min, max } = range(aspect);
        expect(min).toBe(1);
        expect(max).toBeLessThan(3);
        expect(vFovAt(max, aspect)).toBeCloseTo(narrowest, 3);
    });
});
