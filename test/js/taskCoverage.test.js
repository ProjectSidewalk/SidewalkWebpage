/**
 * Free exploration's street credit on the client (#5733).
 *
 * A free-exploration task keeps the stretches of its street the labeler's panos covered, and the server credits the
 * street from that list, so what the client builds has to match what the server expects: a window around every
 * on-street pano, the stretch between consecutive on-street panos when the hop is short, nothing for a pano off the
 * street, and the same merge the server does. The task container's part is walking: credit each pano to the street
 * it is on, and switch streets when the labeler has wandered onto another one.
 *
 * Real vendored turf for the geometry: the questions are about distances along real street lines.
 */

import { loadVendored, loadModules, realUtil, fakeImport } from './loadGlobalScript.js';

fakeImport('frontend/js/explore/task/Task.js', 'Task');

loadVendored('turf');
const turf = window.turf;

const STREET_START = [-77.02, 38.9];
const STREET_LENGTH_M = 200;
// What the server hands the page (StreetCoverage.asJson).
const COVERAGE_RULE = { max_uncovered_m: 50, min_covered_frac: 0.5, pano_window_m: 10, max_hop_m: 50 };

/** A straight street `lengthM` long heading due east from `start`, as [lng, lat] pairs. */
function straightStreet(start, lengthM) {
    return [start, turf.destination(turf.point(start), lengthM / 1000, 90).geometry.coordinates];
}

/** The lat/lng `alongM` from the street's start, offset `asideM` to its left. */
function standingAt(street, alongM, asideM = 0) {
    const bearing = turf.bearing(turf.point(street[0]), turf.point(street[1]));
    const along = turf.destination(turf.point(street[0]), alongM / 1000, bearing);
    const aside = turf.destination(along, asideM / 1000, bearing - 90).geometry.coordinates;
    return { lat: aside[1], lng: aside[0] };
}

/** A /tasks feature for a street. Coordinates are copied because Task.reverseCoordinates reverses in place. */
function feature(coordinates, properties = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordinates.map((coord) => [...coord]) },
        properties: {
            street_edge_id: 1,
            task_start: '2026-10-09T12:00:00Z',
            current_lng: coordinates[0][0],
            current_lat: coordinates[0][1],
            ...properties,
        },
    };
}

/** The free-exploration page facts Task and TaskContainer read. */
const CONFIG = { streetCoverage: { ...COVERAGE_RULE }, isExploreAddressMode: true, isOnboarding: false };

/** How free exploration draws a street that isn't the one being walked. */
const FREE_EXPLORATION = { exploreAddressMode: true, current: false, route: false };

describe('Task coverage in free exploration', () => {
    const street = straightStreet(STREET_START, STREET_LENGTH_M);

    /** A task on a street, with the coverage rule a free-exploration page carries. */
    const makeTask = (geojson) => new window.Task(geojson, CONFIG.streetCoverage, false);

    beforeEach(async () => {
        window.turf = turf;
        window.util ??= await realUtil();
        await loadModules('frontend/js/common/utilitiesMath.js');
        Object.assign(window, await loadModules('frontend/js/explore/task/Task.js'));
    });

    it('credits a window around each pano and the walked stretch between neighbours', () => {
        const task = makeTask(feature(street));

        expect(task.recordVisit(standingAt(street, 5))).toBe(true);
        expect(task.getCoveredRanges()).toEqual([[0, 15]]);
        task.recordVisit(standingAt(street, 40));
        // 5 -> 40 is a 35 m hop, so the stretch between counts and the two windows merge into one range.
        expect(task.getCoveredRanges()).toEqual([[0, 50]]);
        expect(task.getCoveredDistanceM()).toBe(50);
    });

    it('credits only the windows across a hop too long to have been walked', () => {
        const task = makeTask(feature(street));

        task.recordVisit(standingAt(street, 20));
        task.recordVisit(standingAt(street, 100));
        expect(task.getCoveredRanges()).toEqual([[10, 30], [90, 110]]);
    });

    it('ignores a pano off the street and breaks the chain there', () => {
        const task = makeTask(feature(street));

        task.recordVisit(standingAt(street, 20));
        expect(task.recordVisit(standingAt(street, 50, 40))).toBe(false);
        task.recordVisit(standingAt(street, 60));
        // Nothing for the detour, and no bridge from 20 to 60 across it.
        expect(task.getCoveredRanges()).toEqual([[10, 30], [50, 70]]);
    });

    it('measures from the server\'s start whichever way the street was turned', () => {
        const reversed = makeTask(feature(street, { start_point_reversed: true }));

        reversed.recordVisit(standingAt(street, 180));
        expect(reversed.getCoveredRanges()).toEqual([[170, 190]]);
    });

    it('clips a stored range that the server measured a little past the street', () => {
        // The server's geodesic length and turf's differ by decimeters; a reversed street turns the overshoot into a
        // negative slice start, which must never reach the minimap.
        const lengthM = turf.length(turf.lineString(street), { units: 'meters' });
        const reversed = makeTask(
            feature(street, { start_point_reversed: true, covered_ranges: [[150, lengthM + 0.4]] }),
        );

        expect(reversed.getCoveredRanges()[0][1]).toBeCloseTo(lengthM, 1);
        expect(() => reversed.minimapLines(FREE_EXPLORATION)).not.toThrow();
    });

    it('never rounds a stored range past a street whose length rounds up', () => {
        // 100.07 m rounds to 100.1 m; on a reversed street that would put a slice start below zero and crash turf.
        const oddStreet = straightStreet(STREET_START, 100.07);
        const lengthM = turf.length(turf.lineString(oddStreet), { units: 'meters' });
        const reversed = makeTask(
            feature(oddStreet, { start_point_reversed: true, covered_ranges: [[50, lengthM]] }),
        );

        expect(reversed.getCoveredRanges()[0][1]).toBeLessThanOrEqual(lengthM);
        expect(() => reversed.minimapLines(FREE_EXPLORATION)).not.toThrow();
    });

    it('drops a malformed stored pair instead of failing the whole street', () => {
        const task = makeTask(feature(street, { covered_ranges: [[10, 30], null, [50], ['a', 'b']] }));

        expect(task.getCoveredRanges()).toEqual([[10, 30]]);
    });

    it('starts a fresh chain after the labeler left for another street', () => {
        const task = makeTask(feature(street));

        task.recordVisit(standingAt(street, 20));
        task.resetVisitChain();
        task.recordVisit(standingAt(street, 60));
        // The 40 m between was spent on another street, so only the two windows count.
        expect(task.getCoveredRanges()).toEqual([[10, 30], [50, 70]]);
    });

    it('is covered enough once at most the cap is left, and never with nothing seen', () => {
        const task = makeTask(feature(street));
        expect(task.isCoveredEnough()).toBe(false);

        // Either side of the 50 m cap on a 200 m street; the exact boundary is the server's call (StreetCoverageSpec).
        task.setCoveredRanges([[0, 149]]);
        expect(task.isCoveredEnough()).toBe(false);
        task.setCoveredRanges([[0, 151]]);
        expect(task.isCoveredEnough()).toBe(true);
    });

    it('holds a short street to the half-covered floor where the cap would pass it', () => {
        const short = makeTask(feature(straightStreet(STREET_START, 60)));

        // One pano window at a corner of a 60 m street leaves 50 m, within the cap, but is only a sixth of it.
        short.setCoveredRanges([[0, 10]]);
        expect(short.isCoveredEnough()).toBe(false);
        short.setCoveredRanges([[0, 31]]);
        expect(short.isCoveredEnough()).toBe(true);
    });

    it('starts from the coverage the server stored for a resumed task', () => {
        const task = makeTask(feature(street, { audit_task_id: 77, covered_ranges: [[0, 30]] }));

        expect(task.getCoveredRanges()).toEqual([[0, 30]]);
        task.recordVisit(standingAt(street, 35));
        expect(task.getCoveredRanges()).toEqual([[0, 45]]);
    });

    it('merges like the server: clipped, sorted, touching ranges joined, to a decimeter', () => {
        expect(window.Task.mergeRanges([[40, 60], [-5, 20.04], [20, 30], [55, 70], [190, 230]], 200))
            .toEqual([[0, 30], [40, 70], [190, 200]]);
    });

    it('draws covered stretches, and the whole street once it counts', () => {
        const task = makeTask(feature(street));

        task.setCoveredRanges([[0, 30], [100, 120]]);
        let lines = task.minimapLines(FREE_EXPLORATION);
        expect(lines).toHaveLength(2);
        expect(lines.every((line) => line.kind === 'completed')).toBe(true);
        expect(turf.length(turf.lineString(lines[0].coordinates), { units: 'meters' })).toBeCloseTo(30, 0);

        task.setCoveredRanges([[0, 160]]);
        lines = task.minimapLines(FREE_EXPLORATION);
        expect(lines).toHaveLength(1);
        expect(lines[0].coordinates).toEqual(street);
    });
});

describe('TaskContainer walking streets in free exploration', () => {
    const street = straightStreet(STREET_START, STREET_LENGTH_M);
    // A cross street leaving our street's far end, heading north.
    const corner = street[1];
    const crossStreet = [corner, turf.destination(turf.point(corner), 0.2, 0).geometry.coordinates];

    let container;
    let tracker;
    let left;
    let current;
    let cross;

    beforeEach(async () => {
        window.turf = turf;
        window.util ??= await realUtil();
        await loadModules('frontend/js/common/utilitiesMath.js');
        Object.assign(
            window, await loadModules('frontend/js/explore/task/Task.js', 'frontend/js/explore/task/TaskContainer.js')
        );
        tracker = { push: vi.fn(), setAuditTaskID: vi.fn() };
        current = new window.Task(feature(street, { street_edge_id: 1 }), CONFIG.streetCoverage, false);
        cross = new window.Task(feature(crossStreet, { street_edge_id: 2 }), CONFIG.streetCoverage, false);
        container = new window.TaskContainer(current, CONFIG, { isRoute: false },
            { setStreetLines: vi.fn() }, {}, {}, tracker);
        // What the Form hears, as it would in production: the street being left, to post as it stands.
        left = vi.fn();
        container.onTaskLeft(left);
        container._tasks.push(cross);
    });

    /** What the move handler does once the region's streets are known. */
    function loaded() {
        container.tasksLoaded = () => true;
    }

    it('credits the pano to the current street while that is the one being walked', () => {
        loaded();
        container.recordExploreMove(standingAt(street, 50));

        expect(container.getCurrentTask()).toBe(current);
        expect(current.getCoveredRanges()).toEqual([[40, 60]]);
        expect(left).not.toHaveBeenCalled();
    });

    it('posts the street being left and switches when the labeler is nearer another street', () => {
        loaded();
        container.recordExploreMove(standingAt(street, 190));
        container.recordExploreMove(standingAt(crossStreet, 30));

        expect(left).toHaveBeenCalledWith(current);
        expect(container.getCurrentTask()).toBe(cross);
        expect(cross.getCoveredRanges()).toEqual([[20, 40]]);
        expect(tracker.push).toHaveBeenCalledWith('ExploreAddress_StreetSwitch', { from: 1, to: 2, resumed: false });
    });

    it('dates a street from the step onto it, not from an old regular audit the task list carried', () => {
        loaded();
        const oldStart = new Date('2019-01-01T00:00:00Z');
        cross.setProperty('taskStart', oldStart);
        cross.setProperty('auditTaskId', 42);
        container.recordExploreMove(standingAt(street, 190));
        container.recordExploreMove(standingAt(crossStreet, 30));

        expect(cross.getProperty('taskStart').getTime()).toBeGreaterThan(oldStart.getTime());
    });

    it('does not bridge the stretch of a street skipped while on another one', () => {
        loaded();
        container._tasks.push(current);
        container.recordExploreMove(standingAt(street, 190));
        container.recordExploreMove(standingAt(crossStreet, 30));
        container.recordExploreMove(standingAt(street, 150));

        expect(container.getCurrentTask()).toBe(current);
        expect(current.getCoveredRanges()).toEqual([[140, 160], [180, 200]]);
    });

    it('stays on the current street at a corner it shares with another', () => {
        loaded();
        // The corner itself is 0 m from both streets; only a strictly nearer street takes over.
        container.recordExploreMove({ lat: corner[1], lng: corner[0] });

        expect(container.getCurrentTask()).toBe(current);
        expect(left).not.toHaveBeenCalled();
    });

    it('only credits the current street until the region\'s streets have loaded', () => {
        container.recordExploreMove(standingAt(crossStreet, 60));

        expect(container.getCurrentTask()).toBe(current);
        // 60 m up the cross street is 60 m from our street's line: off it, so nothing is credited either way.
        expect(current.getCoveredRanges()).toEqual([]);
        expect(cross.getCoveredRanges()).toEqual([]);
    });
});
