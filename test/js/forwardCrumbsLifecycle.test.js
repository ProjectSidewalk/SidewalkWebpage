/**
 * The stateful half of the minimap's crumbs (#4669): what ForwardCrumbs does with its markers over time, driven
 * through refresh()/clear()/click with a stubbed Minimap.addMarker and a scripted provider.
 *
 * Four behaviours the pure-static suite (forwardCrumbsWindowing) cannot reach:
 *   - a route stop that renumbers as the user advances gets a marker with the new rank in its tooltip;
 *   - clear() disowns a refresh still waiting on lookups, so nothing reappears after the mission-complete modal
 *     has cleared the map;
 *   - lookups queued for a street the user has left are skipped, not run ahead of the next street's;
 *   - a far crumb over a visited pano takes over the breadcrumb's job and peeks back on click.
 *
 * Built against fakes of its collaborators, on real turf: the sampler's along-street math is part of what is tested.
 */

import { loadVendored, loadModules } from './loader.js';
import { fakeTracker, fakePanoManager, fakeTaskContainer } from './fakes.js';

loadVendored('turf');
const { turf } = window;

/** Stands in for a marker made by Minimap.addMarker: records where it is, its options, and whether it was removed. */
class FakeMarker {
  static created = [];

  constructor(latLng, content, options) {
    Object.assign(this, options, { latLng, content });
    this.element = document.createElement('div');
    this.removed = false;
    FakeMarker.created.push(this);
  }

  remove() {
    this.removed = true;
  }
}

// A street running east along one latitude; positions are named by metres from its start.
const LAT = 47.6;
const START_LNG = -122.33;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const metersAt = (lng) => (lng - START_LNG) * M_PER_DEG_LNG;

/** A task for a straight street of `lengthM` metres at latitude `lat`, with the user's furthest point at `furthestM`. */
function makeTask(streetEdgeId, { lengthM = 500, lat = LAT, furthestM = 0 } = {}) {
  const feature = turf.lineString([[START_LNG, lat], [START_LNG + lengthM / M_PER_DEG_LNG, lat]]);
  return {
    getStreetEdgeId: () => streetEdgeId,
    getWalkOrder: () => null,
    getProperty: () => false,
    isComplete: () => false,
    getFeature: () => feature,
    getFurthestPointReached: () => turf.point([START_LNG + furthestM / M_PER_DEG_LNG, lat]),
  };
}

describe('ForwardCrumbs marker lifecycle', () => {
  let viewer;
  let nav;
  let tracker;
  let crumbs;
  let task;
  let panosAlongStreet; // metres from the street start -> pano id, what the scripted provider knows.
  let visited;

  /** The provider's answer at a sample point: the nearest known pano within the 25 m search radius. */
  const nearestPano = ({ lat, lng }) => {
    const here = metersAt(lng);
    let best = null;
    for (const [meters, panoId] of panosAlongStreet) {
      const away = Math.abs(meters - here);
      if (away <= 25 && (!best || away < best.away)) best = { away, panoId, lat, lng: lngAt(meters) };
    }
    return best ? { panoId: best.panoId, lat: best.lat, lng: best.lng } : null;
  };

  beforeEach(async () => {
    FakeMarker.created = [];
    panosAlongStreet = new Map([[20, 'p20'], [40, 'p40'], [60, 'p60'], [80, 'p80'], [100, 'p100']]);
    visited = new Set();
    task = makeTask(1);
    const { ForwardCrumbs, Gate } = await loadModules('frontend/js/explore/navigation/ForwardCrumbs.js',
      'frontend/js/common/Gate.js');
    nav = {
      walking: new Gate(),
      canWalk: () => true,
      onMoved: () => {},
      moveToPano: vi.fn(async () => true),
      moveToLocation: vi.fn(async () => true),
      returnToPano: vi.fn(async () => true),
    };
    tracker = fakeTracker();
    viewer = {
      supportsLocationSearch: () => true,
      findPanoNear: vi.fn(async (latLng) => nearestPano(latLng)),
      getLinkedPanoPositions: async () => [],
      getPanoId: () => 'standing-here',
      getPosition: () => ({ lat: LAT, lng: lngAt(0) }),
      getPov: () => ({ heading: 0 }),
    };
    const panoManager = fakePanoManager(viewer);
    window.i18next = { t: (key, options) => (options && 'rank' in options ? `${key}#${options.rank}` : key) };
    crumbs = new ForwardCrumbs(
      { isOnboarding: false, isExploreAddressMode: false },
      panoManager,
      fakeTaskContainer(() => task),
      { isEnRoute: () => true, getTargetAngle: () => 90 },
      { addMarker: (latLng, content, options) => new FakeMarker(latLng, content, options) },
      { hasVisited: (panoId) => visited.has(panoId) },
      nav,
      { onHover: () => {}, highlightTo: () => {}, clearHighlight: () => {} },
      tracker,
    );
  });

  const onMap = () => FakeMarker.created.filter((marker) => !marker.removed);

  /** Releases deferred lookups until the queue stops producing new ones (each batch released lets more start). */
  const releaseAll = async (pending) => {
    while (pending.length > 0) {
      pending.splice(0).forEach(({ resolve }) => resolve());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const titleOf = (lng) => onMap().find((marker) => Math.abs(marker.latLng.lng - lng) < 1e-9)?.title;

  test('a stop that renumbers as the user advances gets a marker with the new rank in its tooltip', async () => {
    await crumbs.refresh();
    expect(titleOf(lngAt(40))).toBe('audit:right-ui.minimap.forward-crumb-title#2');
    expect(titleOf(lngAt(80))).toBe('audit:right-ui.minimap.route-stop-title#4');
    expect(titleOf(lngAt(100))).toBe('audit:right-ui.minimap.route-stop-title#5');

    // One step forward: the first stop is behind now, everything else moves up a rank.
    task = makeTask(1, { furthestM: 30 });
    viewer.getPosition = () => ({ lat: LAT, lng: lngAt(30) });
    await crumbs.refresh();

    expect(titleOf(lngAt(20))).toBeUndefined();
    expect(titleOf(lngAt(40))).toBe('audit:right-ui.minimap.forward-crumb-title#1');
    expect(titleOf(lngAt(80))).toBe('audit:right-ui.minimap.forward-crumb-title#3');
    expect(titleOf(lngAt(100))).toBe('audit:right-ui.minimap.route-stop-title#4');
    // The second refresh made no provider calls: every sample point on the street was already memoised.
    const callsAfterFirst = viewer.findPanoNear.mock.calls.length;
    await crumbs.refresh();
    expect(viewer.findPanoNear.mock.calls.length).toBe(callsAfterFirst);
  });

  test('clear() disowns a refresh still waiting on lookups, so nothing reappears afterwards', async () => {
    const pending = [];
    viewer.findPanoNear = vi.fn((latLng) => new Promise((resolve) => {
      pending.push({ latLng, resolve: () => resolve(nearestPano(latLng)) });
    }));

    const refreshing = crumbs.refresh();
    crumbs.clear(); // The mission-complete modal, say, while the street's lookups are still in flight.
    await releaseAll(pending);
    await refreshing;

    expect(onMap()).toEqual([]);
  });

  test('lookups queued for a street the user has left are skipped, not run ahead of the next street\'s', async () => {
    const pending = [];
    viewer.findPanoNear = vi.fn((latLng) => new Promise((resolve) => {
      pending.push({ latLng, resolve: () => resolve(nearestPano(latLng)) });
    }));
    const streetOneLat = LAT;
    const streetTwoLat = LAT + 0.01;

    task = makeTask(1, { lengthM: 2000 }); // 100 sample points: 4 in flight, 96 queued.
    const first = crumbs.refresh();
    expect(viewer.findPanoNear).toHaveBeenCalledTimes(4);

    task = makeTask(2, { lengthM: 50, lat: streetTwoLat }); // The next street.
    viewer.getPosition = () => ({ lat: streetTwoLat, lng: lngAt(0) });
    const second = crumbs.refresh();

    // Let street one's four in-flight lookups answer; the queue then drains, skipping street one's leftovers.
    await releaseAll(pending);
    await Promise.all([first, second]);

    // Sample points follow a great circle, so their latitude drifts a hair along the street: match by nearness.
    const calls = viewer.findPanoNear.mock.calls.map(([latLng]) => latLng.lat);
    const near = (target) => (lat) => Math.abs(lat - target) < 0.001;
    expect(calls.filter(near(streetOneLat))).toHaveLength(4);
    expect(calls.filter(near(streetTwoLat)).length).toBeGreaterThan(0);
  });

  test('a pop-up\'s hold on walking clears the crumbs, and letting go redraws them', async () => {
    await crumbs.refresh();
    const drawn = onMap().length;
    expect(drawn).toBeGreaterThan(0);

    nav.walking.hold('interaction');
    expect(onMap()).toEqual([]);

    nav.walking.release('interaction');
    for (let i = 0; i < 10 && onMap().length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onMap()).toHaveLength(drawn);
  });

  test('a far crumb over a visited pano peeks back on click, as the breadcrumb under it would', async () => {
    visited.add('p100'); // Rank 5: beyond the clickable window, and already stood on.
    await crumbs.refresh();

    const far = onMap().find((marker) => Math.abs(marker.latLng.lng - lngAt(100)) < 1e-9);
    expect(far.onClick).toEqual(expect.any(Function));
    expect(far.title).toBe('audit:right-ui.minimap.breadcrumb-title');
    far.onClick();
    expect(nav.returnToPano).toHaveBeenCalledWith('p100');
    expect(nav.moveToPano).not.toHaveBeenCalled();
    expect(tracker.push).toHaveBeenCalledWith('Click_MinimapBreadcrumb', { panoId: 'p100' });
  });

  test('a clickable crumb steps forward on click and reports its kind and rank', async () => {
    await crumbs.refresh();
    const second = onMap().find((marker) => Math.abs(marker.latLng.lng - lngAt(40)) < 1e-9);
    second.onClick();
    await Promise.resolve();
    expect(nav.moveToPano).toHaveBeenCalledWith('p40', false, { alertOnFailure: false });
    expect(tracker.push).toHaveBeenCalledWith('Click_MinimapForwardCrumb', { panoId: 'p40', kind: 'route', rank: 2 });
  });
});
