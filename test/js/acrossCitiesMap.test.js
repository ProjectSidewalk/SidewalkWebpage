/**
 * Tests for the deployment-cities map on /admin/across-cities (#4329). Mapbox GL can't run under jsdom (no WebGL), so
 * the map is a double that records the source, layer and handlers it was given and lets a test fire them.
 */

import { mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { makeCity, renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

/** What the fake map was asked to do; reset by each render. */
let map;

class FakeMap {
  constructor(options) {
    map = { options, sources: {}, layers: [], handlers: {}, controls: [], loadCallbacks: [], canvasStyle: {} };
    map.instance = this;
  }

  addControl(control, position) { map.controls.push({ control, position }); }

  on(event, layerOrHandler, handler) {
    if (event === 'load') map.loadCallbacks.push(layerOrHandler);
    else map.handlers[event] = handler;
  }

  addSource(id, source) { map.sources[id] = source; }

  addLayer(layer) { map.layers.push(layer); }

  getCanvas() { return { style: map.canvasStyle }; }
}

class FakePopup {
  constructor() { map.popup = this; this.open = false; }

  setLngLat(lngLat) { this.lngLat = lngLat; return this; }

  setHTML(html) { this.html = html; return this; }

  addTo() { this.open = true; return this; }

  remove() { this.open = false; }
}

const mapboxgl = { Map: FakeMap, Popup: FakePopup, NavigationControl: class {} };
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));

const MARKUP = '<div id="ac-cities-map"></div><div id="ac-map-status"></div>';

function geo(id, overrides = {}) {
  return { city_id: id, city_name_formatted: `${id} city`, center_lat: 47.6, center_lng: -122.3, ...overrides };
}

/** Renders the page and fires the map's load event, since the source and layer are only added on load. */
async function render(cities, citiesGeo, mapboxToken = 'pk.test') {
  map = null;
  await renderAcrossCities({ markup: MARKUP, scorecards: { cities }, citiesGeo, mapboxToken });
  map?.loadCallbacks.forEach((cb) => cb());
}

function features() {
  return Object.fromEntries(map.sources['ac-cities'].data.features.map((f) => [f.properties.name, f]));
}

function fire(event, feature) {
  map.handlers[event]({ features: [feature] });
}

describe('Across Cities — deployment map', () => {
  it('degrades to a note without a token', async () => {
    await render([makeCity('a')], { cities: [geo('a')] }, null);
    expect(map).toBeNull();
    expect(document.getElementById('ac-map-status').textContent).toBe('Map unavailable.');
    expect(document.getElementById('ac-cities-map').style.display).toBe('none');
  });

  it('degrades to a note when the cities geo fails, leaving the rest of the page drawn', async () => {
    await render([makeCity('a')], new Error('geo down'));
    expect(map).toBeNull();
    expect(document.getElementById('ac-map-status').textContent).toBe('Map unavailable.');
  });

  it('says so when no city has a location', async () => {
    await render([makeCity('a')], { cities: [geo('a', { center_lat: null }), geo('b', { center_lng: undefined })] });
    expect(map).toBeNull();
    expect(document.getElementById('ac-map-status').textContent).toBe('No city locations available.');
  });

  it('opens on the world view with our token', async () => {
    await render([makeCity('a')], { cities: [geo('a')] });
    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(map.options.container).toBe('ac-cities-map');
    expect(map.layers.map((l) => l.id)).toEqual(['ac-cities-circles']);
  });

  it('scales circle area to label count, so radius grows with its square root', async () => {
    await render(
      [makeCity('big', { total_labels: 400 }), makeCity('quarter', { total_labels: 100 }), makeCity('none')],
      { cities: [geo('big'), geo('quarter'), geo('none')] },
    );
    const f = features();
    expect(f['big city'].properties.radius).toBe(24);
    expect(f['quarter city'].properties.radius).toBe(14.5);
    expect(f['none city'].properties.radius).toBe(5);
  });

  it('colors by lifecycle, gray for a city with no scorecard, and keeps private deployments marked', async () => {
    await render(
      [makeCity('a', { lifecycle: 'stalled' }), makeCity('b', { visibility: 'private' })],
      { cities: [geo('a'), geo('b'), geo('c', { url: 'https://c.example.org' })] },
    );
    const f = features();
    expect(f['a city'].properties.color).toBe('#e0a800');
    expect(f['b city'].properties.visibility).toBe('private');
    expect(f['c city'].properties.color).toBe('#9aa7b0');
    expect(f['c city'].properties.url).toBe('https://c.example.org');
    // Without a geo URL the scorecard's is used.
    expect(f['a city'].properties.url).toBe('https://a.example.org');
  });

  it('states a city’s numbers in its popup, and that a city with no scorecard has none', async () => {
    await render(
      [makeCity('a', { lifecycle: 'wrapped_up', coverage: 0.95, total_labels: 12000, last_activity: null })],
      { cities: [geo('a', { city_name_formatted: 'A <b>town</b>' }), geo('c')] },
    );
    const f = features();
    const popup = document.createElement('div');
    popup.innerHTML = f['A <b>town</b>'].properties.popup;
    expect(popup.querySelector('b')).toBeNull();
    expect(popup.querySelector('.coverage-popup-name').textContent).toBe('A <b>town</b>');
    const rows = Object.fromEntries([...popup.querySelectorAll('tr')].map((tr) => [tr.cells[0].textContent,
      tr.cells[1].textContent]));
    expect(rows).toMatchObject({ Status: 'Wrapped up', Coverage: '95%', Labels: '12,000', 'Last activity': 'never' });
    expect(f['c city'].properties.popup).toContain('No stats available.');
  });

  it('shows the popup on hover and hides it on leave', async () => {
    await render([makeCity('a')], { cities: [geo('a')] });
    const feature = features()['a city'];
    fire('mouseenter', feature);
    expect(map.popup.open).toBe(true);
    expect(map.popup.html).toBe(feature.properties.popup);
    expect(map.popup.lngLat).toEqual([-122.3, 47.6]);
    expect(map.canvasStyle.cursor).toBe('pointer');
    map.handlers.mouseleave();
    expect(map.popup.open).toBe(false);
    expect(map.canvasStyle.cursor).toBe('');
  });

  it('opens the city in a new tab on click, and does nothing for a city with no URL', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await render([makeCity('a'), makeCity('b', { url: null })], { cities: [geo('a'), geo('b')] });
    fire('click', features()['a city']);
    expect(open).toHaveBeenCalledWith('https://a.example.org', '_blank', 'noopener');
    open.mockClear();
    fire('click', features()['b city']);
    expect(open).not.toHaveBeenCalled();
  });
});
