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

const path = require('path');
const { loadModules, realUtil } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

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

/** The explore-page globals Task and TaskContainer read, with a minimap that only records what it is told. */
function exploreSvl() {
    return {
        CLOSE_TO_ROUTE_THRESHOLD: 0.05,
        streetCoverage: { ...COVERAGE_RULE },
        isExploreAddressMode: () => true,
        isOnboarding: () => false,
        minimap: { setStreetLines: jest.fn(), clearStreetLines: jest.fn() },
        form: { submitData: jest.fn() },
    };
}

describe('Task coverage in free exploration', () => {
    const street = straightStreet(STREET_START, STREET_LENGTH_M);

    beforeEach(() => {
        window.turf = turf;
        window.svl = exploreSvl();
        window.util ??= realUtil();
        loadModules('frontend/js/common/utilitiesMath.js');
        Object.assign(window, loadModules('frontend/js/explore/task/Task.js'));
    });

    it('credits a window around each pano and the walked stretch between neighbours', () => {
        const task = new window.Task(feature(street), false);

        expect(task.recordVisit(standingAt(street, 5))).toBe(true);
        expect(task.getCoveredRanges()).toEqual([[0, 15]]);
        task.recordVisit(standingAt(street, 40));
        // 5 -> 40 is a 35 m hop, so the stretch between counts and the two windows merge into one range.
        expect(task.getCoveredRanges()).toEqual([[0, 50]]);
        expect(task.getCoveredDistanceM()).toBe(50);
    });

    it('credits only the windows across a hop too long to have been walked', () => {
        const task = new window.Task(feature(street), false);

        task.recordVisit(standingAt(street, 20));
        task.recordVisit(standingAt(street, 100));
        expect(task.getCoveredRanges()).toEqual([[10, 30], [90, 110]]);
    });

    it('ignores a pano off the street and breaks the chain there', () => {
        const task = new window.Task(feature(street), false);

        task.recordVisit(standingAt(street, 20));
        expect(task.recordVisit(standingAt(street, 50, 40))).toBe(false);
        task.recordVisit(standingAt(street, 60));
        // Nothing for the detour, and no bridge from 20 to 60 across it.
        expect(task.getCoveredRanges()).toEqual([[10, 30], [50, 70]]);
    });

    it('measures from the server\'s start whichever way the street was turned', () => {
        const reversed = new window.Task(feature(street, { start_point_reversed: true }), false);

        reversed.recordVisit(standingAt(street, 180));
        expect(reversed.getCoveredRanges()).toEqual([[170, 190]]);
    });

    it('is covered enough once at most the cap is left, and never with nothing seen', () => {
        const task = new window.Task(feature(street), false);
        expect(task.isCoveredEnough()).toBe(false);

        // Either side of the 50 m cap on a 200 m street; the exact boundary is the server's call (StreetCoverageSpec).
        task.setCoveredRanges([[0, 149]]);
        expect(task.isCoveredEnough()).toBe(false);
        task.setCoveredRanges([[0, 151]]);
        expect(task.isCoveredEnough()).toBe(true);
    });

    it('holds a short street to the half-covered floor where the cap would pass it', () => {
        const short = new window.Task(feature(straightStreet(STREET_START, 60)), false);

        // One pano window at a corner of a 60 m street leaves 50 m, within the cap, but is only a sixth of it.
        short.setCoveredRanges([[0, 10]]);
        expect(short.isCoveredEnough()).toBe(false);
        short.setCoveredRanges([[0, 31]]);
        expect(short.isCoveredEnough()).toBe(true);
    });

    it('starts from the coverage the server stored for a resumed task', () => {
        const task = new window.Task(feature(street, { audit_task_id: 77, covered_ranges: [[0, 30]] }), false);

        expect(task.getCoveredRanges()).toEqual([[0, 30]]);
        task.recordVisit(standingAt(street, 35));
        expect(task.getCoveredRanges()).toEqual([[0, 45]]);
    });

    it('merges like the server: clipped, sorted, touching ranges joined, to a decimeter', () => {
        expect(window.Task.mergeRanges([[40, 60], [-5, 20.04], [20, 30], [55, 70], [190, 230]], 200))
            .toEqual([[0, 30], [40, 70], [190, 200]]);
    });

    it('draws covered stretches, and the whole street once it counts', () => {
        const task = new window.Task(feature(street), false);

        task.setCoveredRanges([[0, 30], [100, 120]]);
        task.render();
        let lines = window.svl.minimap.setStreetLines.mock.calls.at(-1)[1];
        expect(lines).toHaveLength(2);
        expect(lines.every((line) => line.kind === 'completed')).toBe(true);
        expect(turf.length(turf.lineString(lines[0].coordinates), { units: 'meters' })).toBeCloseTo(30, 0);

        task.setCoveredRanges([[0, 160]]);
        task.render();
        lines = window.svl.minimap.setStreetLines.mock.calls.at(-1)[1];
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
    let current;
    let cross;

    beforeEach(() => {
        window.turf = turf;
        window.svl = exploreSvl();
        window.util ??= realUtil();
        loadModules('frontend/js/common/utilitiesMath.js');
        Object.assign(window, loadModules('frontend/js/explore/task/Task.js', 'frontend/js/explore/task/TaskContainer.js'));
        tracker = { push: jest.fn(), setAuditTaskID: jest.fn() };
        container = new window.TaskContainer({}, window.svl, tracker);
        current = new window.Task(feature(street, { street_edge_id: 1 }), false);
        cross = new window.Task(feature(crossStreet, { street_edge_id: 2 }), false);
        container.setCurrentTask(current);
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
        expect(window.svl.form.submitData).not.toHaveBeenCalled();
    });

    it('posts the street being left and switches when the labeler is nearer another street', () => {
        loaded();
        container.recordExploreMove(standingAt(street, 190));
        container.recordExploreMove(standingAt(crossStreet, 30));

        expect(window.svl.form.submitData).toHaveBeenCalledWith(current);
        expect(container.getCurrentTask()).toBe(cross);
        expect(cross.getCoveredRanges()).toEqual([[20, 40]]);
        expect(tracker.push).toHaveBeenCalledWith('ExploreAddress_StreetSwitch', { from: 1, to: 2, resumed: false });
    });

    it('stays on the current street at a corner it shares with another', () => {
        loaded();
        // The corner itself is 0 m from both streets; only a strictly nearer street takes over.
        container.recordExploreMove({ lat: corner[1], lng: corner[0] });

        expect(container.getCurrentTask()).toBe(current);
        expect(window.svl.form.submitData).not.toHaveBeenCalled();
    });

    it('only credits the current street until the region\'s streets have loaded', () => {
        container.recordExploreMove(standingAt(crossStreet, 60));

        expect(container.getCurrentTask()).toBe(current);
        // 60 m up the cross street is 60 m from our street's line: off it, so nothing is credited either way.
        expect(current.getCoveredRanges()).toEqual([]);
        expect(cross.getCoveredRanges()).toEqual([]);
    });
});
