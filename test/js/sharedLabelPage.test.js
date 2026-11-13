/**
 * Tests for the public single-label page's controller (frontend/js/shared-label/SharedLabel.js, #5840): the label
 * card it mounts, the nearby-labels minimap, the legend, the city stats band and the outbound-click logging. The
 * label card and the map are faked, so no real pano or map is ever built.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';

/** Every LabelDetail.create call, as [root, options]. */
let detailCreates;
/** Every showLabel call on the fake card, as [labelId, source]. */
let shownLabels;
/** What the fake LabelDetail.create does; a test swaps it to make the mount fail. */
let createDetail;
/** Markers built by the fake mapboxgl, newest last. */
let markers;
/** Popups built by the fake mapboxgl, newest last. */
let popups;
/** The fake map createPSMap hands back, or the error it throws. */
let mapResult;
/** Each addLabelsToMap call, as [map, geojson, options]. */
let addLabelsCalls;
/** The layer tracker the fake addLabelsToMap answers with. */
let layerNames;
/** Every training-example panel built, as [root, config]. */
let goldPins;

mockModule('frontend/js/common/label-detail/LabelDetail.js', () => ({
  LabelDetail: { create: (...args) => createDetail(...args) },
}));
mockModule('frontend/js/shared-label/GoldExamplePin.js', () => ({
  GoldExamplePin: class {
    constructor(...args) { goldPins.push(args); }
  },
}));
mockModule('frontend/js/common/pano-viewer/viewerClassFor.js', () => ({
  viewerClassFor: (source) => `${source}Viewer`,
}));
mockModule('frontend/js/common/pano-viewer/PanoViewer.js', () => ({ PanoViewer: class {} }));
mockModule('frontend/js/common/utilitiesSidewalk.js', () => ({}));
mockModule('frontend/js/ps-map/createPSMap.js', () => ({
  createPSMap: async () => {
    if (mapResult instanceof Error) throw mapResult;
    return [mapResult];
  },
}));
mockModule('frontend/js/ps-map/addLabelsToMap.js', () => ({
  addLabelsToMap: async (...args) => {
    addLabelsCalls.push(args);
    return { layerNames };
  },
}));
mockModule('frontend/js/common/mapboxgl.js', () => ({
  default: {
    Marker: class {
      constructor(opts) { this.opts = opts; markers.push(this); }

      setLngLat(lngLat) { this.lngLat = lngLat; return this; }

      addTo(map) { this.map = map; return this; }
    },
    Popup: class {
      constructor(opts) { this.opts = opts; popups.push(this); }

      setLngLat(lngLat) { this.lngLat = lngLat; return this; }

      setDOMContent(el) { this.content = el; return this; }

      addTo(map) { this.map = map; return this; }
    },
  },
}));

/**
 * A stand-in for the Mapbox map with the few calls the page makes, recording handlers so tests can fire them.
 * @param {string[]} [renderedLayers] - Layer names the map reports as drawn.
 * @returns {object} The fake map.
 */
function fakeMap(renderedLayers = ['labels-CurbRamp', 'labels-Obstacle']) {
  const handlers = {};
  const canvas = document.createElement('canvas');
  return {
    jumps: [],
    handlers,
    jumpTo(opts) { this.jumps.push(opts); },
    getLayer: (name) => (renderedLayers.includes(name) ? { id: name } : undefined),
    getCanvas: () => canvas,
    on(event, layers, handler) { handlers[event] = { layers, handler }; },
  };
}

/**
 * A rawLabels GeoJSON point feature in the API's snake_case shape.
 * @param {number} labelId - The label's id.
 * @param {number[]} coordinates - [lng, lat].
 * @param {object} [props] - Extra properties, e.g. vote counts.
 * @returns {object} The feature.
 */
const rawLabel = (labelId, coordinates, props = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties: {
    label_id: labelId, label_type: 'CurbRamp', agree_count: 0, disagree_count: 0, unsure_count: 0, ...props,
  },
});

/**
 * The config sharedLabel.scala.html renders, with overrides.
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} The config.
 */
const config = (overrides = {}) => ({
  labelId: 42,
  labelType: 'CurbRamp',
  admin: false,
  goldReason: null,
  lat: 47.6,
  lng: -122.3,
  imagerySource: 'gsv',
  imageryAccessToken: 'token',
  mapboxApiKey: 'mapbox-key',
  username: 'alice',
  labelTypeNames: { CurbRamp: 'Curb Ramp', Obstacle: 'Obstacle' },
  i18n: { viewThisLabel: 'View this label' },
  ...overrides,
});

/** The page shell for a label with a location; the links lose their hrefs so a click can't try to navigate jsdom. */
const SHELL = `
  <div class="spotlight__detail"></div>
  <div id="spotlight-map"></div>
  <a id="spotlight-full-map" role="link">Label Map</a>
  <span class="spotlight-legend__swatch" data-label-type="CurbRamp"></span>
  <span class="spotlight-legend__swatch" data-label-type="Mystery"></span>
  <div id="spotlight-stats" hidden>
    <span data-stat="labels">—</span><span data-stat="validations">—</span><span data-stat="miles">—</span>
  </div>
  <a id="spotlight-explore-cta" role="link">Explore</a>
  <a id="spotlight-validate-cta" role="link">Validate</a>`;

/** Overall stats in the /v3/api/overallStats shape, trimmed to the fields the band reads. */
const STATS = {
  labels: { count: 12345 },
  validations: { combined: { total_validations: 6789 } },
  km_explored_no_overlap: 100,
};

let logged;
let SharedLabelPage;

/**
 * Builds the page and lets every async step (card mount, map, fetches) finish.
 * @param {object} [data] - The page config.
 * @returns {Promise<object>} The page controller.
 */
async function buildPage(data = config()) {
  const page = new SharedLabelPage(data);
  for (let i = 0; i < 5; i++) await flush();
  return page;
}

beforeEach(async () => {
  detailCreates = [];
  shownLabels = [];
  markers = [];
  popups = [];
  addLabelsCalls = [];
  goldPins = [];
  layerNames = { CurbRamp: 'labels-CurbRamp', Obstacle: 'labels-Obstacle', Signal: 'labels-Signal' };
  mapResult = fakeMap();
  createDetail = async (root, options) => {
    detailCreates.push([root, options]);
    return { showLabel: async (...args) => { shownLabels.push(args); } };
  };
  logged = [];
  window.logWebpageActivity = (activity) => logged.push(activity);
  window.history.replaceState(null, '', '/label/42');
  document.body.innerHTML = SHELL;
  routeFetch({
    '/v3/api/overallStats': STATS,
    '/v3/api/rawLabels': { type: 'FeatureCollection', features: [] },
  });
  useUtil({
    misc: {
      getLabelColors: () => ({ CurbRamp: { fillStyle: '#90C31F' }, Obstacle: { fillStyle: '#78B0EA' } }),
      getIconImagePaths: (type) => ({ iconImagePath: `/icons/${type}_small.svg` }),
    },
  });
  ({ SharedLabelPage } = await loadModules('frontend/js/shared-label/SharedLabel.js'));
});

afterEach(() => {
  delete window.logWebpageActivity;
});

describe('the label card', () => {
  test('a public visitor gets the plain card, with the city\'s pano viewer, showing this label', async () => {
    await buildPage();

    expect(detailCreates).toHaveLength(1);
    const [root, options] = detailCreates[0];
    expect(root).toBe(document.querySelector('.spotlight__detail'));
    expect(options).toMatchObject({
      admin: false,
      viewerType: 'gsvViewer',
      viewerAccessToken: 'token',
      currUsername: 'alice',
      panoOverlaySource: 'SharedLabelImage',
      voteColumnSource: 'SharedLabelThumbs',
      highlightStoryId: null,
    });
    expect(shownLabels).toEqual([[42, 'SharedLabel']]);
  });

  test('the admin view mounts the card in admin mode and logs under the label search source', async () => {
    await buildPage(config({ admin: true }));

    expect(detailCreates[0][1]).toMatchObject({
      admin: true, panoOverlaySource: 'LabelSearchPage', voteColumnSource: 'LabelSearchPage',
    });
    expect(shownLabels).toEqual([[42, 'LabelSearchPage']]);
  });

  test('a story share link highlights that story; an unusable story id is ignored', async () => {
    window.history.replaceState(null, '', '/label/42?storyId=7');
    await buildPage();
    expect(detailCreates[0][1].highlightStoryId).toBe(7);

    for (const bad of ['abc', '-3', '1.5']) {
      detailCreates = [];
      window.history.replaceState(null, '', `/label/42?storyId=${bad}`);
      await buildPage();
      expect(detailCreates[0][1].highlightStoryId).toBeNull();
    }
  });

  test('a card that fails to mount is reported, and the rest of the page still builds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createDetail = async () => { throw new Error('no pano'); };
    await buildPage();

    expect(error).toHaveBeenCalledWith('SharedLabel: failed to mount label detail', expect.any(Error));
    expect(addLabelsCalls).toHaveLength(1);
    expect(document.getElementById('spotlight-stats').hidden).toBe(false);
  });

  test('a page without the card host skips the card', async () => {
    document.querySelector('.spotlight__detail').remove();
    await buildPage();
    expect(detailCreates).toEqual([]);
  });
});

describe('the training-example panel', () => {
  test('the admin\'s page hands the panel this label and its current pin', async () => {
    document.body.insertAdjacentHTML('beforeend', '<section id="spotlight-gold"></section>');
    await buildPage(config({ admin: true, goldReason: 'driveway' }));
    expect(goldPins).toEqual([[document.getElementById('spotlight-gold'),
      { labelId: 42, labelType: 'CurbRamp', goldReason: 'driveway' }]]);
  });

  test('the public page, which has no panel, builds none', async () => {
    await buildPage();
    expect(goldPins).toEqual([]);
  });
});

describe('the legend', () => {
  test('each swatch takes its label type\'s marker color, and an unknown type is left uncolored', async () => {
    await buildPage();
    const [curbRamp, mystery] = document.querySelectorAll('.spotlight-legend__swatch');
    expect(curbRamp.style.backgroundColor).toBe('rgb(144, 195, 31)');
    expect(mystery.style.backgroundColor).toBe('');
  });
});

describe('the city stats band', () => {
  test('shows labels, validations and miles explored, then reveals itself', async () => {
    await buildPage();
    const band = document.getElementById('spotlight-stats');
    const stat = (key) => band.querySelector(`[data-stat="${key}"]`).textContent;

    expect(band.hidden).toBe(false);
    expect(stat('labels')).toBe((12345).toLocaleString());
    expect(stat('validations')).toBe((6789).toLocaleString());
    // 100 km is 62 miles.
    expect(stat('miles')).toBe('62');
  });

  test('a stat the server leaves out keeps its placeholder, and a stat with no slot is skipped', async () => {
    document.querySelector('[data-stat="validations"]').remove();
    routeFetch({
      '/v3/api/overallStats': { labels: { count: 5 }, km_explored_no_overlap: null },
      '/v3/api/rawLabels': {},
    });
    await buildPage();

    expect(document.querySelector('[data-stat="labels"]').textContent).toBe('5');
    expect(document.querySelector('[data-stat="miles"]').textContent).toBe('—');
  });

  test('stays hidden when the server has none of the stats', async () => {
    routeFetch({ '/v3/api/overallStats': {}, '/v3/api/rawLabels': {} });
    await buildPage();
    expect(document.getElementById('spotlight-stats').hidden).toBe(true);
  });

  test('stays hidden when the stats request fails, reporting only a network error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ '/v3/api/overallStats': { status: 500 }, '/v3/api/rawLabels': {} });
    await buildPage();
    expect(document.getElementById('spotlight-stats').hidden).toBe(true);
    expect(error).not.toHaveBeenCalled();

    routeFetch({ '/v3/api/overallStats': new TypeError('offline'), '/v3/api/rawLabels': {} });
    await buildPage();
    expect(document.getElementById('spotlight-stats').hidden).toBe(true);
    expect(error).toHaveBeenCalledWith('SharedLabel: failed to fetch city stats', expect.any(TypeError));
  });

  test('a page without the band never asks for stats', async () => {
    document.getElementById('spotlight-stats').remove();
    const stub = routeFetch({ '/v3/api/rawLabels': {} });
    await buildPage();
    expect(stub.mock.calls.map(([url]) => url).some((url) => url.includes('overallStats'))).toBe(false);
  });
});

describe('outbound-click logging', () => {
  test('each call to action logs where it leads', async () => {
    await buildPage();
    for (const id of ['spotlight-explore-cta', 'spotlight-validate-cta', 'spotlight-full-map']) {
      document.getElementById(id).dispatchEvent(new MouseEvent('click', { cancelable: true }));
    }
    expect(logged).toEqual([
      'Click_module=SharedLabel_target=Explore',
      'Click_module=SharedLabel_target=Validate',
      'Click_module=SharedLabel_target=FullMap',
    ]);
  });

  test('a click before the logger exists does nothing, and a missing button is skipped', async () => {
    document.getElementById('spotlight-validate-cta').remove();
    await buildPage();
    delete window.logWebpageActivity;
    expect(() => document.getElementById('spotlight-explore-cta').click()).not.toThrow();
  });
});

describe('the nearby-labels map', () => {
  test('centers on the label, asks for nearby high-quality labels in a small box, and marks this label', async () => {
    const stub = routeFetch({ '/v3/api/overallStats': STATS, '/v3/api/rawLabels': { features: [] } });
    await buildPage();

    expect(mapResult.jumps).toEqual([{ center: [-122.3, 47.6], zoom: 16 }]);
    const url = stub.mock.calls.map(([u]) => u).find((u) => u.startsWith('/v3/api/rawLabels'));
    const params = new URL(url, 'http://x').searchParams;
    expect(params.get('highQualityUserOnly')).toBe('true');
    expect(params.get('filetype')).toBe('geojson');
    const [minLng, minLat, maxLng, maxLat] = params.get('bbox').split(',').map(Number);
    expect(minLng).toBeCloseTo(-122.303);
    expect(minLat).toBeCloseTo(47.597);
    expect(maxLng).toBeCloseTo(-122.297);
    expect(maxLat).toBeCloseTo(47.603);

    expect(markers).toHaveLength(1);
    expect(markers[0].lngLat).toEqual([-122.3, 47.6]);
    expect(markers[0].map).toBe(mapResult);
    const el = markers[0].opts.element;
    expect(el.className).toBe('spotlight-focal-marker');
    expect(el.style.getPropertyValue('--lt-color')).toBe('#90C31F');
    expect(el.querySelector('img').getAttribute('src')).toBe('/icons/CurbRamp_small.svg');
  });

  test('draws the nearest other labels, without this one, flagging which have votes', async () => {
    routeFetch({
      '/v3/api/overallStats': STATS,
      '/v3/api/rawLabels': {
        type: 'FeatureCollection',
        features: [
          rawLabel(1, [-122.302, 47.6], { agree_count: 2 }),
          rawLabel(42, [-122.3, 47.6]),
          rawLabel(2, [-122.3001, 47.6]),
          { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.3, 47.6] } },
          rawLabel(3, [-122.301, 47.6], { agree_count: undefined, disagree_count: undefined, unsure_count: undefined }),
        ],
      },
    });
    await buildPage();

    const [map, geojson, options] = addLabelsCalls[0];
    expect(map).toBe(mapResult);
    expect(options).toEqual({});
    expect(geojson.features.map((f) => [f.properties.label_id, f.properties.has_validations])).toEqual([
      [2, false], [3, false], [1, true],
    ]);
  });

  test('caps a dense block at the 250 nearest labels', async () => {
    const features = Array.from({ length: 260 }, (_, i) => rawLabel(i + 100, [-122.3 + (260 - i) * 1e-6, 47.6]));
    routeFetch({ '/v3/api/overallStats': STATS, '/v3/api/rawLabels': { features } });
    await buildPage();

    const kept = addLabelsCalls[0][1].features;
    expect(kept).toHaveLength(250);
    // The farthest ten (the first ten built) are the ones dropped.
    expect(kept.some((f) => f.properties.label_id < 110)).toBe(false);
  });

  test('still draws the map, with no nearby labels, when the nearby request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeFetch({ '/v3/api/overallStats': STATS, '/v3/api/rawLabels': { status: 503 } });
    await buildPage();
    expect(addLabelsCalls[0][1].features).toEqual([]);
    expect(error).not.toHaveBeenCalled();

    addLabelsCalls = [];
    routeFetch({ '/v3/api/overallStats': STATS, '/v3/api/rawLabels': new TypeError('offline') });
    await buildPage();
    expect(addLabelsCalls[0][1].features).toEqual([]);
    expect(error).toHaveBeenCalledWith('SharedLabel: failed to fetch nearby labels', expect.any(TypeError));
  });

  test('a label with no location, or a page with no map slot, gets no map', async () => {
    await buildPage(config({ lat: null, lng: null }));
    await buildPage(config({ lng: undefined }));
    document.getElementById('spotlight-map').remove();
    await buildPage();
    expect(addLabelsCalls).toEqual([]);
    expect(markers).toEqual([]);
  });

  test('a map that fails to build is reported and leaves the rest of the page alone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mapResult = new Error('no webgl');
    await buildPage();
    expect(error).toHaveBeenCalledWith('SharedLabel: failed to create nearby map', mapResult);
    expect(addLabelsCalls).toEqual([]);
    expect(shownLabels).toHaveLength(1);
  });
});

describe('nearby-label popups', () => {
  test('clicking a nearby marker opens a popup naming its type and linking to its own page', async () => {
    await buildPage();
    const { click } = mapResult.handlers;
    // Only the layers the map actually drew get the handlers.
    expect(click.layers).toEqual(['labels-CurbRamp', 'labels-Obstacle']);

    click.handler({
      lngLat: { lng: -122.301, lat: 47.6 },
      features: [{ properties: { label_id: 7, label_type: 'Obstacle' } }],
    });

    expect(popups).toHaveLength(1);
    expect(popups[0].opts.className).toBe('spotlight-popup');
    expect(popups[0].lngLat).toEqual({ lng: -122.301, lat: 47.6 });
    expect(popups[0].map).toBe(mapResult);
    const content = popups[0].content;
    expect(content.querySelector('.spotlight-popup__head span').textContent).toBe('Obstacle');
    expect(content.querySelector('.spotlight-popup__icon').getAttribute('src')).toBe('/icons/Obstacle_small.svg');
    const link = content.querySelector('.spotlight-popup__link');
    expect(link.getAttribute('href')).toBe('/label/7');
    expect(link.textContent).toBe('View this label');
    expect(logged).toEqual(['Click_module=SharedLabel_target=NearbyLabel_labelId=7']);
  });

  test('a label type with no translated name shows its raw name', async () => {
    await buildPage();
    mapResult.handlers.click.handler({ lngLat: {}, features: [{ properties: { label_id: 8, label_type: 'Signal' } }] });
    expect(popups[0].content.querySelector('.spotlight-popup__head span').textContent).toBe('Signal');
  });

  test('hovering a nearby marker shows a pointer cursor until the pointer leaves', async () => {
    await buildPage();
    const canvas = mapResult.getCanvas();
    mapResult.handlers.mouseenter.handler();
    expect(canvas.style.cursor).toBe('pointer');
    mapResult.handlers.mouseleave.handler();
    expect(canvas.style.cursor).toBe('');
  });

  test('a map with no drawn label layers wires no popups', async () => {
    mapResult = fakeMap([]);
    await buildPage();
    expect(mapResult.handlers).toEqual({});
  });
});
