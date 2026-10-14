/**
 * When a route's last pano may finish the route on its own: once the labeler has looked around *that* pano. The
 * observed area resets to a new pano only once the heading settles after the move, so a check made at the landing
 * would read the previous pano's coverage and could finish the route the moment the labeler steps onto the last pano.
 */

const { loadModules } = require('./loadGlobalScript');

describe('MissionController finishing a route on its own', () => {
    let controller;
    let settling;
    let fractionObserved;
    let headingSettled;

    beforeEach(() => {
        settling = false;
        fractionObserved = 0;
        window.i18next = { t: (key) => key };
        Object.assign(window, loadModules('frontend/js/explore/mission/MissionController.js'));
        const navigationService = {
            isHeadingSettling: () => settling,
            onHeadingSettled: (listener) => { headingSettled = listener; },
        };
        controller = new window.MissionController(
            { isExploreAddressMode: false },
            { on: jest.fn() },
            { isRoute: true, isRouteComplete: true },
            { getCurrentMission: () => ({ isComplete: () => false }) },
            {}, {}, {}, {},
            { showAlert: jest.fn() },
            { onFinishClick: jest.fn(), removeLabelBeforeJumpMessage: jest.fn() },
            navigationService,
            { onRouteEndReached: jest.fn(), onRegionExhausted: jest.fn() },
            { onPovChanged: jest.fn() },
            { getFractionObserved: () => fractionObserved },
            {}, {}, {}, {},
            { push: jest.fn() },
        );
        jest.spyOn(controller, 'wrapUpRouteOrRegion').mockImplementation(() => {});
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
