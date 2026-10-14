/**
 * Tests for Label#toLatLng's estimating branch (frontend/js/explore/label/Label.js, issues #4765/#4766).
 *
 * The client-side estimator must mirror the server's PanoDataService.toLatLng: distance from the saturating-cotangent
 * blend on the label's depression angle, bearing straight from the label's centered POV, and 'approximation3' as the
 * computation method.
 *
 * What these pin is the *formula*, not the constants. The constants reach the browser from the backend at runtime
 * (ExploreConfig.latLngEstimation, from PanoDataService.LatLngEstimation.asJson in explore.scala.html), so the
 * shipped client cannot hold a stale copy of them; the fixture below is a hand-copy of that payload standing in for
 * the injection. So a refit that changes the camera height or the blend angle must update this fixture and
 * its expected distances alongside PanoDataServiceSpec's pins — nothing here fails on its own if it doesn't.
 *
 * The fixture's values are the fitted ones: camera height from `final_coefficients` in `data/modern-truth-summary.json`
 * and blend angle + distance cap from `data/distance-refit-summary.json`, both in
 * https://github.com/ProjectSidewalk/label-latlng-estimation. PanoDataService.LatLngEstimation documents how each was
 * derived; don't adjust one here to make a test pass.
 */

import { loadModules } from './loader.js';

describe('Label lat/lng estimation', () => {
    let Label;

    const LAT_LNG_ESTIMATION = {
        blendDeg: 11.25,
        maxDistanceM: 50.0,
        cameraHeightM: 2.341219672825709,
    };

    /** A label mid-placement: no cached labelLat, so placing it on the minimap runs the estimator. */
    function newLabel({ labelType = 'CurbRamp', pitch, heading = 90 } = {}) {
        const label = new Label({
            labelType,
            temporaryLabelId: 1,
            panoXY: { x: 10, y: 20 },   // Present, so the constructor skips the pano-store lookup.
            povOfLabelIfCentered: { heading, pitch, zoom: 1 },
            panoLat: 47.6553,
            panoLng: -122.3035,
        }, {}, LAT_LNG_ESTIMATION, {});
        label.placeOnMinimap({ addMarker: () => ({ setVisible: () => {} }) }, null, () => {});
        return label;
    }

    beforeEach(async () => {
        ({ Label } = await loadModules('frontend/js/explore/label/Label.js'));
        window.i18next = { t: () => '' };
        Label.styleMinimapMarker = () => {};
        window.turf = {
            point: (coords) => ({ geometry: { coordinates: coords } }),
            destination: vi.fn((_start, _distKm, _bearing) => ({ geometry: { coordinates: [-122.303, 47.656] } })),
        };
    });

    /** The [distanceKm, bearing] the estimator handed to turf.destination for the label's single placement. */
    function destinationArgs() {
        expect(window.turf.destination).toHaveBeenCalledTimes(1);
        const [, distKm, bearing] = window.turf.destination.mock.calls[0];
        return [distKm, bearing];
    }

    test('cotangent branch: distance is the camera height over tan(depression), bearing is the centered POV', () => {
        newLabel({ pitch: -22.5, heading: 137.25 });

        const [distKm, bearing] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(5.6522042866305275, 9); // 22.5° below the horizon.
        expect(bearing).toBe(137.25);
    });

    test('near-horizon tail: an above-horizon click is bounded at the published maximum answer', () => {
        newLabel({ pitch: 10 }); // 10° above the horizon.

        const [distKm] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(23.848261259830384, 9); // max_answer_m in the fit's summary.
    });

    test('the distance is the same whatever the label type', () => {
        newLabel({ labelType: 'Crosswalk', pitch: -20 });

        const [distKm] = destinationArgs();
        expect(distKm * 1000).toBeCloseTo(6.432448185071575, 9);
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
