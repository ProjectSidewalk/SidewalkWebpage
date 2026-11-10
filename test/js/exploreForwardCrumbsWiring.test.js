/**
 * How the minimap's forward crumbs follow the rest of Explore (#5840): the POV, move and street-change events they
 * redraw on, the hover tie to the on-pano arrows, the crumbs drawn for arrow destinations, the fill and tint classes
 * as the user turns and advances, when no route stops are sampled at all, and what a provider that stops answering
 * or a pano the provider refuses to serve does to them.
 *
 * Built like forwardCrumbsLifecycle: fakes of the collaborators, a scripted provider, real turf for the sampling.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoManager, fakeTaskContainer } from './fakes.js';

mockModule('i18next', () => ({
  default: { t: (key, options) => (options && 'rank' in options ? `${key}#${options.rank}` : key) },
}));

/** Stands in for a marker made by Minimap.addMarker: records where it is, its options, and whether it was removed. */
class FakeMarker {
  static created = [];

  constructor(latLng, content, options) {
    Object.assign(this, options, { latLng, content });
    this.element = document.createElement('div');
    this.element.appendChild(content);
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

/** A task for a straight street of `lengthM` metres, with the user's furthest point at `furthestM`. */
function makeTask(streetEdgeId, { lengthM = 200, furthestM = 0, complete = false } = {}) {
  const feature = turf.lineString([[START_LNG, LAT], [START_LNG + lengthM / M_PER_DEG_LNG, LAT]]);
  return {
    getStreetEdgeId: () => streetEdgeId,
    getWalkOrder: () => null,
    getProperty: () => false,
    isComplete: () => complete,
    getGeoJSON: () => feature,
    getFurthestPointReached: () => turf.point([START_LNG + furthestM / M_PER_DEG_LNG, LAT]),
  };
}

describe('ForwardCrumbs wiring', () => {
  let ForwardCrumbs;
  let viewer;
  let nav;
  let navArrows;
  let streetSweep;
  let compass;
  let tracker;
  let crumbs;
  let task;
  let config;
  let listeners;
  let panosAlongStreet;
  let links;

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

  /** A link from the current pano to a pano `meters` along the street, `heading` degrees from north. */
  const link = (panoId, heading, meters) => ({ panoId, heading, lat: LAT, lng: lngAt(meters) });

  beforeEach(async () => {
    FakeMarker.created = [];
    panosAlongStreet = new Map([[20, 'p20'], [40, 'p40'], [60, 'p60'], [80, 'p80'], [100, 'p100']]);
    links = [];
    task = makeTask(1);
    config = { isOnboarding: false, isExploreAddressMode: false };
    listeners = {};
    const { Gate } = await loadModules('frontend/js/common/Gate.js');
    ({ ForwardCrumbs } = await loadModules('frontend/js/explore/navigation/ForwardCrumbs.js'));
    nav = {
      walking: new Gate(),
      canWalk: () => true,
      onMoved: (listener) => { listeners.moved = listener; },
      moveToPano: vi.fn(async () => true),
      moveToLocation: vi.fn(async () => true),
      returnToPano: vi.fn(async () => true),
    };
    navArrows = {
      onHover: (listener) => { listeners.hover = listener; },
      highlightTo: vi.fn(),
      clearHighlight: vi.fn(),
      setWalkLanding: vi.fn(),
    };
    compass = { isEnRoute: () => true, getTargetAngle: () => 90 };
    // Stands in for the sweep's search: the first pano past the furthest point reached.
    streetSweep = {
      findLanding: vi.fn(async (walked) => {
        const furthestM = metersAt(walked.getFurthestPointReached().geometry.coordinates[0]);
        const next = [...panosAlongStreet].find(([meters]) => meters > furthestM + 5);
        return next ? { panoId: next[1], lat: LAT, lng: lngAt(next[0]) } : null;
      }),
    };
    tracker = fakeTracker();
    viewer = {
      supportsLocationSearch: () => true,
      findPanoNear: vi.fn(async (latLng) => nearestPano(latLng)),
      getLinkedPanoPositions: vi.fn(async () => links),
      getPanoId: () => 'standing-here',
      getPosition: () => ({ lat: LAT, lng: lngAt(0) }),
      getPov: () => ({ heading: 0 }),
    };
    const panoManager = fakePanoManager(viewer, { onPovChanged: (listener) => { listeners.pov = listener; } });
    crumbs = new ForwardCrumbs(
      config,
      panoManager,
      fakeTaskContainer(() => task, { onCurrentTaskChanged: (listener) => { listeners.taskChanged = listener; } }),
      compass,
      { addMarker: (latLng, content, options) => new FakeMarker(latLng, content, options) },
      { hasVisited: () => false },
      nav,
      streetSweep,
      navArrows,
      tracker,
    );
  });

  const onMap = () => FakeMarker.created.filter((marker) => !marker.removed);
  const markerAt = (meters) => onMap().find((marker) => Math.abs(marker.latLng.lng - lngAt(meters)) < 1e-9);
  const classesAt = (meters) => [...markerAt(meters).content.classList];
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  describe('redraws', () => {
    it('after a move, and when another street becomes current', async () => {
      expect(onMap()).toEqual([]);

      listeners.moved();
      await settle();
      expect(onMap().length).toBeGreaterThan(0);

      task = makeTask(2, { lengthM: 50 });
      panosAlongStreet = new Map([[30, 'q30']]);
      listeners.taskChanged();
      await settle();
      expect(onMap().map((marker) => marker.title)).toEqual(['audit:right-ui.minimap.forward-crumb-title#1']);
    });

    it('nothing in the tutorial, whose street is scripted', async () => {
      config.isOnboarding = true;

      await crumbs.refresh();

      expect(onMap()).toEqual([]);
      expect(viewer.findPanoNear).not.toHaveBeenCalled();
    });

    it('only the arrow destinations in free exploration, where there is no route to sample', async () => {
      config.isExploreAddressMode = true;
      links = [link('east', 90, 30)];

      await crumbs.refresh();

      expect(viewer.findPanoNear).not.toHaveBeenCalled();
      expect(onMap().map((marker) => marker.title)).toEqual(['audit:right-ui.minimap.link-crumb-title']);
      expect(classesAt(30)).not.toContain('minimap-crumb-next');
    });

    it('no route stops on a provider that cannot search by location, or once the street is finished', async () => {
      viewer.supportsLocationSearch = () => false;
      await crumbs.refresh();
      expect(viewer.findPanoNear).not.toHaveBeenCalled();

      viewer.supportsLocationSearch = () => true;
      task = makeTask(1, { complete: true });
      await crumbs.refresh();
      expect(viewer.findPanoNear).not.toHaveBeenCalled();
      expect(onMap()).toEqual([]);
    });

    it('keeps an error to a warning, since it runs beside the move it must never break', async () => {
      viewer.getPanoId = () => { throw new Error('no viewer'); };
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(crumbs.refresh()).resolves.toBeUndefined();

      expect(console.warn).toHaveBeenCalledWith('Minimap crumbs could not be refreshed:', expect.any(Error));
    });
  });

  describe('arrow destinations', () => {
    it('are drawn as link crumbs that light their arrow when hovered or focused', async () => {
      links = [link('side', 180, 55)];

      await crumbs.refresh();

      const marker = markerAt(55);
      expect(marker.zIndex).toBe(25);
      expect(classesAt(55)).toEqual(['minimap-crumb', 'minimap-crumb-link']);
      marker.content.dispatchEvent(new window.Event('mouseenter'));
      expect(navArrows.highlightTo).toHaveBeenCalledWith('side', false);
      marker.content.dispatchEvent(new window.Event('mouseleave'));
      expect(navArrows.clearHighlight).toHaveBeenCalledTimes(1);
      marker.element.dispatchEvent(new window.Event('focus'));
      expect(navArrows.highlightTo).toHaveBeenCalledTimes(2);
      marker.element.dispatchEvent(new window.Event('blur'));
      expect(navArrows.clearHighlight).toHaveBeenCalledTimes(2);
    });

    it('are left out, with a warning, when the provider cannot position them', async () => {
      viewer.getLinkedPanoPositions = async () => { throw new Error('no links'); };
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await crumbs.refresh();

      expect(onMap().every((marker) => marker.content.classList.contains('minimap-crumb-route'))).toBe(true);
      expect(console.warn).toHaveBeenCalledWith('Could not position the current pano\'s links:', expect.any(Error));
    });
  });

  describe('the faced crumb', () => {
    it('fills in as the user turns toward a link, and empties as they turn away', async () => {
      // The east arrow leads to the first route stop, so that crumb is both.
      links = [link('p20', 90, 20), link('north', 0, 0)];
      await crumbs.refresh();
      // Standing at 0 facing north: the north link, not the route stop at 20 m.
      expect(classesAt(20)).not.toContain('minimap-crumb-faced');
      expect(classesAt(0)).toContain('minimap-crumb-faced');

      listeners.pov(100);
      expect(classesAt(20)).toContain('minimap-crumb-faced');
      listeners.pov(110); // Still the same crumb: nothing to redo.
      expect(classesAt(20)).toContain('minimap-crumb-faced');

      listeners.pov(180); // No link that way, and not the route's direction.
      expect(classesAt(20)).not.toContain('minimap-crumb-faced');
    });

    it('fills nothing off the route, even facing the route\'s direction at a dead end', async () => {
      compass.isEnRoute = () => false;
      await crumbs.refresh();

      listeners.pov(90);

      expect(onMap().some((marker) => marker.content.classList.contains('minimap-crumb-faced'))).toBe(false);
    });
  });

  describe('the next-step tint', () => {
    it('moves to the stop the spacebar now leads to as the user advances', async () => {
      await crumbs.refresh();
      expect(classesAt(20)).toContain('minimap-crumb-next');

      task = makeTask(1, { furthestM: 30 });
      viewer.getPosition = () => ({ lat: LAT, lng: lngAt(30) });
      await crumbs.refresh();

      expect(markerAt(20)).toBeUndefined();
      expect(classesAt(40)).toContain('minimap-crumb-next');
    });

    it('tints nothing when the compass cannot say which way the route goes', async () => {
      compass.getTargetAngle = () => { throw new Error('no task geometry yet'); };

      await crumbs.refresh();

      expect(onMap().some((marker) => marker.content.classList.contains('minimap-crumb-next'))).toBe(false);
      expect(crumbs.isWalkNextStop('p20')).toBe(true);
    });
  });

  describe('telling the on-pano arrows where the route walk lands', () => {
    it('names the landing and which way it is, for the pano the user stands on', async () => {
      await crumbs.refresh();

      const [forPanoId, landing] = navArrows.setWalkLanding.mock.lastCall;
      expect(forPanoId).toBe('standing-here');
      expect(landing.panoId).toBe('p20');
      expect(landing.heading).toBeCloseTo(90, 0); // The street runs east.
    });

    it('says there is none when no pano is ahead, or when the walk\'s search went unanswered', async () => {
      panosAlongStreet = new Map();
      await crumbs.refresh();
      expect(navArrows.setWalkLanding).toHaveBeenLastCalledWith('standing-here', null);

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      streetSweep.findLanding.mockRejectedValue(new Error('provider down'));
      await crumbs.refresh();
      expect(navArrows.setWalkLanding).toHaveBeenLastCalledWith('standing-here', null);
    });

    it('draws a crumb for a landing too far off the street to be a stop, as the first stop on the route', async () => {
      const offStreet = { panoId: 'corner', lat: LAT + 20 / 111320, lng: lngAt(10) };
      streetSweep.findLanding.mockResolvedValue(offStreet);
      await crumbs.refresh();

      const corner = onMap().find((marker) => marker.latLng.lat === offStreet.lat);
      expect(corner.title).toBe('audit:right-ui.minimap.forward-crumb-title#1');
      expect([...corner.content.classList]).toContain('minimap-crumb-next');
      expect(navArrows.setWalkLanding.mock.lastCall[1].panoId).toBe('corner');
    });

    it('keeps a landing worked out for a pano the user has since left to itself', async () => {
      streetSweep.findLanding.mockImplementation(async () => {
        viewer.getPanoId = () => 'moved-on';
        return { panoId: 'p20', lat: LAT, lng: lngAt(20) };
      });
      await crumbs.refresh();
      expect(navArrows.setWalkLanding).not.toHaveBeenCalled();
    });

    it('tells the arrows as soon as the landing is known, without waiting for the route stops', async () => {
      let stopsAnswered = false;
      const sampled = viewer.findPanoNear;
      viewer.findPanoNear = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        stopsAnswered = true;
        return sampled(...args);
      };
      navArrows.setWalkLanding.mockImplementation(() => expect(stopsAnswered).toBe(false));
      await crumbs.refresh();
      expect(navArrows.setWalkLanding).toHaveBeenCalledTimes(1);
    });

    it('says there is none when the crumbs could not be worked out at all', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      viewer.getPosition = () => { throw new Error('no position yet'); };
      await crumbs.refresh();
      expect(navArrows.setWalkLanding).toHaveBeenLastCalledWith('standing-here', null);
    });
  });

  describe('highlighting from the on-pano arrows', () => {
    it('outlines the crumb an arrow leads to, the route stop for the forward arrow, and clears', async () => {
      links = [link('side', 0, 55)];
      await crumbs.refresh();

      listeners.hover({ panoId: 'side' });
      listeners.hover({ panoId: 'side' }); // Hovering on: nothing to redo.
      expect(classesAt(55)).toContain('minimap-crumb-highlight');

      listeners.hover({}); // The synthesized route-forward arrow.
      expect(classesAt(55)).not.toContain('minimap-crumb-highlight');
      expect(classesAt(20)).toContain('minimap-crumb-highlight');

      listeners.hover(null);
      expect(classesAt(20)).not.toContain('minimap-crumb-highlight');
      listeners.hover(null); // Nothing highlighted: nothing to clear.
    });

    it('ignores a pano no crumb marks, and the forward arrow when the walk has no next stop', async () => {
      panosAlongStreet = new Map();
      await crumbs.refresh();

      crumbs.highlight('nowhere');
      crumbs.highlightNextStop();

      expect(onMap()).toEqual([]);
    });

    it('forgets a faced or outlined crumb whose marker is rebuilt', async () => {
      links = [link('p20', 90, 20)];
      await crumbs.refresh();
      listeners.pov(90);
      crumbs.highlight('p40');
      expect(classesAt(20)).toContain('minimap-crumb-faced');
      expect(classesAt(40)).toContain('minimap-crumb-highlight');

      // A step past the first stop: the stop behind becomes a plain arrow destination and every other stop moves
      // up a rank, so each marker is rebuilt. Neither the fill nor the outline may point at a marker that is gone.
      task = makeTask(1, { furthestM: 30 });
      viewer.getPosition = () => ({ lat: LAT, lng: lngAt(30) });
      await crumbs.refresh();

      expect(classesAt(20)).toContain('minimap-crumb-link');
      expect(classesAt(20)).not.toContain('minimap-crumb-faced');
      expect(classesAt(40)).not.toContain('minimap-crumb-highlight');
      crumbs.clearHighlight();
      expect(onMap().some((marker) => marker.content.classList.contains('minimap-crumb-highlight'))).toBe(false);
    });
  });

  describe('a provider that stops answering', () => {
    it('is not asked about the rest of the street, but what it did answer is shown', async () => {
      task = makeTask(1, { furthestM: 50 });
      viewer.getPosition = () => ({ lat: LAT, lng: lngAt(50) });
      let answered = 0;
      viewer.findPanoNear = vi.fn(async (latLng) => {
        if (++answered > 2) throw new Error('timed out');
        return nearestPano(latLng);
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await crumbs.refresh();
      const asked = viewer.findPanoNear.mock.calls.length;
      expect(onMap().length).toBeGreaterThan(0);

      // Backtracking brings earlier sample points into range; they are skipped while the provider is down.
      viewer.getPosition = () => ({ lat: LAT, lng: lngAt(0) });
      await crumbs.refresh();

      expect(viewer.findPanoNear.mock.calls.length).toBe(asked);
    });
  });

  describe('stepping to a crumb', () => {
    it('falls back to a coordinate search when the pano no longer loads', async () => {
      nav.moveToPano = vi.fn(async () => false);
      await crumbs.refresh();

      markerAt(20).onClick();
      await settle();

      expect(nav.moveToLocation).toHaveBeenCalledWith({ lat: LAT, lng: lngAt(20) });
      expect(tracker.push).toHaveBeenCalledWith('ForwardCrumbMove_Fallback', { panoId: 'p20' });
    });

    it('does nothing while walking is refused', async () => {
      nav.canWalk = () => false;
      await crumbs.refresh();

      markerAt(20).onClick();
      await settle();

      expect(nav.moveToPano).not.toHaveBeenCalled();
      expect(tracker.push).not.toHaveBeenCalled();
    });
  });
});
