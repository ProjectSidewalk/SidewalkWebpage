/**
 * What the end-of-route wrap-up does with a street the labeler was never able to walk (#5008).
 *
 * The wrap-up is reached standing on a given-up street whenever the give-up path found nothing left to hand out — the
 * common shape being a route whose last street has no imagery. endTask() submits the task with completed=true, which
 * the regular submission path credits as a full audit: region coverage, priority drop, audited meters. A no-imagery
 * report supports none of that (#4922). The submission itself still has to happen, since it is what carries the
 * mission's completed flag to the server.
 *
 * MissionController is loaded as a module and built against the smallest collaborators the wrap-up touches.
 */

import { loadModules } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';


/** A task in one of the two states the wrap-up distinguishes: walked to its end, or given up on for lack of imagery. */
const makeTask = ({ givenUp = false } = {}) => ({
    wasGivenUpOnImagery: () => givenUp,
});

describe('MissionController.wrapUpRouteOrRegion', () => {
    let controller;
    let currentTask;
    let mission;
    let regionModel;
    let form;
    let modalMissionComplete;
    let taskContainer;

    beforeEach(async () => {
        currentTask = makeTask();
        mission = {
            isComplete: () => false,
            complete: vi.fn(),
            getProperty: (key) => (key === 'missionId' ? 7 : 'audit'),
            getDistance: () => 100,
        };
        regionModel = { isRoute: true, currentRegion: () => ({ getRegionId: () => 22 }) };
        form = { submitData: vi.fn() };
        modalMissionComplete = { update: vi.fn(), show: vi.fn() };
        taskContainer = {
            getCurrentTask: () => currentTask,
            endTask: vi.fn(),
            updateAuditedDistance: vi.fn(),
        };
        window.i18next = { t: (key) => key };

        Object.assign(window, await loadModules('frontend/js/explore/mission/MissionController.js'));
        controller = new window.MissionController(
            { isExploreAddressMode: false },
            { on: vi.fn(), completeMission: vi.fn() },
            regionModel,
            { getCurrentMission: () => mission, finishMission: vi.fn((m) => m.complete()) },
            taskContainer,
            form,
            modalMissionComplete,
            {}, {}, { onFinishClick: vi.fn() },
            { onRouteEndReached: vi.fn(), onRegionExhausted: vi.fn() }, fakePanoManager(),
            {}, {}, {}, {}, {},
            fakeTracker(),
        );
    });

    it('finishes a street the labeler walked to its end', () => {
        controller.wrapUpRouteOrRegion();

        expect(taskContainer.endTask).toHaveBeenCalledWith(currentTask);
    });

    it('never finishes a street given up on for missing imagery', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrRegion();

        expect(taskContainer.endTask).not.toHaveBeenCalled();
    });

    it('still submits that street, since the mission\'s completed flag rides on the submission', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrRegion();

        expect(form.submitData).toHaveBeenCalledWith(currentTask);
    });

    it('shows the celebration either way', () => {
        currentTask = makeTask({ givenUp: true });

        controller.wrapUpRouteOrRegion();

        expect(modalMissionComplete.show).toHaveBeenCalled();
    });

    // A region's last mission can read just under done, so the wrap-up has to finish it (#5692).
    it('completes the mission when a region runs out of streets, not only a route', () => {
        regionModel.isRoute = false;

        controller.wrapUpRouteOrRegion();

        expect(mission.complete).toHaveBeenCalled();
    });

    // Completing sends a submission; if it beat the street's, the server would size a new mission for that street.
    it('finishes a region\'s last street before completing its mission', () => {
        regionModel.isRoute = false;

        controller.wrapUpRouteOrRegion();

        const streetDone = taskContainer.endTask.mock.invocationCallOrder[0];
        expect(streetDone).toBeLessThan(mission.complete.mock.invocationCallOrder[0]);
    });
});
