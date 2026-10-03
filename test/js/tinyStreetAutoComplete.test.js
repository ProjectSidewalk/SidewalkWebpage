/**
 * A street too short to walk is completed on arrival when all of it is already in view (#3682).
 *
 * The scenario: a labeler is put on a street shorter than the 25 m completion radius without walking it — by the page
 * load, a seamless switch at a junction, or a jump landing. The end-of-street check runs only after a move, and on a
 * short street Task.isAtEnd shrinks its radius to a fraction of the length, so nothing else would finish it. The rule
 * under test: at those arrival points only, a street under the backend's `walk-planner.tiny-street-m` whose every vertex is within the
 * pano search radius goes through the normal end-of-street path (ended, or its jump prompt armed); a run of such
 * streets is bounded; and a route, whose final street defers to the imagery-exhaustion path (#4640), is left alone.
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
        getStartCoordinate: () => ({ lng: east(fromM)[0], lat: east(fromM)[1] }),
        getEndCoordinate: () => ({ lng: east(toM)[0], lat: east(toM)[1] }),
        isResumed: () => false,
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
            // The backend's threshold (walk-planner.tiny-street-m), shared with the planner.
            walkPlannerSettings: { priorityTolerance: 0.15, tinyStreetM: 20 },
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
            regionModel: {
                isRoute: false,
                isRouteOrRegionComplete: () => false,
                setComplete: jest.fn(),
                currentRegion: () => 'the-region',
            },
            missionModel: { updateMissionProgress: jest.fn() },
            panoManager: { showNavArrows: jest.fn(), setPovToRouteDirection: jest.fn() },
            jumpAlert: { onClickJumpMessage: jest.fn() },
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
                getNextTaskAfterJump: jest.fn(() => null),
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

    it('reads what "tiny" means from the backend\'s setting, so the planner and this check agree', () => {
        svl.walkPlannerSettings.tinyStreetM = 10;
        place(makeTask(1, 0, 15), makeTask(2, 15, 200));

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
    });

    it('completes nothing when the page carries no setting, rather than guessing a threshold', () => {
        delete svl.walkPlannerSettings;
        place(makeTask(1, 0, 15), makeTask(2, 15, 200));

        expect(nav.completeTinyStreetAtSpawn()).toBe(false);
        expect(autoCompletions()).toEqual([]);
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
        ['on a route, whose final street waits for its imagery to run out (#4640)', () => {
            svl.regionModel.isRoute = true;
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
        // Nothing is ended yet, and the log says so.
        expect(autoCompletions()).toEqual([
            ['TaskAutoComplete_TinyStreet', { streetEdgeId: 1, lengthM: 15, armedJump: true }],
        ]);
    });

    it.each([
        ['arms a jump to a planned street that starts a block away, though its far end is close', 200, 25, true],
        ['switches seamlessly onto a planned street that starts where the tiny one ends', 20, 200, false],
    ])('on a planned walk, %s (#5526)', (_name, nextFromM, nextToM, jumps) => {
        // The plan fixed which end is the start, so only that end counts as a connection; isConnectedTo accepts
        // either end and would say "connected" to both.
        svl.taskContainer.hasWalkPlan = () => true;
        const [tiny, next] = [makeTask(1, 0, 15), makeTask(2, nextFromM, nextToM)];
        place(tiny, next);

        nav.completeTinyStreetAtSpawn();

        expect(nav.getLabelBeforeJumpState()).toBe(jumps);
        expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledTimes(jumps ? 0 : 1);
    });

    it('logs each street of a run in the order they were finished', () => {
        const run = [makeTask(1, 0, 4), makeTask(2, 4, 8), makeTask(3, 8, 200)];
        place(...run);

        nav.completeTinyStreetAtSpawn();

        expect(autoCompletions().map(([, note]) => note.streetEdgeId)).toEqual([1, 2]);
    });

    it('finishes a tiny street a jump lands on, then faces the street that follows', async () => {
        const [walked, tiny, next] = [makeTask(1, -900, -800), makeTask(2, 0, 15), makeTask(3, 15, 200)];
        place(walked, tiny, next);
        svl.compass.resetBeforeJump = jest.fn();
        svl.taskContainer.getNextTaskAfterJump.mockReturnValue(tiny);
        nav.moveForward = jest.fn(() => Promise.resolve('landed-pano'));

        await nav.jumpToANewTask();

        expect(svl.taskContainer.endTask).toHaveBeenCalledWith(tiny);
        expect(svl.taskContainer.getCurrentTask()).toBe(next);
        expect(svl.missionModel.updateMissionProgress).toHaveBeenCalled();
        // Re-aimed after the switch, so the camera faces the street being walked rather than the tiny one.
        expect(svl.panoManager.setPovToRouteDirection.mock.invocationCallOrder[0])
            .toBeGreaterThan(svl.taskContainer.setCurrentTask.mock.invocationCallOrder.at(-1));
    });

    it('leaves the street alone when the jump\'s move did not land', async () => {
        const [walked, tiny] = [makeTask(1, -900, -800), makeTask(2, 0, 15)];
        place(walked, tiny);
        svl.compass.resetBeforeJump = jest.fn();
        svl.taskContainer.getNextTaskAfterJump.mockReturnValue(tiny);
        nav.moveForward = jest.fn(() => Promise.resolve(null));

        await nav.jumpToANewTask();

        expect(autoCompletions()).toHaveLength(0);
    });
});
