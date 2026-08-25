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
 * What this adds over the projection coverage already in the tree: PanoDataServiceSpec pins the Scala port and
 * exploreLabelPovStaleness.test.js replays the forward composition, but neither covers the canvas→POV→canvas
 * inverse or the non-WebGL 2D fallback, and nothing held the JS port to the Scala one. The record fixtures below are
 * PanoDataServiceSpec's, so both ports are pinned to the same pov_replay.py values rather than to each other.
 */

const fs = require('fs');
const path = require('path');
const {loadGlobalScript} = require('./loadGlobalScript');

const VALIDATE_LABEL_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/label/Label.js');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

const pano = window.util.pano;

// The authoring canvas every stored canvas_x/canvas_y is expressed in, read from the constant itself rather than
// copied as a literal. LabelPointTable.canvasWidth/canvasHeight is the backend half of the same pair.
const CANVAS_WIDTH = window.util.EXPLORE_CANVAS_WIDTH;
const CANVAS_HEIGHT = window.util.EXPLORE_CANVAS_HEIGHT;

describe('util.pano projection', () => {
    describe('canvasCoordToCenteredPov', () => {
        // A point at the exact center of the canvas is already centered, so its POV is the pano's POV. This is the
        // assertion a re-introduced anchor offset trips first, and the contract AI label submission relies on.
        // Headings are compared through wrapHeading: the projection returns atan2's (-180, 180] while callers pass
        // either convention, and a raw subtraction across the 0/360 seam reads a rounding wobble as a full turn.
        it.each([
            ['zoom 1', {heading: 90.5, pitch: -5.9, zoom: 1}],
            ['zoom 2', {heading: 312.25, pitch: -20.3, zoom: 2}],
            ['zoom 3', {heading: 0, pitch: 0, zoom: 3}],
            ['negative heading', {heading: -47.125, pitch: 12.75, zoom: 1}],
            ['on the seam', {heading: 0, pitch: -8.25, zoom: 2}],
            ['on the seam from above', {heading: 360, pitch: 6.5, zoom: 1}],
        ])('returns the pano POV unchanged for a point at the canvas center (%s)', (_label, pov) => {
            const centered = pano.canvasCoordToCenteredPov(
                pov, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT
            );

            expect(pano.wrapHeading(centered.heading - pov.heading)).toBeCloseTo(0, 6);
            expect(centered.pitch).toBeCloseTo(pov.pitch, 6);
            expect(centered.zoom).toBe(pov.zoom);
        });

        // Projecting a canvas point out to a POV and back must land on the same pixel. An offset applied on only one
        // leg of that trip (which is what an anchor correction buried in the math would be) breaks the identity.
        it.each([
            [{heading: 90.5, pitch: -5.9, zoom: 1}, 257, 233],
            [{heading: 50.04, pitch: -11.25, zoom: 1}, 439, 253],
            [{heading: 312.25, pitch: -20.3, zoom: 2}, 12, 471],
            [{heading: 203.875, pitch: -26.375, zoom: 2}, 703, 9],
            [{heading: -47.125, pitch: 12.75, zoom: 3}, 360, 96],
        ])('round-trips a canvas coordinate through %o at (%i, %i)', (pov, canvasX, canvasY) => {
            const centered = pano.canvasCoordToCenteredPov(pov, canvasX, canvasY, CANVAS_WIDTH, CANVAS_HEIGHT);
            const coord = pano.centeredPovToCanvasCoord(centered, pov, CANVAS_WIDTH, CANVAS_HEIGHT, 20);

            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(canvasX, 6);
            expect(coord.y).toBeCloseTo(canvasY, 6);
        });

        // The null return is what makes Explore skip drawing an off-screen label and PanoMarker park itself at
        // -9999px. Without it a label 180° behind the viewer projects onto the canvas as if it were in front.
        it('returns null for a point behind the camera', () => {
            const pov = {heading: 90, pitch: 0, zoom: 1};
            const behind = {heading: 270, pitch: 0};

            expect(pano.centeredPovToCanvasCoord(behind, pov, CANVAS_WIDTH, CANVAS_HEIGHT, 20)).toBeNull();
        });
    });

    // PanoMarker falls back to the 2D projection whenever the browser hands it no WebGL context, so this runs for
    // real users even though it never executes in a WebGL-capable dev browser. It reaches for helpers on the util.pano
    // namespace, and a stale reference there is a TypeError on the very first marker draw rather than a bad pixel.
    describe('centeredPovToCanvasCoord2d (non-WebGL fallback)', () => {
        it('puts a point at the canvas center when it is already the viewport center', () => {
            const pov = {heading: 90.5, pitch: -5.9, zoom: 1};
            const coord = pano.centeredPovToCanvasCoord2d(pov, pov, CANVAS_WIDTH, CANVAS_HEIGHT, 20);

            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(CANVAS_WIDTH / 2, 6);
            expect(coord.y).toBeCloseTo(CANVAS_HEIGHT / 2, 6);
        });

        // Without wrapping, the 2° gap across the seam reads as -358° and projects a full turn off-canvas (null).
        it('wraps the heading difference across the 0/360 seam', () => {
            const coord = pano.centeredPovToCanvasCoord2d(
                {heading: 1, pitch: 0}, {heading: 359, pitch: 0, zoom: 1}, CANVAS_WIDTH, CANVAS_HEIGHT, 20
            );

            // hfov is 90° at zoom 1, so a wrapped +2° lands 2/90 of the canvas width right of center.
            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(CANVAS_WIDTH / 2 + (2 / 90) * CANVAS_WIDTH, 6);
            expect(coord.y).toBeCloseTo(CANVAS_HEIGHT / 2, 6);
        });

        // The vertical axis needs its own case: with equal pitches dv is 0, which evaluates neither the aspect-ratio
        // correction in vfov nor the sign of targetY, so a mirrored or mis-scaled marker column would pass unseen.
        it('projects a pitch difference down the canvas, scaled by the vertical fov', () => {
            const coord = pano.centeredPovToCanvasCoord2d(
                {heading: 90, pitch: -10}, {heading: 90, pitch: 0, zoom: 1}, CANVAS_WIDTH, CANVAS_HEIGHT, 20
            );

            // vfov is hfov * 480/720 = 60° at zoom 1, so a 10° drop is a sixth of the canvas height below center.
            expect(coord).not.toBeNull();
            expect(coord.x).toBeCloseTo(CANVAS_WIDTH / 2, 6);
            expect(coord.y).toBeCloseTo(CANVAS_HEIGHT / 2 + (10 / 60) * CANVAS_HEIGHT, 6);
        });
    });

    // Record consistency: canvasCoordToCenteredPov -> povToPanoCoord is the composition Explore runs at submission
    // time (Label.js), and every consumer reads its result back out of label_point. These fixtures are lifted from
    // test/service/PanoDataServiceSpec.scala, where each expected value is pinned from sidewalk-panorama-tools'
    // pov_replay.py rather than from either implementation — so this holds the JS and Scala ports to one external
    // oracle instead of to each other. Two are real production records (Teaneck 14955 stored, Chicago 65640
    // repaired); zoom 3 matters because it is the only fixture on zoomToFov's exponential branch, and the identity
    // and round-trip assertions above cancel fov out entirely.
    describe('record consistency with pov_replay.py fixtures', () => {
        it.each([
            ['canvas center, zoom 1', {heading: 123.4, pitch: -17.25, zoom: 1}, 360, 240, 100.0, 16384, 8192,
                9257, 4881],
            ['Teaneck 14955, zoom 1', {heading: 298.25, pitch: -35.0, zoom: 1}, 451, 142, 18.107881546020508,
                16384, 8192, 5217, 4972],
            ['Chicago 65640, zoom 3', {heading: 155.9336, pitch: -15.0063, zoom: 3}, 81, 195, 183.0481719970703,
                16384, 8192, 6453, 4688],
            ['pano-x seam, zoom 2', {heading: 359.5, pitch: -10.0, zoom: 2}, 700, 460, 0.25, 13312, 6656,
                7620, 4230],
        ])('reproduces the pinned pano_x/pano_y for %s', (_label, pov, canvasX, canvasY, cameraHeading, panoWidth,
            panoHeight, panoX, panoY) => {
            const centered = pano.canvasCoordToCenteredPov(pov, canvasX, canvasY, CANVAS_WIDTH, CANVAS_HEIGHT);
            const coord = pano.povToPanoCoord(centered, cameraHeading, panoWidth, panoHeight);

            // The Scala port rounds to the integer columns label_point stores, so compare on the same footing.
            expect(Math.round(coord.x)).toBe(panoX);
            expect(Math.round(coord.y)).toBe(panoY);
            expect(coord.x).toBeGreaterThanOrEqual(0);
            expect(coord.x).toBeLessThan(panoWidth);
        });
    });

    // The shared function is only half the invariant. The 5-px fudge #4851 chased never lived in the projection
    // itself — it lived in each consumer's copy, and today's equivalent is a nudge on the arguments at a call site.
    // So pin the consumer too: a label stored at the canvas center must read back as the POV it was authored at.
    describe('consumer call sites pass the stored canvas coordinate through unchanged', () => {
        it('Validate: getOriginalPov returns the authored POV for a center-canvas label', () => {
            const src = fs.readFileSync(VALIDATE_LABEL_PATH, 'utf8');
            const ValidateLabel = (0, eval)(`(() => {\n${src}\nreturn Label;\n})()`);
            // Label's init reaches for the backup-image helper the Grunt bundle concatenates alongside it.
            global.buildBackupImageData = () => null;
            const authored = {heading: 212.75, pitch: -9.5, zoom: 2};
            const label = new ValidateLabel({
                canvas_x: CANVAS_WIDTH / 2, canvas_y: CANVAS_HEIGHT / 2,
                heading: authored.heading, pitch: authored.pitch, zoom: authored.zoom,
            });

            const pov = label.getOriginalPov();

            expect(pano.wrapHeading(pov.heading - authored.heading)).toBeCloseTo(0, 6);
            expect(pov.pitch).toBeCloseTo(authored.pitch, 6);
            expect(pov.zoom).toBe(authored.zoom);
        });
    });
});
