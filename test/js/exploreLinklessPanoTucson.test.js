/**
 * The case #5968 was reported from, on real data: Google pano DktI3fA6YTTCbhKoiDto3g on S 9th Ave in Tucson (street
 * 1603) comes back with no links, though its northern neighbour links into it. A free-exploration drop-in on it must
 * show an arrow each way down the street, and each arrow's step must land on the next pano that way.
 *
 * Real Task, StreetSweep and turf: the headings and the search points are measured on the street's own geometry.
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
  let panoManager;
  let alertController;
  let task;

  const here = turf.point([DEAD_END_PANO.lng, DEAD_END_PANO.lat]);
  /** A position as metres from the dead-end pano and the bearing to it. */
  const fromHere = ({ lat, lng }) => ({
    meters: turf.distance(here, turf.point([lng, lat]), { units: 'meters' }),
    bearing: (turf.bearing(here, turf.point([lng, lat])) + 360) % 360,
  });
  const isSouth = (bearing) => bearing > 175 && bearing < 185;
  const isNorth = (bearing) => bearing > 355 || bearing < 5;

  /** The drawn arrows as {toward, heading}. */
  const drawnArrows = () => {
    const arrows = new NavArrows(group, document.getElementById('arrows'),
      { isOnboarding: false, isExploreAddressMode: true }, fakeTaskContainer(() => task, { tasksLoaded: () => true }),
      panoManager);
    arrows.reset();
    return [...group.querySelectorAll('image')].map((image) => ({
      toward: image.getAttribute('toward'),
      streetWalk: image.classList.contains('street-walk-arrow'),
      heading: Number(image.getAttribute('transform').match(/rotate\(([-\d.]+),/)[1]),
    }));
  };

  const sweep = () => new StreetSweep({ isExploreAddressMode: true }, {}, { getCurrentTask: () => task },
    { getPanoData: (panoId) => ({ panoId }) }, panoManager, alertController, {}, {}, fakeTracker());

  beforeEach(async () => {
    ({ Task, NavArrows, StreetSweep } = await loadModules('frontend/js/explore/task/Task.js',
      'frontend/js/explore/panorama/NavArrows.js', 'frontend/js/explore/navigation/StreetSweep.js'));
    document.body.innerHTML = '<div id="arrows"><svg><g id="arrow-group"></g></svg></div>';
    group = document.getElementById('arrow-group');
    let standingOn = DEAD_END_PANO.panoId;
    viewer = {
      getPanoId: () => standingOn,
      getPosition: () => ({ lat: DEAD_END_PANO.lat, lng: DEAD_END_PANO.lng }),
      getPov: () => ({ heading: 172.9, pitch: -2.7, zoom: 1.33 }),
      getLinkedPanos: () => [],
      // Imagery wherever the search asks, as on a street with full coverage.
      findPanoNear: vi.fn(async (latLng) => ({ panoId: 'pano-found', ...latLng })),
      supportsLocationSearch: () => true,
      findPanoNearCanMiss: () => false,
    };
    panoManager = fakePanoManager(viewer, {
      setPanorama: vi.fn(async (panoId) => { standingOn = panoId; }),
    });
    alertController = { showAlert: vi.fn() };
    // The drop-in's street as Main sets it up: built from the session, then told where the labeler stands.
    task = new Task({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: S_9TH_AVE.map((c) => [...c]) },
      properties: {
        street_edge_id: 1603, task_start: '2026-11-12T13:00:00Z', start_point_reversed: false,
        current_lat: DEAD_END_PANO.lat, current_lng: DEAD_END_PANO.lng,
      },
    }, COVERAGE, false);
    task.updateTheFurthestPointReached(viewer.getPosition());
  });

  test('one arrow points south down S 9th Ave and one north, and neither is a link', () => {
    const arrows = drawnArrows();
    expect(arrows.map((arrow) => arrow.toward)).toEqual(['end', 'start']);
    expect(arrows.every((arrow) => arrow.streetWalk)).toBe(true);
    expect(isSouth(arrows[0].heading)).toBe(true);
    expect(isNorth(arrows[1].heading)).toBe(true);
  });

  test('the south arrow\'s step looks 10 m south, leaves out the dead-end pano, and lands on what it finds', async () => {
    await expect(sweep().stepAlongStreet(true)).resolves.toBe('pano-found');

    const [latLng, excluded] = viewer.findPanoNear.mock.calls[0];
    expect(fromHere(latLng).meters).toBeCloseTo(10, 0);
    expect(isSouth(fromHere(latLng).bearing)).toBe(true);
    expect([...excluded].map((pano) => pano.panoId)).toEqual([DEAD_END_PANO.panoId]);
    expect(panoManager.setPanorama).toHaveBeenCalledWith('pano-found');
    expect(alertController.showAlert).not.toHaveBeenCalled();
  });

  test('the north arrow\'s step looks 10 m north, back over street the labeler never walked', async () => {
    await expect(sweep().stepAlongStreet(false)).resolves.toBe('pano-found');

    const [latLng] = viewer.findPanoNear.mock.calls[0];
    expect(fromHere(latLng).meters).toBeCloseTo(10, 0);
    expect(isNorth(fromHere(latLng).bearing)).toBe(true);
  });

  test('a pano behind the labeler is no step: the search carries on down the street past it', async () => {
    const north = turf.destination(here, 0.008, 0).geometry.coordinates;
    viewer.findPanoNear
      .mockResolvedValueOnce({ panoId: 'pano-behind', lat: north[1], lng: north[0] });

    await expect(sweep().stepAlongStreet(true)).resolves.toBe('pano-found');

    expect(panoManager.setPanorama).not.toHaveBeenCalledWith('pano-behind');
    expect(fromHere(viewer.findPanoNear.mock.calls[1][0]).meters).toBeCloseTo(20, 0);
  });

  test('with no imagery further that way the labeler stays put and is told so', async () => {
    viewer.findPanoNear.mockResolvedValue(null);

    await expect(sweep().stepAlongStreet(true)).resolves.toBeNull();

    // 41 m of street to the south: four 10 m steps and the street's end.
    expect(viewer.findPanoNear).toHaveBeenCalledTimes(5);
    expect(panoManager.setPanorama).not.toHaveBeenCalled();
    expect(alertController.showAlert.mock.calls.map((call) => call[1])).toEqual(['exploreAddressNoImagery']);
  });
});
