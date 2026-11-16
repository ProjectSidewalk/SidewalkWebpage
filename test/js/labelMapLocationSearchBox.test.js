/**
 * Tests for setting up the LabelMap place search and the pin a result drops (frontend/js/labelMapLocationSearch.js,
 * #5840): limiting suggestions to the city's footprint, the pin's name and Explore link for each kind of result, and
 * the invitation popup's edge cases. Clearing a place is covered in labelMapSearchClear.test.js and the popup's
 * content in exploreHerePopup.test.js. Mapbox's search box, marker and popup are faked.
 */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/** The search box the module built in the current test. */
let searchBox;
/** Popups the fake mapboxgl built in the current test, newest last. */
let popups;
/** Everything passed to window.logWebpageActivity in the current test. */
let logged;

/** Stands in for Search JS's `<mapbox-search-box>`: an EventTarget owning the input the module reads and writes. */
class FakeSearchBox extends EventTarget {
  constructor() {
    super();
    this.element = document.createElement('div');
    this.input = document.createElement('input');
    this.input.setAttribute('role', 'combobox');
    this.element.appendChild(this.input);
    this.options = { proximity: [0, 0] };
    searchBox = this;
  }

  /**
   * @param {object} map - The map the control binds to.
   * @returns {HTMLElement} The control's DOM.
   */
  onAdd(map) {
    this.map = map;
    return this.element;
  }
}

mockModule('@mapbox/search-js-web', () => ({ MapboxSearchBox: FakeSearchBox }));
mockModule('frontend/js/common/mapboxgl.js', () => ({
  default: {
    Marker: class {
      constructor(opts) { this.element = opts.element; }

      setLngLat() { return this; }

      addTo() { document.body.appendChild(this.element); return this; }

      remove() { this.element.remove(); }
    },
    Popup: class {
      constructor() { popups.push(this); }

      setDOMContent(el) { this.content = el; return this; }

      setLngLat() { return this; }

      addTo() { document.body.appendChild(this.content); return this; }

      getElement() { return this.content; }

      remove() { this.removed = true; this.content.remove(); }
    },
  },
}));

/**
 * A map whose region layer is drawn but has nothing under the given point.
 * @returns {object} The fake map.
 */
const mapWithEmptyRegionLayer = () => ({
  getLayer: () => ({}),
  project: () => ({ x: 0, y: 0 }),
  queryRenderedFeatures: () => [],
});

/**
 * Selects a search result the way Search JS does.
 * @param {object|undefined} feature - The chosen GeoJSON feature, or none.
 */
function retrieve(feature) {
  searchBox.dispatchEvent(new CustomEvent('retrieve', { detail: { features: feature ? [feature] : [] } }));
}

/**
 * A search result at a fixed spot.
 * @param {object} [properties] - The result's properties; omitted to model a result with none.
 * @returns {object} The feature.
 */
const place = (properties) => ({ geometry: { coordinates: [-74.02, 40.9] }, properties });

/**
 * Clicks a link, stopping the browser from following it, which jsdom can't do.
 * @param {HTMLElement} link - The link to click.
 */
function clickWithoutLeaving(link) {
  link.addEventListener('click', (e) => e.preventDefault(), { once: true });
  link.click();
}

/** @returns {HTMLButtonElement} The dropped pin. */
const pin = () => document.querySelector('.ps-search-pin');

let search;
let mod;

/**
 * Builds the sidebar and runs the search setup.
 * @param {object} [map] - The map the search binds to.
 * @returns {object} The search handle.
 */
async function init(map = { getLayer: () => null }) {
  search = mod.initLabelMapLocationSearch(map, 'test-token');
  await flush();
  return search;
}

beforeEach(async () => {
  popups = [];
  logged = [];
  search = null;
  document.body.innerHTML = '<div id="labelmap-search-box"></div>';
  window.logWebpageActivity = (activity) => logged.push(activity);
  routeFetch({ '/regions': { type: 'FeatureCollection', features: [] } });
  mod = await loadModules('frontend/js/labelMapLocationSearch.js');
});

afterEach(() => {
  // Each setup leaves a document-level Escape handler behind, so a place left on the map would answer later tests.
  search?.clear();
  delete window.logWebpageActivity;
  vi.useRealTimers();
});

describe('setting up the search box', () => {
  test('a page without the sidebar slot gets no search', async () => {
    document.body.innerHTML = '';
    expect(mod.initLabelMapLocationSearch({}, 'test-token')).toBeNull();
  });

  test('mounts in the sidebar, bound to the map, in the page\'s language, with its list marked closed', async () => {
    const map = { getLayer: () => null };
    await init(map);

    expect(document.getElementById('labelmap-search-box').contains(searchBox.input)).toBe(true);
    expect(searchBox.map).toBe(map);
    expect(searchBox.accessToken).toBe('test-token');
    expect(searchBox.placeholder).toBe('labelmap:search-placeholder');
    expect(searchBox.marker).toBe(false);
    expect(searchBox.options).toEqual({ language: 'common:mapbox-language-code' });
    expect(searchBox.input.getAttribute('aria-expanded')).toBe('false');
  });

  test('limits suggestions to the city\'s regions plus a tenth of their span on each side', async () => {
    routeFetch({
      '/regions': {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 20], [0, 0]]] } },
          {
            type: 'Feature',
            geometry: { type: 'MultiPolygon', coordinates: [[[[-10, 5], [0, 5], [-10, 30], [-10, 5]]]] },
          },
          // A region row with no shape is skipped rather than breaking the extent.
          { type: 'Feature', geometry: null },
          { type: 'Feature', geometry: { type: 'Polygon' } },
        ],
      },
    });
    await init();
    // Spans 20 by 30, so 2 and 3 of padding.
    expect(searchBox.options.bbox).toEqual([[-12, -3], [12, 33]]);
    expect(searchBox.options.language).toBe('common:mapbox-language-code');
  });

  test('a single region feature works as well as a collection', async () => {
    routeFetch({
      '/regions': { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] } },
    });
    await init();
    expect(searchBox.options.bbox).toEqual([[0.9, 0.9], [2.1, 2.1]]);
  });

  test('with no region shapes, or when they fail to load, the search is left unbounded', async () => {
    const answers = [
      { type: 'FeatureCollection', features: [] }, {}, { status: 500, body: 'oops' }, new TypeError('offline'),
    ];
    for (const regions of answers) {
      routeFetch({ '/regions': regions });
      await init();
      expect(searchBox.options.bbox).toBeUndefined();
    }
  });
});

describe('the pin a result drops', () => {
  test('a point of interest\'s pin is named for it and opens Explore there with the name carried over', async () => {
    await init();
    retrieve(place({ name: 'Teaneck High School', full_address: '100 Elizabeth Ave, Teaneck, NJ' }));

    expect(pin().getAttribute('aria-label')).toBe('Teaneck High School');
    pin().click();
    const popup = popups[0].content;
    expect(popup.querySelector('.explore-here__address').textContent).toBe('100 Elizabeth Ave');
    expect(popup.querySelector('.explore-here-button').getAttribute('href'))
      .toBe('/explore?lat=40.9&lng=-74.02&placeName=Teaneck%20High%20School');
  });

  test('a plain address search doesn\'t show the address twice', async () => {
    await init();
    retrieve(place({ name: '100 Elizabeth Ave', address: '100 Elizabeth Ave' }));
    pin().click();
    expect(popups[0].content.querySelector('.explore-here__address')).toBeNull();
  });

  test('a result with no name is named by its address, and opens Explore without a place name', async () => {
    await init();
    retrieve(place({ full_address: '2 Oak Ln, Teaneck, NJ' }));

    expect(pin().getAttribute('aria-label')).toBe('2 Oak Ln');
    pin().click();
    expect(popups[0].content.querySelector('.explore-here-button').getAttribute('href'))
      .toBe('/explore?lat=40.9&lng=-74.02');
  });

  test('a result with neither name nor address gets a generic pin name', async () => {
    await init();
    retrieve(place());
    expect(pin().getAttribute('aria-label')).toBe('labelmap:search-pin');
  });

  test('a retrieve event with no result does nothing', async () => {
    await init();
    retrieve(undefined);
    searchBox.dispatchEvent(new CustomEvent('retrieve'));
    expect(pin()).toBeNull();
  });

  test('a new search while the invitation is open closes it, and the new pin\'s hover opens a fresh one', async () => {
    await init();
    retrieve(place({ name: 'First' }));
    pin().dispatchEvent(new MouseEvent('mouseenter'));
    expect(popups).toHaveLength(1);

    retrieve(place({ name: 'Second' }));
    expect(popups[0].removed).toBe(true);
    pin().dispatchEvent(new MouseEvent('mouseenter'));
    expect(popups).toHaveLength(2);
    expect(popups[1].content.querySelector('.explore-here__place').textContent).toBe('Second');
    // Hovering again while it's open doesn't stack another.
    pin().dispatchEvent(new MouseEvent('mouseenter'));
    expect(popups).toHaveLength(2);
  });

  test('a region with no shape under the pin gets no progress pitch', async () => {
    await init(mapWithEmptyRegionLayer());
    retrieve(place({ name: 'Edge of town' }));
    pin().click();
    expect(popups[0].content.querySelector('.explore-here__context')).toBeNull();
  });
});

describe('the invitation popup', () => {
  test('its Explore button logs the spot it opens', async () => {
    await init();
    retrieve(place({ name: 'Library' }));
    pin().click();
    clickWithoutLeaving(popups[0].content.querySelector('.explore-here-button'));
    expect(logged).toEqual([
      'Click_module=SearchPin_lat=40.9_lng=-74.02',
      'Click_module=ExploreSidewalksHere_lat=40.9_lng=-74.02',
    ]);
  });

  test('with no activity logger yet, opening it and clicking through or clearing still work', async () => {
    await init();
    delete window.logWebpageActivity;
    retrieve(place({ name: 'Library' }));
    pin().click();
    const button = popups[0].content.querySelector('.explore-here-button');
    expect(document.activeElement).toBe(button);
    expect(() => clickWithoutLeaving(button)).not.toThrow();
    expect(search.clear()).toBe(true);
  });

  test('closing it before its leave-check runs leaves nothing to close', async () => {
    await init();
    vi.useFakeTimers();
    retrieve(place({ name: 'Library' }));
    pin().focus();
    pin().blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popups[0].removed).toBe(true);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(pin()).not.toBeNull();
  });

  test('leaving the popup itself closes it once neither pointer nor focus is on it', async () => {
    await init();
    vi.useFakeTimers();
    retrieve(place({ name: 'Library' }));
    pin().dispatchEvent(new MouseEvent('mouseenter'));
    popups[0].content.dispatchEvent(new MouseEvent('mouseleave'));
    vi.runAllTimers();
    expect(popups[0].removed).toBe(true);
  });

  test('keys other than Escape leave the place and its popup alone', async () => {
    await init();
    retrieve(place({ name: 'Library' }));
    pin().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(popups[0].removed).toBeUndefined();
    expect(pin()).not.toBeNull();
  });
});
