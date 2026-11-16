/**
 * Tests for frontend/js/pages/labelMap.js, the public LabelMap's entry: what it asks the map for from the page's data,
 * and how it ties the popup, spotlight, sidebar, downloads and the streaming label feed together. Each of those parts
 * has a suite of its own, so here they are fakes that record what the page hands them (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { flush } from './support/routeFetch.js';

/** What the fakes below saw during one page load; rebuilt per test. */
let h;

mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({
  LabelDetail: { urlLabelId: () => h.deepLinkLabelId },
}));
mockModule('frontend/js/common/label-detail/LabelPopup.js', () => ({
  LabelPopup: (...args) => { h.popupArgs = args; return h.popupResult; },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (src) => { h.imagerySource = src; return h.Viewer; },
}));
mockModule('frontend/js/labelMapLocationSearch.js', () => ({
  initLabelMapLocationSearch: (...args) => { h.locationSearch = args; },
}));
mockModule('frontend/js/ps-map/MapDownloadControl.js', () => ({
  MapDownloadControl: class { constructor(opts) { h.download = opts; } },
}));
mockModule('frontend/js/ps-map/MapLoadingOverlay.js', () => ({
  MapLoadingOverlay: class {
    constructor(opts) { h.overlayOpts = opts; }

    show() { h.overlay.push('show'); }

    hide() { h.overlay.push('hide'); }

    showError() { h.overlay.push('error'); }

    isVisible() { return h.overlay.at(-1) === 'show'; }
  },
}));
mockModule('frontend/js/ps-map/MapSidebarFilter.js', () => ({
  MapSidebarFilter: class {
    constructor(...args) { h.sidebarArgs = args; h.sidebar = this; }

    getState() { return 'filter-state'; }

    getVisibleLabelCount() { return 42; }

    matchesFilters(type) { return type === 'CurbRamp' ? 1 : 0; }

    onChange(fn) { h.sidebarOnChange = fn; }

    refresh = vi.fn();
  },
}));
mockModule('frontend/js/ps-map/MapSidebarUrlSync.js', () => ({
  MapSidebarUrlSync: class {
    constructor(...args) { h.urlSync = args; }

    static applyUrlViewport() { return h.hasUrlViewport; }
  },
}));
mockModule('frontend/js/ps-map/MapStatusPill.js', () => ({
  MapStatusPill: class {
    constructor(el, opts) { h.pill = { el, opts, states: [] }; }

    setState(state) { h.pill.states.push(state); }
  },
}));
mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: (params) => {
    h.params = params;
    // createPSMap calls onMapReady before its promise settles, as the real one does once the style loads.
    params.onMapReady(h.map);
    return h.mapResult();
  },
}));
mockModule('frontend/js/ps-map/labelSpotlight.js', () => ({
  createLabelSpotlight: (opts) => { h.spotlightOpts = opts; return h.spotlight; },
}));
mockModule('frontend/js/ps-map/nearbyLabelNavigator.js', () => ({
  createNearbyLabelNavigator: (mapData, opts) => { h.navArgs = [mapData, opts]; return h.nav; },
}));
mockModule('frontend/js/ps-map/psMapUtilities.js', () => ({
  setRegionFocus: (map) => { h.regionFocus.push(map); },
}));

/**
 * A map that records its handlers and controls.
 * @returns {object} The fake map.
 */
function fakeMap() {
  const handlers = {};
  return {
    handlers,
    on: (event, fn) => { (handlers[event] ||= []).push(fn); },
    addControl: vi.fn(),
    getBounds: () => ({
      getWest: () => -122.3456789, getSouth: () => 47.1, getEast: () => -122.2, getNorth: () => 47.7654321,
    }),
  };
}

/**
 * A streaming label loader whose subscribers a test can fire.
 * @returns {object} The fake loader.
 */
function fakeLabelLoader() {
  const loader = { refetch: vi.fn() };
  for (const name of ['onData', 'onError', 'onStateChange']) loader[name] = (fn) => { loader[name].fn = fn; };
  return loader;
}

/**
 * Loads the entry with the given page-entry data and lets its ready handler run to the end.
 * @param {Record<string, string>} [dataset] - The page-entry `data-*` values, camelCased.
 * @returns {Promise<void>} Resolves once the page has started.
 */
async function boot(dataset = {}) {
  const attrs = Object.entries({ mapboxApiKey: 'pk.test', imagerySource: 'gsv', imageryAccessToken: 'tok', ...dataset })
    .map(([k, v]) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"`).join(' ');
  document.body.innerHTML = `
    <div id="page-entry" ${attrs}></div>
    <dialog id="label-modal"></dialog>
    <div id="labelmap-choropleth"></div>`;
  await loadModules('frontend/js/pages/labelMap.js');
  await flush();
}

/** @returns {object} The options the page handed LabelPopup. */
const popupOpts = () => h.popupArgs[4];
const loader = () => h.mapData.labelLoader;

beforeEach(() => {
  h = {
    overlay: [],
    regionFocus: [],
    deepLinkLabelId: null,
    hasUrlViewport: false,
    Viewer: function Viewer() {},
    map: fakeMap(),
    mapData: { labelLoader: fakeLabelLoader(), updateLabelType: vi.fn(), setLabelDeleted: vi.fn() },
    popup: { setNearbyNavigator: vi.fn() },
    spotlight: {
      spotlight: vi.fn(), pulse: vi.fn(), refreshBeacon: vi.fn(), updateTail: () => {},
      spotlightedLabelId: vi.fn(() => null),
    },
    nav: { getCoords: vi.fn(() => null), getLabelType: vi.fn(() => null), refresh: vi.fn(), filtersChanged: vi.fn() },
  };
  h.popupResult = Promise.resolve(h.popup);
  h.mapResult = () => Promise.resolve([h.map, null, null, null, h.mapData]);
  window.appManager = { ready: (fn) => fn() };
  window.logWebpageActivity = vi.fn();
  delete window.map;
});

describe('what the map is asked for', () => {
  test('a city-wide visit asks for every region, street and label, viewport-scoped', async () => {
    await boot();
    expect(h.params).toMatchObject({
      mapName: 'labelmap-choropleth', mapboxApiKey: 'pk.test', uiSource: 'LabelMap', popupLabelViewer: h.popup,
      viewportLabelLoading: true, mobileZoomedStart: true, highQualityFilter: true,
    });
    expect(String(h.params.regionsURL)).toBe('http://localhost/regions');
    expect(String(h.params.completionRatesURL)).toBe('http://localhost/regions/completionRates');
    expect(String(h.params.streetsURL)).toBe('http://localhost/contribution/streets/all?filterLowQuality=true');
    expect(String(h.params.labelsURL)).toBe('http://localhost/labels/all');
    expect(h.download.showsPartialFilterCaveat).toBe(false);
  });

  test('regions, routes and AI options from the page narrow the requests and caveat the download', async () => {
    await boot({ regionIds: '3,4', routeIds: '9', aiValidationOptions: 'agree' });
    expect(String(h.params.regionsURL)).toBe('http://localhost/regions?regions=3%2C4');
    expect(String(h.params.completionRatesURL)).toBe('http://localhost/regions/completionRates?regions=3%2C4');
    expect(String(h.params.streetsURL))
      .toBe('http://localhost/contribution/streets/all?filterLowQuality=true&regions=3%2C4&routes=9');
    expect(String(h.params.labelsURL))
      .toBe('http://localhost/labels/all?regions=3%2C4&routes=9&aiValidationOptions=agree');
    expect(h.download.showsPartialFilterCaveat).toBe(true);
  });

  test.each([
    [{ routeIds: '9' }],
    [{ aiValidationOptions: 'agree' }],
  ])('any one page-level scope (%o) caveats the download', async (dataset) => {
    await boot(dataset);
    expect(h.download.showsPartialFilterCaveat).toBe(true);
  });

  test('the popup gets the viewer for the city\'s imagery, its token, and a real account\'s username', async () => {
    await boot({ imagerySource: 'infra3d', username: 'mikey' });
    expect(h.imagerySource).toBe('infra3d');
    expect(h.popupArgs.slice(0, 4)).toEqual([false, h.Viewer, 'tok', 'mikey']);
    expect(popupOpts()).toMatchObject({ syncUrlSource: 'LabelMap', showExploreHereLink: true });
  });

  test('a visitor with no account is passed to the popup as no one', async () => {
    await boot({ username: '' });
    expect(h.popupArgs[3]).toBeNull();
  });

  test('the dialog wears the map-host style, so the spotlighted dot stays readable behind it', async () => {
    await boot();
    expect(document.getElementById('label-modal').classList.contains('label-detail--map-host')).toBe(true);
  });
});

describe('once the map is ready', () => {
  test('mounts the address search, shows the loading overlay, and keeps the spotlight tail on the dot', async () => {
    await boot();
    expect(h.locationSearch).toEqual([h.map, 'pk.test']);
    expect(h.overlay[0]).toBe('show');
    expect(h.map.handlers.move).toEqual([h.spotlight.updateTail]);
    expect(window.map.map).toBe(h.map);
    expect(h.spotlightOpts.getMap()).toBe(h.map);
    expect(h.spotlightOpts.getMapData()).toBe(h.mapData);
  });

  test('frames the page\'s region unless the link carries a viewport of its own', async () => {
    await boot();
    expect(h.regionFocus).toEqual([h.map]);

    h.hasUrlViewport = true;
    h.regionFocus = [];
    await boot();
    expect(h.regionFocus).toEqual([]);
  });

  test('a deep-linked label is spotlighted from its camera if its metadata already arrived', async () => {
    h.deepLinkLabelId = 5;
    await boot();
    expect(h.spotlight.spotlight).toHaveBeenCalledWith(5, true);
  });

  test('a deep-linked label already spotlighted is left where it is', async () => {
    h.deepLinkLabelId = 5;
    h.spotlight.spotlightedLabelId.mockReturnValue(5);
    await boot();
    expect(h.spotlight.spotlight).not.toHaveBeenCalled();
  });
});

describe('once the map\'s data is in', () => {
  test('the sidebar counts the view, and the URL keeps the filters', async () => {
    await boot();
    expect(h.sidebarArgs).toEqual([h.map, h.mapData, { highQualityFilter: true, viewportCounts: true }]);
    expect(h.urlSync).toEqual([h.sidebar, h.map]);
  });

  test('the download control sits top-right and reads the filters, count and view bounds', async () => {
    await boot();
    expect(h.map.addControl).toHaveBeenCalledWith(expect.anything(), 'top-right');
    expect(h.download.getFilterState()).toBe('filter-state');
    expect(h.download.getVisibleLabelCount()).toBe(42);
    expect(h.download.getBbox()).toBe('-122.34568,47.10000,-122.20000,47.76543');
  });

  test('the popup\'s arrows page only through labels the sidebar shows, and restart on a filter change', async () => {
    await boot();
    expect(h.navArgs[0]).toBe(h.mapData);
    expect(h.navArgs[1].isCandidate('CurbRamp', {})).toBe(true);
    expect(h.navArgs[1].isCandidate('Obstacle', {})).toBe(false);
    expect(h.popup.setNearbyNavigator).toHaveBeenCalledWith(h.nav);

    h.sidebarOnChange();
    expect(h.nav.filtersChanged).toHaveBeenCalled();
  });

  test('new label data refreshes the counts and arrows and takes the loading overlay down', async () => {
    await boot();
    loader().onData.fn();
    expect(h.sidebar.refresh).toHaveBeenCalled();
    expect(h.nav.refresh).toHaveBeenCalled();
    expect(h.overlay.at(-1)).toBe('hide');
    expect(h.spotlight.spotlight).not.toHaveBeenCalled();
  });

  test('new label data re-spotlights the open label, from the spotlight or else the deep link', async () => {
    h.deepLinkLabelId = 7;
    h.spotlight.spotlightedLabelId.mockReturnValue(7);
    await boot();
    document.getElementById('label-modal').setAttribute('open', '');

    loader().onData.fn();
    expect(h.spotlight.spotlight).toHaveBeenLastCalledWith(7, true);

    h.spotlight.spotlightedLabelId.mockReturnValue(null);
    h.spotlight.spotlight.mockClear();
    loader().onData.fn();
    expect(h.spotlight.spotlight).toHaveBeenCalledWith(7, true);
  });

  test('new label data leaves the spotlight alone while the dialog is closed', async () => {
    h.deepLinkLabelId = 7;
    h.spotlight.spotlightedLabelId.mockReturnValue(7);
    await boot();
    loader().onData.fn();
    expect(h.spotlight.spotlight).not.toHaveBeenCalled();
  });

  test('a failed label feed logs and shows the overlay\'s error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await boot();
    const failure = new Error('feed down');
    loader().onError.fn(failure);
    expect(error).toHaveBeenCalledWith('LabelMap label feed failed', failure);
    expect(h.overlay.at(-1)).toBe('error');
  });

  test('the status pill follows the loader, staying quiet while the overlay covers the map', async () => {
    await boot();
    expect(h.pill.el).toBe(document.getElementById('labelmap-choropleth'));
    expect(h.pill.opts.suppressLoading()).toBe(true);
    loader().onData.fn();
    expect(h.pill.opts.suppressLoading()).toBe(false);

    loader().onStateChange.fn('loading');
    expect(h.pill.states).toEqual(['loading']);
  });

  test('zooming out past the label floor logs the zoom hint once', async () => {
    await boot();
    loader().onStateChange.fn('belowFloor');
    loader().onStateChange.fn('ok');
    loader().onStateChange.fn('belowFloor');
    expect(window.logWebpageActivity.mock.calls).toEqual([['LabelMap_ZoomHintShown']]);
  });

  test('the zoom hint needs no logger on the page', async () => {
    delete window.logWebpageActivity;
    await boot();
    expect(() => loader().onStateChange.fn('belowFloor')).not.toThrow();
  });

  test('counts refresh once a burst of moves settles', async () => {
    await boot();
    vi.useFakeTimers();
    const [onMoveEnd] = h.map.handlers.moveend;
    onMoveEnd();
    vi.advanceTimersByTime(300);
    onMoveEnd();
    vi.advanceTimersByTime(399);
    expect(h.sidebar.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.sidebar.refresh).toHaveBeenCalledTimes(1);
  });

  test('a map that fails to load logs and shows the overlay\'s error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('style 500');
    h.mapResult = () => Promise.reject(failure);
    await boot();
    expect(error).toHaveBeenCalledWith('LabelMap failed to load', failure);
    expect(h.overlay.at(-1)).toBe('error');
  });
});

describe('the overlay\'s retry', () => {
  test('re-asks the label feed in place once it exists', async () => {
    await boot();
    h.overlayOpts.onRetry();
    expect(loader().refetch).toHaveBeenCalled();
  });

  test('reloads the page when the map never got as far as its feed', async () => {
    h.mapResult = () => new Promise(() => {});
    await boot();
    const navigations = navigationAttempts();
    h.overlayOpts.onRetry();
    expect(navigations).toHaveBeenCalledTimes(1);
  });

  test('reloads the page when the page never started', async () => {
    window.appManager = { ready: () => {} };
    await boot();
    const navigations = navigationAttempts();
    h.overlayOpts.onRetry();
    expect(navigations).toHaveBeenCalledTimes(1);
  });
});

describe('the popup\'s callbacks', () => {
  test('showing a label spotlights it, and closing pulses it', async () => {
    await boot();
    popupOpts().onShow(3);
    popupOpts().onClose(3);
    expect(h.spotlight.spotlight).toHaveBeenCalledWith(3);
    expect(h.spotlight.pulse).toHaveBeenCalledWith(3);
  });

  test('before the map data, a label is placed and typed from the popup\'s metadata', async () => {
    h.mapResult = () => new Promise(() => {});
    await boot();
    expect(h.spotlightOpts.getCoords(3)).toBeNull();
    expect(h.spotlightOpts.getLabelType(3)).toBeNull();

    popupOpts().onMetadata(3, { label_type: 'Obstacle', camera_lng: -122.3, camera_lat: 47.6 });
    expect(h.spotlightOpts.getCoords(3)).toEqual([-122.3, 47.6]);
    expect(h.spotlightOpts.getLabelType(3)).toBe('Obstacle');
    expect(h.spotlight.spotlight).toHaveBeenCalledWith(3, true);
  });

  test('once the map data is in, it wins over the metadata, which still backs up a label it lacks', async () => {
    await boot();
    popupOpts().onMetadata(3, { label_type: 'Obstacle', camera_lng: -122.3, camera_lat: 47.6 });
    expect(h.spotlightOpts.getCoords(3)).toEqual([-122.3, 47.6]);
    expect(h.spotlightOpts.getLabelType(3)).toBe('Obstacle');

    h.nav.getCoords.mockReturnValue([-122.31, 47.61]);
    h.nav.getLabelType.mockReturnValue('CurbRamp');
    expect(h.spotlightOpts.getCoords(3)).toEqual([-122.31, 47.61]);
    expect(h.spotlightOpts.getLabelType(3)).toBe('CurbRamp');
  });

  test('metadata without a camera position places nothing', async () => {
    await boot();
    popupOpts().onMetadata(3, { camera_lng: -122.3 });
    popupOpts().onMetadata(4, { camera_lat: 47.6 });
    expect(h.spotlightOpts.getCoords(3)).toBeNull();
    expect(h.spotlightOpts.getCoords(4)).toBeNull();
    expect(h.spotlight.spotlight).not.toHaveBeenCalled();
  });

  test('metadata for the label already spotlighted doesn\'t move the camera again', async () => {
    await boot();
    h.spotlight.spotlightedLabelId.mockReturnValue(3);
    popupOpts().onMetadata(3, { camera_lng: -122.3, camera_lat: 47.6 });
    expect(h.spotlight.spotlight).not.toHaveBeenCalled();
  });

  test('a type edited on the card moves the dot to its new layer and recolors the beacon', async () => {
    await boot();
    popupOpts().onEdit({ label_id: 3, label_type: 'Obstacle' });
    expect(h.mapData.updateLabelType).toHaveBeenCalledWith(3, 'Obstacle');
    expect(h.nav.refresh).toHaveBeenCalled();
    expect(h.spotlight.refreshBeacon).toHaveBeenCalledWith(3);
    expect(h.spotlightOpts.getLabelType(3)).toBe('Obstacle');
  });

  test('an edit that keeps the type changes nothing on the map', async () => {
    await boot();
    h.nav.getLabelType.mockReturnValue('Obstacle');
    popupOpts().onEdit({ label_id: 3, label_type: 'Obstacle' });
    expect(h.mapData.updateLabelType).not.toHaveBeenCalled();
    expect(h.spotlight.refreshBeacon).not.toHaveBeenCalled();
  });

  test('an edit before the map data is in still recolors the beacon', async () => {
    h.mapResult = () => new Promise(() => {});
    await boot();
    popupOpts().onEdit({ label_id: 3, label_type: 'Obstacle' });
    expect(h.spotlight.refreshBeacon).toHaveBeenCalledWith(3);
  });

  test('an edit on map data that can\'t retype a dot still recolors the beacon', async () => {
    delete h.mapData.updateLabelType;
    await boot();
    popupOpts().onEdit({ label_id: 3, label_type: 'Obstacle' });
    expect(h.spotlight.refreshBeacon).toHaveBeenCalledWith(3);
  });

  test('a delete or undelete on the card hides or restores the dot', async () => {
    await boot();
    popupOpts().onDelete({ label_id: 3, deleted: true });
    expect(h.mapData.setLabelDeleted).toHaveBeenCalledWith(3, true);
  });

  test('a delete before the map data is in, or on data that can\'t hide a dot, is harmless', async () => {
    h.mapResult = () => new Promise(() => {});
    await boot();
    expect(() => popupOpts().onDelete({ label_id: 3, deleted: true })).not.toThrow();

    delete h.mapData.setLabelDeleted;
    h.mapResult = () => Promise.resolve([h.map, null, null, null, h.mapData]);
    await boot();
    expect(() => popupOpts().onDelete({ label_id: 3, deleted: true })).not.toThrow();
  });
});
