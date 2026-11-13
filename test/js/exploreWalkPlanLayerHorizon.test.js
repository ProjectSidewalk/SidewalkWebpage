/**
 * The walk-plan preview's horizon before the page has a mission or a current street (#5840): with no mission the
 * preview still reaches its minimum distance, and with no current street it starts at the first street ahead.
 */

import { loadModules } from './loader.js';

/** A planned street of `lengthM` metres that starts where street `id - 1` ends, so the row has no jump in it. */
function makeTask(id, lengthM = 100) {
  return {
    id,
    plannedAhead: false,
    lineDistance: () => lengthM,
    getAuditedDistance: () => 0,
    getStartCoordinate: () => ({ lat: 47.6, lng: -122.33 + id * 0.001 }),
    getEndCoordinate: () => ({ lat: 47.6, lng: -122.33 + (id + 1) * 0.001 }),
    getEntryCoordinate: () => ({ lat: 47.6, lng: -122.33 + id * 0.001 }),
    isResumed: () => false,
    isLeftToWalk: () => true,
    setPlannedAhead(value) {
      this.plannedAhead = value;
    },
  };
}

describe('WalkPlanLayer before the mission and street are known', () => {
  let layer;
  let tasks;

  beforeEach(async () => {
    const { WalkPlanLayer } = await loadModules('frontend/js/explore/navigation/WalkPlanLayer.js');
    tasks = [1, 2, 3, 4, 5].map((id) => makeTask(id));
    const taskContainer = {
      getCurrentTask: () => null,
      getPlannedStepsAhead: (limit) => tasks.slice(0, limit).map((task) => ({ task, step: { id: task.id } })),
      renderTask: vi.fn(),
      onWalkPlanChanged: vi.fn(),
      onCurrentTaskChanged: vi.fn(),
      onTaskEnded: vi.fn(),
    };
    layer = new WalkPlanLayer(taskContainer, { getCurrentMission: () => null, on: vi.fn() });
  });

  it('previews the minimum 250 m with no mission to measure against, starting at the first street ahead', () => {
    layer.refresh();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true, false, false]);
  });
});
