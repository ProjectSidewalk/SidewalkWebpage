/**
 * What Explore's MissionController (frontend/js/explore/mission/MissionController.js) does with each progress update
 * (#5840): the sidebar numbers it refreshes, how a route's bar differs from a region mission's, when a mission is
 * declared done and the celebration shown, and when the survey is asked for. The wrap-up itself and the route
 * auto-finish are pinned in missionCompleteGivenUpStreet.test.js and missionControllerRouteFinish.test.js.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';
import { routeFetch, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('MissionController.update', () => {
  let controller;
  let config;
  let regionModel;
  let missionContainer;
  let missionModel;
  let taskContainer;
  let modalMissionComplete;
  let modalSurvey;
  let overallStats;
  let regionProgressBar;
  let missionProgressBar;
  let minimapMissionProgress;
  let tracker;
  let compass;
  let streetProgress;
  let panoManager;
  let navigationService;
  let mission;
  let completionRate;
  let walkedKm;
  let routeKm;
  let region;

  const build = async () => {
    const { MissionController } = await loadModules('frontend/js/explore/mission/MissionController.js');
    controller = new MissionController(config, missionModel, regionModel, missionContainer, taskContainer,
      { submitData: vi.fn() }, modalMissionComplete, modalSurvey, { showAlert: vi.fn() }, compass, navigationService,
      streetProgress, panoManager, { getFractionObserved: () => 1 }, overallStats, regionProgressBar,
      missionProgressBar, minimapMissionProgress, tracker);
  };

  beforeEach(async () => {
    useUtil({ turfDistanceUnits: () => 'kilometers' });
    config = { isOnboarding: false, isExploreAddressMode: false, userRouteId: null };
    regionModel = {
      isRoute: false, isRouteComplete: null, isRegionComplete: false,
      isRouteOrRegionComplete: () => false,
      currentRegion: () => region,
    };
    region = { getRegionId: () => 7 };
    mission = {
      isComplete: () => false, complete: vi.fn(),
      getProperty: (key) => ({ missionId: 10, missionType: 'audit' })[key],
      getDistance: () => 1000.4,
    };
    completionRate = 0.5;
    missionContainer = {
      getCurrentMission: () => mission,
      getMissionCompletionRate: vi.fn(() => completionRate),
      finishMission: vi.fn(),
    };
    missionModel = { on: vi.fn(), completeMission: vi.fn() };
    walkedKm = 0.3;
    routeKm = 1;
    taskContainer = {
      getCompletedTaskDistance: () => walkedKm,
      getTotalTaskDistance: () => routeKm,
      getCurrentTask: () => ({ wasGivenUpOnImagery: () => false }),
      endTask: vi.fn(),
    };
    modalMissionComplete = { update: vi.fn(), show: vi.fn(), isOpen: () => false };
    modalSurvey = { open: vi.fn() };
    overallStats = { setRegionAuditedDistance: vi.fn() };
    regionProgressBar = { update: vi.fn() };
    missionProgressBar = { update: vi.fn() };
    minimapMissionProgress = { update: vi.fn() };
    tracker = fakeTracker();
    compass = { onFinishClick: vi.fn(), removeLabelBeforeJumpMessage: vi.fn() };
    streetProgress = { onRouteEndReached: vi.fn(), onRegionExhausted: vi.fn() };
    panoManager = fakePanoManager();
    navigationService = { isHeadingSettling: () => false, onHeadingSettled: vi.fn() };
    window.logWebpageActivity = vi.fn();
    await build();
  });

  it('refreshes the sidebar\'s audited distance, the region bar, and both mission bars', () => {
    controller.update(mission, region);

    expect(overallStats.setRegionAuditedDistance).toHaveBeenCalledWith(0.3);
    expect(regionProgressBar.update).toHaveBeenCalled();
    expect(missionProgressBar.update).toHaveBeenCalledWith(0.5);
    expect(minimapMissionProgress.update).toHaveBeenCalledWith(mission);
  });

  it('does nothing at all during the tutorial', () => {
    config.isOnboarding = true;

    controller.update(mission, region);

    expect(overallStats.setRegionAuditedDistance).not.toHaveBeenCalled();
    expect(missionProgressBar.update).not.toHaveBeenCalled();
  });

  it('refreshes only the distance and region bar in free exploration, which has no mission target', () => {
    config.isExploreAddressMode = true;
    completionRate = 1;

    controller.update(mission, region);

    expect(overallStats.setRegionAuditedDistance).toHaveBeenCalled();
    expect(missionProgressBar.update).not.toHaveBeenCalled();
    expect(modalMissionComplete.show).not.toHaveBeenCalled();
  });

  it('is told about each progress update by the model', () => {
    const [event, listener] = missionModel.on.mock.calls[0];
    expect(event).toBe('MissionProgress:update');

    listener({ mission, region });

    expect(missionProgressBar.update).toHaveBeenCalledWith(0.5);
  });

  describe('on a route', () => {
    beforeEach(() => {
      regionModel.isRoute = true;
      regionModel.isRouteComplete = false;
      regionModel.isRegionComplete = null;
    });

    it('fills the mission bar with the share of the whole route walked, never past full', () => {
      controller.update(mission, region);
      expect(missionProgressBar.update).toHaveBeenCalledWith(0.3);

      walkedKm = 1.2;
      controller.update(mission, region);
      expect(missionProgressBar.update).toHaveBeenLastCalledWith(1);
      expect(missionContainer.getMissionCompletionRate).not.toHaveBeenCalled();
    });

    it('shows an empty bar for a route with no length', () => {
      routeKm = 0;
      controller.update(mission, region);
      expect(missionProgressBar.update).toHaveBeenCalledWith(0);
    });

    it('never declares the mission done from distance; the wrap-up does that', () => {
      walkedKm = 1;
      controller.update(mission, region);
      expect(missionContainer.finishMission).not.toHaveBeenCalled();
      expect(modalMissionComplete.show).not.toHaveBeenCalled();
    });
  });

  describe('declaring a region mission done', () => {
    beforeEach(() => { completionRate = 0.9995; });

    it('logs it, finishes it in the container and the model, and shows the celebration', () => {
      controller.update(mission, region);

      expect(tracker.push).toHaveBeenCalledWith('MissionComplete',
        { missionId: 10, missionType: 'audit', distanceMeters: 1000, regionId: 7 });
      expect(missionContainer.finishMission).toHaveBeenCalledWith(mission);
      expect(missionModel.completeMission).toHaveBeenCalledWith(mission);
      expect(modalMissionComplete.update).toHaveBeenCalledWith(mission, region);
      expect(modalMissionComplete.show).toHaveBeenCalled();
    });

    it('is not done at a hair under the threshold', () => {
      completionRate = 0.999;
      controller.update(mission, region);
      expect(missionContainer.finishMission).not.toHaveBeenCalled();
    });

    it('leaves an open celebration alone when the next region\'s first update finishes a mission', () => {
      modalMissionComplete.isOpen = () => true;

      controller.update(mission, region);

      expect(missionContainer.finishMission).toHaveBeenCalled();
      expect(modalMissionComplete.update).not.toHaveBeenCalled();
    });

    it('finishes the mission without the celebration when the region was finished with it', () => {
      regionModel.isRouteOrRegionComplete = () => true;

      controller.update(mission, region);

      expect(missionContainer.finishMission).toHaveBeenCalled();
      expect(modalMissionComplete.show).not.toHaveBeenCalled();
    });

    it('does not look for a done mission once the region or route is finished', () => {
      regionModel.isRegionComplete = true;
      controller.update(mission, region);
      expect(missionContainer.finishMission).not.toHaveBeenCalled();

      regionModel.isRegionComplete = false;
      regionModel.isRouteComplete = true;
      controller.update(mission, region);
      expect(missionContainer.finishMission).not.toHaveBeenCalled();
    });
  });

  describe('the survey', () => {
    it('is asked for between 60% and 90% of a mission, and opened when the server says so', async () => {
      completionRate = 0.7;
      const fetchStub = routeFetch({ '/survey/display': { displayModal: true } });

      controller.update(mission, region);
      await flush();

      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(modalSurvey.open).toHaveBeenCalled();
      expect(window.logWebpageActivity).toHaveBeenCalledWith('SurveyShown');
    });

    it('stays closed when the server declines', async () => {
      completionRate = 0.7;
      routeFetch({ '/survey/display': { displayModal: false } });

      controller.update(mission, region);
      await flush();

      expect(modalSurvey.open).not.toHaveBeenCalled();
    });

    it('is not asked for early or late in a mission', () => {
      const fetchStub = routeFetch({ '/survey/display': { displayModal: true } });
      completionRate = 0.6;
      controller.update(mission, region);
      completionRate = 0.9;
      controller.update(mission, region);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('logs a failed request and carries on', async () => {
      completionRate = 0.7;
      routeFetch({ '/survey/display': new Error('offline') });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      controller.update(mission, region);
      await flush();

      expect(log).toHaveBeenCalledWith(expect.any(Error));
      expect(modalSurvey.open).not.toHaveBeenCalled();
    });
  });

  describe('wrapping up and auto-finishing', () => {
    it('wraps up on the compass\'s finish click and when the region runs out of streets', () => {
      vi.spyOn(controller, 'wrapUpRouteOrRegion').mockImplementation(() => {});
      compass.onFinishClick.mock.calls[0][0]();
      streetProgress.onRegionExhausted.mock.calls[0][0]();
      expect(controller.wrapUpRouteOrRegion).toHaveBeenCalledTimes(2);
    });

    it('wraps up a route whose mission was already finished without finishing it again', () => {
      regionModel.isRoute = true;
      mission.isComplete = () => true;

      controller.wrapUpRouteOrRegion();

      expect(missionContainer.finishMission).not.toHaveBeenCalled();
      expect(taskContainer.endTask).toHaveBeenCalled();
      expect(modalMissionComplete.show).toHaveBeenCalled();
    });

    it('has nothing to wrap up in free exploration', () => {
      config.isExploreAddressMode = true;
      controller.wrapUpRouteOrRegion();
      expect(taskContainer.endTask).not.toHaveBeenCalled();
      expect(modalMissionComplete.show).not.toHaveBeenCalled();
    });

    it('checks the route on each turn of the view, except while the heading settles', () => {
      vi.spyOn(controller, 'maybeAutoCompleteRoute').mockImplementation(() => {});
      const onPov = panoManager.onPovChanged.mock.calls[0][0];

      onPov();
      expect(controller.maybeAutoCompleteRoute).toHaveBeenCalledTimes(1);

      navigationService.isHeadingSettling = () => true;
      onPov();
      expect(controller.maybeAutoCompleteRoute).toHaveBeenCalledTimes(1);
    });

    it('auto-finishes a route once only, and drops the compass\'s manual finish', () => {
      regionModel.isRoute = true;
      regionModel.isRouteComplete = true;
      vi.spyOn(controller, 'wrapUpRouteOrRegion').mockImplementation(() => {});

      controller.maybeAutoCompleteRoute();
      controller.maybeAutoCompleteRoute();

      expect(controller.wrapUpRouteOrRegion).toHaveBeenCalledTimes(1);
      expect(compass.removeLabelBeforeJumpMessage).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('RouteAutoComplete_Fired', { userRouteId: null, fractionObserved: 1 });
    });

    it('leaves a route the compass click already finished alone', () => {
      regionModel.isRoute = true;
      regionModel.isRouteComplete = true;
      mission.isComplete = () => true;
      vi.spyOn(controller, 'wrapUpRouteOrRegion').mockImplementation(() => {});

      controller.maybeAutoCompleteRoute();

      expect(controller.wrapUpRouteOrRegion).not.toHaveBeenCalled();
    });
  });
});
