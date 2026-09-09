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
});
