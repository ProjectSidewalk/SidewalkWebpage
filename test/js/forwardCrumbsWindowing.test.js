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

window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));
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

describe('ForwardCrumbs.aheadOnStreet', () => {
    const measure = (hits) => hits.map((h) => ForwardCrumbs.measureAgainstStreet(STREET, h));
    const opts = { minAheadM: 5, maxOffsetM: 15 };

    test('orders the panos ahead nearest first', () => {
        const measured = measure([hit('D', 200), hit('B', 60), hit('A', 30), hit('E', 300), hit('C', 100)]);
        expect(ForwardCrumbs.aheadOnStreet(measured, { fromKm: 0.02, ...opts }).map((c) => c.panoId))
            .toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    test('drops panos at or behind the furthest point, and those within the standing-here cluster', () => {
        const measured = measure([hit('behind', 50), hit('here', 103), hit('ahead', 110)]);
        expect(ForwardCrumbs.aheadOnStreet(measured, { fromKm: 0.1, ...opts }).map((c) => c.panoId)).toEqual(['ahead']);
    });

    test('drops panos too far off the line to be on this street', () => {
        const measured = measure([hit('alley', 150, 30), hit('kerb', 160, 4)]);
        expect(ForwardCrumbs.aheadOnStreet(measured, { fromKm: 0.1, ...opts }).map((c) => c.panoId)).toEqual(['kerb']);
    });

    test('nothing ahead on a finished street', () => {
        const measured = measure([hit('A', 30), hit('B', 60)]);
        expect(ForwardCrumbs.aheadOnStreet(measured, { fromKm: STREET_KM, ...opts })).toEqual([]);
    });
});

describe('ForwardCrumbs.mergeSources', () => {
    const stop = (panoId, alongM) => ({ ...hit(panoId, alongM), alongKm: alongM / 1000, offsetM: 0 });
    const link = (panoId, heading, alongM = 0, offsetM = 0) => ({ ...hit(panoId, alongM, offsetM), heading });
    const opts = { currentPanoId: 'here', isVisited: (id) => id === 'seen', reachableCount: 3 };

    test('route stops come first with the nearest few clickable, then the other arrows, all clickable', () => {
        const crumbs = ForwardCrumbs.mergeSources(
            [stop('A', 30), stop('B', 60), stop('C', 100), stop('D', 200)],
            [link('east', 90, 10, 20), link('west', 270, -10, 20)], opts,
        );
        expect(crumbs.map((c) => [c.panoId, c.kind, c.clickable, c.rank])).toEqual([
            ['A', 'route', true, 1], ['B', 'route', true, 2], ['C', 'route', true, 3], ['D', 'route', false, 4],
            ['east', 'link', true, 0], ['west', 'link', true, 0],
        ]);
    });

    test('a route stop wins over a link to the same pano, and the current pano is left out', () => {
        const crumbs = ForwardCrumbs.mergeSources(
            [stop('A', 30), stop('here', 40)],
            [link('A', 45), link('here', 0), link('side', 90)], opts,
        );
        expect(crumbs.map((c) => [c.panoId, c.kind])).toEqual([['A', 'route'], ['side', 'link']]);
    });

    test('a visited pano stays a crumb, flagged, so the way forward can still be marked after a backtrack', () => {
        const crumbs = ForwardCrumbs.mergeSources([stop('seen', 30), stop('B', 60)], [link('seen', 45)], opts);
        expect(crumbs.map((c) => [c.panoId, c.kind, c.visited])).toEqual([['seen', 'route', true], ['B', 'route', false]]);
    });
});

describe('ForwardCrumbs.closestLinkIndex', () => {
    const links = [{ panoId: 'n', heading: 0 }, { panoId: 'e', heading: 90 }, { panoId: 'sw', heading: 225 }];

    test('picks the link nearest the heading within the threshold, across the 0/360 seam', () => {
        expect(ForwardCrumbs.closestLinkIndex(links, 80)).toBe(1);
        expect(ForwardCrumbs.closestLinkIndex(links, 350)).toBe(0);
        expect(ForwardCrumbs.closestLinkIndex(links, 200)).toBe(2);
    });

    test('answers -1 when nothing lies within the threshold', () => {
        expect(ForwardCrumbs.closestLinkIndex(links, 160)).toBe(-1);
        expect(ForwardCrumbs.closestLinkIndex([], 0)).toBe(-1);
        expect(ForwardCrumbs.closestLinkIndex(links, 160, 70)).toBe(2);
    });
});

describe('ForwardCrumbs.stepLinkIndex', () => {
    const links = [{ panoId: 'n', heading: 0 }, { panoId: 'e', heading: 90 }];

    test("picks the link a step takes, by moveToLinkedPano's cosine rule (within 60°)", () => {
        expect(ForwardCrumbs.stepLinkIndex(links, 30)).toBe(0);
        expect(ForwardCrumbs.stepLinkIndex(links, 50)).toBe(1);
        expect(ForwardCrumbs.stepLinkIndex(links, 149)).toBe(1);
        expect(ForwardCrumbs.stepLinkIndex(links, 151)).toBe(-1);
        expect(ForwardCrumbs.stepLinkIndex([], 0)).toBe(-1);
    });
});

describe('ForwardCrumbs.facedPanoId', () => {
    const links = [{ panoId: 'e', heading: 90 }, { panoId: 'w', heading: 270 }];
    const route = (deg) => () => deg;

    test('the link a step toward the facing takes is where forward goes, by the up key\'s 60° rule', () => {
        expect(ForwardCrumbs.facedPanoId(links, 100, 'next', route(45))).toBe('e');
        expect(ForwardCrumbs.facedPanoId(links, 140, 'next', route(45))).toBe('e');
        expect(ForwardCrumbs.facedPanoId(links, 260, 'next', route(45))).toBe('w');
    });

    test('at a link-graph dead-end, facing the route fills its next stop (the synthesized forward arrow)', () => {
        expect(ForwardCrumbs.facedPanoId(links, 10, 'next', route(0))).toBe('next');
        expect(ForwardCrumbs.facedPanoId(links, 180, 'next', route(0))).toBeNull();
    });

    test('when a link already serves the route, facing the route without facing that link fills nothing', () => {
        // The route heads 60°: the east link (90°) is its arrow, so no synthesized arrow exists at 20°.
        expect(ForwardCrumbs.facedPanoId(links, 20, 'next', route(60))).toBeNull();
    });

    test('the route heading is only computed when no link is faced', () => {
        const routeHeading = jest.fn(() => 0);
        expect(ForwardCrumbs.facedPanoId(links, 100, 'next', routeHeading)).toBe('e');
        expect(routeHeading).not.toHaveBeenCalled();
        expect(ForwardCrumbs.facedPanoId(links, 10, 'next', routeHeading)).toBe('next');
        expect(routeHeading).toHaveBeenCalledTimes(1);
    });

    test('nothing to fill off route or with no route', () => {
        expect(ForwardCrumbs.facedPanoId(links, 0, null, route(0))).toBeNull();
        expect(ForwardCrumbs.facedPanoId(links, 0, 'next', route(null))).toBeNull();
        expect(ForwardCrumbs.facedPanoId([], 0, null, route(null))).toBeNull();
    });
});

describe('ForwardCrumbs.walkLandingStop', () => {
    const measured = [hit('a', 80), hit('b', 110), hit('c', 130), hit('alley', 110, 30)]
        .map((h) => ForwardCrumbs.measureAgainstStreet(STREET, h));
    const opts = { minAheadM: 5, maxOffsetM: 15, searchRadiusM: 25 };

    test('near the furthest point, the walk lands on the first stop ahead of it', () => {
        expect(ForwardCrumbs.walkLandingStop(measured, 0.1, 10, opts).panoId).toBe('b');
    });

    test('off the street, the walk searches at the furthest point, so the stop nearest it', () => {
        expect(ForwardCrumbs.walkLandingStop(measured, 0.1, 40, opts).panoId).toBe('b');
        expect(ForwardCrumbs.walkLandingStop(measured, 0.085, 40, opts).panoId).toBe('a');
    });

    test('a pano off the street line never counts, and an empty street yields null', () => {
        expect(ForwardCrumbs.walkLandingStop(measured, 0.11, 40, opts).panoId).not.toBe('alley');
        expect(ForwardCrumbs.walkLandingStop([], 0.1, 10, opts)).toBeNull();
    });
});

describe('ForwardCrumbs.nextStepPanoId', () => {
    const links = [{ panoId: 'e', heading: 90 }, { panoId: 'w', heading: 270 }];

    test('the link within 60° of the route direction is where the spacebar steps', () => {
        expect(ForwardCrumbs.nextStepPanoId(links, 60, 'next')).toBe('e');
        expect(ForwardCrumbs.nextStepPanoId(links, 300, 'next')).toBe('w');
    });

    test('with no link the route\'s way, the route walk\'s next stop is the step', () => {
        expect(ForwardCrumbs.nextStepPanoId(links, 0, 'next')).toBe('next');
        expect(ForwardCrumbs.nextStepPanoId(links, 151, 'next')).toBe('next');
        expect(ForwardCrumbs.nextStepPanoId([], 0, 'next')).toBe('next');
    });

    test('the 60° cut-off matches moveToLinkedPano (cosine above one half)', () => {
        expect(ForwardCrumbs.nextStepPanoId(links, 151, null)).toBeNull();
        expect(ForwardCrumbs.nextStepPanoId(links, 149, null)).toBe('e');
    });

    test('nothing with no route', () => {
        expect(ForwardCrumbs.nextStepPanoId(links, null, 'next')).toBeNull();
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
