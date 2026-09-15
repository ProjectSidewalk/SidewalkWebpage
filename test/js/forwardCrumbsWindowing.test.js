/**
 * The geometry behind the minimap's forward crumbs (#4669): which of the panos a street's sample points turned up
 * count as "ahead", which of those the user may step to, and where along the street the sampler looks.
 *
 * These are the pure statics ForwardCrumbs keeps off its instance for exactly this reason; the marker lifecycle and
 * the provider lookups around them need a map and a viewer and are covered by the manual GSV checklist. Real turf,
 * not a stub: the along-line and offset measurements are the thing being pinned.
 *
 * ForwardCrumbs is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into the
 * jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/navigation/ForwardCrumbs.js'), 'utf8');

window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.3.4.min.js'));
window.eval(`${SRC}; window.ForwardCrumbs = ForwardCrumbs;`);
const { ForwardCrumbs } = window;
const { turf } = window;

// A straight ~500 m street running east along one latitude, so "along" is unambiguous and offsets are northward.
const LAT = 47.6;
const START_LNG = -122.33;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const STREET = turf.lineString([[START_LNG, LAT], [lngAt(500), LAT]]);
const STREET_KM = turf.length(STREET);

/** A pano `alongM` metres down the street and `offsetM` metres north of it. */
const hit = (panoId, alongM, offsetM = 0) => ({ panoId, lat: LAT + offsetM / 111320, lng: lngAt(alongM) });

const WINDOW = { minAheadM: 5, maxOffsetM: 15, reachableCount: 3 };

describe('ForwardCrumbs.sampleOffsetsKm', () => {
    test('walks the street at the requested step and always ends at the street end', () => {
        const offsets = ForwardCrumbs.sampleOffsetsKm(0.1, 0.01, 100);
        expect(offsets[0]).toBe(0);
        expect(offsets.at(-1)).toBe(0.1);
        expect(offsets).toHaveLength(11);
        for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(0.01, 10);
    });

    test('widens the step rather than exceeding the sample cap on a long street', () => {
        const offsets = ForwardCrumbs.sampleOffsetsKm(5, 0.01, 100);
        expect(offsets.length).toBeLessThanOrEqual(101);
        expect(offsets[1] - offsets[0]).toBeCloseTo(0.05, 10);
        expect(offsets.at(-1)).toBe(5);
    });

    test('does not double up the end when the street length is a multiple of the step', () => {
        expect(ForwardCrumbs.sampleOffsetsKm(0.03, 0.01, 100)).toEqual([0, 0.01, 0.02, 0.03]);
    });

    test('a degenerate street still gets one sample at its start', () => {
        expect(ForwardCrumbs.sampleOffsetsKm(0, 0.01, 100)).toEqual([0]);
    });
});

describe('ForwardCrumbs.dedupByPanoId', () => {
    test('keeps the first hit per pano, in order', () => {
        const hits = [hit('A', 10), hit('B', 20), hit('A', 12), hit('C', 30), hit('B', 25)];
        expect(ForwardCrumbs.dedupByPanoId(hits).map((h) => h.panoId)).toEqual(['A', 'B', 'C']);
    });
});

describe('ForwardCrumbs.measureAgainstStreet', () => {
    test('reports how far along the street a pano projects and how far off the line it sits', () => {
        const measured = ForwardCrumbs.measureAgainstStreet(STREET, hit('A', 120, 8));
        expect(measured.panoId).toBe('A');
        expect(measured.alongKm * 1000).toBeCloseTo(120, 0);
        expect(measured.offsetM).toBeCloseTo(8, 0);
    });

    test('a pano on the line has (to within the geodesic math) no offset', () => {
        expect(ForwardCrumbs.measureAgainstStreet(STREET, hit('A', 250)).offsetM).toBeLessThan(0.1);
    });
});

describe('ForwardCrumbs.windowCandidates', () => {
    const measure = (hits) => hits.map((h) => ForwardCrumbs.measureAgainstStreet(STREET, h));

    test('splits the panos ahead into the nearest clickable few and the faint rest, nearest first', () => {
        const measured = measure([hit('D', 200), hit('B', 60), hit('A', 30), hit('E', 300), hit('C', 100)]);
        const { reachable, faint } = ForwardCrumbs.windowCandidates(measured, { fromKm: 0.02, ...WINDOW });
        expect(reachable.map((c) => c.panoId)).toEqual(['A', 'B', 'C']);
        expect(faint.map((c) => c.panoId)).toEqual(['D', 'E']);
    });

    test('drops panos at or behind the furthest point, and those within the standing-here cluster', () => {
        const measured = measure([hit('behind', 50), hit('here', 103), hit('ahead', 110)]);
        const { reachable, faint } = ForwardCrumbs.windowCandidates(measured, { fromKm: 0.1, ...WINDOW });
        expect(reachable.map((c) => c.panoId)).toEqual(['ahead']);
        expect(faint).toEqual([]);
    });

    test('drops panos too far off the line to be on this street', () => {
        const measured = measure([hit('alley', 150, 30), hit('kerb', 160, 4)]);
        const { reachable } = ForwardCrumbs.windowCandidates(measured, { fromKm: 0.1, ...WINDOW });
        expect(reachable.map((c) => c.panoId)).toEqual(['kerb']);
    });

    test('fewer panos than the clickable count leaves nothing faint', () => {
        const measured = measure([hit('A', 30), hit('B', 60)]);
        const { reachable, faint } = ForwardCrumbs.windowCandidates(measured, { fromKm: 0, ...WINDOW });
        expect(reachable).toHaveLength(2);
        expect(faint).toEqual([]);
    });

    test('nothing ahead on a finished street', () => {
        const measured = measure([hit('A', 30), hit('B', 60)]);
        const { reachable, faint } = ForwardCrumbs.windowCandidates(measured, { fromKm: STREET_KM, ...WINDOW });
        expect(reachable).toEqual([]);
        expect(faint).toEqual([]);
    });
});

describe('ForwardCrumbs.memoKeyFor', () => {
    const task = (walkOrder, reversed) => ({
        getStreetEdgeId: () => 42,
        getWalkOrder: () => walkOrder,
        getProperty: (key) => (key === 'startPointReversed' ? reversed : null),
    });

    test('separates the two passes of an out-and-back route and the two directions of a street', () => {
        expect(ForwardCrumbs.memoKeyFor(task(1, false))).toBe(ForwardCrumbs.memoKeyFor(task(1, false)));
        expect(ForwardCrumbs.memoKeyFor(task(1, false))).not.toBe(ForwardCrumbs.memoKeyFor(task(3, false)));
        expect(ForwardCrumbs.memoKeyFor(task(1, false))).not.toBe(ForwardCrumbs.memoKeyFor(task(1, true)));
    });
});
