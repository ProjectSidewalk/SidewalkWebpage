/**
 * Tests util.misc.labelMarkerFraction (public/js/common/utilitiesSidewalk.js), the rule three card surfaces share for
 * where a label sits in the image they are showing: the Gallery card, the landing validation grid, and the dashboard's
 * mistake cards.
 *
 * The rule exists because a crop file is one of two things (#2660) — the browser's snapshot of the Explore canvas, or
 * the window the crop job cut around the label — and only a `label_crop` row tells them apart. Getting it wrong points
 * the marker at empty pavement, which no screenshot review catches, so it is pinned here once rather than three times.
 *
 * A pure function over plain values; the consumers' own suites cover the wiring.
 */

const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');

const CROP_MARKER = { x: 0.5, y: 0.5 };

describe('labelMarkerFraction', () => {
    let labelMarkerFraction;

    beforeEach(() => {
        window.util = { assetPath: assetPathStub, EXPLORE_CANVAS_WIDTH: 720, EXPLORE_CANVAS_HEIGHT: 480 };
        installUtilitiesMisc();
        labelMarkerFraction = window.util.misc.labelMarkerFraction;
    });

    it('takes the recorded position when a crop is showing', () => {
        expect(labelMarkerFraction('crop', CROP_MARKER, 180, 360)).toEqual(CROP_MARKER);
    });

    // The still reproduces the 720x480 Explore frame, so the canvas fraction is right by construction there — and the
    // recorded position describes the crop only, which is why it is ignored rather than reused.
    it('ignores the recorded position on the Street View still', () => {
        expect(labelMarkerFraction('api', CROP_MARKER, 180, 360)).toEqual({ x: 0.25, y: 0.75 });
    });

    it('falls back to the canvas fraction for a crop nothing has recorded', () => {
        expect(labelMarkerFraction('crop', null, 180, 360)).toEqual({ x: 0.25, y: 0.75 });
    });

    // Defensive only: every card reads label_point.canvas_x, which is NOT NULL. Pinned because the alternative to
    // centring is dividing null, and NaN is a failure CSS drops silently — the marker just parks in the corner.
    it('centres the marker rather than dividing a missing canvas position', () => {
        expect(labelMarkerFraction('crop', null, null, null)).toEqual({ x: 0.5, y: 0.5 });
        expect(labelMarkerFraction('api', null, undefined, undefined)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('centres only the axis that is missing', () => {
        expect(labelMarkerFraction('api', null, 180, null)).toEqual({ x: 0.25, y: 0.5 });
    });

    // Matches CropService.exploreFrameMarker, which clamps the fraction it records for this same frame. Unclamped,
    // a historic out-of-frame row puts the marker off the card rather than at its edge.
    it('clamps a canvas position that sits outside the frame', () => {
        expect(labelMarkerFraction('api', null, 900, -40)).toEqual({ x: 1, y: 0 });
    });

    // A label placed in a 16:9 immersive viewport (#5085) has a 720x405 frame; the same canvas_y means a different
    // fraction of it than of the boxed 720x480 frame.
    describe('given the frame the label was placed in', () => {
        const FRAME = { canvasWidth: 720, canvasHeight: 405 };

        it('takes the canvas fraction in that frame for a crop nothing has recorded', () => {
            expect(labelMarkerFraction('crop', null, 180, 202.5, FRAME)).toEqual({ x: 0.25, y: 0.5 });
        });

        // The still is 3:2 at the frame's width and field of view, so the 16:9 frame sits in it vertically centred:
        // a point 1/4 of the way down the frame is 1/4 * (405/480) of the still's height above its centre.
        it('re-places the canvas fraction in the 3:2 Street View still', () => {
            const { x, y } = labelMarkerFraction('api', null, 180, 101.25, FRAME);
            expect(x).toBeCloseTo(0.25, 10);
            expect(y).toBeCloseTo(0.5 - 0.25 * (405 / 480), 10);
        });

        // A card cover-fits the 16:9 crop into its 3:2 box, which shows the middle (3/2) / (16/9) = 27/32 of the
        // crop's width, so a point at 1/4 of the crop's width sits (0.25 - 0.5) * 32/27 from the box's centre.
        it('re-expresses a recorded crop position in the 3:2 box the crop is cover-fitted into', () => {
            const marker = { x: 0.25, y: 0.5, width: 1440, height: 810 };
            const { x, y } = labelMarkerFraction('crop', marker, 180, 202.5, { ...FRAME, boxAspect: 3 / 2 });
            expect(x).toBeCloseTo(0.5 - 0.25 * (32 / 27), 10);
            expect(y).toBeCloseTo(0.5, 10);
        });

        it('assumes a crop with no recorded size has the frame\'s aspect', () => {
            const recorded = labelMarkerFraction('crop', { x: 0.25, y: 0.5, width: 1440, height: 810 }, 180, 202.5,
                { ...FRAME, boxAspect: 3 / 2 });
            const assumed = labelMarkerFraction('crop', null, 180, 202.5, { ...FRAME, boxAspect: 3 / 2 });
            expect(assumed.x).toBeCloseTo(recorded.x, 10);
            expect(assumed.y).toBeCloseTo(recorded.y, 10);
        });

        it('is the identity for a 3:2 image in a 3:2 box', () => {
            expect(labelMarkerFraction('crop', { x: 0.25, y: 0.75, width: 1440, height: 960 }, 180, 360,
                { boxAspect: 3 / 2 })).toEqual({ x: 0.25, y: 0.75 });
        });
    });
});
