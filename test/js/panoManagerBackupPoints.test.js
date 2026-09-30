/**
 * PanoManager.backupPointsAlongStreet: where Explore looks next when a street's seed has no usable imagery.
 *
 * A seed can sit off the street: an address drop-in passes the searched point (up to exploreAddressMaxDistM away),
 * and a label card's "Explore here" passes the label's position. Once GsvViewer started rejecting panos beyond the
 * search radius (#5114), a rejected off-street seed became common enough that the fallback's order matters. These
 * tests pin that the fallback starts at the seed's projection onto the street and works outward from there, rather
 * than from the start of the street, and that a seed at the street's start keeps the start-to-end order.
 *
 * PanoManager is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into the jsdom
 * global scope with real turf; nothing it touches at class-definition time needs more.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/panorama/PanoManager.js'), 'utf8');

window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));
window.NavigationService = { DIST_INCREMENT: 0.01 }; // 10 m, as in NavigationService.
window.eval(`${SRC}; window.PanoManager = PanoManager;`);
const { PanoManager, turf } = window;

// A straight ~400 m street running east along one latitude, so "along" is plain metres east of the start.
const LAT = 47.6;
const START_LNG = -122.33;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const STREET = turf.lineString([[START_LNG, LAT], [lngAt(400), LAT]]);
const END = { lat: LAT, lng: lngAt(400) };

/** Metres along the street from its start, of a point on it. */
const alongM = ({ lat, lng }) => turf.nearestPointOnLine(STREET, turf.point([lng, lat])).properties.location * 1000;
/** Metres from a point to the street line. */
const offStreetM = ({ lat, lng }) => turf.pointToLineDistance(turf.point([lng, lat]), STREET, { units: 'meters' });

describe('PanoManager.backupPointsAlongStreet', () => {
    test('with no seed, walks the street every 10 m from the start and ends at the endpoint', () => {
        const points = PanoManager.backupPointsAlongStreet(STREET, END);
        expect(points).toHaveLength(40);
        expect(alongM(points[0])).toBeCloseTo(10, 0);
        expect(alongM(points[1])).toBeCloseTo(20, 0);
        expect(points.at(-1)).toEqual(END);
    });

    test('a seed at the street start keeps the start-to-end order, and is not asked about twice', () => {
        const points = PanoManager.backupPointsAlongStreet(STREET, END, { lat: LAT, lng: START_LNG });
        expect(points).toEqual(PanoManager.backupPointsAlongStreet(STREET, END));
    });

    test('an off-street seed retries at its projection onto the street first, then works outward from it', () => {
        // An address drop-in 30 m north of the street, 300 m along it.
        const seed = { lat: LAT + 30 / 111320, lng: lngAt(300) };
        const points = PanoManager.backupPointsAlongStreet(STREET, END, seed);

        expect(offStreetM(points[0])).toBeLessThan(0.5);
        expect(alongM(points[0])).toBeCloseTo(300, 0);
        // Then the grid, nearest the seed first: 290/310 before 280/320, and never the street's start early on.
        const nextFour = points.slice(1, 5).map((p) => Math.round(alongM(p)));
        expect(nextFour.sort((a, b) => a - b)).toEqual([280, 290, 310, 320]);
        expect(Math.round(alongM(points.at(-1)))).toBe(10); // The far end of the street from the seed comes last.
        // Only the 300 m grid point, which sits on the projection, is dropped: projection + 38 grid points + endpoint.
        expect(points).toHaveLength(40);
        expect(points.filter((p) => Math.round(alongM(p)) === 300)).toHaveLength(1);
        expect(points).toContainEqual(END);
    });

    test('equidistant grid points keep their start-to-end order', () => {
        const seed = { lat: LAT + 30 / 111320, lng: lngAt(300) };
        const [, first, second] = PanoManager.backupPointsAlongStreet(STREET, END, seed).map(alongM);
        expect(first).toBeLessThan(second); // 290 before 310.
    });

    test('a seed on the street mid-way (a resumed walk) is not re-asked, and the fallback starts beside it', () => {
        const seed = { lat: LAT, lng: lngAt(155) };
        const points = PanoManager.backupPointsAlongStreet(STREET, END, seed);
        expect(points).toHaveLength(40);
        expect([150, 160]).toContain(Math.round(alongM(points[0])));
    });
});
