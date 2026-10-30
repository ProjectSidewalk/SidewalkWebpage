/**
 * The /v3/api-docs/places preview (#5840): a map of one region's places, one dot each, with a count, a legend of the
 * categories present, and a popup per place.
 */

import { loadModules } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

function place(id, [lng, lat], properties = {}) {
  return {
    type: 'Feature',
    properties: { place_id: id, category: 'library', name: `Place ${id}`, ...properties },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

const PLACES = {
  type: 'FeatureCollection',
  features: [
    place(1, [0.001, 0.002]),
    place(2, [0.004, 0.001], { category: 'school' }),
    place(3, [0.003, 0.005]),
  ],
};

/** Loads the preview onto a page with its container, and runs it against the given responses. */
async function renderPreview({ routes = {} } = {}) {
  document.body.innerHTML = '<div id="places-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/places?inline=true': PLACES,
    ...routes,
  });
  const { PlacesPreview } = await loadModules('frontend/js/api-docs/placesPreview.js');
  await PlacesPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, container: document.getElementById('places-preview') };
}

/** Clicks a place on the map and returns its popup. */
function clickPlace(properties) {
  world.maps[0].fireOn('place-points', 'click', [{ properties }], { lng: 3, lat: 4 });
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a region with places', () => {
  it("asks for the busiest region's places, and frames the map on them", async () => {
    const { fetchStub, container } = await renderPreview();
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([
      '/v3/api/regionWithMostLabels?utm_source=apiDocs',
      '/v3/api/places?inline=true&regionId=7&utm_source=apiDocs',
    ]);
    const map = world.maps[0];
    expect(map.container).toBe(container.querySelector('#places-map'));
    expect(map.options.bounds.toArray()).toEqual([[0.001, 0.001], [0.004, 0.005]]);
    expect(container.querySelector('.loading-message')).toBeNull();
  });

  it('counts the places and lists each category present with how many it holds', async () => {
    const { container } = await renderPreview();
    expect(textOf(container.querySelector('.map-chip'))).toBe('3 places');
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Places by category');
    expect([...legend.querySelectorAll('.map-legend-item')].map(textOf)).toEqual(['library (2)', 'school (1)']);
  });

  it('says "1 place" when there is only one', async () => {
    const { container } = await renderPreview({
      routes: { '/v3/api/places?inline=true': { type: 'FeatureCollection', features: [place(1, [0, 0])] } },
    });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 place');
  });

  it('enlarges the place under the pointer', async () => {
    await renderPreview();
    const map = world.maps[0];
    expect(map.layers['place-points'].paint['circle-radius'])
      .toEqual(['case', ['boolean', ['feature-state', 'hover'], false], 9, 6]);
    map.fireOn('place-points', 'mousemove', [{ id: 2 }]);
    expect(map.stateOf('places', 2)).toEqual({ hover: true });
    // Moving within the same place changes nothing.
    map.fireOn('place-points', 'mousemove', [{ id: 2 }]);
    map.fireOn('place-points', 'mousemove', []);
    expect(map.stateOf('places', 2)).toEqual({ hover: true });
    map.fire('mouseleave', {}, 'place-points');
    expect(map.stateOf('places', 2)).toEqual({ hover: false });
  });
});

describe("a place's popup", () => {
  it('names the place, its category and id, its nearest street, and links it on OpenStreetMap', async () => {
    await renderPreview();
    const popup = clickPlace({
      place_id: 1, name: 'Central Library', category: 'library', nearest_street_edge_id: 42,
      nearest_street_distance_m: 18.6, osm_url: 'https://www.openstreetmap.org/node/9',
    });
    expect(popup.lngLat).toEqual({ lng: 3, lat: 4 });
    expect(popup.text()).toBe(
      'Central Library Category: library Place ID: 1 Nearest street: street 42, 19 m away View on OpenStreetMap');
    expect(popup.element.querySelector('a[href="https://www.openstreetmap.org/node/9"]')).not.toBeNull();
  });

  it('calls an unnamed place by its category, and says when no street is near', async () => {
    await renderPreview();
    const popup = clickPlace({ place_id: 2, category: 'school', nearest_street_edge_id: null });
    expect(popup.text()).toBe('Unnamed school Category: school Place ID: 2 Nearest street: no street within 250 m');
    expect(popup.element.querySelector('a')).toBeNull();
  });

  it('treats a missing nearest street the same as none', async () => {
    await renderPreview();
    expect(clickPlace({ place_id: 3, category: 'park' }).text()).toContain('no street within 250 m');
  });
});

describe('without a region or places', () => {
  it('asks for the whole city when the region lookup fails', async () => {
    const { fetchStub } = await renderPreview({ routes: { '/v3/api/regionWithMostLabels': { status: 500 } } });
    expect(fetchStub.mock.calls[1][0]).toBe('/v3/api/places?inline=true&utm_source=apiDocs');
  });

  it('asks for the whole city when there is no region', async () => {
    const { fetchStub } = await renderPreview({ routes: { '/v3/api/regionWithMostLabels': null } });
    expect(fetchStub.mock.calls[1][0]).toBe('/v3/api/places?inline=true&utm_source=apiDocs');
  });

  it('shows the whole world and says so when the city has no places yet', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/places?inline=true': {} } });
    const map = world.maps[0];
    expect(map.options).toMatchObject({ center: [0, 0], zoom: 1 });
    expect(map.options.bounds).toBeUndefined();
    const message = container.querySelector('.map-message');
    expect(message.getAttribute('role')).toBe('status');
    expect(textOf(message)).toBe('No places have been fetched for this city yet.');
    expect(map.layers['place-points']).toBeUndefined();
  });
});

describe('when something fails', () => {
  it('shows a friendly message when the places request fails', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/places?inline=true': { status: 503 } } });
    expect(textOf(container)).toBe('Unable to load places for the preview.');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('does nothing but report it when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { PlacesPreview } = await loadModules('frontend/js/api-docs/placesPreview.js');
    await PlacesPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Places preview container not found.');
  });
});
