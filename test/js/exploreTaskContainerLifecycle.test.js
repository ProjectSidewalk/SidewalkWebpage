/**
 * What TaskContainer does around a street's end and the region's bookkeeping (#5840): finishing a street, the
 * "everyone finished this neighborhood" overlay, which streets the mission adopts as they load, the distances the
 * sidebar and the mission-complete modal read, the route's endpoints and path, and the corners of the planned walk
 * (nothing left to plan, a planner that throws something other than an Error, a labeler standing nowhere).
 *
 * Real Task and turf: the distances and the connections are measured on real street geometry.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

const ORIGIN = [-122.33, 47.6];

/** The point `eastM` east and `northM` north of ORIGIN, as [lng, lat]. */
function at(eastM, northM = 0) {
  const north = turf.destination(turf.point(ORIGIN), northM / 1000, 0).geometry.coordinates;
  return turf.destination(turf.point(north), eastM / 1000, 90).geometry.coordinates;
}

/**
 * The fixture region. Streets 1 and 2 run end to end eastward from ORIGIN, and 6 leaves the same junction northward;
 * 3 is 500 m north on its own; 4 and 5 run end to end 300 m east of street 2's end, so 4 connects to 5 ahead but
 * has no street behind it to connect to.
 */
const STREETS = {
  1: [at(0), at(100)],
  2: [at(100), at(200)],
  3: [at(0, 500), at(100, 500)],
  4: [at(500), at(600)],
  5: [at(600), at(700)],
  6: [at(100), at(100, 100)],
};

const STREET_COVERAGE = { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 };

/** A /tasks feature for a street. The coordinates are copied: Task reverses them in place. */
function feature(streetEdgeId, properties = {}) {
  const coordinates = STREETS[streetEdgeId].map((coord) => [...coord]);
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {
      street_edge_id: streetEdgeId,
      priority: 1,
      task_start: '2026-10-09T12:00:00Z',
      current_lng: coordinates[0][0],
      current_lat: coordinates[0][1],
      ...properties,
    },
  };
}

const latLng = ([lng, lat]) => ({ lat, lng });

/** Stands in for WalkPlanner: walks the streets in the order given unless `FakeWalkPlanner.plan` says otherwise. */
class FakeWalkPlanner {
  static plan = null;

  constructor(streets) {
    this.streets = streets;
  }

  static inTier(priority, cutoff) {
    return priority >= cutoff - 1e-9;
  }

  plan(start) {
    if (FakeWalkPlanner.plan) return FakeWalkPlanner.plan(this.streets, start);
    return {
      steps: this.streets.map((street) => ({ id: street.id, reverse: false, jump: false, jumpM: 0 })),
      stats: { streets: this.streets.length, totalM: 100, jumps: 0, lowerBoundJumps: 0, ms: 1 },
    };
  }
}

mockModule('frontend/js/common/WalkPlanner.js', () => ({ WalkPlanner: FakeWalkPlanner }));

describe('TaskContainer', () => {
  let Task;
  let TaskContainer;
  let container;
  let tracker;
  let regionModel;
  let minimap;
  let overallStats;
  let position;
  let config;

  const makeTask = (streetEdgeId, properties) => new Task(feature(streetEdgeId, properties), STREET_COVERAGE, false);
  const task = (streetEdgeId) => container.getTasks().find((t) => t.getStreetEdgeId() === streetEdgeId);

  /** Builds the container on street 1, with the given extra streets loaded as the task list would load them. */
  function build(extraTasks = [], options = {}) {
    config = {
      isExploreAddressMode: false, isOnboarding: false, streetCoverage: STREET_COVERAGE,
      walkPlanner: { priorityTolerance: 0.15, tinyStreetM: 20 }, ...options.config,
    };
    regionModel = {
      isRoute: false,
      currentRegion: () => ({ getRegionId: () => 7 }),
      getRegionCompleteAcrossAllUsers: () => false,
      setRegionCompleteAcrossAllUsers: vi.fn(),
      ...options.regionModel,
    };
    container = new TaskContainer(makeTask(1), config, regionModel, minimap, { getPosition: () => position },
      overallStats, tracker);
    container._tasks.push(...extraTasks);
    return container;
  }

  beforeEach(async () => {
    ({ Task, TaskContainer } = await loadModules('frontend/js/explore/task/Task.js',
      'frontend/js/explore/task/TaskContainer.js'));
    FakeWalkPlanner.plan = null;
    useUtil({ turfDistanceUnits: () => 'kilometers' });
    document.body.innerHTML = '<div id="area-completion-overlay-wrapper" style="display: none"></div>';
    tracker = fakeTracker();
    minimap = { setStreetLines: vi.fn() };
    overallStats = { setRegionAuditedDistance: vi.fn() };
    position = latLng(STREETS[1][1]);
  });

  describe('endTask', () => {
    it('finishes the street, tells the form, and refreshes the sidebar distance and the minimap', () => {
      build([makeTask(2, { priority: 1 })]);
      const ended = vi.fn();
      container.onTaskEnded(ended);

      expect(container.endTask(task(1))).toBe(task(1));

      expect(task(1).isComplete()).toBe(true);
      expect(tracker.push).toHaveBeenCalledWith('TaskEnd');
      expect(ended).toHaveBeenCalledWith(task(1));
      expect(overallStats.setRegionAuditedDistance.mock.calls.at(-1)[0]).toBeCloseTo(0.1, 3);
      expect(minimap.setStreetLines).toHaveBeenCalledWith('street-1', [{ kind: 'completed', coordinates: STREETS[1] }]);
    });

    it('never finishes a street from free exploration, which the server credits from coverage instead', () => {
      build([], { config: { isExploreAddressMode: true } });

      expect(container.endTask(task(1))).toBe(task(1));

      expect(task(1).isComplete()).toBe(false);
      expect(tracker.push).not.toHaveBeenCalledWith('TaskEnd');
    });
  });

  describe('the neighborhood finishing across all users', () => {
    const overlayShown = () => document.getElementById('area-completion-overlay-wrapper').style.display === 'block';

    it('shows the overlay once no street anyone still needs is left', () => {
      // Street 2 was already walked by someone else (its priority dropped), so finishing street 1 ends the region.
      build([makeTask(2, { priority: 0.3 })]);

      container.endTask(task(1));

      expect(overlayShown()).toBe(true);
      expect(regionModel.setRegionCompleteAcrossAllUsers).toHaveBeenCalled();
      expect(tracker.push).toHaveBeenCalledWith('NeighborhoodComplete_AcrossAllUsers', { RegionId: 7 });
    });

    it('shows it when the labeler finishes the region\'s last street themselves', () => {
      build();

      container.endTask(task(1));

      expect(overlayShown()).toBe(true);
    });

    it('waits while a street nobody has walked remains', () => {
      build([makeTask(2, { priority: 1 })]);

      container.endTask(task(1));

      expect(overlayShown()).toBe(false);
      expect(regionModel.setRegionCompleteAcrossAllUsers).not.toHaveBeenCalled();
    });

    it('is not a route\'s concern, and is announced once', () => {
      build([], { regionModel: { isRoute: true } });
      container.endTask(task(1));
      expect(overlayShown()).toBe(false);

      build([], { regionModel: { getRegionCompleteAcrossAllUsers: () => true } });
      container.endTask(task(1));
      expect(overlayShown()).toBe(false);
    });
  });

  describe('fetchTasks', () => {
    it('hands the current mission the streets that belong to it', async () => {
      build();
      vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({
          features: [feature(2, { current_mission_id: 9 }), feature(3, { current_mission_id: 8 })],
        }),
      })));
      const mission = { getProperty: () => 9, pushATaskToTheRoute: vi.fn() };

      await container.fetchTasks(mission);

      expect(mission.pushATaskToTheRoute).toHaveBeenCalledTimes(1);
      expect(mission.pushATaskToTheRoute).toHaveBeenCalledWith(task(2));
      expect(container.tasksLoaded()).toBe(true);
    });

    it('logs a failed fetch rather than letting it escape', async () => {
      build();
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(container.fetchTasks({ getProperty: () => 9 })).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalled();
      expect(container.tasksLoaded()).toBe(false);
    });
  });

  describe('distances', () => {
    it('counts the walked streets plus the labeler\'s progress on the current one, in the user\'s unit', () => {
      build([makeTask(2), makeTask(3)]);
      task(2).complete();
      task(3).giveUpOnImagery();
      position = latLng(at(40));

      // The furthest point is updated as the distance is read, so the current street's 40 m count.
      expect(container.getCompletedTaskDistance()).toBeCloseTo(0.24, 2);
      expect(container.getCurrentTaskDistance()).toBeCloseTo(0.04, 2);
    });

    it('stops counting progress on the current street once it is done or given up on', () => {
      build();
      task(1).complete();
      position = latLng(at(40));

      expect(container.getCompletedTaskDistance({ units: 'meters' })).toBeCloseTo(100, 0);

      build();
      task(1).giveUpOnImagery();
      expect(container.getCompletedTaskDistance({ units: 'meters' })).toBeCloseTo(100, 0);
    });

    it('sums every street anyone finished for the community figure, and every street for the total', () => {
      build([makeTask(2, { priority: 0.4 }), makeTask(3, { priority: 0.2 })]);

      expect(container.getAllUsersCompletedTaskDistance()).toBeCloseTo(0.2, 3);
      expect(container.getTotalTaskDistance()).toBeCloseTo(0.3, 3);
      expect(container.getTotalTaskDistance({ units: 'meters' })).toBeCloseTo(300, 0);
      expect(container.hasMaxPriorityTask()).toBe(true);
      task(1).complete();
      expect(container.hasMaxPriorityTask()).toBe(false);
    });

    it('reports no audited distance without a region to measure it in', () => {
      build([], { regionModel: { currentRegion: () => null } });

      container.updateAuditedDistance();

      expect(overallStats.setRegionAuditedDistance).toHaveBeenCalledWith(0);
    });
  });

  describe('the route\'s shape', () => {
    it('runs from the first street\'s start to the last street\'s end, in walking order', () => {
      build([makeTask(2, { route_street_position: 1 })]);
      task(1).setProperty('routeStreetPosition', 0);

      expect(container.getRouteEndpoints()).toEqual({ start: latLng(STREETS[1][0]), finish: latLng(STREETS[2][1]) });
      expect(container.getRoutePathCoordinates()).toEqual([...STREETS[1], ...STREETS[2]]);
    });

    it('has no endpoints and no path before any street is loaded', () => {
      build();
      container._tasks = [];

      expect(container.getRouteEndpoints()).toBeNull();
      expect(container.getRoutePathCoordinates()).toEqual([]);
    });
  });

  it('draws every street at once on page load', () => {
    build([makeTask(2)]);

    container.renderAllTasks();

    expect(minimap.setStreetLines.mock.calls.map(([key]) => key)).toEqual(['street-1', 'street-2']);
  });

  describe('nextTask without a plan', () => {
    it('jumps to the highest-priority street when there is no finished street to connect from', () => {
      build([makeTask(2, { priority: 0.5 }), makeTask(3, { priority: 0.9 })]);
      task(1).complete();

      expect(container.nextTask(null)).toBe(task(3));
    });

    it('takes the higher-priority of two connected streets', () => {
      // Streets 2 and 6 both leave street 1's far end; 6 heads north from it.
      build([makeTask(2, { priority: 0.8 }), makeTask(6, { priority: 0.9 })]);
      task(1).complete();

      expect(container.nextTask(task(1))).toBe(task(6));
    });

    it('keeps a jump target\'s direction when its own end leads on to another street', () => {
      // Street 4 connects to nothing behind it but to street 5 ahead, so turning it around would face a dead end.
      build([makeTask(4), makeTask(5)]);
      task(1).complete();

      expect(container.nextTask(task(1))).toBe(task(4));
      expect(task(4).getProperty('startPointReversed')).toBe(false);
    });
  });

  describe('the TaskStart log line', () => {
    it('says when a street is a re-audit, on a fresh street and a resumed one alike', () => {
      build([makeTask(2, { needs_reaudit: true })]);

      container.setCurrentTask(task(2));
      expect(tracker.push).toHaveBeenLastCalledWith('TaskStart', { reaudit: true });

      container._tasks.push(makeTask(3, { needs_reaudit: true, audit_task_id: 5, completed: false }));
      task(3).markFromTaskList();
      container.setCurrentTask(task(3));
      expect(tracker.push).toHaveBeenLastCalledWith('TaskStart',
        { resumed: true, auditTaskId: 5, source: 'switch', reaudit: true });
    });
  });

  describe('planWalk', () => {
    /** Loads the given streets through fetchTasks, as the page does, which also builds the first plan. */
    async function load(features, options) {
      build([], options);
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ features }) })));
      await container.fetchTasks({ getProperty: () => 9, pushATaskToTheRoute: vi.fn() });
    }

    it('drops the plan when nothing is left to walk, and still tells the preview', async () => {
      await load([]);
      const changed = vi.fn();
      container.onWalkPlanChanged(changed);
      expect(container.hasWalkPlan()).toBe(true);
      task(1).complete();

      expect(container.planWalk('priority')).toBe(false);

      expect(container.hasWalkPlan()).toBe(false);
      expect(container.getPlannedStepsAhead()).toEqual([]);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('logs a planner that throws something other than an Error without crashing', async () => {
      const failure = 'no: plan, today';
      FakeWalkPlanner.plan = () => { throw failure; };
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await load([feature(2)]);

      expect(container.hasWalkPlan()).toBe(false);
      expect(tracker.push).toHaveBeenCalledWith('WalkPlan_Failed',
        { reason: 'load', error: 'Error', message: 'no plan today' });
    });

    it('starts from the current street\'s end when the viewer has no position yet', async () => {
      await load([feature(2)]);
      task(1).giveUpOnImagery();
      position = null;
      let start;
      FakeWalkPlanner.plan = (streets, from) => {
        start = from;
        return { steps: streets.map((s) => ({ id: s.id, reverse: false })), stats: { totalM: 0, ms: 0 } };
      };

      expect(container.planWalk('giveUp')).toBe(true);

      expect(start).toEqual({ from: STREETS[1][1] });
      // The current street is off the plan, so every planned step is ahead.
      expect(container.getPlannedStepsAhead().map(({ task: t }) => t.getStreetEdgeId())).toEqual([2]);
    });

    it('follows the plan past a street it never saw, which sorts last', async () => {
      await load([feature(2)]);
      container._tasks.push(makeTask(3, { priority: 1 }));
      task(1).complete();

      expect(container.nextTask(task(1))).toBe(task(2));
    });

    it('does not replan a priority change when only the current street is left to walk', async () => {
      await load([]);
      tracker.push.mockClear();

      container.updateTaskPriorities([{ street_edge_id: 1, priority: 0.5 }]);

      expect(tracker.push).not.toHaveBeenCalled();
      expect(task(1).getStreetPriority()).toBe(0.5);
    });

    it('treats a missing tolerance as none when judging the top tier', async () => {
      await load([feature(2, { priority: 0.5 }), feature(3, { priority: 0.5 })],
        { config: { walkPlanner: undefined } });
      tracker.push.mockClear();

      // With no tolerance, only the single best street is the tier, so this change reshapes it.
      container.updateTaskPriorities([{ street_edge_id: 3, priority: 0.6 }]);

      expect(tracker.push).toHaveBeenCalledWith('WalkPlan_Created', expect.objectContaining({ reason: 'priority' }));
    });
  });
});
