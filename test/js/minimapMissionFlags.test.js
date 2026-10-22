/**
 * The minimap's mission flags across a mission boundary (#5378).
 *
 * A neighborhood mission's finish flag is planted where the remaining distance runs out on the current street, and
 * the next mission's start is recorded at the spot the user is standing when it loads — the same spot. So when the
 * mission-complete modal closes, the red finish flag the user just reached should read as the new mission's green
 * start flag straight away, not after their next step re-runs the per-move progress update.
 *
 * MapLibre's Map and Marker and the UI collaborators are stand-ins, so the flags go through the real
 * Minimap.addMarker. Real turf: the along-street math that places the finish flag is part of what is being exercised.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoManager, fakeTaskContainer } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

// jsdom has no 2D canvas; the chevron's pixels aren't under test.
mockModule('frontend/js/explore/navigation/MinimapStyle.js', async (importOriginal) => {
  const actual = await importOriginal();
  actual.MinimapStyle.chevronImage = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  return { ...actual };
});

/**
 * Stands in for maplibregl.Map, just far enough for Minimap.create to finish: a minimap without a map keeps its
 * markers off it, and so would plant no flags here.
 */
class FakeMap {
  addImage() {}

  addSource() {}

  addLayer() {}

  on() {}

  off() {}

  getCanvas() {
    return document.createElement('canvas');
  }

  once(name, handler) {
    if (name === 'style.load') setTimeout(handler, 0);
  }
}

/** Stands in for maplibregl.Marker: records its element and where it was last put. */
class FakeMarker {
  static created = [];

  constructor({ element }) {
    this.element = element;
    FakeMarker.created.push(this);
  }

  setLngLat([lng, lat]) {
    this.position = { lat, lng };
    return this;
  }

  addTo() {
    return this;
  }

  get title() {
    return this.element.getAttribute('data-ps-tooltip');
  }

  get hidden() {
    return this.element.hidden;
  }
}

// A street running east along one latitude; positions are named by metres from its start.
const LAT = 47.6;
const START_LNG = -122.33;
const STREET_LENGTH_M = 500;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const metersAt = (lng) => (lng - START_LNG) * M_PER_DEG_LNG;

/** The one street both missions run along, with the user's furthest point and each mission's recorded start. */
function makeTask({ furthestM = 0, missionStarts = {} } = {}) {
  const feature = turf.lineString([[START_LNG, LAT], [lngAt(STREET_LENGTH_M), LAT]]);
  const furthest = turf.point([lngAt(furthestM), LAT]);
  return {
    getFeature: () => feature,
    getFurthestPointReached: () => furthest,
    getEndCoordinate: () => ({ lat: LAT, lng: lngAt(STREET_LENGTH_M) }),
    getMissionStart: (missionId) => missionStarts[missionId],
    unwalkedRemainder: () => turf.cleanCoords(turf.lineSlice(furthest, turf.point([lngAt(STREET_LENGTH_M), LAT]), feature)),
  };
}

function makeMission(missionId, { distanceM, progressM = 0 }) {
  return {
    getProperty: (key) => ({ missionId, distanceProgress: progressM })[key],
    getDistance: () => distanceM,
  };
}

/** A throwaway element for each progress-bar part the reset touches; nothing here is under test. */
const uiStub = () => document.createElement('div');

describe('Minimap mission flags across a mission boundary', () => {
  let progress;
  let task;

  const flagByTitle = (title) => FakeMarker.created.filter((marker) => marker.title === title).at(-1);

  beforeEach(async () => {
    FakeMarker.created = [];
    mockModule('maplibre-gl',
      () => ({ Map: FakeMap, Marker: FakeMarker, addProtocol: () => {}, setWorkerUrl: () => {} }));
    mockModule('pmtiles', () => ({ Protocol: class { tile() {} } }));
    mockModule('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'maplibre-gl-worker.js' }));
    const ui = {
      holder: uiStub(),
      missionProgress: uiStub(),
      missionProgressFill: uiStub(),
      missionProgressPercent: uiStub(),
      missionProgressDistance: uiStub(),
    };

    const { Minimap, MinimapMissionProgress } = await loadModules('frontend/js/explore/navigation/Minimap.js',
      'frontend/js/explore/navigation/MinimapMissionProgress.js');
    const minimap = await Minimap.create(ui, { lat: LAT, lng: START_LNG }, fakePanoManager(), fakeTracker(),
      { tilesUrl: null, glyphsUrl: '' });
    const missionContainer = {
      getMissionCompletionRate: (mission) => mission.getProperty('distanceProgress') / mission.getDistance(),
    };
    progress = new MinimapMissionProgress(ui, { isOnboarding: false, isExploreAddressMode: false },
      { isRoute: false }, fakeTaskContainer(() => task, { getTasks: () => [task] }), missionContainer, minimap);
  });

  test('closing the modal turns the reached finish flag into the next mission\'s start flag', () => {
    // Mission 1 began at the street start and has 200 m to go from the user's furthest point at 100 m, so its
    // finish flag stands at 300 m along the street.
    task = makeTask({ furthestM: 100, missionStarts: { 1: { lat: LAT, lng: lngAt(0) } } });
    progress.update(makeMission(1, { distanceM: 300, progressM: 100 }));

    const start = flagByTitle('audit:right-ui.minimap.mission-start-flag');
    const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');
    expect(metersAt(start.position.lng)).toBeCloseTo(0, 0);
    expect(metersAt(finish.position.lng)).toBeCloseTo(300, 0);

    // The user walks to the finish; mission 2 loads while the modal is up, recording its start where they stand.
    // Its 1 km target does not fit on the 200 m left of this street, so no finish is knowable yet.
    task = makeTask({
      furthestM: 300,
      missionStarts: { 1: { lat: LAT, lng: lngAt(0) }, 2: { lat: LAT, lng: lngAt(300) } },
    });
    progress.reset(makeMission(2, { distanceM: 1000 }));

    expect(FakeMarker.created).toHaveLength(2); // Moved, not re-planted.
    expect(metersAt(start.position.lng)).toBeCloseTo(300, 0);
    expect(finish.hidden).toBe(true);
  });

  test('a short next mission gets its finish flag re-planted on the same street at once', () => {
    task = makeTask({ furthestM: 300, missionStarts: { 2: { lat: LAT, lng: lngAt(300) } } });
    progress.reset(makeMission(2, { distanceM: 150 }));

    const start = flagByTitle('audit:right-ui.minimap.mission-start-flag');
    const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');
    expect(metersAt(start.position.lng)).toBeCloseTo(300, 0);
    expect(metersAt(finish.position.lng)).toBeCloseTo(450, 0);
  });

  test('a reset with no mission leaves the flags alone', () => {
    task = makeTask({ furthestM: 100, missionStarts: { 1: { lat: LAT, lng: lngAt(0) } } });
    progress.update(makeMission(1, { distanceM: 300, progressM: 100 }));
    const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');

    progress.reset();

    expect(FakeMarker.created).toHaveLength(2);
    expect(finish.hidden).toBe(false);
  });
});
