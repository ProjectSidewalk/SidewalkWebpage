/**
 * The case #5968 was reported from, on real data: Google pano DktI3fA6YTTCbhKoiDto3g on S 9th Ave in Tucson (street
 * 1603) comes back with no links, though its northern neighbour links into it. A free-exploration drop-in on it must
 * show one arrow down the street, and that arrow's walk must look for the next pano further on, past the dead end.
 *
 * Real Task, StreetSweep and turf: the heading and the search point are measured on the street's own geometry.
 */

import * as turf from '@turf/turf';
import { loadModules } from './loader.js';
import { fakePanoManager, fakeTaskContainer, fakeTracker } from './fakes.js';

// Street 1603 as /v3/api/streets serves it, north to south.
const S_9TH_AVE = [[-110.9730129, 32.194051], [-110.9730085, 32.1939483], [-110.9730079, 32.1939456],
  [-110.9729922, 32.1934366]];
// Where StreetViewService places the pano, 27 m down the street's 68 m.
const DEAD_END_PANO = { panoId: 'DktI3fA6YTTCbhKoiDto3g', lat: 32.19380414912033, lng: -110.97300852966856 };
const COVERAGE = { pano_window_m: 10, max_hop_m: 50, max_uncovered_m: 50, min_covered_frac: 0.5 };

describe('free exploration on Tucson\'s link-less pano (#5968)', () => {
  let Task;
  let NavArrows;
  let StreetSweep;
  let group;
  let viewer;

  /** The drop-in's street as Main sets it up: built from the session, then told where the labeler stands. */
  const dropIn = () => {
    const task = new Task({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: S_9TH_AVE.map((c) => [...c]) },
      properties: {
        street_edge_id: 1603, task_start: '2026-11-12T13:00:00Z', start_point_reversed: false,
        current_lat: DEAD_END_PANO.lat, current_lng: DEAD_END_PANO.lng,
      },
    }, COVERAGE, false);
    task.updateTheFurthestPointReached(viewer.getPosition());
    return task;
  };

  const arrowHeading = (task) => {
    const arrows = new NavArrows(group, document.getElementById('arrows'),
      { isOnboarding: false, isExploreAddressMode: true }, fakeTaskContainer(() => task, { tasksLoaded: () => true }),
      fakePanoManager(viewer));
    arrows.reset();
    const images = [...group.querySelectorAll('image')];
    expect(images).toHaveLength(1);
    expect(images[0].classList.contains('route-forward-arrow')).toBe(true);
    return Number(images[0].getAttribute('transform').match(/rotate\(([-\d.]+),/)[1]);
  };

  /** Where the arrow's walk looks first, as metres from the pano and the bearing to it. */
  const firstSearchPoint = (task) => {
    const sweep = new StreetSweep({ isExploreAddressMode: true }, {}, { getCurrentTask: () => task },
      { getPanoData: (panoId) => ({ panoId }) }, fakePanoManager(viewer), {}, {}, {}, fakeTracker());
    sweep.preloadAhead(task);
    const [latLng, excluded] = viewer.preloadPanoNear.mock.calls[0];
    const here = turf.point([DEAD_END_PANO.lng, DEAD_END_PANO.lat]);
    const there = turf.point([latLng.lng, latLng.lat]);
    return {
      meters: turf.distance(here, there, { units: 'meters' }),
      bearing: (turf.bearing(here, there) + 360) % 360,
      excluded: [...excluded].map((pano) => pano.panoId),
    };
  };

  beforeEach(async () => {
    ({ Task, NavArrows, StreetSweep } = await loadModules('frontend/js/explore/task/Task.js',
      'frontend/js/explore/panorama/NavArrows.js', 'frontend/js/explore/navigation/StreetSweep.js'));
    document.body.innerHTML = '<div id="arrows"><svg><g id="arrow-group"></g></svg></div>';
    group = document.getElementById('arrow-group');
    viewer = {
      getPanoId: () => DEAD_END_PANO.panoId,
      getPosition: () => ({ lat: DEAD_END_PANO.lat, lng: DEAD_END_PANO.lng }),
      getPov: () => ({ heading: 172.9, pitch: -2.7, zoom: 1.33 }),
      getLinkedPanos: () => [],
      preloadPanoNear: vi.fn(),
      findPanoNear: vi.fn(async () => null),
      supportsLocationSearch: () => true,
      findPanoNearCanMiss: () => false,
    };
  });

  test('the one arrow points south down S 9th Ave, the way the street runs', () => {
    const heading = arrowHeading(dropIn());
    expect(heading).toBeGreaterThan(175);
    expect(heading).toBeLessThan(185);
  });

  test('its walk looks about 10 m further south, and will not land back on the dead-end pano', () => {
    const { meters, bearing, excluded } = firstSearchPoint(dropIn());
    expect(meters).toBeCloseTo(10, 0);
    expect(bearing).toBeGreaterThan(175);
    expect(bearing).toBeLessThan(185);
    expect(excluded).toEqual([DEAD_END_PANO.panoId]);
  });
});
