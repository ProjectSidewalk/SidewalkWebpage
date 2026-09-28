/**
 * A neighborhood mission plans its walk once the region's streets load, and Explore follows that plan (#5526).
 *
 * The planner itself (`common/WalkPlanner.js`) has its own suite; here it is replaced by a fake that returns a
 * scripted plan, so what is pinned is the lifecycle around it: when a plan is built and when it is not, how its order
 * and directions land on the tasks, that `nextTask` follows it through the same walk-order rule a route uses and never
 * toggles a planned street's direction, when it is rebuilt (and when that waits for an armed jump to land), that a
 * failing minimap preview never escapes, and that a missing or failing planner falls back to the greedy rule rather
 * than breaking the tool.
 *
 * Real Task, TaskContainer, vendored turf and `util.math`: direction is decided by distances along real geometry. Task
 * and TaskContainer are top-level `class` declarations for the Grunt-concatenation world, so the sources are eval'd
 * into the jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const TASK_SRC = readSrc('public/js/explore/src/task/Task.js');
const TASK_CONTAINER_SRC = readSrc('public/js/explore/src/task/TaskContainer.js');
const UTIL_MATH_SRC = readSrc('public/js/common/utilitiesMath.js');
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

const ORIGIN = [-122.33, 47.6];

/** The point `eastM` east and `northM` north of ORIGIN, as [lng, lat]. */
function at(eastM, northM = 0) {
    const north = turf.destination(turf.point(ORIGIN), northM / 1000, 0).geometry.coordinates;
    return turf.destination(turf.point(north), eastM / 1000, 90).geometry.coordinates;
}

/**
 * The fixture region. Streets 1–3 run end to end eastward from ORIGIN; 4 and 5 are 500 m north, off on their own, so
 * reaching them is a jump. Street 1 is the one the page hands over.
 */
const STREETS = {
    1: [at(0), at(100)],
    2: [at(100), at(200)],
    3: [at(200), at(300)],
    4: [at(0, 500), at(100, 500)],
    5: [at(100, 500), at(200, 500)],
    // Parallel to street 1's continuation, 20 m and 60 m north of its east end: close enough that a correction toward
    // the finished street would turn them, by the 25 m connection radius and the 75 m nearby test respectively.
    6: [at(100, 20), at(300, 20)],
    7: [at(100, 60), at(300, 60)],
};

/** A /tasks feature for a street. The coordinates are copied: Task reverses them in place. */
function feature(streetEdgeId, properties = {}) {
    const coordinates = STREETS[streetEdgeId].map((coord) => [...coord]);
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
            street_edge_id: streetEdgeId,
            priority: 0.5,
            task_start: '2026-09-27T12:00:00Z',
            current_lng: coordinates[0][0],
            current_lat: coordinates[0][1],
            ...properties,
        },
    };
}

const DEFAULT_STATS = {
    streets: 5, totalM: 500.4, jumps: 1, jumpM: 400, medianJumpM: 400, deadEnds: 0, lowerBoundJumps: 1, ms: 1.26,
};

/**
 * Stands in for WalkPlanner: records every construction and plan() call, and answers with `FakeWalkPlanner.script`,
 * a function of the streets and the start. The default script walks the streets in the order given, no reversals.
 */
class FakeWalkPlanner {
    static instances = [];
    static script = null;

    constructor(streets, options) {
        this.streets = streets;
        this.options = options;
        FakeWalkPlanner.instances.push(this);
    }

    plan(start) {
        this.start = start;
        const script = FakeWalkPlanner.script
            ?? ((streets) => streets.map((street) => ({ id: street.id, reverse: false, jump: false, jumpM: 0 })));
        return { steps: script(this.streets, start), stats: DEFAULT_STATS };
    }
}

/** A plan over the given ids in order; `options[id]` overrides that step's fields. */
const scriptSteps = (ids, options = {}) => () => ids.map((id) => ({
    id, reverse: false, jump: false, jumpM: 0, ...options[id],
}));

describe('A neighborhood mission\'s planned walk', () => {
    let svl;
    let tracker;
    let container;
    let position;

    const task = (streetEdgeId) => container.getTasks().find((t) => t.getStreetEdgeId() === streetEdgeId);
    const pushed = (eventName) => tracker.push.mock.calls.filter(([name]) => name === eventName);

    /**
     * Loads the page's street and then the region's other streets, as Main and fetchTasks do.
     * @param {object} [options] - `isRoute`, `exploreAddress`, `onboarding`, `features` (the /tasks payload besides
     *     street 1).
     */
    async function load({ isRoute = false, exploreAddress = false, onboarding = false, features } = {}) {
        const mission = { getProperty: () => 1, pushATaskToTheRoute: jest.fn() };
        svl = {
            CONNECTED_TASK_THRESHOLD: 0.025,
            CLOSE_TO_ROUTE_THRESHOLD: 0.05,
            userRouteId: 3,
            isOnboarding: () => onboarding,
            isExploreAddressMode: () => exploreAddress,
            regionModel: { isRoute, currentRegion: () => ({ getRegionId: () => 7 }) },
            missionContainer: { getCurrentMission: () => mission, getTasksMissionsOffset: () => null },
            panoViewer: { getPosition: () => position },
            walkPlanLayer: { refresh: jest.fn(), getPreviewedTasks: jest.fn(() => []) },
            // The backend's thresholds (walk-planner.* in application.conf), as Main copies them from the page.
            walkPlannerSettings: { priorityTolerance: 0.15, tinyStreetM: 20 },
        };
        window.svl = svl;
        tracker = { push: jest.fn(), setAuditTaskID: jest.fn() };
        container = new window.TaskContainer(svl.regionModel, svl, tracker);
        svl.taskContainer = container;

        const current = new window.Task(feature(1), false);
        container._tasks.push(current);
        container.setCurrentTask(current);

        const payload = features ?? [feature(1), feature(2), feature(3), feature(4), feature(5)];
        window.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ features: payload }) }));
        await container.fetchTasks();
    }

    beforeEach(() => {
        window.turf = turf;
        window.eval(UTIL_MATH_SRC);
        window.eval(`${TASK_SRC}\nwindow.Task = Task;`);
        window.eval(`${TASK_CONTAINER_SRC}\nwindow.TaskContainer = TaskContainer;`);
        // Drawing is WalkPlanLayer's and Task.render's concern (walkPlanLayer.test.js); nothing here reads the map.
        jest.spyOn(window.Task.prototype, 'render').mockImplementation(() => {});
        FakeWalkPlanner.instances = [];
        FakeWalkPlanner.script = null;
        window.WalkPlanner = FakeWalkPlanner;
        position = { lat: ORIGIN[1], lng: ORIGIN[0] };
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete window.WalkPlanner;
    });

    describe('is built once the region\'s streets load', () => {
        it('plans with the backend\'s thresholds, not literals of its own', async () => {
            await load();

            expect(FakeWalkPlanner.instances[0].options).toEqual({ priorityTolerance: 0.15, tinyStreetM: 20 });
            expect(tracker.push).toHaveBeenCalledWith('WalkPlan_Created', expect.objectContaining({
                reason: 'load', tolerance: 0.15,
            }));
        });

        it('from the current street, over every street still to walk', async () => {
            await load({ features: [feature(2), feature(3, { completed: true }), feature(4)] });

            expect(FakeWalkPlanner.instances).toHaveLength(1);
            const [planner] = FakeWalkPlanner.instances;
            expect(planner.start).toEqual({ streetId: 1 });
            // The current street leads, and a street this labeler already completed is not planned back in.
            expect(planner.streets.map((street) => street.id)).toEqual([1, 2, 4]);
            expect(planner.streets[1]).toEqual({
                id: 2,
                coords: STREETS[2],
                priority: 0.5,
                lengthM: expect.closeTo(100, 0),
                fixedDirection: false,
            });
            expect(container.hasWalkPlan()).toBe(true);
            expect(container.getWalkPlan().reason).toBe('load');
        });

        it('and stamps each street with its place in the walk', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 4, 5, 2, 3], { 4: { jump: true, jumpM: 500 } });
            await load();

            expect([1, 4, 5, 2, 3].map((id) => task(id).getWalkOrder())).toEqual([0, 1, 2, 3, 4]);
            expect(container.getPlannedTasksAhead().map((t) => t.getStreetEdgeId())).toEqual([4, 5, 2, 3]);
            expect(container.getPlannedTasksAhead(2).map((t) => t.getStreetEdgeId())).toEqual([4, 5]);
            expect(container.getPlannedStepsAhead(1)[0].step).toEqual({ id: 4, reverse: false, jump: true, jumpM: 500 });
        });

        it('and logs a summary of it, not the steps, which would crowd the tracker buffer', async () => {
            await load();

            expect(pushed('WalkPlan_Created')).toEqual([['WalkPlan_Created', {
                reason: 'load', tolerance: 0.15, streets: 5, jumps: 1, plannedM: 500, lowerBoundJumps: 1, ms: 1,
            }]]);
        });

        it('and previews it on the minimap', async () => {
            await load();

            expect(svl.walkPlanLayer.refresh).toHaveBeenCalled();
        });

        it('but not on a route, whose order is saved with it', async () => {
            await load({ isRoute: true });

            expect(window.fetch).toHaveBeenCalledWith('/routeTasks?userRouteId=3', expect.anything());
            expect(FakeWalkPlanner.instances).toHaveLength(0);
            expect(container.hasWalkPlan()).toBe(false);
        });

        it('nor in free exploration, which walks no sequence of streets', async () => {
            await load({ exploreAddress: true });

            expect(FakeWalkPlanner.instances).toHaveLength(0);
            expect(container.hasWalkPlan()).toBe(false);
        });

        it('nor in the tutorial, whose street is scripted', async () => {
            await load({ onboarding: true });

            expect(container.planWalk('load')).toBe(false);
            expect(FakeWalkPlanner.instances).toHaveLength(0);
            expect(container.hasWalkPlan()).toBe(false);
        });

        it('entering a part-walked street where the labeler left it, not at its start (#5370)', async () => {
            const resumeAt = at(250);
            await load({
                features: [feature(2), feature(3, {
                    audit_task_id: 55, completed: false, current_lng: resumeAt[0], current_lat: resumeAt[1],
                })],
            });

            const planned = FakeWalkPlanner.instances[0].streets.find((street) => street.id === 3);
            // Only the unwalked 50 m, in the street's own direction, which the planner may not turn.
            expect(planned.coords[0][0]).toBeCloseTo(resumeAt[0], 6);
            expect(planned.coords.at(-1)).toEqual(STREETS[3][1]);
            expect(planned.lengthM).toBeCloseTo(50, 0);
            expect(planned.fixedDirection).toBe(true);
        });
    });

    describe('turns each street to the direction it is planned to be walked', () => {
        it('starting a reversed step at its far end', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 5, 4], { 5: { reverse: true, jump: true } });
            await load();

            // Street 5 runs west-to-east as stored; the plan walks it from its east end back toward street 4.
            expect(task(5).getStartCoordinate()).toEqual({ lat: STREETS[5][1][1], lng: STREETS[5][1][0] });
            expect(task(5).getProperty('startPointReversed')).toBe(true);
            expect(task(2).getStartCoordinate()).toEqual({ lat: STREETS[2][0][1], lng: STREETS[2][0][0] });
        });

        it('and applying the same plan again changes nothing', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 5, 4], { 5: { reverse: true } });
            await load();
            // The second plan sees street 5 already turned, so its own coordinates now start at the planned end.
            FakeWalkPlanner.script = scriptSteps([1, 2, 5, 4]);

            container.planWalk('priority');

            expect(task(5).getProperty('startPointReversed')).toBe(true);
        });

        it('but leaves a part-walked street as its audit_task row fixed it (#5370)', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 3], { 3: { reverse: true } });
            await load({ features: [feature(2), feature(3, { audit_task_id: 55, completed: false })] });

            expect(FakeWalkPlanner.instances[0].streets.find((street) => street.id === 3).fixedDirection).toBe(true);
            expect(task(3).getProperty('startPointReversed')).toBe(false);
        });

        it('and never turns the street being walked', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2], { 1: { reverse: true } });
            await load({ features: [feature(2)] });

            expect(task(1).getProperty('startPointReversed')).toBe(false);
        });
    });

    describe('is followed by nextTask', () => {
        it('in plan order, not by priority', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 4, 2, 3, 5], { 4: { jump: true } });
            await load({ features: [feature(2, { priority: 1 }), feature(3), feature(4, { priority: 0.25 }), feature(5)] });

            expect(container.nextTask(task(1))).toBe(task(4));
        });

        it('skipping streets completed or given up on since the plan was made', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 3, 4, 5]);
            await load();
            task(2).complete();
            task(3).giveUpOnImagery();

            expect(container.nextTask(task(1))).toBe(task(4));
        });

        it('without ever toggling a planned street\'s direction', async () => {
            // Street 4 is the region's top priority and isolated: without a plan, the greedy rule jumps to it and
            // flips it for want of a connected street at its start. With one, the plan's direction stands.
            FakeWalkPlanner.script = scriptSteps([1, 4, 5, 2, 3], { 4: { jump: true } });
            await load({ features: [feature(2), feature(3), feature(4, { priority: 1 })] });
            const reverse = jest.spyOn(window.Task.prototype, 'reverseStreetDirection');

            const next = container.nextTask(task(1));

            expect(next).toBe(task(4));
            expect(reverse).not.toHaveBeenCalled();
        });

        it('while the greedy rule it replaces does toggle it', async () => {
            // The contrast that makes the case above mean something: same region, no planner.
            delete window.WalkPlanner;
            jest.spyOn(console, 'error').mockImplementation(() => {});
            await load({ features: [feature(2), feature(3), feature(4, { priority: 1 })] });
            const reverse = jest.spyOn(window.Task.prototype, 'reverseStreetDirection');

            expect(container.nextTask(task(1))).toBe(task(4));
            expect(reverse).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['20 m away, inside the connection radius', 6],
            ['60 m away, inside the nearby test', 7],
        ])('keeping a jump target the plan enters at its far end, with its near end %s', async (_name, id) => {
            // The plan enters the street at its east end (the odd-degree rule can choose that); turning it toward the
            // finished street's end would land the labeler where the minimap's connector does not point.
            FakeWalkPlanner.script = scriptSteps([1, id], { [id]: { reverse: true, jump: true, jumpM: 200 } });
            await load({ features: [feature(id)] });

            expect(container.nextTask(task(1))).toBe(task(id));
            expect(task(id).getStartCoordinate()).toEqual({ lat: STREETS[id][1][1], lng: STREETS[id][1][0] });
        });
    });

    describe('is rebuilt', () => {
        it('around a street given up on for lack of imagery, from where the labeler stands', async () => {
            await load();
            position = { lat: STREETS[1][1][1], lng: STREETS[1][1][0] };

            expect(container.planWalk('giveUp', { exclude: task(1) })).toBe(true);

            const replan = FakeWalkPlanner.instances.at(-1);
            expect(replan.streets.map((street) => street.id)).toEqual([2, 3, 4, 5]);
            expect(replan.start).toEqual({ from: STREETS[1][1] });
            expect(pushed('WalkPlan_Created').at(-1)[1].reason).toBe('giveUp');
            expect(task(1).getPlannedPosition()).toBeNull();
        });

        it('when another labeler changes the priority of a street still ahead', async () => {
            await load();

            container.updateTaskPriorities([{ street_edge_id: 4, priority: 0.25 }]);

            expect(FakeWalkPlanner.instances).toHaveLength(2);
            expect(FakeWalkPlanner.instances[1].streets.find((street) => street.id === 4).priority).toBe(0.25);
            expect(container.getWalkPlan().reason).toBe('priority');
        });

        it('when a street the minimap previews changes priority, even within the top tier', async () => {
            await load();
            svl.walkPlanLayer.getPreviewedTasks.mockReturnValue([task(2), task(3)]);

            container.updateTaskPriorities([{ street_edge_id: 2, priority: 0.45 }]);

            expect(FakeWalkPlanner.instances).toHaveLength(2);
        });

        it('when a street rises into the top tier, previewed or not', async () => {
            await load({ features: [feature(2), feature(3), feature(4), feature(5, { priority: 0.2 })] });

            container.updateTaskPriorities([{ street_edge_id: 5, priority: 0.5 }]);

            expect(FakeWalkPlanner.instances).toHaveLength(2);
        });

        it('but not for a change that leaves the preview and the top tier as they were', async () => {
            // Another labeler's submission nudges an unpreviewed street that stays in the tier: replanning would only
            // reshuffle the preview under this labeler.
            await load();
            svl.walkPlanLayer.getPreviewedTasks.mockReturnValue([task(2), task(3)]);

            container.updateTaskPriorities([{ street_edge_id: 5, priority: 0.45 }]);

            expect(FakeWalkPlanner.instances).toHaveLength(1);
            expect(task(5).getStreetPriority()).toBe(0.45);
        });

        it('but not when the changed street is already walked, or its priority is unchanged', async () => {
            await load();
            task(2).complete();

            container.updateTaskPriorities([
                { street_edge_id: 2, priority: 0.1 },
                { street_edge_id: 3, priority: 0.5 },
                { street_edge_id: 999, priority: 0.2 },
            ]);

            expect(FakeWalkPlanner.instances).toHaveLength(1);
        });

        it('when the labeler takes a street other than the plan\'s next (#5370)', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 3, 4, 5]);
            await load();
            task(1).complete();
            FakeWalkPlanner.script = scriptSteps([5, 4, 2, 3]);

            container.setCurrentTask(task(5));

            expect(FakeWalkPlanner.instances.at(-1).start).toEqual({ streetId: 5 });
            expect(container.getWalkPlan().reason).toBe('switch');
            expect(task(5).getWalkOrder()).toBe(0);
        });

        it('but not when the labeler simply takes the plan\'s next street', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 2, 3, 4, 5]);
            await load();
            task(1).complete();

            container.setCurrentTask(container.nextTask(task(1)));

            expect(FakeWalkPlanner.instances).toHaveLength(1);
        });

        it('only once an armed jump lands, and never turning its target in between', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 4, 5, 2, 3], { 4: { reverse: true, jump: true } });
            await load();
            container.setNextTaskAfterJump(task(4));
            FakeWalkPlanner.script = null;

            // A priority response arriving while the label-before-jump prompt is up.
            container.updateTaskPriorities([{ street_edge_id: 2, priority: 0.25 }]);

            expect(FakeWalkPlanner.instances).toHaveLength(1);
            expect(task(4).getProperty('startPointReversed')).toBe(true);

            task(1).complete();
            container.setCurrentTask(task(4));

            expect(FakeWalkPlanner.instances).toHaveLength(2);
            expect(FakeWalkPlanner.instances[1].start).toEqual({ streetId: 4 });
            expect(container.getWalkPlan().reason).toBe('priority');
            expect(container.getNextTaskAfterJump()).toBeNull();
        });

        it('once, however many replans were asked for while the jump was armed', async () => {
            FakeWalkPlanner.script = scriptSteps([1, 4, 5, 2, 3], { 4: { jump: true } });
            await load();
            container.setNextTaskAfterJump(task(4));

            container.updateTaskPriorities([{ street_edge_id: 2, priority: 0.25 }]);
            container.updateTaskPriorities([{ street_edge_id: 3, priority: 0.25 }]);
            task(1).complete();
            container.setCurrentTask(task(4));
            container.setCurrentTask(task(4));

            expect(FakeWalkPlanner.instances).toHaveLength(2);
        });

        it('only by the time streets are loaded', async () => {
            window.eval(`${TASK_CONTAINER_SRC}\nwindow.TaskContainer = TaskContainer;`);
            const regionModel = { isRoute: false };
            const early = new window.TaskContainer(regionModel, { regionModel }, { push: jest.fn() });

            expect(early.planWalk('load')).toBe(false);
            expect(FakeWalkPlanner.instances).toHaveLength(0);
        });
    });

    describe('keeps a failing minimap preview to itself', () => {
        it('so a priority refresh or a street switch carries on, plan intact', async () => {
            await load();
            svl.walkPlanLayer.refresh.mockImplementation(() => {
                throw new Error('render failed');
            });
            jest.spyOn(console, 'error').mockImplementation(() => {});

            // Both run inside the submission chain, whose own error handling reloads the page.
            expect(() => container.updateTaskPriorities([{ street_edge_id: 4, priority: 0.25 }])).not.toThrow();
            expect(() => container.setCurrentTask(task(2))).not.toThrow();
            expect(container.hasWalkPlan()).toBe(true);
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('falls back to the greedy rule rather than break the tool', () => {
        it('when the planner throws', async () => {
            FakeWalkPlanner.script = () => {
                throw new RangeError('no such node: 12, 13');
            };
            jest.spyOn(console, 'error').mockImplementation(() => {});

            await load();

            // The note is `key:value,` pairs, so the message loses the separators it would otherwise break.
            expect(pushed('WalkPlan_Failed')).toEqual([['WalkPlan_Failed', {
                reason: 'load', error: 'RangeError', message: 'no such node 12 13',
            }]]);
            expect(container.hasWalkPlan()).toBe(false);
            expect(container.nextTask(task(1))).not.toBeNull();
        });

        it('when the planner is not in the bundle at all', async () => {
            delete window.WalkPlanner;
            jest.spyOn(console, 'error').mockImplementation(() => {});

            await load();

            expect(pushed('WalkPlan_Failed')).toHaveLength(1);
            expect(container.nextTask(task(1))).not.toBeNull();
        });

        it('dropping a plan it had, so no stale order outlives the failure', async () => {
            await load();
            FakeWalkPlanner.script = () => {
                throw new Error('boom');
            };
            jest.spyOn(console, 'error').mockImplementation(() => {});

            container.planWalk('priority');

            expect(container.hasWalkPlan()).toBe(false);
            expect(container.getTasks().every((t) => t.getPlannedPosition() === null)).toBe(true);
        });
    });
});
