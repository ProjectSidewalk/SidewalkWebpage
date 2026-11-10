/**
 * Where StreetSweep pre-downloads the next forward move from (#5840): one step past the furthest point reached while
 * the labeler stands near it, the furthest point itself from further away (the search then starts there to bring them
 * back), and which panos the preload is told to skip. And where it says the next move would land, without moving.
 *
 * Real Task and turf: the step is a distance along a real street.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';
import { fakePanoManager, fakeTracker } from './fakes.js';

const START = [-77.02, 38.9];
const COVERAGE = { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 };

/** The point `alongM` east of START, as [lng, lat]. */
const along = (alongM) => turf.destination(turf.point(START), alongM / 1000, 90).geometry.coordinates;

/** A straight street `lengthM` long heading due east from START. */
function streetFeature(lengthM) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[...START], along(lengthM)] },
    properties: { street_edge_id: 1, task_start: '2026-10-09T12:00:00Z', current_lng: START[0], current_lat: START[1] },
  };
}

describe('StreetSweep.preloadAhead', () => {
  let Task;
  let sweep;
  let viewer;
  let panos;
  let currentTask;

  const metersAlong = ({ lng, lat }) => turf.distance(turf.point(START), turf.point([lng, lat]), { units: 'meters' });

  beforeEach(async () => {
    let StreetSweep;
    ({ Task, StreetSweep } = await loadModules('frontend/js/explore/task/Task.js',
      'frontend/js/explore/navigation/StreetSweep.js'));
    panos = { 'pano-here': { panoId: 'pano-here' } };
    viewer = {
      getPanoId: () => 'pano-here',
      getPosition: () => ({ lat: START[1], lng: START[0] }),
      preloadPanoNear: vi.fn(),
      findPanoNear: vi.fn(async () => null),
    };
    currentTask = null;
    sweep = new StreetSweep({}, {}, { getCurrentTask: () => currentTask }, { getPanoData: (panoId) => panos[panoId] },
      fakePanoManager(viewer), {}, {}, {}, fakeTracker());
  });

  it('looks one step ahead of the furthest point while the labeler stands at it, skipping the pano they are on', () => {
    sweep.preloadAhead(new Task(streetFeature(200), COVERAGE, false));

    const [latLng, excluded] = viewer.preloadPanoNear.mock.calls[0];
    expect(metersAlong(latLng)).toBeCloseTo(10, 0);
    expect([...excluded]).toEqual([panos['pano-here']]);
  });

  it('looks at the furthest point itself once the labeler has wandered off, with nothing to skip', () => {
    viewer.getPosition = () => {
      const [lng, lat] = turf.destination(turf.point(START), 0.04, 0).geometry.coordinates;
      return { lat, lng };
    };
    viewer.getPanoId = () => 'pano-unknown';

    sweep.preloadAhead(new Task(streetFeature(200), COVERAGE, false));

    const [latLng, excluded] = viewer.preloadPanoNear.mock.calls[0];
    expect(metersAlong(latLng)).toBeCloseTo(0, 0);
    expect([...excluded]).toEqual([]);
  });

  it('stays at the furthest point on a street too short for a step', () => {
    sweep.preloadAhead(new Task(streetFeature(8), COVERAGE, false));

    expect(metersAlong(viewer.preloadPanoNear.mock.calls[0][0])).toBeCloseTo(0, 0);
  });

  describe('findLanding', () => {
    it('answers with the first search point\'s pano, skipping the pano the labeler is on', async () => {
      const hit = { panoId: 'pano-ahead', lat: 38.9, lng: -77.0199 };
      viewer.findPanoNear.mockResolvedValue(hit);

      await expect(sweep.findLanding(new Task(streetFeature(200), COVERAGE, false))).resolves.toBe(hit);

      const [latLng, excluded] = viewer.findPanoNear.mock.calls[0];
      expect(metersAlong(latLng)).toBeCloseTo(10, 0);
      expect([...excluded]).toEqual([panos['pano-here']]);
      expect(viewer.findPanoNear).toHaveBeenCalledTimes(1);
    });

    it('steps on down the street past empty points, as the sweep does, to the first pano found', async () => {
      const hit = { panoId: 'pano-past-the-gap', lat: 38.9, lng: -77.0196 };
      viewer.findPanoNear.mockImplementation(async (latLng) => (metersAlong(latLng) > 35 ? hit : null));

      await expect(sweep.findLanding(new Task(streetFeature(200), COVERAGE, false))).resolves.toBe(hit);

      const searched = viewer.findPanoNear.mock.calls.map(([latLng]) => Math.round(metersAlong(latLng)));
      expect(searched).toEqual([10, 20, 30, 40]);
    });

    it('passes over a pano that gets no further down the street, as an empty point (#5918)', async () => {
      const sideways = { panoId: 'pano-off-to-the-side', lat: along(1)[1] + 0.0001, lng: along(1)[0] };
      const ahead = { panoId: 'pano-ahead', lat: along(30)[1], lng: along(30)[0] };
      viewer.findPanoNear.mockImplementation(async (latLng) => (metersAlong(latLng) > 15 ? ahead : sideways));

      await expect(sweep.findLanding(new Task(streetFeature(200), COVERAGE, false))).resolves.toBe(ahead);
    });

    it('takes any pano when bringing the labeler back from off the route', async () => {
      const [lng, lat] = turf.destination(turf.point(START), 0.04, 0).geometry.coordinates;
      viewer.getPosition = () => ({ lat, lng });
      const atTheStart = { panoId: 'pano-at-the-start', lat: START[1], lng: START[0] };
      viewer.findPanoNear.mockResolvedValue(atTheStart);

      await expect(sweep.findLanding(new Task(streetFeature(200), COVERAGE, false))).resolves.toBe(atTheStart);
    });

    it('answers null once the whole street came up empty, its end included', async () => {
      await expect(sweep.findLanding(new Task(streetFeature(30), COVERAGE, false))).resolves.toBeNull();

      expect(viewer.findPanoNear.mock.calls.map(([latLng]) => Math.round(metersAlong(latLng)))).toEqual([10, 20, 30]);
    });

    it('skips a pano the labeler left by any move, so the next step cannot lead straight back (#5918)', async () => {
      currentTask = new Task(streetFeature(200), COVERAGE, false);
      sweep.rememberStanding();
      panos['pano-next'] = { panoId: 'pano-next' };
      viewer.getPanoId = () => 'pano-next';

      await sweep.findLanding(currentTask);

      expect([...viewer.findPanoNear.mock.calls[0][1]]).toEqual([panos['pano-here'], panos['pano-next']]);
    });

    it('forgets the panos left on another street', async () => {
      currentTask = new Task(streetFeature(200), COVERAGE, false);
      sweep.rememberStanding();
      const otherStreet = streetFeature(200);
      otherStreet.properties.street_edge_id = 2;
      panos['pano-next'] = { panoId: 'pano-next' };
      viewer.getPanoId = () => 'pano-next';

      await sweep.findLanding(new Task(otherStreet, COVERAGE, false));

      expect([...viewer.findPanoNear.mock.calls[0][1]]).toEqual([panos['pano-next']]);
    });

    it('rejects when the provider did not answer: that says nothing about the street', async () => {
      viewer.findPanoNear.mockRejectedValue(new Error('provider down'));
      await expect(sweep.findLanding(new Task(streetFeature(200), COVERAGE, false))).rejects.toThrow('provider down');
    });
  });
});
