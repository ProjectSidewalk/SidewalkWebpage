/**
 * Picking a street up where an earlier session left it, rather than starting it over (#5370).
 *
 * The server now hands back an open `audit_task` row for a street the labeler walked partway, and everything on the
 * client that would restart such a street has to recognize it: its direction is already fixed by the row, its
 * `task_start` bounds the no-imagery report window (#4922), its walked metres are already inside the server's
 * mission progress, and the labeler will land mid-street rather than at either endpoint. Each of those is one
 * `isResumed()` guard, and each guard is a place where over-reaching would break a fresh street instead — so the
 * fresh-street behavior is pinned beside every one of them.
 *
 * Real vendored turf and the real `util.math.haversine` for the geometry cases: the questions are about distance
 * along real street geometry, and a stub that got it slightly wrong would pass for the wrong reason.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const TASK_SRC = readSrc('public/js/explore/src/task/Task.js');
const TASK_CONTAINER_SRC = readSrc('public/js/explore/src/task/TaskContainer.js');
const UTIL_MATH_SRC = readSrc('public/js/common/utilitiesMath.js');
// Loaded once, up front: the fixtures below are built while the suite is collected, before any beforeEach runs.
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

const STREET_START = [-77.02, 38.9];
const STREET_LENGTH_M = 200;
const WALKED_M = 71;

/** A straight street `lengthM` long heading due east from `start`, as [lng, lat] pairs. */
function straightStreet(start, lengthM) {
    return [start, turf.destination(turf.point(start), lengthM / 1000, 90).geometry.coordinates];
}

/** The point `alongM` from `from` in the direction of `towards`. */
function pointAlong(from, towards, alongM) {
    const bearing = turf.bearing(turf.point(from), turf.point(towards));
    return turf.destination(turf.point(from), alongM / 1000, bearing).geometry.coordinates;
}

/**
 * A /tasks feature for a street, with whatever audit state a case needs on it.
 *
 * The coordinates are copied because `Task.reverseCoordinates` reverses the array in place — a shared one would let
 * one case's reversal rewrite the street every later case measures against.
 */
function feature(coordinates, properties = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordinates.map((coord) => [...coord]) },
        properties: {
            street_edge_id: 1,
            task_start: '2026-09-16T12:00:00Z',
            current_lng: coordinates[0][0],
            current_lat: coordinates[0][1],
            ...properties,
        },
    };
}

describe('Task resumed from an earlier session', () => {
    const street = straightStreet(STREET_START, STREET_LENGTH_M);
    // The row says the labeler started from the far end, so the walked stretch is measured back from there.
    const stopped = pointAlong(street[1], street[0], WALKED_M);

    /** The street as the server hands it back after a part-walked session. */
    const openTaskFeature = () => feature(street, {
        audit_task_id: 9385,
        completed: false,
        start_point_reversed: true,
        current_lng: stopped[0],
        current_lat: stopped[1],
    });

    /** What TaskContainer.fetchTasks passes for an open task: the saved position, or nothing for a fresh street. */
    const resumeAt = (props) => (props.audit_task_id && !props.completed
        ? { lat: props.current_lat, lng: props.current_lng }
        : undefined);

    const makeTask = (geojson) => new window.Task(geojson, false, resumeAt(geojson.properties));

    beforeEach(() => {
        window.turf = turf;
        window.svl = { CLOSE_TO_ROUTE_THRESHOLD: 0.05 };
        window.eval(UTIL_MATH_SRC);
        window.eval(`${TASK_SRC}; window.Task = Task;`);
    });

    it('starts where the labeler stopped, at the end the row says they started from', () => {
        const task = makeTask(openTaskFeature());

        expect(task.isResumed()).toBe(true);
        // Reversed first, then the saved position: reversing re-seeds the furthest point, so the other order loses it.
        expect(task.getStartCoordinate()).toEqual({ lat: street[1][1], lng: street[1][0] });
        expect(task.getFurthestPointReached().geometry.coordinates).toEqual(stopped);
        expect(task.getAuditedDistance({ units: 'meters' })).toBeCloseTo(WALKED_M, 1);
    });

    it('treats a finished street and an untouched one as nothing to resume', () => {
        const finished = makeTask(feature(street, { audit_task_id: 9385, completed: true }));
        const untouched = makeTask(feature(street, { completed: false }));

        expect(finished.isResumed()).toBe(false);
        expect(untouched.isResumed()).toBe(false);
        // An untouched street's furthest point is its own start, so none of it reads as walked.
        expect(untouched.getFurthestPointReached().geometry.coordinates).toEqual(street[0]);
        expect(untouched.getAuditedDistance({ units: 'meters' })).toBeCloseTo(0, 3);
    });

    it('hands over its pre-walked distance exactly once', () => {
        // setCurrentTask is not the only caller of the paths that lead here — nextTask is also called speculatively,
        // just to ask whether a next street exists — so a second claim has to be worth nothing.
        const task = makeTask(openTaskFeature());

        expect(task.claimSavedProgress()).toBeCloseTo(WALKED_M / 1000, 4);
        expect(task.claimSavedProgress()).toBe(0);
    });

    describe('isConnectedTo a part-walked street', () => {
        // A street sharing the junction our finished street ends at, walked 70 m in from it.
        const junction = street[1];
        const onward = straightStreet(junction, STREET_LENGTH_M);
        const JUMP_THRESHOLD_KM = 0.025;

        const finishedTask = () => makeTask(feature(street, {}));
        const onwardTask = (properties) => makeTask(feature(onward, properties));

        it('is not connected, because the labeler lands 70 m down it, not at the junction', () => {
            const walkedIn = pointAlong(onward[0], onward[1], 70);
            const target = onwardTask({
                audit_task_id: 9386, completed: false, current_lng: walkedIn[0], current_lat: walkedIn[1],
            });

            expect(finishedTask().isConnectedTo(target, JUMP_THRESHOLD_KM, { units: 'kilometers' })).toBe(false);
        });

        it('is connected when the same street is fresh, so today\'s silent switch is unchanged', () => {
            expect(finishedTask().isConnectedTo(onwardTask({}), JUMP_THRESHOLD_KM, { units: 'kilometers' }))
                .toBe(true);
        });
    });
});

describe('TaskContainer handing out a part-walked street', () => {
    let container;
    let tracker;

    /** A candidate street for the non-route next-task pick, in whichever state a case needs. */
    const makeTask = ({ resumed = false, auditTaskId = null, prewalkedKm = 0 } = {}) => ({
        getWalkOrder: () => null,
        getStreetEdgeId: () => 101,
        getStreetPriority: () => 1,
        getStreetPriorityDiscretized: () => 3,
        getGeoJSON: () => ({ type: 'Feature' }),
        getStartCoordinate: () => ({ lat: 38.9, lng: -77.02 }),
        getEndCoordinate: () => ({ lat: 38.9, lng: -77.01 }),
        getFurthestPointReached: () => ({ type: 'Point' }),
        getAuditTaskId: () => auditTaskId,
        getAuditedDistance: () => prewalkedKm,
        isComplete: () => false,
        isConnectedTo: () => false,
        wasGivenUpOnImagery: () => false,
        isResumed: () => resumed,
        claimSavedProgress: jest.fn()
            .mockImplementationOnce(() => prewalkedKm)
            .mockImplementation(() => 0),
        setStreetEdgeDirection: jest.fn(),
        reverseStreetDirection: jest.fn(),
        setProperty: jest.fn(),
        render: jest.fn(),
    });

    /** A just-finished street to hand nextTask, standing where the next one begins. */
    const finishedTask = () => ({
        ...makeTask(),
        getStreetEdgeId: () => 100,
    });

    beforeEach(() => {
        // Only the two turf calls nextTask itself makes; the geometry questions are covered above against real turf.
        window.turf = { point: (coords) => ({ type: 'Point', coordinates: coords }), pointToLineDistance: () => 0 };
        window.util = { math: { kmsToMeters: (km) => km * 1000 } };
        tracker = { push: jest.fn(), setAuditTaskID: jest.fn() };
        window.eval(`${TASK_CONTAINER_SRC}; window.TaskContainer = TaskContainer;`);
        const regionModel = { isRoute: false };
        const svl = { regionModel, CONNECTED_TASK_THRESHOLD: 0.025, CLOSE_TO_ROUTE_THRESHOLD: 0.05 };
        container = new window.TaskContainer(regionModel, svl, tracker);
    });

    describe('nextTask', () => {
        it('leaves a part-walked street\'s direction and task_start alone', () => {
            const resumed = makeTask({ resumed: true, auditTaskId: 9385 });
            container._tasks = [resumed];

            expect(container.nextTask(finishedTask())).toBe(resumed);
            expect(resumed.setStreetEdgeDirection).not.toHaveBeenCalled();
            expect(resumed.reverseStreetDirection).not.toHaveBeenCalled();
            expect(resumed.setProperty).not.toHaveBeenCalledWith('taskStart', expect.anything());
        });

        it('still points a fresh street at the labeler and stamps its start', () => {
            const fresh = makeTask();
            container._tasks = [fresh];

            expect(container.nextTask(finishedTask())).toBe(fresh);
            expect(fresh.setStreetEdgeDirection).toHaveBeenCalled();
            expect(fresh.setProperty).toHaveBeenCalledWith('taskStart', expect.any(Date));
        });
    });

    describe('setCurrentTask', () => {
        let offset;
        let missionContainer;

        beforeEach(() => {
            offset = 500;
            missionContainer = {
                getCurrentMission: () => ({ getProperty: () => 7 }),
                getTasksMissionsOffset: () => offset,
                setTasksMissionsOffset: jest.fn((value) => { offset = value; }),
            };
        });

        /** setCurrentTask reads svl off the container, so the mission container has to be there before the call. */
        const withMissionContainer = () => {
            const regionModel = { isRoute: false };
            const svl = { regionModel, missionContainer, CONNECTED_TASK_THRESHOLD: 0.025 };
            return new window.TaskContainer(regionModel, svl, tracker);
        };

        it('takes the pre-walked metres back out of the mission offset, once', () => {
            // Those metres are already in the server's mission progress, which the page load folded into the offset;
            // counting them again would jump the mission bar the moment the labeler switches streets.
            const resumed = makeTask({ resumed: true, auditTaskId: 9385, prewalkedKm: 0.071 });
            const tasks = withMissionContainer();

            tasks.setCurrentTask(resumed);
            expect(offset).toBeCloseTo(429, 6);

            tasks.setCurrentTask(resumed);
            expect(offset).toBeCloseTo(429, 6);
        });

        it('leaves the offset alone for a fresh street', () => {
            withMissionContainer().setCurrentTask(makeTask());

            expect(missionContainer.setTasksMissionsOffset).not.toHaveBeenCalled();
        });

        it('moves the interaction log onto the resumed task and says the street was resumed', () => {
            withMissionContainer().setCurrentTask(makeTask({ resumed: true, auditTaskId: 9385 }));

            expect(tracker.setAuditTaskID).toHaveBeenCalledWith(9385);
            expect(tracker.push).toHaveBeenCalledWith('TaskStart', { resumed: true, auditTaskId: 9385 });
        });

        it('logs a fresh street with no note, as before', () => {
            withMissionContainer().setCurrentTask(makeTask());

            expect(tracker.push).toHaveBeenCalledWith('TaskStart', undefined);
        });
    });
});

describe('TaskContainer.fetchTasks', () => {
    const openStreet = straightStreet(STREET_START, STREET_LENGTH_M);
    const freshStreet = straightStreet([-77.05, 38.95], STREET_LENGTH_M);
    const stopped = pointAlong(openStreet[0], openStreet[1], WALKED_M);

    let container;

    beforeEach(() => {
        window.turf = turf;
        window.svl = { CLOSE_TO_ROUTE_THRESHOLD: 0.05 };
        window.eval(UTIL_MATH_SRC);
        // One eval so TaskContainer's `new Task(...)` resolves to the class evaluated beside it.
        window.eval(`${TASK_SRC}\n${TASK_CONTAINER_SRC}; window.TaskContainer = TaskContainer;`);

        window.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                features: [
                    feature(openStreet, {
                        street_edge_id: 1,
                        audit_task_id: 9385,
                        completed: false,
                        current_lng: stopped[0],
                        current_lat: stopped[1],
                    }),
                    feature(freshStreet, { street_edge_id: 2, completed: false }),
                ],
            }),
        }));

        const regionModel = { isRoute: false, currentRegion: () => ({ getRegionId: () => 5 }) };
        const missionContainer = {
            getCurrentMission: () => ({ getProperty: () => 7, pushATaskToTheRoute: jest.fn() }),
        };
        container = new window.TaskContainer(regionModel, { regionModel, missionContainer }, { push: jest.fn() });
    });

    it('seeds an open task at its saved position and a fresh one at its own start', async () => {
        await container.fetchTasks();

        const [open, fresh] = container.getTasks();
        expect(open.isResumed()).toBe(true);
        expect(open.getFurthestPointReached().geometry.coordinates).toEqual(stopped);
        expect(open.getAuditedDistance({ units: 'meters' })).toBeCloseTo(WALKED_M, 1);

        // current_lat/lng comes back for every street; on a fresh one it is only the street's start point, so
        // nothing about it should read as walked.
        expect(fresh.isResumed()).toBe(false);
        expect(fresh.getFurthestPointReached().geometry.coordinates).toEqual(freshStreet[0]);
    });
});
