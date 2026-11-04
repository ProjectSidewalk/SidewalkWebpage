/**
 * Explore's region value object and the model that says whether the region or route is done
 * (frontend/js/explore/region/Region.js and RegionModel.js, #5840): which of the two flags a walk uses, and the log
 * row that finishing leaves behind.
 */

import { loadModules } from './loader.js';
import { fakeTracker } from './fakes.js';

describe('Region', () => {
  let Region;

  beforeEach(async () => {
    ({ Region } = await loadModules('frontend/js/explore/region/Region.js'));
  });

  it('takes the id and name it is given and leaves the rest null', () => {
    const region = new Region({ regionId: 12, name: 'Ballard' });
    expect(region.getRegionId()).toBe(12);
    expect(region.regionId).toBe(12);
    expect(region.getProperty('name')).toBe('Ballard');
    expect(region.getProperty('other')).toBeNull();
  });

  it('can be built from nothing and filled in later, chaining', () => {
    const region = new Region({});
    expect(region.getRegionId()).toBeNull();
    expect(region.getProperty('name')).toBeNull();
    expect(region.setProperty('name', 'Fremont').getProperty('name')).toBe('Fremont');
  });
});

describe('RegionModel', () => {
  let RegionModel;
  let tracker;

  beforeEach(async () => {
    ({ RegionModel } = await loadModules('frontend/js/explore/region/RegionModel.js'));
    tracker = fakeTracker();
  });

  it('is a route walk when given a route id, and tracks only the route flag', () => {
    const model = new RegionModel(55, tracker);
    expect(model.isRoute).toBe(true);
    expect(model.isRouteComplete).toBe(false);
    expect(model.isRegionComplete).toBeNull();
    expect(model.isRouteOrRegionComplete()).toBeFalsy();

    model.setComplete();

    expect(model.isRouteComplete).toBe(true);
    expect(model.isRouteOrRegionComplete()).toBe(true);
    expect(tracker.push).toHaveBeenCalledWith('RouteComplete', { UserRouteId: 55 });
  });

  it('is a region audit without one (null or undefined), and tracks only the region flag', () => {
    for (const model of [new RegionModel(null, tracker), new RegionModel(undefined, tracker)]) {
      expect(model.isRoute).toBe(false);
      expect(model.isRouteComplete).toBeNull();
      expect(model.isRegionComplete).toBe(false);
    }
  });

  it('finishes a region and logs it by id', () => {
    const model = new RegionModel(null, tracker);
    model.setCurrentRegion({ getRegionId: () => 12 });
    expect(model.currentRegion().getRegionId()).toBe(12);

    model.setComplete();

    expect(model.isRegionComplete).toBe(true);
    expect(model.isRouteOrRegionComplete()).toBe(true);
    expect(tracker.push).toHaveBeenCalledWith('NeighborhoodComplete_ByUser', { RegionId: 12 });
  });

  it('cannot finish a region it has not been told about', () => {
    const model = new RegionModel(null, tracker);
    expect(model.currentRegion()).toBeNull();

    model.setComplete();

    expect(model.isRegionComplete).toBe(false);
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('remembers once everyone together has covered the region', () => {
    const model = new RegionModel(null, tracker);
    expect(model.getRegionCompleteAcrossAllUsers()).toBe(false);
    model.setRegionCompleteAcrossAllUsers();
    expect(model.getRegionCompleteAcrossAllUsers()).toBe(true);
  });
});
