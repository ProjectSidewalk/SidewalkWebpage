/**
 * Explore's mission-complete screen (frontend/js/explore/modal/ModalMissionComplete.js) (#5840): the title and badge
 * it shows, the numbers in its stats table, how the streets walked are split into the map's three tiers, which
 * labels go on the map, and what each of its two buttons does once the next mission has loaded.
 *
 * The streets are real Tasks on straight streets, so the tier slicing is turf's; the map is a stand-in that only
 * keeps whatever it was handed.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakePanoManager, fakeTaskContainer, navigationAttempts } from './fakes.js';
import { routeFetch, flush, sentRequests } from './support/routeFetch.js';

// The two formatter keys are rendered the way the real ones would be, so a stat reads as the user sees it.
mockModule('i18next', () => ({
  default: {
    t: (key, opts) => {
      if (key === 'common:format-number') return String(opts.val);
      if (key === 'common:distance-large') return `${opts.dist} km`;
      return opts ? `${key} ${Object.values(opts).join(' ')}` : key;
    },
  },
}));
const toastShow = vi.fn();
mockModule('frontend/js/common/Toast.js', () => ({ Toast: { show: toastShow } }));

const el = (id) => document.getElementById(id);
const START = [-122.33, 47.6];
const STREET_M = 200;

/** A straight street `lengthM` long heading due east from `start`, as [lng, lat] pairs. */
const straightStreet = (start, lengthM) => (
  [start, turf.destination(turf.point(start), lengthM / 1000, 90).geometry.coordinates]
);

/** The {lat, lng} `alongM` east of the street's start. */
const pointAlong = (start, alongM) => {
  const [lng, lat] = turf.destination(turf.point(start), alongM / 1000, 90).geometry.coordinates;
  return { lat, lng };
};

/** @returns {number} The length of a line's coordinates in meters. */
const lengthM = (coords) => turf.length(turf.lineString(coords), { units: 'meters' });

describe('ModalMissionComplete', () => {
  let Task;
  let Mission;
  let modal;
  let map;
  let regionModel;
  let missionContainer;
  let missionModel;
  let taskContainer;
  let labelContainer;
  let overallStats;
  let missionPanel;
  let missionProgressBar;
  let minimapMissionProgress;
  let audio;
  let lock;
  let currentMission;
  let currentTask;
  let walked;
  let unwalked;
  let community;
  let liveMissionCount;
  let labels;
  let region;
  let mission;

  const MISSION_ID = 10;

  /** A real Task on a straight street with the given id, starting `startLng` east of START if given. */
  const street = (id, { start = START, complete = false } = {}) => new Task({
    type: 'Feature',
    properties: { street_edge_id: id, completed: complete, task_start: '2026-01-01T00:00:00Z', priority: 1 },
    geometry: { type: 'LineString', coordinates: straightStreet(start, STREET_M).map((c) => [...c]) },
  }, {}, false);

  /** A listener registry the container and model stand-ins share, so a test can fire what Explore would. */
  const emitter = () => {
    const listeners = {};
    return {
      on: (event, cb) => { listeners[event] = cb; },
      fire: (event, ...args) => listeners[event]?.(...args),
    };
  };

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="modal-mission-complete-holder">
        <div id="modal-mission-complete-background"></div>
        <div id="modal-mission-complete-foreground">
          <img id="modal-mission-complete-badge" alt="">
          <h1 id="modal-mission-complete-title"></h1>
          <p id="modal-mission-complete-subtitle"></p>
          <ul id="modal-mission-complete-label-legend"></ul>
          <li id="modal-mission-complete-legend-community"></li>
          <span id="modal-mission-complete-distance-all"></span>
          <span id="modal-mission-complete-distance-you"></span>
          <span id="modal-mission-complete-labels-all"></span>
          <span id="modal-mission-complete-labels-you"></span>
          <button type="button" id="modal-mission-complete-close-button-secondary"></button>
          <button type="button" id="modal-mission-complete-close-button-primary"></button>
        </div>
      </div>`;
    useUtil({ distanceToString: (meters) => `${Math.round(meters)} m`, turfDistanceUnits: () => 'kilometers' });
    ({ Task, Mission } = await loadModules('frontend/js/explore/task/Task.js',
      'frontend/js/explore/mission/Mission.js'));
    const { ModalMissionComplete } = await loadModules('frontend/js/explore/modal/ModalMissionComplete.js');

    mission = new Mission({ missionId: MISSION_ID, missionType: 'audit', regionId: 7, distance: 400 });
    region = { getRegionId: () => 7, getProperty: () => 'Ballard' };
    currentMission = { next: true };
    currentTask = street(1);
    walked = [];
    unwalked = [];
    community = [];
    liveMissionCount = null;
    labels = [];
    regionModel = {
      isRoute: false, isRouteComplete: null, isRegionComplete: false, isRouteOrRegionComplete: () => false,
    };
    missionContainer = {
      ...emitter(), getMissionsCompletedThisSession: () => 2, getCurrentMission: () => currentMission,
    };
    missionModel = emitter();
    taskContainer = fakeTaskContainer(() => currentTask, {
      getAllUsersCompletedTaskDistance: () => 12.345,
      getCompletedTaskDistance: () => 3.4,
      getWalkedTasks: () => walked,
      getUnwalkedTasks: () => unwalked,
      getCompletedTasksAllUsersUsingPriority: () => community,
    });
    labelContainer = { countLabels: () => 17, getAllLabels: () => labels };
    overallStats = { getLiveMissionCount: vi.fn(() => liveMissionCount) };
    missionPanel = { setMessage: vi.fn() };
    missionProgressBar = { update: vi.fn() };
    minimapMissionProgress = { reset: vi.fn() };
    audio = { load: vi.fn(), play: vi.fn() };
    lock = fakeGate();
    map = { update: vi.fn(async () => {}), resize: vi.fn() };
    modal = new ModalMissionComplete(missionContainer, missionModel, taskContainer, regionModel, labelContainer,
      overallStats, missionPanel, missionProgressBar, minimapMissionProgress, audio,
      fakePanoManager({
        getPosition: () => ({ lat: 47.61, lng: -122.31 }), getPanoId: () => 'p1', getPov: () => ({ heading: 45 }),
      }), lock, map);
  });

  /** What the modal handed the map on its last update. */
  const mapUpdate = () => {
    const [tiers, labelData] = map.update.mock.calls.at(-1);
    return { tiers, labelData };
  };

  it('starts hidden, with the sidebar and minimap mission bars reset for the next mission', () => {
    expect(modal.isOpen()).toBe(false);
    expect(el('modal-mission-complete-holder').style.visibility).toBe('hidden');
    expect(missionProgressBar.update).toHaveBeenCalledWith(0);
    expect(minimapMissionProgress.reset).toHaveBeenCalledWith(currentMission);
  });

  describe('update', () => {
    it('titles a plain mission generically and says how far it went in the region', () => {
      routeFetch({ '/label/countInRegion': { label_count: 900 } });
      modal.update(mission, region);

      expect(el('modal-mission-complete-title').textContent).toBe('mission-complete.title-generic');
      expect(el('modal-mission-complete-subtitle').textContent).toBe('mission-complete.subtitle 400 m Ballard');
    });

    it('titles a finished region by name, and a finished route ahead of that', () => {
      routeFetch({ '/label/countInRegion': { label_count: 900 } });
      regionModel.isRegionComplete = true;
      modal.update(mission, region);
      expect(el('modal-mission-complete-title').textContent).toBe('mission-complete.title-region-complete Ballard');

      regionModel.isRouteComplete = true;
      modal.update(mission, region);
      expect(el('modal-mission-complete-title').textContent).toBe('mission-complete.title-route-complete');
    });

    it('shows the badge for the user\'s all-time mission count, or the first badge before one is earned', () => {
      routeFetch({ '/label/countInRegion': { label_count: 900 } });
      liveMissionCount = 30; // Past the second threshold.
      modal.update(mission, region);
      expect(el('modal-mission-complete-badge').src).toContain('badge_missions_badge2.svg');
      expect(el('modal-mission-complete-badge').alt).toBe('mission-complete.badge-alt');

      liveMissionCount = null; // Stats not loaded: the session's two missions earn nothing yet.
      modal.update(mission, region);
      expect(el('modal-mission-complete-badge').src).toContain('badge_missions_badge1.svg');
    });

    it('fills the stats from the client and fetches only the region\'s label total', async () => {
      const fetchStub = routeFetch({ '/label/countInRegion': { label_count: 1234 } });

      modal.update(mission, region);
      await flush();

      expect(sentRequests(fetchStub).map((r) => r.url)).toEqual(['/label/countInRegion?regionId=7']);
      expect(el('modal-mission-complete-distance-all').textContent).toBe('mission-complete.stat-distance-all 12.3 km');
      expect(el('modal-mission-complete-distance-you').textContent).toBe('mission-complete.stat-distance-you 3.4 km');
      expect(el('modal-mission-complete-labels-you').textContent).toBe('mission-complete.stat-labels-you 17');
      expect(el('modal-mission-complete-labels-all').textContent).toBe('mission-complete.stat-labels-all 1234');
      expect(el('modal-mission-complete-distance-all').style.display).toBe('');
      expect(el('modal-mission-complete-legend-community').style.display).toBe('');
    });

    it('logs a failed label count and leaves the stat empty', async () => {
      routeFetch({ '/label/countInRegion': new Error('offline') });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      modal.update(mission, region);
      await flush();

      expect(error).toHaveBeenCalledWith('Failed to load the region label count.', expect.any(Error));
      expect(el('modal-mission-complete-labels-all').textContent).toBe('');
    });

    it('hides the community figures on a route, which has none, and asks the server for nothing', () => {
      const fetchStub = routeFetch({});
      regionModel.isRoute = true;

      modal.update(mission, region);

      expect(fetchStub).not.toHaveBeenCalled();
      expect(el('modal-mission-complete-distance-all').style.display).toBe('none');
      expect(el('modal-mission-complete-labels-all').style.display).toBe('none');
      expect(el('modal-mission-complete-legend-community').style.display).toBe('none');
    });

    it('builds the label legend once, one entry per label type in its color', () => {
      routeFetch({ '/label/countInRegion': { label_count: 1 } });
      modal.update(mission, region);
      modal.update(mission, region);

      const items = [...el('modal-mission-complete-label-legend').children];
      expect(items.length).toBe(window.labelTypes.length);
      const curbRamp = items[window.labelTypes.findIndex((labelType) => labelType.name === 'CurbRamp')];
      expect(curbRamp.textContent).toBe('common:curb-ramp');
      expect(curbRamp.querySelector('.mission-complete__legend-dot').style.backgroundColor).toBe('rgb(144, 195, 31)');
    });

    it('logs a map that failed to draw rather than breaking the screen', async () => {
      routeFetch({ '/label/countInRegion': { label_count: 1 } });
      map.update.mockRejectedValue(new Error('no WebGL'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      modal.update(mission, region);
      await flush();

      expect(error).toHaveBeenCalledWith('Failed to render the mission-complete map.', expect.any(Error));
    });
  });

  describe('the map\'s street tiers', () => {
    beforeEach(() => { routeFetch({ '/label/countInRegion': { label_count: 1 } }); });

    it('draws the current street from where the mission began to its end, and the stretch before as earlier', () => {
      currentTask.setMissionStart(MISSION_ID, pointAlong(START, 50));
      currentTask.complete();
      walked = [currentTask];

      modal.update(mission, region);

      const { tiers } = mapUpdate();
      expect(tiers.thisMission.features).toHaveLength(1);
      expect(lengthM(tiers.thisMission.features[0].geometry.coordinates)).toBeCloseTo(150, 0);
      expect(tiers.previous.features).toHaveLength(1);
      expect(lengthM(tiers.previous.features[0].geometry.coordinates)).toBeCloseTo(50, 0);
    });

    it('draws a street walked whole in this mission as the whole street', () => {
      currentTask.complete();

      modal.update(mission, region);

      const { tiers } = mapUpdate();
      expect(tiers.thisMission.features[0].geometry.coordinates).toEqual(straightStreet(START, STREET_M));
      expect(tiers.previous.features).toEqual([]);
    });

    it('draws an unfinished street up to the furthest point reached, with its walked start as earlier work', () => {
      currentTask.setMissionStart(MISSION_ID, pointAlong(START, 40));
      currentTask.updateTheFurthestPointReached(pointAlong(START, 120));

      modal.update(mission, region);

      const { tiers } = mapUpdate();
      expect(lengthM(tiers.thisMission.features[0].geometry.coordinates)).toBeCloseTo(80, 0);
      expect(lengthM(tiers.previous.features[0].geometry.coordinates)).toBeCloseTo(40, 0);
    });

    it('gives a street reached by a jump and never walked no length, from its start to its start (#4204)', () => {
      modal.update(mission, region);
      expect(mapUpdate().tiers.thisMission.features[0].geometry.coordinates).toEqual([START, START]);
    });

    it('does not draw the stretch before a mission that began at the street\'s very start', () => {
      currentTask.setMissionStart(MISSION_ID, pointAlong(START, 1));
      currentTask.complete();
      walked = [currentTask];

      modal.update(mission, region);

      expect(mapUpdate().tiers.previous.features).toEqual([]);
    });

    it('draws other streets the user walked whole as earlier work, and skips a mission street without a start', () => {
      const other = street(2, { start: [-122.3, 47.7], complete: true });
      currentTask.complete();
      walked = [other, currentTask];

      modal.update(mission, region);

      const { tiers } = mapUpdate();
      expect(tiers.previous.features).toEqual([other.getGeoJSON()]);
    });

    it('shows everyone\'s finished streets as the community tier, or the route\'s remaining ones on a route', () => {
      community = [street(5, { start: [-122.3, 47.7] })];
      unwalked = [street(6, { start: [-122.2, 47.7] })];

      modal.update(mission, region);
      expect(mapUpdate().tiers.community.features).toEqual([community[0].getGeoJSON()]);

      regionModel.isRoute = true;
      modal.update(mission, region);
      expect(mapUpdate().tiers.community.features).toEqual([unwalked[0].getGeoJSON()]);
    });

    it('keeps a street with a bad or lone coordinate off the map, where it would crash the tiler (#4204)', () => {
      const broken = street(5);
      broken.getGeoJSON().geometry.coordinates[1] = [NaN, 47.6];
      const lone = street(6);
      lone.getGeoJSON().geometry.coordinates.pop();
      community = [broken, lone, { getGeoJSON: () => null }];

      modal.update(mission, region);

      expect(mapUpdate().tiers.community.features).toEqual([]);
    });
  });

  describe('the map\'s labels', () => {
    it('shows the labels placed in this mission that were not deleted, as unvalidated points', () => {
      routeFetch({ '/label/countInRegion': { label_count: 1 } });
      const label = (temporaryLabelId, missionId, deleted = false) => ({
        isDeleted: () => deleted,
        getProperty: (key) => ({ missionId, temporaryLabelId })[key],
        getLabelType: () => 'CurbRamp',
        toLatLng: () => ({ lat: 47.6, lng: -122.33 }),
      });
      labels = [label(1, MISSION_ID), label(2, 9), label(3, MISSION_ID, true)];

      modal.update(mission, region);

      expect(mapUpdate().labelData).toEqual({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.33, 47.6] },
          properties: { label_id: 1, label_type: 'CurbRamp', correct: null, has_validations: false },
        }],
      });
    });
  });

  describe('show', () => {
    it('opens over the stopped tool with the chime, and resizes the map now that it is visible', () => {
      modal.show();

      expect(modal.isOpen()).toBe(true);
      expect(el('modal-mission-complete-holder').style.visibility).toBe('visible');
      expect(el('modal-mission-complete-foreground').style.visibility).toBe('visible');
      expect(el('modal-mission-complete-background').style.visibility).toBe('visible');
      expect(audio.play).toHaveBeenCalledWith('success');
      expect(lock.hold).toHaveBeenCalledWith('mission-complete');
      expect(map.resize).toHaveBeenCalled();
      expect(el('modal-mission-complete-close-button-secondary').textContent)
        .toBe('mission-complete.button-try-validation');
    });

    it('offers the next mission only once it has loaded', () => {
      missionModel.fire('MissionProgress:complete');
      modal.show();
      const primary = el('modal-mission-complete-close-button-primary');
      expect(primary.textContent).toBe('mission-complete.button-next-mission');
      expect(primary.disabled).toBe(true);
      expect(el('modal-mission-complete-close-button-secondary').disabled).toBe(false);

      missionContainer.fire('MissionContainer:missionLoaded');
      expect(primary.disabled).toBe(false);
    });

    it('offers the next mission at once when it had loaded before the screen came up', () => {
      missionContainer.fire('MissionContainer:missionLoaded');
      modal.show();
      expect(el('modal-mission-complete-close-button-primary').disabled).toBe(false);
    });

    it('offers to keep exploring here after a route, and a fresh area after a region, both at once', () => {
      regionModel.isRouteComplete = true;
      modal.show();
      const primary = el('modal-mission-complete-close-button-primary');
      expect(primary.textContent).toBe('mission-complete.button-keep-exploring-here');
      expect(primary.disabled).toBe(false);

      regionModel.isRouteComplete = null;
      regionModel.isRouteOrRegionComplete = () => true;
      modal.show();
      expect(primary.textContent).toBe('mission-complete.button-next-mission');
      expect(primary.disabled).toBe(false);
    });

    it('celebrates a mission badge the user just crossed into', () => {
      liveMissionCount = 5;
      modal.show();
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
        reference: el('modal-mission-complete-foreground'), icon: expect.stringContaining('badge_missions_badge1'),
      }));
    });

    it('celebrates nothing without a new badge, or before the user\'s count is known', () => {
      liveMissionCount = 6;
      modal.show();
      liveMissionCount = null;
      modal.show();
      expect(toastShow).not.toHaveBeenCalled();
    });
  });

  describe('the buttons', () => {
    const primary = () => el('modal-mission-complete-close-button-primary');
    const secondary = () => el('modal-mission-complete-close-button-secondary');

    it('goes on to the next mission: the sidebar is re-headed, the tool released, the screen gone', () => {
      missionContainer.fire('MissionContainer:missionLoaded');
      const navigations = navigationAttempts();
      modal.show();

      primary().click();

      expect(navigations).not.toHaveBeenCalled();
      expect(missionPanel.setMessage).toHaveBeenCalledWith(currentMission);
      expect(lock.release).toHaveBeenCalledWith('mission-complete');
      expect(modal.isOpen()).toBe(false);
      expect(el('modal-mission-complete-holder').style.visibility).toBe('hidden');
    });

    it('leaves for Validate from the secondary button', () => {
      const navigations = navigationAttempts();
      modal.show();
      secondary().click();
      expect(navigations).toHaveBeenCalledTimes(1);
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('reloads Explore for a fresh area once the region is done', () => {
      regionModel.isRouteOrRegionComplete = () => true;
      const navigations = navigationAttempts();
      modal.show();
      primary().click();
      expect(navigations).toHaveBeenCalledTimes(1);
    });

    it('reloads Explore seeded at the pano and heading a finished route ended on', () => {
      regionModel.isRouteComplete = true;
      const navigations = navigationAttempts();
      modal.show();
      primary().click();
      expect(navigations).toHaveBeenCalledTimes(1);
    });
  });
});
