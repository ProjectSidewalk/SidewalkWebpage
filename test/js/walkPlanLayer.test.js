/**
 * The minimap preview of a neighborhood mission's planned walk (#5526): which of the streets ahead are drawn as the
 * route ahead, that the preview stops at the first jump (#5918), that a drawing error stays inside the preview, and
 * that a previewed street is drawn exactly as a route's street ahead is.
 *
 * Real turf: whether a gap is a jump is a distance question on real coordinates.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';

const ORIGIN = [-122.33, 47.6];

/** The point `eastM` east and `northM` north of ORIGIN, as {lat, lng}. */
function pt(eastM, northM = 0) {
  const north = turf.destination(turf.point(ORIGIN), northM / 1000, 0).geometry.coordinates;
  const [lng, lat] = turf.destination(turf.point(north), eastM / 1000, 90).geometry.coordinates;
  return { lat, lng };
}

/**
 * A planned street, as WalkPlanLayer sees it: a length, its two ends, how far it has been walked, and the preview flag.
 * @param {number} id - Street id; by default also places the street, `id` km east, so every gap is a jump.
 * @param {object} [options] - `lengthM`, `start` and `end` ({lat, lng}), `walkedM`, and `resumedAt` ({lat, lng}),
 *     which makes the street a part-walked one.
 */
function makeTask(id, { lengthM = 100, start = pt(id * 1000), end = pt(id * 1000 + lengthM), walkedM = 0,
  resumedAt = null } = {}) {
  return {
    id,
    plannedAhead: false,
    lineDistance: () => lengthM,
    getAuditedDistance: () => walkedM,
    getStartCoordinate: () => start,
    getEndCoordinate: () => end,
    getEntryCoordinate: () => resumedAt ?? start,
    isResumed: () => resumedAt !== null,
    isLeftToWalk: () => true,
    setPlannedAhead: vi.fn(function (value) {
      this.plannedAhead = value;
    }),
  };
}

/**
 * Streets laid end to end eastward from ORIGIN, where the default current street ends, so none of them is a jump.
 * @param {number[]} ids - Street ids, in walk order.
 * @param {(id: number) => object} [optionsFor] - Per-street `lengthM` and `walkedM`.
 */
function row(ids, optionsFor = () => ({})) {
  let eastM = 0;
  return ids.map((id) => {
    const { lengthM = 100, ...rest } = optionsFor(id);
    const task = makeTask(id, { lengthM, start: pt(eastM), end: pt(eastM + lengthM), ...rest });
    eastM += lengthM;
    return task;
  });
}

const step = (id, jump = false) => ({ id, reverse: false, jump, jumpM: jump ? 300 : 0 });

describe('WalkPlanLayer.horizonCount', () => {
  let WalkPlanLayer;

  beforeEach(async () => {
    ({ WalkPlanLayer } = await loadModules('frontend/js/explore/navigation/WalkPlanLayer.js'));
  });

  const horizon = (lengthsM, remainingM = 0) => WalkPlanLayer.horizonCount(lengthsM, remainingM);

  it('reaches at least 250 m past the current street', () => {
    expect(horizon([100, 100, 100, 100])).toBe(3);
  });

  it('reaches as far as the mission has left to go', () => {
    expect(horizon(Array(10).fill(100), 420)).toBe(5);
  });

  it('shows at least two streets, however long the first', () => {
    expect(horizon([400, 100, 100])).toBe(2);
  });

  it('stops at eight streets, however much mission is left', () => {
    expect(horizon(Array(20).fill(20), 5000)).toBe(8);
  });

  it('shows what there is when fewer streets remain', () => {
    expect(horizon([30])).toBe(1);
    expect(horizon([])).toBe(0);
  });
});

describe('WalkPlanLayer.refresh', () => {
  let ahead;
  let current;
  let layer;
  let mission;
  let taskContainer;
  let listeners;

  const rendered = (task) => taskContainer.renderTask.mock.calls.filter(([t]) => t === task).length;
  const plan = (tasks) => tasks.map((task) => ({ task, step: step(task.id) }));

  beforeEach(async () => {
    const { WalkPlanLayer } = await loadModules('frontend/js/explore/navigation/WalkPlanLayer.js');
    current = makeTask(0, { start: pt(-100), end: pt(0) });
    ahead = [];
    mission = { getDistance: () => 0, getProperty: () => 0 };
    listeners = {};
    const subscribe = (name) => (listener) => { listeners[name] = listener; };
    taskContainer = {
      getCurrentTask: () => current,
      getPlannedStepsAhead: (limit) => ahead.slice(0, limit),
      renderTask: vi.fn(),
      onWalkPlanChanged: subscribe('walkPlanChanged'),
      onCurrentTaskChanged: subscribe('currentTaskChanged'),
      onTaskEnded: subscribe('taskEnded'),
    };
    const missionContainer = { getCurrentMission: () => mission, on: (name, listener) => subscribe(name)(listener) };
    layer = new WalkPlanLayer(taskContainer, missionContainer);
  });

  it('previews the streets within the horizon as the route ahead, and leaves the rest alone', () => {
    const tasks = row([1, 2, 3, 4]);
    ahead = plan(tasks);

    layer.refresh();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true, false]);
    expect(tasks.slice(0, 3).every((task) => rendered(task) === 1)).toBe(true);
    expect(rendered(tasks[3])).toBe(0);
    expect(layer.getPreviewedTasks()).toEqual(tasks.slice(0, 3));
  });

  it('reaches as far as the mission goes past the current street', () => {
    // 550 m left in the mission, all 100 m of the current street still to walk: 450 m for the streets ahead.
    mission = { getDistance: () => 1000, getProperty: () => 450 };
    const tasks = row([1, 2, 3, 4, 5, 6, 7]);
    ahead = plan(tasks);

    layer.refresh();

    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
  });

  it('counts only the unwalked part of the current street against the mission', () => {
    mission = { getDistance: () => 1000, getProperty: () => 450 };
    current = makeTask(0, { lengthM: 300, start: pt(-300), end: pt(0), walkedM: 250 });
    const tasks = row([1, 2, 3, 4, 5, 6, 7]);
    ahead = plan(tasks);

    layer.refresh();

    // 550 m left, 50 m of it on the current street.
    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
    current = makeTask(0, { lengthM: 300, start: pt(-300), end: pt(0), walkedM: 0 });
    layer.refresh();
    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(3);
  });

  it('counts only the unwalked part of a part-walked street ahead against the mission (#5370)', () => {
    mission = { getDistance: () => 1000, getProperty: () => 450 };
    const tasks = row([1, 2, 3, 4, 5, 6, 7], (id) => (id === 1 ? { lengthM: 300, walkedM: 250 } : {}));
    ahead = plan(tasks);

    layer.refresh();

    // 450 m past the current street: 50 m of street 1, then four whole streets.
    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
  });

  it('stops the preview at the first jump, though the horizon reaches past it (#5918)', () => {
    const tasks = [
      makeTask(1, { lengthM: 50, start: pt(0), end: pt(50) }), // Continues the current street.
      makeTask(2, { lengthM: 50, start: pt(50, 15), end: pt(100, 15) }), // 15 m off: switched seamlessly.
      makeTask(3, { lengthM: 50, start: pt(200, 15), end: pt(250, 15) }), // 100 m on: a jump.
      makeTask(4, { lengthM: 50, start: pt(250, 15), end: pt(300, 15) }), // Continues street 3.
    ];
    ahead = plan(tasks);

    layer.refresh();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, false, false]);
    expect(layer.getPreviewedTasks()).toEqual(tasks.slice(0, 2));
  });

  it('previews nothing when the very next street is a jump away', () => {
    const tasks = [makeTask(1, { start: pt(0, 300), end: pt(100, 300) }), makeTask(2, { start: pt(100, 300) })];
    ahead = plan(tasks);

    layer.refresh();

    expect(layer.getPreviewedTasks()).toEqual([]);
    expect(rendered(tasks[0])).toBe(0);
  });

  it('measures the gap to where a part-walked street was left, not to its start (#5370)', () => {
    // The street starts 300 m away, but was left right where the current one ends.
    const task = makeTask(1, { start: pt(300), end: pt(0, 100), resumedAt: pt(0, 10) });
    ahead = plan([task]);

    layer.refresh();

    expect(layer.getPreviewedTasks()).toEqual([task]);
  });

  it('starts the preview at the next street when the current one was just given up on, wherever that street is', () => {
    current.isLeftToWalk = () => false;
    const tasks = [
      makeTask(1, { start: pt(0, 300), end: pt(100, 300) }),
      makeTask(2, { start: pt(100, 300), end: pt(200, 300) }),
      makeTask(3, { start: pt(0, 600) }),
    ];
    ahead = plan(tasks);

    layer.refresh();

    expect(layer.getPreviewedTasks()).toEqual(tasks.slice(0, 2));
  });

  it('takes down what it drew once the plan moves on, and redraws what it un-previews', () => {
    const tasks = row([1, 2, 3], () => ({ lengthM: 200 }));
    ahead = plan(tasks.slice(0, 2));
    layer.refresh();
    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, false]);

    [current] = tasks;
    ahead = plan(tasks.slice(1));
    layer.refresh();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([false, true, true]);
    // Un-previewed, so drawn again as quiet context.
    expect(rendered(tasks[0])).toBe(2);
  });

  it('clears everything when there is no plan', () => {
    const [task] = row([1]);
    ahead = plan([task]);
    layer.refresh();

    ahead = [];
    layer.refresh();

    expect(task.plannedAhead).toBe(false);
    expect(layer.getPreviewedTasks()).toEqual([]);
  });

  it.each([
    ['the plan is rebuilt', 'walkPlanChanged'],
    ['another street becomes current', 'currentTaskChanged'],
    ['a street ends', 'taskEnded'],
  ])('redraws when %s', (_name, event) => {
    const tasks = row([1, 2, 3]);
    ahead = plan(tasks);

    listeners[event]();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true]);
  });

  it('redraws when a new mission starts, since the horizon is measured against it', () => {
    const tasks = row([1, 2, 3, 4, 5, 6, 7]);
    ahead = plan(tasks);
    layer.refresh();
    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(3);

    // The next mission is fresh: 600 m to go, of which the current street's 100 m come first.
    mission = { getDistance: () => 600, getProperty: () => 0 };
    listeners['MissionContainer:missionLoaded']();

    expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
  });

  it('keeps a drawing error to itself, so a street switch or a submission carries on', () => {
    // Both run inside the submission chain, whose own error handling reloads the page.
    ahead = plan(row([1]));
    taskContainer.renderTask.mockImplementation(() => {
      throw new Error('render failed');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => listeners.currentTaskChanged()).not.toThrow();
    expect(() => listeners.walkPlanChanged()).not.toThrow();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('Task.minimapLines for a street of the planned walk', () => {
  let task;
  const coordinates = [[-122.33, 47.6], [-122.329, 47.6]];

  beforeEach(async () => {
    const { Task } = await loadModules('frontend/js/explore/task/Task.js');
    task = new Task({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coordinates.map((coord) => [...coord]) },
      properties: { street_edge_id: 7, priority: 1, task_start: '2026-09-27T12:00:00Z' },
    }, { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 }, false);
  });

  const lines = () => task.minimapLines({ exploreAddressMode: false, current: false, route: false });

  it('draws a previewed street exactly as a route draws its streets ahead', () => {
    task.setPlannedAhead(true);

    expect(lines()).toEqual([{ kind: 'remaining', coordinates }]);
    expect(lines()).toEqual(task.minimapLines({ exploreAddressMode: false, current: false, route: true }));
  });

  it('draws a street beyond the preview as quiet context', () => {
    expect(lines()).toEqual([{ kind: 'other', coordinates }]);
  });

  it('draws the unwalked half of a previewed part-walked street as the route ahead (#5370)', async () => {
    const { Task } = await loadModules('frontend/js/explore/task/Task.js');
    const midway = { lng: -122.3295, lat: 47.6 };
    task = new Task({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coordinates.map((coord) => [...coord]) },
      properties: {
        street_edge_id: 7, priority: 1, task_start: '2026-09-27T12:00:00Z', audit_task_id: 42, completed: false,
        current_lng: midway.lng, current_lat: midway.lat,
      },
    }, { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 }, false, midway);
    task.setPlannedAhead(true);

    expect(lines().map((line) => line.kind)).toEqual(['completed', 'remaining']);
    task.setPlannedAhead(false);
    expect(lines().map((line) => line.kind)).toEqual(['completed', 'other']);
  });

  it('still draws a completed street as walked, previewed or not', () => {
    task.setPlannedAhead(true);
    task.complete();

    expect(lines()).toEqual([{ kind: 'completed', coordinates }]);
  });
});
