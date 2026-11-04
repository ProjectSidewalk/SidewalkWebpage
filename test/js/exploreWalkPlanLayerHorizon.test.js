/**
 * The walk-plan preview's horizon before the page has a mission or a current street (#5840): with no mission the
 * preview still reaches its minimum distance, and with no current street the first previewed street starts the
 * path with no connector into it.
 */

import { loadModules } from './loader.js';

/** A planned street of `lengthM` metres with distinct far-apart ends, so any pair of them is a jump. */
function makeTask(id, lengthM = 100) {
  return {
    id,
    plannedAhead: false,
    lineDistance: () => lengthM,
    getAuditedDistance: () => 0,
    getStartCoordinate: () => ({ lat: 47.6, lng: -122.33 + id }),
    getEndCoordinate: () => ({ lat: 47.6, lng: -122.33 + id + 0.001 }),
    getEntryCoordinate: () => ({ lat: 47.6, lng: -122.33 + id }),
    isResumed: () => false,
    isLeftToWalk: () => true,
    setPlannedAhead(value) {
      this.plannedAhead = value;
    },
  };
}

describe('WalkPlanLayer before the mission and street are known', () => {
  let layer;
  let minimap;
  let tasks;

  beforeEach(async () => {
    const { WalkPlanLayer } = await loadModules('frontend/js/explore/navigation/WalkPlanLayer.js');
    tasks = [1, 2, 3, 4, 5].map((id) => makeTask(id));
    minimap = { setStreetLines: vi.fn() };
    const taskContainer = {
      getCurrentTask: () => null,
      getPlannedStepsAhead: (limit) => tasks.slice(0, limit).map((task) => ({ task, step: { id: task.id } })),
      hasWalkPlan: () => true,
      renderTask: vi.fn(),
      onWalkPlanChanged: vi.fn(),
      onCurrentTaskChanged: vi.fn(),
      onTaskEnded: vi.fn(),
    };
    layer = new WalkPlanLayer({ holder: document.createElement('div') }, taskContainer,
      { getCurrentMission: () => null, on: vi.fn() }, minimap);
  });

  it('previews the minimum 250 m with no mission to measure against, with no connector into the first street', () => {
    layer.refresh();

    expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true, false, false]);
    const connectors = minimap.setStreetLines.mock.calls.at(-1)[1];
    // Two jumps between the three previewed streets; none from a current street, since there is none.
    expect(connectors).toHaveLength(2);
    expect(connectors[0].coordinates[0]).toEqual([tasks[0].getEndCoordinate().lng, 47.6]);
  });
});
