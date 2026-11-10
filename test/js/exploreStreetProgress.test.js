/**
 * What StreetProgress decides at the end of a street (#5840): when the "finish labeling here before jumping" prompt
 * goes up and what it arms, how the route or region is declared done, what the jump the prompt leads to does, and the
 * best-effort preload of the next move around all of it. Its collaborators are fakes; the one piece of geometry, the
 * gap between two streets under a planned walk, is measured on real coordinates.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';
import { fakeGate, fakePanoManager, fakeTracker } from './fakes.js';

const ORIGIN = [-122.33, 47.6];

/** The point `eastM` east of ORIGIN, as {lat, lng}. */
function at(eastM) {
  const [lng, lat] = turf.destination(turf.point(ORIGIN), eastM / 1000, 90).geometry.coordinates;
  return { lat, lng };
}

/**
 * A street as StreetProgress reads it.
 * @param {number} id - Street id.
 * @param {object} [options] - `atEnd` and `coveredEnough` for the end-of-street test, `givenUp`, `connected` (what
 *     isConnectedTo answers), `startM`/`endM` for the gap a planned walk measures, and `walkedFraction`.
 */
function makeTask(id, { atEnd = false, coveredEnough = true, givenUp = false, connected = true, startM = 0,
  endM = 100, walkedFraction = 1 } = {}) {
  return {
    id,
    isAtEnd: () => atEnd,
    isCoveredEnough: () => coveredEnough,
    wasGivenUpOnImagery: () => givenUp,
    isConnectedTo: () => connected,
    recordVisit: vi.fn(),
    getGeoJSON: () => ({ id }),
    getEndCoordinate: () => at(endM),
    getEntryCoordinate: () => at(startM),
    lineDistance: () => endM - startM,
    getDistanceFromStart: () => (endM - startM) * walkedFraction,
    headingAlongRoute: () => 45,
  };
}

describe('StreetProgress', () => {
  let progress;
  let config;
  let regionModel;
  let missionModel;
  let mission;
  let taskContainer;
  let viewer;
  let panoManager;
  let nav;
  let sweep;
  let jumpAlert;
  let tracker;
  let listeners;
  let current;
  let next;
  let landed;

  beforeEach(async () => {
    const { StreetProgress } = await loadModules('frontend/js/explore/task/StreetProgress.js');
    config = { isExploreAddressMode: false, isOnboarding: false };
    regionModel = {
      currentRegion: () => ({ id: 7 }), isRoute: false, isRouteOrRegionComplete: () => false, setComplete: vi.fn(),
    };
    missionModel = { updateMissionProgress: vi.fn() };
    mission = { pushATaskToTheRoute: vi.fn() };
    current = makeTask(1);
    next = makeTask(2, { startM: 100, endM: 200 });
    landed = true;
    taskContainer = {
      tasksLoaded: () => true,
      getCurrentTask: () => current,
      nextTask: vi.fn(() => next),
      endTask: vi.fn(),
      setCurrentTask: vi.fn((task) => { current = task; }),
      nextAfterJump: null,
      getNextTaskAfterJump: () => taskContainer.nextAfterJump,
      setNextTaskAfterJump: vi.fn((task) => { taskContainer.nextAfterJump = task; }),
      updateCurrentTask: vi.fn(),
      recordExploreMove: vi.fn(),
      hasWalkPlan: () => false,
    };
    viewer = { getPosition: () => at(100), clearPrefetchCache: vi.fn(), findPanoNearCanMiss: () => false };
    panoManager = fakePanoManager(viewer, { turnTo: vi.fn() });
    listeners = {};
    nav = {
      walking: fakeGate(),
      moving: false,
      isMoving: () => nav.moving,
      onLanded: (listener) => { listeners.landed = listener; },
      moveToNextStreet: vi.fn(async (switchStreet) => {
        switchStreet();
        return landed;
      }),
    };
    sweep = {
      onStreetWalkedOut: (listener) => { listeners.walkedOut = listener; },
      onStreetsRanOut: (listener) => { listeners.ranOut = listener; },
      prefetchAlongStreet: vi.fn(),
      preloadAhead: vi.fn(),
    };
    jumpAlert = { onClickJumpMessage: vi.fn() };
    tracker = fakeTracker();
    progress = new StreetProgress(config, regionModel, missionModel, { getCurrentMission: () => mission },
      taskContainer, panoManager, nav, sweep, jumpAlert, tracker);
  });

  /** Lands at the end of the current street, with the next street a jump away. */
  const landAtEndBeforeJump = () => {
    current = makeTask(1, { atEnd: true, connected: false });
    next = makeTask(2, { startM: 300, endM: 400 });
    listeners.landed();
  };

  describe('reaching the end of a street', () => {
    it('asks the labeler to finish here first when the next street is a jump away, and readies the jump', () => {
      const armed = vi.fn();
      progress.onLabelBeforeJumpChanged(armed);

      landAtEndBeforeJump();

      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
      expect(armed).toHaveBeenCalledWith(true);
      expect(tracker.push).toHaveBeenCalledWith('LabelBeforeJump_ShowMsg');
      expect(taskContainer.setNextTaskAfterJump).toHaveBeenCalledWith(next);
      expect(taskContainer.endTask).not.toHaveBeenCalled();
      // The street is prefetched now, so the jump lands without waiting on the network.
      expect(viewer.clearPrefetchCache).toHaveBeenCalled();
      expect(sweep.prefetchAlongStreet).toHaveBeenCalledWith(next.getGeoJSON());
      // With the prompt up, the next move is the jump, so that is what gets preloaded.
      expect(sweep.preloadAhead).toHaveBeenLastCalledWith(next);
    });

    it('asks only once while the prompt is up', () => {
      landAtEndBeforeJump();
      listeners.landed();

      expect(tracker.push.mock.calls.filter(([name]) => name === 'LabelBeforeJump_ShowMsg')).toHaveLength(1);
      expect(taskContainer.nextTask).toHaveBeenCalledTimes(1);
    });

    it('declares a region done on its last street and still asks the labeler to finish here', () => {
      const exhausted = vi.fn();
      const routeEnd = vi.fn();
      progress.onRegionExhausted(exhausted);
      progress.onRouteEndReached(routeEnd);
      current = makeTask(1, { atEnd: true });
      next = null;

      listeners.landed();

      expect(regionModel.setComplete).toHaveBeenCalled();
      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
      expect(taskContainer.setNextTaskAfterJump).not.toHaveBeenCalled();
      expect(sweep.prefetchAlongStreet).not.toHaveBeenCalled();
      // Regions finish with a compass click; neither end listener fires here.
      expect(routeEnd).not.toHaveBeenCalled();
      expect(exhausted).not.toHaveBeenCalled();
      // Nothing to jump to, so nothing to preload.
      expect(sweep.preloadAhead).not.toHaveBeenCalled();
    });

    it('tells the mission a route\'s last street is done once most of it is walked', () => {
      const routeEnd = vi.fn();
      progress.onRouteEndReached(routeEnd);
      regionModel.isRoute = true;
      current = makeTask(1, { atEnd: true, walkedFraction: 0.95 });
      next = null;

      listeners.landed();

      expect(regionModel.setComplete).toHaveBeenCalled();
      expect(routeEnd).toHaveBeenCalled();
    });

    it('still asks before a connected street when the route is already complete', () => {
      regionModel.isRouteOrRegionComplete = () => true;
      current = makeTask(1, { atEnd: true });

      listeners.landed();

      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
      expect(taskContainer.setNextTaskAfterJump).not.toHaveBeenCalled();
      expect(sweep.prefetchAlongStreet).toHaveBeenCalledWith(next.getGeoJSON());
    });

    it('switches straight onto a connected street, crediting the junction pano to it', () => {
      current = makeTask(1, { atEnd: true });
      const ending = current;

      listeners.landed();

      expect(taskContainer.endTask).toHaveBeenCalledWith(ending);
      expect(mission.pushATaskToTheRoute).toHaveBeenCalledWith(ending);
      expect(taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
      expect(next.recordVisit).toHaveBeenCalledWith(at(100));
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('switches off a street given up on without finishing it', () => {
      current = makeTask(1, { atEnd: true, givenUp: true });

      listeners.landed();

      expect(taskContainer.endTask).not.toHaveBeenCalled();
      expect(taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
    });

    it('measures the gap to the planned next street, not to either of its ends, under a planned walk', () => {
      // The plan enters street 2 at its far end, 300 m away; its near end touches street 1, so isConnectedTo would
      // call it connected and switch the labeler onto a street that begins a block away.
      taskContainer.hasWalkPlan = () => true;
      current = makeTask(1, { atEnd: true });
      next = makeTask(2, { connected: true, startM: 400, endM: 100 });

      listeners.landed();

      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
      expect(taskContainer.setNextTaskAfterJump).toHaveBeenCalledWith(next);
    });

    it('is also reached when the street walks out of imagery after enough was seen', () => {
      current = makeTask(1, { connected: false });

      listeners.walkedOut(current);

      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
    });
  });

  describe('landing on the last pano the walk can reach (#5918)', () => {
    /** Lands mid-street, a jump from the next one, with `links` leading off and `landing` as the walk's next stop. */
    const landWith = async (links, landing) => {
      next = makeTask(2, { startM: 300, endM: 400, connected: false });
      current.isConnectedTo = () => false;
      viewer.getPanoId = () => 'pano-here';
      viewer.getLinkedPanos = () => links;
      sweep.findLanding = typeof landing === 'function' ? landing : async () => landing;
      listeners.landed();
      await new Promise((resolve) => setTimeout(resolve));
    };

    it('asks the labeler to finish here straight away, with no step that goes nowhere', async () => {
      await landWith([{ panoId: 'pano-behind', heading: 225 }], null);
      expect(progress.isLabelBeforeJumpArmed()).toBe(true);
    });

    it('waits while a pano is still ahead', async () => {
      await landWith([], { panoId: 'pano-ahead' });
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('waits while a link still leads on', async () => {
      await landWith([{ panoId: 'pano-on', heading: 45 }], null);
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('leaves a street not seen enough to the step that reports it', async () => {
      current = makeTask(1, { coveredEnough: false });
      await landWith([], null);
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('does nothing when the lookup went unanswered', async () => {
      await landWith([], async () => { throw new Error('provider down'); });
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('leaves the street to a move already in flight, which ends it itself', async () => {
      await landWith([], async () => {
        nav.moving = true;
        return null;
      });
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('brings the mission progress up to date once the street has ended', async () => {
      await landWith([], null);
      expect(missionModel.updateMissionProgress).toHaveBeenCalledTimes(2);
    });

    it('never ends a street on a lookup that can miss panos (infra3d)', async () => {
      viewer.findPanoNearCanMiss = () => true;
      await landWith([], null);
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });

    it('does nothing once the labeler has moved on', async () => {
      await landWith([], async () => {
        viewer.getPanoId = () => 'pano-elsewhere';
        return null;
      });
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
    });
  });

  describe('jumping to the street the prompt was for', () => {
    it('finishes the street under the mission it was walked in, lowers the prompt, and faces forward', async () => {
      const armed = vi.fn();
      progress.onLabelBeforeJumpChanged(armed);
      landAtEndBeforeJump();
      const ended = current;
      const missionAtPrompt = mission;
      mission = { pushATaskToTheRoute: vi.fn() }; // The mission moved on while the prompt was up.

      await progress.jumpToANewTask();

      expect(taskContainer.endTask).toHaveBeenCalledWith(ended);
      expect(missionAtPrompt.pushATaskToTheRoute).toHaveBeenCalledWith(ended);
      expect(mission.pushATaskToTheRoute).not.toHaveBeenCalled();
      expect(armed).toHaveBeenLastCalledWith(false);
      expect(progress.isLabelBeforeJumpArmed()).toBe(false);
      expect(taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
      expect(taskContainer.nextAfterJump).toBeNull();
      expect(panoManager.turnTo).toHaveBeenCalledWith(45);
      expect(jumpAlert.onClickJumpMessage).toHaveBeenCalled();
    });

    it('asks for the next street when none was armed, and leaves a given-up street unfinished', async () => {
      current = makeTask(1, { givenUp: true });
      const givenUp = current;
      next = makeTask(2);

      await progress.jumpToANewTask();

      expect(taskContainer.endTask).not.toHaveBeenCalled();
      expect(taskContainer.nextTask).toHaveBeenCalledWith(givenUp);
      expect(taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
    });

    it('turns nowhere when the move did not land', async () => {
      landed = false;

      await progress.jumpToANewTask();

      expect(panoManager.turnTo).not.toHaveBeenCalled();
      expect(jumpAlert.onClickJumpMessage).not.toHaveBeenCalled();
    });

    it('has nowhere to jump in free exploration', async () => {
      config.isExploreAddressMode = true;

      await progress.jumpToANewTask();

      expect(nav.moveToNextStreet).not.toHaveBeenCalled();
    });
  });

  describe('after a landing', () => {
    it('credits the pano to whichever street it is on in free exploration, with no end of street', () => {
      config.isExploreAddressMode = true;
      current = makeTask(1, { atEnd: true });

      listeners.landed();

      expect(taskContainer.recordExploreMove).toHaveBeenCalledWith(at(100));
      expect(current.recordVisit).not.toHaveBeenCalled();
      expect(taskContainer.endTask).not.toHaveBeenCalled();
      expect(missionModel.updateMissionProgress).toHaveBeenCalledWith(mission, { id: 7 });
    });

    it('copes with no current street yet', () => {
      current = null;

      expect(() => listeners.landed()).not.toThrow();
      expect(taskContainer.updateCurrentTask).toHaveBeenCalled();
      expect(sweep.preloadAhead).not.toHaveBeenCalled();
    });

    it('skips the preload while something holds walking, or before the streets have loaded', () => {
      nav.walking.isHeld = () => true;
      listeners.landed();
      expect(sweep.preloadAhead).not.toHaveBeenCalled();

      nav.walking.isHeld = () => false;
      taskContainer.tasksLoaded = () => false;
      listeners.landed();
      expect(sweep.preloadAhead).not.toHaveBeenCalled();
    });

    it('lets a failed preload go with a warning', () => {
      sweep.preloadAhead.mockImplementation(() => { throw new Error('no viewer'); });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => listeners.landed()).not.toThrow();

      expect(console.warn).toHaveBeenCalledWith('Failed to preload the next move target:', expect.any(Error));
    });
  });

  it('ends the region where the labeler stands when the streets run out of imagery', () => {
    const exhausted = vi.fn();
    const routeEnd = vi.fn();
    progress.onRegionExhausted(exhausted);
    progress.onRouteEndReached(routeEnd);

    listeners.ranOut();
    expect(regionModel.setComplete).toHaveBeenCalled();
    expect(exhausted).toHaveBeenCalled();
    expect(routeEnd).not.toHaveBeenCalled();

    regionModel.isRoute = true;
    listeners.ranOut();
    expect(routeEnd).toHaveBeenCalled();
  });
});
