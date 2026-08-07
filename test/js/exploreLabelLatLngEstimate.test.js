/**
 * Tests for Label#toLatLng's estimating branch (public/js/explore/src/label/Label.js, issues #4765/#4766).
 *
 * The client-side estimator must mirror the server's PanoDataService.toLatLng: distance from the saturating-cotangent
 * blend on the label's depression angle, bearing straight from the label's centered POV, and 'approximation3' as the
 * computation method.
 *
 * What these pin is the *formula*, not the constants. The constants reach the browser from the backend at runtime
 * (svl.latLngEstimation, PanoDataService.LatLngEstimation.asJson injected by explore.scala.html), so the shipped
 * client cannot hold a stale copy of them; the fixture below is a hand-copy of that payload standing in for the
 * injection. It follows that a refit which changes the heights or the blend angle must update this fixture and its
 * expected distances alongside PanoDataServiceSpec's pins — nothing here fails on its own if it doesn't.
 */

const fs = require('fs');
const path = require('path');

const LABEL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
);

/** Loads a fresh Label class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadLabel() {
    window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
    return window.Label;
}

describe('Label lat/lng estimation', () => {
    let Label;

    /** A label mid-placement: no cached labelLat, so the constructor's toLatLng call runs the estimator. */
    function newLabel({ labelType = 'CurbRamp', pitch, heading = 90 } = {}) {
        return new Label({
            labelType,
            temporaryLabelId: 1,
            panoXY: { x: 10, y: 20 },   // Present, so the constructor skips the pano-store lookup.
            povOfLabelIfCentered: { heading, pitch, zoom: 1 },
            panoLat: 47.6553,
            panoLng: -122.3035,
        });
    }

    beforeEach(() => {
        Label = loadLabel();
        window.svl = {
            minimap: { getMap: () => null },
            latLngEstimation: {
                blendDeg: 11.25,
                maxDistanceM: 50.0,
                heightByTypeM: {
                    CurbRamp: 2.783228790539168,
                    NoCurbRamp: 2.5556144942356633,
                    NoSidewalk: 2.682312665952281,
                    Obstacle: 2.6931143839508347,
                    Occlusion: 2.723276984835889,
                    Other: 2.7424683309066746,
                    SurfaceProblem: 2.4991160921669926,
                },
                heightFallbackM: 2.715115204130135,
            },
        };
        Label.createMinimapMarker = () => ({ addListener: () => {} });
        window.turf = {
            point: (coords) => ({ geometry: { coordinates: coords } }),
            destination: jest.fn((start, distKm, bearing) => ({ geometry: { coordinates: [-122.303, 47.656] } })),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    /** The [distanceKm, bearing] the estimator handed to turf.destination for the label's single construction. */
    function destinationArgs() {
        expect(window.turf.destination).toHaveBeenCalledTimes(1);
        const [, distKm, bearing] = window.turf.destination.mock.calls[0];
        return [distKm, bearing];
    }

    test('cotangent branch: distance is the per-type height over tan(depression), bearing is the centered POV', () => {
        newLabel({ pitch: -22.5, heading: 137.25 });

        const [distKm, bearing] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(6.719308693306926, 9); // CurbRamp at 22.5° below the horizon.
        expect(bearing).toBe(137.25);
    });

    test('near-horizon tail: an above-horizon click is bounded at the published maximum answer', () => {
        newLabel({ pitch: 10 }); // 10° above the horizon.

        const [distKm] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(28.3506789700554, 9); // max_answer_m in the fit's summary.
    });

    test('label types absent from the fit use the pooled fallback height', () => {
        newLabel({ labelType: 'Crosswalk', pitch: -20 });

        const [distKm] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(7.459717714565474, 9);
    });

    test('the result is cached as approximation3', () => {
        const label = newLabel({ pitch: -22.5 });

        expect(label.getProperty('latLngComputationMethod')).toBe('approximation3');
        expect(label.getProperty('labelLat')).toBe(47.656);
        expect(label.getProperty('labelLng')).toBe(-122.303);

        // A second call returns the cache without re-estimating.
        expect(label.toLatLng().latLngComputationMethod).toBe('approximation3');
        expect(window.turf.destination).toHaveBeenCalledTimes(1);
    });
});
