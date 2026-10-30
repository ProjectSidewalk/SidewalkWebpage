/** Tests for the Street Status page's per-street map, its status palette and its hover popup (#5840). */

import { loadModules, mockModule } from './loader.js';
import { stubMapbox } from './support/adminMapHarness.js';

const mapboxgl = {};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
const { StreetStatusColors, StreetStatusMap } = await loadModules('frontend/js/admin-dashboard/StreetStatusMap.js');

const STREETS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-122.5, 47.5], [-122.25, 47.75]] },
      properties: { street_edge_id: 1, region_id: 10 } },
  ],
};

/** @returns {object} A map mouse event over one street, with the properties the streets API sends. */
const over = (id, props = {}) => ({
  lngLat: { lng: -122.4, lat: 47.6 },
  features: [{ id, properties: { street_edge_id: id, region_id: 10, region_name: 'Downtown', status: 'no_imagery',
    way_type: 'residential', audit_count: 3, label_count: 1234, user_count: 2, ...props } }],
});

/** @returns {{state: object, events: string[], map: object}} A loaded map whose callbacks log into `events`. */
async function loadMap() {
  const state = stubMapbox(mapboxgl);
  const events = [];
  const map = new StreetStatusMap('street-status-choropleth', {
    mapboxToken: 'pk.test',
    onRegionClick: (id) => events.push(`click ${id}`),
    onRegionHover: (id) => events.push(`hover ${id}`),
    onRegionHoverEnd: () => events.push('hover end'),
  });
  const ready = map.init(STREETS);
  state.load();
  await ready;
  return { state, events, map };
}

/** @returns {HTMLElement} The popup's HTML, parsed. */
function popupOf(state) {
  const el = document.createElement('div');
  el.innerHTML = state.popup.html;
  return el;
}

describe('StreetStatusColors', () => {
  test('names and colors each known status, and falls back for one it does not know', () => {
    expect(StreetStatusColors.colorFor('open')).toBe('#60A189');
    expect(StreetStatusColors.labelFor('no_imagery')).toBe('No imagery');
    expect(StreetStatusColors.colorFor('retired')).toBe(StreetStatusColors.FALLBACK);
    expect(StreetStatusColors.labelFor('retired')).toBe('retired');
  });

  test('hands Mapbox a match over every status, ending in the fallback', () => {
    expect(StreetStatusColors.mapboxExpression()).toEqual(['match', ['get', 'status'], 'open', '#60A189',
      'no_imagery', '#EB724E', 'closed', '#B3B3B3', 'disabled', '#424055', '#d0d0d0']);
  });
});

describe('StreetStatusMap', () => {
  test('refuses to start without a Mapbox token', () => {
    stubMapbox(mapboxgl);
    expect(() => new StreetStatusMap('street-status-choropleth', {}).init(STREETS))
      .toThrow(/missing Mapbox access token/);
  });

  test('opens on the streets, colored by status, keyed by street id', async () => {
    const { state } = await loadMap();
    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(state.options.bounds.toArray()).toEqual([[-122.5, 47.5], [-122.25, 47.75]]);
    expect(state.sources['street-status-streets']).toMatchObject({ promoteId: 'street_edge_id' });
    expect(state.layers['street-status-line'].paint['line-color']).toEqual(StreetStatusColors.mapboxExpression());
    expect(state.layers['street-status-selected'].paint['line-color']).toBe(StreetStatusColors.SELECTED);
  });

  test('hovering a street shows its status and activity, and brushes its region', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'street-status-line', over(7));

    expect(state.cursor).toBe('pointer');
    expect(state.stateOf(7)).toEqual({ hover: true });
    expect(events).toEqual(['hover 10']);
    const popup = popupOf(state);
    expect(popup.querySelector('.coverage-popup-name').textContent).toBe('Street 7');
    expect([...popup.querySelectorAll('dd')].map((dd) => dd.textContent))
      .toEqual(['No imagery', 'Downtown', 'residential', '3', '1,234', '2']);
    expect(popup.querySelector('.street-status-swatch').getAttribute('style')).toBe('background:#EB724E');
    expect(state.popup.open).toBe(true);
  });

  test('a street with an unknown status and no activity shows the raw status and zeros', async () => {
    const { state } = await loadMap();
    state.fire('mousemove', 'street-status-line',
      over(7, { status: 'retired', audit_count: null, label_count: undefined, user_count: 0 }));
    const popup = popupOf(state);
    expect([...popup.querySelectorAll('dd')].map((dd) => dd.textContent))
      .toEqual(['retired', 'Downtown', 'residential', '0', '0', '0']);
    expect(popup.querySelector('.street-status-swatch').getAttribute('style')).toBe('background:#d0d0d0');
  });

  test('moving along one street fires its hover once; moving to the next unhovers the first', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'street-status-line', over(7));
    state.fire('mousemove', 'street-status-line', over(7));
    state.fire('mousemove', 'street-status-line', over(8, { region_id: '20' }));
    expect(events).toEqual(['hover 10', 'hover 20']);
    expect(state.stateOf(7)).toEqual({ hover: false });
  });

  test('a mouse event that hits no street is ignored', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'street-status-line', { features: [] });
    state.fire('click', 'street-status-line', { features: [] });
    expect(events).toEqual([]);
  });

  test('leaving the map clears the hover and closes the popup', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'street-status-line', over(7));
    state.fire('mouseleave', 'street-status-line');
    expect(state.cursor).toBe('');
    expect(state.stateOf(7)).toEqual({ hover: false });
    expect(state.popup.open).toBe(false);
    expect(events).toEqual(['hover 10', 'hover end']);
  });

  test('clicking a street reports its region, not the street', async () => {
    const { state, events } = await loadMap();
    state.fire('click', 'street-status-line', over(7, { region_id: '42' }));
    expect(events).toEqual(['click 42']);
  });

  test('a new highlight outlines only its streets, touching just the ones that changed', async () => {
    const { state, map } = await loadMap();
    map.highlightSegments([1, 2, 3]);
    state.featureStates.length = 0;
    map.highlightSegments(['3', 4]);
    expect(state.featureStates.map(({ target, value }) => [target.id, value.selected]))
      .toEqual([[1, false], [2, false], [4, true]]);

    map.clearHighlight();
    expect([3, 4].map((id) => state.stateOf(id).selected)).toEqual([false, false]);
  });

  test('focusing a street outlines it alone and zooms to it, no closer than street level allows', async () => {
    const { state, map } = await loadMap();
    map.highlightSegments([1, 2]);
    const bounds = { toArray: () => [[0, 0], [1, 1]] };
    map.focusSegment(5, bounds);
    expect(state.stateOf(1).selected).toBe(false);
    expect(state.stateOf(5).selected).toBe(true);
    expect(state.fits).toEqual([{ bounds: [[0, 0], [1, 1]], options: { padding: 140, maxZoom: 16, duration: 700 } }]);
  });
});
