/**
 * Explore's mission value object and the model that announces it (frontend/js/explore/mission/Mission.js and
 * MissionModel.js) (#5840): what a mission remembers, how its distance converts, how a mission row from the server
 * becomes one, and which events the model fires.
 */

import { loadModules } from './loader.js';
import { routeFetch, flush, sentRequests } from './support/routeFetch.js';

/** A /completedMissionsInRegion row, as MissionFormats serializes a mission. */
const missionRow = (overrides = {}) => ({
  mission_id: 41,
  mission_type: 'audit',
  region_id: 7,
  completed: true,
  distance_meters: 500,
  distance_progress: 500,
  skipped: false,
  ...overrides,
});

describe('Mission', () => {
  let Mission;

  beforeEach(async () => {
    ({ Mission } = await loadModules('frontend/js/explore/mission/Mission.js'));
  });

  const mission = (overrides = {}) => new Mission({
    missionId: 3, missionType: 'audit', regionId: 9, isComplete: false, distance: 1609.344, distanceProgress: 100,
    skipped: false, ...overrides,
  });

  it('keeps what it was built with and answers null for a property it has no slot for', () => {
    const m = mission();
    expect(m.getProperty('missionId')).toBe(3);
    expect(m.getProperty('regionId')).toBe(9);
    expect(m.getProperty('nope')).toBeNull();
    m.setProperty('distanceProgress', 250);
    expect(m.getProperty('distanceProgress')).toBe(250);
  });

  it('is complete once completed', () => {
    const m = mission();
    expect(m.isComplete()).toBe(false);
    m.complete();
    expect(m.isComplete()).toBe(true);
  });

  it('holds each street once, however many times it is pushed', () => {
    const m = mission();
    const street = (id) => ({ getStreetEdgeId: () => id });
    m.pushATaskToTheRoute(street(1));
    m.pushATaskToTheRoute(street(2));
    m.pushATaskToTheRoute(street(1));
    expect(m.getRoute().map((t) => t.getStreetEdgeId())).toEqual([1, 2]);
  });

  it('converts its distance to the unit asked for, meters by default', () => {
    const m = mission();
    expect(m.getDistance()).toBeCloseTo(1609.344);
    expect(m.getDistance('meters')).toBeCloseTo(1609.344);
    expect(m.getDistance('miles')).toBeCloseTo(1);
    expect(m.getDistance('kilometers')).toBeCloseTo(1.609344);
    expect(m.getDistance('feet')).toBeCloseTo(5280, 0);
  });

  it('answers in meters and complains about a unit it does not know', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mission().getDistance('furlongs')).toBeCloseTo(1609.344);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('furlongs'));
  });
});

describe('MissionModel', () => {
  let model;

  beforeEach(async () => {
    const { MissionModel } = await loadModules('frontend/js/explore/mission/MissionModel.js');
    model = new MissionModel(7);
  });

  it('builds a Mission from a server row and announces it', () => {
    const added = vi.fn();
    model.on('MissionContainer:addAMission', added);

    model.createAMission(missionRow({ completed: false, distance_progress: 120 }));

    const mission = added.mock.calls[0][0];
    expect(mission.getProperty('missionId')).toBe(41);
    expect(mission.getProperty('missionType')).toBe('audit');
    expect(mission.getProperty('regionId')).toBe(7);
    expect(mission.isComplete()).toBe(false);
    expect(mission.getDistance()).toBe(500);
    expect(mission.getProperty('distanceProgress')).toBe(120);
    expect(mission.getProperty('skipped')).toBe(false);
  });

  it('fetches the region\'s finished missions, announces each, then runs the callback', async () => {
    const fetchStub = routeFetch({
      '/completedMissionsInRegion': [missionRow({ mission_id: 1 }), missionRow({ mission_id: 2 })],
    });
    const added = vi.fn();
    const done = vi.fn();
    model.on('MissionContainer:addAMission', added);

    model.fetchCompletedMissionsInRegion(done);
    await flush();

    expect(sentRequests(fetchStub)[0].url).toBe('/completedMissionsInRegion?regionId=7');
    expect(added.mock.calls.map(([m]) => m.getProperty('missionId'))).toEqual([1, 2]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.invocationCallOrder[0]).toBeGreaterThan(added.mock.invocationCallOrder[1]);
  });

  it('fetches without a callback too', async () => {
    routeFetch({ '/completedMissionsInRegion': [missionRow()] });
    const added = vi.fn();
    model.on('MissionContainer:addAMission', added);

    model.fetchCompletedMissionsInRegion();
    await flush();

    expect(added).toHaveBeenCalledTimes(1);
  });

  it('announces completion and progress with what the listeners need', () => {
    const complete = vi.fn();
    const progress = vi.fn();
    model.on('MissionProgress:complete', complete);
    model.on('MissionProgress:update', progress);
    const mission = { id: 'm' };
    const region = { id: 'r' };

    model.completeMission(mission);
    model.updateMissionProgress(mission, region);

    expect(complete).toHaveBeenCalledWith({ mission });
    expect(progress).toHaveBeenCalledWith({ mission, region });
  });
});
