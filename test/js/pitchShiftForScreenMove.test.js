/**
 * Tests for util.pano.pitchShiftForScreenMove (frontend/js/common/pano-viewer/panoUtilities.js, #5580), the pitch
 * change Validate uses to pan a label up out from under the phone dock. The cases pin the rectilinear geometry: exact
 * at the frame's edge, zero for no move, and not the linear px-per-degree ratio that overshoots away from the centre.
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
