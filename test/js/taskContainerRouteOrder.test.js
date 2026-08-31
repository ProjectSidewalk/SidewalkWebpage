/**
 * Which street a route hands out next, and what it does with the ones it already gave up on (#5008).
 *
 * A street reported as having no imagery deliberately stays incomplete (#4922) — one session's verdict may not mark
 * it audited. But "incomplete" is also how the route decides what is left to walk, so without a separate memory of
 * the give-up the route keeps offering the same dead street back, and finishing the last real street teleports the
 * labeler onto one instead of ending.
 *
 * TaskContainer is a top-level `class` written for the Grunt-concatenation world, so we eval the source in the jsdom
 * global scope.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/task/TaskContainer.js'), 'utf8',
);

/** A route street at `walkOrder`, in whichever of the three states the route's next-street choice cares about. */
const makeTask = (walkOrder, { complete = false, givenUp = false, km = 1 } = {}) => ({
    walkOrder,
    getWalkOrder: () => walkOrder,
    getStreetEdgeId: () => 100 + walkOrder,
    isComplete: () => complete,
    wasGivenUpOnImagery: () => givenUp,
    getGeoJSON: () => ({ properties: { km } }),
    lineDistance: () => km,
    getAuditedDistance: () => 0,
    setProperty: jest.fn(),
    render: jest.fn(),
});

describe('TaskContainer.nextTask on a route', () => {
    let container;

    beforeEach(() => {
        window.eval(`${SRC}; window.TaskContainer = TaskContainer;`);
        const neighborhoodModel = { isRoute: true };
        container = new window.TaskContainer(neighborhoodModel, { neighborhoodModel }, { push: jest.fn() });
    });

    it('walks the route in its saved order', () => {
        container._tasks = [makeTask(3), makeTask(1), makeTask(2)];

        expect(container.nextTask(null).getWalkOrder()).toBe(1);
    });

    it('does not hand back a street this session gave up on for lack of imagery', () => {
        const [givenUp, ahead] = [makeTask(1, { givenUp: true }), makeTask(2)];
        container._tasks = [givenUp, ahead];

        expect(container.nextTask(null)).toBe(ahead);
    });

    it('is out of streets once only given-up ones remain, so the route can end', () => {
        // The alternative is what #5008 hit: the last street finishes, the route hands back a street it already gave
        // up on, and the labeler is jumped onto imagery that was never there.
        container._tasks = [
            makeTask(1, { givenUp: true }),
            makeTask(2, { givenUp: true }),
            makeTask(3, { complete: true }),
        ];

        expect(container.nextTask(container._tasks[2])).toBeNull();
    });

    it('still distinguishes the two passes of an out-and-back street', () => {
        // Both passes carry the same street edge id, so excluding the just-finished one by street would silently
        // drop the return leg.
        const [outbound, back] = [makeTask(1), makeTask(2)];
        outbound.getStreetEdgeId = () => 101;
        back.getStreetEdgeId = () => 101;
        container._tasks = [outbound, back];

        expect(container.nextTask(outbound)).toBe(back);
    });
});

describe('TaskContainer distance credit', () => {
    let container;

    beforeEach(() => {
        window.turf = { length: (feature) => feature.properties.km };
        window.util = { turfDistanceUnits: () => 'kilometers', array: { sum: (a) => a.reduce((x, y) => x + y, 0) } };
        window.eval(`${SRC}; window.TaskContainer = TaskContainer;`);
        const neighborhoodModel = { isRoute: true };
        container = new window.TaskContainer(neighborhoodModel, { neighborhoodModel }, { push: jest.fn() });
    });

    it('counts a given-up street as walked, so the route can reach 100%', () => {
        // The labeler walked everything the tool let them, and the minimap already draws it as done — a route that
        // finishes while its progress bar reads 97% is telling them they left work behind (#5008).
        const tasks = [makeTask(1, { complete: true }), makeTask(2, { givenUp: true }), makeTask(3, { complete: true })];
        container._tasks = tasks;
        container.setCurrentTask(tasks[2]);

        const walked = container.getCompletedTaskDistance({ units: 'kilometers' });

        expect(walked).toBe(container.totalLineDistanceInNeighborhood({ units: 'kilometers' }));
    });

    it('keeps give-ups out of the completions the community share is reconciled against', () => {
        // getCompletedTasks mirrors server-side completion; a give-up writes no audit_task.completed (#4922).
        container._tasks = [makeTask(1, { givenUp: true }), makeTask(2, { complete: true })];

        expect(container.getCompletedTasks()).toHaveLength(1);
        expect(container.getWalkedTasks()).toHaveLength(2);
    });

    it('has nothing left unwalked once every street is walked or given up on', () => {
        // The celebration map draws walked streets in one tier and outstanding ones in another. Splitting them on
        // server-side completion instead puts a given-up street in both, so a route finished at 100% still shows it
        // as work left behind (#5008).
        container._tasks = [
            makeTask(1, { complete: true }),
            makeTask(2, { givenUp: true }),
            makeTask(3, { complete: true }),
        ];

        expect(container.getIncompleteTasks()).toHaveLength(1);
        expect(container.getUnwalkedTasks()).toHaveLength(0);
    });
});
