/**
 * Tests for setRegionFocus (public/js/ps-map/psMapUtilities.js).
 *
 * A `?regionId=` link — a Gallery card's neighborhood, a dashboard link — has to land framed on that neighborhood,
 * so these pin what the map is asked to do for one: the right region picked out of what's rendered, and its own
 * bounds fitted rather than a fixed zoom that can only suit one size of neighborhood.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/ps-map/psMapUtilities.js'), 'utf8'
);

/** A square region feature, as queryRenderedFeatures hands it back. */
function region(id, [west, south], [east, north]) {
    return {
        id,
        geometry: {
            type: 'Polygon',
            coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
    };
}

describe('setRegionFocus', () => {
    let map;

    /** Minimal stand-in for the bounds object Mapbox builds, recording what it was extended with. */
    class LngLatBounds {
        constructor() {
            this.extended = [];
        }

        extend(coords) {
            this.extended.push(coords);
        }
    }

    beforeAll(() => {
        window.mapboxgl = { LngLatBounds };
        window.eval(`${SRC}\nwindow.setRegionFocus = setRegionFocus;`);
    });

    beforeEach(() => {
        jest.useFakeTimers();
        map = {
            getLayer: () => true,
            queryRenderedFeatures: () => [region(4, [-1, -1], [1, 1]), region(7, [10, 20], [11, 21])],
            fitBounds: jest.fn(),
        };
        window.util = { getURLParameter: () => '7' };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('fits the named region\'s own bounds', () => {
        window.setRegionFocus(map);
        jest.runAllTimers();

        expect(map.fitBounds).toHaveBeenCalledTimes(1);
        const [bounds, options] = map.fitBounds.mock.calls[0];
        expect(bounds.extended).toEqual([[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]]);
        expect(options).toEqual({ padding: 40 });
    });

    it('leaves the map where it is when the URL names no region', () => {
        window.util = { getURLParameter: () => null };

        window.setRegionFocus(map);
        jest.runAllTimers();

        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('leaves the map where it is when the region is not among the rendered ones', () => {
        map.queryRenderedFeatures = () => [region(4, [-1, -1], [1, 1])];

        window.setRegionFocus(map);
        jest.runAllTimers();

        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('leaves the map where it is on a page with no neighborhood layer', () => {
        map.getLayer = () => false;

        window.setRegionFocus(map);
        jest.runAllTimers();

        expect(map.fitBounds).not.toHaveBeenCalled();
    });
});
