/**
 * Where StreetSweep pre-downloads the next forward move from (#5840): one step past the furthest point reached while
 * the labeler stands near it, the furthest point itself from further away (the search then starts there to bring them
 * back), and which panos the preload is told to skip.
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
    };
    sweep = new StreetSweep({}, {}, {}, { getPanoData: (panoId) => panos[panoId] }, fakePanoManager(viewer), {}, {},
      {}, fakeTracker());
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
});
