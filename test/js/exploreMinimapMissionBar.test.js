/**
 * The mission's progress on the minimap (frontend/js/explore/navigation/MinimapMissionProgress.js, #5840): the bar
 * along its top edge, hidden for a mission with no distance target; and when the start and finish flags are planted,
 * moved or hidden, including a route's own endpoint flags. The flags across a mission boundary, through the real
 * Minimap, are minimapMissionFlags.test.js's; here the minimap records what it is asked to plant.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule } from './loader.js';
import { fakeTaskContainer } from './fakes.js';

mockModule('i18next', () => ({
  default: { t: (key, options) => (options ? `${key}|${options.done}/${options.total}` : key) },
}));

describe('MinimapMissionProgress', () => {
  let MinimapMissionProgress;
  let ui;
  let config;
  let regionModel;
  let task;
  let tasks;
  let minimap;
  let markers;

  // A 500 m street running east along one latitude, with the labeler at its start.
  const LAT = 47.6;
  const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
  const lngAt = (meters) => -122.33 + meters / M_PER_DEG_LNG;
  const metersAt = (lng) => (lng + 122.33) * M_PER_DEG_LNG;

  /** A mission by its id, distance target and progress, both in meters. */
  const mission = (missionId, distanceM, progressM) => ({
    getProperty: (key) => ({ missionId, distanceProgress: progressM })[key],
    getDistance: () => distanceM,
  });

  beforeEach(async () => {
    ({ MinimapMissionProgress } = await loadModules('frontend/js/explore/navigation/MinimapMissionProgress.js'));
    const el = () => document.createElement('div');
    ui = {
      missionProgress: el(), missionProgressFill: el(), missionProgressPercent: el(), missionProgressDistance: el(),
    };
    config = { isOnboarding: false, isExploreAddressMode: false };
    regionModel = { isRoute: false };
    task = {
      getMissionStart: (missionId) => (missionId === 1 ? { lat: LAT, lng: lngAt(0) } : null),
      unwalkedRemainder: () => turf.lineString([[lngAt(0), LAT], [lngAt(500), LAT]]),
    };
    tasks = [task];
    markers = [];
    minimap = {
      addMarker: vi.fn((latLng, content, options) => {
        const marker = { latLng, content, options, visible: true, setLatLng: vi.fn(), setVisible: vi.fn() };
        markers.push(marker);
        return marker;
      }),
    };
  });

  const build = () => new MinimapMissionProgress(ui, config, regionModel, fakeTaskContainer(() => task, {
    getTasks: () => tasks,
  }), { getMissionCompletionRate: (m) => m.getProperty('distanceProgress') / m.getDistance() }, minimap);

  const flag = (title) => markers.find((marker) => marker.options.title === title);
  const START = 'audit:right-ui.minimap.mission-start-flag';
  const FINISH = 'audit:right-ui.minimap.mission-finish-flag';

  describe('the bar', () => {
    test('fills to the mission\'s completion and names the distance so far out of the target', () => {
      build().update(mission(1, 500, 325));
      expect(ui.missionProgress.style.display).toBe('');
      expect(ui.missionProgressFill.style.width).toBe('65%');
      expect(ui.missionProgressPercent.textContent).toBe('65%');
      expect(ui.missionProgressDistance.textContent).toBe('common:distance-progress|325/500');
      expect(ui.missionProgress.getAttribute('aria-valuenow')).toBe('65');
    });

    test('the distance shown never runs below nothing or past the target', () => {
      const progress = build();
      progress.update(mission(1, 500, undefined));
      expect(ui.missionProgressDistance.textContent).toBe('common:distance-progress|0/500');
      progress.update(mission(1, 500, 640));
      expect(ui.missionProgressDistance.textContent).toBe('common:distance-progress|500/500');
    });

    test('free exploration has no target, so the bar is hidden, and shown again for a real mission', () => {
      const progress = build();
      progress.update(mission(1, 0, 0));
      expect(ui.missionProgress.style.display).toBe('none');
      expect(ui.missionProgressFill.style.width).toBe('');
      progress.update(mission(1, 500, 0));
      expect(ui.missionProgress.style.display).toBe('');
    });

    test('a reset shows nothing done out of the new target, or nothing at all without a mission', () => {
      const progress = build();
      progress.update(mission(1, 500, 325));
      progress.reset(mission(2, 800, 0));
      expect(ui.missionProgressFill.style.width).toBe('0%');
      expect(ui.missionProgressPercent.textContent).toBe('0%');
      expect(ui.missionProgress.getAttribute('aria-valuenow')).toBe('0');
      expect(ui.missionProgressDistance.textContent).toBe('common:distance-progress|0/800');

      progress.reset();
      expect(ui.missionProgressDistance.textContent).toBe('');
    });
  });

  describe('the flags', () => {
    test('the start flag stands where the mission began; the finish where its distance runs out on this street', () => {
      build().update(mission(1, 300, 100));
      expect(metersAt(flag(START).latLng.lng)).toBeCloseTo(0, 0);
      expect(metersAt(flag(FINISH).latLng.lng)).toBeCloseTo(200, 0);
      expect(flag(START).content.tagName).toBe('IMG');
      expect(flag(START).content.src).toContain('/assets/images/icons/routebuilder/flag-start.svg');
      expect(flag(START).content.alt).toBe(START);
      expect(flag(START).content.style.width).toBe('27px');
      expect(flag(START).options.anchor).toBe('bottom');
    });

    test('the finish waits while the distance left outruns the street, and is hidden again if it does later', () => {
      const progress = build();
      progress.update(mission(1, 900, 100));
      expect(flag(FINISH)).toBeUndefined();

      progress.update(mission(1, 300, 100));
      expect(flag(FINISH).setVisible).not.toHaveBeenCalled();

      progress.update(mission(1, 900, 100));
      expect(flag(FINISH).setVisible).toHaveBeenLastCalledWith(false);
      expect(minimap.addMarker).toHaveBeenCalledTimes(2);
    });

    test('a start no street recorded plants no start flag, and hides one already planted', () => {
      const progress = build();
      progress.update(mission(2, 300, 100));
      expect(flag(START)).toBeUndefined();

      progress.update(mission(1, 300, 100));
      progress.update(mission(2, 300, 100));
      expect(flag(START).setVisible).toHaveBeenLastCalledWith(false);
    });

    test.each([
      ['a route', () => { regionModel.isRoute = true; }],
      ['the tutorial', () => { config.isOnboarding = true; }],
      ['free exploration', () => { config.isExploreAddressMode = true; }],
    ])('%s has no mission to frame, so no flags are planted', (_name, arrange) => {
      arrange();
      build().update(mission(1, 300, 100));
      expect(minimap.addMarker).not.toHaveBeenCalled();
    });

    test('there is no finish without a target or a street', () => {
      expect(MinimapMissionProgress.missionFinish(mission(1, 0, 0), task)).toBeNull();
      expect(MinimapMissionProgress.missionFinish(mission(1, 300, 0), null)).toBeNull();
    });

    test('a route\'s own flags are planted at its two ends', () => {
      build().showRouteEndpoints({ lat: 1, lng: 2 }, { lat: 3, lng: 4 });
      expect(markers.map((marker) => [marker.latLng, marker.options.title])).toEqual([
        [{ lat: 1, lng: 2 }, 'audit:right-ui.minimap.route-start-flag'],
        [{ lat: 3, lng: 4 }, 'audit:right-ui.minimap.route-finish-flag'],
      ]);
      expect(markers[1].content.src).toContain('/assets/images/icons/routebuilder/flag-end.svg');
    });
  });
});
