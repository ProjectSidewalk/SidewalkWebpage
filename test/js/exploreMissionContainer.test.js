/**
 * How Explore's MissionContainer (frontend/js/explore/mission/MissionContainer.js) keeps the current mission and
 * measures it (#5840): where a mission starts on its street, how the walked distance becomes mission progress through
 * the offset it keeps, and what finishing a mission does to that offset and to the first-mission flag.
 *
 * The real MissionModel feeds it, so the events are the ones Explore fires; the streets and the pano are stand-ins.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';
import { fakePanoManager, fakeTaskContainer } from './fakes.js';

const STREET = {
  type: 'Feature',
  properties: { street_edge_id: 1 },
  geometry: { type: 'LineString', coordinates: [[-122.33, 47.6], [-122.32, 47.6]] },
};

/** A street as the container sees it: its mission id slot, its tutorial flag, and what it claims when resumed. */
function fakeTask({ tutorial = false, resumed = false, savedKm = 0 } = {}) {
  const props = { tutorialTask: tutorial };
  return {
    getProperty: (key) => props[key] ?? null,
    setProperty: (key, value) => { props[key] = value; },
    getFeature: () => STREET,
    setMissionStart: vi.fn(),
    isResumed: () => resumed,
    claimSavedProgress: () => savedKm,
    props,
  };
}

/** A mission row the way the server sends one. */
const row = (overrides = {}) => ({
  mission_id: 10, mission_type: 'audit', region_id: 7, completed: false, distance_meters: 1000, distance_progress: 0,
  skipped: false, ...overrides,
});

describe('MissionContainer', () => {
  let container;
  let missionModel;
  let storage;
  let missionPanel;
  let currentTask;
  let taskContainer;
  let walkedKm;
  let position;
  let config;

  const build = async () => {
    const { MissionContainer, MissionModel } = await loadModules(
      'frontend/js/explore/mission/MissionContainer.js', 'frontend/js/explore/mission/MissionModel.js',
    );
    missionModel = new MissionModel(7);
    container = new MissionContainer(config, missionPanel, missionModel, storage, taskContainer,
      fakePanoManager({ getPosition: () => position }));
    return container;
  };

  beforeEach(async () => {
    config = { isOnboarding: false };
    const stored = {};
    storage = { get: (key) => stored[key] ?? null, set: vi.fn((key, value) => { stored[key] = value; }) };
    missionPanel = { setMessage: vi.fn() };
    currentTask = fakeTask();
    walkedKm = 0;
    position = { lat: 47.6, lng: -122.325 };
    taskContainer = fakeTaskContainer(() => currentTask, { getCompletedTaskDistance: () => walkedKm });
    await build();
  });

  /** Announces a mission row and hands back the Mission the container built from it. */
  const addMission = (overrides = {}) => {
    missionModel.createAMission(row(overrides));
    return container.getCurrentMission();
  };

  describe('taking a mission from the model', () => {
    it('makes an unfinished mission current, tells the sidebar, and says it is loaded', () => {
      const loaded = vi.fn();
      const changed = vi.fn();
      container.on('MissionContainer:missionLoaded', loaded);
      container.on('MissionContainer:missionChanged', changed);

      const mission = addMission();

      expect(mission.getProperty('missionId')).toBe(10);
      expect(missionPanel.setMessage).toHaveBeenCalledWith(mission);
      expect(currentTask.props.currentMissionId).toBe(10);
      expect(loaded).toHaveBeenCalledWith(mission);
      expect(changed).toHaveBeenCalledWith(mission);
    });

    it('files a finished mission under the completed ones without making it current', () => {
      missionModel.createAMission(row({ mission_id: 3, completed: true, distance_progress: 1000 }));

      expect(container.getCurrentMission()).toBeNull();
      expect(container.getCompletedMissions().map((m) => m.getProperty('missionId'))).toEqual([3]);
    });

    it('marks where a fresh mission starts, snapped onto the street from where the pano stands', () => {
      position = { lat: 47.601, lng: -122.325 }; // A little north of the street.
      addMission();

      const [missionId, start] = currentTask.setMissionStart.mock.calls[0];
      expect(missionId).toBe(10);
      const snapped = turf.nearestPointOnLine(STREET, turf.point([position.lng, position.lat])).geometry.coordinates;
      expect(start).toEqual({ lat: snapped[1], lng: snapped[0] });
    });

    it('marks no start for a mission already under way, or on the tutorial street', () => {
      addMission({ distance_progress: 40 });
      expect(currentTask.setMissionStart).not.toHaveBeenCalled();

      currentTask = fakeTask({ tutorial: true });
      addMission({ mission_id: 11 });
      expect(currentTask.setMissionStart).not.toHaveBeenCalled();
    });
  });

  describe('counting finished missions', () => {
    it('adds each finished mission once, at its full distance, and counts the session\'s', () => {
      const mission = addMission({ distance_progress: 990 });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      missionModel.completeMission(mission);
      missionModel.completeMission(mission);

      expect(container.getCompletedMissions()).toEqual([mission]);
      expect(mission.getProperty('distanceProgress')).toBe(1000);
      expect(container.getMissionsCompletedThisSession()).toBe(2);
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('sums the finished missions\' distances in meters, or the unit asked for', () => {
      missionModel.createAMission(row({ mission_id: 1, completed: true, distance_meters: 1000 }));
      missionModel.createAMission(row({ mission_id: 2, completed: true, distance_meters: 500 }));

      expect(container.getCompletedMissionDistance()).toBe(1500);
      expect(container.getCompletedMissionDistance('kilometers')).toBeCloseTo(1.5);
    });

    it('is the first mission only with nothing finished here or remembered from before', () => {
      expect(container.isTheFirstMission()).toBe(true);

      storage.set('completedFirstMission', true);
      expect(container.isTheFirstMission()).toBe(false);
    });

    it('is not the first mission once one is finished in this region', () => {
      missionModel.createAMission(row({ completed: true }));
      expect(container.isTheFirstMission()).toBe(false);
    });
  });

  describe('finishing a mission', () => {
    it('takes an audit mission\'s overshoot off the offset and remembers a first finish', () => {
      const mission = addMission({ distance_progress: 1030 });
      container.setTasksMissionsOffset(100);

      container.finishMission(mission);

      expect(mission.isComplete()).toBe(true);
      expect(container.getTasksMissionsOffset()).toBe(70);
      expect(storage.set).toHaveBeenCalledWith('completedFirstMission', true);
    });

    it('leaves the offset alone for a mission that is not an audit', () => {
      const mission = addMission({ mission_type: 'exploreAddress', distance_progress: 1030 });
      container.setTasksMissionsOffset(100);

      container.finishMission(mission);

      expect(container.getTasksMissionsOffset()).toBe(100);
    });

    it('does not count the tutorial as a first finish', async () => {
      config = { isOnboarding: true };
      await build();
      const mission = addMission({ mission_type: 'auditOnboarding' });

      container.finishMission(mission);

      expect(storage.set).not.toHaveBeenCalled();
    });
  });

  describe('measuring progress', () => {
    it('is the walked distance less the finished missions\' plus the offset, as a share of the target', () => {
      missionModel.createAMission(row({ mission_id: 1, completed: true, distance_meters: 400 }));
      const mission = addMission();
      container.setTasksMissionsOffset(50);
      walkedKm = 0.6; // 600 m walked - 400 m in the finished mission + 50 m offset = 250 m.

      expect(container.getMissionCompletionRate(mission)).toBeCloseTo(0.25);
      expect(mission.getProperty('distanceProgress')).toBeCloseTo(250);
    });

    it('never reads past done or below nothing', () => {
      const mission = addMission();
      container.setTasksMissionsOffset(0);
      walkedKm = 3;

      expect(container.getMissionCompletionRate(mission)).toBe(1);
    });

    it('bumps the offset instead of reporting negative progress', () => {
      missionModel.createAMission(row({ mission_id: 1, completed: true, distance_meters: 400 }));
      const mission = addMission();
      container.setTasksMissionsOffset(0);
      walkedKm = 0.1; // 100 m walked, 400 m already credited to a finished mission.
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(container.getMissionCompletionRate(mission)).toBe(0);
      expect(container.getTasksMissionsOffset()).toBe(300);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('reads a finished mission at its full distance, whatever was walked', () => {
      const mission = addMission();
      container.setTasksMissionsOffset(0);
      mission.complete();
      walkedKm = 0.1;

      expect(container.getMissionCompletionRate(mission)).toBe(1);
      expect(mission.getProperty('distanceProgress')).toBe(1000);
    });

    it('is nothing for the tutorial, and for a mission with no distance target', () => {
      container.setTasksMissionsOffset(0);
      walkedKm = 5;
      const tutorial = addMission({ mission_type: 'auditOnboarding', distance_progress: 7 });
      expect(container.getMissionCompletionRate(tutorial)).toBe(0);
      expect(tutorial.getProperty('distanceProgress')).toBe(7);

      const free = addMission({ mission_id: 11, mission_type: 'exploreAddress', distance_meters: null });
      expect(container.getMissionCompletionRate(free)).toBe(0);
    });

    it('leaves progress alone until the page has set the offset', () => {
      const mission = addMission({ distance_progress: 7 });
      walkedKm = 5;

      container.updateDistanceProgress(mission);

      expect(mission.getProperty('distanceProgress')).toBe(7);
    });
  });

  describe('switching onto a street', () => {
    /** What TaskContainer announces: the listener the container registered for a new current street. */
    const switchTo = (task) => taskContainer.onCurrentTaskChanged.mock.calls[0][0](task);

    it('ties the street to the current mission', () => {
      addMission();
      const task = fakeTask();

      switchTo(task);

      expect(task.props.currentMissionId).toBe(10);
    });

    it('does nothing before a mission is current', () => {
      const task = fakeTask();
      switchTo(task);
      expect(task.props.currentMissionId).toBeUndefined();
    });

    it('takes a part-walked street\'s earlier metres off the offset, so the bar does not count them twice', () => {
      addMission();
      container.setTasksMissionsOffset(500);

      switchTo(fakeTask({ resumed: true, savedKm: 0.2 }));

      expect(container.getTasksMissionsOffset()).toBe(300);
    });

    it('leaves the offset alone for a fresh street, or before the offset exists', () => {
      addMission();
      switchTo(fakeTask({ resumed: true, savedKm: 0.2 }));
      expect(container.getTasksMissionsOffset()).toBeNull();

      container.setTasksMissionsOffset(500);
      switchTo(fakeTask({ resumed: false, savedKm: 0.2 }));
      expect(container.getTasksMissionsOffset()).toBe(500);
    });
  });
});
