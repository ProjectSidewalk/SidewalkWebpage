/**
 * What the end-of-route wrap-up does with a street the labeler was never able to walk (#5008).
 *
 * The wrap-up is reached standing on a given-up street whenever the give-up path found nothing left to hand out — the
 * common shape being a route whose last street has no imagery. endTask() submits the task with completed=true, which
 * the regular submission path credits as a full audit: region coverage, priority drop, audited meters. A no-imagery
 * report supports none of that (#4922). The submission itself still has to happen, since it is what carries the
 * mission's completed flag to the server.
 *
 * MissionController is a top-level `class` written for the Grunt-concatenation world, so we eval the source in the
 * jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/mission/MissionController.js'), 'utf8',
);

/** A task in one of the two states the wrap-up distinguishes: walked to its end, or given up on for lack of imagery. */
const makeTask = ({ givenUp = false } = {}) => ({
    wasGivenUpOnImagery: () => givenUp,
});

describe('MissionController.wrapUpRouteOrNeighborhood', () => {
    let svl;
    let controller;
    let currentTask;

    beforeEach(() => {
        currentTask = makeTask();
        const mission = {
            isComplete: () => false,
            complete: jest.fn(),
            getProperty: (key) => (key === 'missionId' ? 7 : 'audit'),
            getDistance: () => 100,
        };
        svl = {
            isExploreAddressMode: () => false,
            missionsCompleted: 0,
            form: { submitData: jest.fn() },
            modalMissionComplete: { update: jest.fn(), show: jest.fn() },
            neighborhoodModel: { isRoute: true },
            taskContainer: {
                getCurrentTask: () => currentTask,
                endTask: jest.fn(),
                updateAuditedDistance: jest.fn(),
            },
        };
        window.svl = svl;
        window.i18next = { t: (key) => key };

        window.eval(`${SRC}; window.MissionController = MissionController;`);
        controller = new window.MissionController(
            { on: jest.fn(), completeMission: jest.fn() },
            { ...svl.neighborhoodModel, currentNeighborhood: () => ({ getRegionId: () => 22 }) },
            { getCurrentMission: () => mission },
            { push: jest.fn() },
        );
    });

    it('finishes a street the labeler walked to its end', () => {
        controller.wrapUpRouteOrNeighborhood();

        expect(svl.taskContainer.endTask).toHaveBeenCalledWith(currentTask);
    });

    it('never finishes a street given up on for missing imagery', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrNeighborhood();

        expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });

    it('still submits that street, since the mission\'s completed flag rides on the submission', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrNeighborhood();

        expect(svl.form.submitData).toHaveBeenCalledWith(currentTask);
    });

    it('shows the celebration either way', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrNeighborhood();

        expect(svl.modalMissionComplete.show).toHaveBeenCalled();
    });
});
