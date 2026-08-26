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
const makeTask = (walkOrder, { complete = false, givenUp = false } = {}) => ({
    walkOrder,
    getWalkOrder: () => walkOrder,
    getStreetEdgeId: () => 100 + walkOrder,
    isComplete: () => complete,
    wasGivenUpOnImagery: () => givenUp,
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
