/**
 * When a route's last pano may finish the route on its own: once the labeler has looked around *that* pano. The
 * observed area resets to a new pano only once the heading settles after the move, so a check made at the landing
 * would read the previous pano's coverage and could finish the route the moment the labeler steps onto the last pano.
 */

import { loadModules } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';

describe('MissionController finishing a route on its own', () => {
    let controller;
    let settling;
    let fractionObserved;
    let headingSettled;

    beforeEach(async () => {
        settling = false;
        fractionObserved = 0;
        window.i18next = { t: (key) => key };
        const { MissionController } = await loadModules('frontend/js/explore/mission/MissionController.js');
        const navigationService = {
            isHeadingSettling: () => settling,
            onHeadingSettled: (listener) => { headingSettled = listener; },
        };
        controller = new MissionController(
            { isExploreAddressMode: false },
            { on: vi.fn() },
            { isRoute: true, isRouteComplete: true },
            { getCurrentMission: () => ({ isComplete: () => false }) },
            {}, {}, {}, {},
            { showAlert: vi.fn() },
            { onFinishClick: vi.fn(), removeLabelBeforeJumpMessage: vi.fn() },
            navigationService,
            { onRouteEndReached: vi.fn(), onRegionExhausted: vi.fn() },
            fakePanoManager(),
            { getFractionObserved: () => fractionObserved },
            {}, {}, {}, {},
            fakeTracker(),
        );
        vi.spyOn(controller, 'wrapUpRouteOrRegion').mockImplementation(() => {});
    });

    it('waits for the heading to settle on the last pano, not the coverage of the one before it', () => {
        settling = true;
        fractionObserved = 1; // The previous pano, fully looked around.
        controller.onRouteReadyToFinish();
        expect(controller.wrapUpRouteOrRegion).not.toHaveBeenCalled();

        settling = false;
        fractionObserved = 0.2; // Reset to the last pano once settled.
        headingSettled();
        expect(controller.wrapUpRouteOrRegion).not.toHaveBeenCalled();

        fractionObserved = 0.95;
        headingSettled();
        expect(controller.wrapUpRouteOrRegion).toHaveBeenCalledTimes(1);
    });

    it('finishes at once when the end is reached standing still on a pano already looked around', () => {
        fractionObserved = 1;
        controller.onRouteReadyToFinish();
        expect(controller.wrapUpRouteOrRegion).toHaveBeenCalledTimes(1);
    });
});
