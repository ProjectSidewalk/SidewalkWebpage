/**
 * A street too short to walk is completed on arrival when all of it is already in view (#3682).
 *
 * The end-of-street check runs only after a move, and on a short street Task.isAtEnd shrinks its radius to a fraction
 * of the length, so a labeler placed at the end of a street under the 25 m completion radius — on page load, or by a
 * seamless switch at a junction — could never finish it and was left pressing Stuck. The narrow rule under test: at
 * those two spawn points only, a street of at most 20 m whose every vertex is within the pano search radius is ended
 * through the normal end-of-street path, and a run of such streets is bounded.
 *
 * NavigationService is a top-level `class` declaration for the Grunt-concatenation world, so the source is eval'd
 * into the jsdom global scope. Real vendored turf: "in view" is a distance question on real geometry.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NAVIGATION_SERVICE_SRC = fs.readFileSync(
    path.join(REPO_ROOT, 'public/js/explore/src/navigation/NavigationService.js'), 'utf8',
);
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

const HERE = [-122.33, 47.6];

/** The point `eastM` east of HERE, as [lng, lat]. */
const east = (eastM) => turf.destination(turf.point(HERE), eastM / 1000, 90).geometry.coordinates;

/**
 * A street from `fromM` to `toM` east of where the labeler stands.
 * @param {number} streetEdgeId
 * @param {number} fromM
 * @param {number} toM
 */
function makeTask(streetEdgeId, fromM, toM) {
    const feature = turf.lineString([east(fromM), east(toM)]);
    return {
        complete: false,
        getStreetEdgeId: () => streetEdgeId,
        getFeature: () => feature,
        lineDistance: ({ units }) => turf.length(feature, { units }),
        isComplete() {
            return this.complete;
        },
        wasGivenUpOnImagery: () => false,
        // Streets in a fixture run are chained end to end, so each is connected to the next.
        isConnectedTo: jest.fn(() => true),
    };
}

describe('Tiny-street auto-completion at a spawn point (#3682)', () => {
    let svl;
    let nav;
    let mission;
    let queue;

    const autoCompletions = () => svl.tracker.push.mock.calls.filter(([name]) => name === 'TaskAutoComplete_TinyStreet');

    /** The labeler stands on the first street; nextTask hands out the rest in order. */
    function place(...tasks) {
        queue = [...tasks];
        svl.taskContainer.getCurrentTask.mockReturnValue(queue[0]);
    }

    beforeEach(() => {
        window.turf = turf;
        mission = { pushATaskToTheRoute: jest.fn() };
        svl = {
            STREETVIEW_MAX_DISTANCE: 25,
            CONNECTED_TASK_THRESHOLD: 0.025,
            isOnboarding: () => false,
            isExploreAddressMode: () => false,
            tracker: { push: jest.fn() },
            compass: { showLabelBeforeJumpMessage: jest.fn() },
            missionContainer: { getCurrentMission: () => mission },
            panoViewer: {
                getPosition: () => ({ lat: HERE[1], lng: HERE[0] }),
                clearPrefetchCache: jest.fn(),
                prefetchLocation: jest.fn(),
            },
            regionModel: { isRoute: false, isRouteOrRegionComplete: () => false, setComplete: jest.fn() },
            missionController: { onRouteReadyToFinish: jest.fn() },
            taskContainer: {
                tasksLoaded: () => true,
                getCurrentTask: jest.fn(),
                nextTask: jest.fn((finished) => queue[queue.indexOf(finished) + 1] ?? null),
                endTask: jest.fn((task) => {
                    task.complete = true;
                }),
                setCurrentTask: jest.fn((task) => svl.taskContainer.getCurrentTask.mockReturnValue(task)),
                setNextTaskAfterJump: jest.fn(),
            },
        };
        window.svl = svl;
        window.eval(`${NAVIGATION_SERVICE_SRC}\nwindow.NavigationService = NavigationService;`);
        const el = () => document.createElement('div');
        nav = new window.NavigationService({}, { modeSwitchWalk: el(), viewControlLayer: el(), drawingLayer: el() });
    });

    it('completes a 15 m street the labeler can see all of, through the normal end-of-street path', () => {
        const [tiny, next] = [makeTask(1, 0, 15), makeTask(2, 15, 200)];
        place(tiny, next);

        expect(nav.completeTinyStreetAtSpawn()).toBe(true);

        expect(autoCompletions()).toEqual([['TaskAutoComplete_TinyStreet', { streetEdgeId: 1, lengthM: 15 }]]);
        expect(svl.taskContainer.endTask).toHaveBeenCalledWith(tiny);
        expect(mission.pushATaskToTheRoute).toHaveBeenCalledWith(tiny);
        expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
    });

    it('leaves a 40 m street alone even when all of it is in view', () => {
        // Standing at its midpoint puts both ends within 20 m: the length gate, not the view, is what excludes it.
        const street = makeTask(1, -20, 20);
        place(street, makeTask(2, 20, 200));

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
        expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });

    it('leaves a tiny street alone when its far end is out of view', () => {
        place(makeTask(1, 15, 30), makeTask(2, 30, 200));

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
        expect(autoCompletions()).toHaveLength(0);
    });

    it('leaves a street already completed alone', () => {
        const tiny = makeTask(1, 0, 15);
        tiny.complete = true;
        place(tiny);

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
    });

    it.each([
        ['in the tutorial', () => {
            svl.isOnboarding = () => true;
        }],
        ['in free exploration, which never finishes a street (#4451)', () => {
            svl.isExploreAddressMode = () => true;
        }],
        ['while a jump is armed, since the street being walked is then already done', () => {
            nav.setLabelBeforeJumpState(true);
        }],
        ['before the region\'s streets have loaded', () => {
            svl.taskContainer.tasksLoaded = () => false;
        }],
    ])('does nothing %s', (_name, arrange) => {
        place(makeTask(1, 0, 15), makeTask(2, 15, 200));
        arrange();

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
        expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });

    it('carries on through a run of tiny streets, but only five deep', () => {
        const run = [0, 1, 2, 3, 4, 5, 6].map((i) => makeTask(i + 1, i * 2, i * 2 + 2));
        place(...run);

        nav.completeTinyStreetAtSpawn();

        expect(autoCompletions()).toHaveLength(5);
        expect(svl.taskContainer.endTask).toHaveBeenCalledTimes(5);
        expect(svl.taskContainer.getCurrentTask()).toBe(run[5]);
    });

    it('arms the label-before-jump prompt when the next street is a jump away', () => {
        const [tiny, far] = [makeTask(1, 0, 15), makeTask(2, 800, 900)];
        tiny.isConnectedTo.mockReturnValue(false);
        place(tiny, far);

        expect(nav.completeTinyStreetAtSpawn()).toBe(true);

        // The jump waits for the labeler to finish labeling here, exactly as at the end of a walked street.
        expect(svl.taskContainer.setNextTaskAfterJump).toHaveBeenCalledWith(far);
        expect(svl.compass.showLabelBeforeJumpMessage).toHaveBeenCalled();
        expect(nav.getLabelBeforeJumpState()).toBe(true);
        expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });
});
