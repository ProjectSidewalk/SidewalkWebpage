/**
 * Tests for the canvas↔POV↔pano projection in public/js/common/pano-viewer/src/panoUtilities.js.
 *
 * These pin one property that is invisible in the math but load-bearing across the whole app (#4851): the canvas
 * coordinate is projected exactly as given, with no vertical or horizontal anchor offset. Explore computes a label's
 * pano_x/pano_y from canvasCoordToCenteredPov's output at submission time, and Validate, Gallery, Admin and the
 * label-detail popup all re-derive the label's POV from the stored canvas coordinate — so a constant nudge inside
 * this function silently desyncs every reader from the record the writer produced. AI labels depend on the same
 * identity from the other direction: ExploreService.submitAiLabelData writes them at the canvas center precisely so
 * that this function hands back the submitted POV untouched.
 *
 * panoUtilities.js is a plain global script (`util.pano.* = ...`) built for Grunt concatenation, so the source is
 * eval'd into the jsdom global scope against a fresh `util`.
 */

const fs = require('fs');
const path = require('path');

const PANO_UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/panoUtilities.js'), 'utf8'
);

// Explore's authoring canvas, the frame every stored canvas_x/canvas_y is expressed in (util.EXPLORE_CANVAS_*).
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 480;

/** Loads a fresh copy of panoUtilities.js into the jsdom global scope and returns its `util.pano` namespace. */
function loadPanoUtilities() {
    window.util = {};
    window.eval(PANO_UTILITIES_SRC);
    return window.util.pano;
}

/**
 * Normalizes a heading to [0, 360) so bearings can be compared. The projection derives heading with atan2, which
 * yields (-180, 180], while callers hand it POVs in either convention — the same bearing, written two ways.
 * @param {number} heading - A heading in degrees.
 * @returns {number} The equivalent heading in [0, 360).
 */
function normalizeHeading(heading) {
    return ((heading % 360) + 360) % 360;
}

describe('util.pano projection', () => {
    let pano;

    // The module is a set of pure functions with no state, so one load serves every test.
    beforeAll(() => {
        pano = loadPanoUtilities();
    });

    describe('canvasCoordToCenteredPov', () => {
        // A point at the exact center of the canvas is already centered, so its POV is the pano's POV. This is the
        // assertion a re-introduced anchor offset trips first, and the contract AI label submission relies on.
        it.each([
            ['zoom 1', { heading: 90.5, pitch: -5.9, zoom: 1 }],
            ['zoom 2', { heading: 312.25, pitch: -20.3, zoom: 2 }],
            ['zoom 3', { heading: 0, pitch: 0, zoom: 3 }],
            ['negative heading', { heading: -47.125, pitch: 12.75, zoom: 1 }],
        ])('returns the pano POV unchanged for a point at the canvas center (%s)', (_label, pov) => {
            const centered = pano.canvasCoordToCenteredPov(
                pov, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT
            );

            expect(normalizeHeading(centered.heading)).toBeCloseTo(normalizeHeading(pov.heading), 6);
            expect(centered.pitch).toBeCloseTo(pov.pitch, 6);
            expect(centered.zoom).toBe(pov.zoom);
        });

        // Projecting a canvas point out to a POV and back must land on the same pixel. An offset applied on only one
        // leg of that trip (which is what an anchor correction buried in the math would be) breaks the identity.
        it.each([
            [{ heading: 90.5, pitch: -5.9, zoom: 1 }, 257, 233],
            [{ heading: 50.04, pitch: -11.25, zoom: 1 }, 439, 253],
            [{ heading: 312.25, pitch: -20.3, zoom: 2 }, 12, 471],
            [{ heading: 203.875, pitch: -26.375, zoom: 2 }, 703, 9],
            [{ heading: -47.125, pitch: 12.75, zoom: 3 }, 360, 96],
        ])('round-trips a canvas coordinate through %o at (%i, %i)', (pov, canvasX, canvasY) => {
            const centered = pano.canvasCoordToCenteredPov(pov, canvasX, canvasY, CANVAS_WIDTH, CANVAS_HEIGHT);
            const coord = pano.centeredPovToCanvasCoord(centered, pov, CANVAS_WIDTH, CANVAS_HEIGHT, 20);

            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(canvasX, 6);
            expect(coord.y).toBeCloseTo(canvasY, 6);
        });
    });

    // PanoMarker falls back to the 2D projection whenever the browser hands it no WebGL context, so this runs for
    // real users even though it never executes in a WebGL-capable dev browser. It reaches for helpers on the util.pano
    // namespace, and a stale reference there is a TypeError on the very first marker draw rather than a bad pixel.
    describe('centeredPovToCanvasCoord2d (non-WebGL fallback)', () => {
        it('puts a point at the canvas center when it is already the viewport center', () => {
            const pov = { heading: 90.5, pitch: -5.9, zoom: 1 };
            const coord = pano.centeredPovToCanvasCoord2d(pov, pov, CANVAS_WIDTH, CANVAS_HEIGHT, 20);

            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(CANVAS_WIDTH / 2, 6);
            expect(coord.y).toBeCloseTo(CANVAS_HEIGHT / 2, 6);
        });

        // The heading difference is wrapped, so a point just across the 0°/360° seam stays beside the viewport
        // center instead of projecting a full turn away.
        it('wraps the heading difference across the 0/360 seam', () => {
            const coord = pano.centeredPovToCanvasCoord2d(
                { heading: 1, pitch: 0 }, { heading: 359, pitch: 0, zoom: 1 }, CANVAS_WIDTH, CANVAS_HEIGHT, 20
            );

            expect(coord).not.toBeNull();
            expect(coord.x).toBeGreaterThan(CANVAS_WIDTH / 2);
            expect(coord.x).toBeLessThan(CANVAS_WIDTH);
        });
    });

    describe('record consistency with stored pano coordinates', () => {
        // Real rows from the seeded Seattle dev DB (sidewalk_seattle.label_point joined to pano_data). label_point
        // stores the pano's POV at label time plus the canvas coordinate; pano_x/pano_y is what Explore derived from
        // that pair via canvasCoordToCenteredPov -> povToPanoCoord. Re-running that composition here has to reproduce
        // the stored values, which is the property the whole render path reads back. A 5-px canvas nudge shows up as
        // roughly 30 px of pano_y at these zoom levels, far outside the tolerance below.
        it.each([
            [290327, { heading: 50.04018020629883, pitch: -11.252232551574707, zoom: 1 }, 439, 253,
                102.51716613769531, 16384, 8192, 6379, 4688],
            [290328, { heading: 90.57366180419922, pitch: -5.8973212242126465, zoom: 2 }, 257, 233,
                105.35053253173828, 16384, 8192, 7148, 4337],
        ])('reproduces label %i\'s stored pano_x/pano_y from its canvas coordinate',
            (_labelId, pov, canvasX, canvasY, cameraHeading, panoWidth, panoHeight, panoX, panoY) => {
                const centered = pano.canvasCoordToCenteredPov(pov, canvasX, canvasY, CANVAS_WIDTH, CANVAS_HEIGHT);
                const coord = pano.povToPanoCoord(centered, cameraHeading, panoWidth, panoHeight);

                // The stored columns are integers, so allow the rounding the database applied and nothing more.
                expect(Math.abs(coord.x - panoX)).toBeLessThanOrEqual(1);
                expect(Math.abs(coord.y - panoY)).toBeLessThanOrEqual(1);
            });
    });
});
